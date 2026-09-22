// History — the last 100 turns, in this browser only.
//
// A turn keeps the words, the contract, how long you spoke and when. It does
// not keep the audio: nothing here needs it after the read, and a log of
// recordings is a liability nobody asked for.
//
// Rendered as a ledger rather than a grid of cards. These are entries in a
// record: newest first, grouped under the day they happened, read down a
// single rule, with a coloured rail on the left carrying the dominant flag so
// you can find "the time I was shouting" by scanning one edge.
//
// Three things make it usable rather than merely present:
//   search  — filters on your words and on the flags, because "the one where I
//             sounded uncertain" is how people actually look for a turn;
//   arrows  — up and down move between entries and Enter copies, so the whole
//             log is reachable without a pointer;
//   retry   — a turn whose clipboard write failed is marked as not copied and
//             offers to try again. The words were never at risk; only the
//             handover was, and the failure stays visible until it is fixed.

import { chipsFromContract } from "./chips.js";

const RAIL_ORDER = ["yelling", "urgency", "emphasis", "tension", "confusion", "uncertainty", "hesitation"];

export function createHistory({ root, store, platform, announce }) {
  const list = root.querySelector("#ledger");
  const empty = root.querySelector("#history-empty");
  const clearAll = root.querySelector("#history-clear");
  const search = root.querySelector("#history-search");
  const stats = root.querySelector("#history-stats");
  const count = root.querySelector("#history-count");

  let turns = [];
  let query = "";

  clearAll.addEventListener("click", async () => {
    const all = await store.listTurns();
    if (!all.length) return;
    if (!window.confirm(`Delete all ${all.length} turns? This can't be undone.`)) return;
    await store.clearTurns();
    announce?.("History deleted.");
    await refresh();
  });

  search.addEventListener("input", () => {
    query = search.value.trim().toLowerCase();
    paint();
  });

  // Arrow keys move between entries; Enter copies the words of the focused
  // one. Delegated, so it survives every repaint without rebinding.
  list.addEventListener("keydown", (event) => {
    const entries = [...list.querySelectorAll(".entry")];
    const at = entries.indexOf(event.target.closest(".entry"));
    if (at < 0) return;

    let next = -1;
    if (event.key === "ArrowDown") next = Math.min(entries.length - 1, at + 1);
    else if (event.key === "ArrowUp") next = Math.max(0, at - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = entries.length - 1;
    else if (event.key === "Enter") {
      event.preventDefault();
      entries[at].querySelector(".entry-copy")?.click();
      return;
    } else return;

    event.preventDefault();
    focusEntry(entries, next);
  });

  function focusEntry(entries, index) {
    for (const [i, entry] of entries.entries()) entry.tabIndex = i === index ? 0 : -1;
    entries[index]?.focus();
  }

  async function refresh() {
    turns = await store.listTurns();
    paint();
  }

  function paint() {
    const matching = query ? turns.filter((turn) => matches(turn, query)) : turns;

    empty.hidden = turns.length > 0;
    clearAll.hidden = turns.length === 0;
    search.parentElement.hidden = turns.length === 0;
    stats.hidden = turns.length === 0;
    renderStats(turns);

    count.textContent = query
      ? `${matching.length} of ${turns.length} turn${turns.length === 1 ? "" : "s"} match “${search.value.trim()}”`
      : "";
    count.hidden = !query;

    const nodes = [];
    let day = null;
    for (const turn of matching) {
      const label = dayLabel(turn.at);
      if (label !== day) {
        day = label;
        nodes.push(dayHeading(label));
      }
      nodes.push(renderEntry(turn));
    }
    list.replaceChildren(...nodes);

    const entries = [...list.querySelectorAll(".entry")];
    if (entries.length) entries[0].tabIndex = 0;
  }

  function renderStats(all) {
    const words = all.reduce((sum, turn) => sum + wordCount(turn.text), 0);
    const emphasised = all.filter((turn) => (turn.contract?.emphasis || []).length > 0).length;
    stats.replaceChildren(
      statNode(words.toLocaleString(), words === 1 ? "word dictated" : "words dictated"),
      statNode(String(all.length), all.length === 1 ? "turn" : "turns"),
      statNode(String(emphasised), "with emphasis caught")
    );
  }

  function renderEntry(turn) {
    const item = document.createElement("li");
    item.className = "entry";
    item.tabIndex = -1;
    item.dataset.lead = leadFlag(turn.contract);
    if (turn.delivered === false) item.dataset.failed = "true";

    const text = document.createElement("p");
    text.className = "entry-text";
    text.textContent = turn.text || "(no transcript)";

    const meta = document.createElement("span");
    meta.className = "entry-meta";
    meta.textContent = `${clockTime(turn.at)} · ${Number(turn.durationSec || 0).toFixed(1)}s`;

    const readout = document.createElement("div");
    readout.className = "entry-readout";
    readout.append(...chipsFromContract(turn.contract));

    const actions = document.createElement("div");
    actions.className = "entry-actions";
    const copy = actionButton("Copy text", async (button) => {
      await platform.insert(turn.text);
      flash(button, "Copied");
      announce?.("Copied.");
    });
    copy.classList.add("entry-copy");
    actions.append(
      copy,
      actionButton("Copy block", async (button) => {
        await platform.insert(turn.block || turn.text);
        flash(button, "Copied");
        announce?.("Block copied.");
      }),
      actionButton("Delete", async () => {
        await store.deleteTurn(turn.id);
        announce?.("Turn deleted.");
        await refresh();
      })
    );

    // The chips and the actions share one row, so revealing the actions on
    // hover costs horizontal space rather than making every entry in the log
    // taller than it needs to be.
    const foot = document.createElement("div");
    foot.className = "entry-foot";
    foot.append(readout, actions);

    if (turn.delivered === false) {
      const failed = document.createElement("span");
      failed.className = "entry-failed";
      failed.textContent = "not copied";
      actions.prepend(
        actionButton("Retry", async (button) => {
          const result = await platform.insert(turn.block || turn.text);
          if (!result.ok) {
            flash(button, "Still refused");
            return;
          }
          await store.putTurn({ ...turn, delivered: true });
          announce?.("Copied.");
          await refresh();
        })
      );
      item.append(text, meta, failed, foot);
      return item;
    }

    item.append(text, meta, foot);
    return item;
  }

  return { refresh };
}

function statNode(value, label) {
  const wrap = document.createElement("div");
  const number = document.createElement("strong");
  number.textContent = value;
  const name = document.createElement("span");
  name.textContent = label;
  wrap.append(number, name);
  return wrap;
}

function dayHeading(label) {
  const heading = document.createElement("li");
  heading.className = "day";
  heading.setAttribute("role", "presentation");
  heading.textContent = label;
  return heading;
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

// Search covers the words AND the flags: "the one where I sounded uncertain"
// is how people look for a turn they cannot quote.
function matches(turn, query) {
  if ((turn.text || "").toLowerCase().includes(query)) return true;
  return (turn.contract?.flags || []).some((flag) => flag.type.replace(/_/g, " ").includes(query));
}

function wordCount(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

function leadFlag(contract) {
  const types = new Set((contract?.flags || []).map((flag) => flag.type));
  return RAIL_ORDER.find((type) => types.has(type)) || "";
}

function dayLabel(at) {
  const date = new Date(at);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
}

function clockTime(at) {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
