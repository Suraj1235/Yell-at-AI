import { access, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listEngines, getEngine } from "../transcribe/engines.js";
import { resolveWhisperBinary, resolveWhisperModel } from "../transcribe/whisper.js";
import { findRecorderOnPath } from "../capture/recorder.js";
import { listModels, modelDirectory } from "../transcribe/models.js";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const SCHEMA = "subtext/harness-doctor/v1";

const CHECKS = {
  cli: [
    file("CLI entrypoint", "bin/subtext.js"),
    file("Analyzer core", "src/contract/analyzer.js")
  ],
  http: [
    file("HTTP server", "src/server/http.js"),
    file("Web preview HTML", "ui/web-preview/index.html")
  ],
  "web-preview": [
    file("Preview HTML", "ui/web-preview/index.html"),
    file("Preview app script", "ui/web-preview/app.js"),
    file("Preview styles", "ui/web-preview/style.css")
  ],
  "desktop-capture": [
    file("Desktop recorder", "src/capture/recorder.js"),
    file("Desktop capture docs", "docs/DESKTOP_CAPTURE.md")
  ],
  mcp: [
    textFile("MCP server", "src/server/mcp.js", (value) => (
      value.includes("analyze_file")
        && value.includes("analyze_audio")
        && value.includes("audioBase64")
        && value.includes("subtext/transcript/v1")
    ))
  ],
  codex: [
    jsonFile("Codex MCP config", "adapters/codex/mcp.config.example.json", (value) => (
      value.mcpServers?.subtext?.command === "node"
        && Array.isArray(value.mcpServers.subtext.args)
        && value.mcpServers.subtext.args.includes("mcp")
    ))
  ],
  "claude-code": [
    textFile("Claude hook", "adapters/claude-code/hooks/user-prompt-submit.mjs", (value) => (
      value.includes("subtext/transcript/v1")
        && value.includes("transcriptPath")
        && value.includes("--transcript")
    )),
    file("Claude Subtext skill", "adapters/claude-code/subtext-skill/SKILL.md")
  ],
  realtime: [
    file("Realtime steering guide", "adapters/realtime/README.md")
  ],
  vscode: [
    jsonFile("VS Code manifest", "adapters/vscode/package.json", (value) => {
      const commands = new Set(value.contributes?.commands?.map((command) => command.command) ?? []);
      return value.main === "./extension.cjs"
        && commands.has("subtext.copyEnrichedPrompt")
        && commands.has("subtext.insertEnrichedPrompt")
        && commands.has("subtext.previewEnrichedPrompt");
    }),
    file("VS Code extension host", "adapters/vscode/extension.cjs"),
    file("VS Code runner", "adapters/vscode/runner.cjs")
  ],
  hotkey: [
    file("Hotkey adapter docs", "adapters/hotkey/README.md"),
    textFile("Hammerspoon hotkey template", "adapters/hotkey/hammerspoon-subtext.lua", (value) => (
      value.includes("hs.hotkey.bind")
        && value.includes("subtext_cli")
        && value.includes("ptt")
        && value.includes("--target")
    ))
  ],
  "native-desktop": [
    jsonFile("Tauri desktop config", "apps/desktop/src-tauri/tauri.conf.json", (value) => (
      value.productName === "Subtext Desktop"
        && value.identifier === "ai.subtext.desktop"
        && value.build?.frontendDist === "../src"
        && value.app?.withGlobalTauri === true
    )),
    textFile("Desktop Rust bridge", "apps/desktop/src-tauri/src/main.rs", (value) => (
      value.includes("#[tauri::command]")
        && value.includes("subtext_load_config")
        && value.includes("subtext_session")
        && value.includes("subtext/desktop-config/v1")
        && value.includes("--transcript-command")
        && value.includes("SUBTEXT_CLI_PATH")
    )),
    file("Desktop scaffold docs", "docs/NATIVE_DESKTOP.md")
  ],
  universal: [
    file("Clipboard handoff module", "src/handoff/clipboard.js"),
    file("Active-app paste module", "src/handoff/paste.js"),
    file("Universal adapter docs", "adapters/universal/README.md")
  ]
};

export async function runHarnessDoctor(options = {}) {
  const root = options.root ? resolve(options.root) : ROOT;
  const catalog = JSON.parse(await readFile(join(root, "adapters", "harnesses.json"), "utf8"));
  const selected = options.harness
    ? catalog.filter((harness) => harness.id === options.harness)
    : catalog;

  if (options.harness && selected.length === 0) {
    throw new Error(`Unknown harness: ${options.harness}`);
  }

  const harnesses = [];
  for (const harness of selected) {
    const checks = [];
    for (const check of CHECKS[harness.id] ?? []) {
      checks.push(await check(root));
    }

    const ready = checks.length > 0 && checks.every((check) => check.ok);
    harnesses.push({
      id: harness.id,
      name: harness.name,
      tier: harness.tier,
      status: harness.status,
      ready,
      entrypoint: harness.entrypoint,
      surface: harness.surface,
      checks,
      nextStep: nextStep(harness, ready)
    });
  }

  const readyCount = harnesses.filter((harness) => harness.ready).length;
  return {
    schema: SCHEMA,
    ok: harnesses.every((harness) => harness.ready),
    summary: {
      harnesses: harnesses.length,
      ready: readyCount,
      notReady: harnesses.length - readyCount
    },
    harnesses,
    // STT readiness belongs in the report, not only in the text renderer. The
    // machine-readable output is exactly the consumer that needs the
    // machine-readable egress registry: a CI gate or another surface asking
    // "which engines can run here, and which of them send audio off the box"
    // reads --format json. Passing options.env/platform straight through means
    // undefined falls back to the live environment, while a caller (or a test)
    // can pin both.
    stt: checkSttReadiness(options.env, options.platform)
  };
}

export function renderHarnessDoctor(report) {
  const lines = [
    `Subtext harness doctor: ${report.summary.ready}/${report.summary.harnesses} ready`
  ];

  for (const harness of report.harnesses) {
    lines.push("");
    lines.push(`${harness.ready ? "ok" : "missing"} ${harness.id} (${harness.status}, tier ${harness.tier})`);
    lines.push(`  surface: ${harness.surface}`);
    lines.push(`  entrypoint: ${harness.entrypoint}`);
    for (const check of harness.checks) {
      lines.push(`  ${check.ok ? "ok" : "missing"} ${check.name}: ${check.evidence}`);
    }
    lines.push(`  next: ${harness.nextStep}`);
  }

  // Append the STT readiness section so `subtext doctor` reports engine
  // readiness and network egress. Prefer the snapshot the report already
  // carries: recomputing here would render off the live environment even when
  // the report was built against an injected env/platform. The fallback keeps
  // a hand-built report (no `stt` key) renderable.
  lines.push(renderSttReadiness(report.stt ?? checkSttReadiness()));

  return `${lines.join("\n")}\n`;
}

// Report which STT engines can actually run here, and say plainly which ones
// would send audio off the device. This is what `subtext doctor` prints before a
// user commits to an engine. `platform` is injectable (defaults to
// process.platform) so tests can pin it, matching findRecorderOnPath below,
// which resolves recorders differently per platform (e.g. darwin's afrecord is
// checked by a fixed absolute path rather than via PATH).
export function checkSttReadiness(env = process.env, platform = process.platform) {
  const engines = listEngines("node").map((engine) => {
    if (engine.id === "whisper") {
      try {
        const binary = resolveWhisperBinary(env, platform);
        // resolveWhisperModel honours SUBTEXT_WHISPER_MODEL first and falls back
        // to the managed model directory, so this reflects what dictate would
        // actually use.
        const model = resolveWhisperModel(env);
        return {
          id: engine.id,
          egress: engine.egress,
          ready: Boolean(model),
          detail: model
            ? `whisper.cpp at ${binary}, model ${model}`
            : `whisper.cpp at ${binary}, but no model installed. Run: subtext model download base.en --yes`
        };
      } catch (error) {
        return { id: engine.id, egress: engine.egress, ready: false, detail: error.message };
      }
    }

    if (engine.id === "cloud") {
      const key = env.SUBTEXT_CLOUD_API_KEY || env.GROQ_API_KEY || env.DEEPGRAM_API_KEY;
      return {
        id: engine.id,
        egress: engine.egress,
        ready: Boolean(key),
        detail: key
          ? `API key found; audio would be sent to ${engine.vendor}`
          : "no API key set (SUBTEXT_CLOUD_API_KEY, GROQ_API_KEY, or DEEPGRAM_API_KEY)"
      };
    }

    return {
      id: engine.id,
      egress: engine.egress,
      ready: true,
      detail: "available; you supply the command, so its egress is unknown to Subtext"
    };
  });

  const found = findRecorderOnPath(env, platform);
  return {
    engines,
    recorder: {
      ready: Boolean(found),
      detail: found
        ? `${found.name} at ${found.executable}`
        : "no recorder found. Install ffmpeg (https://ffmpeg.org/download.html) or pass --record-command."
    },
    models: listModels(env),
    modelDirectory: modelDirectory(env)
  };
}

// Render the STT section of `subtext doctor`. The egress column is the point of
// this output: a user choosing an engine must be able to see, without reading
// docs, which ones send their audio somewhere.
export function renderSttReadiness(readiness) {
  const lines = ["", "Speech-to-text", ""];

  for (const engine of readiness.engines) {
    const mark = engine.ready ? "ok  " : "--  ";
    const egress =
      engine.egress === "none" ? "[on-device]"
      : engine.egress === "vendor" ? `[sends audio to ${getEngine(engine.id).vendor}]`
      : "[egress unknown]";
    lines.push(`  ${mark}${engine.id.padEnd(10)} ${egress}`);
    lines.push(`      ${engine.detail}`);
  }

  lines.push("");
  lines.push(`  ${readiness.recorder.ready ? "ok  " : "--  "}recorder   ${readiness.recorder.detail}`);
  lines.push(`      models in ${readiness.modelDirectory}`);
  lines.push("");

  return lines.join("\n");
}

function file(name, path) {
  return async (root) => {
    const absolutePath = join(root, path);
    try {
      await access(absolutePath);
      return { name, ok: true, evidence: path };
    } catch {
      return { name, ok: false, evidence: path };
    }
  };
}

function jsonFile(name, path, validate) {
  return async (root) => {
    const absolutePath = join(root, path);
    try {
      const value = JSON.parse(await readFile(absolutePath, "utf8"));
      const ok = validate(value);
      return {
        name,
        ok,
        evidence: ok ? path : `${path} parsed but failed adapter validation`
      };
    } catch (error) {
      return { name, ok: false, evidence: `${path}: ${error.message}` };
    }
  };
}

function textFile(name, path, validate) {
  return async (root) => {
    const absolutePath = join(root, path);
    try {
      const value = await readFile(absolutePath, "utf8");
      const ok = validate(value);
      return {
        name,
        ok,
        evidence: ok ? path : `${path} failed adapter validation`
      };
    } catch (error) {
      return { name, ok: false, evidence: `${path}: ${error.message}` };
    }
  };
}

function nextStep(harness, ready) {
  if (!ready) return "restore the missing adapter files or rerun package validation";
  if (harness.status === "implemented") return "usable locally";
  if (harness.status === "template-tested") return "template is ready locally; package/install for the target host";
  if (harness.status === "steering-template") return "copy the steering guidance into the native audio session";
  return "review harness catalog for integration status";
}
