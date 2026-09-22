# Native Desktop Scaffold

The northstar desktop app is a signed, visible, global-hotkey capture surface that helps AI understand what you mean and the emotion of your natural speech before anything is pasted into a coding assistant. M0 does not ship that signed app yet, but the repo now includes a concrete scaffold at [apps/desktop](../apps/desktop).

## What Exists

- Tauri v2 config at `apps/desktop/src-tauri/tauri.conf.json`
- Rust command bridge at `apps/desktop/src-tauri/src/main.rs`
- The shared product shell (`apps/shell/`, adapter `platform/platform.tauri.js`) as the frontend, staged by `apps/desktop/src-tauri/build.rs`
- Installer-generated config path at `apps/desktop/subtext-desktop.generated.json`
- Explicit Tauri global bridge enablement (`withGlobalTauri`) so the shell's vanilla ES modules reach `invoke()` with no bundler
- Tauri config loader command `subtext_load_config` for `subtext/desktop-config/v1`
- Bounded session command `subtext_session` with guarded `stdout`, `clipboard`, and `paste` targets

The scaffold delegates to the current reference core:

```sh
node bin/subtext.js session \
  --duration 4 \
  --transcript-command "host-transcript --json {audio}" \
  --target clipboard \
  --verbosity full
```

That keeps recording bounded and visible while preserving the native transcript bridge boundary.

The local adapter installer writes:

```json
{
  "schema": "subtext/desktop-config/v1",
  "nodeCommand": "node",
  "subtextCliPath": "/absolute/path/to/bin/subtext.js",
  "transcriptCommand": "host-transcript --json {audio}",
  "duration": 4,
  "target": "clipboard",
  "verbosity": "full",
  "hotkey": {
    "enabled": false,
    "accelerator": "Cmd+Alt+Ctrl+Y",
    "mode": "scaffold"
  }
}
```

## Why This Helps

The desktop app is where the full product should own:

- visible recording state
- global hotkey registration
- OS microphone permissions
- native device/profile switching
- calibration UI
- editable prompt preview before insertion
- accessibility insertion with user confirmation
- signing, notarization, and installer packaging

The scaffold gives those responsibilities a real project folder, generated config boundary, and validation target without pretending they are complete.

## Development Check

```sh
npm run desktop:check
```

The check validates the Tauri config, Cargo manifest, Rust command bridge, UI bridge, and docs. It does not build or sign a binary.

## Boundary

This is not a signed binary, installer, background listener, or production global hotkey implementation. It is a checked-in launch track for M1.
