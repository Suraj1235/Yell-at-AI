#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// A UserPromptSubmit hook must NEVER block the user's prompt: any failure has to
// fail open by emitting usable stdout and exiting 0. We therefore read and parse
// stdin defensively. If stdin is missing or not valid JSON we echo the raw input
// straight back so the host receives its own prompt unchanged. main() only ever
// returns (never calls process.exit) so a write right before exit can't be
// truncated on a non-TTY pipe - the process ends naturally once main() settles.
const DEFAULT_HOOK_TIMEOUT_MS = 15000;

await main();

async function main() {
  let raw = "";
  try {
    raw = await readStdin();
  } catch (error) {
    failOpenRaw(raw, error);
    return;
  }

  let event;
  try {
    event = JSON.parse(raw);
    if (!event || typeof event !== "object") throw new Error("event is not a JSON object");
  } catch (error) {
    failOpenRaw(raw, error);
    return;
  }

  await enrichEvent(event);
}

async function enrichEvent(event) {
  const audioPath = event.audioPath ?? process.env.SUBTEXT_AUDIO_PATH;
  if (!audioPath) {
    // No audio means there is nothing to analyze - pass the event through
    // untouched, and do it before ever building a (possibly temp-dir-backed)
    // transcript input for it.
    process.stdout.write(`${JSON.stringify(event)}\n`);
    return;
  }

  let transcriptInput = null;
  try {
    transcriptInput = await buildTranscriptInput(event);
  } catch (error) {
    failOpenEvent(event, error);
    return;
  }

  if (!transcriptInput) {
    process.stdout.write(`${JSON.stringify(event)}\n`);
    return;
  }

  const cliPath = resolveCliPath();
  try {
    const contract = JSON.parse(await runSubtextCli({
      cliPath,
      args: [
        "analyze",
        "--audio",
        audioPath,
        ...transcriptInput.args,
        "--format",
        "json"
      ]
    }));
    const enriched = await runSubtextCli({
      cliPath,
      args: [
        "render",
        "--verbosity",
        process.env.SUBTEXT_VERBOSITY ?? "full"
      ],
      input: JSON.stringify(contract)
    });

    process.stdout.write(`${JSON.stringify({
      ...event,
      prompt: enriched,
      text: enriched,
      subtext: contract
    })}\n`);
  } catch (error) {
    failOpenEvent(event, error);
  } finally {
    await transcriptInput.cleanup?.();
  }
}

function failOpenEvent(event, error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`subtext: Claude hook failed open: ${message}\n`);
  process.stdout.write(`${JSON.stringify({
    ...event,
    subtext_error: message
  })}\n`);
}

function failOpenRaw(raw, error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`subtext: Claude hook failed open: ${message}\n`);
  // Echo whatever we received so the host's prompt passes through untouched.
  process.stdout.write(typeof raw === "string" && raw.length > 0 ? raw : "{}\n");
}

function resolveCliPath() {
  if (process.env.SUBTEXT_CLI_PATH) return resolve(process.env.SUBTEXT_CLI_PATH);
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../bin/subtext.js");
}

function runSubtextCli({
  cliPath,
  args,
  input = null
}) {
  const timeoutMs = hookTimeoutMs();
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      stdio: ["pipe", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`subtext CLI timed out after ${timeoutMs} ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise(stdout);
      else reject(new Error(stderr || `subtext exited with code ${code}`));
    });

    if (input == null) {
      child.stdin.end();
    } else {
      child.stdin.end(input);
    }
  });
}

// Mirrors the timeout/kill pattern in adapters/vscode/runner.cjs's spawnSubtext,
// adapted to this hook's env-var configuration surface (SUBTEXT_AUDIO_PATH,
// SUBTEXT_CLI_PATH, SUBTEXT_VERBOSITY already exist there). A hung child must
// never block the user's prompt, so we bound the wait and fail open on timeout.
function hookTimeoutMs() {
  const parsed = Number(process.env.SUBTEXT_HOOK_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_HOOK_TIMEOUT_MS;
}

async function buildTranscriptInput(event) {
  if (event.transcriptPath || event.transcriptFile) {
    return { args: ["--transcript", resolve(String(event.transcriptPath ?? event.transcriptFile))] };
  }

  const text = transcriptText(event.transcript)
    ?? stringField(event.prompt)
    ?? stringField(event.text);
  if (!text) return null;

  if (hasStructuredTranscript(event)) {
    const transcript = structuredTranscriptForEvent(event, text);
    const dir = await mkdtemp(join(tmpdir(), "subtext-claude-"));
    const file = join(dir, "transcript.json");
    await writeFile(file, `${JSON.stringify(transcript)}\n`);
    return {
      args: ["--transcript", file],
      cleanup: () => rm(dir, { recursive: true, force: true })
    };
  }

  return { args: ["--text", text] };
}

function hasStructuredTranscript(event) {
  return Boolean(event.transcript && typeof event.transcript === "object"
    || event.wordTimings
    || event.word_timestamps
    || event.wordTimestamps
    || event.word_timings
    || event.transcriptSource
    || event.transcript_source
    || event.transcriptConfidence
    || event.transcript_confidence
    || event.language);
}

function structuredTranscriptForEvent(event, fallbackText) {
  if (event.transcript && typeof event.transcript === "object") {
    return {
      schema: "subtext/transcript/v1",
      ...event.transcript,
      text: transcriptText(event.transcript) ?? fallbackText
    };
  }

  return {
    schema: "subtext/transcript/v1",
    text: fallbackText,
    source: stringField(event.transcriptSource)
      ?? stringField(event.transcript_source)
      ?? "claude-code",
    ...(event.transcriptConfidence !== undefined ? { confidence: event.transcriptConfidence } : {}),
    ...(event.transcript_confidence !== undefined ? { confidence: event.transcript_confidence } : {}),
    ...(stringField(event.language) ? { language: stringField(event.language) } : {}),
    ...(event.wordTimings ? { wordTimings: event.wordTimings } : {}),
    ...(event.word_timestamps ? { word_timestamps: event.word_timestamps } : {}),
    ...(event.wordTimestamps ? { wordTimestamps: event.wordTimestamps } : {}),
    ...(event.word_timings ? { word_timings: event.word_timings } : {})
  };
}

function transcriptText(value) {
  if (typeof value === "string") return stringField(value);
  if (!value || typeof value !== "object") return null;
  return stringField(value.text) ?? stringField(value.transcript);
}

function stringField(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}
