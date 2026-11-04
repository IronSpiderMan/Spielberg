import { confirmAction } from "./components/ConfirmAction";
import { VideoPreviewModal } from "./components/VideoPreviewModal";
import { ImagePreviewModal } from "./components/ImagePreviewModal";
import { AssetAssignmentModal } from "./components/AssetAssignmentModal";
import { Button,Drawer,Dropdown,Empty,Input,Menu,Message,Modal,Pagination,Select,Space,Spin,Tag } from "@arco-design/web-react";
import { open,save } from "./platform";
import { Eye,HardDrive,MoreHorizontal,Plus,RotateCcw,WandSparkles } from "lucide-react";
import { useEffect,useId,useRef,useState } from "react";
import AssetThumbnail from "./AssetThumbnail";
import { Media,Snapshot,imageUrl,post } from "./core";
import { EmptyState } from "./ui";
import { focusKeyboardTarget, isKeyboardEventBlocked, scrollWithKeyboard } from "./keyboard";
import "./creation.css";

export type AssetUsage = {kind:"asset"|"episode"|"scene"|"canvas";target_id:number;title:string;episode_id?:number;episode_title?:string;purpose:string};
type Asset = Media & {usage_count:number;deleted_at?:string};
type DiskScan = {files:{path:string;size:number}[];cache_bytes:number};
const bytes = (value:number) => value < 1048576 ? `${(value/1024).toFixed(1)} KB` : `${(value/1048576).toFixed(1)} MB`;
function MediaDimensions({media}:{media:Media}) {
  const [size,setSize]=useState("");
  useEffect(()=>{
    let active=true;setSize("");
    const url=imageUrl(media);
    if(media.kind==="image"){
      const image=new Image();image.onload=()=>{if(active)setSize(`${image.naturalWidth} × ${image.naturalHeight} px`);};image.onerror=()=>{if(active)setSize("尺寸暂不可用");};image.src=url;
      return()=>{active=false;image.src="";};
    }
    if(media.kind==="video"){
      const video=document.createElement("video");video.preload="metadata";
      video.onloadedmetadata=()=>{if(active)setSize(`${video.videoWidth} × ${video.videoHeight} px`);};video.onerror=()=>{if(active)setSize("尺寸未知");};video.src=url;
      return()=>{active=false;video.removeAttribute("src");video.load();};
    }
    return()=>{active=false;};
  },[media.kind,media.path]);
  return <small className="asset-dimensions">{size||"读取尺寸中…"}</small>;
}
export default function AssetLibrary({data,reload,onLocate,onImageToImage}: {data:Snapshot;reload:()=>void|Promise<void>;onLocate:(usage:AssetUsage)=>void;onImageToImage:(media:Media)=>void}) {
  const [kind,setKind]=useState("all"),[query,setQuery]=useState(""),[search,setSearch]=useState(""),[filter,setFilter]=useState("all");
  const [preview,setPreview]=useState<Media|null>(null),[rename,setRename]=useState<Media|null>(null),[busy,setBusy]=useState(false);
  const [page,setPage]=useState(1),[items,setItems]=useState<Asset[]>([]),[total,setTotal]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState("");
  const [version,setVersion]=useState(0);
  const [tracking,setTracking]=useState<Asset|null>(null),[uses,setUses]=useState<AssetUsage[]>([]),[usageError,setUsageError]=useState(""),[usageLoading,setUsageLoading]=useState(false);
  const [scan,setScan]=useState<DiskScan|null>(null),[scanning,setScanning]=useState(false);
  const request=useRef(0);
  const paging=useRef(false);
  const libraryRef=useRef<HTMLElement>(null);
  const keyboardHintId=useId();
  const pid=data.project.id;
  const refresh=async()=>{await reload();setVersion(v=>v+1);};
  useEffect(()=>{
    if(query===search)return;
    const timer=setTimeout(()=>{setSearch(query);setPage(1);},250);
    return()=>clearTimeout(timer);
  },[query,search]);
  useEffect(()=>{
    const id=++request.current;paging.current=true;setLoading(true);setError("");
    void post<{items:Asset[];total:number}>("/media/list",{project_id:pid,kind,query:search,usage:filter,page,limit:24}).then(result=>{
      if(id!==request.current)return;
      if(page>1 && result.total <= (page-1)*24){setPage(Math.max(1,Math.ceil(result.total/24)));return;}
      setItems(result.items);setTotal(result.total);
    }).catch(e=>{if(id===request.current)setError(String(e));}).finally(()=>{if(id===request.current){paging.current=false;setLoading(false);}});
    return()=>{request.current++;};
  },[pid,kind,search,filter,page,version,data.revisions?.media,data.revisions?.assets,data.revisions?.episodes]);
  useEffect(()=>{
    if(!tracking)return;
    let disposed=false;setUses([]);setUsageError("");setUsageLoading(true);
    void post<{items:AssetUsage[]}>("/media/usage",{project_id:pid,id:tracking.id}).then(result=>{if(!disposed)setUses(result.items);}).catch(e=>{if(!disposed)setUsageError(String(e));}).finally(()=>{if(!disposed)setUsageLoading(false);});
    return()=>{disposed=true;};
  },[tracking,pid,data.revisions?.assets,data.revisions?.episodes]);
  const [assignment,setAssignment]=useState<Media|null>(null);
  const beginAssignment=(media:Media)=>{setPreview(null);setAssignment(media);};
  const importFiles=async()=>{try {
    const files=await open({multiple:true,filters:[{name:"图片、视频和音频",extensions:["png","jpg","jpeg","webp","gif","svg","mp4","mov","webm","mkv","mp3","wav","m4a","aac","ogg","flac"]}]});
    if(!files)return;setBusy(true);
    for(const source of typeof files==="string"?[files]:files)await post("/media/import",{project_id:pid,source_path:source});
    await refresh();
  }catch(e){Message.error(String(e));await refresh();}finally{setBusy(false);}};
  const action=async(path:string,m:Media,propagateError=false)=>{setBusy(true);try{await post(path,{project_id:pid,id:m.id});await refresh();}catch(e){Message.error(String(e));if(propagateError)throw e;}finally{setBusy(false);}};
  const confirmDelete=(m:Asset)=>confirmAction({
    intent:"danger",
    title:filter==="trash"?"永久删除这个文件？":"移入回收站？",
    content:filter==="trash"?`「${m.name}」将从磁盘删除，无法撤销。`:`「${m.name}」可以随时从回收站恢复。被使用的素材不能移入回收站。`,
    okText:filter==="trash"?"永久删除":"移入回收站",
    onOk:()=>action(filter==="trash"?"/media/purge":"/media/delete",m,true),
  });
  const exportAsset=async(m:Media)=>{try{const path=await save({defaultPath:m.name});if(path)await post("/media/export",{project_id:pid,media_id:m.id,destination_path:path});}catch(e){Message.error(String(e));}};
  const inspectDisk=async()=>{setScanning(true);try{setScan(await post<DiskScan>("/storage/scan",{project_id:pid}));}catch(e){Message.error(String(e));}finally{setScanning(false);}};
  const filtered=kind!=="all"||filter!=="all"||!!query.trim();
  const clearFilters=()=>{setQuery("");setSearch("");setKind("all");setFilter("all");setPage(1);};
  const pageCount=Math.max(1,Math.ceil(total/24));
  const scrollContainer=()=>{
    const library=libraryRef.current;
    const grid=library?.querySelector<HTMLElement>(":scope > .arco-spin, :scope > .library-status");
    if(grid && grid.scrollHeight>grid.clientHeight)return grid;
    const workspace=library?.closest<HTMLElement>(".content");
    return workspace && workspace.scrollHeight>workspace.clientHeight ? workspace : grid || library;
  };
  const changePage=(next:number)=>{
    const target=Math.min(pageCount,Math.max(1,next));
    if(paging.current || loading || query!==search || target===page)return;
    // Lock synchronously: a second key can arrive before React commits the
    // loading state and replaces the document's keydown listener.
    paging.current=true;
    // The current card disappears after a page load. Keep keyboard focus in a
    // stable region instead of dropping it onto document.body.
    focusKeyboardTarget(libraryRef.current);
    setPage(target);
    scrollContainer()?.scrollTo({top:0});
  };
  useEffect(()=>{scrollContainer()?.scrollTo({top:0});},[page,kind,search,filter]);
  useEffect(()=>{
    const keydown=(event:KeyboardEvent)=>{
      const library=libraryRef.current;
      const target=event.target;
      if(!library || !(target instanceof HTMLElement))return;
      // Blank workspace clicks can leave the body focused. Never take arrow
      // keys from navigation, another panel, or a portalled control.
      if(target!==document.body && target.id!=="workspace-content" && !library.contains(target))return;
      if(isKeyboardEventBlocked(event))return;
      if(event.key==="/"){
        const searchInput=library.querySelector<HTMLInputElement>('.asset-toolbar input[aria-label="搜索素材名称"]');
        if(focusKeyboardTarget(searchInput)){event.preventDefault();searchInput?.select();}
        return;
      }
      if(event.key==="ArrowLeft" || event.key==="ArrowRight"){
        event.preventDefault();
        if(!event.repeat && !error)changePage(page+(event.key==="ArrowRight"?1:-1));
        return;
      }
      scrollWithKeyboard(event,scrollContainer());
    };
    document.addEventListener("keydown",keydown);
    return()=>document.removeEventListener("keydown",keydown);
  },[page,pageCount,loading,error,query,search]);
  return <section ref={libraryRef} className="asset-library" aria-label="素材库" aria-busy={loading} tabIndex={0} data-keyboard-region="content" aria-describedby={keyboardHintId}>
    <div className="section-title page-actions"><div className="page-intro"><h1>素材库</h1><p>管理项目中的图片、视频与音频。</p></div><Space wrap>
      <Button loading={scanning} icon={<HardDrive size={16}/>} onClick={inspectDisk}>磁盘清理</Button>
      <Button type="primary" loading={busy} icon={<Plus size={16}/>} onClick={importFiles}>导入素材</Button>
    </Space></div>
    <div className="asset-toolbar">
      <Select aria-label="素材类型" value={kind} onChange={value=>{setKind(value);setPage(1);}} options={[{label:"全部类型",value:"all"},{label:"图片",value:"image"},{label:"视频",value:"video"},{label:"音频",value:"audio"}]}/>
      <Select aria-label="使用状态" value={filter} onChange={value=>{setFilter(value);setPage(1);}} options={[{label:"全部素材",value:"all"},{label:"使用中",value:"used"},{label:"未使用",value:"unused"},{label:"回收站",value:"trash"}]}/>
      <Input.Search aria-label="搜索素材名称" value={query} onChange={setQuery} placeholder="搜索素材名称" allowClear onKeyDown={event=>{
        if(event.key==="Escape" && !event.defaultPrevented && !event.nativeEvent.isComposing && event.nativeEvent.keyCode!==229 && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey){
          event.preventDefault();event.stopPropagation();focusKeyboardTarget(libraryRef.current);
        }
      }}/>
      {filtered&&<Button className="asset-clear-filters" type="text" size="small" onClick={clearFilters}>清除筛选</Button>}
      <span className="helper asset-total" role="status">{loading?"正在加载素材…":<>共 <b>{total}</b> 项素材</>}</span>
    </div>
    {filter==="trash"&&<p className="helper">回收站保留原文件；永久删除才会释放磁盘空间。</p>}
    {error?<div className="library-status" role="alert"><div><b>素材暂时未能加载</b><p>{error}</p></div><Button onClick={()=>setVersion(v=>v+1)}>重新加载</Button></div>:<Spin loading={loading} style={{display:"block"}}>
      <div className="library-grid">{items.map(m=><article className="library-card" key={m.id}>
        <button type="button" className="library-thumbnail" onClick={()=>setPreview(m)} aria-label={`预览 ${m.name}`}><AssetThumbnail media={m} projectId={pid}/><span className="library-preview-hint"><Eye size={15}/>预览</span><Tag>{m.kind==="video"?"视频":m.kind==="image"?"图片":m.kind==="audio"?"音频":"文件"}</Tag></button>
        <div className="library-card-copy"><b title={m.name}>{m.name}</b>{(m.kind==="image"||m.kind==="video")&&<MediaDimensions media={m}/>}<small>{new Date(Number(m.created_at)*1000).toLocaleString()}</small></div>
        {filter!=="trash"&&m.kind!=="file"&&<button type="button" className="asset-usage-link" data-used={m.usage_count>0} onClick={()=>setTracking(m)}>{m.usage_count?`使用中 · ${m.usage_count} 处用途`:"未使用 · 查看用途"}</button>}
        <div className="asset-card-actions">
          {filter==="trash"?<Button size="small" disabled={busy} icon={<RotateCcw size={14}/>} onClick={()=>action("/media/restore",m)}>恢复素材</Button>:m.kind==="image"?<><Button size="small" icon={<WandSparkles size={14}/>} onClick={()=>onImageToImage(m)}>图生图</Button><Button size="small" onClick={()=>beginAssignment(m)}>设置用途</Button></>:m.kind==="video"?<Button size="small" onClick={()=>beginAssignment(m)}>设置用途</Button>:<Button size="small" onClick={()=>exportAsset(m)}>导出文件</Button>}
          <Dropdown trigger="click" droplist={<Menu onClickMenuItem={key=>{if(key==="rename")setRename({...m});if(key==="export")void exportAsset(m);if(key==="delete")confirmDelete(m);if(key==="usage")setTracking(m);}}>
            {filter!=="trash"&&<Menu.Item key="usage">查看用途</Menu.Item>}{filter!=="trash"&&<Menu.Item key="rename">重命名</Menu.Item>}<Menu.Item key="export">导出</Menu.Item><Menu.Item key="delete" disabled={busy || (filter!=="trash"&&m.usage_count>0)}>{filter==="trash"?"永久删除":"移入回收站"}</Menu.Item>
          </Menu>}><Button size="small" aria-label={`更多操作 ${m.name}`} icon={<MoreHorizontal size={16}/>}/></Dropdown>
        </div>
      </article>)}</div>
      {!items.length&&!loading&&<div className="asset-empty"><EmptyState
        title={filter==="trash"?"回收站为空":filtered?"没有符合条件的素材":"素材库还是空的"}
        description={filter==="trash"?"删除的素材会先进入回收站，可随时恢复。":filtered?"调整类型、用途或搜索词，再试一次。":"导入图片、视频或音频，在资产、场景与剪辑中重复使用。"}
        action={<Button type={filtered?"secondary":"primary"} icon={filtered?undefined:<Plus size={16}/>} onClick={filtered?clearFilters:importFiles}>{filtered?"清除筛选":"导入素材"}</Button>}
      /></div>}
    </Spin>}
    <div className="asset-library-footer">
      <p id={keyboardHintId} className="asset-keyboard-hint"><span><kbd>←</kbd><kbd>→</kbd> 翻页</span><span><kbd>↑</kbd><kbd>↓</kbd> 滚动</span><span><kbd>/</kbd> 搜索</span></p>
      <span className="asset-page-announcement" role="status" aria-live="polite" aria-atomic="true">{!loading&&!error&&`第 ${page} 页，共 ${pageCount} 页，当前 ${items.length} 项素材`}</span>
      {total>0&&!error&&<Pagination className="asset-pagination" current={page} pageSize={24} total={total} onChange={changePage} showTotal disabled={loading||query!==search}/>}
    </div>
    <Drawer className="asset-usage-drawer" width={460} visible={!!tracking} title="素材用途" footer={null} onCancel={()=>setTracking(null)}>
      <h3>{tracking?.name}</h3><Spin loading={usageLoading} style={{display:"block"}}>
        {usageError?<p role="alert">{usageError}</p>:uses.length?uses.map((use,index)=><div className="usage-record" key={index}><Tag>{use.purpose}</Tag><b>{use.episode_title&&use.kind==="scene"?`${use.episode_title} / `:""}{use.title}</b><Button size="small" onClick={()=>{setTracking(null);onLocate(use);}}>前往{use.kind==="asset"?"资产":use.kind==="episode"?"剧集":use.kind==="canvas"?"画布":"场景"}</Button></div>):!usageLoading&&<Empty description="尚未被资产、剧集或场景使用"/>}
      </Spin>
    </Drawer>
    <ImagePreviewModal media={preview?.kind==="image"?preview:null} images={items.filter(item=>item.kind==="image")} onMediaChange={setPreview} onClose={()=>setPreview(null)} footer={filter==="trash"?null:<Button type="primary" onClick={()=>preview&&beginAssignment(preview)}>设置用途</Button>}/>
    <VideoPreviewModal media={preview?.kind==="video"?preview:null} videos={items.filter(item=>item.kind==="video")} projectId={pid} onMediaChange={setPreview} onClose={()=>setPreview(null)} footer={filter==="trash"?null:<Button type="primary" onClick={()=>preview&&beginAssignment(preview)}>设置用途</Button>}/>
    <Modal visible={!!preview && (preview.kind==="audio"||preview.kind==="file")} title={preview?.name} footer={null} unmountOnExit onCancel={()=>setPreview(null)}>{preview?.kind==="audio"?<audio controls src={imageUrl(preview)} style={{width:"100%"}}/>:<Empty description="此文件不支持预览，可通过更多操作导出查看"/>}</Modal>
    <Modal visible={!!rename} title="重命名素材" onCancel={()=>setRename(null)} onOk={async()=>{if(!rename?.name.trim())throw Error("请输入素材名称");await post("/media/rename",{project_id:pid,id:rename.id,name:rename.name.trim()});setRename(null);await refresh();}}><Input aria-label="素材名称" value={rename?.name||""} onChange={name=>setRename(m=>m?{...m,name}:null)}/></Modal>
    <Modal visible={!!scan} title="磁盘清理" okText="执行清理" confirmLoading={busy} onCancel={()=>{if(!busy)setScan(null);}} onOk={async()=>{
      if(!scan)return;setBusy(true);try{await post("/storage/cleanup",{project_id:pid,files:scan.files.map(f=>f.path),clear_cache:true});setScan(null);await refresh();Message.success("缓存已清理，未登记文件已移入回收站");}catch(e){Message.error(String(e));throw e;}finally{setBusy(false);}
    }}>
      <p>可重建的缩略图缓存：{bytes(scan?.cache_bytes||0)}</p><p>未登记文件：{scan?.files.length||0} 个，共 {bytes(scan?.files.reduce((sum,f)=>sum+f.size,0)||0)}</p>
      <p>未登记文件将进入回收站，可检查后恢复或永久删除。正在使用的素材不会被清理。</p>
      <div className="cleanup-files">{scan?.files.map(file=><p key={file.path}>{file.path.split(/[\\/]/).pop()} · {bytes(file.size)}</p>)}</div>
    </Modal>
{assignment&&<AssetAssignmentModal key={assignment.id} media={assignment} data={data} reload={refresh} onClose={()=>setAssignment(null)}/>}  </section>;
}
