// Subtext Desktop - native Windows push-to-talk dev build.
//
// This is a working developer build, not a signed/installable product. A
// global hotkey (default Ctrl+Alt+Y) drives one bounded natural-speech turn by
// invoking the existing Node reference CLI as a child-process sidecar:
//
//   node <repo>/bin/subtext.js ptt --turns 1 --duration 4 \
//     --trigger none --transcript-command "..." --target paste
//
// The CLI records audio, bridges a transcript, runs prosody analysis, renders
// the enriched <vocal-context> prompt, and pastes it into the active app via
// the existing src/handoff/paste.js path. The desktop app owns only the hotkey,
// the sidecar invocation, and the visible listening/delivered/failed status.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIcon, TrayIconBuilder},
    AppHandle, Emitter, Manager,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_shell::ShellExt;

const DEFAULT_TRANSCRIPT_COMMAND: &str = "host-transcript --json {audio}";
const DEFAULT_CONFIG_PATH: &str = "apps/desktop/subtext-desktop.generated.json";
const DEFAULT_ACCELERATOR: &str = "Ctrl+Alt+Y";
const STATUS_EVENT: &str = "subtext://status";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionRequest {
    node_command: Option<String>,
    cli_path: Option<String>,
    transcript_command: Option<String>,
    duration: Option<String>,
    target: Option<String>,
    verbosity: Option<String>,
}

#[derive(Debug, Serialize)]
struct SessionResult {
    ok: bool,
    stdout: String,
    stderr: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoadConfigRequest {
    path: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DesktopConfig {
    schema: Option<String>,
    node_command: Option<String>,
    subtext_cli_path: Option<String>,
    transcript_command: Option<String>,
    duration: Option<serde_json::Value>,
    target: Option<String>,
    verbosity: Option<String>,
    hotkey: Option<HotkeyConfig>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct HotkeyConfig {
    enabled: Option<bool>,
    accelerator: Option<String>,
    mode: Option<String>,
}

/// Status of a push-to-talk turn, surfaced to the tray, window title, and UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PttStatus {
    Ready,
    Listening,
    Delivered,
    Failed,
}

impl PttStatus {
    fn label(self) -> &'static str {
        match self {
            PttStatus::Ready => "Ready",
            PttStatus::Listening => "Listening",
            PttStatus::Delivered => "Delivered",
            PttStatus::Failed => "Failed",
        }
    }
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StatusPayload {
    status: String,
    detail: String,
}

/// Shared runtime state. The busy flag prevents overlapping captures when the
/// hotkey is pressed again while a turn is still running; the tray handle (when
/// present) lets us update the tooltip as status changes.
struct PttState {
    busy: AtomicBool,
    accelerator: String,
    tray: std::sync::Mutex<Option<TrayIcon>>,
}

impl PttState {
    fn new(accelerator: String) -> Self {
        Self {
            busy: AtomicBool::new(false),
            accelerator,
            tray: std::sync::Mutex::new(None),
        }
    }
}

fn read_desktop_config(path_override: Option<String>) -> Result<DesktopConfig, String> {
    let path = path_override
        .filter(|value| !value.trim().is_empty())
        .or_else(|| std::env::var("SUBTEXT_DESKTOP_CONFIG").ok())
        .unwrap_or_else(|| DEFAULT_CONFIG_PATH.to_string());
    let text = fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read desktop config {path}: {error}"))?;
    let config: DesktopConfig = serde_json::from_str(&text)
        .map_err(|error| format!("Failed to parse desktop config {path}: {error}"))?;
    if config.schema.as_deref() != Some("subtext/desktop-config/v1") {
        return Err("Desktop config must use schema subtext/desktop-config/v1.".to_string());
    }
    Ok(config)
}

#[tauri::command]
fn subtext_load_config(request: LoadConfigRequest) -> Result<DesktopConfig, String> {
    read_desktop_config(request.path)
}

#[tauri::command]
fn subtext_session(request: SessionRequest) -> Result<SessionResult, String> {
    let node = request
        .node_command
        .or_else(|| std::env::var("SUBTEXT_NODE").ok())
        .unwrap_or_else(|| "node".to_string());
    let cli_path = request
        .cli_path
        .or_else(|| std::env::var("SUBTEXT_CLI_PATH").ok())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Missing Subtext CLI path.".to_string())?;
    let transcript_command = request
        .transcript_command
        .or_else(|| std::env::var("SUBTEXT_TRANSCRIPT_COMMAND").ok())
        .unwrap_or_else(|| DEFAULT_TRANSCRIPT_COMMAND.to_string());
    let duration = request.duration.unwrap_or_else(|| "4".to_string());
    let target = normalize_target(request.target.unwrap_or_else(|| "clipboard".to_string()))?;
    let verbosity = request.verbosity.unwrap_or_else(|| "full".to_string());

    let output = std::process::Command::new(node)
        .arg(cli_path)
        .arg("session")
        .arg("--duration")
        .arg(duration)
        .arg("--transcript-command")
        .arg(transcript_command)
        .arg("--target")
        .arg(target)
        .arg("--verbosity")
        .arg(verbosity)
        .output()
        .map_err(|error| format!("Failed to launch Subtext: {error}"))?;

    Ok(SessionResult {
        ok: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
    })
}

/// Resolve the push-to-talk invocation parameters, layering env vars and the
/// generated desktop config over built-in defaults. Mirrors `subtext_session`'s
/// resolution so the hotkey and the manual button behave the same way.
struct PttInvocation {
    node: String,
    cli_path: String,
    transcript_command: String,
    duration: String,
    verbosity: String,
}

fn resolve_ptt_invocation() -> Result<PttInvocation, String> {
    let config = read_desktop_config(None).ok();

    let node = std::env::var("SUBTEXT_NODE")
        .ok()
        .or_else(|| config.as_ref().and_then(|c| c.node_command.clone()))
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "node".to_string());

    let cli_path = std::env::var("SUBTEXT_CLI_PATH")
        .ok()
        .or_else(|| config.as_ref().and_then(|c| c.subtext_cli_path.clone()))
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            "Missing Subtext CLI path. Set SUBTEXT_CLI_PATH or subtextCliPath in the desktop config."
                .to_string()
        })?;

    let transcript_command = std::env::var("SUBTEXT_TRANSCRIPT_COMMAND")
        .ok()
        .or_else(|| config.as_ref().and_then(|c| c.transcript_command.clone()))
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_TRANSCRIPT_COMMAND.to_string());

    let duration = config
        .as_ref()
        .and_then(|c| c.duration.as_ref())
        .map(json_value_to_string)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "4".to_string());

    let verbosity = config
        .as_ref()
        .and_then(|c| c.verbosity.clone())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "full".to_string());

    Ok(PttInvocation {
        node,
        cli_path,
        transcript_command,
        duration,
        verbosity,
    })
}

fn json_value_to_string(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}

/// Update the tray tooltip, window title, and emit a status event to the UI.
fn set_status(app: &AppHandle, status: PttStatus, detail: &str) {
    let state = app.state::<Arc<PttState>>();
    let tooltip = format!(
        "Subtext Desktop - {} (press {})",
        status.label(),
        state.accelerator
    );

    if let Ok(guard) = state.tray.lock() {
        if let Some(tray) = guard.as_ref() {
            let _ = tray.set_tooltip(Some(tooltip.as_str()));
        }
    }

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_title(&format!("Subtext Desktop - {}", status.label()));
    }

    let _ = app.emit(
        STATUS_EVENT,
        StatusPayload {
            status: status.label().to_string(),
            detail: detail.to_string(),
        },
    );
}

/// Fire one bounded push-to-talk turn through the Node sidecar. Guards against
/// overlapping runs and reports terminal status back to the UI/tray.
fn trigger_ptt(app: &AppHandle) {
    let state = app.state::<Arc<PttState>>().inner().clone();

    // Reject re-entry while a turn is already running.
    if state
        .busy
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        set_status(app, PttStatus::Listening, "A capture is already in progress.");
        return;
    }

    let invocation = match resolve_ptt_invocation() {
        Ok(invocation) => invocation,
        Err(error) => {
            state.busy.store(false, Ordering::SeqCst);
            set_status(app, PttStatus::Failed, &error);
            return;
        }
    };

    set_status(app, PttStatus::Listening, "Recording a bounded turn...");

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        let shell = app_handle.shell();
        let result = shell
            .command(&invocation.node)
            .args([
                invocation.cli_path.as_str(),
                "ptt",
                "--turns",
                "1",
                "--duration",
                invocation.duration.as_str(),
                "--trigger",
                "none",
                "--transcript-command",
                invocation.transcript_command.as_str(),
                "--target",
                "paste",
                "--verbosity",
                invocation.verbosity.as_str(),
            ])
            .output()
            .await;

        match result {
            Ok(output) if output.status.success() => {
                set_status(
                    &app_handle,
                    PttStatus::Delivered,
                    "Enriched prompt pasted into the active app.",
                );
            }
            Ok(output) => {
                let stderr = String::from_utf8_lossy(&output.stderr);
                let detail = first_nonempty_line(&stderr)
                    .unwrap_or_else(|| "Subtext sidecar exited with a non-zero status.".to_string());
                set_status(&app_handle, PttStatus::Failed, &detail);
            }
            Err(error) => {
                set_status(
                    &app_handle,
                    PttStatus::Failed,
                    &format!("Failed to launch Subtext sidecar: {error}"),
                );
            }
        }

        state.busy.store(false, Ordering::SeqCst);
    });
}

fn first_nonempty_line(text: &str) -> Option<String> {
    text.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(|line| line.to_string())
}

/// Parse the configured accelerator, falling back to the built-in default if
/// the string is missing or unparseable.
fn resolve_shortcut() -> (Shortcut, String) {
    let configured = read_desktop_config(None)
        .ok()
        .and_then(|config| config.hotkey)
        .and_then(|hotkey| hotkey.accelerator)
        .filter(|value| !value.trim().is_empty());

    if let Some(accelerator) = configured {
        if let Ok(shortcut) = accelerator.parse::<Shortcut>() {
            return (shortcut, accelerator);
        }
        eprintln!(
            "subtext-desktop: could not parse accelerator '{accelerator}', falling back to {DEFAULT_ACCELERATOR}."
        );
    }

    (
        Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyY),
        DEFAULT_ACCELERATOR.to_string(),
    )
}

fn build_tray(app: &AppHandle) -> Option<TrayIcon> {
    // In a dev build without a bundled icon there may be no default icon; skip
    // the tray gracefully rather than panicking, and rely on the window title.
    let icon = app.default_window_icon()?.clone();

    let show_item = MenuItem::with_id(app, "show", "Show window", true, None::<&str>).ok()?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>).ok()?;
    let menu = Menu::with_items(app, &[&show_item, &quit_item]).ok()?;

    TrayIconBuilder::with_id("subtext-tray")
        .icon(icon)
        .tooltip("Subtext Desktop - Ready (press Ctrl+Alt+Y)")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .build(app)
        .ok()
}

fn main() {
    let (shortcut, accelerator) = resolve_shortcut();
    let state = Arc::new(PttState::new(accelerator));
    let handler_shortcut = shortcut;

    tauri::Builder::default()
        .manage(state)
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, triggered, event| {
                    if triggered == &handler_shortcut && event.state() == ShortcutState::Pressed {
                        trigger_ptt(app);
                    }
                })
                .build(),
        )
        .setup(move |app| {
            let handle = app.handle().clone();

            if let Some(tray) = build_tray(&handle) {
                let state = handle.state::<Arc<PttState>>();
                if let Ok(mut guard) = state.tray.lock() {
                    *guard = Some(tray);
                }
            }

            // Register the push-to-talk accelerator. A failure here (for
            // example, the shortcut is already claimed by another app) should
            // be surfaced, not silently swallowed.
            if let Err(error) = handle.global_shortcut().register(shortcut) {
                eprintln!("subtext-desktop: failed to register global shortcut: {error}");
                set_status(
                    &handle,
                    PttStatus::Failed,
                    &format!("Could not register the global hotkey: {error}"),
                );
            } else {
                set_status(&handle, PttStatus::Ready, "Idle. Press the hotkey to capture.");
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![subtext_load_config, subtext_session])
        .run(tauri::generate_context!())
        .expect("error while running Subtext desktop");
}

fn normalize_target(value: String) -> Result<String, String> {
    let normalized = value.trim().to_lowercase();
    match normalized.as_str() {
        "stdout" | "clipboard" | "paste" => Ok(normalized),
        _ => Err("Desktop scaffold target must be stdout, clipboard, or paste.".to_string()),
    }
}
