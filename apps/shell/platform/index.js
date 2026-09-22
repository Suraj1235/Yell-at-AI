// Adapter selection. No build step: the shell is the same files everywhere,
// and the host announces itself. Tauri injects `window.__TAURI__` before any
// page script runs (`app.withGlobalTauri` in tauri.conf.json); a browser never
// has it. Only the chosen adapter is loaded, so the web build never fetches the
// desktop one and vice versa.

const { default: platform } = globalThis.__TAURI__?.core?.invoke
  ? await import("./platform.tauri.js")
  : await import("./platform.web.js");

export default platform;
