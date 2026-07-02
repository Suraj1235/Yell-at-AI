# Design: Yell-at-AI → Launch-Ready Product

- **Date:** 2026-06-30
- **Authors:** Suraj Kuncham and Manish Sampathirao
- **Status:** Approved, in implementation
- **Branch:** `feat/launch-ready`

## 1. Context & Vision

Yell-at-AI / Subtext is a model-free, zero-dependency prosody engine that emits a strict
`vocalcontext/v1` evidence block beside a transcript, so a host assistant can reason over what the
user *meant*, not just the words. Today the repo is a strong **reference engine + adapters +
scaffolds**, but it is not yet an end-user product.

Vision: **"the next Whisprflow, but better"** — Whisprflow nails fast dictation-everywhere; our
differentiator is the **meaning/emotion layer** layered on top of dictation. This milestone turns the
reference engine into a launch-ready product across four surfaces.

## 2. Scope

All four surfaces are in scope, built **breadth-balanced parallel** (maximize ground covered, accept
rougher edges per surface). Honest delivery cut:

**🟢 Fully built, working, and verified this push**
- Cross-platform engine fix: `npm run check` green on **Windows and Linux**.
- Web demo + public deploy: mic → live dictation (Web Speech API) → client-side `vocalcontext/v1` →
  enriched prompt + landing page.
- Installable dev tool: `npx yell-at-ai`, polished Claude Code / Codex / VS Code adapters, docs.
- Pluggable STT interface in the core + a working browser (Web Speech) adapter.

**🟡 Working foundation + explicit roadmap (not production-signed this push)**
- Native Windows push-to-talk app (Tauri/Rust): working dev build; signed `.msi` is a follow-up.
- Offline whisper.cpp STT adapter: wired + auto-detect + docs; multi-platform binary bundling +
  model auto-download is a follow-up.

## 3. Guiding Principle

**Enhance the sound skeleton, do not rewrite it.** One core engine is reused by every surface. New
STT generalizes the existing `--transcript-command` mechanism. The web app builds on
`ui/web-preview`. Native builds on the existing Tauri scaffold. The dev tool polishes existing
adapters. No gratuitous new phases/modes/mechanics.

## 4. Architecture

```
            ┌─────────── audio (mic / wav) ───────────┐
 web: WebSpeech    native: hotkey+capture    cli: --transcript-command / whisper
            └──────────────┬──────────────────────────┘
                  transcript + samples
                           ▼
   src/  DSP → align → analyzer → vocalcontext/v1 → render   (THE SAME ENGINE EVERYWHERE)
                           ▼
   web copy-to-clipboard · native paste · CLI/MCP/IDE injection
```

Invariant preserved: `src/contract/analyzer.js` remains the single owner of all evidence. Adapters
and surfaces only capture, transcribe, render, and inject.

## 5. Repo Structure (deltas)

```
src/
  index.browser.js        NEW — browser-safe exports (analyzeSamples/render, no fs)
  transcribe/             NEW — pluggable STT: command | whisper | webspeech
apps/web/                 NEW — deployable static web product (DSP client-side) + landing page
apps/desktop/             EDIT — flesh out Tauri/Rust PTT scaffold into a working dev build
adapters/                 EDIT — polish claude-code / codex / vscode + docs
bin/ + package.json       EDIT — npx-ready dev-tool packaging
docs/ + README.md         EDIT — onboarding, demo, honest roadmap
test/                     EDIT — cross-platform + STT-interface + browser-import coverage
```

## 6. Foundation (shared core — done first, kept green)

1. **Cross-platform fixes**
   - Replace `new URL(...).pathname` with `fileURLToPath(new URL(...))` in `test/schema.test.js` and
     `test/analyzer.test.js` (fixes the `D:\D:\...` doubled-drive bug on Windows).
   - `scripts/build-check.mjs`: spawn npm with `shell: true` (or resolve `npm.cmd` on Windows).
   - `test/functional.test.js` Hammerspoon assertion: tolerate `\\`-escaped Windows paths / use a
     path-agnostic matcher.
   - Goal: `npm run check` green on Windows + Linux.
2. **Browser-safe core** — `src/index.browser.js` exports `analyzeSamples` + render without importing
   the fs-based WAV reader; confirm `dsp/*`, `alignment/*`, `text/*` are pure.
3. **Pluggable STT** — `src/transcribe/index.js` with a uniform `transcribe()` contract and adapters:
   - `command` — existing host transcript command (refactor existing logic here).
   - `whisper` — shell out to a whisper.cpp binary, auto-detect, graceful "not installed" error.
   - `webspeech` — browser adapter (used by `apps/web`).

## 7. Surfaces (parallel fan-out, directory-disjoint)

- **apps/web (🟢 flagship):** static site, no backend. Mic capture → Web Speech transcript → decode to
  samples → `analyzeSamples` client-side → render enriched prompt + copy button; landing page
  explaining the wedge. Fallback to manual text input where Web Speech is unavailable. Deploy to a
  public Vercel URL. Owns: `apps/web/**`.
- **dev tool (🟢):** `npx yell-at-ai`, polished `adapters/{claude-code,codex,vscode}`, onboarding docs,
  demo asset, `package.json` bin/metadata. Owns: `package.json`, `bin/**`, `adapters/**`, `README.md`.
- **apps/desktop (🟡):** Tauri/Rust — global hotkey → bounded capture → core analyze (via node
  sidecar) → paste. Working dev build; document `tauri dev`/build; signing as roadmap. Owns:
  `apps/desktop/**`.
- **whisper STT (🟡):** flesh out the `whisper` adapter, an optional model/binary bootstrap script,
  and `docs/` install guide. Owns: `docs/` whisper pages, `scripts/whisper-*`.

## 8. Error Handling & Privacy

- STT failure / mic denied / unsupported browser → fall back to manual transcript with a clear
  message.
- Missing whisper binary → actionable, non-fatal error.
- HTTP server stays **localhost-bound**; web app is **client-side only** — audio never leaves the
  browser, preserving the "no default network egress" privacy boundary.

## 9. Testing / Verification (evidence, not claims)

- `npm run check` green on Windows + Linux.
- New tests: STT interface (mock adapter), browser-safe import surface.
- Web app: loads, produces a contract from a sample clip; deployed URL returns 200.
- Native: `cargo check` if the Rust toolchain is present, else scaffold-validate (`desktop:check`).
- PR body states explicitly what was verified vs. not (esp. the 🟡 items).

## 10. Execution Strategy

1. Foundation phase (small, sequential) lands shared core changes and is verified green.
2. Fleet fans out across directory-disjoint surfaces (no shared-file collisions; one owner per file
   area; surface agents do **not** run the full suite to avoid fixture races).
3. Integration + verify phase runs the full suite once, builds the web app, checks the native app.
4. Push `feat/launch-ready` → open PR. Final `npm publish` and code-signing are the user's to run.

## 11. Out of Scope (explicit)

- Code-signed native installers for any OS.
- Bundling multi-platform whisper binaries / automatic large-model downloads.
- macOS / Linux native PTT apps (Windows-first).
- Actually running `npm publish` (prepared, not executed).

## 12. Risks

- Web Speech API is Chrome/Edge-centric → mitigated by manual-transcript fallback.
- Desktop GUI cannot be fully verified headlessly → delivered as a working dev build with documented
  run steps, marked 🟡.
- Parallel agents on one tree → mitigated by directory-disjoint ownership and a single full-suite run
  at the end.
