// The desktop wiring of the shared shell: the Tauri adapter's pure pieces, the
// per-app insertion rule, the overlay's parity with the in-window pill, and the
// honesty of the badge / onboarding copy for a local recogniser.

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { classifyTarget, resolveInsertion, targetLabel, RULE_DEFAULTS } from "../apps/shell/core/targets.js";
import { privacyLine, engineInfo } from "../apps/shell/core/badge.js";
import { describeEngine, encodeWav, resample } from "../apps/shell/platform/platform.tauri.js";
import { ENGINES } from "../src/transcribe/engines.js";
import { parseWav } from "../src/audio/wav.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFile(join(ROOT, relative), "utf8");

test("AI apps get the block, everything else gets plain text, by default", () => {
  assert.deepEqual(RULE_DEFAULTS, { ai: "block", other: "text" });
  for (const process of ["Code.exe", "Cursor.exe", "claude.exe", "ChatGPT.exe", "WindowsTerminal.exe", "pwsh.exe"]) {
    assert.equal(classifyTarget({ process, title: "" }), "ai", process);
  }
  assert.equal(classifyTarget({ process: "chrome.exe", title: "Claude — Google Chrome" }), "ai");
  assert.equal(classifyTarget({ process: "chrome.exe", title: "Online banking — Google Chrome" }), "other");
  assert.equal(classifyTarget({ process: "slack.exe", title: "general | Slack" }), "other");
  assert.equal(classifyTarget(null), null);
  assert.equal(classifyTarget({ process: "", title: "" }), null);

  assert.equal(resolveInsertion({ target: { process: "Code.exe" } }).rule, "block");
  assert.equal(resolveInsertion({ target: { process: "slack.exe" } }).rule, "text");
  assert.equal(resolveInsertion({ target: { process: "slack.exe" }, settings: { insertOther: "ask" } }).rule, "ask");
  assert.equal(resolveInsertion({ target: { process: "Code.exe" }, settings: { insertAi: "text" } }).rule, "text");
  // An unknown value never silently changes what is inserted.
  assert.equal(resolveInsertion({ target: { process: "slack.exe" }, settings: { insertOther: "shout" } }).rule, "text");
  // No foreground information (macOS/Linux today, the web always): the block,
  // which is what the web build has always handed over.
  assert.equal(resolveInsertion({ target: null }).rule, "block");
  assert.equal(targetLabel({ process: "Code.exe", title: "x" }), "Code");
});

test("the engine egress drives the badge, whether the CLI reports an id or a descriptor", () => {
  // `subtext dictate --format json` reports the engine as an id string today.
  assert.equal(describeEngine("whisper", "whisper").egress, "none");
  assert.equal(describeEngine({ id: "cloud", egress: "vendor", vendor: "Groq" }, "whisper").egress, "vendor");
  assert.equal(describeEngine(null, "whisper").egress, ENGINES.whisper.egress);
  assert.equal(describeEngine("mystery", "whisper").egress, "unknown");

  assert.equal(engineInfo("whisper").egress, "none");
  assert.equal(engineInfo("whisper", { id: "cloud", egress: "vendor", vendor: "Groq" }).vendor, "Groq");
});

test("the onboarding claim is true for the local desktop recogniser", () => {
  const local = privacyLine({ canCapture: true, engine: "whisper" });
  assert.match(local, /no account/i);
  assert.match(local, /no audio is sent to anyone for recognition/i);
  assert.match(local, /whisper\.cpp/);
  assert.doesNotMatch(local, /you type the words/i, "whisper recognises the words; the user does not type them");
  assert.doesNotMatch(local, /Google/);

  const web = privacyLine({ canCapture: true, engine: "webspeech" });
  assert.match(web, new RegExp(ENGINES.webspeech.vendor.replace(/[()]/g, "\\$&")));

  const reportedVendor = privacyLine({ canCapture: true, engine: "whisper", reported: { id: "cloud", egress: "vendor", vendor: "Groq" } });
  assert.match(reportedVendor, /Groq/, "if the host reports a vendor engine ran, the claim must follow it");
});

test("the WAV handed to whisper is 16 kHz mono PCM that the core parses back", () => {
  const rate = 48000;
  const seconds = 0.5;
  const samples = new Float32Array(rate * seconds);
  for (let i = 0; i < samples.length; i += 1) samples[i] = 0.5 * Math.sin((2 * Math.PI * 220 * i) / rate);

  const down = resample(samples, rate, 16000);
  assert.equal(down.length, 16000 * seconds);
  const bytes = encodeWav(down, 16000);
  const parsed = parseWav(Buffer.from(bytes));
  assert.equal(parsed.sampleRate, 16000);
  assert.equal(parsed.samples.length, down.length);
  const peak = parsed.samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  assert.ok(peak > 0.4 && peak <= 0.51, `a 0.5-amplitude tone should survive decimation, got ${peak}`);
});

test("the overlay pill is the in-window pill, byte for byte", async () => {
  const pillBlock = (html) => {
    const start = html.indexOf('<div class="pill" id="pill"');
    const end = html.indexOf('<p class="pill-warn"', start);
    assert.ok(start > -1 && end > start, "pill block not found");
    return html.slice(start, end);
  };
  const main = await read("apps/shell/index.html");
  const overlay = await read("apps/shell/pill.html");
  assert.equal(pillBlock(overlay), pillBlock(main));
  assert.match(overlay, /href="\.\/shell\.css"/, "the overlay must use the shell's own stylesheet");
  assert.match(overlay, /src="\.\/core\/overlay\.js"/);

  const driver = await read("apps/shell/core/overlay.js");
  assert.match(driver, /import \{ createPill \} from "\.\/pill\.js"/, "the overlay must run the same pill module");
  assert.doesNotMatch(driver, /getUserMedia|subtext_insert|setFocus/, "the overlay never captures, inserts or takes focus");
});

test("the desktop windows point at the shell, and the stage carries what it imports", async () => {
  const config = JSON.parse(await read("apps/desktop/src-tauri/tauri.conf.json"));
  assert.equal(config.build.frontendDist, "gen/frontend");
  const urls = Object.fromEntries(config.app.windows.map((window) => [window.label, window.url]));
  assert.equal(urls.main, "shell/index.html");
  assert.equal(urls.pill, "shell/pill.html");
  for (const url of Object.values(urls)) assert.ok(existsSync(join(ROOT, "apps", url)), url);
  assert.doesNotMatch(config.app.security.csp, /unsafe-eval/);
  assert.ok(!existsSync(join(ROOT, "apps/desktop/src")), "the scaffold frontend is retired");

  // Every module the shell imports from the vendor tree must be inside the
  // staged tree, or the desktop build 404s its own engine.
  const engine = await read("apps/shell/core/engine.js");
  for (const [, path] of engine.matchAll(/from "\.\.\/\.\.\/(web\/vendor\/[^"]+)"/g)) {
    assert.ok(existsSync(join(ROOT, "apps", path)), path);
  }
  const build = await read("apps/desktop/src-tauri/build.rs");
  assert.match(build, /"\.\.\/\.\.\/shell", "shell"/);
  assert.match(build, /"\.\.\/\.\.\/web\/vendor", "web\/vendor"/);
});

test("the Tauri adapter keeps the contract's non-negotiables", async () => {
  const adapter = await read("apps/shell/platform/platform.tauri.js");
  // Claim on boot, after subscribing, so the first press is not lost.
  const subscribe = adapter.indexOf('listen("subtext://hotkey"');
  const claim = adapter.indexOf('invoke("subtext_hotkey_claim", { claimed: true })');
  assert.ok(subscribe > -1 && claim > subscribe, "subscribe to subtext://hotkey, then claim");
  // pasted:false is a copy that worked, never a thrown error.
  assert.match(adapter, /ok: Boolean\(result\.clipboard\)/);
  assert.match(adapter, /method: result\.pasted \? "focused-app" : "clipboard"/);
  // Only offline engines on the desktop until cloud has its own consent flow.
  assert.match(adapter, /DESKTOP_ENGINES = \["whisper", "none"\]/);

  const selector = await read("apps/shell/platform/index.js");
  assert.match(selector, /__TAURI__/);
  assert.match(selector, /platform\.tauri\.js/);
  assert.match(selector, /platform\.web\.js/);
  const app = await read("apps/shell/core/app.js");
  assert.match(app, /from "\.\.\/platform\/index\.js"/, "the shell must go through the selector");
});
