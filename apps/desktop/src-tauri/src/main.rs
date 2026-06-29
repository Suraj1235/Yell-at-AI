use serde::{Deserialize, Serialize};
use std::{fs, process::Command};

const DEFAULT_TRANSCRIPT_COMMAND: &str = "host-transcript --json {audio}";
const DEFAULT_CONFIG_PATH: &str = "apps/desktop/subtext-desktop.generated.json";

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

#[derive(Debug, Deserialize, Serialize)]
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

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct HotkeyConfig {
    enabled: Option<bool>,
    accelerator: Option<String>,
    mode: Option<String>,
}

#[tauri::command]
fn subtext_load_config(request: LoadConfigRequest) -> Result<DesktopConfig, String> {
    let path = request
        .path
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

    let output = Command::new(node)
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

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![subtext_load_config, subtext_session])
        .run(tauri::generate_context!())
        .expect("error while running Subtext desktop scaffold");
}

fn normalize_target(value: String) -> Result<String, String> {
    let normalized = value.trim().to_lowercase();
    match normalized.as_str() {
        "stdout" | "clipboard" | "paste" => Ok(normalized),
        _ => Err("Desktop scaffold target must be stdout, clipboard, or paste.".to_string()),
    }
}
