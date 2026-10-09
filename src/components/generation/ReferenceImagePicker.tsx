import { ImagePreviewModal } from "../ImagePreviewModal";
import { Input, Select } from "@arco-design/web-react";
import { X, ZoomIn } from "lucide-react";
import { useEffect, useState } from "react";
import { imageUrl, type Media } from "../../core";

export function ImageAssetSelect({ media, value, onChange, label, disabled = false }: {
  media: Media[];
  value?: number;
  onChange: (value: number | undefined) => void;
  label: string;
  disabled?: boolean;
}) {
  const selected = media.find(item => item.id === value);
  return <>
    <Select aria-label={label} showSearch allowClear value={value} onChange={onChange} disabled={disabled}
      options={media.filter(item => item.kind === "image").map(item => ({ label: item.name, value: item.id }))}
      placeholder={`从资产库选择${label}`} />
    {selected && <img className="video-frame-preview" src={imageUrl(selected)} alt={label} />}
  </>;
}

// Both presentations share selection, removal and preview behavior. Mentioned
// images can be shown alongside selected images without making them removable.
export function ReferenceImagePicker({ media, value, onChange, mentionedIds = [], presentation = "gallery", disabled = false, ariaLabel = "参考图片", onPreview }: {
  media: Media[];
  value: number[];
  onChange: (ids: number[]) => void;
  mentionedIds?: number[];
  presentation?: "gallery" | "select";
  disabled?: boolean;
  ariaLabel?: string;
  onPreview?: (media: Media) => void;
}) {
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(24);
  const [preview, setPreview] = useState<Media | null>(null);
  useEffect(() => setLimit(24), [query]);
  const images = media.filter(item => item.kind === "image").sort((a, b) => {
    const byDate = Date.parse(b.created_at) - Date.parse(a.created_at);
    return Number.isFinite(byDate) && byDate !== 0 ? byDate : b.id - a.id;
  });
  const filtered = images.filter(item => item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const shownIds = [...new Set([...value, ...mentionedIds])];
  const remove = (id: number) => onChange(value.filter(item => item !== id));
  const showPreview = (item: Media) => onPreview ? onPreview(item) : setPreview(item);

  return <>
    {presentation === "select" ? <>
      <Select aria-label={ariaLabel} mode="multiple" showSearch value={value} disabled={disabled} onChange={onChange}
        options={media.filter(item => item.kind === "image").map(item => ({ label: item.name, value: item.id }))}
        placeholder="从资产库选择参考图片" />
      <div className="video-reference-previews">{shownIds.map((id, index) => {
        const item = images.find(image => image.id === id);
        return item && <figure key={id}>
          <button type="button" className="video-reference-preview" aria-label={`放大查看 ${item.name}`} onClick={() => showPreview(item)}><img src={imageUrl(item)} alt={item.name} /></button>
          <figcaption>参考图 {index + 1}</figcaption>
          {value.includes(id) && <button type="button" disabled={disabled} aria-label={`移除 ${item.name}`} onClick={() => remove(id)}><X size={12} /></button>}
        </figure>;
      })}</div>
    </> : <div className="creation-reference-picker">
      <Input value={query} onChange={setQuery} disabled={disabled} allowClear placeholder="搜索参考图片" prefix={<span aria-hidden="true">⌕</span>} aria-label="搜索参考图片" />
      <div className="creation-reference-selected" aria-label="已选参考图片">{shownIds.map(id => {
        const item = images.find(image => image.id === id);
        return item && <div className="creation-reference-chip" key={id}>
          <button type="button" className="reference-preview-button" aria-label={`放大查看 ${item.name}`} title="放大查看" onClick={() => showPreview(item)}><img src={imageUrl(item)} alt={item.name} /></button>
          <span title={item.name}>{item.name}</span>
          {value.includes(id) && <button type="button" disabled={disabled} aria-label={`移除 ${item.name}`} onClick={() => remove(id)}>×</button>}
        </div>;
      })}{!shownIds.length && <span className="helper">尚未选择参考图</span>}</div>
      <div className="creation-asset-picker" onScroll={event => {
        const element = event.currentTarget;
        if (element.scrollTop + element.clientHeight >= element.scrollHeight - 40) setLimit(current => Math.min(current + 24, filtered.length));
      }}>
        {filtered.slice(0, limit).map(item => <div className="creation-asset-item" key={item.id}>
          <button type="button" disabled={disabled} className={`creation-asset-option${value.includes(item.id) ? " selected" : ""}`} aria-pressed={value.includes(item.id)} title={item.name}
            onClick={() => value.includes(item.id) ? remove(item.id) : onChange([...value, item.id])}>
            <img src={imageUrl(item)} alt="" loading="lazy" /><span>{item.name || `图片 ${item.id}`}</span>
          </button>
          <button type="button" className="creation-asset-zoom" aria-label={`放大查看 ${item.name || `图片 ${item.id}`}`} title="放大查看" onClick={() => showPreview(item)}><ZoomIn size={16} /></button>
        </div>)}
        {!images.length && <p className="helper">资产库中还没有图片</p>}
        {!!images.length && !filtered.length && <p className="helper">没有匹配的图片</p>}
        {limit < filtered.length && <p className="helper creation-load-more">继续滚动加载更多 · 已显示 {Math.min(limit, filtered.length)} / {filtered.length}</p>}
      </div>
    </div>}
    {!onPreview && <ImagePreviewModal media={preview} onClose={() => setPreview(null)} />}
  </>;
}
