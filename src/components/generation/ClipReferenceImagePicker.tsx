import { Button, Dropdown, Message } from "@arco-design/web-react";
import { ChevronDown, GripVertical, ImagePlus, Pencil, Plus, Upload, Users } from "lucide-react";
import { useRef, useState } from "react";
import { imageUrl, post, type Media, type Snapshot } from "../../core";
import { open, releaseFile } from "../../platform";
import { AssetImagePicker } from "../AssetImagePicker";
import { ClipFramePicker } from "../ClipFramePicker";
import { ImagePreviewModal } from "../ImagePreviewModal";
import { RoleImagePicker } from "../RoleImagePicker";

export function ClipReferenceImagePicker({ data, value, onChange, reload, label = "参考图片", maxImages, extraMedia = [], writing, supportsPaste, disabled, onUploading, onAnnotate }: {
  data: Snapshot;
  value: number[];
  onChange: (update: (ids: number[]) => number[]) => void;
  reload: () => void | Promise<void>;
  label?: string;
  maxImages?: number;
  extraMedia?: Media[];
  writing?: boolean;
  supportsPaste?: boolean;
  disabled?: boolean;
  onUploading?: (busy: boolean) => void;
  onAnnotate?: (media: Media) => void;
}) {
  const [sourceOpen, setSourceOpen] = useState(false);
  const [picker, setPicker] = useState<"library" | "assets" | null>(null);
  const [preview, setPreview] = useState<Media | null>(null);
  const [imported, setImported] = useState<Media[]>([]);
  const [uploading, setUploading] = useState(false);
  const grid = useRef<HTMLDivElement>(null);
  const [dropTarget, setDropTarget] = useState<number>();
  const locked = disabled || uploading;
  const limit = maxImages ?? Infinity;
  const full = value.length >= limit;
  const available = new Map([...imported, ...extraMedia, ...data.media].map(item => [item.id, item]));
  const selectedImages = value.flatMap(id => {
    const item = available.get(id);
    return item ? [item] : [];
  });
  const setUploadState = (busy: boolean) => {
    setUploading(busy);
    onUploading?.(busy);
  };
  const add = (item: Media) => {
    setImported(items => [...items, item]);
    onChange(ids => ids.includes(item.id) || ids.length >= limit ? ids : [...ids, item.id]);
  };
  const toggle = (id: number) => {
    if (locked) return;
    if (value.includes(id)) onChange(ids => ids.filter(item => item !== id));
    else if (full) Message.warning(`最多选择 ${maxImages} 张参考图`);
    else onChange(ids => ids.includes(id) || ids.length >= limit ? ids : [...ids, id]);
  };
  const upload = async () => {
    if (locked || full) return;
    setUploadState(true);
    let paths: string[] = [];
    try {
      const result = await open({ multiple: true, filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "gif", "svg"] }] });
      paths = typeof result === "string" ? [result] : result || [];
      const files = paths.slice(0, limit - value.length);
      if (!files.length) return;
      try {
        for (const source of files) add(await post<Media>("/media/import", { project_id: data.project.id, source_path: source }));
      } finally { await reload(); }
    } catch (error) { Message.error(String(error)); }
    finally {
      paths.forEach(releaseFile);
      setUploadState(false);
    }
  };
  const targetAt = (x: number, y: number) => {
    const target = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-reference-id]");
    return target && grid.current?.contains(target) ? Number(target.dataset.referenceId) : undefined;
  };

  return <section className="scene-multi-reference" aria-label={label} onKeyDown={event => {
    if (event.key === "Escape" && sourceOpen && event.currentTarget.contains(event.target as Node)) {
      event.preventDefault();
      event.stopPropagation();
      setSourceOpen(false);
    }
  }}>
    <div className="scene-reference-heading">
      <div className="scene-reference-title"><ImagePlus size={15}/><h2>{label}</h2><span>{value.length}{maxImages !== undefined && ` / ${maxImages}`}</span></div>
      <Dropdown trigger="click" popupVisible={sourceOpen && !locked} onVisibleChange={setSourceOpen} unmountOnExit={false}
        droplist={<div className="scene-source-menu" onClick={() => setSourceOpen(false)}>
          <Button type="text" icon={<ImagePlus size={15}/>} onClick={() => setPicker("library")}>从素材库选择</Button>
          <Button type="text" icon={<Users size={15}/>} onClick={() => setPicker("assets")}>从资产中选择</Button>
          <ClipFramePicker data={data} reload={reload} onSelect={add} disabled={disabled || full} onExtracting={setUploadState}/>
          <Button type="text" icon={<Upload size={15}/>} disabled={full} onClick={() => void upload()}>上传图片</Button>
        </div>}>
        <Button size="mini" disabled={locked} loading={uploading} aria-label="添加参考图" icon={<Plus size={13}/>}>添加<ChevronDown size={12}/></Button>
      </Dropdown>
    </div>
    {value.length ? <div ref={grid} className="scene-reference-grid" data-count={value.length}>
      {value.map((id, index) => {
        const item = available.get(id);
        const name = item?.name || `素材 ${id}（不可用）`;
        return <figure className={`scene-reference-thumb${dropTarget === id ? " drop-target" : ""}`} key={id} data-reference-id={id}>
          {item && <button type="button" className="scene-reference-preview" onClick={() => setPreview(item)} aria-label={`预览参考图 ${name}`}>
            <img src={imageUrl(item)} alt={name} draggable={false}/>
          </button>}
          <span className="scene-reference-index" aria-label={`参考图 ${index + 1}`}>{writing ? `图 ${index + 1}` : index + 1}</span>
          <button type="button" className="scene-reference-remove" disabled={locked} onClick={() => toggle(id)} aria-label={`移除参考图 ${name}`} title="移除">×</button>
          <figcaption title={`拖动调整顺序：${name}`} onPointerDown={event => {
            if (locked || event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
          }} onPointerMove={event => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            const target = targetAt(event.clientX, event.clientY);
            setDropTarget(target === id ? undefined : target);
          }} onPointerUp={event => {
            if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
            const target = targetAt(event.clientX, event.clientY);
            setDropTarget(undefined);
            if (locked || target === undefined || target === id) return;
            onChange(ids => {
              const from = ids.indexOf(id), to = ids.indexOf(target);
              if (from < 0 || to < 0) return ids;
              const ordered = [...ids];
              ordered.splice(from, 1);
              ordered.splice(to, 0, id);
              return ordered;
            });
          }} onLostPointerCapture={() => setDropTarget(undefined)}>
            <GripVertical size={12} aria-hidden="true"/><span className="scene-reference-name">{name}</span>
            {item && onAnnotate && <button type="button" className="scene-reference-annotate" disabled={locked} onPointerDown={event => event.stopPropagation()}
              onClick={() => onAnnotate(item)} aria-label={`标注参考图 ${name}`} title="标注图片"><Pencil size={13}/></button>}
          </figcaption>
        </figure>;
      })}
    </div> : <button type="button" className="scene-reference-empty" disabled={locked} onClick={() => setPicker("library")}>
      <ImagePlus size={22}/><span>添加{label}<small>从素材库、资产或片段选择，也可上传{supportsPaste ? "、粘贴" : ""}图片</small></span>
    </button>}
    {!!value.length && <p className="scene-reference-hint">拖动名称调整顺序 · 点击图片预览{supportsPaste && " · 支持粘贴图片"}</p>}
    <AssetImagePicker visible={picker === "library"} label={label === "参考图片" ? "多张参考图" : label} data={data} value={null} multiple selectedIds={value}
      onSelect={toggle} onToggle={toggle} onClose={() => setPicker(null)} busy={locked}/>
    <RoleImagePicker title="从资产中选择参考图" visible={picker === "assets"} roles={data.assets} multiple showPrimary={false} selectedIds={value}
      onClose={() => setPicker(null)} onSelect={item => toggle(item.id)} disabled={locked}/>
    <ImagePreviewModal media={preview} images={selectedImages} onMediaChange={setPreview} title="参考图预览" onClose={() => setPreview(null)}/>
  </section>;
}
