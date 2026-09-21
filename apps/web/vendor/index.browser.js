// Browser-safe surface: pure DSP + analysis + render. No node: imports.
export { analyzeSamples } from "./contract/analyzer.js";
export { renderVocalContext } from "./render/text.js";
export { extractProsody } from "./dsp/features.js";
export { normalizeTranscriptEnvelope } from "./transcript/envelope.js";
// The STT engine registry travels with the browser bundle so the web surface can
// render its vendor badge from the single source of truth (src/transcribe/engines.js)
// rather than hardcoding a vendor name that could drift out of the registry.
// This module is pure data + pure functions; it imports nothing.
export { ENGINES, EGRESS_LEVELS, getEngine, listEngines, isOfflineEngine } from "./transcribe/engines.js";
