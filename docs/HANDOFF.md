# Handoff — state of Yell-at-AI at v0.1.0

Written 2026-09-29 at the first public release. This is the single place to start. It covers what exists, what has been verified and how, what is pending, and the gotchas that cost real time. Every pending item has a GitHub issue.

## What exists

| Surface | Where | State |
| --- | --- | --- |
| Prosody engine: the `vocalcontext/v1` contract | `src/` | Shipped. Model-free, deterministic, zero runtime dependencies, Node ≥ 20 |
| CLI: `yell-at-ai` / `subtext` | `bin/`, `src/cli.js` | Shipped. `demo`, `dictate`, `model`, `doctor`, `analyze`, `capture`, `calibrate`, `serve`, `mcp`, `install-adapter`, … |
| Speech-to-text | `src/transcribe/` | Shipped. Local whisper.cpp is the default; Groq/Deepgram cloud is opt-in with your own key. Every engine declares its network `egress` |
| Dictation app, browser/PWA | `apps/shell/` | Shipped. `npm run shell` → `http://127.0.0.1:8123/apps/shell/index.html` |
| Desktop app, Windows/macOS | `apps/desktop/` | Dev build. The shell runs inside Tauri with a global hotkey, overlay pill, tray and per-app insertion |
| Landing page and web demo | `apps/web/` | Deployed to https://yell-at-ai.vercel.app, but **stale** (see #22) |
| Editor adapters | `adapters/` | Templates for Claude Code, Codex and VS Code, installed with `install-adapter` |
| Release | GitHub [v0.1.0](https://github.com/Suraj1235/Yell-at-AI/releases/tag/v0.1.0) | Tarball attached. **Not on npm** (see #23) |

The architecture is one interface in three places. `apps/shell/core/` holds the UI. `apps/shell/platform/platform.web.js` and `platform.tauri.js` implement the same `PlatformAdapter` interface, and the shell picks one by checking whether `window.__TAURI__` exists. The desktop window/command/event contract is in [`apps/desktop/CONTRACT.md`](../apps/desktop/CONTRACT.md).

## What has been verified, and how

Nothing below is taken from an agent's report alone. Each item was re-run by hand.

- **Tests:** 169/169 on ubuntu, windows and macOS, on both Node 20 and 22. CI also runs a `cargo check` of the Tauri crate on windows-latest. CodeQL passes.
- **Fresh installs:**
  - An anonymous install from GitHub, with git credentials disabled, followed by `yell-at-ai demo`, works.
  - Installing from the release tarball URL works.
- **Real speech end to end:** `dictate --engine whisper` on real recordings, with no transcript supplied, runs local whisper.cpp v1.9.2 and `base.en`. The resulting contract reflects delivery; for example, an angry RAVDESS clip reads `tense` with a tension flag.
- **Emotion eval, scored only on what the assistant receives:**
  - Acted clips: **19/25** (20/25 held out by corpus). Angry 5/6, neutral 4/5, fearful 2/3, sad 4/6. Happy scores 4/5, but only by reading `neutral`; the contract has no word for happy, so those are non-misreads, not detections.
  - Wild YouTube speech: **11/14**.
- **Volume invariance:** `test/gain-invariance.test.js` replays every clip at 0.25×, 1× and 4× gain. It fails on the pre-#18 engine and passes now.
- **Desktop:**
  - With a mocked `__TAURI__`, full turns call every command in order, send plain text to Slack and the full block to VS Code, and the overlay follows status.
  - The real app boots, claims the hotkey, and the shell renders inside it. This was checked over the WebView debugger.
  - A real mic turn has **not** been run (see #21).

Earlier eval figures (21/25 and 13/14) were inflated by harness-only signals. The CHANGELOG says so.

## Pending

**Needs a person:** these can't be done by an agent.

| # | What |
| --- | --- |
| [#21](https://github.com/Suraj1235/Yell-at-AI/issues/21) | Run a real hold-to-talk turn in the desktop app |
| [#22](https://github.com/Suraj1235/Yell-at-AI/issues/22) | Redeploy the web demo. **The live site still makes the old false privacy claim.** Needs `npx vercel login` |
| [#23](https://github.com/Suraj1235/Yell-at-AI/issues/23) | First `npm publish`, then enable tag-triggered publishing (`NPM_PUBLISH=true`) |
| [#24](https://github.com/Suraj1235/Yell-at-AI/issues/24) | Signed installers: VS Build Tools (a UAC prompt), an Authenticode certificate, and Apple notarization |
| [#32](https://github.com/Suraj1235/Yell-at-AI/issues/32) | License: currently noncommercial source-available; the stated plan is open source |

**Product and engineering:**

| # | What |
| --- | --- |
| [#25](https://github.com/Suraj1235/Yell-at-AI/issues/25) | Bundle Node and whisper.cpp into the desktop app so users don't install them |
| [#26](https://github.com/Suraj1235/Yell-at-AI/issues/26) | Local transcription latency: 3.3–5 s per turn against a 3 s target |
| [#27](https://github.com/Suraj1235/Yell-at-AI/issues/27) | Happy vs neutral: the contract needs a positive-arousal category |
| [#28](https://github.com/Suraj1235/Yell-at-AI/issues/28) | Remaining wild misses, plus a larger, more diverse eval set |
| [#29](https://github.com/Suraj1235/Yell-at-AI/issues/29) | Multilingual models; `base.en` turns other languages into invented English |
| [#30](https://github.com/Suraj1235/Yell-at-AI/issues/30) | Desktop polish: foreground-app detection on macOS/Linux, onboarding copy, contract drift, CI legs |
| [#31](https://github.com/Suraj1235/Yell-at-AI/issues/31) | Mobile system-wide insertion (Android IME, iOS keyboard); the PWA is copy-only |
| [#33](https://github.com/Suraj1235/Yell-at-AI/issues/33) | Minor review findings deferred during development |

## Gotchas that cost real time

- **No MSVC linker on the dev machine.** `link.exe` on `PATH` under Git Bash is coreutils `link`, not the linker. Use `RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-gnu` with WinLibs MinGW on `PATH`: `cargo check` works, but the cdylib won't link. For a temporary launch, set `crate-type = ["rlib"]`, and **never commit that**, because mobile needs cdylib/staticlib. `npm run desktop:check` explains this when it fails.
- **whisper.cpp release binaries.** v1.9.4 ships no Windows binaries. Use v1.9.2's `whisper-bin-x64.zip` and set `SUBTEXT_WHISPER_BIN`.
- **Git Bash paths reach native binaries badly.** `command -v ffmpeg` returns `/c/...`, which native Windows binaries such as `yt-dlp.exe` cannot open. The wild eval now uses `where` on Windows.
- **Node's global `fetch` ignores `HTTP(S)_PROXY`.** A "tests pass under a bogus proxy" check therefore proves nothing about network isolation; verify it statically.
- **Hugging Face ETags.** Following the redirect gives you the CDN's ETag. Read `X-Linked-Etag` from the origin with `redirect: "manual"` to get the real SHA-256.
- **macOS `/var` is a symlink to `/private/var`.** Realpath temp dirs before comparing paths.
- **Browser automation:** the maintainer uses Brave. Run headless checks in an isolated Chrome profile on a non-default port, and never kill browsers by name.

## Records

- Design and plans: [`plans/2026-09-21-product-launch-design.md`](../plans/2026-09-21-product-launch-design.md) and [`plans/2026-09-21-phase-0-1-implementation.md`](../plans/2026-09-21-phase-0-1-implementation.md).
- Phase 2 build reports: the shell, polish pass, desktop, wiring and affect fix, plus the Wispr Flow UX reference, are in [`plans/2026-09-22-phase-2/`](../plans/2026-09-22-phase-2/). These are the working reports from each build, with measurements and the reasoning behind each decision.
- Change history: [`CHANGELOG.md`](../CHANGELOG.md). Every change landed as a reviewed PR, #12 through #20.
