import { Form, Input, Message, Modal, Select } from "@arco-design/web-react";
import { useRef, useState } from "react";
import { post, type Media, type Snapshot } from "../core";

const imageUsages = [{ value: "role", label: "角色图" }, { value: "first", label: "场景首帧" }, { value: "last", label: "场景尾帧" }, { value: "reference", label: "场景参考图" }];

// Mount for the selected asset so each new assignment starts with an empty
// target and name. A failed save keeps the user's choices available for retry.
export function AssetAssignmentModal({ media, data, reload, onClose, title = "设置资产用途", usageLabel = "设置为", successMessage }: {
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
  const scenes = data.episodes.flatMap(episode => episode.scenes.map(scene => ({ scene, label: `${episode.title} / ${scene.title}` })));
  const assign = async () => {
    if (saving.current || target === undefined || (usage === "role" && !name.trim())) return;
    saving.current = true; setBusy(true);
    try {
      const project_id = data.project.id;
      if (usage === "role") {
        const role = data.roles.find(item => item.id === target);
        if (!role) throw new Error("请选择有效的角色");
        await post("/roles/media/add", { project_id, role_id: role.id, media_id: media.id, name: name.trim() });
        await post("/roles/update", { project_id, id: role.id, name: role.name, description: role.description, design_media_id: media.id });
      } else {
        const scene = scenes.find(item => item.scene.id === target)?.scene;
        if (!scene) throw new Error("请选择有效的场景");
        if (usage === "video") await post("/scenes/select-video", { project_id, scene_id: scene.id, media_id: media.id });
        else await post("/scenes/update", { project_id, id: scene.id, title: scene.title, description: scene.description,
          first_media_id: scene.first_media_id, last_media_id: scene.last_media_id, reference_media_id: scene.reference_media_id, [`${usage}_media_id`]: media.id });
      }
      await reload();
      Message.success(successMessage || `已设置为${usage === "video" ? "场景视频" : imageUsages.find(item => item.value === usage)?.label}`);
      onClose();
    } catch (error) { Message.error(String(error)); }
    finally { saving.current = false; setBusy(false); }
  };
  return <Modal className="asset-assignment-modal" visible title={title} okText="确定设置" confirmLoading={busy}
    okButtonProps={{ disabled: target === undefined || (usage === "role" && !name.trim()) }} cancelButtonProps={{ disabled: busy }}
    maskClosable={!busy} closable={!busy} escToExit={!busy} onCancel={() => { if (!saving.current) onClose(); }} onOk={assign}>
    <p>{media.name}</p>
    <Form layout="vertical" disabled={busy}>
      <Form.Item label={usageLabel}><Select aria-label="资产用途" value={usage} onChange={value => { setUsage(value); setTarget(undefined); }}
        options={media.kind === "video" ? [{ value: "video", label: "场景视频" }] : imageUsages} /></Form.Item>
      <Form.Item label={usage === "role" ? "选择角色" : "选择场景"} required><Select aria-label={usage === "role" ? "选择角色" : "选择场景"} showSearch allowClear value={target} onChange={setTarget}
        placeholder={usage === "role" ? "请选择角色" : "请选择剧集 / 场景"}
        options={usage === "role" ? data.roles.map(role => ({ value: role.id, label: role.name })) : scenes.map(item => ({ value: item.scene.id, label: item.label }))} /></Form.Item>
      {usage === "role" && <Form.Item label="角色图片名称" required extra="图生图时可用 @角色.图片名称 引用这张图片。">
        <Input aria-label="角色图片名称" value={name} onChange={setName} placeholder="请输入名称，例如：正面、侧面、校服" />
      </Form.Item>}
      {(usage === "role" ? !data.roles.length : !scenes.length) && <p className="helper">{usage === "role" ? "请先在角色管理中创建角色" : "请先创建剧集和场景"}</p>}
      <p className="helper">{usage === "role" ? "图片将加入角色图片并设为主图。" : usage === "video" ? "视频将加入该场景并设为当前使用的视频。" : "图片将替换所选场景对应的图片。"}</p>
    </Form>
  </Modal>;
}
