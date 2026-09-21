# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- `subtext dictate` — the full loop in one command: record, transcribe, analyze, deliver.
- `subtext model list|download` — consent-gated, SHA-256-verified whisper model management.
- Cloud STT adapter (Groq, Deepgram) as an opt-in, bring-your-own-key engine.
- STT engine registry with machine-readable network-egress metadata, surfaced in `subtext doctor`.
- Microphone recorder auto-detection for `ffmpeg`, `arecord`, and `sox`, so capture works on
  Windows and Linux without a hand-written command template.

### Fixed

- Privacy copy no longer claims audio never leaves the device on paths that transcribe through the
  browser's Web Speech API, which uploads audio to Google in Chrome and Edge. A test now guards this.
- `resolveWhisperBinary` no longer resolves a same-named Control Panel applet, MMC snap-in, or
  script-host file (e.g. `main.CPL`) as the whisper binary on a Windows machine whose PATHEXT lists
  those extensions. Binary resolution is now restricted to genuinely executable extensions
  (`.COM`, `.EXE`, `.BAT`, `.CMD`).

## [0.1.0] - Unreleased

Initial release: Subtext as an offline, model-free meaning-and-emotion layer for dictation.

### Added

- Core prosody analyzer producing the `vocalcontext/v1` contract: emphasis, delivery, affect, guidance,
  and flags, model-free and offline.
- CLI (`yell-at-ai` / `subtext`) for analysis, capture, calibration, handoff, local serving, and adapter integration.
- HTTP and MCP-style JSON-RPC servers exposing `analyze_file` / `analyze_audio` tools over localhost.
- Editor and host adapters: Claude Code, Codex, VS Code, a global-hotkey push-to-talk adapter, and a
  native-desktop (Tauri/Rust) working foundation.
- Calibration workflow to baseline analysis against a speaker's normal voice instead of fixed
  thresholds.
- Evaluation suites: golden fixtures, external emotion corpus, wild YouTube corpus, and an LLM-judge
  harness comparing transcript-only vs. vocal-context prompts.
- Client-side web demo (`apps/web/`) for live dictation with no audio leaving the browser.

[0.1.0]: https://github.com/manishgit61332/Yell-at-AI/releases/tag/v0.1.0
