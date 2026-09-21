# Yell at AI — web surface

The public face of the product: a polished, no-backend, statically-deployable web app.
You speak, it streams a live transcript, and the **same `vocalcontext/v1` engine** that powers the
CLI and the editor adapters runs **entirely in your browser** to read *how* you said it — emphasis,
urgency, hesitation, uncertainty, intensity, and a grounded affect reading — then hands you an
enriched prompt to paste into any assistant.

It understands **how** you said it, not just **what** you said.

## What it does

1. `getUserMedia` + `MediaRecorder` capture a short take (up to 30s).
2. The Web Speech API (`window.SpeechRecognition || window.webkitSpeechRecognition`) streams a live
   transcript while you talk.
3. On stop, the recorded `Blob` is decoded with an `AudioContext` (`decodeAudioData`) to a
   `Float32Array` (channel 0) + `sampleRate`.
4. `analyzeSamples({ samples, sampleRate, text })` from the vendored browser core produces the
   `vocalcontext/v1` contract; `renderVocalContext` formats the full `<vocal-context>` block.
5. The page shows emphasis words, the affect reading, the evidence flags with confidence, the
   delivery summary, and the enriched prompt with a **Copy** button.

**Fallback:** if live transcription isn't available (e.g. Firefox), a textarea lets you type the
transcript and still get the prosody from your recording.

**Privacy:** capture, signal processing, and the `vocalcontext/v1` contract all happen in the
browser — there is no server behind this page and no upload of your recording. Transcription is the
exception: the Web Speech API is the browser's own recognizer, and in Chrome and Edge it sends your
audio to Google. The engine badge in the UI always names the active engine. For zero egress, use the
desktop app or type the transcript.

## Files

| File | Role |
| --- | --- |
| `index.html` | Landing section + the live tool, on one page. Loads `app.js` as a module. |
| `app.js` | Mic capture, live waveform scope, Web Speech transcript, decode → engine → render, copy. |
| `style.css` | Polished, responsive, dark theme. Fully self-contained — no CDNs, remote fonts, or remote assets (CSP-safe). |
| `vendor/` | The browser-safe core, vendored from `src/index.browser.js`. **Committed** so the site deploys with no build step. |
| `build.mjs` | Regenerates `vendor/` from the core. |
| `vercel.json` | Static hosting config (no build step; ships a strict CSP). |

## Run locally

`vendor/` is committed, so any static file server works — no build step, no dependencies.

```sh
# from the repo root
node apps/web/build.mjs          # optional: refresh vendor/ from src/

# serve apps/web with any static server, e.g. one of:
npx --yes serve apps/web         # then open the printed URL
python3 -m http.server -d apps/web 8080   # then open http://localhost:8080
```

Open the served URL (not the `file://` path) — microphone capture and ES module imports require an
`http(s)` origin. Live transcription works best in **Chrome** and **Edge**; everywhere else, type the
transcript and the delivery is still read from your recording.

## Regenerate the vendored core

`build.mjs` starts at `../../src/index.browser.js` and recursively copies **only its static import
targets** into `vendor/`, preserving each module's path layout relative to `src/` so the relative
imports keep resolving. It deliberately **ignores dynamic `import()`** targets — `analyzer.js` lazily
does `import("../audio/wav.js")`, which is Node-only and must never reach the browser. Any reachable
module that statically imports a Node builtin (only `audio/wav.js`, pulled in by
`calibration/baseline.js`) is replaced with a browser shim whose exports throw if ever called; the
client analyze path never calls them.

```sh
node apps/web/build.mjs
```

Commit the regenerated `vendor/` files alongside any core changes.

## Deploy

Static hosting. `vercel.json` sets `buildCommand: null` and `outputDirectory: "."`, so Vercel serves
`apps/web` directly. Point a Vercel project at this directory (root directory `apps/web`) and deploy —
no build step is needed because `vendor/` is committed. If you prefer Vercel to vendor on each deploy,
set the build command to `node build.mjs` instead.

Any other static host (GitHub Pages, Netlify, Cloudflare Pages, an S3 bucket) works the same way:
publish the contents of `apps/web` as-is.
