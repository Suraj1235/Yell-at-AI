import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { analyzeFile } from "../src/index.js";

const schema = JSON.parse(await readFile(new URL("../schemas/vocalcontext.v1.schema.json", import.meta.url), "utf8"));
const transcriptSchema = JSON.parse(await readFile(new URL("../schemas/transcript.v1.schema.json", import.meta.url), "utf8"));

test("vocalcontext/v1 schema keeps the public contract strict", () => {
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ["schema", "text", "emphasis", "prosody", "flags", "calibration"]);
  assert.equal(schema.properties.schema.const, "vocalcontext/v1");
  assert.deepEqual(schema.properties.alignment.properties.source.enum, ["platform_word_timestamps", "proportional"]);
  assert.ok(schema.properties.affect.properties.emotional_coloring.enum.includes("emphatic"));
  assert.ok(schema.properties.assistant_guidance.properties.priority.enum.includes("de_escalate"));
  assert.ok(schema.properties.assistant_guidance.properties.directives.items.properties.type.enum.includes("preserve_emphasis"));
  assert.deepEqual(schema.properties.transcript.required, ["source", "word_timestamps"]);
});

test("subtext/transcript/v1 schema documents the native voice bridge", () => {
  assert.equal(transcriptSchema.additionalProperties, true);
  assert.deepEqual(transcriptSchema.required, ["schema", "text", "source"]);
  assert.equal(transcriptSchema.properties.schema.const, "subtext/transcript/v1");
  assert.equal(transcriptSchema.properties.confidence.maximum, 1);
  assert.deepEqual(transcriptSchema.properties.wordTimings.items.required, ["word", "start", "end"]);
  assert.equal(transcriptSchema.properties.wordTimings.items.properties.phones.items.required.includes("start"), true);
});

test("analyzer output conforms to the required schema shape", async () => {
  const contract = await analyzeFile(
    new URL("../eval/fixtures/emphasis.wav", import.meta.url).pathname,
    "can we just refactor the whole auth module"
  );

  assert.equal(contract.schema, "vocalcontext/v1");
  assert.equal(typeof contract.text, "string");
  assert.ok(Array.isArray(contract.emphasis));
  assert.ok(Array.isArray(contract.flags));
  assert.ok(Array.isArray(contract.word_features));
  assert.equal(typeof contract.transcript.source, "string");
  assert.equal(typeof contract.transcript.word_timestamps, "boolean");
  assert.equal(typeof contract.affect.interpretation, "string");
  assert.equal(typeof contract.assistant_guidance.priority, "string");
  assert.ok(Array.isArray(contract.assistant_guidance.directives));
  assert.equal(typeof contract.assistant_guidance.directives[0].text, "string");
  assert.match(contract.alignment.source, /^(platform_word_timestamps|proportional)$/);
  assert.equal(typeof contract.alignment.confidence, "number");
  for (const key of ["duration_frames", "log_f0_range", "log_f0_median", "log_f0_slope", "log_energy"]) {
    assert.equal(typeof contract.word_features[0][key], "number");
  }
  for (const key of ["rate", "pause_density", "terminal_pitch", "energy", "pitch_range", "voice_quality"]) {
    assert.equal(typeof contract.prosody[key], "string");
  }
  assert.match(contract.calibration.baseline, /^(utterance|personal)$/);
});
