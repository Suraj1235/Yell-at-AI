import assert from "node:assert/strict";
import { spawn } from "node:child_process";

await run("node", ["scripts/generate-fixtures.mjs"]);
const result = await run("npm", ["pack", "--dry-run", "--json"]);
const pack = JSON.parse(result.stdout)[0];
const files = new Set(pack.files.map((file) => file.path));

const requiredFiles = [
  "bin/subtext.js",
  "src/index.js",
  "src/calibration/profile-store.js",
  "src/calibration/baseline.js",
  "src/capture/recorder.js",
  "src/contract/analyzer.js",
  "src/harness/bundles.js",
  "src/harness/conformance.js",
  "src/handoff/paste.js",
  "src/transcript/envelope.js",
  "schemas/vocalcontext.v1.schema.json",
  "schemas/transcript.v1.schema.json",
  "adapters/codex/mcp.config.example.json",
  "adapters/claude-code/hooks/user-prompt-submit.mjs",
  "adapters/vscode/package.json",
  "adapters/vscode/extension.cjs",
  "adapters/vscode/runner.cjs",
  "adapters/hotkey/README.md",
  "adapters/hotkey/hammerspoon-subtext.lua",
  "apps/desktop/README.md",
  "apps/desktop/src-tauri/tauri.conf.json",
  "apps/desktop/src-tauri/src/main.rs",
  "docs/NATIVE_DESKTOP.md",
  "scripts/validate-desktop-scaffold.mjs",
  "adapters/harnesses.json",
  "scripts/package-adapters.mjs",
  "scripts/harness-conformance.mjs",
  "scripts/release-readiness.mjs",
  "docs/ADAPTER_PACKAGING.md",
  "docs/CALIBRATION.md",
  "docs/DESKTOP_CAPTURE.md",
  "docs/HARNESS_DOCTOR.md",
  "docs/HARNESS_CONFORMANCE.md",
  "docs/HARNESSES.md",
  "docs/NATURAL_SPEECH.md",
  "docs/NATIVE_TRANSCRIPT_BRIDGE.md",
  "docs/PROSODY_STYLE_TOKENS.md",
  "docs/UNIVERSAL_HANDOFF.md",
  "docs/WEB_PREVIEW.md",
  "ui/web-preview/index.html",
  "ui/web-preview/app.js",
  "ui/web-preview/style.css",
  "eval/external/BASELINE.md",
  "eval/external/README.md",
  "eval/external/emotion-cases.json",
  "eval/fixtures/emphasis.wav",
  "eval/fixtures/manifest.json",
  "docs/BLUEPRINT.md",
  "docs/BENCHMARKING.md",
  "docs/assets/subtext-hero.svg",
  "LICENSE",
  "COMMERCIAL-LICENSE.md",
  "CITATION.cff",
  "README.md"
];

for (const file of requiredFiles) {
  assert.ok(files.has(file), `package is missing ${file}`);
}

assert.ok(pack.size > 0, "package dry-run reported empty package");
assert.ok(pack.unpackedSize > pack.size, "package should report unpacked size larger than tarball size");

process.stdout.write(JSON.stringify({
  ok: true,
  name: pack.name,
  version: pack.version,
  files: pack.files.length,
  size: pack.size,
  unpackedSize: pack.unpackedSize
}, null, 2) + "\n");

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
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
