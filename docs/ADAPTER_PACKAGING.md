# Adapter Packaging

`npm run package:adapters` builds local adapter bundles under `dist/adapters/`.

```sh
npm run package:adapters
```

The command reads [adapters/harnesses.json](../adapters/harnesses.json), runs the same readiness checks used by `subtext doctor`, then emits:

- `dist/adapters/index.json`
- one `dist/adapters/<harness>/bundle.json` per harness
- the adapter files needed by that harness

## Bundle Contract

Each bundle manifest uses `subtext/adapter-bundle/v1`:

```json
{
  "schema": "subtext/adapter-bundle/v1",
  "id": "vscode",
  "version": "0.1.0",
  "ready": true,
  "requiresCorePackage": true,
  "files": []
}
```

The generated bundles are local release artifacts, not a substitute for host marketplace publishing. They make the packaging boundary explicit:

- `implemented` harnesses are usable through the core package now.
- `template-tested` harnesses produce copyable/installable template bundles.
- `steering-template` harnesses produce instruction bundles for native audio sessions.

Generated output is ignored by git because it can be reproduced from source.

## Installing A Local Bundle

Use `subtext install-adapter` when you want a concrete, copyable adapter directory for a specific harness:

```sh
node bin/subtext.js install-adapter --harness codex --target ./subtext-codex-adapter
node bin/subtext.js install-adapter --harness claude-code --target ./subtext-claude-adapter
node bin/subtext.js install-adapter --harness vscode --target ./subtext-vscode-adapter
node bin/subtext.js install-adapter --harness hotkey --target ./subtext-hotkey-adapter
node bin/subtext.js install-adapter --harness native-desktop --target ./subtext-desktop-scaffold
```

The installer:

- runs the same readiness checks as `subtext doctor`
- copies the harness adapter files into the target directory
- refuses to overwrite existing files unless `--force` is passed
- supports `--dry-run`
- writes `subtext-adapter-install.json`
- writes generated host config when the harness needs a concrete path to this checkout

Generated files by harness:

| Harness | Generated File | Purpose |
| --- | --- | --- |
| Codex | `adapters/codex/mcp.config.generated.json` | MCP config with the real `bin/subtext.js` path |
| Claude Code | `adapters/claude-code/subtext.env.example` | `SUBTEXT_CLI_PATH` and verbosity env vars for the hook |
| VS Code | `adapters/vscode/settings.generated.json` | extension settings with the real Subtext CLI path |
| Hotkey | `adapters/hotkey/hammerspoon-subtext.generated.lua` | Hammerspoon config with the real Subtext CLI path |
| Native desktop | `apps/desktop/subtext-desktop.generated.json` | scaffold settings with the real Subtext CLI path, host transcript command, target, verbosity, and hotkey placeholder |

Example JSON output:

```sh
node bin/subtext.js install-adapter --harness codex --target ./subtext-codex-adapter --format json
```

The generated bundles are still local install artifacts. Host marketplace packaging and one-click plugin publishing remain separate release tasks.
