<p align="center">
  <img src="docs/assets/subtext-hero.svg" alt="Subtext animated voice context banner" width="100%">
</p>

<h1 align="center">Yell-at-AI / Subtext</h1>

<p align="center">
  <strong>Help AI understand what you mean and the emotion of your natural speech.</strong><br>
  Not just the plain text transcript.
</p>

<p align="center">
  <a href="#quick-start"><img alt="Quick start" src="https://img.shields.io/badge/quick_start-npm_run_check-2dd4bf?style=for-the-badge"></a>
  <a href="docs/CONTRACT.md"><img alt="Schema" src="https://img.shields.io/badge/schema-vocalcontext%2Fv1-60a5fa?style=for-the-badge"></a>
  <a href="docs/TESTING.md"><img alt="Tests" src="https://img.shields.io/badge/tests-52_passing-22c55e?style=for-the-badge"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-noncommercial_source-f59e0b?style=for-the-badge"></a>
</p>

<p align="center">
  <a href="docs/BLUEPRINT.md">Blueprint</a>
  ·
  <a href="docs/ARCHITECTURE.md">Architecture</a>
  ·
  <a href="docs/CONTRACT.md">Contract</a>
  ·
  <a href="docs/PROSODY_STYLE_TOKENS.md">Style Tokens</a>
  ·
  <a href="docs/HARNESSES.md">Harnesses</a>
  ·
  <a href="docs/DESKTOP_CAPTURE.md">Desktop Capture</a>
  ·
  <a href="docs/NATIVE_DESKTOP.md">Native Desktop</a>
  ·
  <a href="docs/HARNESS_DOCTOR.md">Doctor</a>
  ·
  <a href="docs/HARNESS_CONFORMANCE.md">Conformance</a>
  ·
  <a href="docs/ADAPTER_PACKAGING.md">Adapter Packages</a>
  ·
  <a href="docs/CALIBRATION.md">Calibration</a>
  ·
  <a href="docs/NATURAL_SPEECH.md">Natural Speech</a>
  ·
  <a href="docs/NATIVE_TRANSCRIPT_BRIDGE.md">Native Transcript Bridge</a>
  ·
  <a href="docs/UNIVERSAL_HANDOFF.md">Universal Handoff</a>
  ·
  <a href="docs/TESTING.md">Testing</a>
  ·
  <a href="docs/EXTERNAL_EMOTION_EVAL.md">External Eval</a>
  ·
  <a href="docs/WILD_YOUTUBE_EVAL.md">Wild YouTube Eval</a>
</p>

---

## Why This Exists

Most coding assistants hear your words but miss your meaning. Natural speech gets flattened into plain text, and emotion, emphasis, hesitation, urgency, uncertainty, and intent vanish before the model ever responds.

Subtext restores that missing layer. It lets AI understand what you mean and the emotion of your natural speech by running lightweight on-device signal processing, emitting a strict `vocalcontext/v1` block with grounded meaning/emotion cues, and letting the assistant you already use do the reasoning.

> Subtext's value prop is simple: AI should understand what you mean and the emotion of your natural speech, not just the plain text transcript. Prosody is the evidence layer that makes that promise inspectable.

The transcript still comes from the platform's native voice model, OS dictation, browser dictation, or your chosen host. Subtext adds the missing natural-speech context beside that transcript so the assistant can reason over what was meant, not only what was written down.

## What It Reads

| Signal | What M0 Extracts | Why It Helps |
| --- | --- | --- |
| Pitch / F0 | autocorrelation pitch, range, median, slope, terminal movement | emphasis, uncertainty, emotional contour |
| Energy | frame-level RMS, peaks, and mel log-energy | stress, urgency, contrast |
| Pacing | speech duration and words per second | urgency or deliberation |
| Pauses | adaptive speech/pause density | hesitation, planning, interruption |
| Emphasis | word stress from five word-level prosody dimensions | what the user likely meant to highlight |
| Affect | grounded emotional coloring and meaning cues | how the assistant should interpret and respond |
| Assistant guidance | priority, response style, and behavior directives | consistent response behavior across harnesses |
| Voice quality proxy | jitter/shimmer-style frame variation | possible strain, carefully hedged |

## What It Can Say

| Evidence Flag | What It Means |
| --- | --- |
| `yelling` | very high energy plus elevated delivery |
| `emphasis` | a word or phrase was strongly stressed |
| `confusion` | confusion/question markers with hesitant or rising delivery |
| `hesitation` | filled pauses or high pause density |
| `uncertainty` | rising terminal pitch on non-question text |
| `urgency` | fast, high-energy delivery with few pauses |

## Current Status

M0 is functional as an offline reference implementation:

- pure Node.js, no native compile step
- no bundled model weights
- no GPU
- no API key
- no default network egress
- CLI, HTTP server, and MCP-style JSON-RPC server
- local browser microphone preview
- bounded local desktop capture with `subtext capture`
- natural-speech sessions with `subtext session`, where a host/native transcript command can provide text, confidence, language, and word timings while Subtext provides the emotion and meaning layer from audio
- a formal `subtext/transcript/v1` envelope for platform/native voice-model transcript text, confidence, language, and word timings
- local push-to-talk loops with `subtext ptt` for repeated natural-speech turns into a chosen target
- optional browser dictation in the preview, emitted as `subtext/transcript/v1` with source/language/confidence when supported
- personal baseline calibration for naturally loud, fast, pausy, or expressive speakers
- rolling baseline updates across sessions and microphone positions
- named calibration profiles for different microphones or environments
- optional host word timestamps for native voice-model alignment
- browser microphone selection with device-aware profile switching
- Codex, Claude Code, and VS Code adapter templates, with native transcript envelope support in the Claude and VS Code boundaries
- local Hammerspoon global-hotkey bridge template for bounded capture-and-paste turns
- native desktop Tauri/Rust scaffold for the signed app launch track
- installable local adapter bundles with generated host config
- generated WAV fixtures, unit tests, functional tests, smoke tests, benchmark, and LLM-judge prompt pack

The production target remains a smaller Rust/Tauri core. This repo is the executable reference and test oracle.

## Quick Start

```sh
npm run check

node bin/subtext.js analyze \
  --audio eval/fixtures/emphasis.wav \
  --text "can we just refactor the whole auth module" \
  --format prompt \
  --verbosity full
```

When your host voice layer exposes word timestamps, pass them as JSON to replace proportional fallback alignment:

```sh
node bin/subtext.js analyze --audio turn.wav --text "..." --word-timings word-timings.json
node bin/subtext.js analyze --audio turn.wav --transcript native-transcript.json --require-word-timings
```

Local microphone preview:

```sh
node bin/subtext.js serve
```

Then open `http://127.0.0.1:8765`.

Desktop capture:

```sh
node bin/subtext.js capture --duration 4 --audio-out turn.wav
node bin/subtext.js capture --duration 4 --audio-out turn.wav --text "..." --format prompt
```

Natural-speech session with host/native transcript integration:

```sh
node bin/subtext.js session \
  --duration 4 \
  --audio-out turn.wav \
  --transcript-command "host-transcript --json {audio}" \
  --target paste
```

Local push-to-talk loop:

```sh
node bin/subtext.js ptt \
  --turns 3 \
  --duration 4 \
  --transcript-command "host-transcript --json {audio}" \
  --target paste
```

Personal calibration:

```sh
node bin/subtext.js calibrate --audio neutral.wav --text "this is my normal voice" --out baseline.json
node bin/subtext.js calibrate --baseline baseline.json --audio neutral-2.wav --text "my normal follow-up voice" --out baseline.json
node bin/subtext.js analyze --audio turn.wav --text "..." --baseline baseline.json
node bin/subtext.js calibrate --profile laptop-mic --device built-in --environment desk --audio neutral.wav --text "normal voice"
node bin/subtext.js analyze --profile laptop-mic --audio turn.wav --text "..."
```

Universal paste-anywhere handoff:

```sh
node bin/subtext.js handoff --audio turn.wav --text "..." --target clipboard
node bin/subtext.js handoff --audio turn.wav --text "..." --target paste
```

Example output:

```text
<vocal-context schema="vocalcontext/v1">
Text: can we just refactor the whole auth module
Transcript: cli_text word_timestamps=false
Emphasis: whole z=1.34
Delivery: normal rate, medium energy, wide pitch range, low pause density, falling terminal pitch, steady voice quality
Affect: emphatic (0.63): Emphatic delivery; preserve stressed words as intentional constraints or priorities.
Guidance: preserve_emphasis/focused: Preserve stressed words as likely constraints or priorities: whole.
Flags: emphasis (0.63): strong stress on "whole"
Alignment: proportional confidence=0.55 matched=0/8
Calibration: utterance, samples=1
</vocal-context>

can we just refactor the whole auth module
```

## Project Map

```text
src/                 model-free DSP, capture, alignment, contract builder, rendering, servers
schemas/             strict vocalcontext/v1 and subtext/transcript/v1 JSON schemas
bin/subtext.js       CLI entrypoint
adapters/            Codex, Claude Code, VS Code, Realtime, hotkey, Universal adapter templates
apps/desktop/        Tauri/Rust scaffold for the native desktop launch track
ui/web-preview/      local browser microphone capture and preview harness
eval/fixtures/       generated WAV fixtures
eval/llm-judge/      transcript-only vs vocal-context prompt-pack harness
bench/               latency benchmark
test/                unit, golden, and functional tests
docs/                blueprint, architecture, contract, testing, licensing, roadmap
```

## Commands

```sh
npm run build           # dry-run package validation
npm run fixtures        # regenerate synthetic WAV fixtures
npm test                # unit + golden + functional tests
npm run test:functional # CLI, HTTP, MCP, Claude hook, Codex config tests
npm run bench           # latency benchmark, p95 budget 300 ms
npm run smoke           # CLI + MCP smoke test
npm run desktop:check   # validate the native desktop scaffold
npm run harness:conformance # verify natural-speech cue behavior across harness policies
npm run readiness       # full check + harness/package/cue-guidance readiness report
npm run eval:judge      # generate paired LLM-judge prompts
npm run external:emotion # opt-in web audio emotion-evidence benchmark
npm run wild:youtube     # opt-in natural YouTube speech benchmark
node bin/subtext.js doctor # local harness readiness report
npm run package:adapters # generate local adapter bundles under dist/adapters
node bin/subtext.js install-adapter --harness codex --target ./subtext-codex-adapter
node bin/subtext.js install-adapter --harness hotkey --target ./subtext-hotkey-adapter
node bin/subtext.js install-adapter --harness native-desktop --target ./subtext-desktop-scaffold
node bin/subtext.js profile list # list named calibration profiles
node bin/subtext.js capture --duration 4 --audio-out turn.wav
node bin/subtext.js capture --duration 4 --text "..." --target paste
node bin/subtext.js session --duration 4 --transcript-command "host-transcript {audio}" --target paste
node bin/subtext.js ptt --turns 3 --duration 4 --transcript-command "host-transcript --json {audio}" --target paste
npm run check           # build, tests, benchmark, smoke, and judge prompt pack
npm run eval:judge:mock # offline executable host-model judge report
```

Latest local verification:

```text
53/53 tests passing
20/20 functional plugin-boundary tests passing
p95 latency: 32.161 ms, budget: 300 ms
package dry-run: 125 files
external emotion evidence: opt-in, 21/25 on acted web clips
wild YouTube speech: opt-in, checked-in baseline 11/11; expanded 14-case manifest
desktop scaffold: Tauri/Rust scaffold check passing
harness conformance: yelling/emphasis/confusion cues + 12 harness policies passing
adapter doctor: 12/12 ready
adapter bundles: 12/12 generated
readiness: full check + yelling/emphasis/confusion guidance probes passing
```

The complete matrix is documented in [docs/TESTING.md](docs/TESTING.md).

## Integration Modes

| Tier | Platform Exposes | Subtext Does |
| --- | --- | --- |
| A, steer | native audio-in LLM | provide steering instructions and the contract shape |
| B, enrich | STT-to-text only | analyze audio in parallel and prepend `vocalcontext/v1` |
| C, own | any text field | own capture + preview + clipboard/active-app paste + local hotkey template + native desktop scaffold now; signed native global hotkey remains future work |

The same contract is used across all tiers.

See [docs/HARNESSES.md](docs/HARNESSES.md) and [adapters/harnesses.json](adapters/harnesses.json) for the current harness catalog.

See [docs/HARNESS_CONFORMANCE.md](docs/HARNESS_CONFORMANCE.md) for the cross-harness cue-preservation gate.

See [docs/ADAPTER_PACKAGING.md](docs/ADAPTER_PACKAGING.md) for reproducible local adapter bundles.

Use `subtext install-adapter` to copy a harness bundle into a target directory with concrete generated config for this checkout.

See [docs/CALIBRATION.md](docs/CALIBRATION.md) for personal baseline setup, rolling updates, and named profiles.

See [docs/NATURAL_SPEECH.md](docs/NATURAL_SPEECH.md) for the audio-plus-transcript path.

See [docs/NATIVE_TRANSCRIPT_BRIDGE.md](docs/NATIVE_TRANSCRIPT_BRIDGE.md) for the native transcript envelope that lets Subtext add meaning and emotion without replacing host speech recognition.

See [docs/UNIVERSAL_HANDOFF.md](docs/UNIVERSAL_HANDOFF.md) for paste-anywhere delivery.

See [docs/NATIVE_DESKTOP.md](docs/NATIVE_DESKTOP.md) for the Tauri/Rust desktop scaffold.

## Authors And Attribution

Subtext / Yell-at-AI is authored by **[Suraj Kuncham](https://github.com/Suraj1235)** and **[Manish Sampathirao](https://github.com/manishgit61332)**.

The project is original M0 reference code, but it stands on speech/prosody research and open tooling:

| Area | Acknowledgements |
| --- | --- |
| Speech and prosody | eGeMAPS, openSMILE, Praat, Parselmouth, WebRTC VAD, whisper.cpp |
| Evaluation corpora and wild speech | CREMA-D, RAVDESS, Berlin EmoDB, MIT OCW, NASA, White House, City of Arvada, USGS, PyCon US, FOSDEM, GitButler, Stanford Online, TED, Google for Developers |
| Assistant ecosystem | Model Context Protocol, Claude Code, Codex, VS Code, realtime audio assistants |
| Runtime and future bindings | Node.js, JSON Schema, Tauri, cpal, napi-rs, PyO3 |

GitHub citation metadata lives in [CITATION.cff](CITATION.cff). Detailed attribution and dependency boundaries live here and in [NOTICE](NOTICE).

## License

This project is source-available for noncommercial individual, student, academic, and research use. Enterprise, commercial, revenue-generating, internal business, or paid-product use requires a commercial license.

See [LICENSE](LICENSE), [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md), and [docs/LICENSING.md](docs/LICENSING.md).

This is intentionally not OSI open source while the commercial licensing model is in force.
