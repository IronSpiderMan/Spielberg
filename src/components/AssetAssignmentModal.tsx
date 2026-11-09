import { Form, Input, Message, Modal, Select } from "@arco-design/web-react";
import { useRef, useState } from "react";
import { post, type Media, type Snapshot } from "../core";
import {assetCategoryLabel} from "../asset-categories";

const imageUsages = [{ value: "role", label: "资产图" }, { value: "first", label: "片段首帧" }, { value: "last", label: "片段尾帧" }, { value: "reference", label: "片段参考图" }];
const videoUsages = [{ value: "video", label: "片段视频" }, { value: "one_take", label: "场景主视频（一镜到底）" }];

// Mount for the selected asset so each new assignment starts with an empty
// target and name. A failed save keeps the user's choices available for retry.
export function AssetAssignmentModal({ media, data, reload, onClose, title = "设置素材用途", usageLabel = "设置为", successMessage }: {
  media: Media;
  data: Snapshot;
  reload: () => void | Promise<void>;
  onClose: () => void;
  title?: string;
  usageLabel?: string;
  successMessage?: string;
}) {
  const [usage, setUsage] = useState(media.kind === "video" ? "video" : "role");
  const [target, setTarget] = useState<number>();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const clips = data.episodes.flatMap(episode => episode.scenes.flatMap(scene => scene.clips.map(clip => ({ clip, label: `${episode.title} / ${scene.title} / ${clip.title}` }))));
  const scenes = data.episodes.flatMap(episode => episode.scenes.filter(scene => scene.generation_mode === "one_take")
    .map(scene => ({ value: scene.id, label: `${episode.title} / ${scene.title}` })));
  const targetLabel = usage === "role" ? "资产" : usage === "one_take" ? "场景" : "片段";
  const targets = usage === "role" ? data.assets.map(role => ({ value: role.id, label: `${assetCategoryLabel(role.category)} · ${role.name}` }))
    : usage === "one_take" ? scenes : clips.map(item => ({ value: item.clip.id, label: item.label }));
  const assign = async () => {
    if (saving.current || target === undefined || (usage === "role" && !name.trim())) return;
    saving.current = true; setBusy(true);
    try {
      const project_id = data.project.id;
      if (usage === "role") {
        const role = data.assets.find(item => item.id === target);
        if (!role) throw new Error("请选择有效的资产");
        await post("/assets/media/add", { project_id, asset_id: role.id, media_id: media.id, name: name.trim() });
        await post("/assets/update", { project_id, id: role.id, name: role.name, description: role.description, design_media_id: media.id });
      } else if (usage === "one_take") {
        await post("/scenes/select-video", { project_id, scene_id: target, media_id: media.id });
      } else {
        const clip = clips.find(item => item.clip.id === target)?.clip;
        if (!clip) throw new Error("请选择有效的片段");
        if (usage === "video") await post("/clips/select-video", { project_id, clip_id: clip.id, media_id: media.id });
        else await post("/clips/update", { project_id, id: clip.id, [`${usage}_media_id`]: media.id });
      }
      await reload();
      Message.success(successMessage || `已设置为${[...imageUsages, ...videoUsages].find(item => item.value === usage)?.label}`);
      onClose();
    } catch (error) { Message.error(String(error)); }
    finally { saving.current = false; setBusy(false); }
  };
  return <Modal className="asset-assignment-modal" visible title={title} okText="确定设置" confirmLoading={busy}
    okButtonProps={{ disabled: target === undefined || (usage === "role" && !name.trim()) }} cancelButtonProps={{ disabled: busy }}
    maskClosable={!busy} closable={!busy} escToExit={!busy} onCancel={() => { if (!saving.current) onClose(); }} onOk={assign}>
    <p>{media.name}</p>
    <Form layout="vertical" disabled={busy}>
      <Form.Item label={usageLabel}><Select aria-label="素材用途" value={usage} onChange={value => { setUsage(value); setTarget(undefined); }}
        options={media.kind === "video" ? videoUsages : imageUsages} /></Form.Item>
      <Form.Item label={`选择${targetLabel}`} required><Select aria-label={`选择${targetLabel}`} showSearch allowClear value={target} onChange={setTarget}
        placeholder={`请选择${targetLabel}`} options={targets} /></Form.Item>
      {usage === "role" && <Form.Item label="资产图片名称" required extra="图生图时可用 @资产.图片名称 引用这张图片。">
        <Input aria-label="资产图片名称" value={name} onChange={setName} placeholder="请输入名称，例如：正面、侧面、校服" />
      </Form.Item>}
      {!targets.length && <p className="helper">{usage === "one_take" ? "请先将场景设置为一镜到底" : `请先创建${targetLabel}`}</p>}
      <p className="helper">{usage === "role" ? "图片将加入资产图片并设为主图。" : media.kind === "video" ? `视频将设为${targetLabel}主视频。` : "图片将替换所选片段对应的图片。"}</p>
    </Form>
  </Modal>;
}
