import { Empty } from "@arco-design/web-react";
import { useEffect, useState } from "react";
import AssetThumbnail from "../AssetThumbnail";
import type { Media } from "../core";
import { ImagePreviewModal } from "./ImagePreviewModal";
import { VideoPreviewModal } from "./VideoPreviewModal";
import "./studio-media-library.css";

type MediaKind = "image" | "video";

// Keep completed media visible while the project refresh is still pending or fails.
export function useStudioMedia(media: Media[], kind: MediaKind) {
  const [pending, setPending] = useState<Media[]>([]);
  useEffect(() => {
    setPending(items => items.filter(item => !media.some(saved => saved.id === item.id)));
  }, [media]);
  const items = [...new Map([...pending, ...media].filter(item => item.kind === kind).map(item => [item.id, item])).values()]
    .sort((a, b) => b.id - a.id);
  const remember = (item: Media) => setPending(items => [item, ...items.filter(previous => previous.id !== item.id)]);
  return { items, remember };
}

export function StudioMediaLibrary({ kind, items, projectId }: { kind: MediaKind; items: Media[]; projectId: string }) {
  const [preview, setPreview] = useState<Media | null>(null);
  const label = kind === "image" ? "图片素材" : "视频素材";
  return <section className="studio-media-library" aria-label={label}>
    <h2>{label} <span>{items.length}</span></h2>
    {items.length ? <div className="studio-media-grid">
      {items.map(item => <button type="button" className="studio-media-item" key={item.id} aria-label={`预览 ${item.name}`} title={item.name} onClick={() => setPreview(item)}>
        <AssetThumbnail media={item} projectId={projectId} />
        <span className="studio-media-name">{item.name}</span>
      </button>)}
    </div> : <Empty description={kind === "image" ? "生成或导入的图片会显示在这里" : "生成或导入的视频会显示在这里"} />}
    {kind === "image" ? <ImagePreviewModal media={preview} images={items} onMediaChange={setPreview} onClose={() => setPreview(null)} />
      : <VideoPreviewModal media={preview} videos={items} projectId={projectId} onMediaChange={setPreview} onClose={() => setPreview(null)} />}
  </section>;
}
