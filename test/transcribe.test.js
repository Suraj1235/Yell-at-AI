import assert from "node:assert/strict";
import { test } from "node:test";
import { transcribe, transcribeWithCommand, transcribeWithWhisper, ADAPTERS } from "../src/transcribe/index.js";
import { resolveWhisperBinary, WHISPER_NOT_FOUND_MESSAGE } from "../src/transcribe/whisper.js";

const NONEXISTENT_BIN = "/no/such/whisper/binary-zzzqx";

test("command adapter parses an injected mock runner into an envelope", async () => {
  const transcript = await transcribeWithCommand({
    command: "host-transcript {audio}",
    replacements: { audio: "turn.wav" },
    overrides: { fallbackSource: "host_transcript_command" },
    runner: async (parts) => {
      // The {audio} placeholder must have been substituted before the runner sees it.
      assert.deepEqual(parts, ["host-transcript", "turn.wav"]);
      return "  hello there  ";
    }
  });

  assert.equal(transcript.text, "hello there");
  assert.equal(transcript.source, "host_transcript_command");
});

test("command adapter accepts a structured transcript envelope from the runner", async () => {
  const transcript = await transcribeWithCommand({
    command: "host-transcript --json {audio}",
    replacements: { audio: "turn.wav" },
    overrides: { fallbackSource: "host_transcript_command" },
    runner: async () => JSON.stringify({
      text: "ship the whole thing",
      source: "os-dictation",
      word_timings: [{ word: "ship", start: 0, end: 0.2 }]
    })
  });

  assert.equal(transcript.text, "ship the whole thing");
  assert.equal(transcript.source, "os-dictation");
  assert.equal(transcript.wordTimings.length, 1);
});

test("command adapter throws on an empty command template", async () => {
  await assert.rejects(
    () => transcribeWithCommand({ command: "", runner: async () => "x" }),
    /--transcript-command was empty\./
  );
});

test("transcribe() dispatches to the command adapter by default via a portable command", async () => {
  const transcript = await transcribe("turn.wav", {
    overrides: { fallbackSource: "host_transcript_command" },
    runner: async () => "hello there"
  });

  assert.ok(transcript.text, "expected a non-empty text field");
  assert.ok(transcript.source, "expected a source field");
  assert.equal(transcript.text, "hello there");
});

test("command adapter runs a real portable node command end to end (offline)", async () => {
  // Uses the literal `node` token (resolved via PATH — present when running
  // `node --test`) to avoid space-in-path issues with process.execPath.
  const transcript = await transcribeWithCommand({
    command: `node -e "process.stdout.write('hello there')"`,
    overrides: { fallbackSource: "host_transcript_command" }
  });

  assert.equal(transcript.text, "hello there");
  assert.ok(transcript.source);
});

test("ADAPTERS includes command, whisper, and the browser-only webspeech contract", () => {
  assert.ok(ADAPTERS.includes("command"));
  assert.ok(ADAPTERS.includes("whisper"));
  assert.ok(ADAPTERS.includes("webspeech"));
});

test("whisper adapter throws an actionable error when SUBTEXT_WHISPER_BIN is missing", async () => {
  await assert.rejects(
    () => transcribeWithWhisper({
      audio: "turn.wav",
      env: { SUBTEXT_WHISPER_BIN: NONEXISTENT_BIN, PATH: "" },
      runner: async () => "should not run"
    }),
    (error) => {
      assert.equal(error.message, WHISPER_NOT_FOUND_MESSAGE);
      assert.match(error.message, /set SUBTEXT_WHISPER_BIN or install whisper\.cpp - see docs\/WHISPER\.md/);
      return true;
    }
  );
});

test("whisper adapter throws actionable error when no binary is on an empty PATH", () => {
  assert.throws(
    () => resolveWhisperBinary({ PATH: "" }),
    (error) => {
      assert.equal(error.message, WHISPER_NOT_FOUND_MESSAGE);
      return true;
    }
  );
});

test("transcribe() with the whisper adapter surfaces the actionable not-found error", async () => {
  await assert.rejects(
    () => transcribe("turn.wav", {
      adapter: "whisper",
      env: { SUBTEXT_WHISPER_BIN: NONEXISTENT_BIN, PATH: "" }
    }),
    new RegExp(WHISPER_NOT_FOUND_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  );
});
