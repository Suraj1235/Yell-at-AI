import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeFile } from "../contract/analyzer.js";
import { renderVocalContext } from "../render/text.js";
import { readHarnessCatalog } from "./bundles.js";
import { runHarnessDoctor } from "./doctor.js";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const FIVE_WORD_DIMENSIONS = Object.freeze([
  "duration_frames",
  "log_f0_range",
  "log_f0_median",
  "log_f0_slope",
  "log_energy"
]);

export const TOP_HARNESS_IDS = Object.freeze([
  "cli",
  "http",
  "web-preview",
  "desktop-capture",
  "mcp",
  "codex",
  "claude-code",
  "realtime",
  "vscode",
  "hotkey",
  "native-desktop",
  "universal"
]);

export const NATURAL_SPEECH_CUE_CASES = Object.freeze([
  {
    id: "yelling",
    audio: "eval/fixtures/yelling.wav",
    text: "stop rewriting the whole auth module",
    flag: "yelling",
    priority: "de_escalate",
    responseStyle: "calm",
    directive: "respond_calmly",
    renderedGuidance: "Guidance: de_escalate/calm"
  },
  {
    id: "emphasis",
    audio: "eval/fixtures/emphasis.wav",
    text: "can we just refactor the whole auth module",
    flag: "emphasis",
    priority: "preserve_emphasis",
    responseStyle: "focused",
    directive: "preserve_emphasis",
    renderedGuidance: "Guidance: preserve_emphasis/focused",
    emphasizedWord: "whole"
  },
  {
    id: "confusion",
    audio: "eval/fixtures/confusion.wav",
    text: "wait um i am not sure which auth flow broke?",
    flag: "confusion",
    priority: "clarify",
    responseStyle: "patient",
    directive: "ask_clarifying_question",
    renderedGuidance: "Guidance: clarify/patient"
  }
]);

const HARNESS_POLICIES = Object.freeze({
  cli: policy("local CLI JSON/prompt output", ["audio", "plain transcript", "subtext/transcript/v1"], "renders or returns vocalcontext/v1"),
  http: policy("local HTTP API", ["audioPath", "audioBase64", "subtext/transcript/v1"], "returns JSON or rendered prompt"),
  "web-preview": policy("browser microphone preview", ["browser mic", "manual transcript", "browser SpeechRecognition envelope"], "posts audio plus transcript envelope"),
  "desktop-capture": policy("bounded desktop capture", ["OS recorder", "host transcript command"], "hands off rendered prompt"),
  mcp: policy("MCP-style JSON-RPC", ["audioPath", "audioBase64", "subtext/transcript/v1"], "returns contract or prompt to MCP host"),
  codex: policy("Codex MCP config", ["MCP tool call", "host transcript envelope"], "uses shared MCP contract"),
  "claude-code": policy("Claude Code hook", ["audioPath event", "transcript envelope event"], "rewrites prompt with vocal-context block"),
  realtime: policy("native audio-in steering", ["native audio session"], "steers host to preserve vocalcontext-compatible cues"),
  vscode: policy("VS Code extension template", ["WAV file", "plain transcript", "subtext/transcript/v1"], "inserts/copies/previews rendered prompt"),
  hotkey: policy("local hotkey bridge", ["bounded ptt turn", "host transcript command"], "pastes rendered prompt into active app"),
  "native-desktop": policy("Tauri desktop scaffold", ["desktop config", "bounded session", "host transcript command"], "loads config and runs Subtext session"),
  universal: policy("universal text field handoff", ["WAV file", "desktop session", "ptt loop"], "copies or pastes rendered prompt")
});

export async function runHarnessConformance(options = {}) {
  const root = options.root ? resolve(options.root) : ROOT;
  await ensureCueFixtures(root);
  const catalog = await readHarnessCatalog(root);
  const doctor = await runHarnessDoctor({ root });
  const cueResults = [];

  for (const item of NATURAL_SPEECH_CUE_CASES) {
    cueResults.push(await runCueCase(root, item));
  }

  const catalogIds = new Set(catalog.map((harness) => harness.id));
  const missingTopHarnesses = TOP_HARNESS_IDS.filter((id) => !catalogIds.has(id));
  const harnessResults = catalog.map((harness) => {
    const doctorHarness = doctor.harnesses.find((item) => item.id === harness.id);
    const policy = HARNESS_POLICIES[harness.id];
    const issues = [];
    if (!doctorHarness?.ready) issues.push("harness doctor is not ready");
    if (!policy) issues.push("missing conformance policy");

    return {
      id: harness.id,
      status: harness.status,
      tier: harness.tier,
      ready: Boolean(doctorHarness?.ready),
      conformance: Boolean(policy) && Boolean(doctorHarness?.ready),
      policy: policy ?? null,
      issues
    };
  });

  const policyIds = new Set(Object.keys(HARNESS_POLICIES));
  const policyWithoutCatalog = [...policyIds].filter((id) => !catalogIds.has(id));
  const ok = cueResults.every((result) => result.ok)
    && harnessResults.every((result) => result.conformance)
    && missingTopHarnesses.length === 0
    && policyWithoutCatalog.length === 0;

  return {
    schema: "subtext/harness-conformance/v1",
    ok,
    requirements: {
      naturalSpeechCues: NATURAL_SPEECH_CUE_CASES.map((item) => item.id),
      topHarnesses: TOP_HARNESS_IDS,
      contractSchema: "vocalcontext/v1",
      transcriptSchema: "subtext/transcript/v1",
      wordFeatureDimensions: FIVE_WORD_DIMENSIONS,
      preservedFields: ["affect", "assistant_guidance", "flags", "emphasis", "transcript", "word_features"]
    },
    cues: cueResults,
    harnesses: harnessResults,
    missingTopHarnesses,
    policyWithoutCatalog
  };
}

async function ensureCueFixtures(root) {
  const missing = [];
  for (const item of NATURAL_SPEECH_CUE_CASES) {
    try {
      await access(join(root, item.audio));
    } catch {
      missing.push(item.audio);
    }
  }

  if (!missing.length) return;
  await runNodeScript(root, "scripts/generate-fixtures.mjs");
}

export function renderHarnessConformance(report) {
  const lines = [
    `Subtext harness conformance: ${report.ok ? "ok" : "failed"}`,
    `  cues: ${report.cues.filter((item) => item.ok).length}/${report.cues.length}`,
    `  harnesses: ${report.harnesses.filter((item) => item.conformance).length}/${report.harnesses.length}`
  ];

  if (report.missingTopHarnesses.length) {
    lines.push(`  missing top harnesses: ${report.missingTopHarnesses.join(", ")}`);
  }

  for (const cue of report.cues) {
    lines.push("");
    lines.push(`${cue.ok ? "ok" : "failed"} cue ${cue.id}: ${cue.flag} -> ${cue.guidance.priority}/${cue.guidance.response_style}`);
    if (cue.emphasizedWord) lines.push(`  emphasized: ${cue.emphasizedWord}`);
    if (cue.issues.length) lines.push(`  issues: ${cue.issues.join("; ")}`);
  }

  lines.push("");
  lines.push("Harness policies:");
  for (const harness of report.harnesses) {
    lines.push(`${harness.conformance ? "ok" : "failed"} ${harness.id}: ${harness.policy?.surface ?? "missing policy"}`);
    if (harness.issues.length) lines.push(`  issues: ${harness.issues.join("; ")}`);
  }

  return `${lines.join("\n")}\n`;
}

async function runCueCase(root, item) {
  const audioPath = join(root, item.audio);
  const issues = [];
  const contract = await analyzeFile(audioPath, item.text);
  const prompt = renderVocalContext(contract, { verbosity: "full" });
  const flagTypes = new Set(contract.flags.map((flag) => flag.type));
  const directiveTypes = new Set(contract.assistant_guidance.directives.map((directive) => directive.type));
  const meaningCues = new Set(contract.affect.meaning_cues);
  const missingDimensions = missingWordDimensions(contract);
  const emphasizedWord = contract.emphasis[0]?.word?.toLowerCase() ?? null;

  if (contract.schema !== "vocalcontext/v1") issues.push("missing vocalcontext/v1 schema");
  if (!flagTypes.has(item.flag)) issues.push(`missing ${item.flag} flag`);
  if (!meaningCues.has(item.flag)) issues.push(`missing ${item.flag} meaning cue`);
  if (contract.assistant_guidance.priority !== item.priority) issues.push(`expected priority ${item.priority}`);
  if (contract.assistant_guidance.response_style !== item.responseStyle) issues.push(`expected response_style ${item.responseStyle}`);
  if (!directiveTypes.has(item.directive)) issues.push(`missing directive ${item.directive}`);
  if (!prompt.includes("<vocal-context schema=\"vocalcontext/v1\">")) issues.push("rendered prompt missing vocal-context block");
  if (!prompt.includes(item.renderedGuidance)) issues.push(`rendered prompt missing ${item.renderedGuidance}`);
  if (!prompt.trim().endsWith(item.text)) issues.push("rendered prompt did not preserve transcript text");
  if (missingDimensions.length) issues.push(`missing word feature dimensions: ${missingDimensions.join(", ")}`);
  if (item.emphasizedWord && emphasizedWord !== item.emphasizedWord) {
    issues.push(`expected emphasized word ${item.emphasizedWord}`);
  }

  return {
    id: item.id,
    ok: issues.length === 0,
    audio: item.audio,
    text: item.text,
    flag: item.flag,
    guidance: {
      priority: contract.assistant_guidance.priority,
      response_style: contract.assistant_guidance.response_style,
      directives: contract.assistant_guidance.directives.map((directive) => directive.type)
    },
    affect: contract.affect.emotional_coloring,
    emphasizedWord,
    wordFeatureDimensions: FIVE_WORD_DIMENSIONS,
    renderedPrompt: {
      schema: "vocalcontext/v1",
      includesGuidance: prompt.includes(item.renderedGuidance),
      preservesTranscript: prompt.trim().endsWith(item.text)
    },
    issues
  };
}

function policy(surface, inputs, handoff) {
  return {
    surface,
    inputs,
    handoff,
    mustPreserve: ["vocalcontext/v1", "assistant_guidance", "flags", "affect", "emphasis", "transcript", "word_features"],
    mustNot: ["invent emotion labels", "drop transcript provenance", "silently record audio"]
  };
}

function missingWordDimensions(contract) {
  const firstWord = contract.word_features?.find((item) => item && typeof item.word === "string");
  if (!firstWord) return [...FIVE_WORD_DIMENSIONS];
  return FIVE_WORD_DIMENSIONS.filter((field) => typeof firstWord[field] !== "number");
}

function runNodeScript(root, scriptPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], {
      cwd: root,
      stdio: ["ignore", "ignore", "pipe"]
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `${scriptPath} exited ${code}`));
    });
  });
}
