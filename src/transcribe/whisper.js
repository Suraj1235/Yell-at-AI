// Whisper STT adapter: shell out to a whisper.cpp binary for fully offline
// transcription. This is a basic run+parse implementation; S-WHISPER extends it
// with model handling (SUBTEXT_WHISPER_MODEL), JSON word timings, and bootstrap.
//
// Binary discovery order:
//   1. env SUBTEXT_WHISPER_BIN (explicit override)
//   2. the first of `whisper`, `whisper-cli`, `main` found on PATH
// If none resolve, throw an actionable Error pointing at docs/WHISPER.md.
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";

export const WHISPER_BINARY_NAMES = ["whisper", "whisper-cli", "main"];
export const WHISPER_NOT_FOUND_MESSAGE =
  "whisper binary not found; set SUBTEXT_WHISPER_BIN or install whisper.cpp - see docs/WHISPER.md";

// Resolve a usable whisper binary path, or throw the actionable not-found error.
// `env` is injectable so the resolver is testable offline.
export function resolveWhisperBinary(env = process.env) {
  const override = env.SUBTEXT_WHISPER_BIN;
  if (override) {
    if (isExecutableFile(override)) return override;
    throw new Error(WHISPER_NOT_FOUND_MESSAGE);
  }

  const found = findOnPath(WHISPER_BINARY_NAMES, env);
  if (found) return found;

  throw new Error(WHISPER_NOT_FOUND_MESSAGE);
}

// Transcribe an audio file with whisper.cpp and return a transcript envelope:
// { text, source: "whisper.cpp", words? }. `runner` is injectable for tests.
export async function transcribeWithWhisper(opts = {}) {
  const { audio, env = process.env, args = [], runner = spawnWhisper } = opts;
  if (!audio) throw new Error("whisper adapter requires an audio file path.");

  const binary = resolveWhisperBinary(env);
  const raw = String(await runner(binary, [...args, audio], env)).trim();
  return parseWhisperOutput(raw);
}

// Minimal parser: whisper.cpp prints transcript text (optionally with bracketed
// timestamps per line). Strip leading "[hh:mm:ss.ms --> ...]" markers and join.
// S-WHISPER will add JSON word-timing parsing here.
export function parseWhisperOutput(raw) {
  const text = String(raw ?? "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\[[^\]]*\]\s*/, "").trim())
    .filter(Boolean)
    .join(" ")
    .trim();
  if (!text) throw new Error("whisper produced an empty transcript.");
  return { text, source: "whisper.cpp" };
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

function findOnPath(names, env) {
  const pathValue = env.PATH ?? env.Path ?? "";
  const dirs = pathValue.split(delimiter).filter(Boolean);
  const exts = pathExtensions(env);
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

function pathExtensions(env) {
  if (process.platform !== "win32") return [""];
  const pathext = env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD";
  return ["", ...pathext.split(delimiter).filter(Boolean)];
}

function isExecutableFile(filePath) {
  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}
