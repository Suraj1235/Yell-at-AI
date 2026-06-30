// Browser-safe surface: pure DSP + analysis + render. No node: imports.
export { analyzeSamples } from "./contract/analyzer.js";
export { renderVocalContext } from "./render/text.js";
export { extractProsody } from "./dsp/features.js";
export { normalizeTranscriptEnvelope } from "./transcript/envelope.js";
