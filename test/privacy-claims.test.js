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
