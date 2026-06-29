# Harness Adapter Matrix

Subtext is designed around one contract, `vocalcontext/v1`, and several host harnesses. The core should not know which assistant receives the rendered prompt.

The machine-readable matrix is `adapters/harnesses.json`.

| Harness | Status | Tier | Boundary |
| --- | --- | --- | --- |
| CLI | implemented | B/C | `node bin/subtext.js analyze --audio turn.wav --text "..." --format prompt` |
| HTTP | implemented | B/C | `node bin/subtext.js serve` |
| Browser microphone preview | implemented | C | `http://127.0.0.1:8765` after `node bin/subtext.js serve` |
| Desktop capture | implemented | C | `node bin/subtext.js session --duration 4 --transcript-command "host-transcript --json {audio}"` |
| MCP-style JSON-RPC | implemented | B | `node bin/subtext.js mcp`, exposing `analyze_file` and `analyze_audio` |
| Codex | template-tested | B | `adapters/codex/mcp.config.example.json` |
| Claude Code | template-tested | B | `adapters/claude-code/hooks/user-prompt-submit.mjs` and skill |
| Native realtime audio assistants | steering-template | A | session instruction that preserves the same contract |
| VS Code / IDE chat | template-tested | B/C | `adapters/vscode/package.json` extension template |
| Global hotkey bridge | template-tested | C | `adapters/hotkey/hammerspoon-subtext.lua` local automation template |
| Native desktop scaffold | template-tested | C | `apps/desktop/src-tauri/tauri.conf.json` Tauri/Rust launch track |
| Universal text field | implemented | C | `node bin/subtext.js ptt --turns 3 --duration 4 --transcript-command "host-transcript --json {audio}" --target paste` |

## Local Installation

Use `subtext install-adapter` to create a concrete copy of an adapter with generated host config:

```sh
node bin/subtext.js install-adapter --harness codex --target ./subtext-codex-adapter
node bin/subtext.js install-adapter --harness claude-code --target ./subtext-claude-adapter
node bin/subtext.js install-adapter --harness vscode --target ./subtext-vscode-adapter
node bin/subtext.js install-adapter --harness hotkey --target ./subtext-hotkey-adapter
node bin/subtext.js install-adapter --harness native-desktop --target ./subtext-desktop-scaffold
```

The generated install manifest records copied files, readiness checks, and the next host-specific step.

## Contract Rule

Every harness receives either:

- the raw JSON contract, or
- a rendered `<vocal-context schema="vocalcontext/v1">` block plus the transcript.

Harnesses may capture audio, pass `subtext/transcript/v1` transcript envelopes, and insert rendered output. They must not invent their own emotion labels.

When a contract includes `assistant_guidance`, adapters should preserve it in JSON responses and rendered prompt blocks. That field is the cross-harness response policy derived from the evidence flags.
