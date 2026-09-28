use std::{env, fs, path::PathBuf};

fn main() {
    tauri_build::build();
    let manifest = PathBuf::from(env::var_os("CARGO_MANIFEST_DIR").unwrap());
    let dist = manifest.join("../dist");
    println!("cargo:rerun-if-changed={}", dist.display());
    let mut entries = Vec::new();
    if dist.is_dir() {
        collect(&dist, &dist, &mut entries);
    }
    let mut generated = String::from("pub fn asset(path: &str) -> Option<&'static [u8]> { match path {\n");
    for (relative, absolute) in entries {
        let key = if relative == "index.html" { "".to_string() } else { relative };
        generated.push_str(&format!("{:?} => Some(include_bytes!({:?})),\n", key, absolute));
    }
    generated.push_str("_ => None, } }\n");
    let out = PathBuf::from(env::var_os("OUT_DIR").unwrap()).join("server_assets.rs");
    fs::write(out, generated).unwrap();
}

fn collect(root: &PathBuf, dir: &PathBuf, entries: &mut Vec<(String, String)>) {
    for item in fs::read_dir(dir).unwrap() {
        let path = item.unwrap().path();
        if path.is_dir() { collect(root, &path, entries); }
        else if let Ok(relative) = path.strip_prefix(root) {
            entries.push((relative.to_string_lossy().replace('\\', "/"), path.to_string_lossy().into_owned()));
        }
    }
}
