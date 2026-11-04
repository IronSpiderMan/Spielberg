//! Project-owned relationships between creative assets and their graph layout.
use super::*;
use crate::rest::{ApiError, ApiResult};
use axum::http::StatusCode;

pub(crate) fn install(c: &Connection) -> Result<(), String> {
    c.execute_batch("CREATE TABLE IF NOT EXISTS asset_relations(
        id INTEGER PRIMARY KEY,
        source_asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        target_asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        label TEXT NOT NULL CHECK(length(trim(label)) BETWEEN 1 AND 80),
        directed INTEGER NOT NULL DEFAULT 0 CHECK(directed IN (0,1)),
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
        CHECK(source_asset_id!=target_asset_id),
        CHECK(directed=1 OR source_asset_id<target_asset_id),
        UNIQUE(source_asset_id,target_asset_id,label,directed));
        CREATE INDEX IF NOT EXISTS asset_relations_target ON asset_relations(target_asset_id);
        CREATE TABLE IF NOT EXISTS asset_graph(
            id INTEGER PRIMARY KEY CHECK(id=1),positions TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(positions)),
            revision INTEGER NOT NULL DEFAULT 0);
        INSERT OR IGNORE INTO asset_graph(id) VALUES(1);
        INSERT OR IGNORE INTO revisions(section,version) VALUES('asset_relations',0);
        INSERT OR IGNORE INTO revisions(section,version) VALUES('asset_graph',0);
        CREATE TRIGGER IF NOT EXISTS asset_graph_remove_deleted_asset AFTER DELETE ON assets
        WHEN EXISTS(SELECT 1 FROM asset_graph WHERE json_type(positions,'$.\"'||OLD.id||'\"') IS NOT NULL)
        BEGIN UPDATE asset_graph SET positions=json_remove(positions,'$.\"'||OLD.id||'\"'),revision=revision+1 WHERE id=1; END;")
        .map_err(|e| e.to_string())?;
    for table in ["asset_relations", "asset_graph"] {
        for event in ["INSERT", "UPDATE", "DELETE"] {
            c.execute_batch(&format!("CREATE TRIGGER IF NOT EXISTS revision_{table}_{event} AFTER {event} ON {table}
                BEGIN UPDATE revisions SET version=version+1 WHERE section='{table}'; END;"))
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn bad(message: &str) -> ApiError { ApiError(StatusCode::BAD_REQUEST, message.into()) }
fn missing() -> ApiError { ApiError(StatusCode::NOT_FOUND, "资产关系不存在".into()) }
fn sql_error(error: rusqlite::Error) -> ApiError {
    if let rusqlite::Error::SqliteFailure(ref code, _) = error {
        if code.code == rusqlite::ErrorCode::ConstraintViolation {
            return ApiError(StatusCode::CONFLICT, "关系已存在，或关联资产已被删除".into());
        }
    }
    ApiError(StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
}
fn fields(value: &Value, allowed: &[&str]) -> ApiResult<()> {
    let object=value.as_object().ok_or_else(||bad("JSON 必须是对象"))?;
    for key in object.keys() {
        if key!="project_id" && !allowed.contains(&key.as_str()) {
            return Err(bad(&format!("不支持的字段：{key}")));
        }
    }
    Ok(())
}
fn require_asset(c: &Connection, id: i64) -> ApiResult<()> {
    let exists:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM assets WHERE id=?)",[id],|r|r.get(0)).map_err(sql_error)?;
    if !exists {return Err(ApiError(StatusCode::NOT_FOUND,"关联资产不存在于当前项目".into()));}
    Ok(())
}
fn relation_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    Ok(json!({"id":row.get::<_,i64>(0)?,"source_asset_id":row.get::<_,i64>(1)?,
        "target_asset_id":row.get::<_,i64>(2)?,"label":row.get::<_,String>(3)?,
        "directed":row.get::<_,i64>(4)?!=0,"description":row.get::<_,String>(5)?,
        "created_at":row.get::<_,String>(6)?,"updated_at":row.get::<_,String>(7)?}))
}
fn read_relation(c: &Connection, id: i64) -> ApiResult<Value> {
    c.query_row("SELECT id,source_asset_id,target_asset_id,label,directed,description,created_at,updated_at
        FROM asset_relations WHERE id=?",[id],relation_row).optional().map_err(sql_error)?.ok_or_else(missing)
}
pub(crate) fn list(c: &Connection) -> Result<Value,String> {
    let mut q=c.prepare("SELECT id,source_asset_id,target_asset_id,label,directed,description,created_at,updated_at FROM asset_relations ORDER BY id").map_err(|e|e.to_string())?;
    let relations=q.query_map([],relation_row).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;
    Ok(json!(relations))
}
fn validate_relation(c: &Connection, value: &Value) -> ApiResult<(i64,i64,String,bool,String)> {
    let asset_id=|key:&str|value[key].as_i64().filter(|id|*id>0).ok_or_else(||bad(&format!("{key} 必须是正整数")));
    let mut source=asset_id("source_asset_id")?;
    let mut target=asset_id("target_asset_id")?;
    if source==target {return Err(bad("请选择两个不同的资产建立关系"));}
    require_asset(c,source)?; require_asset(c,target)?;
    let label=value["label"].as_str().ok_or_else(||bad("请输入关系名称"))?.trim().to_string();
    if label.is_empty() || label.chars().count()>80 {return Err(bad("关系名称应为 1–80 个字符"));}
    let directed=value["directed"].as_bool().ok_or_else(||bad("directed 必须是布尔值"))?;
    let description=value["description"].as_str().ok_or_else(||bad("关系说明必须是文本"))?.to_string();
    if description.chars().count()>2000 {return Err(bad("关系说明不能超过 2000 个字符"));}
    if !directed && source>target {std::mem::swap(&mut source,&mut target);}
    Ok((source,target,label,directed,description))
}
fn read_graph(c: &Connection) -> ApiResult<Value> {
    let (positions,revision):(String,i64)=c.query_row("SELECT positions,revision FROM asset_graph WHERE id=1",[],|r|Ok((r.get(0)?,r.get(1)?))).map_err(sql_error)?;
    let positions:Value=serde_json::from_str(&positions).map_err(|e|ApiError(StatusCode::INTERNAL_SERVER_ERROR,e.to_string()))?;
    Ok(json!({"positions":positions,"revision":revision}))
}
fn save_graph(c: &Connection, value: &Value) -> ApiResult<Value> {
    fields(value,&["positions","revision"])?;
    let positions=value["positions"].as_object().ok_or_else(||bad("positions 必须是资产 ID 到坐标的对象"))?;
    if positions.len()>5000 {return Err(bad("关系图最多保存 5000 个资产位置"));}
    let revision=value["revision"].as_i64().filter(|n|*n>=0 && *n<i64::MAX).ok_or_else(||bad("revision 必须是非负整数"))?;
    for (key,point) in positions {
        let id=key.parse::<i64>().ok().filter(|id|*id>0 && id.to_string()==*key).ok_or_else(||bad("关系图资产 ID 无效"))?;
        require_asset(c,id)?;
        let point=point.as_object().ok_or_else(||bad("资产位置必须包含 x、y 坐标"))?;
        if point.len()!=2 || !["x","y"].iter().all(|axis|point.get(*axis).and_then(Value::as_f64).is_some_and(|n|n.is_finite() && n.abs()<=1_000_000.0)) {
            return Err(bad("资产位置必须包含有效的 x、y 坐标"));
        }
    }
    let changed=c.execute("UPDATE asset_graph SET positions=?,revision=revision+1 WHERE id=1 AND revision=?",
        params![value["positions"].to_string(),revision]).map_err(sql_error)?;
    if changed==0 {return Err(ApiError(StatusCode::CONFLICT,"关系图已在其他窗口更新，请重新加载后保存".into()));}
    read_graph(c)
}

pub(crate) fn handle(state: &AppState, c: &Connection, pid: &str, method: &str, resource: &str, id: Option<i64>, value: &Value) -> ApiResult<Value> {
    if resource=="asset-graph" {
        if id.is_some() {return Err(missing());}
        return match method {
            "GET"=>read_graph(c),
            "PATCH"=>{let graph=save_graph(c,value)?;touch(state,pid);Ok(graph)},
            _=>Err(ApiError(StatusCode::METHOD_NOT_ALLOWED,"关系图支持 GET/PATCH".into())),
        };
    }
    if let Some(id)=id {
        let current=read_relation(c,id)?;
        match method {
            "GET"=>Ok(current),
            "PATCH"=>{
                fields(value,&["source_asset_id","target_asset_id","label","directed","description"])?;
                let mut merged=current;
                for (key,item) in value.as_object().unwrap() {merged[key]=item.clone();}
                let (source,target,label,directed,description)=validate_relation(c,&merged)?;
                c.execute("UPDATE asset_relations SET source_asset_id=?,target_asset_id=?,label=?,directed=?,description=?,updated_at=? WHERE id=?",
                    params![source,target,label,directed,description,now(),id]).map_err(sql_error)?;
                touch(state,pid);read_relation(c,id)
            },
            "DELETE"=>{
                c.execute("DELETE FROM asset_relations WHERE id=?",[id]).map_err(sql_error)?;
                touch(state,pid);Ok(json!({"deleted":true}))
            },
            _=>Err(ApiError(StatusCode::METHOD_NOT_ALLOWED,"资产关系支持 GET/PATCH/DELETE".into())),
        }
    } else {
        match method {
            "GET"=>list(c).map_err(|e|ApiError(StatusCode::INTERNAL_SERVER_ERROR,e)),
            "POST"=>{
                fields(value,&["source_asset_id","target_asset_id","label","directed","description"])?;
                let mut merged=json!({"directed":false,"description":""});
                for (key,item) in value.as_object().unwrap() {merged[key]=item.clone();}
                let (source,target,label,directed,description)=validate_relation(c,&merged)?;
                let stamp=now();
                c.execute("INSERT INTO asset_relations(source_asset_id,target_asset_id,label,directed,description,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
                    params![source,target,label,directed,description,stamp,stamp]).map_err(sql_error)?;
                let id=c.last_insert_rowid();touch(state,pid);read_relation(c,id)
            },
            _=>Err(ApiError(StatusCode::METHOD_NOT_ALLOWED,"资产关系集合支持 GET/POST".into())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture { state: AppState, pid: String, other: String }
    impl Fixture {
        fn new() -> Self {
            let root=std::env::temp_dir().join(format!("asset-relations-{}",Uuid::new_v4()));
            storage::initialize_root(&root).unwrap();
            let state=AppState{root,guard:std::sync::Arc::new(Mutex::new(()))};
            let pid=create_project(&state,&json!({"name":"魏家故事"})).unwrap()["id"].as_str().unwrap().to_string();
            let other=create_project(&state,&json!({"name":"另一个项目"})).unwrap()["id"].as_str().unwrap().to_string();
            for name in ["魏来","魏宁","魏来老家"] {
                rest::crud(&state,"POST",&format!("projects/{pid}/assets"),json!({"name":name})).unwrap();
            }
            Self{state,pid,other}
        }
        fn call(&self, method: &str, suffix: &str, value: Value) -> ApiResult<Value> {
            rest::crud(&self.state,method,&format!("projects/{}/{}",self.pid,suffix),value)
        }
    }
    impl Drop for Fixture { fn drop(&mut self) {let _=fs::remove_dir_all(&self.state.root);} }
    #[test]
    fn relationships_roundtrip_validate_duplicates_and_directions() {
        let f=Fixture::new();
        let siblings=f.call("POST","asset-relations",json!({"source_asset_id":2,"target_asset_id":1,"label":" 兄妹 "})).unwrap();
        assert_eq!(siblings["source_asset_id"],1);assert_eq!(siblings["target_asset_id"],2);
        assert_eq!(siblings["label"],"兄妹");assert_eq!(siblings["directed"],false);
        assert_eq!(f.call("POST","asset-relations",json!({"source_asset_id":1,"target_asset_id":2,"label":"兄妹"})).unwrap_err().0,StatusCode::CONFLICT);
        let home=f.call("POST","asset-relations",json!({"source_asset_id":3,"target_asset_id":1,"label":"老家","directed":true})).unwrap();
        assert_eq!(home["source_asset_id"],3);
        let path=format!("asset-relations/{}",home["id"]);
        let saved=f.call("PATCH",&path,json!({"label":"出生地","description":"魏来小时候生活的地方"})).unwrap();
        assert_eq!(saved["source_asset_id"],3);assert_eq!(saved["description"],"魏来小时候生活的地方");
        assert_eq!(f.call("GET",&path,json!({})).unwrap(),saved);
        assert_eq!(f.call("GET","asset-relations",json!({})).unwrap().as_array().unwrap().len(),2);
        for invalid in [json!({"source_asset_id":1,"target_asset_id":1,"label":"自己"}),
            json!({"source_asset_id":1,"target_asset_id":999,"label":"缺失"}),
            json!({"source_asset_id":1,"target_asset_id":2,"label":" "}),
            json!({"source_asset_id":1,"target_asset_id":2,"label":"关系","directed":1}),
            json!({"source_asset_id":1,"target_asset_id":2,"label":"关系","extra":"bad"})] {
            assert!(f.call("POST","asset-relations",invalid).is_err());
        }
        f.call("DELETE",&path,json!({})).unwrap();
        assert_eq!(f.call("GET",&path,json!({})).unwrap_err().0,StatusCode::NOT_FOUND);
    }
    #[test]
    fn graph_layout_rejects_stale_or_invalid_changes_and_get_is_read_only() {
        let f=Fixture::new();
        let graph=f.call("GET","asset-graph",json!({})).unwrap();
        assert_eq!(graph,json!({"positions":{},"revision":0}));
        let positions=json!({"1":{"x":-100.5,"y":125},"2":{"x":350,"y":125}});
        let saved=f.call("PATCH","asset-graph",json!({"positions":positions,"revision":0})).unwrap();
        assert_eq!(saved,json!({"positions":positions,"revision":1}));
        assert_eq!(f.call("PATCH","asset-graph",json!({"positions":{},"revision":0})).unwrap_err().0,StatusCode::CONFLICT);
        for positions in [json!({"999":{"x":0,"y":0}}),json!({"1":{"x":1000001,"y":0}}),json!({"1":{"x":0}}),json!({"01":{"x":0,"y":0}})] {
            assert!(f.call("PATCH","asset-graph",json!({"positions":positions,"revision":1})).is_err());
        }
        let c=db(&f.state,&f.pid).unwrap();let before=catalog::revisions(&c).unwrap();
        assert_eq!(f.call("GET","asset-graph",json!({})).unwrap(),saved);
        f.call("GET","asset-relations",json!({})).unwrap();
        assert_eq!(catalog::revisions(&c).unwrap(),before);
    }
    #[test]
    fn deleting_an_asset_cascades_relations_and_layout_while_projects_stay_isolated() {
        let f=Fixture::new();
        f.call("POST","asset-relations",json!({"source_asset_id":1,"target_asset_id":2,"label":"兄妹"})).unwrap();
        f.call("PATCH","asset-graph",json!({"positions":{"1":{"x":0,"y":0},"2":{"x":300,"y":0}},"revision":0})).unwrap();
        assert_eq!(rest::crud(&f.state,"GET",&format!("projects/{}/asset-relations",f.other),json!({})).unwrap(),json!([]));
        assert_eq!(rest::crud(&f.state,"GET",&format!("projects/{}/asset-graph",f.other),json!({})).unwrap(),json!({"positions":{},"revision":0}));
        f.call("DELETE","assets/1",json!({})).unwrap();
        assert_eq!(f.call("GET","asset-relations",json!({})).unwrap(),json!([]));
        assert_eq!(f.call("GET","asset-graph",json!({})).unwrap(),json!({"positions":{"2":{"x":300,"y":0}},"revision":2}));
        let c=db(&f.state,&f.pid).unwrap();let revisions=catalog::revisions(&c).unwrap();
        assert!(revisions["asset_relations"].as_i64().unwrap()>=2);
        assert!(revisions["asset_graph"].as_i64().unwrap()>=2);
    }
}
