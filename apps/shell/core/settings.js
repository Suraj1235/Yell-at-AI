// Settings.
//
// Only engines this build can actually run are listed. Offering `whisper-wasm`
// or a cloud key here while neither is wired would put a claim in the UI that
// the product cannot keep, which is the one thing the launch plan says must
// never happen. They arrive when they work.
//
// Choosing an engine repaints the badge immediately, before any capture, so the
// egress statement and the active engine can never be a step apart.

import { ENGINES } from "./engine.js";
import { BINDINGS } from "./hotkey.js";

export const DEFAULTS = Object.freeze({
  engine: "webspeech",
  mic: "",
  verbosity: "full",
  hotkey: "ctrl-alt-y",
  live: "on"
});

export function createSettings({ root, store, platform, onChange, onRecalibrate }) {
  const form = root.querySelector("#settings-form");
  const engine = root.querySelector("#set-engine");
  const engineNote = root.querySelector("#set-engine-note");
  const mic = root.querySelector("#set-mic");
  const verbosity = root.querySelector("#set-verbosity");
  const hotkey = root.querySelector("#set-hotkey");
  const live = root.querySelector("#set-live");
  const baselineNote = root.querySelector("#baseline-note");
  const recalibrate = root.querySelector("#recalibrate");

  let values = { ...DEFAULTS };

  hotkey.replaceChildren(
    ...BINDINGS.map((binding) => new Option(`Hold ${binding.label}`, binding.id))
  );

  recalibrate.addEventListener("click", () => onRecalibrate?.());

  form.addEventListener("change", async () => {
    values = await store.saveSettings({
      engine: engine.value,
      mic: mic.value,
      verbosity: verbosity.value,
      hotkey: hotkey.value,
      live: live.value
    });
    describeEngine();
    onChange?.(values);
  });

  function describeEngine() {
    const active = ENGINES[engine.value];
    engineNote.textContent = active
      ? `${active.description} Prosody analysis stays on this device whichever engine you pick.`
      : "No audio is sent to anyone for recognition. You type the words, and the prosody is read " +
        "from your recording on this device.";
  }

  async function load(capabilities) {
    values = { ...DEFAULTS, ...(await store.getSettings()) };

    const available = capabilities.engines;
    if (!available.includes(values.engine)) values.engine = available[0];
    engine.replaceChildren(
      ...available.map((id) => new Option(ENGINES[id] ? ENGINES[id].label : "None — I type the words", id))
    );

    engine.value = values.engine;
    verbosity.value = values.verbosity;
    hotkey.value = values.hotkey;
    live.value = values.live;
    describeEngine();

    await loadDevices();
    return values;
  }

  async function loadDevices() {
    const devices = await platform.devices().catch(() => []);
    mic.replaceChildren(
      new Option("System default", ""),
      ...devices.map((device) => new Option(device.label, device.id))
    );
    mic.value = devices.some((device) => device.id === values.mic) ? values.mic : "";
  }

  function showBaseline(baseline, source, usable) {
    if (!baseline) {
      baselineNote.textContent =
        "Not calibrated yet. A live chip is a z-score, and a z-score needs something to be measured " +
        "against, so the chips stay off until you calibrate.";
      return;
    }
    const measured = `${baseline.samples} measured segment${baseline.samples === 1 ? "" : "s"}`;
    if (!usable) {
      baselineNote.textContent =
        `Only ${measured}, which is not enough spread to turn into a z-score. Calibrate again, or ` +
        "dictate a few turns and it fills in.";
      return;
    }
    baselineNote.textContent =
      source === "calibration"
        ? `Calibrated from ${measured} of your own voice. Emphasis is measured against you, not against an average stranger.`
        : `Learned from ${measured} of your own turns. Calibrating gives it a cleaner reference.`;
  }

  return { load, loadDevices, showBaseline, get values() { return values; } };
}
