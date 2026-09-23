// Which app is about to receive the paste.
//
// The shell applies a per-app insertion rule - the full `<vocal-context>` block
// for AI tools (Claude, Cursor, VS Code, ChatGPT, terminals), plain text
// everywhere else - and it needs to know what is focused to pick one. The
// overlay pill is `focusable: false`, so at insertion time the foreground
// window is still the app the user was typing into.
//
// Windows only for now: two Win32 calls and a process-name lookup, no new
// crates beyond the `windows-sys` Tauri already links. On macOS and Linux this
// returns `None` and the shell falls back to its default rule. The macOS
// answer is `NSWorkspace.frontmostApplication` (no permission needed for the
// bundle id), and on X11 `_NET_ACTIVE_WINDOW`; both are follow-ups.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForegroundApp {
    /// The window title, e.g. "main.rs - Yell-at-AI - Visual Studio Code".
    pub title: String,
    /// The executable's file name, e.g. "Code.exe". Empty when the process
    /// could not be opened (elevated windows refuse `OpenProcess`).
    pub process: String,
}

#[cfg(target_os = "windows")]
pub fn current() -> Option<ForegroundApp> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId,
    };

    // SAFETY: plain Win32 queries on a window handle the OS just gave us. Every
    // buffer is sized and passed with its length; the process handle is closed
    // on every path that opened it.
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.is_null() {
            return None;
        }

        let mut title = [0u16; 512];
        let length = GetWindowTextW(hwnd, title.as_mut_ptr(), title.len() as i32);
        let title = String::from_utf16_lossy(&title[..length.max(0) as usize]);

        let mut pid: u32 = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        let mut process = String::new();
        if pid != 0 {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if !handle.is_null() {
                let mut path = [0u16; 1024];
                let mut size = path.len() as u32;
                if QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, path.as_mut_ptr(), &mut size) != 0 {
                    let full = String::from_utf16_lossy(&path[..size as usize]);
                    process = full
                        .rsplit(['\\', '/'])
                        .next()
                        .unwrap_or_default()
                        .to_string();
                }
                CloseHandle(handle);
            }
        }

        Some(ForegroundApp { title, process })
    }
}

#[cfg(not(target_os = "windows"))]
pub fn current() -> Option<ForegroundApp> {
    None
}
