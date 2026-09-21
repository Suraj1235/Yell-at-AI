import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveDictateEngine } from "../src/cli.js";

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "bin", "subtext.js");

test("engine precedence is --engine over env over the offline default", () => {
  assert.equal(resolveDictateEngine({ engine: "cloud" }, { SUBTEXT_STT_ENGINE: "command" }), "cloud");
  assert.equal(resolveDictateEngine({}, { SUBTEXT_STT_ENGINE: "command" }), "command");
  assert.equal(resolveDictateEngine({}, {}), "whisper", "the shipped default must be offline");
});

test("an unknown engine is rejected with the list of available engines", () => {
  assert.throws(() => resolveDictateEngine({ engine: "nope" }, {}), /Available: /);
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
