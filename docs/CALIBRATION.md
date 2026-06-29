# Personal Calibration

Subtext should not treat every naturally loud, fast, pausy, or expressive speaker as yelling, urgent, hesitant, or tense. Personal calibration creates a local `subtext/baseline/v1` profile from neutral speech and uses it to interpret later turns relative to that speaker.

## CLI

Create a baseline:

```sh
node bin/subtext.js calibrate \
  --audio neutral.wav \
  --text "this is my normal coding voice" \
  --out baseline.json
```

Use it:

```sh
node bin/subtext.js analyze \
  --audio turn.wav \
  --text "stop rewriting the whole auth module" \
  --baseline baseline.json \
  --format prompt
```

Update a baseline with another neutral sample:

```sh
node bin/subtext.js calibrate \
  --baseline baseline.json \
  --audio neutral-2.wav \
  --text "can we inspect the auth flow" \
  --out baseline.json
```

The update keeps the same `subtext/baseline/v1` shape, increments `samples`, preserves the original `createdAt`, writes `updatedAt`, and merges signal statistics with pooled variance. You do not need to keep old raw audio around.

## Named Profiles

Use named profiles when you switch microphones, rooms, or speaking setups:

```sh
node bin/subtext.js calibrate \
  --profile laptop-mic \
  --device built-in \
  --environment desk \
  --audio neutral.wav \
  --text "this is my normal coding voice"

node bin/subtext.js analyze \
  --profile laptop-mic \
  --audio turn.wav \
  --text "stop rewriting the whole auth module"
```

By default, profile baselines are stored in `.subtext/profiles.json`. Override that with:

```sh
node bin/subtext.js calibrate --profile studio-mic --profiles ./profiles.json --audio neutral.wav --text "normal voice"
```

Profile management:

```sh
node bin/subtext.js profile list
node bin/subtext.js profile show --name laptop-mic
node bin/subtext.js profile delete --name laptop-mic
```

The profile store uses `subtext/profile-store/v1`; each profile contains one ordinary `subtext/baseline/v1` object.

You can also pass a manifest:

```json
[
  { "audioPath": "neutral-1.wav", "text": "this is my normal voice" },
  { "audioPath": "neutral-2.wav", "text": "can we inspect the auth flow" }
]
```

```sh
node bin/subtext.js calibrate --manifest calibration.json --out baseline.json
```

## HTTP

Create a baseline from browser or app-captured WAV audio:

```http
POST /v1/calibrate
Content-Type: application/json

{
  "audioBase64": "...wav bytes...",
  "text": "this is my normal voice"
}
```

Update an existing baseline by passing it back:

```http
POST /v1/calibrate
Content-Type: application/json

{
  "audioBase64": "...wav bytes...",
  "text": "can we inspect the auth flow",
  "baseline": {
    "schema": "subtext/baseline/v1",
    "samples": 3,
    "energy": { "mean": 0.08, "stdev": 0.02 }
  }
}
```

The example baseline is abbreviated for readability. Send the full baseline object returned by a previous calibration response.

Use the returned baseline in:

- `POST /v1/analyze`
- `POST /v1/analyze-audio`

## Browser Preview

Run:

```sh
node bin/subtext.js serve
```

Open `http://127.0.0.1:8765`, record a normal neutral turn, then press **Calibrate**. The preview stores the baseline in browser `localStorage` and applies it to future analysis until you clear it.

Pressing **Calibrate** again updates the stored baseline instead of replacing it. That makes the preview useful for rolling calibration across normal coding sessions and microphone positions.

The preview also has a profile name field. Loading a different profile switches the stored baseline used for analysis and calibration.

When browser device enumeration is available, the preview can also switch profiles automatically based on the selected microphone. The device/profile mapping stays in browser `localStorage` alongside the profile baselines.

## What Calibration Changes

M0 calibration adjusts:

- energy classification
- fast/slow rate classification
- pause-density classification
- pitch-range classification
- voice-quality strain thresholds
- yelling thresholds
- sample-weighted rolling updates across sessions
- named profile storage for different microphones or environments

This helps suppress false urgency, yelling, hesitation, and tension for users whose normal coding voice is loud, quick, pausy, or pitch-expressive.

M0 still treats filled pauses and explicit confusion language as meaningful transcript evidence. It does not personalize lexical/prosodic mismatch rules yet.
