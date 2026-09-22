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
  const pill = root.querySelector("#pill");
  const lamp = root.querySelector(".pill-lamp");
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

    if (state === "listening") {
      message.textContent = "Listening";
      hitLabel.textContent = "Stop dictating";
      renderChips(chips, []);
      waveform.clear();
      waveform.start();
      startedAt = performance.now();
      tick();
      announce?.("Listening.");
      return;
    }

    stopTimer();
    waveform.stop();

    if (state === "thinking") {
      message.textContent = "Reading the delivery";
      hitLabel.textContent = "Reading the delivery";
      announce?.("Reading the delivery.");
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

    // One arriving audio frame: draw it at the tint currently in force.
    pushAmplitude(amp) {
      waveform.push(amp);
    },

    // The live reader moved. Tint is null when there is no baseline to be a
    // z-score against, in which case level alone drives the bar height and the
    // colour stays cool.
    applyLive({ chips: live, tint }) {
      if (tint != null) waveform.setTint(tint);
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
