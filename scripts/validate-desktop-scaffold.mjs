// Desktop shell check.
//
// This used to assert only that some strings existed in some files, and it
// mentioned cargo without ever running it. The crate had therefore never
// compiled: `Cargo.toml` declared `[lib] name = "subtext_desktop"` while `src/`
// contained only `main.rs`, and every "working developer build" claim went
// unchallenged because nothing here ever asked cargo for an opinion.
//
// It now runs `cargo check` in apps/desktop/src-tauri. A non-compiling crate
// cannot pass `npm run desktop:check` again. Where cargo is absent - CI legs
// without a Rust toolchain, a contributor who only touched the docs - the check
// SKIPS with a clear message and still passes; it never silently pretends to
// have compiled something.
//
// Skip explicitly with SUBTEXT_SKIP_CARGO=1.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const CARGO_TIMEOUT_MS = 15 * 60 * 1000;

const config = JSON.parse(await readFile("apps/desktop/src-tauri/tauri.conf.json", "utf8"));
assert.equal(config.productName, "Subtext Desktop");
assert.equal(config.identifier, "ai.subtext.desktop");
assert.equal(config.build.frontendDist, "../src");
assert.equal(config.app.withGlobalTauri, true);
assert.match(config.app.security.csp, /default-src 'self'/);

// The shell ships as an unsigned build, so bundling is on and signing is not.
assert.equal(config.bundle.active, true);
assert.ok(Array.isArray(config.bundle.icon) && config.bundle.icon.length > 0,
  "bundle.icon must list the generated icon set");
for (const icon of config.bundle.icon) {
  assert.ok(existsSync(`apps/desktop/src-tauri/${icon}`),
    `missing icon ${icon} - run node apps/desktop/scripts/generate-icons.mjs`);
}

// Two windows: the settings window and the overlay pill. The pill must never be
// able to steal focus from whatever the user is typing into.
const windows = Object.fromEntries(config.app.windows.map((entry) => [entry.label, entry]));
assert.ok(windows.main, "tauri.conf.json must declare the 'main' window");
const pill = windows.pill;
assert.ok(pill, "tauri.conf.json must declare the 'pill' overlay window");
assert.equal(pill.url, "pill.html");
assert.equal(pill.focusable, false);
assert.equal(pill.decorations, false);
assert.equal(pill.transparent, true);
assert.equal(pill.alwaysOnTop, true);
assert.equal(pill.skipTaskbar, true);
assert.equal(pill.visible, false);

const capabilities = JSON.parse(
  await readFile("apps/desktop/src-tauri/capabilities/default.json", "utf8")
);
assert.deepEqual(capabilities.windows, ["main", "pill"]);

const cargo = await readFile("apps/desktop/src-tauri/Cargo.toml", "utf8");
assert.match(cargo, /name = "subtext-desktop"/);
assert.match(cargo, /tauri = \{ version = "2"/);
assert.match(cargo, /serde = \{ version = "1"/);
assert.match(cargo, /serde_json = "1"/);
// The [lib] target is what `tauri android init` / `tauri ios init` link against.
assert.match(cargo, /\[lib\][\s\S]*name = "subtext_desktop"/);

// Standard Tauri 2 layout: logic in lib.rs, a thin binary that calls run().
const lib = await readFile("apps/desktop/src-tauri/src/lib.rs", "utf8");
const main = await readFile("apps/desktop/src-tauri/src/main.rs", "utf8");
assert.match(lib, /pub fn run\(\)/);
assert.match(lib, /mobile_entry_point/);
assert.match(main, /subtext_desktop::run\(\)/);
assert.match(main, /windows_subsystem = "windows"/);

const commands = await readFile("apps/desktop/src-tauri/src/commands.rs", "utf8");
assert.match(commands, /#\[tauri::command\]/);
for (const command of [
  "subtext_load_config",
  "subtext_session",
  "subtext_analyze",
  "subtext_transcribe",
  "subtext_insert",
  "subtext_render",
  "subtext_stage_audio",
  "subtext_history_list",
  "subtext_history_append",
  "subtext_history_delete",
  "subtext_history_clear",
  "subtext_pill_show",
  "subtext_pill_hide",
  "subtext_pill_position",
  "subtext_hotkey_set",
  "subtext_hotkey_claim"
]) {
  assert.match(commands, new RegExp(`fn ${command}\\b`), `missing command ${command}`);
  assert.match(lib, new RegExp(`commands::${command}\\b`), `${command} is not in generate_handler!`);
}
assert.match(commands, /\.arg|"session"/);
assert.match(commands, /--transcript-command/);
assert.match(await readFile("apps/desktop/src-tauri/src/config.rs", "utf8"), /SUBTEXT_CLI_PATH/);
assert.match(await readFile("apps/desktop/src-tauri/src/config.rs", "utf8"), /subtext\/desktop-config\/v1/);
assert.match(await readFile("apps/desktop/src-tauri/src/config.rs", "utf8"), /fn normalize_target/);

// Hold-to-talk needs BOTH edges. A handler that only sees Pressed cannot end a
// turn on release, which is the whole gesture.
const hotkey = await readFile("apps/desktop/src-tauri/src/hotkey.rs", "utf8");
assert.match(hotkey, /ShortcutState::Pressed/);
assert.match(hotkey, /ShortcutState::Released/);
assert.match(hotkey, /HOLD_THRESHOLD_MS/);
assert.match(hotkey, /Code::Escape/);
assert.match(hotkey, /Ctrl\+Alt\+Y|DEFAULT_ACCELERATOR/);

// Every subprocess call is timeout-bounded (launch gate 3: never hang).
const sidecar = await readFile("apps/desktop/src-tauri/src/sidecar.rs", "utf8");
assert.match(sidecar, /tokio::time::timeout/);
assert.match(sidecar, /kill_on_drop/);

const html = await readFile("apps/desktop/src/index.html", "utf8");
assert.match(html, /Subtext Desktop/);
assert.match(html, /__TAURI__/);
assert.match(html, /subtext_load_config/);
assert.match(html, /subtext_session/);
assert.match(html, /subtext-desktop\.generated\.json/);
assert.match(html, /visible|Recording|Record Bounded Turn/);
assert.match(html, /subtext:\/\/hotkey/);

const pillHtml = await readFile("apps/desktop/src/pill.html", "utf8");
assert.match(pillHtml, /subtext:\/\/status/);
assert.match(pillHtml, /subtext:\/\/pill/);

const readme = await readFile("apps/desktop/README.md", "utf8");
assert.match(readme, /not a signed app/i);
assert.match(readme, /bounded/i);

// The window/command/event contract the shared shell at apps/shell/ targets.
const contract = await readFile("apps/desktop/CONTRACT.md", "utf8");
assert.match(contract, /frontendDist/);
assert.match(contract, /subtext_hotkey_claim/);
assert.match(contract, /subtext:\/\/hotkey/);

const cargoCheck = runCargoCheck();

process.stdout.write(`${JSON.stringify({
  schema: "subtext/desktop-scaffold-check/v1",
  ok: true,
  productName: config.productName,
  identifier: config.identifier,
  bundleActive: config.bundle.active,
  windows: Object.keys(windows),
  cargoCheck
}, null, 2)}\n`);

/**
 * Run `cargo check` in the Tauri crate. Returns a result record; throws (fails
 * the check) only when cargo is present and the crate does not compile.
 */
function runCargoCheck() {
  if (process.env.SUBTEXT_SKIP_CARGO === "1") {
    process.stderr.write("desktop:check: SUBTEXT_SKIP_CARGO=1 - skipping cargo check.\n");
    return { ran: false, skipped: "SUBTEXT_SKIP_CARGO=1" };
  }

  const probe = spawnSync("cargo", ["--version"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) {
    process.stderr.write(
      "desktop:check: cargo was not found on PATH, so the Rust shell was NOT compiled.\n" +
      "desktop:check: install the Rust toolchain from https://rustup.rs to check it here.\n"
    );
    return { ran: false, skipped: "cargo not on PATH" };
  }

  process.stderr.write("desktop:check: running cargo check in apps/desktop/src-tauri...\n");
  // stderr is captured rather than inherited so the thrown error can carry the
  // decisive lines. A CI log or a skimming contributor otherwise sees only
  // "exit code 101" at the bottom and has to scroll for the cause.
  const result = spawnSync("cargo", ["check", "--all-targets"], {
    cwd: "apps/desktop/src-tauri",
    encoding: "utf8",
    timeout: CARGO_TIMEOUT_MS,
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.stderr) process.stderr.write(result.stderr);

  if (result.error && result.error.code === "ETIMEDOUT") {
    throw new Error(`desktop:check: cargo check exceeded ${CARGO_TIMEOUT_MS} ms.`);
  }
  if (result.error) {
    throw new Error(`desktop:check: could not run cargo check: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(describeCargoFailure(result.status, result.stderr ?? ""));
  }

  return { ran: true, version: probe.stdout.trim() };
}

/**
 * Turn a failed `cargo check` into an error that names the cause. The most
 * common way this fails on a fresh Windows machine is not the crate at all:
 * the default toolchain is *-pc-windows-msvc, which needs the MSVC linker,
 * and without Visual Studio Build Tools `link.exe` resolves to nothing (or,
 * under Git Bash, to coreutils' `link`). That case gets a specific hint;
 * everything else gets the last lines cargo printed.
 */
function describeCargoFailure(status, stderr) {
  const lines = stderr.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean);
  const decisive = lines.filter((line) => /^error(\[|:)|linker|link\.exe|windres|dlltool|not found|panicked/i.test(line));
  const tail = (decisive.length ? decisive : lines).slice(-6).join("\n  ");

  const linkerProblem = /linker `?link\.exe`? not found|link\.exe|linking with|windres|dlltool|NotAttempted/i.test(stderr);
  const hint = linkerProblem
    ? "\n\ndesktop:check: this looks like a missing native toolchain, not a bug in the crate.\n" +
      "  On Windows either install Visual Studio Build Tools (Desktop development with C++), or use\n" +
      "  the GNU toolchain: `rustup toolchain install stable-x86_64-pc-windows-gnu` plus a MinGW\n" +
      "  distribution such as WinLibs for windres/dlltool, then run with\n" +
      "  RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-gnu. Set SUBTEXT_SKIP_CARGO=1 to skip this step."
    : "";

  return (
    `desktop:check: cargo check failed with exit code ${status}. The desktop crate did not compile.\n` +
    `  ${tail}${hint}`
  );
}
