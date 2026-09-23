# External Emotion Evidence Benchmark

This opt-in harness downloads acted, scripted emotion-labeled WAV clips from public research datasets and checks whether Subtext emits compatible prosodic evidence.

Run:

```sh
npm run external:emotion
```

Download only:

```sh
npm run external:emotion:download
```

Outputs:

- `eval/external/out/emotion-eval-report.json`
- `eval/external/out/emotion-eval-report.md`

The checked-in current baseline is `eval/external/BASELINE.md`.

Downloaded audio is cached in `eval/external/cache/` and ignored by git.

## Sources

The manifest currently includes 25 clips from:

- CREMA-D: acted English speech from the CheyneyComputerScience/CREMA-D GitHub repository.
- RAVDESS: acted English theatrical speech, fetched from the `birgermoell/ravdess` Hugging Face mirror of the CC BY-NC-SA 4.0 dataset.
- Berlin EmoDB: acted German speech, fetched from Zenodo record `7447302`, licensed CC BY 4.0, including same-speaker calibrated probes.

## What Counts As A Pass

A clip is scored only on what the assistant receives: the contract's
`affect.emotional_coloring` and `flags`. The harness never adds signals of its
own. The manifest may only name contract signals (`coloring_*`, `flag_*`, and
the composites `reads_aroused`, `reads_subdued`, `reads_uncertain`,
`reads_neutral`, `steering_flag`, all defined from coloring and flags), and
every clip with the same label must use the same rule. The script refuses a
manifest that breaks either constraint.

- angry: must read aroused (tense/urgent/high_intensity coloring, or a tension/urgency/yelling flag); must not read subdued
- fearful: must read aroused or uncertain/hesitant; must not read subdued
- happy: must read aroused or neutral; must not read subdued or uncertain (the contract has no positive-arousal word, so "tense" is the closest it can say)
- sad: must read subdued or hesitant; must not read aroused
- neutral: must read neutral/emphatic; no steering flag

The report includes a per-label confusion table of what the coloring told the
assistant, which is the number to read; the pass rate alone hides a detector
that says the same thing for every clip.

`--holdout` refits the uncalibrated vocal-effort and pitch-range cutoffs on two
corpora, scores the third with the refit values, and rotates, so the in-sample
number can be compared with a held-out one.
