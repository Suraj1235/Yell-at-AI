import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ENGINES,
  EGRESS_LEVELS,
  getEngine,
  listEngines,
  isOfflineEngine
} from "../src/transcribe/engines.js";

test("every engine declares a known egress level", () => {
  const ids = Object.keys(ENGINES);
  assert.ok(ids.length >= 5, `expected at least 5 engines, got ${ids.length}`);
  for (const [id, engine] of Object.entries(ENGINES)) {
    assert.equal(engine.id, id, `${id}: id field must match its registry key`);
    assert.ok(EGRESS_LEVELS.includes(engine.egress), `${id}: bad egress ${engine.egress}`);
    assert.ok(engine.label.length > 0, `${id}: needs a human label`);
    assert.ok(engine.description.length > 0, `${id}: needs a description`);
    assert.ok(engine.runtimes.length > 0, `${id}: needs at least one runtime`);
  }
});

test("any engine that sends audio to a vendor must name the vendor", () => {
  for (const engine of Object.values(ENGINES)) {
    if (engine.egress === "vendor") {
      assert.ok(
        typeof engine.vendor === "string" && engine.vendor.length > 0,
        `${engine.id}: egress "vendor" requires a non-empty vendor name`
      );
    } else {
      assert.equal(engine.vendor, null, `${engine.id}: only vendor-egress engines name a vendor`);
    }
  }
});

test("whisper is offline and webspeech is not", () => {
  assert.equal(isOfflineEngine("whisper"), true);
  assert.equal(isOfflineEngine("webspeech"), false);
  assert.equal(ENGINES.webspeech.egress, "vendor");
});

test("listEngines filters by runtime", () => {
  const browser = listEngines("browser").map((engine) => engine.id);
  assert.ok(browser.includes("webspeech"));
  assert.ok(!browser.includes("whisper"), "whisper.cpp is a Node-only subprocess adapter");
});

test("getEngine throws an actionable error for an unknown id", () => {
  assert.throws(() => getEngine("nope"), /Unknown transcribe engine: nope\. Available: /);
});
