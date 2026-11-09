import { Button, Form, Input, Message, Modal, Select, Tag } from "@arco-design/web-react";
import { useRef, useState } from "react";
import { post, type Scene } from "./core";

export function SceneMergeDialog({ projectId, episodeId, scenes, close, onMerged }: {
  projectId: string;
  episodeId: number;
  scenes: Scene[];
  close: () => void;
  onMerged: (scene: Scene) => void;
}) {
  const [targetId, setTargetId] = useState(scenes[0].id);
  const [title, setTitle] = useState<string>();
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const target = scenes.find(scene => scene.id === targetId);
  const name = title ?? target?.title ?? "";
  const clipCount = scenes.reduce((count, scene) => count + scene.clips.length, 0);
  const hasSceneVideos = scenes.some(scene => scene.video_media_id || scene.videos?.length);

  const merge = async () => {
    if (submitting.current || !target || !name.trim()) return;
    submitting.current = true;
    setBusy(true);
    try {
      const result = await post<Scene>("/scenes/merge", {
        project_id: projectId,
        episode_id: episodeId,
        scene_ids: scenes.map(scene => scene.id),
        target_scene_id: target.id,
        title: name.trim(),
      });
      onMerged(result);
    } catch (error) {
      Message.error(String(error));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  return <Modal title="合并场景" className="scene-merge-modal" visible
    style={{ width: 540, maxWidth: "calc(100vw - 32px)" }} maskClosable={false}
    closable={!busy} escToExit={!busy} onCancel={() => { if (!submitting.current) close(); }}
    footer={<>
      <Button disabled={busy} onClick={close}>取消</Button>
      <Button type="primary" disabled={!target || !name.trim()} loading={busy} onClick={() => void merge()}>确认合并</Button>
    </>}>
    <p className="scene-merge-summary"><strong>{scenes.length} 个场景</strong>将合为一个，{clipCount} 个片段按剧集顺序排列。</p>
    <ol className="scene-merge-list">
      {scenes.map(scene => <li key={scene.id}>
        <div><span>{scene.title}</span><Tag size="small">{scene.clips.length} 个片段</Tag></div>
      </li>)}
    </ol>
    <Form layout="vertical" disabled={busy}>
      <Form.Item label="沿用场景设定">
        <Select aria-label="沿用场景设定" value={targetId} onChange={setTargetId}
          options={scenes.map(scene => ({ label: scene.title, value: scene.id }))} />
      </Form.Item>
      <Form.Item label="合并后的名称" required>
        <Input aria-label="合并后的名称" value={name} onChange={setTitle} />
      </Form.Item>
    </Form>
    <p className="helper">合并后的场景沿用所选场景的简介、共享 Prompt、参考素材和生成方式，其余场景的独立设定将移除。</p>
    {hasSceneVideos && <p className="helper">已有场景视频可在素材库中找到。</p>}
    {target?.generation_mode === "one_take" && <p className="helper">合并后仍使用一镜到底。请为完整的片段序列生成或选择主视频。</p>}
  </Modal>;
}
