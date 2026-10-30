import { Button, Message, Modal, Select } from "@arco-design/web-react";
import { ChevronLeft, ChevronRight, Download, Film, Maximize, Pause, Play, Repeat, RotateCcw, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode, type VideoHTMLAttributes } from "react";
import AssetThumbnail, { cachedThumbnailUrl, loadThumbnailUrl } from "../AssetThumbnail";
import { imageUrl, type Media } from "../core";
import "./image-preview.css";
import "./video-preview.css";

type Props = {
  media: Media | null;
  onClose: () => void;
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
};
const noVideos: Media[] = [];

function time(value: number) {
  const seconds = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function VideoPreviewModal({ visible, ...props }: Props) {
  const open = !!props.media && (visible ?? true);
  return <Modal className="image-preview-modal video-preview-modal is-fullscreen" wrapClassName="image-preview-wrapper" alignCenter={false}
    visible={open} title={props.media?.name || props.title || "视频预览"} closable={false} footer={props.footer ?? null} onCancel={props.onClose} unmountOnExit>
    {open && props.media && <VideoPreview key={`${props.playbackKey ?? ""}:${props.media.id}:${props.media.path}`} {...props} media={props.media} />}
  </Modal>;
}

function VideoPreview({ media, onClose, title = "视频预览", videos = noVideos, projectId, onMediaChange, toolbar, onEnded, allowLoop = true, autoPlay = false, initialTime = 0 }: Omit<Props, "visible"> & { media: Media }) {
  const player = useRef<HTMLVideoElement>(null);
  const [metadata, setMetadata] = useState({ width: 0, height: 0, duration: 0 });
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [loop, setLoop] = useState(false);
  const [fit, setFit] = useState(true);
  const [loading, setLoading] = useState(true);
  const [hasFrame, setHasFrame] = useState(false);
  const [poster, setPoster] = useState(() => projectId ? cachedThumbnailUrl(media, projectId) : "");
  const [failed, setFailed] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const currentIndex = videos.findIndex(item => item.id === media.id);
  const canNavigate = videos.length > 1 && currentIndex >= 0 && !!onMediaChange;
  const ready = metadata.width > 0 && !failed;
  const move = useCallback((offset: number) => {
    if (canNavigate) onMediaChange?.(videos[(currentIndex + offset + videos.length) % videos.length]);
  }, [canNavigate, currentIndex, videos, onMediaChange]);
  const play = useCallback(() => {
    const video = player.current;
    if (!video || failed) return;
    if (video.paused) void video.play().catch(() => Message.warning("暂时无法播放，请检查视频是否加载完成"));
    else video.pause();
  }, [failed]);
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
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey ||
        (event.target as HTMLElement).closest('input, textarea, select, [role="combobox"], [role="listbox"], [contenteditable="true"]')) return;
      // Native playback controls keep Space and arrow keys for their own actions.
      const target = event.target as HTMLElement;
      if ((event.code === "Space" && target.closest("button, video")) ||
        ((event.key === "ArrowLeft" || event.key === "ArrowRight") && target.closest("video"))) return;
      const video = player.current;
      if (!video) return;
      if (event.code === "Space") { event.preventDefault(); play(); }
      else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        if (!canNavigate) return;
        event.preventDefault(); move(event.key === "ArrowLeft" ? -1 : 1);
      } else if (["j", "l", "m", "0", "1"].includes(event.key.toLowerCase())) {
        event.preventDefault();
        switch (event.key.toLowerCase()) {
          case "j": case "l":
            if (ready && Number.isFinite(video.duration)) video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + (event.key.toLowerCase() === "j" ? -5 : 5)));
            break;
          case "m": video.muted = !video.muted; break;
          case "0": setFit(true); break;
          case "1": setFit(false); break;
        }
      }
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [canNavigate, move, play, ready]);
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
  return <>
    <div className="video-preview-header image-preview-heading">
      <span className="image-preview-file-icon"><Film size={20} /></span>
      <div><strong title={media.name || title}>{media.name || title}</strong><span>{ready ? `${title === "视频预览" ? "" : `${title} · `}${metadata.width} × ${metadata.height} px · ${time(metadata.duration)}` : title}</span></div>
      <Button className="video-preview-close" aria-label="关闭视频预览" onClick={onClose}>关闭</Button>
    </div>
    <div className="image-preview-toolbar" role="toolbar" aria-label="视频预览工具">
      <div className="image-preview-tools">
        <Button disabled={!ready} aria-label={playing ? "暂停" : "播放"} title="播放 / 暂停 (空格)" onClick={play} icon={playing ? <Pause size={16} /> : <Play size={16} />}>{playing ? "暂停" : "播放"}</Button>
        <Button disabled={!ready} aria-label="从头播放" onClick={() => { if (player.current) { player.current.currentTime = 0; void player.current.play().catch(() => Message.warning("请点击播放开始观看")); } }} icon={<RotateCcw size={16} />} />
        <Button disabled={!ready} className={fit ? "is-active" : ""} onClick={() => setFit(true)} title="适应窗口 (0)" icon={<Maximize size={16} />}>适应窗口</Button>
        <Button disabled={!ready} className={!fit ? "is-active" : ""} onClick={() => setFit(false)} title="原始尺寸 (1)">1:1</Button>
        <span className="image-preview-divider" />
        <Select className="video-preview-speed" aria-label="播放速度" value={speed} disabled={!ready} options={[0.5, 0.75, 1, 1.25, 1.5, 2].map(value => ({ value, label: `${value}×` }))}
          onChange={value => { setSpeed(value); if (player.current) player.current.playbackRate = value; }} />
        <Button disabled={!ready || !allowLoop} aria-pressed={allowLoop && loop} className={allowLoop && loop ? "is-active" : ""} onClick={() => setLoop(value => !value)} icon={<Repeat size={16} />}>循环</Button>
        <Button disabled={!ready} aria-label={muted ? "取消静音" : "静音"} title="静音 (M)" onClick={() => { if (player.current) player.current.muted = !player.current.muted; }} icon={muted ? <VolumeX size={16} /> : <Volume2 size={16} />} />
      </div>
      <div className="image-preview-tools image-preview-actions">{toolbar}<Button loading={downloading} icon={<Download size={16} />} onClick={() => void download()}>下载</Button></div>
    </div>
    <div className="image-preview-stage video-preview-stage">
      {canNavigate && <button type="button" className="image-preview-nav is-previous" aria-label="上一个视频" onClick={() => move(-1)}><ChevronLeft size={24} /></button>}
      <div className={`video-preview-viewport${fit ? "" : " is-actual-size"}`} aria-label="视频画布">
        <video ref={player} src={`${imageUrl(media)}#t=0.001`} poster={!hasFrame ? poster || undefined : undefined} aria-label={media.name} controls playsInline preload="auto" autoPlay={autoPlay} loop={allowLoop && loop}
          style={!fit && ready ? { width: metadata.width, height: metadata.height } : undefined}
          onLoadedMetadata={event => {
            const video = event.currentTarget;
            setMetadata({ width: video.videoWidth, height: video.videoHeight, duration: video.duration });
            video.playbackRate = speed;
            if (initialTime > 0 && Number.isFinite(video.duration)) video.currentTime = Math.min(initialTime, video.duration);
          }}
          onLoadedData={event => frameLoaded(event.currentTarget)} onSeeked={event => frameLoaded(event.currentTarget)} onCanPlay={event => frameLoaded(event.currentTarget)}
          onWaiting={() => setLoading(true)} onPlaying={() => { setPlaying(true); setHasFrame(true); setLoading(false); }}
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); onEnded?.(); }}
          onVolumeChange={event => setMuted(event.currentTarget.muted)} onRateChange={event => setSpeed(event.currentTarget.playbackRate)}
          onTimeUpdate={event => setCurrentTime(event.currentTarget.currentTime)} onError={() => { setFailed(true); setLoading(false); setPlaying(false); }} />
      </div>
      {((loading && !hasFrame && !poster) || failed) && <div className={`image-preview-placeholder video-preview-placeholder${failed ? " is-error" : ""}`} role={failed ? "alert" : "status"}>
        <Film size={28} /><span>{failed ? "视频加载失败，请检查文件或更换版本" : "正在加载视频…"}</span>
        {failed && <Button onClick={() => { setFailed(false); setLoading(true); setHasFrame(false); setMetadata({ width: 0, height: 0, duration: 0 }); player.current?.load(); }}>重新加载</Button>}
      </div>}
      {canNavigate && <button type="button" className="image-preview-nav is-next" aria-label="下一个视频" onClick={() => move(1)}><ChevronRight size={24} /></button>}
    </div>
    <div className="image-preview-status"><span>空格 播放 / 暂停 · J / L 后退 / 前进 5 秒 · M 静音</span><span>{time(currentTime)} / {time(metadata.duration)}<i />{fit ? "适应窗口" : "原始尺寸"}<i />Esc 关闭</span></div>
    {canNavigate && <div className="image-preview-filmstrip video-preview-filmstrip" aria-label="视频列表">
      <span className="image-preview-position" aria-live="polite">{currentIndex + 1} / {videos.length}</span>
      <div>{videos.map((item, index) => <button type="button" key={item.id} title={item.name} aria-label={`查看第 ${index + 1} 个视频：${item.name}`} aria-pressed={item.id === media.id}
        onClick={() => onMediaChange?.(item)} ref={element => { if (item.id === media.id) element?.scrollIntoView({ block: "nearest", inline: "nearest" }); }}>
        {projectId ? <AssetThumbnail media={item} projectId={projectId} /> : <Film size={20} />}<span>{index + 1}</span>
      </button>)}</div>
      <span className="image-preview-key-hint">← → 切换视频</span>
    </div>}
  </>;
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
