#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_updates;
mod desktop_targets;
mod food_safety;
mod instance_position;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            use tauri::Manager;

            if let Some(window) = app.get_webview_window("main") {
                if let Err(error) = window.show().and_then(|_| window.set_focus()) {
                    eprintln!("UNO 已在运行，但无法聚焦现有窗口: {error}");
                }
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(app_updates::UpdateManager::default())
        .setup(|app| {
            if let Err(error) = instance_position::position_main_window(app.handle()) {
                eprintln!("UNO 多实例窗口定位失败: {error}");
            }
            if let Err(error) = food_safety::cleanup_owned_seat_files(app.handle()) {
                eprintln!("宠物座位启动清理失败，文件已安全保留: {error}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            desktop_targets::find_seat_targets,
            desktop_targets::refresh_window_seat,
            food_safety::create_owned_seat_file,
            food_safety::trash_owned_seat_file,
            food_safety::inspect_user_food,
            food_safety::trash_user_food,
            app_updates::prepare_update,
            app_updates::install_pending_update,
            app_updates::system_idle_seconds,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run black shirt companion");
}
