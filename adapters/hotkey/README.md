# Global Hotkey Adapter

This adapter is a local global-hotkey bridge for Subtext. It is the practical M0 path between terminal `subtext ptt` and the future signed desktop app.

It binds a key to:

```sh
node bin/subtext.js ptt \
  --turns 1 \
  --trigger none \
  --duration 4 \
  --transcript-command "host-transcript --json {audio}" \
  --target paste
```

## macOS With Hammerspoon

1. Install [Hammerspoon](https://www.hammerspoon.org/).
2. Copy `hammerspoon-subtext.lua` into `~/.hammerspoon/`.
3. Add this to `~/.hammerspoon/init.lua`:

```lua
dofile(os.getenv("HOME") .. "/.hammerspoon/hammerspoon-subtext.lua")
```

4. Configure environment variables before launching Hammerspoon:

```sh
export SUBTEXT_CLI_PATH="/absolute/path/to/Yell-at-AI/bin/subtext.js"
export SUBTEXT_TRANSCRIPT_COMMAND='host-transcript --json {audio}'
export SUBTEXT_DURATION=4
export SUBTEXT_TARGET=paste
```

Default hotkey: `cmd+alt+ctrl+y`.

## Boundary

This is not a signed app, background listener, installer, or marketplace package. It is a local automation template that calls the same bounded `subtext ptt` path used by the CLI and universal adapter.

