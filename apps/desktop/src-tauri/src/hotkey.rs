// Press-and-hold global hotkey.
//
// The scaffold only ever listened for `ShortcutState::Pressed`, which can express
// "tap to fire a fixed-length turn" and nothing else. Hold-to-talk needs both
// edges: capture starts on press and ENDS ON RELEASE.
//
// Both gestures are supported from one binding, disambiguated by how long the
// key was held:
//
//   press ... release after >= HOLD_THRESHOLD_MS  -> hold-to-talk, ends on release
//   press ... release before HOLD_THRESHOLD_MS    -> tap-to-toggle, ends on the next press
//   Esc at any point during a turn                -> cancel, insert nothing
//
// Esc is registered as a global shortcut ONLY while a turn is live, and
// unregistered the moment it ends. Holding Esc hostage system-wide for an app
// that is idle in the tray would be hostile.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::config::DEFAULT_ACCELERATOR;
use crate::history::now_ms;
use crate::status::{set_status, PttStatus};

pub const HOTKEY_EVENT: &str = "subtext://hotkey";
/// Below this, a press/release pair reads as a tap, not a hold.
pub const HOLD_THRESHOLD_MS: u128 = 250;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    /// No turn in flight.
    Idle,
    /// Key is down; we do not yet know whether this is a hold or a tap.
    Undecided,
    /// It was a tap, so the turn stays open until the next press.
    Toggled,
}

struct Inner {
    accelerator: String,
    shortcut: Option<Shortcut>,
    phase: Phase,
    pressed_at: Option<Instant>,
    turn: u64,
    cancel_registered: bool,
}

pub struct HotkeyRuntime {
    inner: Mutex<Inner>,
    /// Set by `subtext_hotkey_claim` when the frontend will do the capturing
    /// itself (WebView `getUserMedia`). While unclaimed, the press edge runs the
    /// original Node CLI turn, so the existing dev-build behaviour is preserved.
    claimed: AtomicBool,
    /// Guards against overlapping CLI turns.
    pub busy: AtomicBool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyEvent {
    /// "start" | "end" | "cancel"
    pub phase: String,
    /// "hold" | "toggle" | "pending"
    pub mode: String,
    pub turn: u64,
    pub accelerator: String,
    pub held_ms: u64,
    pub at: u64,
    /// True when the frontend claimed capture, false when Rust ran the turn.
    pub claimed: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyStatus {
    pub accelerator: String,
    pub registered: bool,
    pub claimed: bool,
    pub hold_threshold_ms: u64,
    pub default_accelerator: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyBindRequest {
    pub accelerator: String,
}

impl HotkeyRuntime {
    pub fn new(accelerator: String, shortcut: Option<Shortcut>) -> Self {
        Self {
            inner: Mutex::new(Inner {
                accelerator,
                shortcut,
                phase: Phase::Idle,
                pressed_at: None,
                turn: 0,
                cancel_registered: false,
            }),
            claimed: AtomicBool::new(false),
            busy: AtomicBool::new(false),
        }
    }

    pub fn is_claimed(&self) -> bool {
        self.claimed.load(Ordering::SeqCst)
    }

    pub fn set_claimed(&self, claimed: bool) {
        self.claimed.store(claimed, Ordering::SeqCst);
    }

    pub fn accelerator(&self) -> String {
        self.inner
            .lock()
            .map(|guard| guard.accelerator.clone())
            .unwrap_or_else(|_| DEFAULT_ACCELERATOR.to_string())
    }

    pub fn shortcut(&self) -> Option<Shortcut> {
        self.inner.lock().ok().and_then(|guard| guard.shortcut)
    }
}

/// `Ctrl+Alt+Y` - deliberately not Cmd+Space (Spotlight) or Ctrl+Space (IME
/// switcher on Windows, completion in most editors).
pub fn default_shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyY)
}

pub fn cancel_shortcut() -> Shortcut {
    Shortcut::new(None, Code::Escape)
}

pub fn parse_accelerator(text: &str) -> Result<Shortcut, String> {
    text.trim().parse::<Shortcut>().map_err(|error| {
        format!("'{}' is not a valid accelerator ({error}). Try something like Ctrl+Alt+Y.", text.trim())
    })
}

/// Read the configured accelerator, falling back to the built-in default when
/// it is absent or unparseable.
pub fn resolve_shortcut() -> (Shortcut, String) {
    let configured = crate::config::read_desktop_config_opt()
        .and_then(|config| config.hotkey)
        .and_then(|hotkey| hotkey.accelerator)
        .filter(|value| !value.trim().is_empty());

    if let Some(accelerator) = configured {
        match parse_accelerator(&accelerator) {
            Ok(shortcut) => return (shortcut, accelerator),
            Err(error) => eprintln!("subtext-desktop: {error} Falling back to {DEFAULT_ACCELERATOR}."),
        }
    }

    (default_shortcut(), DEFAULT_ACCELERATOR.to_string())
}

/// Rebind the capture hotkey at runtime.
///
/// An accelerator the OS refuses (already owned by another app, reserved by the
/// shell) must surface as a clear error and leave the previous binding working -
/// never fail silently and never leave the user with no hotkey at all.
pub fn rebind(app: &AppHandle, accelerator: &str) -> Result<HotkeyStatus, String> {
    let next = parse_accelerator(accelerator)?;
    let runtime = app.state::<Arc<HotkeyRuntime>>().inner().clone();
    let previous = runtime.shortcut();

    if previous == Some(next) {
        return Ok(describe(app));
    }

    let manager = app.global_shortcut();
    if let Some(previous) = previous {
        let _ = manager.unregister(previous);
    }

    if let Err(error) = manager.register(next) {
        // Put the old binding back so the app is not left mute.
        let restored = previous
            .map(|shortcut| manager.register(shortcut).is_ok())
            .unwrap_or(false);
        if let Ok(mut guard) = runtime.inner.lock() {
            guard.shortcut = if restored { previous } else { None };
        }
        return Err(format!(
            "The system refused the hotkey {}: {error}. It is most likely already claimed by another app{}",
            accelerator.trim(),
            if restored {
                format!(". Your previous hotkey ({}) is still active.", runtime.accelerator())
            } else {
                ". No capture hotkey is registered right now - pick another one.".to_string()
            }
        ));
    }

    if let Ok(mut guard) = runtime.inner.lock() {
        guard.shortcut = Some(next);
        guard.accelerator = accelerator.trim().to_string();
    }
    app.state::<Arc<crate::status::StatusState>>()
        .set_accelerator(accelerator.trim().to_string());

    Ok(describe(app))
}

pub fn describe(app: &AppHandle) -> HotkeyStatus {
    let runtime = app.state::<Arc<HotkeyRuntime>>().inner().clone();
    let shortcut = runtime.shortcut();
    HotkeyStatus {
        accelerator: runtime.accelerator(),
        registered: shortcut
            .map(|shortcut| app.global_shortcut().is_registered(shortcut))
            .unwrap_or(false),
        claimed: runtime.is_claimed(),
        hold_threshold_ms: HOLD_THRESHOLD_MS as u64,
        default_accelerator: DEFAULT_ACCELERATOR.to_string(),
    }
}

/// The global-shortcut plugin handler. Dispatches both edges of the capture
/// hotkey plus the turn-scoped Esc binding.
pub fn handle(app: &AppHandle, triggered: &Shortcut, state: ShortcutState) {
    let runtime = app.state::<Arc<HotkeyRuntime>>().inner().clone();

    if triggered == &cancel_shortcut() {
        if state == ShortcutState::Pressed {
            cancel_turn(app, &runtime);
        }
        return;
    }

    if runtime.shortcut() != Some(*triggered) {
        return;
    }

    match state {
        ShortcutState::Pressed => on_press(app, &runtime),
        ShortcutState::Released => on_release(app, &runtime),
    }
}

fn on_press(app: &AppHandle, runtime: &Arc<HotkeyRuntime>) {
    let decision = {
        let Ok(mut guard) = runtime.inner.lock() else {
            return;
        };
        match guard.phase {
            // Auto-repeat while the key is held: ignore.
            Phase::Undecided => None,
            Phase::Toggled => {
                guard.phase = Phase::Idle;
                let held = guard
                    .pressed_at
                    .map(|at| at.elapsed().as_millis() as u64)
                    .unwrap_or(0);
                guard.pressed_at = None;
                Some(("end", "toggle", guard.turn, held))
            }
            Phase::Idle => {
                guard.turn += 1;
                guard.phase = Phase::Undecided;
                guard.pressed_at = Some(Instant::now());
                Some(("start", "pending", guard.turn, 0))
            }
        }
    };

    let Some((phase, mode, turn, held)) = decision else {
        return;
    };

    if phase == "start" {
        arm_cancel(app, runtime);
        emit(app, runtime, phase, mode, turn, held);
        set_status(app, PttStatus::Listening, "Listening. Release to send.");
        if !runtime.is_claimed() {
            crate::turn::run_cli_turn(app);
        }
    } else {
        disarm_cancel(app, runtime);
        emit(app, runtime, phase, mode, turn, held);
        if runtime.is_claimed() {
            set_status(app, PttStatus::Thinking, "Transcribing and reading prosody...");
        }
    }
}

fn on_release(app: &AppHandle, runtime: &Arc<HotkeyRuntime>) {
    let decision = {
        let Ok(mut guard) = runtime.inner.lock() else {
            return;
        };
        match guard.phase {
            Phase::Undecided => {
                let held = guard
                    .pressed_at
                    .map(|at| at.elapsed().as_millis())
                    .unwrap_or(0);
                if held >= HOLD_THRESHOLD_MS {
                    guard.phase = Phase::Idle;
                    guard.pressed_at = None;
                    Some(("end", "hold", guard.turn, held as u64))
                } else {
                    // Too quick to be a hold: leave the turn open as a toggle.
                    guard.phase = Phase::Toggled;
                    None
                }
            }
            // A release in any other phase is the tail of a gesture we already
            // resolved, or a stray event after a cancel.
            Phase::Idle | Phase::Toggled => None,
        }
    };

    let Some((phase, mode, turn, held)) = decision else {
        return;
    };

    disarm_cancel(app, runtime);
    emit(app, runtime, phase, mode, turn, held);
    if runtime.is_claimed() {
        set_status(app, PttStatus::Thinking, "Transcribing and reading prosody...");
    }
}

fn cancel_turn(app: &AppHandle, runtime: &Arc<HotkeyRuntime>) {
    let decision = {
        let Ok(mut guard) = runtime.inner.lock() else {
            return;
        };
        if guard.phase == Phase::Idle {
            return;
        }
        guard.phase = Phase::Idle;
        let held = guard
            .pressed_at
            .map(|at| at.elapsed().as_millis() as u64)
            .unwrap_or(0);
        guard.pressed_at = None;
        (guard.turn, held)
    };

    disarm_cancel(app, runtime);
    emit(app, runtime, "cancel", "cancel", decision.0, decision.1);
    set_status(app, PttStatus::Ready, "Cancelled. Nothing was inserted.");
}

/// Esc only exists as a global binding for the duration of a turn.
///
/// Both of these run OFF the shortcut-handler thread. The global-shortcut
/// plugin holds its own `shortcuts` mutex for the whole duration of the handler
/// call, and `register`/`unregister` take that same non-reentrant mutex - doing
/// it inline would deadlock the app on the first press.
fn arm_cancel(app: &AppHandle, runtime: &Arc<HotkeyRuntime>) {
    let already = runtime
        .inner
        .lock()
        .map(|guard| guard.cancel_registered)
        .unwrap_or(true);
    if already {
        return;
    }
    let app = app.clone();
    let runtime = runtime.clone();
    tauri::async_runtime::spawn(async move {
        // A refused Esc binding is not fatal: the turn still ends on release.
        if app.global_shortcut().register(cancel_shortcut()).is_ok() {
            if let Ok(mut guard) = runtime.inner.lock() {
                guard.cancel_registered = true;
            }
        }
    });
}

fn disarm_cancel(app: &AppHandle, runtime: &Arc<HotkeyRuntime>) {
    let registered = runtime
        .inner
        .lock()
        .map(|guard| guard.cancel_registered)
        .unwrap_or(false);
    if !registered {
        return;
    }
    // Claim it immediately so a second end/cancel cannot queue a second
    // unregister; the spawned task only has to do the plugin call.
    if let Ok(mut guard) = runtime.inner.lock() {
        guard.cancel_registered = false;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = app.global_shortcut().unregister(cancel_shortcut());
    });
}

fn emit(
    app: &AppHandle,
    runtime: &Arc<HotkeyRuntime>,
    phase: &str,
    mode: &str,
    turn: u64,
    held_ms: u64,
) {
    let _ = app.emit(
        HOTKEY_EVENT,
        HotkeyEvent {
            phase: phase.to_string(),
            mode: mode.to_string(),
            turn,
            accelerator: runtime.accelerator(),
            held_ms,
            at: now_ms(),
            claimed: runtime.is_claimed(),
        },
    );
}
