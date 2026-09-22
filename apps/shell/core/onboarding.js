// Onboarding: permission, key, calibration, first turn.
//
// Calibration is the step that earns its place. Everything this product claims
// is a comparison — "you leaned on that word" only means anything against how
// you usually say words — so without a baseline the numbers are measured
// against nobody. One neutral sentence is enough to start, and the app keeps
// refining it from your real turns afterwards.
//
// The sentence is deliberately dull. It is a statement of fact with no stressed
// word, a mix of long and short vowels, and nothing in it that would make a
// person perform.

const CALIBRATION_LINE = "The meeting is scheduled for Thursday at four.";
const CALIBRATION_SECONDS = 4;

export function createOnboarding({ root, store, platform, bindings, recordOnce, onBinding, onDone, onTurn }) {
  const panel = root.querySelector("#onboard");
  const rail = root.querySelector("#onboard-rail");
  const title = root.querySelector("#onboard-title");
  const body = root.querySelector("#onboard-body");
  const slot = root.querySelector("#onboard-slot");
  const status = root.querySelector("#onboard-status");
  const next = root.querySelector("#onboard-next");
  const skip = root.querySelector("#onboard-skip");

  let index = 0;
  let chosenBinding = bindings[0];
  let finished = false;
  let unsubscribeTurn = null;

  const steps = [
    {
      id: "permission",
      title: "Let the microphone through",
      body:
        "Yell@AI reads how you said something, so it needs to hear it. The browser will ask once. " +
        "The reading itself happens in this page, on this device.",
      cta: "Allow microphone",
      async run() {
        status.textContent = "waiting for the browser prompt…";
        try {
          const session = await platform.capture({});
          session.cancel();
          status.textContent = "microphone ready";
          return true;
        } catch (error) {
          status.textContent = error.message;
          return false;
        }
      }
    },
    {
      id: "hotkey",
      title: "Pick the key you'll hold",
      body:
        "Hold it, say your piece, let go. It never fires while you're typing in a text box, and " +
        "Escape always cancels without inserting anything.",
      cta: "Use this key",
      mount() {
        const group = document.createElement("div");
        group.className = "hotkey-choices";
        for (const binding of bindings) {
          const choice = document.createElement("button");
          choice.type = "button";
          choice.className = "hotkey-choice";
          choice.setAttribute("aria-pressed", String(binding.id === chosenBinding.id));
          const label = document.createElement("span");
          label.textContent = binding.label;
          const note = document.createElement("span");
          note.className = "mono";
          note.textContent = binding.id === "ctrl-alt-y" ? "same as the desktop app" : "alternative";
          choice.append(label, note);
          choice.addEventListener("click", () => {
            chosenBinding = binding;
            for (const other of group.children) other.setAttribute("aria-pressed", "false");
            choice.setAttribute("aria-pressed", "true");
            onBinding?.(binding);
          });
          group.append(choice);
        }
        slot.append(group);
      },
      async run() {
        await store.saveSettings({ hotkey: chosenBinding.id });
        onBinding?.(chosenBinding);
        return true;
      }
    },
    {
      id: "calibrate",
      title: "Say one flat sentence",
      body:
        "This is what makes the readings yours. Say the line below the way you'd read a train " +
        "timetable — no performance — and every later reading is measured against it.",
      cta: "Record the line",
      mount() {
        const line = document.createElement("p");
        line.className = "calib-line";
        line.textContent = CALIBRATION_LINE;
        slot.append(line);
      },
      async run() {
        status.textContent = `recording ${CALIBRATION_SECONDS}s — read the line now`;
        try {
          const take = await recordOnce(CALIBRATION_SECONDS, (remaining) => {
            status.textContent = `recording — ${remaining.toFixed(1)}s left`;
          });
          const { baselineFromTake, usableBaseline } = await import("./baseline.js");
          const baseline = baselineFromTake({
            samples: take.samples,
            sampleRate: take.sampleRate,
            text: CALIBRATION_LINE
          });
          await store.saveBaseline("calibration", baseline);
          status.textContent = usableBaseline(baseline)
            ? `baseline stored from ${baseline.samples} segments — energy ${baseline.energy.mean.toFixed(4)} ± ${baseline.energy.stdev.toFixed(4)}, rate ${baseline.rate.mean.toFixed(2)} words/s`
            : "only one usable segment, so live chips stay off until you have dictated a few turns";
          return true;
        } catch (error) {
          status.textContent = `${error.message} You can calibrate later from Settings.`;
          return false;
        }
      }
    },
    {
      id: "test",
      title: "Now mean something",
      body: "",
      cta: "Done",
      mount() {
        body.textContent =
          `Hold ${chosenBinding.label} and say a sentence where one word matters more than the ` +
          "others. Watch the waveform warm up on that word.";
        status.textContent = "waiting for your first turn…";
        unsubscribeTurn = onTurn?.((turn) => {
          const flags = (turn.contract?.flags || []).map((flag) => flag.type).join(", ");
          status.textContent = flags
            ? `read: ${flags}`
            : "read: neutral delivery — nothing stood out, which is also an answer";
          next.disabled = false;
        });
        next.disabled = true;
      },
      async run() {
        return true;
      }
    }
  ];

  next.addEventListener("click", async () => {
    const step = steps[index];
    next.disabled = true;
    const ok = await step.run();
    next.disabled = false;
    // A failed permission or calibration is a path, not a dead end: the user
    // can move on and the app degrades honestly.
    if (!ok && step.id === "permission") {
      next.textContent = "Continue anyway";
      step.cta = "Continue anyway";
      if (step.retried) advance();
      step.retried = true;
      return;
    }
    advance();
  });

  skip.addEventListener("click", () => finish());

  function advance() {
    if (index >= steps.length - 1) {
      finish();
      return;
    }
    index += 1;
    paint();
  }

  function paint() {
    const step = steps[index];
    for (const item of rail.children) {
      const stepIndex = steps.findIndex((candidate) => candidate.id === item.dataset.step);
      item.dataset.done = String(stepIndex < index);
      if (stepIndex === index) item.setAttribute("aria-current", "step");
      else item.removeAttribute("aria-current");
    }
    title.textContent = step.title;
    body.textContent = step.body;
    status.textContent = "";
    slot.replaceChildren();
    next.textContent = step.cta;
    next.disabled = false;
    step.mount?.();
    next.focus();
  }

  function finish() {
    if (finished) return;
    finished = true;
    unsubscribeTurn?.();
    panel.hidden = true;
    store.saveSettings({ onboarded: true });
    onDone?.(chosenBinding);
  }

  return {
    async start(binding) {
      chosenBinding = binding || bindings[0];
      finished = false;
      index = 0;
      panel.hidden = false;
      paint();
    },
    get open() {
      return !panel.hidden;
    }
  };
}
