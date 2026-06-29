# Harness Conformance

Harness conformance is the local proof that Subtext still does what Yell-at-AI promises when it is routed through different assistant surfaces.

Run:

```sh
npm run harness:conformance
node bin/subtext.js conformance --format text
```

The report uses `subtext/harness-conformance/v1` and verifies two things:

1. Natural-speech cues still produce the expected contract behavior.
2. Every top harness has a ready adapter policy for preserving that behavior.

## Required Natural-Speech Cues

The gate covers the three northstar cues:

| Cue | Expected Evidence | Expected Assistant Guidance |
| --- | --- | --- |
| `yelling` | high-intensity delivery flag and affect cue | `de_escalate/calm` |
| `emphasis` | stressed word evidence from the five word-level dimensions | `preserve_emphasis/focused` |
| `confusion` | confusion/question/hesitation evidence | `clarify/patient` |

For every cue, conformance checks:

- `schema="vocalcontext/v1"`
- expected flag and affect meaning cue
- expected `assistant_guidance.priority`
- expected response style and directive
- rendered `<vocal-context>` prompt includes guidance
- rendered prompt preserves the transcript text
- `word_features` contains duration frames, Log-F0 range, Log-F0 median, Log-F0 slope, and Log-energy

## Harness Policy

Every supported harness must have a conformance policy. The policy records:

- accepted inputs, such as audio path, base64 audio, host transcript command, or `subtext/transcript/v1`
- how the harness hands off the enriched prompt or contract
- fields the harness must preserve: `affect`, `assistant_guidance`, `flags`, `emphasis`, `transcript`, and `word_features`
- things the harness must not do: invent emotion labels, drop transcript provenance, or silently record audio

The current top-harness set is:

```text
cli, http, web-preview, desktop-capture, mcp, codex, claude-code,
realtime, vscode, hotkey, native-desktop, universal
```

## Adding A New Harness

To add a harness without weakening the product promise:

1. Add it to `adapters/harnesses.json`.
2. Add readiness checks in `src/harness/doctor.js`.
3. Add package files in `src/harness/bundles.js`.
4. Add a conformance policy in `src/harness/conformance.js`.
5. Add functional tests for install/package behavior.
6. Run `npm run readiness`.

If a harness cannot preserve `assistant_guidance`, flags, transcript provenance, and the rendered vocal-context block, it should not be marked ready.
