// Yell@AI shell — wiring.
//
// The loop, and the order matters:
//   hold  -> pill goes to listening, microphone opens, live reader starts
//   speak -> every audio frame is drawn AND fed to the rolling read
//   let go-> pill goes to thinking, recogniser settles, the engine runs
//   done  -> the block goes where you're working, the turn lands in history
//
// Two rules from the launch plan are load-bearing here and are worth finding
// again in a year:
//   never lose words — if insertion fails, the turn is still on screen and
//     still in history, and the failure is named rather than swallowed;
//   never capture silently — the microphone is opened in exactly one place,
//     immediately after the pill enters `listening`, and closed in exactly one
//     place, and there is no third path.

import platform from "../platform/platform.web.js";
import { renderVocalContext } from "./engine.js";
import { baselineFromTake, mergeBaselines, isBaseline, usableBaseline } from "./baseline.js";
import { createMachine } from "./state.js";
import { createPill } from "./pill.js";
import { createBadge } from "./badge.js";
import { createHistory } from "./history.js";
import { createSettings, DEFAULTS } from "./settings.js";
import { createOnboarding } from "./onboarding.js";
import { createHotkey, bindPillGesture, BINDINGS, getBinding } from "./hotkey.js";
import { createPing } from "./ping.js";
import { createLiveReader, rmsOf } from "./live.js";
import { createEvidence } from "./evidence.js";

const MAX_TURN_SECONDS = 120;

const el = (id) => document.getElementById(id);

boot().catch((error) => {
  const stage = el("stage-error");
  if (stage) {
    stage.hidden = false;
    stage.textContent = `The app didn't start: ${error.message}`;
  }
  console.error(error);
});

async function boot() {
  const root = document;
  const machine = createMachine("idle");
  const announcer = el("announcer");
  const announce = (text) => { announcer.textContent = text; };

  const capabilities = await platform.capabilities();
  const badge = createBadge(root);

  // First paint, before any listener is wired and long before capture is
  // possible: say which engine is active and who receives the audio.
  const store = await platform.store();
  const saved = { ...DEFAULTS, ...(await store.getSettings()) };
  if (!capabilities.engines.includes(saved.engine)) saved.engine = capabilities.engines[0];
  badge.render({ canCapture: capabilities.capture, engine: saved.engine });

  const pill = createPill({ root, machine, announce });
  const turnListeners = new Set();

  /* ── baseline ─────────────────────────────────────────────────────────
     `stored` is whatever is on disk; `baseline` is what is allowed to drive a
     reading. usableBaseline() is the gate between them, and nothing bypasses
     it — see core/baseline.js for why a one-measurement baseline must not. */
  let stored = await store.getBaseline("calibration");
  let baselineSource = isBaseline(stored) ? "calibration" : null;
  if (!baselineSource) {
    const auto = await store.getBaseline("auto");
    if (isBaseline(auto)) {
      stored = auto;
      baselineSource = "auto";
    }
  }
  let baseline = usableBaseline(stored);

  const live = createLiveReader({
    baseline,
    onUpdate: (reading) => {
      if (machine.state !== "listening") return;
      pill.applyLive(reading);
    }
  });

  /* ── settings ───────────────────────────────────────────────────────── */
  const ping = createPing({ enabled: saved.ping !== "off" });

  const settings = createSettings({
    root,
    store,
    platform,
    onChange: (values) => {
      badge.render({ canCapture: capabilities.capture, engine: values.engine });
      hotkey.setBinding(getBinding(values.hotkey));
      ping.setEnabled(values.ping !== "off");
      pill.setVisibility(values.pill);
      applyHint();
    },
    onRecalibrate: () => onboarding.start(getBinding(settings.values.hotkey))
  });
  await settings.load(capabilities);
  pill.setVisibility(saved.pill);
  settings.showBaseline(stored, baselineSource, Boolean(baseline));

  /* ── history ────────────────────────────────────────────────────────── */
  const history = createHistory({ root, store, platform, announce });
  await history.refresh();

  /* ── views ──────────────────────────────────────────────────────────── */
  const tabs = [...root.querySelectorAll(".nav-tab")];
  const views = [...root.querySelectorAll(".view")];
  for (const tab of tabs) {
    tab.addEventListener("click", () => show(tab.dataset.goto));
  }
  function show(name) {
    document.body.dataset.view = name;
    for (const tab of tabs) {
      if (tab.dataset.goto === name) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    }
    for (const view of views) view.hidden = view.dataset.view !== name;
    if (name === "history") history.refresh();
    if (name === "settings") settings.loadDevices();
  }

  /* ── the turn ───────────────────────────────────────────────────────── */
  let capture = null;
  let recogniser = null;
  let lastTake = null;
  let stopAt = 0;

  async function startTurn() {
    if (machine.state === "listening" || machine.state === "thinking") return;
    if (onboarding.open && document.activeElement?.closest?.("#onboard")) return;
    if (!capabilities.capture) {
      fail("This browser can't reach a microphone, so there is nothing to read.");
      return;
    }

    clearError();
    if (!machine.can("listening")) machine.to("idle");
    machine.to("listening");
    live.reset();
    // Before the microphone opens, so the cue marks the gesture rather than
    // the permission round-trip.
    ping.play();

    try {
      capture = await platform.capture({
        deviceId: settings.values.mic || undefined,
        onSamples: (frame, sampleRate) => {
          pill.pushAmplitude(rmsOf(frame));
          if (settings.values.live === "on") live.push(frame, sampleRate);
        }
      });
    } catch (error) {
      capture = null;
      fail(error.message);
      return;
    }

    recogniser = await platform.transcribe({
      engine: settings.values.engine,
      onPartial: () => {}
    });

    stopAt = window.setTimeout(() => {
      if (machine.state === "listening") finishTurn();
    }, MAX_TURN_SECONDS * 1000);
  }

  async function finishTurn() {
    if (machine.state !== "listening" || !capture) return;
    window.clearTimeout(stopAt);
    // However the turn ends — key, pill, auto-stop — hands-free ends with it,
    // or the key and the pill would disagree about whether one is running.
    hotkey.clearLatch();
    machine.to("thinking");

    const take = await capture.stop();
    capture = null;
    const heard = recogniser ? await recogniser.stop() : { text: "", source: "manual", blocked: false };
    recogniser = null;

    if (heard.blocked) badge.blocked();

    if (take.durationSec < 0.35 || take.samples.length < 2048) {
      machine.to("error", { message: "That was too short to read. Hold the key for a full sentence." });
      return;
    }

    lastTake = take;
    if (!heard.text) {
      machine.to("idle");
      askForWords();
      return;
    }

    await completeTurn(take, heard.text, heard.source);
  }

  function cancelTurn() {
    window.clearTimeout(stopAt);
    capture?.cancel();
    recogniser?.cancel();
    capture = null;
    recogniser = null;
    hotkey.clearLatch();
    if (machine.state === "listening" || machine.state === "thinking") machine.to("idle");
    announce("Cancelled. Nothing was inserted.");
  }

  async function completeTurn(take, text, source) {
    let contract;
    try {
      contract = platform.analyze({
        samples: take.samples,
        sampleRate: take.sampleRate,
        text,
        baseline,
        options: { transcriptSource: source, language: navigator.language || undefined }
      });
    } catch (error) {
      // Fail open: the words survive even when the read does not.
      await deliver({ text, block: text, contract: null, durationSec: take.durationSec });
      machine.to("error", { message: `Couldn't read the delivery: ${error.message} The text was still copied.` });
      return;
    }

    const block = renderVocalContext(contract, { verbosity: settings.values.verbosity });
    pill.showContract(contract);
    renderTurn({ text, contract, block });
    await deliver({ text, block, contract, durationSec: take.durationSec });
    await learnBaseline(take, text);
  }

  async function deliver({ text, block, contract, durationSec }) {
    const turn = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: Date.now(),
      text,
      block,
      contract,
      durationSec,
      engine: settings.values.engine
    };

    // History first, insertion second. If insertion is the thing that fails,
    // the words are already safe.
    try {
      await store.putTurn(turn);
    } catch (error) {
      console.warn("history write failed", error);
    }
    for (const listener of turnListeners) listener(turn);

    const result = await platform.insert(block);
    // The label names what actually happened to the words. On the web that is
    // the clipboard; the desktop adapter puts them into the focused app and
    // says "Inserted". Neither word is ever a euphemism for editing them.
    if (machine.state === "thinking") {
      const landed = result.method === "focused-app" ? "Inserted" : "Copied";
      machine.to("inserted", { message: result.ok ? landed : "Saved to history" });
    }
    if (!result.ok) {
      showError("The clipboard refused the write. The block is on screen and in history — copy it from there.");
    }
    if (document.body.dataset.view === "history") history.refresh();
  }

  async function learnBaseline(take, text) {
    // Every finished turn refines the reference the next turn is measured
    // against. Calibration seeds it; real speech keeps it honest.
    try {
      const fresh = baselineFromTake({ samples: take.samples, sampleRate: take.sampleRate, text });
      const previous = await store.getBaseline("auto");
      const merged = isBaseline(previous) ? mergeBaselines(previous, fresh) : fresh;
      await store.saveBaseline("auto", merged);
      if (!baselineSource || baselineSource === "auto") {
        stored = merged;
        baseline = usableBaseline(stored);
        baselineSource = "auto";
        live.setBaseline(baseline);
        settings.showBaseline(stored, baselineSource, Boolean(baseline));
      }
    } catch (error) {
      console.warn("baseline update skipped", error);
    }
  }

  /* ── typed fallback ─────────────────────────────────────────────────── */
  const fallbackForm = el("type-fallback");
  const fallbackText = el("fallback-text");

  function askForWords() {
    fallbackForm.hidden = false;
    fallbackText.focus();
    announce("No words were recognised. Type what you said.");
  }

  fallbackForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = fallbackText.value.trim();
    if (!text || !lastTake) return;
    fallbackForm.hidden = true;
    fallbackText.value = "";
    machine.to("listening");
    machine.to("thinking");
    await completeTurn(lastTake, text, "manual");
  });

  /* ── rendering a finished turn ──────────────────────────────────────── */
  const evidence = createEvidence(root);

  function renderTurn({ text, contract, block }) {
    el("specimen").hidden = true;
    evidence.render({ text, contract, blockText: block });
  }

  const copyButton = el("copy-block");
  copyButton.addEventListener("click", async () => {
    const result = await platform.insert(evidence.blockText);
    el("copy-block-label").textContent = result.ok ? "Copied" : "Press Ctrl+C";
    copyButton.classList.toggle("is-done", result.ok);
    window.setTimeout(() => {
      el("copy-block-label").textContent = "Copy block";
      copyButton.classList.remove("is-done");
    }, 1600);
  });

  /* ── errors ─────────────────────────────────────────────────────────── */
  function fail(message) {
    if (machine.state === "listening" || machine.state === "thinking" || machine.state === "idle") {
      machine.to("error", { message });
    }
    showError(message);
  }
  function showError(message) {
    const stage = el("stage-error");
    stage.hidden = false;
    stage.textContent = message;
  }
  function clearError() {
    el("stage-error").hidden = true;
  }

  pill.hit.addEventListener("click", () => {
    if (machine.state === "error") {
      machine.to("idle");
      clearError();
    }
  });

  /* ── input ──────────────────────────────────────────────────────────── */
  // Opening the microphone is asynchronous; the gesture that ends a turn can
  // arrive before it finishes opening. Every path that ends or changes a turn
  // waits on the same promise first, which is what stops a quick tap from
  // stopping a turn that has not started yet and leaving the microphone open.
  let pendingStart = null;
  const begin = () => { pendingStart = startTurn(); };
  const settled = async () => { try { await pendingStart; } catch { /* startTurn reports its own failures */ } };

  const hotkey = createHotkey({
    binding: getBinding(saved.hotkey),
    onPress: begin,
    onRelease: async () => { await settled(); finishTurn(); },
    onCancel: () => cancelTurn(),
    onLatch: async () => { await settled(); enterHandsFree(); }
  });

  // Hands-free, reached three ways — double-tap the key, click the pill, or
  // press the key once while a click-started turn is running. All three land
  // here so the pill, the key and the announcement can never disagree about
  // whether the microphone is still open.
  function enterHandsFree() {
    if (machine.state !== "listening") return;
    hotkey.latch();
    pill.setHandsFree(true);
    announce(`Hands-free. Press ${getBinding(settings.values.hotkey).label} or click the pill to stop.`);
  }

  bindPillGesture(pill.hit, {
    isActive: () => machine.state === "listening",
    onStart: begin,
    onStop: async () => { await settled(); if (machine.state === "listening") finishTurn(); },
    onHandsFree: async () => { await settled(); enterHandsFree(); }
  });

  function applyHint() {
    pill.setIdleHint(`Hold ${getBinding(settings.values.hotkey).label}`);
    const hint = el("hint-key")?.parentElement;
    if (!hint) return;
    const binding = getBinding(settings.values.hotkey);
    const keys = binding.label.split(" + ");
    const kbd = keys.map((key, index) => {
      const node = document.createElement("kbd");
      node.className = "key";
      if (index === 0) node.id = "hint-key";
      node.textContent = key;
      return node;
    });
    hint.replaceChildren("Hold ", ...kbd, " and say it the way you mean it. Release to read it back.");
  }
  applyHint();

  /* ── onboarding ─────────────────────────────────────────────────────── */
  const onboarding = createOnboarding({
    root,
    store,
    platform,
    bindings: BINDINGS,
    recordOnce,
    onBinding: (binding) => {
      hotkey.setBinding(binding);
      settings.values.hotkey = binding.id;
      applyHint();
    },
    onTurn: (listener) => {
      turnListeners.add(listener);
      return () => turnListeners.delete(listener);
    },
    onDone: async () => {
      const fresh = await store.getBaseline("calibration");
      if (isBaseline(fresh)) {
        stored = fresh;
        baseline = usableBaseline(stored);
        baselineSource = "calibration";
        live.setBaseline(baseline);
        settings.showBaseline(stored, baselineSource, Boolean(baseline));
      }
      applyHint();
    }
  });

  async function recordOnce(seconds, onTick) {
    const session = await platform.capture({
      onSamples: (frame) => pill.pushAmplitude(rmsOf(frame))
    });
    machine.to("listening");
    const started = performance.now();
    await new Promise((resolve) => {
      const tick = () => {
        const left = seconds - (performance.now() - started) / 1000;
        if (left <= 0) { resolve(); return; }
        onTick?.(left);
        setTimeout(tick, 100);
      };
      tick();
    });
    const take = await session.stop();
    machine.to("thinking");
    machine.to("idle");
    return take;
  }

  if (!saved.onboarded) {
    onboarding.start(getBinding(saved.hotkey));
  }

  /* ── PWA ────────────────────────────────────────────────────────────── */
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register(new URL("../sw.js", import.meta.url), { scope: "./" })
      .catch((error) => console.warn("offline shell unavailable", error));
  }

  // A small, deliberately read-only diagnostics surface. The desktop agent
  // wires platform.tauri.js against the same machine, and the headless check
  // asserts against it rather than reaching into module scope.
  globalThis.__shell = {
    get state() { return machine.state; },
    get liveCostMs() { return live.lastCostMs; },
    get liveEnabled() { return live.enabled; },
    get tint() { return pill.waveform.tint; },
    get handsFree() { return hotkey.latched; },
    get pingAudible() { return ping.audible; },
    get settings() { return { ...settings.values }; },
    show,
    startTurn,
    finishTurn,
    cancelTurn
  };

  document.body.dataset.ready = "true";
}
