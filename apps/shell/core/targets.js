// Per-app insertion rules.
//
// The block this product writes is for an AI to read. Pasting the full
// <vocal-context> evidence into Claude, Cursor, VS Code, ChatGPT or a terminal
// running an agent is the point; pasting it into a Slack message or an email
// to a person is noise. So the words go in verbatim everywhere, and the
// evidence rides along only where an assistant will read it.
//
// Two rules, one for each kind of app, each of which can be:
//   block  the full vocal-context block (your words, then the evidence)
//   text   your words, exactly as transcribed, and nothing else
//   ask    paste nothing; put the block on the clipboard and say so, so you
//          choose where it goes. The overlay never takes focus, so "ask" is a
//          clipboard handover rather than a dialog in front of your work.
//
// Classification is by the focused app's executable name first and its window
// title second. A browser is only an AI app when the title names one — Chrome
// on claude.ai is, Chrome on your bank is not. Unknown means "other".

export const RULES = Object.freeze(["block", "text", "ask"]);

export const RULE_DEFAULTS = Object.freeze({ ai: "block", other: "text" });

// Executables that are an AI surface whatever they are showing.
const AI_PROCESSES = [
  /^claude(\.exe)?$/i,
  /^chatgpt(\.exe)?$/i,
  /^cursor(\.exe)?$/i,
  /^code(\.exe)?$/i,            // VS Code
  /^code - insiders(\.exe)?$/i,
  /^codium(\.exe)?$/i,
  /^windsurf(\.exe)?$/i,
  /^zed(\.exe)?$/i,
  // Terminals: where Claude Code, Codex and friends run.
  /^windowsterminal(\.exe)?$/i,
  /^wt(\.exe)?$/i,
  /^powershell(\.exe)?$/i,
  /^pwsh(\.exe)?$/i,
  /^cmd(\.exe)?$/i,
  /^conhost(\.exe)?$/i,
  /^openconsole(\.exe)?$/i,
  /^mintty(\.exe)?$/i,
  /^alacritty(\.exe)?$/i,
  /^wezterm(-gui)?(\.exe)?$/i,
  /^kitty$/i,
  /^iterm2?$/i,
  /^terminal$/i,
  /^warp(\.exe)?$/i,
  /^ghostty(\.exe)?$/i
];

// Window titles that name an AI surface, for apps (mostly browsers) that can
// show anything.
const AI_TITLES = [
  /\bclaude\b/i,
  /\bchatgpt\b/i,
  /\bcursor\b/i,
  /visual studio code/i,
  /\bgemini\b/i,
  /\bcopilot\b/i,
  /\bperplexity\b/i,
  /\bcodex\b/i
];

// Returns "ai" | "other" for a { title, process } from the host, or null when
// the host could not say what is focused.
export function classifyTarget(target) {
  if (!target) return null;
  const process = String(target.process || "").trim();
  const title = String(target.title || "").trim();
  if (!process && !title) return null;
  if (process && AI_PROCESSES.some((pattern) => pattern.test(process))) return "ai";
  if (title && AI_TITLES.some((pattern) => pattern.test(title))) return "ai";
  return "other";
}

// Decide what to hand over. `settings` carries insertAi / insertOther.
// With no target information at all, the AI rule applies: the block is the
// product, and the web build (which can never see the focused app) has always
// copied it.
export function resolveInsertion({ target, settings = {} }) {
  const kind = classifyTarget(target) ?? "ai";
  const pick = (value, fallback) => (RULES.includes(value) ? value : fallback);
  const rule = kind === "ai"
    ? pick(settings.insertAi, RULE_DEFAULTS.ai)
    : pick(settings.insertOther, RULE_DEFAULTS.other);
  return { kind, rule, label: targetLabel(target) };
}

// A short human name for history and toasts: "Code.exe", or the title.
export function targetLabel(target) {
  if (!target) return null;
  const process = String(target.process || "").replace(/\.exe$/i, "").trim();
  if (process) return process;
  const title = String(target.title || "").trim();
  return title ? title.slice(0, 60) : null;
}
