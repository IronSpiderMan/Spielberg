import React, {useEffect, useRef, useState} from "react";
import {Button, Empty, Form, Input, Message, Modal, Popconfirm, Select, Space, Tabs, Tag} from "@arco-design/web-react";
import {open, save} from "@tauri-apps/plugin-dialog";
import {Plus, ImagePlus, ArrowUp, ArrowDown, Trash2, Download} from "lucide-react";
import {Media, Role, Scene, Snapshot, post, imageUrl} from "./core";
import "./creation.css";

function rolePattern(roles: Role[]) {
  const slash=String.fromCharCode(92);
  const names=roles.map(role=>role.name).filter(Boolean).sort((a,b)=>b.length-a.length).map(name=>name.split("").map(char=>slash+"u"+char.charCodeAt(0).toString(16).padStart(4,"0")).join(""));
  return names.length ? new RegExp(`@(${names.join("|")})(?=$|[${slash}s，。！？、；：,.!?;:()（）])`,"g") : null;
}
function mentioned(prompt: string, roles: Role[]) {
  const pattern=rolePattern(roles);
  const names=new Set(pattern ? Array.from(prompt.matchAll(pattern),match=>match[1]) : []);
  return roles.filter(role=>names.has(role.name));
}
export function resolvePrompt(prompt: string, roles: Role[]) {
  const pattern=rolePattern(roles);
  return pattern ? prompt.replace(pattern,(_,name:string)=>{const role=roles.find(role=>role.name===name)!;return `${name}（${role.description || "保持角色设定"}）`;}) : prompt;
}
function PromptInput({value,onChange,roles,placeholder}: {value:string;onChange:(v:string)=>void;roles:Role[];placeholder?:string}) {
  const query=value.match(/@([^@\n]*)$/)?.[1];
  return <div><Input.TextArea value={value} onChange={onChange} autoSize={{minRows:3,maxRows:8}} placeholder={placeholder || "描述画面，输入 @ 引用角色"}/>{query !== undefined && <div className="mention-options">{roles.filter(r=>r.name.includes(query)).map(r=><Button size="mini" key={r.id} onClick={()=>onChange(value.slice(0,value.lastIndexOf("@"))+`@${r.name} `)}>@{r.name}</Button>)}</div>}<div className="mention-options">{mentioned(value,roles).map(r=><Tag key={r.id} color="purple">@{r.name}</Tag>)}</div></div>;
}
export function CreationDesk({data,reload,renderSequence,changePage,activeTab,onTabChange}: {data:Snapshot;reload:()=>void;renderSequence:()=>React.ReactNode;changePage:(v:string)=>void;editScene:(s:Scene)=>void;activeTab:string;onTabChange:(tab:string)=>void}) {
  return <section className="creation-desk"><div className="section-title"><div><p className="eyebrow">CREATIVE WORKSPACE</p><h1>创作工作台</h1><p>从一张画面，到一个完整的故事。</p></div><Button onClick={()=>changePage("assets")}>打开资产库</Button></div><Tabs activeTab={activeTab} onChange={onTabChange} destroyOnHide={false}><Tabs.TabPane key="images" title="01 · 图片生成"><ImageStudio data={data} reload={reload}/></Tabs.TabPane><Tabs.TabPane key="sequence" title="02 · 剧集编排">{renderSequence()}</Tabs.TabPane><Tabs.TabPane key="script" title="03 · 脚本编排"><ScriptStudio data={data} reload={reload} onCreated={()=>changePage("episodes")}/></Tabs.TabPane></Tabs></section>;
}
function ImageStudio({data,reload}: {data:Snapshot;reload:()=>void}) {
  const [mode,setMode]=useState("t2i"),[prompt,setPrompt]=useState(""),[ratio,setRatio]=useState("16:9"),[refs,setRefs]=useState<number[]>([]),[busy,setBusy]=useState(false),[result,setResult]=useState<Media|null>(null);
  const roleRefs=mentioned(prompt,data.roles).map(r=>({role:r,media:data.media.find(m=>m.id===r.design_media_id)||r.images[0]}));
  const generate=async()=>{
    if(!prompt.trim()) return Message.warning("请填写画面描述");
    const ids=[...new Set([...refs,...roleRefs.flatMap(r=>r.media?[r.media.id]:[])])];
    if(mode==="i2i" && roleRefs.some(r=>!r.media)) return Message.warning("引用的角色尚无图片，请先在角色设定中添加");
    if(mode==="i2i" && !ids.length) return Message.warning("请选择参考图，或 @ 有图片的角色");
    setBusy(true);
    try {const media=await post<Media>("/generations/image",{project_id:data.project.id,operation:mode,prompt:resolvePrompt(prompt,data.roles),aspect_ratio:ratio,image_media_ids:mode==="i2i"?ids:[]});setResult(media);await reload();Message.success("图片已保存到资产库");} catch(e){Message.error(String(e));}finally{setBusy(false);}
  };
  return <div className="creation-split"><div className="creation-panel"><h2>描绘你的下一幕</h2><Form layout="vertical" disabled={busy}><Form.Item label="生成方式"><Select value={mode} onChange={setMode} options={[{label:"文生图",value:"t2i"},{label:"图生图",value:"i2i"}]}/></Form.Item><Form.Item label="画面描述" required><PromptInput value={prompt} onChange={setPrompt} roles={data.roles}/></Form.Item><p className="helper">文生图引用角色设定；图生图同时引用角色主图，可在下方添加更多参考图。</p>{mode==="i2i" && <Form.Item label="参考图片"><Select mode="multiple" value={refs} onChange={setRefs} showSearch placeholder="从资产库选择" options={data.media.filter(m=>m.kind==="image").map(m=>({value:m.id,label:m.name}))}/><div className="reference-strip">{roleRefs.map(r=>r.media?<img key={r.role.id} src={imageUrl(r.media)} title={`@${r.role.name}`} alt={r.role.name}/>:<Tag color="red" key={r.role.id}>{r.role.name} 缺少图片</Tag>)}{refs.map(id=>{const m=data.media.find(m=>m.id===id);return m?<img key={id} src={imageUrl(m)} alt={m.name}/>:null;})}</div></Form.Item>}<Form.Item label="画幅"><Select value={ratio} onChange={setRatio} options={["16:9","9:16","1:1"]}/></Form.Item><Button type="primary" long loading={busy} onClick={generate} icon={<ImagePlus size={16}/>}>生成图片</Button></Form></div><div className="creation-panel image-result">{result?<><img src={imageUrl(result)} alt={result.name}/><p>{result.name} · 已入库</p></>:<Empty description="生成结果将在这里展示，并自动进入资产库"/>}<p className="helper">生成任务可在「后台任务」中查看进度与错误信息。</p></div></div>;
}
export function SequencePreview({scenes}: {scenes:Scene[]}) {
  const [index,setIndex]=useState(0),[playing,setPlaying]=useState(false);
  const player=useRef<HTMLVideoElement>(null);
  const signature=scenes.map(s=>`${s.id}:${s.video_media_id}`).join(",");
  useEffect(()=>{setIndex(0);setPlaying(false);},[signature]);
  const missing=scenes.filter(s=>!s.video_media).length;
  if(!scenes.length) return <Empty description="添加场景后开始编排"/>;
  if(missing) return <Empty description={`还有 ${missing} 个场景未选择视频，请在下方选择`}/>;
  return <div className="sequence-player"><video ref={player} key={`${signature}:${index}`} src={imageUrl(scenes[index]?.video_media)} controls autoPlay={playing} onPlay={()=>setPlaying(true)} onEnded={()=>{if(index<scenes.length-1){setPlaying(true);setIndex(index+1);}else{setPlaying(false);}}} onError={()=>Message.error("视频无法播放，请检查文件或更换版本")}/><div><span>即时串播 · {index+1} / {scenes.length} · {scenes[index]?.title}</span><Button size="mini" onClick={()=>{setIndex(0);setPlaying(true);if(player.current){player.current.currentTime=0;void player.current.play().catch(()=>Message.warning("请点击播放器开始播放"));}}}>从头播放</Button></div></div>;
}
export function AssetLibrary({data,reload}: {data:Snapshot;reload:()=>void}) {
  const [kind,setKind]=useState("all"),[query,setQuery]=useState(""),[preview,setPreview]=useState<Media|null>(null),[rename,setRename]=useState<Media|null>(null),[busy,setBusy]=useState(false);
  const items=data.media.filter(m=>(kind==="all"||m.kind===kind)&&m.name.toLowerCase().includes(query.toLowerCase()));
  const importFiles=async()=>{try {const files=await open({multiple:true,filters:[{name:"图片和视频",extensions:["png","jpg","jpeg","webp","gif","mp4","mov","webm","mkv"]}]});if(!files)return;setBusy(true);for(const source of typeof files==="string"?[files]:files)await post("/media/import",{project_id:data.project.id,source_path:source});}catch(e){Message.error(String(e));}finally{setBusy(false);await reload();}};
  return <section><div className="section-title"><div><p className="eyebrow">PROJECT ASSETS</p><h1>资产库</h1><p>当前项目的图片、视频和合并成片，统一管理与复用。</p></div><Button type="primary" loading={busy} icon={<Plus size={16}/>} onClick={importFiles}>导入资产</Button></div><div className="asset-toolbar"><Select aria-label="资产类型" value={kind} onChange={setKind} options={[{label:`全部 · ${data.media.length}`,value:"all"},{label:"图片",value:"image"},{label:"视频",value:"video"}]}/><Input.Search value={query} onChange={setQuery} placeholder="搜索资产名称" allowClear/></div><div className="library-grid">{items.map(m=><article className="library-card" key={m.id}><button className="library-thumbnail" onClick={()=>setPreview(m)} aria-label={`预览 ${m.name}`}>{m.kind==="video"?<video src={`${imageUrl(m)}#t=0.001`} preload="metadata" muted/>:<img loading="lazy" src={imageUrl(m)} alt={m.name}/>}<Tag>{m.kind==="video"?"视频":"图片"}</Tag></button><b title={m.name}>{m.name}</b><small>{new Date(Number(m.created_at)*1000).toLocaleString()}</small><Space><Button size="mini" onClick={()=>setRename({...m})}>重命名</Button><Button size="mini" icon={<Download size={13}/>} onClick={async()=>{try{const path=await save({defaultPath:m.name});if(path)await post("/media/export",{project_id:data.project.id,media_id:m.id,destination_path:path});}catch(e){Message.error(String(e));}}}>导出</Button><Popconfirm title="从资产库移除此资产？被角色或场景引用的资产不可删除。" onOk={async()=>{try{await post("/media/delete",{project_id:data.project.id,id:m.id});await reload();}catch(e){Message.error(String(e));}}}><Button aria-label={`删除 ${m.name}`} size="mini" status="danger" icon={<Trash2 size={13}/>}/></Popconfirm></Space></article>)}</div>{!items.length&&<Empty description="还没有符合条件的资产，导入素材或去工作台生成图片"/>}<Modal visible={!!preview} title={preview?.name} footer={null} unmountOnExit onCancel={()=>setPreview(null)}>{preview?.kind==="video"?<video className="asset-preview" controls src={imageUrl(preview)}/>:<img className="asset-preview" src={imageUrl(preview || undefined)} alt={preview?.name}/>}</Modal><Modal visible={!!rename} title="重命名资产" onCancel={()=>setRename(null)} onOk={async()=>{if(!rename?.name.trim())return;try{await post("/media/rename",{project_id:data.project.id,id:rename.id,name:rename.name.trim()});setRename(null);await reload();}catch(e){Message.error(String(e));}}}><Input value={rename?.name||""} onChange={name=>setRename(m=>m?{...m,name}:null)}/></Modal></section>;
}
type ScriptScene={id:string;description:string;first:string;last:string;reference:string};
type ScriptDraft={title:string;scenes:ScriptScene[]};
const blankScene=():ScriptScene=>({id:crypto.randomUUID(),description:"",first:"",last:"",reference:""});
function ScriptStudio({data,reload,onCreated}: {data:Snapshot;reload:()=>void;onCreated:()=>void}) {
  const [draft,setDraft]=useState<ScriptDraft>({title:"",scenes:[blankScene()]}),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[status,setStatus]=useState("正在读取草稿");
  const latest=useRef(draft);latest.current=draft;
  const saveQueue=useRef<Promise<unknown>>(Promise.resolve());
  useEffect(()=>{let disposed=false;post<ScriptDraft|null>("/scripts/load",{project_id:data.project.id}).then(saved=>{if(!disposed){if(saved)setDraft(saved);setLoaded(true);setStatus("草稿已读取");}}).catch(e=>{if(!disposed)setStatus(`读取失败：${String(e)}`);});return()=>{disposed=true;};},[data.project.id]);
  const persist=(current:ScriptDraft)=>{
    setStatus("正在保存草稿");
    const request=saveQueue.current.catch(()=>{}).then(()=>post("/scripts/save",{project_id:data.project.id,draft:current}));
    saveQueue.current=request;
    return request.then(()=>{if(latest.current===current){setStatus("草稿已保存");}}).catch(e=>{setStatus("保存失败，请重试");throw e;});
  };
  const update=(next:ScriptDraft)=>{latest.current=next;setDraft(next);void persist(next).catch(()=>{});};
  const saveDraft=async()=>{setBusy(true);try{await persist(latest.current);}catch(e){Message.error(String(e));}finally{setBusy(false);}};
  const patch=(id:string,key:keyof ScriptScene,value:string)=>update({...draft,scenes:draft.scenes.map(s=>s.id===id?{...s,[key]:value}:s)});
  const move=(i:number,d:number)=>{const scenes=[...draft.scenes];[scenes[i],scenes[i+d]]=[scenes[i+d],scenes[i]];update({...draft,scenes});};
  const publish=async()=>{if(!draft.title.trim()||!draft.scenes.length||draft.scenes.some(s=>!s.description.trim()))return Message.warning("请填写剧集标题及每个场景的描述");setBusy(true);try{await saveQueue.current;await post("/scripts/publish",{project_id:data.project.id,draft});await reload();Message.success("已根据脚本创建剧集，可继续生成图片与视频");onCreated();}catch(e){Message.error(String(e));}finally{setBusy(false);}};
  return <div className="script-studio"><div className="script-toolbar"><div><h2>先写故事，再制作镜头</h2><p className="helper">草稿自动保存。确认后创建剧集与场景，帧描述保留为图片生成提示词。</p></div><Space><Tag>{status}</Tag><Button disabled={!loaded} loading={busy} onClick={saveDraft}>保存草稿</Button><Button type="primary" disabled={!loaded} loading={busy} onClick={publish}>确定脚本，创建剧集</Button></Space></div><fieldset disabled={!loaded||busy}><Form layout="vertical"><Form.Item label="剧集标题" required><Input value={draft.title} onChange={title=>update({...draft,title})} placeholder="为这一集命名"/></Form.Item>{draft.scenes.map((scene,i)=><article className="script-scene" key={scene.id}><div className="script-scene-head"><b>SCENE {String(i+1).padStart(3,"0")}</b><Space><Button aria-label="上移场景" size="mini" disabled={!i||busy} onClick={()=>move(i,-1)} icon={<ArrowUp size={14}/>}/><Button aria-label="下移场景" size="mini" disabled={i===draft.scenes.length-1||busy} onClick={()=>move(i,1)} icon={<ArrowDown size={14}/>}/><Button size="mini" onClick={()=>update({...draft,scenes:[...draft.scenes,{...scene,id:crypto.randomUUID()}]})}>复制</Button><Popconfirm title="删除此脚本场景？" onOk={()=>update({...draft,scenes:draft.scenes.filter(s=>s.id!==scene.id)})}><Button size="mini" status="danger" icon={<Trash2 size={14}/>}/></Popconfirm></Space></div><Form.Item label="场景描述" required><PromptInput value={scene.description} onChange={v=>patch(scene.id,"description",v)} roles={data.roles} placeholder="描述场景中的动作、环境和镜头运动（必填）"/></Form.Item><div className="script-frames">{([['first','首帧描述'],['last','尾帧描述'],['reference','参考图描述']] as const).map(([key,label])=><Form.Item key={key} label={`${label} · 选填`}><PromptInput value={scene[key]} onChange={v=>patch(scene.id,key,v)} roles={data.roles}/></Form.Item>)}</div></article>)}<Button long disabled={!loaded||busy} icon={<Plus size={16}/>} onClick={()=>update({...draft,scenes:[...draft.scenes,blankScene()]})}>添加场景</Button></Form></fieldset></div>;
}
