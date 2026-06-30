import assert from "node:assert/strict";
import { test } from "node:test";
import { transcribe, transcribeWithCommand, transcribeWithWhisper, ADAPTERS } from "../src/transcribe/index.js";
import {
  resolveWhisperBinary,
  resolveWhisperModel,
  buildWhisperArgs,
  parseWhisperOutput,
  WHISPER_NOT_FOUND_MESSAGE,
  WHISPER_SOURCE
} from "../src/transcribe/whisper.js";

const NONEXISTENT_BIN = "/no/such/whisper/binary-zzzqx";
// A path guaranteed to exist on every platform, used to satisfy the file-exists
// checks in resolveWhisperBinary/resolveWhisperModel without spawning anything
// (the runner is always faked, so this binary is never actually executed).
const REAL_FILE = process.execPath;

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

test("whisper adapter parses canned plain-text stdout into the envelope", async () => {
  const transcript = await transcribeWithWhisper({
    audio: "turn.wav",
    env: { SUBTEXT_WHISPER_BIN: REAL_FILE, PATH: "" },
    runner: async () =>
      "[00:00:00.000 --> 00:00:02.700]  can we just refactor the whole auth module\n",
    json: false
  });

  assert.equal(transcript.text, "can we just refactor the whole auth module");
  assert.equal(transcript.source, WHISPER_SOURCE);
  assert.equal(transcript.source, "whisper.cpp");
  assert.equal(transcript.words, undefined);
});

test("whisper adapter parses whisper.cpp JSON (segments + token offsets) with word timings", async () => {
  // Shape produced by `whisper-cli --output-json-full`: a `transcription` array of
  // segments, each carrying `tokens` whose `offsets` are in milliseconds.
  const cannedJson = JSON.stringify({
    result: { language: "en" },
    transcription: [
      {
        text: " can we",
        offsets: { from: 0, to: 450 },
        tokens: [
          { text: "[_BEG_]", offsets: { from: 0, to: 0 } },
          { text: " can", offsets: { from: 0, to: 220 } },
          { text: " we", offsets: { from: 250, to: 450 } }
        ]
      },
      {
        text: " whole",
        offsets: { from: 1490, to: 1990 },
        tokens: [
          { text: " whole", offsets: { from: 1490, to: 1990 } }
        ]
      }
    ]
  });

  const transcript = await transcribeWithWhisper({
    audio: "turn.wav",
    env: { SUBTEXT_WHISPER_BIN: REAL_FILE, PATH: "" },
    runner: async () => cannedJson
  });

  assert.equal(transcript.text, "can we whole");
  assert.equal(transcript.source, "whisper.cpp");
  assert.equal(transcript.language, "en");
  // The bracketed special token [_BEG_] is dropped; three real words remain.
  assert.equal(transcript.words.length, 3);
  assert.deepEqual(transcript.words[0], { word: "can", start: 0, end: 0.22 });
  assert.deepEqual(transcript.words[1], { word: "we", start: 0.25, end: 0.45 });
  assert.deepEqual(transcript.words[2], { word: "whole", start: 1.49, end: 1.99 });
});

test("whisper adapter accepts a simple JSON envelope with explicit words/confidence", async () => {
  const transcript = await transcribeWithWhisper({
    audio: "turn.wav",
    env: { SUBTEXT_WHISPER_BIN: REAL_FILE, PATH: "" },
    runner: async () => JSON.stringify({
      text: "ship the whole thing",
      language: "en",
      confidence: 0.91,
      words: [
        { word: "ship", start: 0, end: 0.2 },
        { word: "the", start: 0.22, end: 0.34 },
        { word: "whole", start: 0.36, end: 0.7 },
        { word: "thing", start: 0.72, end: 1.0 }
      ]
    })
  });

  assert.equal(transcript.text, "ship the whole thing");
  assert.equal(transcript.source, "whisper.cpp");
  assert.equal(transcript.language, "en");
  assert.equal(transcript.confidence, 0.91);
  assert.equal(transcript.words.length, 4);
  assert.deepEqual(transcript.words[3], { word: "thing", start: 0.72, end: 1 });
});

test("whisper adapter injects -m <model> and the audio path into the runner args", async () => {
  let observedBinary;
  let observedArgs;
  const transcript = await transcribeWithWhisper({
    audio: "turn.wav",
    env: { SUBTEXT_WHISPER_BIN: REAL_FILE, SUBTEXT_WHISPER_MODEL: REAL_FILE, PATH: "" },
    runner: async (binary, args) => {
      observedBinary = binary;
      observedArgs = args;
      return "hello there";
    }
  });

  assert.equal(transcript.text, "hello there");
  assert.equal(observedBinary, REAL_FILE);
  // Model flag is injected before the audio path; audio is always last.
  const modelIndex = observedArgs.indexOf("-m");
  assert.ok(modelIndex >= 0, "expected -m to be present");
  assert.equal(observedArgs[modelIndex + 1], REAL_FILE);
  assert.equal(observedArgs[observedArgs.length - 1], "turn.wav");
});

test("whisper adapter throws an actionable error when SUBTEXT_WHISPER_MODEL is missing", async () => {
  await assert.rejects(
    () => transcribeWithWhisper({
      audio: "turn.wav",
      env: { SUBTEXT_WHISPER_BIN: REAL_FILE, SUBTEXT_WHISPER_MODEL: "/no/such/model-zzzqx.bin", PATH: "" },
      runner: async () => "should not run"
    }),
    (error) => {
      assert.match(error.message, /whisper model not found/);
      assert.match(error.message, /see docs\/WHISPER\.md/);
      return true;
    }
  );
});

test("resolveWhisperModel returns null when SUBTEXT_WHISPER_MODEL is unset", () => {
  assert.equal(resolveWhisperModel({ PATH: "" }), null);
  assert.equal(resolveWhisperModel({ SUBTEXT_WHISPER_MODEL: REAL_FILE, PATH: "" }), REAL_FILE);
});

test("buildWhisperArgs places the audio path last and requests JSON by default", () => {
  const args = buildWhisperArgs({ audio: "turn.wav" });
  assert.equal(args[args.length - 1], "turn.wav");
  assert.ok(args.includes("--output-json"));

  const plain = buildWhisperArgs({ audio: "turn.wav", json: false });
  assert.ok(!plain.includes("--output-json"));
  assert.equal(plain[plain.length - 1], "turn.wav");
});

test("parseWhisperOutput throws on an empty transcript", () => {
  assert.throws(() => parseWhisperOutput("\n\n"), /empty transcript/);
});
