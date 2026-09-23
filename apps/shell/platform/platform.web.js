/* =========================================================================
   PlatformAdapter — the browser implementation.

   The shell in ../core is written against this interface and nothing else.
   Swapping in ./platform.tauri.js must be the only change needed to run the
   identical UI inside the desktop overlay.

   ─────────────────────────────────────────────────────────────────────────
   interface PlatformAdapter {

     readonly id: "web" | "tauri"
     capabilities(): Promise<{
       capture: boolean,          // can we get microphone samples at all
       recognition: boolean,      // is a speech recognizer reachable
       engines: string[],         // engine ids from the shared registry
       insert: "clipboard" | "focused-app",
       devices: boolean           // can we enumerate microphones
     }>

     // Open the microphone. Streams raw mono Float32 PCM to onSamples as it
     // arrives, so the live reader and the final analysis see the same audio.
     capture({ deviceId, onSamples }): Promise<CaptureSession>
       CaptureSession {
         sampleRate: number
         stop(): Promise<{ samples: Float32Array, sampleRate, durationSec }>
         cancel(): void        // release the microphone, discard everything
       }

     // Start recognition for this turn. Never required: a turn with no
     // transcript still yields prosody once the user supplies the words.
     transcribe({ engine, lang, onPartial }): Promise<TranscriptionSession>
       TranscriptionSession {
         engine: string
         stop(): Promise<{ text: string, source: string, blocked: boolean }>
         cancel(): void
       }

     // ALWAYS LOCAL, on every platform, with no toggle. The vocal-context
     // contract is produced by the model-free engine in this process. An
     // adapter that sent audio anywhere to compute this would be a bug.
     analyze({ samples, sampleRate, text, baseline, options }): Contract

     // Hand the finished text to wherever the user is working.
     insert(text): Promise<{ ok: boolean, method: "clipboard" | "focused-app" }>

     // Durable local storage for settings, baseline and the turn history.
     store(): Promise<Store>
       Store {
         getSettings(): Promise<object>
         saveSettings(patch): Promise<object>
         getBaseline(kind): Promise<object|null>      // "calibration" | "auto"
         saveBaseline(kind, value): Promise<void>
         putTurn(turn): Promise<void>                 // trims to MAX_TURNS
         listTurns(): Promise<turn[]>                 // newest first
         deleteTurn(id): Promise<void>
         clearTurns(): Promise<void>
       }
   }
   ─────────────────────────────────────────────────────────────────────────
   ========================================================================= */

import { analyzeSamples, ENGINES } from "../core/engine.js";

const DB_NAME = "yell-at-ai";
const DB_VERSION = 1;
const TURNS = "turns";
const KV = "kv";
const MAX_TURNS = 100;
const MAX_SECONDS = 120;

const SpeechRecognitionImpl = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;

// Read through globalThis: a bare `navigator` is a ReferenceError at import time
// in any host without it (Node 20, workers), which broke the test suite on Node 20.
const mediaDevices = globalThis.navigator?.mediaDevices;
const hasCapture = Boolean(
  mediaDevices && typeof mediaDevices.getUserMedia === "function" && AudioCtx
);

export const platform = {
  id: "web",

  async capabilities() {
    return {
      capture: hasCapture,
      recognition: Boolean(SpeechRecognitionImpl),
      engines: SpeechRecognitionImpl ? ["webspeech", "none"] : ["none"],
      insert: "clipboard",
      devices: Boolean(navigator.mediaDevices?.enumerateDevices)
    };
  },

  async devices() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    return all
      .filter((device) => device.kind === "audioinput")
      .map((device, index) => ({
        id: device.deviceId,
        label: device.label || `Microphone ${index + 1}`
      }));
  },

  async capture({ deviceId, onSamples } = {}) {
    if (!hasCapture) {
      throw new CaptureError("This browser can't reach a microphone.", "unsupported");
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: constraints(deviceId) });
    } catch (error) {
      // Not every browser honours the processing constraints; a plain request
      // is still better than no microphone.
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: deviceId ? { deviceId: { exact: deviceId } } : true
        });
      } catch {
        throw new CaptureError(microphoneReason(error), error?.name || "error");
      }
    }

    const context = new AudioCtx();
    if (context.state === "suspended") await context.resume().catch(() => {});
    const source = context.createMediaStreamSource(stream);
    const sampleRate = context.sampleRate;
    const chunks = [];
    let total = 0;
    let closed = false;
    const capSamples = MAX_SECONDS * sampleRate;

    const take = (frame) => {
      if (closed || total >= capSamples) return;
      chunks.push(frame);
      total += frame.length;
      if (onSamples) onSamples(frame, sampleRate);
    };

    let node;
    try {
      await context.audioWorklet.addModule(new URL("../core/capture-worklet.js", import.meta.url));
      node = new AudioWorkletNode(context, "pcm-tap");
      node.port.onmessage = (event) => take(event.data);
      source.connect(node);
      // A worklet needs a live graph path; a muted gain keeps it pulling
      // without routing the microphone back to the speakers.
      const sink = context.createGain();
      sink.gain.value = 0;
      node.connect(sink).connect(context.destination);
    } catch {
      // Older Safari and anything without AudioWorklet.
      node = context.createScriptProcessor(4096, 1, 1);
      node.onaudioprocess = (event) => take(new Float32Array(event.inputBuffer.getChannelData(0)));
      const sink = context.createGain();
      sink.gain.value = 0;
      source.connect(node);
      node.connect(sink).connect(context.destination);
    }

    const shutdown = () => {
      if (closed) return;
      closed = true;
      try { node.disconnect(); } catch { /* already gone */ }
      try { source.disconnect(); } catch { /* already gone */ }
      for (const track of stream.getTracks()) track.stop();
      context.close().catch(() => {});
    };

    return {
      sampleRate,
      stream,
      async stop() {
        shutdown();
        const samples = new Float32Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          samples.set(chunk, offset);
          offset += chunk.length;
        }
        return { samples, sampleRate, durationSec: total / sampleRate };
      },
      cancel() {
        shutdown();
        chunks.length = 0;
        total = 0;
      }
    };
  },

  async transcribe({ engine = "webspeech", lang, onPartial } = {}) {
    if (engine !== "webspeech" || !SpeechRecognitionImpl) {
      // The honest no-op: nothing is sent anywhere, and the caller asks the
      // user for the words instead.
      return {
        engine: "none",
        async stop() {
          return { text: "", source: "manual", blocked: false };
        },
        cancel() {}
      };
    }

    const recognition = new SpeechRecognitionImpl();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang || navigator.language || "en-US";

    let finalText = "";
    let interim = "";
    let blocked = false;

    recognition.addEventListener("result", (event) => {
      let pending = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) finalText += `${result[0].transcript} `;
        else pending += result[0].transcript;
      }
      interim = pending;
      if (onPartial) onPartial(`${finalText}${interim}`.replace(/\s+/g, " ").trim());
    });

    recognition.addEventListener("error", (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") blocked = true;
    });

    try {
      recognition.start();
    } catch {
      blocked = true;
    }

    const settle = () => `${finalText}${interim}`.replace(/\s+/g, " ").trim();

    return {
      engine: "webspeech",
      async stop() {
        try { recognition.stop(); } catch { /* already stopped */ }
        // Chrome emits the last final result shortly after stop(); give it a
        // bounded moment rather than racing it.
        await new Promise((resolve) => {
          const done = () => resolve();
          recognition.addEventListener("end", done, { once: true });
          setTimeout(done, 600);
        });
        return { text: settle(), source: "webspeech", blocked };
      },
      cancel() {
        try { recognition.abort(); } catch { /* already stopped */ }
      }
    };
  },

  // Local. Model-free. No network on this path, on any platform.
  analyze({ samples, sampleRate, text, baseline = null, options = {} }) {
    return analyzeSamples({ samples, sampleRate, text, baseline, options });
  },

  async insert(text) {
    if (!text) return { ok: false, method: "clipboard" };
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return { ok: true, method: "clipboard" };
      }
    } catch { /* fall through to the legacy path */ }
    return { ok: legacyCopy(text), method: "clipboard" };
  },

  async store() {
    const db = await openDb();
    return {
      async getSettings() {
        return (await kvGet(db, "settings")) || {};
      },
      async saveSettings(patch) {
        const next = { ...(await kvGet(db, "settings")), ...patch };
        await kvPut(db, "settings", next);
        return next;
      },
      async getBaseline(kind) {
        return (await kvGet(db, `baseline:${kind}`)) || null;
      },
      async saveBaseline(kind, value) {
        await kvPut(db, `baseline:${kind}`, value);
      },
      async putTurn(turn) {
        await tx(db, TURNS, "readwrite", (storeRef) => storeRef.put(turn));
        const all = await this.listTurns();
        for (const stale of all.slice(MAX_TURNS)) {
          await tx(db, TURNS, "readwrite", (storeRef) => storeRef.delete(stale.id));
        }
      },
      async listTurns() {
        const rows = await tx(db, TURNS, "readonly", (storeRef) => storeRef.getAll());
        return (rows || []).sort((a, b) => b.at - a.at);
      },
      async deleteTurn(id) {
        await tx(db, TURNS, "readwrite", (storeRef) => storeRef.delete(id));
      },
      async clearTurns() {
        await tx(db, TURNS, "readwrite", (storeRef) => storeRef.clear());
      }
    };
  },

  engines: ENGINES
};

// Microphone constraints, and the one line in this file most likely to be
// "tidied up" by someone who does not know why it is here:
//
// The browser's default capture pipeline runs automatic gain control, noise
// suppression and echo cancellation. AGC normalises loudness over time — it is
// designed to make a quiet talker and a loud talker sound the same on a call.
// That is precisely the signal this product measures. With AGC on, leaning on
// a word gets flattened, and a long quiet passage gets quietly amplified until
// an ordinary word reads as emphasis. Noise suppression is gentler but still
// reshapes the spectral envelope the pitch tracker works on.
//
// So all three are turned off. What reaches the engine is what the microphone
// heard. Browsers that ignore these constraints fall back to a plain request
// above, and the reading is still useful — just less faithful.
function constraints(deviceId) {
  const audio = {
    autoGainControl: false,
    noiseSuppression: false,
    echoCancellation: false
  };
  if (deviceId) audio.deviceId = { exact: deviceId };
  return audio;
}

export class CaptureError extends Error {
  constructor(message, reason) {
    super(message);
    this.name = "CaptureError";
    this.reason = reason;
  }
}

function microphoneReason(error) {
  switch (error?.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Microphone access is blocked. Allow it for this site, then try again.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No microphone was found. Plug one in or pick a different device in Settings.";
    case "NotReadableError":
      return "Another app is holding the microphone. Close it and try again.";
    default:
      return "The microphone didn't open. Check that this page is served over HTTPS or localhost.";
  }
}

function legacyCopy(text) {
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/* ───────────────────────── IndexedDB ───────────────────────── */
function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TURNS)) db.createObjectStore(TURNS, { keyPath: "id" });
      if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx(db, name, mode, run) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(name, mode);
    const request = run(transaction.objectStore(name));
    transaction.onerror = () => reject(transaction.error);
    if (request && "onsuccess" in request) {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    } else {
      transaction.oncomplete = () => resolve();
    }
  });
}

const kvGet = (db, key) => tx(db, KV, "readonly", (storeRef) => storeRef.get(key));
const kvPut = (db, key, value) => tx(db, KV, "readwrite", (storeRef) => storeRef.put(value, key));

export default platform;
