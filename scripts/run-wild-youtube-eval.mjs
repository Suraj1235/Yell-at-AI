import assert from "node:assert/strict";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { analyzeFile, extractProsody, readWavFile } from "../src/index.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifestPath = join(root, "eval", "wild", "youtube-cases.json");
const cacheDir = join(root, "eval", "wild", "cache");
const captionsDir = join(cacheDir, "captions");
const outDir = join(root, "eval", "wild", "out");
const transcriptCacheVersion = "v2";
const args = parseArgs(process.argv.slice(2));
const minPassRate = Number(args["min-pass-rate"] ?? 0);
const downloadOnly = Boolean(args["download-only"]);
const allowUnavailable = Boolean(args["allow-unavailable"]);
const ytdlpExtraArgs = parseExtraArgs(args["yt-dlp-args"] ?? process.env.SUBTEXT_YTDLP_ARGS ?? "");

await mkdir(cacheDir, { recursive: true });
await mkdir(captionsDir, { recursive: true });
await mkdir(outDir, { recursive: true });

const cases = filterCases(JSON.parse(await readFile(manifestPath, "utf8")), args);
assert.ok(cases.length > 0, "No wild YouTube cases matched the requested filter.");
const ffmpegPath = await locateFfmpeg();
const results = [];

for (const testCase of cases) {
  process.stderr.write(`wild eval: ${testCase.id}\n`);
  try {
    const audioPath = await ensureYoutubeSegment(testCase, ffmpegPath);
    const transcript = testCase.transcript ?? await ensureYoutubeTranscript(testCase);

    if (downloadOnly) {
      results.push({ ...resultBase(testCase), audioPath, transcript, downloaded: true });
      continue;
    }

    const contract = await analyzeFile(audioPath, transcript);
    const wav = await readWavFile(audioPath);
    const prosodySummary = extractProsody(wav.samples, wav.sampleRate).summary;
    const signals = collectSignals(contract, prosodySummary, transcript);
    const matchedAny = (testCase.expectAny ?? []).filter((signal) => signals.includes(signal));
    const matchedAll = (testCase.expectAll ?? []).filter((signal) => signals.includes(signal));
    const forbiddenHits = (testCase.forbid ?? []).filter((signal) => signals.includes(signal));
    const hasRequiredAll = matchedAll.length === (testCase.expectAll ?? []).length;
    const hasAny = !testCase.expectAny?.length || matchedAny.length > 0;
    const pass = hasRequiredAll && hasAny && forbiddenHits.length === 0;

    results.push({
      ...resultBase(testCase),
      pass,
      matchedAny,
      matchedAll,
      forbiddenHits,
      signals,
      transcript,
      contract,
      prosodySummary,
      audioPath
    });
  } catch (error) {
    if (!allowUnavailable) throw error;
    results.push({
      ...resultBase(testCase),
      unavailable: true,
      pass: false,
      error: error.message,
      matchedAny: [],
      matchedAll: [],
      forbiddenHits: [],
      signals: []
    });
  }
}

if (downloadOnly) {
  process.stdout.write(JSON.stringify({
    ok: results.some((result) => result.downloaded),
    downloaded: results.filter((result) => result.downloaded).length,
    unavailable: results.filter((result) => result.unavailable).length,
    cacheDir
  }, null, 2) + "\n");
  process.exit(0);
}

const availableResults = results.filter((result) => !result.unavailable);
const passed = availableResults.filter((result) => result.pass).length;
const failed = availableResults.length - passed;
const unavailable = results.length - availableResults.length;
const passRate = passed / Math.max(1, availableResults.length);
const report = {
  generatedAt: new Date().toISOString(),
  cases: results.length,
  available: availableResults.length,
  unavailable,
  passed,
  failed,
  passRate: Number(passRate.toFixed(3)),
  minPassRate,
  caveat: "This is a wild YouTube speech assistant-handoff benchmark. It checks observable prosody/flag behavior, not emotion labels.",
  toolchain: {
    ytdlp: (await run("yt-dlp", ["--version"])).stdout.trim(),
    ffmpegPath,
    extraYtdlpArgs: ytdlpExtraArgs
  },
  results
};

await writeFile(join(outDir, "youtube-wild-report.json"), JSON.stringify(report, null, 2) + "\n");
await writeFile(join(outDir, "youtube-wild-report.md"), renderMarkdown(report));

process.stdout.write(JSON.stringify({
  cases: report.cases,
  available: report.available,
  unavailable: report.unavailable,
  passed: report.passed,
  failed: report.failed,
  passRate: report.passRate,
  minPassRate,
  reportJson: "eval/wild/out/youtube-wild-report.json",
  reportMarkdown: "eval/wild/out/youtube-wild-report.md"
}, null, 2) + "\n");

if (availableResults.length === 0) {
  process.stderr.write("Wild YouTube benchmark had no available cases to score.\n");
  process.exitCode = 1;
} else if (passRate < minPassRate) {
  process.stderr.write(`Wild YouTube benchmark below threshold: ${passRate} < ${minPassRate}\n`);
  process.exitCode = 1;
}

async function ensureYoutubeSegment(testCase, ffmpeg) {
  assert.ok(testCase.sourceUrl, `${testCase.id} requires sourceUrl`);
  assert.equal(typeof testCase.startSec, "number", `${testCase.id} requires startSec`);
  assert.equal(typeof testCase.endSec, "number", `${testCase.id} requires endSec`);
  assert.ok(testCase.endSec > testCase.startSec, `${testCase.id} endSec must be after startSec`);

  const target = join(cacheDir, `${testCase.id}-${segmentKey(testCase)}.wav`);
  if (await exists(target)) return target;

  const section = `*${formatTimestamp(testCase.startSec)}-${formatTimestamp(testCase.endSec)}`;
  await run("yt-dlp", [
    "--quiet",
    "--no-warnings",
    ...ytdlpExtraArgs,
    "--ffmpeg-location",
    ffmpeg,
    "--download-sections",
    section,
    "-f",
    "bestaudio[ext=m4a]/bestaudio/best",
    "--extract-audio",
    "--audio-format",
    "wav",
    "--postprocessor-args",
    "ffmpeg:-ac 1 -ar 16000",
    "-o",
    join(cacheDir, `${testCase.id}-${segmentKey(testCase)}.%(ext)s`),
    testCase.sourceUrl
  ]);

  assert.ok(await exists(target), `Expected extracted WAV for ${testCase.id}: ${target}`);
  return target;
}

async function ensureYoutubeTranscript(testCase) {
  const transcriptPath = join(captionsDir, `${testCase.id}-${segmentKey(testCase)}-${transcriptCacheVersion}.txt`);
  if (await exists(transcriptPath)) return readFile(transcriptPath, "utf8").then((text) => text.trim());

  const caseCaptionDir = join(captionsDir, testCase.id);
  await mkdir(caseCaptionDir, { recursive: true });
  await run("yt-dlp", [
    "--quiet",
    "--no-warnings",
    ...ytdlpExtraArgs,
    "--skip-download",
    "--write-subs",
    "--write-auto-subs",
    "--sub-langs",
    testCase.subtitleLangs ?? "en,en-US,en-orig",
    "--sub-format",
    "vtt",
    "-o",
    join(caseCaptionDir, `${testCase.id}.%(ext)s`),
    testCase.sourceUrl
  ]);

  const vttFiles = (await readdir(caseCaptionDir))
    .filter((file) => file.endsWith(".vtt"))
    .map((file) => join(caseCaptionDir, file));
  assert.ok(vttFiles.length > 0, `No VTT captions found for ${testCase.id}`);

  const candidates = [];
  for (const file of vttFiles) {
    const raw = await readFile(file, "utf8");
    const transcript = extractVttTranscript(raw, testCase.startSec, testCase.endSec);
    const words = transcript.split(/\s+/).filter(Boolean).length;
    const markupPenalty = (raw.match(/<c[ >]/g) ?? []).length;
    const duplicatePenalty = countDuplicateLines(raw);
    candidates.push({ file, transcript, words, score: words * 3 - markupPenalty - duplicatePenalty });
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  assert.ok(best.transcript.length > 0, `Empty transcript for ${testCase.id}`);
  await writeFile(transcriptPath, `${best.transcript}\n`);
  return best.transcript;
}

function extractVttTranscript(raw, startSec, endSec) {
  const cues = [];
  const lines = raw.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.includes("-->")) continue;

    const [startRaw] = line.split("-->");
    const cueStart = parseCueTime(startRaw.trim());
    const textLines = [];
    index += 1;
    while (index < lines.length && lines[index].trim()) {
      textLines.push(lines[index]);
      index += 1;
    }

    if (cueStart < startSec - 0.25 || cueStart > endSec + 0.25) continue;
    const plainTextLines = textLines.filter((textLine) => !textLine.includes("<"));
    const cueText = plainTextLines.length > 0 ? plainTextLines.join(" ") : textLines.join(" ");
    cues.push(cleanCaptionText(cueText));
  }

  const deduped = [];
  for (const cue of cues) {
    if (!cue || deduped.at(-1) === cue) continue;
    if (deduped.some((prior) => prior.endsWith(cue) || cue.endsWith(prior))) {
      const prior = deduped.at(-1);
      if (prior && cue.length > prior.length && cue.includes(prior)) deduped[deduped.length - 1] = cue;
      continue;
    }
    deduped.push(cue);
  }

  return cleanCaptionText(deduped.join(" "));
}

function cleanCaptionText(value) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\[[^\]]+\]/g, " ")
    .replace(/\([^)]*(music|applause|laughter)[^)]*\)/gi, " ")
    .replace(/\b[A-Z][A-Z0-9 ]{2,}:\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function collectSignals(contract, summary, transcript) {
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

  const steeringFlagTypes = new Set(["yelling", "urgency", "tension", "hesitation", "confusion", "uncertainty"]);
  const hasSteeringFlag = contract.flags.some((flag) => steeringFlagTypes.has(flag.type));
  const deliveryClear = !hasSteeringFlag && prosody.pause_density !== "high";
  const questionText = /\?/.test(transcript) || /\bquestions?\b/i.test(transcript);
  const aroused = prosody.energy === "high"
    || prosody.rate === "fast"
    || prosody.pitch_range === "wide"
    || contract.flags.some((flag) => ["urgency", "tension"].includes(flag.type));
  const subdued = prosody.energy === "low"
    || prosody.rate === "slow"
    || prosody.pause_density === "high"
    || prosody.pitch_range === "narrow";

  if (deliveryClear) signals.add("delivery_clear");
  if (questionText) signals.add("question_text");
  if (aroused) signals.add("aroused");
  if (subdued) signals.add("subdued");
  if (summary.pitchConfidenceMean < 0.55) signals.add("low_pitch_confidence");
  if (summary.reliableVoicedFrameCount < summary.voicedFrameCount * 0.6) signals.add("pitch_outlier_heavy");

  return [...signals].sort();
}

function renderMarkdown(report) {
  const rows = report.results.map((result) => [
    result.unavailable ? "UNAVAILABLE" : result.pass ? "PASS" : "MISS",
    result.id,
    result.source,
    result.genre,
    `${formatTimestamp(result.startSec)}-${formatTimestamp(result.endSec)}`,
    result.contract?.prosody?.energy ?? "-",
    result.contract?.prosody?.rate ?? "-",
    result.contract?.prosody?.pitch_range ?? "-",
    result.contract?.prosody?.pause_density ?? "-",
    result.contract?.flags?.map((flag) => flag.type).join(", ") || "none",
    result.unavailable ? truncate(result.error, 120) : result.matchedAny.join(", ") || result.matchedAll.join(", ") || "none",
    result.forbiddenHits.join(", ") || "none"
  ]);

  return [
    "# Wild YouTube Speech Benchmark",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Result: ${report.passed}/${report.available} available clips matched expected assistant-handoff behavior. Pass rate ${report.passRate}. Unavailable: ${report.unavailable}/${report.cases}.`,
    "",
    "> This benchmark uses natural YouTube speech clips to expose false positives and missing vocal-context cues. It is not an emotion classifier.",
    "",
    `Toolchain: yt-dlp ${report.toolchain.ytdlp}; ffmpeg ${report.toolchain.ffmpegPath}`,
    "",
    "| Result | Case | Source | Genre | Segment | Energy | Rate | Pitch Range | Pause Density | Flags | Matched Evidence | Forbidden Hits |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row.map(escapeCell).join(" | ")} |`),
    "",
    "## Flaws To Inspect",
    "",
    ...report.results
      .filter((result) => !result.pass && !result.unavailable)
      .map((result) => {
        const expectations = [
          result.expectedAny.length ? `any of [${result.expectedAny.join(", ")}]` : null,
          result.expectedAll.length ? `all of [${result.expectedAll.join(", ")}]` : null,
          result.forbidden.length ? `forbidden [${result.forbidden.join(", ")}]` : null
        ].filter(Boolean).join("; ");
        return `- ${result.id}: expected ${expectations}, saw [${result.signals.join(", ")}]. Transcript excerpt: "${truncate(result.transcript, 180)}"`;
      }),
    ...report.results
      .filter((result) => result.unavailable)
      .map((result) => `- ${result.id}: source unavailable during this run. ${truncate(result.error, 180)}`),
    "",
    "## Sources",
    "",
    ...report.results.map((result) => `- ${result.source}: [${escapeMarkdown(result.title)}](${result.sourceUrl}) (${formatTimestamp(result.startSec)}-${formatTimestamp(result.endSec)})`),
    "",
    "Downloaded clips are cached under eval/wild/cache and ignored by git."
  ].join("\n") + "\n";
}

function resultBase(testCase) {
  return {
    id: testCase.id,
    source: testCase.source,
    sourceUrl: testCase.sourceUrl,
    title: testCase.title,
    genre: testCase.genre,
    startSec: testCase.startSec,
    endSec: testCase.endSec,
    expectedAny: testCase.expectAny ?? [],
    expectedAll: testCase.expectAll ?? [],
    forbidden: testCase.forbid ?? [],
    notes: testCase.notes
  };
}

function filterCases(cases, args) {
  const selectedIds = parseFilterValues(args.case ?? args.cases);
  const selectedSources = parseFilterValues(args.source).map((source) => source.toLowerCase());
  return cases.filter((testCase) => (
    (!selectedIds.length || selectedIds.includes(testCase.id))
    && (!selectedSources.length || selectedSources.includes(String(testCase.source).toLowerCase()))
  ));
}

function parseFilterValues(value) {
  if (!value) return [];
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function parseExtraArgs(value) {
  if (!value) return [];
  return String(value).match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, "")) ?? [];
}

async function locateFfmpeg() {
  if (process.env.FFMPEG_PATH && await exists(process.env.FFMPEG_PATH)) return process.env.FFMPEG_PATH;

  // Windows first, and deliberately not via `sh`. Under Git Bash / MSYS,
  // `command -v ffmpeg` prints a POSIX path like /c/Users/.../ffmpeg, which we
  // then hand to yt-dlp.exe as --ffmpeg-location. yt-dlp is a native Windows
  // binary and cannot resolve that form, so it reports "ffmpeg is not installed"
  // even though ffmpeg is on PATH. `where` returns a native path.
  if (process.platform === "win32") {
    const where = await runMaybe("where", ["ffmpeg"]);
    if (where.ok) {
      const first = where.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0];
      if (first && await exists(first)) return first;
    }
  }

  const system = await runMaybe("sh", ["-lc", "command -v ffmpeg"]);
  if (system.ok && system.stdout.trim() && await exists(system.stdout.trim())) return system.stdout.trim();

  const imageio = await runMaybe("python3", ["-c", "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"]);
  if (imageio.ok && imageio.stdout.trim() && await exists(imageio.stdout.trim())) return imageio.stdout.trim();

  throw new Error(
    "Wild YouTube eval requires ffmpeg. Install ffmpeg and put it on PATH, set FFMPEG_PATH to the " +
    "full path of the executable (on Windows use a native path such as " +
    "C:\\path\\to\\ffmpeg.exe, not a Git Bash /c/... path), or install Python imageio-ffmpeg."
  );
}

function parseCueTime(value) {
  const [hoursOrMinutes, minutesOrSeconds, secondsRaw] = value.split(":");
  if (secondsRaw === undefined) {
    return Number(hoursOrMinutes) * 60 + Number(minutesOrSeconds.replace(",", "."));
  }
  return Number(hoursOrMinutes) * 3600 + Number(minutesOrSeconds) * 60 + Number(secondsRaw.replace(",", "."));
}

function formatTimestamp(seconds) {
  const totalMs = Math.round(seconds * 1000);
  const totalSeconds = Math.floor(totalMs / 1000);
  const ms = totalMs % 1000;
  const hh = Math.floor(totalSeconds / 3600);
  const mm = Math.floor((totalSeconds % 3600) / 60);
  const ss = totalSeconds % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

function segmentKey(testCase) {
  return `${Math.round(testCase.startSec * 1000)}-${Math.round(testCase.endSec * 1000)}`;
}

function countDuplicateLines(raw) {
  const seen = new Set();
  let duplicates = 0;
  for (const line of raw.split(/\r?\n/).map(cleanCaptionText).filter(Boolean)) {
    if (line.includes("-->")) continue;
    if (seen.has(line)) duplicates += 1;
    seen.add(line);
  }
  return duplicates;
}

function escapeCell(value) {
  return String(value).replace(/\|/g, "\\|");
}

function escapeMarkdown(value) {
  return String(value).replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

function truncate(value, maxLength) {
  const text = String(value ?? "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
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

async function runMaybe(command, args) {
  try {
    return { ok: true, ...(await run(command, args)) };
  } catch (error) {
    return { ok: false, error };
  }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("exit", (code) => {
      const stdoutText = Buffer.concat(stdout).toString("utf8");
      const stderrText = Buffer.concat(stderr).toString("utf8");
      if (code === 0) {
        resolve({ stdout: stdoutText, stderr: stderrText });
      } else {
        reject(new Error(stderrText || `${command} exited ${code}`));
      }
    });
  });
}
