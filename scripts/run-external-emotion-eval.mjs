// Acted-emotion benchmark, scored ONLY on what the assistant receives.
//
// Each clip is analysed into a vocalcontext/v1 contract and judged on two
// fields of that contract: `affect.emotional_coloring` and `flags`. Nothing the
// harness derives from the raw prosody categories counts. (An earlier version
// passed an angry clip when a harness-only "aroused" signal fired, which was
// true on most neutral clips too, while the contract itself said "subdued".)
//
//   node scripts/run-external-emotion-eval.mjs [--min-pass-rate 0.5] [--holdout]
//
// --holdout refits the uncalibrated vocal-effort and pitch-range cutoffs on two
// corpora, scores the third with the refit values, and rotates. It shows how
// much of the in-sample number is memorised.
import assert from "node:assert/strict";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { buildBaselineFromFiles, extractProsody, readWavFile } from "../src/index.js";
import * as analyzer from "../src/contract/analyzer.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifestPath = join(root, "eval", "external", "emotion-cases.json");
const cacheDir = join(root, "eval", "external", "cache");
const outDir = join(root, "eval", "external", "out");
const args = parseArgs(process.argv.slice(2));
const minPassRate = Number(args["min-pass-rate"] ?? 0);
const downloadOnly = Boolean(args["download-only"]);
const holdout = Boolean(args.holdout);

// ---- The contract vocabulary a case may be scored on -----------------------
// Composite readings are defined from coloring + flags only.
const AROUSED_COLORINGS = new Set(["high_intensity", "urgent", "tense"]);
const AROUSED_FLAGS = new Set(["yelling", "urgency", "tension"]);
const UNCERTAIN_COLORINGS = new Set(["uncertain", "hesitant"]);
const UNCERTAIN_FLAGS = new Set(["hesitation", "confusion", "uncertainty"]);
const STEERING_FLAGS = new Set([...AROUSED_FLAGS, ...UNCERTAIN_FLAGS]);
const COLORINGS = ["neutral", "subdued", "emphatic", "urgent", "uncertain", "hesitant", "tense", "mixed", "high_intensity"];
const FLAGS = ["urgency", "yelling", "confusion", "hesitation", "uncertainty", "tension", "emphasis", "lexical_prosodic_mismatch"];
const CONTRACT_SIGNALS = new Set([
  ...COLORINGS.map((value) => `coloring_${value}`),
  ...FLAGS.map((value) => `flag_${value}`),
  "reads_aroused",
  "reads_subdued",
  "reads_uncertain",
  "reads_neutral",
  "steering_flag"
]);

// The confusion table's columns: what the coloring tells the assistant.
const BUCKETS = ["aroused", "subdued", "uncertain", "neutral", "mixed"];
function bucketOf(coloring) {
  if (AROUSED_COLORINGS.has(coloring)) return "aroused";
  if (coloring === "subdued") return "subdued";
  if (UNCERTAIN_COLORINGS.has(coloring)) return "uncertain";
  if (coloring === "mixed") return "mixed";
  return "neutral"; // neutral, emphatic
}

// Uncalibrated cutoffs the --holdout refit searches over.
const FIT_GRID = {
  vocalEffortHighAlphaDbNoBaseline: range(-12, -2, 1),
  vocalEffortLowAlphaDbNoBaseline: range(-22, -13, 1),
  pitchRangeNarrowSemitonesNoBaseline: range(3, 7, 0.5)
};

await mkdir(cacheDir, { recursive: true });
await mkdir(outDir, { recursive: true });

const cases = JSON.parse(await readFile(manifestPath, "utf8"));
validateManifest(cases);

if (downloadOnly) {
  let downloaded = 0;
  for (const testCase of cases) {
    await ensureAudio(testCase);
    downloaded += 1;
    for (const baselineItem of testCase.baseline ?? []) {
      await ensureAudio(baselineItem);
      downloaded += 1;
    }
  }
  process.stdout.write(JSON.stringify({ ok: true, downloaded, cacheDir }, null, 2) + "\n");
  process.exit(0);
}

// Extract prosody once per clip; every threshold candidate reuses it.
const prepared = [];
for (const testCase of cases) {
  const audioPath = await ensureAudio(testCase);
  const baselineItems = await Promise.all((testCase.baseline ?? []).map(async (baselineItem) => ({
    audioPath: await ensureAudio(baselineItem),
    text: baselineItem.transcript
  })));
  const baseline = baselineItems.length > 0 ? await buildBaselineFromFiles(baselineItems) : null;
  const wav = await readWavFile(audioPath);
  prepared.push({
    testCase,
    audioPath,
    baseline,
    samples: wav.samples,
    sampleRate: wav.sampleRate,
    prosodyResult: extractProsody(wav.samples, wav.sampleRate)
  });
}

const inSample = scoreAll(prepared, null);
const report = {
  generatedAt: new Date().toISOString(),
  scoredOn: "vocalcontext/v1 affect.emotional_coloring + flags only",
  cases: inSample.results.length,
  passed: inSample.passed,
  failed: inSample.results.length - inSample.passed,
  passRate: rate(inSample.passed, inSample.results.length),
  minPassRate,
  labelRules: labelRules(cases),
  confusion: confusionTable(inSample.results),
  perLabel: perLabel(inSample.results),
  caveat: "Acted emotion labels, 25 clips, 3 corpora. A prosody-evidence benchmark for what the assistant is told, not an emotion classifier or psychological assessment.",
  results: inSample.results
};

if (holdout) {
  report.holdout = runHoldout(prepared);
}

await writeFile(join(outDir, "emotion-eval-report.json"), JSON.stringify(report, null, 2) + "\n");
await writeFile(join(outDir, "emotion-eval-report.md"), renderMarkdown(report));

process.stdout.write(JSON.stringify({
  cases: report.cases,
  passed: report.passed,
  failed: report.failed,
  passRate: report.passRate,
  minPassRate,
  perLabel: Object.fromEntries(Object.entries(report.perLabel).map(([label, value]) => [label, `${value.passed}/${value.cases}`])),
  ...(report.holdout ? { holdout: report.holdout.summary } : {}),
  reportJson: "eval/external/out/emotion-eval-report.json",
  reportMarkdown: "eval/external/out/emotion-eval-report.md"
}, null, 2) + "\n");

if (report.passRate < minPassRate) {
  process.stderr.write(`External emotion benchmark below threshold: ${report.passRate} < ${minPassRate}\n`);
  process.exitCode = 1;
}

// ---- scoring ----------------------------------------------------------------

function contractFor(item, thresholds) {
  const options = thresholds ? { thresholds } : {};
  // buildContract reuses the extracted prosody. Engines without it (an older
  // checkout, used to record a "before" baseline) fall back to full analysis.
  if (typeof analyzer.buildContract === "function") {
    return analyzer.buildContract({ prosodyResult: item.prosodyResult, text: item.testCase.transcript, baseline: item.baseline, options });
  }
  assert.ok(!thresholds, "This engine does not support threshold overrides (--holdout).");
  return analyzer.analyzeSamples({ samples: item.samples, sampleRate: item.sampleRate, text: item.testCase.transcript, baseline: item.baseline });
}

function scoreAll(items, thresholds) {
  const results = items.map((item) => scoreCase(item, contractFor(item, thresholds)));
  return { results, passed: results.filter((result) => result.pass).length };
}

function scoreCase(item, contract) {
  const { testCase } = item;
  const signals = contractSignals(contract);
  const matchedAny = (testCase.expectAny ?? []).filter((signal) => signals.includes(signal));
  const matchedAll = (testCase.expectAll ?? []).filter((signal) => signals.includes(signal));
  const forbiddenHits = (testCase.forbid ?? []).filter((signal) => signals.includes(signal));
  const pass = matchedAll.length === (testCase.expectAll ?? []).length
    && (!testCase.expectAny?.length || matchedAny.length > 0)
    && forbiddenHits.length === 0;
  return {
    id: testCase.id,
    source: testCase.source,
    emotion: testCase.emotion,
    transcript: testCase.transcript,
    calibration: item.baseline ? `personal(${item.baseline.samples})` : "utterance",
    pass,
    coloring: contract.affect.emotional_coloring,
    bucket: bucketOf(contract.affect.emotional_coloring),
    flags: contract.flags.map((flag) => flag.type),
    matchedAny,
    matchedAll,
    forbiddenHits,
    expectedAny: testCase.expectAny ?? [],
    expectedAll: testCase.expectAll ?? [],
    forbidden: testCase.forbid ?? [],
    signals,
    // Context for debugging only; never scored.
    prosody: contract.prosody,
    notes: testCase.notes
  };
}

function contractSignals(contract) {
  const coloring = contract.affect.emotional_coloring;
  const flagTypes = contract.flags.map((flag) => flag.type);
  const signals = new Set([`coloring_${coloring}`, ...flagTypes.map((type) => `flag_${type}`)]);
  if (AROUSED_COLORINGS.has(coloring) || flagTypes.some((type) => AROUSED_FLAGS.has(type))) signals.add("reads_aroused");
  if (coloring === "subdued") signals.add("reads_subdued");
  if (UNCERTAIN_COLORINGS.has(coloring) || flagTypes.some((type) => UNCERTAIN_FLAGS.has(type))) signals.add("reads_uncertain");
  if (coloring === "neutral" || coloring === "emphatic") signals.add("reads_neutral");
  if (flagTypes.some((type) => STEERING_FLAGS.has(type))) signals.add("steering_flag");
  return [...signals].sort();
}

function validateManifest(allCases) {
  const rulesByLabel = new Map();
  for (const testCase of allCases) {
    for (const signal of [...(testCase.expectAny ?? []), ...(testCase.expectAll ?? []), ...(testCase.forbid ?? [])]) {
      assert.ok(CONTRACT_SIGNALS.has(signal), `${testCase.id}: "${signal}" is not a contract signal. Score on coloring/flags only.`);
    }
    const rule = JSON.stringify({ any: testCase.expectAny ?? [], all: testCase.expectAll ?? [], forbid: testCase.forbid ?? [] });
    const prior = rulesByLabel.get(testCase.emotion);
    assert.ok(!prior || prior === rule, `${testCase.id}: every "${testCase.emotion}" clip must use the same rule.`);
    rulesByLabel.set(testCase.emotion, rule);
  }
}

function labelRules(allCases) {
  const rules = {};
  for (const testCase of allCases) {
    rules[testCase.emotion] ??= { expectAny: testCase.expectAny ?? [], expectAll: testCase.expectAll ?? [], forbid: testCase.forbid ?? [] };
  }
  return rules;
}

function confusionTable(results) {
  const table = {};
  for (const result of results) {
    table[result.emotion] ??= Object.fromEntries(BUCKETS.map((bucket) => [bucket, 0]));
    table[result.emotion][result.bucket] += 1;
  }
  return table;
}

function perLabel(results) {
  const out = {};
  for (const result of results) {
    out[result.emotion] ??= { cases: 0, passed: 0 };
    out[result.emotion].cases += 1;
    if (result.pass) out[result.emotion].passed += 1;
  }
  return out;
}

// ---- held-out refit ---------------------------------------------------------

function runHoldout(items) {
  const corpora = [...new Set(items.map((item) => item.testCase.source))];
  const combos = cartesian(FIT_GRID);
  const folds = [];
  const heldOutResults = [];

  for (const heldOut of corpora) {
    const train = items.filter((item) => item.testCase.source !== heldOut);
    const test = items.filter((item) => item.testCase.source === heldOut);
    // Every grid point that ties for the most training passes is "optimal".
    // The refit picks the optimal point nearest the per-cutoff median of that
    // set: the centre of the plateau, chosen without looking at the shipped
    // values (a tie-break toward them would leak the in-sample choice).
    const scoredCombos = combos.map((thresholds) => ({ thresholds, passed: scoreAll(train, thresholds).passed }));
    const topPassed = Math.max(...scoredCombos.map((combo) => combo.passed));
    const optimal = scoredCombos.filter((combo) => combo.passed === topPassed);
    const centre = Object.fromEntries(Object.keys(FIT_GRID).map((key) => [key, median(optimal.map((combo) => combo.thresholds[key]))]));
    const best = optimal
      .map((combo) => ({
        ...combo,
        distance: Object.keys(FIT_GRID).reduce((sum, key) => sum + Math.abs(combo.thresholds[key] - centre[key]) / spanOf(FIT_GRID[key]), 0)
      }))
      .sort((a, b) => a.distance - b.distance)[0];
    const optimalRange = Object.fromEntries(Object.keys(FIT_GRID).map((key) => {
      const values = optimal.map((combo) => combo.thresholds[key]);
      return [key, [Math.min(...values), Math.max(...values)]];
    }));
    const scored = scoreAll(test, best.thresholds);
    const shippedOnTest = scoreAll(test, null);
    heldOutResults.push(...scored.results);
    folds.push({
      heldOut,
      trainCases: train.length,
      trainPassed: best.passed,
      fitted: best.thresholds,
      optimalCombos: optimal.length,
      optimalRange,
      testCases: test.length,
      testPassed: scored.passed,
      shippedTestPassed: shippedOnTest.passed,
      testPerLabel: perLabel(scored.results)
    });
  }

  const heldOutPassed = heldOutResults.filter((result) => result.pass).length;
  return {
    grid: Object.fromEntries(Object.entries(FIT_GRID).map(([key, values]) => [key, `${values[0]}..${values.at(-1)}`])),
    shipped: Object.fromEntries(Object.keys(FIT_GRID).map((key) => [key, analyzer.THRESHOLDS[key]])),
    folds,
    confusion: confusionTable(heldOutResults),
    perLabel: perLabel(heldOutResults),
    summary: {
      heldOutPassed,
      cases: heldOutResults.length,
      passRate: rate(heldOutPassed, heldOutResults.length),
      folds: folds.map((fold) => `${fold.heldOut}: ${fold.testPassed}/${fold.testCases} (train ${fold.trainPassed}/${fold.trainCases})`)
    }
  };
}

function cartesian(grid) {
  let combos = [{}];
  for (const [key, values] of Object.entries(grid)) {
    combos = combos.flatMap((combo) => values.map((value) => ({ ...combo, [key]: value })));
  }
  return combos;
}

function range(start, end, step) {
  const values = [];
  for (let value = start; value <= end + 1e-9; value += step) values.push(Number(value.toFixed(3)));
  return values;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function spanOf(values) {
  return Math.max(1e-9, values.at(-1) - values[0]);
}

function rate(passed, total) {
  return Number((passed / Math.max(1, total)).toFixed(3));
}

// ---- report -----------------------------------------------------------------

function renderConfusion(table, perLabelStats) {
  const labels = Object.keys(table).sort();
  return [
    `| Label | ${BUCKETS.join(" | ")} | Pass |`,
    `| --- | ${BUCKETS.map(() => "---").join(" | ")} | --- |`,
    ...labels.map((label) => `| ${label} | ${BUCKETS.map((bucket) => table[label][bucket]).join(" | ")} | ${perLabelStats[label].passed}/${perLabelStats[label].cases} |`)
  ];
}

function renderMarkdown(data) {
  const rows = data.results.map((result) => [
    result.pass ? "PASS" : "MISS",
    result.id,
    result.source,
    result.emotion,
    result.calibration,
    result.coloring,
    result.flags.join(", ") || "none",
    result.forbiddenHits.join(", ") || "none"
  ]);
  const lines = [
    "# External Emotion Benchmark (contract-scored)",
    "",
    `Generated: ${data.generatedAt}`,
    "",
    `Scored on: ${data.scoredOn}.`,
    "",
    `Result: ${data.passed}/${data.cases} clips passed. Pass rate ${data.passRate}.`,
    "",
    "> Acted emotion labels expose whether the contract conveys delivery. This is not an emotion classifier and must not be used as psychological assessment.",
    "",
    "## What the assistant was told, by label",
    "",
    "Columns are the coloring bucket: aroused = tense/urgent/high_intensity, subdued, uncertain = uncertain/hesitant, neutral = neutral/emphatic, mixed.",
    "",
    ...renderConfusion(data.confusion, data.perLabel),
    "",
    "## Label rules",
    "",
    ...Object.entries(data.labelRules).map(([label, rule]) => `- ${label}: ${[
      rule.expectAny.length ? `any of [${rule.expectAny.join(", ")}]` : null,
      rule.expectAll.length ? `all of [${rule.expectAll.join(", ")}]` : null,
      rule.forbid.length ? `forbid [${rule.forbid.join(", ")}]` : null
    ].filter(Boolean).join("; ")}`),
    "",
    "## Cases",
    "",
    "| Result | Case | Source | Label | Calibration | Coloring | Flags | Forbidden hits |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`)
  ];

  if (data.holdout) {
    lines.push(
      "",
      "## Held-out by corpus",
      "",
      `Cutoffs refit on two corpora (grid ${Object.entries(data.holdout.grid).map(([key, value]) => `${key} ${value}`).join(", ")}), scored on the third.`,
      "",
      `Shipped cutoffs: effort high ${data.holdout.shipped.vocalEffortHighAlphaDbNoBaseline} dB, effort low ${data.holdout.shipped.vocalEffortLowAlphaDbNoBaseline} dB, narrow ${data.holdout.shipped.pitchRangeNarrowSemitonesNoBaseline} st. The refit picks the centre of the plateau of grid points tied for the best training score; the ranges show how wide that plateau is.`,
      "",
      "| Held out | Train pass | Refit (effort high / effort low / narrow st) | Optimal range on train | Held-out pass (refit) | Held-out pass (shipped cutoffs) |",
      "| --- | --- | --- | --- | --- | --- |",
      ...data.holdout.folds.map((fold) => `| ${fold.heldOut} | ${fold.trainPassed}/${fold.trainCases} | ${fold.fitted.vocalEffortHighAlphaDbNoBaseline} / ${fold.fitted.vocalEffortLowAlphaDbNoBaseline} / ${fold.fitted.pitchRangeNarrowSemitonesNoBaseline} | ${Object.values(fold.optimalRange).map(([lo, hi]) => (lo === hi ? `${lo}` : `${lo}..${hi}`)).join(" / ")} (${fold.optimalCombos} pts) | ${fold.testPassed}/${fold.testCases} | ${fold.shippedTestPassed}/${fold.testCases} |`),
      "",
      `Held-out total: ${data.holdout.summary.heldOutPassed}/${data.holdout.summary.cases} (${data.holdout.summary.passRate}).`,
      "",
      ...renderConfusion(data.holdout.confusion, data.holdout.perLabel)
    );
  }

  lines.push(
    "",
    "## Misses",
    "",
    ...data.results
      .filter((result) => !result.pass)
      .map((result) => `- ${result.id} (${result.emotion}): told "${result.coloring}" with flags [${result.flags.join(", ")}]; prosody ${result.prosody.energy} energy, ${result.prosody.rate} rate, ${result.prosody.pitch_range} pitch range.`),
    "",
    "## Dataset Notes",
    "",
    "- CREMA-D clips are fetched from the CheyneyComputerScience/CREMA-D GitHub repository.",
    "- RAVDESS clips are fetched as individual WAV files from the birgermoell/ravdess Hugging Face mirror of the CC BY-NC-SA 4.0 dataset.",
    "- Berlin EmoDB clips are extracted from Zenodo record 7447302, licensed CC BY 4.0.",
    "- Downloaded audio is cached under eval/external/cache and ignored by git."
  );
  return lines.join("\n") + "\n";
}

// ---- download / io ----------------------------------------------------------

async function ensureAudio(testCase) {
  const target = join(cacheDir, `${testCase.id}.wav`);
  if (await exists(target)) return target;

  if (testCase.url) {
    await download(testCase.url, target);
    return target;
  }

  if (testCase.archiveUrl && testCase.archiveEntry) {
    const archivePath = join(cacheDir, basename(testCase.archiveUrl.split("?")[0]));
    if (!(await exists(archivePath))) {
      await download(testCase.archiveUrl, archivePath);
    }
    const list = await run("unzip", ["-Z1", archivePath]);
    const entry = list.stdout.split(/\r?\n/).find((line) => line === testCase.archiveEntry || line.endsWith(`/${basename(testCase.archiveEntry)}`));
    assert.ok(entry, `Archive entry not found for ${testCase.id}: ${testCase.archiveEntry}`);
    const extracted = await run("unzip", ["-p", archivePath, entry], { encoding: "buffer" });
    await writeFile(target, extracted.stdout);
    return target;
  }

  throw new Error(`No url or archiveUrl/archiveEntry for ${testCase.id}`);
}

async function download(url, target) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "SubtextExternalEmotionEval/0.1"
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }
  await mkdir(dirname(target), { recursive: true });
  const stream = createWriteStream(target);
  await new Promise((resolve, reject) => {
    response.body.pipeTo(new WritableStream({
      write(chunk) {
        stream.write(Buffer.from(chunk));
      },
      close() {
        stream.end(resolve);
      },
      abort(error) {
        stream.destroy(error);
        reject(error);
      }
    })).catch(reject);
  });
}

function escapeCell(value) {
  return String(value).replace(/\|/g, "\\|");
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      i += 1;
    }
  }
  return parsed;
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function run(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("exit", (code) => {
      const stdoutBuffer = Buffer.concat(stdout);
      const stderrText = Buffer.concat(stderr).toString("utf8");
      if (code === 0) {
        resolve({
          stdout: options.encoding === "buffer" ? stdoutBuffer : stdoutBuffer.toString("utf8"),
          stderr: stderrText
        });
      } else {
        reject(new Error(stderrText || `${command} exited ${code}`));
      }
    });
  });
}
