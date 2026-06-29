import { spawn } from "node:child_process";
import { copyToClipboard } from "./clipboard.js";

export async function pasteIntoActiveApp(text, options = {}) {
  const clipboard = await copyToClipboard(text, options.clipboardCommand);
  const command = options.pasteCommand
    ? parseCommand(options.pasteCommand)
    : defaultPasteCommand();

  if (!command.length) {
    throw new Error("No active-app paste command found. Use --target clipboard or provide --paste-command.");
  }

  await runCommand(command);
  return {
    clipboard,
    paste: {
      command: command[0],
      args: command.slice(1)
    }
  };
}

function defaultPasteCommand() {
  if (process.platform === "darwin") {
    return [
      "osascript",
      "-e",
      "tell application \"System Events\" to keystroke \"v\" using command down"
    ];
  }

  if (process.platform === "win32") {
    return [
      "powershell",
      "-NoProfile",
      "-Command",
      "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')"
    ];
  }

  return [["xdotool", "key", "ctrl+v"], ["wtype", "-M", "ctrl", "v", "-m", "ctrl"]]
    .find((command) => command);
}

function parseCommand(value) {
  return String(value).match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, "")) ?? [];
}

function runCommand(command) {
  return new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `${command[0]} exited ${code}`));
    });
  });
}
