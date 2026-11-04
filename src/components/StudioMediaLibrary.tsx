import { Button, Empty, Input } from "@arco-design/web-react";
import { Search } from "lucide-react";
import { useEffect, useId, useState } from "react";
import AssetThumbnail from "../AssetThumbnail";
import type { Media } from "../core";
import { serializeStudioImageDrag, STUDIO_IMAGE_MIME } from "../studio-media-drag";
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

export function StudioMediaLibrary({ kind, items, projectId, imageDragDisabled = false }: {
  kind: MediaKind;
  items: Media[];
  projectId: string;
  imageDragDisabled?: boolean;
}) {
  const [preview, setPreview] = useState<Media | null>(null);
  const [query, setQuery] = useState("");
  const dragHintId = useId();
  useEffect(() => { setQuery(""); setPreview(null); }, [projectId, kind]);
  const label = kind === "image" ? "图片素材" : "视频素材";
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filtered = items.filter(item => item.name.toLocaleLowerCase().includes(normalizedQuery));
  const canDrag = kind === "image" && !imageDragDisabled;
  return <section className="studio-media-library" aria-label={label}>
    <h2>{label} <span role="status" aria-live="polite" aria-label={normalizedQuery ? `找到 ${filtered.length} 个，共 ${items.length} 个${label}` : `共 ${items.length} 个${label}`}>{normalizedQuery ? `${filtered.length} / ${items.length}` : items.length}</span></h2>
    <Input className="studio-media-search" value={query} onChange={setQuery} allowClear
      aria-label={`搜索${label}`} placeholder="搜索素材名称" prefix={<Search size={14} aria-hidden="true" />} />
    {kind === "image" && <p className="studio-media-drag-hint" id={dragHintId}>拖到左侧，添加为图生图参考图</p>}
    {filtered.length ? <div className="studio-media-grid">
      {filtered.map(item => <button type="button" className="studio-media-item" key={item.id} aria-label={`预览 ${item.name}`} title={item.name} onClick={() => setPreview(item)}
        draggable={canDrag && item.kind === "image"} aria-describedby={canDrag ? dragHintId : undefined}
        onDragStart={event => {
          if (!canDrag || item.kind !== "image") { event.preventDefault(); return; }
          // Replace the thumbnail's native URL payload so dropping over a text
          // field cannot insert a file URL instead of selecting a reference.
          event.dataTransfer.clearData();
          event.dataTransfer.setData(STUDIO_IMAGE_MIME, serializeStudioImageDrag({ projectId, mediaId: item.id }));
          event.dataTransfer.effectAllowed = "copy";
        }}>
        <AssetThumbnail media={item} projectId={projectId} />
        <span className="studio-media-name">{item.name}</span>
      </button>)}
    </div> : <div className="studio-media-empty">
      <Empty description={normalizedQuery ? `没有匹配的${label}` : kind === "image" ? "生成或导入的图片会显示在这里" : "生成或导入的视频会显示在这里"} />
      {normalizedQuery && <Button type="text" size="small" onClick={() => setQuery("")}>清除搜索</Button>}
    </div>}
    {kind === "image" ? <ImagePreviewModal media={preview} images={items} onMediaChange={setPreview} onClose={() => setPreview(null)} />
      : <VideoPreviewModal media={preview} videos={items} projectId={projectId} onMediaChange={setPreview} onClose={() => setPreview(null)} />}
  </section>;
}
