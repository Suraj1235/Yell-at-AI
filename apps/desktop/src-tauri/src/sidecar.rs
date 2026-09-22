// Timeout-bounded child-process calls into the Node reference CLI.
//
// Gate 3 of the launch plan ("never hang") says every subprocess is
// timeout-bounded with a visible error, so there is exactly one way to run a
// child process in this crate and it always takes a deadline. The child is
// spawned with `kill_on_drop`, so when the timeout future is dropped the
// process is killed rather than orphaned.

use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;
use tokio::io::AsyncWriteExt;

/// Analysis is pure local DSP (32ms p95 today), so this is a generous ceiling.
pub const ANALYZE_TIMEOUT_MS: u64 = 30_000;
/// Local whisper on a cold model load can legitimately take a while.
pub const TRANSCRIBE_TIMEOUT_MS: u64 = 180_000;
/// Clipboard + a single synthetic keystroke.
pub const INSERT_TIMEOUT_MS: u64 = 15_000;
/// Rendering a saved contract back to prompt text.
pub const RENDER_TIMEOUT_MS: u64 = 15_000;
/// No caller may ask for an unbounded wait.
pub const MAX_TIMEOUT_MS: u64 = 15 * 60 * 1_000;

/// Windows `CREATE_NO_WINDOW`: keeps a console from flashing up behind the
/// overlay every time we shell out.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SidecarOutput {
    pub ok: bool,
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
}

impl SidecarOutput {
    /// The most useful single line to put in front of a user when a call fails.
    pub fn failure_detail(&self, fallback: &str) -> String {
        first_nonempty_line(&self.stderr)
            .or_else(|| first_nonempty_line(&self.stdout))
            .unwrap_or_else(|| fallback.to_string())
    }
}

pub fn clamp_timeout(requested: Option<u64>, default_ms: u64) -> u64 {
    requested
        .filter(|value| *value > 0)
        .unwrap_or(default_ms)
        .min(MAX_TIMEOUT_MS)
}

pub fn first_nonempty_line(text: &str) -> Option<String> {
    text.lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(|line| line.to_string())
}

/// Run a program to completion, or kill it when `timeout_ms` elapses.
pub async fn run(
    program: &str,
    args: &[String],
    stdin_text: Option<String>,
    timeout_ms: u64,
) -> Result<SidecarOutput, String> {
    let mut command = tokio::process::Command::new(program);
    command
        .args(args)
        .stdin(if stdin_text.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    #[cfg(windows)]
    command.creation_flags(CREATE_NO_WINDOW);

    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to launch {program}: {error}"))?;

    if let Some(text) = stdin_text {
        if let Some(mut stdin) = child.stdin.take() {
            stdin
                .write_all(text.as_bytes())
                .await
                .map_err(|error| format!("Failed to write to {program} stdin: {error}"))?;
            stdin
                .shutdown()
                .await
                .map_err(|error| format!("Failed to close {program} stdin: {error}"))?;
        }
    }

    let waited = tokio::time::timeout(
        Duration::from_millis(timeout_ms),
        child.wait_with_output(),
    )
    .await;

    match waited {
        Ok(Ok(output)) => Ok(SidecarOutput {
            ok: output.status.success(),
            code: output.status.code(),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        }),
        Ok(Err(error)) => Err(format!("{program} failed: {error}")),
        Err(_) => Err(format!(
            "{program} did not finish within {timeout_ms} ms and was terminated."
        )),
    }
}

/// `node <cli> <args...>` with a deadline.
pub async fn run_cli(
    node: &str,
    cli_path: &str,
    args: Vec<String>,
    stdin_text: Option<String>,
    timeout_ms: u64,
) -> Result<SidecarOutput, String> {
    let mut full = Vec::with_capacity(args.len() + 1);
    full.push(cli_path.to_string());
    full.extend(args);
    run(node, &full, stdin_text, timeout_ms).await
}

/// Parse CLI stdout as JSON, quoting the offending output when it is not.
pub fn parse_json(label: &str, output: &SidecarOutput) -> Result<serde_json::Value, String> {
    serde_json::from_str(output.stdout.trim()).map_err(|error| {
        let hint = output.failure_detail("no stderr output");
        format!("Could not parse {label} output as JSON ({error}). Sidecar said: {hint}")
    })
}
