// Local-only turn history.
//
// The launch plan sketches SQLite for this. A JSON file keeps the desktop crate
// free of a C dependency (rusqlite needs a C toolchain at build time), and the
// cap is 100 turns, so the whole store is a few hundred KB at worst. The shape
// below is the storage contract; swapping the backing store later does not have
// to change the Tauri command surface.
//
// Nothing here leaves the machine. The file lives in the OS app-data directory.

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{Manager, Runtime};

pub const HISTORY_SCHEMA: &str = "subtext/desktop-history/v1";
pub const HISTORY_LIMIT: usize = 100;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    /// Unix epoch milliseconds.
    pub at: u64,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub contract: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub engine: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target_app: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio_ms: Option<u64>,
    #[serde(default)]
    pub delivered: bool,
}

/// What the frontend sends; the store owns `id` and `at`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewHistoryEntry {
    pub text: String,
    pub prompt: Option<String>,
    pub contract: Option<serde_json::Value>,
    pub engine: Option<String>,
    pub target_app: Option<String>,
    pub audio_ms: Option<u64>,
    #[serde(default)]
    pub delivered: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct HistoryFile {
    schema: String,
    entries: Vec<HistoryEntry>,
}

pub struct History {
    path: Mutex<Option<PathBuf>>,
    seq: AtomicU64,
}

impl History {
    /// The store is managed at builder time, before there is an `App` to ask
    /// for the app-data directory. That matters: windows declared in
    /// `tauri.conf.json` are created before `setup` runs, so the webview can
    /// invoke a history command while `setup` is still executing. Managing this
    /// late made that race a `state() called before manage()` panic on startup.
    /// The path is therefore resolved on first use and cached.
    pub fn new() -> Self {
        Self {
            path: Mutex::new(None),
            seq: AtomicU64::new(0),
        }
    }

    pub fn location<R: Runtime, M: Manager<R>>(&self, app: &M) -> Result<PathBuf, String> {
        let mut guard = self
            .path
            .lock()
            .map_err(|_| "History store lock was poisoned.".to_string())?;
        if let Some(path) = guard.as_ref() {
            return Ok(path.clone());
        }
        let path = app
            .path()
            .app_data_dir()
            .map_err(|error| format!("Could not resolve the app data directory: {error}"))?
            .join("history.json");
        *guard = Some(path.clone());
        Ok(path)
    }

    /// Newest first.
    pub fn list<R: Runtime, M: Manager<R>>(
        &self,
        app: &M,
        limit: Option<usize>,
    ) -> Result<Vec<HistoryEntry>, String> {
        let path = self.location(app)?;
        let mut entries = read_file(&path)?.entries;
        if let Some(limit) = limit {
            entries.truncate(limit);
        }
        Ok(entries)
    }

    pub fn append<R: Runtime, M: Manager<R>>(
        &self,
        app: &M,
        entry: NewHistoryEntry,
    ) -> Result<HistoryEntry, String> {
        let path = self.location(app)?;
        let mut file = read_file(&path)?;
        let at = now_ms();
        let stored = HistoryEntry {
            id: format!("{at:013}-{:06}", self.seq.fetch_add(1, Ordering::SeqCst) % 1_000_000),
            at,
            text: entry.text,
            prompt: entry.prompt,
            contract: entry.contract,
            engine: entry.engine,
            target_app: entry.target_app,
            audio_ms: entry.audio_ms,
            delivered: entry.delivered,
        };
        file.entries.insert(0, stored.clone());
        file.entries.truncate(HISTORY_LIMIT);
        write_file(&path, &file)?;
        Ok(stored)
    }

    pub fn delete<R: Runtime, M: Manager<R>>(&self, app: &M, id: &str) -> Result<bool, String> {
        let path = self.location(app)?;
        let mut file = read_file(&path)?;
        let before = file.entries.len();
        file.entries.retain(|entry| entry.id != id);
        let removed = file.entries.len() != before;
        if removed {
            write_file(&path, &file)?;
        }
        Ok(removed)
    }

    pub fn clear<R: Runtime, M: Manager<R>>(&self, app: &M) -> Result<usize, String> {
        let path = self.location(app)?;
        let mut file = read_file(&path)?;
        let removed = file.entries.len();
        file.entries.clear();
        write_file(&path, &file)?;
        Ok(removed)
    }
}

fn read_file(path: &PathBuf) -> Result<HistoryFile, String> {
    match fs::read_to_string(path) {
        Ok(text) => serde_json::from_str::<HistoryFile>(&text).or_else(|_| {
            // A corrupt store must not brick the app. Keep the bad file beside
            // the new one so nothing is silently destroyed, and start fresh.
            let _ = fs::rename(path, path.with_extension("json.corrupt"));
            Ok(empty_file())
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(empty_file()),
        Err(error) => Err(format!("Failed to read history at {}: {error}", path.display())),
    }
}

fn write_file(path: &PathBuf, file: &HistoryFile) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create {}: {error}", parent.display()))?;
    }
    let text = serde_json::to_string_pretty(file)
        .map_err(|error| format!("Failed to serialize history: {error}"))?;
    // Write-then-rename so a crash mid-write cannot truncate the store.
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, text)
        .map_err(|error| format!("Failed to write history: {error}"))?;
    fs::rename(&temporary, path)
        .map_err(|error| format!("Failed to commit history at {}: {error}", path.display()))
}

fn empty_file() -> HistoryFile {
    HistoryFile {
        schema: HISTORY_SCHEMA.to_string(),
        entries: Vec::new(),
    }
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}
