export { parseWav, readWavFile, encodeWav } from "./audio/wav.js";
export { buildBaselineFromFiles, buildBaselineFromSamples, isBaseline, mergeBaselines } from "./calibration/baseline.js";
export {
  defaultProfileStorePath,
  deleteProfile,
  getProfile,
  getProfileBaseline,
  listProfiles,
  loadProfileStore,
  saveProfileStore,
  upsertProfileBaseline
} from "./calibration/profile-store.js";
export { recordWav, buildRecorderCommand, findRecorderOnPath, resolveWindowsAudioDevice } from "./capture/recorder.js";
export { extractProsody } from "./dsp/features.js";
export { buildAdapterBundles, installAdapter, readHarnessCatalog } from "./harness/bundles.js";
export { runHarnessConformance, renderHarnessConformance } from "./harness/conformance.js";
export { runHarnessDoctor, renderHarnessDoctor, checkSttReadiness, renderSttReadiness } from "./harness/doctor.js";
export { copyToClipboard } from "./handoff/clipboard.js";
export { pasteIntoActiveApp } from "./handoff/paste.js";
export { analyzeSamples, analyzeFile } from "./contract/analyzer.js";
export { renderVocalContext } from "./render/text.js";
export { startHttpServer } from "./server/http.js";
export { startMcpServer } from "./server/mcp.js";
// package.json declares a single export (`{".": "./src/index.js"}`) with no
// subpath patterns, so a deep import such as `yell-at-ai/src/transcribe/engines.js`
// is blocked by the exports map. Anything another surface needs - the desktop
// shell, the web app - has to be re-exported here or it is unreachable from the
// published package. One entrypoint, deliberately.
export {
  ADAPTERS,
  DEFAULT_ADAPTER,
  transcribe,
  transcribeWithCommand,
  transcribeWithWhisper,
  resolveWhisperBinary,
  // The STT engine registry: the single source of truth for which engines exist
  // and which of them send audio to a named third party. Surfaces that must
  // render a vendor badge read this.
  ENGINES,
  EGRESS_LEVELS,
  getEngine,
  listEngines,
  isOfflineEngine,
  // Opt-in, bring-your-own-key cloud STT. The lower-level request builders
  // (buildCloudRequest, parseCloudResponse, resolveCloudCredentials) stay
  // internal: they are the adapter's own seams, not a supported API.
  transcribeWithCloud,
  CLOUD_PROVIDERS
} from "./transcribe/index.js";
export { resolveWhisperModel } from "./transcribe/whisper.js";
// Local whisper model management. MODELS itself is deliberately NOT exported:
// it is only shallow-frozen, so handing it out would let a consumer rewrite a
// pinned sha256 or url at runtime. listModels() is the read path.
export { listModels, downloadModel, modelDirectory, resolveInstalledModel } from "./transcribe/models.js";
export { normalizeTranscriptEnvelope, parseTranscriptPayload, TRANSCRIPT_SCHEMA } from "./transcript/envelope.js";
