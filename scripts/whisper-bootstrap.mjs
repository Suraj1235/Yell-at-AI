#!/usr/bin/env node
// whisper-bootstrap: help a user obtain an offline whisper.cpp binary and a small
// ggml model for the `whisper` STT adapter.
//
// By default this PRINTS instructions only — it never downloads or bundles
// anything, so a fresh checkout stays weight-free and there is no surprise
// network egress. A clearly gated, opt-in `--download` flag can fetch a single
// small model file into a target directory, and only after explicit `--yes`
// confirmation. The binary itself is always built/installed by the user; we do
// not fetch executables.
//
// Usage:
//   node scripts/whisper-bootstrap.mjs            # print OS-specific instructions
//   node scripts/whisper-bootstrap.mjs --help     # show this help
//   node scripts/whisper-bootstrap.mjs --model tiny.en   # instructions for a model
//   node scripts/whisper-bootstrap.mjs --download --model tiny.en --yes   # opt-in fetch
//
// No network access happens unless BOTH --download and --yes are passed.
import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { platform } from "node:os";

const MODELS_BASE_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

// A few small, English-friendly models. Sizes are approximate download sizes.
const MODELS = {
  "tiny.en": { file: "ggml-tiny.en.bin", size: "~75 MB", note: "fastest, lowest accuracy" },
  tiny: { file: "ggml-tiny.bin", size: "~75 MB", note: "fastest, multilingual" },
  "base.en": { file: "ggml-base.en.bin", size: "~142 MB", note: "good default for English" },
  base: { file: "ggml-base.bin", size: "~142 MB", note: "good default, multilingual" },
  "small.en": { file: "ggml-small.en.bin", size: "~466 MB", note: "higher accuracy, slower" },
  small: { file: "ggml-small.bin", size: "~466 MB", note: "higher accuracy, multilingual" }
};

const DEFAULT_MODEL = "base.en";

run().catch((error) => {
  process.stderr.write(`whisper-bootstrap: ${error.message}\n`);
  process.exit(1);
});

async function run() {
  // parseArgs may throw on a bad flag; keep its error in the same clean handler
  // (message only, no stack) as the rest of the script.
  await main(parseArgs(process.argv.slice(2)));
}

async function main(opts) {
  if (opts.help) {
    printHelp();
    return;
  }

  const modelKey = opts.model ?? DEFAULT_MODEL;
  const model = MODELS[modelKey];
  if (!model) {
    throw new Error(
      `unknown model "${modelKey}". Known: ${Object.keys(MODELS).join(", ")}. Run --help for details.`
    );
  }

  if (opts.download) {
    await runDownload(modelKey, model, opts);
    return;
  }

  printInstructions(modelKey, model);
}

function printInstructions(modelKey, model) {
  const os = platform();
  const out = process.stdout;

  out.write("Subtext offline whisper.cpp setup\n");
  out.write("=================================\n\n");
  out.write("This prints instructions only. Nothing is downloaded or bundled by default,\n");
  out.write("so audio and models stay entirely on your machine (no network egress).\n\n");

  out.write("1) Build or install the whisper.cpp binary\n");
  out.write("------------------------------------------\n");
  if (os === "darwin") {
    out.write("   Homebrew (simplest):\n");
    out.write("     brew install whisper-cpp\n");
    out.write("     # provides `whisper-cli` on PATH\n\n");
    out.write("   Or build from source:\n");
  } else if (os === "win32") {
    out.write("   Prebuilt binaries are published on the whisper.cpp releases page:\n");
    out.write("     https://github.com/ggerganov/whisper.cpp/releases\n");
    out.write("   Download a Windows build, unzip it, and note the path to whisper-cli.exe\n");
    out.write("   (older builds call it main.exe).\n\n");
    out.write("   Or build from source (requires CMake + a C++ toolchain):\n");
  } else {
    out.write("   Some distros package it (e.g. `apt install whisper-cpp` / AUR `whisper.cpp`).\n");
    out.write("   Otherwise build from source:\n");
  }
  out.write("     git clone https://github.com/ggerganov/whisper.cpp\n");
  out.write("     cd whisper.cpp\n");
  out.write("     cmake -B build && cmake --build build --config Release\n");
  out.write("     # binary lands at build/bin/whisper-cli (or main on older versions)\n\n");

  out.write("2) Download a small model (ggml format)\n");
  out.write("---------------------------------------\n");
  out.write(`   Recommended: ${modelKey} (${model.size}, ${model.note})\n`);
  out.write(`     ${MODELS_BASE_URL}/${model.file}\n\n`);
  out.write("   whisper.cpp ships a helper that does the same download:\n");
  if (os === "win32") {
    out.write(`     .\\models\\download-ggml-model.cmd ${modelKey}\n\n`);
  } else {
    out.write(`     ./models/download-ggml-model.sh ${modelKey}\n\n`);
  }
  out.write("   Or let this script fetch just the model (opt-in, explicit):\n");
  out.write(`     node scripts/whisper-bootstrap.mjs --download --model ${modelKey} --yes\n\n`);

  out.write("3) Point Subtext at them\n");
  out.write("------------------------\n");
  out.write("   Set these environment variables (or pass the binary via PATH):\n");
  if (os === "win32") {
    out.write("     $env:SUBTEXT_WHISPER_BIN = \"C:\\\\path\\\\to\\\\whisper-cli.exe\"\n");
    out.write(`     $env:SUBTEXT_WHISPER_MODEL = \"C:\\\\path\\\\to\\\\${model.file}\"\n\n`);
  } else {
    out.write("     export SUBTEXT_WHISPER_BIN=/path/to/whisper-cli\n");
    out.write(`     export SUBTEXT_WHISPER_MODEL=/path/to/${model.file}\n\n`);
  }
  out.write("   If `whisper`, `whisper-cli`, or `main` is already on PATH, SUBTEXT_WHISPER_BIN\n");
  out.write("   is optional. SUBTEXT_WHISPER_MODEL is needed unless your binary has a built-in\n");
  out.write("   default model.\n\n");

  out.write("4) Use it\n");
  out.write("---------\n");
  out.write("   The `whisper` adapter is part of the pluggable STT interface\n");
  out.write("   (src/transcribe/index.js). Example, in Node:\n\n");
  out.write("     import { transcribe } from \"./src/transcribe/index.js\";\n");
  out.write("     const t = await transcribe(\"turn.wav\", { adapter: \"whisper\" });\n");
  out.write("     // -> { text, source: \"whisper.cpp\", language?, confidence?, words? }\n\n");
  out.write("   See docs/WHISPER.md for the full guide and the offline privacy guarantee.\n");
}

async function runDownload(modelKey, model, opts) {
  const out = process.stdout;
  const targetDir = resolve(opts.dir ?? "models");
  const targetPath = join(targetDir, model.file);
  const url = `${MODELS_BASE_URL}/${model.file}`;

  if (!opts.yes) {
    out.write("Opt-in model download (dry run)\n");
    out.write("===============================\n\n");
    out.write("This would download ONE model file. No binary is fetched. Re-run with --yes\n");
    out.write("to actually download. Nothing leaves your machine except this single GET.\n\n");
    out.write(`   model:  ${modelKey} (${model.size}, ${model.note})\n`);
    out.write(`   from:   ${url}\n`);
    out.write(`   to:     ${targetPath}\n\n`);
    out.write("   Confirm with:\n");
    out.write(`     node scripts/whisper-bootstrap.mjs --download --model ${modelKey} --dir ${opts.dir ?? "models"} --yes\n`);
    return;
  }

  if (typeof fetch !== "function") {
    throw new Error("global fetch is unavailable; use Node >= 18 or download the model manually (see --help).");
  }

  if (await fileExists(targetPath)) {
    out.write(`Model already present, skipping download: ${targetPath}\n`);
    printPointEnv(targetPath);
    return;
  }

  out.write(`Downloading ${modelKey} (${model.size}) ...\n`);
  out.write(`   from: ${url}\n   to:   ${targetPath}\n`);
  await mkdir(dirname(targetPath), { recursive: true });

  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) {
    throw new Error(`download failed: HTTP ${response.status} ${response.statusText}`);
  }

  await streamToFile(response.body, targetPath);
  const size = await fileSize(targetPath);
  out.write(`Done. Wrote ${formatBytes(size)} to ${targetPath}\n\n`);
  printPointEnv(targetPath);
}

function printPointEnv(targetPath) {
  const out = process.stdout;
  out.write("Point Subtext at the model:\n");
  if (platform() === "win32") {
    out.write(`   $env:SUBTEXT_WHISPER_MODEL = "${targetPath}"\n`);
  } else {
    out.write(`   export SUBTEXT_WHISPER_MODEL="${targetPath}"\n`);
  }
  out.write("And ensure a whisper.cpp binary is on PATH or set SUBTEXT_WHISPER_BIN.\n");
}

async function streamToFile(webStream, targetPath) {
  const fileStream = createWriteStream(targetPath);
  const reader = webStream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!fileStream.write(Buffer.from(value))) {
        await new Promise((resolveDrain) => fileStream.once("drain", resolveDrain));
      }
    }
  } finally {
    reader.releaseLock?.();
  }
  await new Promise((resolveEnd, rejectEnd) => {
    fileStream.end((error) => (error ? rejectEnd(error) : resolveEnd()));
  });
}

function printHelp() {
  const out = process.stdout;
  out.write("whisper-bootstrap - obtain an offline whisper.cpp binary + model for Subtext\n\n");
  out.write("Usage:\n");
  out.write("  node scripts/whisper-bootstrap.mjs [options]\n\n");
  out.write("Options:\n");
  out.write("  --help, -h          Show this help and exit.\n");
  out.write("  --model <name>      Target model. Default: base.en.\n");
  out.write(`                      Known: ${Object.keys(MODELS).join(", ")}.\n`);
  out.write("  --download          Opt-in: fetch ONE model file (no binary). Dry run unless --yes.\n");
  out.write("  --dir <path>        Download directory for --download. Default: ./models.\n");
  out.write("  --yes               Confirm an actual --download (otherwise it only prints a plan).\n\n");
  out.write("Behavior:\n");
  out.write("  With no flags, prints OS-specific instructions to install whisper.cpp and a\n");
  out.write("  small model, and how to point Subtext at them. Nothing is downloaded or\n");
  out.write("  bundled by default. Audio stays fully offline once set up.\n\n");
  out.write("Environment variables read by the whisper adapter:\n");
  out.write("  SUBTEXT_WHISPER_BIN     Path to a whisper.cpp binary (overrides PATH lookup).\n");
  out.write("  SUBTEXT_WHISPER_MODEL   Path to a ggml model file (e.g. ggml-base.en.bin).\n\n");
  out.write("See docs/WHISPER.md for the full guide.\n");
}

function parseArgs(argv) {
  const opts = { help: false, download: false, yes: false, model: null, dir: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--help":
      case "-h":
        opts.help = true;
        break;
      case "--download":
        opts.download = true;
        break;
      case "--yes":
      case "-y":
        opts.yes = true;
        break;
      case "--model":
        opts.model = argv[++i];
        break;
      case "--dir":
        opts.dir = argv[++i];
        break;
      default:
        if (arg.startsWith("--model=")) opts.model = arg.slice("--model=".length);
        else if (arg.startsWith("--dir=")) opts.dir = arg.slice("--dir=".length);
        else throw new Error(`unknown argument "${arg}". Run --help for usage.`);
    }
  }
  return opts;
}

async function fileExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function fileSize(path) {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}
