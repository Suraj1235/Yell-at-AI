# Universal Clipboard Handoff

Universal handoff is the practical "any harness" bridge. It renders the same `vocalcontext/v1` prompt used by every adapter, then either copies it to the clipboard or explicitly pastes it into the active app.

```sh
node bin/subtext.js handoff \
  --audio turn.wav \
  --text "stop rewriting the whole auth module" \
  --target clipboard
```

Supported targets:

- `clipboard`: copy the enriched prompt to the system clipboard
- `paste`: copy the enriched prompt, then invoke an active-app paste command
- `stdout`: print the enriched prompt
- `file`: write the enriched prompt to `--out`

With calibration:

```sh
node bin/subtext.js handoff \
  --audio turn.wav \
  --text "..." \
  --baseline baseline.json \
  --target clipboard
```

## Clipboard Commands

Subtext uses:

- macOS: `pbcopy`
- Windows: `clip`
- Linux Wayland: `wl-copy`, then `xclip -selection clipboard`, then `xsel --clipboard --input`
- Linux X11 or unknown session: `xclip -selection clipboard`, then `xsel --clipboard --input`

For test harnesses or custom environments:

```sh
node bin/subtext.js handoff \
  --audio turn.wav \
  --text "..." \
  --target clipboard \
  --clipboard-command "my-copy-command"
```

## Active-App Paste

```sh
node bin/subtext.js handoff \
  --audio turn.wav \
  --text "..." \
  --target paste
```

`--target paste` first writes the enriched prompt to the clipboard, then sends a paste gesture to the active app.

Default paste commands:

- macOS: `osascript` sends Command-V through System Events
- Windows: PowerShell sends Ctrl-V through `System.Windows.Forms.SendKeys`
- Linux: `xdotool key ctrl+v`

For tests or custom automation:

```sh
node bin/subtext.js handoff \
  --audio turn.wav \
  --text "..." \
  --target paste \
  --clipboard-command "my-copy-command" \
  --paste-command "my-paste-command"
```

## Boundary

This is explicit insertion, not a background daemon. Some platforms may require accessibility permission for the paste gesture. The Hammerspoon adapter can bind `subtext ptt --target paste` to a local macOS hotkey, but signed native global insertion is still future work. Use `--target clipboard` when you want to inspect before manually pasting.
