export function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function stdev(values) {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function quantile(values, q) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return 0;
  const position = (clean.length - 1) * q;
  const base = Math.floor(position);
  const rest = position - base;
  const next = clean[base + 1];
  return next === undefined ? clean[base] : clean[base] + rest * (next - clean[base]);
}

export function median(values) {
  return quantile(values, 0.5);
}

export function zScore(value, center, spread) {
  if (!Number.isFinite(value) || !Number.isFinite(center) || !Number.isFinite(spread) || spread < 1e-9) {
    return 0;
  }
  return (value - center) / spread;
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function round(value, digits = 3) {
  if (!Number.isFinite(value)) return 0;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function semitoneDelta(a, b) {
  if (a <= 0 || b <= 0) return 0;
  return 12 * Math.log2(a / b);
}
