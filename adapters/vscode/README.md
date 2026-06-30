# VS Code Adapter

A dependency-free VS Code extension template that brings the meaning/emotion layer into your editor.
Pick a WAV file, enter or paste a transcript (plain text or a `subtext/transcript/v1` envelope), and
send the rendered `vocalcontext/v1` prompt to one of three surfaces:

- copy to clipboard
- insert into the active editor
- open a preview document

## One-command setup

From a checkout of this repo, generate an install bundle wired to this checkout's real CLI:

```sh
node bin/subtext.js install-adapter --harness vscode --target ./subtext-vscode-adapter
```

Open `subtext-vscode-adapter/adapters/vscode/` as an extension project in VS Code and launch the
extension host (press `F5`). Apply `settings.generated.json` from that bundle as your extension
settings so the copied adapter points at this checkout's Subtext CLI.

Running the template straight from inside the Yell-at-AI repo also works: with no `subtext.cliPath`
set, the runner resolves `../../bin/subtext.js` relative to the extension.

## Commands

- `Subtext: Copy Enriched Prompt`
- `Subtext: Insert Enriched Prompt`
- `Subtext: Preview Enriched Prompt`

## Settings

- `subtext.cliPath`: optional path to `bin/subtext.js`. Leave empty when running from this repo. Set an
  absolute path otherwise - `/Users/you/Yell-at-AI/bin/subtext.js` on macOS/Linux,
  `C:\Users\you\Yell-at-AI\bin\subtext.js` on Windows.
- `subtext.baselinePath`: optional path to a personal calibration baseline
- `subtext.defaultVerbosity`: `full`, `subtle`, or `raw`

`full` is the default so native transcript source, word-timestamp status, alignment confidence, and
affect evidence stay visible in the prompt. Use `subtle` when you explicitly want a smaller prompt.

## Cross-platform note

The runner launches the CLI with Node's own binary (`process.execPath`) and builds every path with
`node:path`, so it behaves identically on Windows, macOS, and Linux without a shell or `.cmd` lookup.

## Native transcript input

If your IDE voice layer or a helper command can produce structured transcript metadata, paste JSON like
this into the transcript box:

```json
{
  "schema": "subtext/transcript/v1",
  "text": "can we just refactor the whole auth module",
  "source": "vscode-native-voice",
  "confidence": 0.95,
  "language": "en",
  "wordTimings": [
    { "word": "can", "start": 0.0, "end": 0.22 },
    { "word": "whole", "start": 1.5, "end": 1.98 }
  ]
}
```

The runner writes that envelope to a temporary file and invokes:

```sh
node bin/subtext.js handoff --audio turn.wav --transcript transcript.json --target stdout --verbosity full
```

That preserves platform/native transcript source, confidence, language, word timestamps, and phone
timestamps where available.

## Testing without VS Code

The adapter shell is testable without VS Code through `runner.cjs`. The project functional tests verify
that the extension metadata is parseable, plain-transcript handoff works, and structured native
transcript metadata survives into the rendered prompt.

## Boundary

This is a Tier B/C adapter template, not a marketplace package yet. It does not capture microphone audio
directly. Use the web demo, `subtext capture`, an OS recorder, or another capture tool to produce the
WAV input, then let this adapter insert the enriched prompt into VS Code or an IDE chat workflow.
