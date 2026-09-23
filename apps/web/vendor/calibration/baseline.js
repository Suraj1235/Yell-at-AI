import { extractProsody } from "../dsp/features.js";
import { mean, round, stdev } from "../dsp/stats.js";
import { tokenizeWords } from "../text/tokenize.js";

const BASELINE_SCHEMA = "subtext/baseline/v1";
const MIN_SPREAD = 0.001;

export async function buildBaselineFromFiles(items, options = {}) {
  const { readWavFile } = await import("../audio/wav.js"); // lazy: keeps this module browser-safe (isBaseline is on the browser path)
  const entries = [];
  for (const item of items) {
    const wav = await readWavFile(item.audioPath);
    entries.push({
      samples: wav.samples,
      sampleRate: wav.sampleRate,
      text: item.text
    });
  }
  return buildBaselineFromSamples(entries, options);
}

export function buildBaselineFromSamples(entries, options = {}) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("Calibration requires at least one audio sample.");
  }

  const measurements = entries.map((entry) => {
    if (!entry.samples || !entry.sampleRate || typeof entry.text !== "string" || !entry.text.trim()) {
      throw new Error("Each calibration entry requires samples, sampleRate, and text.");
    }
    const prosody = extractProsody(entry.samples, entry.sampleRate, options.prosody).summary;
    const words = tokenizeWords(entry.text);
    return {
      energyMean: prosody.energyMean,
      energyPeak: prosody.energyPeak,
      wordsPerSecond: words.length / Math.max(0.001, prosody.speechDurationSec),
      pitchRangeSemitones: prosody.pitchRangeSemitones,
      pauseDensity: prosody.pauseDensity,
      pitchConfidenceMean: prosody.pitchConfidenceMean,
      jitterRatio: prosody.jitterRatio,
      shimmerRatio: prosody.shimmerRatio,
      alphaRatioDb: prosody.alphaRatioDb
    };
  });
  const alphaValues = measurements.map((item) => item.alphaRatioDb);

  return {
    schema: BASELINE_SCHEMA,
    createdAt: new Date().toISOString(),
    samples: measurements.length,
    energy: summarize(measurements.map((item) => item.energyMean)),
    energyPeak: summarize(measurements.map((item) => item.energyPeak)),
    rate: summarize(measurements.map((item) => item.wordsPerSecond)),
    pitchRange: summarize(measurements.map((item) => item.pitchRangeSemitones)),
    pauseDensity: summarize(measurements.map((item) => item.pauseDensity)),
    pitchConfidence: summarize(measurements.map((item) => item.pitchConfidenceMean)),
    jitter: summarize(measurements.map((item) => item.jitterRatio)),
    shimmer: summarize(measurements.map((item) => item.shimmerRatio)),
    // Vocal effort (spectral balance). Optional: baselines saved before it
    // existed stay valid and simply fall back to loudness alone.
    ...(alphaValues.every(Number.isFinite) ? { alphaRatio: summarize(alphaValues) } : {})
  };
}

export function mergeBaselines(existing, incoming) {
  if (!isBaseline(existing)) {
    throw new Error("Existing baseline must use subtext/baseline/v1.");
  }
  if (!isBaseline(incoming)) {
    throw new Error("Incoming baseline must use subtext/baseline/v1.");
  }

  return {
    schema: BASELINE_SCHEMA,
    createdAt: existing.createdAt ?? incoming.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    samples: Number(existing.samples) + Number(incoming.samples),
    energy: mergeSummary(existing.energy, incoming.energy, existing.samples, incoming.samples),
    energyPeak: mergeSummary(existing.energyPeak, incoming.energyPeak, existing.samples, incoming.samples),
    rate: mergeSummary(existing.rate, incoming.rate, existing.samples, incoming.samples),
    pitchRange: mergeSummary(existing.pitchRange, incoming.pitchRange, existing.samples, incoming.samples),
    pauseDensity: mergeSummary(existing.pauseDensity, incoming.pauseDensity, existing.samples, incoming.samples),
    pitchConfidence: mergeSummary(existing.pitchConfidence, incoming.pitchConfidence, existing.samples, incoming.samples),
    jitter: mergeSummary(existing.jitter, incoming.jitter, existing.samples, incoming.samples),
    shimmer: mergeSummary(existing.shimmer, incoming.shimmer, existing.samples, incoming.samples),
    ...(hasSummary(existing.alphaRatio) && hasSummary(incoming.alphaRatio)
      ? { alphaRatio: mergeSummary(existing.alphaRatio, incoming.alphaRatio, existing.samples, incoming.samples) }
      : {})
  };
}

export function isBaseline(value) {
  return Boolean(
    value
      && value.schema === BASELINE_SCHEMA
      && Number(value.samples) > 0
      && hasSummary(value.energy)
      && hasSummary(value.energyPeak)
      && hasSummary(value.rate)
      && hasSummary(value.pitchRange)
      && hasSummary(value.pauseDensity)
      && hasSummary(value.pitchConfidence)
      && hasSummary(value.jitter)
      && hasSummary(value.shimmer)
  );
}

function summarize(values) {
  return {
    mean: round(mean(values), 5),
    stdev: round(Math.max(MIN_SPREAD, stdev(values)), 5)
  };
}

function mergeSummary(left, right, leftCount, rightCount) {
  const n1 = Number(leftCount);
  const n2 = Number(rightCount);
  const n = n1 + n2;
  const mean1 = Number(left?.mean ?? 0);
  const mean2 = Number(right?.mean ?? 0);
  const stdev1 = Number(left?.stdev ?? MIN_SPREAD);
  const stdev2 = Number(right?.stdev ?? MIN_SPREAD);

  if (!Number.isFinite(n) || n <= 0) {
    return { mean: 0, stdev: MIN_SPREAD };
  }

  const mergedMean = (n1 * mean1 + n2 * mean2) / n;
  if (n <= 1) {
    return {
      mean: round(mergedMean, 5),
      stdev: MIN_SPREAD
    };
  }

  const delta = mean2 - mean1;
  const leftM2 = Math.max(0, stdev1 ** 2) * Math.max(0, n1 - 1);
  const rightM2 = Math.max(0, stdev2 ** 2) * Math.max(0, n2 - 1);
  const mergedM2 = leftM2 + rightM2 + (delta ** 2) * n1 * n2 / n;
  const mergedStdev = Math.sqrt(Math.max(0, mergedM2 / (n - 1)));
  return {
    mean: round(mergedMean, 5),
    stdev: round(Math.max(MIN_SPREAD, mergedStdev), 5)
  };
}

function hasSummary(value) {
  return Number.isFinite(Number(value?.mean)) && Number.isFinite(Number(value?.stdev));
}
