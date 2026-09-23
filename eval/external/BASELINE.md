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

## After: gain-invariant uncalibrated read (vocal effort from spectral balance)

Result: 19/25 (0.76). `npm run external:emotion` enforces >= 0.7.

| Label | aroused | subdued | uncertain | neutral | mixed | Pass |
| --- | --- | --- | --- | --- | --- | --- |
| angry | 5 | 0 | 0 | 1 | 0 | 5/6 |
| fearful | 1 | 0 | 1 | 1 | 0 | 2/3 |
| happy | 0 | 1 | 0 | 4 | 0 | 4/5 |
| neutral | 1 | 0 | 0 | 4 | 0 | 4/5 |
| sad | 0 | 3 | 1 | 2 | 0 | 4/6 |

What this does and does not show:

- Arousal separates. 5 of 6 angry clips now reach the assistant as tense or
  high-intensity (before: 1), and 4 of 5 neutral clips as neutral. "Subdued" is
  said 4 times in 25, 3 of them to sad clips (before: 15 times, to every label).
- Happy is NOT separated from neutral. 4 of 5 happy clips read neutral and none
  read aroused; happy passes only because its rule tolerates neutral. The
  spectral-balance cue that lifts anger does not lift acted happiness, and the
  contract has no positive-arousal word to say it with anyway. Valence is not
  conveyed.
- Fear is inconsistent: one tense, one uncertain, one neutral.
- Sad is half right: 3 subdued plus 1 hesitant. Two CREMA-D sad takes are too
  quiet relative to their room noise for pitch and spectrum to be measured.
- The one neutral miss is personal-baseline mode (tension from voice quality
  against a 3-clip baseline), not the uncalibrated path.

Misses: crema_angry_dfa, crema_sad_dfa, crema_happy_ieo_1002 (read subdued at
4.86 st pitch range, 0.14 st under the narrow cut), crema_sad_ieo_1002,
ravdess_fearful_actor02, emodb_neutral_a02_sp15_personal.

## Held out by corpus

`npm run external:emotion:holdout` refits the three uncalibrated cutoffs
(effort high, effort low, narrow pitch) on two corpora by grid search, takes the
centre of the tied-best plateau, and scores the third corpus.

| Held out | Train pass | Refit (effort high / low dB / narrow st) | Tied-best range on train | Held-out (refit) | Held-out (shipped) |
| --- | --- | --- | --- | --- | --- |
| CREMA-D | 15/16 | -10 / -17 / 6 | -12..-8 / -22..-13 / 3..7 | 6/9 | 5/9 |
| RAVDESS | 13/16 | -11 / -18 / 4 | -12..-9 / -22..-15 / 3..5 | 8/9 | 8/9 |
| Berlin EmoDB | 16/18 | -11 / -19 / 5 | -12..-9 / -22..-15 / 5 | 6/7 | 6/7 |

Held-out total: 20/25 (0.80), against 19/25 in-sample with the shipped cutoffs.

| Label | aroused | subdued | uncertain | neutral | mixed | Pass |
| --- | --- | --- | --- | --- | --- | --- |
| angry | 6 | 0 | 0 | 0 | 0 | 6/6 |
| fearful | 2 | 0 | 1 | 0 | 0 | 3/3 |
| happy | 3 | 0 | 0 | 2 | 0 | 5/5 |
| neutral | 1 | 1 | 0 | 3 | 0 | 3/5 |
| sad | 1 | 2 | 1 | 2 | 0 | 3/6 |

Read this carefully: held-out is not lower than in-sample because the shipped
effort-high cut (-6 dB) is not the acted optimum. Every fold's refit wants -9 to
-12 dB, which catches more acted anger, fear and happiness, but at -9 dB three
calm wild YouTube clips (NASA Q&A, White House briefing, USGS lecture) get
tension or urgency flags, and at -12 dB six do. The shipped cut is the lowest
that keeps calm wild speech clean (none flagged at -7 dB or above), plus margin.
The low-effort and narrow-pitch cuts are stable across folds (-17 to -19 dB,
4 to 6 st) but the plateaus are wide, i.e. the data barely constrain them.

Gain invariance: every acted clip and every golden fixture produces identical
affect, flags, prosody, guidance and emphasis words at 0.25x, 1x and 4x
amplitude (test/gain-invariance.test.js). On the old engine 27 of those 35
clips changed their coloring or flags across the three gains.

Important: acted emotion labels, 25 clips, 3 corpora. This is a check on what the
assistant is told, not an emotion classifier or a psychological assessment.

## Sources

- CREMA-D: `https://github.com/CheyneyComputerScience/CREMA-D`
- RAVDESS Hugging Face mirror: `https://huggingface.co/datasets/birgermoell/ravdess`
- Berlin EmoDB Zenodo: `https://zenodo.org/records/7447302`
