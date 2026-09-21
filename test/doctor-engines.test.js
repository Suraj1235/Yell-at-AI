import assert from "node:assert/strict";
import { test } from "node:test";
import { checkSttReadiness } from "../src/harness/doctor.js";

// Every test below pins `platform` explicitly to "linux". findRecorderOnPath
// checks macOS's afrecord by a fixed absolute path (/usr/bin/afrecord) rather
// than via PATH, so a bogus-PATH test that expects "recorder not found" would
// be flaky/wrong on the darwin CI runner unless platform is pinned. Node
// itself is not on any of RECORDERS_BY_PLATFORM's lists, so pinning "linux"
// here does not risk accidentally finding the real test runner's binary.

test("readiness reports every Node-runnable engine with its egress level", () => {
  const readiness = checkSttReadiness({ PATH: "" }, "linux");
  const ids = readiness.engines.map((engine) => engine.id);
  assert.ok(ids.includes("whisper"));
  assert.ok(ids.includes("cloud"));
  assert.ok(ids.includes("command"));
  assert.ok(!ids.includes("webspeech"), "browser-only engines are not Node readiness checks");

  for (const engine of readiness.engines) {
    assert.ok(["none", "vendor", "unknown"].includes(engine.egress));
    assert.equal(typeof engine.ready, "boolean");
    assert.ok(engine.detail.length > 0, `${engine.id} must explain its state`);
  }
});

test("whisper is reported not-ready with an actionable detail when no binary exists", () => {
  const readiness = checkSttReadiness({ PATH: "", SUBTEXT_WHISPER_BIN: "/no/such/bin-zzzqx" }, "linux");
  const whisper = readiness.engines.find((engine) => engine.id === "whisper");
  assert.equal(whisper.ready, false);
  assert.match(whisper.detail, /docs\/WHISPER\.md|whisper binary not found/);
});

test("cloud is reported ready only when a key is present", () => {
  assert.equal(
    checkSttReadiness({ PATH: "" }, "linux").engines.find((e) => e.id === "cloud").ready,
    false
  );
  assert.equal(
    checkSttReadiness({ PATH: "", SUBTEXT_CLOUD_API_KEY: "k" }, "linux").engines.find((e) => e.id === "cloud").ready,
    true
  );
});

test("readiness reports the recorder situation", () => {
  const readiness = checkSttReadiness({ PATH: "/no/such/dir-zzzqx" }, "linux");
  assert.equal(readiness.recorder.ready, false);
  assert.match(readiness.recorder.detail, /ffmpeg/);
});
