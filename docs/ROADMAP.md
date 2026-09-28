# Roadmap

> **Current state (v0.1.0, 2026-09-29):** see [HANDOFF.md](HANDOFF.md) for what shipped, what is verified, and every pending item as a tracked GitHub issue. The milestones below are the original plan and are kept for history.

## M0, Current Repo

- Pure Node.js reference core.
- Strict `vocalcontext/v1` schema.
- CLI, HTTP, and MCP-style JSON-RPC surfaces.
- Synthetic fixtures, tests, benchmarks, and eval prompt packs.
- Adapter templates for Codex and Claude Code.
- Rolling personal baseline updates.
- Named calibration profiles.
- Browser microphone-aware profile switching.
- Bounded CLI desktop capture through `subtext capture`.
- Natural-speech session flow through `subtext session`.
- Terminal/wrapper-triggered repeated turns through `subtext ptt`.
- Local global-hotkey automation template through the `hotkey` adapter.
- Tauri/Rust native desktop scaffold for visible bounded capture and the signed app launch track.
- Formal `subtext/transcript/v1` envelope plus host transcript commands with text/confidence/language/word-timing metadata for native voice-model alignment.

## M1, Production Core

- Port core to Rust.
- Add live microphone capture.
- Add native OS-level microphone detection and global per-device profile switching.
- Add openSMILE/eGeMAPS parity mode.
- Package Node and Python bindings.

## Northstar Launch Tracks

These are the remaining foundational gaps between the current reference implementation and the full Yell-at-AI product promise.

| Track | Current State | Completion Bar |
| --- | --- | --- |
| Native desktop/global mic capture | Browser preview plus bounded CLI `subtext capture` / `subtext session`, terminal/wrapper-triggered `subtext ptt`, local Hammerspoon hotkey template, and Tauri/Rust scaffold; no signed background listener | Signed desktop app with global hotkey, visible recording state, calibration flow, and no hidden capture |
| Platform transcript integration | CLI/HTTP/MCP accept `subtext/transcript/v1` provenance, `subtext session` can call a host/native transcript command that returns text/confidence/language/word timings, and host word timestamps are supported | Adapters for target hosts pass native transcript text, confidence/language when available, and word timings without a custom STT dependency |
| Marketplace-quality plugins | Codex, Claude Code, and VS Code are local/template-tested | Host-specific packaged releases with install docs, update path, and integration smoke tests |
| Natural speech scale | Synthetic fixtures, acted clips, and 11 wild YouTube windows | Larger consented/dataset-backed eval with speaker/mic diversity, false-positive analysis, and per-release baseline reports |
| Signed binaries and installer | Node reference package only | Rust/Tauri or equivalent signed app, Homebrew/npm/GitHub release artifacts, and reproducible builds |
| Global insertion | Clipboard handoff, explicit `--target paste` active-app insertion, repeated `ptt` turns, and local hotkey automation template | Signed global hotkey path, richer accessibility insertion with confirmation, and visible editable prompt |
| Host-model judging | Prompt-pack dry run plus optional mock/OpenAI provider runner with credentials, explicit paid opt-in, and case/token caps | Add more host providers, stored baselines by model version, and CI-safe regression thresholds |

## M2, Host Integrations

- Codex MCP packaging.
- Claude Code plugin packaging once hook APIs are pinned.
- VS Code extension.
- Signed native universal hotkey/dictation adapter.
- Editable preview UI.

## M3, Tier A Steering

- Realtime audio assistant steering instructions.
- Contract-compatible native-audio output policy.
- Bench host interpretation with and without steering.

## M4, Launch

- Signed binaries.
- Homebrew/npm/GitHub releases.
- Security review.
- Commercial license process.
- Public docs site.
