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

Each acted clip is scored only on what the assistant receives: the contract's `affect.emotional_coloring` and `flags`. One rule per label: angry must read aroused and not subdued; fearful aroused or uncertain; happy aroused or neutral, never subdued or uncertain; sad subdued or hesitant, never aroused; neutral must read neutral with no steering flag. The rules and the per-label confusion table are in [eval/external/README.md](../eval/external/README.md) and [eval/external/BASELINE.md](../eval/external/BASELINE.md).

This intentionally tests a weaker and safer claim than "emotion detection": whether what the assistant is told is directionally compatible with known labels.

## Latest Local Result

- 19/25 in-sample; held out by corpus (cutoffs refit on the other two corpora), 20/25
- angry 5/6, neutral 4/5, sad 4/6, fearful 2/3, happy 4/5
- before the gain-invariant engine change: 8/25 on the same contract-only scoring (the old 21/25 counted harness-side signals the assistant never saw)

What model-free DSP does and does not separate here:

- Arousal separates: acted anger reaches the assistant as tense or high-intensity; neutral stays neutral.
- Happy does not separate from neutral (4 of 5 happy clips read neutral); valence is not conveyed.
- Fear is inconsistent, and two quiet, noisy CREMA-D sad takes cannot be measured reliably.
- One calibrated Berlin EmoDB neutral case still false-flags tension from voice-quality proxies.

## Dataset Boundary

Downloaded clips are cached under `eval/external/cache/` and ignored by git. The benchmark stores source URLs and generated reports, not bundled third-party audio.
