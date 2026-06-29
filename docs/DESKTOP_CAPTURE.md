# Desktop Capture

`subtext capture` is the first local desktop microphone path outside the browser preview. It records a bounded WAV file locally, then can feed the same analyzer, renderer, and handoff pipeline used by CLI, HTTP, MCP, Codex, Claude Code, VS Code, and universal clipboard handoff.

`subtext session` is the natural-speech workflow layered on top of capture. It records a bounded turn, receives transcript text from the host/native voice layer, extracts meaning and emotion cues from the audio, and emits or pastes the enriched prompt.

## Record Only

```sh
node bin/subtext.js capture --duration 4 --audio-out turn.wav
```

This writes a WAV and returns a `subtext/capture/v1` report with the output path, duration, sample rate, recorder, and timestamps.

## Record And Analyze

```sh
node bin/subtext.js capture \
  --duration 4 \
  --audio-out turn.wav \
  --text "stop rewriting the whole auth module" \
  --format prompt \
  --verbosity full
```

With `--text` or `--transcript`, `capture` analyzes the recording and emits the normal `vocalcontext/v1` prompt or JSON result.

You can also let a platform-native transcript bridge provide the text:

```sh
node bin/subtext.js capture \
  --duration 4 \
  --audio-out turn.wav \
  --transcript-command "host-transcript {audio}" \
  --format prompt
```

The command can write either transcript text or a `subtext/transcript/v1` JSON transcript object to stdout. `{audio}` and `{audioPath}` are replaced with the recorded WAV path.

JSON transcript output may include:

- `schema`
- `text`
- `source`
- `confidence`
- `language`
- `wordTimings`

## Natural Speech Session

```sh
node bin/subtext.js session \
  --duration 4 \
  --audio-out turn.wav \
  --transcript-command "host-transcript {audio}" \
  --target stdout
```

If the host bridge emits JSON with `wordTimings`, add `--require-word-timings` when you want Subtext to fail instead of falling back to proportional alignment:

```sh
node bin/subtext.js session \
  --duration 4 \
  --transcript-command "host-transcript --json {audio}" \
  --require-word-timings \
  --target stdout
```

`session` is the clearest M0 version of the product promise:

- the host or OS voice layer owns speech-to-text
- Subtext owns local prosody analysis
- the output tells the assistant what the user likely meant and the emotional context in the natural speech

Use `--target paste` when you want to inject the enriched prompt into the active assistant window:

```sh
node bin/subtext.js session \
  --duration 4 \
  --transcript-command "host-transcript {audio}" \
  --target paste
```

For paths with spaces, keep the placeholder inside a single argument, for example `"host-transcript" "{audio}"`.

## Local Push-To-Talk Loop

`subtext ptt` repeats the session flow for a bounded number of turns. It is useful for terminal wrappers, demos, and paste-anywhere workflows where you want to speak several turns into the same assistant.

```sh
node bin/subtext.js ptt \
  --turns 3 \
  --duration 4 \
  --transcript-command "host-transcript --json {audio}" \
  --target paste
```

By default, each turn waits for Enter before recording. Automation wrappers can skip that wait:

```sh
node bin/subtext.js ptt \
  --turns 3 \
  --trigger none \
  --duration 4 \
  --audio-out "turn-{turn}.wav" \
  --transcript-command "host-transcript --json {audio}" \
  --format json
```

Template placeholders:

- `{audio}` in `--transcript-command`: the recorded WAV for the current turn
- `{turn}` in `--transcript-command`, `--audio-out`, or `--out`: the 1-based turn number

When using `--target file` with multiple turns, `--out` must contain `{turn}` so turns do not overwrite each other.

## Record And Handoff

```sh
node bin/subtext.js capture \
  --duration 4 \
  --audio-out turn.wav \
  --text "..." \
  --target paste
```

Supported targets match `handoff`:

- `clipboard`
- `paste`
- `stdout`
- `file`

When using `--target file`, `--out` is the prompt output path and `--audio-out` is the WAV path.

## Recorder Backends

On macOS, the default backend is `/usr/bin/afrecord`:

```sh
node bin/subtext.js capture --duration 4 --audio-out turn.wav
```

For Linux, Windows, CI, or custom recorders, provide a command template:

```sh
node bin/subtext.js capture \
  --duration 4 \
  --audio-out turn.wav \
  --record-command "ffmpeg -y -f avfoundation -i :0 -t {duration} -ar {sampleRate} -ac 1 {out}"
```

Template placeholders:

- `{out}`
- `{duration}`
- `{sampleRate}`
- `{device}`

The command is split into executable and arguments without shell expansion. If you need shell features, wrap them in your own script and call that script as the recorder command.

## Safety Boundary

These commands are bounded and explicit: they record only for the requested duration and write a visible local WAV path. With `--target paste`, they can invoke active-app insertion after copying the prompt. `ptt` is a terminal/wrapper-triggered loop. The Hammerspoon adapter can bind that loop to a local global hotkey, but it is still a user-installed automation template, not a signed background listener or native desktop app.

The northstar desktop product still needs:

- signed native app
- signed native global hotkey
- visible recording state
- OS-level device/profile switching
- richer accessibility insertion with user confirmation and preview
