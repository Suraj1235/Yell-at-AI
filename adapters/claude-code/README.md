# Claude Code Adapter Template

This directory contains a hook template and a skill-style instruction file.

Install a concrete local Claude Code adapter bundle with:

```sh
node bin/subtext.js install-adapter --harness claude-code --target ./subtext-claude-adapter
```

The installer writes `subtext-claude-adapter/adapters/claude-code/subtext.env.example` with the `SUBTEXT_CLI_PATH` value needed by the copied hook. The hook invokes the Subtext CLI rather than importing repo source files directly, so it can run outside this checkout.

The current implementation is intentionally conservative because hook/plugin APIs change faster than the core contract. The important invariant is:

1. get transcript text or a `subtext/transcript/v1` envelope from the host
2. get the matching audio path from the host or capture layer
3. call Subtext
4. replace the outgoing prompt with the rendered `vocalcontext/v1` block plus the transcript

Use `hooks/user-prompt-submit.mjs` as the adapter boundary and keep host-specific event parsing isolated there.

## Supported Event Fields

The hook passes through events that do not include both audio and transcript data. When data is available, it accepts:

- `audioPath`, or `SUBTEXT_AUDIO_PATH`
- `prompt` or `text` for plain transcript text
- `transcriptPath` / `transcriptFile` for a JSON transcript file
- `transcript` as a `subtext/transcript/v1` object
- `wordTimings`, `word_timestamps`, `wordTimestamps`, or `word_timings`
- `transcriptSource`, `transcriptConfidence`, and `language`

When structured transcript metadata or word/phone timings are present, the hook writes a temporary transcript envelope and invokes:

```sh
node bin/subtext.js analyze --audio turn.wav --transcript transcript.json --format json
```

That preserves native voice-model source, confidence, language, word timestamps, and phone timestamps before rendering the prompt.

The hook renders with `SUBTEXT_VERBOSITY=full` by default so the outgoing prompt includes transcript provenance and alignment metadata. Set `SUBTEXT_VERBOSITY=subtle` only when the host needs a smaller prompt.

If analysis fails, the hook fails open: it emits the original event with `subtext_error` instead of blocking the user's prompt.
