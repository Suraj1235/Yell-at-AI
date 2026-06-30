import { clamp, round } from "../dsp/stats.js";

const MATCH_LOOKAHEAD = 6;

export function alignWordsFromTimings(words, wordTimings, summary, options = {}) {
  const timings = normalizeWordTimings(wordTimings);
  if (!timings.length) return null;

  const aligned = [];
  let timingIndex = 0;

  for (const word of words) {
    const matchIndex = findNextTimingIndex(timings, word.normalized, timingIndex);
    if (matchIndex < 0) {
      return failedAlignment(words, options, aligned.length);
    }

    const timing = timings[matchIndex];
    timingIndex = matchIndex + 1;
    const startSec = clamp(timing.startSec, 0, summary.durationSec);
    const endSec = clamp(Math.max(timing.endSec, startSec + 0.001), startSec + 0.001, summary.durationSec);
    aligned.push({
      ...word,
      startSec,
      endSec,
      durationSec: Math.max(0.001, endSec - startSec),
      phoneTimings: clampPhoneTimings(timing.phoneTimings ?? [], startSec, endSec)
    });
  }

  return {
    words: aligned,
    report: {
      source: "platform_word_timestamps",
      confidence: 1,
      matched_words: words.length,
      total_words: words.length
    }
  };
}

function clampPhoneTimings(phoneTimings, wordStartSec, wordEndSec) {
  return phoneTimings
    .map((phone) => {
      const startSec = clamp(phone.startSec, wordStartSec, wordEndSec);
      const endSec = clamp(phone.endSec, wordStartSec, wordEndSec);
      if (endSec <= startSec) return null;
      return {
        ...phone,
        startSec,
        endSec,
        durationSec: Math.max(0.001, endSec - startSec)
      };
    })
    .filter(Boolean);
}

export function normalizeWordTimings(wordTimings) {
  const rawItems = Array.isArray(wordTimings)
    ? wordTimings
    : Array.isArray(wordTimings?.words)
      ? wordTimings.words
      : Array.isArray(wordTimings?.segments)
        ? wordTimings.segments
        : Array.isArray(wordTimings?.tokens)
          ? wordTimings.tokens
          : [];

  return rawItems
    .map((item) => normalizeTiming(item))
    .filter(Boolean)
    .sort((a, b) => a.startSec - b.startSec);
}

function normalizeTiming(item) {
  if (!item || typeof item !== "object") return null;
  const word = item.word ?? item.text ?? item.token ?? item.label ?? item.value ?? item.punctuated_word;
  const normalized = normalizeWord(word);
  if (!normalized) return null;

  const startSec = readTime(item, "start");
  const endSec = readTime(item, "end");
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) return null;
  const phoneTimings = normalizePhoneTimings(item);

  return {
    word: String(word),
    normalized,
    startSec,
    endSec,
    ...(phoneTimings.length ? { phoneTimings } : {})
  };
}

function normalizePhoneTimings(item) {
  const rawPhones = firstArray(
    item.phoneTimings,
    item.phone_timings,
    item.phoneTimestamps,
    item.phone_timestamps,
    item.phones,
    item.phonemes,
    item.segments
  );
  if (!rawPhones) return [];

  return rawPhones
    .map((phone) => normalizePhoneTiming(phone))
    .filter(Boolean)
    .sort((a, b) => a.startSec - b.startSec);
}

function normalizePhoneTiming(item) {
  if (!item || typeof item !== "object") return null;
  const label = item.phone ?? item.phoneme ?? item.symbol ?? item.label ?? item.text ?? item.token;
  const startSec = readTime(item, "start");
  const endSec = readTime(item, "end");
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) return null;
  return {
    ...(label !== undefined ? { label: String(label) } : {}),
    startSec,
    endSec
  };
}

function readTime(item, key) {
  for (const name of [
    `${key}Sec`,
    `${key}_sec`,
    `${key}Seconds`,
    `${key}_seconds`,
    `${key}Time`,
    `${key}_time`,
    key
  ]) {
    const value = parseTimeValue(item[name]);
    if (Number.isFinite(value)) return value;
  }

  for (const name of [`${key}Ms`, `${key}_ms`, `${key}Millis`, `${key}_millis`, `${key}Milliseconds`, `${key}_milliseconds`]) {
    const value = parseMillisecondsValue(item[name]);
    if (Number.isFinite(value)) return value / 1000;
  }

  return NaN;
}

function parseTimeValue(value) {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return NaN;
  const trimmed = value.trim();
  const match = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*(ms|s)?$/i);
  if (!match) return Number(trimmed);
  const number = Number(match[1]);
  if (!Number.isFinite(number)) return NaN;
  return match[2]?.toLowerCase() === "ms" ? number / 1000 : number;
}

function parseMillisecondsValue(value) {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return NaN;
  const trimmed = value.trim();
  const match = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*(ms|s)?$/i);
  if (!match) return Number(trimmed);
  const number = Number(match[1]);
  if (!Number.isFinite(number)) return NaN;
  return match[2]?.toLowerCase() === "s" ? number * 1000 : number;
}

function firstArray(...values) {
  return values.find((value) => Array.isArray(value));
}

function findNextTimingIndex(timings, normalizedWord, fromIndex) {
  const endIndex = Math.min(timings.length, fromIndex + MATCH_LOOKAHEAD);
  for (let index = fromIndex; index < endIndex; index += 1) {
    if (timings[index].normalized === normalizedWord) return index;
  }
  return -1;
}

function failedAlignment(words, options, matchedCount) {
  if (options.requireWordTimings) {
    throw new Error("Provided word timings could not be matched to the transcript in order.");
  }

  return {
    words: null,
    report: {
      source: "proportional",
      confidence: round(matchedCount / Math.max(1, words.length), 2),
      matched_words: matchedCount,
      total_words: words.length
    }
  };
}

function normalizeWord(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
}
