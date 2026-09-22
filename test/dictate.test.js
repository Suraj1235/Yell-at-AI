import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveDictateEngine, dictatableEngines } from "../src/cli.js";
import { ADAPTERS } from "../src/transcribe/index.js";
import { listEngines } from "../src/transcribe/engines.js";

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "bin", "subtext.js");
const FAKE_RECORDER = "node scripts/fake-recorder.mjs {out}";

test("engine precedence is --engine over env over the offline default", () => {
  assert.equal(resolveDictateEngine({ engine: "cloud" }, { SUBTEXT_STT_ENGINE: "command" }), "cloud");
  assert.equal(resolveDictateEngine({}, { SUBTEXT_STT_ENGINE: "command" }), "command");
  assert.equal(resolveDictateEngine({}, {}), "whisper", "the shipped default must be offline");
});

test("an unknown engine is rejected with the list of available engines", () => {
  assert.throws(() => resolveDictateEngine({ engine: "nope" }, {}), /Available: /);
});

// The structural guard. Validation used to run against ENGINES (5 ids) while
// dispatch ran against ADAPTERS (4), so a browser-only id passed the check and
// blew up after the microphone had already run. This asserts the two lists
// cannot drift again as the registry grows.
test("every node-runtime engine has a dispatchable adapter", () => {
  for (const engine of listEngines("node")) {
    assert.ok(
      ADAPTERS.includes(engine.id),
      `${engine.id} is registered for the node runtime but transcribe() cannot dispatch it`
    );
  }
});

test("dictatableEngines is exactly the node engines that transcribe() can run", () => {
  assert.deepEqual(dictatableEngines(), ["whisper", "cloud", "command"].filter((id) => ADAPTERS.includes(id)));
  assert.ok(!dictatableEngines().includes("whisper-wasm"), "whisper-wasm is browser-only");
  assert.ok(!dictatableEngines().includes("webspeech"), "webspeech is browser-only");
});

test("a browser-only engine is rejected up front, with one coherent list", () => {
  // whisper-wasm stays in ENGINES - it is correctly registered for the browser
  // surface - but the CLI must not offer it.
  assert.throws(
    () => resolveDictateEngine({ engine: "whisper-wasm" }, {}),
    (error) => {
      assert.match(error.message, /browser only/i, "the message must say why, not just that it failed");
      assert.match(error.message, /Available: whisper, cloud, command\./);
      assert.doesNotMatch(error.message, /whisper-wasm.*Available:.*whisper-wasm/s, "the rejected id must not appear in the offer");
      return true;
    }
  );
  assert.throws(() => resolveDictateEngine({ engine: "webspeech" }, {}), /browser only/i);
});

test("dictate --engine whisper-wasm fails BEFORE it records anything", async () => {
  // A real capture is wired up (fake recorder, so no microphone is needed). If
  // validation ran late, this would record, write the file, and only then fail
  // with a second engine list wrapped in "your recording was saved".
  const capturePath = join(ROOT, "tmp", `dictate-wasm-reject-${process.pid}.wav`);
  try {
    const error = await run(process.execPath, [CLI, "dictate",
      "--engine", "whisper-wasm",
      "--duration", "1",
      "--record-command", FAKE_RECORDER,
      "--audio-out", capturePath]
    ).catch((caught) => caught);

    assert.ok(error.code !== 0, "an unusable engine must be a non-zero exit");
    assert.match(error.stderr, /browser only/i);
    assert.match(error.stderr, /Available: whisper, cloud, command\./);
    assert.doesNotMatch(
      error.stderr,
      /Your recording was saved/,
      "a rejected engine must never produce a recording-recovery message"
    );
    assert.doesNotMatch(
      error.stderr,
      /Unknown transcribe adapter/,
      "the user must get one engine list, not two contradictory ones"
    );
    assert.equal(existsSync(capturePath), false, "nothing may be recorded before the engine is validated");
  } finally {
    await rm(capturePath, { force: true });
  }
});

test("dictate --engine cloud without a key fails with an actionable message", async () => {
  // No --text here: an explicit transcript short-circuits STT entirely (see
  // dictateFromArgs in src/cli.js), which would skip the cloud adapter and this
  // assertion would never be exercised. Omitting it forces the real STT path.
  const error = await run("node", [CLI, "dictate", "--engine", "cloud", "--audio",
    join(ROOT, "eval", "fixtures", "emphasis.wav")],
    { env: { ...process.env, SUBTEXT_CLOUD_API_KEY: "", GROQ_API_KEY: "", DEEPGRAM_API_KEY: "" } }
  ).catch((caught) => caught);

  assert.ok(error.code !== 0, "missing credentials must be a non-zero exit");
  assert.match(error.stderr, /SUBTEXT_CLOUD_API_KEY/);
});

test("dictate accepts a pre-recorded --audio and skips capture entirely", async () => {
  const { stdout } = await run("node", [CLI, "dictate",
    "--audio", join(ROOT, "eval", "fixtures", "emphasis.wav"),
    "--text", "ship the whole thing",
    "--format", "prompt"
  ]);

  assert.match(stdout, /<vocal-context schema="vocalcontext\/v1">/);
  assert.match(stdout, /Emphasis: whole/);
  assert.match(stdout, /ship the whole thing/);
});

test("dictate --engine whisper with no binary fails open: the transcript still reaches the user", async () => {
  // process.execPath (not the bare "node") so the child process itself is found
  // by absolute path: on Windows, spawn resolves a bare command name using the
  // *child's* PATH, so clearing PATH below would otherwise fail to launch node
  // at all (ENOENT) rather than exercising the CLI's whisper-not-found path.
  const error = await run(process.execPath, [CLI, "dictate",
    "--audio", join(ROOT, "eval", "fixtures", "emphasis.wav"),
    "--engine", "whisper"],
    { env: { ...process.env, SUBTEXT_WHISPER_BIN: "/no/such/binary-zzzqx", PATH: "" } }
  ).catch((caught) => caught);

  assert.ok(error.code !== 0);
  assert.match(error.stderr, /whisper binary not found/);
  assert.match(error.stderr, /docs\/WHISPER\.md/, "the error must point at the install guide");
});

test("dictate fails open after a real capture: the error names the saved audio path and how to recover it", async () => {
  // Drives a real capture (via --record-command, so no microphone is needed
  // and the outcome cannot depend on what recorder happens to be installed on
  // the CI runner) and then forces the post-capture STT stage to fail. The
  // fix under test: dictateFromArgs must not let that read like the user's
  // words are gone - the recording was never deleted, so the error must name
  // where it landed and how to recover it.
  const capturePath = join(ROOT, "tmp", `dictate-fail-open-${process.pid}.wav`);
  try {
    const error = await run("node", [CLI, "dictate",
      "--duration", "1",
      "--record-command", FAKE_RECORDER,
      "--audio-out", capturePath,
      "--engine", "whisper"],
      { env: { ...process.env, SUBTEXT_WHISPER_BIN: "/no/such/binary-zzzqx" } }
    ).catch((caught) => caught);

    assert.ok(error.code !== 0, "a post-capture failure must still be a non-zero exit");
    assert.match(error.stderr, /whisper binary not found/, "the underlying cause must survive, not be replaced");
    assert.match(
      error.stderr,
      new RegExp(capturePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      "the error must name where the recording was saved"
    );
    assert.match(error.stderr, /subtext analyze --audio/, "the error must tell the user how to recover the recording");
  } finally {
    await rm(capturePath, { force: true });
  }
});

test("dictate --audio (caller-supplied recording) does not claim to have saved anything on failure", async () => {
  // The --audio path never captured anything itself, so a post-capture
  // failure must surface the underlying cause unwrapped, with no invented
  // "saved to" / recovery text about a file the caller already owns.
  const error = await run("node", [CLI, "dictate",
    "--audio", join(ROOT, "eval", "fixtures", "emphasis.wav"),
    "--engine", "whisper"],
    { env: { ...process.env, SUBTEXT_WHISPER_BIN: "/no/such/binary-zzzqx" } }
  ).catch((caught) => caught);

  assert.ok(error.code !== 0);
  assert.match(error.stderr, /whisper binary not found/);
  assert.doesNotMatch(error.stderr, /Your recording was saved/, "the caller's own --audio file is not something we saved");
});
