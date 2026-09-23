import { estimatePitch } from "./pitch.js";
import { computeSpectralFeatures } from "./mel.js";
import { mean, median, quantile, round, semitoneDelta } from "./stats.js";

// Speech/silence gating. Every level here is RELATIVE to the clip itself, so
// the same utterance recorded 12 dB hotter or quieter gets the same speech mask,
// the same pitched frames and therefore the same contract. The previous gate
// clamped the floor into an absolute 0.004-0.025 RMS window: a quiet recording
// (every CREMA-D clip; a laptop mic with browser AGC off) then counted its room
// noise as speech, and a hot one lost its quiet syllables.
//
// The floor sits a fixed margin above the noise estimate (the 10th-percentile
// frame), clamped into a window measured down from the loud speech frames
// (the 95th percentile). That is the old absolute window re-expressed in dB
// relative to the talker, which is what it was approximating.
const GATE = {
  // A frame at or below this RMS is digital silence (exact zeros, sub-LSB
  // dither). It is the one absolute level in the engine, and it decides nothing
  // except "is there any signal in this frame at all".
  digitalSilenceRms: 1e-7,
  noiseQuantile: 0.1,
  speechQuantile: 0.95,
  // 6 dB above the noise estimate: twice its RMS, enough to reject steady room
  // noise without eating the start of a word.
  noiseMarginDb: 6,
  // Never gate higher than 15 dB under the loud frames: in a noisy room
  // (MIT OCW discussion audio, noise ~21 dB under speech) this keeps real pauses
  // visible, and 15 dB still passes the weaker syllables of normal speech.
  maxFloorBelowSpeechDb: 15,
  // Never gate lower than 30 dB under the loud frames: in near-silent studio
  // recordings (RAVDESS, noise 50-100 dB down) breaths and hiss must not count
  // as speech time and drag the speaking rate down.
  minFloorBelowSpeechDb: 30
};

export function extractProsody(samples, sampleRate, options = {}) {
  const frameMs = options.frameMs ?? 30;
  const hopMs = options.hopMs ?? 10;
  const frameSize = Math.max(64, Math.round((sampleRate * frameMs) / 1000));
  const hopSize = Math.max(16, Math.round((sampleRate * hopMs) / 1000));
  const frameStarts = [];

  if (samples.length <= frameSize) {
    frameStarts.push(0);
  } else {
    for (let start = 0; start + frameSize <= samples.length; start += hopSize) {
      frameStarts.push(start);
    }
  }

  const rawFrames = frameStarts.map((start) => {
    const frame = samples.subarray(start, Math.min(samples.length, start + frameSize));
    const rms = computeRms(frame);
    const zcr = computeZeroCrossingRate(frame);
    return {
      startSec: start / sampleRate,
      endSec: Math.min(samples.length, start + frameSize) / sampleRate,
      centerSec: (start + frame.length / 2) / sampleRate,
      rms,
      ...computeSpectralFeatures(frame, sampleRate, options.mel),
      db: 20 * Math.log10(Math.max(1e-6, rms)),
      zcr
    };
  });

  const rmsValues = rawFrames.map((frame) => frame.rms);
  const nonZeroRms = rmsValues.filter((value) => value > GATE.digitalSilenceRms);
  const speechLevel = quantile(nonZeroRms, GATE.speechQuantile);
  const adaptiveFloor = Math.max(
    GATE.digitalSilenceRms,
    clampValue(
      quantile(nonZeroRms, GATE.noiseQuantile) * dbToRatio(GATE.noiseMarginDb),
      speechLevel * dbToRatio(-(options.minFloorBelowSpeechDb ?? GATE.minFloorBelowSpeechDb)),
      speechLevel * dbToRatio(-(options.maxFloorBelowSpeechDb ?? GATE.maxFloorBelowSpeechDb))
    )
  );
  const energyFloor = options.energyFloor ?? adaptiveFloor;
  const rawSpeechMask = rawFrames.map((frame) => frame.rms >= energyFloor);
  const speechMask = smoothSpeechMask(rawSpeechMask, {
    maxBridgeFrames: Math.max(1, Math.round((options.maxBridgeMs ?? 120) / hopMs)),
    minRunFrames: Math.max(1, Math.round((options.minSpeechRunMs ?? 50) / hopMs))
  });

  const frames = rawFrames.map((frame, index) => {
    const shouldPitch = frame.rms >= energyFloor;
    const pitch = shouldPitch
      ? estimatePitch(samples.subarray(
          Math.round(frame.startSec * sampleRate),
          Math.round(frame.endSec * sampleRate)
        ), sampleRate, options.pitch)
      : { f0: null, confidence: 0 };
    return {
      ...frame,
      f0: pitch.f0,
      pitchConfidence: pitch.confidence,
      speech: speechMask[index],
      rawSpeech: rawSpeechMask[index],
      voiced: Boolean(shouldPitch && pitch.f0)
    };
  });

  const voicedFrames = frames.filter((frame) => frame.voiced);
  const reliableVoicedFrames = filterPitchOutliers(voicedFrames);
  const activeFrames = frames.filter((frame) => frame.speech);
  const activeStart = frames.findIndex((frame) => frame.speech);
  const activeEnd = findLastIndex(frames, (frame) => frame.speech);
  const speechFrames = frames.filter((frame) => frame.rawSpeech);
  const activeWindowFrames = activeStart >= 0 && activeEnd >= activeStart
    ? frames.slice(activeStart, activeEnd + 1)
    : frames;
  const voicedF0 = reliableVoicedFrames.map((frame) => frame.f0);
  const voicedRms = speechFrames.map((frame) => frame.rms);
  const durationSec = samples.length / sampleRate;
  const speechStartSec = activeFrames[0]?.startSec ?? 0;
  const speechEndSec = activeFrames.at(-1)?.endSec ?? durationSec;
  const speechDurationSec = Math.max(0.001, speechEndSec - speechStartSec);
  const pitchP10 = quantile(voicedF0, 0.1);
  const pitchP90 = quantile(voicedF0, 0.9);
  const pitchRangeSemitones = pitchP10 > 0 && pitchP90 > 0 ? semitoneDelta(pitchP90, pitchP10) : 0;
  // Level-independent loudness measures. These are ratios of the clip to
  // itself, so they are unchanged by microphone gain.
  const voicedAlpha = reliableVoicedFrames.map((frame) => frame.alphaRatioDb).filter(Number.isFinite);
  const speechMeanRms = mean(voicedRms);
  const energyPeakToMean = speechMeanRms > 0 ? Math.max(0, ...voicedRms) / speechMeanRms : 0;
  const speechP10 = quantile(voicedRms, 0.1);
  const energyContrastDb = speechP10 > 0 ? 20 * Math.log10(quantile(voicedRms, 0.9) / speechP10) : 0;

  const summary = {
    durationSec: round(durationSec),
    speechStartSec: round(speechStartSec),
    speechEndSec: round(speechEndSec),
    speechDurationSec: round(speechDurationSec),
    frameCount: frames.length,
    voicedFrameCount: voicedFrames.length,
    reliableVoicedFrameCount: reliableVoicedFrames.length,
    energyFloor: round(energyFloor, 5),
    energyMean: round(mean(voicedRms), 5),
    energyMedian: round(median(voicedRms), 5),
    energyPeak: round(Math.max(0, ...rmsValues), 5),
    energyPeakToMean: round(energyPeakToMean, 3),
    energyContrastDb: round(energyContrastDb, 2),
    alphaRatioDb: voicedAlpha.length ? round(median(voicedAlpha), 2) : null,
    pauseDensity: round(1 - activeFrames.length / Math.max(1, activeWindowFrames.length), 4),
    f0Median: round(median(voicedF0), 2),
    f0P10: round(pitchP10, 2),
    f0P90: round(pitchP90, 2),
    pitchRangeSemitones: round(pitchRangeSemitones, 2),
    pitchConfidenceMean: round(mean(reliableVoicedFrames.map((frame) => frame.pitchConfidence)), 3),
    jitterRatio: round(computeJitter(voicedF0), 4),
    shimmerRatio: round(computeShimmer(voicedRms), 4),
    zeroCrossingRateMean: round(mean(speechFrames.map((frame) => frame.zcr)), 4),
    terminalPitch: classifyTerminalPitch(reliableVoicedFrames)
  };

  return {
    frames,
    summary
  };
}

function dbToRatio(db) {
  return 10 ** (db / 20);
}

function clampValue(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function smoothSpeechMask(mask, options) {
  const bridged = [...mask];
  let index = 0;
  while (index < bridged.length) {
    if (bridged[index]) {
      index += 1;
      continue;
    }

    const gapStart = index;
    while (index < bridged.length && !bridged[index]) index += 1;
    const gapEnd = index;
    const hasSpeechBefore = gapStart > 0 && bridged[gapStart - 1];
    const hasSpeechAfter = gapEnd < bridged.length && bridged[gapEnd];
    if (hasSpeechBefore && hasSpeechAfter && gapEnd - gapStart <= options.maxBridgeFrames) {
      bridged.fill(true, gapStart, gapEnd);
    }
  }

  const smoothed = [...bridged];
  index = 0;
  while (index < smoothed.length) {
    if (!smoothed[index]) {
      index += 1;
      continue;
    }

    const runStart = index;
    while (index < smoothed.length && smoothed[index]) index += 1;
    const runEnd = index;
    if (runEnd - runStart < options.minRunFrames) {
      smoothed.fill(false, runStart, runEnd);
    }
  }

  return smoothed;
}

function findLastIndex(values, predicate) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (predicate(values[index], index)) return index;
  }
  return -1;
}

function filterPitchOutliers(voicedFrames) {
  if (voicedFrames.length < 8) return voicedFrames;

  const f0Median = median(voicedFrames.map((frame) => frame.f0));
  if (f0Median <= 0) return voicedFrames;

  const filtered = voicedFrames.filter((frame) => {
    const ratio = frame.f0 / f0Median;
    return ratio >= 0.5 && ratio <= 2 && frame.pitchConfidence >= 0.48;
  });

  return filtered.length >= Math.max(6, voicedFrames.length * 0.45) ? filtered : voicedFrames;
}

function computeRms(frame) {
  if (!frame.length) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i += 1) {
    sum += frame[i] * frame[i];
  }
  return Math.sqrt(sum / frame.length);
}

function computeZeroCrossingRate(frame) {
  if (frame.length < 2) return 0;
  let crossings = 0;
  for (let i = 1; i < frame.length; i += 1) {
    if ((frame[i - 1] >= 0 && frame[i] < 0) || (frame[i - 1] < 0 && frame[i] >= 0)) {
      crossings += 1;
    }
  }
  return crossings / (frame.length - 1);
}

function computeJitter(f0Values) {
  if (f0Values.length < 3) return 0;
  const deltas = [];
  for (let i = 1; i < f0Values.length; i += 1) {
    deltas.push(Math.abs(f0Values[i] - f0Values[i - 1]));
  }
  return quantile(deltas, 0.75) / Math.max(1e-6, median(f0Values));
}

function computeShimmer(rmsValues) {
  if (rmsValues.length < 3) return 0;
  const deltas = [];
  for (let i = 1; i < rmsValues.length; i += 1) {
    deltas.push(Math.abs(rmsValues[i] - rmsValues[i - 1]));
  }
  return mean(deltas) / Math.max(1e-6, mean(rmsValues));
}

function classifyTerminalPitch(voicedFrames) {
  if (voicedFrames.length < 8) return "unknown";
  const lastWindowStart = voicedFrames.at(-1).centerSec - 0.45;
  const priorWindowStart = lastWindowStart - 0.65;
  const last = voicedFrames.filter((frame) => frame.centerSec >= lastWindowStart).map((frame) => frame.f0);
  const prior = voicedFrames
    .filter((frame) => frame.centerSec >= priorWindowStart && frame.centerSec < lastWindowStart)
    .map((frame) => frame.f0);

  if (last.length < 3 || prior.length < 3) return "unknown";
  const change = semitoneDelta(median(last), median(prior));
  if (change >= 1.5) return "rising";
  if (change <= -1.5) return "falling";
  return "level";
}
