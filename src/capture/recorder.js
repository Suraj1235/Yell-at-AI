import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join, dirname, resolve, delimiter } from "node:path";

const DEFAULT_SAMPLE_RATE = 16000;
const DEFAULT_DURATION_SEC = 5;
const DEFAULT_MAX_DURATION_SEC = 60;

export async function recordWav(options = {}) {
  const durationSec = readPositiveNumber(options.durationSec ?? options.duration, DEFAULT_DURATION_SEC, "duration");
  const maxDurationSec = readPositiveNumber(options.maxDurationSec ?? options.maxDuration, DEFAULT_MAX_DURATION_SEC, "maxDuration");
  if (durationSec > maxDurationSec) {
    throw new Error(`Capture duration ${durationSec}s exceeds maxDuration ${maxDurationSec}s.`);
  }

  const sampleRate = Math.round(readPositiveNumber(options.sampleRate, DEFAULT_SAMPLE_RATE, "sampleRate"));
  const audioPath = resolve(options.out ?? defaultCapturePath());
  await mkdir(dirname(audioPath), { recursive: true });

  const recorder = buildRecorderCommand({
    audioPath,
    durationSec,
    sampleRate,
    device: options.device,
    command: options.command ?? process.env.SUBTEXT_RECORD_COMMAND
  });
  const startedAt = new Date();
  await runRecorder(recorder, { timeoutMs: Math.ceil((durationSec + 10) * 1000) });
  const endedAt = new Date();

  return {
    schema: "subtext/capture/v1",
    audioPath,
    durationSec,
    sampleRate,
    recorder: recorder.name,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString()
  };
}

// Recorders we know how to drive, in preference order per platform. ffmpeg is
// first everywhere it appears because it is the most consistently available and
// produces a correct WAV header without extra flags.
const RECORDERS_BY_PLATFORM = {
  win32: ["ffmpeg", "sox"],
  linux: ["ffmpeg", "arecord", "sox"],
  darwin: ["afrecord", "ffmpeg", "sox"]
};

// Resolve the first known recorder present on PATH, PATHEXT-aware on Windows so
// `ffmpeg.exe` resolves from the bare name `ffmpeg`. Returns null when none are
// installed, which the caller turns into an actionable error.
export function findRecorderOnPath(env = process.env, platform = process.platform) {
  const candidates = RECORDERS_BY_PLATFORM[platform] ?? ["ffmpeg", "sox"];
  for (const name of candidates) {
    // macOS ships afrecord at a fixed absolute path rather than on PATH.
    if (name === "afrecord" && platform === "darwin") {
      if (existsSync("/usr/bin/afrecord")) return { name, executable: "/usr/bin/afrecord" };
      continue;
    }
    const resolved = resolveExecutable(name, env, platform);
    if (resolved) return { name, executable: resolved };
  }
  return null;
}

function resolveExecutable(name, env, platform) {
  const pathValue = env.PATH ?? env.Path ?? "";
  const extensions = platform === "win32"
    ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean)
    : [""];
  for (const directory of pathValue.split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = join(directory, `${name}${extension}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

export function buildRecorderCommand({
  audioPath,
  durationSec,
  sampleRate,
  device,
  command,
  env = process.env,
  platform = process.platform,
  detect = null
}) {
  if (command) {
    const [executable, ...args] = splitCommandLine(command).map((part) => replacePlaceholders(part, {
      out: audioPath,
      duration: String(durationSec),
      sampleRate: String(sampleRate),
      device: device ?? ""
    }));
    if (!executable) throw new Error("Custom recorder command is empty.");
    return {
      name: "custom",
      executable,
      args
    };
  }

  const detected = detect ? detect() : findRecorderOnPath(env, platform);

  if (detected?.name === "afrecord") {
    const args = ["-f", "WAVE", "-d", String(durationSec), "-r", String(sampleRate), "-c", "1"];
    if (device) args.push("-i", String(device));
    args.push(audioPath);
    return { name: "afrecord", executable: detected.executable, args };
  }

  if (detected?.name === "ffmpeg") {
    // Input device syntax is platform-specific; the encode flags are not.
    const input = platform === "win32"
      ? ["-f", "dshow", "-i", `audio=${device ?? "default"}`]
      : platform === "darwin"
        ? ["-f", "avfoundation", "-i", `:${device ?? "0"}`]
        : ["-f", "alsa", "-i", String(device ?? "default")];
    return {
      name: "ffmpeg",
      executable: detected.executable,
      args: [
        "-hide_banner", "-loglevel", "error", "-y",
        ...input,
        "-t", String(durationSec),
        "-ac", "1",
        "-ar", String(sampleRate),
        "-acodec", "pcm_s16le",
        audioPath
      ]
    };
  }

  if (detected?.name === "arecord") {
    const args = [
      "-q",
      "-d", String(durationSec),
      "-f", "S16_LE",
      "-r", String(sampleRate),
      "-c", "1"
    ];
    if (device) args.push("-D", String(device));
    args.push(audioPath);
    return { name: "arecord", executable: detected.executable, args };
  }

  if (detected?.name === "sox") {
    const args = ["-q", "-d", "-b", "16", "-c", "1", "-r", String(sampleRate), audioPath, "trim", "0", String(durationSec)];
    return { name: "sox", executable: detected.executable, args };
  }

  throw new Error(
    `No microphone recorder found for this platform (${platform}). Subtext looked for ` +
    `${(RECORDERS_BY_PLATFORM[platform] ?? ["ffmpeg", "sox"]).join(", ")} on PATH. ` +
    `Install one (ffmpeg is the easiest: https://ffmpeg.org/download.html), or pass ` +
    `--record-command / set SUBTEXT_RECORD_COMMAND with a template using the {out}, ` +
    `{duration}, {sampleRate}, {device} placeholders. The desktop app captures in its own ` +
    `window and needs none of this.`
  );
}

function runRecorder(recorder, { timeoutMs }) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(recorder.executable, recorder.args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Recorder timed out after ${timeoutMs} ms.`));
    }, timeoutMs);

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        resolvePromise();
      } else {
        const suffix = stderr.trim() ? `: ${stderr.trim()}` : "";
        reject(new Error(`Recorder failed (${signal ?? code})${suffix}`));
      }
    });
  });
}

function defaultCapturePath() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return join(process.cwd(), ".subtext", "captures", `capture-${stamp}.wav`);
}

function readPositiveNumber(value, fallback, label) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }
  return number;
}

function replacePlaceholders(value, replacements) {
  return String(value).replace(/\{(out|duration|sampleRate|device)\}/g, (_, key) => replacements[key]);
}

function splitCommandLine(command) {
  const parts = [];
  const pattern = /"([^"]*)"|'([^']*)'|[^\s]+/g;
  for (const match of String(command).matchAll(pattern)) {
    parts.push(match[1] ?? match[2] ?? match[0]);
  }
  return parts;
}
