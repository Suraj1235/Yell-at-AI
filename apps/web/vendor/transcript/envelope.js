export const TRANSCRIPT_SCHEMA = "subtext/transcript/v1";

export function parseTranscriptPayload(raw, options = {}) {
  const text = String(raw ?? "").trim();
  if (!text) throw new Error("Transcript source returned an empty transcript.");

  if (!looksStructuredTranscript(text)) {
    return normalizeTranscriptEnvelope({ text }, options);
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    throw new Error(`Transcript JSON could not be parsed: ${error.message}`);
  }
  return normalizeTranscriptEnvelope(payload, options);
}

export function normalizeTranscriptEnvelope(payload, options = {}) {
  const input = typeof payload === "string" ? { text: payload } : payload;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Structured transcript JSON must be an object with a text field.");
  }

  const transcript = input.transcript && typeof input.transcript === "object" && !Array.isArray(input.transcript)
    ? input.transcript
    : input;
  const text = stringField(transcript.text)
    ?? stringField(transcript.transcript)
    ?? stringField(input.text)
    ?? stringField(input.transcript);
  if (!text) throw new Error("Structured transcript JSON must include text.");

  const source = stringField(options.source)
    ?? stringField(input.transcriptSource)
    ?? stringField(input.transcript_source)
    ?? stringField(transcript.source)
    ?? stringField(input.source)
    ?? stringField(transcript.provider)
    ?? stringField(input.provider)
    ?? stringField(transcript.service)
    ?? stringField(input.service)
    ?? stringField(transcript.model)
    ?? stringField(input.model)
    ?? stringField(options.fallbackSource)
    ?? "provided";

  const confidence = firstDefined(
    options.confidence,
    input.transcriptConfidence,
    input.transcript_confidence,
    transcript.confidence,
    input.confidence
  );
  const confidenceNumber = Number(confidence);
  const language = stringField(options.language)
    ?? stringField(input.language)
    ?? stringField(transcript.language)
    ?? stringField(input.locale)
    ?? stringField(transcript.locale);
  const wordTimings = firstDefined(
    options.wordTimings,
    transcript.wordTimings,
    transcript.word_timestamps,
    transcript.wordTimestamps,
    transcript.word_timings,
    transcript.words,
    transcript.segments,
    transcript.tokens,
    input.wordTimings,
    input.word_timestamps,
    input.wordTimestamps,
    input.word_timings,
    input.words,
    input.segments,
    input.tokens
  );

  return {
    schema: TRANSCRIPT_SCHEMA,
    text,
    source,
    ...(Number.isFinite(confidenceNumber) ? { confidence: clamp01(confidenceNumber) } : {}),
    ...(language ? { language } : {}),
    ...(isTimingCollection(wordTimings) ? { wordTimings } : {})
  };
}

export function looksStructuredTranscript(value) {
  return String(value ?? "").trim().startsWith("{");
}

function stringField(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function isTimingCollection(value) {
  return Array.isArray(value)
    || Array.isArray(value?.words)
    || Array.isArray(value?.segments)
    || Array.isArray(value?.tokens);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}
