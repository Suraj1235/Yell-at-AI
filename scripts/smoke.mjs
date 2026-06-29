import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const bin = join(root, "bin", "subtext.js");
const audioPath = join(root, "eval", "fixtures", "emphasis.wav");
const text = "can we just refactor the whole auth module";

const jsonOutput = await run("node", [bin, "analyze", "--audio", audioPath, "--text", text]);
const contract = JSON.parse(jsonOutput);
assert.equal(contract.schema, "vocalcontext/v1");
assert.equal(contract.emphasis[0].word.toLowerCase(), "whole");

const promptOutput = await run("node", [bin, "analyze", "--audio", audioPath, "--text", text, "--format", "prompt"]);
assert.match(promptOutput, /<vocal-context/);

const mcp = spawn("node", [bin, "mcp"], { stdio: ["pipe", "pipe", "pipe"] });
let stdout = "";
mcp.stdout.on("data", (chunk) => {
  stdout += chunk.toString("utf8");
});
mcp.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })}\n`);
await waitFor(() => stdout.includes("\"tools\""), 1000);
mcp.kill();
assert.match(stdout, /analyze_file/);
assert.match(stdout, /analyze_audio/);

process.stdout.write("smoke ok\n");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => {
      out += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      err += chunk.toString("utf8");
    });
    child.on("exit", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(err || `${command} exited ${code}`));
    });
  });
}

function waitFor(predicate, timeoutMs) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error("Timed out waiting for smoke condition."));
      }
    }, 20);
  });
}
