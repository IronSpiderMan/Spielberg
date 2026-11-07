import { Button, Modal } from "@arco-design/web-react";
import { Check, CheckCircle2, Music, Pause, Play, RotateCcw, Save, Scissors, AudioLines, LoaderCircle } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { imageUrl, post, type Media } from "../core";
import { AudioWaveform, useAudioWaveform } from "./AudioWaveform";
import { TrimTimeField } from "./TrimTimeField";
import { VideoTrimTimeline } from "./VideoTrimTimeline";
import "./video-preview.css";
import "./audio-preview.css";

type Props = {media: Media | null; projectId?: string; onClose: () => void; allowEdit?: boolean; initialEditing?: boolean};
const MIN = 0.05;
const time = (value: number) => {
  const ticks = Math.round(Math.max(0, Number.isFinite(value) ? value : 0)*100);
  return `${Math.floor(ticks/6000).toString().padStart(2,"0")}:${(ticks%6000/100).toFixed(2).padStart(5,"0")}`;
};
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

export function AudioPreviewModal(props: Props) {
  const [saving, setSaving] = useState(false);
  useEffect(()=>setSaving(false), [props.media?.id, props.media?.path]);
  return <Modal className="audio-preview-modal" visible={!!props.media} title={props.allowEdit !== false && props.projectId ? "音频预览与裁剪" : "音频预览"} footer={null} unmountOnExit
    style={{width: 960, maxWidth: "calc(100vw - 32px)"}} closable={!saving} escToExit={!saving} maskClosable={!saving} onCancel={()=>{if(!saving)props.onClose();}}>
    {props.media && <AudioPreview key={`${props.media.id}:${props.media.path}`} {...props} media={props.media} saving={saving} setSaving={setSaving}/>}
  </Modal>;
}

function AudioPreview({media, projectId, allowEdit = true, initialEditing = false, saving, setSaving}: Props & {media: Media; saving: boolean; setSaving: (value: boolean)=>void}) {
  const [source, setSource] = useState(media);
  const player = useRef<HTMLAudioElement>(null);
  const [editing, setEditing] = useState(initialEditing);
  const [duration, setDuration] = useState(0), [currentTime, setCurrentTime] = useState(0);
  const [range, setRange] = useState({start: 0, end: 0});
  const rangeRef = useRef(range); rangeRef.current = range;
  const [playing, setPlaying] = useState(false), [failed, setFailed] = useState(false), [dragging, setDragging] = useState(false);
  const [name, setName] = useState(`${media.name.replace(/\.[^.]+$/, "")} · 裁剪`);
  const [overwrite, setOverwrite] = useState(false), [error, setError] = useState("");
  const [saved, setSaved] = useState<Media | null>(null);
  const [resultOpen, setResultOpen] = useState(false);
  const waveform = useAudioWaveform(source, projectId, editing);
  const saveModeId = useId();
  const inFlight = useRef(false);
  const gestureRange = useRef<{start: number; end: number} | null>(null);
  const ready = !failed && Number.isFinite(duration) && duration >= MIN;
  const valid = ready && range.start >= 0 && range.end <= duration && range.end - range.start >= MIN - 1e-8;
  const changed = () => {setSaved(null); setError("");};
  const seek = (value: number) => {
    if (!player.current || saving || !ready) return;
    const next = clamp(value, 0, duration); player.current.currentTime = next; setCurrentTime(next);
  };
  const changeRange = (edge: "start" | "end", value: number) => {
    if (saving || !ready) return;
    player.current?.pause();
    const old = rangeRef.current;
    const next = edge === "start" ? {...old, start: clamp(value, 0, old.end - MIN)} : {...old, end: clamp(value, old.start + MIN, duration)};
    rangeRef.current = next; setRange(next); changed(); seek(next[edge]);
  };
  useEffect(()=>{
    if (!editing) return;
    let frame = 0;
    const tick = () => {
      const audio = player.current;
      if (audio && !audio.paused) {
        if (audio.currentTime >= rangeRef.current.end) {audio.pause(); audio.currentTime = rangeRef.current.end;}
        setCurrentTime(audio.currentTime);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return ()=>cancelAnimationFrame(frame);
  }, [editing]);
  useEffect(()=>{const audio = player.current; return ()=>audio?.pause();}, []);
  const toggle = () => {
    const audio = player.current;
    if (!audio || !valid || saving || dragging) return;
    if (!audio.paused) {audio.pause(); return;}
    if (audio.currentTime < range.start || audio.currentTime >= range.end - 0.001) audio.currentTime = range.start;
    void audio.play().catch(()=>setError("无法播放音频，请重新加载后重试"));
  };
  const save = async () => {
    if (!projectId || !valid || (!overwrite && !name.trim()) || inFlight.current || dragging || saved) return;
    inFlight.current = true; setSaving(true); setError(""); player.current?.pause();
    try {
      const result = await post<Media>("/media/trim-audio", {project_id: projectId, media_id: source.id, source_path: source.path, start: range.start, end: range.end, name: name.trim(), overwrite});
      setSaved(result);
      if (overwrite) {setSource(result); setDuration(0); setCurrentTime(0); const next = {start: 0, end: 0}; rangeRef.current = next; setRange(next);}
      window.dispatchEvent(new CustomEvent("spielberg:media-saved", {detail: {projectId, media: result}}));
    } catch (e) {setError(`裁剪保存失败：${e instanceof Error ? e.message : String(e)}`);}
    finally {inFlight.current = false; setSaving(false);}
  };
  const resetRange = () => {
    player.current?.pause(); const next = {start:0,end:duration};
    rangeRef.current=next;setRange(next);changed();seek(0);
  };
  const selectedDuration = Math.max(0,range.end-range.start);
  return <div className={`audio-preview-content${editing ? " is-editing" : ""}`} onKeyDown={event=>{
    const target = event.target as HTMLElement;
    if (!editing || saving || dragging || event.defaultPrevented || event.nativeEvent.isComposing || event.ctrlKey || event.metaKey || event.altKey || target.closest('input,button,select,textarea,[role="slider"]')) return;
    if (event.code === "Space") {event.preventDefault();toggle();}
    else if (event.key.toLowerCase() === "i") {event.preventDefault();changeRange("start",currentTime);}
    else if (event.key.toLowerCase() === "o") {event.preventDefault();changeRange("end",currentTime);}
  }}>
    <div className="audio-preview-summary">
      <span className="audio-file-icon"><Music size={23}/></span>
      <div className="audio-file-copy"><strong title={source.name}>{source.name}</strong><span>{source.path.split(".").pop()?.toUpperCase()} 音频<i/>{duration > 0 ? `总时长 ${time(duration)}` : "正在读取音频…"}</span></div>
      {allowEdit && projectId && <Button icon={editing ? <Music size={15}/> : <Scissors size={15}/>} disabled={!ready || saving} onClick={()=>{player.current?.pause(); setEditing(!editing);}}>{editing ? "返回预览" : "编辑 / 裁剪"}</Button>}
    </div>
    <audio className="audio-native-player" key={source.path} ref={player} controls={!editing} preload="metadata" src={imageUrl(source)} aria-label="素材音频预览"
      onLoadedMetadata={event=>{const value = event.currentTarget.duration; if(!Number.isFinite(value) || value <= 0){setFailed(true);return;} setFailed(false); setDuration(value); if(rangeRef.current.end === 0){const next = {start: 0, end: value}; rangeRef.current = next; setRange(next);}}}
      onTimeUpdate={event=>setCurrentTime(event.currentTarget.currentTime)} onPlay={event=>{if(saving){event.currentTarget.pause();return;} if(editing && (event.currentTarget.currentTime < range.start || event.currentTarget.currentTime >= range.end))event.currentTarget.currentTime = range.start; setPlaying(true);}}
      onPause={()=>setPlaying(false)} onEnded={()=>setPlaying(false)} onError={()=>{setFailed(true); setPlaying(false);}}/>
    {failed && <div role="alert" className="audio-editor-feedback is-error">音频加载失败<Button onClick={()=>{setFailed(false); player.current?.load();}}>重新加载</Button></div>}
    {editing && <section className="audio-trim-editor" aria-label="音频裁剪">
      <div className="audio-waveform-workspace">
        <div className="audio-workspace-heading"><strong><AudioLines size={17}/>波形与裁剪</strong><span className="audio-selection-badge"><Scissors size={13}/>保留 {time(selectedDuration)}</span></div>
        <div className="audio-playback-toolbar">
          <Button type="primary" icon={playing ? <Pause size={16}/> : <Play size={16}/>} disabled={!valid || saving || dragging} onClick={toggle}>{playing ? "暂停片段" : "预览选中片段"}</Button>
          <span className="audio-playback-clock"><b>{time(currentTime)}</b><span>/ {time(duration)}</span></span>
          <Button className="audio-reset-range" type="text" icon={<RotateCcw size={14}/>} disabled={!ready || saving || dragging} onClick={resetRange}>重置范围</Button>
        </div>
        <VideoTrimTimeline label="音频裁剪时间轴" duration={duration} start={range.start} end={range.end} currentTime={currentTime} disabled={!ready || saving} onChange={changeRange} onSeek={seek} onGestureStart={()=>{player.current?.pause();gestureRange.current=rangeRef.current;setDragging(true);}} onGestureEnd={cancel=>{if(cancel && gestureRange.current){rangeRef.current=gestureRange.current;setRange(gestureRange.current);}gestureRange.current=null;setDragging(false);}}>
          {waveform.data ? <AudioWaveform data={waveform.data} start={range.start} end={range.end} duration={duration}/> : <div className={`audio-waveform-placeholder${waveform.error ? " is-error" : ""}`} role={waveform.error ? "alert" : "status"}>
            {waveform.error ? <><AudioLines size={22}/><span>波形暂时无法加载</span></> : <><LoaderCircle size={20} className="audio-waveform-spinner"/><span>正在分析音频波形…</span></>}
          </div>}
        </VideoTrimTimeline>
        <div className="audio-waveform-caption"><div className="audio-waveform-legend"><span><i className="is-sound"/>有声波形</span><span title="峰值低于 −50 dB 的区域；不会自动删除声音"><i className="is-silent"/>静音 / 极低音量</span></div><span>拖动两端裁剪 · 点击波形定位</span></div>
        {waveform.error && <div className="audio-waveform-error" role="alert"><span>{waveform.error}</span><Button size="small" onClick={waveform.retry}>重新加载波形</Button></div>}
      </div>
      <div className="audio-range-editor">
        <div className="audio-range-point"><span className="audio-range-label">起点 <span>IN</span></span><div><TrimTimeField label="音频裁剪起点" value={range.start} min={0} max={Math.max(0,range.end-MIN)} disabled={!ready || saving || dragging} onCommit={value=>changeRange("start",value)}/><span>秒</span><Button type="text" size="small" title="将播放头设为起点（I）" disabled={!ready || saving || dragging || currentTime>range.end-MIN} onClick={()=>changeRange("start",currentTime)}>设为当前</Button></div></div>
        <div className="audio-range-point"><span className="audio-range-label">终点 <span>OUT</span></span><div><TrimTimeField label="音频裁剪终点" value={range.end} min={range.start+MIN} max={duration} disabled={!ready || saving || dragging} onCommit={value=>changeRange("end",value)}/><span>秒</span><Button type="text" size="small" title="将播放头设为终点（O）" disabled={!ready || saving || dragging || currentTime<range.start+MIN} onClick={()=>changeRange("end",currentTime)}>设为当前</Button></div></div>
        <div className="audio-range-length"><span>选中时长</span><strong>{time(selectedDuration)}</strong><small>共 {selectedDuration.toFixed(2)} 秒</small></div>
      </div>
      <div className="audio-save-section">
        <div className="audio-save-heading"><strong>保存裁剪</strong><span>WAV 音频</span></div>
        <fieldset className="audio-save-modes" aria-label="音频保存方式" disabled={saving}>
          <label className={`audio-save-card${!overwrite ? " is-selected" : ""}`}><input type="radio" name={saveModeId} aria-label="另存为新素材" checked={!overwrite} onChange={()=>{setOverwrite(false);changed();}}/><span className="audio-save-card-copy"><strong>另存为新素材</strong><small>加入素材库，保留原音频</small></span>{!overwrite && <Check size={15}/>}</label>
          <label className={`audio-save-card${overwrite ? " is-selected" : ""}`}><input type="radio" name={saveModeId} aria-label="覆盖原素材" checked={overwrite} onChange={()=>{setOverwrite(true);changed();}}/><span className="audio-save-card-copy"><strong>覆盖原素材</strong><small>已有引用同步使用裁剪结果</small></span>{overwrite && <Check size={15}/>}</label>
        </fieldset>
        <div className="audio-save-footer"><label className="audio-output-name">{overwrite ? "素材名称" : "保存名称"}<input aria-label="裁剪音频名称" maxLength={100} value={overwrite ? source.name : name} disabled={saving || overwrite} onChange={event=>{setName(event.target.value);changed();}}/></label><Button type="primary" status={overwrite && !saved ? "warning" : undefined} icon={saved ? <CheckCircle2 size={16}/> : <Save size={16}/>} loading={saving} disabled={!valid || (!overwrite && !name.trim()) || !!saved || dragging} onClick={()=>void save()}>{saved ? "已保存" : overwrite ? "裁剪并覆盖素材" : "保存为新素材"}</Button></div>
        {saving && <div role="status" className="audio-editor-feedback"><LoaderCircle size={16} className="audio-waveform-spinner"/>正在裁剪并保存，请稍候…</div>}
        {error && <div role="alert" className="audio-editor-feedback is-error"><span>{error}</span><Button disabled={saving} onClick={()=>void save()}>重试保存</Button></div>}
        {saved && <div role="status" className="audio-editor-feedback is-success"><CheckCircle2 size={16}/><span>{overwrite ? "已覆盖" : "已保存到素材库"}：{saved.name}</span><Button size="small" onClick={()=>{player.current?.pause();setResultOpen(true);}}>试听结果</Button></div>}
      </div>
    </section>}
    {saved && <AudioPreviewModal media={resultOpen ? saved : null} allowEdit={false} onClose={()=>setResultOpen(false)}/>}
  </div>;
}
