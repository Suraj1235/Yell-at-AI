# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
