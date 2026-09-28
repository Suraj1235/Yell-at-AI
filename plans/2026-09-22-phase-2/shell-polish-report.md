# Phase 2 — shell polish against the Wispr Flow reference

**Status: complete on `feat/phase-2-shell-polish` (worktree `.worktrees/shell-polish`). Not merged.**

Nine commits on top of `main` (7f41d8e). Only `apps/shell/**` and
`test/privacy-claims.test.js` are touched — `git diff main --name-only | grep -v
'^apps/shell/'` returns exactly one line, the test.

## Commits

| SHA | Subject |
| --- | --- |
| `c6826fb` | feat(shell): replace the raw block dump with an evidence card |
| `89be80b` | feat(shell): hands-free by double-tap or click, a start cue, and our own stage labels |
| `7176329` | feat(shell): cancelling leaves a way back — undo, or open history |
| `204584c` | feat(shell): stop by itself on quiet and at the cap, with a warning first |
| `e90addb` | feat(shell): history you can actually search, scan and repair |
| `07cd363` | feat(shell): onboarding that demonstrates instead of promising |
| `3025640` | test(privacy): put the shell's onboarding copy under the copy guard |
| `65b9dc8` | chore(shell): lift the specimen out of the grey, and report the start cue |
| `003659d` | fix(shell): let the toast be announced once, not twice |

## Tests

- `npm test` — **157 pass, 0 fail** (156 baseline + 1 new).
- `node --test test/privacy-claims.test.js` — **7 pass, 0 fail** (6 + 1 new).
  The guard was extended, never relaxed: nothing was removed from `BANNED` or
  `MUST_BE_COVERED`. `apps/shell/core/onboarding.js` is now swept, and a new
  test asserts the onboarding privacy claim is **built from the engine
  registry** rather than typed into the screen, and that onboarding does not
  state the offline claim unconditionally.

## How it was verified

Headless Chrome over CDP, `--use-fake-device-for-media-stream` with
`--use-file-for-fake-audio-capture` playing real audio into a real
`getUserMedia` stream; service worker bypassed so the files on disk are what
runs; focus emulation on so clipboard writes and `:focus-within` behave.
Onboarding is walked for real, so every reading below sits on a calibrated
personal baseline unless stated otherwise. Screenshots in
`C:\Users\suraj\AppData\Local\Temp\claude\D--Yell-at-AI\503a564c-10cd-4cf0-b002-04223f4d4d53\scratchpad\shot\`
(pill idle / listening / live-chips / hands-free / thinking / inserted / error /
warning, evidence card with and without flags, raw block, history, onboarding
mic + first turn, settings, badge in both states, phone width).

**0 console errors across every scenario.**

## The ten MATCH items

| # | Item | Before (at `main`) | After — observed |
| --- | --- | --- | --- |
| 1 | Double-tap → hands-free within 0.5 s | Absent. A **single** press under 350 ms latched, so a slip left the mic open | Double tap (70 ms + 170 ms gap) → `state=listening, handsFree=true, pill[data-mode=hands-free]`, announced "Hands-free. Press Ctrl + Alt + Y or click the pill to stop."; next press stops. A single tap is now a short turn |
| 2 | Click the pill to start / stop | Broken. A 60 ms click called start then stop before the mic opened; the pill stuck in `listening` until Escape (reproduced at `main`) | Click → `listening, handsFree=true`; second click → `idle, handsFree=false`. Every end-path now awaits the same start promise |
| 3 | Cancel → Undo / Open History | Absent. Esc dropped the samples and announced it | Esc → toast "Cancelled. Nothing was inserted." with **Undo** and **Open history**; history rows after cancel = **0**; Undo restored the take → real contract (`emphasis on "take", z 1.02`) → 1 history row |
| 4 | Start ping | Absent | `__shell.pingPlayed = true` (oscillator synthesised and started in-page, no asset); `pingAudible=false` under `prefers-reduced-motion: reduce` and when the new Start cue setting is off |
| 5 | Auto-stop, audio never discarded | Only a silent 120 s `setTimeout`. No warning, no silence stop | Quiet stop at **7.45 s** (4 s speech + 3 s quiet); no-audio stop at ~8 s with its own honest message; cap: warning at **104.4 s** ("Stopping in 15s — the words still land."), stop at **119.4 s**. Every stop exits through `finishTurn`, so the take is analysed; toasts say what became of it |
| 6 | History: dates, search, hover-copy, arrows, retry | Flat list, always-visible buttons, no search | Groups `Today / Yesterday / Friday 18 September`; search by word ("auth" → 2) **and by flag** ("urgency" → 1) with "1 of 4 turns match"; actions on hover/focus (always on touch); ↑↓/Home/End move focus, Enter copied "stop rewriting the whole auth module" to the real clipboard; a `delivered:false` turn shows "not copied" + **Retry**, which re-copied and cleared the mark |
| 7 | Stats in the history header | Absent | `25 words dictated · 4 turns · 2 with emphasis caught` |
| 8 | Onboarding: live bars, guided turn, per-step skip, permission recovery | Mic step opened and immediately closed a session; one global "Skip setup"; no recovery text; test step was prose | 18 bars fed by real RMS (13–14 moving, peak 1.0) and the CTA becomes Continue only after they move; three beats light `waiting → now → done` through a real turn, ending `read: emphasis on "simpler", z 1.03`; **Skip this step** on every step; a dismissed permission gets a named recovery path instead of a dead end |
| 9 | Pill visibility setting | Absent | `Always` / `Only while active`; set to active → `layer[data-visibility=active]`, idle pill `opacity: 0`, restored on `:focus-within` and for every non-idle state |
| 10 | Stage labels in our vocabulary | "Listening", "Reading the delivery", "Copied — paste it anywhere" | `Listening…` → `Reading delivery…` → `Copied` (web) / `Inserted` (focused-app), taken from `insert()`'s method. No "cleaning up" stage exists |

## The seven BETTER items

1. **Live prosody.** With a baseline calibrated on a flat stretch and a louder
   turn: at 5.3 s, still holding the key, `emphasis z 4.95 [provisional]` (dashed
   rail) and tint **1.000**. Cost **34–78 ms** per 1 s window against a 300 ms
   budget. The tint now also drives the pill's rim, which is what you see out of
   the corner of your eye.
2. **Evidence card.** The `<pre>` dump is gone from first position. The stressed
   word is marked **inside your sentence** with its z on it (`thing` / `z 1.11`,
   matching the block's `Emphasis: thing z=1.11`), located by matching the
   emphasis start time against `word_features` through the engine's own
   tokenizer. Chips carry z **and** conf. One guidance line. A provenance line
   that says *measured against you — 4 calibrated segments* and *word positions
   estimated from duration — confidence 0.55*. Raw block one click away
   (`aria-expanded` toggle, 13 lines).
3. **Badge.** Unchanged in substance, still first paint, still above `<main>`,
   verified in `vendor` and `none` states.
4. **No account, no cap.** In onboarding, derived from the engine registry. The
   brief's literal sentence ("nothing leaves your machine on the default
   engine") would be **false in this shell**, whose default engine is Web Speech;
   the rendered line keeps the shape and states the truth for the active engine,
   and the new test forbids the unconditional version.
5. **Verbatim.** Stated on the first-turn step and at the top of Settings.
6. **Calibration.** Now visible in the product, on the provenance line of every
   card.
7. **Lightweight.** Idle shell tab, one-tab browser, 12 s after load: **JS heap
   1.19 MB used / 3.0 MB reserved, 773 DOM nodes, 48 listeners**. Renderer RSS
   is not cleanly attributable headlessly (Chrome keeps several renderer
   processes: 40–97 MB each), so I am not claiming a process figure against
   Wispr's reported ~800 MB.

## Quality floor

360 px: `scrollWidth == clientWidth == 360`, no element past the right edge,
gutters measured at exactly **16 px** on the lede, the badge and the card; pill
331 px wide. Reduced motion: animations collapse to ~0 and the start cue goes
silent. Keyboard: focus visible, history fully operable, toast never times out
while focus is inside it. Zero runtime deps, no bundler, no CDN, strict CSP
unchanged; new modules (`evidence.js`, `ping.js`, `toast.js`) are precached and
the service worker version was bumped to `yell-shell-v2`.

## Partial, and known

- **`thinking` at full speed is unobservable headlessly.** The recogniser errors
  instantly with no speech service, so the settle window is ~0 ms. The screenshot
  was taken during a genuine 22-second take whose analysis is slow enough to
  photograph; the state and label are real, the duration is not representative.
- **Silence auto-stop applies in hands-free only.** Holding the key is a
  continuous statement of intent and cutting it off mid-pause would be a bug.
  The 120 s cap applies to both.
- **Undo holds the cancelled take in memory** until the toast dismisses or the
  next turn starts. The microphone is released in the same tick as the cancel;
  nothing is written to history or the clipboard.
- **Retry covers post-capture handover failures** (`delivered: false`), which on
  the web means a refused clipboard write. There is no re-transcription.

## How to run

```
npm run shell          # http://127.0.0.1:8123/apps/shell/index.html
npm test               # 157 pass
node --test test/privacy-claims.test.js
```

Serves from the repository root under the production CSP, because the shell
imports the engine vendored beside the landing page. No build step.
