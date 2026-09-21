// Whisper STT adapter: shell out to a whisper.cpp binary for fully offline
// transcription. No model weights are bundled and there is no network egress —
// the binary and model live on the user's machine and the audio never leaves it.
// See docs/WHISPER.md for install, model choice, and the privacy guarantee.
//
// Binary discovery order:
//   1. env SUBTEXT_WHISPER_BIN (explicit override; must point at a real file)
//   2. the first of `whisper`, `whisper-cli`, `main` found on PATH
//      (PATHEXT-aware on Windows, restricted to .COM/.EXE/.BAT/.CMD so a
//      generic name like `main` can never resolve to a same-named Control
//      Panel applet, MMC snap-in, or script host file that happens to share
//      an extension listed in PATHEXT)
// If none resolve, throw the actionable not-found error pointing at docs/WHISPER.md.
//
// Model discovery (optional): SUBTEXT_WHISPER_MODEL points at a ggml model file
// (e.g. ggml-base.en.bin). When set, `-m <model>` is injected. If it is set but
// the file is missing, throw an actionable model-not-found error. When it is
// unset, no `-m` is added and the binary uses whatever default it was built with.
//
// Output parsing accepts either whisper.cpp's plain stdout (text, optionally with
// per-line "[hh:mm:ss --> ...]" markers) or its JSON (`-oj` / `--output-json` /
// `--output-json-full`), from which word/token timings are lifted into the
// envelope. The runner is injectable so the adapter is fully testable offline.
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolveInstalledModel } from "./models.js";

export const WHISPER_BINARY_NAMES = ["whisper", "whisper-cli", "main"];
export const WHISPER_SOURCE = "whisper.cpp";
export const WHISPER_NOT_FOUND_MESSAGE =
  "whisper binary not found; set SUBTEXT_WHISPER_BIN or install whisper.cpp - see docs/WHISPER.md";

// Resolve a usable whisper binary path, or throw the actionable not-found error.
// `env` is injectable so the resolver is testable offline. `platform` is
// injectable too (defaults to process.platform) so PATHEXT handling can be
// exercised hermetically on any CI runner regardless of its real OS.
export function resolveWhisperBinary(env = process.env, platform = process.platform) {
  const override = env.SUBTEXT_WHISPER_BIN;
  if (override) {
    if (isExecutableFile(override)) return override;
    throw new Error(WHISPER_NOT_FOUND_MESSAGE);
  }

  const found = findOnPath(WHISPER_BINARY_NAMES, env, platform);
  if (found) return found;

  throw new Error(WHISPER_NOT_FOUND_MESSAGE);
}

// Resolve the ggml model path from SUBTEXT_WHISPER_MODEL, falling back to a
// model installed by `subtext model download` (see src/transcribe/models.js),
// or null when neither is available. Throws an actionable error when
// SUBTEXT_WHISPER_MODEL is set but the file is missing.
export function resolveWhisperModel(env = process.env) {
  const model = env.SUBTEXT_WHISPER_MODEL;
  if (model) {
    if (isExecutableFile(model)) return model;
    throw new Error(
      `whisper model not found at SUBTEXT_WHISPER_MODEL=${model}; download a ggml model - see docs/WHISPER.md`
    );
  }

  // Fall back to a model installed by `subtext model download`, so the offline
  // default works without the user setting any environment variable.
  const managed = resolveInstalledModel("base.en", env);
  return managed ?? null;
}

// Build the argument vector passed to the whisper binary for a given audio file.
// Requests JSON-with-token-timings so word timings can be parsed, keeps stdout
// quiet of progress noise, and injects `-m <model>` when a model is resolved.
// `extraArgs` (caller-supplied) win by being appended last.
export function buildWhisperArgs({ audio, model = null, json = true, extraArgs = [] } = {}) {
  if (!audio) throw new Error("whisper adapter requires an audio file path.");
  const args = [];
  if (model) args.push("-m", model);
  if (json) {
    // -oj writes a sidecar JSON file; --output-json-full also emits token times.
    // We additionally pass them so a JSON-capable build prints structured output
    // we can lift word timings from; plain-text builds simply ignore unknowns at
    // their own discretion. Callers that need a different shape override via args.
    args.push("--output-json", "--output-json-full");
  }
  args.push(...extraArgs, audio);
  return args;
}

// Transcribe an audio file with whisper.cpp and return a transcript envelope:
// { text, source: "whisper.cpp", language?, confidence?, words? }. `words` are
// present only when the binary emitted JSON token/word timings. `runner` is
// injectable for tests; it receives (binary, args, env) and resolves to either a
// raw stdout string or an already-parsed object.
export async function transcribeWithWhisper(opts = {}) {
  const { audio, env = process.env, args = [], runner = spawnWhisper, json = true } = opts;
  if (!audio) throw new Error("whisper adapter requires an audio file path.");

  const binary = resolveWhisperBinary(env);
  const model = resolveWhisperModel(env);
  const runArgs = buildWhisperArgs({ audio, model, json, extraArgs: args });

  const raw = await runner(binary, runArgs, env);
  return parseWhisperOutput(raw);
}

// Parse whisper output into a transcript envelope. Accepts:
//   - a plain stdout string (optionally with "[hh:mm:ss.ms --> ...]" line markers)
//   - a JSON string or already-parsed object in whisper.cpp's shape
//     ({ transcription: [{ text, offsets, tokens: [...] }], ... }) or a simple
//     { text, language?, confidence?, words?/segments?/wordTimings? } envelope.
export function parseWhisperOutput(raw) {
  const payload = coerceJson(raw);
  if (payload && typeof payload === "object") return parseWhisperJson(payload);
  return parseWhisperText(typeof raw === "string" ? raw : String(raw ?? ""));
}

// Plain-text path: strip leading "[...]" timestamp markers per line and join.
export function parseWhisperText(raw) {
  const text = String(raw ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\[[^\]]*\]\s*/, "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
  if (!text) throw new Error("whisper produced an empty transcript.");
  return { text, source: WHISPER_SOURCE };
}

// JSON path: handle both whisper.cpp's native `transcription` array and a plain
// { text, ... } envelope. Lift language/confidence when present and word timings
// from tokens/words/segments into the canonical { word, start, end } shape.
function parseWhisperJson(payload) {
  const segments = Array.isArray(payload.transcription) ? payload.transcription : null;

  const text = (
    stringField(payload.text)
    ?? (segments ? segments.map((seg) => stringField(seg?.text) ?? "").join(" ") : null)
    ?? ""
  )
    .replace(/\s+/g, " ")
    .trim();
  if (!text) throw new Error("whisper produced an empty transcript.");

  const envelope = { text, source: WHISPER_SOURCE };

  const language = stringField(payload.language)
    ?? stringField(payload.result?.language)
    ?? stringField(payload.params?.language);
  if (language && language.toLowerCase() !== "auto") envelope.language = language;

  // Only accept an explicit 0..1 confidence. whisper.cpp's avg_logprob is a log
  // probability (negative), not a 0..1 score, so it is deliberately not mapped.
  const confidence = firstFiniteNumber(payload.confidence, payload.result?.confidence);
  if (confidence !== null) envelope.confidence = clamp01(confidence);

  const words = extractWords(payload, segments);
  if (words.length) envelope.words = words;

  return envelope;
}

// Collect word timings from whichever field the JSON exposes. whisper.cpp emits
// per-segment `tokens` with millisecond `offsets`; a simple envelope may instead
// carry `words`/`wordTimings`/`segments`. Output is { word, start, end } seconds.
function extractWords(payload, segments) {
  if (Array.isArray(payload.words)) return payload.words.map(normalizeWord).filter(Boolean);
  if (Array.isArray(payload.wordTimings)) return payload.wordTimings.map(normalizeWord).filter(Boolean);

  const words = [];
  for (const segment of segments ?? []) {
    const tokens = Array.isArray(segment?.tokens)
      ? segment.tokens
      : Array.isArray(segment?.words)
        ? segment.words
        : null;
    if (tokens) {
      for (const token of tokens) {
        const word = normalizeWord(token);
        if (word) words.push(word);
      }
    } else {
      const word = normalizeWord(segment);
      if (word) words.push(word);
    }
  }
  return words;
}

// Normalize one token/word/segment record into { word, start, end } (seconds),
// or null when it has no usable text. Skips whisper.cpp's bracketed special
// tokens (e.g. "[_BEG_]") and accepts either second-based start/end or
// millisecond `offsets: { from, to }`.
function normalizeWord(record) {
  if (!record || typeof record !== "object") return null;
  const text = stringField(record.word) ?? stringField(record.text);
  if (!text) return null;
  if (/^\[.*\]$/.test(text)) return null; // whisper special tokens like [_TT_..]

  let start = firstFiniteNumber(record.start, record.from, record.t0);
  let end = firstFiniteNumber(record.end, record.to, record.t1);

  const offsets = record.offsets && typeof record.offsets === "object" ? record.offsets : null;
  if (start === null && offsets) start = msToSeconds(firstFiniteNumber(offsets.from));
  if (end === null && offsets) end = msToSeconds(firstFiniteNumber(offsets.to));

  const word = { word: text };
  if (start !== null) word.start = start;
  if (end !== null) word.end = end;
  return word;
}

function spawnWhisper(binary, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"], env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `${binary} exited ${code}`));
    });
  });
}

function findOnPath(names, env, platform = process.platform) {
  const pathValue = env.PATH ?? env.Path ?? "";
  const dirs = pathValue.split(pathDelimiterFor(platform)).filter(Boolean);
  const exts = pathExtensions(env, platform);
  for (const dir of dirs) {
    for (const name of names) {
      for (const ext of exts) {
        const candidate = join(dir, name + ext);
        if (isExecutableFile(candidate)) return candidate;
      }
    }
  }
  return null;
}

// Extensions Windows will actually execute a process from directly. PATHEXT on
// a real machine can also list non-executable shell-associated extensions such
// as .CPL (Control Panel applets), .MSC (MMC snap-ins), .JS/.VBS (script host
// files) - spawning one of those as "whisper" fails baffling-ly rather than
// cleanly. A real whisper.cpp release for Windows is always a .exe, so
// restricting to this set cannot lose a legitimate binary.
const EXECUTABLE_EXTENSIONS = new Set([".COM", ".EXE", ".BAT", ".CMD"]);

// PATH and PATHEXT separators belong to the platform being RESOLVED FOR, not to
// the platform running this code. node:path's `delimiter` is the host's, so using
// it here made a win32 resolution simulated on Linux/macOS split PATHEXT on ":"
// and match nothing. PATHEXT is a Windows concept and is always ";"-separated.
function pathDelimiterFor(platform) {
  return platform === "win32" ? ";" : ":";
}

function pathExtensions(env, platform = process.platform) {
  if (platform !== "win32") return [""];
  const pathext = env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD";
  const allowed = pathext
    .split(";")
    .map((ext) => ext.trim())
    .filter(Boolean)
    .filter((ext) => EXECUTABLE_EXTENSIONS.has(ext.toUpperCase()));
  return ["", ...allowed];
}

function isExecutableFile(filePath) {
  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}

// Parse a JSON string into an object, or return null for non-JSON / non-object.
// Already-parsed objects pass through (so an injected runner may return one).
function coerceJson(value) {
  if (value && typeof value === "object") return value;
  const text = String(value ?? "").trim();
  if (!text.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function stringField(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function msToSeconds(ms) {
  if (ms === null) return null;
  return Math.round((ms / 1000) * 1000) / 1000;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}
