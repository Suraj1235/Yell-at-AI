import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { buildAdapterBundles } from "../src/index.js";
import { ROOT } from "../src/harness/bundles.js";

test("buildAdapterBundles emits relative, forward-slash bundle paths on every platform", async () => {
  const stamp = `bundles-test-${process.pid}-${Date.now()}`;
  const outRoot = join(ROOT, "tmp", stamp);
  try {
    const index = await buildAdapterBundles({ outRoot });
    assert.ok(index.bundles.length > 0, "expected at least one bundle");
    for (const bundle of index.bundles) {
      assert.doesNotMatch(bundle.path, /^[A-Za-z]:[\\/]/, `${bundle.path} looks absolute`);
      assert.ok(!bundle.path.startsWith("/"), `${bundle.path} starts with /`);
      assert.doesNotMatch(bundle.path, /\\/, `${bundle.path} contains a backslash`);
      assert.match(bundle.path, new RegExp(`^tmp/${stamp}/`), `${bundle.path} does not look relative to root`);
    }
  } finally {
    await rm(outRoot, { recursive: true, force: true });
  }
});

test("buildAdapterBundles defaults outRoot to process.cwd(), not the package root (installed-package footgun)", async () => {
  // realpath matters here, and only on macOS: os.tmpdir() reports /var/folders/...
  // but /var is a symlink to /private/var, so once we chdir into the scratch dir
  // process.cwd() — which is what buildAdapterBundles derives bundle paths from —
  // reports the resolved /private/var/... form. Comparing the resolved actual
  // against an unresolved expected fails on every macOS runner.
  const scratchCwd = await realpath(await mkdtemp(join(tmpdir(), "subtext-bundles-cwd-")));
  const originalCwd = process.cwd();
  process.chdir(scratchCwd);
  try {
    const index = await buildAdapterBundles({ root: ROOT });
    assert.ok(index.bundles.length > 0, "expected at least one bundle");
    const expectedOutRoot = join(scratchCwd, "dist", "adapters");
    const writtenIndex = JSON.parse(await readFile(join(expectedOutRoot, "index.json"), "utf8"));
    assert.deepEqual(writtenIndex, index, "default outRoot should be under process.cwd(), not the package root");
    for (const bundle of index.bundles) {
      const expectedPath = resolve(join(expectedOutRoot, bundle.id));
      assert.equal(
        bundle.path,
        expectedPath,
        `${bundle.path} should be the native absolute bundle dir when outRoot is outside root (cross-drive on this machine)`
      );
    }
  } finally {
    process.chdir(originalCwd);
    await rm(scratchCwd, { recursive: true, force: true });
  }
});
