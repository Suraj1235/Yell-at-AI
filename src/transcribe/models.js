// Whisper ggml model manager.
//
// Subtext never bundles model weights and never downloads anything on its own.
// downloadModel() throws unless the caller passes consent: true, which the CLI
// only sets after the user confirms. Every download is checksum-verified against
// src/transcribe/models.json and written atomically, so an interrupted or
// tampered download can never leave a half-model that whisper.cpp would load.
import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
export const MODELS = Object.freeze(require("./models.json"));

export function modelDirectory(env = process.env) {
  return env.SUBTEXT_MODEL_DIR || join(homedir(), ".subtext", "models");
}

function modelSpec(id) {
  const model = MODELS[id];
  if (!model) {
    throw new Error(`Unknown whisper model: ${id}. Available: ${Object.keys(MODELS).join(", ")}.`);
  }
  return model;
}

export function resolveInstalledModel(id, env = process.env) {
  const path = join(modelDirectory(env), modelSpec(id).file);
  return existsSync(path) ? path : null;
}

export function listModels(env = process.env) {
  return Object.values(MODELS).map((model) => {
    const path = join(modelDirectory(env), model.file);
    const installed = existsSync(path);
    return {
      id: model.id,
      installed,
      path: installed ? path : null,
      bytes: installed ? statSync(path).size : model.bytes,
      note: model.note
    };
  });
}

export async function downloadModel(id, {
  env = process.env,
  fetchImpl = fetch,
  onProgress = null,
  consent = false,
  expectedSha256 = null
} = {}) {
  const model = modelSpec(id);

  if (consent !== true) {
    throw new Error(
      `Downloading the ${id} model requires explicit consent. Subtext never fetches model ` +
      `weights on its own. Re-run with --yes, or download ${model.file} yourself and put it in ` +
      `${modelDirectory(env)}.`
    );
  }

  const directory = modelDirectory(env);
  await mkdir(directory, { recursive: true });
  const finalPath = join(directory, model.file);
  const partPath = `${finalPath}.part`;

  const response = await fetchImpl(model.url);
  if (!response.ok) {
    throw new Error(`Model download failed: HTTP ${response.status} from ${model.url}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  onProgress?.({ id, received: bytes.length, total: model.bytes });

  const digest = createHash("sha256").update(bytes).digest("hex");
  const expected = expectedSha256 ?? model.sha256;
  if (digest !== expected) {
    await rm(partPath, { force: true });
    throw new Error(
      `Model checksum mismatch for ${id}: expected ${expected}, got ${digest}. ` +
      `The download was discarded. Retry, or install the model manually.`
    );
  }

  // Atomic: write beside the target, then rename, so a crash never leaves a
  // truncated file that looks installed.
  await writeFile(partPath, bytes);
  await rename(partPath, finalPath);
  return finalPath;
}
