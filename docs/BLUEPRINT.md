# Enhanced Blueprint

## Product Principle

Subtext helps AI understand what you mean and the emotion of your natural speech, not just the plain text transcript. The engine extracts lightweight vocal signals on-device and emits a versioned context block with meaning, affect, intent, and prosody cues. The host assistant performs the final reasoning.

Architecturally, Subtext is a natural-speech context layer with prosody style-token mechanics: deterministic local DSP turns tone, pacing, pauses, and emphasis into explicit tokens, while the platform's native voice model continues to handle transcription and the assistant model continues to handle reasoning.

That keeps the project small and portable:

- no bundled black-box emotion model
- no custom speech foundation model
- no GPU path
- no inference bill
- no extra API key
- no silent emotion logging
- host-native transcript boundary: Subtext enriches platform transcript text instead of replacing speech recognition
- one contract across Claude Code, Codex, IDEs, Realtime assistants, and universal dictation

## Gaps Closed From The Rough Plan

1. Emotion claims are downgraded to evidence claims. Flags say things like `urgency` because of "fast rate + high energy + few pauses"; they do not say the user is angry, sarcastic, or anxious.
2. The schema is the real product API. Adapters are disposable; `vocalcontext/v1` is stable and versioned.
3. Alignment confidence is explicit. M0 accepts platform word timestamps from native voice layers and falls back to proportional alignment when a host only provides transcript text. Future forced-alignment sources can swap in behind the same contract field.
4. Calibration is explicit. M0 can run with utterance-local baselines, rolling personal baseline updates, named profiles, and browser microphone-aware profile switching so naturally loud or fast speakers are not misread. M1 adds native device detection and global profile switching.
5. `subtext session` makes the differentiator executable: capture natural speech, receive transcript text from a host/native command, derive emotion and meaning cues from the audio, and hand the enriched prompt to the assistant.
6. `subtext/transcript/v1` makes the host-native transcript boundary explicit: host voice models provide transcript metadata and word timings, while Subtext provides local prosody-derived meaning and emotion context.
7. Benchmarks test the product claim, not just DSP math. The LLM-judge harness compares transcript-only interpretation against transcript plus vocal context.
8. Licensing is honest. "Free for individuals/students/research, paid for enterprise/profit" is source-available noncommercial, not OSI open source.

## Integration Tiers

| Tier | Platform exposes | Subtext behavior | Example |
| --- | --- | --- | --- |
| A, steer | Native audio-in LLM | Inject guidance and the output contract; no DSP required | Realtime audio assistants |
| B, enrich | STT to text | Capture audio in parallel, run DSP, align to transcript, prepend context | Codex/Claude Code style voice flows |
| C, own | Any text field | Own mic capture and inject enriched text through accessibility APIs | Universal fallback |

## Engine Scope

M0 extracts:

- RMS energy
- autocorrelation F0 estimate
- pitch range
- terminal pitch trend
- pause density
- speech rate
- approximate jitter/shimmer proxies
- per-word emphasis from duration frames, Log-F0 range, Log-F0 median, Log-F0 slope, and Log-energy
- platform phone timestamps for `duration_frames` when a native voice layer provides them, with estimated phone duration fallback otherwise
- grounded affect summaries for emotional coloring and meaning cues
- model-free flags for yelling, emphasis, confusion, urgency, hesitation, uncertainty, tension, and mismatch

M1 should port this contract-compatible reference core to Rust and add openSMILE/eGeMAPS parity tests.

## Non-Goals

- No opaque emotion classifier that hides evidence from the user or host assistant.
- No hidden recording.
- No default network egress from the engine.
- No STT replacement in M0.
- No medical, hiring, policing, or psychological assessment use.

## Release Gates

- Schema compatibility tests pass.
- Golden fixtures pass.
- CLI and MCP smoke tests pass.
- p95 analysis latency stays under 300 ms on fixtures.
- LLM-judge prompt pack generated for transcript-only vs vocal-context comparison.
- Docs state that natural-speech emotion and meaning are grounded in inspectable evidence.
