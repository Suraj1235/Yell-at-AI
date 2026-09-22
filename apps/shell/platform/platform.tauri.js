/* =========================================================================
   PlatformAdapter — Tauri desktop.

   The interface, its arguments and its return shapes are documented at the
   top of ./platform.web.js. This file implements the same shape against the
   Rust commands in apps/desktop/src-tauri (contract: apps/desktop/CONTRACT.md)
   and adds a few OPTIONAL desktop-only members the shell feature-detects:

     bindHotkey(handlers)     claim the global hotkey, route subtext://hotkey
     setHotkey(binding)       rebind the global accelerator (throws on refusal)
     reportState(state, msg)  mirror the shell's state to tray, title, overlay
     overlay(payload)         feed the overlay pill (level, tint, live chips)
     foregroundApp()          { title, process } of the app about to be pasted into
     onStatus(listener)       subtext://status from Rust

   Where each piece runs, and why:

     capture     in the WebView, exactly as the web adapter does it (plan
                 Move 1): getUserMedia -> Float32 PCM. No ffmpeg, no sox.
     transcribe  after capture stops, the take is resampled to 16 kHz mono,
                 encoded as 16-bit PCM WAV, staged with subtext_stage_audio and
                 transcribed by subtext_transcribe (whisper.cpp by default).
     analyze     IN PROCESS, with the same vendored model-free engine the web
                 build runs. One engine, one baseline, one set of numbers on
                 every surface, and no second Node start-up per turn. The
                 contract subtext_transcribe also returns is ignored on purpose.
     insert      subtext_insert: clipboard first, then the paste keystroke.
                 `pasted: false` is a successful copy, not an error.
     store       turns in the Rust JSON history file (subtext_history_*);
                 settings and the voice baseline in this WebView's IndexedDB,
                 which lives in the app's own data directory.
   ========================================================================= */

import web from "./platform.web.js";
import { ENGINES } from "../core/engine.js";
import { rmsOf } from "../core/live.js";

const TAURI = globalThis.__TAURI__;
const invoke = (command, args) => TAURI.core.invoke(command, args);
const listen = (event, handler) => TAURI.event.listen(event, handler);
const emit = (event, payload) => TAURI.event.emit(event, payload).catch(() => {});

// whisper.cpp reads 16 kHz mono 16-bit PCM and refuses anything else.
const WHISPER_RATE = 16000;
// The overlay is a second window; there is no need to cross the IPC bridge
// for every 128-sample worklet frame.
const OVERLAY_FRAME_MS = 50;

// The engines this build can actually run. Only offline engines are offered
// here: a cancelled turn is still transcribed so that Undo can restore it, and
// that must never mean sending a cancelled recording to a vendor. Cloud STT
// arrives with its own consent flow.
const DESKTOP_ENGINES = ["whisper", "none"];

// Binding ids (core/hotkey.js) -> accelerators the global-shortcut plugin parses.
const ACCELERATORS = Object.freeze({
  "ctrl-alt-y": "Ctrl+Alt+Y",
  "ctrl-alt-space": "Ctrl+Alt+Space",
  f9: "F9",
  f4: "F4"
});

// The last capture's take, handed from CaptureSession.stop() to the
// TranscriptionSession that was opened for the same turn.
let pendingTake = null;

export const platform = {
  id: "tauri",

  // The global accelerator replaces the page's keydown listener: the OS
  // swallows the chord before the WebView ever sees it.
  globalHotkey: true,

  async capabilities() {
    const base = await web.capabilities();
    return {
      capture: base.capture,
      recognition: true,
      engines: DESKTOP_ENGINES,
      insert: "focused-app",
      devices: base.devices
    };
  },

  devices() {
    return web.devices();
  },

  async capture({ deviceId, onSamples } = {}) {
    let resolveTake;
    const take = new Promise((resolve) => { resolveTake = resolve; });
    pendingTake = take;

    // One amplitude per audio frame, exactly what the in-window pill pushes,
    // shipped to the overlay in batches so both waveforms are the same bars.
    let levels = [];
    let lastSent = 0;
    const session = await web.capture({
      deviceId,
      onSamples: (frame, sampleRate) => {
        onSamples?.(frame, sampleRate);
        levels.push(rmsOf(frame));
        const now = performance.now();
        if (now - lastSent >= OVERLAY_FRAME_MS) {
          lastSent = now;
          emit("subtext://pill", { level: levels[levels.length - 1], levels });
          levels = [];
        }
      }
    });

    return {
      sampleRate: session.sampleRate,
      stream: session.stream,
      async stop() {
        const result = await session.stop();
        resolveTake(result);
        return result;
      },
      cancel() {
        session.cancel();
        resolveTake(null);
      }
    };
  },

  async transcribe({ engine = "whisper" } = {}) {
    const take = pendingTake;
    pendingTake = null;

    if (engine === "none" || !take) {
      return {
        engine: "none",
        async stop() {
          return { text: "", source: "manual", blocked: false };
        },
        cancel() {}
      };
    }

    let cancelled = false;
    return {
      engine,
      async stop() {
        const recorded = await take;
        if (cancelled || !recorded || recorded.samples.length < 2048) {
          return { text: "", source: "manual", blocked: false, engineInfo: describeEngine(null, engine) };
        }
        let staged = null;
        try {
          const wav = encodeWav(resample(recorded.samples, recorded.sampleRate, WHISPER_RATE), WHISPER_RATE);
          staged = await invoke("subtext_stage_audio", {
            request: { bytes: Array.from(wav), extension: "wav" }
          });
          const result = await invoke("subtext_transcribe", {
            request: { wavPath: staged.path, engine }
          });
          return {
            text: String(result.text || "").replace(/\s+/g, " ").trim(),
            source: engine,
            blocked: false,
            engineInfo: describeEngine(result.engine, engine)
          };
        } catch (error) {
          // The recording is still in memory; the shell asks for the words and
          // reads the delivery from it. Name what failed rather than hiding it.
          return {
            text: "",
            source: "manual",
            blocked: false,
            engineInfo: describeEngine(null, engine),
            failure: `Transcription didn't run: ${message(error)}`
          };
        } finally {
          if (staged) invoke("subtext_discard_audio", { path: staged.path }).catch(() => {});
        }
      },
      cancel() {
        cancelled = true;
      }
    };
  },

  // Local. Model-free. The same engine the web build runs, in this process.
  analyze(input) {
    return web.analyze(input);
  },

  // Clipboard first, keystroke second, in Rust. `pasted: false` still means
  // the words are on the clipboard, so it resolves ok with method "clipboard".
  //
  // When this window has focus the user is working in Yell@AI itself (a Copy
  // button, a turn dictated with the settings open), so the text is copied and
  // no keystroke is synthesised into our own page.
  async insert(text, { paste } = {}) {
    if (!text) return { ok: false, method: "clipboard" };
    const wantPaste = paste ?? !document.hasFocus();
    try {
      const result = await invoke("subtext_insert", { request: { text, paste: wantPaste } });
      return {
        ok: Boolean(result.clipboard),
        method: result.pasted ? "focused-app" : "clipboard",
        pasted: Boolean(result.pasted),
        // Only worth saying when a paste was attempted and did not land.
        note: wantPaste && !result.pasted ? result.detail : null
      };
    } catch (error) {
      return { ok: false, method: "clipboard", note: message(error) };
    }
  },

  async store() {
    const local = await web.store();
    return {
      getSettings: () => local.getSettings(),
      saveSettings: (patch) => local.saveSettings(patch),
      getBaseline: (kind) => local.getBaseline(kind),
      saveBaseline: (kind, value) => local.saveBaseline(kind, value),
      async putTurn(turn) {
        await invoke("subtext_history_put", { entry: toEntry(turn) });
      },
      async listTurns() {
        const entries = await invoke("subtext_history_list", { request: { limit: 100 } });
        return (entries || []).map(fromEntry);
      },
      async deleteTurn(id) {
        await invoke("subtext_history_delete", { id });
      },
      async clearTurns() {
        await invoke("subtext_history_clear");
      }
    };
  },

  /* ── desktop-only members ─────────────────────────────────────────── */

  // Claim the hotkey (CONTRACT §3: without this the press edge runs the old
  // Node CLI turn), then route Rust's press / release / tap / Esc into the
  // same handlers the page hotkey drives.
  async bindHotkey({ onStart, onEnd, onLatch, onCancel }) {
    await listen("subtext://hotkey", (event) => {
      const payload = event?.payload || {};
      if (!payload.claimed) return;
      if (payload.phase === "start") onStart?.(payload);
      else if (payload.phase === "end") onEnd?.(payload);
      else if (payload.phase === "latch") onLatch?.(payload);
      else if (payload.phase === "cancel") onCancel?.(payload);
    });
    return invoke("subtext_hotkey_claim", { claimed: true });
  },

  // Rejects with the OS's reason when the accelerator is refused; Rust has
  // already restored the previous binding by then.
  async setHotkey(binding) {
    const accelerator = ACCELERATORS[binding?.id] || binding?.label?.replace(/\s+/g, "") || "Ctrl+Alt+Y";
    try {
      return await invoke("subtext_hotkey_set", { request: { accelerator } });
    } catch (error) {
      throw new Error(message(error));
    }
  },

  onStatus(listener) {
    return listen("subtext://status", (event) => listener(event?.payload || {}));
  },

  // The tray, the window title and the overlay are driven from this one call,
  // so the three surfaces and the shell cannot disagree. Synchronous hops
  // (the typed-fallback path goes listening -> thinking in one tick, with no
  // microphone open) are coalesced so the overlay never flashes "Listening"
  // for a turn that is not recording.
  reportState: coalesce((state, detail) => {
    const status = STATUS_OF[state] || "ready";
    invoke("subtext_status_set", { request: { status, detail: detail || "" } }).catch(() => {});
  }),

  overlay(payload) {
    emit("subtext://pill", payload);
  },

  // Null when this window has focus: the turn is being handed to Yell@AI
  // itself (a copy, not a paste), so no other app's rule applies.
  // Launch at login lives in the OS (tauri-plugin-autostart), not in the
  // shell's settings, so it is read back rather than remembered.
  autostart: {
    get: () => invoke("subtext_autostart_status"),
    async set(enabled) {
      try {
        return await invoke("subtext_autostart_set", { enabled });
      } catch (error) {
        throw new Error(message(error));
      }
    }
  },

  async foregroundApp() {
    if (document.hasFocus()) return null;
    try {
      return (await invoke("subtext_foreground_app")) || null;
    } catch {
      return null;
    }
  },

  engines: ENGINES
};

const STATUS_OF = Object.freeze({
  idle: "ready",
  listening: "listening",
  thinking: "thinking",
  inserted: "delivered",
  error: "failed"
});

function coalesce(run) {
  let queued = null;
  return (...args) => {
    const first = queued === null;
    queued = args;
    if (first) {
      queueMicrotask(() => {
        const latest = queued;
        queued = null;
        run(...latest);
      });
    }
  };
}

// The CLI reports the engine it ran, as an id or as a descriptor. Either way
// the badge is painted from an `egress` field, looked up in the same registry
// the CLI itself uses (src/transcribe/engines.js, vendored), never from a name
// typed into the UI.
export function describeEngine(reported, fallbackId) {
  if (reported && typeof reported === "object" && reported.egress) {
    return { ...(ENGINES[reported.id] || {}), ...reported };
  }
  const id = typeof reported === "string" && reported ? reported : fallbackId;
  return ENGINES[id] || { id, label: id, egress: "unknown", vendor: null };
}

function toEntry(turn) {
  return {
    id: String(turn.id),
    at: Math.round(Number(turn.at) || Date.now()),
    text: turn.text || "",
    prompt: turn.block || undefined,
    contract: turn.contract || undefined,
    engine: turn.engine || undefined,
    targetApp: turn.targetApp || undefined,
    audioMs: Number.isFinite(turn.durationSec) ? Math.round(turn.durationSec * 1000) : undefined,
    // Unconfirmed until the shell says the handover worked: the first write
    // happens BEFORE insertion, so a crash in between reads as not delivered.
    delivered: turn.delivered === true
  };
}

function fromEntry(entry) {
  return {
    id: entry.id,
    at: entry.at,
    text: entry.text,
    block: entry.prompt || entry.text,
    contract: entry.contract || null,
    engine: entry.engine || null,
    targetApp: entry.targetApp || null,
    durationSec: Number.isFinite(entry.audioMs) ? entry.audioMs / 1000 : 0,
    delivered: entry.delivered
  };
}

/* ───────────────────────── audio ───────────────────────── */

// Box-filter decimation to the recogniser's rate. Speech is band-limited well
// under 8 kHz, and averaging each output sample's input span is enough of a
// low-pass to keep aliasing out of what whisper hears. The prosody engine is
// NOT fed this — it reads the full-rate take in-process.
export function resample(samples, fromRate, toRate) {
  if (fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const length = Math.floor(samples.length / ratio);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(samples.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = start; j < end; j += 1) sum += samples[j];
    out[i] = sum / (end - start);
  }
  return out;
}

// 16-bit PCM mono WAV, the format the Subtext core and whisper.cpp both read.
export function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const ascii = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}

function message(error) {
  return typeof error === "string" ? error : error?.message || String(error);
}

export default platform;
