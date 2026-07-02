// Command STT adapter: run an external host transcript command and parse its
// output into a transcript envelope. This generalizes the CLI's historic
// `--transcript-command` mechanism: it substitutes the {audio}/{audioPath}/{turn}
// placeholders, spawns the command, and parses stdout as plain text or a
// transcript envelope (via parseTranscriptPayload from ../transcript/envelope.js).
//
// The spawn runner is injectable so the adapter is testable offline without a
// real child process.
import { spawn } from "node:child_process";
import { parseTranscriptPayload } from "../transcript/envelope.js";
import { parseCommand } from "../util/command.js";

// Default runner: spawn the command, collect stdout, resolve with raw stdout on
// exit 0, otherwise reject with stderr (or a generic exit-code error). This is a
// byte-for-byte port of the CLI's original runTranscriptCommand spawn logic.
export function spawnRunner(command, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), {
      stdio: ["ignore", "pipe", "pipe"],
      ...options.spawn
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `${command[0]} exited ${code}`));
    });
  });
}

// Run a host transcript command template and return a transcript envelope:
// { schema, text, source, confidence?, language?, wordTimings? }. The envelope's
// wordTimings are the adapter contract's `words`.
//
// opts:
//   command:     the command template string (e.g. "host-transcript {audio}")
//   replacements: placeholder values, e.g. { audio, audioPath, turn }
//   overrides:   transcript envelope overrides (source/confidence/language/...)
//   runner:      async (commandParts) => rawStdout   (injectable; default spawnRunner)
export async function transcribeWithCommand(opts = {}) {
  const { command: commandTemplate, replacements = {}, overrides = {}, runner = spawnRunner } = opts;
  const command = parseCommand(commandTemplate)
    .map((part) => replaceTranscriptPlaceholders(part, replacements));
  if (!command.length) throw new Error("--transcript-command was empty.");

  const raw = String(await runner(command)).trim();
  return parseTranscriptPayload(raw, overrides);
}

export function replaceTranscriptPlaceholders(value, replacements) {
  return String(value).replace(/\{(audio|audioPath|turn)\}/g, (_, key) => replacements[key] ?? "");
}

export { parseCommand };
