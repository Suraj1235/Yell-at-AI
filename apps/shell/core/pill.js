// The floating pill — the centrepiece.
//
// It owns its own geometry through the --pill-* custom properties and reads
// nothing from the page around it, so the same markup and the same module run
// unchanged inside a frameless always-on-top overlay window on the desktop.
//
// Plan gate 4, "never capture silently": the pill is the only thing that turns
// the microphone light on in this UI, and `listening` is the only state in
// which it is not visibly at rest. There is no code path that captures without
// putting the pill in that state.

import { createWaveform } from "./waveform.js";
import { renderChips, chipsFromLive, chipsFromContract } from "./chips.js";

const INSERTED_MS = 600;

export function createPill({ root, machine, announce }) {
  const layer = root.querySelector("#pill-layer");
  const pill = root.querySelector("#pill");
  const message = root.querySelector("#pill-msg");
  const elapsed = root.querySelector("#pill-elapsed");
  const scope = root.querySelector("#pill-scope");
  const chips = root.querySelector("#pill-chips");
  const hit = root.querySelector("#pill-hit");
  const hitLabel = root.querySelector("#pill-hit-label");

  const waveform = createWaveform(scope);
  let timer = 0;
  let startedAt = 0;
  let insertedTimer = 0;
  let idleHint = "Hold to talk";

  const observer = new ResizeObserver(() => waveform.resize());
  observer.observe(scope);

  machine.on(({ state, detail }) => {
    window.clearTimeout(insertedTimer);
    pill.dataset.state = state;
    document.body.dataset.state = state;
    if (state !== "listening") setWarning(null);

    if (state === "listening") {
      // The stage vocabulary is fixed and it is ours. "Listening…" is what the
      // microphone is doing; "Reading delivery…" is what the analyser is doing.
      // Neither of them is "cleaning up", because nothing here edits a word.
      message.textContent = "Listening…";
      hitLabel.textContent = "Stop dictating";
      renderChips(chips, []);
      waveform.clear();
      waveform.start();
      startedAt = performance.now();
      tick();
      announce?.("Listening.");
      return;
    }

    setHandsFree(false);
    pill.style.removeProperty("--live-tint");
    stopTimer();
    waveform.stop();

    if (state === "thinking") {
      message.textContent = "Reading delivery…";
      hitLabel.textContent = "Reading delivery";
      announce?.("Reading delivery.");
    } else if (state === "inserted") {
      message.textContent = detail?.message || "Copied";
      hitLabel.textContent = idleHint;
      announce?.(detail?.message || "Copied.");
      insertedTimer = window.setTimeout(() => {
        if (machine.state === "inserted") machine.to("idle");
      }, INSERTED_MS + 900);
    } else if (state === "error") {
      message.textContent = detail?.message || "Something went wrong.";
      hitLabel.textContent = "Dismiss";
      announce?.(detail?.message || "Something went wrong.");
    } else {
      message.textContent = idleHint;
      hitLabel.textContent = idleHint;
      elapsed.textContent = "0.0s";
      renderChips(chips, []);
      waveform.clear();
    }
  });

  function tick() {
    timer = requestAnimationFrame(tick);
    elapsed.textContent = `${((performance.now() - startedAt) / 1000).toFixed(1)}s`;
  }

  function stopTimer() {
    if (timer) cancelAnimationFrame(timer);
    timer = 0;
  }

  function setHandsFree(on) {
    if (on) pill.dataset.mode = "hands-free";
    else delete pill.dataset.mode;
    if (on) hitLabel.textContent = "Stop dictating";
  }

  function setWarning(text) {
    if (text) {
      pill.dataset.warn = "true";
      warn.textContent = text;
      warn.hidden = false;
    } else {
      delete pill.dataset.warn;
      warn.hidden = true;
      warn.textContent = "";
    }
  }

  const warn = root.querySelector("#pill-warn");

  return {
    element: pill,
    hit,
    waveform,

    setIdleHint(text) {
      idleHint = text;
      if (machine.state === "idle") {
        message.textContent = text;
        hitLabel.textContent = text;
      }
    },

    // "Only while active" hides the resting mark. The pill still exists, still
    // takes focus, and still shows every state that is not idle — what goes
    // away is the thing sitting on your screen when nothing is happening.
    setVisibility(mode) {
      layer.dataset.visibility = mode === "active" ? "active" : "always";
    },

    setHandsFree,
    setWarning,

    // One arriving audio frame: draw it at the tint currently in force.
    pushAmplitude(amp) {
      waveform.push(amp);
    },

    // The live reader moved. Tint is null when there is no baseline to be a
    // z-score against, in which case level alone drives the bar height and the
    // colour stays cool.
    //
    // The same number also warms the pill's own rim. The waveform is where the
    // evidence is, but the rim is what you see out of the corner of your eye
    // while you are looking at the thing you are dictating into — which is
    // where you actually are.
    applyLive({ chips: live, tint }) {
      if (tint != null) {
        waveform.setTint(tint);
        pill.style.setProperty("--live-tint", tint.toFixed(3));
      }
      renderChips(chips, chipsFromLive(live));
    },

    showContract(contract) {
      renderChips(chips, chipsFromContract(contract));
    },

    clearChips() {
      renderChips(chips, []);
    },

    destroy() {
      observer.disconnect();
      stopTimer();
      waveform.stop();
    }
  };
}
