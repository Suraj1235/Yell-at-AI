import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  MODELS,
  modelDirectory,
  resolveInstalledModel,
  listModels,
  downloadModel
} from "../src/transcribe/models.js";
import { parseModelDownloadArgs } from "../src/cli.js";

const CLI_BIN = fileURLToPath(new URL("../bin/subtext.js", import.meta.url));

// Drives `subtext model download ...` as a real child process (process.execPath,
// never the bare "node" string, which on Windows resolves against the child's
// own PATH rather than this process's interpreter). This helper is used ONLY
// for the refusal cases below: the CLI's `if (!consent) { ...; return; }`
// branch never calls downloadModel() and never touches fetch, so spawning it
// is fully hermetic. The two "consent granted" cases are deliberately NOT
// tested this way - the CLI's real downloadModel() uses the global fetch
// with no injection point, so spawning it would start a real DNS
// lookup/connect to huggingface.co before any kill signal could land. Those
// two cases are instead covered below as direct unit tests of
// parseModelDownloadArgs(), which is exactly the ordering logic that broke -
// zero process spawning, zero network, by construction.
function runModelDownload(args, { env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_BIN, "model", "download", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env }
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

test("the catalog has real-looking checksums and sizes for every model", () => {
  const ids = Object.keys(MODELS);
  assert.ok(ids.includes("base.en"), "base.en is the shipped default");
  for (const [id, model] of Object.entries(MODELS)) {
    assert.match(model.sha256, /^[0-9a-f]{64}$/, `${id}: sha256 must be 64 lowercase hex chars`);
    assert.ok(model.bytes > 1_000_000, `${id}: bytes looks wrong (${model.bytes})`);
    assert.match(model.url, /^https:\/\//, `${id}: url must be https`);
    assert.ok(model.file.endsWith(".bin"), `${id}: file must be a ggml .bin`);
  }
});

test("modelDirectory honours SUBTEXT_MODEL_DIR", () => {
  assert.equal(modelDirectory({ SUBTEXT_MODEL_DIR: "/custom/models" }), "/custom/models");
});

test("resolveInstalledModel returns null when nothing is installed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "subtext-models-"));
  assert.equal(resolveInstalledModel("base.en", { SUBTEXT_MODEL_DIR: dir }), null);
});

test("resolveInstalledModel finds a model that is present", async () => {
  const dir = await mkdtemp(join(tmpdir(), "subtext-models-"));
  const path = join(dir, MODELS["base.en"].file);
  await writeFile(path, "not-a-real-model");
  assert.equal(resolveInstalledModel("base.en", { SUBTEXT_MODEL_DIR: dir }), path);
});

test("listModels reports installed state per model", async () => {
  const dir = await mkdtemp(join(tmpdir(), "subtext-models-"));
  await writeFile(join(dir, MODELS["base.en"].file), "x");
  const listed = listModels({ SUBTEXT_MODEL_DIR: dir });
  assert.equal(listed.find((entry) => entry.id === "base.en").installed, true);
  assert.equal(listed.find((entry) => entry.id === "tiny.en").installed, false);
});

test("downloadModel refuses to touch the network without explicit consent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "subtext-models-"));
  await assert.rejects(
    downloadModel("base.en", {
      env: { SUBTEXT_MODEL_DIR: dir },
      consent: false,
      fetchImpl: async () => {
        throw new Error("the network must not be touched without consent");
      }
    }),
    /requires explicit consent/
  );
});

test("downloadModel rejects and deletes a file whose checksum does not match", async () => {
  const dir = await mkdtemp(join(tmpdir(), "subtext-models-"));
  await assert.rejects(
    downloadModel("base.en", {
      env: { SUBTEXT_MODEL_DIR: dir },
      consent: true,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: new Map([["content-length", "17"]]),
        arrayBuffer: async () => new TextEncoder().encode("tampered-payload!").buffer
      })
    }),
    /checksum mismatch/
  );
  assert.equal(resolveInstalledModel("base.en", { SUBTEXT_MODEL_DIR: dir }), null,
    "a failed download must leave nothing behind");
});

test("downloadModel writes the file when the checksum matches", async () => {
  const dir = await mkdtemp(join(tmpdir(), "subtext-models-"));
  const payload = new TextEncoder().encode("pretend-model-bytes");
  const digest = createHash("sha256").update(payload).digest("hex");

  const path = await downloadModel("base.en", {
    env: { SUBTEXT_MODEL_DIR: dir },
    consent: true,
    expectedSha256: digest,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: new Map([["content-length", String(payload.length)]]),
      arrayBuffer: async () => payload.buffer
    })
  });

  assert.equal(await readFile(path, "utf8"), "pretend-model-bytes");
});

// Unit-level coverage for the exact thing that broke: --yes must be honoured
// regardless of where it appears relative to the model id, without ever
// spawning a process or touching the network. This is the ordering logic
// used directly by the `model download` branch in src/cli.js.
test("parseModelDownloadArgs: <id> --yes consents (id before --yes)", () => {
  assert.deepEqual(parseModelDownloadArgs(["tiny.en", "--yes"]), { id: "tiny.en", consent: true });
});

test("parseModelDownloadArgs: --yes <id> consents (--yes before id, the regression case)", () => {
  assert.deepEqual(parseModelDownloadArgs(["--yes", "tiny.en"]), { id: "tiny.en", consent: true });
});

test("parseModelDownloadArgs: --yes alone consents and defaults the id to base.en", () => {
  assert.deepEqual(parseModelDownloadArgs(["--yes"]), { id: "base.en", consent: true });
});

test("parseModelDownloadArgs: <id> with no --yes does not consent", () => {
  assert.deepEqual(parseModelDownloadArgs(["tiny.en"]), { id: "tiny.en", consent: false });
});

test("parseModelDownloadArgs: no tokens at all does not consent and defaults the id", () => {
  assert.deepEqual(parseModelDownloadArgs([]), { id: "base.en", consent: false });
});

test("parseModelDownloadArgs: --yes=false never consents (single joined token)", () => {
  assert.deepEqual(parseModelDownloadArgs(["--yes=false"]), { id: "base.en", consent: false });
  assert.deepEqual(parseModelDownloadArgs(["tiny.en", "--yes=false"]), { id: "tiny.en", consent: false });
});

test("parseModelDownloadArgs: --yes false (space-separated explicit false) never consents", () => {
  assert.deepEqual(parseModelDownloadArgs(["--yes", "false"]), { id: "base.en", consent: false });
  assert.deepEqual(parseModelDownloadArgs(["tiny.en", "--yes", "false"]), { id: "tiny.en", consent: false });
});

test("parseModelDownloadArgs: --yes true (space-separated explicit true) consents", () => {
  assert.deepEqual(parseModelDownloadArgs(["--yes", "true"]), { id: "base.en", consent: true });
});

test("CLI: model download <id> with no --yes refuses and exits non-zero", async () => {
  const dir = await mkdtemp(join(tmpdir(), "subtext-models-"));
  const result = await runModelDownload(["tiny.en"], { env: { SUBTEXT_MODEL_DIR: dir } });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Re-run with --yes to confirm/);
});

test("CLI: model download --yes=false refuses (never widens consent to any --yes token)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "subtext-models-"));
  const result = await runModelDownload(["--yes=false"], { env: { SUBTEXT_MODEL_DIR: dir } });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Re-run with --yes to confirm/);
});

test("CLI: model download --yes false (space-separated explicit false) refuses", async () => {
  const dir = await mkdtemp(join(tmpdir(), "subtext-models-"));
  const result = await runModelDownload(["--yes", "false"], { env: { SUBTEXT_MODEL_DIR: dir } });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /Re-run with --yes to confirm/);
});
