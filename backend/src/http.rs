use super::*;
use crate::rest::{ApiError, ApiResult};
use axum::{body::{Body, to_bytes}, extract::{Query, State}, http::{Request, StatusCode, header}, response::{IntoResponse, Response}, routing::{any, get}, Json, Router};
use http_body_util::BodyExt;
use std::{collections::HashMap, future::IntoFuture, net::TcpListener, sync::Arc};
use tokio::io::AsyncWriteExt;
use tower_http::{cors::CorsLayer, services::ServeFile};

type Shared = Arc<AppState>;
pub fn default_data_dir() -> PathBuf {
    std::env::var_os("SPIELBERG_DATA_DIR").map(PathBuf::from)
        .or_else(||dirs::data_local_dir().map(|p|p.join("Spielberg")))
        .unwrap_or_else(||PathBuf::from("./spielberg-data"))
}
/// Owns the exact same HTTP service in desktop and standalone deployments.
/// Dropping it stops accepting requests and shuts down its runtime.
pub struct Backend {
    pub url: String,
    shutdown: Option<tokio::sync::oneshot::Sender<()>>,
    thread: Option<std::thread::JoinHandle<()>>,
}
impl Backend {
    pub fn start(root: PathBuf, bind: &str) -> Result<Self, Box<dyn std::error::Error>> {
        storage::initialize_root(&root)?;
        let state=Arc::new(AppState{root,guard:Arc::new(Mutex::new(()))});
        for p in registry(&state).map_err(std::io::Error::other)? {
            let pid=p["id"].as_str().ok_or_else(||std::io::Error::other("无效项目 ID"))?;
            match db(&state,pid) {
                Ok(c)=>recover_jobs(&state,pid,&c).map_err(std::io::Error::other)?,
                Err(error)=>eprintln!("跳过当前不可用的项目 {pid}：{error}"),
            }
        }
        let listener=TcpListener::bind(bind)?;listener.set_nonblocking(true)?;
        let url=format!("http://{}",listener.local_addr()?);
        let router=router(state);
        let runtime=tokio::runtime::Runtime::new()?;
        let (tx,rx)=tokio::sync::oneshot::channel();
        let thread=std::thread::spawn(move||{
            runtime.block_on(async move {
                let listener=tokio::net::TcpListener::from_std(listener).expect("监听器初始化失败");
                tokio::select! {
                    result=axum::serve(listener,router).into_future()=>{if let Err(e)=result{eprintln!("HTTP 服务退出：{e}");}},
                    _=rx=>{},
                }
            });
            runtime.shutdown_timeout(std::time::Duration::from_secs(3));
        });
        Ok(Self{url,shutdown:Some(tx),thread:Some(thread)})
    }
}
impl Drop for Backend {
    fn drop(&mut self){if let Some(tx)=self.shutdown.take(){let _=tx.send(());}if let Some(thread)=self.thread.take(){let _=thread.join();}}
}
pub fn run(){
    let bind=std::env::var("SPIELBERG_BIND").unwrap_or_else(|_|"127.0.0.1:8080".into());
    let backend=Backend::start(default_data_dir(),&bind).expect("启动后端失败");
    println!("Spielberg listening at {}",backend.url);
    let runtime=tokio::runtime::Runtime::new().expect("创建信号运行时失败");
    runtime.block_on(async {let _=tokio::signal::ctrl_c().await;});
}
fn allowed_origins()->Vec<axum::http::HeaderValue>{
    std::env::var("SPIELBERG_ALLOWED_ORIGINS").unwrap_or_else(|_|"http://127.0.0.1:1420,http://localhost:1420,tauri://localhost,http://tauri.localhost,https://tauri.localhost".into())
        .split(',').filter_map(|v|v.trim().parse().ok()).collect()
}
async fn origin_guard(request:Request<Body>,next:axum::middleware::Next)->Response{
    if let Some(origin)=request.headers().get(header::ORIGIN) {
        let host=request.headers().get(header::HOST).and_then(|v|v.to_str().ok()).unwrap_or("");
        let same=origin.to_str().map(|o|o==format!("http://{host}")||o==format!("https://{host}")).unwrap_or(false);
        if !same && !allowed_origins().contains(origin){return ApiError(StatusCode::FORBIDDEN,"不允许的请求来源".into()).into_response()}
    }
    next.run(request).await
}
fn router(state:Shared)->Router{
    Router::new()
        .route("/api/v1/health",get(||async{Json(json!({"data":{"status":"ok","api_version":1}}))}))
        .route("/api/v1/{*path}",any(endpoint))
        .route("/media",get(media_file))
        .fallback(static_file)
        .with_state(state)
        .layer(axum::middleware::from_fn(origin_guard))
        .layer(CorsLayer::new().allow_origin(allowed_origins())
            .allow_methods([axum::http::Method::GET,axum::http::Method::POST,axum::http::Method::PATCH,axum::http::Method::PUT,axum::http::Method::DELETE,axum::http::Method::OPTIONS])
            .allow_headers([header::CONTENT_TYPE,header::RANGE])
            .expose_headers([header::CONTENT_DISPOSITION,header::CONTENT_RANGE]))
}
fn success(value:Value,status:StatusCode)->Response{(status,Json(json!({"data":value}))).into_response()}
fn query_value(q:&HashMap<String,String>)->Value{
    let mut result=json!({});
    for (key,value) in q {
        result[key]=if ["id","episode_id","role_id","limit","page","before","through"].contains(&key.as_str()) {
            value.parse::<i64>().map(Value::from).unwrap_or_else(|_|json!(value))
        } else {json!(value)};
    }
    result
}
async fn endpoint(State(state):State<Shared>,Query(query):Query<HashMap<String,String>>,request:Request<Body>)->Response{
    match endpoint_inner(state,query,request).await {Ok(r)=>r,Err(e)=>e.into_response()}
}
async fn endpoint_inner(state:Shared,query:HashMap<String,String>,request:Request<Body>)->ApiResult<Response>{
    let method=request.method().as_str().to_string();
    let path=request.uri().path().trim_start_matches("/api/v1/").to_string();
    let parts:Vec<_>=path.split('/').collect();
    if method=="GET" && parts.len()==2 && parts[0]=="downloads" {
        let id=parts[1];if uuid::Uuid::parse_str(id).is_err(){return Err(ApiError(StatusCode::NOT_FOUND,"下载不存在".into()))}
        let file=state.root.join("downloads").join(format!("{id}.spielberg-backup"));
        return serve_file(file,Some("project.spielberg-backup"),request).await;
    }
    if parts.len()==5 && parts[0]=="projects" && parts[2]=="assets" && parts[4]=="content" && method=="GET" {
        let state2=state.clone();let pid=parts[1].to_string();let id=parts[3].parse::<i64>().map_err(|_|ApiError(StatusCode::BAD_REQUEST,"资产 ID 无效".into()))?;
        let item=blocking(move||{let _lock=state2.guard.lock().map_err(|_|"数据锁不可用".to_string())?;media(&db(&state2,&pid)?,Some(id)).ok_or_else(||ApiError(StatusCode::NOT_FOUND,"资产不存在".into()))}).await?;
        let file=PathBuf::from(strv(&item,"path")?);let name=strv(&item,"name")?;
        return serve_file(file,if query.get("download")==Some(&"1".to_string()){Some(&name)}else{None},request).await;
    }
    if method=="POST" && parts.len()==4 && parts[0]=="projects" && parts[2]=="assets" && parts[3]=="upload" {
        let pid=parts[1].to_string();let name=query.get("name").filter(|v|!v.trim().is_empty()).ok_or_else(||ApiError(StatusCode::BAD_REQUEST,"缺少文件名".into()))?.clone();
        let ext=rest::safe_extension(Path::new(&name).extension().and_then(|v|v.to_str()).unwrap_or(""))?;
        let role=query.get("role_id").map(|v|v.parse::<i64>().map_err(|_|ApiError(StatusCode::BAD_REQUEST,"角色 ID 无效".into()))).transpose()?;
        let temp=receive_file(&state,request.into_body(),&ext,100*1024*1024).await?;
        return blocking(move||{let _lock=state.guard.lock().map_err(|_|"数据锁不可用".to_string())?;rest::import_uploaded(&state,&pid,&temp.0,&name,role)}).await.map(|v|success(v,StatusCode::CREATED));
    }
    if method=="POST" && path=="projects/restore-upload" {
        let temp=receive_file(&state,request.into_body(),"spielberg-backup",2*1024*1024*1024).await?;
        return blocking(move||{let _lock=state.guard.lock().map_err(|_|"数据锁不可用".to_string())?;Ok(project_backup::command(&state,&json!({"path":temp.0}),true)?)}).await.map(|v|success(v,StatusCode::CREATED));
    }
    let bytes=to_bytes(request.into_body(),140*1024*1024).await.map_err(|_|ApiError(StatusCode::PAYLOAD_TOO_LARGE,"请求体过大".into()))?;
    let mut value=query_value(&query);
    if !bytes.is_empty(){
        let body:Value=serde_json::from_slice(&bytes).map_err(|_|ApiError(StatusCode::BAD_REQUEST,"JSON 格式无效".into()))?;
        let object=body.as_object().ok_or_else(||ApiError(StatusCode::BAD_REQUEST,"JSON 必须是对象".into()))?;
        for (key,item) in object{value[key]=item.clone();}
    }
    if parts.len()==3 && parts[0]=="projects" && parts[2]=="backup" && method=="POST" {
        let pid=parts[1].to_string();
        return blocking(move||{
            let _lock=state.guard.lock().map_err(|_|"数据锁不可用".to_string())?;
            let folder=state.root.join("downloads");fs::create_dir_all(&folder).map_err(|e|ApiError(StatusCode::INTERNAL_SERVER_ERROR,e.to_string()))?;
            // Retain completed downloads for 24 hours; active downloads are never touched.
            for entry in fs::read_dir(&folder).map_err(|e|ApiError(StatusCode::INTERNAL_SERVER_ERROR,e.to_string()))?.flatten(){
                if entry.metadata().and_then(|m|m.modified()).ok().and_then(|m|m.elapsed().ok()).is_some_and(|age|age.as_secs()>86400){let _=fs::remove_file(entry.path());}
            }
            let id=Uuid::new_v4().to_string();let path=folder.join(format!("{id}.spielberg-backup"));
            project_backup::command(&state,&json!({"project_id":pid,"path":path,"include_api_keys":value["include_api_keys"]}),false)?;
            Ok(json!({"url":format!("/api/v1/downloads/{id}")}))
        }).await.map(|v|success(v,StatusCode::CREATED));
    }
    if let Some(action)=path.strip_prefix("actions/") {
        if method!="POST"{return Err(ApiError(StatusCode::METHOD_NOT_ALLOWED,"动作接口使用 POST".into()))}
        let action=format!("/{action}");return blocking(move||rest::action(&state,&action,value)).await.map(|v|success(v,StatusCode::OK));
    }
    let status=if method=="POST" {StatusCode::CREATED}else{StatusCode::OK};
    blocking(move||rest::crud(&state,&method,&path,value)).await.map(|v|success(v,status))
}
async fn blocking<F>(work:F)->ApiResult<Value> where F:FnOnce()->ApiResult<Value>+Send+'static {
    tokio::task::spawn_blocking(work).await.map_err(|e|ApiError(StatusCode::INTERNAL_SERVER_ERROR,e.to_string()))?
}
struct TemporaryFile(PathBuf);
impl Drop for TemporaryFile {fn drop(&mut self){let _=fs::remove_file(&self.0);}}
async fn receive_file(state:&AppState,mut body:Body,extension:&str,limit:usize)->ApiResult<TemporaryFile>{
    let folder=state.root.join("uploads");tokio::fs::create_dir_all(&folder).await.map_err(|e|ApiError(StatusCode::INTERNAL_SERVER_ERROR,e.to_string()))?;
    let temp=TemporaryFile(folder.join(format!("{}.{}",Uuid::new_v4(),extension)));
    let mut file=tokio::fs::File::create(&temp.0).await.map_err(|e|ApiError(StatusCode::INTERNAL_SERVER_ERROR,e.to_string()))?;
    let mut size=0;
    while let Some(frame)=body.frame().await {
        let frame=frame.map_err(|e|ApiError(StatusCode::BAD_REQUEST,e.to_string()))?;
        if let Ok(bytes)=frame.into_data(){size+=bytes.len();if size>limit{return Err(ApiError(StatusCode::PAYLOAD_TOO_LARGE,"文件超过上传大小限制".into()))}file.write_all(&bytes).await.map_err(|e|ApiError(StatusCode::INTERNAL_SERVER_ERROR,e.to_string()))?;}
    }
    if size==0{return Err(ApiError(StatusCode::BAD_REQUEST,"文件为空".into()))}
    file.flush().await.map_err(|e|ApiError(StatusCode::INTERNAL_SERVER_ERROR,e.to_string()))?;drop(file);Ok(temp)
}
async fn serve_file(path:PathBuf,download:Option<&str>,request:Request<Body>)->ApiResult<Response>{
    let mut response=ServeFile::new(path).try_call(request).await.map_err(|e|ApiError(StatusCode::INTERNAL_SERVER_ERROR,e.to_string()))?.map(Body::new);
    if let Some(name)=download {
        let encoded=name.as_bytes().iter().map(|b|format!("%{b:02X}")).collect::<String>();
        response.headers_mut().insert(header::CONTENT_DISPOSITION,format!("attachment; filename=\"download\"; filename*=UTF-8''{encoded}").parse().unwrap());
    }
    Ok(response)
}
async fn media_file(State(state):State<Shared>,Query(query):Query<HashMap<String,String>>,request:Request<Body>)->Response{
    let result=(||->ApiResult<PathBuf>{
        let path=PathBuf::from(query.get("path").ok_or_else(||ApiError(StatusCode::BAD_REQUEST,"缺少素材路径".into()))?);
        let real=path.canonicalize().map_err(|_|ApiError(StatusCode::NOT_FOUND,"素材不存在".into()))?;
        let _lock=state.guard.lock().map_err(|_|"数据锁不可用".to_string())?;
        let allowed=registry(&state)?.iter().filter_map(|p|p["path"].as_str()).flat_map(|p|[PathBuf::from(p).join("assets"),PathBuf::from(p).join(".cache")]).any(|root|root.canonicalize().map(|r|real.starts_with(r)).unwrap_or(false));
        if !allowed{return Err(ApiError(StatusCode::FORBIDDEN,"无权访问此文件".into()))}Ok(real)
    })();
    match result{Ok(path)=>match serve_file(path,None,request).await{Ok(r)=>r,Err(e)=>e.into_response()},Err(e)=>e.into_response()}
}
async fn static_file(uri:axum::http::Uri)->Response{
    let key=uri.path().trim_start_matches('/');
    if key.starts_with("api/"){return ApiError(StatusCode::NOT_FOUND,"API 不存在".into()).into_response()}
    let found=server_assets::asset(if key=="index.html"{""}else{key}).map(|b|(key,b)).or_else(||{
        if !key.contains('.') {server_assets::asset("").map(|b|("index.html",b))}else{None}
    });
    match found{
        Some((key,bytes))=>{let mime=if key.is_empty(){"text/html".to_string()}else{mime_guess::from_path(key).first_or_octet_stream().to_string()};([(header::CONTENT_TYPE,mime),(header::CACHE_CONTROL,"no-cache".into())],bytes).into_response()},
        None=>(StatusCode::NOT_FOUND,"页面不存在；开发时请使用 Vite，部署前运行 npm run build").into_response(),
    }
}
