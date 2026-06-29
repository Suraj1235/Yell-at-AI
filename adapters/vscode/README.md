# VS Code Adapter

This adapter turns Subtext into a dependency-free VS Code extension template. It lets you choose a WAV file, enter or paste transcript text or a `subtext/transcript/v1` native transcript envelope, and then send the rendered `vocalcontext/v1` prompt to one of three surfaces:

- copy to clipboard
- insert into the active editor
- open a preview document

## Commands

- `Subtext: Copy Enriched Prompt`
- `Subtext: Insert Enriched Prompt`
- `Subtext: Preview Enriched Prompt`

## Settings

- `subtext.cliPath`: optional path to `bin/subtext.js`
- `subtext.baselinePath`: optional path to a personal calibration baseline
- `subtext.defaultVerbosity`: `full`, `subtle`, or `raw`

`full` is the default so native transcript source, word timestamp status, alignment confidence, and affect evidence stay visible in the prompt. Use `subtle` when you explicitly want a smaller prompt.

## Native Transcript Input

If your IDE voice layer or helper command can produce structured transcript metadata, paste JSON like this into the transcript box:

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

That preserves platform/native transcript source, confidence, language, word timestamps, and phone timestamps where available.

## Local Development

Open this folder as an extension project in VS Code and run the extension host. If the adapter is launched from inside the Yell-at-AI repository, it automatically resolves `../../bin/subtext.js`.

The adapter shell is testable without VS Code through `runner.cjs`; the project functional tests verify that the extension metadata is parseable, plain transcript handoff works, and structured native transcript metadata survives into the rendered prompt.

To create a copyable local install bundle:

```sh
node bin/subtext.js install-adapter --harness vscode --target ./subtext-vscode-adapter
```

Apply `subtext-vscode-adapter/adapters/vscode/settings.generated.json` as the extension settings so the copied adapter points at this checkout's real Subtext CLI.

## Boundary

This is a Tier B/C adapter template, not a marketplace package yet. It does not capture microphone audio directly. Use the browser preview, `subtext capture`, an OS recorder, or another capture tool to produce the WAV input, then let this adapter insert the enriched prompt into VS Code or an IDE chat workflow.
