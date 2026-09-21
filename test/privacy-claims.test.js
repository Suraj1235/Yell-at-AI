import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, readdir, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, posix, sep } from "node:path";
import { ENGINES } from "../src/transcribe/engines.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// The guard's file list is DERIVED from package.json "files", not hand
// maintained. The previous list was six hand-written paths, and two false
// claims lived outside it - one of them in CHANGELOG.md, which ships in the
// npm tarball. A list that enumerates what actually ships cannot develop that
// hole again: adding a doc to the package automatically puts it under guard.
//
// npm always includes README.md and LICENSE whatever "files" says, so README.md
// is added explicitly. src/cli.js is included because its help text is
// user-facing copy that happens to live in a .js file.
const ALWAYS_SHIPPED = ["README.md", "src/cli.js"];

// Pages that must never fall out of the scan. If a future edit to "files"
// stops shipping one of these, that is a packaging bug and this list catches
// it rather than the guard silently going quiet.
const MUST_BE_COVERED = [
  "README.md",
  "CHANGELOG.md",
  "docs/QUICKSTART.md",
  "apps/web/index.html",
  "apps/web/README.md",
  "docs/WEB_PREVIEW.md",
  "docs/NATURAL_SPEECH.md",
  "src/cli.js"
];

// Only .md and .html are swept out of directories. Sweeping every shipped .js
// would pull in source comments, which legitimately say audio never leaves the
// machine for the whisper adapter, where it is true.
async function collect(relative, into, filesOnly) {
  const absolute = join(ROOT, relative);
  let info;
  try {
    info = await stat(absolute);
  } catch {
    return; // listed in "files" but absent from this checkout
  }

  if (info.isFile()) {
    const normalized = relative.split(sep).join(posix.sep);
    if (!filesOnly || /\.(md|html)$/i.test(normalized)) into.add(normalized);
    return;
  }

  for (const entry of (await readdir(absolute)).sort()) {
    if (entry.startsWith(".") || entry === "node_modules") continue;
    await collect(join(relative, entry), into, true);
  }
}

async function shippedCopyFiles() {
  const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
  const found = new Set();
  for (const entry of pkg.files) {
    await collect(entry.replace(/[\\/]+$/, ""), found, true);
  }
  for (const extra of ALWAYS_SHIPPED) {
    await collect(extra, found, false);
  }
  return [...found].sort();
}

// Absolute claims that are false while any default path uses a vendor recognizer.
const BANNED = [
  /your\s+(?:voice|audio)\s+never\s+leaves/i,
  /audio\s+never\s+leaves\s+(?:the\s+)?(?:tab|page|browser|device)/i,
  /there\s+is\s+no\s+server\s+to\s+send\s+audio\s+to/i,
  /no\s+upload\s+[-—]\s+audio\s+stays\s+in\s+memory/i,
  // "no audio leaving the browser" shipped in CHANGELOG.md and tripped none of
  // the four patterns above. Scoped to the browser surface on purpose: "no
  // audio leaves the machine" is true of `subtext serve`, which is local-only.
  /no\s+audio\s+(?:ever\s+)?leav(?:es|ing)\s+(?:the\s+)?(?:tab|page|browser|device)/i,
  // A bare "no upload" reads as "my recording is not uploaded" on a landing
  // page, whatever the surrounding sentence scopes it to.
  /\bno\s+uploads?\b/i,
  /nothing\s+(?:ever\s+)?leaves\s+(?:the\s+)?(?:tab|page|browser)/i
];

test("the copy guard covers every user-facing file the tarball ships", async () => {
  const files = await shippedCopyFiles();
  for (const required of MUST_BE_COVERED) {
    assert.ok(
      files.includes(required),
      `${required} must be inside the copy guard (is it still in package.json "files"?)`
    );
  }
  assert.ok(files.length > 20, `expected the shipped-docs sweep to find many files, got ${files.length}`);
});

test("no shipped user-facing file makes an unqualified absolute claim about audio never leaving", async () => {
  const offenders = [];
  for (const relative of await shippedCopyFiles()) {
    const text = await readFile(join(ROOT, relative), "utf8");
    text.split("\n").forEach((line, index) => {
      for (const pattern of BANNED) {
        if (pattern.test(line)) {
          offenders.push(`${relative}:${index + 1}: ${line.trim()}`);
          return;
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
