# Desktop shell contract

The desktop app has no frontend of its own. It runs the shared product shell,
`apps/shell/`, with `apps/shell/platform/platform.tauri.js` as its
`PlatformAdapter`. This file is the contract between the two: the Rust half of
the `PlatformAdapter` interface from `plans/2026-09-21-product-launch-design.md`
§3 (Move 2).

## 0. Where the frontend comes from

```jsonc
// apps/desktop/src-tauri/tauri.conf.json
"build": { "frontendDist": "gen/frontend" }
```

`src-tauri/build.rs` stages exactly two trees into `src-tauri/gen/frontend/`,
keeping their layout relative to `apps/`:

| Staged path | Source |
| --- | --- |
| `gen/frontend/shell/**` | `apps/shell/**` |
| `gen/frontend/web/vendor/**` | `apps/web/vendor/**` |

Why not `frontendDist: "../../"` (the `apps/` directory)? Tauri embeds every
file under `frontendDist` into the binary, and `apps/` contains this crate's own
`target/` directory. Why not `frontendDist: "../../shell"`? The shell imports
the engine as `../../web/vendor/index.browser.js`, which would resolve outside
the asset root. The stage keeps one source of truth for both: `gen/` is
gitignored, files are rewritten only when their bytes change, and files deleted
upstream are removed from the stage. Nothing is duplicated in git.

The build fails with a clear message if either source tree is missing, which is
why the `native-desktop` adapter bundle ships `apps/shell/**` and
`apps/web/vendor/**` alongside the crate.

Adapter selection needs no build step either: `apps/shell/platform/index.js`
loads `platform.tauri.js` when `window.__TAURI__` exists (`withGlobalTauri` is
on) and `platform.web.js` otherwise.

---

## 1. Windows

| Label | File | Shape | Notes |
| --- | --- | --- | --- |
| `main` | `shell/index.html` | 760×680, normal | The shell: dictate, history, settings, onboarding. May be hidden; the tray reopens it. |
| `pill` | `shell/pill.html` | 420×132 logical, frameless, transparent, always-on-top, `skipTaskbar`, **`focusable: false`**, click-through, hidden by default | The overlay. |

Both windows are declared in `tauri.conf.json` and listed in
`capabilities/default.json`.

The overlay window is larger than the pill (48px tall, 180-380px wide by state)
because the live prosody chips and the stop warning sit above it, exactly as in
the main window. It is transparent and click-through, so the spare area is
invisible and never takes a click. `shell/pill.html` carries the same pill
markup as `shell/index.html`, the same `shell.css`, and the same
`core/pill.js`; `core/overlay.js` only decides what drives it. A test asserts
the two pill blocks are byte-identical, so they cannot drift.

**The pill never takes focus.** It is created `focusable: false`, cursor events
are ignored (`set_ignore_cursor_events(true)`), and no code path calls
`set_focus` on it. That is what lets the user keep typing into the app
underneath. Nothing in `pill.html` or `core/overlay.js` asks for focus.

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
{ phase: "start" | "end" | "latch" | "cancel",
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
| Tap (<250 ms), later tap again | `start`/`pending` → `latch`/`toggle` → `end`/`toggle` |
| Esc during a turn | `start`/`pending` → `cancel` |

`latch` is emitted on the release of a tap: the turn stays open, Esc stays armed,
and the shell shows hands-free (and applies its quiet auto-stop).

`Esc` is registered globally **only while a turn is live**, and unregistered as
soon as it ends.

How the shell maps these (`core/app.js`): `start` begins a turn, or ends the
running one if a turn is already listening; `end` finishes; `latch` enters
hands-free; `cancel` cancels (nothing inserted, Undo offered).

### `subtext://pill` — frontend → the pill window

```ts
{ level?: number,        // 0..1 RMS of the latest audio frame
  levels?: number[],     // every frame's RMS since the last event (~50 ms),
                         // so the overlay draws the same bars as the main window
  live?: { chips: { type, z, evidence, provisional }[], tint: number | null },
  contract?: { flags: object[], emphasis: object[] },   // the final read's chips
  handsFree?: boolean,
  warning?: string | null }                             // the stop warning
```

The overlay's STATE comes only from `subtext://status`: Rust publishes
`Listening` on the key's press edge, and the shell reports every later state
through `subtext_status_set`.

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
makes the hotkey a pure event source. The shell does this in
`platform.tauri.js` `bindHotkey()`, after it has subscribed to
`subtext://hotkey`, so no press is lost between the two.

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

`engine` ids come from `src/transcribe/engines.js`. **Render the vendor badge
from the engine's `egress` field**, not from a hardcoded name. Note that the
CLI's `dictate --format json` currently reports `engine` as the id string
(`"whisper"`), not a descriptor object; the shell's `describeEngine()` accepts
either and, for an id, reads `egress` from the vendored copy of the same
registry. The desktop build offers only offline engines (`whisper`, `none`): a
cancelled turn is still transcribed locally so Undo can restore it, and that
must never send a cancelled recording to a vendor.

`subtext_transcribe` runs `dictate --audio`, which also analyses. The shell
uses only its `text` and `engine`: prosody is analysed **in the WebView** with
the vendored model-free engine (`platform.analyze`), the same code and the same
baseline as the web build, so there is one set of numbers on every surface and
no second Node start-up per turn. `subtext_analyze` remains available.

The WebView records at the device rate (usually 48 kHz). whisper.cpp only reads
16 kHz, so the adapter decimates to 16 kHz before encoding the WAV it stages.
The prosody engine reads the full-rate take.

`subtext_insert` writes the clipboard **first**, then synthesises the paste
keystroke (the same per-platform command as `src/handoff/paste.js`). If the
keystroke fails it still resolves, with `pasted: false` and a `detail` that says
the text is on the clipboard. **An insertion failure is never data loss** - do
not treat a falsy `pasted` as a thrown error. The shell maps it to
`{ ok: true, method: "clipboard" }`, labels the pill "Copied", and shows the
`detail` in a toast.

The shell passes `paste: false` when its own window has focus (a Copy button, a
turn dictated with Settings open), so it never synthesises Ctrl+V into itself.

### Foreground app (per-app insertion rule)

```ts
subtext_foreground_app() -> { title: string, process: string } | null
```

Windows: `GetForegroundWindow` + `GetWindowTextW` + the process image name
(`src-tauri/src/foreground.rs`). macOS and Linux return `null` for now
(documented hook: `NSWorkspace.frontmostApplication`, `_NET_ACTIVE_WINDOW`), and
the shell then applies its AI-app rule. The rule itself lives in the shell,
`core/targets.js`: two settings, *In AI apps* (default: full block) and
*Everywhere else* (default: plain text), each `block | text | ask`. `ask`
copies the block and pastes nothing. The overlay is `focusable: false`, so at
insertion time the foreground window is still the app the user was in.

### History

Local JSON file in the OS app-data directory, newest first, capped at 100.

The shell writes each turn twice - before insertion, so a failed insertion never
loses the words, and again with the outcome - so it uses `subtext_history_put`,
which replaces by `id` rather than appending a second entry. Settings and the
voice baseline stay in the WebView's IndexedDB (inside the app's data dir).

```ts
subtext_history_list({ request?: { limit?: number } }) -> HistoryEntry[]
subtext_history_append({ entry: NewHistoryEntry }) -> HistoryEntry
subtext_history_put({ entry: HistoryEntry }) -> HistoryEntry   // upsert by id
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
their state locally, so the three surfaces cannot disagree. The shell reports
every state change (`idle→ready`, `listening`, `thinking`, `inserted→delivered`,
`error→failed`), coalesced per tick so a synchronous listening→thinking hop never
flashes "Listening" without a microphone open.

`subtext_status_set` with `ready`, `delivered` or `failed` also **settles** a
tap-to-toggle turn back to idle. The shell can end a turn on its own (auto-stop
after quiet, a click on the pill), and without this the next press would read as
"end". A turn whose key is still physically held is left alone; its release
closes it.

---

## 4. What lives where

| Concern | Owner |
| --- | --- |
| Recording | Frontend (`getUserMedia` in the WebView). No ffmpeg, sox, or arecord. |
| WAV encoding | Frontend. 16-bit PCM mono. |
| Transcription | Node CLI, via `subtext_transcribe`. |
| Prosody analysis | The WebView, with the vendored engine (`platform.analyze`). Always local, always model-free. `subtext_analyze` stays available. |
| Prompt rendering | The WebView (`renderVocalContext`). `subtext_render` stays available. |
| Per-app insertion rule | The shell (`core/targets.js`), from `subtext_foreground_app`. |
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
- **Foreground app on macOS/Linux** returns `null`, so the AI-app rule applies
  everywhere there until those lookups land.
- **The overlay's position** is anchored to the cursor at each Listening and
  Thinking status; the caret position is not available cross-platform.
