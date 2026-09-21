// Registry of speech-to-text engines and, critically, whether each one sends the
// user's audio off the device.
//
// The prosody engine is ALWAYS local and model-free; only the transcript half can
// ever touch a network. This registry is the single source of truth for that
// distinction. The UI renders a persistent vendor badge for any engine with
// egress "vendor", and test/privacy-claims.test.js asserts that marketing copy
// only claims "offline" for egress "none".
//
//   none    - no network egress, ever, once installed
//   vendor  - audio is sent to a named third party for recognition
//   unknown - user-supplied command; we cannot know what it does

export const EGRESS_LEVELS = Object.freeze(["none", "vendor", "unknown"]);

export const ENGINES = Object.freeze({
  whisper: Object.freeze({
    id: "whisper",
    label: "whisper.cpp (local)",
    egress: "none",
    vendor: null,
    runtimes: Object.freeze(["node"]),
    description:
      "Shells out to a local whisper.cpp binary and a local ggml model. Nothing leaves the machine."
  }),
  "whisper-wasm": Object.freeze({
    id: "whisper-wasm",
    label: "whisper (WASM, in-page)",
    egress: "none",
    vendor: null,
    runtimes: Object.freeze(["browser"]),
    description:
      "Runs whisper in WebAssembly inside the page. Downloads the model once, then no egress."
  }),
  webspeech: Object.freeze({
    id: "webspeech",
    label: "Browser Web Speech API",
    egress: "vendor",
    vendor: "Google (Chrome/Edge) or Apple (Safari)",
    runtimes: Object.freeze(["browser"]),
    description:
      "Uses the browser's own recognizer. In Chrome and Edge this uploads your audio to Google's servers."
  }),
  cloud: Object.freeze({
    id: "cloud",
    label: "Cloud STT (bring your own key)",
    egress: "vendor",
    vendor: "your configured provider (Groq or Deepgram)",
    runtimes: Object.freeze(["node", "browser"]),
    description:
      "Sends the recorded turn to the provider you configured. Fastest and most accurate; opt-in only."
  }),
  command: Object.freeze({
    id: "command",
    label: "Host transcript command",
    egress: "unknown",
    vendor: null,
    runtimes: Object.freeze(["node"]),
    description:
      "Runs a command you supply. Whether it sends audio anywhere depends entirely on that command."
  })
});

export function getEngine(id) {
  const engine = ENGINES[id];
  if (!engine) {
    throw new Error(
      `Unknown transcribe engine: ${id}. Available: ${Object.keys(ENGINES).join(", ")}.`
    );
  }
  return engine;
}

export function listEngines(runtime = null) {
  const all = Object.values(ENGINES);
  if (!runtime) return all;
  return all.filter((engine) => engine.runtimes.includes(runtime));
}

export function isOfflineEngine(id) {
  return getEngine(id).egress === "none";
}
