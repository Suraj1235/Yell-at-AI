// The Rust-driven fallback turn.
//
// When no frontend has claimed capture (`subtext_hotkey_claim`), the press edge
// runs exactly what the original dev build ran: one bounded `subtext ptt` turn
// through the Node CLI, which records, transcribes, analyses, renders, and
// pastes. That keeps this build useful on its own, and keeps the previously
// documented behaviour intact.
//
// Once `apps/shell` claims capture, this path stays dormant: the shell records
// in the WebView and calls `subtext_transcribe` / `subtext_analyze` /
// `subtext_insert` itself.

use std::sync::atomic::Ordering;
use std::sync::Arc;

use tauri::{AppHandle, Manager};

use crate::config;
use crate::hotkey::HotkeyRuntime;
use crate::sidecar;
use crate::status::{set_status, PttStatus};

struct Invocation {
    node: String,
    cli_path: String,
    transcript_command: String,
    duration: String,
    verbosity: String,
}

fn resolve() -> Result<Invocation, String> {
    let config = config::read_desktop_config_opt();
    Ok(Invocation {
        node: config::resolve_node(None, config.as_ref()),
        cli_path: config::resolve_cli_path(None, config.as_ref())?,
        transcript_command: config::resolve_transcript_command(None, config.as_ref()),
        duration: config::resolve_duration(None, config.as_ref()),
        verbosity: config::resolve_verbosity(None, config.as_ref()),
    })
}

/// Fire one bounded push-to-talk turn through the Node sidecar.
pub fn run_cli_turn(app: &AppHandle) {
    let runtime = app.state::<Arc<HotkeyRuntime>>().inner().clone();

    // Reject re-entry while a turn is already running.
    if runtime
        .busy
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        set_status(app, PttStatus::Listening, "A capture is already in progress.");
        return;
    }

    let invocation = match resolve() {
        Ok(invocation) => invocation,
        Err(error) => {
            runtime.busy.store(false, Ordering::SeqCst);
            set_status(app, PttStatus::Failed, &error);
            return;
        }
    };

    set_status(app, PttStatus::Listening, "Recording a bounded turn...");

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        // The CLI records for `duration` seconds and then does the whole
        // pipeline, so the deadline is the recording plus generous headroom for
        // a cold whisper model load.
        let recording_ms = invocation
            .duration
            .trim()
            .parse::<f64>()
            .map(|seconds| (seconds.max(0.0) * 1_000.0) as u64)
            .unwrap_or(4_000);
        let timeout_ms = recording_ms + sidecar::TRANSCRIBE_TIMEOUT_MS;

        let result = sidecar::run_cli(
            &invocation.node,
            &invocation.cli_path,
            vec![
                "ptt".into(),
                "--turns".into(),
                "1".into(),
                "--duration".into(),
                invocation.duration.clone(),
                "--trigger".into(),
                "none".into(),
                "--transcript-command".into(),
                invocation.transcript_command.clone(),
                "--target".into(),
                "paste".into(),
                "--verbosity".into(),
                invocation.verbosity.clone(),
            ],
            None,
            timeout_ms,
        )
        .await;

        match result {
            Ok(output) if output.ok => set_status(
                &app_handle,
                PttStatus::Delivered,
                "Enriched prompt pasted into the active app.",
            ),
            Ok(output) => {
                let detail =
                    output.failure_detail("Subtext sidecar exited with a non-zero status.");
                set_status(&app_handle, PttStatus::Failed, &detail);
            }
            Err(error) => set_status(&app_handle, PttStatus::Failed, &error),
        }

        runtime.busy.store(false, Ordering::SeqCst);
    });
}
