# Harness Doctor

`subtext doctor` verifies that the local adapter layer is present and ready for each supported harness.

```sh
node bin/subtext.js doctor
node bin/subtext.js doctor --format json
node bin/subtext.js doctor --harness vscode
```

The doctor reads [adapters/harnesses.json](../adapters/harnesses.json) and checks the files or templates each harness needs:

- CLI, HTTP, browser preview, desktop capture, MCP, and universal clipboard/active-app paste handoff
- Codex MCP config template
- Claude Code prompt hook and Subtext skill template
- VS Code extension template
- Hammerspoon global-hotkey bridge template
- Native desktop Tauri/Rust scaffold
- realtime assistant steering guide

## Output Contract

JSON output uses `subtext/harness-doctor/v1`:

```json
{
  "schema": "subtext/harness-doctor/v1",
  "ok": true,
  "summary": { "harnesses": 12, "ready": 12, "notReady": 0 },
  "harnesses": []
}
```

`ready: true` means the local adapter files are present and internally valid. It does not mean marketplace packaging or host-specific installation has been completed. The `status` field from the harness catalog still distinguishes:

- `implemented`: usable locally now
- `template-tested`: local template is valid and ready to package/install into the target host
- `steering-template`: prompt guidance is available for native audio sessions

This gives a quick release check for the "plug into my harness" promise without requiring every target app to be installed during CI.
