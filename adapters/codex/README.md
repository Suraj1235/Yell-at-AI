# Codex Adapter

Codex can use Subtext through the MCP-style JSON-RPC server.

Install a concrete local Codex adapter bundle with:

```sh
node bin/subtext.js install-adapter --harness codex --target ./subtext-codex-adapter
```

Then merge `subtext-codex-adapter/adapters/codex/mcp.config.generated.json` into your Codex MCP configuration. The generated file points at this checkout's real `bin/subtext.js` path.

Example local config:

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

The exposed tools are:

- `analyze_file`, for local WAV paths
- `analyze_audio`, for base64 WAV bytes or `audioDataUrl`

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

For no-MCP flows, use:

```sh
node bin/subtext.js analyze --audio turn.wav --text "..." --format prompt
```
