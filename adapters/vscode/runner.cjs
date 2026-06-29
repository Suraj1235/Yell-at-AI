const { existsSync } = require("node:fs");
const { mkdtemp, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { dirname, join, resolve } = require("node:path");
const { spawn } = require("node:child_process");

function resolveCliPath(configuredPath, extensionDir = __dirname) {
  if (configuredPath && String(configuredPath).trim()) {
    return resolve(String(configuredPath));
  }

  return resolve(extensionDir, "..", "..", "bin", "subtext.js");
}

function buildHandoffArgs(options) {
  const {
    cliPath,
    audioPath,
    text,
    transcriptPath,
    transcriptSource,
    transcriptConfidence,
    language,
    wordTimings,
    requireWordTimings = false,
    baselinePath = "",
    verbosity = "full"
  } = options;

  if (!cliPath) throw new Error("Missing Subtext CLI path.");
  if (!audioPath) throw new Error("Missing WAV audio path.");
  if (!transcriptPath && (!text || !String(text).trim())) {
    throw new Error("Missing transcript text or transcript envelope.");
  }

  const args = [
    cliPath,
    "handoff",
    "--audio",
    audioPath
  ];

  if (transcriptPath) {
    args.push("--transcript", resolve(String(transcriptPath)));
  } else {
    args.push("--text", text);
  }

  args.push(
    "--target",
    "stdout",
    "--verbosity",
    verbosity
  );

  if (baselinePath && String(baselinePath).trim()) {
    args.push("--baseline", baselinePath);
  }

  if (transcriptSource && String(transcriptSource).trim()) {
    args.push("--transcript-source", String(transcriptSource).trim());
  }

  if (transcriptConfidence !== undefined && transcriptConfidence !== null && String(transcriptConfidence).trim()) {
    args.push("--transcript-confidence", String(transcriptConfidence).trim());
  }

  if (language && String(language).trim()) {
    args.push("--language", String(language).trim());
  }

  if (wordTimings) {
    args.push("--word-timings", typeof wordTimings === "string" ? wordTimings : JSON.stringify(wordTimings));
  }

  if (requireWordTimings) {
    args.push("--require-word-timings");
  }

  return args;
}

async function runSubtextHandoff(options) {
  const {
    nodePath = process.execPath,
    cwd = dirname(options.cliPath),
    timeoutMs = 15000
  } = options;

  if (!existsSync(options.cliPath)) {
    return Promise.reject(new Error(`Subtext CLI not found at ${options.cliPath}`));
  }

  const prepared = await prepareHandoffOptions(options);
  try {
    return await spawnSubtext(nodePath, buildHandoffArgs(prepared.options), { cwd, timeoutMs });
  } finally {
    await prepared.cleanup?.();
  }
}

async function prepareHandoffOptions(options) {
  if (!isTranscriptEnvelope(options.transcript)) {
    return { options };
  }

  const dir = await mkdtemp(join(tmpdir(), "subtext-vscode-"));
  const file = join(dir, "transcript.json");
  await writeFile(file, `${JSON.stringify({
    schema: "subtext/transcript/v1",
    ...options.transcript
  })}\n`);

  return {
    options: {
      ...options,
      transcriptPath: file,
      text: options.transcript.text ?? options.transcript.transcript ?? options.text
    },
    cleanup: () => rm(dir, { recursive: true, force: true })
  };
}

function isTranscriptEnvelope(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function spawnSubtext(nodePath, args, { cwd, timeoutMs }) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(nodePath, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Subtext handoff timed out after ${timeoutMs} ms.`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolvePromise(stdout);
      } else {
        reject(new Error(stderr || `Subtext exited with code ${code}.`));
      }
    });
  });
}

module.exports = {
  buildHandoffArgs,
  prepareHandoffOptions,
  resolveCliPath,
  runSubtextHandoff
};
