use super::*;

pub(crate) fn install(c: &Connection) -> Result<(), String> {
    c.execute_batch("BEGIN;
        CREATE TABLE IF NOT EXISTS screenplays(
            id INTEGER PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        INSERT OR IGNORE INTO revisions(section) VALUES('screenplays');
        CREATE TRIGGER IF NOT EXISTS revision_screenplays_insert AFTER INSERT ON screenplays
            BEGIN UPDATE revisions SET version=version+1 WHERE section='screenplays'; END;
        CREATE TRIGGER IF NOT EXISTS revision_screenplays_update AFTER UPDATE ON screenplays
            BEGIN UPDATE revisions SET version=version+1 WHERE section='screenplays'; END;
        CREATE TRIGGER IF NOT EXISTS revision_screenplays_delete AFTER DELETE ON screenplays
            BEGIN UPDATE revisions SET version=version+1 WHERE section='screenplays'; END;
        PRAGMA user_version=5;
        COMMIT;").map_err(|e|e.to_string())
}

pub(crate) fn install_format(c: &Connection) -> Result<(), String> {
    c.execute_batch("BEGIN; ALTER TABLE screenplays ADD COLUMN format TEXT NOT NULL DEFAULT 'markdown' CHECK(format IN ('markdown','csv')); PRAGMA user_version=6; COMMIT;").map_err(|e|e.to_string())
}

pub(crate) fn validate_content(format: &str, content: &str) -> Result<(), String> {
    if format == "markdown" { return Ok(()); }
    if format != "csv" { return Err("剧本格式必须为 markdown 或 csv".into()); }
    let rows = parse_csv(content)?;
    let mut seen = std::collections::HashSet::new();
    for (index, r) in rows.iter().enumerate().skip(1) {
        if r.len() != 5 { return Err(format!("第 {} 行必须有 5 列（画面可留空）", index+1)); }
        if r[0].trim().is_empty() || !seen.insert(r[0].trim()) { return Err(format!("第 {} 行编号为空或重复", index+1)); }
        if !["大远景","远景","全景","中景","近景","特写","大特写"].contains(&r[1].as_str()) { return Err(format!("第 {} 行景别无效", index+1)); }
        if !["固定","推近","拉远","横摇","俯仰","平移","跟随","升高","降低","环绕","手持","变焦"].contains(&r[2].as_str()) { return Err(format!("第 {} 行运镜无效", index+1)); }
        if r[4].trim().is_empty() { return Err(format!("第 {} 行描述不能为空", index+1)); }
    }
    Ok(())
}

fn parse_csv(content: &str) -> Result<Vec<Vec<String>>, String> {
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut row = Vec::new();
    let mut cell = String::new();
    let mut quoted = false;
    let mut closed = false;
    let mut chars = content.trim_start_matches('\u{feff}').chars().peekable();
    while let Some(ch) = chars.next() {
        if quoted {
            if ch == '"' {
                if chars.peek() == Some(&'"') { chars.next(); cell.push('"'); }
                else { quoted = false; closed = true; }
            } else { cell.push(ch); }
        } else if ch == ',' || ch == '\n' || ch == '\r' {
            row.push(std::mem::take(&mut cell)); closed = false;
            if ch != ',' {
                if ch == '\r' && chars.peek() == Some(&'\n') { chars.next(); }
                rows.push(std::mem::take(&mut row));
            }
        } else if ch == '"' && cell.is_empty() && !closed { quoted = true; }
        else {
            if closed || ch == '"' { return Err("CSV 引号格式错误".into()); }
            cell.push(ch);
        }
    }
    if quoted { return Err("CSV 存在未闭合的引号".into()); }
    if !cell.is_empty() || !row.is_empty() || closed { row.push(cell); rows.push(row); }
    if !rows.first().is_some_and(|r| r.len() == 5 && r.iter().map(String::as_str).eq(["编号","景别","运镜","画面","描述"])) {
        return Err("CSV 表头必须为：编号,景别,运镜,画面,描述".into());
    }
    if rows.iter().any(|row|row.len()!=5) { return Err("CSV 必须有 5 列".into()); }
    Ok(rows)
}

pub(crate) fn rewrite_pictures(c: &Connection, paths: &std::collections::HashMap<String,String>) -> Result<(), String> {
    let mut q = c.prepare("SELECT id,content FROM screenplays WHERE format='csv'").map_err(|e|e.to_string())?;
    let scripts = q.query_map([], |r|Ok((r.get::<_,i64>(0)?,r.get::<_,String>(1)?))).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
    for (id,content) in scripts {
        let mut rows = parse_csv(&content)?;
        let mut changed = false;
        for row in rows.iter_mut().skip(1) {
            if let Some(path) = paths.get(&row[3]) { row[3] = path.clone(); changed = true; }
        }
        if changed {
            let content = rows.iter().map(|row| row.iter().map(|cell| {
                if cell.contains([',','"','\r','\n']) { format!("\"{}\"", cell.replace('"', "\"\"")) } else { cell.clone() }
            }).collect::<Vec<_>>().join(",")).collect::<Vec<_>>().join("\r\n");
            c.execute("UPDATE screenplays SET content=? WHERE id=?", params![content,id]).map_err(|e|e.to_string())?;
        }
    }
    Ok(())
}

pub(crate) fn list(c: &Connection) -> Result<Vec<Value>, String> {
    let mut q = c.prepare("SELECT id,title,content,created_at,updated_at,format FROM screenplays ORDER BY CAST(updated_at AS INTEGER) DESC,id DESC").map_err(|e|e.to_string())?;
    let rows = q.query_map([], |r| Ok(json!({
        "id":r.get::<_,i64>(0)?, "title":r.get::<_,String>(1)?,
        "content":r.get::<_,String>(2)?, "created_at":r.get::<_,String>(3)?,
        "updated_at":r.get::<_,String>(4)?, "format":r.get::<_,String>(5)?
    }))).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string());
    rows
}

pub(crate) fn insert(s: &AppState, v: &Value) -> Result<Value, String> {
    let pid = project_id(v)?;
    let c = db(s, &pid)?;
    let title = strv(v, "title")?;
    let content = v["content"].as_str().unwrap_or("");
    let format = v["format"].as_str().unwrap_or("markdown");
    validate_content(format, &content)?;
    let t = now();
    c.execute("INSERT INTO screenplays(title,content,created_at,updated_at,format) VALUES(?,?,?,?,?)",
        params![title.trim(),content,t,t,format]).map_err(|e|e.to_string())?;
    touch(s, &pid);
    Ok(json!({"id":c.last_insert_rowid()}))
}

pub(crate) fn update(s: &AppState, v: &Value) -> Result<(), String> {
    let pid = project_id(v)?;
    let c = db(s, &pid)?;
    let id = intv(v,"id")?;
    let current: String = c.query_row("SELECT format FROM screenplays WHERE id=?", [id], |r|r.get(0)).map_err(|e|e.to_string())?;
    let format = v["format"].as_str().unwrap_or(&current);
    let content = strv(v,"content")?;
    validate_content(format, &content)?;
    c.execute("UPDATE screenplays SET title=?,content=?,updated_at=?,format=? WHERE id=?",
        params![strv(v,"title")?.trim(),content,now(),format,id]).map_err(|e|e.to_string())?;
    touch(s, &pid);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csv_validation_handles_quotes_and_optional_pictures() {
        assert!(validate_content("csv", "\u{feff}编号,景别,运镜,画面,描述\r\n001,特写,固定,,\"他说\"\"你好\"\",然后离开\n下一行\"").is_ok());
        for content in ["编号,景别,运镜,画面,描述\n1,未知,固定,,描述", "编号,景别,运镜,画面,描述\n1,中景,固定,,描述\n1,近景,推近,,描述", "编号,景别,运镜,画面,描述\n1,中景,固定,,", "编号,景别,运镜,画面,描述\n1,中景,自由运镜,,描述", "编号,景别,运镜,画面,描述\n1,中景,固定,,\"未闭合"] {
            assert!(validate_content("csv", content).is_err());
        }
        assert!(validate_content("other", "").is_err());
    }

    #[test]
    fn upgrades_markdown_format_with_existing_content() {
        let c = Connection::open_in_memory().unwrap();
        migrate(&c).unwrap();
        c.execute_batch("DROP TABLE screenplays; CREATE TABLE screenplays(id INTEGER PRIMARY KEY,title TEXT,content TEXT,created_at TEXT,updated_at TEXT); INSERT INTO screenplays VALUES(1,'旧剧本','# 故事','1','1'); PRAGMA user_version=5;").unwrap();
        migrate(&c).unwrap();
        migrate(&c).unwrap();
        assert_eq!(c.query_row("SELECT format FROM screenplays", [], |r|r.get::<_,String>(0)).unwrap(), "markdown");
        assert_eq!(c.query_row("SELECT content FROM screenplays", [], |r|r.get::<_,String>(0)).unwrap(), "# 故事");
    }

    #[test]
    fn upgrades_existing_projects_without_losing_data() {
        let mut c = Connection::open_in_memory().unwrap();
        migrate(&c).unwrap();
        c.execute("INSERT INTO prompts(name,content,created_at,updated_at) VALUES('风格','水墨','1','1')", []).unwrap();
        c.execute_batch("DROP TRIGGER revision_screenplays_insert; DROP TRIGGER revision_screenplays_update;
            DROP TRIGGER revision_screenplays_delete; DROP TABLE screenplays;
            DELETE FROM revisions WHERE section='screenplays'; PRAGMA user_version=4;").unwrap();
        migrate(&c).unwrap();
        migrate(&c).unwrap();
        assert_eq!(c.query_row("SELECT content FROM prompts", [], |r| r.get::<_,String>(0)).unwrap(), "水墨");
        let before = catalog::revisions(&c).unwrap();
        c.execute("INSERT INTO screenplays(title,content,created_at,updated_at) VALUES('剧本','# 标题','1','1')", []).unwrap();
        let changes = snapshot_database(&mut c, json!({"id":"test"}), &before).unwrap();
        assert_eq!(changes["screenplays"][0]["content"], "# 标题");
        assert!(changes.get("prompts").is_none());
        assert_eq!(c.query_row("PRAGMA user_version", [], |r| r.get::<_,i64>(0)).unwrap(), 7);
    }
}
