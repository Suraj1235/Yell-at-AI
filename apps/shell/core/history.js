// History — the last 100 turns, in this browser only.
//
// A turn keeps the words, the contract, how long you spoke and when. It does
// not keep the audio: nothing here needs it after the read, and a log of
// recordings is a liability nobody asked for.
//
// Rendered as a ledger rather than a grid of cards. These are entries in a
// record, they are read newest-first down a single rule, and the coloured rail
// on the left is the dominant flag, so you can find "the time I was shouting"
// by scanning one edge.

import { chipsFromContract } from "./chips.js";

const RAIL_ORDER = ["yelling", "urgency", "emphasis", "tension", "confusion", "uncertainty", "hesitation"];

export function createHistory({ root, store, platform, announce }) {
  const list = root.querySelector("#ledger");
  const empty = root.querySelector("#history-empty");
  const clearAll = root.querySelector("#history-clear");

  clearAll.addEventListener("click", async () => {
    const turns = await store.listTurns();
    if (!turns.length) return;
    if (!window.confirm(`Delete all ${turns.length} turns? This can't be undone.`)) return;
    await store.clearTurns();
    announce?.("History deleted.");
    await refresh();
  });

  async function refresh() {
    const turns = await store.listTurns();
    empty.hidden = turns.length > 0;
    clearAll.hidden = turns.length === 0;
    list.replaceChildren(...turns.map(render));
  }

  function render(turn) {
    const item = document.createElement("li");
    item.dataset.lead = leadFlag(turn.contract);

    const text = document.createElement("p");
    text.className = "entry-text";
    text.textContent = turn.text || "(no transcript)";

    const meta = document.createElement("span");
    meta.className = "entry-meta";
    meta.textContent = `${formatTime(turn.at)} · ${Number(turn.durationSec || 0).toFixed(1)}s`;

    const readout = document.createElement("div");
    readout.className = "entry-readout";
    readout.append(...chipsFromContract(turn.contract));

    const actions = document.createElement("div");
    actions.className = "entry-actions";
    actions.append(
      actionButton("Copy text", async (button) => {
        await platform.insert(turn.text);
        flash(button, "Copied");
      }),
      actionButton("Copy block", async (button) => {
        await platform.insert(turn.block || turn.text);
        flash(button, "Copied");
      }),
      actionButton("Delete", async () => {
        await store.deleteTurn(turn.id);
        announce?.("Turn deleted.");
        await refresh();
      })
    );

    item.append(text, meta, readout, actions);
    return item;
  }

  return { refresh };
}

function actionButton(label, run) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn-quiet";
  button.textContent = label;
  button.addEventListener("click", () => run(button));
  return button;
}

function flash(button, label) {
  const original = button.textContent;
  button.textContent = label;
  button.classList.add("is-done");
  window.setTimeout(() => {
    button.textContent = original;
    button.classList.remove("is-done");
  }, 1400);
}

function leadFlag(contract) {
  const types = new Set((contract?.flags || []).map((flag) => flag.type));
  return RAIL_ORDER.find((type) => types.has(type)) || "";
}

function formatTime(at) {
  const date = new Date(at);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return sameDay ? time : `${date.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}
