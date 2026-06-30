# Codex Adapter

Give Codex the meaning/emotion layer through Subtext's MCP-style JSON-RPC server. Codex calls a
Subtext tool with audio plus a transcript and gets back the rendered `vocalcontext/v1` prompt (or the
raw contract) to reason over.

## One-command setup

From a checkout of this repo, generate a config wired to this checkout's real CLI path:

```sh
node bin/subtext.js install-adapter --harness codex --target ./subtext-codex-adapter
```

Then merge `subtext-codex-adapter/adapters/codex/mcp.config.generated.json` into your Codex MCP
configuration. The generated file already contains the absolute path to this checkout's
`bin/subtext.js`, so there is nothing to hand-edit.

## Manual config

If you prefer to wire it by hand, add a server entry that runs the CLI in `mcp` mode. Use an absolute
path to `bin/subtext.js`:

```json
{
  "mcpServers": {
    "subtext": {
      "command": "node",
      "args": ["/absolute/path/to/Yell-at-AI/bin/subtext.js", "mcp"]
    }
  }
}
```

On Windows, use the native path form for the argument, for example
`"C:\\Users\\you\\Yell-at-AI\\bin\\subtext.js"` (JSON requires the backslashes to be escaped).
`command` stays `"node"` on every OS.

## Exposed tools

- `analyze_file`, for local WAV paths
- `analyze_audio`, for base64 WAV bytes or an `audioDataUrl`

`analyze_file` accepts:

```json
{
  "audioPath": "/absolute/path/to/turn.wav",
  "transcript": {
    "schema": "subtext/transcript/v1",
    "text": "can we just refactor the whole auth module",
    "source": "codex-native-voice"
  },
  "format": "prompt",
  "verbosity": "full"
}
```

`analyze_audio` accepts the same transcript envelope without requiring a shared local file path:

```json
{
  "audioBase64": "...wav bytes...",
  "transcript": {
    "schema": "subtext/transcript/v1",
    "text": "can we just refactor the whole auth module",
    "source": "codex-native-voice",
    "confidence": 0.94,
    "language": "en",
    "wordTimings": []
  },
  "format": "prompt",
  "verbosity": "full"
}
```

## No-MCP fallback

For shells or automations that do not speak MCP, call the CLI directly:

```sh
node bin/subtext.js analyze --audio turn.wav --text "..." --format prompt
```
