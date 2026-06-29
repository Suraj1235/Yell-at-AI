import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const config = JSON.parse(await readFile("apps/desktop/src-tauri/tauri.conf.json", "utf8"));
assert.equal(config.productName, "Subtext Desktop");
assert.equal(config.identifier, "ai.subtext.desktop");
assert.equal(config.build.frontendDist, "../src");
assert.equal(config.app.withGlobalTauri, true);
assert.match(config.app.security.csp, /default-src 'self'/);
assert.equal(config.bundle.active, false);

const cargo = await readFile("apps/desktop/src-tauri/Cargo.toml", "utf8");
assert.match(cargo, /name = "subtext-desktop"/);
assert.match(cargo, /tauri = \{ version = "2"/);
assert.match(cargo, /serde = \{ version = "1"/);
assert.match(cargo, /serde_json = "1"/);

const rust = await readFile("apps/desktop/src-tauri/src/main.rs", "utf8");
assert.match(rust, /#\[tauri::command\]/);
assert.match(rust, /fn subtext_load_config/);
assert.match(rust, /fn subtext_session/);
assert.match(rust, /subtext\/desktop-config\/v1/);
assert.match(rust, /\.arg\("session"\)/);
assert.match(rust, /--transcript-command/);
assert.match(rust, /SUBTEXT_CLI_PATH/);
assert.match(rust, /normalize_target/);

const html = await readFile("apps/desktop/src/index.html", "utf8");
assert.match(html, /Subtext Desktop/);
assert.match(html, /__TAURI__/);
assert.match(html, /subtext_load_config/);
assert.match(html, /subtext_session/);
assert.match(html, /subtext-desktop\.generated\.json/);
assert.match(html, /Cmd\+Alt\+Ctrl\+Y/);
assert.match(html, /visible|Recording|Record Bounded Turn/);

const readme = await readFile("apps/desktop/README.md", "utf8");
assert.match(readme, /not a signed app/i);
assert.match(readme, /bounded/i);

process.stdout.write(`${JSON.stringify({
  schema: "subtext/desktop-scaffold-check/v1",
  ok: true,
  productName: config.productName,
  identifier: config.identifier
}, null, 2)}\n`);
