// Subtext Desktop - thin binary entrypoint.
//
// Everything lives in `src/lib.rs` behind `subtext_desktop::run()`. That is the
// standard Tauri 2 layout, and it is not cosmetic: `tauri android init` and
// `tauri ios init` generate mobile entrypoints that link against the `[lib]`
// target and call `run()` themselves. Collapsing the library back into this
// binary would make the crate desktop-only.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    subtext_desktop::run();
}
