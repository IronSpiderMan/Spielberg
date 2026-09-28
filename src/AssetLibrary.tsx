import { Button,Drawer,Dropdown,Empty,Form,Input,Menu,Message,Modal,Pagination,Select,Space,Spin,Tag } from "@arco-design/web-react";
import { open,save } from "./platform";
import { HardDrive,MoreHorizontal,Plus,RotateCcw,WandSparkles } from "lucide-react";
import { useEffect,useRef,useState } from "react";
import AssetThumbnail from "./AssetThumbnail";
import { Media,Snapshot,imageUrl,post } from "./core";
import "./creation.css";

export type AssetUsage = {kind:"role"|"episode"|"scene";target_id:number;title:string;episode_id?:number;episode_title?:string;purpose:string};
type Asset = Media & {usage_count:number;deleted_at?:string};
type DiskScan = {files:{path:string;size:number}[];cache_bytes:number};
const bytes = (value:number) => value < 1048576 ? `${(value/1024).toFixed(1)} KB` : `${(value/1048576).toFixed(1)} MB`;
function MediaDimensions({media}:{media:Media}) {
  const [size,setSize]=useState("");
  useEffect(()=>{
    let active=true;
    const url=imageUrl(media);
    if(media.kind==="image"){
      const image=new Image();image.onload=()=>{if(active)setSize(`${image.naturalWidth} × ${image.naturalHeight} px`);};image.src=url;
      return()=>{active=false;image.src="";};
    }
    if(media.kind==="video"){
      const video=document.createElement("video");video.preload="metadata";
      video.onloadedmetadata=()=>{if(active)setSize(`${video.videoWidth} × ${video.videoHeight} px`);};video.onerror=()=>{if(active)setSize("尺寸未知");};video.src=url;
      return()=>{active=false;video.removeAttribute("src");video.load();};
    }
    return()=>{active=false;};
  },[media]);
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
  const pid=data.project.id;
  const refresh=async()=>{await reload();setVersion(v=>v+1);};
  useEffect(()=>{const timer=setTimeout(()=>{setSearch(query);setPage(1);},250);return()=>clearTimeout(timer);},[query]);
  useEffect(()=>{
    const id=++request.current;setLoading(true);setError("");
    void post<{items:Asset[];total:number}>("/media/list",{project_id:pid,kind,query:search,usage:filter,page,limit:24}).then(result=>{
      if(id!==request.current)return;
      if(page>1 && result.total <= (page-1)*24){setPage(Math.max(1,Math.ceil(result.total/24)));return;}
      setItems(result.items);setTotal(result.total);
    }).catch(e=>{if(id===request.current)setError(String(e));}).finally(()=>{if(id===request.current)setLoading(false);});
    return()=>{request.current++;};
  },[pid,kind,search,filter,page,version,data.revisions?.media,data.revisions?.roles,data.revisions?.episodes]);
  useEffect(()=>{
    if(!tracking)return;
    let disposed=false;setUses([]);setUsageError("");setUsageLoading(true);
    void post<{items:AssetUsage[]}>("/media/usage",{project_id:pid,id:tracking.id}).then(result=>{if(!disposed)setUses(result.items);}).catch(e=>{if(!disposed)setUsageError(String(e));}).finally(()=>{if(!disposed)setUsageLoading(false);});
    return()=>{disposed=true;};
  },[tracking,pid,data.revisions?.roles,data.revisions?.episodes]);
  const [assignment,setAssignment]=useState<Media|null>(null);
  const [usage,setUsage]=useState("role");
  const [target,setTarget]=useState<number|undefined>();
  const [assigning,setAssigning]=useState(false);
  const usages=[{value:"role",label:"角色图"},{value:"first",label:"场景首帧"},{value:"last",label:"场景尾帧"},{value:"reference",label:"场景参考图"}];
  const scenes=data.episodes.flatMap(episode=>episode.scenes.map(scene=>({scene,label:`${episode.title} / ${scene.title}`})));
  const beginAssignment=(media:Media)=>{setPreview(null);setAssignment(media);setUsage(media.kind==="video"?"video":"role");setTarget(undefined);};
  const assign=async()=>{
    if(!assignment || target===undefined || assigning)return;
    setAssigning(true);
    try {
      const project_id=data.project.id;
      if(usage==="role") {
        const role=data.roles.find(r=>r.id===target);
        if(!role)throw new Error("请选择有效的角色");
        await post("/roles/media/add",{project_id,role_id:role.id,media_id:assignment.id});
        await post("/roles/update",{project_id,id:role.id,name:role.name,description:role.description,design_media_id:assignment.id});
      } else {
        const scene=scenes.find(item=>item.scene.id===target)?.scene;
        if(!scene)throw new Error("请选择有效的场景");
        if(usage==="video")await post("/scenes/select-video",{project_id,scene_id:scene.id,media_id:assignment.id});
        else await post("/scenes/update",{project_id,id:scene.id,title:scene.title,description:scene.description,first_media_id:scene.first_media_id,last_media_id:scene.last_media_id,reference_media_id:scene.reference_media_id,[`${usage}_media_id`]:assignment.id});
      }
      await reload();
      setAssignment(null);
      Message.success(`已设置为${usage==="video"?"场景视频":usages.find(item=>item.value===usage)?.label}`);
    } catch(e){Message.error(String(e));}finally{setAssigning(false);}
  };
  const importFiles=async()=>{try {
    const files=await open({multiple:true,filters:[{name:"图片和视频",extensions:["png","jpg","jpeg","webp","gif","mp4","mov","webm","mkv"]}]});
    if(!files)return;setBusy(true);
    for(const source of typeof files==="string"?[files]:files)await post("/media/import",{project_id:pid,source_path:source});
    await refresh();
  }catch(e){Message.error(String(e));await refresh();}finally{setBusy(false);}};
  const action=async(path:string,m:Media)=>{setBusy(true);try{await post(path,{project_id:pid,id:m.id});await refresh();}catch(e){Message.error(String(e));}finally{setBusy(false);}};
  const confirmDelete=(m:Asset)=>Modal.confirm({
    title:filter==="trash"?"永久删除这个文件？":"移入回收站？",
    content:filter==="trash"?`${m.name} 将从磁盘删除，无法撤销。`:`${m.name} 可以随时从回收站恢复。被使用的资产不能移入回收站。`,
    okText:filter==="trash"?"永久删除":"移入回收站",okButtonProps:{status:"danger"},
    onOk:()=>action(filter==="trash"?"/media/purge":"/media/delete",m),
  });
  const exportAsset=async(m:Media)=>{try{const path=await save({defaultPath:m.name});if(path)await post("/media/export",{project_id:pid,media_id:m.id,destination_path:path});}catch(e){Message.error(String(e));}};
  const inspectDisk=async()=>{setScanning(true);try{setScan(await post<DiskScan>("/storage/scan",{project_id:pid}));}catch(e){Message.error(String(e));}finally{setScanning(false);}};
  return <section>
    <div className="section-title"><div><h1>资产库</h1><p>查看素材用途，管理图片、视频和回收站。</p></div><Space wrap>
      <Button loading={scanning} icon={<HardDrive size={16}/>} onClick={inspectDisk}>磁盘清理</Button>
      <Button type="primary" loading={busy} icon={<Plus size={16}/>} onClick={importFiles}>导入资产</Button>
    </Space></div>
    <div className="asset-toolbar">
      <Select aria-label="资产类型" value={kind} onChange={value=>{setKind(value);setPage(1);}} options={[{label:"全部类型",value:"all"},{label:"图片",value:"image"},{label:"视频",value:"video"}]}/>
      <Select aria-label="使用状态" value={filter} onChange={value=>{setFilter(value);setPage(1);}} options={[{label:"全部资产",value:"all"},{label:"使用中",value:"used"},{label:"未使用",value:"unused"},{label:"回收站",value:"trash"}]}/>
      <Input.Search value={query} onChange={setQuery} placeholder="搜索资产名称" allowClear/>
      <span className="helper">共 {total} 项</span>
    </div>
    {filter==="trash"&&<p className="helper">回收站保留原文件；永久删除才会释放磁盘空间。</p>}
    {error?<div role="alert"><p>{error}</p><Button onClick={()=>setVersion(v=>v+1)}>重试</Button></div>:<Spin loading={loading} style={{display:"block"}}>
      <div className="library-grid">{items.map(m=><article className="library-card" key={m.id}>
        <button className="library-thumbnail" onClick={()=>setPreview(m)} aria-label={`预览 ${m.name}`}><AssetThumbnail media={m} projectId={pid}/><Tag>{m.kind==="video"?"视频":m.kind==="image"?"图片":"文件"}</Tag></button>
        <b title={m.name}>{m.name}</b>{m.kind!=="file"&&<MediaDimensions media={m}/>}<small>{new Date(Number(m.created_at)*1000).toLocaleString()}</small>
        {filter!=="trash"&&m.kind!=="file"&&<button className="asset-usage-link" onClick={()=>setTracking(m)}>{m.usage_count?`使用中 · ${m.usage_count} 处用途`:"未使用 · 查看用途"}</button>}
        <div className="asset-card-actions">
          {filter==="trash"?<Button size="small" disabled={busy} icon={<RotateCcw size={14}/>} onClick={()=>action("/media/restore",m)}>恢复资产</Button>:m.kind==="image"?<><Button size="small" icon={<WandSparkles size={14}/>} onClick={()=>onImageToImage(m)}>图生图</Button><Button size="small" onClick={()=>beginAssignment(m)}>设置用途</Button></>:m.kind==="video"?<Button size="small" onClick={()=>beginAssignment(m)}>设置用途</Button>:<Button size="small" onClick={()=>exportAsset(m)}>导出文件</Button>}
          <Dropdown trigger="click" droplist={<Menu onClickMenuItem={key=>{if(key==="rename")setRename({...m});if(key==="export")void exportAsset(m);if(key==="delete")confirmDelete(m);if(key==="usage")setTracking(m);}}>
            {filter!=="trash"&&<Menu.Item key="usage">查看用途</Menu.Item>}{filter!=="trash"&&<Menu.Item key="rename">重命名</Menu.Item>}<Menu.Item key="export">导出</Menu.Item><Menu.Item key="delete" disabled={busy || (filter!=="trash"&&m.usage_count>0)}>{filter==="trash"?"永久删除":"移入回收站"}</Menu.Item>
          </Menu>}><Button size="small" aria-label={`更多操作 ${m.name}`} icon={<MoreHorizontal size={16}/>}/></Dropdown>
        </div>
      </article>)}</div>
      {!items.length&&!loading&&<Empty description={filter==="trash"?"回收站为空":"没有符合条件的资产"}/>}
    </Spin>}
    <Pagination className="asset-pagination" current={page} pageSize={24} total={total} onChange={setPage} showTotal/>
    <Drawer width={460} visible={!!tracking} title="资产用途" footer={null} onCancel={()=>setTracking(null)}>
      <h3>{tracking?.name}</h3><Spin loading={usageLoading} style={{display:"block"}}>
        {usageError?<p role="alert">{usageError}</p>:uses.length?uses.map((use,index)=><div className="usage-record" key={index}><Tag>{use.purpose}</Tag><b>{use.episode_title&&use.kind==="scene"?`${use.episode_title} / `:""}{use.title}</b><Button size="small" onClick={()=>{setTracking(null);onLocate(use);}}>前往{use.kind==="role"?"角色":use.kind==="episode"?"剧集":"场景"}</Button></div>):!usageLoading&&<Empty description="尚未被角色、剧集或场景使用"/>}
      </Spin>
    </Drawer>
    <Modal visible={!!preview} title={preview?.name} footer={filter==="trash"||preview?.kind==="file"?null:<Button type="primary" onClick={()=>preview&&beginAssignment(preview)}>设置用途</Button>} unmountOnExit onCancel={()=>setPreview(null)}>{preview?.kind==="video"?<video className="asset-preview" controls src={imageUrl(preview)}/>:preview?.kind==="file"?<Empty description="此文件不支持预览，可通过更多操作导出查看"/>:<img className="asset-preview" src={imageUrl(preview||undefined)} alt={preview?.name}/>}</Modal>
    <Modal visible={!!rename} title="重命名资产" onCancel={()=>setRename(null)} onOk={async()=>{if(!rename?.name.trim())throw Error("请输入资产名称");await post("/media/rename",{project_id:pid,id:rename.id,name:rename.name.trim()});setRename(null);await refresh();}}><Input aria-label="资产名称" value={rename?.name||""} onChange={name=>setRename(m=>m?{...m,name}:null)}/></Modal>
    <Modal visible={!!scan} title="磁盘清理" okText="执行清理" confirmLoading={busy} onCancel={()=>{if(!busy)setScan(null);}} onOk={async()=>{
      if(!scan)return;setBusy(true);try{await post("/storage/cleanup",{project_id:pid,files:scan.files.map(f=>f.path),clear_cache:true});setScan(null);await refresh();Message.success("缓存已清理，未登记文件已移入回收站");}catch(e){Message.error(String(e));throw e;}finally{setBusy(false);}
    }}>
      <p>可重建的缩略图缓存：{bytes(scan?.cache_bytes||0)}</p><p>未登记文件：{scan?.files.length||0} 个，共 {bytes(scan?.files.reduce((sum,f)=>sum+f.size,0)||0)}</p>
      <p>未登记文件将进入回收站，可检查后恢复或永久删除。正在使用的资产不会被清理。</p>
      <div className="cleanup-files">{scan?.files.map(file=><p key={file.path}>{file.path.split(/[\\/]/).pop()} · {bytes(file.size)}</p>)}</div>
    </Modal>
<Modal className="asset-assignment-modal" visible={!!assignment} title="设置资产用途" okText="确定设置" confirmLoading={assigning} okButtonProps={{disabled:target===undefined}} cancelButtonProps={{disabled:assigning}} maskClosable={!assigning} closable={!assigning} onCancel={()=>{if(!assigning)setAssignment(null);}} onOk={assign}>
    <p>{assignment?.name}</p>
    <Form layout="vertical" disabled={assigning}>
      <Form.Item label="设置为"><Select aria-label="资产用途" value={usage} onChange={value=>{setUsage(value);setTarget(undefined);}} options={assignment?.kind==="video"?[{value:"video",label:"场景视频"}]:usages}/></Form.Item>
      <Form.Item label={usage==="role"?"选择角色":"选择场景"} required><Select aria-label={usage==="role"?"选择角色":"选择场景"} showSearch allowClear value={target} onChange={setTarget} placeholder={usage==="role"?"请选择角色":"请选择剧集 / 场景"} options={usage==="role"?data.roles.map(role=>({value:role.id,label:role.name})):scenes.map(({scene,label})=>({value:scene.id,label}))}/></Form.Item>
      {(usage==="role"?!data.roles.length:!scenes.length)&&<p className="helper">{usage==="role"?"请先在角色管理中创建角色":"请先创建剧集和场景"}</p>}
      <p className="helper">{usage==="role"?"图片将加入角色图片并设为主图。":usage==="video"?"视频将加入该场景并设为当前使用的视频。":"图片将替换所选场景对应的图片。"}</p>
    </Form>
  </Modal>  </section>;
}
