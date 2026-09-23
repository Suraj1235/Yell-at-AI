import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transcribe, transcribeWithCommand, transcribeWithWhisper, ADAPTERS } from "../src/transcribe/index.js";
import {
  resolveWhisperBinary,
  resolveWhisperModel,
  buildWhisperArgs,
  resolveWhisperThreads,
  parseWhisperOutput,
  WHISPER_NOT_FOUND_MESSAGE,
  WHISPER_SOURCE
} from "../src/transcribe/whisper.js";

const NONEXISTENT_BIN = "/no/such/whisper/binary-zzzqx";
const NONEXISTENT_DIR = "/no/such/whisper/model-dir-zzzqx";
// A path guaranteed to exist on every platform, used to satisfy the file-exists
// checks in resolveWhisperBinary/resolveWhisperModel without spawning anything
// (the runner is always faked, so this binary is never actually executed).
const REAL_FILE = process.execPath;

test("command adapter parses an injected mock runner into an envelope", async () => {
  const transcript = await transcribeWithCommand({
    command: "host-transcript {audio}",
    replacements: { audio: "turn.wav" },
    overrides: { fallbackSource: "host_transcript_command" },
    runner: async (parts) => {
      // The {audio} placeholder must have been substituted before the runner sees it.
      assert.deepEqual(parts, ["host-transcript", "turn.wav"]);
      return "  hello there  ";
    }
  });

  assert.equal(transcript.text, "hello there");
  assert.equal(transcript.source, "host_transcript_command");
});

test("command adapter accepts a structured transcript envelope from the runner", async () => {
  const transcript = await transcribeWithCommand({
    command: "host-transcript --json {audio}",
    replacements: { audio: "turn.wav" },
    overrides: { fallbackSource: "host_transcript_command" },
    runner: async () => JSON.stringify({
      text: "ship the whole thing",
      source: "os-dictation",
      word_timings: [{ word: "ship", start: 0, end: 0.2 }]
    })
  });

  assert.equal(transcript.text, "ship the whole thing");
  assert.equal(transcript.source, "os-dictation");
  assert.equal(transcript.wordTimings.length, 1);
});

test("command adapter throws on an empty command template", async () => {
  await assert.rejects(
    () => transcribeWithCommand({ command: "", runner: async () => "x" }),
    /--transcript-command was empty\./
  );
});

test("transcribe() dispatches to the command adapter by default via a portable command", async () => {
  const transcript = await transcribe("turn.wav", {
    overrides: { fallbackSource: "host_transcript_command" },
    runner: async () => "hello there"
  });

  assert.ok(transcript.text, "expected a non-empty text field");
  assert.ok(transcript.source, "expected a source field");
  assert.equal(transcript.text, "hello there");
});

test("command adapter runs a real portable node command end to end (offline)", async () => {
  // Uses the literal `node` token (resolved via PATH — present when running
  // `node --test`) to avoid space-in-path issues with process.execPath.
  const transcript = await transcribeWithCommand({
    command: `node -e "process.stdout.write('hello there')"`,
    overrides: { fallbackSource: "host_transcript_command" }
  });

  assert.equal(transcript.text, "hello there");
  assert.ok(transcript.source);
});

test("ADAPTERS includes command, whisper, and the browser-only webspeech contract", () => {
  assert.ok(ADAPTERS.includes("command"));
  assert.ok(ADAPTERS.includes("whisper"));
  assert.ok(ADAPTERS.includes("webspeech"));
});

test("whisper adapter throws an actionable error when SUBTEXT_WHISPER_BIN is missing", async () => {
  await assert.rejects(
    () => transcribeWithWhisper({
      audio: "turn.wav",
      env: { SUBTEXT_WHISPER_BIN: NONEXISTENT_BIN, PATH: "" },
      runner: async () => "should not run"
    }),
    (error) => {
      assert.equal(error.message, WHISPER_NOT_FOUND_MESSAGE);
      assert.match(error.message, /set SUBTEXT_WHISPER_BIN or install whisper\.cpp - see docs\/WHISPER\.md/);
      return true;
    }
  );
});

test("whisper adapter throws actionable error when no binary is on an empty PATH", () => {
  assert.throws(
    () => resolveWhisperBinary({ PATH: "" }),
    (error) => {
      assert.equal(error.message, WHISPER_NOT_FOUND_MESSAGE);
      return true;
    }
  );
});

test("transcribe() with the whisper adapter surfaces the actionable not-found error", async () => {
  await assert.rejects(
    () => transcribe("turn.wav", {
      adapter: "whisper",
      env: { SUBTEXT_WHISPER_BIN: NONEXISTENT_BIN, PATH: "" }
    }),
    new RegExp(WHISPER_NOT_FOUND_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  );
});

test("whisper adapter parses canned plain-text stdout into the envelope", async () => {
  const transcript = await transcribeWithWhisper({
    audio: "turn.wav",
    env: { SUBTEXT_WHISPER_BIN: REAL_FILE, PATH: "" },
    runner: async () =>
      "[00:00:00.000 --> 00:00:02.700]  can we just refactor the whole auth module\n",
    json: false
  });

  assert.equal(transcript.text, "can we just refactor the whole auth module");
  assert.equal(transcript.source, WHISPER_SOURCE);
  assert.equal(transcript.source, "whisper.cpp");
  assert.equal(transcript.words, undefined);
});

test("whisper adapter parses whisper.cpp JSON (segments + token offsets) with word timings", async () => {
  // Shape produced by `whisper-cli --output-json-full`: a `transcription` array of
  // segments, each carrying `tokens` whose `offsets` are in milliseconds.
  const cannedJson = JSON.stringify({
    result: { language: "en" },
    transcription: [
      {
        text: " can we",
        offsets: { from: 0, to: 450 },
        tokens: [
          { text: "[_BEG_]", offsets: { from: 0, to: 0 } },
          { text: " can", offsets: { from: 0, to: 220 } },
          { text: " we", offsets: { from: 250, to: 450 } }
        ]
      },
      {
        text: " whole",
        offsets: { from: 1490, to: 1990 },
        tokens: [
          { text: " whole", offsets: { from: 1490, to: 1990 } }
        ]
      }
    ]
  });

  const transcript = await transcribeWithWhisper({
    audio: "turn.wav",
    env: { SUBTEXT_WHISPER_BIN: REAL_FILE, PATH: "" },
    runner: async () => cannedJson
  });

  assert.equal(transcript.text, "can we whole");
  assert.equal(transcript.source, "whisper.cpp");
  assert.equal(transcript.language, "en");
  // The bracketed special token [_BEG_] is dropped; three real words remain.
  assert.equal(transcript.words.length, 3);
  assert.deepEqual(transcript.words[0], { word: "can", start: 0, end: 0.22 });
  assert.deepEqual(transcript.words[1], { word: "we", start: 0.25, end: 0.45 });
  assert.deepEqual(transcript.words[2], { word: "whole", start: 1.49, end: 1.99 });
});

test("whisper adapter accepts a simple JSON envelope with explicit words/confidence", async () => {
  const transcript = await transcribeWithWhisper({
    audio: "turn.wav",
    env: { SUBTEXT_WHISPER_BIN: REAL_FILE, PATH: "" },
    runner: async () => JSON.stringify({
      text: "ship the whole thing",
      language: "en",
      confidence: 0.91,
      words: [
        { word: "ship", start: 0, end: 0.2 },
        { word: "the", start: 0.22, end: 0.34 },
        { word: "whole", start: 0.36, end: 0.7 },
        { word: "thing", start: 0.72, end: 1.0 }
      ]
    })
  });

  assert.equal(transcript.text, "ship the whole thing");
  assert.equal(transcript.source, "whisper.cpp");
  assert.equal(transcript.language, "en");
  assert.equal(transcript.confidence, 0.91);
  assert.equal(transcript.words.length, 4);
  assert.deepEqual(transcript.words[3], { word: "thing", start: 0.72, end: 1 });
});

test("whisper adapter injects -m <model> and the audio path into the runner args", async () => {
  let observedBinary;
  let observedArgs;
  const transcript = await transcribeWithWhisper({
    audio: "turn.wav",
    env: { SUBTEXT_WHISPER_BIN: REAL_FILE, SUBTEXT_WHISPER_MODEL: REAL_FILE, PATH: "" },
    runner: async (binary, args) => {
      observedBinary = binary;
      observedArgs = args;
      return "hello there";
    }
  });

  assert.equal(transcript.text, "hello there");
  assert.equal(observedBinary, REAL_FILE);
  // Model flag is injected before the audio path; audio is always last.
  const modelIndex = observedArgs.indexOf("-m");
  assert.ok(modelIndex >= 0, "expected -m to be present");
  assert.equal(observedArgs[modelIndex + 1], REAL_FILE);
  assert.equal(observedArgs[observedArgs.length - 1], "turn.wav");
});

test("whisper adapter throws an actionable error when SUBTEXT_WHISPER_MODEL is missing", async () => {
  await assert.rejects(
    () => transcribeWithWhisper({
      audio: "turn.wav",
      env: { SUBTEXT_WHISPER_BIN: REAL_FILE, SUBTEXT_WHISPER_MODEL: "/no/such/model-zzzqx.bin", PATH: "" },
      runner: async () => "should not run"
    }),
    (error) => {
      assert.match(error.message, /whisper model not found/);
      assert.match(error.message, /see docs\/WHISPER\.md/);
      return true;
    }
  );
});

test("resolveWhisperModel returns null when SUBTEXT_WHISPER_MODEL is unset", () => {
  // SUBTEXT_MODEL_DIR is pinned to a directory that cannot exist so this test
  // does not depend on whether the machine running it happens to have a
  // whisper model already installed under the real home directory.
  assert.equal(resolveWhisperModel({ PATH: "", SUBTEXT_MODEL_DIR: NONEXISTENT_DIR }), null);
  assert.equal(resolveWhisperModel({ SUBTEXT_WHISPER_MODEL: REAL_FILE, PATH: "" }), REAL_FILE);
});

test("resolveWhisperBinary does not resolve a main.CPL-shaped candidate on Windows (regression)", async () => {
  // Reproduces a real bug: WHISPER_BINARY_NAMES includes the generic name
  // "main", and a machine whose PATHEXT lists Windows shell-associated
  // extensions (.CPL for Control Panel applets, .MSC, .JS, .VBS, ...) would
  // resolve "main" to something like C:\WINDOWS\system32\main.CPL - a Control
  // Panel applet, not a whisper binary. Since whisper is the default STT
  // engine, this silently baffling-ly broke dictate on any such machine.
  //
  // Hermetic: platform is injected as "win32" regardless of the host running
  // this test (CI runs ubuntu/windows/macos), and PATH/PATHEXT point only at
  // a throwaway temp directory this test creates and cleans up itself.
  const dir = await mkdtemp(join(tmpdir(), "subtext-whisper-cpl-"));
  try {
    const cplPath = join(dir, "main.CPL");
    await writeFile(cplPath, "");

    assert.throws(
      () => resolveWhisperBinary(
        {
          PATH: dir,
          PATHEXT: ".COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC;.CPL"
        },
        "win32"
      ),
      (error) => {
        assert.equal(error.message, WHISPER_NOT_FOUND_MESSAGE);
        return true;
      },
      "a main.CPL file on PATH must never be resolved as the whisper binary"
    );

    // Positive control: the same directory resolves once it also has a
    // genuinely executable candidate, proving the restriction is scoped to
    // non-executable extensions and does not lose a legitimate binary.
    const exePath = join(dir, "main.EXE");
    await writeFile(exePath, "");
    assert.equal(
      resolveWhisperBinary(
        {
          PATH: dir,
          PATHEXT: ".COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC;.CPL"
        },
        "win32"
      ),
      exePath
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("buildWhisperArgs places the audio path last and requests JSON by default", () => {
  const args = buildWhisperArgs({ audio: "turn.wav" });
  assert.equal(args[args.length - 1], "turn.wav");
  assert.ok(args.includes("--output-json"));

  const plain = buildWhisperArgs({ audio: "turn.wav", json: false });
  assert.ok(!plain.includes("--output-json"));
  assert.equal(plain[plain.length - 1], "turn.wav");
});

test("whisper runs on the machine's cores, capped, instead of whisper.cpp's fixed 4", () => {
  assert.equal(resolveWhisperThreads({}, 8), 8);
  assert.equal(resolveWhisperThreads({}, 2), 2);
  assert.equal(resolveWhisperThreads({}, 32), 8);
  assert.equal(resolveWhisperThreads({}, 0), 1);
  assert.equal(resolveWhisperThreads({ SUBTEXT_WHISPER_THREADS: "3" }, 8), 3);
  assert.equal(resolveWhisperThreads({ SUBTEXT_WHISPER_THREADS: "lots" }, 8), 8);

  const args = buildWhisperArgs({ audio: "turn.wav", threads: 8 });
  assert.deepEqual(args.slice(args.indexOf("-t"), args.indexOf("-t") + 2), ["-t", "8"]);
  assert.equal(args.at(-1), "turn.wav");

  const callerChoice = buildWhisperArgs({ audio: "turn.wav", threads: 8, extraArgs: ["--threads", "2"] });
  assert.equal(callerChoice.filter((arg) => arg === "-t" || arg === "--threads").length, 1);
  assert.ok(!buildWhisperArgs({ audio: "turn.wav" }).includes("-t"));
});

test("parseWhisperOutput throws on an empty transcript", () => {
  assert.throws(() => parseWhisperOutput("\n\n"), /empty transcript/);
});

test("public entrypoint src/index.js re-exports the transcribe surface", async () => {
  const entrypoint = await import("../src/index.js");
  assert.equal(entrypoint.transcribe, transcribe);
  assert.equal(entrypoint.transcribeWithCommand, transcribeWithCommand);
  assert.equal(entrypoint.transcribeWithWhisper, transcribeWithWhisper);
  assert.deepEqual(entrypoint.ADAPTERS, ADAPTERS);
  assert.equal(typeof entrypoint.DEFAULT_ADAPTER, "string");
  assert.equal(typeof entrypoint.resolveWhisperBinary, "function");
});

test("public entrypoint src/index.js re-exports the STT registry, models, and readiness surface", async () => {
  // package.json exports is {".": "./src/index.js"} with no subpath patterns,
  // so anything missing from this module is unreachable to a consumer of the
  // published package - including the Phase 2/3 surfaces that are supposed to
  // build the vendor badge off ENGINES. This pins the whole new public surface.
  const entrypoint = await import("../src/index.js");
  const engines = await import("../src/transcribe/engines.js");
  const models = await import("../src/transcribe/models.js");
  const doctor = await import("../src/harness/doctor.js");
  const recorder = await import("../src/capture/recorder.js");
  const whisper = await import("../src/transcribe/whisper.js");
  const cloud = await import("../src/transcribe/cloud.js");

  // The registry, identity-equal so there is one source of truth, not a copy.
  assert.equal(entrypoint.ENGINES, engines.ENGINES);
  assert.equal(entrypoint.EGRESS_LEVELS, engines.EGRESS_LEVELS);
  assert.equal(entrypoint.getEngine, engines.getEngine);
  assert.equal(entrypoint.listEngines, engines.listEngines);
  assert.equal(entrypoint.isOfflineEngine, engines.isOfflineEngine);

  assert.equal(entrypoint.transcribeWithCloud, cloud.transcribeWithCloud);
  assert.equal(entrypoint.CLOUD_PROVIDERS, cloud.CLOUD_PROVIDERS);

  assert.equal(entrypoint.listModels, models.listModels);
  assert.equal(entrypoint.downloadModel, models.downloadModel);
  assert.equal(entrypoint.modelDirectory, models.modelDirectory);
  assert.equal(entrypoint.resolveInstalledModel, models.resolveInstalledModel);

  assert.equal(entrypoint.checkSttReadiness, doctor.checkSttReadiness);
  assert.equal(entrypoint.renderSttReadiness, doctor.renderSttReadiness);

  assert.equal(entrypoint.findRecorderOnPath, recorder.findRecorderOnPath);
  assert.equal(entrypoint.resolveWindowsAudioDevice, recorder.resolveWindowsAudioDevice);
  assert.equal(entrypoint.resolveWhisperModel, whisper.resolveWhisperModel);

  // A consumer can read egress off the entrypoint alone - the thing the badge
  // and any CI gate actually need.
  assert.equal(entrypoint.getEngine("webspeech").egress, "vendor");
  assert.ok(entrypoint.getEngine("webspeech").vendor.length > 0);
});

test("the entrypoint keeps the mutable model catalog internal", async () => {
  // MODELS is only shallow-frozen, so exporting it would let a consumer rewrite
  // a pinned sha256 or url at runtime. listModels() is the supported read path.
  const entrypoint = await import("../src/index.js");
  assert.equal(entrypoint.MODELS, undefined);
  assert.equal(typeof entrypoint.listModels, "function");
});
