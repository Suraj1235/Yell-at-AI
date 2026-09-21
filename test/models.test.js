import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  MODELS,
  modelDirectory,
  resolveInstalledModel,
  listModels,
  downloadModel
} from "../src/transcribe/models.js";

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
