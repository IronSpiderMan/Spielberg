import { AssetAssignmentModal } from "./components/AssetAssignmentModal";
import { ImagePreviewModal } from "./components/ImagePreviewModal";
import { GenerationModeTabs, MediaSizeFields } from "./components/generation/GenerationFields";
import { ReferenceImagePicker } from "./components/generation/ReferenceImagePicker";
import { useImageUpload } from "./hooks/useImageUpload";
import { usePromptOptimization } from "./hooks/usePromptOptimization";
import { VideoStudio } from "./VideoStudio";
import { localId } from "./id";
import { Button,Empty,Form,Input,Message,Popconfirm,Select,Space,Tabs,Tag } from "@arco-design/web-react";
import { ArrowDown,ArrowUp,ImagePlus,Plus,Trash2,Undo2 } from "lucide-react";
import React,{ lazy,Suspense,useEffect,useRef,useState } from "react";
import { defaultGenerationSize, Media,Scene,Snapshot,imageUrl,post } from "./core";
import { findMentions,promptMentions,resolvePromptReferences } from "./prompt-mentions";
import { PromptInput } from "./PromptInput";
import { STYLE_PRESETS } from "./prompt-presets";
import { PROMPT_TEMPLATES } from "./prompt-templates";

import { resolvePrompt, resolveReferencePrompt } from "./resolve-prompt";
import type { Person } from "./PoseStudio";
const PoseStudio=lazy(()=>import("./PoseStudio"));
export function CreationDesk({data,reload,renderSequence,changePage,activeTab,onTabChange,imageSource,onImageUse,initialPrompt,initialRatio}: {data:Snapshot;reload:()=>void;renderSequence:()=>React.ReactNode;changePage:(v:string)=>void;editScene:(s:Scene)=>void;activeTab:string;onTabChange:(tab:string)=>void;imageSource?:Media;onImageUse?:(media:Media)=>void;initialPrompt?:string;initialRatio?:string}) {
  return <section className={`creation-desk${(activeTab==="images"||activeTab==="videos")?" images-active":activeTab==="sequence"?" sequence-active":""}`}><div className="section-title page-actions"><div className="page-intro"><h1>工作台</h1><p>生成图片与视频，编排剧集和脚本。</p></div></div><Tabs activeTab={activeTab} onChange={onTabChange} destroyOnHide={false}><Tabs.TabPane key="images" title="图片生成"><ImageStudio key={imageSource?.id||"default"} data={data} reload={reload} source={imageSource} onUse={onImageUse} initialPrompt={initialPrompt} initialRatio={initialRatio}/></Tabs.TabPane><Tabs.TabPane key="videos" title="视频生成"><VideoStudio key={data.project.id} data={data} reload={reload}/></Tabs.TabPane><Tabs.TabPane key="sequence" title="剧集编排">{renderSequence()}</Tabs.TabPane><Tabs.TabPane key="script" title="脚本编排"><ScriptStudio key={data.project.id} data={data} reload={reload} onCreated={()=>changePage("episodes")}/></Tabs.TabPane></Tabs></section>;
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
export function ImageStudio({data,reload,source,initialPrompt="",initialRatio="16:9",onUse,onBusyChange,compact=false}: {
  data:Snapshot;
  reload:()=>void;
  source?:Media;
  initialPrompt?:string;
  initialRatio?:string;
  onUse?:(media:Media)=>void;
  onBusyChange?:(busy:boolean)=>void;
  compact?:boolean;
}) {
  const [mode,setMode]=useState(source?"i2i":"t2i"),[prompt,setPrompt]=useState(initialPrompt),[ratio,setRatio]=useState(initialRatio),[size,setSize]=useState(defaultGenerationSize(initialRatio)),[refs,setRefs]=useState<number[]>(source?[source.id]:[]),[busy,setBusy]=useState(false),[results,setResults]=useState<(Media|null)[]>([]);
  const [count,setCount]=useState(1),[completed,setCompleted]=useState(0),[failures,setFailures]=useState<string[]>([]),[mask,setMask]=useState<string>();
  const [poseDraft,setPoseDraft]=useState<Person[]>();
  const [assignResult,setAssignResult]=useState<Media|null>(null);
  const [poseOpen,setPoseOpen]=useState(false),[poseMedia,setPoseMedia]=useState<Media[]>([]);
  const { uploading, inProgress: uploadInProgress, uploadImages } = useImageUpload({projectId:data.project.id,reload,refreshError:"图片已保存，但刷新资产失败"});
  const { optimizing, optimize: optimizePrompt } = usePromptOptimization();
  const [assetPreview,setAssetPreview]=useState<Media|null>(null);
  const availableMedia=[...data.media,...poseMedia.filter(m=>!data.media.some(item=>item.id===m.id))];
  const pasteImages=async(files:File[])=>{
    if(uploadInProgress.current||generating.current)return;
    await uploadImages(files, {pasted:true,onUploaded:media=>{
      setPoseMedia(items=>[...items,media]);
      setRefs(ids=>[...new Set([...ids,media.id])]);setMode("i2i");
    },onComplete:count=>Message.success(`${count} 张图片已入库，并选为参考图`)});
  };
  const generating=useRef(false);
  const prompts=[...data.prompts,...STYLE_PRESETS];
  const templates=[...PROMPT_TEMPLATES,...data.prompts];
  const paintSource=source||availableMedia.find(m=>m.id===refs[0]);
  useEffect(()=>setMask(undefined),[paintSource?.id]);
  const expandedPrompt=resolvePromptReferences(prompt,prompts);
  const optimize=()=>optimizePrompt({projectId:data.project.id,prompt,kind:"image",imageIds:mode==="i2i"?[...refs,...imageRefs.flatMap(r=>r.media?[r.media.id]:[])]:[],onOptimized:setPrompt});
  const imageRefs=findMentions(expandedPrompt,promptMentions(data.roles,mode==="i2i"?data:undefined));
  const generate=async()=>{
    if(generating.current||uploadInProgress.current) return;
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
    const payload={project_id:data.project.id,operation:mode,prompt:mode==="i2i" ? resolveReferencePrompt(expandedPrompt,data) : resolvePrompt(expandedPrompt,data.roles),aspect_ratio:ratio,size,image_media_ids:mode==="i2i"?ids:[],mask_data_url:mode==="i2i"?mask:undefined};
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
  return <><Suspense fallback={<p role="status">正在加载 3D 姿势编辑器…</p>}>{poseOpen&&<PoseStudio initialPeople={poseDraft} onPeopleChange={setPoseDraft} projectId={data.project.id} size={size} onClose={()=>setPoseOpen(false)} onUse={media=>{setPoseMedia(items=>[...items,media]);setRefs(ids=>[...ids,media.id]);setPoseOpen(false);Promise.resolve().then(reload).catch(e=>Message.error(`截图已保存，但刷新失败：${String(e)}`));}}/>}</Suspense><div className="creation-split image-creation-split"><div className="creation-panel">{!compact&&<div className="generation-panel-heading"><h2>图片生成</h2></div>}<GenerationModeTabs value={mode} onChange={setMode} disabled={busy} modes={[{value:"t2i",label:"文生图",disabled:!!source},{value:"i2i",label:"图生图"}]}/><Form layout="vertical" disabled={busy}><Form.Item label="画面描述" required><PromptInput value={prompt} onChange={setPrompt} roles={data.roles} data={mode==="i2i"?data:undefined} prompts={prompts} templates={templates} placeholder={mode==="i2i"?"描述画面，输入 @ 引用角色、@prompt 常用提示词、@template 选择模板；也可用 @角色.图片名 或 @剧集名.scene001.first / last / ref 自动添加参考图":"描述画面，输入 @ 引用角色、@prompt 常用提示词，或 @template 选择模板"} disabled={busy||optimizing||uploading} onPasteImages={files=>void pasteImages(files)} onOptimize={optimize} optimizing={optimizing}/><p className="helper" role="status">{uploading?"正在上传粘贴的图片…":"可直接粘贴图片，自动存入资产库并选为图生图参考图"}</p></Form.Item>{mode==="i2i" && <Form.Item label="参考图片"><Button className="pose-entry" onClick={()=>setPoseOpen(true)}>3D 人体 · 摆姿势参考</Button><ReferenceImagePicker media={availableMedia} value={refs} onChange={setRefs} disabled={busy||uploading} onPreview={setAssetPreview}/>{paintSource&&<MaskPainter key={paintSource.id} source={paintSource} value={mask} onChange={setMask}/>}<div className="reference-strip">{imageRefs.map(r=>r.media&&!refs.includes(r.media.id)?<button type="button" className="reference-preview-button" key={r.id} title={`放大查看 @${r.name}`} aria-label={`放大查看 @${r.name}`} onClick={()=>setAssetPreview(r.media!)}><img src={imageUrl(r.media)} alt={r.name}/></button>:!r.media?<Tag color="red" key={r.id}>{r.name} 缺少图片</Tag>:null)}</div></Form.Item>}<div className="image-generation-options"><MediaSizeFields ratio={ratio} size={size} onChange={value=>{setRatio(value.ratio);setSize(value.size);}}/><Form.Item label="生成数量"><Select aria-label="生成数量" value={count} onChange={setCount} options={[1,2,3,4].map(value=>({label:`${value} 张`,value}))}/></Form.Item></div></Form><Button className="generation-submit" type="primary" long loading={busy} disabled={uploading} onClick={generate} icon={<ImagePlus size={16}/>}>{busy?`生成中 ${completed} / ${count}`:`生成 ${count} 张图片`}</Button></div><div className="creation-panel image-result" aria-busy={busy}>{(!compact||busy)&&<div className="generation-preview-heading">{!compact&&<h2>生成预览</h2>}<span className={`generation-state${busy?" is-busy":results.some(Boolean)?" is-ready":""}`}>{busy?"生成中":results.some(Boolean)?"已完成":"等待创作"}</span></div>}<div className="generation-preview-body">{results.some(Boolean)?<div className={`image-results-grid${results.length===1?" single":""}`}>{results.map((result,index)=>result&&<article className="image-result-card" key={`${index}-${result.id}`}><img src={imageUrl(result)} alt={result.name}/><p>第 {index+1} 张 · {result.name} · 已入库</p><div className="image-result-actions"><Button size="small" disabled={busy} onClick={()=>setAssignResult(result)}>设置用途</Button>{onUse&&<Button type="primary" disabled={busy} onClick={()=>onUse(result)}>使用第 {index+1} 张图片</Button>}</div></article>)}</div>:<Empty icon={compact?null:<ImagePlus size={28}/>} description={<><b>{busy?"画面正在生成":failures.length?"本次未生成图片":(compact?"生成的图片将显示在这里":"让想象在这里成像")}</b>{(!compact||busy||failures.length>0)&&<p>{busy?"稍候片刻，完成的图片将依次展示":failures.length?"调整描述或参数后再试一次":"在左侧描述画面，生成的图片将自动存入资产库"}</p>}</>}/>}<div role="status" aria-live="polite">{busy&&<p className="helper">已完成 {completed} / {count} 张</p>}</div>{failures.length>0&&<div className="image-generation-errors" role="alert">{failures.map(error=><p key={error}>{error}</p>)}</div>}{source&&<><p className="helper">原图 · {source.name}</p><img src={imageUrl(source)} alt={`原图：${source.name}`} style={{maxHeight:180}}/><p className="helper">满意后点击「替换原图」，再保存场景。原图仍保留在资产库。</p></>}</div>{!compact&&<p className="helper generation-result-note">生成任务可在「后台任务」中查看进度与错误信息。</p>}</div></div>{assignResult&&<AssetAssignmentModal key={assignResult.id} media={assignResult} data={data} reload={reload} onClose={()=>setAssignResult(null)} title="设置生成图片用途" usageLabel="设置为" successMessage="图片用途已更新"/>}<ImagePreviewModal media={assetPreview} onClose={()=>setAssetPreview(null)}/></>;
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
type ScriptScene={id:string;scene_id?:number;title?:string;mode:"fl2v"|"i2v";description:string;first:string;last:string;reference:string;references:string[]};
type ScriptDraft={title:string;scenes:ScriptScene[]};
const blankScene=():ScriptScene=>({id:localId(),mode:"fl2v",description:"",first:"",last:"",reference:"",references:[""]});
const referenceDescriptions=(script?:{reference?:string;references?:string[]}):string[]=>script?.references??[script?.reference||""];
const referenceLabel=(index:number)=>`图${["一","二","三","四","五","六","七","八","九","十"][index]||index+1}`;
const episodeDraft=(episode:Snapshot["episodes"][number]):ScriptDraft=>({title:episode.title,scenes:episode.scenes.length?episode.scenes.map(scene=>({id:localId(),scene_id:scene.id,title:scene.title,mode:scene.generation_options?.video_mode||((scene.generation_options?.reference_media_ids?.length||scene.reference_media_id||scene.script?.reference)?"i2v":"fl2v"),description:scene.description,first:scene.script?.first||"",last:scene.script?.last||"",reference:scene.script?.reference||"",references:referenceDescriptions(scene.script)})):[blankScene()]});
function ScriptStudio({data,reload,onCreated}: {data:Snapshot;reload:()=>void;onCreated:()=>void}) {
  const [draft,setDraft]=useState<ScriptDraft>({title:"",scenes:[blankScene()]}),[episodeId,setEpisodeId]=useState<number>(),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[status,setStatus]=useState("正在读取草稿");
  const latest=useRef(draft);latest.current=draft;
  const saveQueue=useRef<Promise<unknown>>(Promise.resolve());
  const loadVersion=useRef(0);
  const [loadAttempt,setLoadAttempt]=useState(0);
  useEffect(()=>{
    let disposed=false;const version=++loadVersion.current;
    setLoaded(false);setStatus("正在读取草稿");
    saveQueue.current.catch(()=>{}).then(()=>post<ScriptDraft|null>("/scripts/load",{project_id:data.project.id,episode_id:episodeId})).then(saved=>{
      if(disposed||version!==loadVersion.current)return;
      const episode=data.episodes.find(item=>item.id===episodeId);
      if(episodeId!==undefined&&!episode)throw new Error("剧集不存在，请重新选择");
      const next=saved?{...saved,scenes:saved.scenes.map(scene=>({...scene,references:referenceDescriptions(scene),mode:scene.mode||((scene.reference||scene.references?.some(Boolean))?"i2v":"fl2v")}))}:episode?episodeDraft(episode):{title:"",scenes:[blankScene()]};
      latest.current=next;setDraft(next);setLoaded(true);setStatus(saved?"草稿已读取":episode?"剧集已加载":"新建脚本");
    }).catch(e=>{if(!disposed)setStatus(`读取失败：${String(e)}`);});
    return()=>{disposed=true;};
  },[data.project.id,episodeId,loadAttempt]);
  const persist=(current:ScriptDraft)=>{
    const version=loadVersion.current;
    setStatus("正在保存草稿");
    const request=saveQueue.current.catch(()=>{}).then(()=>post("/scripts/save",{project_id:data.project.id,episode_id:episodeId,draft:current}));
    saveQueue.current=request;
    return request.then(()=>{if(version===loadVersion.current&&latest.current===current)setStatus("草稿已保存");}).catch(e=>{if(version===loadVersion.current)setStatus("保存失败，请重试");throw e;});
  };
  const update=(next:ScriptDraft)=>{latest.current=next;setDraft(next);void persist(next).catch(()=>{});};
  const switchEpisode=async(value:string|number)=>{
    const next=value==="new"?undefined:Number(value);
    if(next===episodeId)return;
    setBusy(true);
    try{
      if(loaded)await persist(latest.current);
      setLoaded(false);setEpisodeId(next);
    }catch(e){Message.error(`切换前保存草稿失败：${String(e)}`);}finally{setBusy(false);}
  };
  const saveDraft=async()=>{setBusy(true);try{await persist(latest.current);}catch(e){Message.error(String(e));}finally{setBusy(false);}};
  const patch=(id:string,key:keyof ScriptScene,value:string)=>update({...draft,scenes:draft.scenes.map(s=>s.id===id?{...s,[key]:value}:s)});
  const patchReferences=(id:string,references:string[])=>update({...draft,scenes:draft.scenes.map(scene=>scene.id===id?{...scene,references,reference:references[0]||""}:scene)});
  const move=(i:number,d:number)=>{const scenes=[...draft.scenes];[scenes[i],scenes[i+d]]=[scenes[i+d],scenes[i]];update({...draft,scenes});};
  const publish=async()=>{
    if(!draft.title.trim()||!draft.scenes.length||draft.scenes.some(s=>!s.description.trim()))return Message.warning("请填写剧集标题及每个场景的描述");
    setBusy(true);
    try{
      await saveQueue.current.catch(()=>{});
      const result=await post<{draft?:ScriptDraft}>("/scripts/publish",{project_id:data.project.id,episode_id:episodeId,draft});
      if(result.draft){latest.current=result.draft;setDraft(result.draft);}
      setStatus(episodeId===undefined?"剧集已创建":"修改已保存");
      Message.success(episodeId===undefined?"已根据脚本创建剧集，可继续生成图片与视频":"剧集脚本已更新");
      await reload();onCreated();
    }catch(e){Message.error(String(e));}finally{setBusy(false);}
  };
  return <div className="script-studio">
    <div className="script-toolbar"><div><h2>先写故事，再制作镜头</h2><p className="helper">草稿自动保存。选择已有剧集可继续编辑，确认后保存到剧集。</p></div><Space><Tag><span role="status" aria-live="polite">{status}</span></Tag>{!loaded&&status.startsWith("读取失败")&&<Button onClick={()=>setLoadAttempt(n=>n+1)}>重试读取</Button>}<Button disabled={!loaded} loading={busy} onClick={saveDraft}>保存草稿</Button><Button type="primary" disabled={!loaded} loading={busy} onClick={publish}>{episodeId===undefined?"确定脚本，创建剧集":"保存修改到剧集"}</Button></Space></div>
    <Form layout="vertical" className="script-episode-picker"><Form.Item label="编辑剧集"><Select aria-label="选择编辑剧集" showSearch disabled={busy||(!loaded&&!status.startsWith("读取失败"))} value={episodeId??"new"} onChange={value=>void switchEpisode(value)} options={[{value:"new",label:"＋ 新建剧集"},...data.episodes.map(episode=>({value:episode.id,label:episode.title}))]}/><p className="helper">{episodeId===undefined?"创建新的剧集脚本。":"修改原剧集的标题、场景和帧描述；保留已有场景的图片与视频。"}</p></Form.Item></Form>
    <fieldset disabled={!loaded||busy}><Form layout="vertical" disabled={!loaded||busy}><Form.Item label="剧集标题" required><Input value={draft.title} onChange={title=>update({...draft,title})} placeholder="为这一集命名"/></Form.Item>
    {draft.scenes.map((scene,i)=><article className="script-scene" key={scene.id}>
      <div className="script-scene-head"><b>SCENE {String(i+1).padStart(3,"0")}</b><Space><Button aria-label="上移场景" size="mini" disabled={!i||busy} onClick={()=>move(i,-1)} icon={<ArrowUp size={14}/>}/><Button aria-label="下移场景" size="mini" disabled={i===draft.scenes.length-1||busy} onClick={()=>move(i,1)} icon={<ArrowDown size={14}/>}/><Button size="mini" onClick={()=>update({...draft,scenes:[...draft.scenes,{...scene,id:localId(),scene_id:undefined,title:undefined}]})}>复制</Button><Popconfirm title="删除此脚本场景？" content={scene.scene_id?"保存修改后，该场景会从剧集中移除，素材文件仍保留在资产库。":undefined} onOk={()=>update({...draft,scenes:draft.scenes.filter(s=>s.id!==scene.id)})}><Button aria-label="删除脚本场景" size="mini" status="danger" icon={<Trash2 size={14}/>}/></Popconfirm></Space></div>
      <Form.Item label="场景描述" required><PromptInput disabled={!loaded||busy} value={scene.description} onChange={v=>patch(scene.id,"description",v)} roles={data.roles} placeholder="描述场景中的动作、环境和镜头运动（必填）"/></Form.Item>
      <Tabs className="script-mode-tabs" activeTab={scene.mode} onChange={mode=>patch(scene.id,"mode",mode)}>
        <Tabs.TabPane key="fl2v" title="首尾帧" disabled={!loaded||busy}><div className="script-frames script-frames-pair">{([['first','首帧描述'],['last','尾帧描述']] as const).map(([key,label])=><Form.Item key={key} label={`${label} · 选填`}><PromptInput disabled={!loaded||busy} value={scene[key]} onChange={v=>patch(scene.id,key,v)} roles={data.roles}/></Form.Item>)}</div></Tabs.TabPane>
        <Tabs.TabPane key="i2v" title="全能参考" disabled={!loaded||busy}><div className="script-frames script-frames-reference">
          {scene.references.map((value,index)=><div className="script-reference-description" key={index}><div className="script-reference-description-head"><b>{referenceLabel(index)}的描述 · 选填</b><Button aria-label={`删除${referenceLabel(index)}描述`} size="mini" disabled={!loaded||busy} icon={<Trash2 size={14}/>} onClick={()=>patchReferences(scene.id,scene.references.filter((_,i)=>i!==index))}/></div><PromptInput disabled={!loaded||busy} value={value} onChange={v=>patchReferences(scene.id,scene.references.map((text,i)=>i===index?v:text))} roles={data.roles} placeholder={`描述${referenceLabel(index)}的画面，输入 @ 引用角色`}/></div>)}
          <Button className="script-reference-add" long disabled={!loaded||busy} icon={<Plus size={16}/>} onClick={()=>patchReferences(scene.id,[...scene.references,""])}>添加{referenceLabel(scene.references.length)}描述</Button>
        </div></Tabs.TabPane>
      </Tabs>
    </article>)}
    <Button long disabled={!loaded||busy} icon={<Plus size={16}/>} onClick={()=>update({...draft,scenes:[...draft.scenes,blankScene()]})}>添加场景</Button></Form></fieldset>
  </div>;
}
