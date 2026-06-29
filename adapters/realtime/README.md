# Realtime Steering

For native audio-in models, Subtext does not need to run DSP by default. The model already receives acoustic information.

Use a session instruction like:

```text
When the user speaks, attend to vocal cues such as emphasis, pacing, pitch movement, pauses, and energy. Use those cues to understand the user's meaning and emotional coloring beyond the transcript. When helpful, produce or internally use a vocalcontext/v1-compatible summary with affect, assistant_guidance, emphasis, prosody, flags, and calibration fields. Follow assistant_guidance for response behavior, keep emotional interpretation grounded in observable evidence, and do not overstate low-confidence cues.
```

Tier A benchmarking should compare:

- native audio prompt without steering
- native audio prompt with steering
- transcript plus Subtext `vocalcontext/v1`

The goal is not to replace native audio perception. The goal is consistent behavior and a portable contract.
