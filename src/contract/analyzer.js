import { alignWordsProportionally } from "../alignment/proportional.js";
import { alignWordsFromTimings } from "../alignment/word-timings.js";
import { isBaseline } from "../calibration/baseline.js";
import { extractProsody } from "../dsp/features.js";
import { clamp, mean, quantile, round, stdev, zScore } from "../dsp/stats.js";
import { CONFUSION_WORDS, FILLED_PAUSES, NEGATIVE_WORDS, POSITIVE_WORDS, SOFTENERS, tokenizeWords } from "../text/tokenize.js";

const SCHEMA = "vocalcontext/v1";

// Categorical thresholds for bucketing a speaker's rate/energy/pauses/pitch-range/
// voice-quality, and for the yelling detector. Each metric has a baseline-mode cutoff
// (a z-score against the speaker's own calibrated history, used when a personal
// baseline is available) and a no-baseline-mode cutoff (an absolute value used as a
// cross-speaker default otherwise). Values are unchanged from their prior inline
// literals; only the names are new.
const THRESHOLDS = {
  // categorizeProsody: speaking rate (words/sec).
  rateBaselineZ: 1.35,
  rateFastWordsPerSecondNoBaseline: 3.6,
  rateSlowWordsPerSecondNoBaseline: 1.9,

  // categorizeProsody: energy. energyDefaultMean/Stdev are the population
  // mean/stdev used as a stand-in baseline when computing a z-score with no
  // personal baseline.
  energyDefaultMean: 0.1,
  energyDefaultStdev: 0.045,
  energyBaselineZ: 1.35,
  energyHighZNoBaseline: 1.15,
  energyHighMeanNoBaseline: 0.15,
  energyLowZNoBaseline: 1.1,
  energyLowMeanNoBaseline: 0.055,

  // categorizePauseDensity.
  pauseDensityBaselineZ: 1.35,
  pauseDensityBaselineDelta: 0.06,
  pauseDensityHighNoBaseline: 0.28,
  pauseDensityModerateNoBaseline: 0.12,

  // buildFlags: hesitation from filled pauses ("um", "uh", ...), as a rate per
  // word rather than a raw count. 0.04 is one filler per 25 words: the golden
  // hesitation fixture (1 in 8 words, 0.125) clears it comfortably, while the
  // wild-eval false positives (1 in 87 and 1 in 112 words, ~0.01) do not.
  hesitationFilledPauseRate: 0.04,

  // categorizePitchRange (semitones).
  pitchRangeBaselineZ: 1.35,
  pitchRangeBaselineDeltaSemitones: 1.5,
  pitchRangeWideSemitonesNoBaseline: 7,
  pitchRangeNarrowSemitonesNoBaseline: 3.2,

  // categorizeVoiceQuality: no-baseline mode flags "tense" on any single absolute
  // symptom (low harmonic/pitch confidence, high shimmer, or jitter co-occurring
  // with energy); baseline mode instead requires a z-score outlier vs. the
  // speaker's own jitter/shimmer/confidence history.
  voiceQualityLowConfidenceNoBaseline: 0.45,
  voiceQualityHighShimmerNoBaseline: 0.42,
  voiceQualityHighJitterNoBaseline: 0.12,
  voiceQualityJitterEnergyFloor: 0.05,
  voiceQualityModerateJitterNoBaseline: 0.06,
  voiceQualityHighEnergyPeakNoBaseline: 0.34,
  voiceQualityLowConfidenceBaseline: 0.38,
  voiceQualityConfidenceZ: -2,
  voiceQualityJitterZ: 2,
  voiceQualityJitterRatioFloor: 0.04,
  voiceQualityShimmerZ: 2,
  voiceQualityShimmerRatioFloor: 0.16,

  // isYelling: extreme-energy detector.
  yellingEnergyPeakZ: 1.8,
  yellingEnergyMeanZ: 1.6,
  yellingEnergyPeakNoBaseline: 0.34,
  yellingEnergyMeanNoBaseline: 0.19
};

export async function analyzeFile(audioPath, text, options = {}) {
  const { readWavFile } = await import("../audio/wav.js"); // lazy: keeps this module browser-safe
  const wav = await readWavFile(audioPath);
  return analyzeSamples({
    samples: wav.samples,
    sampleRate: wav.sampleRate,
    text,
    baseline: options.baseline,
    options
  });
}

export function analyzeSamples({ samples, sampleRate, text, baseline = null, options = {} }) {
  if (!samples || !sampleRate) {
    throw new Error("analyzeSamples requires samples and sampleRate.");
  }
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("analyzeSamples requires non-empty transcript text.");
  }

  const words = tokenizeWords(text);
  const prosodyResult = extractProsody(samples, sampleRate, options.prosody);
  const timingAlignment = alignWordsFromTimings(
    words,
    options.wordTimings ?? options.word_timestamps,
    prosodyResult.summary,
    { requireWordTimings: Boolean(options.requireWordTimings ?? options.require_word_timings) }
  );
  const proportionalWords = alignWordsProportionally(words, prosodyResult.summary);
  const alignedWords = timingAlignment?.words ?? proportionalWords;
  const alignment = timingAlignment?.words
    ? timingAlignment.report
    : timingAlignment?.report ?? {
      source: "proportional",
      confidence: words.length ? 0.55 : 1,
      matched_words: 0,
      total_words: words.length
    };
  const transcript = buildTranscriptMetadata(options, alignment);
  const wordMetrics = scoreWords(alignedWords, prosodyResult.frames);
  const hasPersonalBaseline = isBaseline(baseline);
  const prosody = categorizeProsody(prosodyResult.summary, wordMetrics, baseline);
  const flags = buildFlags(text, words, prosody, prosodyResult.summary, wordMetrics, baseline);
  const wordFeatures = wordMetrics.map((word) => ({
    word: word.word,
    start: round(word.startSec, 3),
    end: round(word.endSec, 3),
    duration_frames: round(word.durationFrames, 2),
    log_f0_range: round(word.logF0Range, 3),
    log_f0_median: round(word.logF0Median, 3),
    log_f0_slope: round(word.logF0Slope, 3),
    log_energy: round(word.logEnergy, 3),
    duration_source: word.durationSource
  }));
  const emphasis = wordMetrics
    .filter((word) => word.z >= 0.85 && !FILLED_PAUSES.has(word.normalized))
    .sort((a, b) => b.z - a.z)
    .slice(0, options.maxEmphasis ?? 5)
    .map((word) => ({
      word: word.word,
      z: round(word.z, 2),
      start: round(word.startSec, 3),
      end: round(word.endSec, 3)
    }));
  const affect = buildAffectSummary(prosody, flags);
  const assistantGuidance = buildAssistantGuidance(affect, flags, emphasis);

  return {
    schema: SCHEMA,
    text: text.trim(),
    transcript,
    emphasis,
    prosody: {
      rate: prosody.rate,
      pause_density: prosody.pauseDensity,
      terminal_pitch: prosody.terminalPitch,
      energy: prosody.energy,
      pitch_range: prosody.pitchRange,
      voice_quality: prosody.voiceQuality
    },
    affect,
    assistant_guidance: assistantGuidance,
    word_features: wordFeatures,
    alignment,
    flags,
    calibration: {
      baseline: hasPersonalBaseline ? "personal" : "utterance",
      samples: hasPersonalBaseline ? baseline.samples : 1
    }
  };
}

function buildAssistantGuidance(affect, flags, emphasis) {
  const flagMap = new Map(flags.map((flag) => [flag.type, flag]));
  const directives = [];

  if (flagMap.has("yelling")) {
    addDirective(directives, "respond_calmly", "Respond calmly and avoid escalating the tone.", flagMap.get("yelling"));
    addDirective(directives, "avoid_escalation", "Do not mirror the user's intensity; keep the response grounded.", flagMap.get("yelling"));
  }

  if (flagMap.has("urgency")) {
    addDirective(directives, "prioritize_direct_action", "Prioritize the next concrete action before extra explanation.", flagMap.get("urgency"));
    addDirective(directives, "keep_concise", "Keep the first response concise and task-focused.", flagMap.get("urgency"));
  }

  if (flagMap.has("confusion") || flagMap.has("uncertainty")) {
    const source = flagMap.get("confusion") ?? flagMap.get("uncertainty");
    addDirective(directives, "ask_clarifying_question", "Clarify only the assumptions that affect the next coding step.", source);
    addDirective(directives, "state_assumptions", "State assumptions plainly before acting on them.", source);
  }

  if (flagMap.has("hesitation")) {
    addDirective(directives, "avoid_overconfidence", "Offer a careful interpretation and avoid overconfident leaps.", flagMap.get("hesitation"));
  }

  if (flagMap.has("tension")) {
    addDirective(directives, "keep_concise", "Keep the response steady, concise, and grounded.", flagMap.get("tension"));
  }

  if (flagMap.has("lexical_prosodic_mismatch")) {
    addDirective(directives, "resolve_text_tone_mismatch", "Treat the transcript literally, but do not ignore the vocal cue.", flagMap.get("lexical_prosodic_mismatch"));
  }

  if (emphasis.length || flagMap.has("emphasis")) {
    const emphasized = emphasis.slice(0, 3).map((item) => item.word).join(", ");
    addDirective(
      directives,
      "preserve_emphasis",
      emphasized
        ? `Preserve stressed words as likely constraints or priorities: ${emphasized}.`
        : "Preserve stressed words as likely constraints or priorities.",
      flagMap.get("emphasis")
    );
  }

  if (!directives.length) {
    directives.push({
      type: "use_transcript_normally",
      text: "No strong vocal-context adaptation needed; use the transcript normally.",
      confidence: affect.confidence
    });
  }

  return {
    priority: guidancePriority(flagMap),
    response_style: guidanceStyle(flagMap),
    directives
  };
}

function addDirective(directives, type, text, flag = null) {
  if (directives.some((directive) => directive.type === type)) return;
  directives.push({
    type,
    text,
    ...(flag ? { source_flag: flag.type, confidence: flag.conf } : {})
  });
}

function guidancePriority(flagMap) {
  if (flagMap.has("yelling")) return "de_escalate";
  if (flagMap.has("confusion") || flagMap.has("uncertainty")) return "clarify";
  if (flagMap.has("urgency")) return "act_quickly";
  if (flagMap.has("lexical_prosodic_mismatch")) return "resolve_mismatch";
  if (flagMap.has("hesitation")) return "careful";
  if (flagMap.has("emphasis")) return "preserve_emphasis";
  return "normal";
}

function guidanceStyle(flagMap) {
  if (flagMap.has("yelling")) return "calm";
  if (flagMap.has("urgency")) return "direct";
  if (flagMap.has("confusion") || flagMap.has("uncertainty") || flagMap.has("hesitation")) return "patient";
  if (flagMap.has("tension")) return "steady";
  if (flagMap.has("lexical_prosodic_mismatch")) return "careful";
  if (flagMap.has("emphasis")) return "focused";
  return "normal";
}

function buildTranscriptMetadata(options, alignment) {
  const transcriptOptions = options.transcript && typeof options.transcript === "object" ? options.transcript : {};
  const source = String(
    options.transcriptSource
    ?? options.transcript_source
    ?? transcriptOptions.source
    ?? "provided"
  ).trim() || "provided";
  const language = options.language ?? options.transcriptLanguage ?? transcriptOptions.language;
  const confidenceValue = Number(
    options.transcriptConfidence
    ?? options.transcript_confidence
    ?? transcriptOptions.confidence
  );
  const metadata = {
    source,
    word_timestamps: alignment.source === "platform_word_timestamps"
  };
  if (typeof language === "string" && language.trim()) {
    metadata.language = language.trim();
  }
  if (Number.isFinite(confidenceValue)) {
    metadata.confidence = round(clamp(confidenceValue, 0, 1), 3);
  }
  return metadata;
}

function scoreWords(words, frames) {
  if (!words.length) return [];
  const hopSec = inferFrameHopSec(frames);

  const metrics = words.map((word) => {
    const overlapping = frames.filter((frame) => frame.centerSec >= word.startSec && frame.centerSec <= word.endSec);
    const speechFrames = overlapping.filter((frame) => frame.rms > 0);
    const voicedFrames = overlapping.filter((frame) => frame.voiced);
    const energy = mean(speechFrames.map((frame) => frame.rms));
    const f0Peak = Math.max(0, ...voicedFrames.map((frame) => frame.f0 ?? 0));
    const f0Mean = mean(voicedFrames.map((frame) => frame.f0 ?? 0).filter((value) => value > 0));
    const logF0Values = voicedFrames.map((frame) => Math.log(frame.f0 ?? 0)).filter(Number.isFinite);
    const logF0Range = logF0Values.length
      ? quantile(logF0Values, 0.95) - quantile(logF0Values, 0.05)
      : 0;
    const logF0Median = logF0Values.length ? quantile(logF0Values, 0.5) : 0;
    const logF0Slope = computeLogF0Slope(voicedFrames, word.startSec);
    const logEnergy = mean(speechFrames.map((frame) => frame.melLogEnergy).filter(Number.isFinite));
    const phoneDurations = Array.isArray(word.phoneTimings)
      ? word.phoneTimings.map((phone) => phone.durationSec ?? (phone.endSec - phone.startSec)).filter((value) => Number.isFinite(value) && value > 0)
      : [];
    const estimatedPhoneCount = estimatePhoneCount(word.normalized);
    const durationFrames = phoneDurations.length
      ? mean(phoneDurations.map((durationSec) => durationSec / hopSec))
      : (word.durationSec / hopSec) / estimatedPhoneCount;
    const durationPerSyllable = word.durationSec / Math.max(1, word.syllables);
    return {
      ...word,
      energy,
      f0Peak,
      f0Mean,
      logF0Range,
      logF0Median,
      logF0Slope,
      logEnergy,
      durationFrames,
      durationSource: phoneDurations.length ? "platform_phone_timestamps" : "estimated_phone_duration",
      durationPerSyllable
    };
  });

  const energyMean = mean(metrics.map((word) => word.logEnergy));
  const energyStdev = stdev(metrics.map((word) => word.logEnergy));
  const f0Mean = mean(metrics.map((word) => word.logF0Median).filter((value) => value > 0));
  const f0Stdev = stdev(metrics.map((word) => word.logF0Median).filter((value) => value > 0));
  const f0RangeMean = mean(metrics.map((word) => word.logF0Range).filter((value) => value > 0));
  const f0RangeStdev = stdev(metrics.map((word) => word.logF0Range).filter((value) => value > 0));
  const slopeMean = mean(metrics.map((word) => Math.abs(word.logF0Slope)));
  const slopeStdev = stdev(metrics.map((word) => Math.abs(word.logF0Slope)));
  const durationMean = mean(metrics.map((word) => word.durationFrames));
  const durationStdev = stdev(metrics.map((word) => word.durationFrames));

  return metrics.map((word) => {
    const energyZ = positiveLift(zScore(word.logEnergy, energyMean, energyStdev));
    const f0Z = word.logF0Median > 0 ? positiveLift(zScore(word.logF0Median, f0Mean, f0Stdev)) : 0;
    const f0RangeZ = word.logF0Range > 0 ? positiveLift(zScore(word.logF0Range, f0RangeMean, f0RangeStdev)) : 0;
    const slopeZ = positiveLift(zScore(Math.abs(word.logF0Slope), slopeMean, slopeStdev));
    const durationZ = positiveLift(zScore(word.durationFrames, durationMean, durationStdev));
    return {
      ...word,
      z: clamp(0.28 * f0Z + 0.3 * energyZ + 0.18 * f0RangeZ + 0.14 * durationZ + 0.1 * slopeZ, -4, 4)
    };
  });
}

function positiveLift(value) {
  return Math.max(0, value);
}

function buildAffectSummary(prosody, flags) {
  const cueTypes = [...new Set(flags.map((flag) => flag.type))];
  const strongestConfidence = flags.length ? Math.max(...flags.map((flag) => flag.conf)) : 0.42;
  const emotionalColoring = chooseEmotionalColoring(cueTypes, prosody);
  const interpretation = affectInterpretation(emotionalColoring, cueTypes);
  const evidence = [
    `${prosody.rate} rate, ${prosody.energy} energy, ${prosody.pitchRange} pitch range`,
    ...flags.slice(0, 4).map((flag) => `${flag.type}: ${flag.evidence}`)
  ];

  return {
    emotional_coloring: emotionalColoring,
    meaning_cues: cueTypes,
    interpretation,
    confidence: confidence(strongestConfidence),
    evidence
  };
}

function chooseEmotionalColoring(cueTypes, prosody) {
  if (cueTypes.includes("yelling")) return "high_intensity";
  if (cueTypes.includes("urgency")) return "urgent";
  if (cueTypes.includes("confusion") || cueTypes.includes("uncertainty")) return "uncertain";
  if (cueTypes.includes("hesitation")) return "hesitant";
  if (cueTypes.includes("tension")) return "tense";
  if (cueTypes.includes("lexical_prosodic_mismatch")) return "mixed";
  if (cueTypes.includes("emphasis")) return "emphatic";
  if (prosody.energy === "low" || prosody.pitchRange === "narrow") return "subdued";
  return "neutral";
}

function affectInterpretation(emotionalColoring, cueTypes) {
  const preserveEmphasis = cueTypes.includes("emphasis")
    ? " Preserve explicitly stressed words as likely intent markers."
    : "";
  switch (emotionalColoring) {
    case "high_intensity":
      return `High-intensity emotional delivery; respond calmly and avoid escalation.${preserveEmphasis}`;
    case "urgent":
      return `Urgent delivery; prioritize direct action and avoid unnecessary detours.${preserveEmphasis}`;
    case "uncertain":
      return `Uncertain or confused delivery; clarify assumptions and make the next step feel easy.${preserveEmphasis}`;
    case "hesitant":
      return `Hesitant delivery; offer a careful interpretation and avoid overconfident leaps.${preserveEmphasis}`;
    case "tense":
      return `Tense delivery; keep the response steady, concise, and grounded.${preserveEmphasis}`;
    case "mixed":
      return `Mixed text-and-tone signal; treat the transcript literally but avoid ignoring the vocal cue.${preserveEmphasis}`;
    case "emphatic":
      return "Emphatic delivery; preserve stressed words as intentional constraints or priorities.";
    case "subdued":
      return `Subdued delivery; do not assume lack of importance from plain transcript text alone.${preserveEmphasis}`;
    default:
      return `No strong emotional coloring detected; use the transcript normally.${preserveEmphasis}`;
  }
}

function computeLogF0Slope(voicedFrames, wordStartSec) {
  const points = voicedFrames
    .map((frame) => ({
      x: frame.centerSec - wordStartSec,
      y: Math.log(frame.f0 ?? 0)
    }))
    .filter((point) => Number.isFinite(point.y));
  if (points.length < 2) return 0;

  const xMean = mean(points.map((point) => point.x));
  const yMean = mean(points.map((point) => point.y));
  const denominator = points.reduce((sum, point) => sum + (point.x - xMean) ** 2, 0);
  if (denominator <= 1e-9) return 0;
  return points.reduce((sum, point) => sum + (point.x - xMean) * (point.y - yMean), 0) / denominator;
}

function inferFrameHopSec(frames) {
  if (frames.length < 2) return 0.01;
  const hops = [];
  for (let index = 1; index < frames.length; index += 1) {
    const hop = frames[index].centerSec - frames[index - 1].centerSec;
    if (hop > 0) hops.push(hop);
  }
  return quantile(hops, 0.5) || 0.01;
}

function estimatePhoneCount(normalizedWord) {
  const word = String(normalizedWord ?? "").replace(/[^a-z0-9]/g, "");
  if (!word) return 1;
  const vowelGroups = word.match(/[aeiouy]+/g)?.length ?? 0;
  const consonants = word.replace(/[^bcdfghjklmnpqrstvwxz]/g, "").length;
  return Math.max(1, Math.round(vowelGroups + consonants * 0.7));
}

function categorizeProsody(summary, wordMetrics, baseline) {
  const wordsPerSecond = wordMetrics.length / Math.max(0.001, summary.speechDurationSec);
  const hasBaseline = isBaseline(baseline);
  const rateZ = hasBaseline ? zScore(wordsPerSecond, baseline.rate.mean, baseline.rate.stdev) : 0;
  const rate = hasBaseline
    ? rateZ >= THRESHOLDS.rateBaselineZ
      ? "fast"
      : rateZ <= -THRESHOLDS.rateBaselineZ
        ? "slow"
        : "normal"
    : wordsPerSecond >= THRESHOLDS.rateFastWordsPerSecondNoBaseline
      ? "fast"
      : wordsPerSecond <= THRESHOLDS.rateSlowWordsPerSecondNoBaseline
        ? "slow"
        : "normal";
  const pauseDensity = categorizePauseDensity(summary, baseline);

  const energyCenter = hasBaseline ? baseline.energy.mean : THRESHOLDS.energyDefaultMean;
  const energySpread = hasBaseline ? baseline.energy.stdev : THRESHOLDS.energyDefaultStdev;
  const energyZ = zScore(summary.energyMean, energyCenter, energySpread);
  const energy = hasBaseline
    ? energyZ >= THRESHOLDS.energyBaselineZ
      ? "high"
      : energyZ <= -THRESHOLDS.energyBaselineZ
        ? "low"
        : "medium"
    : energyZ >= THRESHOLDS.energyHighZNoBaseline || summary.energyMean >= THRESHOLDS.energyHighMeanNoBaseline
      ? "high"
      : energyZ <= -THRESHOLDS.energyLowZNoBaseline || summary.energyMean <= THRESHOLDS.energyLowMeanNoBaseline
        ? "low"
        : "medium";

  const pitchRange = categorizePitchRange(summary, baseline);
  const voiceQuality = categorizeVoiceQuality(summary, baseline);

  return {
    wordsPerSecond,
    rate,
    pauseDensity,
    terminalPitch: summary.terminalPitch,
    energy,
    pitchRange,
    voiceQuality
  };
}

function categorizePauseDensity(summary, baseline) {
  if (!isBaseline(baseline)) {
    return summary.pauseDensity >= THRESHOLDS.pauseDensityHighNoBaseline
      ? "high"
      : summary.pauseDensity >= THRESHOLDS.pauseDensityModerateNoBaseline
        ? "moderate"
        : "low";
  }

  const pauseZ = zScore(summary.pauseDensity, baseline.pauseDensity.mean, baseline.pauseDensity.stdev);
  const delta = summary.pauseDensity - baseline.pauseDensity.mean;
  if (pauseZ >= THRESHOLDS.pauseDensityBaselineZ && delta >= THRESHOLDS.pauseDensityBaselineDelta) return "high";
  if (pauseZ <= -THRESHOLDS.pauseDensityBaselineZ && delta <= -THRESHOLDS.pauseDensityBaselineDelta) return "low";
  return summary.pauseDensity < THRESHOLDS.pauseDensityModerateNoBaseline ? "low" : "moderate";
}

function categorizePitchRange(summary, baseline) {
  if (!isBaseline(baseline)) {
    return summary.pitchRangeSemitones >= THRESHOLDS.pitchRangeWideSemitonesNoBaseline
      ? "wide"
      : summary.pitchRangeSemitones <= THRESHOLDS.pitchRangeNarrowSemitonesNoBaseline
        ? "narrow"
        : "medium";
  }

  const pitchZ = zScore(summary.pitchRangeSemitones, baseline.pitchRange.mean, baseline.pitchRange.stdev);
  const delta = summary.pitchRangeSemitones - baseline.pitchRange.mean;
  if (pitchZ >= THRESHOLDS.pitchRangeBaselineZ && delta >= THRESHOLDS.pitchRangeBaselineDeltaSemitones) return "wide";
  if (pitchZ <= -THRESHOLDS.pitchRangeBaselineZ && delta <= -THRESHOLDS.pitchRangeBaselineDeltaSemitones) return "narrow";
  return "medium";
}

function categorizeVoiceQuality(summary, baseline) {
  if (!isBaseline(baseline)) {
    return summary.pitchConfidenceMean <= THRESHOLDS.voiceQualityLowConfidenceNoBaseline
      || summary.shimmerRatio >= THRESHOLDS.voiceQualityHighShimmerNoBaseline
      || (summary.jitterRatio >= THRESHOLDS.voiceQualityHighJitterNoBaseline && summary.energyMean >= THRESHOLDS.voiceQualityJitterEnergyFloor)
      || (summary.jitterRatio >= THRESHOLDS.voiceQualityModerateJitterNoBaseline && summary.energyPeak >= THRESHOLDS.voiceQualityHighEnergyPeakNoBaseline)
      ? "tense"
      : "steady";
  }

  const jitterZ = zScore(summary.jitterRatio, baseline.jitter.mean, baseline.jitter.stdev);
  const shimmerZ = zScore(summary.shimmerRatio, baseline.shimmer.mean, baseline.shimmer.stdev);
  const confidenceZ = baseline.pitchConfidence
    ? zScore(summary.pitchConfidenceMean, baseline.pitchConfidence.mean, baseline.pitchConfidence.stdev)
    : 0;
  const unusuallyLowConfidence = summary.pitchConfidenceMean <= THRESHOLDS.voiceQualityLowConfidenceBaseline
    || confidenceZ <= THRESHOLDS.voiceQualityConfidenceZ;
  const unusuallyJittery = jitterZ >= THRESHOLDS.voiceQualityJitterZ
    && summary.jitterRatio >= THRESHOLDS.voiceQualityJitterRatioFloor
    && summary.energyMean >= THRESHOLDS.voiceQualityJitterEnergyFloor;
  const unusuallyShimmery = shimmerZ >= THRESHOLDS.voiceQualityShimmerZ && summary.shimmerRatio >= THRESHOLDS.voiceQualityShimmerRatioFloor;
  return unusuallyLowConfidence || unusuallyJittery || unusuallyShimmery ? "tense" : "steady";
}

function buildFlags(text, words, prosody, summary, wordMetrics, baseline) {
  const normalizedWords = words.map((word) => word.normalized);
  const filledPauseCount = normalizedWords.filter((word) => FILLED_PAUSES.has(word)).length;
  const softenerCount = countSofteners(normalizedWords);
  const confusionMarkerCount = countConfusionMarkers(text, normalizedWords);
  const positiveCount = normalizedWords.filter((word) => POSITIVE_WORDS.has(word)).length;
  const negativeCount = normalizedWords.filter((word) => NEGATIVE_WORDS.has(word)).length;
  const strongest = wordMetrics.toSorted((a, b) => b.z - a.z)[0];
  const flags = [];

  if (isYelling(prosody, summary, baseline)) {
    flags.push({
      type: "yelling",
      evidence: yellingEvidence(prosody, summary),
      conf: confidence(0.68 + Math.min(0.2, Math.max(0, summary.energyPeak - 0.3)))
    });
  }

  if (prosody.rate === "fast" && prosody.energy === "high" && prosody.pauseDensity !== "high") {
    flags.push({
      type: "urgency",
      evidence: "fast rate + high energy + few pauses",
      conf: confidence(0.66 + Math.min(0.18, (prosody.wordsPerSecond - 3.6) * 0.08))
    });
  }

  // Filled pauses are scored as a RATE, not a count. A single "um" in an
  // 87-word answer is fluent speech; the same "um" in an 8-word push-to-talk
  // turn is a real hesitation cue. The wild YouTube eval showed the old
  // count>0 rule flagging calm lecturers and briefers as hesitant on exactly
  // one filler, which for dictation means telling the assistant the user is
  // unsure when they were merely speaking deliberately.
  const wordCount = Math.max(1, normalizedWords.length);
  const filledPauseRate = filledPauseCount / wordCount;
  const hesitantFromFillers = filledPauseCount > 0 && filledPauseRate >= THRESHOLDS.hesitationFilledPauseRate;

  if (hesitantFromFillers || prosody.pauseDensity === "high") {
    const evidence = hesitantFromFillers
      ? `${filledPauseCount} filled pause${filledPauseCount === 1 ? "" : "s"} in ${wordCount} words + ${prosody.pauseDensity} pause density`
      : "high pause density";
    flags.push({
      type: "hesitation",
      evidence,
      conf: confidence(hesitantFromFillers ? 0.62 + Math.min(0.2, filledPauseRate * 1.2) : 0.62)
    });
  }

  if (isConfused(text, prosody, filledPauseCount, softenerCount, confusionMarkerCount)) {
    flags.push({
      type: "confusion",
      evidence: confusionEvidence(prosody, filledPauseCount, softenerCount, confusionMarkerCount),
      conf: confidence(0.56 + Math.min(0.22, confusionMarkerCount * 0.06 + filledPauseCount * 0.07))
    });
  }

  if (isUncertainRise(text, prosody, filledPauseCount, softenerCount, confusionMarkerCount)) {
    flags.push({
      type: "uncertainty",
      evidence: "rising terminal pitch on a non-question transcript",
      conf: 0.58
    });
  }

  if (prosody.voiceQuality === "tense" || (prosody.energy === "high" && prosody.pitchRange === "wide")) {
    flags.push({
      type: "tension",
      evidence: prosody.voiceQuality === "tense" ? "jitter/shimmer or low harmonic confidence" : "high energy + wide pitch range",
      conf: confidence(prosody.voiceQuality === "tense" ? 0.62 : 0.56)
    });
  }

  if (strongest?.z >= 1.2 && !FILLED_PAUSES.has(strongest.normalized)) {
    flags.push({
      type: "emphasis",
      evidence: `strong stress on "${strongest.word}"`,
      conf: confidence(0.52 + strongest.z * 0.08)
    });
  }

  if (softenerCount > 0 && (prosody.energy === "high" || prosody.rate === "fast")) {
    flags.push({
      type: "lexical_prosodic_mismatch",
      evidence: "softening language with elevated delivery",
      conf: 0.61
    });
  } else if (positiveCount > negativeCount && (prosody.energy === "low" || prosody.pitchRange === "narrow") && prosody.rate !== "fast") {
    flags.push({
      type: "lexical_prosodic_mismatch",
      evidence: "positive wording with flat or low-energy delivery",
      conf: 0.6
    });
  }

  return flags;
}

function confidence(value) {
  return round(clamp(value, 0.01, 0.99), 2);
}

function countConfusionMarkers(text, normalizedWords) {
  const phraseText = ` ${text.toLowerCase().replace(/[^a-z0-9']+/g, " ")} `;
  const phraseCount = [
    " not sure ",
    " don't know ",
    " do not know ",
    " i guess ",
    " i think ",
    " no idea ",
    " help me understand "
  ].filter((phrase) => phraseText.includes(phrase)).length;
  const wordCount = normalizedWords.filter((word) => CONFUSION_WORDS.has(word)).length;
  return phraseCount + wordCount;
}

function countSofteners(normalizedWords) {
  let count = 0;
  for (let index = 0; index < normalizedWords.length; index += 1) {
    const word = normalizedWords[index];
    if (!SOFTENERS.has(word)) continue;
    if (word === "just" && ["as", "like", "because", "when", "where", "after", "before"].includes(normalizedWords[index + 1])) {
      continue;
    }
    count += 1;
  }
  return count;
}

function isYelling(prosody, summary, baseline) {
  const extremeEnergy = isBaseline(baseline)
    ? zScore(summary.energyPeak, baseline.energyPeak.mean, baseline.energyPeak.stdev) >= THRESHOLDS.yellingEnergyPeakZ
      || zScore(summary.energyMean, baseline.energy.mean, baseline.energy.stdev) >= THRESHOLDS.yellingEnergyMeanZ
    : summary.energyPeak >= THRESHOLDS.yellingEnergyPeakNoBaseline || summary.energyMean >= THRESHOLDS.yellingEnergyMeanNoBaseline;
  const elevatedDelivery = prosody.energy === "high" && (prosody.pitchRange === "wide" || prosody.rate === "fast" || prosody.voiceQuality === "tense");
  return extremeEnergy && elevatedDelivery && prosody.pauseDensity !== "high";
}

function yellingEvidence(prosody, summary) {
  const pieces = [
    "very high energy",
    `${prosody.pitchRange} pitch range`,
    `${prosody.rate} rate`
  ];
  if (prosody.voiceQuality === "tense") pieces.push("tense voice quality");
  pieces.push(`energy peak ${round(summary.energyPeak, 2)}`);
  return pieces.join(" + ");
}

function isConfused(text, prosody, filledPauseCount, softenerCount, confusionMarkerCount) {
  const questionLike = /[?]\s*$/.test(text.trim()) || confusionMarkerCount > 0;
  const uncertainDelivery = prosody.pauseDensity === "high"
    || prosody.terminalPitch === "rising"
    || prosody.rate === "slow"
    || filledPauseCount > 0
    || softenerCount > 0;
  return questionLike && uncertainDelivery;
}

function isUncertainRise(text, prosody, filledPauseCount, softenerCount, confusionMarkerCount) {
  if (prosody.terminalPitch !== "rising" || /[?]\s*$/.test(text.trim())) return false;
  // Rising terminal pitch on a non-question is only weak evidence; require a real
  // uncertainty signal (filled pause, softener, confusion marker, or high pause density)
  // rather than mere brevity, which short high-arousal declaratives (e.g. acted anger) also share.
  const hasUncertaintyContext = filledPauseCount > 0
    || softenerCount > 0
    || confusionMarkerCount > 0
    || prosody.pauseDensity === "high";
  return hasUncertaintyContext;
}

function confusionEvidence(prosody, filledPauseCount, softenerCount, confusionMarkerCount) {
  const pieces = [];
  if (confusionMarkerCount > 0) pieces.push(`${confusionMarkerCount} confusion marker${confusionMarkerCount === 1 ? "" : "s"}`);
  if (filledPauseCount > 0) pieces.push(`${filledPauseCount} filled pause${filledPauseCount === 1 ? "" : "s"}`);
  if (softenerCount > 0) pieces.push(`${softenerCount} softener${softenerCount === 1 ? "" : "s"}`);
  if (prosody.pauseDensity === "high") pieces.push("high pause density");
  if (prosody.terminalPitch === "rising") pieces.push("rising terminal pitch");
  if (prosody.rate === "slow") pieces.push("slow rate");
  return pieces.join(" + ") || "question-like language with uncertain delivery";
}
