import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { Button, Input, Message, Modal } from "@arco-design/web-react";
import { Download, Plus, Scissors, Trash2, ArrowLeft, ArrowRight, Music, Film, Play, Pause, Undo2, Redo2, Search, Check, Save, SkipBack, SkipForward, GripVertical } from "lucide-react";
import { Media, Snapshot, fileUrl, post } from "./core";
import { uploadMedia } from "./api";
import { download } from "./transport";
import AssetThumbnail from "./AssetThumbnail";
import { VideoPreviewModal } from "./components/VideoPreviewModal";
import "./media-editor.css";
type Clip = { source?: string; id: string; media_id: number; name: string; path: string; kind: string; duration: number; start: number; end: number; speed: number; volume: number; track?: "audio"; at?: number; detached?: boolean };
const length = (c: Clip) => (c.end-c.start)/c.speed;
const time = (n: number) => { const cs=Math.round(Math.max(0,n)*100); return `${Math.floor(cs/6000).toString().padStart(2,"0")}:${(cs%6000/100).toFixed(2).padStart(5,"0")}`; };
function MediaPlayback({clip,local,playing,video=false,clock=false,onError}:{clip:Clip;local:number;playing:boolean;video?:boolean;clock?:boolean;onError:()=>void}) {
  const ref=useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const starting=useRef(false);
  const lastCorrection=useRef(0);
  const sync=()=>{
    const p=ref.current;if(!p)return;
    p.volume=clip.detached?0:clip.volume;p.playbackRate=clip.speed;
    // The video is the playback clock. Never chase a wall clock by seeking it.
    // Detached audio only corrects substantial drift, at most once per second.
    const now=performance.now();
    const correctAudio=!clock&&playing&&!p.seeking&&now-lastCorrection.current>1000&&Math.abs(p.currentTime-local)>0.35;
    if(p.readyState>=1&&(!playing&&Math.abs(p.currentTime-local)>0.015||correctAudio)){p.currentTime=local;lastCorrection.current=now;}
    if(playing&&p.paused&&!starting.current){starting.current=true;p.play().catch(error=>{if(error?.name!=="AbortError")onError();}).finally(()=>{starting.current=false;});}
    else if(!playing)p.pause();
  };
  const loaded=()=>{const p=ref.current;if(p){p.currentTime=local;lastCorrection.current=performance.now();}sync();};
  useEffect(sync,[local,playing,clip]);
  useEffect(()=>{const media=ref.current;return()=>{media?.pause();};},[]);
  return video?<video ref={ref} src={fileUrl(clip.path)} playsInline preload="auto" data-editor-clock={clock || undefined} onLoadedMetadata={loaded} onError={onError}/>:<audio ref={ref} data-editor-clock={clock || undefined} src={fileUrl(clip.path)} preload="auto" onLoadedMetadata={loaded} onError={onError}/>;
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
  return <div className="media-editor me-project-page"><header className="me-header"><div><h2><Scissors size={23}/> 音视频剪辑</h2><p>从项目素材到完整作品，在时间线上编排每一个镜头。</p></div><span className="me-project-count">{projects.length} 个剪辑项目</span></header>
    <form className="me-create-panel" onSubmit={e=>{e.preventDefault();if(!loading)void create();}}><div><strong>新建剪辑项目</strong><p>独立保存时间线与导出作品，直接复用当前项目素材。</p></div><div className="me-create-controls"><Input aria-label="新剪辑项目名称" placeholder="为这次剪辑起个名字（选填）" value={title} onChange={setTitle}/><Button htmlType="submit" type="primary" loading={loading} icon={<Plus size={16}/>}>创建剪辑项目</Button></div></form>
    {loading&&!projects.length&&<div className="me-project-loading" role="status">正在加载剪辑项目…</div>}
    {!loading&&!projects.length&&<section className="me-project-empty"><div className="me-empty-icon"><Scissors size={32}/></div><h3>让素材成为作品</h3><p>创建第一个剪辑项目，开始编排视频与音频。</p><div className="me-start-steps"><div><Film size={20}/><strong>01 · 添加素材</strong><span>选取剧集中的视频和音频</span></div><div><Scissors size={20}/><strong>02 · 编排时间线</strong><span>裁剪、分割并调整片段</span></div><div><Download size={20}/><strong>03 · 导出作品</strong><span>生成 MP4 视频或 MP3 音频</span></div></div><small>已有浏览器草稿会在首次创建时自动迁移。</small></section>}
    {!!projects.length&&<><div className="me-list-heading"><h3>我的剪辑</h3><span>选择项目，继续创作</span></div><div className="me-projects">{projects.map(p=><button className="me-project-card" key={p.id} onClick={()=>setCurrent(p)}><div className="me-project-cover"><Film size={30}/><span>{p.status==="exported"?"已导出":p.status==="rendering"?"导出中":p.status==="failed"?"导出失败":"剪辑草稿"}</span></div><strong>{p.name}</strong><span>{p.draft.clips.length} 个片段 · {new Set(p.draft.clips.map(c=>c.media_id)).size} 个来源素材 · {p.outputs.length} 个产出</span><div className="me-project-footer"><span>{Number(p.updated_at)>0?`更新于 ${new Date(Number(p.updated_at)*1000).toLocaleString()}`:"尚未编辑"}</span><ArrowRight size={16}/></div></button>)}</div></>}
  </div>;
}

// Keep incomplete number entry local; a completed field is one undoable edit.
function NumberField({label,value,min,max,step=0.01,disabled,onCommit}:{label:string;value:number;min:number;max:number;step?:number;disabled:boolean;onCommit:(value:number)=>boolean|void}) {
  const [entry,setEntry]=useState({value,text:String(value)});
  const text=entry.value===value?entry.text:String(value);
  const setText=(text:string)=>setEntry({value,text});
  if(entry.value!==value)setEntry({value,text:String(value)});
  const cancelled=useRef(false);
  return <input aria-label={label} type="number" min={min} max={max} step={step} value={text} disabled={disabled}
    onChange={event=>setText(event.target.value)} onBlur={()=>{
      if(cancelled.current){cancelled.current=false;return;}
      const n=Number(text);
      if(!text.trim()||!Number.isFinite(n)){setText(String(value));return;}
      const next=Math.max(min,Math.min(max,n));setText(String(next));if(next!==value&&onCommit(next)===false)setText(String(value));
    }} onKeyDown={event=>{
      if(event.key==="Enter"){event.preventDefault();event.currentTarget.blur();}
      if(event.key==="Escape"){cancelled.current=true;setText(String(value));event.currentTarget.blur();}
    }}/>;
}
type EditState = {clips:Clip[];selected:string;cursor:number};
const MIN_CLIP=0.05;
const EDITOR_MEDIA="application/x-spielberg-editor-media";
const EDITOR_CLIP="application/x-spielberg-editor-clip";
const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));
const mainPlacements=(clips:Clip[])=>{let at=0;return clips.filter(c=>c.track!=="audio").map(clip=>{const value={clip,at};at+=length(clip);return value;});};
const totalLength=(clips:Clip[])=>Math.max(clips.filter(c=>c.track!=="audio").reduce((n,c)=>n+length(c),0),...clips.filter(c=>c.track==="audio").map(c=>(c.at||0)+length(c)),0);
const clipOffset=(clips:Clip[],id:string)=>{const c=clips.find(c=>c.id===id);return c?.track==="audio"?c.at||0:mainPlacements(clips).find(p=>p.clip.id===id)?.at||0;};

function EditWorkspace({data,reload,project,back}:{data:Snapshot;reload:()=>Promise<void>;project:EditProject;back:()=>Promise<void>}) {
  const [clips,setClips]=useState<Clip[]>(()=>project.draft.clips.map(c=>{
    const media=data.media.find(m=>m.id===c.media_id);
    return {...c,name:media?.name||c.name||"素材不可用",path:media?.path||c.path,kind:c.track==="audio"?"audio":media?.kind||c.kind};
  }));
  const [selected,setSelected]=useState(clips[0]?.id||"");
  const [cursor,setCursor]=useState(0),[playing,setPlaying]=useState(false);
  const stateRef=useRef<EditState>({clips,selected,cursor});stateRef.current={clips,selected,cursor};
  const [past,setPast]=useState<EditState[]>([]),[future,setFuture]=useState<EditState[]>([]);
  const gesture=useRef<EditState|null>(null);
  const drag=useRef<{id:string;edge:"start"|"end";x:number;clip:Clip;at:number}|null>(null);
  const [interacting,setInteracting]=useState(false);
  const [busy,setBusy]=useState(false),[exporting,setExporting]=useState(false);
  const operation=useRef(false);
  const [format,setFormat]=useState(project.draft.format||"mp4"),[ratio,setRatio]=useState(project.draft.ratio||"16:9"),[name,setName]=useState(project.name);
  const [result,setResult]=useState<Media|null>(null),[outputs,setOutputs]=useState(project.outputs);
  const [episodeId,setEpisodeId]=useState(project.draft.episodeId||"all");
  const [query,setQuery]=useState(""),[kind,setKind]=useState("all"),[preview,setPreview]=useState<Media|null>(null);
  const [zoom,setZoom]=useState(100);
  const timeline=useRef<HTMLElement>(null),trackScroll=useRef<HTMLDivElement>(null),editor=useRef<HTMLDivElement>(null),input=useRef<HTMLInputElement>(null);
  const zoomValue=useRef(100),zoomAnchor=useRef<{time:number;x:number}|null>(null);
  const locked=busy||exporting;
  const main=clips.filter(c=>c.track!=="audio"),audios=clips.filter(c=>c.track==="audio"),placements=mainPlacements(clips);
  const running=main.reduce((n,c)=>n+length(c),0),total=totalLength(clips);
  const clip=clips.find(c=>c.id===selected),index=main.findIndex(c=>c.id===selected),offset=clipOffset(clips,selected);
  const position=clip?clip.start+(cursor-offset)*clip.speed:0;
  const active=placements.find(p=>cursor>=p.at&&cursor<p.at+length(p.clip))||(cursor===total&&cursor===running?placements[placements.length-1]:undefined);
  const activeAudios=audios.filter(c=>cursor>=(c.at||0)&&cursor<(c.at||0)+length(c));
  const episode=data.episodes.find(e=>String(e.id)===episodeId);
  useEffect(()=>{if(episodeId!=="all"&&!episode)setEpisodeId("all");},[episodeId,episode]);
  const assets:{media:Media;label:string;key:string}[]=episode?episode.playback_units.flatMap(scene=>{
    const media=scene.video_media?.id===scene.video_media_id?scene.video_media:scene.videos?.find(m=>m.id===scene.video_media_id)||data.media.find(m=>m.id===scene.video_media_id);
    return media?.kind==="video"?[{media,label:scene.title,key:`${scene.kind}-${scene.id}`}]:[];
  }):data.media.filter(m=>m.kind==="video"||m.kind==="audio").map(media=>({media,label:media.kind==="video"?"视频 · 追加到主轨":"音频 · 添加到播放头",key:`media-${media.id}`}));
  const filtered=assets.filter(({media,label})=>(kind==="all"||media.kind===kind)&&`${media.name} ${label}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));

  const draft=useRef({clips,format,ratio,episodeId,name});draft.current={clips,format,ratio,episodeId,name};
  const serialize=()=>JSON.stringify(draft.current);
  const lastSaved=useRef(serialize());
  const [savedContent,setSavedContent]=useState(lastSaved.current),[pendingSaves,setPendingSaves]=useState(0),[storageError,setStorageError]=useState(false);
  const saveQueue=useRef<Promise<unknown>>(Promise.resolve());
  const saving=pendingSaves>0,dirty=serialize()!==savedContent;
  const save=useCallback(()=>{
    const value=draft.current;
    if(!value.name.trim())return Promise.reject(new Error("请输入作品名称后保存"));
    const content=JSON.stringify(value);
    setPendingSaves(n=>n+1);
    const request=saveQueue.current.catch(()=>{}).then(async()=>{
      if(lastSaved.current===content){setSavedContent(content);setStorageError(false);return;}
      await post("/editor/save",{project_id:data.project.id,id:project.id,name:value.name.trim(),draft:{clips:value.clips,format:value.format,ratio:value.ratio,episodeId:value.episodeId}});
      lastSaved.current=content;setSavedContent(content);setStorageError(false);
    });
    saveQueue.current=request;
    return request.catch(error=>{setStorageError(true);throw error;}).finally(()=>setPendingSaves(n=>n-1));
  },[data.project.id,project.id]);
  useEffect(()=>{
    if(!dirty||interacting||!name.trim())return;
    const timer=window.setTimeout(()=>{void save().catch(()=>{});},600);
    return()=>window.clearTimeout(timer);
  },[clips,format,ratio,episodeId,name,dirty,interacting,save]);
  useEffect(()=>()=>{void save().catch(()=>{});},[save]);
  useEffect(()=>{
    if(!dirty&&!saving&&!locked)return;
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};
    window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);
  },[dirty,saving,locked]);
  const leave=async()=>{if(locked||interacting)return;setPlaying(false);try{await save();await back();}catch(e){Message.error(`草稿未保存：${String(e)}`);}};

  const restore=(state:EditState)=>{
    const next={...state,cursor:clamp(state.cursor,0,totalLength(state.clips))};
    stateRef.current=next;setClips(next.clips);setSelected(next.selected);setCursor(next.cursor);setPlaying(false);setResult(null);
  };
  const edit=(next:Clip[],selection=stateRef.current.selected,at=stateRef.current.cursor)=>{
    const before=stateRef.current;
    if(totalLength(next)>7200+1e-8){Message.warning({id:"editor-duration-limit",content:"时间线最长为两小时，请缩短片段或提高播放速度"});return false;}
    if(JSON.stringify(next)===JSON.stringify(before.clips))return true;
    if(!gesture.current)setPast(items=>[...items.slice(-49),before]);
    setFuture([]);restore({clips:next,selected:selection,cursor:at});return true;
  };
  const beginGesture=()=>{if(gesture.current)return;gesture.current=stateRef.current;setPlaying(false);setInteracting(true);};
  const finishGesture=(cancel=false)=>{
    const before=gesture.current;gesture.current=null;drag.current=null;setInteracting(false);
    if(!before)return;
    if(cancel){restore(before);return;}
    if(JSON.stringify(before.clips)!==JSON.stringify(stateRef.current.clips))setPast(items=>[...items.slice(-49),before]);
  };
  const undo=()=>{if(locked||interacting||!past.length)return;const prev=past[past.length-1],current=stateRef.current;setFuture(items=>[current,...items]);setPast(items=>items.slice(0,-1));restore(prev);};
  const redo=()=>{if(locked||interacting||!future.length)return;const next=future[0],current=stateRef.current;setPast(items=>[...items,current]);setFuture(items=>items.slice(1));restore(next);};
  const seek=(value:number)=>{if(locked)return;setPlaying(false);const next=clamp(value,0,total);stateRef.current={...stateRef.current,cursor:next};setCursor(next);};
  const update=(patch:Partial<Clip>)=>{
    if(!clip||locked)return false;
    const next=clips.map(c=>c.id===clip.id?{...c,...patch}:c),updated=next.find(c=>c.id===clip.id)!;
    const at=clipOffset(next,clip.id),sourcePosition=clamp(position,updated.start,Math.max(updated.start,updated.end-0.001));
    return edit(next,clip.id,patch.at!==undefined?at:at+(sourcePosition-updated.start)/updated.speed);
  };
  const add=async(m:Media,dropAt?:number)=>{
    if(operation.current||locked||clips.length>=100)return;
    operation.current=true;setBusy(true);setPlaying(false);
    try{
      const info=await post<{duration:number}>("/editor/probe",{project_id:data.project.id,media_id:m.id});
      if(!Number.isFinite(info.duration)||info.duration<MIN_CLIP)throw new Error("素材时长不足 0.05 秒");
      const at=m.kind==="audio"?dropAt??stateRef.current.cursor:dropAt??running;
      const c:Clip={...m,id:crypto.randomUUID(),media_id:m.id,source:episode?`${episode.title} / ${assets.find(a=>a.media.id===m.id)?.label||m.name}`:"项目素材库",duration:info.duration,start:0,end:info.duration,speed:1,volume:1,...(m.kind==="audio"?{track:"audio" as const,at}:{})};
      if((m.kind==="audio"?at:running)+length(c)>7200)throw new Error("时间线最多支持两小时，请先裁剪素材");
      if(m.kind==="audio")edit([...clips,c],c.id,at);
      else {
        const insertion=dropAt===undefined?main.length:placements.findIndex(p=>dropAt<p.at+length(p.clip)/2);
        const order=[...main];order.splice(insertion<0?main.length:insertion,0,c);
        const next=[...order,...audios];edit(next,c.id,clipOffset(next,c.id));
      }
    }catch(e){Message.error(String(e));}finally{operation.current=false;setBusy(false);}
  };
  const canSplit=!!clip&&position-clip.start>=MIN_CLIP-1e-8&&clip.end-position>=MIN_CLIP-1e-8;
  const split=()=>{if(!clip||!canSplit||locked||clips.length>=100)return;const right={...clip,id:crypto.randomUUID(),start:position,...(clip.track==="audio"?{at:cursor}:{})};edit(clips.flatMap(c=>c.id===clip.id?[{...c,end:position},right]:[c]),right.id,cursor);};
  const remove=(id:string)=>{
    if(locked)return;
    const next=clips.filter(c=>c.id!==id),neighbor=next.find(c=>c.id===selected)||next[Math.min(clips.findIndex(c=>c.id===id),next.length-1)];
    edit(next,neighbor?.id||"",neighbor?clipOffset(next,neighbor.id):0);
  };
  const moveTo=(id:string,target:string)=>{
    const from=main.findIndex(c=>c.id===id),to=main.findIndex(c=>c.id===target);
    if(locked||from<0||to<0||from===to)return;
    const order=[...main];order.splice(to,0,...order.splice(from,1));const next=[...order,...audios];edit(next,id,clipOffset(next,id));
  };
  const move=(direction:number)=>{if(index>=0&&main[index+direction])moveTo(selected,main[index+direction].id);};
  const detach=async()=>{
    if(!clip||clip.kind!=="video"||clip.track==="audio"||clip.detached||locked||operation.current||clips.length>=100)return;
    operation.current=true;setBusy(true);setPlaying(false);
    try{
      const info=await post<{audio:boolean}>("/editor/probe",{project_id:data.project.id,media_id:clip.media_id});
      if(!info.audio){Message.warning("该视频没有音轨");return;}
      const audio:Clip={...clip,id:crypto.randomUUID(),kind:"audio",track:"audio",at:offset,name:`${clip.name} · 音轨`,detached:false};
      edit([...clips.map(c=>c.id===clip.id?{...c,detached:true}:c),audio],audio.id,offset);
      Message.success("音轨已分离，可在下方独立编辑");
    }catch(e){Message.error(String(e));}finally{operation.current=false;setBusy(false);}
  };
  const render=async()=>{
    if(operation.current||locked||interacting||!clips.length)return;
    operation.current=true;setExporting(true);setPlaying(false);
    try{
      await save();
      const media=await post<Media>("/editor/export",{project_id:data.project.id,edit_id:project.id,clips:main.map(c=>({...c,volume:c.detached?0:c.volume})),audio_clips:audios,format,ratio,name:name.trim()});
      setResult(media);setOutputs(items=>[media,...items.filter(m=>m.id!==media.id)]);Message.success("导出完成，已保存到项目素材库");
      try{await reload();}catch{Message.warning("作品已导出，素材库刷新失败，请稍后重试");}
    }catch(e){Message.error(String(e));}finally{operation.current=false;setExporting(false);}
  };
  const playbackError=()=>{setPlaying(false);Message.error("无法预览该素材，请检查媒体格式或文件是否存在");};
  const togglePlayback=()=>{if(!clips.length||locked||interacting)return;if(cursor>=total)setCursor(0);setPlaying(value=>!value);};
  useEffect(()=>{setCursor(c=>Math.min(c,total));},[total]);
  const clockClip=active||(activeAudios[0]?{clip:activeAudios[0],at:activeAudios[0].at||0}:undefined);
  const playback=useRef({active:clockClip,total});playback.current={active:clockClip,total};
  useEffect(()=>{
    if(!playing)return;
    let frame=0,last=performance.now();
    const tick=(now:number)=>{
      const delta=(now-last)/1000;last=now;
      const {active:current,total:end}=playback.current;
      const media=editor.current?.querySelector<HTMLMediaElement>('[data-editor-clock]');
      if(current&&media){
        if(media.readyState>=2&&!media.seeking&&(!media.paused||media.ended)){
          const local=media.ended?length(current.clip):Math.max(0,(media.currentTime-current.clip.start)/current.clip.speed);
          setCursor(Math.min(end,current.at+Math.min(length(current.clip),local)));
        }
      }else setCursor(c=>Math.min(end,c+delta));
      frame=requestAnimationFrame(tick);
    };
    frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);
  },[playing]);
  useEffect(()=>{if(cursor>=total)setPlaying(false);},[cursor,total]);

  const changeZoom=useCallback((value:number,clientX?:number)=>{
    const scroller=trackScroll.current,next=clamp(value,50,300);
    if(scroller){const x=clientX===undefined?scroller.clientWidth/2:clamp(clientX-scroller.getBoundingClientRect().left,86,scroller.clientWidth);zoomAnchor.current={time:(scroller.scrollLeft+x-86)/(40*zoomValue.current/100),x};}
    zoomValue.current=next;setZoom(next);
  },[]);
  useLayoutEffect(()=>{const anchor=zoomAnchor.current;if(anchor&&trackScroll.current)trackScroll.current.scrollLeft=anchor.time*40*zoom/100+86-anchor.x;zoomAnchor.current=null;},[zoom]);
  useEffect(()=>{
    const node=timeline.current;if(!node)return;
    let gestureStart=100,gesturing=false;
    const wheel=(event:WheelEvent)=>{if(!event.ctrlKey&&!event.metaKey)return;event.preventDefault();if(gesturing)return;const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?node.clientHeight:1);changeZoom(zoomValue.current*Math.exp(-delta*0.01),event.clientX);};
    const start=(event:Event)=>{event.preventDefault();gesturing=true;gestureStart=zoomValue.current;};
    const change=(event:Event)=>{event.preventDefault();const e=event as Event & {scale:number;clientX:number};if(Number.isFinite(e.scale))changeZoom(gestureStart*e.scale,e.clientX);};
    const end=(event:Event)=>{event.preventDefault();gesturing=false;};
    node.addEventListener("wheel",wheel,{passive:false});node.addEventListener("gesturestart",start,{passive:false});node.addEventListener("gesturechange",change,{passive:false});node.addEventListener("gestureend",end,{passive:false});
    return()=>{node.removeEventListener("wheel",wheel);node.removeEventListener("gesturestart",start);node.removeEventListener("gesturechange",change);node.removeEventListener("gestureend",end);};
  },[changeZoom]);
  useEffect(()=>{
    if(!playing||!trackScroll.current)return;
    const scroller=trackScroll.current,x=86+cursor*40*zoom/100;
    if(x>scroller.scrollLeft+scroller.clientWidth-40)scroller.scrollLeft=x-scroller.clientWidth+80;
    else if(x<scroller.scrollLeft+86)scroller.scrollLeft=Math.max(0,x-86);
  },[playing,cursor,zoom]);
  const pixelsPerSecond=40*zoom/100,timelineWidth=Math.max(600,total*pixelsPerSecond+40);
  const tickStep=pixelsPerSecond>=70?1:pixelsPerSecond>=30?2:5;
  const ticks=Array.from({length:Math.floor(timelineWidth/pixelsPerSecond/tickStep)+1},(_,i)=>i*tickStep);
  const startTrim=(event:PointerEvent<HTMLButtonElement>,c:Clip,at:number,edge:"start"|"end")=>{
    if(locked||event.button!==0)return;event.preventDefault();event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);beginGesture();drag.current={id:c.id,edge,x:event.clientX,clip:c,at};setSelected(c.id);
  };
  const dragTrim=(event:PointerEvent<HTMLButtonElement>)=>{
    const d=drag.current;if(!d)return;
    const delta=(event.clientX-d.x)/pixelsPerSecond*d.clip.speed;
    const value=d.edge==="start"?clamp(d.clip.start+delta,0,d.clip.end-MIN_CLIP):clamp(d.clip.end+delta,d.clip.start+MIN_CLIP,d.clip.duration);
    const next=stateRef.current.clips.map(c=>c.id===d.id?{...c,[d.edge]:value}:c);
    const updated=next.find(c=>c.id===d.id)!;
    edit(next,d.id,d.edge==="start"?d.at:d.at+Math.max(0,length(updated)-0.001));
  };
  const dropAt=(event:React.DragEvent<HTMLElement>)=>{
    event.preventDefault();if(locked)return;
    const at=clamp((event.clientX-event.currentTarget.getBoundingClientRect().left)/pixelsPerSecond,0,7200);
    const mid=Number(event.dataTransfer.getData(EDITOR_MEDIA));
    if(mid){const m=data.media.find(m=>m.id===mid&&(m.kind==="video"||m.kind==="audio"));if(m)void add(m,at);return;}
    const id=event.dataTransfer.getData(EDITOR_CLIP),audio=audios.find(c=>c.id===id);
    if(audio&&at+length(audio)<=7200)edit(clips.map(c=>c.id===id?{...c,at}:c),id,at);
  };
  const tile=(c:Clip,at:number)=><div key={c.id} className={`me-clip me-editable-clip ${c.track==="audio"?"audio":""} ${c.id===selected?"selected":""}`} style={{position:"absolute",left:at*pixelsPerSecond,width:Math.max(4,length(c)*pixelsPerSecond-2),top:4,height:76}}>
    <button className="me-trim-handle is-start" aria-label={`调整入点 ${c.name}`} title="拖动裁剪入点" disabled={locked} onPointerDown={e=>startTrim(e,c,at,"start")} onPointerMove={dragTrim} onPointerUp={()=>finishGesture()} onPointerCancel={()=>finishGesture(true)} onLostPointerCapture={()=>{if(drag.current)finishGesture();}} onKeyDown={event=>{if(event.key==="ArrowLeft"||event.key==="ArrowRight"){event.preventDefault();event.stopPropagation();const delta=event.key==="ArrowRight"?0.05:-0.05;const start=clamp(c.start+delta,0,c.end-MIN_CLIP);const next=clips.map(item=>item.id===c.id?{...item,start}:item);edit(next,c.id,at);}}}><GripVertical size={10}/></button>
    <button className="me-clip-hit" disabled={locked} draggable={!locked&&!interacting} aria-pressed={c.id===selected} aria-label={`选择片段 ${c.name}`} title="点击定位 · 拖动调整顺序或音轨位置" onClick={e=>{const rect=e.currentTarget.getBoundingClientRect(),fraction=e.detail===0?0:clamp((e.clientX-rect.left)/rect.width,0,1);setSelected(c.id);seek(at+Math.min(Math.max(0,length(c)-0.001),fraction*length(c)));if(e.detail>0)editor.current?.focus({preventScroll:true});}} onDragStart={event=>{event.dataTransfer.setData(EDITOR_CLIP,c.id);event.dataTransfer.effectAllowed="move";setPlaying(false);}} onDragOver={event=>event.preventDefault()} onDrop={event=>{if(c.track!=="audio"&&main.some(item=>item.id===event.dataTransfer.getData(EDITOR_CLIP))){event.preventDefault();event.stopPropagation();moveTo(event.dataTransfer.getData(EDITOR_CLIP),c.id);}}}>
      <b>{c.track==="audio"?<Music size={12}/>:<Film size={12}/>} {c.name}</b><span>{time(length(c))} · {c.speed}× {c.detached?"· 音轨已分离":c.volume===0?"· 静音":""}</span>
    </button>
    <button className="me-trim-handle is-end" aria-label={`调整出点 ${c.name}`} title="拖动裁剪出点" disabled={locked} onPointerDown={e=>startTrim(e,c,at,"end")} onPointerMove={dragTrim} onPointerUp={()=>finishGesture()} onPointerCancel={()=>finishGesture(true)} onLostPointerCapture={()=>{if(drag.current)finishGesture();}} onKeyDown={event=>{if(event.key==="ArrowLeft"||event.key==="ArrowRight"){event.preventDefault();event.stopPropagation();const end=clamp(c.end+(event.key==="ArrowRight"?0.05:-0.05),c.start+MIN_CLIP,c.duration);const next=clips.map(item=>item.id===c.id?{...item,end}:item);edit(next,c.id,at+Math.max(0,(end-c.start)/c.speed-0.001));}}}><GripVertical size={10}/></button>
  </div>;
  return <div className="media-editor me-workbench" ref={editor} tabIndex={0} aria-label="音视频剪辑工作区" onKeyDown={event=>{
    if(!event.currentTarget.contains(event.target as Node)||event.defaultPrevented||event.nativeEvent.isComposing||preview)return;
    const target=event.target as HTMLElement;
    const modifier=event.metaKey||event.ctrlKey,key=event.key.toLowerCase();
    if(modifier&&key==="s"){event.preventDefault();if(!locked&&!interacting)void save().catch(e=>Message.error(String(e)));return;}
    if(target.closest('input,textarea,select,[contenteditable="true"],[role="combobox"],[role="slider"]'))return;
    if(locked||interacting)return;
    if(modifier&&key==="z"){event.preventDefault();event.shiftKey?redo():undo();}
    else if(modifier&&key==="y"){event.preventDefault();redo();}
    else if(!modifier&&!event.altKey&&!event.repeat){
      if(event.code==="Space"&&!target.closest("button")){event.preventDefault();togglePlayback();}
      else if(key==="s"){event.preventDefault();split();}
      else if(event.key==="Delete"||event.key==="Backspace"){if(clip){event.preventDefault();remove(clip.id);}}
      else if(event.key==="ArrowLeft"||event.key==="ArrowRight"){event.preventDefault();seek(cursor+(event.key==="ArrowRight"?1:-1)*(event.shiftKey?1:1/30));}
      else if(event.key==="Home"||event.key==="End"){event.preventDefault();seek(event.key==="Home"?0:total);}
    }
  }}>
    <header className="me-header"><div className="me-header-title"><Button aria-label="返回剪辑项目" disabled={locked||interacting} icon={<ArrowLeft size={16}/>} onClick={leave}/><div><h2>{name||project.name}</h2><span role="status" className={`me-save-state${storageError?" is-error":saving?" is-saving":dirty?" is-dirty":""}`}><Check size={12}/>{storageError?"保存失败，请重试":saving?"正在保存…":dirty?"有未保存的修改":"已保存"}</span></div></div><div className="me-actions"><Button loading={saving} disabled={locked||interacting||!name.trim()} icon={<Save size={14}/>} onClick={()=>void save().catch(e=>Message.error(String(e)))}>保存草稿</Button><Input aria-label="作品名称" placeholder="作品名称" value={name} maxLength={100} disabled={locked} onChange={setName}/><select aria-label="导出格式" value={format} disabled={locked} onChange={e=>{setPlaying(false);setFormat(e.target.value);}}><option value="mp4">MP4 视频</option><option value="mp3">MP3 音频</option></select><Button type="primary" icon={<Download size={16}/>} loading={exporting} disabled={!clips.length||busy||interacting||!name.trim()} onClick={()=>void render()}>导出作品</Button></div></header>
    {exporting&&<div className="me-notice" role="status">正在导出作品… 完成后自动保存到素材库，请保持页面打开。</div>}
    {storageError&&<div className="me-notice" role="alert">草稿保存失败，修改仍保留在当前页面。<Button onClick={()=>void save().catch(e=>Message.error(String(e)))}>重试保存</Button></div>}
    {result&&<div className="me-notice">已生成：{result.name}<Button onClick={()=>download(`/api/v1/projects/${encodeURIComponent(data.project.id)}/media/${result.id}/content?download=1`,result.name)}>下载文件</Button></div>}
    {!!outputs.length&&<details className="me-output-history"><summary>导出记录 · {outputs.length} 个作品</summary><div>{outputs.map(m=><span key={m.id}>{m.name}<Button size="small" onClick={()=>download(`/api/v1/projects/${encodeURIComponent(data.project.id)}/media/${m.id}/content?download=1`,m.name)}>下载</Button></span>)}</div></details>}
    <div className="me-workspace">
      <aside className="me-library" aria-label="剪辑素材库"><div className="me-panel-title">素材库 <Button size="small" loading={busy} disabled={exporting} icon={<Plus size={14}/>} onClick={()=>input.current?.click()}>导入</Button></div>
        <input ref={input} type="file" accept="video/*,audio/*,.mkv,.flac" hidden onChange={async e=>{const file=e.target.files?.[0];e.target.value="";if(!file||locked)return;setBusy(true);try{const m=await uploadMedia<Media>(data.project.id,file);await reload();setBusy(false);await add(m);}catch(error){Message.error(String(error));}finally{setBusy(false);}}}/>
        <label className="me-episode-label">素材来源<select aria-label="选择剧集" value={episodeId} disabled={locked} onChange={e=>setEpisodeId(e.target.value)}><option value="all">全部项目素材</option>{data.episodes.map(e=><option key={e.id} value={String(e.id)}>{e.title}</option>)}</select></label>
        <Input className="me-library-search" aria-label="搜索剪辑素材" placeholder="搜索素材" allowClear prefix={<Search size={14}/>} value={query} onChange={setQuery}/>
        <div className="me-filter-tabs" role="group" aria-label="素材类型筛选">{[{value:"all",label:"全部"},{value:"video",label:"视频"},{value:"audio",label:"音频"}].map(item=><button key={item.value} aria-pressed={kind===item.value} onClick={()=>setKind(item.value)}>{item.label}</button>)}<span>{filtered.length}</span></div>
        <div className="me-assets">{filtered.map(({media:m,label,key})=><div key={key} className="me-asset me-asset-row"><button className="me-asset-preview-button" aria-label={`预览素材 ${m.name}`} title={`预览 ${m.name} · 可拖到时间线`} disabled={locked} draggable={!locked} onDragStart={event=>{event.dataTransfer.setData(EDITOR_MEDIA,String(m.id));event.dataTransfer.effectAllowed="copy";setPlaying(false);}} onClick={()=>{setPlaying(false);setPreview(m);}}><AssetThumbnail media={m} projectId={data.project.id}/><span className="me-asset-caption"><b>{m.name}</b><small>{label}</small></span></button><button className="me-asset-add" aria-label={`添加到时间线 ${m.name}`} title={m.kind==="audio"?"在播放头位置添加音轨":"追加到视频主轨"} disabled={locked||clips.length>=100} onClick={()=>void add(m)}><Plus size={16}/></button></div>)}{!filtered.length&&<div className="me-empty">{query||kind!=="all"?"没有匹配的素材":episode?"本集尚未设置主视频":"导入视频或音频，开始剪辑"}</div>}</div>
        <p className="me-hint">点击缩略图预览，＋添加到时间线</p>
      </aside>
      <section className="me-preview" aria-label="作品预览"><div className="me-panel-title">作品预览<span>{format==="mp3"?"纯音频":ratio}</span></div><div className="me-stage"><div className="me-canvas" style={{aspectRatio:ratio.replace(":","/")}}>
        {active?<><MediaPlayback key={active.clip.id} clip={active.clip} local={active.clip.start+Math.min(length(active.clip),Math.max(0,cursor-active.at))*active.clip.speed} playing={playing} video={active.clip.kind==="video"&&format!=="mp3"} clock onError={playbackError}/>{(active.clip.kind==="audio"||format==="mp3")&&<div className="me-audio"><Music size={44}/><span>{active.clip.name}</span></div>}</>:<div className="me-empty">{activeAudios.length?<><Music size={40}/><p>{activeAudios[0].name}</p></>:<><Film size={40}/><p>{clips.length?"当前时间没有视频画面":"从素材库添加视频，开始编排镜头"}</p></>}</div>}
        {activeAudios.map(c=><MediaPlayback key={c.id} clip={c} local={c.start+(cursor-(c.at||0))*c.speed} playing={playing} clock={!active&&c.id===activeAudios[0]?.id} onError={playbackError}/>)}
      </div></div><div className="me-player-controls"><Button aria-label="回到开头" title="回到开头（Home）" disabled={!clips.length||locked} icon={<SkipBack size={15}/>} onClick={()=>seek(0)}/><Button aria-label={playing?"暂停":"播放"} title="播放 / 暂停（空格）" disabled={!clips.length||locked||interacting} icon={playing?<Pause size={18}/>:<Play size={18}/>} onClick={togglePlayback}/><Button aria-label="跳到结尾" title="跳到结尾（End）" disabled={!clips.length||locked} icon={<SkipForward size={15}/>} onClick={()=>seek(total)}/><span>{time(cursor)} <i>/</i> {time(total)}</span></div>
        <div className="me-ruler"><input aria-label="时间线播放头" type="range" min="0" max={total||1} step="0.001" value={cursor} disabled={!clips.length||locked||interacting} onChange={e=>seek(Number(e.target.value))}/></div>
      </section>
      <aside className="me-inspector" aria-label="片段设置"><div className="me-panel-title">片段设置 <span>{clip?clip.track==="audio"?"独立音轨":"主轨片段":"未选择"}</span></div>
        {clip?<><div className="me-selection-summary"><strong title={clip.name}>{clip.name}</strong><span>保留 {time(length(clip))} · 原始 {time(clip.duration)}</span></div>
          <section className="me-inspector-section"><h3>裁剪范围</h3><div className="me-inspector-grid"><label>入点（秒）<NumberField label="入点" value={clip.start} min={0} max={clip.end-MIN_CLIP} disabled={locked||interacting} onCommit={start=>update({start})}/></label><label>出点（秒）<NumberField label="出点" value={clip.end} min={clip.start+MIN_CLIP} max={clip.duration} disabled={locked||interacting} onCommit={end=>update({end})}/></label></div><div className="me-inspector-grid"><Button size="small" disabled={locked||!canSplit} onClick={()=>update({start:position})}>播放头设为入点</Button><Button size="small" disabled={locked||!canSplit} onClick={()=>update({end:position})}>播放头设为出点</Button></div></section>
          <section className="me-inspector-section"><h3>播放与声音</h3><label>播放速度<select aria-label="片段播放速度" value={clip.speed} disabled={locked||interacting} onChange={e=>update({speed:Number(e.target.value)})}>{[0.5,0.75,1,1.25,1.5,2].map(n=><option key={n} value={n}>{n}×</option>)}</select></label><label>音量 <span>{clip.detached?"音轨已分离":`${Math.round(clip.volume*100)}%`}</span><input aria-label="音量" type="range" min="0" max="1" step="0.05" value={clip.detached?0:clip.volume} disabled={locked||clip.detached} onPointerDown={beginGesture} onPointerUp={()=>finishGesture()} onPointerCancel={()=>finishGesture(true)} onBlur={()=>finishGesture()} onChange={e=>update({volume:Number(e.target.value)})}/></label>{clip.track==="audio"&&<label>时间线位置（秒）<NumberField label="音轨位置" value={clip.at||0} min={0} max={Math.max(0,7200-length(clip))} step={0.1} disabled={locked||interacting} onCommit={at=>update({at})}/></label>}</section>
          <p className="me-hint">{clip.source||"项目素材库"}</p>
        </>:<div className="me-empty"><Scissors size={24}/><p>选择时间线上的片段<br/>调整裁剪、速度与音量</p></div>}
        <section className="me-inspector-section"><h3>画布</h3><label>画布比例<select aria-label="画布比例" value={ratio} disabled={locked||format==="mp3"} onChange={e=>setRatio(e.target.value)}><option>16:9</option><option>9:16</option><option>1:1</option></select></label></section>
      </aside>
    </div>
    <section className="me-timeline" ref={timeline} aria-label="剪辑时间线"><div className="me-timeline-heading"><strong>时间线</strong><span>{main.length} 个镜头 · {audios.length} 条音轨 · {time(total)}</span></div>
      <div className="me-toolbar"><div className="me-tool-group" role="group" aria-label="编辑历史"><Button title="撤销（⌘ / Ctrl Z）" aria-label="撤销" disabled={!past.length||locked||interacting} icon={<Undo2 size={16}/>} onClick={undo}/><Button title="重做（⇧⌘ Z / Ctrl Y）" aria-label="重做" disabled={!future.length||locked||interacting} icon={<Redo2 size={16}/>} onClick={redo}/></div><div className="me-tool-group" role="group" aria-label="片段编辑"><Button disabled={!canSplit||locked||interacting||clips.length>=100} icon={<Scissors size={16}/>} title="分割（S）" onClick={split}>在播放头分割</Button><Button disabled={!clip||clip.kind!=="video"||clip.track==="audio"||clip.detached||locked||clips.length>=100} icon={<Music size={16}/>} onClick={()=>void detach()}>分离音轨</Button></div><div className="me-tool-group" role="group" aria-label="片段顺序"><Button title="前移片段" aria-label="前移片段" disabled={index<=0||locked} icon={<ArrowLeft size={16}/>} onClick={()=>move(-1)}/><Button title="后移片段" aria-label="后移片段" disabled={index<0||index>=main.length-1||locked} icon={<ArrowRight size={16}/>} onClick={()=>move(1)}/></div><div className="me-tool-group"><Button status="danger" aria-label="删除片段" title="删除片段（Delete）" disabled={!clip||locked} icon={<Trash2 size={16}/>} onClick={()=>clip&&remove(clip.id)}>删除</Button></div><label className="me-zoom">缩放<input aria-label="时间线缩放" type="range" min="50" max="300" step="10" value={zoom} disabled={interacting} onChange={e=>changeZoom(Number(e.target.value))}/><output>{Math.round(zoom)}%</output></label></div>
      <div className="me-track-scroll" ref={trackScroll}><div style={{width:timelineWidth+86}}>
        <div className="me-time-ruler" style={{width:timelineWidth}} onClick={event=>{seek((event.clientX-event.currentTarget.getBoundingClientRect().left)/pixelsPerSecond);editor.current?.focus({preventScroll:true});}}>{ticks.map(n=><span className="me-time-tick" key={n} style={{left:n*pixelsPerSecond}}>{time(n).slice(0,-3)}</span>)}</div>
        <div className="me-track"><span className="me-track-label"><Film size={16}/>主轨道</span><div className="me-track-lane" style={{width:timelineWidth}} onDragOver={event=>{if(!locked)event.preventDefault();}} onDrop={dropAt} onClick={event=>{if(event.target===event.currentTarget){seek((event.clientX-event.currentTarget.getBoundingClientRect().left)/pixelsPerSecond);editor.current?.focus({preventScroll:true});}}}>{placements.map(({clip:c,at})=>tile(c,at))}{!main.length&&<div className="me-track-empty">拖入视频，或点击素材旁的 ＋</div>}<div className="me-playhead" style={{left:cursor*pixelsPerSecond}}/></div></div>
        {audios.map((c,i)=><div className="me-track" key={c.id}><span className="me-track-label"><Music size={16}/>音轨 {i+1}</span><div className="me-track-lane" style={{width:timelineWidth}} onDragOver={event=>{if(!locked)event.preventDefault();}} onDrop={dropAt} onClick={event=>{if(event.target===event.currentTarget){seek((event.clientX-event.currentTarget.getBoundingClientRect().left)/pixelsPerSecond);editor.current?.focus({preventScroll:true});}}}>{tile(c,c.at||0)}<div className="me-playhead" style={{left:cursor*pixelsPerSecond}}/></div></div>)}
      </div></div><div className="me-keyboard-hints"><span>拖动片段两端裁剪 · 拖动片段调整顺序 · Ctrl / ⌘ 滚动缩放</span><span>空格 播放 · S 分割 · Delete 删除 · ⌘ / Ctrl Z 撤销</span></div>
    </section>
    <VideoPreviewModal media={preview?.kind==="video"?preview:null} projectId={data.project.id} onClose={()=>setPreview(null)}/>
    <Modal title={preview?.name} visible={preview?.kind==="audio"} footer={null} unmountOnExit onCancel={()=>setPreview(null)}><audio controls autoPlay src={preview?.kind==="audio"?fileUrl(preview.path):undefined} aria-label="素材音频预览" style={{width:"100%"}}/></Modal>
  </div>;
}
