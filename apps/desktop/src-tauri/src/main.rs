// Subtext Desktop - thin binary entrypoint.
//
// Everything lives in `src/lib.rs` behind `subtext_desktop::run()`. That is the
// standard Tauri 2 layout, and it is not cosmetic: `tauri android init` and
// `tauri ios init` generate mobile entrypoints that link against the `[lib]`
// target and call `run()` themselves. Collapsing the library back into this
// binary would make the crate desktop-only.
//
// Where the pieces went, for anyone landing here first:
//
//   src/lib.rs       `run()`: builder wiring, tray, plugin registration.
//   src/commands.rs  the `#[tauri::command]` surface - subtext_load_config,
//                    subtext_session, subtext_analyze, subtext_transcribe,
//                    subtext_insert, subtext_render, subtext_stage_audio,
//                    subtext_history_*, subtext_pill_*, subtext_hotkey_*.
//   src/config.rs    the `subtext/desktop-config/v1` file and the resolution
//                    order over it: explicit argument -> environment variable
//                    (SUBTEXT_CLI_PATH, SUBTEXT_NODE, SUBTEXT_TRANSCRIPT_COMMAND)
//                    -> config file -> built-in default.
//   src/hotkey.rs    press-and-hold: capture starts on the press edge and ends
//                    on release, with tap-to-toggle and Esc to cancel.
//   src/pill.rs      the frameless, non-focusable overlay window.
//   src/sidecar.rs   timeout-bounded child-process calls into the Node CLI.
//   src/turn.rs      the fallback turn (`ptt ... --transcript-command ...`) that
//                    runs while no frontend has claimed capture.
//   src/history.rs   local-only turn history.
//   src/status.rs    one status path for the tray, the title, and the pill.
//
// The window / command / event contract is documented in apps/desktop/CONTRACT.md.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    subtext_desktop::run();
}
