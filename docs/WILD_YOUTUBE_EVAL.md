# Wild YouTube Speech Eval

Controlled acted corpora are useful, but they are too clean to expose all the ways a voice plugin can fail. The wild YouTube eval is the raw-data companion: short natural speech clips, YouTube/provider audio compression, real microphones, room tone, public speaking cadence, and captions used as the transcript proxy.

Run:

```sh
npm run wild:youtube
```

Reports:

- `eval/wild/out/youtube-wild-report.json`
- `eval/wild/out/youtube-wild-report.md`

## Toolchain

The harness uses:

- `yt-dlp` to fetch short YouTube audio segments and captions
- `ffmpeg` for segment extraction and WAV conversion
- Python `imageio-ffmpeg` as a fallback ffmpeg provider when system `ffmpeg` is not on PATH

The runtime engine does not bundle these tools. They are only for the opt-in benchmark.

## Included Sources

| Source | Clips | Natural Setting |
| --- | ---: | --- |
| MIT OpenCourseWare | 3 | classroom Q&A, professor answer, discussion with fillers |
| NASA | 2 | remote Q&A and press-conference answer |
| The White House | 1 | press briefing |
| City of Arvada | 1 | public meeting room audio |
| USGS Presentations | 1 | public science lecture |
| PyCon US | 1 | technical conference talk |
| FOSDEM | 1 | technical conference talk |
| GitButler | 1 | higher-energy technical talk |
| Stanford Online | 1 | university lecture |
| TED | 1 | stage public-speaking talk |
| Google for Developers | 1 | developer keynote |

The manifest is [eval/wild/youtube-cases.json](../eval/wild/youtube-cases.json).

## What The Benchmark Tests

Subtext checks whether natural-speech emotion and intent cues improve assistant handoff behavior:

- audience question clips should surface question evidence or uncertainty-style context
- neutral/public-speech clips should not false-flag yelling, urgency, or tension
- genuine filled pauses and long pauses should surface hesitation
- high-energy technical delivery may surface emphasis, but should not be treated as yelling by default

## Latest Local Result

The checked-in current baseline is [eval/wild/BASELINE.md](../eval/wild/BASELINE.md).

Latest checked-in baseline:

- 11 natural YouTube clips
- 8 source channels
- 8 natural speech settings
- 11/11 matched expected assistant-handoff behavior

The manifest now contains 14 candidate clips across 11 source channels. The three added clips expand coverage to Stanford Online, TED, and Google for Developers. They are intentionally tracked in the manifest before claiming a new baseline; public YouTube access can require cookies or alternate `yt-dlp` client arguments in some environments.

Raw-data flaws found and fixed:

- caption windows could include neighboring speaker text
- YouTube auto-caption VTT internals could duplicate transcript text
- wh-words alone were too broad as confusion markers
- `kind` caused false softener matches in ordinary phrases
- `just` needed context-aware handling
- rising terminal pitch was too eager in long public-speech clips
- loud classroom mic gain should not fail clear delivery unless it creates a steering flag

## Boundary

This benchmark is sampled and pragmatic. It relies on YouTube captions as a stand-in for platform-native STT and uses short windows from public videos. It is meant to find flaws, not certify real-world emotion recognition.

If YouTube blocks unauthenticated downloads, use:

```sh
npm run wild:youtube -- --allow-unavailable
npm run wild:youtube -- --case stanford_cs224n_lecture --allow-unavailable
SUBTEXT_YTDLP_ARGS='--cookies-from-browser safari' npm run wild:youtube
```
