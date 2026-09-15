// ponytail: 数据层已移到前端（src/services/tickflow.ts），
// Rust 只保留桌面壳。仅当需要系统能力（文件、通知等）时才在这里加代码。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
