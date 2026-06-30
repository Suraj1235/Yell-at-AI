# Quickstart

Subtext is the meaning and emotion layer for dictation: it reads *how* you said something - emphasis,
urgency, hesitation - and hands your AI a grounded `vocalcontext/v1` block beside the transcript. It is
model-free, runs offline, and has zero runtime dependencies (Node.js >= 20).

Pick the path that fits you.

---

## 1. Web demo (no install)

Open the demo, allow microphone access, and speak a short line with one word leaned on:

> Web demo: YELL_WEB_URL_PLACEHOLDER

You will see the live transcript plus the vocal context Subtext reads from your delivery, with a copy
button for the enriched prompt. Everything runs in the page - your audio never leaves the browser.

If your browser does not expose live dictation, the demo falls back to a text box: type the transcript
and Subtext still analyzes the recording's prosody.

---

## 2. CLI (30 seconds)

Run it on a bundled sample with no setup. `yell-at-ai` and `subtext` are the same tool:

```sh
npx yell-at-ai analyze \
  --audio eval/fixtures/emphasis.wav \
  --text "ship the whole thing" \
  --format prompt
```

Output:

```text
<vocal-context schema="vocalcontext/v1">
Emphasis: whole z=1.23
Delivery: slow rate, medium energy, wide pitch range, low pause density, falling terminal pitch, steady voice quality
Affect: emphatic (0.62): Emphatic delivery; preserve stressed words as intentional constraints or priorities.
Guidance: preserve_emphasis/focused: Preserve stressed words as likely constraints or priorities: whole.
Flags: emphasis (0.62): strong stress on "whole"
</vocal-context>

ship the whole thing
```

Install it globally if you reach for it often:

```sh
npm install -g @subtext/yell-at-ai
yell-at-ai doctor          # check which integrations are ready
yell-at-ai serve           # local mic preview at http://127.0.0.1:8765
```

Working from a checkout instead of the published package? Call the entrypoint directly with
`node bin/subtext.js <command>`.

Bring your own transcript and audio from any recorder:

```sh
yell-at-ai analyze --audio turn.wav --text "can we just refactor the whole auth module" --format prompt
```

Calibrate to your normal voice so loud, fast, or expressive speakers are not over-read:

```sh
yell-at-ai calibrate --audio neutral.wav --text "this is my normal voice" --out baseline.json
yell-at-ai analyze --audio turn.wav --text "..." --baseline baseline.json
```

---

## 3. Editor adapters

Each adapter installs as a self-contained bundle wired to your checkout. The CLI is resolved with
Node's own binary and `node:path`, so the bundles run the same on Windows, macOS, and Linux.

### Claude Code

```sh
node bin/subtext.js install-adapter --harness claude-code --target ./subtext-claude-adapter
```

Point Claude Code's `UserPromptSubmit` hook at the copied `user-prompt-submit.mjs` and export
`SUBTEXT_CLI_PATH` from the generated `subtext.env.example`. The hook enriches your outgoing prompt with
the vocal-context block, and fails open (your prompt still sends) if anything goes wrong. See
[../adapters/claude-code/README.md](../adapters/claude-code/README.md).

### Codex

```sh
node bin/subtext.js install-adapter --harness codex --target ./subtext-codex-adapter
```

Merge the generated `mcp.config.generated.json` into your Codex MCP configuration. It exposes
`analyze_file` and `analyze_audio` tools. See [../adapters/codex/README.md](../adapters/codex/README.md).

### VS Code

```sh
node bin/subtext.js install-adapter --harness vscode --target ./subtext-vscode-adapter
```

Open the bundle as an extension project, press `F5` to launch the extension host, and run
`Subtext: Copy Enriched Prompt` (or insert / preview). Apply the generated `settings.generated.json`.
See [../adapters/vscode/README.md](../adapters/vscode/README.md).

---

## Where the transcript comes from

Subtext never replaces speech recognition. The words come from your platform's native voice model, OS
dictation, browser dictation, [whisper](WHISPER.md), or any host you choose; Subtext adds the meaning
and emotion layer beside them. See [NATURAL_SPEECH.md](NATURAL_SPEECH.md) and
[NATIVE_TRANSCRIPT_BRIDGE.md](NATIVE_TRANSCRIPT_BRIDGE.md) for the audio-plus-transcript path.

## Next steps

- [CONTRACT.md](CONTRACT.md) - the strict `vocalcontext/v1` schema your assistant reads
- [CALIBRATION.md](CALIBRATION.md) - personal baselines and named microphone profiles
- [UNIVERSAL_HANDOFF.md](UNIVERSAL_HANDOFF.md) - paste the enriched prompt into any text field
- [HARNESSES.md](HARNESSES.md) - the full integration catalog
