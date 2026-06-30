export function renderVocalContext(contract, options = {}) {
  const verbosity = options.verbosity ?? "subtle";
  if (verbosity === "raw") return contract.text;

  const emphasis = contract.emphasis.length
    ? contract.emphasis.map((item) => `${escapePromptField(item.word)} z=${item.z}`).join(", ")
    : "none above threshold";

  const delivery = [
    `${contract.prosody.rate} rate`,
    `${contract.prosody.energy} energy`,
    `${contract.prosody.pitch_range} pitch range`,
    `${contract.prosody.pause_density} pause density`,
    `${contract.prosody.terminal_pitch} terminal pitch`,
    `${contract.prosody.voice_quality} voice quality`
  ].join(", ");

  const flags = contract.flags.length
    ? contract.flags.map((flag) => `${flag.type} (${flag.conf}): ${escapePromptField(flag.evidence)}`).join("; ")
    : "none";
  const affect = contract.affect
    ? `${contract.affect.emotional_coloring} (${contract.affect.confidence}): ${escapePromptField(contract.affect.interpretation)}`
    : "unspecified";
  const guidance = renderGuidance(contract.assistant_guidance);
  const alignment = contract.alignment
    ? `${contract.alignment.source} confidence=${contract.alignment.confidence} matched=${contract.alignment.matched_words}/${contract.alignment.total_words}`
    : "unspecified";
  const transcript = contract.transcript
    ? `${escapePromptField(contract.transcript.source)} word_timestamps=${contract.transcript.word_timestamps}`
    : "unspecified";

  if (verbosity === "full") {
    return [
      `<vocal-context schema="${contract.schema}">`,
      `Text: ${escapePromptField(contract.text)}`,
      `Transcript: ${transcript}`,
      `Emphasis: ${emphasis}`,
      `Delivery: ${delivery}`,
      `Affect: ${affect}`,
      `Guidance: ${guidance}`,
      `Flags: ${flags}`,
      `Alignment: ${alignment}`,
      `Calibration: ${contract.calibration.baseline}, samples=${contract.calibration.samples}`,
      "</vocal-context>",
      "",
      contract.text
    ].join("\n");
  }

  return [
    `<vocal-context schema="${contract.schema}">`,
    `Emphasis: ${emphasis}`,
    `Delivery: ${delivery}`,
    `Affect: ${affect}`,
    `Guidance: ${guidance}`,
    `Flags: ${flags}`,
    "</vocal-context>",
    "",
    contract.text
  ].join("\n");
}

function renderGuidance(guidance) {
  if (!guidance) return "unspecified";
  const directives = Array.isArray(guidance.directives) && guidance.directives.length
    ? guidance.directives.map((directive) => escapePromptField(directive.text)).join("; ")
    : "none";
  return `${escapePromptField(guidance.priority)}/${escapePromptField(guidance.response_style)}: ${directives}`;
}

function escapePromptField(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\s+/g, " ")
    .trim();
}
