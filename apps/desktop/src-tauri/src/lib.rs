// Subtext Desktop - the native shell for Yell-at-AI.
//
// The product loop is Wispr-Flow shaped: hold `Ctrl+Alt+Y`, a small overlay pill
// appears near the cursor, you speak, you release, and your words land in
// whatever app has focus with the `vocalcontext/v1` evidence block attached.
//
// This crate owns only the native surface:
//
//   * the press-and-hold global hotkey (both edges, plus Esc to cancel),
//   * the frameless always-on-top overlay pill,
//   * the tray, autostart, and status,
//   * timeout-bounded child-process calls into the Node reference CLI,
//   * local-only turn history.
//
// Recording, transcription, prosody analysis, and prompt rendering all stay in
// the zero-dependency Node core, invoked as a child process. Bundling Node as a
// true Tauri `externalBin` is a later task.
//
// The window / command / event contract this exposes is documented in
// apps/desktop/CONTRACT.md, so the shared shell in `apps/shell/` can replace
// `apps/desktop/src/` by pointing `frontendDist` at it.

mod commands;
mod config;
mod history;
mod hotkey;
mod pill;
mod sidecar;
mod status;
mod turn;

use std::sync::Arc;

use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::GlobalShortcutExt;

use crate::history::History;
use crate::status::{set_status, PttStatus, StatusState};

#[cfg(desktop)]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
#[cfg(desktop)]
use tauri::tray::{TrayIcon, TrayIconBuilder, TrayIconEvent};

/// Library entrypoint. `src/main.rs` calls this, and so do the generated
/// `tauri android init` / `tauri ios init` mobile entrypoints.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let (shortcut, accelerator) = hotkey::resolve_shortcut();

    tauri::Builder::default()
        // All shared state is managed HERE, not in `setup`. Windows declared in
        // tauri.conf.json are created before `setup` runs, so the webview can
        // invoke a command while setup is still executing; state managed late
        // panics that call with "state() called before manage()".
        .manage(Arc::new(StatusState::new(accelerator.clone())))
        .manage(Arc::new(hotkey::HotkeyRuntime::new(
            accelerator,
            Some(shortcut),
        )))
        .manage(History::new())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, triggered, event| {
                    hotkey::handle(app, triggered, event.state())
                })
                .build(),
        )
        .setup(move |app| {
            let handle = app.handle().clone();

            pill::configure(&handle);

            #[cfg(desktop)]
            {
                let state = handle.state::<Arc<StatusState>>().inner().clone();
                if let Some(tray) = build_tray(&handle) {
                    if let Ok(mut guard) = state.tray.lock() {
                        *guard = Some(tray);
                    }
                }
            }

            register_capture_hotkey(&handle, shortcut);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::subtext_load_config,
            commands::subtext_session,
            commands::subtext_stage_audio,
            commands::subtext_discard_audio,
            commands::subtext_analyze,
            commands::subtext_render,
            commands::subtext_transcribe,
            commands::subtext_insert,
            commands::subtext_history_list,
            commands::subtext_history_append,
            commands::subtext_history_delete,
            commands::subtext_history_clear,
            commands::subtext_history_path,
            commands::subtext_pill_show,
            commands::subtext_pill_hide,
            commands::subtext_pill_position,
            commands::subtext_status_set,
            commands::subtext_hotkey_status,
            commands::subtext_hotkey_set,
            commands::subtext_hotkey_claim,
            commands::subtext_autostart_status,
            commands::subtext_autostart_set,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Subtext desktop");
}

/// Register the capture accelerator. A shortcut the OS refuses - already owned
/// by another app, reserved by the shell - is surfaced in the status banner and
/// the tray, never swallowed.
fn register_capture_hotkey(app: &AppHandle, shortcut: tauri_plugin_global_shortcut::Shortcut) {
    match app.global_shortcut().register(shortcut) {
        Ok(()) => set_status(
            app,
            PttStatus::Ready,
            "Idle. Hold the hotkey to dictate, tap it to toggle, press Esc to cancel.",
        ),
        Err(error) => {
            eprintln!("subtext-desktop: failed to register global shortcut: {error}");
            set_status(
                app,
                PttStatus::Failed,
                &format!(
                    "The system refused the hotkey {}: {error}. Pick another one in settings.",
                    app.state::<Arc<StatusState>>().accelerator()
                ),
            );
        }
    }
}

#[cfg(desktop)]
fn build_tray(app: &AppHandle) -> Option<TrayIcon> {
    let icon = app.default_window_icon()?.clone();

    // A disabled first item is the status readout; the rest are actions.
    let status_item =
        MenuItem::with_id(app, "status", "Status: Ready", false, None::<&str>).ok()?;
    let show_item = MenuItem::with_id(app, "show", "Open Subtext", true, None::<&str>).ok()?;
    let history_item =
        MenuItem::with_id(app, "history", "Open history folder", true, None::<&str>).ok()?;
    let top_separator = PredefinedMenuItem::separator(app).ok()?;
    let bottom_separator = PredefinedMenuItem::separator(app).ok()?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>).ok()?;
    let menu = Menu::with_items(
        app,
        &[
            &status_item,
            &top_separator,
            &show_item,
            &history_item,
            &bottom_separator,
            &quit_item,
        ],
    )
    .ok()?;

    if let Ok(mut guard) = app.state::<Arc<StatusState>>().tray_status_item.lock() {
        *guard = Some(status_item);
    }

    TrayIconBuilder::with_id("subtext-tray")
        .icon(icon)
        .tooltip("Subtext Desktop - Ready")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "history" => reveal_history(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::DoubleClick { .. } = event {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)
        .ok()
}

#[cfg(desktop)]
fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Open the folder that holds the local history file. Nothing here is uploaded;
/// the point of the menu item is that the user can see that for themselves.
#[cfg(desktop)]
fn reveal_history(app: &AppHandle) {
    let Ok(path) = app.state::<History>().location(app) else {
        return;
    };
    let Some(folder) = path.parent().map(|parent| parent.to_path_buf()) else {
        return;
    };
    let _ = std::fs::create_dir_all(&folder);

    #[cfg(target_os = "windows")]
    let opener: (&str, Vec<String>) = ("explorer", vec![folder.display().to_string()]);
    #[cfg(target_os = "macos")]
    let opener: (&str, Vec<String>) = ("open", vec![folder.display().to_string()]);
    #[cfg(all(unix, not(target_os = "macos")))]
    let opener: (&str, Vec<String>) = ("xdg-open", vec![folder.display().to_string()]);
    #[cfg(not(any(windows, unix)))]
    let opener: (&str, Vec<String>) = ("", Vec::new());

    if opener.0.is_empty() {
        return;
    }

    tauri::async_runtime::spawn(async move {
        let _ = sidecar::run(opener.0, &opener.1, None, 10_000).await;
    });
}
