# Benchmarking And Evaluation

Subtext tracks twelve harness paths in M0: CLI, HTTP, web preview, desktop capture, MCP, Codex, Claude Code, realtime steering, VS Code, hotkey bridge, native desktop scaffold, and universal handoff.

## Build Validation

```sh
npm run build
```

This verifies the package tarball includes the CLI, core, schema, docs, license files, and adapter templates.

## Golden Fixtures

```sh
npm test
```

Synthetic WAV fixtures cover:

- neutral delivery
- urgency
- yelling
- hesitation
- confusion
- word emphasis
- lexical/prosodic mismatch

These assert the contract contains expected evidence without claiming emotion certainty.

## Latency

```sh
npm run bench
```

The latency budget is p95 analysis under 300 ms on generated fixtures. This measures WAV parse plus DSP plus contract building.

## Adapter Smoke

```sh
npm run smoke
```

This checks the CLI and MCP-style JSON-RPC server surface, including the file-path and base64-audio MCP tools.

## Functional Adapter Tests

```sh
npm run test:functional
```

This launches the CLI, HTTP server, MCP server, Claude Code hook template, VS Code runner, native desktop scaffold checks, and Codex config example against generated fixtures. It validates the plugin boundaries without requiring host-app installation.

The functional suite also exercises host-provided word timestamps through CLI, HTTP, and MCP, including `analyze_audio`, so native voice-model alignment cannot regress to proportional guessing unnoticed.

## Harness Conformance

```sh
npm run harness:conformance
```

This verifies yelling, emphasis, and confusion cue behavior against the shared `vocalcontext/v1` contract, rendered prompt output, the five word-level prosody dimensions, and all 12 harness preservation policies.

## LLM-Judge Prompt Pack

```sh
npm run eval:judge
```

This generates `eval/llm-judge/out/prompt-pack.jsonl` with paired transcript-only and transcript-plus-context prompts. Use it against each target host model to test whether interpretation changes in the expected direction.

For an executable provider run:

```sh
npm run eval:judge:mock
OPENAI_API_KEY=... npm run eval:judge:openai -- --model gpt-4.1-mini --max-cases 5
```

The default check remains dry-run and no-network. Paid provider execution requires credentials, `--allow-paid`, and bounded `--max-cases` / `--max-output-tokens` settings.

## Future Real-World Eval

Synthetic fixtures prove mechanics. Before launch, add consented real-user dogfood clips with:

- transcript
- optional word timing
- edited/approved vocal-context block
- expected assistant behavior
- latency measurements on macOS, Windows, and Linux

## External Emotion Evidence

```sh
npm run external:emotion
```

This opt-in benchmark downloads 25 scripted, acted emotion clips from CREMA-D, RAVDESS, and Berlin EmoDB. It checks whether Subtext's prosody evidence is compatible with known labels, while explicitly avoiding an emotion-classifier claim.
