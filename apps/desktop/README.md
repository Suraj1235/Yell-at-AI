# Subtext Desktop

The native desktop shell for Yell-at-AI: a Tauri 2 / Rust app that gives the
zero-dependency Node core a press-and-hold global hotkey, a floating overlay
pill, a tray, and local turn history.

It is a **developer build**. It is not a signed app, and it does not bundle
Node - see [Status and follow-ups](#status-and-follow-ups).

## The loop

Hold **`Ctrl+Alt+Y`**, a small pill appears near the cursor with a live
waveform, you speak, you release, and your words land in whatever app has focus
with the `vocalcontext/v1` evidence block attached.

| Gesture | Behaviour |
| --- | --- |
| Hold ≥250 ms, release | Hold-to-talk. Capture starts on the press edge and **ends on release**. |
| Tap (<250 ms) | Tap-to-toggle, for long dictation. The next tap ends the turn. |
| `Esc` during a turn | Cancels. Nothing is inserted. |

`Esc` is bound globally **only while a turn is live** and released the moment it
ends, so an idle Subtext never holds the Escape key hostage.

The hotkey is rebindable at runtime. An accelerator the OS refuses - already
claimed by another app, reserved by the shell - produces a clear error and the
previous binding stays active. It never fails silently.

## Two capture paths

The desktop app can record in either of two places, and which one is live is an
explicit choice:

1. **WebView capture (the product path).** Tick *capture in this window* and the
   frontend records with `getUserMedia`, encodes a 16-bit PCM WAV in-page, and
   hands the bytes to Rust. No ffmpeg, no `sox`, no `arecord`. Rust then calls
   the Node CLI to transcribe and analyse, and inserts the result.
2. **CLI capture (the original dev-build path, and the default).** Until a
   frontend claims the hotkey with `subtext_hotkey_claim`, the press edge runs
   one bounded turn through the Node CLI exactly as the first scaffold did:

   ```sh
   node /absolute/path/to/Yell-at-AI/bin/subtext.js ptt \
     --turns 1 --duration 4 --trigger none \
     --transcript-command "host-transcript --json {audio}" \
     --target paste --verbosity full
   ```

Either way the capture is bounded and explicit: one turn per gesture, and a
re-entry guard that ignores a second press while a turn is still running.

## Never lose the user's words

`subtext_insert` writes the clipboard **first**, then synthesises the paste
keystroke (the same per-platform command as `src/handoff/paste.js`). If the
keystroke does not land - no Accessibility permission on macOS, no `xdotool` or
`wtype` on Linux - the text is still on the clipboard, the result says so, and
the turn is still written to history. An insertion failure is not data loss.

Every child-process call is timeout-bounded and the child is killed on timeout,
so a wedged sidecar surfaces as an error rather than a hang.

## Surfaces

- **Overlay pill** - a second window (`pill`), 180×48 logical px, frameless,
  transparent, always-on-top, skip-taskbar, **non-focusable**, and
  click-through. It never steals focus from the app you are typing into. It is
  hidden by default and shown for the duration of a turn.
- **Tray** - status (Ready / Listening / Thinking / Delivered / Failed), open
  the window, open the local history folder, quit.
- **Window title and banner** - the same status, so all three agree.
- **Launch at login** - a checkbox in the window, via `tauri-plugin-autostart`.
- **History** - the last 100 turns, in a JSON file under the OS app-data
  directory. Local only; the tray can open the folder so you can check.

Mic active implies pill visible: visibility is driven by the Rust status path,
not by the frontend, so there is no way to record with the overlay hidden.

## Prerequisites

- **Node.js >= 20** on `PATH` (this repo's core is zero-dependency Node).
- **Rust toolchain** (stable) - <https://rustup.rs>.
- **Tauri CLI v2** and a webview: WebView2 on Windows (preinstalled on
  Windows 11), WebKitGTK on Linux, WKWebView on macOS.
- On Windows, the **Microsoft C++ Build Tools** (the MSVC workload `rustup`
  prompts for). Without them there is no linker and nothing - not even
  `cargo check` - will build.

```sh
cd apps/desktop
npm install                 # installs @tauri-apps/cli
# or: cargo install tauri-cli --version "^2.0.0"
```

## Configure this checkout

The app needs to know where this repo's CLI lives. Environment variables win
over the generated config file.

```sh
# PowerShell
$env:SUBTEXT_NODE = "node"
$env:SUBTEXT_CLI_PATH = "C:\path\to\Yell-at-AI\bin\subtext.js"
$env:SUBTEXT_TRANSCRIPT_COMMAND = "host-transcript --json {audio}"
$env:SUBTEXT_STT_ENGINE = "whisper"
$env:SUBTEXT_DESKTOP_CONFIG = "C:\path\to\Yell-at-AI\apps\desktop\subtext-desktop.generated.json"
```

Or `apps/desktop/subtext-desktop.generated.json`:

```json
{
  "schema": "subtext/desktop-config/v1",
  "nodeCommand": "node",
  "subtextCliPath": "C:/path/to/Yell-at-AI/bin/subtext.js",
  "transcriptCommand": "host-transcript --json {audio}",
  "duration": 4,
  "target": "clipboard",
  "verbosity": "full",
  "engine": "whisper",
  "hotkey": {
    "enabled": true,
    "accelerator": "Ctrl+Alt+Y",
    "mode": "dev"
  }
}
```

Resolution order for each value: explicit Tauri-command argument -> environment
variable -> generated config -> built-in default. A missing `subtextCliPath`
produces a clear "Missing Subtext CLI path" failure instead of a broken turn.
`hotkey.accelerator` drives the registered shortcut; if it is absent or
unparseable the app falls back to `Ctrl+Alt+Y` and says so on stderr.

## Run it

```sh
cd apps/desktop
npm run tauri:dev      # or: cargo tauri dev
npm run tauri:build    # unsigned installer; see below
```

### Check it without audio hardware

```sh
# from the repo root - validates the config/Rust/HTML invariants AND runs cargo check
npm run desktop:check

# just the Rust
cd apps/desktop/src-tauri && cargo check
```

`npm run desktop:check` runs `cargo check --all-targets` in the Tauri crate. If
cargo is not on `PATH` it skips that step with an explicit message rather than
pretending it compiled. `SUBTEXT_SKIP_CARGO=1` skips it deliberately.

## Icons

`src-tauri/icons/` is generated, not hand-drawn:

```sh
node apps/desktop/scripts/generate-icons.mjs
```

The script draws a dark rounded square with a teal-to-violet waveform - the
landing page's palette - and writes the PNG, `.ico`, and `.icns` set with no
dependencies. They are on-brand **placeholders**, not finished brand assets.
`tauri-build` refuses to build on Windows without `icons/icon.ico`, so they have
to exist for the crate to compile at all.

## Extending or replacing the frontend

`apps/desktop/src/` is self-contained and is the reference implementation of the
window / command / event contract. The shared shell at `apps/shell/` replaces it
by pointing `frontendDist` at itself. **The contract is documented in
[CONTRACT.md](CONTRACT.md)** - windows, events, commands, and what each side
owns.

## Status and follow-ups

This is a **dev build**. Concretely out of scope for now:

- **Code signing.** `bundle.active` is `true`, so `tauri build` produces
  installers, but nothing is signed - no Authenticode certificate and no Apple
  Developer ID exists yet. Unsigned means SmartScreen and Gatekeeper warnings.
  This is not a signed app.
- **Bundled Node / whisper sidecar.** The app shells out to `node` on `PATH`.
  Shipping them as true Tauri `externalBin` entries is a separate task.
- **SQLite history.** History is a capped JSON file; the command surface is the
  same either way.
- **Per-app insertion rules** (full `<vocal-context>` for AI apps, plain text for
  Slack and email) live in the shell, not here.
- **Native Android/iOS.** The crate has the `[lib]` target and `pub fn run()`
  that `tauri android init` / `tauri ios init` require; the desktop-only plugins
  still need target-gating when that lands. See CONTRACT.md §5.

Verified on Windows only so far. The Rust is `cfg`-guarded for macOS and Linux
(paste command, folder opener, transparency) but has not been built on them.
