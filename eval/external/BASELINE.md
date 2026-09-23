# External Emotion Baseline (contract-scored)

```sh
npm run external:emotion                               # in-sample, 25 clips
node scripts/run-external-emotion-eval.mjs --holdout   # plus held-out-by-corpus refit
```

Every clip is scored on what the assistant actually receives: the contract's
`affect.emotional_coloring` and `flags`. Nothing the harness derives from raw
prosody counts.

## Why the old 21/25 was retired

The previous harness passed a clip when any of a list of harness-side signals
fired. For the 6 angry clips the list was `aroused, energy_high, rate_fast,
flag_urgency, voice_tense`, and 4 of the 5 angry passes matched only `aroused`
(true whenever the pitch range was wide or the rate fast), which also fired on
most neutral clips. Meanwhile the contract told the assistant "subdued" for every
CREMA-D clip regardless of emotion, "neutral" for both RAVDESS angry clips, and
raised a flag on only 2 of 25 clips. 21/25 measured the harness, not the product.

## Label rules

| Label | Must read | Must not read |
| --- | --- | --- |
| angry | aroused (coloring tense/urgent/high_intensity, or a tension/urgency/yelling flag) | subdued |
| fearful | aroused, or uncertain/hesitant | subdued |
| happy | aroused or neutral (the contract has no positive-arousal word) | subdued, uncertain/hesitant |
| sad | subdued, or hesitant | aroused |
| neutral | neutral or emphatic coloring | any steering flag (yelling, urgency, tension, hesitation, confusion, uncertainty) |

## Before: engine at 8a11df6 (absolute-RMS energy), contract-scored

Result: 8/25 (0.32).

| Label | aroused | subdued | uncertain | neutral | mixed | Pass |
| --- | --- | --- | --- | --- | --- | --- |
| angry | 1 | 2 | 0 | 3 | 0 | 1/6 |
| fearful | 0 | 2 | 1 | 0 | 0 | 1/3 |
| happy | 0 | 4 | 0 | 1 | 0 | 1/5 |
| neutral | 1 | 3 | 0 | 1 | 0 | 1/5 |
| sad | 0 | 4 | 0 | 2 | 0 | 4/6 |

Sad's 4/6 is not skill: 15 of 25 clips across every label read "subdued",
because the uncalibrated energy cut was an absolute RMS level and CREMA-D and
RAVDESS are simply recorded quieter than EmoDB.

Important: acted emotion labels, 25 clips, 3 corpora. This is a check on what the
assistant is told, not an emotion classifier or a psychological assessment.

## Sources

- CREMA-D: `https://github.com/CheyneyComputerScience/CREMA-D`
- RAVDESS Hugging Face mirror: `https://huggingface.co/datasets/birgermoell/ravdess`
- Berlin EmoDB Zenodo: `https://zenodo.org/records/7447302`
