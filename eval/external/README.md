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

This benchmark does not ask Subtext to classify emotion. It asks whether known emotion labels have compatible prosodic evidence:

- angry/fearful/happy often expect arousal evidence such as high energy, fast rate, wide pitch range, urgency, or tension
- sad often expects subdued evidence such as low energy, slow rate, high pauses, or narrow pitch range
- neutral expects clear delivery and no strong urgency/tension/hesitation/yelling cue

Misses are valuable. They reveal where M0 thresholds, alignment, pitch extraction, or utterance-local calibration do not generalize.
