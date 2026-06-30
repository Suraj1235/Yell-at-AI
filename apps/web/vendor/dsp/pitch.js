import { mean } from "./stats.js";

export function estimatePitch(frame, sampleRate, options = {}) {
  const minF0 = options.minF0 ?? 70;
  const maxF0 = options.maxF0 ?? 420;
  const minLag = Math.max(1, Math.floor(sampleRate / maxF0));
  const maxLag = Math.min(frame.length - 2, Math.ceil(sampleRate / minF0));

  if (frame.length < maxLag + 2) {
    return { f0: null, confidence: 0 };
  }

  const dc = mean(Array.from(frame));
  const windowed = new Float32Array(frame.length);
  for (let i = 0; i < frame.length; i += 1) {
    const hann = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / Math.max(1, frame.length - 1));
    windowed[i] = (frame[i] - dc) * hann;
  }

  let bestLag = 0;
  let bestCorrelation = -1;

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let sum = 0;
    let energyA = 0;
    let energyB = 0;
    const limit = frame.length - lag;
    for (let i = 0; i < limit; i += 1) {
      const a = windowed[i];
      const b = windowed[i + lag];
      sum += a * b;
      energyA += a * a;
      energyB += b * b;
    }

    const denominator = Math.sqrt(energyA * energyB);
    if (denominator <= 1e-12) continue;
    const correlation = sum / denominator;
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation;
      bestLag = lag;
    }
  }

  if (bestCorrelation < (options.minConfidence ?? 0.42) || bestLag === 0) {
    return { f0: null, confidence: Math.max(0, bestCorrelation) };
  }

  return {
    f0: sampleRate / bestLag,
    confidence: Math.max(0, Math.min(1, bestCorrelation))
  };
}
