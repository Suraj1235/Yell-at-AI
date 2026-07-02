import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { join } from "node:path";
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
