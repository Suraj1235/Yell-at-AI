# Subtext Desktop Scaffold

This is the native desktop app scaffold for the northstar product. It is intentionally small: the signed app is not shipped yet, but the boundary is now concrete and testable.

The scaffold is a Tauri/Rust wrapper around the current Node reference core. It gives the future desktop app a place to own:

- visible recording state
- explicit bounded capture
- native/global hotkey integration
- calibration entry points
- host/native transcript bridge configuration
- accessibility insertion with user confirmation

## Current Behavior

The app UI can load installer-generated config through `subtext_load_config`, then call a Tauri command named `subtext_session`. That command runs:

```sh
node /path/to/bin/subtext.js session \
  --duration 4 \
  --transcript-command "host-transcript --json {audio}" \
  --target clipboard \
  --verbosity full
```

The command is bounded and explicit. It delegates audio recording, transcript bridging, prosody analysis, and rendering to the reference core.

## Local Configuration

Set these environment variables before launching the app during development:

```sh
export SUBTEXT_NODE=node
export SUBTEXT_CLI_PATH=/absolute/path/to/Yell-at-AI/bin/subtext.js
export SUBTEXT_TRANSCRIPT_COMMAND='host-transcript --json {audio}'
export SUBTEXT_DESKTOP_CONFIG=/absolute/path/to/apps/desktop/subtext-desktop.generated.json
```

The adapter installer also writes `apps/desktop/subtext-desktop.generated.json` with the concrete CLI path for this checkout:

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

The hotkey block is an explicit launch-track placeholder. It records the intended native accelerator in generated config, but this scaffold does not register a production global shortcut yet.

## Boundary

This scaffold is not a signed app, installer, background listener, or marketplace package. It is the checked-in native-app track that future M1 work should harden into signed binaries.
