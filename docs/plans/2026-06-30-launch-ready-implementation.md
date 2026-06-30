# Yell-at-AI Launch-Ready Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Execution is orchestrated breadth-parallel via the Workflow tool (ultracode), with a verified Foundation phase before the surface fan-out.

**Goal:** Turn the Subtext reference engine into a launch-ready product across four surfaces (web demo + deploy, installable dev tool, native Windows PTT, offline whisper STT), starting with a cross-platform-green core.

**Architecture:** One pure-JS core (`src/`) reused everywhere. A thin Foundation phase fixes cross-platform breakage, splits a browser-safe entry, and adds a pluggable STT interface. Then four directory-disjoint surface agents build in parallel on the stable core. A final integration phase verifies, then we deploy + open a PR.

**Tech Stack:** Node ≥20 (zero runtime deps), `node --test`, Web Speech API + WebAudio (browser), Tauri/Rust (desktop), whisper.cpp (offline STT), Vercel (web deploy).

---

## Agent Ownership Matrix (collision avoidance)

| Agent | Owns (may edit) | Must NOT touch |
| --- | --- | --- |
| Foundation (F1–F3) | `test/*`, `scripts/build-check.mjs`, `src/contract/*`, `src/index.js`, `src/index.browser.js`, `src/transcribe/*` | surface dirs |
| S-WEB | `apps/web/**` only | everything else |
| S-DEV | `package.json`, `bin/**`, `adapters/{claude-code,codex,vscode}/**`, `README.md` | `apps/**`, `src/**` |
| S-NATIVE | `apps/desktop/**` only | everything else |
| S-WHISPER | `src/transcribe/whisper.js`, `scripts/whisper-*.mjs`, `docs/WHISPER*.md`, `test/transcribe.test.js` | `package.json`, surface dirs |

Rules for all surface agents: **do not run `npm test` / `npm run fixtures`** (fixture write race) and **do not run git**. Edit files only; report a summary. The main loop commits and runs the full suite once at the end.

---

## Phase 0 — Foundation (sequential, verified green before fan-out)

### Task F1: Cross-platform fixes

**Files:**
- Modify: `test/schema.test.js:31`
- Modify: `test/analyzer.test.js:7-43` (10 fixture paths)
- Modify: `scripts/build-check.mjs:84`
- Modify: `test/functional.test.js` (Hammerspoon path assertion near line 1027)

**Step 1 — fix the `.pathname` drive-doubling bug.** In `test/schema.test.js` and `test/analyzer.test.js`, the fixture paths use `new URL("../eval/fixtures/X.wav", import.meta.url).pathname`, which yields `/D:/...` on Windows and resolves to `D:\D:\...`. Replace with `fileURLToPath`:

```js
// top of file
import { fileURLToPath } from "node:url";
// each fixture path:
audio: fileURLToPath(new URL("../eval/fixtures/neutral.wav", import.meta.url)),
```
Apply to all 10 entries in `test/analyzer.test.js` and the one in `test/schema.test.js:31`.

**Step 2 — fix `spawn('npm')` ENOENT on Windows** in `scripts/build-check.mjs` `run()`:
```js
const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
```

**Step 3 — fix the Hammerspoon assertion** in `test/functional.test.js`: the generated Lua escapes `\` as `\\` on Windows, so a regex expecting single backslashes fails. Make the assertion path-separator agnostic (assert the generated config contains the basename `subtext.js` and the `ptt` invocation, rather than an OS-specific absolute path), or normalize both sides before matching.

**Step 4 — verify:** `node --test` → all tests that previously failed on Windows now pass; `node scripts/build-check.mjs` prints `"ok": true`. Expected: `# fail 0` on Windows and Linux.

### Task F2: Browser-safe core entry

**Files:**
- Modify: `src/contract/analyzer.js` (drop the top-level `readWavFile` import; make it lazy inside `analyzeFile`)
- Create: `src/index.browser.js`
- Create: `test/browser-entry.test.js`

**Rationale:** Verified by grep — `dsp/*`, `alignment/*`, `text/*`, `calibration/baseline.js`, `render/text.js` are all browser-pure. The ONLY non-browser import reachable from `analyzeSamples` is `readWavFile` (uses `node:fs`) imported at the top of `analyzer.js`. `analyzeSamples` never calls it.

**Step 1 —** make `analyzer.js` browser-safe with minimal churn. Four internal modules (`mcp.js`, `http.js`, `conformance.js`, `cli.js`) import `analyzeFile` directly from `analyzer.js`, so do NOT move it. Instead remove the top-level `import { readWavFile } from "../audio/wav.js";` and lazy-load it inside `analyzeFile`:
```js
export async function analyzeFile(audioPath, text, options = {}) {
  const { readWavFile } = await import("../audio/wav.js"); // lazy: keeps this module browser-safe
  const wav = await readWavFile(audioPath);
  return analyzeSamples({ samples: wav.samples, sampleRate: wav.sampleRate, text, baseline: options.baseline, options });
}
```
Now `analyzer.js` has no top-level `node:`-dependent import; `analyzeSamples` (browser path) never triggers the dynamic import. `src/index.js` and all internal importers stay unchanged.

**Step 2 —** create `src/index.browser.js`:
```js
// Browser-safe surface: pure DSP + analysis + render. No node: imports.
export { analyzeSamples } from "./contract/analyzer.js";
export { renderVocalContext } from "./render/text.js";
export { extractProsody } from "./dsp/features.js";
export { normalizeTranscriptEnvelope } from "./transcript/envelope.js";
```

**Step 3 — test** `test/browser-entry.test.js`: import `src/index.browser.js`, run `analyzeSamples` on a synthesized sine `Float32Array`, assert it returns `schema === "vocalcontext/v1"`. Also assert (static check) that none of the browser-entry's transitive deps import `node:` — e.g. read each imported file and assert no `node:` substring.

**Step 4 — verify:** `node --test test/browser-entry.test.js` passes; existing analyzer/CLI/HTTP tests still pass (public API preserved).

### Task F3: Pluggable STT interface

**Files:**
- Create: `src/transcribe/index.js`, `src/transcribe/command.js`, `src/transcribe/whisper.js` (stub for S-WHISPER to finish)
- Test: `test/transcribe.test.js` (mock adapter; S-WHISPER extends)

**Contract:** `async function transcribe(audio, { adapter, ...opts }) -> { text, source, language?, confidence?, words? }` matching the `subtext/transcript/v1` envelope. `audio` may be a file path (node adapters) or samples. Adapters registry: `command` (generalizes the existing `--transcript-command` logic in `src/cli.js`), `whisper` (shell out to a whisper.cpp binary; auto-detect; throw an actionable error if missing), and a documented `webspeech` contract that the browser implements.

**Step 1 —** factor the existing transcript-command execution out of `src/cli.js` into `src/transcribe/command.js` and call it from the CLI (no behavior change — existing `session`/`ptt` tests must still pass).
**Step 2 —** `src/transcribe/whisper.js`: detect a `whisper`/`whisper-cli`/`main` binary (env `SUBTEXT_WHISPER_BIN` override), run it on the WAV, parse output to `{ text, source: "whisper.cpp", words? }`; throw `whisper binary not found …` when absent.
**Step 3 —** `test/transcribe.test.js`: a mock adapter returns canned text; assert envelope shape; assert `whisper` adapter throws a clear error when the binary is absent.
**Step 4 — verify:** `node --test test/transcribe.test.js` passes; CLI session/ptt tests still pass.

**Foundation gate:** main loop runs the full suite (`npm run build && npm test && npm run smoke`) and confirms green on Windows before any surface work. Commit: `fix: cross-platform green + browser-safe core + pluggable STT`.

---

## Phase 1 — Surfaces (parallel fan-out, directory-disjoint)

### Task S-WEB (🟢 flagship): deployable web product
**Owns:** `apps/web/**`. **Files:** `apps/web/index.html`, `apps/web/app.js`, `apps/web/style.css`, `apps/web/landing.html` (or sections), `apps/web/vendor/` (copied browser-safe core), `apps/web/README.md`, `apps/web/vercel.json`.

**Build:** A static, no-backend app. (1) Landing section: the wedge ("understands *how* you said it"), a one-line pitch, a "Try it" CTA. (2) App: `getUserMedia` mic capture + `MediaRecorder`; **Web Speech API** (`webkitSpeechRecognition`) for the live transcript; on stop, decode the recorded blob via `AudioContext.decodeAudioData` → `getChannelData(0)` Float32Array + sampleRate → `analyzeSamples` (from the vendored `src/index.browser.js`) → `renderVocalContext` → show emphasis/affect/flags + the enriched `<vocal-context>` block with a **copy** button. (3) Fallback: if Web Speech is unavailable, show a textarea to type the transcript and still run prosody on the recording. Polished, responsive, dark UI; no external CDNs (CSP-safe, all assets local). Provide a small `apps/web/build.mjs` (or doc) that vendors the browser-safe core files into `apps/web/vendor/`. Add `vercel.json` for static hosting.

**Verify (agent):** open `apps/web/index.html` logic via a node smoke that imports the vendored core and runs `analyzeSamples` on a sine buffer; lint that no `node:`/external-URL references exist in `app.js`.

### Task S-DEV (🟢): installable dev tool + first-class adapters
**Owns:** `package.json`, `bin/**`, `adapters/{claude-code,codex,vscode}/**`, `README.md`.

**Build:** Ensure `npx yell-at-ai <cmd>` works (bin already maps `subtext`; add a `yell-at-ai` alias bin pointing at the same entry). Tighten `package.json` metadata (description, repository, homepage, bugs, keywords; keep zero deps). Polish the three adapters: clear one-command setup, correct relative paths, runnable hooks; ensure `adapters/claude-code/hooks/user-prompt-submit.mjs` resolves the CLI cross-platform. Rewrite the README top section for a product audience (what it is, 30-second try-it for web + CLI, install, the honest 🟢/🟡 status) and add a `docs/QUICKSTART.md`. Do not change DSP/analyzer behavior.

**Verify (agent):** `node bin/subtext.js doctor` reports adapters ready; `node bin/subtext.js analyze --audio eval/fixtures/emphasis.wav --text "ship the whole thing" --format prompt` renders a block; adapter file paths exist.

### Task S-NATIVE (🟡): native Windows push-to-talk (working dev build)
**Owns:** `apps/desktop/**`.

**Build:** Advance the Tauri/Rust scaffold to a working dev build: a global hotkey (e.g. `Ctrl+Alt+Y`) starts/stops a bounded capture; the captured WAV + transcript (via the STT interface, default `command`, optional `whisper`) is analyzed by the Node core invoked as a **sidecar** (`node bin/subtext.js analyze …`), and the enriched prompt is pasted into the active app (reuse `src/handoff/paste.js` patterns). Wire `tauri.conf.json`, `main.rs` (hotkey + sidecar invocation + paste), and a README with exact `tauri dev` run steps. Mark signed `.msi` distribution as a documented follow-up; do not attempt signing.

**Verify (agent):** `cargo check` in `apps/desktop/src-tauri` if a Rust toolchain is present (report toolchain absence honestly); `node scripts/validate-desktop-scaffold.mjs` passes; static review that the sidecar command + hotkey are wired.

### Task S-WHISPER (🟡): offline whisper.cpp STT
**Owns:** `src/transcribe/whisper.js`, `scripts/whisper-bootstrap.mjs`, `docs/WHISPER.md`, `test/transcribe.test.js` (whisper cases).

**Build:** Finish the `whisper` adapter from F3: robust binary discovery, model path via `SUBTEXT_WHISPER_MODEL`, parse text (and word timings if `--output-json`) into the envelope. Add `scripts/whisper-bootstrap.mjs` that prints/automates how to obtain a whisper.cpp binary + a small model (download optional, never bundled). Write `docs/WHISPER.md` (install, model choice, privacy: fully offline). Extend `test/transcribe.test.js` with whisper-adapter parsing tests using a fake binary/fixture output (no network, no real model).

**Verify (agent):** `node --test test/transcribe.test.js` passes; `node scripts/whisper-bootstrap.mjs --help` runs.

---

## Phase 2 — Integration, verification, deploy, PR (main loop)

1. Run the full suite once: `npm run build && npm test && npm run smoke && node bin/subtext.js doctor`. Confirm `# fail 0` on Windows.
2. Build/smoke the web app; confirm the vendored core runs client-side.
3. `cargo check` the desktop app if toolchain present (else note).
4. Update `README.md` status block to reflect reality (🟢 verified vs 🟡 foundation), no inflated claims.
5. Commit per surface (or grouped), then deploy `apps/web` to Vercel → capture the public URL → add it to the README.
6. Push `feat/launch-ready`; open a PR whose body states exactly what was verified vs. not, the new public URL, and the follow-ups (signing, binary bundling, `npm publish`).

## Verification Gates (must hold)
- Foundation: `# fail 0` on Windows + Linux before fan-out.
- No surface agent edits another's files; no concurrent suite runs.
- Final: full suite green; web app produces a contract client-side; PR is honest about 🟡 items.
