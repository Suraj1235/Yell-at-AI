import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeFile, renderVocalContext } from "../../src/index.js";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const outDir = join(root, "eval", "llm-judge", "out");

const args = parseArgs(process.argv.slice(2));
const manifest = JSON.parse(await readFile(join(root, "eval", "fixtures", "manifest.json"), "utf8"));
await mkdir(outDir, { recursive: true });

const allRows = await buildPromptRows(manifest);
const rows = allRows.slice(0, Number(args["max-cases"] ?? allRows.length));
await writeFile(join(outDir, "prompt-pack.jsonl"), rows.map((row) => JSON.stringify(row)).join("\n") + "\n");

if (args["dry-run"] || !args.provider) {
  process.stdout.write(JSON.stringify({
    mode: "dry-run",
    cases: rows.length,
    promptPack: "eval/llm-judge/out/prompt-pack.jsonl",
    note: "Use this JSONL with your host LLM judge or run with --provider openai --allow-paid to execute a gated provider eval."
  }, null, 2) + "\n");
  process.exit(0);
}

const provider = String(args.provider);
const report = await runProviderJudge(rows, {
  provider,
  model: args.model ?? defaultModel(provider),
  allowPaid: Boolean(args["allow-paid"] || process.env.SUBTEXT_ALLOW_PAID_EVAL === "1"),
  maxPromptChars: Number(args["max-prompt-chars"] ?? 24000),
  maxOutputTokens: Number(args["max-output-tokens"] ?? 500)
});

await writeFile(join(outDir, "judge-report.json"), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(join(outDir, "judge-report.md"), renderReportMarkdown(report));
process.stdout.write(JSON.stringify({
  mode: "provider",
  provider: report.provider,
  model: report.model,
  cases: report.summary.cases,
  passed: report.summary.passed,
  passRate: report.summary.passRate,
  report: "eval/llm-judge/out/judge-report.json"
}, null, 2) + "\n");

async function buildPromptRows(items) {
  const rows = [];
  for (const fixture of items) {
    const contract = await analyzeFile(join(root, fixture.audio), fixture.text);
    rows.push({
      id: fixture.id,
      transcript: fixture.text,
      without_context_prompt: [
        "Interpret this coding-assistant request. What intent, urgency, and emotional coloring should the assistant infer?",
        "",
        fixture.text
      ].join("\n"),
      with_context_prompt: [
        "Interpret this coding-assistant request. Use vocal context to understand natural-speech meaning and emotion.",
        "",
        renderVocalContext(contract, { verbosity: "full" })
      ].join("\n"),
      expected_signal: contract.flags.map((flag) => flag.type),
      expected_affect: contract.affect?.emotional_coloring ?? "neutral"
    });
  }
  return rows;
}

async function runProviderJudge(items, options) {
  validateProviderOptions(options);
  const cases = [];

  for (const row of items) {
    const prompt = buildJudgePrompt(row);
    if (prompt.length > options.maxPromptChars) {
      throw new Error(`Judge prompt for ${row.id} exceeds --max-prompt-chars=${options.maxPromptChars}.`);
    }

    const judged = options.provider === "mock"
      ? mockJudge(row)
      : await openAiJudge(prompt, options);
    const normalized = normalizeJudgeResult(row, judged);
    cases.push(normalized);
  }

  const passed = cases.filter((item) => item.passed).length;
  return {
    schema: "subtext/llm-judge-report/v1",
    provider: options.provider,
    model: options.model,
    generatedAt: new Date().toISOString(),
    summary: {
      cases: cases.length,
      passed,
      failed: cases.length - passed,
      passRate: round(passed / Math.max(1, cases.length))
    },
    controls: {
      maxPromptChars: options.maxPromptChars,
      maxOutputTokens: options.maxOutputTokens,
      paidRunExplicitlyAllowed: options.provider === "mock" ? false : options.allowPaid
    },
    cases
  };
}

function validateProviderOptions(options) {
  if (!["mock", "openai"].includes(options.provider)) {
    throw new Error("Unsupported judge provider. Use --provider mock or --provider openai.");
  }
  if (options.provider !== "mock" && !options.allowPaid) {
    throw new Error("Provider execution can cost money. Re-run with --allow-paid or SUBTEXT_ALLOW_PAID_EVAL=1.");
  }
  if (options.provider === "openai" && !process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required for --provider openai.");
  }
  if (!Number.isFinite(options.maxPromptChars) || options.maxPromptChars <= 0) {
    throw new Error("--max-prompt-chars must be a positive number.");
  }
  if (!Number.isFinite(options.maxOutputTokens) || options.maxOutputTokens <= 0) {
    throw new Error("--max-output-tokens must be a positive number.");
  }
}

async function openAiJudge(prompt, options) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: options.model,
      input: prompt,
      max_output_tokens: options.maxOutputTokens
    })
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`OpenAI judge request failed (${response.status}): ${body.error?.message ?? response.statusText}`);
  }

  return parseJudgeJson(extractOutputText(body));
}

function mockJudge(row) {
  const signalCount = row.expected_signal.length;
  const nonNeutralAffect = row.expected_affect && row.expected_affect !== "neutral";
  return {
    expected_signal_detected: signalCount > 0 || nonNeutralAffect,
    context_improved_interpretation: signalCount > 0 || nonNeutralAffect,
    without_context_summary: "Transcript-only interpretation misses or weakens the vocal cue.",
    with_context_summary: `Vocal-context interpretation accounts for ${[...row.expected_signal, row.expected_affect].filter(Boolean).join(", ") || "neutral delivery"}.`,
    score: signalCount > 0 || nonNeutralAffect ? 1 : 0.5,
    rationale: "Deterministic mock judge for offline harness validation."
  };
}

function buildJudgePrompt(row) {
  return [
    "You are judging whether Subtext vocal context helps a coding assistant infer natural-speech meaning and emotion.",
    "Compare the transcript-only interpretation with the vocal-context interpretation.",
    "Return only strict JSON with this shape:",
    "{\"expected_signal_detected\":boolean,\"context_improved_interpretation\":boolean,\"without_context_summary\":string,\"with_context_summary\":string,\"score\":number,\"rationale\":string}",
    "",
    `Case id: ${row.id}`,
    `Expected signal flags: ${row.expected_signal.join(", ") || "none"}`,
    `Expected affect: ${row.expected_affect}`,
    "",
    "Transcript-only prompt:",
    row.without_context_prompt,
    "",
    "Prompt with Subtext vocal context:",
    row.with_context_prompt
  ].join("\n");
}

function normalizeJudgeResult(row, judged) {
  const score = clamp(Number(judged.score ?? 0), 0, 1);
  const expectedSignalDetected = Boolean(judged.expected_signal_detected);
  const contextImproved = Boolean(judged.context_improved_interpretation);
  const passed = contextImproved && (row.expected_signal.length === 0 || expectedSignalDetected);
  return {
    id: row.id,
    expected_signal: row.expected_signal,
    expected_affect: row.expected_affect,
    passed,
    score: round(score),
    expected_signal_detected: expectedSignalDetected,
    context_improved_interpretation: contextImproved,
    without_context_summary: String(judged.without_context_summary ?? ""),
    with_context_summary: String(judged.with_context_summary ?? ""),
    rationale: String(judged.rationale ?? "")
  };
}

function extractOutputText(body) {
  if (typeof body.output_text === "string") return body.output_text;
  const chunks = [];
  for (const item of body.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === "string") chunks.push(content.text);
    }
  }
  const text = chunks.join("\n").trim();
  if (!text) throw new Error("OpenAI judge response did not include output text.");
  return text;
}

function parseJudgeJson(text) {
  const trimmed = String(text).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("Judge response was not parseable JSON.");
  }
}

function renderReportMarkdown(report) {
  const lines = [
    "# LLM Judge Report",
    "",
    `Provider: ${report.provider}`,
    `Model: ${report.model}`,
    `Cases: ${report.summary.cases}`,
    `Pass rate: ${report.summary.passRate}`,
    "",
    "| Case | Pass | Score | Expected | Rationale |",
    "| --- | --- | ---: | --- | --- |"
  ];
  for (const item of report.cases) {
    lines.push(`| ${item.id} | ${item.passed ? "yes" : "no"} | ${item.score} | ${[...item.expected_signal, item.expected_affect].join(", ")} | ${escapeTable(item.rationale)} |`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function defaultModel(provider) {
  return provider === "openai" ? "gpt-4.1-mini" : "mock-judge";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Number((Number.isFinite(value) ? value : 0).toFixed(3));
}

function escapeTable(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}
