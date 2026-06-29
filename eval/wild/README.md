# Wild YouTube Speech Benchmark

This opt-in harness downloads short natural speech segments from public YouTube sources, extracts English captions as the transcript proxy, and checks whether Subtext emits useful or harmful assistant-handoff cues.

Run:

```sh
npm run wild:youtube
```

Download only:

```sh
npm run wild:youtube:download
```

Focused runs and provider-access troubleshooting:

```sh
node scripts/run-wild-youtube-eval.mjs --case mit_ocw_audience_question
node scripts/run-wild-youtube-eval.mjs --source "MIT OpenCourseWare"
node scripts/run-wild-youtube-eval.mjs --case stanford_cs224n_lecture --allow-unavailable
SUBTEXT_YTDLP_ARGS='--cookies-from-browser safari' npm run wild:youtube
```

`--allow-unavailable` records YouTube/caption access failures as unavailable sources instead of confusing them with model failures. Use `SUBTEXT_YTDLP_ARGS` or `--yt-dlp-args` when your environment needs cookies or alternate `yt-dlp` extractor settings.

Outputs:

- `eval/wild/out/youtube-wild-report.json`
- `eval/wild/out/youtube-wild-report.md`

The checked-in current baseline is `eval/wild/BASELINE.md`.

Downloaded clips and captions are cached in `eval/wild/cache/` and ignored by git.

## Sources

The manifest currently includes 14 candidate clips from:

- MIT OpenCourseWare: classroom Q&A and classroom discussion.
- NASA: remote Q&A and press-conference audio.
- The White House: press briefing audio.
- City of Arvada: public meeting room audio.
- USGS Presentations: public science lecture audio.
- PyCon US, FOSDEM, and GitButler: conference technical talks.
- Stanford Online: university lecture audio.
- TED: stage public-speaking talk.
- Google for Developers: developer keynote audio.

## What Counts As A Pass

This benchmark does not ask Subtext to infer emotion. It asks whether natural speech creates appropriate assistant handoff context:

- audience questions should surface question evidence or uncertainty-style context
- neutral lectures, press briefings, and public comments should not false-flag yelling, urgency, or tension
- natural fillers and long pauses should surface hesitation when the clip genuinely contains them
- energetic technical talks may surface emphasis, but should not become yelling or urgency by default

Misses are valuable. They reveal raw-data failures in transcript slicing, caption quality, softener semantics, question handling, pitch extraction, and false-positive flag rules.
