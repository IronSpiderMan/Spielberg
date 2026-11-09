import { Button, Dropdown, Empty, Input, Message, Modal, Tabs, Tag } from "@arco-design/web-react";
import { Check, ChevronDown, Film, FolderOpen, Music2, Play, Plus, Search, Upload, Users, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { uploadMedia } from "../../api";
import { assetCategoryLabel, supportsAudioReferences } from "../../asset-categories";
import AssetThumbnail from "../../AssetThumbnail";
import { imageUrl, type Asset, type Media } from "../../core";
import { VideoPreviewModal } from "../VideoPreviewModal";
import "./reference-media-picker.css";

type ReferenceKind = "video" | "audio";
type ReferenceSource = "library" | "assets";
const referenceLabel = (kind: ReferenceKind) => kind === "video" ? "视频" : "音频";
const MAX_REFERENCES = 3;

export function ReferenceMediaPicker({ projectId, media, assets = [], videoIds = [], audioIds = [], onChange, reload, disabled, onUploading, shared = false }: {
  projectId: string;
  media: Media[];
  assets?: Asset[];
  videoIds?: number[];
  audioIds?: number[];
  onChange: (kind: ReferenceKind, ids: number[]) => void;
  reload: () => void | Promise<void>;
  disabled?: boolean;
  shared?: boolean;
  onUploading?: (busy: boolean) => void;
}) {
  const [uploaded, setUploaded] = useState<Media[]>([]);
  const [uploading, setUploading] = useState<ReferenceKind | null>(null);
  const [sourceMenu, setSourceMenu] = useState<ReferenceKind | null>(null);
  const [picker, setPicker] = useState<{ kind: ReferenceKind; source: ReferenceSource } | null>(null);
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<Media | null>(null);
  const inProgress = useRef(false);
  const inputs = useRef<Partial<Record<ReferenceKind, HTMLInputElement | null>>>({});
  const limit = shared ? Infinity : MAX_REFERENCES;
  const countLabel = (count: number) => shared ? count : `${count} / ${limit}`;
  const locked = disabled || !!uploading;
  const library = [...media, ...uploaded.filter(item => !media.some(m => m.id === item.id))];
  const audioAssets = assets.filter(asset => supportsAudioReferences(asset.category));
  // Asset audio names are aliases. Keep the library's file name when available,
  // but allow saved asset references to render even before the media refresh.
  const available = new Map([...audioAssets.flatMap(asset => asset.audios || []), ...library].map(item => [item.id, item]));
  useEffect(() => { setUploaded([]); setPicker(null); setPreview(null); setSourceMenu(null); }, [projectId]);
  const idsFor = (kind: ReferenceKind) => kind === "video" ? videoIds : audioIds;
  const openPicker = (kind: ReferenceKind, source: ReferenceSource) => {
    setSourceMenu(null); setQuery(""); setPicker({ kind, source });
  };
  const toggle = (kind: ReferenceKind, id: number) => {
    if (locked) return;
    const ids = idsFor(kind);
    if (ids.includes(id)) onChange(kind, ids.filter(value => value !== id));
    else if (ids.length < limit) onChange(kind, [...ids, id]);
    else Message.warning(`最多选择 ${MAX_REFERENCES} 个参考${referenceLabel(kind)}`);
  };
  const upload = async (kind: ReferenceKind, files: File[]) => {
    if (disabled || inProgress.current || !files.length) return;
    const ids = [...idsFor(kind)];
    if (ids.length + files.length > limit) return void Message.warning(`最多选择 ${MAX_REFERENCES} 个参考${referenceLabel(kind)}`);
    inProgress.current = true; setUploading(kind); onUploading?.(true);
    try {
      for (const file of files) {
        const item = await uploadMedia<Media>(projectId, file);
        if (item.kind !== kind) throw new Error("上传素材类型不符");
        setUploaded(items => [...items, item]);
        ids.push(item.id); onChange(kind, [...ids]);
      }
    } catch (error) { Message.error(`参考素材上传失败：${String(error)}`); }
    finally {
      try { await reload(); } catch (error) { Message.error(`刷新素材失败：${String(error)}`); }
      inProgress.current = false; setUploading(null); onUploading?.(false);
    }
  };
  const videoThumbnail = (item: Media) => <button type="button" className="reference-media-thumbnail" aria-label={`预览参考视频 ${item.name}`} onClick={() => setPreview(item)}>
    <AssetThumbnail media={item} projectId={projectId} /><span className="reference-media-play"><Play size={15} fill="currentColor" /></span>
  </button>;
  const option = (item: Media, asset?: Asset) => {
    if (!picker) return null;
    const selected = idsFor(picker.kind).includes(item.id);
    const name = asset ? `${asset.name} · ${item.name}` : item.name;
    return <article className={`reference-media-option${selected ? " is-selected" : ""}`} key={item.id}>
      {picker.kind === "video" && videoThumbnail(item)}
      <div className="reference-media-option-content">
        <span className="reference-media-name" title={item.name}>{item.name}</span>
        {picker.kind === "audio" && <audio src={imageUrl(item)} controls preload="none" aria-label={`试听 ${name}`} />}
      </div>
      <Button size="small" type={selected ? "primary" : "secondary"} icon={selected ? <Check size={14} /> : <Plus size={14} />}
        aria-label={`${selected ? "取消选择" : "选择"}参考${referenceLabel(picker.kind)} ${name}`} aria-pressed={selected}
        disabled={locked || (!selected && idsFor(picker.kind).length >= limit)} onClick={() => toggle(picker.kind, item.id)}>{selected ? "已选择" : "选择"}</Button>
    </article>;
  };
  const search = query.trim().toLocaleLowerCase();
  const filteredMedia = library.filter(item => item.kind === picker?.kind && item.name.toLocaleLowerCase().includes(search));
  const assetGroups = audioAssets.map(asset => ({ asset, audios: (asset.audios || []).filter(item => item.kind === "audio" &&
    `${asset.name} ${assetCategoryLabel(asset.category)} ${item.name}`.toLocaleLowerCase().includes(search)) })).filter(group => group.audios.length);

  return <div className="reference-media-picker">
    <div className="reference-media-panels">
      {(["video", "audio"] as const).map(kind => {
        const label = referenceLabel(kind), title = `${shared ? "共享" : ""}参考${label}`, ids = idsFor(kind), Icon = kind === "video" ? Film : Music2;
        return <section key={kind} className="reference-media-panel" aria-label={title}>
          <div className="reference-media-heading">
            <div className="reference-media-title"><Icon size={15} /><h3>{title}</h3><span className="reference-media-count">{countLabel(ids.length)}</span></div>
            <Dropdown trigger="click" popupVisible={sourceMenu === kind && !locked} onVisibleChange={visible => setSourceMenu(visible ? kind : null)}
              droplist={<div className="reference-media-source-menu" onClick={() => setSourceMenu(null)}>
                <Button type="text" icon={<FolderOpen size={15} />} onClick={() => openPicker(kind, "library")}>从素材库选择</Button>
                {kind === "audio" && <Button type="text" icon={<Users size={15} />} onClick={() => openPicker(kind, "assets")}>从资产库选择</Button>}
                <Button type="text" disabled={ids.length >= limit} icon={<Upload size={15} />} onClick={() => inputs.current[kind]?.click()}>上传参考{label}</Button>
              </div>}>
              <Button size="mini" disabled={locked} loading={uploading === kind} aria-label={`添加参考${label}`} icon={<Plus size={13} />}>添加<ChevronDown size={12} /></Button>
            </Dropdown>
            <input ref={element => { inputs.current[kind] = element; }} hidden type="file" multiple disabled={locked} aria-label={`上传参考${label}`} accept={kind === "video" ? ".mp4,.mov,.webm,.mkv" : ".mp3,.wav,.m4a,.aac,.ogg,.flac"}
              onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ""; void upload(kind, files); }} />
          </div>
          {ids.length ? <div className="reference-media-selected">{ids.map(id => {
            const item = available.get(id), name = item?.name || `素材 ${id}（不可用）`;
            return <article key={id} className={`reference-media-selected-item is-${kind}`} data-media-id={id}>
              {kind === "video" && item && videoThumbnail(item)}
              <div className="reference-media-item-detail"><span className="reference-media-name" title={name}>{name}</span>{kind === "video" && item && <span className="reference-media-hint">点击预览</span>}</div>
              <Button className="reference-media-remove" type="text" size="mini" disabled={locked} icon={<X size={14} />} aria-label={`移除参考${label} ${name}`} onClick={() => onChange(kind, ids.filter(value => value !== id))} />
              {kind === "audio" && item && <audio src={imageUrl(item)} controls preload="none" aria-label={`试听 ${name}`} />}
            </article>;
          })}</div> : <button type="button" className="reference-media-empty" disabled={locked} onClick={() => openPicker(kind, "library")}>
            <Icon size={20} /><span>添加{kind === "video" ? "动作或镜头" : "音色或声音"}参考<small>{kind === "audio" ? "素材库 / 资产库 / 本地上传" : "素材库 / 本地上传"} · 可选</small></span>
          </button>}
        </section>;
      })}
    </div>
    {!shared && <p className="reference-media-note">图片、视频、音频至少选择一种；视频、音频均为可选参考。</p>}
    {picker && <Modal className="reference-media-modal" title={`选择参考${referenceLabel(picker.kind)}`} visible style={{ width: 640, maxWidth: "calc(100vw - 32px)" }} onCancel={() => setPicker(null)} unmountOnExit
      footer={<div className="reference-media-footer"><span role="status">已选择 {countLabel(idsFor(picker.kind).length)} 个参考{referenceLabel(picker.kind)}</span><Button type="primary" onClick={() => setPicker(null)}>完成选择</Button></div>}>
      {picker.kind === "audio" && <Tabs activeTab={picker.source} onChange={source => { setPicker({ ...picker, source: source as ReferenceSource }); setQuery(""); }}>
        <Tabs.TabPane key="library" title="素材库" /><Tabs.TabPane key="assets" title="资产库" />
      </Tabs>}
      <Input value={query} onChange={setQuery} allowClear prefix={<Search size={15} />} aria-label={`搜索参考${referenceLabel(picker.kind)}`} placeholder={picker.source === "assets" ? "搜索资产名称或音频名称" : `搜索${referenceLabel(picker.kind)}素材名称`} />
      {picker.source === "assets" && <p className="reference-media-note">支持人物、生物资产的音频参考，可按资产名称或音频名称查找。</p>}
      <div className="reference-media-options">
        {picker.source === "library" ? filteredMedia.length ? filteredMedia.map(item => option(item)) : <Empty description={search ? "没有匹配的素材" : `素材库中暂无${referenceLabel(picker.kind)}，可从本地上传`} />
          : assetGroups.length ? assetGroups.map(({ asset, audios }) => <section className="reference-media-asset-group" key={asset.id} aria-label={asset.name}>
            <div className="reference-media-asset-heading"><strong title={asset.name}>{asset.name}</strong><Tag size="small">{assetCategoryLabel(asset.category)}</Tag></div>
            {audios.map(item => option(item, asset))}
          </section>) : <Empty description={search ? "没有匹配的资产音频" : "暂无可用音频，请先在人物或生物资产中添加音频参考"} />}
      </div>
    </Modal>}
    <VideoPreviewModal media={preview} projectId={projectId} onClose={() => setPreview(null)} />
  </div>;
}
