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
//
// Three rules the whole flow follows:
//
//   Show, don't promise. The microphone step does not say "microphone ready";
//   it opens the microphone and moves a row of bars with your voice, and you
//   decide whether it works. The first-turn step does not describe the
//   gesture; it lights the three beats of it as you perform them.
//
//   Every step is skippable, individually and as a whole. A setup screen that
//   traps someone at a permission dialog they have already dismissed is a
//   support ticket, so the dismissed-permission case gets its own recovery
//   text rather than a dead end.
//
//   Say the two things that are true of us and not of the alternatives — no
//   account and no word limit, and that your words go through verbatim — once,
//   plainly, where they can be checked. The privacy half comes from the engine
//   registry (see badge.js) so it is true of the engine actually selected.

import { privacyLine } from "./badge.js";
import { rmsOf } from "./live.js";

const CALIBRATION_LINE = "The meeting is scheduled for Thursday at four.";
const CALIBRATION_SECONDS = 4;
const TEST_LINE = "make the whole thing simpler";
const LEVEL_BARS = 18;

export function createOnboarding({
  root,
  store,
  platform,
  capabilities,
  bindings,
  recordOnce,
  onBinding,
  onDone,
  onTurn,
  onState,
  engineNow
}) {
  const panel = root.querySelector("#onboard");
  const rail = root.querySelector("#onboard-rail");
  const title = root.querySelector("#onboard-title");
  const body = root.querySelector("#onboard-body");
  const claim = root.querySelector("#onboard-claim");
  const slot = root.querySelector("#onboard-slot");
  const status = root.querySelector("#onboard-status");
  const next = root.querySelector("#onboard-next");
  const skip = root.querySelector("#onboard-skip");
  const skipStep = root.querySelector("#onboard-skip-step");

  let index = 0;
  let chosenBinding = bindings[0];
  let finished = false;
  let unsubscribeTurn = null;
  let unsubscribeState = null;

  /* ── the live level meter ─────────────────────────────────────────────
     A row of bars fed from the same RMS the waveform uses. It is here so the
     permission step can be checked rather than believed: if the bars move,
     the microphone works, and no amount of "ready" text is worth as much. */
  let meter = null;

  function startMeter(target) {
    const bars = [...target.querySelectorAll("i")];
    const levels = new Array(bars.length).fill(0);
    let latest = 0;
    let raf = 0;
    let peak = 0.02;

    const paint = () => {
      raf = requestAnimationFrame(paint);
      levels.shift();
      levels.push(latest);
      peak = Math.max(latest, peak * 0.995, 0.02);
      for (const [i, bar] of bars.entries()) {
        bar.style.setProperty("--h", Math.min(1, levels[i] / peak).toFixed(3));
      }
    };
    paint();

    return {
      push: (frame) => { latest = rmsOf(frame); },
      stop: () => cancelAnimationFrame(raf)
    };
  }

  async function stopMeter() {
    meter?.view.stop();
    meter?.session.cancel();
    meter = null;
  }

  /* ── the three beats of a first turn ──────────────────────────────── */
  let beats = null;

  function markBeat(at, state) {
    if (!beats) return;
    for (const [i, node] of beats.entries()) {
      node.dataset.state = i < at ? "done" : i === at ? state : "waiting";
    }
  }

  const steps = [
    {
      id: "permission",
      title: "Let the microphone through",
      body:
        "Yell@AI reads how you said something, so it needs to hear it. The browser will ask once, " +
        "and you can watch the level move before you go any further.",
      claim: () => privacyLine({ canCapture: capabilities?.capture !== false, engine: engineNow?.() }),
      cta: "Allow microphone",
      mount() {
        const meterNode = document.createElement("div");
        meterNode.className = "levels";
        meterNode.id = "onboard-levels";
        meterNode.setAttribute("aria-hidden", "true");
        // At rest before permission, so the thing that is about to move is
        // already on screen rather than appearing from nowhere.
        for (let i = 0; i < LEVEL_BARS; i += 1) meterNode.append(document.createElement("i"));
        slot.append(meterNode);
      },
      async run() {
        // Second press: the bars have already proved the point.
        if (meter) {
          await stopMeter();
          return true;
        }
        status.textContent = "waiting for the browser prompt…";
        try {
          const target = root.querySelector("#onboard-levels");
          const view = startMeter(target);
          const session = await platform.capture({ onSamples: (frame) => view.push(frame) });
          meter = { session, view };
          target.dataset.live = "true";
          status.textContent = "the microphone is open — say something and watch the level move";
          next.textContent = "Continue";
          return false;
        } catch (error) {
          status.textContent = error.message;
          recover();
          return false;
        }
      }
    },
    {
      id: "hotkey",
      title: "Pick the key you'll hold",
      body:
        "Hold it, say your piece, let go. Double-tap it to keep recording hands-free. It never " +
        "fires while you're typing in a text box, and Escape always cancels without inserting anything.",
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
      claim: () =>
        "Your words go through verbatim. We add evidence beside them — which word you leaned on, " +
        "and by how much — and we never rewrite them.",
      cta: "Done",
      mount() {
        body.textContent =
          "Three beats. Watch the waveform warm up on the word you lean on, and the block that " +
          "lands underneath will name it.";

        const guide = document.createElement("ol");
        guide.className = "beats";
        beats = [];

        const one = beatNode("Press and hold", keyNodes(chosenBinding));
        const two = beatNode("Say it, and lean on one word", quoteNode(TEST_LINE));
        const three = beatNode("Let go", null);
        for (const node of [one, two, three]) {
          guide.append(node);
          beats.push(node);
        }
        slot.append(guide);
        markBeat(0, "now");

        status.textContent = "waiting for your first turn…";
        next.disabled = true;

        unsubscribeState = onState?.(({ state }) => {
          if (state === "listening") markBeat(1, "now");
          else if (state === "thinking") markBeat(2, "now");
        });

        unsubscribeTurn = onTurn?.((turn) => {
          markBeat(3, "done");
          const emphasis = turn.contract?.emphasis?.[0];
          const flags = (turn.contract?.flags || []).map((flag) => flag.type).join(", ");
          status.textContent = emphasis
            ? `read: emphasis on “${emphasis.word}”, z ${Number(emphasis.z).toFixed(2)}${flags ? ` — ${flags}` : ""}`
            : flags
              ? `read: ${flags}`
              : "read: neutral delivery — nothing stood out, which is also an answer";
          next.disabled = false;
        });
      },
      async run() {
        return true;
      }
    }
  ];

  // The dismissed-permission recovery path. The browser remembers a refusal,
  // so trying again without changing anything produces the same refusal and no
  // prompt — which reads as the app being broken. Say where the switch is.
  function recover() {
    if (root.querySelector("#onboard-recover")) return;
    const box = document.createElement("div");
    box.id = "onboard-recover";
    box.className = "recover";
    const heading = document.createElement("strong");
    heading.textContent = "If you dismissed the prompt, the browser remembers";
    const how = document.createElement("p");
    how.textContent =
      "Open the padlock or microphone icon at the left of the address bar, set Microphone to " +
      "Allow, then reload this page and choose Try again. You can also skip this step: the app " +
      "still opens, and it will ask again the first time you hold the key.";
    box.append(heading, how);
    slot.append(box);
    next.textContent = "Try again";
  }

  next.addEventListener("click", async () => {
    const step = steps[index];
    next.disabled = true;
    const ok = await step.run();
    next.disabled = false;
    if (ok) advance();
  });

  skip.addEventListener("click", () => finish());
  skipStep.addEventListener("click", () => {
    status.textContent = "";
    advance();
  });

  function advance() {
    stopMeter();
    unsubscribeState?.();
    unsubscribeState = null;
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
    beats = null;

    const line = step.claim?.();
    claim.textContent = line || "";
    claim.hidden = !line;

    next.textContent = step.cta;
    next.disabled = false;
    skipStep.textContent = index === steps.length - 1 ? "Skip the practice" : "Skip this step";
    step.mount?.();
    next.focus();
  }

  function finish() {
    if (finished) return;
    finished = true;
    stopMeter();
    unsubscribeTurn?.();
    unsubscribeState?.();
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

/* ── small builders ──────────────────────────────────────────────────── */

function beatNode(label, extra) {
  const item = document.createElement("li");
  item.className = "beat";
  item.dataset.state = "waiting";
  const text = document.createElement("span");
  text.className = "beat-label";
  text.textContent = label;
  item.append(text);
  if (extra) item.append(extra);
  return item;
}

// The exact keys, drawn as keys. A first-run screen that spells the binding in
// prose is asking you to translate it before you can follow it.
function keyNodes(binding) {
  const wrap = document.createElement("span");
  wrap.className = "beat-keys";
  for (const key of binding.label.split(" + ")) {
    const kbd = document.createElement("kbd");
    kbd.className = "key";
    kbd.textContent = key;
    wrap.append(kbd);
  }
  return wrap;
}

function quoteNode(text) {
  const quote = document.createElement("span");
  quote.className = "beat-quote";
  quote.textContent = `“${text}”`;
  return quote;
}
