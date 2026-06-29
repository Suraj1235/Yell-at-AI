# Native Transcript Bridge

Subtext adds meaning and emotion from natural speech to the transcript your host already produces. The host platform, OS dictation, browser dictation, or native voice model should produce the transcript; Subtext records or receives the same audio turn locally, extracts prosody evidence, and attaches meaning and emotion context beside that text.

Use `subtext/transcript/v1` when an adapter can return structured transcript metadata:

```json
{
  "schema": "subtext/transcript/v1",
  "text": "can we just refactor the whole auth module",
  "source": "platform-native-voice",
  "confidence": 0.97,
  "language": "en",
  "wordTimings": [
    {
      "word": "can",
      "start": 0.0,
      "end": 0.22,
      "phones": [
        { "phone": "k", "start": 0.01, "end": 0.06 },
        { "phone": "ae", "start": 0.07, "end": 0.16 },
        { "phone": "n", "start": 0.17, "end": 0.22 }
      ]
    },
    { "word": "we", "start": 0.25, "end": 0.45 }
  ]
}
```

The schema lives at [schemas/transcript.v1.schema.json](../schemas/transcript.v1.schema.json).

## Required Fields

- `schema`: `subtext/transcript/v1`
- `text`: transcript text from the selected voice layer
- `source`: readable provenance, such as `platform-native-voice`, `browser-speech-recognition`, `browser-preview-manual`, `codex-voice`, `claude-code-voice`, or `os-dictation`

## Optional Fields

- `confidence`: host transcript confidence from 0 to 1
- `language`: BCP-47-ish language tag when available
- `wordTimings`: word-level timestamps in seconds
- `wordTimings[].phones`: optional phone/phoneme timestamps for the word, used for the duration prosody dimension when available

## Compatibility Aliases

The canonical field is `wordTimings`, but Subtext also accepts common provider shapes while normalizing:

- `wordTimings`, `word_timestamps`, `wordTimestamps`, `word_timings`, `words`, `segments`, or `tokens`
- word labels as `word`, `text`, `token`, `label`, `value`, or `punctuated_word`
- phone timing arrays as `phones`, `phonemes`, `phoneTimings`, `phone_timings`, `phoneTimestamps`, or `phone_timestamps`
- phone labels as `phone`, `phoneme`, `symbol`, `label`, `text`, or `token`
- seconds as `start`/`end`, `startSec`/`endSec`, `start_time`/`end_time`, or `startTime`/`endTime`
- milliseconds as `startMs`/`endMs`, `start_ms`/`end_ms`, `startMilliseconds`/`endMilliseconds`

If word timings are missing or cannot be matched, Subtext falls back to proportional alignment unless `--require-word-timings` is set.

If phone timings are present on a matched word, `word_features[].duration_frames` uses the average duration of those phones in analysis frames and emits `duration_source="platform_phone_timestamps"`. Without phone timings, Subtext falls back to estimated phone duration.

## CLI

```sh
node bin/subtext.js analyze \
  --audio turn.wav \
  --transcript native-transcript.json \
  --require-word-timings \
  --format prompt
```

For live natural-speech turns, transcript commands may print the same JSON:

```sh
node bin/subtext.js session \
  --duration 4 \
  --transcript-command "host-transcript --json {audio}" \
  --require-word-timings \
  --target paste
```

Plain text is still accepted, but it cannot provide source confidence, language, or native word timestamps.

## HTTP

```json
{
  "audioPath": "turn.wav",
  "transcript": {
    "schema": "subtext/transcript/v1",
    "text": "wait um i am not sure which auth flow broke?",
    "source": "browser-speech-recognition",
    "confidence": 0.91,
    "language": "en",
    "wordTimings": []
  }
}
```

## MCP

The `analyze_file` tool accepts the same `transcript` object with a local `audioPath`. The `analyze_audio` tool accepts the same transcript object with `audioBase64` or `audioDataUrl`, so MCP hosts can pass captured audio without coordinating a shared temporary file.

Adapters should pass the host transcript envelope directly and let Subtext derive `vocalcontext/v1`.

## Boundary

This is the differentiator boundary:

- the host voice model owns speech recognition
- Subtext owns local prosody evidence and `vocalcontext/v1`
- the assistant model owns reasoning and final response generation

Adapters should not invent emotion labels. They should pass transcript metadata, audio, and optional word timings, then follow `assistant_guidance` in the returned contract.
