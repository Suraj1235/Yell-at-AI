// The live read — the signature moment.
//
// While you speak, this runs the SAME model-free feature extractor the final
// contract uses (extractProsody, from src/dsp/features.js) over a rolling
// one-second window, and compares the result against your stored baseline. The
// numbers it shows are therefore the same kind of number the block will carry:
// z-scores against your own voice, not a sentiment guess.
//
// Two honest limits, stated here and in the UI:
//
//   1. It reads DELIVERY, not words. Attributing emphasis to a particular word
//      needs word timings, and the interim transcript has none, so a live chip
//      says `emphasis  z 1.4` and the block written on release says
//      `emphasis on "whole", z 1.23`. The block is the authority; live chips
//      are marked provisional and drawn with a dashed rail.
//   2. Without a baseline there is nothing to be a z-score against. Before
//      calibration the waveform still tints from raw level, but no chips
//      appear, and onboarding says why.
//
// Jitter control, because a flickering readout would be worse than no readout:
//   - each window's z is smoothed with an EMA (ALPHA)
//   - a chip must clear its threshold on two consecutive windows to appear
//   - once shown it stays for at least HOLD_MS after the condition clears
// The window is decimated to 16 kHz first, which is ample for F0 and energy and
// keeps a window's analysis well inside the gap between windows.

import { extractProsody } from "./engine.js";
import { usableBaseline } from "./baseline.js";

const WINDOW_SEC = 1.0;
const EVERY_MS = 300;
const TARGET_RATE = 16000;
const ALPHA = 0.4;
const HOLD_MS = 900;
const MIN_SPREAD = 1e-4;

// Each rule reads one baseline field and produces one chip. `z` is the number
// the chip prints; nothing here invents a label the numbers do not support.
const RULES = [
  {
    // Emphasis is a PEAK phenomenon — one syllable louder than the rest.
    // Yelling is a MEAN one: the whole window is up. Separating them on that
    // basis is what stops a single stressed word being reported as shouting,
    // which was the first false positive this reader produced.
    type: "yelling",
    read: (s, z) => (z("energyPeak", s.energyPeak) >= 2.1 && z("energy", s.energyMean) >= 2.5
      ? { z: z("energy", s.energyMean), evidence: "sustained energy across the window" }
      : null)
  },
  {
    type: "emphasis",
    read: (s, z) => (z("energyPeak", s.energyPeak) >= 1.2
      ? { z: z("energyPeak", s.energyPeak), evidence: "peak energy" }
      : null)
  },
  {
    type: "urgency",
    read: (s, z) => (z("pauseDensity", s.pauseDensity) <= -0.8 && z("energy", s.energyMean) >= 0.8
      ? { z: z("energy", s.energyMean), evidence: "few pauses, raised energy" }
      : null)
  },
  {
    type: "hesitation",
    read: (s, z) => (z("pauseDensity", s.pauseDensity) >= 1.2
      ? { z: z("pauseDensity", s.pauseDensity), evidence: "pause density" }
      : null)
  },
  {
    type: "tension",
    read: (s, z) => {
      const worst = Math.max(z("jitter", s.jitterRatio), z("shimmer", s.shimmerRatio));
      return worst >= 1.3 ? { z: worst, evidence: "jitter and shimmer" } : null;
    }
  }
];

export function createLiveReader({ baseline = null, onUpdate, now = () => performance.now() } = {}) {
  baseline = usableBaseline(baseline);
  let ring = null;
  let ringRate = 0;
  let filled = 0;
  let writeAt = 0;
  let lastRun = 0;
  let enabled = Boolean(baseline);
  const smoothed = new Map();
  const held = new Map();
  const streaks = new Map();
  let lastCost = 0;

  function ensureRing(sampleRate) {
    const size = Math.round(WINDOW_SEC * sampleRate);
    if (!ring || ringRate !== sampleRate) {
      ring = new Float32Array(size);
      ringRate = sampleRate;
      filled = 0;
      writeAt = 0;
    }
  }

  function zOf(field, value) {
    const stats = baseline?.[field];
    if (!stats) return 0;
    const spread = Math.max(MIN_SPREAD, Number(stats.stdev) || MIN_SPREAD);
    const raw = (Number(value) - Number(stats.mean)) / spread;
    const previous = smoothed.get(field);
    const next = previous == null ? raw : previous + ALPHA * (raw - previous);
    smoothed.set(field, next);
    return next;
  }

  function run() {
    const size = ring.length;
    const ordered = new Float32Array(Math.min(filled, size));
    for (let i = 0; i < ordered.length; i += 1) {
      ordered[i] = ring[(writeAt - ordered.length + i + size) % size];
    }
    const window = decimate(ordered, ringRate, TARGET_RATE);
    const started = now();
    let summary;
    try {
      summary = extractProsody(window.samples, window.sampleRate).summary;
    } catch {
      return; // a degenerate window is not an error the user should ever see
    }
    lastCost = now() - started;

    // One pass over the rules, then hysteresis so nothing flickers.
    const at = now();
    const seen = new Set();
    for (const rule of RULES) {
      const hit = enabled ? rule.read(summary, zOf) : null;
      const streak = hit ? (streaks.get(rule.type) || 0) + 1 : 0;
      streaks.set(rule.type, streak);
      if (hit && streak >= 2) {
        held.set(rule.type, { ...hit, type: rule.type, until: at + HOLD_MS });
      }
      const alive = held.get(rule.type);
      if (alive && alive.until > at) seen.add(rule.type);
      else held.delete(rule.type);
    }

    // `yelling` subsumes `emphasis`: showing both is noise, not evidence.
    if (seen.has("yelling")) seen.delete("emphasis");

    const chips = [...seen].map((type) => {
      const entry = held.get(type);
      return { type, z: round(entry.z, 2), evidence: entry.evidence, provisional: true };
    });

    const emphasisZ = smoothed.get("energyPeak") ?? 0;
    const tint = enabled ? clamp01((emphasisZ + 0.4) / 2.6) : null;

    if (onUpdate) onUpdate({ chips, tint, summary, enabled, costMs: lastCost });
  }

  return {
    get enabled() {
      return enabled;
    },
    get lastCostMs() {
      return lastCost;
    },
    setBaseline(next) {
      baseline = usableBaseline(next);
      enabled = Boolean(baseline);
    },
    push(frame, sampleRate) {
      ensureRing(sampleRate);
      const size = ring.length;
      for (let i = 0; i < frame.length; i += 1) {
        ring[writeAt] = frame[i];
        writeAt = (writeAt + 1) % size;
      }
      filled = Math.min(size, filled + frame.length);

      const at = now();
      if (filled < size * 0.5) return;
      if (at - lastRun < EVERY_MS) return;
      lastRun = at;
      run();
    },
    reset() {
      filled = 0;
      writeAt = 0;
      lastRun = 0;
      smoothed.clear();
      held.clear();
      streaks.clear();
    }
  };
}

// Cheap box-average decimation. Anti-aliases enough for F0 and energy, and is
// the difference between a window costing a few milliseconds and tens.
function decimate(samples, from, to) {
  if (!samples.length || from <= to) return { samples, sampleRate: from };
  const factor = Math.floor(from / to);
  if (factor < 2) return { samples, sampleRate: from };
  const out = new Float32Array(Math.floor(samples.length / factor));
  for (let i = 0; i < out.length; i += 1) {
    let sum = 0;
    const base = i * factor;
    for (let j = 0; j < factor; j += 1) sum += samples[base + j];
    out[i] = sum / factor;
  }
  return { samples: out, sampleRate: from / factor };
}

export function rmsOf(frame) {
  let sum = 0;
  for (let i = 0; i < frame.length; i += 1) sum += frame[i] * frame[i];
  return Math.sqrt(sum / Math.max(1, frame.length));
}

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const round = (value, places) => Number(Number(value).toFixed(places));
