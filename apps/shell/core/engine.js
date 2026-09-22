// The one place the shell reaches the analysis engine.
//
// The browser build of the engine already ships, vendored and committed, under
// apps/web/vendor/. Re-exporting it here rather than copying it means the
// shell, the landing page and the CLI are provably running the same code, and
// it keeps the shell to a single edit if the vendor location ever moves.
//
// Everything below is model-free and runs in this process. There is no network
// call on this path, on any platform.

export {
  analyzeSamples,
  renderVocalContext,
  extractProsody,
  ENGINES,
  getEngine,
  listEngines,
  isOfflineEngine
} from "../../web/vendor/index.browser.js";

export {
  buildBaselineFromSamples,
  mergeBaselines,
  isBaseline
} from "../../web/vendor/calibration/baseline.js";

// The same tokenizer the analyzer ran, so the word the card marks inside your
// sentence is the word the engine measured — not a lookalike found by a second,
// subtly different split.
export { tokenizeWords } from "../../web/vendor/text/tokenize.js";
