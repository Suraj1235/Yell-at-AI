import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const runner = join(root, "eval", "llm-judge", "run.mjs");
const outDir = join(root, "eval", "llm-judge", "out");

test("LLM judge dry-run writes a bounded prompt pack without provider calls", async () => {
  const stdout = await run("node", [runner, "--dry-run", "--max-cases", "2"]);
  const result = JSON.parse(stdout);

  assert.equal(result.mode, "dry-run");
  assert.equal(result.cases, 2);
  const lines = (await readFile(join(outDir, "prompt-pack.jsonl"), "utf8")).trim().split("\n");
  assert.equal(lines.length, 2);
  const row = JSON.parse(lines[0]);
  assert.equal(typeof row.with_context_prompt, "string");
  assert.ok(Array.isArray(row.expected_signal));
});

test("LLM judge mock provider writes an offline report", async () => {
  const stdout = await run("node", [runner, "--provider", "mock", "--max-cases", "2"]);
  const result = JSON.parse(stdout);
  const report = JSON.parse(await readFile(join(outDir, "judge-report.json"), "utf8"));

  assert.equal(result.provider, "mock");
  assert.equal(report.schema, "subtext/llm-judge-report/v1");
  assert.equal(report.summary.cases, 2);
  assert.equal(report.summary.passed, 2);
  assert.equal(report.controls.paidRunExplicitlyAllowed, false);
  assert.match(await readFile(join(outDir, "judge-report.md"), "utf8"), /LLM Judge Report/);
});

test("LLM judge paid providers require explicit opt-in before credentials", async () => {
  await assert.rejects(
    run("node", [runner, "--provider", "openai", "--max-cases", "1"], {
      env: { ...process.env, OPENAI_API_KEY: "" }
    }),
    /can cost money/
  );
});

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"]
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
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || stdout || `${command} exited ${code}`));
    });
  });
}
