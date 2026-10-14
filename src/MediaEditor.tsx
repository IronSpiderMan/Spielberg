import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, Input, Message } from "@arco-design/web-react";
import { Download, Plus, Scissors, Trash2, ArrowLeft, ArrowRight, Music, Film, Play, Pause, Undo2, Redo2 } from "lucide-react";
import { Media, Snapshot, fileUrl, post } from "./core";
import { uploadAsset } from "./api";
import { download } from "./transport";
import AssetThumbnail from "./AssetThumbnail";
import "./media-editor.css";
type Clip = { source?: string; id: string; media_id: number; name: string; path: string; kind: string; duration: number; start: number; end: number; speed: number; volume: number; track?: "audio"; at?: number; detached?: boolean };
const length = (c: Clip) => (c.end-c.start)/c.speed;
const time = (n: number) => `${Math.floor(n/60).toString().padStart(2,"0")}:${(n%60).toFixed(2).padStart(5,"0")}`;
function MediaPlayback({clip,local,playing,video=false,onError}:{clip:Clip;local:number;playing:boolean;video?:boolean;onError:()=>void}) {
  const ref=useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const starting=useRef(false);
  const lastCorrection=useRef(0);
  const sync=()=>{
    const p=ref.current;if(!p)return;
    p.volume=clip.detached?0:clip.volume;p.playbackRate=clip.speed;
    // The video is the playback clock. Never chase a wall clock by seeking it.
    // Detached audio only corrects substantial drift, at most once per second.
    const now=performance.now();
    const correctAudio=!video&&playing&&!p.seeking&&now-lastCorrection.current>1000&&Math.abs(p.currentTime-local)>0.35;
    if(p.readyState>=1&&(!playing&&Math.abs(p.currentTime-local)>0.015||correctAudio)){p.currentTime=local;lastCorrection.current=now;}
    if(playing&&p.paused&&!starting.current){starting.current=true;p.play().catch(onError).finally(()=>{starting.current=false;});}
    else if(!playing)p.pause();
  };
  const loaded=()=>{const p=ref.current;if(p){p.currentTime=local;lastCorrection.current=performance.now();}sync();};
  useEffect(sync,[local,playing,clip]);
  useEffect(()=>()=>{ref.current?.pause();},[]);
  return video?<video ref={ref} src={fileUrl(clip.path)} playsInline preload="auto" data-editor-clock="true" onLoadedMetadata={loaded} onError={onError}/>:<audio ref={ref} src={fileUrl(clip.path)} preload="auto" onLoadedMetadata={loaded} onError={onError}/>;
}
type EditProject = {id:string;name:string;draft:{clips:Clip[];format?:string;ratio?:string;episodeId?:string};status:string;outputs:Media[];updated_at:string};
export default function MediaEditor({data,reload}:{data:Snapshot;reload:()=>Promise<void>}) {
  const [projects,setProjects]=useState<EditProject[]>([]),[current,setCurrent]=useState<EditProject|null>(null),[loading,setLoading]=useState(true);
  const [title,setTitle]=useState("");
  const refresh=useCallback(async()=>{const items=await post<EditProject[]>("/editor/projects",{project_id:data.project.id});setProjects(items);return items;},[data.project.id]);
  useEffect(()=>{let alive=true;refresh().catch(e=>Message.error(String(e))).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};},[refresh]);
  const create=async()=>{setLoading(true);try{
    const item:EditProject={id:crypto.randomUUID(),name:title.trim()||`剪辑项目 ${projects.length+1}`,draft:{clips:[],format:"mp4",ratio:"16:9",episodeId:"all"},status:"draft",outputs:[],updated_at:""};
    // Migrate the old browser draft once; never copy media files.
    const legacyKey=`spielberg-editor-${data.project.id}`;
    if(!projects.length){try{const old=JSON.parse(localStorage.getItem(legacyKey)||"[]");if(Array.isArray(old))item.draft.clips=old;}catch{}}
    await post("/editor/save",{project_id:data.project.id,...item});
    if(!projects.length)localStorage.removeItem(legacyKey);await refresh();setCurrent(item);setTitle("");
  }catch(e){Message.error(String(e));}finally{setLoading(false);}};
  if(current)return <EditWorkspace key={current.id} data={data} reload={reload} project={current} back={async()=>{await refresh();setCurrent(null);}}/>;
  return <div className="media-editor"><header className="me-header"><div><h2><Scissors size={23}/> 剪辑项目</h2><p>每个项目独立保存时间线、素材来源和产出 · 复用项目素材，不复制源文件</p></div><div className="me-actions"><Input aria-label="新剪辑项目名称" placeholder="剪辑项目名称" value={title} onChange={setTitle}/><Button type="primary" loading={loading} icon={<Plus size={16}/>} onClick={create}>创建剪辑项目</Button></div></header>
    {!loading&&!projects.length&&<div className="me-empty">创建一个剪辑项目，开始组织素材和剪辑作品。已有浏览器草稿将在首次创建时迁移。</div>}
    <div className="me-projects">{projects.map(p=><button className="me-project-card" key={p.id} onClick={()=>setCurrent(p)}><strong>{p.name}</strong><span>{p.status==="exported"?"已导出":p.status==="rendering"?"导出中":p.status==="failed"?"导出失败":"剪辑草稿"} · {p.draft.clips.length} 个片段 · {new Set(p.draft.clips.map(c=>c.media_id)).size} 个来源素材</span><span>{p.outputs.length} 个产出 · 更新于 {new Date(Number(p.updated_at)*1000).toLocaleString()}</span></button>)}</div></div>;
}
function EditWorkspace({data,reload,project,back}:{data:Snapshot;reload:()=>Promise<void>;project:EditProject;back:()=>Promise<void>}) {
  const [clips,setClips]=useState<Clip[]>(()=>project.draft.clips.map(c=>({...c,...(data.media.find(m=>m.id===c.media_id)||{}) ,id:c.id})));
  const [selected,setSelected]=useState(clips[0]?.id||"");
  const [past,setPast]=useState<Clip[][]>([]),[future,setFuture]=useState<Clip[][]>([]);
  const [busy,setBusy]=useState(false),[exporting,setExporting]=useState(false),[playing,setPlaying]=useState(false);
  const [cursor,setCursor]=useState(0),[format,setFormat]=useState(project.draft.format||"mp4"),[ratio,setRatio]=useState(project.draft.ratio||"16:9"),[name,setName]=useState(project.name),[result,setResult]=useState<Media|null>(null);
  const [storageError,setStorageError]=useState(false),[zoom,setZoom]=useState(100);
  const timeline=useRef<HTMLElement>(null);
  const trackScroll=useRef<HTMLDivElement>(null);
  const zoomValue=useRef(100);
  const zoomAnchor=useRef<{time:number;x:number}|null>(null);
  const changeZoom=useCallback((value:number,clientX?:number)=>{
    const scroller=trackScroll.current;
    const next=Math.max(50,Math.min(300,value));
    if(scroller){
      const x=clientX===undefined?scroller.clientWidth/2:Math.max(86,Math.min(scroller.clientWidth,clientX-scroller.getBoundingClientRect().left));
      zoomAnchor.current={time:(scroller.scrollLeft+x-86)/(40*zoomValue.current/100),x};
    }
    zoomValue.current=next;
    setZoom(next);
  },[]);
  useLayoutEffect(()=>{
    const anchor=zoomAnchor.current;
    if(anchor&&trackScroll.current)trackScroll.current.scrollLeft=anchor.time*40*zoom/100+86-anchor.x;
    zoomAnchor.current=null;
  },[zoom]);
  useEffect(()=>{
    const node=timeline.current;if(!node)return;
    let gestureStart=100,gesturing=false;
    const wheel=(event:WheelEvent)=>{
      if(!event.ctrlKey&&!event.metaKey)return;
      event.preventDefault();
      if(gesturing)return;
      const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?node.clientHeight:1);
      changeZoom(zoomValue.current*Math.exp(-delta*0.01),event.clientX);
    };
    // WKWebView/Safari sends native gesture events for trackpad pinches.
    const start=(event:Event)=>{event.preventDefault();gesturing=true;gestureStart=zoomValue.current;};
    const change=(event:Event)=>{
      event.preventDefault();
      const gesture=event as Event & {scale:number;clientX:number};
      if(Number.isFinite(gesture.scale))changeZoom(gestureStart*gesture.scale,gesture.clientX);
    };
    const end=(event:Event)=>{event.preventDefault();gesturing=false;};
    node.addEventListener("wheel",wheel,{passive:false});
    node.addEventListener("gesturestart",start,{passive:false});
    node.addEventListener("gesturechange",change,{passive:false});
    node.addEventListener("gestureend",end,{passive:false});
    return()=>{
      node.removeEventListener("wheel",wheel);
      node.removeEventListener("gesturestart",start);
      node.removeEventListener("gesturechange",change);
      node.removeEventListener("gestureend",end);
    };
  },[changeZoom]);
  const input=useRef<HTMLInputElement>(null);
  const editor=useRef<HTMLDivElement>(null);
  const main=clips.filter(c=>c.track!=="audio"),audios=clips.filter(c=>c.track==="audio");
  let running=0;const placements=main.map(c=>{const at=running;running+=length(c);return {clip:c,at};});
  const total=Math.max(running,...audios.map(c=>(c.at||0)+length(c)),0);
  const clip=clips.find(c=>c.id===selected),index=main.findIndex(c=>c.id===selected);
  const offset=clip?.track==="audio"?clip.at||0:placements.find(p=>p.clip.id===selected)?.at||0;
  const position=clip?clip.start+(cursor-offset)*clip.speed:0;
  const active=placements.find(p=>cursor>=p.at&&cursor<p.at+length(p.clip))||(cursor===total&&cursor===running?placements[placements.length-1]:undefined);
  const [episodeId,setEpisodeId]=useState(project.draft.episodeId||"all");
  const episode=data.episodes.find(e=>String(e.id)===episodeId);
  useEffect(()=>{if(episodeId!=="all"&&!episode)setEpisodeId(data.episodes[0]?String(data.episodes[0].id):"all");},[episodeId,episode,data.episodes]);
  const assets:{media:Media;label:string;key:string}[]=episode?[...episode.scenes].sort((a,b)=>a.sort_order-b.sort_order||a.id-b.id).flatMap(scene=>{
    if(!scene.video_media_id)return [];
    const media=scene.video_media?.id===scene.video_media_id?scene.video_media:scene.videos?.find(m=>m.id===scene.video_media_id)||data.media.find(m=>m.id===scene.video_media_id);
    return media?.kind==="video"?[{media,label:scene.title,key:`scene-${scene.id}`}]:[];
  }):data.media.filter(m=>m.kind==="video"||m.kind==="audio").map(media=>({media,label:media.kind==="video"?"视频素材":"音频素材",key:`media-${media.id}`}));
  const [outputs,setOutputs]=useState(project.outputs);
  const [saving,setSaving]=useState(false);
  const saveQueue=useRef<Promise<unknown>>(Promise.resolve());
  const draft=useRef({clips,format,ratio,episodeId,name});draft.current={clips,format,ratio,episodeId,name};
  const save=useCallback(()=>{
    const value=draft.current;setSaving(true);
    const request=saveQueue.current.catch(()=>{}).then(()=>post("/editor/save",{project_id:data.project.id,id:project.id,name:value.name,draft:{clips:value.clips,format:value.format,ratio:value.ratio,episodeId:value.episodeId}}));
    saveQueue.current=request;
    return request.then(()=>setStorageError(false)).catch(e=>{setStorageError(true);throw e;}).finally(()=>setSaving(false));
  },[data.project.id,project.id]);
  useEffect(()=>{const timer=window.setTimeout(()=>{save().catch(()=>{});},600);return()=>window.clearTimeout(timer);},[clips,format,ratio,episodeId,name,save]);
  useEffect(()=>()=>{save().catch(()=>{});},[save]);
  const leave=async()=>{setPlaying(false);try{await save();await back();}catch(e){Message.error(`草稿未保存：${String(e)}`);}};

  useEffect(()=>{setCursor(c=>Math.min(c,total));},[total]);
  const clock=useRef(0);
  const activeClock=useRef(active);
  activeClock.current=active;
  useEffect(()=>{
    if(!playing)return;
    let frame=0,lastPaint=0;
    clock.current=performance.now();
    const tick=(now:number)=>{
      if(now-lastPaint>=33){
        const delta=(now-clock.current)/1000;
        clock.current=now;lastPaint=now;
        const current=activeClock.current;
        if(current){
          const media=editor.current?.querySelector<HTMLVideoElement>('video[data-editor-clock]');
          // Freeze the timeline during buffering, initial loading and seeks.
          if(media&&media.readyState>=2&&!media.seeking&&(!media.paused||media.ended)){
            const local=media.ended?length(current.clip):Math.max(0,(media.currentTime-current.clip.start)/current.clip.speed);
            setCursor(Math.min(total,current.at+Math.min(length(current.clip),local)));
          }
        }else setCursor(c=>Math.min(total,c+delta));
      }
      frame=requestAnimationFrame(tick);
    };
    frame=requestAnimationFrame(tick);
    return()=>cancelAnimationFrame(frame);
  },[playing,total]);
  useEffect(()=>{if(cursor>=total)setPlaying(false);},[cursor,total]);
  const edit=(next:Clip[])=>{setPlaying(false);setPast(p=>[...p.slice(-39),clips]);setFuture([]);setClips(next);setResult(null);};
  const update=(patch:Partial<Clip>)=>{if(clip)edit(clips.map(c=>c.id===clip.id?{...c,...patch}:c));};
  const add=async(m:Media)=>{setBusy(true);try{const info=await post<{duration:number}>("/editor/probe",{project_id:data.project.id,media_id:m.id});const c:Clip={...m,id:crypto.randomUUID(),media_id:m.id,source:episode?`${episode.title} / ${assets.find(a=>a.media.id===m.id)?.label||m.name}`:"项目素材库",duration:info.duration,start:0,end:info.duration,speed:1,volume:1};edit([...clips,c]);setSelected(c.id);setCursor(running);}catch(e){Message.error(String(e));}finally{setBusy(false);}};
  const seek=(value:number)=>{setPlaying(false);setCursor(Math.max(0,Math.min(total,value)));};
  const canSplit=!!clip&&position-clip.start>=0.05&&clip.end-position>=0.05;
  const split=()=>{if(!clip||!canSplit||clips.length>=100)return;const right={...clip,id:crypto.randomUUID(),start:position,...(clip.track==="audio"?{at:cursor}:{})};edit(clips.flatMap(c=>c.id===clip.id?[{...clip,end:position},right]:[c]));setSelected(right.id);};
  const remove=(id:string)=>{edit(clips.filter(c=>c.id!==id));if(id===selected)setSelected("");};
  const move=(direction:number)=>{const next=[...main];[next[index],next[index+direction]]=[next[index+direction],next[index]];edit([...next,...audios]);};
  const detach=async()=>{if(!clip||clip.kind!=="video"||clip.track==="audio"||clip.detached||clips.length>=100)return;setBusy(true);setPlaying(false);try{const info=await post<{audio:boolean}>("/editor/probe",{project_id:data.project.id,media_id:clip.media_id});if(!info.audio){Message.warning("该视频没有音轨");return;}edit([...clips.map(c=>c.id===clip.id?{...c,detached:true}:c),{...clip,id:crypto.randomUUID(),kind:"audio",track:"audio",at:offset,name:`${clip.name} · 音轨`,detached:false}]);Message.success("音轨已分离，原视频静音；下方音轨可独立剪辑");}catch(e){Message.error(String(e));}finally{setBusy(false);}};
  const render=async()=>{setExporting(true);setPlaying(false);try{await save();const media=await post<Media>("/editor/export",{project_id:data.project.id,edit_id:project.id,clips:main.map(c=>({...c,volume:c.detached?0:c.volume})),audio_clips:audios,format,ratio,name});setResult(media);setOutputs(items=>[media,...items.filter(m=>m.id!==media.id)]);Message.success("导出完成，已保存到项目素材库");await reload();}catch(e){Message.error(String(e));}finally{setExporting(false);}};
  const playbackError=()=>{setPlaying(false);Message.error("无法预览该素材，请检查媒体格式或文件是否存在");};
  const locked=busy||exporting;
  const togglePlayback=useCallback(()=>{
    if(!clips.length||busy||exporting)return;
    setCursor(value=>value>=total?0:value);
    setPlaying(value=>!value);
  },[clips.length,busy,exporting,total]);
  useEffect(()=>{
    const onKeyDown=(event:KeyboardEvent)=>{
      if(event.code!=="Space"||event.defaultPrevented||event.isComposing||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey)return;
      const target=event.target;
      if(target instanceof HTMLElement){
        if(target.isContentEditable||target.closest('input,textarea,select,[role="textbox"],[role="combobox"],[role="slider"],[role="dialog"]'))return;
        if(target!==document.body&&target!==document.documentElement&&!editor.current?.contains(target))return;
      }
      event.preventDefault(); // Prevent scrolling and a focused button's native Space click.
      if(!event.repeat)togglePlayback();
    };
    window.addEventListener("keydown",onKeyDown);
    return()=>window.removeEventListener("keydown",onKeyDown);
  },[togglePlayback]);
  const pixelsPerSecond=40*zoom/100;
  const timelineWidth=Math.max(600,total*pixelsPerSecond);
  const tile=(c:Clip,at:number)=><div key={c.id} className={`me-clip me-editable-clip ${c.track==="audio"?"audio":""} ${c.id===selected?"selected":""}`} style={{position:"absolute",left:at*pixelsPerSecond,width:Math.max(2,length(c)*pixelsPerSecond-2),top:4,height:76}}><button className="me-clip-hit" aria-label={`选择片段 ${c.name}`} onClick={e=>{const rect=e.currentTarget.getBoundingClientRect();setSelected(c.id);seek(at+Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width))*length(c));}}><b>{c.name}</b><span>{time(length(c))} · {c.speed}× {c.detached?"· 已分离音轨":c.volume===0?"· 静音":""}</span></button><button className="me-clip-delete" aria-label={`删除 ${c.name}`} disabled={locked} onClick={()=>remove(c.id)}><Trash2 size={13}/></button></div>;
  return <div className="media-editor" ref={editor}>
    <header className="me-header"><div><h2><Button disabled={busy||exporting} icon={<ArrowLeft size={16}/>} onClick={leave}>剪辑项目</Button><Scissors size={23}/> {project.name}</h2><p>{storageError?"草稿保存失败，请重试后再离开":saving?"正在保存项目草稿…":"草稿自动保存到项目数据库 · 素材仅保存引用"}</p></div><div className="me-actions"><Button loading={saving} disabled={busy||exporting} onClick={()=>save().catch(e=>Message.error(String(e)))}>保存草稿</Button><Input aria-label="作品名称" value={name} onChange={setName} style={{width:160}}/><select aria-label="导出格式" value={format} onChange={e=>setFormat(e.target.value)}><option value="mp4">视频 MP4</option><option value="mp3">音频 MP3</option></select><Button type="primary" icon={<Download size={16}/>} loading={exporting} disabled={!clips.length||busy} onClick={render}>导出作品</Button></div></header>
    {exporting&&<div className="me-notice" role="status">正在渲染并合并片段，请保持页面打开。完成后作品将出现在素材库中。</div>}
    {result&&<div className="me-notice">已生成：{result.name}<Button onClick={()=>download(`/api/v1/projects/${encodeURIComponent(data.project.id)}/assets/${result.id}/content?download=1`,result.name)}>下载文件</Button></div>}
    {!!outputs.length&&<div className="me-notice me-output-history"><b>项目产出（{outputs.length}）</b>{outputs.map(m=><span key={m.id}>{m.name}<Button size="small" onClick={()=>download(`/api/v1/projects/${encodeURIComponent(data.project.id)}/assets/${m.id}/content?download=1`,m.name)}>下载</Button></span>)}</div>}
    <div className="me-workspace"><aside className="me-library"><div className="me-panel-title">项目素材 <Button size="small" loading={busy} disabled={exporting} icon={<Plus size={14}/>} onClick={()=>input.current?.click()}>导入</Button></div><input ref={input} type="file" accept="video/*,audio/*,.mkv,.flac" hidden onChange={async e=>{const file=e.target.files?.[0];e.target.value="";if(!file)return;setBusy(true);try{const m=await uploadAsset<Media>(data.project.id,file);await reload();await add(m);}catch(error){Message.error(String(error));}finally{setBusy(false);}}}/><label className="me-episode-label">素材来源<select aria-label="选择剧集" value={episodeId} onChange={e=>setEpisodeId(e.target.value)}><option value="all">全部项目素材</option>{data.episodes.map(e=><option key={e.id} value={String(e.id)}>{e.title}</option>)}</select></label><p className="me-hint">{episode?`已选主视频 ${assets.length} / ${episode.scenes.length} · 按场景顺序排列`:"点击素材添加到时间线"}</p><div className="me-assets">{assets.map(({media:m,label,key})=><button disabled={busy||exporting||clips.length>=100} key={key} onClick={()=>add(m)} className="me-asset me-asset-preview" title={`添加到时间线：${label} · ${m.name}`}><AssetThumbnail media={m} projectId={data.project.id}/><span className="me-asset-caption"><b>{label}</b><small>{m.name}</small></span><Plus className="me-asset-add" size={16}/></button>)}{!assets.length&&<div className="me-empty">{episode?"该剧集还没有主视频，请先在剧集的场景中设定主视频。":"导入视频或音乐，开始你的第一段剪辑"}</div>}</div></aside>
    <section className="me-preview"><div className="me-panel-title">播放器 <span>{format==="mp3"?"纯音频输出":ratio}</span></div><div className="me-stage"><div className="me-canvas" style={{aspectRatio:ratio.replace(":","/")}}>{active?<><MediaPlayback key={active.clip.id} clip={active.clip} local={active.clip.start+Math.min(length(active.clip),Math.max(0,cursor-active.at))*active.clip.speed} playing={playing} video onError={playbackError}/>{active.clip.kind==="audio"&&<div className="me-audio"><Music size={48}/><span>{active.clip.name}</span></div>}</>:<div className="me-empty"><Film size={40}/><p>{clips.length?"当前时间没有视频画面":"将素材添加到时间线，开始剪辑"}</p></div>}{audios.filter(c=>cursor>=(c.at||0)&&cursor<(c.at||0)+length(c)).map(c=><MediaPlayback key={c.id} clip={c} local={c.start+(cursor-(c.at||0))*c.speed} playing={playing} onError={playbackError}/>)}</div></div><div className="me-player-controls"><Button aria-label={playing?"暂停":"播放"} aria-keyshortcuts="Space" title="播放 / 暂停（空格）" disabled={!clips.length||locked} icon={playing?<Pause size={17}/>:<Play size={17}/>} onClick={togglePlayback}/><span>{time(cursor)} / {time(total)}</span></div></section>
    <aside className="me-inspector"><div className="me-panel-title">{clip?.track==="audio"?"音轨片段设置":"片段设置"}</div>{clip?<><strong>{clip.name}</strong>{clip.track==="audio"&&<label>时间线位置（秒）<input aria-label="音轨位置" type="number" min="0" max="7200" step="0.1" value={clip.at||0} disabled={locked} onChange={e=>{const n=e.target.valueAsNumber;if(Number.isFinite(n)&&n>=0&&n+length(clip)<=7200)update({at:n});}}/></label>}<label>入点（秒）<input aria-label="入点" type="number" min="0" max={clip.end-0.05} step="0.01" value={clip.start} disabled={locked} onChange={e=>{const n=e.target.valueAsNumber;if(Number.isFinite(n)&&n>=0&&n<clip.end-0.049)update({start:n});}}/></label><label>出点（秒）<input aria-label="出点" type="number" min={clip.start+0.05} max={clip.duration} step="0.01" value={clip.end} disabled={locked} onChange={e=>{const n=e.target.valueAsNumber;if(Number.isFinite(n)&&n>clip.start+0.049&&n<=clip.duration)update({end:n});}}/></label><label>播放速度<select value={clip.speed} disabled={locked} onChange={e=>update({speed:Number(e.target.value)})}>{[0.5,0.75,1,1.25,1.5,2].map(n=><option key={n} value={n}>{n}×</option>)}</select></label><label>音量 · {clip.detached?"已分离，原声静音":`${Math.round(clip.volume*100)}%`}<input aria-label="音量" type="range" min="0" max="1" step="0.05" value={clip.detached?0:clip.volume} disabled={locked||clip.detached} onChange={e=>update({volume:Number(e.target.value)})}/></label><p className="me-hint">素材来源：{clip.source||"项目素材库"}<br/>{data.media.find(m=>m.id===clip.media_id)?.name||"素材不可用"}（#{clip.media_id}）<br/>片段时长 {time(length(clip))}<br/>原始时长 {time(clip.duration)}</p></>:<p className="me-hint">点击时间线片段选中并定位播放头</p>}<label>画布比例<select value={ratio} onChange={e=>setRatio(e.target.value)} disabled={locked||format==="mp3"}><option>16:9</option><option>9:16</option><option>1:1</option></select></label><p className="me-hint">主轨删除后自动衔接；分离音轨保持独立时间位置，可单独裁剪、拆分、移动和删除。</p></aside></div>
    <section className="me-timeline" ref={timeline}><div className="me-toolbar"><Button aria-label="撤销" disabled={!past.length||locked} icon={<Undo2 size={16}/>} onClick={()=>{setPlaying(false);setFuture(f=>[clips,...f]);const prev=past[past.length-1];setClips(prev);setPast(past.slice(0,-1));setResult(null);}}/><Button aria-label="重做" disabled={!future.length||locked} icon={<Redo2 size={16}/>} onClick={()=>{setPlaying(false);setPast([...past,clips]);setClips(future[0]);setFuture(future.slice(1));setResult(null);}}/><Button disabled={!canSplit||locked||clips.length>=100} icon={<Scissors size={16}/>} onClick={split}>在播放头分割</Button><Button disabled={!clip||clip.kind!=="video"||clip.detached||locked||clips.length>=100} icon={<Music size={16}/>} onClick={detach}>分离音轨</Button><Button aria-label="前移片段" disabled={index<=0||locked} icon={<ArrowLeft size={16}/>} onClick={()=>move(-1)}/><Button aria-label="后移片段" disabled={index<0||index>=main.length-1||locked} icon={<ArrowRight size={16}/>} onClick={()=>move(1)}/><Button aria-label="删除片段" disabled={!clip||locked} icon={<Trash2 size={16}/>} onClick={()=>clip&&remove(clip.id)}>删除片段</Button><label className="me-zoom">缩放<input aria-label="时间线缩放" type="range" min="50" max="300" step="10" value={zoom} onChange={e=>changeZoom(Number(e.target.value))}/><output>{Math.round(zoom)}%</output></label><span>{clips.length} 个片段 · {time(total)}</span></div>
    <p className="me-hint">点击片段内任意位置定位播放头，再点击「在播放头分割」；选中片段后可删除或分离音轨。触控板双指展开/收拢，或按住 Ctrl / ⌘ 滚动鼠标缩放时间轴。</p><div className="me-ruler"><span>00:00</span><input aria-label="时间线播放头" type="range" min="0" max={total||1} step="0.01" value={cursor} disabled={!clips.length} onChange={e=>seek(Number(e.target.value))}/><span>{time(total)}</span></div>
    <div className="me-track-scroll" ref={trackScroll}><div style={{width:timelineWidth+88}}><div className="me-track"><span className="me-track-label"><Film size={18}/>主轨道</span><div className="me-track-lane" style={{width:timelineWidth}}>{placements.map(({clip:c,at})=>tile(c,at))}{!main.length&&<div className="me-track-empty">从素材区添加视频</div>}<div className="me-playhead" style={{left:cursor*pixelsPerSecond}}/></div></div>{audios.map((c,i)=><div className="me-track" key={c.id}><span className="me-track-label"><Music size={18}/>音轨 {i+1}</span><div className="me-track-lane" style={{width:timelineWidth}}>{tile(c,c.at||0)}<div className="me-playhead" style={{left:cursor*pixelsPerSecond}}/></div></div>)}</div></div></section>
  </div>;
}
