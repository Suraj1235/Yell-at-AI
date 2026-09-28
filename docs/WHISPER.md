# Offline Whisper STT

**Status: shipped.** `subtext dictate --engine whisper` is the default path, and
`subtext model download base.en --yes` installs the model. `transcribe()` and the `whisper`
adapter remain importable from the package entrypoint (`import { transcribe } from
"yell-at-ai"`) for library use.

Subtext's job is the meaning-and-emotion layer of natural speech; it does not ship a
speech recognizer. The `whisper` adapter is one way to produce the transcript half of
a turn **entirely on your own machine**, by shelling out to a local
[whisper.cpp](https://github.com/ggerganov/whisper.cpp) binary and a downloaded ggml
model.

It is one of the pluggable STT adapters in `src/transcribe/index.js`, alongside
`command` (any external transcript command) and the browser-only `webspeech`
contract. The transcript it returns flows into the same `subtext/transcript/v1`
envelope every other source uses, so the prosody engine treats a whisper.cpp
transcript exactly like a host or OS one.

## Privacy: Fully Offline

This adapter is designed so that **a configured setup performs no network egress**:

- Subtext never bundles model weights and never downloads them on its own.
- The whisper.cpp binary and the ggml model live on your machine; you install them.
- Transcription runs as a local subprocess. Your audio is read from a local WAV file
  and passed to a local executable. It does not leave the device.
- The only optional network access is the clearly gated, opt-in model download in
  `scripts/whisper-bootstrap.mjs`, which fetches **one** model file and only when you
  pass both `--download` and `--yes`. The binary is always installed by you.

In other words: once `SUBTEXT_WHISPER_BIN` and `SUBTEXT_WHISPER_MODEL` point at local
files, the `whisper` adapter is air-gappable. There is no API key, no GPU requirement,
and no default egress, consistent with the rest of the Subtext engine.

## Install

Run the bootstrap helper for OS-specific, copy-pasteable instructions:

```sh
node scripts/whisper-bootstrap.mjs
node scripts/whisper-bootstrap.mjs --help
```

It prints instructions only and downloads nothing by default. The steps it walks you
through are:

### 1. Get a whisper.cpp binary

| OS | Easiest path |
| --- | --- |
| macOS | `brew install whisper-cpp` (provides `whisper-cli` on PATH) |
| Windows | Download `whisper-bin-x64.zip` from a release that ships Windows binaries — not every release does (v1.9.4, the latest at the time of writing, has none). [v1.9.2's CPU build](https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-bin-x64.zip) is known to work. Unzip, then point `SUBTEXT_WHISPER_BIN` at `Release\whisper-cli.exe` (older builds: `main.exe`) |
| Linux | Distro/AUR package where available, otherwise build from source |

Building from source on any platform:

```sh
git clone https://github.com/ggerganov/whisper.cpp
cd whisper.cpp
cmake -B build && cmake --build build --config Release
# binary lands at build/bin/whisper-cli (or build/bin/main on older versions)
```

### 2. Download a model

The bootstrap helper can fetch a single model file for you (opt-in, explicit):

```sh
node scripts/whisper-bootstrap.mjs --download --model base.en --yes
```

Or use whisper.cpp's own helper, or download a `ggml-*.bin` file directly from
`https://huggingface.co/ggerganov/whisper.cpp`.

## Model Choice

All models are English-or-multilingual ggml files. Smaller is faster and uses less
memory; larger is more accurate. For short push-to-talk turns the small end is usually
plenty.

| Model | Approx. download | Notes |
| --- | --- | --- |
| `tiny.en` / `tiny` | ~75 MB | fastest, lowest accuracy |
| `base.en` / `base` | ~142 MB | good default for English (recommended) |
| `small.en` / `small` | ~466 MB | higher accuracy, slower |

The `.en` variants are English-only and slightly more accurate on English than their
multilingual counterparts of the same size. Pick a multilingual model if you speak
other languages.

## Model Management (`subtext model`)

Once you have a whisper.cpp binary, `subtext model` manages the ggml model files
themselves — checksum-verified, consent-gated, and written atomically so an
interrupted download never leaves a half-model that whisper.cpp would try to load:

```sh
subtext model list                     # what is installed, and where
subtext model download base.en --yes   # fetch a model (~142 MB for base.en), one time
```

`subtext model list` prints every model Subtext knows how to manage (`tiny.en`,
`base.en`, `small.en` — see `src/transcribe/models.json`), whether it is installed, and
its size. `subtext model download <id>` refuses to fetch anything until you pass
`--yes`; without it, it prints exactly what it would download and where, and exits
non-zero. Every download's SHA-256 is checked against `src/transcribe/models.json`
before the file is kept — a checksum mismatch discards the download and throws, rather
than installing a tampered or corrupt model.

By default, models are installed to `~/.subtext/models`. Override the directory with:

| Variable | Purpose |
| --- | --- |
| `SUBTEXT_MODEL_DIR` | Directory `subtext model` installs into and reads from. Defaults to `~/.subtext/models`. |

`subtext dictate --engine whisper` (the default engine) resolves a model in this order:
`SUBTEXT_WHISPER_MODEL` if set, otherwise the `base.en` model installed by `subtext model
download` in `SUBTEXT_MODEL_DIR`/`~/.subtext/models`. If neither is present, `subtext
doctor` reports `whisper` as not-ready and names the exact command to fix it.

## Configure

The adapter discovers its binary and model from the environment:

| Variable | Purpose |
| --- | --- |
| `SUBTEXT_WHISPER_BIN` | Path to a whisper.cpp binary. Overrides PATH lookup. Optional if `whisper`, `whisper-cli`, or `main` is already on PATH. |
| `SUBTEXT_WHISPER_MODEL` | Path to a ggml model file (e.g. `ggml-base.en.bin`). Needed unless your binary has a built-in default model. |

Binary discovery order:

1. `SUBTEXT_WHISPER_BIN` if set (must point at a real file).
2. The first of `whisper`, `whisper-cli`, `main` found on `PATH` (Windows-aware: it
   honors `PATHEXT`, so `whisper-cli.exe` / `main.exe` resolve).

If none resolve, the adapter throws a single actionable error:

```text
whisper binary not found; set SUBTEXT_WHISPER_BIN or install whisper.cpp - see docs/WHISPER.md
```

If `SUBTEXT_WHISPER_MODEL` is set but the file is missing, it throws a matching
model-not-found error pointing back here.

macOS/Linux:

```sh
export SUBTEXT_WHISPER_BIN=/path/to/whisper-cli
export SUBTEXT_WHISPER_MODEL=/path/to/ggml-base.en.bin
```

Windows (PowerShell):

```powershell
$env:SUBTEXT_WHISPER_BIN = "C:\path\to\whisper-cli.exe"
$env:SUBTEXT_WHISPER_MODEL = "C:\path\to\ggml-base.en.bin"
```

## Use It

The adapter returns a transcript envelope:

```text
{ text, source: "whisper.cpp", language?, confidence?, words? }
```

`words` is an array of `{ word, start, end }` (seconds) and is present only when the
binary emitted JSON token timings; `start`/`end` are filled when the build reports
them. `language` and `confidence` appear only when the JSON output includes them.

Through the pluggable STT interface in Node:

```js
import { transcribe } from "./src/transcribe/index.js";

const transcript = await transcribe("turn.wav", { adapter: "whisper" });
// transcript.source === "whisper.cpp"
```

Or the adapter directly:

```js
import { transcribeWithWhisper } from "./src/transcribe/whisper.js";

const transcript = await transcribeWithWhisper({ audio: "turn.wav" });
```

The transcript then feeds the prosody/contract pipeline like any other source. With
the CLI, point the existing transcript-command path at a whisper.cpp invocation, e.g.:

```sh
node bin/subtext.js session \
  --duration 4 \
  --audio-out turn.wav \
  --transcript-command "whisper-cli -m /path/to/ggml-base.en.bin -otxt -nt {audio}" \
  --target paste
```

(`-otxt -nt` keeps stdout to plain transcript text; the `command` adapter parses that
straight into the envelope. Use the `whisper` adapter when you want Subtext to handle
binary/model discovery and JSON word-timing parsing for you.)

## How Output Is Parsed

The adapter accepts either of whisper.cpp's output styles:

- **Plain text** (default stdout, optionally with `[hh:mm:ss --> ...]` line markers):
  the markers are stripped and lines are joined into `text`.
- **JSON** (`--output-json` / `--output-json-full`): the `transcription` segments are
  joined into `text`, and per-token `offsets` (milliseconds) are converted into
  `words` with second-based `start`/`end`. whisper.cpp special tokens such as
  `[_BEG_]` are skipped.

By default the adapter requests JSON-with-token-timings so word timings are available
when the build supports them; plain-text-only builds still parse correctly.

## Related

- [Natural Speech Path](NATURAL_SPEECH.md) — how transcript + audio combine.
- [Native Transcript Bridge](NATIVE_TRANSCRIPT_BRIDGE.md) — the shared
  `subtext/transcript/v1` envelope.
