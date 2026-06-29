import { performance } from "node:perf_hooks";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeFile } from "../src/index.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(await readFile(join(root, "eval", "fixtures", "manifest.json"), "utf8"));
const iterations = Number(process.argv.find((arg) => arg.startsWith("--iterations="))?.split("=")[1] ?? 120);
const timings = [];

for (const fixture of manifest) {
  const audioPath = join(root, fixture.audio);
  await analyzeFile(audioPath, fixture.text);
  for (let i = 0; i < iterations; i += 1) {
    const started = performance.now();
    await analyzeFile(audioPath, fixture.text);
    timings.push({ id: fixture.id, ms: performance.now() - started });
  }
}

const values = timings.map((item) => item.ms).sort((a, b) => a - b);
const report = {
  iterationsPerFixture: iterations,
  totalRuns: timings.length,
  p50Ms: percentile(values, 0.5),
  p95Ms: percentile(values, 0.95),
  maxMs: values.at(-1),
  budgetMs: 300
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

if (report.p95Ms > report.budgetMs) {
  process.stderr.write(`Latency budget failed: p95 ${report.p95Ms.toFixed(2)} ms > ${report.budgetMs} ms\n`);
  process.exitCode = 1;
}

function percentile(sorted, q) {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * q) - 1));
  return Number(sorted[index].toFixed(3));
}
