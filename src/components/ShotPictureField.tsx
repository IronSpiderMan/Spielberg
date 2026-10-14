import { Button, Input, Space } from "@arco-design/web-react";
import { useEffect, useRef, useState } from "react";
import { imageUrl, type Media, type Snapshot } from "../core";
import { AssetImagePicker } from "./AssetImagePicker";
import { RoleImagePicker } from "./RoleImagePicker";
import { ImagePreviewModal } from "./ImagePreviewModal";

export function ShotPictureField({ picture, index, data, busy, onChange, onUpload }: {
  picture: string;
  index: number;
  data: Snapshot;
  busy: boolean;
  onChange: (path: string) => void;
  onUpload: (file: File) => Promise<void>;
}) {
  const [picker, setPicker] = useState<"asset" | "role" | null>(null);
  const [preview, setPreview] = useState<Media | null>(null);
  const [failed, setFailed] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setFailed(false), [picture]);
  const media = data.media.find(item => item.kind === "image" && item.path === picture)
    || data.roles.flatMap(role => role.images).find(item => item.path === picture);
  const selected: Media = media || { id: 0, path: picture, name: picture.split(/[\\/]/).pop() || "分镜画面", kind: "image", created_at: "" };
  const select = (item: Media) => { onChange(item.path); setPicker(null); };
  const label = `镜头 ${index + 1}`;
  return <div className="shot-picture-field">
    {picture && <>
      {failed ? <span className="helper">图片无法加载，请重新选择</span> : <button type="button" className="shot-picture-preview" aria-label={`${label} 预览画面`} onClick={() => setPreview(selected)}>
        <img src={imageUrl(selected)} alt={`${label} 画面`} loading="lazy" onError={() => setFailed(true)} />
      </button>}
      <Input aria-label={`${label} 画面路径`} value={picture} readOnly title={picture} />
    </>}
    <Space wrap size={4}>
      <Button size="mini" disabled={busy} aria-label={`${label} 从资产选择画面`} onClick={() => setPicker("asset")}>资产</Button>
      <Button size="mini" disabled={busy} aria-label={`${label} 从角色选择画面`} onClick={() => setPicker("role")}>角色</Button>
      <Button size="mini" disabled={busy} aria-label={`${label} 上传本地画面`} onClick={() => input.current?.click()}>本地上传</Button>
      {picture && <Button size="mini" disabled={busy} aria-label={`${label} 清除画面`} onClick={() => onChange("")}>清除</Button>}
    </Space>
    <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden aria-label={`${label} 本地画面文件`}
      onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void onUpload(file); }} />
    <AssetImagePicker visible={picker === "asset"} label={`${label}画面`} value={media?.id || null} data={data} busy={busy}
      onSelect={id => { const item = data.media.find(item => item.id === id); if (item) select(item); }} onClose={() => setPicker(null)} />
    <RoleImagePicker visible={picker === "role"} title={`为${label}选择角色画面`} roles={data.roles} selectedIds={media ? [media.id] : []}
      disabled={busy} onSelect={select} onClose={() => setPicker(null)} />
    <ImagePreviewModal media={preview} onClose={() => setPreview(null)} title="分镜画面预览" />
  </div>;
}
