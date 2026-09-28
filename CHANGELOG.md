# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - 2026-09-29

First public release: Subtext, the meaning-and-emotion layer for dictation, with the dictation app
(browser / PWA and a desktop dev build).

### Added

- `subtext dictate` — the full loop in one command: record, transcribe, analyze, deliver.
- `subtext model list|download` — consent-gated, SHA-256-verified whisper model management.
- Cloud STT adapter (Groq, Deepgram) as an opt-in, bring-your-own-key engine.
- STT engine registry with machine-readable network-egress metadata, surfaced in `subtext doctor`.
- Microphone recorder auto-detection for `ffmpeg`, `arecord`, and `sox`, so capture works on
  Windows and Linux without a hand-written command template.

- **The dictation app** (`apps/shell`): one vanilla-JS interface for browser, PWA and desktop. A
  hold-to-talk floating pill; live prosody while you speak; an evidence card with the stressed word
  highlighted; hands-free by double-tap or click; undo after cancel; auto-stop on silence and at a cap
  (words are never discarded); searchable history; onboarding with live level bars and calibration;
  and a persistent engine badge naming who, if anyone, receives your audio. Installable on Android and
  iPhone as a PWA.
- **Desktop app** (`apps/desktop`): the shell runs inside Tauri with a press-and-hold global hotkey, a
  non-focusable overlay pill, a tray, launch at login, local history, local whisper transcription, and
  per-app insertion (the full block for AI apps, plain text elsewhere). The crate had never compiled
  before this release; CI now runs `cargo check` on it.
- `test/gain-invariance.test.js`: every fixture and cached clip at 0.25x, 1x and 4x volume must
  produce an identical contract.
- whisper.cpp now runs with `-t min(cores, 8)` threads (override with `SUBTEXT_WHISPER_THREADS`).

### Changed

- **Uncalibrated emotion reading no longer depends on microphone gain.** Energy is read as vocal effort
  from the spectrum rather than from absolute loudness, which had made every quietly recorded clip read
  `subdued` whatever the speaker's emotion. On 25 acted clips, scored only on what the assistant
  receives: 8/25 before, 19/25 after (20/25 held out by corpus). Happy and neutral are still not
  separated.
- The emotion and wild-speech evals now score only the contract the assistant receives, never
  harness-derived signals. Earlier published figures (21/25, 11/14 → 13/14) were inflated by those
  signals.
- Hesitation from filled pauses is scored as a rate per word, so one "um" in a long answer no longer
  marks a fluent speaker as hesitant.

### Fixed

- Installing from GitHub (`npm install github:Suraj1235/Yell-at-AI`) shipped without the bundled sample
  audio, so `yell-at-ai demo` failed. A `prepare` hook now generates it on git installs.
- The shell's web adapter touched `navigator` at import time and crashed on Node 20.
- Privacy copy no longer makes an unqualified claim that recordings stay on the device on paths that
  transcribe through the browser's Web Speech API, which uploads audio to Google in Chrome and Edge.
  A test now guards this across every user-facing file the npm tarball ships.
- `resolveWhisperBinary` no longer resolves a same-named Control Panel applet, MMC snap-in, or
  script-host file (e.g. `main.CPL`) as the whisper binary on a Windows machine whose PATHEXT lists
  those extensions. Binary resolution is now restricted to genuinely executable extensions
  (`.COM`, `.EXE`, `.BAT`, `.CMD`).

### Foundations


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
- Client-side web demo (`apps/web/`) for live dictation. The prosody analysis runs entirely in the
  browser with no model weights and no server. Transcription is the exception: the page uses the
  browser's Web Speech API, which in Chrome and Edge sends your audio to Google for recognition. A
  persistent badge above the recorder names the engine and the vendor before you record.

[0.1.0]: https://github.com/Suraj1235/Yell-at-AI/releases/tag/v0.1.0
