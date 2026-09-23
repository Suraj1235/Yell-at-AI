// The Tauri command surface - the Rust half of the `PlatformAdapter` contract
// that `apps/shell` targets. See apps/desktop/CONTRACT.md for the full spec.
//
// Two rules hold across every command here:
//
//   * Every subprocess call is timeout-bounded (launch gate 3).
//   * A failure after capture never loses the user's words (launch gate 1):
//     `subtext_insert` puts the text on the clipboard BEFORE it tries the
//     keystroke, and says so when the keystroke does not land.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;

use crate::config::{self, DesktopConfig, LoadConfigRequest};
use crate::history::{History, HistoryEntry, NewHistoryEntry};
use crate::hotkey::{self, HotkeyBindRequest, HotkeyRuntime, HotkeyStatus};
use crate::pill::{self, PillAnchor, PillPlacement};
use crate::sidecar;
use crate::status::{self, PttStatus};

// --- config ---------------------------------------------------------------

#[tauri::command]
pub fn subtext_load_config(request: LoadConfigRequest) -> Result<DesktopConfig, String> {
    config::read_desktop_config(request.path)
}

// --- the original one-shot session command --------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRequest {
    pub node_command: Option<String>,
    pub cli_path: Option<String>,
    pub transcript_command: Option<String>,
    pub duration: Option<String>,
    pub target: Option<String>,
    pub verbosity: Option<String>,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionResult {
    pub ok: bool,
    pub stdout: String,
    pub stderr: String,
}

/// Record one turn with the CLI's own capture path. Preserved verbatim from the
/// original scaffold (same arguments, same resolution order) so the manual
/// "Record Bounded Turn" button keeps working.
#[tauri::command]
pub async fn subtext_session(request: SessionRequest) -> Result<SessionResult, String> {
    let config = config::read_desktop_config_opt();
    let node = config::resolve_node(request.node_command, config.as_ref());
    let cli_path = config::resolve_cli_path(request.cli_path, config.as_ref())?;
    let transcript_command =
        config::resolve_transcript_command(request.transcript_command, config.as_ref());
    let duration = config::resolve_duration(request.duration, config.as_ref());
    let target = config::normalize_target(request.target.unwrap_or_else(|| "clipboard".to_string()))?;
    let verbosity = config::resolve_verbosity(request.verbosity, config.as_ref());

    let recording_ms = duration
        .trim()
        .parse::<f64>()
        .map(|seconds| (seconds.max(0.0) * 1_000.0) as u64)
        .unwrap_or(4_000);
    let timeout_ms = sidecar::clamp_timeout(
        request.timeout_ms,
        recording_ms + sidecar::TRANSCRIBE_TIMEOUT_MS,
    );

    let output = sidecar::run_cli(
        &node,
        &cli_path,
        vec![
            "session".into(),
            "--duration".into(),
            duration,
            "--transcript-command".into(),
            transcript_command,
            "--target".into(),
            target,
            "--verbosity".into(),
            verbosity,
        ],
        None,
        timeout_ms,
    )
    .await?;

    Ok(SessionResult {
        ok: output.ok,
        stdout: output.stdout,
        stderr: output.stderr,
    })
}

// --- staging WebView captures --------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StageAudioRequest {
    pub bytes: Vec<u8>,
    /// Defaults to "wav"; the CLI's analysis path expects WAV.
    pub extension: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StagedAudio {
    pub path: String,
    pub bytes: usize,
}

/// Capture happens in the WebView (`getUserMedia` + the existing JS WAV
/// encoder), so the recording arrives here as bytes and has to reach disk
/// before the CLI can read it. It lands in the app cache directory, never a
/// shared temp folder, and `subtext_discard_audio` refuses to delete anything
/// outside it.
#[tauri::command]
pub fn subtext_stage_audio(
    app: AppHandle,
    request: StageAudioRequest,
) -> Result<StagedAudio, String> {
    if request.bytes.is_empty() {
        return Err("The recording was empty - no audio was captured.".to_string());
    }
    let extension = request
        .extension
        .unwrap_or_else(|| "wav".to_string())
        .to_lowercase();
    if extension.is_empty() || !extension.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("Audio extension must be alphanumeric.".to_string());
    }

    let directory = captures_dir(&app)?;
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create {}: {error}", directory.display()))?;
    let path = directory.join(format!("turn-{}.{extension}", crate::history::now_ms()));
    std::fs::write(&path, &request.bytes)
        .map_err(|error| format!("Could not stage the recording: {error}"))?;

    Ok(StagedAudio {
        path: path.display().to_string(),
        bytes: request.bytes.len(),
    })
}

#[tauri::command]
pub fn subtext_discard_audio(app: AppHandle, path: String) -> Result<bool, String> {
    let directory = captures_dir(&app)?;
    let target = std::path::PathBuf::from(&path);
    if !target.starts_with(&directory) {
        return Err("Refusing to delete a file outside the capture directory.".to_string());
    }
    match std::fs::remove_file(&target) {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!("Could not delete {path}: {error}")),
    }
}

fn captures_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_cache_dir()
        .map_err(|error| format!("Could not resolve the app cache directory: {error}"))
        .map(|dir| dir.join("captures"))
}

// --- analyze --------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeRequest {
    /// Path to the WAV the frontend just recorded.
    pub wav_path: String,
    pub text: String,
    pub verbosity: Option<String>,
    pub profile: Option<String>,
    pub baseline: Option<String>,
    /// Also render the prompt text (one extra bounded CLI call). Default true.
    pub render: Option<bool>,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyzeResult {
    pub contract: serde_json::Value,
    pub prompt: Option<String>,
    pub verbosity: String,
}

/// Prosody analysis. Always local, always model-free - this path has no network
/// call in it on any platform.
#[tauri::command]
pub async fn subtext_analyze(request: AnalyzeRequest) -> Result<AnalyzeResult, String> {
    let config = config::read_desktop_config_opt();
    let node = config::resolve_node(None, config.as_ref());
    let cli_path = config::resolve_cli_path(None, config.as_ref())?;
    let verbosity = config::resolve_verbosity(request.verbosity, config.as_ref());
    let timeout_ms = sidecar::clamp_timeout(request.timeout_ms, sidecar::ANALYZE_TIMEOUT_MS);

    let mut args: Vec<String> = vec![
        "analyze".into(),
        "--audio".into(),
        request.wav_path,
        "--text".into(),
        request.text,
        "--format".into(),
        "json".into(),
    ];
    if let Some(profile) = request.profile.filter(|value| !value.trim().is_empty()) {
        args.push("--profile".into());
        args.push(profile);
    }
    if let Some(baseline) = request.baseline.filter(|value| !value.trim().is_empty()) {
        args.push("--baseline".into());
        args.push(baseline);
    }

    let output = sidecar::run_cli(&node, &cli_path, args, None, timeout_ms).await?;
    if !output.ok {
        return Err(output.failure_detail("Subtext analysis failed."));
    }
    let contract = sidecar::parse_json("analyze", &output)?;

    let prompt = if request.render.unwrap_or(true) {
        Some(render_contract(&node, &cli_path, &contract, &verbosity, timeout_ms).await?)
    } else {
        None
    };

    Ok(AnalyzeResult {
        contract,
        prompt,
        verbosity,
    })
}

// --- render ---------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderRequest {
    pub contract: serde_json::Value,
    pub verbosity: Option<String>,
    pub timeout_ms: Option<u64>,
}

/// Turn a saved `vocalcontext/v1` contract back into prompt text.
#[tauri::command]
pub async fn subtext_render(request: RenderRequest) -> Result<String, String> {
    let config = config::read_desktop_config_opt();
    let node = config::resolve_node(None, config.as_ref());
    let cli_path = config::resolve_cli_path(None, config.as_ref())?;
    let verbosity = config::resolve_verbosity(request.verbosity, config.as_ref());
    let timeout_ms = sidecar::clamp_timeout(request.timeout_ms, sidecar::RENDER_TIMEOUT_MS);
    render_contract(&node, &cli_path, &request.contract, &verbosity, timeout_ms).await
}

/// The CLI's `render` reads a contract from stdin, so this needs no temp file.
async fn render_contract(
    node: &str,
    cli_path: &str,
    contract: &serde_json::Value,
    verbosity: &str,
    timeout_ms: u64,
) -> Result<String, String> {
    let payload = serde_json::to_string(contract)
        .map_err(|error| format!("Could not serialize the contract: {error}"))?;
    let output = sidecar::run_cli(
        node,
        cli_path,
        vec!["render".into(), "--verbosity".into(), verbosity.to_string()],
        Some(payload),
        timeout_ms,
    )
    .await?;
    if !output.ok {
        return Err(output.failure_detail("Rendering the enriched prompt failed."));
    }
    Ok(output.stdout)
}

// --- transcribe -----------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeRequest {
    /// Path to a WAV on disk. The frontend records in the WebView and writes it.
    pub wav_path: String,
    /// Engine id from src/transcribe/engines.js: whisper | cloud | command | ...
    pub engine: Option<String>,
    pub provider: Option<String>,
    pub verbosity: Option<String>,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeResult {
    pub text: String,
    /// The engine descriptor the CLI reports, including its `egress` field.
    pub engine: serde_json::Value,
    pub contract: serde_json::Value,
}

/// Transcribe a recorded WAV and analyse it in one bounded CLI call.
///
/// `dictate --audio <wav>` runs transcription and prosody analysis together, so
/// the round trip is one Node start-up rather than two.
#[tauri::command]
pub async fn subtext_transcribe(request: TranscribeRequest) -> Result<TranscribeResult, String> {
    let config = config::read_desktop_config_opt();
    let node = config::resolve_node(None, config.as_ref());
    let cli_path = config::resolve_cli_path(None, config.as_ref())?;
    let engine = config::resolve_engine(request.engine, config.as_ref());
    let provider = config::resolve_provider(request.provider, config.as_ref());
    let verbosity = config::resolve_verbosity(request.verbosity, config.as_ref());
    let timeout_ms = sidecar::clamp_timeout(request.timeout_ms, sidecar::TRANSCRIBE_TIMEOUT_MS);

    let mut args: Vec<String> = vec![
        "dictate".into(),
        "--audio".into(),
        request.wav_path,
        "--engine".into(),
        engine,
        "--format".into(),
        "json".into(),
        "--target".into(),
        "stdout".into(),
        "--verbosity".into(),
        verbosity,
    ];
    if let Some(provider) = provider {
        args.push("--provider".into());
        args.push(provider);
    }

    let output = sidecar::run_cli(&node, &cli_path, args, None, timeout_ms).await?;
    if !output.ok {
        return Err(output.failure_detail("Transcription failed."));
    }
    let parsed = sidecar::parse_json("dictate", &output)?;

    let contract = parsed
        .get("contract")
        .cloned()
        .ok_or_else(|| "The CLI returned no vocalcontext contract.".to_string())?;
    let text = contract
        .get("text")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string();

    Ok(TranscribeResult {
        text,
        engine: parsed
            .get("engine")
            .cloned()
            .unwrap_or(serde_json::Value::Null),
        contract,
    })
}

// --- insert ---------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InsertRequest {
    pub text: String,
    /// Set false to copy only. Default true.
    pub paste: Option<bool>,
    /// Override the synthetic-keystroke command (mirrors the CLI's --paste-command).
    pub paste_command: Option<String>,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InsertResult {
    pub clipboard: bool,
    pub pasted: bool,
    pub detail: String,
}

/// Put `text` into the focused app.
///
/// The clipboard write happens first and unconditionally. If the synthetic
/// paste keystroke then fails - no accessibility permission on macOS, no
/// `xdotool`/`wtype` on Linux - the words are still on the clipboard and the
/// result says so. An insertion failure is never data loss.
#[tauri::command]
pub async fn subtext_insert(app: AppHandle, request: InsertRequest) -> Result<InsertResult, String> {
    if request.text.is_empty() {
        return Err("Nothing to insert.".to_string());
    }

    app.clipboard()
        .write_text(request.text.clone())
        .map_err(|error| format!("Could not copy to the clipboard: {error}"))?;

    if !request.paste.unwrap_or(true) {
        return Ok(InsertResult {
            clipboard: true,
            pasted: false,
            detail: "Copied to the clipboard.".to_string(),
        });
    }

    let command = match request.paste_command.filter(|value| !value.trim().is_empty()) {
        Some(custom) => parse_command(&custom),
        None => default_paste_command(),
    };

    let Some((program, args)) = command else {
        return Ok(InsertResult {
            clipboard: true,
            pasted: false,
            detail: "No paste command is available on this platform. Your text is on the clipboard - press Ctrl+V."
                .to_string(),
        });
    };

    let timeout_ms = sidecar::clamp_timeout(request.timeout_ms, sidecar::INSERT_TIMEOUT_MS);
    match sidecar::run(&program, &args, None, timeout_ms).await {
        Ok(output) if output.ok => Ok(InsertResult {
            clipboard: true,
            pasted: true,
            detail: "Inserted into the focused app.".to_string(),
        }),
        Ok(output) => Ok(InsertResult {
            clipboard: true,
            pasted: false,
            detail: format!(
                "Could not paste into the focused app ({}). Your text is on the clipboard - press Ctrl+V.",
                output.failure_detail("the paste command failed")
            ),
        }),
        Err(error) => Ok(InsertResult {
            clipboard: true,
            pasted: false,
            detail: format!(
                "Could not paste into the focused app ({error}). Your text is on the clipboard - press Ctrl+V."
            ),
        }),
    }
}

// Mirrors src/handoff/paste.js so the desktop shell and the CLI synthesise the
// same keystroke on each platform.
#[cfg(target_os = "windows")]
fn default_paste_command() -> Option<(String, Vec<String>)> {
    Some((
        "powershell".to_string(),
        vec![
            "-NoProfile".to_string(),
            "-Command".to_string(),
            "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')"
                .to_string(),
        ],
    ))
}

#[cfg(target_os = "macos")]
fn default_paste_command() -> Option<(String, Vec<String>)> {
    Some((
        "osascript".to_string(),
        vec![
            "-e".to_string(),
            "tell application \"System Events\" to keystroke \"v\" using command down".to_string(),
        ],
    ))
}

#[cfg(all(unix, not(target_os = "macos")))]
fn default_paste_command() -> Option<(String, Vec<String>)> {
    if std::env::var("WAYLAND_DISPLAY").is_ok() {
        return Some((
            "wtype".to_string(),
            vec![
                "-M".to_string(),
                "ctrl".to_string(),
                "v".to_string(),
                "-m".to_string(),
                "ctrl".to_string(),
            ],
        ));
    }
    Some((
        "xdotool".to_string(),
        vec!["key".to_string(), "ctrl+v".to_string()],
    ))
}

#[cfg(not(any(windows, unix)))]
fn default_paste_command() -> Option<(String, Vec<String>)> {
    None
}

/// Whitespace split with double-quote grouping, matching src/util/command.js.
fn parse_command(text: &str) -> Option<(String, Vec<String>)> {
    let mut tokens: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    let mut started = false;

    for character in text.chars() {
        match character {
            '"' => {
                quoted = !quoted;
                started = true;
            }
            c if c.is_whitespace() && !quoted => {
                if started {
                    tokens.push(std::mem::take(&mut current));
                    started = false;
                }
            }
            c => {
                current.push(c);
                started = true;
            }
        }
    }
    if started {
        tokens.push(current);
    }
    if tokens.is_empty() {
        return None;
    }
    let program = tokens.remove(0);
    Some((program, tokens))
}

// --- history --------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryListRequest {
    pub limit: Option<usize>,
}

#[tauri::command]
pub fn subtext_history_list(
    app: AppHandle,
    request: Option<HistoryListRequest>,
) -> Result<Vec<HistoryEntry>, String> {
    app.state::<History>()
        .list(&app, request.and_then(|request| request.limit))
}

#[tauri::command]
pub fn subtext_history_append(
    app: AppHandle,
    entry: NewHistoryEntry,
) -> Result<HistoryEntry, String> {
    app.state::<History>().append(&app, entry)
}

/// Upsert by id. The shell owns `id` and `at` for its turns and writes each one
/// twice (before insertion, then with the outcome); see `History::put`.
#[tauri::command]
pub fn subtext_history_put(app: AppHandle, entry: HistoryEntry) -> Result<HistoryEntry, String> {
    app.state::<History>().put(&app, entry)
}

#[tauri::command]
pub fn subtext_history_delete(app: AppHandle, id: String) -> Result<bool, String> {
    app.state::<History>().delete(&app, &id)
}

#[tauri::command]
pub fn subtext_history_clear(app: AppHandle) -> Result<usize, String> {
    app.state::<History>().clear(&app)
}

#[tauri::command]
pub fn subtext_history_path(app: AppHandle) -> Result<String, String> {
    app.state::<History>()
        .location(&app)
        .map(|path| path.display().to_string())
}

// --- overlay pill ---------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PillRequest {
    pub anchor: Option<PillAnchor>,
}

#[tauri::command]
pub fn subtext_pill_show(
    app: AppHandle,
    request: Option<PillRequest>,
) -> Result<PillPlacement, String> {
    pill::show(&app, request.and_then(|request| request.anchor))
}

#[tauri::command]
pub fn subtext_pill_hide(app: AppHandle) -> Result<(), String> {
    pill::hide(&app)
}

#[tauri::command]
pub fn subtext_pill_position(
    app: AppHandle,
    request: Option<PillRequest>,
) -> Result<PillPlacement, String> {
    pill::position(&app, request.and_then(|request| request.anchor))
}

// --- status ---------------------------------------------------------------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusRequest {
    pub status: PttStatus,
    pub detail: Option<String>,
}

/// Let the frontend drive the tray, the title, and the pill through the same
/// path the Rust side uses, so the three surfaces cannot disagree.
///
/// A terminal or idle status from the frontend also settles the hotkey. The
/// shell can end a turn on its own - auto-stop after quiet, a click on the pill,
/// a microphone that failed to open - and without this the Rust state machine
/// would still think a tap-to-toggle turn was open, so the next press would be
/// read as "end" instead of "start" and the user's first press would vanish.
#[tauri::command]
pub fn subtext_status_set(app: AppHandle, request: StatusRequest) {
    if matches!(
        request.status,
        PttStatus::Ready | PttStatus::Delivered | PttStatus::Failed
    ) {
        hotkey::settle(&app);
    }
    status::set_status(&app, request.status, &request.detail.unwrap_or_default());
}

// --- foreground app -------------------------------------------------------

/// The app that will receive a paste: its window title and executable name.
/// The shell uses it to pick the per-app insertion rule (full vocal-context
/// block for AI tools, plain text elsewhere). `None` where the platform gives
/// us no cheap way to ask; the shell then falls back to its default rule.
#[tauri::command]
pub fn subtext_foreground_app() -> Option<crate::foreground::ForegroundApp> {
    crate::foreground::current()
}

// --- hotkey ---------------------------------------------------------------

#[tauri::command]
pub fn subtext_hotkey_status(app: AppHandle) -> HotkeyStatus {
    hotkey::describe(&app)
}

/// Rebind the capture hotkey. An accelerator the OS refuses returns a clear
/// error and leaves the previous binding in place.
#[tauri::command]
pub fn subtext_hotkey_set(app: AppHandle, request: HotkeyBindRequest) -> Result<HotkeyStatus, String> {
    hotkey::rebind(&app, &request.accelerator)
}

/// The frontend calls this on boot to say "I will do the capturing". Until it
/// does, the press edge runs the Node CLI turn itself.
#[tauri::command]
pub fn subtext_hotkey_claim(app: AppHandle, claimed: bool) -> HotkeyStatus {
    app.state::<Arc<HotkeyRuntime>>().set_claimed(claimed);
    hotkey::describe(&app)
}

// --- autostart ------------------------------------------------------------

#[tauri::command]
pub fn subtext_autostart_status(app: AppHandle) -> Result<bool, String> {
    #[cfg(desktop)]
    {
        use tauri_plugin_autostart::ManagerExt;
        return app
            .autolaunch()
            .is_enabled()
            .map_err(|error| format!("Could not read the launch-at-login setting: {error}"));
    }
    #[cfg(not(desktop))]
    {
        let _ = app;
        Err("Launch at login is desktop-only.".to_string())
    }
}

#[tauri::command]
pub fn subtext_autostart_set(app: AppHandle, enabled: bool) -> Result<bool, String> {
    #[cfg(desktop)]
    {
        use tauri_plugin_autostart::ManagerExt;
        let manager = app.autolaunch();
        let changed = if enabled {
            manager.enable()
        } else {
            manager.disable()
        };
        changed.map_err(|error| {
            format!(
                "Could not {} launch at login: {error}",
                if enabled { "enable" } else { "disable" }
            )
        })?;
        return manager
            .is_enabled()
            .map_err(|error| format!("Could not read the launch-at-login setting: {error}"));
    }
    #[cfg(not(desktop))]
    {
        let _ = (app, enabled);
        Err("Launch at login is desktop-only.".to_string())
    }
}
