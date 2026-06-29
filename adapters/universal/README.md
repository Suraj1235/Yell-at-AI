# Universal Adapter

The universal adapter is a clipboard and active-app paste handoff that works with any text field:

```sh
node bin/subtext.js handoff \
  --audio turn.wav \
  --text "wait um i am not sure which auth flow broke?" \
  --target clipboard
```

Then paste into Codex, Claude Code, VS Code chat, a browser assistant, a terminal prompt wrapper, or any other text field.

Other targets:

```sh
node bin/subtext.js handoff --audio turn.wav --text "..." --target stdout
node bin/subtext.js handoff --audio turn.wav --text "..." --target file --out enriched.txt
node bin/subtext.js handoff --audio turn.wav --text "..." --target paste
```

For bounded desktop recording plus paste-anywhere delivery:

```sh
node bin/subtext.js capture --duration 4 --text "..." --target paste
node bin/subtext.js session --duration 4 --transcript-command "host-transcript --json {audio}" --target paste
node bin/subtext.js ptt --turns 3 --duration 4 --transcript-command "host-transcript --json {audio}" --target paste
```

`session` is the preferred one-shot natural-speech path when a host or OS voice layer can provide transcript text. `ptt` repeats the same flow for bounded local push-to-talk turns. If that bridge returns JSON with confidence, language, and word timings, Subtext uses those fields for stronger alignment before pasting the enriched prompt.

Universal handoff itself is explicit copy/paste delivery, not a background hotkey daemon. For local macOS hotkey automation, use the separate Hammerspoon template in `adapters/hotkey`.
