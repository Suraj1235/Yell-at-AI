// Pluggable speech-to-text (STT) interface.
//
// A uniform transcribe() that dispatches across adapters and returns a transcript
// envelope shape: { text, source, language?, confidence?, words? } (matching
// subtext/transcript/v1; the concrete envelope from ../transcript/envelope.js is a
// superset that also carries `schema` and `wordTimings` — its `wordTimings` is the
// adapter contract's `words`).
//
// Adapters:
//   "command"  — generalizes the CLI's host transcript-command mechanism: spawn an
//                external command, substitute {audio}/{audioPath}/{turn}, parse
//                stdout as plain text or a transcript envelope. (./command.js)
//   "whisper"  — shell out to a whisper.cpp binary (auto-detected; SUBTEXT_WHISPER_BIN
//                override); throws an actionable error when no binary is found.
//                (./whisper.js)
//   "webspeech" — IMPLEMENTED IN THE BROWSER, NOT HERE. Contract: the browser uses the
//                Web Speech API (webkitSpeechRecognition / SpeechRecognition) to produce
//                a live transcript, then constructs the same envelope shape
//                ({ text, source: "webspeech", language?, confidence?, words? }) and feeds
//                it to analyzeSamples in src/index.browser.js. It is listed here for
//                discoverability but has no Node implementation.
import { transcribeWithCommand } from "./command.js";
import { transcribeWithWhisper } from "./whisper.js";
import { transcribeWithCloud } from "./cloud.js";

// Adapter names known to this interface. "webspeech" is a browser-only contract.
export const ADAPTERS = ["command", "whisper", "cloud", "webspeech"];
export { ENGINES, EGRESS_LEVELS, getEngine, listEngines, isOfflineEngine } from "./engines.js";
export const DEFAULT_ADAPTER = "command";

// transcribe(input, opts) -> Promise<envelope>
// `input` may be a file path (node adapters) or, for browser adapters, samples.
// opts.adapter selects the adapter ("command" default, or "whisper"); remaining
// opts are forwarded to the chosen adapter.
export async function transcribe(input, opts = {}) {
  const { adapter = DEFAULT_ADAPTER, ...rest } = opts;

  if (adapter === "command") {
    return transcribeWithCommand({ replacements: { audio: input ?? "", audioPath: input ?? "" }, ...rest });
  }

  if (adapter === "whisper") {
    return transcribeWithWhisper({ audio: input, ...rest });
  }

  if (adapter === "cloud") {
    return transcribeWithCloud({ audio: input, ...rest });
  }

  if (adapter === "webspeech") {
    throw new Error("The 'webspeech' adapter is implemented in the browser, not in the Node transcribe interface.");
  }

  throw new Error(`Unknown transcribe adapter: ${adapter}. Available: ${ADAPTERS.join(", ")}.`);
}

export { transcribeWithCommand } from "./command.js";
export { transcribeWithWhisper, resolveWhisperBinary } from "./whisper.js";
export { transcribeWithCloud, CLOUD_PROVIDERS } from "./cloud.js";
