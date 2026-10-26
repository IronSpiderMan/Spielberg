use super::*;
use serde::{Deserialize, Serialize};
use std::{collections::{BTreeMap, HashSet}, io::Read, time::Duration};

const MAX_FILES: usize = 256;
const MAX_TOTAL: usize = 10 * 1024 * 1024;
const MAX_FILE: usize = 2 * 1024 * 1024;
const MAX_SKILL: usize = 32 * 1024;
const MAX_ARCHIVE: usize = 25 * 1024 * 1024;
const MAX_EXPANDED: u64 = 100 * 1024 * 1024;
const META: &str = ".spielberg-skill.json";

#[derive(Clone, Serialize, Deserialize)]
struct Metadata {
    id: String, name: String, description: String, enabled: bool, source: String,
    installed_at: String, updated_at: String, files_count: usize,
    source_kind: String, revision: String,
}
impl Metadata {
    fn summary(&self) -> Value {
        json!({"id":self.id,"name":self.name,"description":self.description,"enabled":self.enabled,
            "source":self.source,"installed_at":self.installed_at,"updated_at":self.updated_at,"files_count":self.files_count})
    }
}
struct Package { name: String, description: String, files: BTreeMap<String, Vec<u8>>, source: String, source_kind: String }
fn directory(s: &AppState) -> PathBuf { s.root.join("skills") }
fn io_error(e: std::io::Error) -> String { format!("Skill 文件操作失败：{e}") }
fn valid_name(name: &str) -> bool {
    !name.is_empty() && name.len() <= 64 && !name.starts_with('-') && !name.ends_with('-')
        && !name.contains("--") && name.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}
fn id_value(v: &Value) -> Result<&str, String> {
    let id = v["id"].as_str().ok_or("缺少 Skill ID")?;
    if !valid_name(id) { return Err("Skill ID 无效".into()); }
    Ok(id)
}
fn checked_path(path: &str) -> Result<String, String> {
    if path.is_empty() || path.len() > 512 || path.contains('\\') || path.chars().any(char::is_control) {
        return Err("Skill 文件路径无效".into());
    }
    let parts: Vec<_> = path.split('/').collect();
    if parts.len() > 16 || parts.iter().any(|p| p.is_empty() || [".", "..", ".git"].contains(&p.to_ascii_lowercase().as_str()) || p.to_ascii_lowercase().starts_with(".spielberg-") || p.contains(':')) {
        return Err("Skill 文件路径无效，不能越界或使用保留路径".into());
    }
    Ok(parts.join("/"))
}
fn regular(path: &Path, dir: bool) -> Result<(), String> {
    let m = fs::symlink_metadata(path).map_err(io_error)?;
    if m.file_type().is_symlink() || (dir && !m.is_dir()) || (!dir && !m.is_file()) {
        return Err("Skill 不能包含符号链接或特殊文件".into());
    }
    Ok(())
}
fn atomic_json(path: &Path, value: &Metadata) -> Result<(), String> {
    let temporary = path.with_extension(format!("tmp-{}", Uuid::new_v4()));
    let result = (|| {
        let bytes = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
        use std::io::Write;
        let mut file = fs::File::create(&temporary).map_err(io_error)?;
        file.write_all(&bytes).map_err(io_error)?;
        file.sync_all().map_err(io_error)?;
        fs::rename(&temporary, path).map_err(io_error)
    })();
    if result.is_err() { let _ = fs::remove_file(temporary); }
    result
}
// Commands hold the shared application lock while recovering and committing local state.
fn recover(s: &AppState) -> Result<(), String> {
    let root = directory(s);
    fs::create_dir_all(&root).map_err(io_error)?;
    regular(&root, true)?;
    for entry in fs::read_dir(&root).map_err(io_error)? {
        let entry = entry.map_err(io_error)?;
        let name = entry.file_name().to_string_lossy().to_string();
        if let Some(id) = name.strip_prefix(".backup-") {
            if !valid_name(id) { continue; }
            regular(&entry.path(), true)?;
            if root.join(id).exists() { fs::remove_dir_all(entry.path()).map_err(io_error)?; }
            else { fs::rename(entry.path(), root.join(id)).map_err(io_error)?; }
        } else if name.starts_with(".staging-") || name.starts_with(".deleted-") {
            regular(&entry.path(), true)?;
            fs::remove_dir_all(entry.path()).map_err(io_error)?;
        }
    }
    Ok(())
}
fn metadata(s: &AppState, id: &str) -> Result<Metadata, String> {
    if !valid_name(id) { return Err("Skill ID 无效".into()); }
    let folder = directory(s).join(id);
    if !folder.exists() { return Err("Skill 不存在".into()); }
    regular(&folder, true)?;
    regular(&folder.join(META), false)?;
    let mut raw = vec![];
    fs::File::open(folder.join(META)).map_err(io_error)?.take(16 * 1024 + 1).read_to_end(&mut raw).map_err(io_error)?;
    if raw.len() > 16 * 1024 { return Err("Skill 元数据过大".into()); }
    let m: Metadata = serde_json::from_slice(&raw).map_err(|_| "Skill 元数据损坏")?;
    if m.id != id || m.name != id || !valid_name(&m.name) || m.description.is_empty() || m.description.chars().count() > 1000 { return Err("Skill 元数据无效".into()); }
    Ok(m)
}
fn installed(s: &AppState) -> Result<Vec<Metadata>, String> {
    recover(s)?;
    let mut all = vec![];
    for entry in fs::read_dir(directory(s)).map_err(io_error)? {
        let entry = entry.map_err(io_error)?;
        let id = entry.file_name().to_string_lossy().to_string();
        if id.starts_with('.') { continue; }
        all.push(metadata(s, &id)?);
    }
    all.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(all)
}
fn frontmatter(bytes: &[u8]) -> Result<(String, String), String> {
    if bytes.len() > MAX_SKILL { return Err("SKILL.md 不能超过 32 KiB，请缩短指令并使用辅助文件".into()); }
    let content = std::str::from_utf8(bytes).map_err(|_| "SKILL.md 必须是 UTF-8 文本")?;
    let content = content.strip_prefix('\u{feff}').unwrap_or(content);
    let mut lines = content.lines();
    if lines.next() != Some("---") { return Err("SKILL.md 必须包含 YAML 前置信息（name 和 description）".into()); }
    let mut yaml = String::new();
    let mut closed = false;
    for line in lines {
        if line == "---" { closed = true; break; }
        yaml.push_str(line); yaml.push('\n');
    }
    if !closed { return Err("SKILL.md 的 YAML 前置信息未闭合".into()); }
    let fields: serde_yaml::Value = serde_yaml::from_str(&yaml).map_err(|e| format!("SKILL.md 前置信息格式无效：{e}"))?;
    let name = fields.get("name").and_then(serde_yaml::Value::as_str).ok_or("SKILL.md 缺少有效的 name")?.trim();
    let description = fields.get("description").and_then(serde_yaml::Value::as_str).ok_or("SKILL.md 缺少有效的 description")?.trim();
    if !valid_name(name) { return Err("Skill name 必须为 1–64 位小写字母、数字或连字符，且不能以连字符开头、结尾或包含连续连字符".into()); }
    if description.is_empty() || description.chars().count() > 1000 || description.contains('\0') {
        return Err("Skill description 必须为 1–1000 个字符".into());
    }
    Ok((name.into(), description.into()))
}
fn package(files: BTreeMap<String, Vec<u8>>, source: String, source_kind: &str) -> Result<Package, String> {
    if files.len() > MAX_FILES { return Err("每个 Skill 最多包含 256 个文件".into()); }
    let mut total = 0;
    let mut paths = HashSet::new();
    for (path, bytes) in &files {
        checked_path(path)?;
        if !paths.insert(path.to_lowercase()) { return Err("Skill 文件路径重复（忽略大小写）".into()); }
        if bytes.len() > MAX_FILE { return Err(format!("Skill 单个文件不能超过 2 MiB：{path}")); }
        if path.ends_with("/SKILL.md") { return Err("所选目录包含多个 Skill，请指定某个 Skill 子目录".into()); }
        total += bytes.len();
    }
    for path in &paths {
        let mut ancestor = path.as_str();
        while let Some((parent, _)) = ancestor.rsplit_once('/') {
            if paths.contains(parent) { return Err("Skill 文件与目录路径冲突".into()); }
            ancestor = parent;
        }
    }
    if total > MAX_TOTAL { return Err("每个 Skill 总大小不能超过 10 MiB".into()); }
    let instructions = files.get("SKILL.md").ok_or("所选目录没有 SKILL.md；请指定包含该文件的 Skill 子目录")?;
    let (name, description) = frontmatter(instructions)?;
    Ok(Package { name, description, files, source, source_kind: source_kind.into() })
}
fn uploaded(v: &Value) -> Result<Package, String> {
    let input = v["files"].as_array().ok_or("缺少 Skill 文件列表")?;
    if input.len() > MAX_FILES { return Err("每个 Skill 最多包含 256 个文件".into()); }
    let mut files = BTreeMap::new();
    let mut total = 0;
    for file in input {
        let path = checked_path(file["path"].as_str().ok_or("缺少 Skill 文件路径")?)?;
        let encoded = file["content_base64"].as_str().ok_or("缺少 Skill 文件内容")?;
        if encoded.len() > (MAX_FILE + 2) / 3 * 4 { return Err("Skill 单个文件不能超过 2 MiB".into()); }
        let bytes = base64::engine::general_purpose::STANDARD.decode(encoded).map_err(|_| "Skill 文件的 Base64 数据无效")?;
        total += bytes.len();
        if total > MAX_TOTAL { return Err("每个 Skill 总大小不能超过 10 MiB".into()); }
        if files.insert(path, bytes).is_some() { return Err("Skill 文件路径重复".into()); }
    }
    let source = v.get("source_name").map(|x| x.as_str().ok_or("source_name 必须是字符串")).transpose()?.unwrap_or("本地导入").trim();
    if source.is_empty() || source.chars().count() > 200 || source.chars().any(char::is_control) { return Err("本地来源名称无效".into()); }
    package(files, source.into(), "local")
}

#[derive(Debug)]
struct GithubSource { owner: String, repo: String, revision: String, subdir: String, source: String }
fn decode_component(input: &str) -> Result<String, String> {
    let bytes = input.as_bytes();
    let mut decoded = vec![];
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if i + 2 >= bytes.len() { return Err("GitHub 地址编码无效".into()); }
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).map_err(|_| "GitHub 地址编码无效")?;
            decoded.push(u8::from_str_radix(hex, 16).map_err(|_| "GitHub 地址编码无效")?);
            i += 3;
        } else { decoded.push(bytes[i]); i += 1; }
    }
    let decoded = String::from_utf8(decoded).map_err(|_| "GitHub 地址编码无效")?;
    if decoded.contains('/') { return Err("GitHub 地址不能使用编码后的路径分隔符".into()); }
    checked_path(&decoded)?;
    Ok(decoded)
}
fn github_source(input: &str) -> Result<GithubSource, String> {
    let url = reqwest::Url::parse(input.trim()).map_err(|_| "请输入有效的 GitHub 仓库或 tree 子目录链接")?;
    if url.scheme() != "https" || url.host_str() != Some("github.com") || !url.username().is_empty()
        || url.password().is_some() || url.port().is_some() || url.query().is_some() || url.fragment().is_some() {
        return Err("仅支持 https://github.com 的仓库或 tree 子目录链接".into());
    }
    let parts = url.path().trim_matches('/').split('/').map(decode_component).collect::<Result<Vec<_>, _>>()?;
    if parts.len() < 2 { return Err("GitHub 地址缺少仓库名称".into()); }
    let owner = parts[0].clone();
    let repo = parts[1].strip_suffix(".git").unwrap_or(&parts[1]).to_string();
    if owner.len() > 100 || repo.is_empty() || repo.len() > 100
        || !owner.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
        || !repo.bytes().all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b)) || [".", ".."].contains(&repo.as_str()) {
        return Err("GitHub 仓库名称无效".into());
    }
    if parts.len() > 2 && (parts.len() < 4 || parts[2] != "tree") { return Err("请使用 GitHub 仓库或 tree 子目录链接".into()); }
    let revision = parts.get(3).cloned().unwrap_or_else(|| "HEAD".into());
    let subdir = parts.get(4..).unwrap_or(&[]).join("/");
    let mut normalized = reqwest::Url::parse("https://github.com").unwrap();
    { let mut segments = normalized.path_segments_mut().unwrap();
      segments.push(&owner).push(&repo);
      if parts.len() > 2 { segments.push("tree").push(&revision); for segment in &parts[4..] { segments.push(segment); } }
    }
    Ok(GithubSource { owner, repo, revision, subdir, source: normalized.into() })
}
fn archive_files(bytes: &[u8], subdir: &str) -> Result<BTreeMap<String, Vec<u8>>, String> {
    let decoder = flate2::read::GzDecoder::new(bytes).take(MAX_EXPANDED + 1);
    let mut archive = tar::Archive::new(decoder);
    let mut files = BTreeMap::new();
    let mut root: Option<String> = None;
    let mut expanded = 0u64;
    let mut total = 0usize;
    for (index, entry) in archive.entries().map_err(|_| "GitHub 压缩包无效")?.enumerate() {
        if index >= 20_000 { return Err("GitHub 仓库文件过多，请选择较小的仓库".into()); }
        let mut entry = entry.map_err(|_| "GitHub 压缩包损坏或展开大小超过限制")?;
        expanded = expanded.checked_add(entry.size()).ok_or("GitHub 压缩包过大")?;
        if expanded > MAX_EXPANDED { return Err("GitHub 仓库展开大小不能超过 100 MiB".into()); }
        // GitHub codeload starts git archives with a global PAX commit comment.
        // It describes the archive and is not a member of its root directory.
        if entry.header().entry_type().is_pax_global_extensions() {
            if entry.size() > 16 * 1024 { return Err("GitHub 压缩包 PAX 元数据过大".into()); }
            let extensions = entry.pax_extensions().map_err(|_| "GitHub 压缩包 PAX 元数据无效")?.ok_or("GitHub 压缩包 PAX 元数据无效")?;
            for extension in extensions {
                let extension = extension.map_err(|_| "GitHub 压缩包 PAX 元数据无效")?;
                let key = extension.key().map_err(|_| "GitHub 压缩包 PAX 元数据无效")?;
                extension.value().map_err(|_| "GitHub 压缩包 PAX 元数据无效")?;
                if ["path", "linkpath", "size"].contains(&key) || key.starts_with("GNU.sparse.") {
                    return Err("GitHub 压缩包不支持全局 PAX 路径、链接或大小覆盖".into());
                }
            }
            continue;
        }
        let path = entry.path().map_err(|_| "GitHub 压缩包包含无效路径")?;
        let path = path.to_str().ok_or("GitHub 压缩包文件路径必须为 UTF-8")?.trim_end_matches('/').to_string();
        let path = checked_path(&path)?;
        let (entry_root, relative) = path.split_once('/').unwrap_or((&path, ""));
        if let Some(root) = &root { if root != entry_root { return Err("GitHub 压缩包根目录无效".into()); } }
        else { root = Some(entry_root.to_string()); }
        let relative = if subdir.is_empty() { relative }
            else if relative == subdir { "" }
            else if let Some(relative) = relative.strip_prefix(&format!("{subdir}/")) { relative }
            else { continue; };
        if relative.is_empty() { continue; }
        if entry.header().entry_type().is_dir() { continue; }
        if !entry.header().entry_type().is_file() { return Err("所选 Skill 目录不能包含符号链接、硬链接或特殊文件".into()); }
        let relative = checked_path(relative)?;
        if entry.size() > MAX_FILE as u64 { return Err(format!("Skill 单个文件不能超过 2 MiB：{relative}")); }
        let mut content = vec![];
        entry.take((MAX_FILE + 1) as u64).read_to_end(&mut content).map_err(|_| "GitHub 文件解压失败")?;
        total += content.len();
        if total > MAX_TOTAL { return Err("每个 Skill 总大小不能超过 10 MiB".into()); }
        if files.insert(relative, content).is_some() { return Err("GitHub 压缩包包含重复文件路径".into()); }
        if files.len() > MAX_FILES { return Err("每个 Skill 最多包含 256 个文件".into()); }
    }
    Ok(files)
}
fn github(input: &str) -> Result<Package, String> {
    let source = github_source(input)?;
    let mut download = reqwest::Url::parse("https://codeload.github.com").unwrap();
    download.path_segments_mut().unwrap().push(&source.owner).push(&source.repo).push("tar.gz").push(&source.revision);
    let client = reqwest::blocking::Client::builder().connect_timeout(Duration::from_secs(10)).timeout(Duration::from_secs(90))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() < 4 && attempt.url().scheme() == "https"
                && [Some("github.com"), Some("codeload.github.com")].contains(&attempt.url().host_str())
                && attempt.url().username().is_empty() && attempt.url().password().is_none() && attempt.url().port().is_none() { attempt.follow() }
            else { attempt.stop() }
        })).build().map_err(|e| format!("无法创建 GitHub 下载连接：{e}"))?;
    let response = client.get(download).header(reqwest::header::USER_AGENT, "Spielberg-Skills/1.0").send()
        .map_err(|e| format!("GitHub 下载失败：{e}"))?;
    if !response.status().is_success() { return Err(format!("GitHub 下载失败（HTTP {}），请检查仓库、分支和目录是否公开可访问", response.status().as_u16())); }
    if response.content_length().is_some_and(|size| size > MAX_ARCHIVE as u64) { return Err("GitHub 压缩包不能超过 25 MiB".into()); }
    let mut bytes = vec![];
    response.take((MAX_ARCHIVE + 1) as u64).read_to_end(&mut bytes).map_err(|e| format!("GitHub 下载失败：{e}"))?;
    if bytes.len() > MAX_ARCHIVE { return Err("GitHub 压缩包不能超过 25 MiB".into()); }
    let files = archive_files(&bytes, &source.subdir)?;
    if !files.contains_key("SKILL.md") { return Err("所选 GitHub 目录没有 SKILL.md；请使用指向某个 Skill 子目录的 tree 链接".into()); }
    package(files, source.source, "github")
}

fn commit(s: &AppState, p: Package, previous: Option<Metadata>) -> Result<Value, String> {
    let all = installed(s)?;
    if let Some(previous) = &previous {
        if p.name != previous.id { return Err("重装后 Skill name 必须与原名称一致".into()); }
    } else if all.iter().any(|m| m.id == p.name || (p.source_kind == "github" && m.source_kind == "github" && m.source == p.source)) {
        return Err("该 Skill 已安装，请使用更新或重装功能".into());
    }
    let timestamp = now();
    let meta = Metadata {
        id: p.name.clone(), name: p.name, description: p.description, enabled: previous.as_ref().map(|m| m.enabled).unwrap_or(true),
        source: p.source, source_kind: p.source_kind, installed_at: previous.as_ref().map(|m| m.installed_at.clone()).unwrap_or_else(|| timestamp.clone()),
        updated_at: timestamp, files_count: p.files.len(), revision: Uuid::new_v4().to_string(),
    };
    let root = directory(s);
    let target = root.join(&meta.id);
    let stage = root.join(format!(".staging-{}", Uuid::new_v4()));
    fs::create_dir(&stage).map_err(io_error)?;
    let result = (|| {
        for (path, bytes) in p.files {
            let path = stage.join(path);
            fs::create_dir_all(path.parent().ok_or("Skill 文件路径无效")?).map_err(io_error)?;
            fs::write(&path, bytes).map_err(io_error)?;
            fs::OpenOptions::new().write(true).open(path).map_err(io_error)?.sync_all().map_err(io_error)?;
        }
        atomic_json(&stage.join(META), &meta)?;
        // Filesystems that normalize Unicode names must not silently merge uploads.
        if file_inventory(&stage)?.len() != meta.files_count { return Err("Skill 文件路径在当前文件系统中重复".into()); }
        let backup = root.join(format!(".backup-{}", meta.id));
        if previous.is_some() { fs::rename(&target, &backup).map_err(io_error)?; }
        if let Err(error) = fs::rename(&stage, &target) {
            if previous.is_some() { let _ = fs::rename(&backup, &target); }
            return Err(io_error(error));
        }
        if previous.is_some() { let _ = fs::remove_dir_all(backup); }
        Ok(meta.summary())
    })();
    if result.is_err() { let _ = fs::remove_dir_all(stage); }
    result
}
fn file_inventory(folder: &Path) -> Result<Vec<Value>, String> {
    fn visit(root: &Path, relative: &str, files: &mut Vec<Value>, total: &mut u64) -> Result<(), String> {
        let folder = root.join(relative);
        regular(&folder, true)?;
        for entry in fs::read_dir(folder).map_err(io_error)? {
            let entry = entry.map_err(io_error)?;
            let name = entry.file_name().into_string().map_err(|_| "Skill 文件路径必须为 UTF-8")?;
            if relative.is_empty() && name.starts_with(".spielberg-skill.") { continue; }
            let path = if relative.is_empty() { name } else { format!("{relative}/{name}") };
            checked_path(&path)?;
            let m = fs::symlink_metadata(entry.path()).map_err(io_error)?;
            if m.file_type().is_symlink() || (!m.is_file() && !m.is_dir()) { return Err("Skill 不能包含符号链接或特殊文件".into()); }
            if m.is_dir() { visit(root, &path, files, total)?; }
            else {
                if m.len() > MAX_FILE as u64 { return Err("Skill 文件超过 2 MiB 限制".into()); }
                *total += m.len();
                files.push(json!({"path":path,"size":m.len()}));
                if files.len() > MAX_FILES || *total > MAX_TOTAL as u64 { return Err("Skill 文件数量或总大小超过限制".into()); }
            }
        }
        Ok(())
    }
    let mut files = vec![];
    visit(folder, "", &mut files, &mut 0)?;
    files.sort_by(|a, b| a["path"].as_str().cmp(&b["path"].as_str()));
    Ok(files)
}
fn detail(s: &AppState, id: &str) -> Result<Value, String> {
    let meta = metadata(s, id)?;
    let files = file_inventory(&directory(s).join(id))?;
    let content = read_file(s, id, "SKILL.md")?;
    frontmatter(content.as_bytes())?;
    let mut result = meta.summary();
    result["content"] = json!(content);
    result["files"] = json!(files);
    Ok(result)
}
fn read_file(s: &AppState, id: &str, path: &str) -> Result<String, String> {
    let path = checked_path(path)?;
    let mut file = directory(s).join(id);
    regular(&file, true)?;
    let parts: Vec<_> = path.split('/').collect();
    for (index, component) in parts.iter().enumerate() {
        file.push(component);
        if !file.exists() { return Err("Skill 文件不存在".into()); }
        regular(&file, index + 1 != parts.len())?;
    }
    let size = fs::metadata(&file).map_err(io_error)?.len();
    if size > MAX_FILE as u64 || (path == "SKILL.md" && size > MAX_SKILL as u64) { return Err("Skill 文件超过大小限制".into()); }
    let content = fs::read(&file).map_err(io_error)?;
    if content.len() > MAX_FILE { return Err("Skill 文件超过大小限制".into()); }
    let content = String::from_utf8(content).map_err(|_| "该 Skill 辅助文件是二进制文件，不能作为文本读取")?;
    if content.contains('\0') { return Err("该 Skill 辅助文件是二进制文件，不能作为文本读取".into()); }
    Ok(content)
}

pub(super) fn command(s: &AppState, action: &str, v: &Value) -> Result<Value, String> {
    if !v.is_object() { return Err("Skill 参数必须是 JSON 对象".into()); }
    if action == "install" {
        if v.get("files").is_some() && v.get("source").is_some() { return Err("请选择本地文件或 GitHub 来源之一".into()); }
        // All downloads and archive validation happen before taking the application lock.
        let p = if let Some(source) = v.get("source") { github(source.as_str().ok_or("GitHub source 必须是字符串")?)? } else { uploaded(v)? };
        let _lock = s.guard.lock().map_err(|_| "Skill 数据锁不可用")?;
        recover(s)?;
        let previous = v.get("replace_id").map(|id| metadata(s, id.as_str().ok_or("replace_id 必须是字符串")?)).transpose()?;
        return commit(s, p, previous);
    }
    if action == "update" {
        let id = id_value(v)?;
        let original = {
            let _lock = s.guard.lock().map_err(|_| "Skill 数据锁不可用")?;
            recover(s)?;
            metadata(s, id)?
        };
        if original.source_kind != "github" { return Err("本地导入的 Skill 请重新选择文件进行重装".into()); }
        let p = github(&original.source)?;
        let _lock = s.guard.lock().map_err(|_| "Skill 数据锁不可用")?;
        recover(s)?;
        let current = metadata(s, id)?;
        if current.revision != original.revision { return Err("下载期间 Skill 已被修改，请重试更新".into()); }
        return commit(s, p, Some(current));
    }
    let _lock = s.guard.lock().map_err(|_| "Skill 数据锁不可用")?;
    recover(s)?;
    match action {
        "list" => Ok(json!({"items":installed(s)?.iter().map(Metadata::summary).collect::<Vec<_>>(),"directory":directory(s)})),
        "detail" => detail(s, id_value(v)?),
        "toggle" => {
            let id = id_value(v)?;
            let enabled = v["enabled"].as_bool().ok_or("enabled 必须为布尔值")?;
            let mut m = metadata(s, id)?;
            m.enabled = enabled; m.updated_at = now(); m.revision = Uuid::new_v4().to_string();
            atomic_json(&directory(s).join(id).join(META), &m)?;
            Ok(m.summary())
        },
        "delete" => {
            let id = id_value(v)?;
            metadata(s, id)?;
            let deleted = directory(s).join(format!(".deleted-{}", Uuid::new_v4()));
            fs::rename(directory(s).join(id), &deleted).map_err(io_error)?;
            let _ = fs::remove_dir_all(deleted);
            Ok(json!({"ok":true}))
        },
        _ => Err("Skill 操作不存在".into()),
    }
}

// Callers already hold AppState.guard; these functions must not acquire it again.
pub(super) fn enabled_catalog(s: &AppState) -> Result<Value, String> {
    Ok(json!(installed(s)?.into_iter().filter(|m| m.enabled).map(|m| json!({"id":m.id,"name":m.name,"description":m.description})).collect::<Vec<_>>()))
}
pub(super) fn read_enabled(s: &AppState, id: &str, path: Option<&str>) -> Result<Value, String> {
    recover(s)?;
    let meta = metadata(s, id)?;
    if !meta.enabled { return Err("该 Skill 已停用，请先在设置中启用".into()); }
    let path = path.unwrap_or("SKILL.md");
    let content = read_file(s, id, path)?;
    if path == "SKILL.md" { frontmatter(content.as_bytes())?; }
    Ok(json!({"id":meta.id,"name":meta.name,"path":path,"total_chars":content.chars().count(),"content":content}))
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(AppState);
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!("spielberg-skills-test-{}", Uuid::new_v4()));
            fs::create_dir_all(&root).unwrap();
            Self(AppState { root, guard: std::sync::Arc::new(Mutex::new(())) })
        }
        fn run(&self, action: &str, v: Value) -> Result<Value, String> { command(&self.0, action, &v) }
    }
    impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0.root); } }
    fn file(path: &str, content: impl AsRef<[u8]>) -> Value {
        json!({"path":path,"content_base64":base64::engine::general_purpose::STANDARD.encode(content)})
    }
    fn instructions(name: &str, body: &str) -> String { format!("---\nname: {name}\ndescription: A useful test skill.\n---\n{body}") }
    fn upload(name: &str, body: &str) -> Value { json!({"files":[file("SKILL.md", instructions(name, body))]}) }
    fn archive(entries: &[(&str, &[u8], u8)]) -> Vec<u8> {
        let mut builder = tar::Builder::new(Vec::new());
        for (path, content, kind) in entries {
            let mut header = tar::Header::new_gnu();
            header.set_mode(0o644); header.set_size(content.len() as u64);
            header.set_entry_type(tar::EntryType::new(*kind));
            if *kind == b'2' { header.set_link_name("../../outside").unwrap(); }
            let bytes = header.as_mut_bytes();
            bytes[..100].fill(0); bytes[..path.len()].copy_from_slice(path.as_bytes());
            header.set_cksum(); builder.append(&header, *content).unwrap();
        }
        let tar = builder.into_inner().unwrap();
        let mut gzip = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        use std::io::Write;
        gzip.write_all(&tar).unwrap(); gzip.finish().unwrap()
    }
    #[test]
    fn global_lifecycle_and_runtime_follow_enabled_state() {
        let f = Fixture::new();
        assert_eq!(f.run("list", json!({})).unwrap()["items"], json!([]));
        let text = "---\nname: helpful-skill\ndescription: >-\n  Read project records\n  and prepare a report.\n---\nFollow the referenced notes.";
        let payload = json!({"source_name":"skills-folder","files":[file("SKILL.md",text),file("references/notes.md","你好，project notes")]});
        let installed = rest::action(&f.0, "/skills/install", payload).unwrap();
        assert_eq!(installed["id"], "helpful-skill"); assert_eq!(installed["files_count"], 2); assert_eq!(installed["enabled"], true);
        assert_eq!(installed["description"], "Read project records and prepare a report.");
        assert_eq!(installed["source"], "skills-folder");
        assert!(f.run("install", upload("helpful-skill","duplicate")).unwrap_err().contains("已安装"));
        let detail = f.run("detail", json!({"id":"helpful-skill"})).unwrap();
        assert_eq!(detail["content"], text); assert_eq!(detail["files"].as_array().unwrap().len(), 2);
        assert_eq!(enabled_catalog(&f.0).unwrap()[0]["id"], "helpful-skill");
        assert_eq!(read_enabled(&f.0, "helpful-skill", Some("references/notes.md")).unwrap()["content"], "你好，project notes");
        f.run("toggle", json!({"id":"helpful-skill","enabled":false})).unwrap();
        assert_eq!(enabled_catalog(&f.0).unwrap(), json!([]));
        assert!(read_enabled(&f.0,"helpful-skill",None).unwrap_err().contains("停用"));
        let restarted = AppState { root:f.0.root.clone(), guard:std::sync::Arc::new(Mutex::new(())) };
        assert_eq!(command(&restarted,"list",&json!({})).unwrap()["items"][0]["enabled"],false);
        assert!(f.run("update", json!({"id":"helpful-skill"})).unwrap_err().contains("本地"));
        assert_eq!(f.run("delete", json!({"id":"helpful-skill"})).unwrap(),json!({"ok":true}));
        assert!(f.run("detail",json!({"id":"helpful-skill"})).unwrap_err().contains("不存在"));
    }
    #[test]
    fn reinstall_preserves_identity_preferences_and_original_install_time() {
        let f=Fixture::new(); let first=f.run("install",upload("replace-me","old body")).unwrap();
        f.run("toggle",json!({"id":"replace-me","enabled":false})).unwrap();
        let mut replacement=upload("replace-me","new body"); replacement["replace_id"]=json!("replace-me");
        let updated=f.run("install",replacement).unwrap();
        assert_eq!(updated["installed_at"],first["installed_at"]); assert_eq!(updated["enabled"],false);
        assert!(f.run("detail",json!({"id":"replace-me"})).unwrap()["content"].as_str().unwrap().contains("new body"));
        let mut renamed=upload("changed-name","body"); renamed["replace_id"]=json!("replace-me");
        assert!(f.run("install",renamed).is_err());
        assert_eq!(f.run("list",json!({})).unwrap()["items"].as_array().unwrap().len(),1);
    }
    #[test]
    fn malformed_metadata_oversized_instructions_and_unsafe_paths_are_rejected() {
        let f=Fixture::new();
        for content in ["No frontmatter", "---\nname: valid\n---\nbody", "---\nname: [valid]\ndescription: text\n---", "---\nname: Invalid Name\ndescription: text\n---", "---\nname: valid\ndescription: [text]\n---", "---\nname: valid\nname: duplicate\ndescription: text\n---"] {
            assert!(f.run("install",json!({"files":[file("SKILL.md",content)]})).is_err(),"{content}");
        }
        let too_long=instructions("valid",&"x".repeat(MAX_SKILL));
        assert!(f.run("install",json!({"files":[file("SKILL.md",too_long)]})).unwrap_err().contains("32 KiB"));
        for path in ["../escape", "/absolute", "sub/../../escape", "sub\\escape", "C:/escape", ".spielberg-skill.json", "sub//file", "sub/./file"] {
            assert!(f.run("install",json!({"files":[file("SKILL.md",instructions("safe","body")),file(path,"content")]})).is_err(),"{path}");
        }
        assert!(f.run("install",json!({"files":[file("SKILL.md",instructions("safe","body")),file("SKILL.md","duplicate")]})).is_err());
        assert!(f.run("install",json!({"files":[file("SKILL.md",instructions("safe","body")),file("skill.md","case collision")]})).is_err());
        assert!(f.run("install",json!({"files":[file("SKILL.md",instructions("safe","body")),file(".SPIELBERG-SKILL.JSON","reserved")]})).is_err());
        assert!(f.run("install",json!({"files":[{"path":"SKILL.md","content_base64":"%%%%"}]})).is_err());
        assert!(f.run("detail",json!({"id":"../escape"})).is_err());
        assert!(f.run("toggle",json!({"id":"safe","enabled":"true"})).is_err());
        assert_eq!(f.run("list",json!({})).unwrap()["items"],json!([]));
    }
    #[test]
    fn github_links_and_archives_limit_download_scope_and_reject_links_or_traversal() {
        let source=github_source("https://github.com/example/repository/tree/main/skills/report").unwrap();
        assert_eq!(source.subdir,"skills/report"); assert_eq!(source.revision,"main");
        assert_eq!(github_source("https://github.com/example/repository.git").unwrap().revision,"HEAD");
        for source in ["http://github.com/a/b", "https://example.com/a/b", "https://github.com@evil.com/a/b", "https://github.com/a/b/blob/main/SKILL.md", "https://github.com/a/b?query=1", "https://github.com/a/b/tree/main/skills%2Fevil"] {
            assert!(github_source(source).is_err(),"{source}");
        }
        let skill=instructions("report","body");
        let bytes=archive(&[("repo-main/README.md",b"outside",b'0'),("repo-main/skills/report/SKILL.md",skill.as_bytes(),b'0'),("repo-main/skills/report/scripts/run.py",b"print('hello')",b'0')]);
        let files=archive_files(&bytes,"skills/report").unwrap(); assert_eq!(files.len(),2); assert!(files.contains_key("scripts/run.py")); assert!(!files.contains_key("README.md"));
        for entries in [vec![("root/../escape",b"bad".as_slice(),b'0')],vec![("root/skills/link",b"".as_slice(),b'2')],vec![("root/skills/a",b"one".as_slice(),b'0'),("root/skills/a",b"two".as_slice(),b'0')]] {
            assert!(archive_files(&archive(&entries),"skills").is_err());
        }
        let oversized=vec![b'x';MAX_FILE+1];
        assert!(archive_files(&archive(&[("root/skills/big",&oversized,b'0')]),"skills").unwrap_err().contains("2 MiB"));
    }
    #[test]
    fn github_codeload_global_pax_comment_is_not_treated_as_archive_root() {
        // The first two headers and comment mirror an actual GitHub codeload archive.
        let global = b"52 comment=063bee94c3f4df8453406c830b0a7df0f2860278\n";
        let skill = instructions("report", "body");
        let bytes = archive(&[
            ("pax_global_header", global, b'g'),
            ("agent-skills-main/", b"", b'5'),
            ("agent-skills-main/skills/report/SKILL.md", skill.as_bytes(), b'0'),
            ("agent-skills-main/skills/report/references/notes.md", b"helpful notes", b'0'),
        ]);
        let files = archive_files(&bytes, "skills/report").unwrap();
        assert_eq!(files.len(), 2);
        assert_eq!(files["SKILL.md"], skill.as_bytes());
        assert!(!files.contains_key("pax_global_header"));
        assert!(archive_files(&archive(&[("pax_global_header", b"invalid record\n", b'g')]), "").is_err());
        assert!(archive_files(&archive(&[("pax_global_header", b"21 path=../../escape\n", b'g')]), "").is_err());
        // Local PAX path overrides are resolved by tar, then checked as ordinary paths.
        fn pax_path(path: &str) -> Vec<u8> {
            let value = format!("path={path}\n");
            let mut size = value.len() + 2;
            loop {
                let record = format!("{size} {value}");
                if record.len() == size { return record.into_bytes(); }
                size = record.len();
            }
        }
        let local_path = pax_path("root/skills/report/SKILL.md");
        let local = archive(&[("pax_global_header", global, b'g'), ("root/paxheader", &local_path, b'x'), ("root/placeholder", skill.as_bytes(), b'0')]);
        assert_eq!(archive_files(&local, "skills/report").unwrap()["SKILL.md"], skill.as_bytes());
        let unsafe_path = pax_path("root/../escape");
        let local = archive(&[("pax_global_header", global, b'g'), ("root/paxheader", &unsafe_path, b'x'), ("root/placeholder", b"unsafe", b'0')]);
        assert!(archive_files(&local, "").is_err());
        assert!(archive_files(&archive(&[("pax_global_header", global, b'g'), ("root/../escape", b"unsafe", b'0')]), "").is_err());
        assert!(archive_files(&archive(&[("pax_global_header", global, b'g'), ("root/skills/link", b"", b'2')]), "skills").is_err());
    }
    #[test]
    fn interrupted_directory_replacement_is_recovered_and_staging_is_cleaned() {
        let f=Fixture::new();f.run("install",upload("recover-me","original")).unwrap();
        let root=directory(&f.0);fs::rename(root.join("recover-me"),root.join(".backup-recover-me")).unwrap();
        fs::create_dir(root.join(".staging-abandoned")).unwrap();
        assert_eq!(f.run("list",json!({})).unwrap()["items"][0]["id"],"recover-me");
        assert!(!root.join(".staging-abandoned").exists()); assert!(!root.join(".backup-recover-me").exists());
        fs::create_dir(root.join(".backup-recover-me")).unwrap();
        assert_eq!(f.run("list",json!({})).unwrap()["items"][0]["id"],"recover-me");
        assert!(!root.join(".backup-recover-me").exists());
    }
    #[cfg(unix)]
    #[test]
    fn installed_file_reads_cannot_follow_symlinks_or_escape_the_skill() {
        let f=Fixture::new();f.run("install",upload("safe-skill","body")).unwrap();
        let outside=f.0.root.join("secret.txt");fs::write(&outside,"private").unwrap();
        std::os::unix::fs::symlink(&outside,directory(&f.0).join("safe-skill/secret.txt")).unwrap();
        assert!(read_enabled(&f.0,"safe-skill",Some("secret.txt")).unwrap_err().contains("符号链接"));
        assert!(read_enabled(&f.0,"safe-skill",Some("../secret.txt")).is_err());
        assert!(f.run("detail",json!({"id":"safe-skill"})).is_err());
    }
}
