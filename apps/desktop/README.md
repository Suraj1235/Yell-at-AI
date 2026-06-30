# Subtext Desktop (Windows push-to-talk dev build)

This is the native desktop surface for Yell-at-AI: a Tauri/Rust shell that gives
the Node reference core a global push-to-talk hotkey on Windows. It is a working
**developer build**, not a signed or installable product yet (see
[Status and follow-ups](#status-and-follow-ups)).

## What it does

Press the global hotkey **`Ctrl+Alt+Y`** anywhere on Windows and the app runs one
bounded natural-speech turn by invoking the existing Node CLI as a child-process
sidecar:

```sh
node /absolute/path/to/Yell-at-AI/bin/subtext.js ptt \
  --turns 1 \
  --duration 4 \
  --trigger none \
  --transcript-command "host-transcript --json {audio}" \
  --target paste \
  --verbosity full
```

The CLI records audio, bridges a transcript (via the configured transcript
command, or the optional whisper STT adapter), runs prosody analysis, renders the
enriched `<vocal-context>` prompt, and pastes it into whatever app currently has
focus using the existing `src/handoff/paste.js` path. `--trigger none` makes the
turn fire immediately — the hotkey press is the trigger, so no terminal Enter is
needed.

The capture is bounded and explicit: one turn per press, a fixed duration, and a
re-entry guard that ignores a second press while a turn is still running. The
desktop layer owns only the hotkey, the sidecar invocation, and the visible
status — all recording, transcription, analysis, and rendering stay in the
reference core.

### Status surface

Run state is shown three ways and stays in sync:

- a status banner in the app window (Ready / Listening / Delivered / Failed),
- the window title,
- the system-tray tooltip (when a tray icon is available).

The window also keeps the original manual controls: a **Load Config** button and
a **Record Bounded Turn** button that calls the `subtext_session` Tauri command
directly (useful for testing without the global hotkey).

## Prerequisites

- **Node.js >= 20** on `PATH` (this repo's core is zero-dependency Node).
- **Rust toolchain** (stable) — install from <https://rustup.rs>.
- **Tauri CLI v2** and Windows WebView2 (preinstalled on Windows 11).

Install the Tauri CLI once (either is fine):

```sh
# via npm (uses apps/desktop/package.json devDependency)
cd apps/desktop
npm install

# or globally via cargo
cargo install tauri-cli --version "^2.0.0"
```

On Windows you also need the Microsoft C++ Build Tools (the MSVC toolchain that
`rustup` prompts you to install) and WebView2. WebView2 ships with Windows 11; on
older Windows install the Evergreen runtime from Microsoft.

## Configure this checkout

The hotkey path needs to know where this repo's CLI lives. Provide that either
through environment variables or the generated config file (env vars win).

Environment variables:

```sh
# PowerShell
$env:SUBTEXT_NODE = "node"
$env:SUBTEXT_CLI_PATH = "C:\path\to\Yell-at-AI\bin\subtext.js"
$env:SUBTEXT_TRANSCRIPT_COMMAND = "host-transcript --json {audio}"
$env:SUBTEXT_DESKTOP_CONFIG = "C:\path\to\Yell-at-AI\apps\desktop\subtext-desktop.generated.json"
```

Or `apps/desktop/subtext-desktop.generated.json` (the adapter installer can write
this; you can also create it by hand):

```json
{
  "schema": "subtext/desktop-config/v1",
  "nodeCommand": "node",
  "subtextCliPath": "C:/path/to/Yell-at-AI/bin/subtext.js",
  "transcriptCommand": "host-transcript --json {audio}",
  "duration": 4,
  "target": "clipboard",
  "verbosity": "full",
  "hotkey": {
    "enabled": true,
    "accelerator": "Ctrl+Alt+Y",
    "mode": "dev"
  }
}
```

Resolution order for each value: explicit Tauri-command argument (manual button)
-> environment variable -> generated config -> built-in default. The hotkey path
uses the env var / config / default chain. If `subtextCliPath` is missing the app
reports a clear "Missing Subtext CLI path" failure instead of running a broken
turn.

The `hotkey.accelerator` field drives the registered global shortcut. If it is
absent or unparseable the app falls back to `Ctrl+Alt+Y`. The config's
cross-platform placeholder string `Cmd+Alt+Ctrl+Y` is shown in the UI for
reference; the **active Windows accelerator is `Ctrl+Alt+Y`**.

## Run the dev build

From `apps/desktop` (the Tauri CLI reads `src-tauri/tauri.conf.json`):

```sh
cd apps/desktop

# via npm script
npm run tauri:dev

# or with the cargo-installed CLI
cargo tauri dev
```

`tauri dev` compiles the Rust shell, launches the window, registers the global
shortcut, and (when an app icon is available) creates a tray icon. Press
`Ctrl+Alt+Y` (with a real `--transcript-command` configured) to capture a turn;
the banner moves through Listening -> Delivered, and the enriched prompt is pasted
into the focused app.

No icon assets are checked in for this dev build, so there may be no tray icon and
the window uses the platform default; status is still shown in the window banner
and title. Adding `src-tauri/icons/` and a `bundle.icon` list is part of the
packaging follow-up below. If your Tauri CLI version requires icons to launch,
generate a placeholder set with `cargo tauri icon path/to/icon.png`.

### Smoke check without audio hardware

If you do not have a transcript command wired up, you can still verify the shell
compiles and the wiring is correct:

```sh
# from repo root, validate the scaffold's config/Rust/HTML invariants
node scripts/validate-desktop-scaffold.mjs

# type-check the Rust without producing a binary (needs the Rust toolchain)
cd apps/desktop/src-tauri
cargo check
```

## How the sidecar is wired

- **Hotkey:** registered with `tauri-plugin-global-shortcut`; the handler fires on
  the `Pressed` edge of `Ctrl+Alt+Y`.
- **Sidecar:** the turn is launched with `tauri-plugin-shell`
  (`app.shell().command("node").args([...]).output()`), scoped in
  `src-tauri/capabilities/default.json` to the `node` program. This shells out to
  the repo's CLI rather than bundling a binary, so the same Node core is reused
  verbatim. (Bundling Node as a true Tauri `externalBin` sidecar is a follow-up;
  see below.)
- **Paste:** delegated to the CLI's `--target paste`, which uses the existing
  cross-platform paste handoff (`SendKeys ^v` on Windows).

## Status and follow-ups

This is a **dev build**. It is not a signed app, installer, background service,
or marketplace package. Concretely out of scope for now, tracked as documented
follow-ups:

- **Code-signed `.msi` installer.** Producing a signed Windows installer
  (`tauri build` with an Authenticode certificate and `bundle.active = true`) is a
  deliberate follow-up. `bundle.active` is currently `false` and no signing is
  attempted.
- **Bundled Node sidecar.** Shipping Node as a true Tauri `externalBin` so end
  users do not need Node on `PATH`.
- **Hardened capture UX.** Push-to-hold capture, device selection in-app, and
  calibration entry points.

When that hardening lands, this is the checked-in native track it builds on.
