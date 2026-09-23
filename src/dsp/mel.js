const TWO_PI = 2 * Math.PI;
const filterbankCache = new Map();
const windowCache = new Map();

// Alpha ratio bands (Hz). The alpha ratio is the energy in 1-5 kHz over the
// energy in 50 Hz-1 kHz, in dB: the eGeMAPS spectral-balance feature. Raised
// vocal effort (anger, shouting, excitement) flattens the glottal source
// spectrum and pushes energy into the upper band; low-arousal speech (sadness,
// flat or tired delivery) is dominated by the fundamental and first harmonics.
// Because it is a ratio of two energies in the same frame it does not move when
// the microphone gain does, which is why the uncalibrated reading is built on it
// instead of absolute RMS.
const ALPHA_LOW_BAND_HZ = [50, 1000];
const ALPHA_HIGH_BAND_HZ = [1000, 5000];

export function computeMelLogEnergy(frame, sampleRate, options = {}) {
  return computeSpectralFeatures(frame, sampleRate, options).melLogEnergy;
}

// One FFT per frame yields both the mel log energy (word emphasis) and the
// alpha ratio (vocal effort).
export function computeSpectralFeatures(frame, sampleRate, options = {}) {
  const fftSize = nextPowerOfTwo(Math.max(64, frame.length));
  const filters = getMelFilterbank({
    sampleRate,
    fftSize,
    bands: options.bands ?? 24,
    minHz: options.minHz ?? 50,
    maxHz: options.maxHz ?? sampleRate / 2
  });
  const power = powerSpectrum(frame, fftSize);
  let normSquared = 0;

  for (const filter of filters) {
    let bandEnergy = 0;
    for (const { bin, weight } of filter) {
      bandEnergy += (power[bin] ?? 0) * weight;
    }
    normSquared += bandEnergy ** 2;
  }

  const binHz = sampleRate / fftSize;
  let low = 0;
  let high = 0;
  for (let bin = 0; bin < power.length; bin += 1) {
    const hz = bin * binHz;
    if (hz >= ALPHA_LOW_BAND_HZ[0] && hz < ALPHA_LOW_BAND_HZ[1]) low += power[bin];
    else if (hz >= ALPHA_HIGH_BAND_HZ[0] && hz < ALPHA_HIGH_BAND_HZ[1]) high += power[bin];
  }

  return {
    melLogEnergy: Math.log(Math.sqrt(normSquared) + 1e-12),
    // null, not a number, when either band is empty (digital silence), so a
    // silent frame can never be read as extreme effort or extreme flatness.
    alphaRatioDb: low > 0 && high > 0 ? 10 * Math.log10(high / low) : null
  };
}

function powerSpectrum(frame, fftSize) {
  const real = new Float64Array(fftSize);
  const imag = new Float64Array(fftSize);
  const window = getHannWindow(frame.length);

  for (let index = 0; index < frame.length; index += 1) {
    real[index] = frame[index] * window[index];
  }

  fft(real, imag);

  const bins = Math.floor(fftSize / 2) + 1;
  const power = new Float64Array(bins);
  for (let bin = 0; bin < bins; bin += 1) {
    power[bin] = (real[bin] ** 2 + imag[bin] ** 2) / fftSize;
  }
  return power;
}

function getMelFilterbank({ sampleRate, fftSize, bands, minHz, maxHz }) {
  const key = [sampleRate, fftSize, bands, minHz, maxHz].join(":");
  const cached = filterbankCache.get(key);
  if (cached) return cached;

  const minMel = hzToMel(minHz);
  const maxMel = hzToMel(maxHz);
  const melPoints = [];
  for (let index = 0; index < bands + 2; index += 1) {
    melPoints.push(minMel + ((maxMel - minMel) * index) / (bands + 1));
  }
  const hzPoints = melPoints.map(melToHz);
  const binPoints = hzPoints.map((hz) => Math.floor(((fftSize + 1) * hz) / sampleRate));
  const filters = [];

  for (let band = 1; band <= bands; band += 1) {
    const left = binPoints[band - 1];
    const center = Math.max(left + 1, binPoints[band]);
    const right = Math.max(center + 1, binPoints[band + 1]);
    const weights = [];

    for (let bin = left; bin < center; bin += 1) {
      const weight = (bin - left) / Math.max(1, center - left);
      if (weight > 0) weights.push({ bin, weight });
    }
    for (let bin = center; bin <= right; bin += 1) {
      const weight = (right - bin) / Math.max(1, right - center);
      if (weight > 0) weights.push({ bin, weight });
    }

    filters.push(weights);
  }

  filterbankCache.set(key, filters);
  return filters;
}

function getHannWindow(length) {
  const cached = windowCache.get(length);
  if (cached) return cached;

  const window = new Float64Array(length);
  for (let index = 0; index < length; index += 1) {
    window[index] = 0.5 * (1 - Math.cos((TWO_PI * index) / Math.max(1, length - 1)));
  }
  windowCache.set(length, window);
  return window;
}

function fft(real, imag) {
  const n = real.length;
  let j = 0;
  for (let i = 1; i < n; i += 1) {
    let bit = n >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const angle = -TWO_PI / len;
    const wLenReal = Math.cos(angle);
    const wLenImag = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let wReal = 1;
      let wImag = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const uReal = real[i + k];
        const uImag = imag[i + k];
        const vReal = real[i + k + len / 2] * wReal - imag[i + k + len / 2] * wImag;
        const vImag = real[i + k + len / 2] * wImag + imag[i + k + len / 2] * wReal;
        real[i + k] = uReal + vReal;
        imag[i + k] = uImag + vImag;
        real[i + k + len / 2] = uReal - vReal;
        imag[i + k + len / 2] = uImag - vImag;
        const nextReal = wReal * wLenReal - wImag * wLenImag;
        wImag = wReal * wLenImag + wImag * wLenReal;
        wReal = nextReal;
      }
    }
  }
}

function nextPowerOfTwo(value) {
  return 2 ** Math.ceil(Math.log2(value));
}

function hzToMel(hz) {
  return 2595 * Math.log10(1 + hz / 700);
}

function melToHz(mel) {
  return 700 * (10 ** (mel / 2595) - 1);
}
