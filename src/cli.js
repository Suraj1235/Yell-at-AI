import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBaselineFromFiles, mergeBaselines } from "./calibration/baseline.js";
import {
  defaultProfileStorePath,
  deleteProfile,
  getProfile,
  getProfileBaseline,
  listProfiles,
  loadProfileStore,
  saveProfileStore,
  upsertProfileBaseline
} from "./calibration/profile-store.js";
import { recordWav } from "./capture/recorder.js";
import { analyzeFile } from "./contract/analyzer.js";
import { installAdapter } from "./harness/bundles.js";
import { runHarnessConformance, renderHarnessConformance } from "./harness/conformance.js";
import { runHarnessDoctor, renderHarnessDoctor } from "./harness/doctor.js";
import { copyToClipboard } from "./handoff/clipboard.js";
import { pasteIntoActiveApp } from "./handoff/paste.js";
import { renderVocalContext } from "./render/text.js";
import { startHttpServer } from "./server/http.js";
import { startMcpServer } from "./server/mcp.js";
import { transcribeWithCommand } from "./transcribe/command.js";
import { transcribe, getEngine } from "./transcribe/index.js";
import { listModels, downloadModel, modelDirectory } from "./transcribe/models.js";
import { normalizeTranscriptEnvelope, parseTranscriptPayload } from "./transcript/envelope.js";

export async function runCli(argv = []) {
  const [command = "help", ...rest] = argv;

  try {
    if (command === "analyze") {
      const args = parseArgs(rest);
      const contract = await analyzeFromArgs(args, "analyze");
      const output = args.format === "prompt"
        ? renderVocalContext(contract, { verbosity: args.verbosity ?? "subtle" })
        : `${JSON.stringify(contract, null, 2)}\n`;
      if (args.out) {
        await writeOutputFile(args.out, output);
      } else {
        process.stdout.write(output);
      }
      return;
    }

    if (command === "demo") {
      const args = parseArgs(rest);
      args.audio = join(dirname(fileURLToPath(import.meta.url)), "..", "eval", "fixtures", "emphasis.wav");
      args.text = args.text ?? "ship the whole thing";
      const contract = await analyzeFromArgs(args, "demo");
      const output = args.format === "json"
        ? `${JSON.stringify(contract, null, 2)}\n`
        : renderVocalContext(contract, { verbosity: args.verbosity ?? "subtle" });
      process.stdout.write(output);
      return;
    }

    if (command === "handoff") {
      const args = parseArgs(rest);
      const contract = await analyzeFromArgs(args, "handoff");
      const output = renderVocalContext(contract, { verbosity: args.verbosity ?? "subtle" });
      await deliverOutput("handoff", output, args.target ?? "clipboard", args, {
        clipboard: "subtext: copied enriched prompt to clipboard\n",
        paste: "subtext: copied enriched prompt and pasted into active app\n"
      });
      return;
    }

    if (command === "calibrate") {
      const args = parseArgs(rest);
      const items = await readCalibrationItems(args);
      const newBaseline = await buildBaselineFromFiles(items);
      const baseline = await buildCalibrationBaseline(args, newBaseline);
      const output = `${JSON.stringify(baseline, null, 2)}\n`;
      if (args.out) {
        await writeOutputFile(args.out, output);
      } else {
        process.stdout.write(output);
      }
      return;
    }

    if (command === "capture") {
      const args = parseArgs(rest);
      const report = await captureFromArgs(args);
      const transcript = await transcriptFromArgs(args, "capture_text", report.audioPath);

      if (!transcript) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        return;
      }

      const contract = await analyzeCapturedTurn(report, transcript, args);
      const output = args.format === "prompt" || args.target
        ? renderVocalContext(contract, { verbosity: args.verbosity ?? "subtle" })
        : `${JSON.stringify({ capture: report, contract }, null, 2)}\n`;

      await deliverOutput("capture", output, args.target, args, {
        fileHint: " Use --audio-out for the recorded WAV.",
        clipboard: "subtext: captured audio and copied enriched prompt to clipboard\n",
        paste: "subtext: captured audio, copied enriched prompt, and pasted into active app\n"
      });
      return;
    }

    if (command === "session") {
      const args = parseArgs(rest);
      const { report, contract } = await runNaturalSpeechTurn(args, "session");
      const output = args.format === "json"
        ? `${JSON.stringify({ capture: report, contract }, null, 2)}\n`
        : renderVocalContext(contract, { verbosity: args.verbosity ?? "subtle" });

      await deliverOutput("session", output, args.target ?? "stdout", args, {
        fileHint: " Use --audio-out for the recorded WAV.",
        clipboard: "subtext: recorded natural speech and copied enriched prompt to clipboard\n",
        paste: "subtext: recorded natural speech, copied enriched prompt, and pasted into active app\n"
      });
      return;
    }

    if (command === "dictate") {
      const args = parseArgs(rest);
      const { report, contract, engine } = await dictateFromArgs(args);
      const output = args.format === "json"
        ? `${JSON.stringify({ capture: report, engine, contract }, null, 2)}\n`
        : renderVocalContext(contract, { verbosity: args.verbosity ?? "subtle" });

      await deliverOutput("dictate", output, args.target ?? "stdout", args, {
        fileHint: " Use --audio-out for the recorded WAV.",
        clipboard: "subtext: dictated turn copied to clipboard\n",
        paste: "subtext: dictated turn copied and pasted into active app\n"
      });
      return;
    }

    if (command === "ptt") {
      const args = parseArgs(rest);
      await runPttLoop(args);
      return;
    }

    if (command === "profile") {
      await runProfileCommand(rest);
      return;
    }

    if (command === "model") {
      const [subcommand = "list", ...modelRest] = rest;

      if (subcommand === "list") {
        const args = parseArgs(modelRest);
        const rows = listModels();
        if (args.format === "json") {
          process.stdout.write(`${JSON.stringify({ directory: modelDirectory(), models: rows }, null, 2)}\n`);
          return;
        }
        process.stdout.write(`Whisper models in ${modelDirectory()}\n\n`);
        for (const row of rows) {
          const state = row.installed ? "installed" : "not installed";
          process.stdout.write(`  ${row.id.padEnd(10)} ${state.padEnd(14)} ${formatBytes(row.bytes)}  ${row.note}\n`);
        }
        process.stdout.write(`\nInstall one with: subtext model download base.en --yes\n`);
        return;
      }

      if (subcommand === "download") {
        const { id, consent } = parseModelDownloadArgs(modelRest);
        if (!consent) {
          const model = listModels().find((row) => row.id === id);
          process.stderr.write(
            `subtext: downloading ${id} fetches roughly ${formatBytes(model?.bytes ?? 0)} from ` +
            `huggingface.co into ${modelDirectory()}.\n` +
            `This is the only network request Subtext ever makes on your behalf.\n` +
            `Re-run with --yes to confirm: subtext model download ${id} --yes\n`
          );
          process.exitCode = 1;
          return;
        }
        process.stderr.write(`subtext: downloading ${id}...\n`);
        const path = await downloadModel(id, { consent: true });
        process.stdout.write(`subtext: installed ${id} at ${path}\n`);
        return;
      }

      throw new Error(`Unknown model subcommand: ${subcommand}. Use: list, download.`);
    }

    if (command === "render") {
      const args = parseArgs(rest);
      const contract = args.file
        ? await readJsonFile(args.file, "contract JSON")
        : JSON.parse(await readStdin());
      process.stdout.write(renderVocalContext(contract, { verbosity: args.verbosity ?? "subtle" }));
      return;
    }

    if (command === "serve") {
      const args = parseArgs(rest);
      const server = startHttpServer({ port: args.port, host: args.host });
      server.on("listening", () => {
        const address = server.address();
        process.stderr.write(`subtext listening on http://${address.address}:${address.port}\n`);
      });
      server.on("error", (error) => {
        process.stderr.write(`subtext: ${error.message}\n`);
        process.exitCode = 1;
      });
      return;
    }

    if (command === "mcp") {
      startMcpServer();
      return;
    }

    if (command === "doctor") {
      const args = parseArgs(rest);
      const report = await runHarnessDoctor({ harness: args.harness });
      const output = args.format === "json"
        ? `${JSON.stringify(report, null, 2)}\n`
        : renderHarnessDoctor(report);
      if (args.out) {
        await writeOutputFile(args.out, output);
      } else {
        process.stdout.write(output);
      }
      return;
    }

    if (command === "conformance") {
      const args = parseArgs(rest);
      const report = await runHarnessConformance();
      const output = args.format === "text"
        ? renderHarnessConformance(report)
        : `${JSON.stringify(report, null, 2)}\n`;
      if (args.out) {
        await writeOutputFile(args.out, output);
      } else {
        process.stdout.write(output);
      }
      if (!report.ok) process.exitCode = 1;
      return;
    }

    if (command === "install-adapter") {
      const args = parseArgs(rest);
      const report = await installAdapter({
        harness: args.harness ?? args._[0],
        target: args.target,
        dryRun: Boolean(args["dry-run"]),
        force: Boolean(args.force)
      });
      const output = args.format === "json"
        ? `${JSON.stringify(report, null, 2)}\n`
        : renderAdapterInstall(report);
      process.stdout.write(output);
      return;
    }

    if (command === "version" || command === "--version" || command === "-v") {
      process.stdout.write(`${packageVersion()}\n`);
      return;
    }

    if (command === "help" || command === "--help" || command === "-h") {
      process.stdout.write(helpText());
      return;
    }

    throw new Error(`Unknown command: ${command}. Run 'subtext --help' to see available commands.`);
  } catch (error) {
    process.stderr.write(`subtext: ${error.message}\n`);
    process.exitCode = 1;
  }
}

function parseArgs(args) {
  const parsed = { _: [] };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      parsed._.push(arg);
      continue;
    }
    const key = arg.slice(2);
    const next = args[i + 1];
    if (next === undefined || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      i += 1;
    }
  }
  return parsed;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

// Read and JSON-parse a user-supplied file, labeling any failure (missing file or
// malformed JSON) with `label` and `path` so the CLI's top-level error handler
// prints something actionable instead of a bare "SyntaxError: Unexpected token...".
async function readJsonFile(path, label) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`${label} ${path}: ${error.message}`);
  }
}

function packageVersion() {
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
  return JSON.parse(readFileSync(pkgPath, "utf8")).version;
}

function helpText() {
  return `Subtext - meaning and emotion from natural speech for coding assistants

Usage:
  subtext <command> [options]

Commands:
  demo              Analyze the bundled sample and print the enriched prompt (works from any directory)
  analyze           Analyze a WAV + transcript into a vocalcontext/v1 contract (--format json|prompt)
  serve             Run the local HTTP analysis server (no audio leaves the machine)
  capture           Record audio from the mic, then optionally analyze it
  session           Record one natural-speech turn and emit the enriched prompt
  dictate           Record a turn, transcribe it, and deliver the enriched prompt (the full loop)
  ptt               Push-to-talk loop: record, analyze, and deliver multiple turns
  handoff           Analyze a turn and deliver the enriched prompt (clipboard/paste/stdout/file)
  calibrate         Build or update a neutral-voice baseline from one or more samples
  profile           Manage saved calibration profiles (list, show, delete)
  model             Manage local whisper models (list, download)
  render            Render a saved vocalcontext/v1 contract into prompt text
  doctor            Check harness adapter readiness (--harness ... --format text|json)
  conformance       Verify natural-speech cues and harness policies (--format json|text)
  install-adapter   Install a harness adapter into a target directory
  mcp               Run the Model Context Protocol (stdio) server
  help              Show this help (also --help, -h)
  version           Show the package version (also --version, -v)

Common flags:
  --audio <file.wav>            Source audio for analysis
  --text "<transcript>"         Inline transcript text
  --transcript <file>           Transcript envelope JSON file
  --transcript-command "<cmd>"  Host transcription command ({audio} placeholder)
  --baseline <file>             Neutral-voice baseline JSON
  --profile <name>              Use a saved calibration profile
  --format json|prompt|text     Output format (command-dependent)
  --verbosity raw|subtle|full   Prompt verbosity (default: subtle)
  --target stdout|clipboard|paste|file   Delivery target for enriched prompts
  --out <file>                  Write output to a file instead of stdout

Examples:
  subtext analyze --audio turn.wav --text "can we just refactor the whole auth module" [--format json|prompt]
  subtext calibrate --audio neutral.wav --text "this is my normal voice" --out baseline.json
  subtext analyze --audio turn.wav --text "..." --baseline baseline.json
  subtext analyze --audio turn.wav --text "..." --transcript-source host-native-voice --word-timings word-timings.json
  subtext analyze --audio turn.wav --transcript native-transcript.json --require-word-timings
  subtext calibrate --baseline baseline.json --audio new-neutral.wav --text "..." --out baseline.json
  subtext calibrate --profile laptop-mic --audio neutral.wav --text "..." [--profiles .subtext/profiles.json]
  subtext analyze --profile laptop-mic --audio turn.wav --text "..."
  subtext profile list [--profiles .subtext/profiles.json]
  subtext model list                       # what is installed, and where
  subtext model download base.en --yes     # fetch the default model (~142 MB, one time)
  subtext capture --duration 4 --audio-out turn.wav
  subtext capture --duration 4 --text "..." --format prompt
  subtext session --duration 4 --transcript-command "host-transcript {audio}" [--target stdout|clipboard|paste|file]
  subtext session --duration 4 --transcript-command "host-transcript --json {audio}" --require-word-timings
  subtext dictate                                   # record 4s, transcribe with local whisper, print
  subtext dictate --target paste                    # ...and paste it into the focused app
  subtext dictate --engine cloud --provider groq    # opt in to cloud STT (needs SUBTEXT_CLOUD_API_KEY)
  subtext dictate --audio turn.wav                  # transcribe and analyze an existing recording
  subtext ptt --turns 3 --duration 4 --transcript-command "host-transcript --json {audio}" --target paste
  subtext handoff --audio turn.wav --text "..." [--target clipboard|paste|stdout|file]
  subtext render --file contract.json [--verbosity raw|subtle|full]
  subtext doctor [--harness cli|http|web-preview|desktop-capture|mcp|codex|claude-code|realtime|vscode|hotkey|native-desktop|universal] [--format text|json]
  subtext conformance [--format json|text]
  subtext install-adapter --harness codex --target ./subtext-codex-adapter [--dry-run|--force]
  subtext serve [--port 8765]
  subtext mcp

The engine helps AI understand what you mean and the emotion of your natural speech, not just plain transcript text. It emits vocalcontext/v1 meaning, affect, and prosody cues without sending audio over the network.
`;
}

function formatBytes(bytes) {
  if (!bytes) return "unknown size";
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

// Dedicated arg handling for `model download`, local to this command rather
// than the shared parseArgs (which every other command depends on). The
// shared parser binds the token after any --flag as that flag's value, so
// "model download --yes tiny.en" would bind args.yes to the string "tiny.en"
// instead of granting consent - --yes would be silently ignored whenever it
// precedes the model id. Here --yes is a boolean flag: it means true on its
// own no matter where it appears relative to the model id, and only reads an
// explicit override when the exact literal "true"/"false" immediately
// follows it - so "--yes false" and "--yes=false" both still refuse. Consent
// is never widened to "any --yes token means yes".
function parseModelDownloadArgs(tokens) {
  let consent = false;
  let id = null;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === "--yes") {
      const next = tokens[i + 1];
      if (next === "true" || next === "false") {
        consent = next === "true";
        i += 1;
      } else {
        consent = true;
      }
      continue;
    }
    if (id === null && !token.startsWith("--")) {
      id = token;
    }
  }
  return { id: id ?? "base.en", consent };
}

function renderAdapterInstall(report) {
  const verb = report.dryRun ? "would install" : "installed";
  return [
    `Subtext adapter ${verb}: ${report.id}`,
    `  target: ${report.target}`,
    `  files: ${report.filesInstalled}`,
    `  status: ${report.status}, ready=${report.ready}`,
    report.generatedFiles.length ? `  generated: ${report.generatedFiles.join(", ")}` : "  generated: none",
    `  manifest: ${report.manifestPath}`,
    `  next: ${report.nextStep}`,
    ""
  ].join("\n");
}

async function analyzeFromArgs(args, commandName) {
  const audioPath = args.audio ?? args.wav;
  const transcript = await transcriptFromArgs(args, "cli_text", audioPath);
  if (!audioPath || !transcript?.text) {
    throw new Error(`${commandName} requires --audio <file.wav> and --text <transcript>, --transcript <file>, or --transcript-command <command>.`);
  }
  const baseline = await baselineFromArgs(args);
  const wordTimings = (await wordTimingsFromArgs(args)) ?? transcript.wordTimings;
  return analyzeFile(audioPath, transcript.text, {
    baseline,
    wordTimings,
    requireWordTimings: Boolean(args["require-word-timings"]),
    transcriptSource: transcript.source,
    transcriptConfidence: args["transcript-confidence"] ?? transcript.confidence,
    language: args.language ?? transcript.language
  });
}

async function analyzeCapturedTurn(report, transcript, args) {
  const baseline = await baselineFromArgs(args);
  const wordTimings = (await wordTimingsFromArgs(args)) ?? transcript.wordTimings;
  return analyzeFile(report.audioPath, transcript.text, {
    baseline,
    wordTimings,
    requireWordTimings: Boolean(args["require-word-timings"]),
    transcriptSource: transcript.source,
    transcriptConfidence: args["transcript-confidence"] ?? transcript.confidence,
    language: args.language ?? transcript.language
  });
}

async function runNaturalSpeechTurn(args, commandName, turn = null) {
  const report = await captureFromArgs(args);
  const transcript = await transcriptFromArgs(args, `${commandName}_text`, report.audioPath, turn);
  if (!transcript) {
    throw new Error(`${commandName} requires --text <transcript>, --transcript <file>, or --transcript-command <command>.`);
  }

  const contract = await analyzeCapturedTurn(report, transcript, args);
  return { report, contract };
}

// Engine precedence for `dictate`: explicit flag, then environment, then the
// shipped offline default. getEngine throws with the available list when the id
// is unknown, so a typo never silently falls back to something that uploads audio.
export function resolveDictateEngine(args, env = process.env) {
  const id = args.engine ?? env.SUBTEXT_STT_ENGINE ?? "whisper";
  getEngine(id);
  return id;
}

// The product loop in one function: get audio (recorded now, or a file the caller
// already has), get words (from --text, or from the selected STT engine), then run
// the same analyze + deliver path every other command uses.
async function dictateFromArgs(args) {
  const engine = resolveDictateEngine(args);

  const report = args.audio
    ? { schema: "subtext/capture/v1", audioPath: args.audio, recorder: "provided" }
    : await captureFromArgs(args);

  // Everything below this point runs AFTER audio is already safely on disk.
  // Fail open: if transcription or analysis blows up here, the recording is
  // never deleted, so the failure must say where it landed and how to recover
  // it, rather than reading like the user's words are gone. A caller-supplied
  // --audio file was already the user's own, so it gets no such rewrite - only
  // audio *this command captured* is called out as recoverable.
  try {
    // An explicit --text short-circuits STT; it is how the tests and the offline
    // demo path stay engine-independent.
    let transcript = await transcriptFromArgs(args, "dictate_text", report.audioPath);

    if (!transcript) {
      const envelope = await transcribe(report.audioPath, {
        adapter: engine,
        command: args["transcript-command"],
        apiKey: args["api-key"],
        provider: args.provider,
        model: args.model
      });
      transcript = normalizeTranscriptEnvelope(envelope, transcriptOverrides(args, `dictate_${engine}`));
    }

    const contract = await analyzeCapturedTurn(report, transcript, args);
    return { report, contract, engine };
  } catch (error) {
    if (args.audio) throw error;
    throw new Error(
      `${error.message} Your recording was saved to ${report.audioPath} and was NOT deleted - ` +
      `retry with: subtext analyze --audio ${report.audioPath} --text "<what you said>"`
    );
  }
}

async function runPttLoop(args) {
  const turns = readPositiveInteger(args.turns ?? 1, "ptt --turns");
  const target = args.target ?? "stdout";
  const collectJson = args.format === "json" && target === "stdout";
  const results = [];

  if (target === "file" && turns > 1 && typeof args.out === "string" && !args.out.includes("{turn}")) {
    throw new Error("ptt --target file with multiple turns requires --out containing {turn}.");
  }

  for (let turn = 1; turn <= turns; turn += 1) {
    await waitForPttTrigger(args, turn);
    const turnArgs = argsForTurn(args, turn);
    const { report, contract } = await runNaturalSpeechTurn(turnArgs, "ptt", turn);

    if (collectJson) {
      results.push({ turn, capture: report, contract });
      continue;
    }

    const output = args.format === "json"
      ? `${JSON.stringify({ turn, capture: report, contract }, null, 2)}\n`
      : renderVocalContext(contract, { verbosity: args.verbosity ?? "subtle" });

    await deliverOutput("ptt", outputForPttTarget(output, target), target, turnArgs, {
      fileHint: " Use --audio-out for the recorded WAV. For multiple file turns, include {turn} in --out.",
      clipboard: `subtext: recorded natural speech turn ${turn} and copied enriched prompt to clipboard\n`,
      paste: `subtext: recorded natural speech turn ${turn}, copied enriched prompt, and pasted into active app\n`
    });
  }

  if (collectJson) {
    process.stdout.write(`${JSON.stringify({ schema: "subtext/ptt-run/v1", turns: results }, null, 2)}\n`);
  }
}

async function captureFromArgs(args) {
  return recordWav({
    out: args["audio-out"] ?? (args.target ? args["audio-out"] : args.out),
    durationSec: args.duration ?? args.seconds,
    maxDurationSec: args["max-duration"],
    sampleRate: args["sample-rate"],
    device: args.device,
    command: args["record-command"]
  });
}

async function transcriptFromArgs(args, textSource, audioPath = null, turn = null) {
  if (typeof args.text === "string") {
    if (!args.text.trim()) {
      throw new Error("--text was provided but is empty; pass the transcript text in quotes.");
    }
    return normalizeTranscriptEnvelope({ text: args.text }, transcriptOverrides(args, textSource));
  }

  if (args.transcript) {
    const raw = (await readFile(args.transcript, "utf8")).trim();
    return parseTranscriptPayload(raw, transcriptOverrides(args, "transcript_file"));
  }

  if (args["transcript-command"]) {
    return transcribeWithCommand({
      command: args["transcript-command"],
      replacements: { audio: audioPath ?? "", turn: turn ?? "" },
      overrides: transcriptOverrides(args, "host_transcript_command")
    });
  }

  return null;
}

function transcriptOverrides(args, fallbackSource) {
  return {
    fallbackSource,
    source: args["transcript-source"],
    confidence: args["transcript-confidence"],
    language: args.language
  };
}

async function deliverOutput(commandName, output, target = null, args = {}, messages = {}) {
  if (!target || target === "stdout") {
    process.stdout.write(output);
    return;
  }

  if (target === "file") {
    if (!args.out) {
      throw new Error(`${commandName} --target file requires --out <prompt path>.${messages.fileHint ?? ""}`);
    }
    await writeOutputFile(args.out, output);
    return;
  }

  if (target === "clipboard") {
    await copyToClipboard(output, args["clipboard-command"]);
    process.stderr.write(messages.clipboard ?? "subtext: copied enriched prompt to clipboard\n");
    return;
  }

  if (target === "paste" || target === "active-app") {
    await pasteIntoActiveApp(output, {
      clipboardCommand: args["clipboard-command"],
      pasteCommand: args["paste-command"]
    });
    process.stderr.write(messages.paste ?? "subtext: copied enriched prompt and pasted into active app\n");
    return;
  }

  throw new Error(`${commandName} --target must be clipboard, paste, stdout, or file.`);
}

async function waitForPttTrigger(args, turn) {
  const trigger = args.trigger ?? (args["no-wait"] ? "none" : "enter");
  if (trigger === "none") return;
  if (trigger !== "enter") throw new Error("ptt --trigger must be enter or none.");

  process.stderr.write(`subtext: press Enter to record turn ${turn}\n`);
  await readLineFromStdin();
}

function readLineFromStdin() {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      process.stdin.off("data", onData);
      process.stdin.off("error", onError);
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onData = () => finish();
    const onError = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    process.stdin.on("data", onData);
    process.stdin.on("error", onError);
    process.stdin.resume();
  });
}

function argsForTurn(args, turn) {
  const next = { ...args };
  for (const key of ["audio-out", "out"]) {
    if (typeof next[key] === "string") {
      next[key] = next[key].replace(/\{turn\}/g, String(turn));
    }
  }
  return next;
}

function outputForPttTarget(output, target) {
  return target === "stdout" && !output.endsWith("\n\n") ? `${output}\n\n` : output;
}

function readPositiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return number;
}

async function buildCalibrationBaseline(args, newBaseline) {
  if (args.profile) {
    const storePath = profileStorePath(args);
    const store = await loadProfileStore(storePath);
    const existingBaseline = args.baseline
      ? await readJsonFile(args.baseline, "baseline JSON")
      : getProfileBaseline(store, args.profile);
    const baseline = existingBaseline ? mergeBaselines(existingBaseline, newBaseline) : newBaseline;
    const nextStore = upsertProfileBaseline(store, {
      name: args.profile,
      baseline,
      device: args.device,
      environment: args.environment
    });
    await saveProfileStore(storePath, nextStore);
    return baseline;
  }

  return args.baseline
    ? mergeBaselines(await readJsonFile(args.baseline, "baseline JSON"), newBaseline)
    : newBaseline;
}

async function baselineFromArgs(args) {
  if (args.baseline && args.profile) {
    throw new Error("Use either --baseline <file> or --profile <name>, not both.");
  }
  if (args.profile) {
    const store = await loadProfileStore(profileStorePath(args));
    const baseline = getProfileBaseline(store, args.profile);
    if (!baseline) throw new Error(`Profile has no usable baseline: ${args.profile}`);
    return baseline;
  }
  return args.baseline ? await readJsonFile(args.baseline, "baseline JSON") : null;
}

async function runProfileCommand(rest) {
  const [action = "list", ...argRest] = rest;
  const args = parseArgs(argRest);
  const storePath = profileStorePath(args);
  const store = await loadProfileStore(storePath);

  if (action === "list") {
    const profiles = listProfiles(store);
    const output = args.format === "json"
      ? `${JSON.stringify({ schema: "subtext/profile-list/v1", storePath, profiles }, null, 2)}\n`
      : renderProfileList(storePath, profiles);
    process.stdout.write(output);
    return;
  }

  if (action === "show") {
    const name = args.name ?? args._[0];
    const profile = getProfile(store, name);
    if (!profile) throw new Error(`Unknown profile: ${name}`);
    process.stdout.write(`${JSON.stringify(profile, null, 2)}\n`);
    return;
  }

  if (action === "delete") {
    const name = args.name ?? args._[0];
    const nextStore = deleteProfile(store, name);
    await saveProfileStore(storePath, nextStore);
    process.stdout.write(`deleted profile: ${name}\n`);
    return;
  }

  throw new Error("profile action must be list, show, or delete.");
}

function renderProfileList(storePath, profiles) {
  const lines = [`Subtext profiles: ${profiles.length} (${storePath})`];
  for (const profile of profiles) {
    const details = [
      `${profile.samples} sample${profile.samples === 1 ? "" : "s"}`,
      profile.device ? `device=${profile.device}` : null,
      profile.environment ? `environment=${profile.environment}` : null
    ].filter(Boolean).join(", ");
    lines.push(`  ${profile.name}: ${details || "no baseline"}`);
  }
  lines.push("");
  return lines.join("\n");
}

function profileStorePath(args) {
  return args.profiles ?? args["profile-store"] ?? defaultProfileStorePath();
}

async function writeOutputFile(filePath, output) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, output);
}

async function readCalibrationItems(args) {
  if (args.manifest) {
    const manifest = await readJsonFile(args.manifest, "calibration manifest JSON");
    if (!Array.isArray(manifest)) {
      throw new Error("Calibration manifest must be an array of { audioPath, text } entries.");
    }
    return manifest.map((item) => ({
      audioPath: item.audioPath ?? item.audio,
      text: item.text
    }));
  }

  const audioPath = args.audio ?? args.wav;
  const text = args.text ?? (args.transcript ? (await readFile(args.transcript, "utf8")).trim() : null);
  if (!audioPath || !text) {
    throw new Error("calibrate requires --audio <file.wav> and --text <neutral transcript>, or --manifest <file>.");
  }
  return [{ audioPath, text }];
}

async function wordTimingsFromArgs(args) {
  const value = args["word-timings"] ?? args["word-timestamps"];
  if (!value) return null;
  const text = String(value).trim();
  if (text.startsWith("[") || text.startsWith("{")) {
    return JSON.parse(text);
  }
  return readJsonFile(value, "word timings JSON");
}
