use std::{env, path::PathBuf, process::Command};

fn main() {
    tauri_build::build();
    println!("cargo:rerun-if-changed=src/speech_macos.m");
    println!("cargo:rerun-if-changed=Info.plist");
    println!("cargo:rerun-if-changed=Entitlements.plist");
    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") { return; }

    // Use the installed Apple toolchain, with no new runtime or Cargo dependency.
    let out = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR"));
    let target = match env::var("CARGO_CFG_TARGET_ARCH").as_deref() {
        Ok("aarch64") => "arm64-apple-macos11.0",
        Ok("x86_64") => "x86_64-apple-macos10.15",
        _ => panic!("unsupported macOS architecture"),
    };
    let object = out.join("speech_macos.o");
    let status = Command::new("xcrun")
        .args(["clang", "-target", target, "-fobjc-arc", "-fblocks", "-Wall", "-Wextra", "-Wno-unused-parameter", "-O2", "-c", "src/speech_macos.m", "-o"])
        .arg(&object).status().expect("Apple clang is required for system speech recognition");
    assert!(status.success(), "failed to compile system speech recognition");
    let status = Command::new("xcrun").args(["ar", "crus"])
        .arg(out.join("libspielberg_speech.a")).arg(object).status().expect("Apple ar is required");
    assert!(status.success(), "failed to archive system speech recognition");
    println!("cargo:rustc-link-search=native={}", out.display());
    println!("cargo:rustc-link-lib=static=spielberg_speech");
    for framework in ["Foundation", "AVFoundation", "Speech"] {
        println!("cargo:rustc-link-lib=framework={framework}");
    }
}
