// Regression guard for the absolute-level bug.
//
// The uncalibrated reading used to bucket energy by absolute RMS, so the same
// words said the same way came out "subdued" through a quiet mic and "yelling"
// through a hot one. Microphone gain is not emotion. Every clip here is analysed
// at 0.25x, 1x and 4x amplitude (exact in floating point: powers of two) and
// what the assistant receives must be identical at all three.
//
// Always runs on the golden fixtures. Also runs on the acted-emotion clips when
// they are cached locally (`npm run external:emotion:download`); they are not
// committed, so that half is skipped on a fresh checkout.
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { analyzeSamples, readWavFile } from "../src/index.js";

const SCALES = [0.25, 1, 4];
const root = new URL("../", import.meta.url);

function scaled(samples, factor) {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) out[i] = samples[i] * factor;
  return out;
}

// Everything the assistant is told, minus raw numbers that legitimately carry
// the level (word_features log energy) or float noise (emphasis z).
function whatTheAssistantSees(contract) {
  return {
    affect: contract.affect,
    flags: contract.flags,
    prosody: contract.prosody,
    assistant_guidance: contract.assistant_guidance,
    emphasis: contract.emphasis.map((item) => item.word)
  };
}

async function assertGainInvariant(audioPath, text, label) {
  const wav = await readWavFile(audioPath);
  const [reference, ...others] = SCALES.map((factor) => whatTheAssistantSees(analyzeSamples({
    samples: scaled(wav.samples, factor),
    sampleRate: wav.sampleRate,
    text
  })));
  others.forEach((reading, index) => {
    assert.deepEqual(reading, reference, `${label}: contract changed between 0.25x and ${SCALES[index + 1]}x gain`);
  });
  return reference;
}

test("golden fixtures read the same at 0.25x, 1x and 4x microphone gain", async () => {
  const manifest = JSON.parse(await readFile(new URL("eval/fixtures/manifest.json", root), "utf8"));
  assert.ok(manifest.length >= 10);
  for (const fixture of manifest) {
    await assertGainInvariant(fileURLToPath(new URL(fixture.audio, root)), fixture.text, fixture.id);
  }
});

test("yelling stays yelling through a quiet mic, and neutral stays calm through a hot one", async () => {
  const yelling = await readWavFile(fileURLToPath(new URL("eval/fixtures/yelling.wav", root)));
  const quiet = analyzeSamples({ samples: scaled(yelling.samples, 0.25), sampleRate: yelling.sampleRate, text: "stop rewriting the whole auth module" });
  assert.equal(quiet.affect.emotional_coloring, "high_intensity");
  assert.ok(quiet.flags.some((flag) => flag.type === "yelling"));

  const neutral = await readWavFile(fileURLToPath(new URL("eval/fixtures/expressive-neutral.wav", root)));
  const hot = analyzeSamples({ samples: scaled(neutral.samples, 4), sampleRate: neutral.sampleRate, text: "can we inspect the auth module" });
  assert.ok(!hot.flags.some((flag) => ["yelling", "urgency", "tension"].includes(flag.type)));
});

test("cached acted-emotion clips read the same at 0.25x, 1x and 4x microphone gain", async (t) => {
  const cases = JSON.parse(await readFile(new URL("eval/external/emotion-cases.json", root), "utf8"));
  const available = [];
  for (const testCase of cases) {
    const audioPath = fileURLToPath(new URL(`eval/external/cache/${testCase.id}.wav`, root));
    try {
      await access(audioPath);
      available.push({ ...testCase, audioPath });
    } catch {
      // not downloaded
    }
  }
  if (!available.length) {
    t.skip("acted-emotion clips are not cached (npm run external:emotion:download)");
    return;
  }
  for (const testCase of available) {
    await assertGainInvariant(testCase.audioPath, testCase.transcript, testCase.id);
  }
});
