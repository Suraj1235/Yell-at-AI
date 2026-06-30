# Claude Code Adapter

Add the meaning/emotion layer to Claude Code. This adapter enriches an outgoing prompt with a
`vocalcontext/v1` block (emphasis, affect, flags) built from the audio of the turn, then hands the
enriched prompt to Claude. It ships as a `UserPromptSubmit`-style hook plus a Subtext skill that tells
Claude how to read the block.

## One-command setup

From a checkout of this repo, generate a self-contained bundle you can drop next to Claude Code:

```sh
node bin/subtext.js install-adapter --harness claude-code --target ./subtext-claude-adapter
```

That writes:

- `subtext-claude-adapter/adapters/claude-code/hooks/user-prompt-submit.mjs` - the hook
- `subtext-claude-adapter/adapters/claude-code/subtext-skill/SKILL.md` - the skill instructions
- `subtext-claude-adapter/adapters/claude-code/subtext.env.example` - a `SUBTEXT_CLI_PATH` line wired to this checkout

Point Claude Code's `UserPromptSubmit` hook at the copied `user-prompt-submit.mjs` and export the
`SUBTEXT_CLI_PATH` from `subtext.env.example`. The hook invokes the Subtext CLI rather than importing
repo source directly, so the bundle runs outside this checkout.

## How the CLI is resolved (cross-platform)

The hook spawns the CLI with Node's own binary (`process.execPath`) and resolves the script path with
`node:path`, so it works the same on Windows, macOS, and Linux - no shell, no `.cmd` lookup, no
hardcoded separators. Resolution order:

1. `SUBTEXT_CLI_PATH` if set (use this when the hook lives outside the repo).
2. Otherwise, `../../../bin/subtext.js` relative to the hook file (the in-repo default).

Set `SUBTEXT_CLI_PATH` to an absolute path. On macOS/Linux that looks like
`/Users/you/Yell-at-AI/bin/subtext.js`; on Windows, `C:\Users\you\Yell-at-AI\bin\subtext.js`.

## The contract the hook implements

1. get transcript text or a `subtext/transcript/v1` envelope from the host
2. get the matching audio path from the host or capture layer
3. call Subtext
4. replace the outgoing prompt with the rendered `vocalcontext/v1` block plus the transcript

The implementation is intentionally conservative because hook/plugin APIs change faster than the core
contract. Keep host-specific event parsing isolated in `hooks/user-prompt-submit.mjs`; that file is the
adapter boundary.

## Supported event fields

The hook passes events straight through when they do not carry both audio and transcript data. When
data is available, it accepts:

- `audioPath`, or the `SUBTEXT_AUDIO_PATH` environment variable
- `prompt` or `text` for plain transcript text
- `transcriptPath` / `transcriptFile` for a JSON transcript file
- `transcript` as a `subtext/transcript/v1` object
- `wordTimings`, `word_timestamps`, `wordTimestamps`, or `word_timings`
- `transcriptSource`, `transcriptConfidence`, and `language`

When structured transcript metadata or word/phone timings are present, the hook writes a temporary
transcript envelope and invokes:

```sh
node bin/subtext.js analyze --audio turn.wav --transcript transcript.json --format json
```

That preserves native voice-model source, confidence, language, word timestamps, and phone timestamps
before rendering the prompt.

The hook renders with `SUBTEXT_VERBOSITY=full` by default so the outgoing prompt includes transcript
provenance and alignment metadata. Set `SUBTEXT_VERBOSITY=subtle` when the host needs a smaller prompt.

## Fail-open behavior

If analysis fails for any reason, the hook fails open: it emits the original event with a
`subtext_error` field instead of blocking the user's prompt. A dropped microphone or missing binary
never costs you a turn.
