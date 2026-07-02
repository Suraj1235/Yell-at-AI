// Shared "shell-like" command-line tokenizer: splits a template string (e.g. a
// user-supplied --transcript-command, --clipboard-command, or --paste-command) into
// argv parts, honoring double-quoted segments so a quoted argument containing
// spaces stays a single token. Used by every subsystem that accepts a
// user-supplied command template.
export function parseCommand(value) {
  return String(value).match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, "")) ?? [];
}
