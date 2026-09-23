// The desktop overlay pill (pill.html).
//
// Same markup, same stylesheet, same createPill as the main window — this file
// only decides what drives it. There is no microphone here and no insertion:
// the overlay is a picture of the turn the main window is running.
//
//   subtext://status  (Rust)          -> the pill's state. Rust publishes
//                                        Listening itself on the key's press
//                                        edge, and the main window reports
//                                        every later state through
//                                        subtext_status_set, so this one event
//                                        is the whole state feed.
//   subtext://pill    (main window)   -> amplitudes, live tint and chips, the
//                                        final contract's chips, hands-free,
//                                        the stop warning
//
// CONTRACT.md §2 documents the payloads. The window is focusable:false and
// click-through, and nothing here ever asks for focus.

import { createMachine } from "./state.js";
import { createPill } from "./pill.js";

const TAURI = globalThis.__TAURI__;

const machine = createMachine("idle");
const pill = createPill({ root: document, machine, announce: null });

// Rust status labels -> shell states.
const STATE_OF = Object.freeze({
  Ready: "idle",
  Listening: "listening",
  Thinking: "thinking",
  Delivered: "inserted",
  Failed: "error"
});

// The overlay mirrors; it must never throw on an ordering it did not expect.
// Walk through the legal path instead (listening -> thinking -> inserted).
function drive(next, detail = null) {
  if (machine.state === next) {
    if (detail) machine.to(next, detail);
    return;
  }
  if (next === "inserted" && machine.state !== "thinking") {
    if (machine.state !== "listening") drive("listening");
    machine.to("thinking");
  }
  if (next === "thinking" && machine.state !== "listening") drive("listening");
  if (!machine.can(next)) machine.to("idle");
  if (machine.state !== next) machine.to(next, detail);
}

let lastSeq = 0;

export function applyStatus({ status, detail, seq } = {}) {
  if (Number.isFinite(seq)) {
    if (seq <= lastSeq) return; // CONTRACT §2: drop out-of-order updates
    lastSeq = seq;
  }
  const next = STATE_OF[status] || "idle";
  if (next === "inserted") drive(next, { message: detail || "Inserted" });
  else if (next === "error") drive(next, { message: detail || "Something went wrong." });
  else drive(next);
}

export function applyPill(payload = {}) {
  if (Array.isArray(payload.levels)) {
    for (const level of payload.levels) pill.pushAmplitude(Number(level) || 0);
  } else if (payload.level !== undefined) {
    pill.pushAmplitude(Number(payload.level) || 0);
  }
  if (payload.live && machine.state === "listening") {
    pill.applyLive({ chips: payload.live.chips || [], tint: payload.live.tint ?? null });
  }
  if (payload.contract) pill.showContract(payload.contract);
  if (payload.handsFree !== undefined && machine.state === "listening") pill.setHandsFree(Boolean(payload.handsFree));
  if (payload.warning !== undefined) pill.setWarning(payload.warning || null);
}

if (TAURI?.event?.listen) {
  TAURI.event.listen("subtext://status", (event) => applyStatus(event?.payload || {}));
  TAURI.event.listen("subtext://pill", (event) => applyPill(event?.payload || {}));
}

document.body.dataset.ready = "true";
globalThis.__overlay = { get state() { return machine.state; }, applyStatus, applyPill };
