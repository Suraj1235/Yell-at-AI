// Cloud STT adapter: opt-in, bring-your-own-key transcription via Groq or
// Deepgram. This is the ONLY adapter in the Node tree that sends audio over the
// network, and it is never the default -- see src/transcribe/engines.js, where it
// is declared with egress "vendor".
//
// It exists because cloud recognition is roughly 3x faster than local whisper on
// a laptop CPU and returns real word timings, which beat the proportional
// alignment fallback. Users who want zero egress keep the default `whisper`
// engine and never touch this file.
//
// The fetch implementation is injectable so the adapter is fully testable offline.
// The API key is never included in any thrown error or log line.
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

export const CLOUD_PROVIDERS = Object.freeze(["groq", "deepgram"]);

const DEFAULT_MODELS = Object.freeze({
  groq: "whisper-large-v3-turbo",
  deepgram: "nova-3"
});

const PROVIDER_ENV_KEYS = Object.freeze({
  groq: "GROQ_API_KEY",
  deepgram: "DEEPGRAM_API_KEY"
});

// Resolve provider + key. Precedence: explicit argument, provider-specific env
// var, then the generic SUBTEXT_CLOUD_API_KEY.
export function resolveCloudCredentials({ provider = "groq", apiKey = null, env = process.env } = {}) {
  if (!CLOUD_PROVIDERS.includes(provider)) {
    throw new Error(
      `Unknown cloud STT provider: ${provider}. Available: ${CLOUD_PROVIDERS.join(", ")}.`
    );
  }

  const resolved = apiKey || env[PROVIDER_ENV_KEYS[provider]] || env.SUBTEXT_CLOUD_API_KEY;
  if (!resolved) {
    throw new Error(
      `Cloud STT needs an API key. Set SUBTEXT_CLOUD_API_KEY, or the provider-specific ` +
      `${PROVIDER_ENV_KEYS[provider]}, or pass --api-key. Cloud STT is opt-in and sends your ` +
      `audio to ${provider}; the default 'whisper' engine stays entirely on your machine.`
    );
  }

  return { provider, apiKey: resolved };
}

// Build the provider-specific HTTP request. Groq takes multipart/form-data with
// an OpenAI-compatible shape; Deepgram takes raw audio bytes with query params.
export function buildCloudRequest({ provider, apiKey, model, audioBytes, audioName = "turn.wav" }) {
  if (provider === "groq") {
    const form = new FormData();
    form.append("file", new Blob([audioBytes], { type: "audio/wav" }), audioName);
    form.append("model", model ?? DEFAULT_MODELS.groq);
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
    return {
      url: "https://api.groq.com/openai/v1/audio/transcriptions",
      init: { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form }
    };
  }

  const params = new URLSearchParams({
    model: model ?? DEFAULT_MODELS.deepgram,
    punctuate: "true",
    smart_format: "true"
  });
  return {
    url: `https://api.deepgram.com/v1/listen?${params}`,
    init: {
      method: "POST",
      headers: { Authorization: `Token ${apiKey}`, "Content-Type": "audio/wav" },
      body: audioBytes
    }
  };
}

// Normalize either provider's response into the shared transcript envelope.
export function parseCloudResponse(provider, body) {
  if (provider === "groq") {
    const text = String(body?.text ?? "").trim();
    if (!text) throw new Error("Cloud STT (groq) returned an empty transcript.");
    return {
      schema: "subtext/transcript/v1",
      text,
      source: "cloud_groq",
      language: normalizeLanguage(body?.language),
      wordTimings: normalizeWords(body?.words)
    };
  }

  const alternative = body?.results?.channels?.[0]?.alternatives?.[0];
  const text = String(alternative?.transcript ?? "").trim();
  if (!text) throw new Error("Cloud STT (deepgram) returned an empty transcript.");
  return {
    schema: "subtext/transcript/v1",
    text,
    source: "cloud_deepgram",
    confidence: typeof alternative.confidence === "number" ? alternative.confidence : undefined,
    wordTimings: normalizeWords(alternative?.words)
  };
}

function normalizeWords(words) {
  if (!Array.isArray(words)) return undefined;
  const normalized = words
    .map((entry) => ({
      word: String(entry?.word ?? entry?.punctuated_word ?? "").trim(),
      start: Number(entry?.start),
      end: Number(entry?.end)
    }))
    .filter((entry) => entry.word && Number.isFinite(entry.start) && Number.isFinite(entry.end));
  return normalized.length ? normalized : undefined;
}

function normalizeLanguage(language) {
  if (typeof language !== "string" || !language.trim()) return undefined;
  // Groq reports a language name ("english"); the envelope wants a short tag.
  const named = { english: "en", spanish: "es", french: "fr", german: "de" };
  const key = language.trim().toLowerCase();
  return named[key] ?? key.slice(0, 5);
}

export async function transcribeWithCloud({
  audio,
  provider = "groq",
  apiKey = null,
  model = null,
  env = process.env,
  fetchImpl = fetch,
  timeoutMs = 30000
} = {}) {
  if (!audio) throw new Error("Cloud STT needs an audio file path.");
  const credentials = resolveCloudCredentials({ provider, apiKey, env });
  const audioBytes = await readFile(audio);

  const { url, init } = buildCloudRequest({
    provider: credentials.provider,
    apiKey: credentials.apiKey,
    model,
    audioBytes,
    audioName: basename(audio)
  });

  // Never hang: a stuck cloud call must not strand the user's turn.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Cloud STT (${credentials.provider}) timed out after ${timeoutMs}ms.`);
    }
    throw new Error(`Cloud STT (${credentials.provider}) request failed: ${error.message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    // Read the body for context but never echo the request, which holds the key.
    const detail = await safeText(response);
    throw new Error(
      `Cloud STT (${credentials.provider}) returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`
    );
  }

  return parseCloudResponse(credentials.provider, await response.json());
}

async function safeText(response) {
  try {
    return (await response.text()).slice(0, 300);
  } catch {
    return "";
  }
}
