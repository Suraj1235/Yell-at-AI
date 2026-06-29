# Browser Microphone Preview

The local preview harness is the first working Tier C path: Subtext owns microphone capture, produces a WAV in the browser, sends it to the local engine, and renders the same `vocalcontext/v1` block used by CLI, HTTP, MCP, Codex, and Claude Code adapters.

Run:

```sh
node bin/subtext.js serve
```

Open:

```text
http://127.0.0.1:8765
```

The preview uses:

- browser `getUserMedia` for local microphone input
- browser `enumerateDevices` for microphone selection when available
- optional browser `SpeechRecognition` for transcript dictation when supported, emitted as `subtext/transcript/v1`
- client-side WAV encoding
- `POST /v1/analyze-audio` for captured audio
- `POST /v1/calibrate` for personal baseline creation
- `POST /v1/render` for prompt rendering

## Current Boundary

The preview records natural speech and analyzes prosody. For transcripts, you can type, paste from a host assistant, or use **Dictate Transcript** when your browser supports `SpeechRecognition`. Manual text is sent as a `browser-preview-manual` transcript envelope; browser dictation is sent as `browser-speech-recognition` with language and confidence when the browser exposes them.

Browser dictation is browser-provided STT, not Subtext's local DSP engine. Depending on the browser/vendor, it may use an external browser service.

Use **Calibrate** after recording a neutral "normal voice" sample. The baseline is stored locally in the browser and applied to future analyses so naturally loud or fast speech is less likely to be mislabeled as yelling or urgent.

The microphone selector remembers the selected input device. When the selected or captured microphone changes, the preview switches to a microphone-specific profile name such as `mic-built-in-microphone` and stores the mapping locally. That gives the browser harness basic automatic profile switching for different microphones without sending device information anywhere.

## Verification

Functional tests cover:

- the preview HTML route
- the preview JavaScript route
- the `/v1/analyze-audio` base64 WAV endpoint
- `subtext/transcript/v1` provenance through `/v1/analyze-audio`
- the `/v1/calibrate` baseline endpoint
- browser dictation controls in the preview JavaScript
- microphone selection and device-aware profile storage in the preview JavaScript

The UI itself remains intentionally local-only and dependency-free.
