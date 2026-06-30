#!/usr/bin/env node
// Vendors the browser-safe core into apps/web/vendor/.
//
// Starting from ../../src/index.browser.js, this walks ONLY static import
// targets (`import ... from "..."` and `export ... from "..."`), preserving
// each module's path layout relative to src/ so the existing relative imports
// keep resolving inside vendor/. It deliberately ignores dynamic `import(...)`
// targets: src/contract/analyzer.js lazily does `import("../audio/wav.js")`,
// which pulls in node:fs and must never reach the browser.
//
// One static edge in the reachable graph is node-only: src/calibration/baseline.js
// statically imports readWavFile from ../audio/wav.js (which imports node:fs/promises).
// analyzeSamples never calls it, but a browser ESM loader still instantiates the
// whole graph and would fail to resolve `node:fs/promises`. So any reachable module
// whose source statically imports a `node:` builtin is replaced in vendor/ with a
// browser shim that re-exports the same names as throwing stubs. The relative import
// keeps resolving; the node code never lands in the bundle.
//
// The result is committed so the site deploys with no build step.

import { readFile, writeFile, mkdir, rm, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(here, "..", "..", "src");
const entry = join(srcRoot, "index.browser.js");
const vendorRoot = join(here, "vendor");

// Match `... from "<spec>"` / `... from '<spec>'` for static import/export.
// We only resolve relative specifiers (./ or ../); bare and node: specifiers
// are handled separately.
const STATIC_FROM_RE = /\bfrom\s*["']([^"']+)["']/g;
// Side-effect imports: `import "<spec>";` (no `from`).
const SIDE_EFFECT_IMPORT_RE = /\bimport\s*["']([^"']+)["']/g;
// A module is node-only if it statically pulls in a node: builtin.
const NODE_IMPORT_RE = /\bfrom\s*["']node:|^\s*import\s+["']node:/m;
// Named exports, for generating shim stubs: `export function foo`, `export const foo`,
// `export class Foo`, `export async function foo`, and `export { a, b as c }`.
const EXPORT_DECL_RE = /\bexport\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g;
const EXPORT_LIST_RE = /\bexport\s*\{([^}]*)\}/g;

function collectStaticSpecifiers(source) {
  const specifiers = new Set();
  for (const match of source.matchAll(STATIC_FROM_RE)) specifiers.add(match[1]);
  for (const match of source.matchAll(SIDE_EFFECT_IMPORT_RE)) specifiers.add(match[1]);
  return [...specifiers];
}

function collectExportedNames(source) {
  const names = new Set();
  for (const match of source.matchAll(EXPORT_DECL_RE)) names.add(match[1]);
  for (const match of source.matchAll(EXPORT_LIST_RE)) {
    for (const part of match[1].split(",")) {
      const piece = part.trim();
      if (!piece || piece.startsWith("type ")) continue;
      // `a as b` exports as `b`; `a` exports as `a`. Re-exports (`from`) are
      // handled by graph walking, not here.
      const asMatch = piece.match(/\bas\s+([A-Za-z_$][\w$]*)/);
      const name = asMatch ? asMatch[1] : piece;
      if (/^[A-Za-z_$][\w$]*$/.test(name) && name !== "default") names.add(name);
    }
  }
  return [...names];
}

function isRelative(specifier) {
  return specifier.startsWith("./") || specifier.startsWith("../");
}

function shimSource(relPathFromSrc, exportedNames) {
  const reason =
    `Browser shim for ${relPathFromSrc}: this module uses Node-only APIs ` +
    `(e.g. node:fs) and is never invoked on the client analyze path.`;
  const stubs = exportedNames
    .map(
      (name) =>
        `export function ${name}() {\n  throw new Error(${JSON.stringify(
          `${name}() is not available in the browser build. ${reason}`
        )});\n}`
    )
    .join("\n\n");
  return (
    `// AUTO-GENERATED browser shim — do not edit by hand.\n` +
    `// ${reason}\n` +
    `// Regenerate with: node apps/web/build.mjs\n\n` +
    (stubs || `export {};\n`) +
    "\n"
  );
}

async function build() {
  // Clean vendor/ so removed core files don't linger.
  await rm(vendorRoot, { recursive: true, force: true });
  await mkdir(vendorRoot, { recursive: true });

  /** @type {Map<string, { kind: "copy" | "shim", source: string, names?: string[] }>} */
  const plan = new Map();
  const queue = [entry];

  while (queue.length) {
    const absPath = queue.shift();
    const relFromSrc = relative(srcRoot, absPath).split("\\").join("/");
    if (plan.has(relFromSrc)) continue;

    let source;
    try {
      source = await readFile(absPath, "utf8");
    } catch (error) {
      throw new Error(`Cannot read static import target ${relFromSrc}: ${error.message}`);
    }

    if (NODE_IMPORT_RE.test(source)) {
      // Node-only module reached via a static edge — shim it, do NOT recurse.
      plan.set(relFromSrc, {
        kind: "shim",
        source: shimSource(relFromSrc, collectExportedNames(source))
      });
      continue;
    }

    plan.set(relFromSrc, { kind: "copy", source });

    for (const specifier of collectStaticSpecifiers(source)) {
      if (!isRelative(specifier)) continue; // skip bare/node: specifiers
      const target = resolve(dirname(absPath), specifier);
      const targetRel = relative(srcRoot, target).split("\\").join("/");
      if (targetRel.startsWith("..")) {
        throw new Error(
          `Refusing to vendor ${specifier} (resolves outside src/) imported by ${relFromSrc}.`
        );
      }
      queue.push(target);
    }
  }

  // Write the plan.
  let copied = 0;
  let shimmed = 0;
  for (const [relFromSrc, entryPlan] of [...plan].sort((a, b) => a[0].localeCompare(b[0]))) {
    const outPath = join(vendorRoot, relFromSrc);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, entryPlan.source);
    if (entryPlan.kind === "shim") shimmed += 1;
    else copied += 1;
  }

  return { copied, shimmed, files: [...plan.keys()].sort() };
}

async function verify() {
  // Load the vendored entry the way a browser would: reject any node: specifier.
  const probe = pathToFileURL(join(vendorRoot, "index.browser.js")).href;
  // We cannot register a loader hook from inside an async function portably, so
  // instead we statically scan every vendored file for a `node:` import. If the
  // walk did its job, zero remain.
  const offenders = [];
  async function scan(dir) {
    for (const name of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, name.name);
      if (name.isDirectory()) {
        await scan(full);
      } else if (name.name.endsWith(".js")) {
        const source = await readFile(full, "utf8");
        if (NODE_IMPORT_RE.test(source)) {
          offenders.push(relative(vendorRoot, full).split("\\").join("/"));
        }
      }
    }
  }
  await scan(vendorRoot);
  if (offenders.length) {
    throw new Error(
      `Vendored bundle still contains node: imports (not browser-safe): ${offenders.join(", ")}`
    );
  }
  // Confirm the entry actually imports and runs the engine.
  const mod = await import(probe);
  if (typeof mod.analyzeSamples !== "function" || typeof mod.renderVocalContext !== "function") {
    throw new Error("Vendored index.browser.js is missing analyzeSamples/renderVocalContext.");
  }
  const sampleRate = 16000;
  const samples = new Float32Array(sampleRate);
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = Math.sin((2 * Math.PI * 150 * i) / sampleRate);
  }
  const result = mod.analyzeSamples({ samples, sampleRate, text: "vendored bundle smoke test" });
  if (result.schema !== "vocalcontext/v1") {
    throw new Error(`Expected vocalcontext/v1, got ${result.schema}`);
  }
  return result.schema;
}

const { copied, shimmed, files } = await build();
const schema = await verify();
console.log(`Vendored ${copied} browser-safe module(s) + ${shimmed} shim(s) into apps/web/vendor/:`);
for (const file of files) console.log(`  ${file}`);
console.log(`Verified: vendored index.browser.js runs analyzeSamples -> schema "${schema}".`);
