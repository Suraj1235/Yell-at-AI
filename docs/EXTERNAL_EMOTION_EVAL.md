# External Emotion Evidence Eval

This project includes an opt-in benchmark using 25 scripted, acted emotion-labeled audio clips from the web. It is designed to find flaws in Subtext's prosody evidence extraction.

Run:

```sh
npm run external:emotion
```

Reports:

- `eval/external/out/emotion-eval-report.json`
- `eval/external/out/emotion-eval-report.md`

## Included Sources

| Source | Clips | Labels Used | Notes |
| --- | ---: | --- | --- |
| CREMA-D | 9 | angry, happy, sad, fearful, neutral | acted English speech, direct WAV URLs from GitHub |
| RAVDESS | 9 | happy, sad, angry, fearful, neutral | acted English theatrical speech, individual WAV URLs from Hugging Face mirror |
| Berlin EmoDB | 7 | angry, happy, sad, neutral | acted German speech, extracted from Zenodo archive, including same-speaker calibrated cases |

The manifest is [eval/external/emotion-cases.json](../eval/external/emotion-cases.json).

## What The Benchmark Tests

Subtext's value prop is helping AI understand what you mean and the emotion of your natural speech, not just plain transcript text. This benchmark maps known acted labels to expected prosodic evidence and affect cues:

- angry/fearful/happy: arousal cues such as high energy, fast rate, wide pitch range, urgency, or tension
- sad: subdued cues such as low energy, slow rate, high pauses, or narrow pitch range
- neutral: clear delivery with no strong urgency/tension/hesitation/yelling flags

This intentionally tests a weaker and safer claim than "emotion detection": whether the vocal evidence is directionally compatible with known labels.

## Latest Local Result

After tightening neutral expectations, the benchmark should be treated as a flaw-finder. The checked-in current baseline is [eval/external/BASELINE.md](../eval/external/BASELINE.md).

Latest local baseline:

- 25 web audio clips
- 3 sources
- 5 known labels
- 21/25 matched expected broad prosody evidence
- 4/25 exposed flaws

Observed M0 weaknesses from the current corpus:

- One CREMA-D happy clip is read as subdued under utterance-only global thresholds.
- At least one Berlin EmoDB sad clip is not read as subdued under global, speaker-agnostic thresholds.
- Same-speaker calibration helps a Berlin EmoDB sad case, but does not rescue every angry/neutral case.
- One calibrated Berlin EmoDB neutral case still false-flags tension because pitch/voice-quality proxies are too brittle on that clip.
- Happy, angry, and fearful often collapse into a shared "aroused" evidence family; M0 does not reliably separate positive vs negative valence.
- Speaker or corpus baselines are needed before any stronger label-level claim can be made.

## Dataset Boundary

Downloaded clips are cached under `eval/external/cache/` and ignored by git. The benchmark stores source URLs and generated reports, not bundled third-party audio.
