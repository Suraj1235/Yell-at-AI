// Evidence chips.
//
// The product rule, and the reason this is a module rather than three lines of
// template: a chip never carries an adjective on its own. Whatever it claims,
// it prints the number it was read from. A chip that said "frustrated" would be
// the vibe-reading this whole thing exists to replace.

const LABELS = {
  lexical_prosodic_mismatch: "mismatch"
};

export function chipElement({ type, word = null, z = null, conf = null, provisional = false, title = "" }) {
  const chip = document.createElement("span");
  chip.className = `chip chip-${type}`;
  if (provisional) chip.dataset.provisional = "true";
  if (title) chip.title = title;

  const kind = document.createElement("span");
  kind.className = "chip-type";
  kind.textContent = LABELS[type] || type.replace(/_/g, " ");
  chip.append(kind);

  if (word) {
    const target = document.createElement("span");
    target.className = "chip-word";
    target.textContent = `“${word}”`;
    chip.append(target);
  }

  const number = document.createElement("span");
  number.className = "chip-num";
  number.textContent = z != null ? `z ${z.toFixed(2)}` : `conf ${Number(conf ?? 0).toFixed(2)}`;
  chip.append(number);

  return chip;
}

// The authoritative read: flags out of the contract, with the emphasis chip
// upgraded to name the word the engine actually aligned the stress to.
export function chipsFromContract(contract) {
  const strongest = contract?.emphasis?.[0] || null;
  return (contract?.flags || []).map((flag) =>
    chipElement({
      type: flag.type,
      word: flag.type === "emphasis" ? strongest?.word ?? null : null,
      z: flag.type === "emphasis" && strongest ? Number(strongest.z) : null,
      conf: flag.conf,
      title: flag.evidence || ""
    })
  );
}

// The provisional read, from the rolling window. Dashed rail, no word, and a
// tooltip that says which measurement moved.
export function chipsFromLive(items) {
  return items.map((item) =>
    chipElement({
      type: item.type,
      z: item.z,
      provisional: true,
      title: `provisional — ${item.evidence} on the last second of audio`
    })
  );
}

export function renderChips(container, chips) {
  container.replaceChildren(...chips);
}

// "Nothing stood out" is a result, not an absence. Leaving a silent gap where
// the evidence goes reads as a bug; saying so reads as a measurement.
export function renderReadout(container, contract) {
  const chips = chipsFromContract(contract);
  if (chips.length) {
    container.replaceChildren(...chips);
    return;
  }
  const note = document.createElement("p");
  note.className = "readout-empty";
  note.textContent = "Nothing crossed threshold — an even delivery, which is also an answer.";
  container.replaceChildren(note);
}
