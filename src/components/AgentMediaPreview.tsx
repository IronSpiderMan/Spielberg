import { Maximize, Music2 } from "lucide-react";
import { useState } from "react";
import { imageUrl, type Media } from "../core";

export function AgentMediaPreview({ media, onPreview, onLoad, inline = false }: {
  media: Media; onPreview: (media: Media) => void; onLoad?: () => void; inline?: boolean;
}) {
  const src = imageUrl(media);
  const [failedSource, setFailedSource] = useState("");
  const failed = failedSource === src;
  const content = <>
    {failed ? <span className="agent-media-error" role="status">媒体加载失败，<a href={src} target="_blank" rel="noopener noreferrer">打开原文件</a></span>
      : media.kind === "image" ? <button type="button" className="agent-media-image" aria-label={`预览 ${media.name}`} onClick={() => onPreview(media)}>
        <img src={src} alt={media.name} loading="lazy" onLoad={onLoad} onError={() => setFailedSource(src)} />
      </button> : media.kind === "video" ? <>
        <video src={src} aria-label={`播放 ${media.name}`} controls playsInline preload="metadata" onLoadedMetadata={onLoad} onError={() => setFailedSource(src)} />
        <button type="button" className="agent-media-expand" aria-label={`放大预览 ${media.name}`} onClick={event => {
          event.currentTarget.parentElement?.querySelector("video")?.pause(); onPreview(media);
        }}><Maximize size={14} />放大预览</button>
      </> : <audio src={src} aria-label={`试听 ${media.name}`} controls preload="none" onError={() => setFailedSource(src)} />}
    <span className="agent-media-name">{media.kind === "audio" && <Music2 size={14} aria-hidden="true" />}{media.name}</span>
  </>;
  const className = `agent-media-preview is-${media.kind}`;
  return inline ? <span className={className}>{content}</span> : <div className={className}>{content}</div>;
}
