mod food_safety;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if let Err(error) = food_safety::cleanup_owned_seat_files(app.handle()) {
                eprintln!("宠物座位启动清理失败，文件已安全保留: {error}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            food_safety::find_seat_candidates,
            food_safety::create_owned_seat_file,
            food_safety::trash_owned_seat_file,
            food_safety::inspect_user_food,
            food_safety::trash_user_food,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run black shirt companion");
}
