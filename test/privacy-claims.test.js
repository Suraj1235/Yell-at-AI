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
// npm always includes README.md whatever "files" says, so README.md is added
// explicitly. src/cli.js is included because its help text is user-facing
// copy that happens to live in a .js file. apps/web/app.js is included for the
// same reason: it holds the engine-badge copy, and the directory sweep below
// only picks up .md/.html, so a .js file needs to be listed here to be swept.
//
// apps/shell/core/badge.js and apps/shell/core/settings.js are listed for the
// same reason as apps/web/app.js: they hold the product shell's engine-badge
// and engine-picker copy, which is user-facing prose that happens to live in a
// .js file. apps/shell/sw.js is listed because its header describes what does
// and does not work offline.
//
// apps/shell/core/onboarding.js is listed because onboarding is where the
// product makes its claims to someone who has not used it yet - "no account,
// no word limit" and what does or does not leave the device - and a welcome
// screen is the worst place for an over-claim to live unguarded.
const ALWAYS_SHIPPED = [
  "README.md",
  "src/cli.js",
  "apps/web/app.js",
  "apps/shell/core/badge.js",
  "apps/shell/core/onboarding.js",
  "apps/shell/core/settings.js",
  "apps/shell/sw.js"
];

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
  "src/cli.js",
  "apps/shell/index.html",
  "apps/shell/core/badge.js",
  "apps/shell/core/onboarding.js"
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

// The same point-of-use guard, for the product shell. apps/shell is a separate
// entry from apps/web and would otherwise be able to ship a quieter badge than
// the landing page's.
test("the shell's engine badge sits above the app and is honest in every engine state", async () => {
  const html = await readFile(join(ROOT, "apps/shell/index.html"), "utf8");

  const badgeAt = html.indexOf('id="engine-badge"');
  const mainAt = html.indexOf('<main class="app-main">');
  const pillAt = html.indexOf('id="pill"');
  assert.ok(badgeAt > -1, "the shell must render an engine badge");
  assert.ok(mainAt > -1 && pillAt > -1, "the shell must still have its main region and its pill");
  assert.ok(badgeAt < mainAt, "the badge must come BEFORE anything you can dictate into");

  const badge = html.slice(badgeAt, mainAt);
  assert.match(badge, /Web Speech/i, "the badge must name the engine in use");
  assert.match(badge, /Google/i, "the badge must name the third party that receives the audio");
  assert.doesNotMatch(
    badge,
    /\shidden[\s=>]/,
    "the badge must be visible on first paint, not revealed later"
  );

  const source = await readFile(join(ROOT, "apps/shell/core/badge.js"), "utf8");
  assert.match(
    source,
    /ENGINES\.webspeech/,
    "the shell badge must render the vendor from the shared engine registry, not a hardcoded literal"
  );
  assert.doesNotMatch(
    source,
    /badge\.(hidden|remove\(\))/,
    "the badge is non-dismissible: nothing may hide or remove it"
  );
  // The shell can be set to an engine that sends nothing. That state must say
  // so rather than keep warning about a vendor it is no longer using.
  assert.match(
    source,
    /no audio is sent to anyone for recognition/i,
    "the engine-set-to-none state must say that nothing is sent, not warn about a vendor"
  );

  // ...and the shell must actually be able to reach that state.
  const settings = await readFile(join(ROOT, "apps/shell/core/settings.js"), "utf8");
  assert.match(settings, /None — I type the words/, "the engine picker must offer an engine that sends nothing");
});

// Onboarding makes the product's claims to someone who has not used it yet,
// including the one sentence most likely to be written as an absolute: what
// you are not signing up for, and what does or does not leave the device. The
// engine-dependent half must be derived, not typed, for the same reason the
// badge's is - the shell can be set to an engine that sends nothing, and it
// defaults to one that sends audio for recognition. A hardcoded sentence would
// be wrong in one of those two states whichever way it was written.
test("the onboarding claim is built from the engine registry, not written into the screen", async () => {
  const badge = await readFile(join(ROOT, "apps/shell/core/badge.js"), "utf8");
  assert.match(badge, /export function privacyLine/, "badge.js must export the onboarding claim builder");

  const claim = badge.slice(badge.indexOf("export function privacyLine"), badge.indexOf("export function createBadge"));
  assert.match(claim, /ENGINES\.webspeech\.vendor/, "the vendor in the claim must come from the registry");
  assert.match(
    claim,
    /no audio is sent to anyone for recognition/i,
    "the engine-sends-nothing state must say so plainly"
  );
  assert.match(claim, /no account/i, "the claim must still make the point it exists to make");
  assert.match(claim, /no word limit/i, "the claim must still make the point it exists to make");

  const onboarding = await readFile(join(ROOT, "apps/shell/core/onboarding.js"), "utf8");
  assert.match(
    onboarding,
    /import \{ privacyLine \} from "\.\/badge\.js"/,
    "onboarding must use the derived claim rather than its own copy of it"
  );
  assert.doesNotMatch(
    onboarding,
    /nothing leaves your machine/i,
    "onboarding must not state the offline claim unconditionally: the shell's default engine sends audio for recognition"
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
