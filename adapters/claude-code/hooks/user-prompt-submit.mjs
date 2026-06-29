#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const event = JSON.parse(await readStdin());
const audioPath = event.audioPath ?? process.env.SUBTEXT_AUDIO_PATH;
const transcriptInput = await buildTranscriptInput(event);

if (!audioPath || !transcriptInput) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
  process.exit(0);
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
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`subtext: Claude hook failed open: ${message}\n`);
  process.stdout.write(`${JSON.stringify({
    ...event,
    subtext_error: message
  })}\n`);
} finally {
  await transcriptInput.cleanup?.();
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
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      stdio: ["pipe", "pipe", "pipe"]
    });

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
