# External Emotion Evidence Baseline

Generated locally on 2026-06-27 with:

```sh
npm run external:emotion
```

Result: 21/25 clips matched expected prosody evidence. Pass rate: 0.84.

Important: this is an acted-emotion prosody evidence benchmark, not an emotion classifier.

| Result | Case | Source | Known Label | Calibration | Energy | Rate | Pitch Range | Pause Density | Flags | Matched Evidence | Flaw |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PASS | crema_angry_dfa | CREMA-D | angry | utterance | low | slow | wide | low | uncertainty | aroused |  |
| PASS | crema_happy_dfa | CREMA-D | happy | utterance | low | normal | wide | low | uncertainty | aroused, pitch_wide |  |
| PASS | crema_sad_dfa | CREMA-D | sad | utterance | low | normal | medium | low | none | subdued, energy_low |  |
| PASS | crema_neutral_dfa | CREMA-D | neutral | utterance | low | normal | wide | low | none | delivery_clear |  |
| PASS | crema_angry_ieo_1002 | CREMA-D | angry | utterance | low | slow | wide | low | none | aroused |  |
| MISS | crema_happy_ieo_1002 | CREMA-D | happy | utterance | low | slow | medium | low | none | none | Happy clip is read as subdued/low-energy under global thresholds |
| PASS | crema_sad_ieo_1002 | CREMA-D | sad | utterance | low | slow | medium | low | none | subdued, energy_low, rate_slow |  |
| PASS | crema_fear_ieo_1002 | CREMA-D | fearful | utterance | low | slow | wide | low | uncertainty | aroused, pitch_wide, terminal_rising, flag_uncertainty |  |
| PASS | crema_neutral_ieo_1002 | CREMA-D | neutral | utterance | low | slow | medium | low | none | delivery_clear |  |
| PASS | ravdess_happy_speech | RAVDESS | happy | utterance | low | fast | medium | low | none | aroused, rate_fast |  |
| PASS | ravdess_sad_speech | RAVDESS | sad | utterance | low | fast | narrow | low | none | subdued, energy_low, pitch_narrow |  |
| PASS | ravdess_angry_speech | RAVDESS | angry | utterance | medium | normal | wide | low | none | aroused |  |
| PASS | ravdess_fearful_speech | RAVDESS | fearful | utterance | low | normal | wide | high | hesitation | aroused, pitch_wide |  |
| PASS | ravdess_neutral_actor02 | RAVDESS | neutral | utterance | low | fast | wide | low | none | delivery_clear |  |
| PASS | ravdess_happy_actor02 | RAVDESS | happy | utterance | low | normal | wide | low | none | aroused, pitch_wide |  |
| PASS | ravdess_sad_actor02 | RAVDESS | sad | utterance | low | fast | medium | moderate | emphasis | subdued, energy_low |  |
| PASS | ravdess_angry_actor02 | RAVDESS | angry | utterance | medium | normal | wide | low | none | aroused |  |
| PASS | ravdess_fearful_actor02 | RAVDESS | fearful | utterance | low | fast | wide | low | none | aroused, pitch_wide |  |
| PASS | emodb_angry_a02 | Berlin EmoDB | angry | utterance | medium | fast | wide | low | tension | aroused, rate_fast, voice_tense |  |
| PASS | emodb_happy_a02 | Berlin EmoDB | happy | utterance | medium | normal | wide | low | none | aroused, pitch_wide |  |
| MISS | emodb_sad_a02 | Berlin EmoDB | sad | utterance | medium | normal | medium | low | none | none | Sad clip is not subdued under global thresholds |
| PASS | emodb_neutral_a02 | Berlin EmoDB | neutral | utterance | medium | fast | wide | low | none | delivery_clear |  |
| PASS | emodb_sad_b02_sp15_personal | Berlin EmoDB | sad | personal(3) | high | slow | medium | low | none | subdued, rate_slow |  |
| MISS | emodb_angry_a02_sp15_personal | Berlin EmoDB | angry | personal(3) | medium | normal | medium | low | none | none | Same-speaker baseline does not surface arousal cues for this anger clip |
| MISS | emodb_neutral_a02_sp15_personal | Berlin EmoDB | neutral | personal(3) | low | slow | wide | low | tension | none | Pitch/voice-quality proxies false-flag tension |

## What This Exposes

- M0 is useful for broad arousal/subdued evidence, but still weak at separating happy, angry, and fearful valence.
- Neutral expectations are now behavior-based: no strong assistant-steering flags, not perfectly flat prosody.
- Same-speaker calibration can help speaker-relative sadness, but it is not a general emotion detector.
- Voice-quality and pitch-range proxies remain brittle on some acted German clips.
- Stronger label-level claims need larger real-world corpora, speaker baselines, and platform word timestamps.

## Sources

- CREMA-D: `https://github.com/CheyneyComputerScience/CREMA-D`
- RAVDESS Hugging Face mirror: `https://huggingface.co/datasets/birgermoell/ravdess`
- Berlin EmoDB Zenodo: `https://zenodo.org/records/7447302`
