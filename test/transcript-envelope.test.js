import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeWordTimings } from "../src/alignment/word-timings.js";
import { normalizeTranscriptEnvelope, parseTranscriptPayload, TRANSCRIPT_SCHEMA } from "../src/transcript/envelope.js";

const text = "can we just refactor the whole auth module";

test("normalizes the canonical native transcript envelope", () => {
  const transcript = normalizeTranscriptEnvelope({
    schema: TRANSCRIPT_SCHEMA,
    text,
    source: "platform-native-voice",
    confidence: 0.97,
    language: "en",
    wordTimings: [{ word: "can", start: 0, end: 0.22 }]
  });

  assert.equal(transcript.schema, TRANSCRIPT_SCHEMA);
  assert.equal(transcript.text, text);
  assert.equal(transcript.source, "platform-native-voice");
  assert.equal(transcript.confidence, 0.97);
  assert.equal(transcript.language, "en");
  assert.equal(transcript.wordTimings.length, 1);
});

test("normalizes nested provider transcript shapes and source overrides", () => {
  const transcript = normalizeTranscriptEnvelope({
    transcript: {
      transcript: text,
      provider: "browser-dictation",
      locale: "en-US",
      words: [{ text: "can", startMs: 0, endMs: 220 }]
    }
  }, {
    source: "codex-voice",
    confidence: 0.88
  });

  assert.equal(transcript.source, "codex-voice");
  assert.equal(transcript.confidence, 0.88);
  assert.equal(transcript.language, "en-US");
  assert.equal(transcript.wordTimings[0].text, "can");
});

test("parses plain text and structured transcript command output", () => {
  const plain = parseTranscriptPayload(text, { fallbackSource: "host_transcript_command" });
  assert.equal(plain.text, text);
  assert.equal(plain.source, "host_transcript_command");

  const structured = parseTranscriptPayload(JSON.stringify({
    schema: TRANSCRIPT_SCHEMA,
    text,
    source: "os-dictation",
    word_timings: [{ word: "can", start: 0, end: 0.22 }]
  }), { fallbackSource: "host_transcript_command" });
  assert.equal(structured.source, "os-dictation");
  assert.equal(structured.wordTimings.length, 1);
});

test("word timing normalizer accepts common provider aliases", () => {
  const timings = normalizeWordTimings({
    tokens: [
      { punctuated_word: "can", startMs: "0ms", endMs: "220ms" },
      {
        value: "we",
        startTime: "0.25s",
        endTime: "0.45s",
        phonemes: [
          { phoneme: "w", startTime: "0.25s", endTime: "0.31s" },
          { phoneme: "iy", startTime: "0.34s", endTime: "0.45s" }
        ]
      },
      { label: "just", start_sec: 0.48, end_sec: 0.76 }
    ]
  });

  assert.deepEqual(timings.map((item) => item.normalized), ["can", "we", "just"]);
  assert.equal(timings[0].startSec, 0);
  assert.equal(timings[0].endSec, 0.22);
  assert.equal(timings[1].startSec, 0.25);
  assert.equal(timings[1].endSec, 0.45);
  assert.equal(timings[1].phoneTimings.length, 2);
  assert.equal(timings[1].phoneTimings[0].label, "w");
});
