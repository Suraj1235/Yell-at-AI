import assert from "node:assert/strict";
import { test } from "node:test";
import {
  transcribeWithCloud,
  resolveCloudCredentials,
  parseCloudResponse,
  buildCloudRequest,
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

/* ───────────────────── Deepgram request path ─────────────────────
   buildCloudRequest's Deepgram branch shipped with zero executed coverage:
   every end-to-end test above uses Groq, while README and CHANGELOG advertise
   --provider deepgram as shipped. The two providers diverge in four places and
   none of them was pinned by a test: the endpoint and its query string, the
   `Token` auth scheme (Groq uses `Bearer`), an explicit audio/wav Content-Type,
   and a raw-bytes body where Groq sends FormData. All offline: fetchImpl is
   injected, the key is a fixture, and nothing opens a socket.
*/

test("buildCloudRequest targets Deepgram's listen endpoint with the documented query params", () => {
  const { url, init } = buildCloudRequest({
    provider: "deepgram",
    apiKey: "dg-secret",
    model: null,
    audioBytes: Buffer.from([1, 2, 3])
  });

  const parsed = new URL(url);
  assert.equal(parsed.origin, "https://api.deepgram.com");
  assert.equal(parsed.pathname, "/v1/listen");
  assert.equal(parsed.searchParams.get("model"), "nova-3", "the default Deepgram model");
  assert.equal(parsed.searchParams.get("punctuate"), "true");
  assert.equal(parsed.searchParams.get("smart_format"), "true");
  assert.equal(init.method, "POST");
});

test("buildCloudRequest honours an explicit Deepgram model", () => {
  const { url } = buildCloudRequest({
    provider: "deepgram",
    apiKey: "dg-secret",
    model: "nova-2-meeting",
    audioBytes: Buffer.from([1])
  });
  assert.equal(new URL(url).searchParams.get("model"), "nova-2-meeting");
});

test("Deepgram authenticates with Token, not Bearer (Groq's scheme)", () => {
  const deepgram = buildCloudRequest({
    provider: "deepgram",
    apiKey: "dg-secret",
    audioBytes: Buffer.from([1])
  });
  const groq = buildCloudRequest({
    provider: "groq",
    apiKey: "gsk-secret",
    audioBytes: Buffer.from([1])
  });

  assert.equal(deepgram.init.headers.Authorization, "Token dg-secret");
  assert.equal(groq.init.headers.Authorization, "Bearer gsk-secret");
  assert.ok(
    !deepgram.init.headers.Authorization.startsWith("Bearer"),
    "a one-word divergence no other test would catch"
  );
});

test("Deepgram sends the raw audio bytes with an audio/wav Content-Type", () => {
  const audioBytes = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x01, 0x02]);
  const { init } = buildCloudRequest({ provider: "deepgram", apiKey: "dg-secret", audioBytes });

  assert.equal(init.headers["Content-Type"], "audio/wav");
  assert.equal(init.body, audioBytes, "the body is the audio itself, not a multipart form");
  assert.ok(!(init.body instanceof FormData), "FormData is the Groq shape, not Deepgram's");

  // Groq, by contrast, must not set Content-Type by hand: FormData needs the
  // runtime to add its own multipart boundary.
  const groq = buildCloudRequest({ provider: "groq", apiKey: "gsk-secret", audioBytes });
  assert.ok(groq.init.body instanceof FormData);
  assert.equal(groq.init.headers["Content-Type"], undefined);
});

test("transcribeWithCloud drives the Deepgram path end to end, offline", async () => {
  let seen = null;
  const envelope = await transcribeWithCloud({
    audio: FIXTURE,
    provider: "deepgram",
    apiKey: "dg-secret",
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: {
            channels: [{
              alternatives: [{
                transcript: "ship the whole thing",
                confidence: 0.97,
                words: [{ word: "whole", start: 0.42, end: 0.95 }]
              }]
            }]
          }
        })
      };
    }
  });

  assert.equal(envelope.source, "cloud_deepgram");
  assert.equal(envelope.text, "ship the whole thing");
  assert.equal(envelope.confidence, 0.97);

  assert.match(seen.url, /^https:\/\/api\.deepgram\.com\/v1\/listen\?/);
  assert.equal(seen.init.headers.Authorization, "Token dg-secret");
  assert.equal(seen.init.headers["Content-Type"], "audio/wav");
  assert.ok(seen.init.body?.length > 0, "the audio bytes must actually be sent");
  assert.ok(seen.init.signal, "the request must carry the abort signal so it cannot hang");
});

test("a Deepgram HTTP failure surfaces the status without leaking the key", async () => {
  const error = await transcribeWithCloud({
    audio: FIXTURE,
    provider: "deepgram",
    apiKey: "dg-secret",
    fetchImpl: async () => ({ ok: false, status: 403, text: async () => "INSUFFICIENT_PERMISSIONS" })
  }).catch((caught) => caught);

  assert.match(error.message, /deepgram/);
  assert.match(error.message, /403/);
  assert.ok(!error.message.includes("dg-secret"), "the API key must never appear in an error");
});

test("a Deepgram transport failure surfaces the cause without leaking the key", async () => {
  const error = await transcribeWithCloud({
    audio: FIXTURE,
    provider: "deepgram",
    apiKey: "dg-secret",
    fetchImpl: async () => { throw new Error("getaddrinfo ENOTFOUND api.deepgram.com"); }
  }).catch((caught) => caught);

  assert.match(error.message, /request failed/);
  assert.ok(!error.message.includes("dg-secret"), "the API key must never appear in an error");
});
