use tauri::Manager;
mod speech;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // Route target="_blank" links to the system browser from the WebView.
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            speech::speech_recognition_available,
            speech::start_speech_recognition,
            speech::stop_speech_recognition,
        ])
        .setup(|app| {
            let root=spielberg_backend::default_data_dir();
            let backend=spielberg_backend::Backend::start_configured(root, std::net::Ipv4Addr::UNSPECIFIED.into())?;
            let api_url=backend.client_url();
            let bootstrap=format!("window.__SPIELBERG_API_URL__={};",serde_json::to_string(&api_url)?);
            app.manage(backend);
            tauri::WebviewWindowBuilder::new(app,"main",tauri::WebviewUrl::App("index.html".into()))
                .title("Spielberg")
                .inner_size(1420.0,920.0).min_inner_size(1100.0,720.0)
                // Let Finder/Explorer file drops reach the frontend HTML5 handlers.
                .disable_drag_drop_handler()
                .initialization_script(&bootstrap)
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("启动 Spielberg 失败")
        .run(|_, event| {
            if matches!(event, tauri::RunEvent::Exit) { speech::shutdown(); }
        });
}
