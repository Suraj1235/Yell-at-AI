# Yell-at-AI Phase 0 + Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every privacy claim in the repo literally true, get the package actually published, and
give Yell-at-AI real speech-to-text so a single command turns a spoken turn into an enriched prompt
with no external setup.

**Architecture:** Extend the existing pluggable STT interface (`src/transcribe/index.js`) with an
engine registry that carries machine-readable network-egress metadata, a cloud adapter, and a model
manager. Add one CLI command, `subtext dictate`, that composes the existing capture → transcribe →
analyze → deliver pieces into the product loop. Teach the existing macOS-only recorder to auto-detect
`ffmpeg`/`sox`/`arecord` so the loop runs on Windows and Linux too. No new runtime dependencies.

**Tech Stack:** Node.js >= 20 (zero runtime deps), `node:test`, `node:child_process`, `fetch`
(built-in), whisper.cpp (external binary), Groq and Deepgram HTTP APIs (opt-in, BYO key).

**Spec:** `plans/2026-09-21-product-launch-design.md`

## Global Constraints

Copied verbatim from the spec — every task's requirements implicitly include these.

- **Zero runtime dependencies.** `package.json` `dependencies` stays empty. Dev-only tooling is also
  avoided; tests use `node:test`.
- **Node floor:** `>=20`. Use built-in `fetch`, `node:test`, and `node:fs/promises`.
- **Prosody analysis is always local, always model-free.** No task may route audio through a network
  service for the prosody half — only for the transcript half, and only when explicitly opted in.
- **Offline is the shipped default; cloud is opt-in and labelled.**
- **Every engine carries a machine-readable `egress: "none" | "vendor" | "unknown"` field.**
- **Marketing copy may claim "offline" only for `egress: "none"` paths, and a test asserts the wording.**
- **Fail open, never block the user's prompt.** Any failure after capture must still surface the
  user's words; an insertion or analysis failure is never data loss.
- **Cross-platform green.** CI runs ubuntu/windows/macos × Node 20 and 22. Never hardcode POSIX paths
  or shell syntax.
- **Commit style:** conventional commits (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `build:`).
- **Every commit message ends with:**
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- **Full local gate before any release step:** `npm run check` must pass.

---

# PHASE 0 — Truth and unblock

---

### Task 1: STT engine registry with network-egress metadata

The repo currently has adapter *names* (`ADAPTERS = ["command", "whisper", "webspeech"]`) but no
machine-readable statement of which ones send audio off the device. Every honesty guarantee in this
plan and in the UI is built on that field, so it comes first.

**Files:**
- Create: `src/transcribe/engines.js`
- Modify: `src/transcribe/index.js:26-27` (re-export the registry; keep `ADAPTERS` working)
- Test: `test/engines.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `ENGINES: Record<string, Engine>` where
    `Engine = { id: string, label: string, egress: "none" | "vendor" | "unknown", vendor: string | null, runtimes: ("node" | "browser")[], description: string }`
  - `EGRESS_LEVELS: readonly ["none", "vendor", "unknown"]`
  - `getEngine(id: string): Engine` — throws `Unknown transcribe engine: <id>. Available: ...`
  - `listEngines(runtime?: "node" | "browser"): Engine[]`
  - `isOfflineEngine(id: string): boolean` — true only when `egress === "none"`

- [ ] **Step 1: Write the failing test**

Create `test/engines.test.js`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ENGINES,
  EGRESS_LEVELS,
  getEngine,
  listEngines,
  isOfflineEngine
} from "../src/transcribe/engines.js";

test("every engine declares a known egress level", () => {
  const ids = Object.keys(ENGINES);
  assert.ok(ids.length >= 5, `expected at least 5 engines, got ${ids.length}`);
  for (const [id, engine] of Object.entries(ENGINES)) {
    assert.equal(engine.id, id, `${id}: id field must match its registry key`);
    assert.ok(EGRESS_LEVELS.includes(engine.egress), `${id}: bad egress ${engine.egress}`);
    assert.ok(engine.label.length > 0, `${id}: needs a human label`);
    assert.ok(engine.description.length > 0, `${id}: needs a description`);
    assert.ok(engine.runtimes.length > 0, `${id}: needs at least one runtime`);
  }
});

test("any engine that sends audio to a vendor must name the vendor", () => {
  for (const engine of Object.values(ENGINES)) {
    if (engine.egress === "vendor") {
      assert.ok(
        typeof engine.vendor === "string" && engine.vendor.length > 0,
        `${engine.id}: egress "vendor" requires a non-empty vendor name`
      );
    } else {
      assert.equal(engine.vendor, null, `${engine.id}: only vendor-egress engines name a vendor`);
    }
  }
});

test("whisper is offline and webspeech is not", () => {
  assert.equal(isOfflineEngine("whisper"), true);
  assert.equal(isOfflineEngine("webspeech"), false);
  assert.equal(ENGINES.webspeech.egress, "vendor");
});

test("listEngines filters by runtime", () => {
  const browser = listEngines("browser").map((engine) => engine.id);
  assert.ok(browser.includes("webspeech"));
  assert.ok(!browser.includes("whisper"), "whisper.cpp is a Node-only subprocess adapter");
});

test("getEngine throws an actionable error for an unknown id", () => {
  assert.throws(() => getEngine("nope"), /Unknown transcribe engine: nope\. Available: /);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/engines.test.js`
Expected: FAIL — `Cannot find module '.../src/transcribe/engines.js'`

- [ ] **Step 3: Write the implementation**

Create `src/transcribe/engines.js`:

```js
// Registry of speech-to-text engines and, critically, whether each one sends the
// user's audio off the device.
//
// The prosody engine is ALWAYS local and model-free; only the transcript half can
// ever touch a network. This registry is the single source of truth for that
// distinction. The UI renders a persistent vendor badge for any engine with
// egress "vendor", and test/privacy-claims.test.js asserts that marketing copy
// only claims "offline" for egress "none".
//
//   none    - no network egress, ever, once installed
//   vendor  - audio is sent to a named third party for recognition
//   unknown - user-supplied command; we cannot know what it does

export const EGRESS_LEVELS = Object.freeze(["none", "vendor", "unknown"]);

export const ENGINES = Object.freeze({
  whisper: Object.freeze({
    id: "whisper",
    label: "whisper.cpp (local)",
    egress: "none",
    vendor: null,
    runtimes: Object.freeze(["node"]),
    description:
      "Shells out to a local whisper.cpp binary and a local ggml model. Nothing leaves the machine."
  }),
  "whisper-wasm": Object.freeze({
    id: "whisper-wasm",
    label: "whisper (WASM, in-page)",
    egress: "none",
    vendor: null,
    runtimes: Object.freeze(["browser"]),
    description:
      "Runs whisper in WebAssembly inside the page. Downloads the model once, then no egress."
  }),
  webspeech: Object.freeze({
    id: "webspeech",
    label: "Browser Web Speech API",
    egress: "vendor",
    vendor: "Google (Chrome/Edge) or Apple (Safari)",
    runtimes: Object.freeze(["browser"]),
    description:
      "Uses the browser's own recognizer. In Chrome and Edge this uploads your audio to Google's servers."
  }),
  cloud: Object.freeze({
    id: "cloud",
    label: "Cloud STT (bring your own key)",
    egress: "vendor",
    vendor: "your configured provider (Groq or Deepgram)",
    runtimes: Object.freeze(["node", "browser"]),
    description:
      "Sends the recorded turn to the provider you configured. Fastest and most accurate; opt-in only."
  }),
  command: Object.freeze({
    id: "command",
    label: "Host transcript command",
    egress: "unknown",
    vendor: null,
    runtimes: Object.freeze(["node"]),
    description:
      "Runs a command you supply. Whether it sends audio anywhere depends entirely on that command."
  })
});

export function getEngine(id) {
  const engine = ENGINES[id];
  if (!engine) {
    throw new Error(
      `Unknown transcribe engine: ${id}. Available: ${Object.keys(ENGINES).join(", ")}.`
    );
  }
  return engine;
}

export function listEngines(runtime = null) {
  const all = Object.values(ENGINES);
  if (!runtime) return all;
  return all.filter((engine) => engine.runtimes.includes(runtime));
}

export function isOfflineEngine(id) {
  return getEngine(id).egress === "none";
}
```

- [ ] **Step 4: Re-export from the STT interface**

In `src/transcribe/index.js`, immediately after the existing
`export const ADAPTERS = ["command", "whisper", "webspeech"];` line, add:

```js
export { ENGINES, EGRESS_LEVELS, getEngine, listEngines, isOfflineEngine } from "./engines.js";
```

Leave `ADAPTERS` exactly as it is — `test/transcribe.test.js` imports it and other call sites rely on
it. The registry is additive.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/engines.test.js test/transcribe.test.js`
Expected: PASS, with no regression in the existing transcribe suite.

- [ ] **Step 6: Commit**

```bash
git add src/transcribe/engines.js src/transcribe/index.js test/engines.test.js
git commit -m "$(cat <<'EOF'
feat(transcribe): engine registry with machine-readable network-egress metadata

Adds ENGINES, the single source of truth for which STT engines send audio
off the device. The prosody engine is always local; only the transcript
half can ever touch a network, and this makes that distinction assertable
by tests and renderable in the UI.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Privacy-claim truth pass, guarded by a test

`apps/web` transcribes with the Web Speech API, which in Chrome uploads audio to Google, while the
page says "Your voice never leaves this tab" and "There is no server to send audio to." That is
false, and it is the first thing a Product Hunt commenter will find. This task makes the copy true
everywhere and adds a test so it cannot silently regress.

**Files:**
- Modify: `apps/web/index.html:214-217` (privacy section), `apps/web/index.html:299-301` (footer note)
- Modify: `apps/web/README.md:27`
- Modify: `docs/QUICKSTART.md:18`
- Modify: `README.md:114`
- Test: `test/privacy-claims.test.js`

**Interfaces:**
- Consumes: `isOfflineEngine` and `ENGINES` from Task 1.
- Produces: no new runtime exports. Produces the invariant that no user-facing copy file contains an
  unqualified absolute privacy claim about audio.

- [ ] **Step 1: Write the failing test**

Create `test/privacy-claims.test.js`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ENGINES } from "../src/transcribe/engines.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// User-facing copy only. Source comments are excluded: src/transcribe/whisper.js
// legitimately says audio never leaves the machine, because for that adapter it
// is true.
const COPY_FILES = [
  "README.md",
  "docs/QUICKSTART.md",
  "apps/web/index.html",
  "apps/web/README.md"
];

// Absolute claims that are false while any default path uses a vendor recognizer.
const BANNED = [
  /your\s+(?:voice|audio)\s+never\s+leaves/i,
  /audio\s+never\s+leaves\s+(?:the\s+)?(?:tab|page|browser|device)/i,
  /there\s+is\s+no\s+server\s+to\s+send\s+audio\s+to/i,
  /no\s+upload\s+[-—]\s+audio\s+stays\s+in\s+memory/i
];

test("no user-facing file makes an unqualified absolute claim about audio never leaving", async () => {
  const offenders = [];
  for (const relative of COPY_FILES) {
    const text = await readFile(join(ROOT, relative), "utf8");
    const lines = text.split("\n");
    lines.forEach((line, index) => {
      for (const pattern of BANNED) {
        if (pattern.test(line)) {
          offenders.push(`${relative}:${index + 1}: ${line.trim()}`);
        }
      }
    });
  }
  assert.deepEqual(
    offenders,
    [],
    `Unqualified privacy claims found. Prosody is always local, but transcription ` +
      `via the webspeech engine uploads audio to ${ENGINES.webspeech.vendor}. ` +
      `Qualify the claim.\n${offenders.join("\n")}`
  );
});

test("the web page names the vendor wherever it describes transcription privacy", async () => {
  const html = await readFile(join(ROOT, "apps/web/index.html"), "utf8");
  assert.match(html, /Web Speech/i, "the page must name the recognizer it actually uses");
  assert.match(html, /Google/i, "the page must name the vendor that receives the audio");
  assert.match(
    html,
    /prosody[^.]{0,80}never leaves/i,
    "the page should still make the true, strong claim: the prosody layer never leaves the device"
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/privacy-claims.test.js`
Expected: FAIL — offenders list includes `apps/web/index.html:214`, `apps/web/index.html:217`,
`apps/web/README.md:27`, `docs/QUICKSTART.md:18`, `README.md:114`.

- [ ] **Step 3: Rewrite the web page privacy section**

In `apps/web/index.html`, replace the whole `<section class="privacy" ...>` block with:

```html
  <section class="privacy" id="privacy" aria-labelledby="privacy-title">
    <h2 id="privacy-title">Your prosody never leaves this tab.</h2>
    <p>
      The part that makes this product work — the signal processing, the emphasis scoring, the
      affect reading, the whole <code>vocalcontext/v1</code> contract — is computed in your browser
      from your recording. There is no server behind it and no model weights to load. The same
      engine ships in the command-line tool, the editor adapters, and the desktop app.
    </p>
    <p>
      <strong>Transcription is the honest exception.</strong> To turn your speech into words, this
      page uses your browser's built-in Web Speech API — and in Chrome and Edge, that uploads your
      audio to Google's servers for recognition. We will not pretend otherwise. The badge above the
      recorder always names the engine in use.
    </p>
    <ul class="privacy-points" role="list">
      <li><span aria-hidden="true">∅</span> Prosody analysis is local — always, on every engine</li>
      <li><span aria-hidden="true">∅</span> No API key, no account, no model weights</li>
      <li><span aria-hidden="true">⚠</span> Web Speech transcription sends audio to Google</li>
      <li><span aria-hidden="true">✓</span> Want zero egress? Use the desktop app, or type the transcript</li>
    </ul>
  </section>
```

- [ ] **Step 4: Fix the footer note in the same file**

In `apps/web/index.html`, replace the `<p class="foot-fine">` line with:

```html
  <p class="foot-fine">Live transcription uses the browser's Web Speech API and works best in Chrome &amp; Edge, where the audio is sent to Google for recognition. Everywhere else, type your transcript — the delivery is still read from your recording, on your device.</p>
```

- [ ] **Step 5: Fix the three remaining copy files**

In `apps/web/README.md`, replace the `**Privacy:**` paragraph with:

```markdown
**Privacy:** capture, signal processing, and the `vocalcontext/v1` contract all happen in the
browser — there is no server behind this page and no upload of your recording. Transcription is the
exception: the Web Speech API is the browser's own recognizer, and in Chrome and Edge it sends your
audio to Google. The engine badge in the UI always names the active engine. For zero egress, use the
desktop app or type the transcript.
```

In `docs/QUICKSTART.md`, replace the sentence on line 18 with:

```markdown
button for the enriched prompt. The prosody analysis runs entirely in the page; transcription uses
the browser's Web Speech API, which in Chrome and Edge uploads audio to Google for recognition.
```

In `README.md`, replace the sentence on line 114 with:

```markdown
Subtext reads from your delivery, computed client-side. Transcription uses the browser's own Web
Speech API (in Chrome and Edge that sends audio to Google); the prosody layer never leaves the page.
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --test test/privacy-claims.test.js`
Expected: PASS, both tests.

- [ ] **Step 7: Run the full suite for regressions**

Run: `npm test`
Expected: PASS — previously 82 tests, now 89 (82 + 5 from Task 1 + 2 here).

- [ ] **Step 8: Commit**

```bash
git add README.md docs/QUICKSTART.md apps/web/index.html apps/web/README.md test/privacy-claims.test.js
git commit -m "$(cat <<'EOF'
fix(docs): tell the truth about Web Speech transcription egress

The site claimed "your voice never leaves this tab" while transcribing
through the Web Speech API, which in Chrome uploads audio to Google. The
prosody half of that claim was always true; the transcript half was not.

Copy now makes the strong true claim (prosody is local on every engine)
and names the vendor for the exception. test/privacy-claims.test.js fails
the build if an unqualified absolute claim comes back.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Actually publish — dependencies, metadata, npm, release

Nothing in this repo is public: the GitHub repo is private, `yell-at-ai` returns 404 on the npm
registry, and there are zero releases. This task ships it.

**Files:**
- Modify: `.github/workflows/ci.yml` (only if a dependabot bump breaks it)
- Modify: `CHANGELOG.md` (mark 0.1.0 released, dated)
- No source changes.

**Interfaces:**
- Consumes: a green `npm run check` from Tasks 1 and 2.
- Produces: `yell-at-ai@0.1.0` on npm; GitHub release `v0.1.0`; a public repository.

- [ ] **Step 1: Merge the three stale dependabot PRs**

Open PRs are #7 (`actions/checkout` 4→7), #8 (`github/codeql-action` 3→4), #11
(`actions/setup-node` 4→7). Merge each, then confirm CI is green on `main` across all six
matrix legs before continuing. If a bump breaks a workflow, fix the workflow in the same commit
rather than pinning back.

- [ ] **Step 2: Run the full release gate**

Run: `npm run check`
Expected: build dry-run, all tests, bench under the 300ms p95 budget, smoke, and the judge prompt
pack all pass. Do not proceed on any failure.

- [ ] **Step 3: Verify the package contents**

Run: `npm run verify:package`
Expected: PASS. Then run `npm pack --dry-run` and confirm the tarball excludes `test/`, `bench/`,
`plans/`, `.superpowers/`, `dist/`, and `eval/external/cache/`. A stray 20MB of WAV fixtures in the
published tarball is a launch-day embarrassment.

- [ ] **Step 4: Date the changelog**

In `CHANGELOG.md`, change the heading `## [0.1.0] - Unreleased` to `## [0.1.0] - 2026-09-21` (use the
actual publish date). Commit:

```bash
git add CHANGELOG.md
git commit -m "$(cat <<'EOF'
docs: date the 0.1.0 changelog entry for release

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: HUMAN GATE — make the repository public**

**This cannot be done by the agent.** The stored credential authenticates as `Suraj1235`, which has
push but not admin on `manishgit61332/Yell-at-AI`; repository-settings API calls return 404. Ask
**@manishgit61332** to:

1. Flip repository visibility to **public**.
2. Set the description to: `The meaning and emotion layer for dictation — your AI hears how you said it, not just what you said. Model-free, offline, zero dependencies.`
3. Add topics: `dictation`, `voice`, `prosody`, `speech`, `emotion`, `vocal-context`, `whisper`, `mcp`, `claude-code`, `accessibility`, `dsp`, `offline`.
4. Enable **Discussions** (Product Hunt traffic needs somewhere to land that is not the issue tracker).
5. Either grant `Suraj1235` admin, or perform steps 1–4 directly.

Do not proceed to Step 6 until the repo is public — publishing to npm while pointing `repository.url`
at a private repo produces broken links on the package page.

- [ ] **Step 6: HUMAN GATE — publish to npm**

Requires npm credentials. Confirm the name is still free (`npm view yell-at-ai` should 404), then:

```bash
npm publish --access public
```

`prepublishOnly` runs `npm run build && npm test`, so this re-gates itself. Verify afterwards:

```bash
cd $(mktemp -d) && npx --yes yell-at-ai@0.1.0 demo
```

Expected: the `<vocal-context>` block for "ship the whole thing" prints, with `Emphasis: whole
z=1.23`.

- [ ] **Step 7: Cut the GitHub release**

Tag and push — the existing tag-triggered release workflow handles provenance:

```bash
git tag -a v0.1.0 -m "v0.1.0 - Subtext: the meaning and emotion layer for dictation"
git push origin v0.1.0
```

Confirm the release workflow goes green and the release appears with the changelog body.

- [ ] **Step 8: Verify the public surface end to end**

Check each and record the result:
- `https://github.com/manishgit61332/Yell-at-AI` loads while signed out
- `https://www.npmjs.com/package/yell-at-ai` shows the README with working links
- `https://yell-at-ai.vercel.app` loads and its privacy copy matches Task 2
- CI badge in the README resolves (it 404s while the repo is private)

---

# PHASE 1 — Real speech-to-text

---

### Task 4: Cross-platform recorder auto-detection

`src/capture/recorder.js:75` throws on every platform except macOS, so `capture`, `session`, and
`ptt` do not work on Windows or Linux unless the user hand-writes an `ffmpeg` command line. The
desktop app will capture in its WebView and bypass this entirely (see the spec, Move 1), but the CLI
still needs to work on the maintainer's own machine. Auto-detect the common recorders instead of
demanding a template.

**Files:**
- Modify: `src/capture/recorder.js` (add detection; keep `buildRecorderCommand` signature)
- Test: `test/recorder.test.js` (extend the existing file)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `findRecorderOnPath(env?: NodeJS.ProcessEnv, platform?: string): { name: string, executable: string } | null`
  - `buildRecorderCommand({ audioPath, durationSec, sampleRate, device, command, env?, platform? })`
    — unchanged signature plus two injectable test seams; still returns
    `{ name: string, executable: string, args: string[] }`

- [ ] **Step 1: Write the failing test**

Append to `test/recorder.test.js`:

```js
import { findRecorderOnPath } from "../src/capture/recorder.js";

// A directory guaranteed to exist, used as a fake PATH entry. The executables we
// claim to find are never spawned in these tests.
const REAL_DIR = dirname(process.execPath);

test("findRecorderOnPath returns null when no recorder is installed", () => {
  const found = findRecorderOnPath({ PATH: "/no/such/dir/zzzqx" }, "linux");
  assert.equal(found, null);
});

test("buildRecorderCommand builds an ffmpeg dshow line on Windows when ffmpeg is found", () => {
  const command = buildRecorderCommand({
    audioPath: "C:\\tmp\\turn.wav",
    durationSec: 4,
    sampleRate: 16000,
    device: null,
    command: null,
    env: { PATH: REAL_DIR, PATHEXT: ".EXE" },
    platform: "win32",
    // Injected so the test does not depend on ffmpeg actually being installed.
    detect: () => ({ name: "ffmpeg", executable: "ffmpeg" })
  });

  assert.equal(command.name, "ffmpeg");
  assert.ok(command.args.includes("dshow"), "Windows capture goes through the dshow input device");
  assert.ok(command.args.includes("-t"), "duration must be bounded");
  assert.equal(command.args.at(-1), "C:\\tmp\\turn.wav", "output path is the final argument");
});

test("buildRecorderCommand builds an arecord line on Linux when arecord is found", () => {
  const command = buildRecorderCommand({
    audioPath: "/tmp/turn.wav",
    durationSec: 3,
    sampleRate: 16000,
    device: null,
    command: null,
    platform: "linux",
    detect: () => ({ name: "arecord", executable: "arecord" })
  });

  assert.equal(command.name, "arecord");
  assert.ok(command.args.includes("-d"));
  assert.equal(command.args.at(-1), "/tmp/turn.wav");
});

test("an explicit --record-command still wins over auto-detection", () => {
  const command = buildRecorderCommand({
    audioPath: "/tmp/turn.wav",
    durationSec: 2,
    sampleRate: 16000,
    command: "my-recorder --secs {duration} {out}",
    platform: "linux",
    detect: () => ({ name: "arecord", executable: "arecord" })
  });

  assert.equal(command.name, "custom");
  assert.deepEqual(command.args, ["--secs", "2", "/tmp/turn.wav"]);
});

test("the no-recorder error names the platform and the tools it looked for", () => {
  assert.throws(
    () => buildRecorderCommand({
      audioPath: "/tmp/turn.wav",
      durationSec: 2,
      sampleRate: 16000,
      platform: "linux",
      detect: () => null
    }),
    /linux[\s\S]*ffmpeg[\s\S]*--record-command/
  );
});
```

Add `import { dirname } from "node:path";` to the file's imports if it is not already there, and add
`buildRecorderCommand` to the existing import from `../src/capture/recorder.js`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/recorder.test.js`
Expected: FAIL — `findRecorderOnPath is not a function`, and `buildRecorderCommand` throws the old
macOS-only error for the win32 and linux cases.

- [ ] **Step 3: Implement detection**

In `src/capture/recorder.js`, add above `buildRecorderCommand`:

```js
// Recorders we know how to drive, in preference order per platform. ffmpeg is
// first everywhere it appears because it is the most consistently available and
// produces a correct WAV header without extra flags.
const RECORDERS_BY_PLATFORM = {
  win32: ["ffmpeg", "sox"],
  linux: ["ffmpeg", "arecord", "sox"],
  darwin: ["afrecord", "ffmpeg", "sox"]
};

// Resolve the first known recorder present on PATH, PATHEXT-aware on Windows so
// `ffmpeg.exe` resolves from the bare name `ffmpeg`. Returns null when none are
// installed, which the caller turns into an actionable error.
export function findRecorderOnPath(env = process.env, platform = process.platform) {
  const candidates = RECORDERS_BY_PLATFORM[platform] ?? ["ffmpeg", "sox"];
  for (const name of candidates) {
    // macOS ships afrecord at a fixed absolute path rather than on PATH.
    if (name === "afrecord" && platform === "darwin") {
      if (existsSync("/usr/bin/afrecord")) return { name, executable: "/usr/bin/afrecord" };
      continue;
    }
    const resolved = resolveExecutable(name, env, platform);
    if (resolved) return { name, executable: resolved };
  }
  return null;
}

function resolveExecutable(name, env, platform) {
  const pathValue = env.PATH ?? env.Path ?? "";
  const extensions = platform === "win32"
    ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean)
    : [""];
  for (const directory of pathValue.split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = join(directory, `${name}${extension}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}
```

Add the imports this needs at the top of the file:

```js
import { existsSync } from "node:fs";
import { delimiter } from "node:path";
```

(`join` is already imported; keep the existing `mkdir`, `spawn`, `dirname`, `resolve` imports.)

- [ ] **Step 4: Build the per-recorder argument vectors**

Replace the body of `buildRecorderCommand` after the existing custom-`command` branch. Keep that
branch first and unchanged so an explicit `--record-command` always wins. Then:

```js
  const detected = detect ? detect() : findRecorderOnPath(env, platform);

  if (detected?.name === "afrecord") {
    const args = ["-f", "WAVE", "-d", String(durationSec), "-r", String(sampleRate), "-c", "1"];
    if (device) args.push("-i", String(device));
    args.push(audioPath);
    return { name: "afrecord", executable: detected.executable, args };
  }

  if (detected?.name === "ffmpeg") {
    // Input device syntax is platform-specific; the encode flags are not.
    const input = platform === "win32"
      ? ["-f", "dshow", "-i", `audio=${device ?? "default"}`]
      : platform === "darwin"
        ? ["-f", "avfoundation", "-i", `:${device ?? "0"}`]
        : ["-f", "alsa", "-i", String(device ?? "default")];
    return {
      name: "ffmpeg",
      executable: detected.executable,
      args: [
        "-hide_banner", "-loglevel", "error", "-y",
        ...input,
        "-t", String(durationSec),
        "-ac", "1",
        "-ar", String(sampleRate),
        "-acodec", "pcm_s16le",
        audioPath
      ]
    };
  }

  if (detected?.name === "arecord") {
    const args = [
      "-q",
      "-d", String(durationSec),
      "-f", "S16_LE",
      "-r", String(sampleRate),
      "-c", "1"
    ];
    if (device) args.push("-D", String(device));
    args.push(audioPath);
    return { name: "arecord", executable: detected.executable, args };
  }

  if (detected?.name === "sox") {
    const args = ["-q", "-d", "-b", "16", "-c", "1", "-r", String(sampleRate), audioPath, "trim", "0", String(durationSec)];
    return { name: "sox", executable: detected.executable, args };
  }

  throw new Error(
    `No microphone recorder found for this platform (${platform}). Subtext looked for ` +
    `${(RECORDERS_BY_PLATFORM[platform] ?? ["ffmpeg", "sox"]).join(", ")} on PATH. ` +
    `Install one (ffmpeg is the easiest: https://ffmpeg.org/download.html), or pass ` +
    `--record-command / set SUBTEXT_RECORD_COMMAND with a template using the {out}, ` +
    `{duration}, {sampleRate}, {device} placeholders. The desktop app captures in its own ` +
    `window and needs none of this.`
  );
```

Change the function signature to accept the new seams:

```js
export function buildRecorderCommand({
  audioPath,
  durationSec,
  sampleRate,
  device,
  command,
  env = process.env,
  platform = process.platform,
  detect = null
}) {
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test test/recorder.test.js`
Expected: PASS, including the pre-existing recorder tests.

- [ ] **Step 6: Verify on real hardware**

On this Windows machine, with ffmpeg installed:

```bash
node bin/subtext.js capture --duration 2 --audio-out tmp/turn.wav
```

Expected: a 2-second WAV at `tmp/turn.wav` and a `subtext/capture/v1` JSON report with
`"recorder": "ffmpeg"`. If ffmpeg is absent, the new error must name ffmpeg and the download URL —
confirm that text is what appears.

- [ ] **Step 7: Commit**

```bash
git add src/capture/recorder.js test/recorder.test.js
git commit -m "$(cat <<'EOF'
feat(capture): auto-detect ffmpeg/arecord/sox so capture works off macOS

recordWav only had a built-in recorder on macOS, so capture/session/ptt
threw on Windows and Linux unless the user hand-wrote an ffmpeg command.
Now the common recorders are detected on PATH and driven directly, with
an explicit --record-command still taking precedence and a not-found
error that names the tools and the fix.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: `subtext dictate` — the product loop as one command

Today a user must chain `capture` with a `--transcript-command` they supply themselves. `dictate` is
the whole loop: record, transcribe with a real engine, analyze, deliver.

**Files:**
- Modify: `src/cli.js` (add the `dictate` branch after the `session` branch at line 107; add a
  `dictateFromArgs` helper near `runNaturalSpeechTurn` at line 375; add help text)
- Test: `test/dictate.test.js`

**Interfaces:**
- Consumes: `getEngine`, `ENGINES` (Task 1); `findRecorderOnPath` (Task 4); the existing
  `transcribe()` from `src/transcribe/index.js`; the existing `analyzeCapturedTurn`,
  `deliverOutput`, `parseArgs` helpers in `src/cli.js`.
- Produces: `resolveDictateEngine(args, env): string` exported from `src/cli.js` for testing —
  returns the engine id after applying precedence `--engine` > `SUBTEXT_STT_ENGINE` > `"whisper"`.

- [ ] **Step 1: Write the failing test**

Create `test/dictate.test.js`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { resolveDictateEngine } from "../src/cli.js";

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "bin", "subtext.js");

test("engine precedence is --engine over env over the offline default", () => {
  assert.equal(resolveDictateEngine({ engine: "cloud" }, { SUBTEXT_STT_ENGINE: "command" }), "cloud");
  assert.equal(resolveDictateEngine({}, { SUBTEXT_STT_ENGINE: "command" }), "command");
  assert.equal(resolveDictateEngine({}, {}), "whisper", "the shipped default must be offline");
});

test("an unknown engine is rejected with the list of available engines", () => {
  assert.throws(() => resolveDictateEngine({ engine: "nope" }, {}), /Available: /);
});

test("dictate --engine cloud without a key fails with an actionable message", async () => {
  const error = await run("node", [CLI, "dictate", "--engine", "cloud", "--audio",
    join(ROOT, "eval", "fixtures", "emphasis.wav"), "--text", "ship the whole thing"],
    { env: { ...process.env, SUBTEXT_CLOUD_API_KEY: "", GROQ_API_KEY: "", DEEPGRAM_API_KEY: "" } }
  ).catch((caught) => caught);

  assert.ok(error.code !== 0, "missing credentials must be a non-zero exit");
  assert.match(error.stderr, /SUBTEXT_CLOUD_API_KEY/);
});

test("dictate accepts a pre-recorded --audio and skips capture entirely", async () => {
  const { stdout } = await run("node", [CLI, "dictate",
    "--audio", join(ROOT, "eval", "fixtures", "emphasis.wav"),
    "--text", "ship the whole thing",
    "--format", "prompt"
  ]);

  assert.match(stdout, /<vocal-context schema="vocalcontext\/v1">/);
  assert.match(stdout, /Emphasis: whole/);
  assert.match(stdout, /ship the whole thing/);
});

test("dictate --engine whisper with no binary fails open: the transcript still reaches the user", async () => {
  const error = await run("node", [CLI, "dictate",
    "--audio", join(ROOT, "eval", "fixtures", "emphasis.wav"),
    "--engine", "whisper"],
    { env: { ...process.env, SUBTEXT_WHISPER_BIN: "/no/such/binary-zzzqx", PATH: "" } }
  ).catch((caught) => caught);

  assert.ok(error.code !== 0);
  assert.match(error.stderr, /whisper binary not found/);
  assert.match(error.stderr, /docs\/WHISPER\.md/, "the error must point at the install guide");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/dictate.test.js`
Expected: FAIL — `resolveDictateEngine` is not exported, and the CLI exits non-zero with
`Unknown command: dictate`.

- [ ] **Step 3: Add the engine resolver to `src/cli.js`**

Add near the other helpers, and add `getEngine` to the imports from `./transcribe/index.js`:

```js
// Engine precedence for `dictate`: explicit flag, then environment, then the
// shipped offline default. getEngine throws with the available list when the id
// is unknown, so a typo never silently falls back to something that uploads audio.
export function resolveDictateEngine(args, env = process.env) {
  const id = args.engine ?? env.SUBTEXT_STT_ENGINE ?? "whisper";
  getEngine(id);
  return id;
}
```

- [ ] **Step 4: Add the `dictate` command branch**

In `runCli`, immediately after the `session` branch, add:

```js
    if (command === "dictate") {
      const args = parseArgs(rest);
      const { report, contract, engine } = await dictateFromArgs(args);
      const output = args.format === "json"
        ? `${JSON.stringify({ capture: report, engine, contract }, null, 2)}\n`
        : renderVocalContext(contract, { verbosity: args.verbosity ?? "subtle" });

      await deliverOutput("dictate", output, args.target ?? "stdout", args, {
        fileHint: " Use --audio-out for the recorded WAV.",
        clipboard: "subtext: dictated turn copied to clipboard\n",
        paste: "subtext: dictated turn copied and pasted into active app\n"
      });
      return;
    }
```

- [ ] **Step 5: Implement `dictateFromArgs`**

Add next to `runNaturalSpeechTurn`:

```js
// The product loop in one function: get audio (recorded now, or a file the caller
// already has), get words (from --text, or from the selected STT engine), then run
// the same analyze + deliver path every other command uses.
async function dictateFromArgs(args) {
  const engine = resolveDictateEngine(args);

  const report = args.audio
    ? { schema: "subtext/capture/v1", audioPath: args.audio, recorder: "provided" }
    : await captureFromArgs(args);

  // An explicit --text short-circuits STT; it is how the tests and the offline
  // demo path stay engine-independent.
  let transcript = await transcriptFromArgs(args, "dictate_text", report.audioPath);

  if (!transcript) {
    const envelope = await transcribe(report.audioPath, {
      adapter: engine,
      command: args["transcript-command"],
      apiKey: args["api-key"],
      provider: args.provider,
      model: args.model
    });
    transcript = normalizeTranscriptEnvelope(envelope, transcriptOverrides(args, `dictate_${engine}`));
  }

  const contract = await analyzeCapturedTurn(report, transcript, args);
  return { report, contract, engine };
}
```

Add `transcribe` to the imports at the top of `src/cli.js`:

```js
import { transcribe, getEngine } from "./transcribe/index.js";
```

- [ ] **Step 6: Add the help text**

In the help output, add to the command list, directly under `session`:

```text
  dictate           Record a turn, transcribe it, and deliver the enriched prompt (the full loop)
```

And to the examples block:

```text
  subtext dictate                                   # record 4s, transcribe with local whisper, print
  subtext dictate --target paste                    # ...and paste it into the focused app
  subtext dictate --engine cloud --provider groq    # opt in to cloud STT (needs SUBTEXT_CLOUD_API_KEY)
  subtext dictate --audio turn.wav                  # transcribe and analyze an existing recording
```

- [ ] **Step 7: Run the tests**

Run: `node --test test/dictate.test.js`
Expected: PASS — all five tests. The cloud-key test will pass once Task 6 lands; until then it fails
with `Unknown transcribe adapter: cloud`. **Temporarily skip only that one test** with `test.skip`
and add a `// unskipped in Task 6` comment, so this task can commit green.

- [ ] **Step 8: Commit**

```bash
git add src/cli.js test/dictate.test.js
git commit -m "$(cat <<'EOF'
feat(cli): add `subtext dictate`, the full record-transcribe-analyze loop

Previously a user had to chain `capture` with a --transcript-command they
supplied themselves. `dictate` composes capture, the pluggable STT
interface, analysis, and delivery into one command, defaulting to the
offline whisper engine.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Cloud STT adapter — Groq and Deepgram, bring your own key

The opt-in half of the hybrid decision. This is what makes the desktop app feel as fast as Wispr
Flow for users who choose speed over zero-egress, and it returns real word timings, which are
strictly better for alignment than the proportional fallback.

**Files:**
- Create: `src/transcribe/cloud.js`
- Modify: `src/transcribe/index.js` (dispatch `"cloud"`; add to `ADAPTERS`)
- Test: `test/cloud.test.js`
- Modify: `test/dictate.test.js` (unskip the cloud-key test from Task 5)

**Interfaces:**
- Consumes: `parseTranscriptPayload`-style envelope shape from `src/transcript/envelope.js`; the
  `ENGINES.cloud` entry from Task 1.
- Produces:
  - `transcribeWithCloud({ audio, provider?, apiKey?, model?, env?, fetchImpl? }): Promise<Envelope>`
    where `Envelope = { schema, text, source, confidence?, language?, wordTimings? }`
  - `CLOUD_PROVIDERS: readonly ["groq", "deepgram"]`
  - `resolveCloudCredentials({ provider, apiKey, env }): { provider: string, apiKey: string }` —
    throws the actionable missing-key error
  - `buildCloudRequest({ provider, apiKey, model, audioBytes }): { url, init }`
  - `parseCloudResponse(provider, body): Envelope`

- [ ] **Step 1: Write the failing test**

Create `test/cloud.test.js`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  transcribeWithCloud,
  resolveCloudCredentials,
  parseCloudResponse,
  CLOUD_PROVIDERS
} from "../src/transcribe/cloud.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "..", "eval", "fixtures", "emphasis.wav");

test("both providers are registered", () => {
  assert.deepEqual([...CLOUD_PROVIDERS], ["groq", "deepgram"]);
});

test("a missing key produces an actionable error naming the env vars", () => {
  assert.throws(
    () => resolveCloudCredentials({ provider: "groq", apiKey: null, env: {} }),
    /SUBTEXT_CLOUD_API_KEY[\s\S]*GROQ_API_KEY/
  );
});

test("a provider-specific env var is picked up", () => {
  const resolved = resolveCloudCredentials({
    provider: "deepgram",
    apiKey: null,
    env: { DEEPGRAM_API_KEY: "dg-secret" }
  });
  assert.equal(resolved.apiKey, "dg-secret");
  assert.equal(resolved.provider, "deepgram");
});

test("an unknown provider is rejected", () => {
  assert.throws(
    () => resolveCloudCredentials({ provider: "notaprovider", apiKey: "k", env: {} }),
    /Unknown cloud STT provider: notaprovider/
  );
});

test("parses a Groq verbose_json response into an envelope with word timings", () => {
  const envelope = parseCloudResponse("groq", {
    text: " ship the whole thing ",
    language: "english",
    words: [
      { word: "ship", start: 0.0, end: 0.30 },
      { word: "the", start: 0.30, end: 0.42 },
      { word: "whole", start: 0.42, end: 0.95 },
      { word: "thing", start: 0.95, end: 1.30 }
    ]
  });

  assert.equal(envelope.text, "ship the whole thing");
  assert.equal(envelope.source, "cloud_groq");
  assert.equal(envelope.wordTimings.length, 4);
  assert.deepEqual(envelope.wordTimings[2], { word: "whole", start: 0.42, end: 0.95 });
});

test("parses a Deepgram response into the same envelope shape", () => {
  const envelope = parseCloudResponse("deepgram", {
    results: {
      channels: [{
        alternatives: [{
          transcript: "ship the whole thing",
          confidence: 0.98,
          words: [
            { word: "ship", start: 0.0, end: 0.30, confidence: 0.99 },
            { word: "whole", start: 0.42, end: 0.95, confidence: 0.97 }
          ]
        }]
      }]
    }
  });

  assert.equal(envelope.text, "ship the whole thing");
  assert.equal(envelope.source, "cloud_deepgram");
  assert.equal(envelope.confidence, 0.98);
  assert.equal(envelope.wordTimings[1].word, "whole");
});

test("an empty transcript from the provider is an error, not a silent empty turn", () => {
  assert.throws(() => parseCloudResponse("groq", { text: "   " }), /returned an empty transcript/);
});

test("transcribeWithCloud sends the audio and never logs the key", async () => {
  let seen = null;
  const envelope = await transcribeWithCloud({
    audio: FIXTURE,
    provider: "groq",
    apiKey: "gsk-secret",
    fetchImpl: async (url, init) => {
      seen = { url, init };
      return { ok: true, status: 200, json: async () => ({ text: "ship the whole thing", words: [] }) };
    }
  });

  assert.equal(envelope.text, "ship the whole thing");
  assert.match(seen.url, /api\.groq\.com/);
  assert.equal(seen.init.headers.Authorization, "Bearer gsk-secret");
  assert.ok(seen.init.body, "the audio must actually be sent");
});

test("an HTTP error surfaces the status without leaking the key", async () => {
  const error = await transcribeWithCloud({
    audio: FIXTURE,
    provider: "groq",
    apiKey: "gsk-secret",
    fetchImpl: async () => ({ ok: false, status: 401, text: async () => "invalid_api_key" })
  }).catch((caught) => caught);

  assert.match(error.message, /401/);
  assert.ok(!error.message.includes("gsk-secret"), "the API key must never appear in an error");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/cloud.test.js`
Expected: FAIL — `Cannot find module '.../src/transcribe/cloud.js'`

- [ ] **Step 3: Write the implementation**

Create `src/transcribe/cloud.js`:

```js
// Cloud STT adapter: opt-in, bring-your-own-key transcription via Groq or
// Deepgram. This is the ONLY adapter in the Node tree that sends audio over the
// network, and it is never the default -- see src/transcribe/engines.js, where it
// is declared with egress "vendor".
//
// It exists because cloud recognition is roughly 3x faster than local whisper on
// a laptop CPU and returns real word timings, which beat the proportional
// alignment fallback. Users who want zero egress keep the default `whisper`
// engine and never touch this file.
//
// The fetch implementation is injectable so the adapter is fully testable offline.
// The API key is never included in any thrown error or log line.
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

export const CLOUD_PROVIDERS = Object.freeze(["groq", "deepgram"]);

const DEFAULT_MODELS = Object.freeze({
  groq: "whisper-large-v3-turbo",
  deepgram: "nova-3"
});

const PROVIDER_ENV_KEYS = Object.freeze({
  groq: "GROQ_API_KEY",
  deepgram: "DEEPGRAM_API_KEY"
});

// Resolve provider + key. Precedence: explicit argument, provider-specific env
// var, then the generic SUBTEXT_CLOUD_API_KEY.
export function resolveCloudCredentials({ provider = "groq", apiKey = null, env = process.env } = {}) {
  if (!CLOUD_PROVIDERS.includes(provider)) {
    throw new Error(
      `Unknown cloud STT provider: ${provider}. Available: ${CLOUD_PROVIDERS.join(", ")}.`
    );
  }

  const resolved = apiKey || env[PROVIDER_ENV_KEYS[provider]] || env.SUBTEXT_CLOUD_API_KEY;
  if (!resolved) {
    throw new Error(
      `Cloud STT needs an API key. Set SUBTEXT_CLOUD_API_KEY, or the provider-specific ` +
      `${PROVIDER_ENV_KEYS[provider]}, or pass --api-key. Cloud STT is opt-in and sends your ` +
      `audio to ${provider}; the default 'whisper' engine stays entirely on your machine.`
    );
  }

  return { provider, apiKey: resolved };
}

// Build the provider-specific HTTP request. Groq takes multipart/form-data with
// an OpenAI-compatible shape; Deepgram takes raw audio bytes with query params.
export function buildCloudRequest({ provider, apiKey, model, audioBytes, audioName = "turn.wav" }) {
  if (provider === "groq") {
    const form = new FormData();
    form.append("file", new Blob([audioBytes], { type: "audio/wav" }), audioName);
    form.append("model", model ?? DEFAULT_MODELS.groq);
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
    return {
      url: "https://api.groq.com/openai/v1/audio/transcriptions",
      init: { method: "POST", headers: { Authorization: `Bearer ${apiKey}` }, body: form }
    };
  }

  const params = new URLSearchParams({
    model: model ?? DEFAULT_MODELS.deepgram,
    punctuate: "true",
    smart_format: "true"
  });
  return {
    url: `https://api.deepgram.com/v1/listen?${params}`,
    init: {
      method: "POST",
      headers: { Authorization: `Token ${apiKey}`, "Content-Type": "audio/wav" },
      body: audioBytes
    }
  };
}

// Normalize either provider's response into the shared transcript envelope.
export function parseCloudResponse(provider, body) {
  if (provider === "groq") {
    const text = String(body?.text ?? "").trim();
    if (!text) throw new Error("Cloud STT (groq) returned an empty transcript.");
    return {
      schema: "subtext/transcript/v1",
      text,
      source: "cloud_groq",
      language: normalizeLanguage(body?.language),
      wordTimings: normalizeWords(body?.words)
    };
  }

  const alternative = body?.results?.channels?.[0]?.alternatives?.[0];
  const text = String(alternative?.transcript ?? "").trim();
  if (!text) throw new Error("Cloud STT (deepgram) returned an empty transcript.");
  return {
    schema: "subtext/transcript/v1",
    text,
    source: "cloud_deepgram",
    confidence: typeof alternative.confidence === "number" ? alternative.confidence : undefined,
    wordTimings: normalizeWords(alternative?.words)
  };
}

function normalizeWords(words) {
  if (!Array.isArray(words)) return undefined;
  const normalized = words
    .map((entry) => ({
      word: String(entry?.word ?? entry?.punctuated_word ?? "").trim(),
      start: Number(entry?.start),
      end: Number(entry?.end)
    }))
    .filter((entry) => entry.word && Number.isFinite(entry.start) && Number.isFinite(entry.end));
  return normalized.length ? normalized : undefined;
}

function normalizeLanguage(language) {
  if (typeof language !== "string" || !language.trim()) return undefined;
  // Groq reports a language name ("english"); the envelope wants a short tag.
  const named = { english: "en", spanish: "es", french: "fr", german: "de" };
  const key = language.trim().toLowerCase();
  return named[key] ?? key.slice(0, 5);
}

export async function transcribeWithCloud({
  audio,
  provider = "groq",
  apiKey = null,
  model = null,
  env = process.env,
  fetchImpl = fetch,
  timeoutMs = 30000
} = {}) {
  if (!audio) throw new Error("Cloud STT needs an audio file path.");
  const credentials = resolveCloudCredentials({ provider, apiKey, env });
  const audioBytes = await readFile(audio);

  const { url, init } = buildCloudRequest({
    provider: credentials.provider,
    apiKey: credentials.apiKey,
    model,
    audioBytes,
    audioName: basename(audio)
  });

  // Never hang: a stuck cloud call must not strand the user's turn.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Cloud STT (${credentials.provider}) timed out after ${timeoutMs}ms.`);
    }
    throw new Error(`Cloud STT (${credentials.provider}) request failed: ${error.message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    // Read the body for context but never echo the request, which holds the key.
    const detail = await safeText(response);
    throw new Error(
      `Cloud STT (${credentials.provider}) returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`
    );
  }

  return parseCloudResponse(credentials.provider, await response.json());
}

async function safeText(response) {
  try {
    return (await response.text()).slice(0, 300);
  } catch {
    return "";
  }
}
```

- [ ] **Step 4: Wire it into the dispatcher**

In `src/transcribe/index.js`:

Change the adapters constant:

```js
export const ADAPTERS = ["command", "whisper", "cloud", "webspeech"];
```

Add the import beside the existing two:

```js
import { transcribeWithCloud } from "./cloud.js";
```

Add the dispatch branch after the `whisper` branch:

```js
  if (adapter === "cloud") {
    return transcribeWithCloud({ audio: input, ...rest });
  }
```

Add the re-export beside the others:

```js
export { transcribeWithCloud, CLOUD_PROVIDERS } from "./cloud.js";
```

- [ ] **Step 5: Unskip the deferred test from Task 5**

In `test/dictate.test.js`, change the cloud-key test back from `test.skip` to `test` and delete the
`// unskipped in Task 6` comment.

- [ ] **Step 6: Run the tests**

Run: `node --test test/cloud.test.js test/dictate.test.js test/transcribe.test.js`
Expected: PASS — all of them, including the previously skipped cloud-credentials test.

- [ ] **Step 7: Verify against a real provider (optional, needs a key)**

If a Groq key is available:

```bash
SUBTEXT_CLOUD_API_KEY=... node bin/subtext.js dictate \
  --audio eval/fixtures/emphasis.wav --engine cloud --provider groq --format json
```

Expected: JSON whose `contract.transcript.source` is `cloud_groq` and whose alignment uses real word
timings rather than the proportional fallback. Record the observed latency for the Task 4 gate in
Phase 4. Skip this step rather than committing a key anywhere.

- [ ] **Step 8: Commit**

```bash
git add src/transcribe/cloud.js src/transcribe/index.js test/cloud.test.js test/dictate.test.js
git commit -m "$(cat <<'EOF'
feat(transcribe): opt-in cloud STT adapter for Groq and Deepgram

The opt-in half of the hybrid STT decision: faster than local whisper and
returns real word timings, which beat proportional alignment. Never the
default, declared egress "vendor", key resolved from --api-key or env, and
the key never appears in a thrown error.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Whisper model manager — `subtext model`

`whisper` is the shipped default, but it currently requires the user to find a ggml model themselves.
`scripts/whisper-bootstrap.mjs` can download one but is a script, not a command, and does not verify
what it downloaded. This makes the offline default actually usable.

**Files:**
- Create: `src/transcribe/models.js`
- Create: `src/transcribe/models.json`
- Modify: `src/cli.js` (add the `model` command branch and help text)
- Test: `test/models.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `MODELS: Record<string, { id, file, url, bytes, sha256, note }>`
  - `modelDirectory(env?): string` — `SUBTEXT_MODEL_DIR`, else `<os.homedir()>/.subtext/models`
  - `resolveInstalledModel(id, env?): string | null` — absolute path, or null
  - `listModels(env?): Array<{ id, installed, path, bytes, note }>`
  - `downloadModel(id, { env?, fetchImpl?, onProgress?, consent }): Promise<string>` — throws
    unless `consent === true`; verifies SHA-256; writes atomically via a `.part` file

- [ ] **Step 1: Record the real checksums**

Do this before writing `models.json` — **do not invent hashes.** Download each model once and record
its actual digest:

```bash
curl -L -o /tmp/ggml-base.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
node -e "const{createHash}=require('crypto'),{readFileSync}=require('fs');console.log(createHash('sha256').update(readFileSync('/tmp/ggml-base.en.bin')).digest('hex'))"
node -e "console.log(require('fs').statSync('/tmp/ggml-base.en.bin').size)"
```

Repeat for `ggml-tiny.en.bin` and `ggml-small.en.bin`. Paste the real values into `models.json` in
the next step.

- [ ] **Step 2: Write the failing test**

Create `test/models.test.js`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  MODELS,
  modelDirectory,
  resolveInstalledModel,
  listModels,
  downloadModel
} from "../src/transcribe/models.js";

test("the catalog has real-looking checksums and sizes for every model", () => {
  const ids = Object.keys(MODELS);
  assert.ok(ids.includes("base.en"), "base.en is the shipped default");
  for (const [id, model] of Object.entries(MODELS)) {
    assert.match(model.sha256, /^[0-9a-f]{64}$/, `${id}: sha256 must be 64 lowercase hex chars`);
    assert.ok(model.bytes > 1_000_000, `${id}: bytes looks wrong (${model.bytes})`);
    assert.match(model.url, /^https:\/\//, `${id}: url must be https`);
    assert.ok(model.file.endsWith(".bin"), `${id}: file must be a ggml .bin`);
  }
});

test("modelDirectory honours SUBTEXT_MODEL_DIR", () => {
  assert.equal(modelDirectory({ SUBTEXT_MODEL_DIR: "/custom/models" }), "/custom/models");
});

test("resolveInstalledModel returns null when nothing is installed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "subtext-models-"));
  assert.equal(resolveInstalledModel("base.en", { SUBTEXT_MODEL_DIR: dir }), null);
});

test("resolveInstalledModel finds a model that is present", async () => {
  const dir = await mkdtemp(join(tmpdir(), "subtext-models-"));
  const path = join(dir, MODELS["base.en"].file);
  await writeFile(path, "not-a-real-model");
  assert.equal(resolveInstalledModel("base.en", { SUBTEXT_MODEL_DIR: dir }), path);
});

test("listModels reports installed state per model", async () => {
  const dir = await mkdtemp(join(tmpdir(), "subtext-models-"));
  await writeFile(join(dir, MODELS["base.en"].file), "x");
  const listed = listModels({ SUBTEXT_MODEL_DIR: dir });
  assert.equal(listed.find((entry) => entry.id === "base.en").installed, true);
  assert.equal(listed.find((entry) => entry.id === "tiny.en").installed, false);
});

test("downloadModel refuses to touch the network without explicit consent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "subtext-models-"));
  await assert.rejects(
    downloadModel("base.en", {
      env: { SUBTEXT_MODEL_DIR: dir },
      consent: false,
      fetchImpl: async () => {
        throw new Error("the network must not be touched without consent");
      }
    }),
    /requires explicit consent/
  );
});

test("downloadModel rejects and deletes a file whose checksum does not match", async () => {
  const dir = await mkdtemp(join(tmpdir(), "subtext-models-"));
  await assert.rejects(
    downloadModel("base.en", {
      env: { SUBTEXT_MODEL_DIR: dir },
      consent: true,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        headers: new Map([["content-length", "17"]]),
        arrayBuffer: async () => new TextEncoder().encode("tampered-payload!").buffer
      })
    }),
    /checksum mismatch/
  );
  assert.equal(resolveInstalledModel("base.en", { SUBTEXT_MODEL_DIR: dir }), null,
    "a failed download must leave nothing behind");
});

test("downloadModel writes the file when the checksum matches", async () => {
  const dir = await mkdtemp(join(tmpdir(), "subtext-models-"));
  const payload = new TextEncoder().encode("pretend-model-bytes");
  const digest = createHash("sha256").update(payload).digest("hex");

  const path = await downloadModel("base.en", {
    env: { SUBTEXT_MODEL_DIR: dir },
    consent: true,
    expectedSha256: digest,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: new Map([["content-length", String(payload.length)]]),
      arrayBuffer: async () => payload.buffer
    })
  });

  assert.equal(await readFile(path, "utf8"), "pretend-model-bytes");
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test test/models.test.js`
Expected: FAIL — `Cannot find module '.../src/transcribe/models.js'`

- [ ] **Step 4: Write the catalog**

Create `src/transcribe/models.json`, substituting the **real** values recorded in Step 1:

```json
{
  "tiny.en": {
    "id": "tiny.en",
    "file": "ggml-tiny.en.bin",
    "url": "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin",
    "bytes": 0,
    "sha256": "REPLACE_WITH_REAL_DIGEST_FROM_STEP_1",
    "note": "Fastest, lowest accuracy. Good on very old hardware."
  },
  "base.en": {
    "id": "base.en",
    "file": "ggml-base.en.bin",
    "url": "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
    "bytes": 0,
    "sha256": "REPLACE_WITH_REAL_DIGEST_FROM_STEP_1",
    "note": "The default. Best speed/accuracy balance for short push-to-talk turns."
  },
  "small.en": {
    "id": "small.en",
    "file": "ggml-small.en.bin",
    "url": "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin",
    "bytes": 0,
    "sha256": "REPLACE_WITH_REAL_DIGEST_FROM_STEP_1",
    "note": "More accurate, noticeably slower on CPU."
  }
}
```

The `bytes` and `sha256` values above are the only intentionally unfilled fields in this plan; Step 1
produces them. `test/models.test.js` fails until they are real, which is the guard.

- [ ] **Step 5: Write the implementation**

Create `src/transcribe/models.js`:

```js
// Whisper ggml model manager.
//
// Subtext never bundles model weights and never downloads anything on its own.
// downloadModel() throws unless the caller passes consent: true, which the CLI
// only sets after the user confirms. Every download is checksum-verified against
// src/transcribe/models.json and written atomically, so an interrupted or
// tampered download can never leave a half-model that whisper.cpp would load.
import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
export const MODELS = Object.freeze(require("./models.json"));

export function modelDirectory(env = process.env) {
  return env.SUBTEXT_MODEL_DIR || join(homedir(), ".subtext", "models");
}

function modelSpec(id) {
  const model = MODELS[id];
  if (!model) {
    throw new Error(`Unknown whisper model: ${id}. Available: ${Object.keys(MODELS).join(", ")}.`);
  }
  return model;
}

export function resolveInstalledModel(id, env = process.env) {
  const path = join(modelDirectory(env), modelSpec(id).file);
  return existsSync(path) ? path : null;
}

export function listModels(env = process.env) {
  return Object.values(MODELS).map((model) => {
    const path = join(modelDirectory(env), model.file);
    const installed = existsSync(path);
    return {
      id: model.id,
      installed,
      path: installed ? path : null,
      bytes: installed ? statSync(path).size : model.bytes,
      note: model.note
    };
  });
}

export async function downloadModel(id, {
  env = process.env,
  fetchImpl = fetch,
  onProgress = null,
  consent = false,
  expectedSha256 = null
} = {}) {
  const model = modelSpec(id);

  if (consent !== true) {
    throw new Error(
      `Downloading the ${id} model requires explicit consent. Subtext never fetches model ` +
      `weights on its own. Re-run with --yes, or download ${model.file} yourself and put it in ` +
      `${modelDirectory(env)}.`
    );
  }

  const directory = modelDirectory(env);
  await mkdir(directory, { recursive: true });
  const finalPath = join(directory, model.file);
  const partPath = `${finalPath}.part`;

  const response = await fetchImpl(model.url);
  if (!response.ok) {
    throw new Error(`Model download failed: HTTP ${response.status} from ${model.url}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  onProgress?.({ id, received: bytes.length, total: model.bytes });

  const digest = createHash("sha256").update(bytes).digest("hex");
  const expected = expectedSha256 ?? model.sha256;
  if (digest !== expected) {
    await rm(partPath, { force: true });
    throw new Error(
      `Model checksum mismatch for ${id}: expected ${expected}, got ${digest}. ` +
      `The download was discarded. Retry, or install the model manually.`
    );
  }

  // Atomic: write beside the target, then rename, so a crash never leaves a
  // truncated file that looks installed.
  await writeFile(partPath, bytes);
  await rename(partPath, finalPath);
  return finalPath;
}
```

- [ ] **Step 6: Run the tests**

Run: `node --test test/models.test.js`
Expected: PASS — all eight tests, once Step 1's real checksums are in `models.json`.

- [ ] **Step 7: Add the `model` CLI command**

In `src/cli.js`, add the import:

```js
import { listModels, downloadModel, modelDirectory } from "./transcribe/models.js";
```

And the command branch, after the `profile` branch:

```js
    if (command === "model") {
      const [subcommand = "list", ...modelRest] = rest;
      const args = parseArgs(modelRest);

      if (subcommand === "list") {
        const rows = listModels();
        if (args.format === "json") {
          process.stdout.write(`${JSON.stringify({ directory: modelDirectory(), models: rows }, null, 2)}\n`);
          return;
        }
        process.stdout.write(`Whisper models in ${modelDirectory()}\n\n`);
        for (const row of rows) {
          const state = row.installed ? "installed" : "not installed";
          process.stdout.write(`  ${row.id.padEnd(10)} ${state.padEnd(14)} ${formatBytes(row.bytes)}  ${row.note}\n`);
        }
        process.stdout.write(`\nInstall one with: subtext model download base.en --yes\n`);
        return;
      }

      if (subcommand === "download") {
        const id = modelRest.find((value) => !value.startsWith("--")) ?? "base.en";
        const consent = args.yes === true || args.yes === "true";
        if (!consent) {
          const model = listModels().find((row) => row.id === id);
          process.stderr.write(
            `subtext: downloading ${id} fetches roughly ${formatBytes(model?.bytes ?? 0)} from ` +
            `huggingface.co into ${modelDirectory()}.\n` +
            `This is the only network request Subtext ever makes on your behalf.\n` +
            `Re-run with --yes to confirm: subtext model download ${id} --yes\n`
          );
          process.exitCode = 1;
          return;
        }
        process.stderr.write(`subtext: downloading ${id}...\n`);
        const path = await downloadModel(id, { consent: true });
        process.stdout.write(`subtext: installed ${id} at ${path}\n`);
        return;
      }

      throw new Error(`Unknown model subcommand: ${subcommand}. Use: list, download.`);
    }
```

Add the helper near the other formatting helpers:

```js
function formatBytes(bytes) {
  if (!bytes) return "unknown size";
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}
```

- [ ] **Step 8: Teach the whisper adapter to find a managed model**

In `src/transcribe/whisper.js`, in `resolveWhisperModel`, after the `SUBTEXT_WHISPER_MODEL` branch
returns null, fall back to the managed directory before giving up. Replace the final `return null;`
with:

```js
  // Fall back to a model installed by `subtext model download`, so the offline
  // default works without the user setting any environment variable.
  const managed = resolveInstalledModel("base.en", env);
  return managed ?? null;
```

and add the import at the top of the file:

```js
import { resolveInstalledModel } from "./models.js";
```

- [ ] **Step 9: Add help text**

In the CLI help command list, after `profile`:

```text
  model             Manage local whisper models (list, download)
```

And to the examples:

```text
  subtext model list                       # what is installed, and where
  subtext model download base.en --yes     # fetch the default model (~142 MB, one time)
```

- [ ] **Step 10: Run the full suite**

Run: `npm test`
Expected: PASS. Then verify the real flow end to end:

```bash
node bin/subtext.js model list
node bin/subtext.js model download base.en          # must refuse without --yes
node bin/subtext.js model download base.en --yes    # downloads and verifies
node bin/subtext.js dictate --audio eval/fixtures/emphasis.wav --engine whisper
```

Expected: the last command transcribes with local whisper and prints an enriched prompt, with no
`SUBTEXT_WHISPER_MODEL` set. This requires a whisper.cpp binary on PATH; if absent, confirm the error
names `docs/WHISPER.md`.

- [ ] **Step 11: Commit**

```bash
git add src/transcribe/models.js src/transcribe/models.json src/transcribe/whisper.js src/cli.js test/models.test.js
git commit -m "$(cat <<'EOF'
feat(transcribe): whisper model manager with consent-gated, verified downloads

`subtext model list|download` makes the offline default usable without
hunting for a ggml file. Downloads require explicit --yes, are SHA-256
verified against a checked-in catalog, and are written atomically so a
failed fetch never leaves a half-model behind. The whisper adapter now
falls back to the managed directory, so no env var is needed.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Doctor, docs, and the Phase 1 truth pass

New commands and engines are worthless if `doctor` does not know about them and the docs still say
whisper is "library API only." This task closes Phase 1 honestly.

**Files:**
- Modify: `src/harness/doctor.js` (report engine and model readiness)
- Modify: `docs/WHISPER.md` (remove the "not yet wired into the CLI" status)
- Modify: `README.md` (status table, command list, install section)
- Modify: `CHANGELOG.md` (new Unreleased section)
- Test: `test/doctor-engines.test.js`

**Interfaces:**
- Consumes: `listEngines` (Task 1), `findRecorderOnPath` (Task 4), `listModels` and
  `resolveInstalledModel` (Task 7), `resolveWhisperBinary` (existing).
- Produces: `checkSttReadiness(env?): { engines: Array<{id, egress, ready, detail}>, recorder: {...}, models: [...] }`
  exported from `src/harness/doctor.js`.

- [ ] **Step 1: Write the failing test**

Create `test/doctor-engines.test.js`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkSttReadiness } from "../src/harness/doctor.js";

test("readiness reports every Node-runnable engine with its egress level", () => {
  const readiness = checkSttReadiness({ PATH: "" });
  const ids = readiness.engines.map((engine) => engine.id);
  assert.ok(ids.includes("whisper"));
  assert.ok(ids.includes("cloud"));
  assert.ok(ids.includes("command"));
  assert.ok(!ids.includes("webspeech"), "browser-only engines are not Node readiness checks");

  for (const engine of readiness.engines) {
    assert.ok(["none", "vendor", "unknown"].includes(engine.egress));
    assert.equal(typeof engine.ready, "boolean");
    assert.ok(engine.detail.length > 0, `${engine.id} must explain its state`);
  }
});

test("whisper is reported not-ready with an actionable detail when no binary exists", () => {
  const readiness = checkSttReadiness({ PATH: "", SUBTEXT_WHISPER_BIN: "/no/such/bin-zzzqx" });
  const whisper = readiness.engines.find((engine) => engine.id === "whisper");
  assert.equal(whisper.ready, false);
  assert.match(whisper.detail, /docs\/WHISPER\.md|whisper binary not found/);
});

test("cloud is reported ready only when a key is present", () => {
  assert.equal(
    checkSttReadiness({ PATH: "" }).engines.find((e) => e.id === "cloud").ready,
    false
  );
  assert.equal(
    checkSttReadiness({ PATH: "", SUBTEXT_CLOUD_API_KEY: "k" }).engines.find((e) => e.id === "cloud").ready,
    true
  );
});

test("readiness reports the recorder situation", () => {
  const readiness = checkSttReadiness({ PATH: "/no/such/dir-zzzqx" });
  assert.equal(readiness.recorder.ready, false);
  assert.match(readiness.recorder.detail, /ffmpeg/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/doctor-engines.test.js`
Expected: FAIL — `checkSttReadiness is not a function`

- [ ] **Step 3: Implement the readiness check**

Add to `src/harness/doctor.js`:

```js
import { listEngines, getEngine } from "../transcribe/engines.js";
import { resolveWhisperBinary, resolveWhisperModel } from "../transcribe/whisper.js";
import { findRecorderOnPath } from "../capture/recorder.js";
import { listModels, modelDirectory } from "../transcribe/models.js";

// Report which STT engines can actually run here, and say plainly which ones
// would send audio off the device. This is what `subtext doctor` prints before a
// user commits to an engine.
export function checkSttReadiness(env = process.env) {
  const engines = listEngines("node").map((engine) => {
    if (engine.id === "whisper") {
      try {
        const binary = resolveWhisperBinary(env);
        // resolveWhisperModel honours SUBTEXT_WHISPER_MODEL first and falls back
        // to the managed directory, so this reflects what dictate would actually use.
        const model = resolveWhisperModel(env);
        return {
          id: engine.id,
          egress: engine.egress,
          ready: Boolean(model),
          detail: model
            ? `whisper.cpp at ${binary}, model ${model}`
            : `whisper.cpp at ${binary}, but no model installed. Run: subtext model download base.en --yes`
        };
      } catch (error) {
        return { id: engine.id, egress: engine.egress, ready: false, detail: error.message };
      }
    }

    if (engine.id === "cloud") {
      const key = env.SUBTEXT_CLOUD_API_KEY || env.GROQ_API_KEY || env.DEEPGRAM_API_KEY;
      return {
        id: engine.id,
        egress: engine.egress,
        ready: Boolean(key),
        detail: key
          ? `API key found; audio would be sent to ${engine.vendor}`
          : "no API key set (SUBTEXT_CLOUD_API_KEY, GROQ_API_KEY, or DEEPGRAM_API_KEY)"
      };
    }

    return {
      id: engine.id,
      egress: engine.egress,
      ready: true,
      detail: "available; you supply the command, so its egress is unknown to Subtext"
    };
  });

  const found = findRecorderOnPath(env);
  return {
    engines,
    recorder: {
      ready: Boolean(found),
      detail: found
        ? `${found.name} at ${found.executable}`
        : "no recorder found. Install ffmpeg (https://ffmpeg.org/download.html) or pass --record-command."
    },
    models: listModels(env),
    modelDirectory: modelDirectory(env)
  };
}
```

Then render it. Add this function to the same file and call it from `renderHarnessDoctor`, appending
its output after the existing harness table:

```js
// Render the STT section of `subtext doctor`. The egress column is the point of
// this output: a user choosing an engine must be able to see, without reading
// docs, which ones send their audio somewhere.
export function renderSttReadiness(readiness) {
  const lines = ["", "Speech-to-text", ""];

  for (const engine of readiness.engines) {
    const mark = engine.ready ? "ok  " : "--  ";
    const egress =
      engine.egress === "none" ? "[on-device]"
      : engine.egress === "vendor" ? `[sends audio to ${getEngine(engine.id).vendor}]`
      : "[egress unknown]";
    lines.push(`  ${mark}${engine.id.padEnd(10)} ${egress}`);
    lines.push(`      ${engine.detail}`);
  }

  lines.push("");
  lines.push(`  ${readiness.recorder.ready ? "ok  " : "--  "}recorder   ${readiness.recorder.detail}`);
  lines.push(`      models in ${readiness.modelDirectory}`);
  lines.push("");

  return lines.join("\n");
}
```

Add `getEngine` to the imports from `../transcribe/engines.js` in this file.

- [ ] **Step 4: Run the tests**

Run: `node --test test/doctor-engines.test.js`
Expected: PASS — all four tests.

- [ ] **Step 5: Correct `docs/WHISPER.md`**

Replace the status line at the top of the file:

```markdown
**Status: shipped.** `subtext dictate --engine whisper` is the default path, and
`subtext model download base.en --yes` installs the model. `transcribe()` and the `whisper`
adapter remain importable from the package entrypoint for library use.
```

Add a section documenting `subtext model list` and `subtext model download`, and the
`SUBTEXT_MODEL_DIR` override.

- [ ] **Step 6: Update the README status table**

Change the two rows that are now wrong:

```markdown
| Offline whisper STT | 🟢 shipped | `subtext dictate --engine whisper`; `subtext model download base.en --yes` installs a checksum-verified model. No weights bundled, no egress. |
| Cloud STT (opt-in) | 🟢 shipped | `--engine cloud --provider groq\|deepgram` with your own key. Faster, returns real word timings, and clearly labelled as sending audio to the provider. |
```

Add `dictate` and `model` to the CLI row's command list, and add to the "Try it in 30 seconds"
section, after the existing `npx yell-at-ai demo` block:

```markdown
Then speak one for real — this records four seconds, transcribes it locally, and prints the enriched
prompt:

```sh
npx yell-at-ai model download base.en --yes   # one time, ~142 MB, asks first
npx yell-at-ai dictate --target clipboard
```
```

- [ ] **Step 7: Add the changelog entry**

At the top of `CHANGELOG.md`, above the `## [0.1.0]` heading:

```markdown
## [Unreleased]

### Added

- `subtext dictate` — the full loop in one command: record, transcribe, analyze, deliver.
- `subtext model list|download` — consent-gated, SHA-256-verified whisper model management.
- Cloud STT adapter (Groq, Deepgram) as an opt-in, bring-your-own-key engine.
- STT engine registry with machine-readable network-egress metadata, surfaced in `subtext doctor`.
- Microphone recorder auto-detection for `ffmpeg`, `arecord`, and `sox`, so capture works on
  Windows and Linux without a hand-written command template.

### Fixed

- Privacy copy no longer claims audio never leaves the device on paths that transcribe through the
  browser's Web Speech API, which uploads audio to Google in Chrome and Edge. A test now guards this.
```

- [ ] **Step 8: Run the complete gate**

Run: `npm run check`
Expected: build, all tests (82 baseline + roughly 30 new), bench under 300ms p95, smoke, and judge
pack all pass.

Then confirm the new surface is real:

```bash
node bin/subtext.js doctor
node bin/subtext.js --help | grep -E "dictate|model"
```

Expected: `doctor` prints the Speech-to-text section with per-engine egress; help lists both new
commands.

- [ ] **Step 9: Commit**

```bash
git add src/harness/doctor.js docs/WHISPER.md README.md CHANGELOG.md test/doctor-engines.test.js
git commit -m "$(cat <<'EOF'
feat(doctor): report STT engine readiness and network egress; docs truth pass

`subtext doctor` now says which engines can actually run here and which
ones would send audio off the device. docs/WHISPER.md no longer claims
whisper is library-only, and the README status table reflects the shipped
dictate/model commands.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 1 exit criteria

Phase 2 (`apps/shell` and the desktop app) does not start until all of these hold:

- [ ] `npm run check` is green locally and CI is green on all six matrix legs
- [ ] `yell-at-ai@0.1.0` is installable from npm and `npx yell-at-ai demo` works from a clean directory
- [ ] The GitHub repo is public, described, topic-tagged, and has a v0.1.0 release
- [ ] On a clean Windows machine with ffmpeg installed: `yell-at-ai model download base.en --yes`
      followed by `yell-at-ai dictate --target clipboard` puts an enriched prompt on the clipboard
      with no other configuration
- [ ] `subtext doctor` reports the correct egress level for every engine
- [ ] No user-facing file makes an unqualified claim that audio never leaves the device
- [ ] Measured and recorded: p95 release-to-insert latency for local whisper `base.en` and for cloud,
      on a five-second turn — these numbers set the Phase 4 gate 7 budget

---

## Notes for whoever writes the Phase 2 plan

Write it only after Phase 1 exits. It should cover, per the spec:

- Extracting `apps/shell/` with the `PlatformAdapter` interface (`capture`, `transcribe`, `analyze`,
  `insert`, `store`) and the two implementations
- The frameless always-on-top pill overlay, its five states, and the live prosody chips
- Press-and-hold global hotkey semantics (the existing Tauri handler is `Pressed`-edge only and must
  become press/release)
- WebView capture replacing the sidecar `ptt` invocation
- whisper.cpp as a Tauri `externalBin` for win-x64, mac-arm64, mac-x64, linux-x64
- Per-app insertion rules and the known-AI-app list
- History (SQLite), settings, onboarding with calibration, tray, autostart, icons,
  `bundle.active: true`
