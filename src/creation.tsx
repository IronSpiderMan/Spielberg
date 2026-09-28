import { Button,Empty,Form,Input,Message,Popconfirm,Select,Space,Tabs,Tag } from "@arco-design/web-react";
import { ArrowDown,ArrowUp,ImagePlus,Plus,Trash2,Undo2 } from "lucide-react";
import React,{ lazy,Suspense,useEffect,useRef,useState } from "react";
import { GENERATION_SIZES, Media,Scene,Snapshot,imageUrl,post } from "./core";
import { ProjectSummary } from "./ui";
import { findMentions,mentionPattern,promptMentions,resolvePromptReferences } from "./prompt-mentions";
import { PromptInput } from "./PromptInput";
import { STYLE_PRESETS } from "./prompt-presets";

import { resolvePrompt } from "./resolve-prompt";
import type { Person } from "./PoseStudio";
const PoseStudio=lazy(()=>import("./PoseStudio"));
function resolveImagePrompt(prompt:string,data:Snapshot) {
  const items=promptMentions(data.roles,data), pattern=mentionPattern(items);
  return pattern ? prompt.replace(pattern,(_,name:string)=>{
    const item=items.find(item=>item.name===name)!;
    return item.kind==="role" ? `${name}（${item.description}）` : `参考图片（${item.description}）`;
  }) : prompt;
}
export function CreationDesk({data,reload,renderSequence,changePage,activeTab,onTabChange,imageSource}: {data:Snapshot;reload:()=>void;renderSequence:()=>React.ReactNode;changePage:(v:string)=>void;editScene:(s:Scene)=>void;activeTab:string;onTabChange:(tab:string)=>void;imageSource?:Media}) {
  return <section className="creation-desk"><div className="section-title"><div><p className="eyebrow">CREATIVE WORKSPACE</p><h1>创作工作台</h1><p>从一张画面，到一个完整的故事。</p></div><Button onClick={()=>changePage("assets")}>打开资产库</Button></div><ProjectSummary data={data}/><Tabs activeTab={activeTab} onChange={onTabChange} destroyOnHide={false}><Tabs.TabPane key="script" title="01 · 脚本编排"><ScriptStudio data={data} reload={reload} onCreated={()=>changePage("episodes")}/></Tabs.TabPane><Tabs.TabPane key="images" title="02 · 图片生成"><ImageStudio key={imageSource?.id||"default"} data={data} reload={reload} source={imageSource}/></Tabs.TabPane><Tabs.TabPane key="sequence" title="03 · 剧集编排">{renderSequence()}</Tabs.TabPane></Tabs></section>;
}
function MaskPainter({source,value,onChange}:{source:Media;value?:string;onChange:(value:string|undefined)=>void}) {
  const canvas=useRef<HTMLCanvasElement>(null),maskCanvas=useRef<HTMLCanvasElement>(null),drawing=useRef(false),origin=useRef<{x:number;y:number}>({x:0,y:0}),points=useRef<{x:number;y:number}[]>([]),[loaded,setLoaded]=useState(false),[tool,setTool]=useState<"rect"|"circle"|"free">("rect");
  useEffect(()=>{let active=true;const img=new Image();img.onload=()=>{if(!active||!canvas.current||!maskCanvas.current)return;const c=canvas.current,m=maskCanvas.current;c.width=m.width=img.naturalWidth;c.height=m.height=img.naturalHeight;const ctx=c.getContext("2d")!,maskCtx=m.getContext("2d")!;ctx.clearRect(0,0,c.width,c.height);maskCtx.fillStyle="#000";maskCtx.fillRect(0,0,m.width,m.height);if(value){const overlay=new Image();overlay.onload=()=>{ctx.drawImage(overlay,0,0,c.width,c.height);maskCtx.globalCompositeOperation="destination-out";maskCtx.drawImage(overlay,0,0,m.width,m.height);maskCtx.globalCompositeOperation="source-over";};overlay.src=value;}setLoaded(true);};img.src=imageUrl(source);return()=>{active=false;};},[source.id]);
  const pos=(e:React.PointerEvent<HTMLCanvasElement>)=>{const c=canvas.current!,r=c.getBoundingClientRect();return{x:(e.clientX-r.left)*c.width/r.width,y:(e.clientY-r.top)*c.height/r.height};};
  const drawShape=(p:{x:number;y:number},commit=false)=>{const c=canvas.current!,ctx=c.getContext("2d")!,m=maskCanvas.current!,mc=m.getContext("2d")!,o=origin.current;ctx.clearRect(0,0,c.width,c.height);ctx.fillStyle="rgba(255,55,40,.38)";ctx.beginPath();if(tool==="rect")ctx.rect(o.x,o.y,p.x-o.x,p.y-o.y);else if(tool==="circle"){const radius=Math.min(Math.abs(p.x-o.x),Math.abs(p.y-o.y)),x=o.x+(p.x<o.x?-radius:radius),y=o.y+(p.y<o.y?-radius:radius);ctx.ellipse(x,y,radius,radius,0,0,Math.PI*2);}else{points.current.forEach((point,i)=>i?ctx.lineTo(point.x,point.y):ctx.moveTo(point.x,point.y));ctx.closePath();}ctx.fill();if(commit){mc.globalCompositeOperation="destination-out";mc.beginPath();if(tool==="rect")mc.rect(o.x,o.y,p.x-o.x,p.y-o.y);else if(tool==="circle"){const radius=Math.min(Math.abs(p.x-o.x),Math.abs(p.y-o.y)),x=o.x+(p.x<o.x?-radius:radius),y=o.y+(p.y<o.y?-radius:radius);mc.ellipse(x,y,radius,radius,0,0,Math.PI*2);}else{points.current.forEach((point,i)=>i?mc.lineTo(point.x,point.y):mc.moveTo(point.x,point.y));mc.closePath();}mc.fill();mc.globalCompositeOperation="source-over";}};
  const stroke=(e:React.PointerEvent<HTMLCanvasElement>,begin:boolean)=>{const c=canvas.current!,p=pos(e);if(begin){c.setPointerCapture(e.pointerId);drawing.current=true;origin.current=p;points.current=[p];return;}if(tool==="free")points.current.push(p);drawShape(p);};
  const finish=(e:React.PointerEvent<HTMLCanvasElement>)=>{if(!drawing.current)return;drawing.current=false;const p=pos(e),m=maskCanvas.current;if(m){if(tool==="free")points.current.push(p);drawShape(p,true);onChange(m.toDataURL("image/png"));}};
  const start=(e:React.PointerEvent<HTMLCanvasElement>)=>{if(loaded)stroke(e,true);};
  const move=(e:React.PointerEvent<HTMLCanvasElement>)=>{if(drawing.current)stroke(e,false);};
  return <div className="mask-painter"><div className="mask-painter-head"><span>框选要修改的区域</span><Space size={6}><Button size="mini" type={tool==="rect"?"primary":"secondary"} onClick={()=>setTool("rect")}>矩形框</Button><Button size="mini" type={tool==="circle"?"primary":"secondary"} onClick={()=>setTool("circle")}>圆框</Button><Button size="mini" type={tool==="free"?"primary":"secondary"} onClick={()=>setTool("free")}>任意形状</Button><Button size="mini" icon={<Undo2 size={14}/>} disabled={!value} onClick={()=>{const c=canvas.current,m=maskCanvas.current;if(c&&m){c.getContext("2d")!.clearRect(0,0,c.width,c.height);const mc=m.getContext("2d")!;mc.globalCompositeOperation="source-over";mc.fillStyle="#000";mc.fillRect(0,0,m.width,m.height);onChange(undefined);}}}>清除</Button></Space></div><div className="mask-painter-canvas"><img src={imageUrl(source)} alt="图生图原图"/><canvas ref={canvas} onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}/><canvas ref={maskCanvas} hidden/></div><p className="helper">拖动绘制选区。红色区域会以透明蒙版提交，支持蒙版的模型可按选区重绘。</p></div>;
}
export function ImageStudio({data,reload,source,initialPrompt="",initialRatio="16:9",onUse,onBusyChange}: {
  data:Snapshot;
  reload:()=>void;
  source?:Media;
  initialPrompt?:string;
  initialRatio?:string;
  onUse?:(media:Media)=>void;
  onBusyChange?:(busy:boolean)=>void;
}) {
  const [mode,setMode]=useState(source?"i2i":"t2i"),[prompt,setPrompt]=useState(initialPrompt),[ratio,setRatio]=useState(initialRatio),[size,setSize]=useState(GENERATION_SIZES.find(g=>g.ratio===initialRatio)?.sizes[0]||"1280x736"),[refs,setRefs]=useState<number[]>(source?[source.id]:[]),[busy,setBusy]=useState(false),[results,setResults]=useState<(Media|null)[]>([]);
  const [count,setCount]=useState(1),[completed,setCompleted]=useState(0),[failures,setFailures]=useState<string[]>([]),[optimizing,setOptimizing]=useState(false),[mask,setMask]=useState<string>(),[assetQuery,setAssetQuery]=useState(""),[assetLimit,setAssetLimit]=useState(24);
  const [poseDraft,setPoseDraft]=useState<Person[]>();
  const [poseOpen,setPoseOpen]=useState(false),[poseMedia,setPoseMedia]=useState<Media[]>([]);
  const availableMedia=[...data.media,...poseMedia.filter(m=>!data.media.some(item=>item.id===m.id))];
  const generating=useRef(false);
  const prompts=[...data.prompts,...STYLE_PRESETS];
  const imageAssets=availableMedia.filter(m=>m.kind==="image").sort((a,b)=>{const byDate=Date.parse(b.created_at)-Date.parse(a.created_at);return Number.isFinite(byDate)&&byDate!==0?byDate:b.id-a.id;});
  const filteredAssets=imageAssets.filter(m=>m.name.toLocaleLowerCase().includes(assetQuery.trim().toLocaleLowerCase()));
  const visibleAssets=filteredAssets.slice(0,assetLimit);
  const paintSource=source||availableMedia.find(m=>m.id===refs[0]);
  useEffect(()=>setAssetLimit(24),[assetQuery]);
  useEffect(()=>setMask(undefined),[paintSource?.id]);
  const expandedPrompt=resolvePromptReferences(prompt,prompts);
  const optimize=async()=>{if(optimizing||!prompt.trim())return;setOptimizing(true);try{const references=mode==="i2i"?[...new Set([...refs,...imageRefs.flatMap(r=>r.media?[r.media.id]:[])])]:[];const result=await post<{prompt:string}>("/prompts/optimize",{project_id:data.project.id,prompt,kind:"image",image_media_ids:references});setPrompt(result.prompt);Message.success("Prompt 已优化");}catch(e){Message.error(String(e));}finally{setOptimizing(false);}};
  const imageRefs=findMentions(expandedPrompt,promptMentions(data.roles,mode==="i2i"?data:undefined));
  const generate=async()=>{
    if(generating.current) return;
    if(!expandedPrompt.trim()) return Message.warning("请填写画面描述");
    const ids=[...new Set([...refs,...imageRefs.flatMap(r=>r.media?[r.media.id]:[])])];
    if(mode==="i2i" && imageRefs.some(r=>!r.media)) return Message.warning("引用的角色或场景尚无图片，请先添加对应图片");
    if(mode==="i2i" && !ids.length) return Message.warning("请选择参考图，或 @ 有图片的角色或场景");
    generating.current=true;
    setBusy(true);
    setResults(Array.from({length:count},()=>null));
    setCompleted(0);
    setFailures([]);
    onBusyChange?.(true);
    const payload={project_id:data.project.id,operation:mode,prompt:mode==="i2i" ? resolveImagePrompt(expandedPrompt,data) : resolvePrompt(expandedPrompt,data.roles),aspect_ratio:ratio,size,image_media_ids:mode==="i2i"?ids:[],mask_data_url:mode==="i2i"?mask:undefined};
    try {
      const outcomes=await Promise.allSettled(Array.from({length:count},async(_,index)=>{
        try {
          const media=await post<Media>("/generations/image",payload);
          setResults(current=>current.map((item,i)=>i===index?media:item));
          return media;
        } catch(e) {
          setFailures(current=>[...current,`第 ${index+1} 张：${String(e)}`]);
          throw e;
        } finally {
          setCompleted(current=>current+1);
        }
      }));
      const succeeded=outcomes.filter(item=>item.status==="fulfilled").length;
      if(succeeded===count) Message.success(`${succeeded} 张图片已保存到资产库`);
      else if(succeeded) Message.warning(`已生成 ${succeeded} 张，${count-succeeded} 张失败`);
      else Message.error("图片生成失败，请查看错误信息");
      if(succeeded) {
        try {await reload();} catch(e) {Message.error(`图片已入库，但刷新资产失败：${String(e)}`);}
      }
    } finally {
      generating.current=false;
      setBusy(false);
      onBusyChange?.(false);
    }
  };
  return <><Suspense fallback={<p role="status">正在加载 3D 姿势编辑器…</p>}>{poseOpen&&<PoseStudio initialPeople={poseDraft} onPeopleChange={setPoseDraft} projectId={data.project.id} size={size} onClose={()=>setPoseOpen(false)} onUse={media=>{setPoseMedia(items=>[...items,media]);setRefs(ids=>[...ids,media.id]);setPoseOpen(false);Promise.resolve().then(reload).catch(e=>Message.error(`截图已保存，但刷新失败：${String(e)}`));}}/>}</Suspense><div className="creation-split"><div className="creation-panel"><h2>描绘你的下一幕</h2><Form layout="vertical" disabled={busy}><Form.Item label="生成方式"><Select value={mode} disabled={!!source} onChange={setMode} options={[{label:"文生图",value:"t2i"},{label:"图生图",value:"i2i"}]}/></Form.Item><Form.Item label="画面描述" required><PromptInput value={prompt} onChange={setPrompt} roles={data.roles} data={mode==="i2i"?data:undefined} prompts={prompts} placeholder="描述画面，输入 @ 引用角色，或 @prompt 引用常用提示词" disabled={busy||optimizing} onOptimize={optimize} optimizing={optimizing}/></Form.Item><p className="helper">输入 @prompt 选择 Prompt 库或预设风格，生成时自动展开，可组合多个引用。文生图引用角色设定；图生图支持 @角色 和 @剧集名.scene001.first / last / ref（首帧 / 尾帧 / 参考图），自动加入参考图片。</p>{mode==="i2i" && <Form.Item label="参考图片"><Button className="pose-entry" onClick={()=>setPoseOpen(true)}>3D 人体 · 摆姿势参考</Button><div className="creation-reference-picker"><Input value={assetQuery} onChange={setAssetQuery} allowClear placeholder="搜索参考图片" prefix={<span aria-hidden="true">⌕</span>} aria-label="搜索参考图片"/><div className="creation-reference-selected" aria-label="已选参考图片">{refs.map(id=>{const m=availableMedia.find(item=>item.id===id);return m?<div className="creation-reference-chip" key={id}><img src={imageUrl(m)} alt={m.name}/><span title={m.name}>{m.name}</span><button type="button" aria-label={`移除 ${m.name}`} onClick={()=>setRefs(current=>current.filter(x=>x!==id))}>×</button></div>:null})}{!refs.length&&<span className="helper">尚未选择参考图</span>}</div><div className="creation-asset-picker" onScroll={e=>{const el=e.currentTarget;if(el.scrollTop+el.clientHeight>=el.scrollHeight-40)setAssetLimit(n=>Math.min(n+24,filteredAssets.length));}}>{visibleAssets.map(m=><button type="button" key={m.id} className={`creation-asset-option${refs.includes(m.id)?" selected":""}`} aria-pressed={refs.includes(m.id)} title={m.name} onClick={()=>setRefs(current=>current.includes(m.id)?current.filter(id=>id!==m.id):[...current,m.id])}><img src={imageUrl(m)} alt="" loading="lazy"/><span>{m.name||`图片 ${m.id}`}</span></button>)}{!imageAssets.length&&<p className="helper">资产库中还没有图片</p>}{imageAssets.length>0&&!filteredAssets.length&&<p className="helper">没有匹配的图片</p>}{visibleAssets.length<filteredAssets.length&&<p className="helper creation-load-more">继续滚动加载更多 · 已显示 {visibleAssets.length} / {filteredAssets.length}</p>}</div></div>{paintSource&&<MaskPainter key={paintSource.id} source={paintSource} value={mask} onChange={setMask}/>}<div className="reference-strip">{imageRefs.map(r=>r.media&&!refs.includes(r.media.id)?<img key={r.id} src={imageUrl(r.media)} title={`@${r.name}`} alt={r.name}/>:!r.media?<Tag color="red" key={r.id}>{r.name} 缺少图片</Tag>:null)}</div></Form.Item>}<Form.Item label="画幅"><Select value={ratio} onChange={v=>{setRatio(v);setSize(GENERATION_SIZES.find(g=>g.ratio===v)?.sizes[0]||"1152x640");}} options={GENERATION_SIZES.map(g=>({label:g.label,value:g.ratio}))}/></Form.Item><Form.Item label="输出尺寸"><Select value={size} onChange={setSize} options={GENERATION_SIZES.find(g=>g.ratio===ratio)?.sizes.map(value=>({label:value,value}))||[]}/></Form.Item><Form.Item label="生成数量"><Select aria-label="生成数量" value={count} onChange={setCount} options={[1,2,3,4].map(value=>({label:`${value} 张`,value}))}/></Form.Item><Button type="primary" long loading={busy} onClick={generate} icon={<ImagePlus size={16}/>}>{busy?`生成中 ${completed} / ${count}`:`生成 ${count} 张图片`}</Button></Form></div><div className="creation-panel image-result">{results.some(Boolean)?<div className={`image-results-grid${results.length===1?" single":""}`}>{results.map((result,index)=>result&&<article className="image-result-card" key={`${index}-${result.id}`}><img src={imageUrl(result)} alt={result.name}/><p>第 {index+1} 张 · {result.name} · 已入库</p>{onUse&&<Button type="primary" disabled={busy} onClick={()=>onUse(result)}>使用第 {index+1} 张替换原图</Button>}</article>)}</div>:<Empty description={busy?"正在生成图片，请稍候":failures.length?"本次未生成图片，请重试":"生成结果将在这里展示，并自动进入资产库"}/>}<div role="status" aria-live="polite">{busy&&<p className="helper">已完成 {completed} / {count} 张</p>}</div>{failures.length>0&&<div className="image-generation-errors" role="alert">{failures.map(error=><p key={error}>{error}</p>)}</div>}{source&&<><p className="helper">原图 · {source.name}</p><img src={imageUrl(source)} alt={`原图：${source.name}`} style={{maxHeight:180}}/><p className="helper">满意后点击「替换原图」，再保存场景。原图仍保留在资产库。</p></>}<p className="helper">生成任务可在「后台任务」中查看进度与错误信息。</p></div></div></>;
}
export function SequencePreview({scenes}: {scenes:Scene[]}) {
  const [index,setIndex]=useState(0),[playing,setPlaying]=useState(false);
  const player=useRef<HTMLVideoElement>(null);
  const signature=scenes.map(s=>`${s.id}:${s.video_media_id}`).join(",");
  useEffect(()=>{setIndex(0);setPlaying(false);},[signature]);
  const missing=scenes.filter(s=>!s.video_media).length;
  if(!scenes.length) return <Empty description="添加场景后开始编排"/>;
  if(missing) return <Empty description={`还有 ${missing} 个场景未选择视频，请在下方选择`}/>;
  return <div className="sequence-player"><video ref={player} key={`${signature}:${index}`} src={imageUrl(scenes[index]?.video_media)} controls autoPlay={playing} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onEnded={()=>{if(index<scenes.length-1){setPlaying(true);setIndex(index+1);}else{setPlaying(false);}}} onError={()=>Message.error("视频无法播放，请检查文件或更换版本")}/><div><span>即时串播 · {index+1} / {scenes.length} · {scenes[index]?.title}</span><Button size="mini" onClick={()=>{setIndex(0);setPlaying(true);if(player.current){player.current.currentTime=0;void player.current.play().catch(()=>Message.warning("请点击播放器开始播放"));}}}>从头播放</Button></div></div>;
}
type ScriptScene={id:string;description:string;first:string;last:string;reference:string};
type ScriptDraft={title:string;scenes:ScriptScene[]};
const blankScene=():ScriptScene=>({id:crypto.randomUUID(),description:"",first:"",last:"",reference:""});
function ScriptStudio({data,reload,onCreated}: {data:Snapshot;reload:()=>void;onCreated:()=>void}) {
  const [draft,setDraft]=useState<ScriptDraft>({title:"",scenes:[blankScene()]}),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[status,setStatus]=useState("正在读取草稿");
  const latest=useRef(draft);latest.current=draft;
  const saveQueue=useRef<Promise<unknown>>(Promise.resolve());
  const [loadAttempt,setLoadAttempt]=useState(0);
  useEffect(()=>{let disposed=false;setStatus("正在读取草稿");post<ScriptDraft|null>("/scripts/load",{project_id:data.project.id}).then(saved=>{if(!disposed){if(saved)setDraft(saved);setLoaded(true);setStatus("草稿已读取");}}).catch(e=>{if(!disposed)setStatus(`读取失败：${String(e)}`);});return()=>{disposed=true;};},[data.project.id,loadAttempt]);
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
  return <div className="script-studio"><div className="script-toolbar"><div><h2>先写故事，再制作镜头</h2><p className="helper">草稿自动保存。确认后创建剧集与场景，帧描述保留为图片生成提示词。</p></div><Space><Tag><span role="status" aria-live="polite">{status}</span></Tag>{!loaded&&status.startsWith("读取失败")&&<Button onClick={()=>setLoadAttempt(n=>n+1)}>重试读取</Button>}<Button disabled={!loaded} loading={busy} onClick={saveDraft}>保存草稿</Button><Button type="primary" disabled={!loaded} loading={busy} onClick={publish}>确定脚本，创建剧集</Button></Space></div><fieldset disabled={!loaded||busy}><Form layout="vertical"><Form.Item label="剧集标题" required><Input value={draft.title} onChange={title=>update({...draft,title})} placeholder="为这一集命名"/></Form.Item>{draft.scenes.map((scene,i)=><article className="script-scene" key={scene.id}><div className="script-scene-head"><b>SCENE {String(i+1).padStart(3,"0")}</b><Space><Button aria-label="上移场景" size="mini" disabled={!i||busy} onClick={()=>move(i,-1)} icon={<ArrowUp size={14}/>}/><Button aria-label="下移场景" size="mini" disabled={i===draft.scenes.length-1||busy} onClick={()=>move(i,1)} icon={<ArrowDown size={14}/>}/><Button size="mini" onClick={()=>update({...draft,scenes:[...draft.scenes,{...scene,id:crypto.randomUUID()}]})}>复制</Button><Popconfirm title="删除此脚本场景？" onOk={()=>update({...draft,scenes:draft.scenes.filter(s=>s.id!==scene.id)})}><Button aria-label="删除脚本场景" size="mini" status="danger" icon={<Trash2 size={14}/>}/></Popconfirm></Space></div><Form.Item label="场景描述" required><PromptInput value={scene.description} onChange={v=>patch(scene.id,"description",v)} roles={data.roles} placeholder="描述场景中的动作、环境和镜头运动（必填）"/></Form.Item><div className="script-frames">{([['first','首帧描述'],['last','尾帧描述'],['reference','参考图描述']] as const).map(([key,label])=><Form.Item key={key} label={`${label} · 选填`}><PromptInput value={scene[key]} onChange={v=>patch(scene.id,key,v)} roles={data.roles}/></Form.Item>)}</div></article>)}<Button long disabled={!loaded||busy} icon={<Plus size={16}/>} onClick={()=>update({...draft,scenes:[...draft.scenes,blankScene()]})}>添加场景</Button></Form></fieldset></div>;
}
