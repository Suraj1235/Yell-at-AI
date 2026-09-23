// The overlay pill: a second, frameless, transparent, always-on-top window.
//
// It is declared in `tauri.conf.json` (label `pill`, `focusable: false`,
// `skipTaskbar: true`, `visible: false`) so the window manager knows what it is
// before it is ever mapped. This module only positions it and shows/hides it.
//
// Two rules the rest of the app depends on:
//   1. The pill NEVER takes focus. It is `focusable: false`, cursor events are
//      ignored, and nothing in this crate calls `set_focus` on it. Whatever the
//      user was typing into keeps the caret.
//   2. Mic active implies pill visible (launch gate 4: never capture silently).
//      `status::set_status` drives visibility off the turn state rather than
//      leaving it to the frontend to remember.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, PhysicalPosition, WebviewWindow};

pub const PILL_LABEL: &str = "pill";
/// Logical pixels; `tauri.conf.json` declares the same numbers.
///
/// The window is larger than the pill itself (the shell's pill is 48px tall
/// and 180-380px wide depending on state) because the live prosody chips and
/// the stop warning sit above it, exactly as they do in the main window. The
/// window is transparent and click-through, so the spare area is invisible and
/// never intercepts a click.
pub const PILL_WIDTH: f64 = 420.0;
pub const PILL_HEIGHT: f64 = 132.0;
/// Logical gap between the caret/cursor and the top of the pill.
const CURSOR_GAP: f64 = 26.0;
/// Logical margin kept between the pill and the edge of the screen.
const EDGE_MARGIN: f64 = 12.0;

/// Where the caller wants the pill to sit.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum PillAnchor {
    /// Just below the mouse cursor, clamped to the monitor it is on.
    Cursor,
    /// Centred horizontally, near the bottom of the primary monitor.
    BottomCenter,
    /// An explicit physical-pixel point (top-left corner of the pill).
    Point { x: i32, y: i32 },
}

impl Default for PillAnchor {
    fn default() -> Self {
        PillAnchor::Cursor
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PillPlacement {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub anchor: String,
}

fn window(app: &AppHandle) -> Result<WebviewWindow, String> {
    app.get_webview_window(PILL_LABEL).ok_or_else(|| {
        format!("Overlay window '{PILL_LABEL}' is not available in this build.")
    })
}

/// Applied once at startup: the pill must never eat a click meant for the app
/// underneath it.
pub fn configure(app: &AppHandle) {
    if let Ok(pill) = window(app) {
        let _ = pill.set_ignore_cursor_events(true);
        let _ = pill.set_always_on_top(true);
        let _ = pill.hide();
    }
}

pub fn hide(app: &AppHandle) -> Result<(), String> {
    let pill = window(app)?;
    pill.hide()
        .map_err(|error| format!("Could not hide the overlay: {error}"))
}

pub fn show(app: &AppHandle, anchor: Option<PillAnchor>) -> Result<PillPlacement, String> {
    let placement = position(app, anchor)?;
    let pill = window(app)?;
    pill.show()
        .map_err(|error| format!("Could not show the overlay: {error}"))?;
    // Re-assert on every show: some window managers drop always-on-top when a
    // window is hidden and re-mapped.
    let _ = pill.set_always_on_top(true);
    Ok(placement)
}

pub fn position(app: &AppHandle, anchor: Option<PillAnchor>) -> Result<PillPlacement, String> {
    let anchor = anchor.unwrap_or_default();
    let pill = window(app)?;
    let scale = pill.scale_factor().unwrap_or(1.0);
    let width = (PILL_WIDTH * scale).round() as i32;
    let height = (PILL_HEIGHT * scale).round() as i32;

    let (x, y, label) = match anchor {
        PillAnchor::Point { x, y } => (x, y, "point"),
        PillAnchor::Cursor => {
            let cursor = pill
                .cursor_position()
                .map_err(|error| format!("Could not read the cursor position: {error}"))?;
            let monitor = pill
                .monitor_from_point(cursor.x, cursor.y)
                .ok()
                .flatten()
                .or_else(|| pill.primary_monitor().ok().flatten());
            let gap = (CURSOR_GAP * scale).round() as i32;
            let raw_x = cursor.x.round() as i32 - width / 2;
            let raw_y = cursor.y.round() as i32 + gap;
            let (x, y) = clamp(raw_x, raw_y, width, height, monitor, scale);
            (x, y, "cursor")
        }
        PillAnchor::BottomCenter => {
            let monitor = pill
                .current_monitor()
                .ok()
                .flatten()
                .or_else(|| pill.primary_monitor().ok().flatten());
            match monitor {
                Some(monitor) => {
                    let origin = monitor.position();
                    let size = monitor.size();
                    let x = origin.x + (size.width as i32 - width) / 2;
                    let y = origin.y + size.height as i32 - height
                        - (size.height as f64 * 0.16).round() as i32;
                    (x, y, "bottomCenter")
                }
                None => (0, 0, "bottomCenter"),
            }
        }
    };

    pill.set_position(PhysicalPosition::new(x, y))
        .map_err(|error| format!("Could not position the overlay: {error}"))?;

    Ok(PillPlacement {
        x,
        y,
        width: width.max(0) as u32,
        height: height.max(0) as u32,
        anchor: label.to_string(),
    })
}

/// Keep the pill fully on the monitor it was anchored to. If the cursor is near
/// the bottom edge there is no room below it, so flip the pill above instead.
fn clamp(
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    monitor: Option<tauri::Monitor>,
    scale: f64,
) -> (i32, i32) {
    let Some(monitor) = monitor else {
        return (x.max(0), y.max(0));
    };
    let origin = monitor.position();
    let size = monitor.size();
    let margin = (EDGE_MARGIN * scale).round() as i32;

    let min_x = origin.x + margin;
    let max_x = origin.x + size.width as i32 - width - margin;
    let min_y = origin.y + margin;
    let max_y = origin.y + size.height as i32 - height - margin;

    let clamped_x = if max_x < min_x { min_x } else { x.clamp(min_x, max_x) };
    let clamped_y = if y > max_y {
        // Flip above the cursor rather than clipping off the bottom of the screen.
        let flipped = y - height - (2.0 * CURSOR_GAP * scale).round() as i32;
        flipped.max(min_y)
    } else {
        y.max(min_y)
    };

    (clamped_x, clamped_y)
}
