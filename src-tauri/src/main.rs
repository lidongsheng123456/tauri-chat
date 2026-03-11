// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// 应用程序入口点。
///
/// 直接委托给 `lanchat_lib::run()` 启动 Tauri 应用，
/// 保持 `main.rs` 尽量简洁，所有初始化逻辑集中在 `lib.rs` 中管理。
fn main() {
    lanchat_lib::run();
}
