import { PreviewVideo } from "../VideoPreviewModal";
import { Button, Form, Message, Select } from "@arco-design/web-react";
import { useRef, useState } from "react";
import { uploadMedia } from "../../api";
import { imageUrl, type Media } from "../../core";

export function ReferenceMediaPicker({ projectId, media, videoIds = [], audioIds = [], onChange, reload, disabled, onUploading }: {
  projectId: string;
  media: Media[];
  videoIds?: number[];
  audioIds?: number[];
  onChange: (kind: "video" | "audio", ids: number[]) => void;
  reload: () => void | Promise<void>;
  disabled?: boolean;
  onUploading?: (busy: boolean) => void;
}) {
  const [uploaded, setUploaded] = useState<Media[]>([]);
  const [uploading, setUploading] = useState(false);
  const inProgress = useRef(false);
  const inputs = useRef<Partial<Record<"video" | "audio", HTMLInputElement | null>>>({});
  const available = [...media, ...uploaded.filter(item => !media.some(m => m.id === item.id))];
  const upload = async (kind: "video" | "audio", files: File[]) => {
    if (disabled || inProgress.current || !files.length) return;
    const ids = [...(kind === "video" ? videoIds : audioIds)];
    if (ids.length + files.length > 3) return void Message.warning(`最多选择 3 个参考${kind === "video" ? "视频" : "音频"}`);
    inProgress.current = true; setUploading(true); onUploading?.(true);
    try {
      for (const file of files) {
        const item = await uploadMedia<Media>(projectId, file);
        setUploaded(items => [...items, item]);
        if (item.kind !== kind) throw new Error("上传素材类型不符");
        ids.push(item.id); onChange(kind, [...ids]);
      }
    } catch (error) { Message.error(`参考素材上传失败：${String(error)}`); }
    finally {
      try { await reload(); } catch (error) { Message.error(`刷新素材失败：${String(error)}`); }
      inProgress.current = false; setUploading(false); onUploading?.(false);
    }
  };
  return <>
    {(["video", "audio"] as const).map(kind => {
      const label = kind === "video" ? "视频" : "音频";
      const ids = kind === "video" ? videoIds : audioIds;
      return <Form.Item key={kind} label={`参考${label}（可选）· ${ids.length} / 3`}>
        <Select mode="multiple" allowClear aria-label={`参考${label}`} value={ids} disabled={disabled || uploading}
          placeholder={`选择参考${label}，最多 3 个`} options={available.filter(item => item.kind === kind).map(item => ({ value: item.id, label: item.name }))}
          onChange={(next: number[]) => { if (next.length > 3) Message.warning(`最多选择 3 个参考${label}`); else onChange(kind, next); }} />
        <div className="helper" style={{ display: "block", marginTop: 8 }}>
          <Button size="small" disabled={disabled || uploading} loading={uploading} onClick={() => inputs.current[kind]?.click()}>上传参考{label}</Button>
          <input ref={element => { inputs.current[kind] = element; }} hidden type="file" multiple disabled={disabled || uploading} accept={kind === "video" ? ".mp4,.mov,.webm,.mkv" : ".mp3,.wav,.m4a,.aac,.ogg,.flac"}
            onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ""; void upload(kind, files); }} />
        </div>
        {ids.map(id => { const item = available.find(m => m.id === id); return item && <div key={id} style={{ marginTop: 8 }}>
          <span className="helper">{item.name}</span>
          {kind === "video" ? <PreviewVideo media={item} projectId={projectId} style={{ maxHeight: 160 }} /> : <audio src={imageUrl(item)} controls preload="metadata" style={{ maxWidth: "100%" }} />}
        </div>; })}
      </Form.Item>;
    })}
    <p className="helper">图片、视频、音频至少选择一种；参考视频和音频可省略。</p>
  </>;
}
