import { AutoComplete, Button } from "@arco-design/web-react";
import { Image, X } from "lucide-react";
import { useState } from "react";
import type { Media } from "../core";
import { buildShotMediaCatalog, resolveShotImage } from "../shot-media";
import { ImagePreviewModal } from "./ImagePreviewModal";

export function ShotMediaField({ references, catalog, index, busy, onChange }: {
  references: string[];
  catalog: ReturnType<typeof buildShotMediaCatalog>;
  index: number;
  busy: boolean;
  onChange: (references: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [preview, setPreview] = useState<Media | null>(null);
  const selected = references.flatMap((reference, position) => {
    const image = resolveShotImage(reference, catalog);
    return image ? [{ ...image, position }] : [];
  });
  const selectedIds = new Set(selected.map(item => item.media?.id));
  const search = query.trim().replace(/^@/, "").trim().toLowerCase();
  const options = focused ? catalog.options.filter(item => !selectedIds.has(item.media.id) && item.searchText.includes(search)).slice(0, 50) : [];
  const label = `镜头 ${index + 1}`;
  const closePreview = () => setPreview(null);
  return <div className="shot-media-field">
    {!!selected.length && <ul className="shot-media-references">
      {selected.map(({ media, label: name, position }) => (
        <li key={position} className="shot-media-reference">
          {media ? <button type="button" className="shot-media-preview" title={name}
            aria-label={`${label} 预览图片 ${name}`} onClick={() => setPreview(media)}>
            <Image size={14} aria-hidden="true" /><span>{name}</span>
          </button> : <span className="shot-media-missing" title={name}>{name} · 图片不可用</span>}
          <Button type="text" size="mini" disabled={busy} aria-label={`${label} 移除素材 ${name}`} icon={<X size={13} />}
            onClick={() => onChange(references.filter((_, i) => i !== position))} />
        </li>
      ))}
    </ul>}
    <AutoComplete value={query} onChange={setQuery} onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); setQuery(""); }}
      onSelect={value => { onChange([...references, value]); setQuery(""); }}
      disabled={busy} placeholder="@资产.图片 或 @素材库.图片" filterOption={false}
      inputProps={{ "aria-label": `${label} 搜索素材` }} triggerProps={{ autoFitPosition: true, updateOnScroll: true }}>
      {options.map(item => <AutoComplete.Option key={item.value} value={item.value}>
        <span className="shot-media-option">{item.label}<small>{item.media.name}{item.duplicate && ` · #${item.media.id}`}</small></span>
      </AutoComplete.Option>)}
    </AutoComplete>
    {focused && search && !options.length && <span className="helper" role="status">没有匹配的图片</span>}
    {preview && <ImagePreviewModal media={preview} onClose={closePreview} title="分镜图片预览" />}
  </div>;
}
