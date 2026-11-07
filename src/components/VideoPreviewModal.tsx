import { PreviewKeyboardNavigation } from "./PreviewKeyboardNavigation";
import { Button, Message, Modal, Select } from "@arco-design/web-react";
import { ChevronLeft, ChevronRight, Download, Film, Maximize, Pause, Play, Repeat, RotateCcw, Scissors, Volume2, VolumeX, Undo2, Redo2, SkipBack, SkipForward, Save, CheckCircle2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode, type VideoHTMLAttributes } from "react";
import AssetThumbnail, { cachedThumbnailUrl, loadThumbnailUrl } from "../AssetThumbnail";
import { imageUrl, post, type Media } from "../core";
import { VideoTrimTimeline } from "./VideoTrimTimeline";
import { useVideoTrimFrames } from "./useVideoTrimFrames";
import "./image-preview.css";
import "./video-preview.css";

type Props = {
  media: Media | null;
  onClose: () => void;
  afterClose?: () => void;
  visible?: boolean;
  title?: string;
  videos?: Media[];
  projectId?: string;
  onMediaChange?: (media: Media) => void;
  footer?: ReactNode;
  toolbar?: ReactNode;
  onEnded?: () => void;
  allowLoop?: boolean;
  autoPlay?: boolean;
  initialTime?: number;
  playbackKey?: string | number;
  allowEdit?: boolean;
};
const noVideos: Media[] = [];

type TrimRange = { start: number; end: number };
const MIN_TRIM = 0.05;
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
function preciseTime(value: number) {
  const cs = Math.round(Math.max(0, Number.isFinite(value) ? value : 0) * 100);
  return `${Math.floor(cs / 6000).toString().padStart(2, "0")}:${(cs % 6000 / 100).toFixed(2).padStart(5, "0")}`;
}
function TrimTimeField({label,value,min,max,disabled,onCommit}:{label:string;value:number;min:number;max:number;disabled:boolean;onCommit:(value:number)=>void}) {
  const [entry,setEntry] = useState({value,text:value.toFixed(2)});
  if (entry.value !== value) setEntry({value,text:value.toFixed(2)});
  const text = entry.value === value ? entry.text : value.toFixed(2);
  const cancelled = useRef(false);
  return <input aria-label={label} type="number" min={min} max={max} step="0.01" value={text} disabled={disabled}
    onChange={event=>setEntry({value,text:event.target.value})}
    onBlur={()=>{
      if(cancelled.current){cancelled.current=false;return;}
      const parsed=Number(text);
      if(text.trim()&&Number.isFinite(parsed)&&text!==value.toFixed(2))onCommit(clamp(parsed,min,max));
      setEntry({value,text:value.toFixed(2)});
    }} onKeyDown={event=>{
      if(event.key==="Enter"){event.preventDefault();event.currentTarget.blur();}
      if(event.key==="Escape"){event.preventDefault();event.stopPropagation();cancelled.current=true;setEntry({value,text:value.toFixed(2)});event.currentTarget.blur();}
    }}/>;
}

function time(value: number) {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function VideoPreviewModal({ visible, afterClose, ...props }: Props) {
  const open = !!props.media && (visible ?? true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setEditing(false); setSaving(false); }, [open, props.media?.id, props.media?.path, props.playbackKey]);
  const videos = props.videos || noVideos;
  const index = videos.findIndex(item => item.id === props.media?.id);
  const canNavigate = open && !editing && videos.length > 1 && index >= 0 && !!props.onMediaChange;
  const move = (offset: number) => {if (canNavigate) props.onMediaChange?.(videos[(index + offset + videos.length) % videos.length]);};
  return <Modal modalRender={node => <PreviewKeyboardNavigation enabled={canNavigate} move={move}>{node}</PreviewKeyboardNavigation>} className={`image-preview-modal video-preview-modal is-fullscreen${editing ? " is-editing" : ""}`} wrapClassName="image-preview-wrapper" alignCenter={false}
    visible={open} title={props.media?.name || props.title || "视频预览"} closable={false} footer={null} escToExit={!saving} maskClosable={!saving} onCancel={() => { if (!saving) props.onClose(); }} afterClose={afterClose} unmountOnExit>
    {open && props.media && <VideoPreview key={`${props.playbackKey ?? ""}:${props.media.id}:${props.media.path}`} {...props} media={props.media} editing={editing} setEditing={setEditing} saving={saving} setSaving={setSaving} />}
  </Modal>;
}

function VideoPreview({ media, onClose, title = "视频预览", videos = noVideos, projectId, onMediaChange, toolbar, footer, onEnded, allowLoop = true, autoPlay = false, initialTime = 0, allowEdit = true, editing, setEditing, saving, setSaving }: Omit<Props, "visible"> & { media: Media; editing: boolean; setEditing: (value: boolean) => void; saving: boolean; setSaving: (value: boolean) => void }) {
  const player = useRef<HTMLVideoElement>(null);
  const [metadata, setMetadata] = useState({ width: 0, height: 0, duration: 0 });
  const [currentTime, setCurrentTime] = useState(0);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(false);
  const [fit, setFit] = useState(true);
  const [loading, setLoading] = useState(true);
  const [hasFrame, setHasFrame] = useState(false);
  const [poster, setPoster] = useState(() => projectId ? cachedThumbnailUrl(media, projectId) : "");
  const [failed, setFailed] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [range, setRange] = useState<TrimRange>({ start: 0, end: 0 });
  const rangeRef = useRef(range); rangeRef.current = range;
  const [past, setPast] = useState<TrimRange[]>([]), [future, setFuture] = useState<TrimRange[]>([]);
  const gesture = useRef<TrimRange | null>(null);
  const [dragging, setDragging] = useState(false);
  const [trimLoop, setTrimLoop] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [resultOpen, setResultOpen] = useState(false);
  const frames = useVideoTrimFrames(imageUrl(media), editing && metadata.width > 0, metadata.duration);
  const [outputName, setOutputName] = useState(() => `${media.name.replace(/\.[^.]+$/, "")} · 裁剪`);
  const [previewing, setPreviewing] = useState(false);
  const [saved, setSaved] = useState<Media | null>(null);
  const saveInFlight = useRef(false);
  const currentIndex = videos.findIndex(item => item.id === media.id);
  const canNavigate = !editing && videos.length > 1 && currentIndex >= 0 && !!onMediaChange;
  const ready = metadata.width > 0 && !failed;
  const canEdit = ready && !!projectId && allowEdit && Number.isFinite(metadata.duration) && metadata.duration >= 0.05;
  const validRange = range.start >= 0 && range.end <= metadata.duration && range.end - range.start >= 0.05 - 1e-8;
  const seek = (value: number) => {
    if (!player.current || saving) return;
    const next = clamp(value, 0, metadata.duration || 0);
    player.current.pause(); setPreviewing(false);
    player.current.currentTime = next; setCurrentTime(next);
  };
  const applyRange = (next: TrimRange, at = next.start, record = true) => {
    const previous = rangeRef.current;
    if (previous.start === next.start && previous.end === next.end) return;
    if (record && !gesture.current) setPast(items => [...items.slice(-39), previous]);
    if (record && !gesture.current) setFuture([]);
    rangeRef.current = next; setRange(next); setSaved(null); setSaveError(""); seek(at);
  };
  const changeRange = (edge: "start" | "end", value: number) => {
    if (saving || !Number.isFinite(value)) return;
    const previous = rangeRef.current;
    const next = clamp(value, edge === "start" ? 0 : previous.start + MIN_TRIM, edge === "start" ? previous.end - MIN_TRIM : metadata.duration);
    applyRange({...previous, [edge]:next}, next);
  };
  const beginGesture = () => { if (!gesture.current) { gesture.current = rangeRef.current; setDragging(true); player.current?.pause(); } };
  const endGesture = (cancel = false) => {
    const before = gesture.current; gesture.current = null; setDragging(false);
    if (!before) return;
    if (cancel) { applyRange(before, before.start, false); return; }
    const next = rangeRef.current;
    if (before.start !== next.start || before.end !== next.end) { setPast(items => [...items.slice(-39),before]); setFuture([]); }
  };
  const undo = () => {
    if (saving || dragging || !past.length) return;
    const current = rangeRef.current, previous = past[past.length-1];
    setPast(items => items.slice(0,-1)); setFuture(items => [current,...items]); applyRange(previous, previous.start, false);
  };
  const redo = () => {
    if (saving || dragging || !future.length) return;
    const current = rangeRef.current, next = future[0];
    setFuture(items => items.slice(1)); setPast(items => [...items,current]); applyRange(next, next.start, false);
  };
  const togglePlay = (restart = false) => {
    const video = player.current;
    if (!video || !ready || saving || dragging) return;
    if (!video.paused) { video.pause(); return; }
    if (editing && (restart || video.currentTime < range.start || video.currentTime >= range.end - 0.001)) video.currentTime = range.start;
    void video.play().catch(error => { if (error?.name !== "AbortError") Message.warning("暂时无法播放，请稍后重试"); });
  };
  // Use the media clock for the playhead, and enforce the out point without waiting for timeupdate.
  useEffect(() => {
    if (!editing) return;
    let frame = 0;
    const tick = () => {
      const video = player.current;
      if (video && !video.paused) {
        if (video.currentTime >= range.end) {
          if (trimLoop) video.currentTime = range.start;
          else { video.pause(); video.currentTime = range.end; setPreviewing(false); }
        }
        setCurrentTime(video.currentTime);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [editing, range.start, range.end, trimLoop]);
  const saveTrim = async () => {
    if (!projectId || !validRange || !outputName.trim() || saveInFlight.current || dragging || saved) return;
    saveInFlight.current = true;
    player.current?.pause(); setPreviewing(false); setSaving(true); setSaveError("");
    try {
      const result = await post<Media>("/media/trim-video", { project_id: projectId, media_id: media.id, start: range.start, end: range.end, name: outputName.trim() });
      setSaved(result);
      window.dispatchEvent(new CustomEvent("spielberg:media-saved", { detail: { projectId, media: result } }));
    } catch (error) { setSaveError(`裁剪保存失败：${error instanceof Error ? error.message : String(error)}`); }
    finally { saveInFlight.current = false; setSaving(false); }
  };
  const move = useCallback((offset: number) => {
    if (canNavigate) onMediaChange?.(videos[(currentIndex + offset + videos.length) % videos.length]);
  }, [canNavigate, currentIndex, videos, onMediaChange]);
  useEffect(() => {
    const video = player.current;
    return () => { video?.pause(); };
  }, []);
  useEffect(() => {
    if (!projectId) return;
    let active = true;
    void loadThumbnailUrl(media, projectId).then(url => { if (active) setPoster(url); }).catch(() => {});
    return () => { active = false; };
  }, [projectId, media.id, media.path]);
  useEffect(() => {
    if (autoPlay) void player.current?.play().catch(() => {});
  }, [autoPlay]);
  const frameLoaded = (video: HTMLVideoElement) => {
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      setHasFrame(true);
      setLoading(false);
    }
  };

  const download = async () => {
    setDownloading(true);
    try {
      const response = await fetch(imageUrl(media));
      if (!response.ok) throw new Error(`下载失败：${response.status}`);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = /\.[a-z0-9]+$/i.test(media.name) ? media.name : `${media.name}.${media.path.split(".").pop() || "mp4"}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { Message.error(String(error)); }
    finally { setDownloading(false); }
  };
  return <div className="video-preview-content" tabIndex={-1} onKeyDown={event => {
    if (!editing || !event.currentTarget.contains(event.target as Node) || event.defaultPrevented || event.nativeEvent.isComposing || resultOpen) return;
    const target=event.target as HTMLElement, modifier=event.ctrlKey||event.metaKey;
    if (target.closest('input,textarea,select,[contenteditable="true"],[role="combobox"]')) return;
    if (saving || dragging) return;
    if(modifier&&event.key.toLowerCase()==="z"){event.preventDefault();event.shiftKey?redo():undo();return;}
    if(target.closest('[role="slider"]')||modifier||event.altKey)return;
    if(event.code==="Space"&&!target.closest("button")){event.preventDefault();togglePlay();}
    else if(event.key==="ArrowLeft"||event.key==="ArrowRight"){event.preventDefault();seek(currentTime+(event.key==="ArrowRight"?1:-1)*(event.shiftKey?1:1/30));}
    else if(event.key.toLowerCase()==="i"){event.preventDefault();changeRange("start",currentTime);}
    else if(event.key.toLowerCase()==="o"){event.preventDefault();changeRange("end",currentTime);}
  }}>
    <div className="video-preview-topbar">
    <div className="video-preview-header image-preview-heading">
      <span className="image-preview-file-icon"><Film size={20} /></span>
      <div><strong title={media.name || title}>{media.name || title}{editing && <em className="video-preview-edit-badge">裁剪</em>}</strong><span>{ready ? `${title === "视频预览" ? "" : `${title} · `}${metadata.width} × ${metadata.height} px · ${time(metadata.duration)}` : title}</span></div>
    </div>
    <div className="image-preview-toolbar" role="toolbar" aria-label="视频预览工具">
      <div className="image-preview-tools">
        {!editing && <Button disabled={!ready || saving} aria-label="从头播放" onClick={() => { if (player.current) { player.current.currentTime = 0; void player.current.play().catch(() => Message.warning("请点击播放开始观看")); } }} icon={<RotateCcw size={16} />} />}
        <Button disabled={!ready || saving} className={fit ? "is-active" : ""} onClick={() => setFit(true)} title="适应窗口" icon={<Maximize size={16} />}>适应窗口</Button>
        <Button disabled={!ready || saving} className={!fit ? "is-active" : ""} onClick={() => setFit(false)} title="原始尺寸">1:1</Button>
        {!editing && <><span className="image-preview-divider" />
        <Select className="video-preview-speed" aria-label="播放速度" value={speed} disabled={!ready || saving} options={[0.5, 0.75, 1, 1.25, 1.5, 2].map(value => ({ value, label: `${value}×` }))}
          onChange={value => { setSpeed(value); if (player.current) player.current.playbackRate = value; }} />
        <Button disabled={!ready || !allowLoop || editing || saving} aria-pressed={allowLoop && loop} className={allowLoop && loop ? "is-active" : ""} onClick={() => setLoop(value => !value)} icon={<Repeat size={16} />}>循环</Button>
        <Button disabled={!ready || saving} aria-label={muted ? "取消静音" : "静音"} title="静音" onClick={() => { if (player.current) player.current.muted = !player.current.muted; }} icon={muted ? <VolumeX size={16} /> : <Volume2 size={16} />} /></>}
      </div>
      <div className="image-preview-tools image-preview-actions">{!editing && toolbar}{projectId && allowEdit && <Button type={editing ? "secondary" : "primary"} disabled={!canEdit || saving} aria-pressed={editing} icon={<Scissors size={16} />} onClick={() => {
        player.current?.pause(); setLoop(false);
        if (!editing && range.end === 0) { const initial = {start:0,end:metadata.duration}; rangeRef.current=initial;setRange(initial); }
        setEditing(!editing);
      }}>{editing ? "返回预览" : "编辑 / 裁剪"}</Button>}{!editing && <Button loading={downloading} disabled={saving} icon={<Download size={16} />} onClick={() => void download()}>下载</Button>}</div>
    </div>
    <Button className="video-preview-close" aria-label="关闭视频预览" disabled={saving} onClick={onClose}>关闭</Button>
    </div>
    <div className="image-preview-stage video-preview-stage">
      {canNavigate && <button type="button" className="image-preview-nav is-previous" aria-label="上一个视频" title="上一个视频（←）" onClick={() => move(-1)}><ChevronLeft size={24} /></button>}
      <div className={`video-preview-viewport${fit ? "" : " is-actual-size"}`} aria-label="视频画布">
        <video ref={player} src={`${imageUrl(media)}#t=0.001`} poster={!hasFrame ? poster || undefined : undefined} aria-label={media.name} controls={!editing && !saving} playsInline preload="auto" autoPlay={autoPlay} loop={!editing && allowLoop && loop}
          style={!fit && ready ? { width: metadata.width, height: metadata.height } : undefined}
          onClick={() => { if (editing) togglePlay(); }}
          onLoadedMetadata={event => {
            const video = event.currentTarget;
            setMetadata({ width: video.videoWidth, height: video.videoHeight, duration: video.duration });
            if (Number.isFinite(video.duration) && video.duration >= MIN_TRIM) {
              const previous=rangeRef.current;
              const end=previous.end>0?Math.min(previous.end,video.duration):video.duration;
              const next={start:clamp(previous.start,0,end-MIN_TRIM),end};
              if(previous.start!==next.start||previous.end!==next.end){
                rangeRef.current=next;setRange(next);setSaved(null);setPast([]);setFuture([]);
              }
            }
            video.playbackRate = speed;
            if (initialTime > 0 && Number.isFinite(video.duration)) video.currentTime = Math.min(initialTime, video.duration);
          }}
          onLoadedData={event => frameLoaded(event.currentTarget)} onSeeked={event => frameLoaded(event.currentTarget)} onCanPlay={event => frameLoaded(event.currentTarget)}
          onWaiting={() => setLoading(true)} onPlaying={() => { setHasFrame(true); setLoading(false); }}
          onPlay={event => {
            if (!editing) return;
            if (saving) { event.currentTarget.pause(); return; }
            if (event.currentTarget.currentTime < range.start || event.currentTarget.currentTime >= range.end) event.currentTarget.currentTime = range.start;
            setPreviewing(true);
          }} onPause={() => setPreviewing(false)} onEnded={() => {
            setPreviewing(false);
            if (editing && trimLoop && !saving) { const video=player.current;if(video){video.currentTime=range.start;void video.play().catch(()=>{});} }
            else if (!editing) onEnded?.();
          }}
          onVolumeChange={event => setMuted(event.currentTarget.muted)} onRateChange={event => setSpeed(event.currentTarget.playbackRate)}
          onTimeUpdate={event => setCurrentTime(event.currentTarget.currentTime)} onError={() => { setFailed(true); setLoading(false); }} />
      </div>
      {((loading && !hasFrame && !poster) || failed) && <div className={`image-preview-placeholder video-preview-placeholder${failed ? " is-error" : ""}`} role={failed ? "alert" : "status"}>
        <Film size={28} /><span>{failed ? "视频加载失败，请检查文件或更换版本" : "正在加载视频…"}</span>
        {failed && <Button onClick={() => { setFailed(false); setLoading(true); setHasFrame(false); setMetadata({ width: 0, height: 0, duration: 0 }); player.current?.load(); }}>重新加载</Button>}
      </div>}
      {editing && !previewing && hasFrame && !failed && !saving && <button type="button" className="video-trim-stage-play" aria-label="播放裁剪预览" onClick={() => togglePlay()}><Play size={24} fill="currentColor" /></button>}
      {canNavigate && <button type="button" className="image-preview-nav is-next" aria-label="下一个视频" title="下一个视频（→）" onClick={() => move(1)}><ChevronRight size={24} /></button>}
    </div>
    {editing && <section className="video-trim-panel" aria-label="视频裁剪" tabIndex={0}>
      <div className="video-trim-heading"><strong><Scissors size={16} />裁剪片段</strong><span>拖动两端保留需要的画面</span><b className="video-trim-duration">已选 {preciseTime(range.end-range.start)}<small> / {preciseTime(metadata.duration)}</small></b></div>
      <div className="video-trim-playback">
        <Button type="primary" disabled={saving || dragging || !ready || !validRange} icon={previewing ? <Pause size={16} /> : <Play size={16} />} onClick={() => togglePlay(true)}>{previewing ? "暂停片段" : "预览选中片段"}</Button>
        <span className="video-trim-time">{preciseTime(currentTime)}<small> / {preciseTime(metadata.duration)}</small></span>
        <div className="video-trim-playback-tools">
          <Button aria-label="上一帧" title="上一帧（←）" disabled={saving || !ready} icon={<SkipBack size={15} />} onClick={() => seek(currentTime-1/30)} />
          <Button aria-label="下一帧" title="下一帧（→）" disabled={saving || !ready} icon={<SkipForward size={15} />} onClick={() => seek(currentTime+1/30)} />
          <Select className="video-preview-speed" aria-label="裁剪播放速度" value={speed} disabled={saving || !ready} options={[0.5,0.75,1,1.25,1.5,2].map(value=>({value,label:`${value}×`}))} onChange={value=>{setSpeed(value);if(player.current)player.current.playbackRate=value;}} />
          <Button aria-label="循环片段" title="循环播放选中范围" aria-pressed={trimLoop} className={trimLoop ? "is-active" : ""} disabled={saving} icon={<Repeat size={15} />} onClick={()=>setTrimLoop(value=>!value)} />
          <Button aria-label={muted ? "取消静音" : "静音"} disabled={saving} icon={muted ? <VolumeX size={15}/> : <Volume2 size={15}/>} onClick={()=>{if(player.current)player.current.muted=!player.current.muted;}} />
        </div>
      </div>
      <VideoTrimTimeline duration={metadata.duration} start={range.start} end={range.end} currentTime={currentTime} disabled={saving || !ready} frames={frames} onChange={changeRange} onSeek={seek} onGestureStart={beginGesture} onGestureEnd={endGesture}/>
      <div className="video-trim-fields">
        <div className="video-trim-point"><label>起点 <TrimTimeField label="裁剪起点" value={range.start} min={0} max={range.end-MIN_TRIM} disabled={saving || dragging} onCommit={value=>changeRange("start",value)}/><span>秒</span></label><Button size="small" aria-label="当前帧设为起点" title="当前帧设为起点（I）" disabled={saving || dragging || currentTime>=range.end-MIN_TRIM} onClick={()=>changeRange("start",currentTime)}>设为当前帧</Button></div>
        <div className="video-trim-point"><label>终点 <TrimTimeField label="裁剪终点" value={range.end} min={range.start+MIN_TRIM} max={metadata.duration} disabled={saving || dragging} onCommit={value=>changeRange("end",value)}/><span>秒</span></label><Button size="small" aria-label="当前帧设为终点" title="当前帧设为终点（O）" disabled={saving || dragging || currentTime<=range.start+MIN_TRIM} onClick={()=>changeRange("end",currentTime)}>设为当前帧</Button></div>
        <div className="video-trim-history"><Button aria-label="撤销裁剪" title="撤销裁剪（⌘ / Ctrl Z）" disabled={saving || dragging || !past.length} icon={<Undo2 size={15}/>} onClick={undo}/><Button aria-label="重做裁剪" title="重做裁剪（⇧⌘ / Ctrl Z）" disabled={saving || dragging || !future.length} icon={<Redo2 size={15}/>} onClick={redo}/><Button disabled={saving || dragging || range.start===0&&range.end===metadata.duration} onClick={()=>applyRange({start:0,end:metadata.duration})}>重置范围</Button></div>
      </div>
      <div className="video-trim-actions">
        <label className="video-trim-name">保存名称<input aria-label="裁剪视频名称" maxLength={100} value={outputName} disabled={saving} onChange={event=>{setOutputName(event.target.value);setSaved(null);setSaveError("");}}/></label>
        <span className="video-trim-save-note">另存为新视频 · 原素材保留</span>
        <Button type="primary" icon={saved ? <CheckCircle2 size={16}/> : <Save size={16}/>} loading={saving} disabled={!ready || !validRange || !outputName.trim() || !!saved || dragging} onClick={()=>void saveTrim()}>{saved ? "已保存" : "保存为新素材"}</Button>
      </div>
      {saving && <div className="video-trim-feedback" role="status">正在裁剪并保存，请稍候…</div>}
      {saveError && <div className="video-trim-feedback is-error" role="alert"><span>{saveError}</span><Button size="small" disabled={saving} onClick={()=>void saveTrim()}>重试保存</Button></div>}
      {saved && <div className="video-trim-feedback is-success" role="status"><CheckCircle2 size={16}/><span>已保存：{saved.name}</span><Button size="small" onClick={()=>{player.current?.pause();setPreviewing(false);setResultOpen(true);}}>预览结果</Button></div>}
      <div className="video-trim-shortcuts"><span>空格 播放 / 暂停 · ← → 微调播放位置 · I / O 标记起止点</span><span>⌘ / Ctrl Z 撤销 · Esc 关闭</span></div>
    </section>}
    {!editing && <div className="image-preview-status"><span>{time(currentTime)} / {time(metadata.duration)}<i />{fit ? "适应窗口" : "原始尺寸"}<i />{canNavigate && <>← / → 切换<i /></>}{saving ? "正在保存…" : "Esc 关闭"}</span></div>}
    {!editing && (canNavigate || footer) && <div className="video-preview-bottom-bar">
    {canNavigate && <div className="image-preview-filmstrip video-preview-filmstrip" aria-label="视频列表">
      <span className="image-preview-position" aria-live="polite">{currentIndex + 1} / {videos.length}</span>
      <div>{videos.map((item, index) => <button type="button" key={item.id} title={item.name} aria-label={`查看第 ${index + 1} 个视频：${item.name}`} aria-pressed={item.id === media.id}
        onClick={() => onMediaChange?.(item)} ref={element => { if (item.id === media.id) element?.scrollIntoView({ block: "nearest", inline: "nearest" }); }}>
        {projectId ? <AssetThumbnail media={item} projectId={projectId} /> : <Film size={20} />}<span>{index + 1}</span>
      </button>)}</div>

    </div>}
    {footer && <div className="video-preview-footer-actions">{footer}</div>}
    </div>}
    {saved && <VideoPreviewModal media={resultOpen ? saved : null} projectId={projectId} allowEdit={false} onClose={()=>setResultOpen(false)}/>}
  </div>;
}

export function PreviewVideo({ media, projectId, ...props }: Omit<VideoHTMLAttributes<HTMLVideoElement>, "src"> & { media: Media; projectId?: string }) {
  const inline = useRef<HTMLVideoElement>(null);
  const [open, setOpen] = useState(false);
  const [initialTime, setInitialTime] = useState(0);
  const show = () => { setInitialTime(inline.current?.currentTime || 0); inline.current?.pause(); setOpen(true); };
  return <div className="video-result-preview" onPointerDown={event => event.stopPropagation()}>
    <video {...props} ref={inline} src={imageUrl(media)} controls playsInline preload={props.preload || "metadata"} onDoubleClick={event => { event.preventDefault(); show(); }} />
    <Button className="video-result-expand" size="small" aria-label={`放大预览 ${media.name}`} icon={<Maximize size={14} />} onClick={show}>放大预览</Button>
    <VideoPreviewModal media={open ? media : null} projectId={projectId} initialTime={initialTime} onClose={() => setOpen(false)} />
  </div>;
}
