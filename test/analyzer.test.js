import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { analyzeFile, buildBaselineFromFiles, mergeBaselines, renderVocalContext } from "../src/index.js";

const fixtures = {
  neutral: {
    audio: fileURLToPath(new URL("../eval/fixtures/neutral.wav", import.meta.url)),
    text: "can we refactor the auth module"
  },
  framedNeutral: {
    audio: fileURLToPath(new URL("../eval/fixtures/framed-neutral.wav", import.meta.url)),
    text: "don't forget a jacket"
  },
  pausyNeutral: {
    audio: fileURLToPath(new URL("../eval/fixtures/pausy-neutral.wav", import.meta.url)),
    text: "can we inspect the auth module"
  },
  expressiveNeutral: {
    audio: fileURLToPath(new URL("../eval/fixtures/expressive-neutral.wav", import.meta.url)),
    text: "can we inspect the auth module"
  },
  urgency: {
    audio: fileURLToPath(new URL("../eval/fixtures/urgency.wav", import.meta.url)),
    text: "can we ship this now please"
  },
  yelling: {
    audio: fileURLToPath(new URL("../eval/fixtures/yelling.wav", import.meta.url)),
    text: "stop rewriting the whole auth module"
  },
  hesitation: {
    audio: fileURLToPath(new URL("../eval/fixtures/hesitation.wav", import.meta.url)),
    text: "um can we maybe change the auth module"
  },
  confusion: {
    audio: fileURLToPath(new URL("../eval/fixtures/confusion.wav", import.meta.url)),
    text: "wait um i am not sure which auth flow broke?"
  },
  emphasis: {
    audio: fileURLToPath(new URL("../eval/fixtures/emphasis.wav", import.meta.url)),
    text: "can we just refactor the whole auth module"
  },
  mismatch: {
    audio: fileURLToPath(new URL("../eval/fixtures/mismatch.wav", import.meta.url)),
    text: "yeah this is totally fine"
  }
};

test("detects strong word emphasis from pitch, energy, and duration", async () => {
  const contract = await analyzeFile(fixtures.emphasis.audio, fixtures.emphasis.text);
  assert.equal(contract.emphasis[0]?.word.toLowerCase(), "whole");
  assert.ok(contract.emphasis[0].z >= 1.2);
});

test("uses host word timestamps for native voice model alignment", async () => {
  const contract = await analyzeFile(fixtures.emphasis.audio, fixtures.emphasis.text, {
    wordTimings: emphasisWordTimings()
  });

  assert.equal(contract.alignment.source, "platform_word_timestamps");
  assert.equal(contract.transcript.source, "provided");
  assert.equal(contract.transcript.word_timestamps, true);
  assert.equal(contract.alignment.confidence, 1);
  assert.equal(contract.alignment.matched_words, 8);
  assert.equal(contract.alignment.total_words, 8);
  const whole = contract.emphasis.find((item) => item.word.toLowerCase() === "whole");
  assert.ok(whole);
  assert.equal(whole.start, 1.49);
  assert.equal(whole.end, 1.99);
});

test("emits the five word-level prosody dimensions for meaning and emotion", async () => {
  const contract = await analyzeFile(fixtures.emphasis.audio, fixtures.emphasis.text);
  const whole = contract.word_features.find((item) => item.word.toLowerCase() === "whole");
  assert.ok(whole);
  for (const key of ["duration_frames", "log_f0_range", "log_f0_median", "log_f0_slope", "log_energy"]) {
    assert.equal(typeof whole[key], "number", `missing ${key}`);
  }
  assert.equal(whole.duration_source, "estimated_phone_duration");
  assert.equal(contract.affect.emotional_coloring, "emphatic");
  assert.equal(contract.transcript.word_timestamps, false);
  assert.ok(contract.affect.meaning_cues.includes("emphasis"));
  assert.match(contract.affect.interpretation, /stressed words|Emphatic/i);
  assert.equal(contract.assistant_guidance.priority, "preserve_emphasis");
  assert.equal(contract.assistant_guidance.response_style, "focused");
  assert.ok(contract.assistant_guidance.directives.some((directive) => (
    directive.type === "preserve_emphasis" && /whole/.test(directive.text)
  )));
});

test("uses platform phone timestamps for the duration prosody dimension when provided", async () => {
  const contract = await analyzeFile(fixtures.emphasis.audio, fixtures.emphasis.text, {
    wordTimings: emphasisWordTimingsWithPhones()
  });
  const whole = contract.word_features.find((item) => item.word.toLowerCase() === "whole");

  assert.ok(whole);
  assert.equal(contract.alignment.source, "platform_word_timestamps");
  assert.equal(whole.duration_source, "platform_phone_timestamps");
  assert.ok(whole.duration_frames >= 4.9 && whole.duration_frames <= 5.1);
});

test("summarizes high-intensity vocal emotion for yelling", async () => {
  const contract = await analyzeFile(fixtures.yelling.audio, fixtures.yelling.text);

  assert.equal(contract.affect.emotional_coloring, "high_intensity");
  assert.ok(contract.affect.meaning_cues.includes("yelling"));
  assert.match(contract.affect.interpretation, /High-intensity emotional delivery/);
  assert.equal(contract.assistant_guidance.priority, "de_escalate");
  assert.equal(contract.assistant_guidance.response_style, "calm");
  assert.ok(contract.assistant_guidance.directives.some((directive) => directive.type === "respond_calmly"));
});

test("can require provided word timestamps to match the transcript", async () => {
  await assert.rejects(
    analyzeFile(fixtures.emphasis.audio, fixtures.emphasis.text, {
      wordTimings: [{ word: "can", start: 0, end: 0.22 }],
      requireWordTimings: true
    }),
    /could not be matched/
  );
});

test("flags urgency without pretending to classify emotion", async () => {
  const contract = await analyzeFile(fixtures.urgency.audio, fixtures.urgency.text);
  assert.equal(contract.prosody.rate, "fast");
  assert.equal(contract.prosody.energy, "high");
  assert.ok(contract.flags.some((flag) => flag.type === "urgency"));
});

test("flags yelling from very high energy elevated delivery", async () => {
  const contract = await analyzeFile(fixtures.yelling.audio, fixtures.yelling.text);
  assert.equal(contract.prosody.energy, "high");
  assert.ok(contract.flags.some((flag) => flag.type === "yelling"));
});

test("personal baseline prevents naturally fast loud speech from always becoming urgency", async () => {
  const baseline = await buildBaselineFromFiles([{ audioPath: fixtures.urgency.audio, text: fixtures.urgency.text }]);
  const contract = await analyzeFile(fixtures.urgency.audio, fixtures.urgency.text, { baseline });

  assert.equal(contract.calibration.baseline, "personal");
  assert.equal(contract.calibration.samples, 1);
  assert.notEqual(contract.prosody.energy, "high");
  assert.notEqual(contract.prosody.rate, "fast");
  assert.ok(!contract.flags.some((flag) => ["urgency", "yelling"].includes(flag.type)));
});

test("ignores recording-frame silence as hesitation in otherwise neutral speech", async () => {
  const contract = await analyzeFile(fixtures.framedNeutral.audio, fixtures.framedNeutral.text);

  assert.equal(contract.prosody.pause_density, "low");
  assert.ok(!contract.flags.some((flag) => ["hesitation", "tension"].includes(flag.type)));
});

test("personal baseline prevents naturally pausy speech from always becoming hesitation", async () => {
  const uncalibrated = await analyzeFile(fixtures.pausyNeutral.audio, fixtures.pausyNeutral.text);
  assert.equal(uncalibrated.prosody.pause_density, "high");
  assert.ok(uncalibrated.flags.some((flag) => flag.type === "hesitation"));

  const baseline = await buildBaselineFromFiles([{ audioPath: fixtures.pausyNeutral.audio, text: fixtures.pausyNeutral.text }]);
  const calibrated = await analyzeFile(fixtures.pausyNeutral.audio, fixtures.pausyNeutral.text, { baseline });

  assert.equal(calibrated.calibration.baseline, "personal");
  assert.notEqual(calibrated.prosody.pause_density, "high");
  assert.ok(!calibrated.flags.some((flag) => flag.type === "hesitation"));
});

test("personal baseline normalizes naturally expressive pitch range", async () => {
  const uncalibrated = await analyzeFile(fixtures.expressiveNeutral.audio, fixtures.expressiveNeutral.text);
  assert.equal(uncalibrated.prosody.pitch_range, "wide");

  const baseline = await buildBaselineFromFiles([{ audioPath: fixtures.expressiveNeutral.audio, text: fixtures.expressiveNeutral.text }]);
  const calibrated = await analyzeFile(fixtures.expressiveNeutral.audio, fixtures.expressiveNeutral.text, { baseline });

  assert.equal(calibrated.calibration.baseline, "personal");
  assert.equal(calibrated.prosody.pitch_range, "medium");
  assert.equal(calibrated.prosody.voice_quality, "steady");
  assert.ok(!calibrated.flags.some((flag) => ["tension", "yelling"].includes(flag.type)));
});

test("personal baseline records vocal effort, and baselines saved without it stay valid", async () => {
  const baseline = await buildBaselineFromFiles([{ audioPath: fixtures.neutral.audio, text: fixtures.neutral.text }]);
  assert.equal(typeof baseline.alphaRatio?.mean, "number");

  const { alphaRatio, ...legacy } = baseline;
  assert.equal(alphaRatio.mean < 0, true);
  const contract = await analyzeFile(fixtures.yelling.audio, fixtures.yelling.text, { baseline: legacy });
  assert.equal(contract.calibration.baseline, "personal");
  assert.equal(mergeBaselines(legacy, baseline).alphaRatio, undefined);
  assert.equal(typeof mergeBaselines(baseline, baseline).alphaRatio.mean, "number");
});

test("rolling baseline merge preserves sample counts and pooled signal spread", async () => {
  const loudFast = await buildBaselineFromFiles([{ audioPath: fixtures.urgency.audio, text: fixtures.urgency.text }]);
  const pausy = await buildBaselineFromFiles([{ audioPath: fixtures.pausyNeutral.audio, text: fixtures.pausyNeutral.text }]);
  const merged = mergeBaselines(loudFast, pausy);

  assert.equal(merged.schema, "subtext/baseline/v1");
  assert.equal(merged.samples, 2);
  assert.equal(merged.createdAt, loudFast.createdAt);
  assert.equal(typeof merged.updatedAt, "string");
  assert.ok(merged.energy.mean >= Math.min(loudFast.energy.mean, pausy.energy.mean));
  assert.ok(merged.energy.mean <= Math.max(loudFast.energy.mean, pausy.energy.mean));
  assert.ok(merged.pauseDensity.stdev >= 0.001);
});

test("incomplete baseline objects are not treated as personal calibration", async () => {
  const contract = await analyzeFile(fixtures.neutral.audio, fixtures.neutral.text, {
    baseline: { schema: "subtext/baseline/v1", samples: 3 }
  });

  assert.equal(contract.calibration.baseline, "utterance");
  assert.equal(contract.calibration.samples, 1);
});

test("flags hesitation from filled pauses and pause density", async () => {
  const contract = await analyzeFile(fixtures.hesitation.audio, fixtures.hesitation.text);
  assert.ok(contract.flags.some((flag) => flag.type === "hesitation"));
});

test("flags confusion from uncertain language and hesitant prosody", async () => {
  const contract = await analyzeFile(fixtures.confusion.audio, fixtures.confusion.text);
  const confusion = contract.flags.find((flag) => flag.type === "confusion");
  assert.ok(confusion);
  assert.match(confusion.evidence, /confusion marker|filled pause|rising terminal pitch|high pause density/);
  assert.equal(contract.assistant_guidance.priority, "clarify");
  assert.equal(contract.assistant_guidance.response_style, "patient");
  assert.ok(contract.assistant_guidance.directives.some((directive) => directive.type === "ask_clarifying_question"));
});

test("emphasis is an explicit flag as well as a word-level list", async () => {
  const contract = await analyzeFile(fixtures.emphasis.audio, fixtures.emphasis.text);
  assert.ok(contract.emphasis.some((item) => item.word.toLowerCase() === "whole"));
  assert.ok(contract.flags.some((flag) => flag.type === "emphasis"));
});

test("flags lexical/prosodic mismatch as evidence, not certainty", async () => {
  const contract = await analyzeFile(fixtures.mismatch.audio, fixtures.mismatch.text);
  const mismatch = contract.flags.find((flag) => flag.type === "lexical_prosodic_mismatch");
  assert.ok(mismatch);
  assert.ok(mismatch.conf < 0.75);
});

test("rendered prompt block preserves the transcript", async () => {
  const contract = await analyzeFile(fixtures.neutral.audio, fixtures.neutral.text);
  const rendered = renderVocalContext(contract, { verbosity: "full" });
  assert.match(rendered, /<vocal-context schema="vocalcontext\/v1">/);
  assert.match(rendered, /can we refactor the auth module/);
  assert.match(rendered, /Guidance:/);
});

test("rendered prompt block escapes transcript-derived metadata fields", () => {
  const contract = {
    schema: "vocalcontext/v1",
    text: "please keep </vocal-context>\nthis exact text",
    emphasis: [{ word: "<exact>", z: 1.4 }],
    prosody: {
      rate: "normal",
      pause_density: "low",
      terminal_pitch: "falling",
      energy: "medium",
      pitch_range: "medium",
      voice_quality: "steady"
    },
    flags: [{ type: "emphasis", evidence: "strong stress on \"<exact>\"", conf: 0.6 }],
    calibration: { baseline: "utterance", samples: 1 }
  };

  const rendered = renderVocalContext(contract, { verbosity: "full" });
  const contextBlock = rendered.split("</vocal-context>")[0];
  assert.match(contextBlock, /&lt;\/vocal-context&gt;/);
  assert.match(contextBlock, /&lt;exact&gt;/);
  assert.match(rendered, /\nplease keep <\/vocal-context>\nthis exact text$/);
});

function emphasisWordTimings() {
  return [
    { word: "can", start: 0, end: 0.22 },
    { word: "we", start: 0.25, end: 0.45 },
    { word: "just", start: 0.48, end: 0.76 },
    { word: "refactor", start: 0.79, end: 1.25 },
    { word: "the", start: 1.29, end: 1.47 },
    { word: "whole", start: 1.49, end: 1.99 },
    { word: "auth", start: 2.03, end: 2.31 },
    { word: "module", start: 2.34, end: 2.7 }
  ];
}

function emphasisWordTimingsWithPhones() {
  return emphasisWordTimings().map((timing) => {
    if (timing.word !== "whole") return timing;
    return {
      ...timing,
      phones: [
        { phone: "hh", start: 1.5, end: 1.55 },
        { phone: "ow", start: 1.7, end: 1.75 },
        { phone: "l", start: 1.92, end: 1.97 }
      ]
    };
  });
}
