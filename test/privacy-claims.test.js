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
  "apps/web/README.md",
  "docs/WEB_PREVIEW.md",
  "docs/NATURAL_SPEECH.md"
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

// The point-of-use guard. Asserting that "Google" appears *somewhere* in a
// 245-line page is the kind of check that passes while the recorder itself says
// nothing: the prose section that satisfied it sits ~150 lines below the record
// button. This asserts the vendor is named in the badge, and that the badge is
// above the recorder in document order.
test("a persistent engine badge sits above the recorder and names the vendor before capture", async () => {
  const html = await readFile(join(ROOT, "apps/web/index.html"), "utf8");

  const badgeAt = html.indexOf('id="engine-badge"');
  const recorderAt = html.indexOf('<div class="recorder">');
  assert.ok(badgeAt > -1, "the page must render an engine badge (index.html claims it does)");
  assert.ok(recorderAt > -1, "the recorder must still be on the page");
  assert.ok(badgeAt < recorderAt, "the badge must come BEFORE the recorder in document order");

  const badge = html.slice(badgeAt, recorderAt);
  assert.match(badge, /Web Speech/i, "the badge must name the engine in use");
  assert.match(badge, /Google/i, "the badge must name the third party that receives the audio");
  assert.doesNotMatch(
    badge,
    /\shidden[\s=>]/,
    "the badge must be visible on first paint, not revealed later"
  );

  // Non-dismissible: no close control, and nothing hides it at runtime.
  const app = await readFile(join(ROOT, "apps/web/app.js"), "utf8");
  assert.match(app, /engine-badge/, "app.js must keep the badge in sync with the active engine");
  assert.match(
    app,
    /ENGINES\.webspeech/,
    "the badge must render the vendor from the shared engine registry, not a hardcoded literal"
  );
  assert.doesNotMatch(
    app,
    /engineBadge\.(hidden|remove\(\))/,
    "the badge is non-dismissible: nothing may hide or remove it"
  );

  // ...and it must be accurate in the fallback state, where no audio is sent
  // for recognition at all, rather than wrongly warning about Google.
  assert.match(
    app,
    /no audio is sent to anyone for recognition/i,
    "the typed-transcript fallback must say that nothing is sent, not warn about a vendor"
  );
});

test("the engine badge's vendor string comes from the registry and names Google", () => {
  // The badge interpolates ENGINES.webspeech.vendor. If that string ever stopped
  // naming the Chrome/Edge vendor, the badge would silently stop naming it too.
  assert.match(ENGINES.webspeech.vendor, /Google/);
  assert.equal(ENGINES.webspeech.egress, "vendor");
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
