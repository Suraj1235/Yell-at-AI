import assert from "node:assert/strict";
import { spawn } from "node:child_process";

// Verify the publishable tarball without actually publishing.
// `npm pack --dry-run --json` reports exactly what would ship; we assert the
// entrypoints are present and the file list is non-empty, then print a summary.
const result = await run("npm", ["pack", "--dry-run", "--json"]);
const pack = JSON.parse(result.stdout)[0];
const files = new Set(pack.files.map((file) => file.path));

const requiredFiles = ["bin/subtext.js", "src/index.js"];
for (const file of requiredFiles) {
  assert.ok(files.has(file), `package is missing ${file}`);
}

assert.ok(pack.files.length > 0, "package dry-run reported zero files");

const sizeKb = (pack.size / 1024).toFixed(1);
process.stdout.write(
  `OK ${pack.name}@${pack.version} - ${pack.files.length} files, ${sizeKb} kB packed\n`
);

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32"
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("exit", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || `${command} exited ${code}`));
    });
  });
}
