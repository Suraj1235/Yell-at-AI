# Phase 2 — desktop wiring report

Worktree `D:\Yell-at-AI\.worktrees\wiring`, branch `feat/phase-2-wiring`, 4 commits on `15392ac`:

| SHA | Commit |
| --- | --- |
| `eedc491` | feat(desktop): the Rust half the shell needs to drive a turn |
| `6ed1218` | feat(shell): drive the desktop app through a real Tauri adapter |
| `b1f7510` | build(desktop): run apps/shell in Tauri and retire apps/desktop/src |
| `86771c7` | docs(desktop): the contract now describes the shell it runs |

## Decisions

- **frontendDist = `gen/frontend`** (under src-tauri), not `apps/`. Tauri embeds
  everything under frontendDist, and `apps/` contains `src-tauri/target/`.
  `build.rs` mirrors `apps/shell/**` → `gen/frontend/shell/**` and
  `apps/web/vendor/**` → `gen/frontend/web/vendor/**`. That keeps the layout, so
  `../../web/vendor` resolves unchanged. It is gitignored, rewrites a file only
  when its bytes change, propagates deletions, and panics clearly if either
  source tree is missing. Nothing is duplicated in git. The windows are
  `shell/index.html` and `shell/pill.html`. This is documented in CONTRACT.md §0.
- **Adapter selection**: `apps/shell/platform/index.js` uses top-level
  `await import()` on `window.__TAURI__`. No build step.
- **analyze stays in-process** with the vendored engine: one engine and one
  baseline on every surface, and no second Node start-up. The contract that
  `subtext_transcribe` returns is ignored on purpose.
- **Capture** reuses the web adapter's capture. For whisper, the take is
  decimated to 16 kHz, because whisper.cpp rejects anything else. The prosody
  engine reads the full-rate take.
- **Engines on desktop are `whisper` and `none` only.** A cancelled turn is
  still transcribed so that Undo works, and a cancelled recording must never
  reach a vendor.
- **The CLI reports `engine` as an id string, not an object.** CONTRACT §3
  overstated this. `describeEngine()` accepts either form and reads `egress`
  from the vendored registry. The badge and the onboarding claim are now chosen
  by egress: `none` means "recognised on this device, no audio is sent to
  anyone for recognition". The earlier logic would have told a whisper user
  "you type the words".
- **Insert**: `pasted:false` resolves as `{ok:true, method:"clipboard"}`, the
  pill says "Copied", and the Rust `detail` goes into a toast. When the app's
  own window has focus, the shell sends `paste:false`, so it never sends Ctrl+V
  into itself.
- **Per-app rule** (`core/targets.js`) has two desktop-only settings:
  - *In AI apps* defaults to the full block. AI apps are Claude, ChatGPT,
    Cursor, VS Code, terminals, or a browser whose title names one.
  - *Everywhere else* defaults to plain text.
  - Each setting can be `block`, `text` or `ask`. `ask` copies the block and
    pastes nothing.
- **Hotkey**: the shell subscribes to `subtext://hotkey` first and then claims
  it. `start` begins a turn, or ends one that is already listening. `end`
  finishes the turn, `cancel` cancels it, and the new `latch` phase (emitted on
  a tap's release) turns on hands-free. `subtext_status_set` with
  ready/delivered/failed settles a turn that is in the Toggled state, so a turn
  the shell ended by itself doesn't eat the next press.
- **History**: the new `subtext_history_put` upserts by id, because the shell
  writes each turn twice.
- **Overlay**: `pill.html` uses the same pill markup (a test checks the two are
  byte-identical), the same `shell.css` and the same `pill.js`.
  `core/overlay.js` takes its state only from `subtext://status` and its
  drawing data from `subtext://pill` (per-frame levels, live tint and chips,
  final chips, hands-free, warning). The window grew to 420×132 so the chips
  fit. It is transparent and click-through.
- **Also**: launch at login moved into shell Settings, because the retired page
  had the only toggle. The service worker is not registered under Tauri. The
  CSP has no `unsafe-eval`, script-src dropped `unsafe-inline`, and the IPC
  origin was added to connect-src.

## Verification (all run in the worktree)

- `cargo check --all-targets` (GNU): **pass**, no warnings.
- `npm test`: **164/164 pass** (157 baseline plus 7 in
  `test/shell-desktop.test.js`). `node --test test/privacy-claims.test.js`:
  **7/7**, unchanged.
- `npm run desktop:check` (GNU): **ok**, and cargo check ran.
- `npm run package:adapters`: the native-desktop bundle has 71 files and is
  ready. `cargo check --all-targets` inside
  `dist/adapters/native-desktop/apps/desktop/src-tauri`, with
  `CARGO_TARGET_DIR` set to the worktree target: **pass**.
- **Web**, in headless Chrome only: port 9333, a fresh temporary profile,
  `serve-shell` on 8125. `platform` is "web", the badge shows Web Speech, the
  desktop fields are hidden, and after skipping onboarding `startTurn` reaches
  `listening`. The pill's `data-state` is `listening`, then returns to idle.
- **Tauri path in headless Chrome with a mocked `__TAURI__`**: two full
  hold-to-release turns.
  - Slack as the target: plain text, `paste:true`.
  - VS Code as the target: the full `<vocal-context>` block.
  - Command order: claim → hotkey_set → status listening/thinking →
    stage_audio (a 16 kHz WAV) → transcribe(whisper) → discard →
    history_put(delivered:false) → foreground_app → insert →
    history_put(delivered:true) → status delivered.
  - pill.html followed the status events: listening, thinking, stale seq
    dropped, inserted, error, idle. Its body is transparent, and the live chip
    rendered.
- **The real Tauri app** was built rlib-only with the main window
  `visible:false`. Neither change was committed; both are reverted. It was run
  with the WebView2 CDP on 9334.
  - Window inventory for its PID: "Subtext overlay" 420×132 hidden,
    "Subtext Desktop - Ready" 775×717 hidden, plus two IME helper windows.
  - Main WebView at `http://tauri.localhost/shell/index.html`: `ready=true`,
    `platform=tauri`, badge "whisper.cpp (local)" with egress none, engines
    whisper and none, desktop fields shown, onboarding open.
    `subtext_hotkey_status.claimed=true` and `registered=true`.
  - Every shell and vendor module loaded with a 200, and the IPC calls
    returned 200.
  - The overlay WebView at `shell/pill.html` booted, and its state was idle.
  - On the very first cold launch the check ran before boot had finished:
    claimed was false and the pill was still about:blank. Two later launches
    booted fully.
  - I saw DOM and CDP state only. I never looked at a rendered screen, so
    there is no visual claim here.
- **Processes**: every server, Chrome and app process I started was killed by
  PID, and the temporary profiles were deleted. A `serve-shell` on the default
  port 8123 (PID 63544) is not mine and was left alone.

## Live vs stubbed

- **Live**: hotkey claim and events, WebView capture, the 16 kHz WAV → stage →
  whisper transcribe → discard, in-process analysis, the per-app rule with the
  foreground app on Windows, insert that honours `pasted:false`, the history
  file, tray, title and overlay status, the overlay pill, launch at login, and
  the rebind that surfaces an OS refusal.
- **Stubbed or not done**:
  - The foreground app returns `null` on macOS and Linux, so the AI-app rule
    applies everywhere there. The hook is documented.
  - Cloud STT is not offered on desktop.
  - No real microphone or whisper turn was run inside Tauri, because that would
    need a permission prompt and a visible window.
  - The onboarding copy still says "double-tap" for hands-free, but the
    desktop gesture is a single tap.

## Blockers

None for merge. Known limits:

- `cargo build` of the cdylib still can't link on GNU.
- The first cold launch of WebView2 is slow, taking several seconds before the
  shell claims the hotkey.
