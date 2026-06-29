import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeWav, parseWav } from "../src/index.js";

test("WAV encode/parse round-trips mono PCM into normalized samples", () => {
  const source = Float32Array.from([0, 0.25, -0.25, 0.9, -0.9]);
  const wav = encodeWav({ samples: source, sampleRate: 16000 });
  const parsed = parseWav(wav);

  assert.equal(parsed.sampleRate, 16000);
  assert.equal(parsed.channels, 1);
  assert.equal(parsed.samples.length, source.length);
  assert.ok(Math.abs(parsed.samples[1] - source[1]) < 0.001);
});
