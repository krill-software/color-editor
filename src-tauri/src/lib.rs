use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use krill_desktop_core::{fs as kfs, state as kstate, dev as kdev, updater::BuilderExt};

const SLUG: &str = "krill-color-editor";

#[derive(Debug, Serialize)]
struct CssRead {
    path: String,
    contents: String,
}

// The .css IS the document — Rust is a plain-text courier. read_css hands the
// file's text to the webview (parsed into rows there); write_css persists the
// :root block the editor renders.
#[tauri::command]
fn read_css(path: String) -> Result<CssRead, String> {
    let p = Path::new(&path);
    let contents = fs::read_to_string(p).map_err(|e| kfs::format_io_err(&path, e))?;
    Ok(CssRead { path: kfs::absolute_path(p), contents })
}

#[tauri::command]
fn write_css(path: String, contents: String) -> Result<String, String> {
    let p = Path::new(&path);
    if let Some(parent) = p.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|e| kfs::format_io_err(&path, e))?;
        }
    }
    fs::write(p, contents).map_err(|e| kfs::format_io_err(&path, e))?;
    Ok(kfs::absolute_path(p))
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct AppState {
    window: Option<kstate::WindowGeometry>,
    recent: Option<Vec<String>>,
    /// Bookmarked colors from the Discover tab — cross-document.
    saved: Option<Vec<String>>,
}

#[tauri::command]
fn load_state() -> Option<AppState> {
    kstate::load(SLUG, "state.json")
}

#[tauri::command]
fn save_state(state: AppState) -> Result<(), String> {
    kstate::save(SLUG, "state.json", &state)
}

#[tauri::command]
fn dev_test_file() -> Option<String> {
    kdev::test_file(env!("CARGO_MANIFEST_DIR"), &["test.css"])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .with_updater()
        .plugin(tauri_plugin_cli::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            read_css,
            write_css,
            load_state,
            save_state,
            dev_test_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
