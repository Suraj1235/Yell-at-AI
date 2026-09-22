// Turn status: the one place that decides what the tray, the window title, the
// overlay pill, and the frontend are all told.
//
// Launch gate 4 is "never capture silently": mic active implies pill visible.
// That is enforced here rather than in the frontend, so a frontend that forgets
// to show the pill still cannot record invisibly.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::menu::MenuItem;
use tauri::tray::TrayIcon;
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::pill;

pub const STATUS_EVENT: &str = "subtext://status";

/// How long a terminal state stays on screen before the pill hides itself.
const TERMINAL_LINGER_MS: u64 = 1_400;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PttStatus {
    Ready,
    Listening,
    Thinking,
    Delivered,
    Failed,
}

impl PttStatus {
    pub fn label(self) -> &'static str {
        match self {
            PttStatus::Ready => "Ready",
            PttStatus::Listening => "Listening",
            PttStatus::Thinking => "Thinking",
            PttStatus::Delivered => "Delivered",
            PttStatus::Failed => "Failed",
        }
    }

    /// Is the microphone (or a turn) live? These states must show the pill.
    fn is_live(self) -> bool {
        matches!(self, PttStatus::Listening | PttStatus::Thinking)
    }

    /// Terminal states linger briefly, then the overlay gets out of the way.
    fn is_terminal(self) -> bool {
        matches!(self, PttStatus::Delivered | PttStatus::Failed)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusPayload {
    pub status: String,
    pub detail: String,
    /// Monotonic per-app counter; the frontend can drop out-of-order updates.
    pub seq: u64,
}

/// Shared runtime state for the status surface.
pub struct StatusState {
    pub accelerator: Mutex<String>,
    pub tray: Mutex<Option<TrayIcon>>,
    pub tray_status_item: Mutex<Option<MenuItem<Wry>>>,
    seq: AtomicU64,
}

impl StatusState {
    pub fn new(accelerator: String) -> Self {
        Self {
            accelerator: Mutex::new(accelerator),
            tray: Mutex::new(None),
            tray_status_item: Mutex::new(None),
            seq: AtomicU64::new(0),
        }
    }

    pub fn accelerator(&self) -> String {
        self.accelerator
            .lock()
            .map(|guard| guard.clone())
            .unwrap_or_else(|_| crate::config::DEFAULT_ACCELERATOR.to_string())
    }

    pub fn set_accelerator(&self, accelerator: String) {
        if let Ok(mut guard) = self.accelerator.lock() {
            *guard = accelerator;
        }
    }
}

/// Publish a status change everywhere at once.
pub fn set_status(app: &AppHandle, status: PttStatus, detail: &str) {
    let state = app.state::<Arc<StatusState>>().inner().clone();
    let seq = state.seq.fetch_add(1, Ordering::SeqCst) + 1;
    let accelerator = state.accelerator();
    let tooltip = format!(
        "Subtext Desktop - {} (hold {})",
        status.label(),
        accelerator
    );

    if let Ok(guard) = state.tray.lock() {
        if let Some(tray) = guard.as_ref() {
            let _ = tray.set_tooltip(Some(tooltip.as_str()));
        }
    }
    if let Ok(guard) = state.tray_status_item.lock() {
        if let Some(item) = guard.as_ref() {
            let _ = item.set_text(format!("Status: {}", status.label()));
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
            seq,
        },
    );

    drive_pill(app, state, status, seq);
}

fn drive_pill(app: &AppHandle, state: Arc<StatusState>, status: PttStatus, seq: u64) {
    if status.is_live() {
        let _ = pill::show(app, None);
        return;
    }

    if status.is_terminal() {
        // Leave the result on screen long enough to read, then hide - unless a
        // newer status has already landed.
        let app_handle = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(TERMINAL_LINGER_MS)).await;
            if state.seq.load(Ordering::SeqCst) == seq {
                let _ = pill::hide(&app_handle);
            }
        });
        return;
    }

    let _ = pill::hide(app);
}
