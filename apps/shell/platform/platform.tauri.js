/* =========================================================================
   PlatformAdapter — Tauri desktop. STUB.

   Every method below throws. This file exists so the shell's contract with its
   host is written down in exactly one shape, and so the desktop agent has a
   checklist: replace each throw with the Rust-side call named in its comment
   and the identical UI in ../core runs inside the frameless overlay window
   with no other change.

   The interface, its arguments and its return shapes are documented at the top
   of ./platform.web.js. Read that first; this file deliberately repeats none
   of it, so the two cannot drift.

   What is already true on the desktop side and should be wired, not written:
     - the Tauri shell registers a global accelerator and emits status events
     - src/handoff/paste.js inserts text into the focused application
     - src/transcribe/whisper.js drives a local whisper.cpp binary
     - capture happens in the WebView (plan Move 1), so capture() can in
       practice reuse the web adapter unchanged
   ========================================================================= */

const NOT_WIRED = "not yet wired";

function todo(method, detail) {
  const error = new Error(`platform.tauri.${method}: ${NOT_WIRED} — ${detail}`);
  error.name = "NotWiredError";
  return error;
}

export const platform = {
  id: "tauri",

  async capabilities() {
    throw todo(
      "capabilities",
      "report { capture, recognition, engines, insert: \"focused-app\", devices } from the Rust side, " +
        "with engines derived from the shared registry in src/transcribe/engines.js"
    );
  },

  async devices() {
    throw todo("devices", "enumerate input devices; the WebView's enumerateDevices is the likely answer");
  },

  async capture() {
    throw todo(
      "capture",
      "capture in the WebView exactly as platform.web.js does (plan Move 1) and return the same CaptureSession"
    );
  },

  async transcribe() {
    throw todo(
      "transcribe",
      "invoke the whisper.cpp sidecar through Tauri's externalBin and resolve the same { text, source, blocked }"
    );
  },

  analyze() {
    throw todo(
      "analyze",
      "call the same model-free engine used by the web adapter. This path must never leave the machine, " +
        "whatever the transcription engine does"
    );
  },

  async insert() {
    throw todo(
      "insert",
      "call src/handoff/paste.js for the focused application and resolve { ok, method: \"focused-app\" }"
    );
  },

  async store() {
    throw todo(
      "store",
      "back the Store shape with SQLite through Tauri, keeping the same method names the shell calls"
    );
  }
};

export default platform;
