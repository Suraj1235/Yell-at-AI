# vocalcontext/v1

The contract is the compatibility layer across every host.

```json
{
  "schema": "vocalcontext/v1",
  "text": "can we just refactor the whole auth module",
  "transcript": {
    "source": "platform-native-voice",
    "word_timestamps": true,
    "confidence": 0.97,
    "language": "en"
  },
  "emphasis": [
    { "word": "whole", "z": 2.1, "start": 1.42, "end": 1.83 }
  ],
  "prosody": {
    "rate": "fast",
    "pause_density": "low",
    "terminal_pitch": "falling",
    "energy": "high",
    "pitch_range": "wide",
    "voice_quality": "steady"
  },
  "affect": {
    "emotional_coloring": "emphatic",
    "meaning_cues": ["emphasis"],
    "interpretation": "Emphatic delivery; preserve stressed words as intentional constraints or priorities.",
    "confidence": 0.63,
    "evidence": ["normal rate, medium energy, wide pitch range", "emphasis: strong stress on \"whole\""]
  },
  "assistant_guidance": {
    "priority": "preserve_emphasis",
    "response_style": "focused",
    "directives": [
      {
        "type": "preserve_emphasis",
        "text": "Preserve stressed words as likely constraints or priorities: whole.",
        "source_flag": "emphasis",
        "confidence": 0.63
      }
    ]
  },
  "word_features": [
    {
      "word": "whole",
      "start": 1.42,
      "end": 1.83,
      "duration_frames": 9.7,
      "log_f0_range": 0.08,
      "log_f0_median": 5.5,
      "log_f0_slope": 0.12,
      "log_energy": 1.27,
      "duration_source": "estimated_phone_duration"
    }
  ],
  "flags": [
    {
      "type": "emphasis",
      "evidence": "strong stress on \"whole\"",
      "conf": 0.63
    }
  ],
  "alignment": {
    "source": "platform_word_timestamps",
    "confidence": 1,
    "matched_words": 8,
    "total_words": 8
  },
  "calibration": {
    "baseline": "utterance",
    "samples": 1
  }
}
```

## Compatibility Rules

- `schema` is required and semver-like. Breaking changes require `vocalcontext/v2`.
- `transcript` records where the text came from, whether native word timestamps were available, and optional language/confidence metadata. Input adapters should use `subtext/transcript/v1`; see [NATIVE_TRANSCRIPT_BRIDGE.md](NATIVE_TRANSCRIPT_BRIDGE.md).
- `affect` is the assistant-facing natural-speech meaning layer: emotional coloring, meaning cues, interpretation guidance, confidence, and evidence.
- `assistant_guidance` turns vocal evidence into explicit response behavior for every harness. It is guidance, not a claim about the user's psychological state.
- `word_features` exposes the five word-level prosody dimensions used for stress and emotion cues. `duration_frames` uses platform phone timestamps when available and estimated phone duration otherwise.
- Flags must include evidence and confidence.
- Flags must stay grounded in observable cues so emotional interpretation is inspectable.
- `alignment.source` reports whether word-level emphasis used host word timestamps or proportional fallback.
- Unknown adapter metadata belongs outside the contract.
- Human-readable prompt blocks should be generated from the JSON contract, not hand-written.

The machine-readable schema lives at `schemas/vocalcontext.v1.schema.json`.

## Token View

The same contract can be read as a set of explicit prosody style tokens:

```text
transcript.source=platform-native-voice
transcript.word_timestamps=true
delivery.rate=fast
delivery.energy=high
contour.pitch_range=wide
contour.terminal_pitch=falling
emphasis.word=whole z=2.1
affect.emotional_coloring=emphatic
assistant_guidance.priority=preserve_emphasis
assistant_guidance.directive=preserve_emphasis
word.whole.duration_frames=9.7
word.whole.log_f0_range=0.08
word.whole.log_f0_median=5.5
word.whole.log_f0_slope=0.12
word.whole.log_energy=1.27
flag.emphasis conf=0.63
alignment.source=platform_word_timestamps confidence=1 matched=8/8
calibration.baseline=utterance
```

These are not latent vectors or model-internal embeddings. They are explainable tokens intended for the platform-native assistant model to use as context.

## Current Flag Types

| Flag | Meaning |
| --- | --- |
| `yelling` | very high energy plus elevated delivery |
| `emphasis` | strong word stress from duration frames, Log-F0 range, Log-F0 median, Log-F0 slope, and Log-energy |
| `confusion` | question/confusion markers plus hesitant or rising delivery |
| `hesitation` | filled pauses or high pause density |
| `uncertainty` | rising terminal pitch on non-question text |
| `urgency` | fast, high-energy delivery with few pauses |
| `tension` | voice-quality strain evidence |
| `lexical_prosodic_mismatch` | words and prosody point in different directions |

## Affect Colorings

`affect.emotional_coloring` is the compact natural-speech meaning hint for the host assistant:

| Coloring | Meaning |
| --- | --- |
| `neutral` | no strong emotional coloring detected |
| `subdued` | low-energy or narrow-range delivery |
| `emphatic` | stressed delivery that marks priority or constraint |
| `urgent` | fast, high-energy delivery |
| `uncertain` | confusion or rising/uncertain delivery |
| `hesitant` | filled pauses or high pause density |
| `tense` | strain-like voice-quality evidence |
| `mixed` | transcript and tone point in different directions |
| `high_intensity` | yelling/high-intensity emotional delivery |
