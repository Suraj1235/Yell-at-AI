import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkSttReadiness, runHarnessDoctor, renderHarnessDoctor } from "../src/harness/doctor.js";
import { EGRESS_LEVELS } from "../src/transcribe/engines.js";

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

// The whole point of the engine registry is that egress is machine-readable.
// checkSttReadiness used to be called only from the text renderer, so
// `subtext doctor --format json` -- the one consumer that cannot read prose --
// shipped no STT section at all.
test("the doctor report exposes per-engine egress on the machine-readable path", async (t) => {
  // SUBTEXT_MODEL_DIR is pinned so listModels/modelDirectory never stat the
  // developer's real home directory.
  const models = await mkdtemp(join(tmpdir(), "subtext-doctor-"));
  t.after(() => rm(models, { recursive: true, force: true }));

  const report = await runHarnessDoctor({
    env: { PATH: "", SUBTEXT_MODEL_DIR: models },
    platform: "linux"
  });

  assert.ok(report.stt, "runHarnessDoctor must include the STT section in its report");
  assert.ok(Array.isArray(report.stt.engines) && report.stt.engines.length > 0);

  for (const engine of report.stt.engines) {
    assert.ok(
      EGRESS_LEVELS.includes(engine.egress),
      `${engine.id}: --format json must carry a machine-readable egress level, got ${engine.egress}`
    );
  }

  const byId = Object.fromEntries(report.stt.engines.map((engine) => [engine.id, engine]));
  assert.equal(byId.whisper.egress, "none");
  assert.equal(byId.cloud.egress, "vendor", "a JSON consumer must be able to see cloud sends audio out");
  assert.equal(byId.command.egress, "unknown");
  assert.equal(report.stt.modelDirectory, models);

  // The whole report must survive JSON.stringify -- that is how the CLI emits it.
  const roundTripped = JSON.parse(JSON.stringify(report));
  assert.equal(roundTripped.stt.engines.length, report.stt.engines.length);
  assert.equal(roundTripped.stt.engines.find((e) => e.id === "cloud").egress, "vendor");
});

test("the text renderer uses the report's snapshot rather than recomputing it", async (t) => {
  const models = await mkdtemp(join(tmpdir(), "subtext-doctor-"));
  t.after(() => rm(models, { recursive: true, force: true }));

  const report = await runHarnessDoctor({
    env: { PATH: "", SUBTEXT_MODEL_DIR: models },
    platform: "linux"
  });
  const text = renderHarnessDoctor(report);

  assert.match(text, /Speech-to-text/);
  assert.match(text, /\[sends audio to /, "the text output still names the vendor for vendor egress");
  assert.ok(
    text.includes(models),
    "the rendered section must reflect the injected environment the report was built from"
  );
});
