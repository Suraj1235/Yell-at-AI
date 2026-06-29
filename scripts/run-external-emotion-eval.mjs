import assert from "node:assert/strict";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { analyzeFile, buildBaselineFromFiles, extractProsody, readWavFile } from "../src/index.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifestPath = join(root, "eval", "external", "emotion-cases.json");
const cacheDir = join(root, "eval", "external", "cache");
const outDir = join(root, "eval", "external", "out");
const args = parseArgs(process.argv.slice(2));
const minPassRate = Number(args["min-pass-rate"] ?? 0);
const downloadOnly = Boolean(args["download-only"]);

await mkdir(cacheDir, { recursive: true });
await mkdir(outDir, { recursive: true });

const cases = JSON.parse(await readFile(manifestPath, "utf8"));
const results = [];

for (const testCase of cases) {
  const audioPath = await ensureAudio(testCase);
  if (downloadOnly) {
    results.push({ id: testCase.id, source: testCase.source, audioPath, downloaded: true });
    for (const baselineItem of testCase.baseline ?? []) {
      const baselinePath = await ensureAudio(baselineItem);
      results.push({ id: baselineItem.id, source: baselineItem.source ?? testCase.source, audioPath: baselinePath, downloaded: true });
    }
    continue;
  }

  const baselineItems = await Promise.all((testCase.baseline ?? []).map(async (baselineItem) => ({
    audioPath: await ensureAudio(baselineItem),
    text: baselineItem.transcript
  })));
  const baseline = baselineItems.length > 0 ? await buildBaselineFromFiles(baselineItems) : null;
  const contract = await analyzeFile(audioPath, testCase.transcript, { baseline });
  const wav = await readWavFile(audioPath);
  const prosodySummary = extractProsody(wav.samples, wav.sampleRate).summary;
  const signals = collectSignals(contract);
  const matchedAny = (testCase.expectAny ?? []).filter((signal) => signals.includes(signal));
  const matchedAll = (testCase.expectAll ?? []).filter((signal) => signals.includes(signal));
  const forbiddenHits = (testCase.forbid ?? []).filter((signal) => signals.includes(signal));
  const hasRequiredAll = matchedAll.length === (testCase.expectAll ?? []).length;
  const hasAny = !testCase.expectAny?.length || matchedAny.length > 0;
  const pass = hasRequiredAll && hasAny && forbiddenHits.length === 0;

  results.push({
    id: testCase.id,
    source: testCase.source,
    genre: testCase.genre,
    emotion: testCase.emotion,
    transcript: testCase.transcript,
    pass,
    matchedAny,
    matchedAll,
    forbiddenHits,
    expectedAny: testCase.expectAny ?? [],
    expectedAll: testCase.expectAll ?? [],
    forbidden: testCase.forbid ?? [],
    signals,
    contract,
    prosodySummary,
    baselineSamples: baseline?.samples ?? 0,
    audioPath,
    notes: testCase.notes
  });
}

if (downloadOnly) {
  process.stdout.write(JSON.stringify({ ok: true, downloaded: results.length, cacheDir }, null, 2) + "\n");
  process.exit(0);
}

const passed = results.filter((result) => result.pass).length;
const failed = results.length - passed;
const passRate = passed / Math.max(1, results.length);
const report = {
  generatedAt: new Date().toISOString(),
  cases: results.length,
  passed,
  failed,
  passRate: Number(passRate.toFixed(3)),
  minPassRate,
  caveat: "This is an acted-emotion prosody evidence benchmark, not an emotion classifier or psychological assessment.",
  results
};

await writeFile(join(outDir, "emotion-eval-report.json"), JSON.stringify(report, null, 2) + "\n");
await writeFile(join(outDir, "emotion-eval-report.md"), renderMarkdown(report));

process.stdout.write(JSON.stringify({
  cases: report.cases,
  passed: report.passed,
  failed: report.failed,
  passRate: report.passRate,
  minPassRate,
  reportJson: "eval/external/out/emotion-eval-report.json",
  reportMarkdown: "eval/external/out/emotion-eval-report.md"
}, null, 2) + "\n");

if (passRate < minPassRate) {
  process.stderr.write(`External emotion evidence benchmark below threshold: ${passRate} < ${minPassRate}\n`);
  process.exitCode = 1;
}

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

function collectSignals(contract) {
  const signals = new Set();
  const { prosody } = contract;
  signals.add(`energy_${prosody.energy}`);
  signals.add(`rate_${prosody.rate}`);
  signals.add(`pitch_${prosody.pitch_range}`);
  signals.add(`pause_${prosody.pause_density}`);
  signals.add(`terminal_${prosody.terminal_pitch}`);
  signals.add(`voice_${prosody.voice_quality}`);

  for (const flag of contract.flags) {
    signals.add(`flag_${flag.type}`);
  }

  const aroused = prosody.energy === "high"
    || prosody.rate === "fast"
    || prosody.pitch_range === "wide"
    || contract.flags.some((flag) => ["urgency", "tension"].includes(flag.type));
  const subdued = prosody.energy === "low"
    || prosody.rate === "slow"
    || prosody.pause_density === "high"
    || prosody.pitch_range === "narrow";
  const stable = contract.flags.length === 0
    && ["medium", "low"].includes(prosody.energy)
    && ["normal", "slow"].includes(prosody.rate)
    && prosody.pause_density !== "high";
  const steeringFlagTypes = new Set(["yelling", "urgency", "tension", "hesitation", "confusion", "uncertainty"]);
  const hasSteeringFlag = contract.flags.some((flag) => steeringFlagTypes.has(flag.type));
  const deliveryClear = !hasSteeringFlag && prosody.energy !== "high" && prosody.pause_density !== "high";

  if (aroused) signals.add("aroused");
  if (subdued) signals.add("subdued");
  if (stable) signals.add("stable");
  if (deliveryClear) signals.add("delivery_clear");

  return [...signals].sort();
}

function renderMarkdown(report) {
  const rows = report.results.map((result) => [
    result.pass ? "PASS" : "MISS",
    result.id,
    result.source,
    result.genre,
    result.emotion,
    result.contract.prosody.energy,
    result.contract.prosody.rate,
    result.contract.prosody.pitch_range,
    result.contract.prosody.pause_density,
    result.baselineSamples > 0 ? `personal(${result.baselineSamples})` : "utterance",
    result.contract.flags.map((flag) => flag.type).join(", ") || "none",
    result.matchedAny.join(", ") || result.matchedAll.join(", ") || "none",
    result.forbiddenHits.join(", ") || "none"
  ]);

  return [
    "# External Emotion Evidence Benchmark",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Result: ${report.passed}/${report.cases} matched expected prosody evidence. Pass rate ${report.passRate}.`,
    "",
    "> This benchmark uses acted emotion labels to expose flaws in prosody evidence extraction. It is not an emotion classifier and must not be used as psychological assessment.",
    "",
    "| Result | Case | Source | Genre | Known Label | Energy | Rate | Pitch Range | Pause Density | Calibration | Flags | Matched Evidence | Forbidden Hits |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`),
    "",
    "## Flaws To Inspect",
    "",
    ...report.results
      .filter((result) => !result.pass)
      .map((result) => {
        const expectations = [
          result.expectedAny.length ? `any of [${result.expectedAny.join(", ")}]` : null,
          result.expectedAll.length ? `all of [${result.expectedAll.join(", ")}]` : null,
          result.forbidden.length ? `forbidden [${result.forbidden.join(", ")}]` : null
        ].filter(Boolean).join("; ");
        return `- ${result.id}: label=${result.emotion}; expected ${expectations}, saw [${result.signals.join(", ")}].`;
      }),
    "",
    "## Dataset Notes",
    "",
    "- CREMA-D clips are fetched from the CheyneyComputerScience/CREMA-D GitHub repository.",
    "- RAVDESS clips are fetched as individual WAV files from the birgermoell/ravdess Hugging Face mirror of the CC BY-NC-SA 4.0 dataset.",
    "- Berlin EmoDB clips are extracted from Zenodo record 7447302, licensed CC BY 4.0.",
    "- Downloaded audio is cached under eval/external/cache and ignored by git."
  ].join("\n") + "\n";
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

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
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
