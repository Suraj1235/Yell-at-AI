# Desktop shell contract

`apps/desktop/src/` is a **self-contained reference frontend**. It exists so the
native layer can be developed and verified on its own. The shared shell being
built at `apps/shell/` replaces it by pointing `frontendDist` at itself:

```jsonc
// apps/desktop/src-tauri/tauri.conf.json
"build": { "frontendDist": "../../shell" }
```

Nothing else has to change, provided the shell honours the contract below. This
file is the contract. It is the Rust half of the `PlatformAdapter` interface from
`plans/2026-09-21-product-launch-design.md` §3 (Move 2).

---

## 1. Windows

| Label | File | Shape | Notes |
| --- | --- | --- | --- |
| `main` | `index.html` | 760×680, normal | Settings, history, onboarding. May be hidden; the tray reopens it. |
| `pill` | `pill.html` | 180×48 logical, frameless, transparent, always-on-top, `skipTaskbar`, **`focusable: false`**, click-through, hidden by default | The overlay. |

Both windows are declared in `tauri.conf.json` and listed in
`capabilities/default.json`. A replacement frontend must ship **both**
`index.html` and `pill.html` at those paths, or change the window definitions.

**The pill never takes focus.** It is created `focusable: false`, cursor events
are ignored (`set_ignore_cursor_events(true)`), and no code path calls
`set_focus` on it. That is what lets the user keep typing into the app
underneath. Do not call `getCurrentWindow().setFocus()` from `pill.html`.

**Mic active implies pill visible.** Rust drives pill visibility from the turn
status (`status::set_status`), not from the frontend, so a frontend that forgets
to show the pill still cannot record invisibly. `Listening` and `Thinking` show
it; `Delivered` and `Failed` linger ~1.4s and then hide; `Ready` hides at once.

---

## 2. Events

All three are Tauri events. Payload keys are camelCase.

### `subtext://status` — Rust → everyone

```ts
{ status: "Ready" | "Listening" | "Thinking" | "Delivered" | "Failed",
  detail: string,
  seq: number }   // monotonic; drop out-of-order updates
```

### `subtext://hotkey` — Rust → everyone

The press-and-hold state machine. **This is what drives capture.**

```ts
{ phase: "start" | "end" | "cancel",
  mode: "pending" | "hold" | "toggle" | "cancel",
  turn: number,           // increments per turn
  accelerator: string,
  heldMs: number,
  at: number,             // unix ms
  claimed: boolean }      // true when the frontend owns capture
```

Sequences:

| Gesture | Events |
| --- | --- |
| Hold ≥250 ms, release | `start`/`pending` → `end`/`hold` |
| Tap (<250 ms), later tap again | `start`/`pending` → `end`/`toggle` |
| Esc during a turn | `start`/`pending` → `cancel` |

`Esc` is registered globally **only while a turn is live**, and unregistered as
soon as it ends.

### `subtext://pill` — frontend → the pill window

```ts
{ level?: number,     // 0..1, drives the waveform height
  flags?: string[],   // e.g. ["emphasis", "urgency"] - tints the waveform
  label?: string }
```

---

## 3. Commands

Every command that shells out is timeout-bounded; pass `timeoutMs` to override
the default. All arguments are passed as `invoke(name, { request: {...} })`
unless the signature below says otherwise.

### Turn ownership

```ts
subtext_hotkey_claim({ claimed: boolean }) -> HotkeyStatus
```

**Call this with `true` on boot if you will capture in the WebView.** Until you
do, the press edge runs the original Node CLI turn (`subtext ptt --target
paste`) itself, which is the behaviour the previous dev build shipped. Claiming
makes the hotkey a pure event source.

```ts
subtext_hotkey_status() -> HotkeyStatus
subtext_hotkey_set({ request: { accelerator: string } }) -> HotkeyStatus  // throws on OS refusal

type HotkeyStatus = {
  accelerator: string; registered: boolean; claimed: boolean;
  holdThresholdMs: number; defaultAccelerator: string;
}
```

`subtext_hotkey_set` rejects with a human-readable error when the OS refuses the
accelerator, and restores the previous binding so the app is never left mute.
Surface that error; never swallow it.

### Capture → analysis → insertion

```ts
subtext_stage_audio({ request: { bytes: number[], extension?: string } })
  -> { path: string, bytes: number }

subtext_transcribe({ request: {
  wavPath: string, engine?: string, provider?: string,
  verbosity?: string, timeoutMs?: number } })
  -> { text: string, engine: object, contract: object }

subtext_analyze({ request: {
  wavPath: string, text: string, verbosity?: string,
  profile?: string, baseline?: string, render?: boolean, timeoutMs?: number } })
  -> { contract: object, prompt: string | null, verbosity: string }

subtext_render({ request: { contract: object, verbosity?: string } }) -> string

subtext_insert({ request: {
  text: string, paste?: boolean, pasteCommand?: string, timeoutMs?: number } })
  -> { clipboard: boolean, pasted: boolean, detail: string }

subtext_discard_audio({ path: string }) -> boolean
```

`engine` ids come from `src/transcribe/engines.js` and the returned `engine`
object carries its `egress` field. **Render the vendor badge from that field**,
not from a hardcoded name.

`subtext_insert` writes the clipboard **first**, then synthesises the paste
keystroke (the same per-platform command as `src/handoff/paste.js`). If the
keystroke fails it still resolves, with `pasted: false` and a `detail` that says
the text is on the clipboard. **An insertion failure is never data loss** - do
not treat a falsy `pasted` as a thrown error.

### History

Local JSON file in the OS app-data directory, newest first, capped at 100.

```ts
subtext_history_list({ request?: { limit?: number } }) -> HistoryEntry[]
subtext_history_append({ entry: NewHistoryEntry }) -> HistoryEntry
subtext_history_delete({ id: string }) -> boolean
subtext_history_clear() -> number
subtext_history_path() -> string

type HistoryEntry = {
  id: string; at: number; text: string;
  prompt?: string; contract?: object; engine?: string;
  targetApp?: string; audioMs?: number; delivered: boolean;
}
```

### Overlay

```ts
subtext_pill_show({ request?: { anchor?: Anchor } })     -> Placement
subtext_pill_position({ request?: { anchor?: Anchor } }) -> Placement
subtext_pill_hide() -> void

type Anchor = { kind: "cursor" } | { kind: "bottomCenter" } | { kind: "point", x: number, y: number }
type Placement = { x: number; y: number; width: number; height: number; anchor: string }
```

`cursor` places the pill below the pointer, clamped to that monitor, flipping
above the pointer near the bottom edge.

### Status, config, autostart

```ts
subtext_status_set({ request: { status: "ready"|"listening"|"thinking"|"delivered"|"failed", detail?: string } })
subtext_load_config({ request: { path?: string } }) -> DesktopConfig
subtext_session({ request: {...} }) -> { ok, stdout, stderr }   // the original CLI-records path
subtext_autostart_status() -> boolean
subtext_autostart_set({ enabled: boolean }) -> boolean
```

Drive the tray and the pill through `subtext_status_set` rather than reproducing
their state locally, so the three surfaces cannot disagree.

---

## 4. What lives where

| Concern | Owner |
| --- | --- |
| Recording | Frontend (`getUserMedia` in the WebView). No ffmpeg, sox, or arecord. |
| WAV encoding | Frontend. 16-bit PCM mono. |
| Transcription | Node CLI, via `subtext_transcribe`. |
| Prosody analysis | Node CLI, via `subtext_analyze`. Always local, always model-free. |
| Prompt rendering | Node CLI, via `subtext_render` (or import `src/index.browser.js` and render in-page). |
| Insertion | Rust: clipboard plugin + a synthetic paste keystroke. |
| Global hotkey, overlay, tray, autostart, history | Rust. |

---

## 5. Known gaps

- **Node is not bundled.** Every analysis call shells out to `node` on `PATH`
  against this checkout's `bin/subtext.js`, resolved from `SUBTEXT_CLI_PATH` or
  the generated desktop config. Shipping Node/whisper as a true Tauri
  `externalBin` is a separate task.
- **History is a JSON file, not SQLite.** Same command surface either way.
- **No code signing.** `bundle.active` is `true` and builds are unsigned, so
  SmartScreen and Gatekeeper will warn. That is expected at this stage.
- **Mobile.** The crate has the `[lib]` target with `pub fn run()` that
  `tauri android init` / `tauri ios init` need. Those targets will additionally
  require moving `tauri-plugin-global-shortcut` and `tauri-plugin-autostart`
  under a `cfg(not(any(target_os = "android", target_os = "ios")))` dependency
  table and gating `mod hotkey` / `mod turn` behind `#[cfg(desktop)]`.
- **Per-app insertion rules** (full `<vocal-context>` for AI apps, plain text for
  Slack) are not implemented; `subtext_insert` inserts exactly what it is given,
  so the rule can live in the shell.
