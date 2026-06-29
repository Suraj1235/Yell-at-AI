# Testing Matrix

Subtext is tested as an offline, local-first project. The current harness verifies the reference engine, package build, adapter boundaries, and benchmark/eval artifacts without requiring Claude Code, Codex, or a paid model account to be installed.

## One Command

```sh
npm run check
```

This runs:

- `npm run build`
- `npm test`
- `npm run bench`
- `npm run smoke`
- `npm run eval:judge`

For a push/release-style gate that also checks harness readiness, adapter bundles, and assistant-guidance preservation, run:

```sh
npm run readiness
```

This emits a `subtext/release-readiness/v1` JSON report after running the full `check` pipeline, the native desktop scaffold check, `subtext doctor`, adapter packaging, harness conformance, and cue-level guidance probes for yelling, emphasis, and confusion against both JSON and rendered prompt output.

## Build Validation

```sh
npm run build
```

Runs `npm pack --dry-run --json` and asserts the package includes the runnable CLI, core engine, schema, docs, license files, app scaffold, and adapter templates. There is no compile step in M0 because the reference implementation is pure Node.js.

## Native Desktop Scaffold Check

```sh
npm run desktop:check
```

Validates the Tauri config, Cargo manifest, Rust command bridge, generated-config loader, browser UI bridge, hotkey placeholder, and native desktop docs. This proves the signed-app launch track is structurally present; it does not build, sign, notarize, or install a native binary.

## Unit And Golden Tests

```sh
npm test
```

Regenerates synthetic WAV fixtures and runs Node's built-in test runner.

Covered:

- WAV encode/parse round trip
- strict public schema shape
- analyzer output shape
- transcript provenance and native word-timestamp metadata
- the `subtext/transcript/v1` native voice bridge envelope
- platform word timestamp alignment and required-match failure behavior
- grounded affect summary for natural-speech emotion and meaning
- five word-level prosody dimensions
- platform phone timestamps feeding the duration prosody dimension
- emphasis detection
- yelling flag evidence
- baseline calibration suppressing false urgency/yelling for naturally fast loud speech
- baseline calibration suppressing false hesitation for naturally pausy speech
- baseline calibration normalizing naturally wide pitch range
- rolling baseline merge sample counts and pooled signal spread
- confusion flag evidence
- explicit emphasis flag evidence
- urgency flag evidence
- hesitation flag evidence
- recording-frame silence ignored as false hesitation/tension
- lexical/prosodic mismatch evidence
- prompt rendering

## Functional Adapter Tests

```sh
npm run test:functional
```

Covered:

- CLI `analyze` renders an injectable `vocalcontext/v1` prompt
- CLI/HTTP/MCP paths accept host-provided `subtext/transcript/v1` metadata and word timestamps
- HTTP server `/health` and `/v1/analyze`
- HTTP server `/v1/analyze-audio`
- HTTP server `/v1/calibrate`
- HTTP server rolling calibration updates
- Browser microphone preview HTML and JavaScript routes
- Browser preview transcript provenance for manual text and browser SpeechRecognition dictation
- Browser microphone selection and device-aware local profile switching
- CLI `calibrate` producing reusable baseline files
- CLI `calibrate --baseline` updating existing baseline files
- CLI named profile store for calibrate/list/show/delete/analyze
- CLI `capture` using a fake recorder to validate bounded desktop capture without microphone access
- CLI `session` using a fake recorder plus `--transcript-command` to validate the host/native transcript bridge, structured transcript JSON, native word-timestamp alignment, and paste handoff
- CLI `ptt` using a fake recorder to validate repeated bounded natural-speech turns with structured transcript metadata
- CLI `handoff` targeting stdout, file, a test clipboard command, and a test active-app paste command
- MCP-style JSON-RPC `initialize`, `tools/list`, and `tools/call` for local audio paths and base64 audio
- Claude Code `UserPromptSubmit` hook template enriches prompt events
- Claude Code hook preserves `subtext/transcript/v1` source, word timestamps, and phone-derived duration features
- Claude Code hook passes through text-only events
- Codex MCP config example remains parseable
- VS Code extension metadata remains parseable
- VS Code adapter runner renders an enriched prompt from generated WAV fixtures
- VS Code adapter runner preserves `subtext/transcript/v1` source, word timestamps, and alignment metadata
- Global hotkey adapter docs and Hammerspoon template are present and packageable
- Native desktop Tauri/Rust scaffold is present, doctor-checked, packageable, and installable with generated config
- CLI `doctor` verifies harness adapter readiness
- `package:adapters` emits local bundles for all harnesses
- `install-adapter` writes concrete host config and runnable copied hooks
- Harness catalog covers CLI, HTTP, web preview, desktop capture, MCP, Codex, Claude Code, realtime, VS Code, hotkey, native desktop, and universal targets

These tests validate Subtext's plugin boundaries. They do not claim that Claude Code or Codex marketplace packaging is complete; they prove the local adapter contracts are executable.

## Harness Conformance

```sh
npm run harness:conformance
node bin/subtext.js conformance --format text
```

Runs the cross-harness natural-speech conformance report. It checks the three northstar cues, rendered prompt preservation, the five word-level prosody dimensions, and readiness policies for all 12 supported harnesses. See [HARNESS_CONFORMANCE.md](HARNESS_CONFORMANCE.md).

## Latency Benchmark

```sh
npm run bench
```

Runs repeated analysis on the generated fixture set and fails if p95 exceeds 300 ms. The budget measures WAV parse, DSP extraction, alignment, and contract generation.

## Smoke Test

```sh
npm run smoke
```

Quick CLI and MCP sanity test intended for local release checks.

## LLM-Judge Harness

```sh
npm run eval:judge
```

Generates `eval/llm-judge/out/prompt-pack.jsonl`, a paired prompt set:

- transcript only
- transcript plus `vocalcontext/v1`

Use the JSONL with target host models to score whether vocal context changes interpretation in the expected direction. The default mode is dry-run and no-network.

Provider-backed runs are opt-in:

```sh
npm run eval:judge:mock
OPENAI_API_KEY=... npm run eval:judge:openai -- --model gpt-4.1-mini --max-cases 5
```

The OpenAI provider requires `--allow-paid` through the npm script, plus `OPENAI_API_KEY`. Direct script use also accepts `SUBTEXT_ALLOW_PAID_EVAL=1`. Cost controls include `--max-cases`, `--max-prompt-chars`, and `--max-output-tokens`.

## External Emotion Evidence Benchmark

```sh
npm run external:emotion
```

Downloads and caches 25 acted, scripted, emotion-labeled WAV clips from CREMA-D, RAVDESS, and Berlin EmoDB, then checks whether Subtext emits compatible prosody evidence. Reports are written to:

- `eval/external/out/emotion-eval-report.json`
- `eval/external/out/emotion-eval-report.md`

This benchmark is opt-in because it uses network downloads and third-party dataset terms. It is not part of `npm run check`.

Important: this is not a hidden black-box emotion model. It tests whether known labels such as angry, happy, sad, fearful, and neutral correspond to grounded affect cues like high energy, fast rate, wide pitch range, low energy, high pauses, or stable delivery.

The detailed benchmark notes are in `docs/EXTERNAL_EMOTION_EVAL.md`.

## Wild YouTube Speech Benchmark

```sh
npm run wild:youtube
```

Downloads and caches short natural speech segments from public YouTube sources, extracts English captions as the transcript proxy, and checks whether Subtext emits useful or harmful assistant-handoff cues. Reports are written to:

- `eval/wild/out/youtube-wild-report.json`
- `eval/wild/out/youtube-wild-report.md`

This benchmark is opt-in because it uses network downloads, YouTube/provider terms, `yt-dlp`, and a local `ffmpeg` provider. It is not part of `npm run check`.

The wild manifest covers classroom Q&A, classroom discussion, NASA Q&A and press audio, a White House briefing, city council/public meeting audio, a USGS lecture, PyCon, FOSDEM, a GitButler/FOSDEM talk, Stanford Online, TED, and Google for Developers. Latest checked-in baseline: 11/11 matched expected assistant-handoff behavior after tightening softener/question/uncertainty logic. The expanded 14-case manifest is ready for rerun when YouTube access is available.

The detailed benchmark notes are in `docs/WILD_YOUTUBE_EVAL.md`.

## Current Known Limits

- Live microphone capture is available in the local browser preview, bounded desktop capture is available through `subtext capture` / `subtext session`, repeated terminal/wrapper-triggered turns are available through `subtext ptt`, a local Hammerspoon hotkey template exists, and a Tauri/Rust desktop scaffold is checked in. Signed native global hotkeys are not shipped in M0.
- Browser preview, HTTP, MCP, Claude hook, VS Code runner, and `subtext session` can consume structured JSON with confidence/language/word timings, but official host adapters still need to pass those fields directly where stable APIs exist.
- Named profile storage exists locally; browser-side microphone selection can switch profiles when device enumeration is available. Native OS-level microphone detection and global profile switching are not shipped in M0.
- Platform-native Claude Code/Codex/VS Code installation and the native desktop app are represented by adapter/scaffold templates and local functional tests.
- Word alignment uses platform word timestamps when the host provides them; otherwise it falls back to model-free proportional timing.
- External acted-emotion clips are useful for finding flaws, but acted labels do not guarantee real-world affect detection.
- Wild YouTube clips expose raw-data false positives, but they are only sampled windows and rely on YouTube captions as a platform-STT proxy. Public YouTube can block unauthenticated downloads; use `--allow-unavailable`, `--case`, `--source`, and `SUBTEXT_YTDLP_ARGS` to separate provider access failures from cue failures.
- The license structure should be reviewed by counsel before commercial sales.
