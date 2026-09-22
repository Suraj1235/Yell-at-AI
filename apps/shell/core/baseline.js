// How the shell makes, and judges, a personal baseline.
//
// Every number this product shows is a comparison against how you usually
// speak, so the baseline is the thing that decides whether a reading means
// anything. Two traps, both of which this module exists to avoid:
//
//   1. A baseline built from ONE measurement has no spread. buildBaselineFromSamples
//      clamps stdev to a floor of 0.001 in that case, so the very next z-score
//      is (value − mean) / 0.001 — hundreds. Every flag fires, every waveform
//      pins to hot, and the evidence is garbage that looks confident.
//      Onboarding asks for one sentence, not ten, so the spread has to come
//      from inside that sentence: the take is cut into segments and each
//      segment is measured, which is a real within-speaker spread rather than
//      a fabricated one.
//   2. Even so, a baseline can come back with too few usable segments — a take
//      that was mostly silence, say. usableBaseline() is the single gate that
//      decides whether a baseline is allowed to drive a reading at all, and
//      everything that consumes a baseline goes through it. Below the bar, the
//      app says so and falls back to the engine's no-baseline mode, which uses
//      absolute cutoffs and is honest about being generic.

import { buildBaselineFromSamples, isBaseline, mergeBaselines as mergeRaw } from "./engine.js";

export { isBaseline };

const MIN_SAMPLES = 2;

// The smallest spread each measure is allowed to claim.
//
// A spread narrower than this is not a measurement of a voice — it is an
// artifact of having measured too few segments of one sentence. Four segments
// of steady speech can come back with an energy spread under 3% of its mean,
// and then the next loud syllable reads `z 98`: a number that has lost its
// meaning, which is exactly the vibes-dressed-as-data this product exists to
// replace. The floors only ever WIDEN, so a baseline with genuine spread keeps
// it and the effect is confined to the case it exists for: too little data.
//
// Two floors per field, because the two failure modes are different:
//   relative  for quantities with no natural zero point — a speaker's energy or
//             rate varies by double-digit percentages between utterances.
//   absolute  for bounded ratios, whose mean can sit near zero, where a
//             relative floor collapses to nothing. `pauseDensity` measured
//             near 0 on a fluent calibration line is the case that produced a
//             live chip reading `z 174`.
const FLOORS = {
  energy: { relative: 0.15, absolute: 0.004 },
  energyPeak: { relative: 0.15, absolute: 0.006 },
  rate: { relative: 0.15, absolute: 0.3 },        // words per second
  pitchRange: { relative: 0.15, absolute: 0.8 },  // semitones
  pauseDensity: { relative: 0.15, absolute: 0.06 },
  pitchConfidence: { relative: 0.15, absolute: 0.04 },
  jitter: { relative: 0.2, absolute: 0.005 },
  shimmer: { relative: 0.2, absolute: 0.005 }
};

function widen(baseline) {
  const out = { ...baseline };
  for (const [field, floor] of Object.entries(FLOORS)) {
    const stats = baseline[field];
    if (!stats) continue;
    const least = Math.max(Math.abs(Number(stats.mean)) * floor.relative, floor.absolute);
    out[field] = { mean: stats.mean, stdev: Math.max(Number(stats.stdev) || 0, least) };
  }
  return out;
}

export function mergeBaselines(existing, incoming) {
  return widen(mergeRaw(existing, incoming));
}
const SEGMENTS = 4;
const MIN_SEGMENT_SEC = 0.6;
const SILENCE_RMS = 0.006;

// The one gate. Null means "do not measure anything against this".
export function usableBaseline(baseline) {
  if (!isBaseline(baseline)) return null;
  if (Number(baseline.samples) < MIN_SAMPLES) return null;
  return baseline;
}

// Build a baseline from a single take by measuring it in segments.
//
// The transcript is split across the segments in proportion to their length.
// That is an approximation — it assumes an even speaking rate across the
// sentence — and it only feeds the `rate` field, which is the one field that
// needs a word count. Every other field is measured from the audio directly.
export function baselineFromTake({ samples, sampleRate, text, segments = SEGMENTS }) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const total = samples.length;
  const count = Math.max(1, Math.min(segments, Math.floor(total / sampleRate / MIN_SEGMENT_SEC)));

  const entries = [];
  const size = Math.floor(total / count);
  for (let i = 0; i < count; i += 1) {
    const slice = samples.subarray(i * size, i === count - 1 ? total : (i + 1) * size);
    if (rms(slice) < SILENCE_RMS) continue; // a silent segment measures nothing
    const from = Math.floor((i * words.length) / count);
    const to = i === count - 1 ? words.length : Math.floor(((i + 1) * words.length) / count);
    const chunk = words.slice(from, to).join(" ");
    entries.push({ samples: slice, sampleRate, text: chunk || words[0] || "the" });
  }

  if (!entries.length) {
    throw new Error("That take was silent, so there was nothing to measure.");
  }
  return widen(buildBaselineFromSamples(entries));
}

function rms(frame) {
  let sum = 0;
  for (let i = 0; i < frame.length; i += 1) sum += frame[i] * frame[i];
  return Math.sqrt(sum / Math.max(1, frame.length));
}
