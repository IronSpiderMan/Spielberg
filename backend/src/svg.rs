//! Static SVG assets stay vector files; model inputs use cached PNG renditions.
use super::*;
use resvg::{tiny_skia, usvg};
use std::{hash::{Hash, Hasher}, sync::{Arc, OnceLock}};

const MAX_BYTES: usize = 5 * 1024 * 1024;
static FONTS: OnceLock<Arc<usvg::fontdb::Database>> = OnceLock::new();
static CACHE: Mutex<()> = Mutex::new(());

pub(crate) fn is_svg(path: &Path) -> bool {
    path.extension().and_then(|s|s.to_str()).is_some_and(|s|s.eq_ignore_ascii_case("svg"))
}

fn tree(bytes: &[u8], fonts: bool) -> Result<usvg::Tree, String> {
    if bytes.is_empty() || bytes.len() > MAX_BYTES { return Err("SVG 不能为空且不能超过 5 MB".into()); }
    let source = std::str::from_utf8(bytes).map_err(|_|"SVG 必须使用 UTF-8 编码")?;
    let doc = usvg::roxmltree::Document::parse_with_options(source, usvg::roxmltree::ParsingOptions {
        nodes_limit: 100_000, ..Default::default()
    }).map_err(|e|format!("SVG XML 无效：{e}"))?;
    let root = doc.root_element();
    if root.tag_name().name() != "svg" || root.tag_name().namespace() != Some("http://www.w3.org/2000/svg") {
        return Err("SVG 根元素必须是带 xmlns=\"http://www.w3.org/2000/svg\" 的 svg".into());
    }
    for node in doc.descendants() {
        if node.is_pi() { return Err("SVG 不支持外部样式表或处理指令".into()); }
        if !node.is_element() { continue; }
        if node.tag_name().namespace() != Some("http://www.w3.org/2000/svg") ||
            ["script", "foreignobject", "animate", "animatemotion", "animatetransform", "set", "discard"].contains(&node.tag_name().name().to_ascii_lowercase().as_str()) {
            return Err("仅支持静态 SVG，不支持脚本、动画或嵌入网页".into());
        }
        for attr in node.attributes() {
            let name = attr.name().to_ascii_lowercase();
            if name.starts_with("on") { return Err("SVG 不支持事件处理代码".into()); }
            if name == "href" {
                let value = attr.value().trim();
                let raster = ["data:image/png;base64,", "data:image/jpeg;base64,", "data:image/webp;base64,", "data:image/gif;base64,"].iter().any(|p|value.starts_with(p));
                if !value.starts_with('#') && !raster { return Err("SVG 只支持内部引用或内嵌位图，不支持外部资源".into()); }
            }
        }
    }
    let mut options = usvg::Options::default();
    // Never let a user-supplied SVG read server files (including nested images).
    options.image_href_resolver.resolve_string = Box::new(|_, _| None);
    let resolve_data = usvg::ImageHrefResolver::default_data_resolver();
    options.image_href_resolver.resolve_data = Box::new(move |mime, data, options| {
        if ["image/png", "image/jpeg", "image/webp", "image/gif"].contains(&mime) { resolve_data(mime, data, options) } else { None }
    });
    if fonts {
        options.fontdb = FONTS.get_or_init(|| {
            let mut db = usvg::fontdb::Database::new();
            db.load_system_fonts();
            Arc::new(db)
        }).clone();
    }
    let tree = usvg::Tree::from_xmltree(&doc, &options).map_err(|e|format!("SVG 无法解析：{e}"))?;
    let size = tree.size();
    if size.width() > 8192.0 || size.height() > 8192.0 || size.width() * size.height() > 16_777_216.0 {
        return Err("SVG 尺寸不能超过 8192 像素或 1600 万像素".into());
    }
    Ok(tree)
}

pub(crate) fn validate(bytes: &[u8]) -> Result<(), String> { tree(bytes, false).map(|_|()) }

pub(crate) fn render_png(bytes: &[u8], max_side: u32) -> Result<Vec<u8>, String> {
    let tree = tree(bytes, true)?;
    let size = tree.size();
    let scale = (max_side as f32 / size.width().max(size.height())).min(1.0);
    let mut pixmap = tiny_skia::Pixmap::new((size.width()*scale).ceil().max(1.0) as u32, (size.height()*scale).ceil().max(1.0) as u32).ok_or("SVG 渲染尺寸无效")?;
    resvg::render(&tree, tiny_skia::Transform::from_scale(scale, scale), &mut pixmap.as_mut());
    pixmap.encode_png().map_err(|e|format!("SVG 转 PNG 失败：{e}"))
}

pub(crate) fn create(state: &AppState, value: &Value) -> Result<Value, String> {
    let pid = project_id(value)?;
    let mut name = strv(value, "name")?.trim().to_string();
    if name.is_empty() { return Err("SVG 名称不能为空".into()); }
    if !name.to_ascii_lowercase().ends_with(".svg") { name.push_str(".svg"); }
    let source = strv(value, "svg")?;
    // Normal asset CRUD validates the optional role and imports through the same
    // SVG validation as HTTP uploads and desktop imports, with no model request.
    let mut data = json!({"name":name,"extension":"svg","data_base64":base64::engine::general_purpose::STANDARD.encode(source.as_bytes())});
    if let Some(role) = value.get("role_id") { data["role_id"] = role.clone(); }
    rest::crud(state, "POST", &format!("projects/{pid}/assets"), data).map_err(|e|e.1)
}

pub(crate) fn reference_path(path: &Path) -> Result<PathBuf, String> {
    if !is_svg(path) { return Ok(path.to_path_buf()); }
    // Imported media live in <project>/assets/images; keep derivatives in cache.
    let root = path.parent().and_then(Path::parent).and_then(Path::parent).ok_or("SVG 路径无效")?;
    let dir = root.join(".cache/svg");
    let root = root.canonicalize().map_err(|e|e.to_string())?;
    let cache = root.join(".cache");
    if cache.exists() && !cache.canonicalize().map_err(|e|e.to_string())?.starts_with(&root) { return Err("SVG 缓存不能指向项目之外".into()); }
    fs::create_dir_all(&dir).map_err(|e|e.to_string())?;
    if !dir.canonicalize().map_err(|e|e.to_string())?.starts_with(&root) { return Err("SVG 缓存不能指向项目之外".into()); }
    let metadata = fs::metadata(path).map_err(|e|e.to_string())?;
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    path.hash(&mut hash); metadata.len().hash(&mut hash); metadata.modified().ok().hash(&mut hash);
    let output = dir.join(format!("{:x}.png", hash.finish()));
    let _lock = CACHE.lock().map_err(|_|"SVG 缓存不可用")?;
    if !output.is_file() {
        let bytes = fs::read(path).map_err(|e|e.to_string())?;
        let png = render_png(&bytes, 2048)?;
        let temporary = dir.join(format!("{}.png", Uuid::new_v4()));
        fs::write(&temporary, png).map_err(|e|e.to_string())?;
        fs::rename(&temporary, &output).map_err(|e|e.to_string())?;
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    const SIMPLE: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80"><defs><linearGradient id="g"><stop stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs><rect width="120" height="80" fill="url(#g)"/><text x="10" y="40">SVG</text></svg>"##;
    #[test]
    fn static_svg_renders_to_png_and_rejects_active_or_invalid_content() {
        validate(SIMPLE.as_bytes()).unwrap();
        let png = render_png(SIMPLE.as_bytes(), 60).unwrap();
        assert!(png.starts_with(b"\x89PNG\r\n\x1a\n"));
        assert_eq!(u32::from_be_bytes(png[16..20].try_into().unwrap()), 60);
        assert_eq!(u32::from_be_bytes(png[20..24].try_into().unwrap()), 40);
        for bad in ["", "not xml", "<html/>", "<svg/>", "<svg xmlns=\"http://www.w3.org/2000/svg\">"] { assert!(validate(bad.as_bytes()).is_err()); }
        for body in ["<script>alert(1)</script>", "<rect onload=\"alert(1)\"/>", "<foreignObject/>", "<animate/>", "<image href=\"file:///etc/passwd\"/>", "<image href=\"https://example.com/a.png\"/>", "<use href=\"data:image/svg+xml;base64,AA==\"/>"] {
            assert!(validate(format!(r#"<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">{body}</svg>"#).as_bytes()).is_err(), "accepted {body}");
        }
        assert!(validate(&vec![b' '; MAX_BYTES+1]).is_err());
    }
}
