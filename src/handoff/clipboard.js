import { spawn } from "node:child_process";

export async function copyToClipboard(text, overrideCommand = null) {
  const commands = overrideCommand ? [parseCommand(overrideCommand)] : defaultClipboardCommands();
  if (!commands.length || commands.some((command) => !command.length)) {
    throw new Error("No clipboard command found. Use --target stdout or install pbcopy, clip, wl-copy, xclip, or xsel.");
  }

  const failures = [];
  for (const command of commands) {
    try {
      await writeToCommand(command, text);
      return { command: command[0], args: command.slice(1) };
    } catch (error) {
      failures.push(`${command.join(" ")}: ${error.message}`);
    }
  }

  throw new Error(`No clipboard command succeeded. Tried ${commands.map((command) => command.join(" ")).join(", ")}. ${failures.join(" | ")}`);
}

function defaultClipboardCommands() {
  if (process.platform === "darwin") return [["pbcopy"]];
  if (process.platform === "win32") return [["clip"]];

  const linuxCommands = [
    ["xclip", "-selection", "clipboard"],
    ["xsel", "--clipboard", "--input"]
  ];

  return process.env.WAYLAND_DISPLAY
    ? [["wl-copy"], ...linuxCommands]
    : linuxCommands;
}

function parseCommand(value) {
  return String(value).match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, "")) ?? [];
}

function writeToCommand(command, text) {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `${command[0]} exited ${code}`));
    });
    child.stdin.end(text);
  });
}
