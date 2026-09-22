// Desktop configuration: the `subtext/desktop-config/v1` file plus the
// environment-variable overrides that sit on top of it.
//
// Resolution order, unchanged from the original scaffold and relied on by the
// README, is: explicit Tauri-command argument -> environment variable ->
// generated config file -> built-in default.

use std::fs;

use serde::{Deserialize, Serialize};

pub const DEFAULT_TRANSCRIPT_COMMAND: &str = "host-transcript --json {audio}";
pub const DEFAULT_CONFIG_PATH: &str = "apps/desktop/subtext-desktop.generated.json";
pub const DEFAULT_ACCELERATOR: &str = "Ctrl+Alt+Y";
pub const CONFIG_SCHEMA: &str = "subtext/desktop-config/v1";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadConfigRequest {
    pub path: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct DesktopConfig {
    pub schema: Option<String>,
    pub node_command: Option<String>,
    pub subtext_cli_path: Option<String>,
    pub transcript_command: Option<String>,
    pub duration: Option<serde_json::Value>,
    pub target: Option<String>,
    pub verbosity: Option<String>,
    /// Default STT engine id for `subtext_transcribe` (see src/transcribe/engines.js).
    pub engine: Option<String>,
    /// Cloud provider id, only meaningful when `engine` is `cloud`.
    pub provider: Option<String>,
    pub hotkey: Option<HotkeyConfig>,
}

#[derive(Debug, Deserialize, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyConfig {
    pub enabled: Option<bool>,
    pub accelerator: Option<String>,
    pub mode: Option<String>,
}

pub fn read_desktop_config(path_override: Option<String>) -> Result<DesktopConfig, String> {
    let path = path_override
        .filter(|value| !value.trim().is_empty())
        .or_else(|| std::env::var("SUBTEXT_DESKTOP_CONFIG").ok())
        .unwrap_or_else(|| DEFAULT_CONFIG_PATH.to_string());
    let text = fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read desktop config {path}: {error}"))?;
    let config: DesktopConfig = serde_json::from_str(&text)
        .map_err(|error| format!("Failed to parse desktop config {path}: {error}"))?;
    if config.schema.as_deref() != Some(CONFIG_SCHEMA) {
        return Err(format!("Desktop config must use schema {CONFIG_SCHEMA}."));
    }
    Ok(config)
}

/// Best-effort read used by the resolution helpers: a missing or malformed
/// config is not fatal, it just means every value falls through to its default.
pub fn read_desktop_config_opt() -> Option<DesktopConfig> {
    read_desktop_config(None).ok()
}

fn non_empty(value: Option<String>) -> Option<String> {
    value.filter(|text| !text.trim().is_empty())
}

/// The Node binary used to run the reference CLI.
pub fn resolve_node(explicit: Option<String>, config: Option<&DesktopConfig>) -> String {
    non_empty(explicit)
        .or_else(|| non_empty(std::env::var("SUBTEXT_NODE").ok()))
        .or_else(|| non_empty(config.and_then(|c| c.node_command.clone())))
        .unwrap_or_else(|| "node".to_string())
}

/// Absolute path to this checkout's `bin/subtext.js`. There is no sensible
/// default, so a missing value is an error the user can act on.
pub fn resolve_cli_path(
    explicit: Option<String>,
    config: Option<&DesktopConfig>,
) -> Result<String, String> {
    non_empty(explicit)
        .or_else(|| non_empty(std::env::var("SUBTEXT_CLI_PATH").ok()))
        .or_else(|| non_empty(config.and_then(|c| c.subtext_cli_path.clone())))
        .ok_or_else(|| {
            "Missing Subtext CLI path. Set SUBTEXT_CLI_PATH or subtextCliPath in the desktop config."
                .to_string()
        })
}

pub fn resolve_transcript_command(
    explicit: Option<String>,
    config: Option<&DesktopConfig>,
) -> String {
    non_empty(explicit)
        .or_else(|| non_empty(std::env::var("SUBTEXT_TRANSCRIPT_COMMAND").ok()))
        .or_else(|| non_empty(config.and_then(|c| c.transcript_command.clone())))
        .unwrap_or_else(|| DEFAULT_TRANSCRIPT_COMMAND.to_string())
}

pub fn resolve_verbosity(explicit: Option<String>, config: Option<&DesktopConfig>) -> String {
    non_empty(explicit)
        .or_else(|| non_empty(config.and_then(|c| c.verbosity.clone())))
        .unwrap_or_else(|| "full".to_string())
}

pub fn resolve_duration(explicit: Option<String>, config: Option<&DesktopConfig>) -> String {
    non_empty(explicit)
        .or_else(|| {
            non_empty(
                config
                    .and_then(|c| c.duration.as_ref())
                    .map(json_value_to_string),
            )
        })
        .unwrap_or_else(|| "4".to_string())
}

pub fn resolve_engine(explicit: Option<String>, config: Option<&DesktopConfig>) -> String {
    non_empty(explicit)
        .or_else(|| non_empty(std::env::var("SUBTEXT_STT_ENGINE").ok()))
        .or_else(|| non_empty(config.and_then(|c| c.engine.clone())))
        .unwrap_or_else(|| "whisper".to_string())
}

pub fn resolve_provider(explicit: Option<String>, config: Option<&DesktopConfig>) -> Option<String> {
    non_empty(explicit).or_else(|| non_empty(config.and_then(|c| c.provider.clone())))
}

pub fn json_value_to_string(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}

/// The desktop layer only ever hands the CLI a delivery target it understands.
pub fn normalize_target(value: String) -> Result<String, String> {
    let normalized = value.trim().to_lowercase();
    match normalized.as_str() {
        "stdout" | "clipboard" | "paste" => Ok(normalized),
        _ => Err("Desktop scaffold target must be stdout, clipboard, or paste.".to_string()),
    }
}
