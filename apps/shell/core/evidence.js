// The evidence card.
//
// This is the difference between this product and a dictation app, made
// visible. A transcript on its own is what everyone ships. What we hand back
// is the transcript PLUS the measurement, and the measurement is attached to
// the thing it was measured on:
//
//   - the word you leaned on is marked inside your own sentence, with its
//     z-score sitting on it, not in a legend somewhere below;
//   - every chip carries the number it came from;
//   - one line says what your assistant is being told to do about it;
//   - the provenance line says what the reading was measured against and how
//     the word was located, because "emphasis on 'whole'" means something
//     different when the word positions are estimated than when they come from
//     real timings. Saying which is the whole point of inspectable evidence.
//
// The raw block is not gone — it is one click away, and it is what actually
// travels. This card is a reading of it, never a replacement for it.
//
// Typography carries the split: the serif is YOUR WORDS and the mono is what
// the machine measured. A stressed word keeps the serif and gains a mono
// number. The two materials never blend, because the two kinds of claim never
// blend either.

import { tokenizeWords } from "./engine.js";
import { renderReadout } from "./chips.js";

export function createEvidence(root) {
  const card = root.querySelector("#turn");
  const quote = root.querySelector("#turn-text");
  const readout = root.querySelector("#turn-readout");
  const guidance = root.querySelector("#turn-guidance");
  const provenance = root.querySelector("#turn-provenance");
  const delivery = root.querySelector("#turn-delivery");
  const block = root.querySelector("#turn-block");
  const toggle = root.querySelector("#toggle-block");

  toggle.addEventListener("click", () => setBlockOpen(block.hidden));

  function setBlockOpen(open) {
    block.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.textContent = open ? "Hide the raw block" : "Show the raw block";
  }

  return {
    element: card,
    get blockText() {
      return block.textContent;
    },

    render({ text, contract, blockText }) {
      quote.replaceChildren(...markStress(text, contract));
      renderReadout(readout, contract);
      renderGuidance(guidance, contract);
      renderProvenance(provenance, contract);
      renderDelivery(delivery, contract);
      block.textContent = blockText;
      setBlockOpen(false);
      card.hidden = false;
      // Re-trigger the one animation in the card: the stress rule drawing
      // itself under the word. It answers the user's release, so it is motion
      // that reports a result rather than decoration.
      card.classList.remove("is-fresh");
      void card.offsetWidth;
      card.classList.add("is-fresh");
    }
  };
}

/* ── the sentence, with the stress marked in place ─────────────────────── */

// Returns DOM nodes for the transcript with each emphasised word wrapped.
//
// The engine's word_features array is one entry per token, in order, produced
// by the same tokenizer imported here — so an emphasis entry is located by its
// start time in that array, and the index maps straight onto the token in the
// text on screen. If either side is missing (a contract from an older build, a
// hand-typed transcript) it degrades to the first matching word, and if that
// fails too the sentence renders plain. A wrong word marked is worse than no
// word marked.
export function markStress(text, contract) {
  const emphasis = (contract?.emphasis || []).filter((entry) => entry && entry.word);
  if (!emphasis.length) return [text];

  const tokens = tokenizeWords(text);
  const features = contract?.word_features || [];
  const marks = new Map();

  for (const entry of emphasis) {
    let index = -1;
    if (features.length === tokens.length && entry.start != null) {
      index = features.findIndex((feature) => Math.abs(feature.start - entry.start) < 1e-6);
    }
    if (index < 0 || !tokens[index]) {
      const want = String(entry.word).toLowerCase();
      index = tokens.findIndex((token, at) => token.normalized === want && !marks.has(at));
    }
    if (index < 0 || !tokens[index]) continue;
    if (tokens[index].normalized !== String(entry.word).toLowerCase()) continue;
    marks.set(index, entry);
  }

  if (!marks.size) return [text];

  const nodes = [];
  let cursor = 0;
  for (const [index, entry] of [...marks.entries()].sort((a, b) => a[0] - b[0])) {
    const token = tokens[index];
    if (token.startChar > cursor) nodes.push(text.slice(cursor, token.startChar));
    nodes.push(stressNode(token.word, Number(entry.z)));
    cursor = token.endChar;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function stressNode(word, z) {
  const mark = document.createElement("mark");
  mark.className = "stress";
  // 0 → a hairline, 3 → the full weight. The rule under the word is drawn at
  // the strength of the reading, so two marked words in one sentence are
  // visibly not the same claim.
  mark.style.setProperty("--z", String(Math.max(0, Math.min(1, (z - 0.6) / 2.4)).toFixed(3)));

  const body = document.createElement("span");
  body.className = "stress-word";
  body.textContent = word;

  const number = document.createElement("span");
  number.className = "stress-z";
  number.textContent = `z ${z.toFixed(2)}`;

  mark.append(body, number);
  mark.setAttribute("aria-label", `${word}, emphasised, z ${z.toFixed(2)}`);
  return mark;
}

/* ── the one line of guidance ──────────────────────────────────────────── */

function renderGuidance(node, contract) {
  const directive = contract?.assistant_guidance?.directives?.[0];
  const line = directive?.text || contract?.affect?.interpretation;
  if (!line) {
    node.hidden = true;
    return;
  }
  node.hidden = false;
  const label = document.createElement("span");
  label.className = "guidance-label";
  label.textContent = "your assistant is told";
  node.replaceChildren(label, document.createTextNode(line));
}

/* ── what this reading rests on ────────────────────────────────────────── */

function renderProvenance(node, contract) {
  const calibration = contract?.calibration || {};
  const alignment = contract?.alignment || {};
  const rows = [];

  if (calibration.baseline === "personal") {
    rows.push([
      "measured against",
      `you — ${calibration.samples} calibrated segment${calibration.samples === 1 ? "" : "s"}`
    ]);
  } else {
    rows.push(["measured against", "this sentence only — calibrate to be measured against you"]);
  }

  if (alignment.source === "platform_word_timestamps") {
    rows.push(["word positions", `from the engine's timings — confidence ${fixed(alignment.confidence)}`]);
  } else if (alignment.source) {
    rows.push(["word positions", `estimated from duration — confidence ${fixed(alignment.confidence)}`]);
  }

  node.replaceChildren(
    ...rows.flatMap(([term, value]) => {
      const dt = document.createElement("dt");
      dt.textContent = term;
      const dd = document.createElement("dd");
      dd.textContent = value;
      return [dt, dd];
    })
  );
  node.hidden = rows.length === 0;
}

/* ── the six delivery reads ────────────────────────────────────────────── */

function renderDelivery(node, contract) {
  const prosody = contract?.prosody || {};
  const rows = [
    ["rate", prosody.rate],
    ["energy", prosody.energy],
    ["pitch range", prosody.pitch_range],
    ["pauses", prosody.pause_density],
    ["terminal", prosody.terminal_pitch],
    ["voice", prosody.voice_quality]
  ];
  node.replaceChildren(
    ...rows.map(([key, value]) => {
      const wrap = document.createElement("div");
      const dt = document.createElement("dt");
      dt.textContent = key;
      const dd = document.createElement("dd");
      dd.textContent = value ?? "—";
      wrap.append(dt, dd);
      return wrap;
    })
  );
}

const fixed = (value) => Number(value ?? 0).toFixed(2);
