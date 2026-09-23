import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeWav } from "../src/audio/wav.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fixtureDir = join(root, "eval", "fixtures");
const sampleRate = 16000;

// Voice source spectra. Every fixture keeps its original first three harmonics
// (1, 0.28, 0.08) and gains a tail of higher harmonics, k >= 4 up to 7 kHz, at
// upperGain * (3/k)^tilt. Real voices have that tail, and how strong it is is
// the physical signature of vocal effort: pushing the voice flattens the source
// spectrum. The engine's uncalibrated energy reading is that spectral balance
// (the alpha ratio), because absolute sample level is set by mic gain, not by
// the speaker.
//
// Until this existed the yelling and urgency fixtures said "loud" only by having
// bigger sample values (amplitude 0.2-0.48 against 0.1 for neutral), with no
// harmonics above 1 kHz at all. That was exactly the absolute-level bug: turn
// the mic down 4x and the "yelling" fixture became neutral. Their expected
// results are unchanged; they now carry the cue that survives a gain change.
// Measured alpha ratio: modal about -16 to -11 dB (medium effort), raised about
// -4 dB, shouted about +1 to +3 dB, soft about -30 dB.
const VOICES = {
  modal: { upperGain: 0.3, tilt: 1.5 },
  raised: { upperGain: 0.3, tilt: 0.5 },
  shouted: { upperGain: 1, tilt: 1 },
  soft: { upperGain: 0.05, tilt: 1.5 }
};
const MAX_HARMONIC_HZ = 7000;

const cases = [
  {
    id: "neutral",
    text: "can we refactor the auth module",
    words: [
      word("can", 0.24, 145, 0.12, 0.04),
      word("we", 0.22, 148, 0.12, 0.04),
      word("refactor", 0.5, 150, 0.12, 0.05),
      word("the", 0.18, 146, 0.11, 0.03),
      word("auth", 0.28, 152, 0.12, 0.04),
      word("module", 0.4, 147, 0.11, 0)
    ]
  },
  {
    id: "framed-neutral",
    text: "don't forget a jacket",
    leadingSilenceSec: 0.75,
    trailingSilenceSec: 0.85,
    words: [
      word("don't", 0.28, 142, 0.09, 0.04),
      word("forget", 0.46, 150, 0.1, 0.05),
      word("a", 0.16, 146, 0.08, 0.04),
      word("jacket", 0.44, 148, 0.09, 0)
    ]
  },
  {
    id: "pausy-neutral",
    text: "can we inspect the auth module",
    words: [
      word("can", 0.24, 140, 0.1, 0.34),
      word("we", 0.22, 142, 0.1, 0.32),
      word("inspect", 0.44, 148, 0.1, 0.36),
      word("the", 0.18, 145, 0.09, 0.3),
      word("auth", 0.28, 150, 0.1, 0.34),
      word("module", 0.4, 146, 0.1, 0)
    ]
  },
  {
    id: "expressive-neutral",
    text: "can we inspect the auth module",
    words: [
      word("can", 0.22, 120, 0.2, 0.03, 180),
      word("we", 0.2, 175, 0.18, 0.03, 220),
      word("inspect", 0.46, 130, 0.21, 0.03, 245),
      word("the", 0.18, 170, 0.17, 0.03, 135),
      word("auth", 0.28, 230, 0.22, 0.03, 150),
      word("module", 0.38, 135, 0.19, 0, 210)
    ]
  },
  {
    id: "urgency",
    text: "can we ship this now please",
    voice: "raised",
    words: [
      word("can", 0.15, 185, 0.2, 0.01),
      word("we", 0.13, 190, 0.2, 0.01),
      word("ship", 0.16, 215, 0.24, 0.01),
      word("this", 0.14, 205, 0.22, 0.01),
      word("now", 0.2, 255, 0.34, 0.01),
      word("please", 0.18, 215, 0.24, 0)
    ]
  },
  {
    id: "yelling",
    text: "stop rewriting the whole auth module",
    voice: "shouted",
    words: [
      word("stop", 0.18, 270, 0.42, 0.005),
      word("rewriting", 0.34, 255, 0.38, 0.005),
      word("the", 0.12, 235, 0.3, 0.005),
      word("whole", 0.28, 310, 0.48, 0.005),
      word("auth", 0.2, 285, 0.42, 0.005),
      word("module", 0.26, 260, 0.38, 0)
    ]
  },
  {
    id: "hesitation",
    text: "um can we maybe change the auth module",
    words: [
      word("um", 0.28, 125, 0.08, 0.38),
      word("can", 0.3, 138, 0.1, 0.18),
      word("we", 0.26, 135, 0.1, 0.1),
      word("maybe", 0.48, 145, 0.09, 0.28),
      word("change", 0.36, 142, 0.11, 0.1),
      word("the", 0.22, 134, 0.08, 0.08),
      word("auth", 0.34, 140, 0.1, 0.12),
      word("module", 0.42, 132, 0.09, 0)
    ]
  },
  {
    id: "confusion",
    text: "wait um i am not sure which auth flow broke?",
    words: [
      word("wait", 0.34, 128, 0.08, 0.24),
      word("um", 0.28, 122, 0.07, 0.32),
      word("i", 0.2, 132, 0.08, 0.12),
      word("am", 0.2, 136, 0.08, 0.1),
      word("not", 0.28, 142, 0.09, 0.14),
      word("sure", 0.44, 148, 0.09, 0.24, 160),
      word("which", 0.36, 152, 0.1, 0.12, 170),
      word("auth", 0.32, 155, 0.09, 0.1, 174),
      word("flow", 0.36, 164, 0.1, 0.12, 188),
      word("broke", 0.48, 178, 0.11, 0, 220)
    ]
  },
  {
    id: "emphasis",
    text: "can we just refactor the whole auth module",
    words: [
      word("can", 0.22, 145, 0.1, 0.03),
      word("we", 0.2, 146, 0.1, 0.03),
      word("just", 0.28, 175, 0.17, 0.03),
      word("refactor", 0.46, 150, 0.11, 0.04),
      word("the", 0.18, 145, 0.09, 0.02),
      word("whole", 0.5, 245, 0.33, 0.04),
      word("auth", 0.28, 152, 0.12, 0.03),
      word("module", 0.36, 145, 0.1, 0)
    ]
  },
  {
    id: "mismatch",
    text: "yeah this is totally fine",
    voice: "soft",
    words: [
      word("yeah", 0.34, 118, 0.055, 0.08),
      word("this", 0.3, 116, 0.05, 0.08),
      word("is", 0.22, 115, 0.048, 0.07),
      word("totally", 0.52, 113, 0.047, 0.1),
      word("fine", 0.42, 105, 0.045, 0)
    ]
  }
];

await mkdir(fixtureDir, { recursive: true });

const manifest = [];
for (const fixture of cases) {
  const samples = synthesize(fixture.words, fixture);
  const audioPath = join(fixtureDir, `${fixture.id}.wav`);
  await writeFile(audioPath, encodeWav({ samples, sampleRate }));
  manifest.push({
    id: fixture.id,
    text: fixture.text,
    audio: `eval/fixtures/${fixture.id}.wav`,
    durationSec: Number((samples.length / sampleRate).toFixed(3))
  });
}

await writeFile(join(fixtureDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

function word(label, durationSec, f0Start, amp, pauseAfterSec = 0, f0End = f0Start) {
  return { label, durationSec, f0Start, f0End, amp, pauseAfterSec };
}

function synthesize(specs, fixture = {}) {
  const samples = [];
  const voice = VOICES[fixture.voice ?? "modal"];
  let phase = 0;
  pushSilence(samples, fixture.leadingSilenceSec ?? 0);
  for (const spec of specs) {
    const voicedSamples = Math.round(spec.durationSec * sampleRate);
    const weights = harmonicWeights(voice, Math.max(spec.f0Start, spec.f0End));
    // Normalise so the tail never raises the peak above the original
    // three-harmonic waveform's: amplitude still means what it meant.
    const norm = weights.reduce((sum, weight) => sum + weight, 0) / (1 + 0.28 + 0.08);
    for (let i = 0; i < voicedSamples; i += 1) {
      const t = i / Math.max(1, voicedSamples - 1);
      const f0 = spec.f0Start + (spec.f0End - spec.f0Start) * t;
      const envelope = Math.min(1, i / 80, (voicedSamples - i) / 80);
      let harmonic = 0;
      for (let k = 0; k < weights.length; k += 1) harmonic += weights[k] * Math.sin(phase * (k + 1));
      samples.push((spec.amp * envelope * harmonic) / norm);
      phase += (2 * Math.PI * f0) / sampleRate;
    }
    pushSilence(samples, spec.pauseAfterSec);
  }
  pushSilence(samples, fixture.trailingSilenceSec ?? 0);
  return Float32Array.from(samples);
}

function harmonicWeights(voice, maxF0) {
  const weights = [1, 0.28, 0.08];
  for (let k = 4; k * maxF0 <= MAX_HARMONIC_HZ; k += 1) {
    weights.push(voice.upperGain * (3 / k) ** voice.tilt);
  }
  return weights;
}

function pushSilence(samples, durationSec) {
  const silenceSamples = Math.round(durationSec * sampleRate);
  for (let i = 0; i < silenceSamples; i += 1) {
    samples.push(0);
  }
}
