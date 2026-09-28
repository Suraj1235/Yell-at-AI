# Phase 2 — apps/shell

**Status: complete on `feat/phase-2-shell` (worktree `.worktrees/shell`). Not merged.**

## Commits

| SHA | Subject |
| --- | --- |
| `867a1ae` | feat(shell): define the PlatformAdapter contract and implement it for the browser |
| `592bc83` | feat(shell): read prosody live on a rolling window and tint the waveform with it |
| `078fd35` | feat(shell): the pill, the hold-to-talk binding, history, settings and onboarding |
| `6642c70` | feat(shell): wire the app shell and ship it as an installable PWA |
| `56bc878` | chore(shell): serve the shell locally under the production CSP |
| `eba05a0` | test(privacy): put the product shell's engine badge under the copy guard |

`apps/web` is untouched (`git diff main --name-only | grep apps/web` → nothing).

## Tests

- `npm test` — **156 pass, 0 fail** (155 baseline + 1 new shell badge guard).
- `node --test test/privacy-claims.test.js` — **6 pass, 0 fail**. The guard was
  extended, never relaxed: `apps/shell/index.html`, `core/badge.js`,
  `core/settings.js` and `sw.js` are now swept, and a new test asserts the
  shell's badge sits above anything you can dictate into, is visible on first
  paint, names the vendor from the registry, is non-dismissible, and tells the
  truth in the engine-set-to-none state.

## Headless verification

Driven over CDP in headless Chrome with a real `getUserMedia` stream
(`--use-file-for-fake-audio-capture` playing a speech-shaped signal with a
periodic loud syllable). Every number below is observed, not asserted:

- boot clean, `body[data-ready]=true`, **0 console errors**
- badge on first paint: `egress="vendor"`, above `<main>`, "Transcription engine
  — Browser Web Speech API … sent to Google (Chrome/Edge) or Apple (Safari)"
- Ctrl+Alt+Y keydown → `pill[data-state="listening"]`; canvas 288×24 painting
  **558 px across 18 tints**; elapsed counting
- live read with a calibrated baseline: `liveEnabled=true`, **47.5 ms** per
  1 s window (budget 300 ms), peak tint **1.000**, chip
  `emphasis · z 5.46` with `data-provisional="true"`
- release → `thinking`; no recogniser in headless → typed fallback → real
  `vocalcontext/v1` block rendered, `inserted` state, 1 history row
- engine → none repaints badge to `egress="none"`, "No audio is sent to anyone
  for recognition."
- PWA: service worker **activated**, manifest `standalone`, 4 icons
- 360 px viewport: `scrollWidth == clientWidth`, no horizontal scroll

## Live vs stubbed

**Live (browser):** capture (AudioWorklet PCM, AGC/NS/AEC off), Web Speech
recognition, local `analyzeSamples`, clipboard insert, IndexedDB settings +
baseline + 100-turn history, pill state machine, live rolling prosody read,
tinted waveform, provisional chips, hold-to-talk + tap-latch + Esc + pointer
hold, engine badge, settings, four-screen onboarding with segmented
calibration, PWA with offline app shell.

**Stubbed:** `platform/platform.tauri.js` — all five methods throw
`"not yet wired"` and name the Rust call that replaces each.

**Deliberately not offered:** `whisper-wasm` and `cloud` engines are not in the
settings picker, because neither is wired and listing them would be a false
claim. Web `insert()` is clipboard-only; there is no focused-app insertion in a
browser.

**Live chips read delivery, not words.** Word-level attribution needs timings
the interim transcript does not carry, so a live chip says `emphasis z 1.4` and
the block written on release says `emphasis on "whole", z 1.23`. Live chips are
marked provisional (dashed rail); the block is the authority. Live reading was
**not** flicker-prone and did **not** need a post-hoc fallback — EMA smoothing,
a two-window streak requirement and a 900 ms hold were enough.

## Two bugs found and fixed while verifying

1. **Browser AGC fights the product.** Default `getUserMedia` runs automatic
   gain control, which normalises loudness — the exact signal being measured.
   Now disabled along with noise suppression and echo cancellation, with a
   fallback for browsers that refuse the constraints.
2. **Degenerate baselines produced nonsense evidence.** A baseline from one
   measurement has its spread clamped to a 0.001 floor, so the next loud
   syllable read `z 98.88`, and pause density near zero read `z 174`.
   `core/baseline.js` now measures calibration in segments, gates every
   baseline through `usableBaseline()`, and floors each measure on its own
   scale (relative for open-ended quantities, absolute for bounded ratios).

## How to run

```
npm run shell          # http://127.0.0.1:8123/apps/shell/index.html
```

Serves from the repository root under the production CSP. The root matters: the
shell imports the engine vendored beside the landing page
(`apps/web/vendor/index.browser.js`) via the single re-export in
`apps/shell/core/engine.js`, rather than keeping a second copy. Any static
server rooted at the repo works; there is no build step.
