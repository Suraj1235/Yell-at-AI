import assert from "node:assert/strict";
import { test } from "node:test";
import {
  transcribeWithCloud,
  resolveCloudCredentials,
  parseCloudResponse,
  CLOUD_PROVIDERS
} from "../src/transcribe/cloud.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "..", "eval", "fixtures", "emphasis.wav");

test("both providers are registered", () => {
  assert.deepEqual([...CLOUD_PROVIDERS], ["groq", "deepgram"]);
});

test("a missing key produces an actionable error naming the env vars", () => {
  assert.throws(
    () => resolveCloudCredentials({ provider: "groq", apiKey: null, env: {} }),
    /SUBTEXT_CLOUD_API_KEY[\s\S]*GROQ_API_KEY/
  );
});

test("a provider-specific env var is picked up", () => {
  const resolved = resolveCloudCredentials({
    provider: "deepgram",
    apiKey: null,
    env: { DEEPGRAM_API_KEY: "dg-secret" }
  });
  assert.equal(resolved.apiKey, "dg-secret");
  assert.equal(resolved.provider, "deepgram");
});

test("an unknown provider is rejected", () => {
  assert.throws(
    () => resolveCloudCredentials({ provider: "notaprovider", apiKey: "k", env: {} }),
    /Unknown cloud STT provider: notaprovider/
  );
});

test("parses a Groq verbose_json response into an envelope with word timings", () => {
  const envelope = parseCloudResponse("groq", {
    text: " ship the whole thing ",
    language: "english",
    words: [
      { word: "ship", start: 0.0, end: 0.30 },
      { word: "the", start: 0.30, end: 0.42 },
      { word: "whole", start: 0.42, end: 0.95 },
      { word: "thing", start: 0.95, end: 1.30 }
    ]
  });

  assert.equal(envelope.text, "ship the whole thing");
  assert.equal(envelope.source, "cloud_groq");
  assert.equal(envelope.wordTimings.length, 4);
  assert.deepEqual(envelope.wordTimings[2], { word: "whole", start: 0.42, end: 0.95 });
});

test("parses a Deepgram response into the same envelope shape", () => {
  const envelope = parseCloudResponse("deepgram", {
    results: {
      channels: [{
        alternatives: [{
          transcript: "ship the whole thing",
          confidence: 0.98,
          words: [
            { word: "ship", start: 0.0, end: 0.30, confidence: 0.99 },
            { word: "whole", start: 0.42, end: 0.95, confidence: 0.97 }
          ]
        }]
      }]
    }
  });

  assert.equal(envelope.text, "ship the whole thing");
  assert.equal(envelope.source, "cloud_deepgram");
  assert.equal(envelope.confidence, 0.98);
  assert.equal(envelope.wordTimings[1].word, "whole");
});

test("an empty transcript from the provider is an error, not a silent empty turn", () => {
  assert.throws(() => parseCloudResponse("groq", { text: "   " }), /returned an empty transcript/);
});

test("transcribeWithCloud sends the audio and never logs the key", async () => {
  let seen = null;
  const envelope = await transcribeWithCloud({
    audio: FIXTURE,
    provider: "groq",
    apiKey: "gsk-secret",
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return { ok: true, status: 200, json: async () => ({ text: "ship the whole thing", words: [] }) };
    }
  });

  assert.equal(envelope.text, "ship the whole thing");
  assert.match(seen.url, /api\.groq\.com/);
  assert.equal(seen.init.headers.Authorization, "Bearer gsk-secret");
  assert.ok(seen.init.body, "the audio must actually be sent");
});

test("an HTTP error surfaces the status without leaking the key", async () => {
  const error = await transcribeWithCloud({
    audio: FIXTURE,
    provider: "groq",
    apiKey: "gsk-secret",
    fetchImpl: async () => ({ ok: false, status: 401, text: async () => "invalid_api_key" })
  }).catch((caught) => caught);

  assert.match(error.message, /401/);
  assert.ok(!error.message.includes("gsk-secret"), "the API key must never appear in an error");
});
