import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runHarnessDoctor } from "./doctor.js";

export const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

export const BUNDLE_FILES = Object.freeze({
  cli: [
    "bin/subtext.js",
    "docs/CONTRACT.md"
  ],
  http: [
    "src/server/http.js",
    "docs/WEB_PREVIEW.md"
  ],
  "web-preview": [
    "ui/web-preview/index.html",
    "ui/web-preview/app.js",
    "ui/web-preview/style.css",
    "docs/WEB_PREVIEW.md"
  ],
  "desktop-capture": [
    "src/capture/recorder.js",
    "docs/DESKTOP_CAPTURE.md"
  ],
  mcp: [
    "src/server/mcp.js",
    "docs/CONTRACT.md"
  ],
  codex: [
    "adapters/codex/README.md",
    "adapters/codex/mcp.config.example.json"
  ],
  "claude-code": [
    "adapters/claude-code/README.md",
    "adapters/claude-code/hooks/user-prompt-submit.mjs",
    "adapters/claude-code/subtext-skill/SKILL.md"
  ],
  realtime: [
    "adapters/realtime/README.md",
    "docs/PROSODY_STYLE_TOKENS.md"
  ],
  vscode: [
    "adapters/vscode/README.md",
    "adapters/vscode/package.json",
    "adapters/vscode/extension.cjs",
    "adapters/vscode/runner.cjs"
  ],
  hotkey: [
    "adapters/hotkey/README.md",
    "adapters/hotkey/hammerspoon-subtext.lua"
  ],
  "native-desktop": [
    "apps/desktop/README.md",
    "apps/desktop/package.json",
    "apps/desktop/src/index.html",
    "apps/desktop/src-tauri/Cargo.toml",
    "apps/desktop/src-tauri/build.rs",
    "apps/desktop/src-tauri/tauri.conf.json",
    "apps/desktop/src-tauri/src/main.rs",
    "docs/NATIVE_DESKTOP.md"
  ],
  universal: [
    "adapters/universal/README.md",
    "docs/UNIVERSAL_HANDOFF.md",
    "src/handoff/clipboard.js",
    "src/handoff/paste.js"
  ]
});

export async function buildAdapterBundles(options = {}) {
  const root = options.root ? resolve(options.root) : ROOT;
  const outRoot = options.outRoot ? resolve(options.outRoot) : join(root, "dist", "adapters");
  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const harnesses = await readHarnessCatalog(root);
  const doctor = await runHarnessDoctor({ root });

  await rm(outRoot, { recursive: true, force: true });
  await mkdir(outRoot, { recursive: true });

  const bundles = [];
  for (const harness of harnesses) {
    const doctorHarness = doctor.harnesses.find((item) => item.id === harness.id);
    const files = BUNDLE_FILES[harness.id] ?? [];
    const bundleDir = join(outRoot, harness.id);
    await mkdir(bundleDir, { recursive: true });

    for (const file of files) {
      await copyPreservingRelativePath(root, bundleDir, file);
    }

    const manifest = adapterBundleManifest({ harness, packageJson, doctorHarness, files });
    await writeFile(join(bundleDir, "bundle.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    bundles.push({
      id: manifest.id,
      status: manifest.status,
      ready: manifest.ready,
      path: relativeDistPath(root, bundleDir),
      files: files.length
    });
  }

  const index = {
    schema: "subtext/adapter-bundles/v1",
    package: packageJson.name,
    version: packageJson.version,
    harnesses: bundles.length,
    ready: bundles.filter((bundle) => bundle.ready).length,
    bundles
  };

  await writeFile(join(outRoot, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
  return index;
}

export async function installAdapter(options = {}) {
  const root = options.root ? resolve(options.root) : ROOT;
  const targetRoot = options.target ? resolve(options.target) : null;
  const harnessId = options.harness;
  if (!harnessId) throw new Error("install-adapter requires --harness <id>.");
  if (!targetRoot) throw new Error("install-adapter requires --target <directory>.");

  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const harnesses = await readHarnessCatalog(root);
  const harness = harnesses.find((item) => item.id === harnessId);
  if (!harness) throw new Error(`Unknown harness: ${harnessId}`);

  const doctor = await runHarnessDoctor({ root, harness: harness.id });
  const doctorHarness = doctor.harnesses[0];
  if (!doctorHarness?.ready) {
    throw new Error(`${harness.id} is not ready. Run subtext doctor --harness ${harness.id}.`);
  }

  const files = BUNDLE_FILES[harness.id] ?? [];
  const generatedFiles = generatedInstallFiles({ harness, root });
  const plannedFiles = [
    ...files.map((file) => ({ kind: "copy", path: file, source: join(root, file), target: join(targetRoot, file) })),
    ...generatedFiles.map((file) => ({ kind: "generate", path: file.path, target: join(targetRoot, file.path), content: file.content }))
  ];

  const conflicts = [];
  if (!options.dryRun && !options.force) {
    for (const file of plannedFiles) {
      if (await exists(file.target)) conflicts.push(file.path);
    }
  }
  if (conflicts.length > 0) {
    throw new Error(`Refusing to overwrite existing adapter files without --force: ${conflicts.join(", ")}`);
  }

  const manifest = {
    ...adapterBundleManifest({ harness, packageJson, doctorHarness, files }),
    schema: "subtext/adapter-install/v1",
    installedAt: new Date().toISOString(),
    target: targetRoot,
    dryRun: Boolean(options.dryRun),
    generatedFiles: generatedFiles.map((file) => file.path),
    nextStep: installNextStep(harness)
  };

  const manifestPath = "subtext-adapter-install.json";
  const manifestTarget = join(targetRoot, manifestPath);
  if (!options.dryRun && !options.force && await exists(manifestTarget)) {
    throw new Error(`Refusing to overwrite existing adapter files without --force: ${manifestPath}`);
  }

  if (!options.dryRun) {
    for (const file of plannedFiles) {
      await mkdir(dirname(file.target), { recursive: true });
      if (file.kind === "copy") {
        await copyFile(file.source, file.target);
      } else {
        await writeFile(file.target, file.content);
      }
    }
    await writeFile(manifestTarget, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  return {
    ...manifest,
    filesInstalled: plannedFiles.length + 1,
    manifestPath
  };
}

export async function readHarnessCatalog(root = ROOT) {
  return JSON.parse(await readFile(join(root, "adapters", "harnesses.json"), "utf8"));
}

export function installHint(harness) {
  if (harness.id === "codex") return "Use mcp.config.generated.json as the concrete Codex MCP server config for this checkout.";
  if (harness.id === "claude-code") return "Install the hook and skill in Claude Code, and set SUBTEXT_CLI_PATH to this checkout's bin/subtext.js.";
  if (harness.id === "vscode") return "Open the copied VS Code adapter folder as an extension host project and apply settings.generated.json.";
  if (harness.id === "hotkey") return "Copy hammerspoon-subtext.generated.lua into ~/.hammerspoon/init.lua or load it from your Hammerspoon config.";
  if (harness.id === "native-desktop") return "Use the Tauri scaffold in apps/desktop as the native desktop launch track; run npm run desktop:check before attempting a signed build.";
  if (harness.id === "universal") return "Use subtext handoff --target clipboard or --target paste to deliver an enriched prompt into any text field.";
  if (harness.id === "desktop-capture") return "Use subtext session --duration 4 --transcript-command \"host-transcript --json {audio}\" to record natural speech and bridge host transcript text plus metadata.";
  if (harness.id === "realtime") return "Paste the steering guidance into the native audio session instructions.";
  return `Use the core package entrypoint: ${harness.entrypoint}`;
}

function adapterBundleManifest({ harness, packageJson, doctorHarness, files }) {
  return {
    schema: "subtext/adapter-bundle/v1",
    id: harness.id,
    name: harness.name,
    version: packageJson.version,
    tier: harness.tier,
    status: harness.status,
    ready: doctorHarness?.ready ?? false,
    entrypoint: harness.entrypoint,
    surface: harness.surface,
    requiresCorePackage: true,
    files,
    checks: doctorHarness?.checks ?? [],
    installHint: installHint(harness)
  };
}

async function copyPreservingRelativePath(root, targetRoot, file) {
  const target = join(targetRoot, file);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(join(root, file), target);
}

function generatedInstallFiles({ harness, root }) {
  const cliPath = join(root, "bin", "subtext.js");
  if (harness.id === "codex") {
    return [{
      path: "adapters/codex/mcp.config.generated.json",
      content: `${JSON.stringify({
        mcpServers: {
          subtext: {
            command: "node",
            args: [cliPath, "mcp"]
          }
        }
      }, null, 2)}\n`
    }];
  }

  if (harness.id === "claude-code") {
    return [{
      path: "adapters/claude-code/subtext.env.example",
      content: `SUBTEXT_CLI_PATH=${cliPath}\nSUBTEXT_VERBOSITY=full\n`
    }];
  }

  if (harness.id === "vscode") {
    return [{
      path: "adapters/vscode/settings.generated.json",
      content: `${JSON.stringify({
        "subtext.cliPath": cliPath,
        "subtext.defaultVerbosity": "full"
      }, null, 2)}\n`
    }];
  }

  if (harness.id === "hotkey") {
    return [{
      path: "adapters/hotkey/hammerspoon-subtext.generated.lua",
      content: generatedHammerspoonConfig({
        cliPath,
        transcriptCommand: "host-transcript --json {audio}",
        duration: "4",
        target: "paste"
      })
    }];
  }

  if (harness.id === "native-desktop") {
    return [{
      path: "apps/desktop/subtext-desktop.generated.json",
      content: `${JSON.stringify({
        schema: "subtext/desktop-config/v1",
        nodeCommand: "node",
        subtextCliPath: cliPath,
        transcriptCommand: "host-transcript --json {audio}",
        duration: 4,
        target: "clipboard",
        verbosity: "full",
        hotkey: {
          enabled: false,
          accelerator: "Cmd+Alt+Ctrl+Y",
          mode: "scaffold"
        }
      }, null, 2)}\n`
    }];
  }

  return [];
}

function installNextStep(harness) {
  if (harness.id === "codex") return "Merge adapters/codex/mcp.config.generated.json into your Codex MCP configuration.";
  if (harness.id === "claude-code") return "Copy adapters/claude-code/hooks/user-prompt-submit.mjs and adapters/claude-code/subtext-skill/SKILL.md into Claude Code, then export SUBTEXT_CLI_PATH.";
  if (harness.id === "vscode") return "Open adapters/vscode as an extension project and apply adapters/vscode/settings.generated.json.";
  if (harness.id === "hotkey") return "Load adapters/hotkey/hammerspoon-subtext.generated.lua from ~/.hammerspoon/init.lua, then reload Hammerspoon.";
  if (harness.id === "native-desktop") return "Open apps/desktop as a Tauri project, apply apps/desktop/subtext-desktop.generated.json, and run npm run desktop:check.";
  return installHint(harness);
}

function generatedHammerspoonConfig({ cliPath, transcriptCommand, duration, target }) {
  return `-- Generated Subtext Hammerspoon global hotkey bridge.
-- Default binding: cmd+alt+ctrl+y

local node = "node"
local subtext_cli = ${JSON.stringify(cliPath)}
local transcript_command = ${JSON.stringify(transcriptCommand)}
local duration = ${JSON.stringify(duration)}
local target = ${JSON.stringify(target)}

local function shell_quote(value)
  local text = tostring(value)
  return "'" .. text:gsub("'", "'\\\\''") .. "'"
end

local function run_subtext_turn()
  local command = table.concat({
    shell_quote(node),
    shell_quote(subtext_cli),
    "ptt",
    "--turns", "1",
    "--trigger", "none",
    "--duration", shell_quote(duration),
    "--transcript-command", shell_quote(transcript_command),
    "--target", shell_quote(target)
  }, " ")

  hs.alert.show("Subtext listening")
  hs.task.new("/bin/sh", function(exit_code, stdout, stderr)
    if exit_code == 0 then
      hs.alert.show("Subtext prompt delivered")
    else
      hs.alert.show("Subtext failed")
      print(stderr or stdout or ("subtext exited " .. tostring(exit_code)))
    end
  end, { "-lc", command }):start()
end

hs.hotkey.bind({ "cmd", "alt", "ctrl" }, "Y", run_subtext_turn)
`;
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function relativeDistPath(root, value) {
  const normalizedRoot = `${resolve(root)}/`;
  const normalizedValue = resolve(value);
  return normalizedValue.startsWith(normalizedRoot)
    ? normalizedValue.slice(normalizedRoot.length)
    : normalizedValue;
}
