//! System speech recognition. The recognizer lives in the app process so macOS
//! attributes microphone and Speech permissions to Spielberg, not a helper.
#[cfg(target_os = "macos")]
mod native {
    use std::{ffi::{CStr, CString}, os::raw::c_char, sync::OnceLock};
    use tauri::{AppHandle, Emitter};

    static APP: OnceLock<AppHandle> = OnceLock::new();

    extern "C" {
        fn spielberg_speech_available() -> bool;
        fn spielberg_speech_start(session: *const c_char, locale: *const c_char, callback: extern "C" fn(*const c_char));
        fn spielberg_speech_stop(session: *const c_char, cancel: bool);
        fn spielberg_speech_shutdown();
    }

    extern "C" fn receive_event(raw: *const c_char) {
        if raw.is_null() { return; }
        // The native side keeps this UTF-8 JSON string alive for the callback.
        let bytes = unsafe { CStr::from_ptr(raw) }.to_bytes();
        if let (Some(app), Ok(event)) = (APP.get(), serde_json::from_slice::<serde_json::Value>(bytes)) {
            let _ = app.emit("agent-speech", event);
        }
    }

    pub fn available() -> bool { unsafe { spielberg_speech_available() } }
    pub fn start(app: AppHandle, session: String, locale: String) -> Result<(), String> {
        if session.is_empty() || session.len() > 128 { return Err("无效的语音会话".into()); }
        if locale.len() > 64 { return Err("无效的识别语言".into()); }
        let session = CString::new(session).map_err(|_| "无效的语音会话")?;
        let locale = CString::new(locale).map_err(|_| "无效的识别语言")?;
        let _ = APP.set(app);
        unsafe { spielberg_speech_start(session.as_ptr(), locale.as_ptr(), receive_event); }
        Ok(())
    }
    pub fn stop(session: String, cancel: bool) -> Result<(), String> {
        let session = CString::new(session).map_err(|_| "无效的语音会话")?;
        unsafe { spielberg_speech_stop(session.as_ptr(), cancel); }
        Ok(())
    }
    pub fn shutdown() { unsafe { spielberg_speech_shutdown(); } }
}

#[tauri::command]
pub fn speech_recognition_available() -> bool {
    #[cfg(target_os = "macos")]
    { native::available() }
    #[cfg(not(target_os = "macos"))]
    { false }
}

#[tauri::command]
pub fn start_speech_recognition(app: tauri::AppHandle, session_id: String, locale: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    { native::start(app, session_id, locale) }
    #[cfg(not(target_os = "macos"))]
    { let _ = (app, session_id, locale); Err("当前系统未提供原生语音识别，请使用支持语音识别的浏览器或文字输入".into()) }
}

#[tauri::command]
pub fn stop_speech_recognition(session_id: String, cancel: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    { native::stop(session_id, cancel) }
    #[cfg(not(target_os = "macos"))]
    { let _ = (session_id, cancel); Ok(()) }
}

pub fn shutdown() {
    #[cfg(target_os = "macos")]
    native::shutdown();
}
