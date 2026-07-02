import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, dirname, resolve } from "node:path";

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

export function buildRecorderCommand({ audioPath, durationSec, sampleRate, device, command }) {
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

  if (process.platform === "darwin") {
    const args = [
      "-f",
      "WAVE",
      "-d",
      String(durationSec),
      "-r",
      String(sampleRate),
      "-c",
      "1"
    ];
    if (device) args.push("-i", String(device));
    args.push(audioPath);
    return {
      name: "afrecord",
      executable: "/usr/bin/afrecord",
      args
    };
  }

  throw new Error(
    `No built-in recorder for this platform (${process.platform}); only macOS has one. ` +
    "Provide --record-command or set SUBTEXT_RECORD_COMMAND with a template using the " +
    "{out}, {duration}, {sampleRate}, {device} placeholders. Examples: " +
    "Windows: --record-command \"ffmpeg -f dshow -i audio=\\\"Microphone\\\" -t {duration} {out}\"; " +
    "Linux: --record-command \"arecord -d {duration} -f cd {out}\"."
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
