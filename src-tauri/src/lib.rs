use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let root=std::env::var_os("SPIELBERG_DATA_DIR").map(std::path::PathBuf::from).unwrap_or(app.path().app_data_dir()?);
            let backend=spielberg_backend::Backend::start(root,"0.0.0.0:8080")?;
            let api_url="http://127.0.0.1:8080";
            let bootstrap=format!("window.__SPIELBERG_API_URL__={};",serde_json::to_string(&api_url)?);
            app.manage(backend);
            tauri::WebviewWindowBuilder::new(app,"main",tauri::WebviewUrl::App("index.html".into()))
                .title("Spielberg")
                .inner_size(1420.0,920.0).min_inner_size(1100.0,720.0)
                .initialization_script(&bootstrap)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("启动 Spielberg 失败");
}
