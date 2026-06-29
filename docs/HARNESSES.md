# Top Harness Integration

The user-facing goal is simple: speak naturally, then send what you mean and the emotion of that speech to whichever coding assistant harness you choose, instead of sending only plain transcript text.

Subtext supports this through a layered adapter strategy:

| Harness | Current State | Best Path |
| --- | --- | --- |
| Codex | template-tested | MCP-style JSON-RPC server |
| Claude Code | template-tested | prompt-submit hook plus Subtext skill |
| Generic agent harness | implemented | MCP-style JSON-RPC server |
| Local apps | implemented | HTTP `/v1/analyze` and `/v1/render` |
| Browser mic preview | implemented | `subtext serve`, then open `http://127.0.0.1:8765` |
| Desktop mic capture | implemented | bounded CLI `subtext capture`, one-shot `subtext session`, or repeated `subtext ptt --turns 3 --transcript-command "host-transcript --json {audio}"` |
| Shell/wrappers | implemented | CLI `subtext analyze` |
| Realtime audio assistants | steering-template | Tier A instructions, no DSP unless transcript-only |
| VS Code / IDE chat | template-tested | extension commands for copy, insert, and preview with plain text or `subtext/transcript/v1` input |
| Global hotkey bridge | template-tested | Hammerspoon template that invokes bounded `subtext ptt --target paste` |
| Native desktop app scaffold | template-tested | Tauri/Rust scaffold for visible bounded capture and the signed desktop launch track |
| Universal text box | implemented | clipboard or active-app paste with `subtext handoff --target clipboard|paste`, `subtext session --target paste`, or repeated `subtext ptt --target paste` |

The adapter catalog lives at [adapters/harnesses.json](../adapters/harnesses.json).

Run the local harness readiness check with:

```sh
node bin/subtext.js doctor
node bin/subtext.js doctor --harness vscode --format json
```

See [HARNESS_DOCTOR.md](HARNESS_DOCTOR.md) for the doctor output contract and status meanings.

Build local adapter bundles with:

```sh
npm run package:adapters
```

See [ADAPTER_PACKAGING.md](ADAPTER_PACKAGING.md) for the generated bundle layout.

Run the natural-speech conformance gate with:

```sh
npm run harness:conformance
node bin/subtext.js conformance --format text
```

See [HARNESS_CONFORMANCE.md](HARNESS_CONFORMANCE.md) for the cue and adapter-preservation policy.

Install a concrete local adapter bundle with:

```sh
node bin/subtext.js install-adapter --harness codex --target ./subtext-codex-adapter
node bin/subtext.js install-adapter --harness claude-code --target ./subtext-claude-adapter
node bin/subtext.js install-adapter --harness vscode --target ./subtext-vscode-adapter
node bin/subtext.js install-adapter --harness hotkey --target ./subtext-hotkey-adapter
node bin/subtext.js install-adapter --harness native-desktop --target ./subtext-desktop-scaffold
```

The installer writes generated host config where needed, including Codex MCP config with the real local CLI path, Claude Code env vars for the copied hook, VS Code settings, Hammerspoon config, and native desktop scaffold config.

## Signal Meaning

Subtext can currently express:

- `yelling`: very high energy plus elevated delivery
- `emphasis`: strong stress on one or more words
- `confusion`: question/confusion markers with hesitant or rising delivery
- `hesitation`: filled pauses or high pause density
- `uncertainty`: rising terminal pitch on non-question text
- `urgency`: fast, high-energy delivery with few pauses
- `tension`: strained voice-quality evidence
- `lexical_prosodic_mismatch`: words and delivery point in different directions

These cues are meant to help the host understand natural-speech emotion and intent. A host assistant should respond behaviorally: slow down, clarify, preserve emphasized constraints, or avoid overreacting to low-confidence flags.

Adapters should prefer `assistant_guidance` for behavior decisions because it normalizes the same evidence across harnesses:

- `de_escalate` / `calm` for high-intensity/yelling evidence
- `preserve_emphasis` / `focused` for stressed words
- `clarify` / `patient` for confusion or uncertainty
- `act_quickly` / `direct` for urgent delivery

Flags remain the inspectable evidence; guidance is the response policy derived from that evidence.

## Transcript Sources

Subtext needs a transcript to attach prosody to words. The transcript can come from your selected harness, OS dictation, browser dictation in the preview, a `--transcript-command`, or manual paste. Adapters should prefer the [native transcript bridge](NATIVE_TRANSCRIPT_BRIDGE.md) envelope: `subtext/transcript/v1` with `text`, `source`, optional `confidence`, optional `language`, and optional `wordTimings`. Plain text is still accepted. When the host voice layer exposes word timestamps, adapters should pass them as `wordTimings` so emphasis uses native voice-model alignment instead of proportional fallback. If the host exposes phone timestamps, adapters should keep them on the word timing objects so `duration_frames` can use platform timing instead of estimated phone counts. The local Subtext engine remains the meaning/emotion layer derived from prosody evidence.

## Tier Rules

- Tier A, native audio-in: the host model already hears tone; Subtext provides steering and contract shape.
- Tier B, transcript-only voice: Subtext analyzes parallel audio and prepends `vocalcontext/v1`.
- Tier C, any text field: Subtext owns capture/preview/insertion, including repeated local `ptt` turns and the native desktop scaffold launch track.

## Remaining Work

- Harden the native desktop scaffold into a full signed desktop preview and calibration app.
- Publish Claude Code/Codex packages through their host-specific distribution channels when stable APIs are available.
- Promote the VS Code extension template into a marketplace package.
- Promote the local Hammerspoon hotkey bridge into a signed native global hotkey path with richer accessibility insertion beyond explicit active-app paste.
- Add native OS-level microphone detection and global profile switching outside the browser preview.
