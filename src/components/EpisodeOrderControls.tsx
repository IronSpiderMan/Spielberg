import { Button, Dropdown, Form, Input, Menu, Message, Modal, Space } from "@arco-design/web-react";
import { ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpToLine, ChevronDown } from "lucide-react";
import { useRef, useState } from "react";
import { post, type Clip, type Episode, type Project } from "../core";
import { confirmAction } from "./ConfirmAction";

const reorderingEpisodes = new Set<string>();
export type EpisodeItemAction = { key: string; label: string; danger?: boolean; run: () => void };

export function EpisodeOrderControls({episode, id, kind, project, reload, actions, disabled = false}: {
  episode: Episode; id: number; kind: "scene" | "clip"; project: Project; reload: () => void;
  actions?: EpisodeItemAction[]; disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const items = kind === "scene" ? episode.scenes : episode.scenes.find(scene => scene.clips.some(clip => clip.id === id))?.clips || [];
  const index = items.findIndex(item => item.id === id);
  const last = items.length - 1;
  const label = kind === "scene" ? "场景" : "片段";
  const move = async (target: number, toEndpoint = false) => {
    const key = `${project.id}/${episode.id}`;
    if (reorderingEpisodes.has(key) || disabled || index < 0 || target === index || target < 0 || target > last) return;
    const ids = items.map(item => item.id);
    if (toEndpoint) ids.splice(target, 0, ids.splice(index, 1)[0]);
    else [ids[index], ids[target]] = [ids[target], ids[index]];
    const moving = new Set(ids);
    let next = 0;
    const orderedIds = kind === "scene" ? ids : episode.clips.map(clip => moving.has(clip.id) ? ids[next++] : clip.id);
    reorderingEpisodes.add(key);
    setBusy(true);
    try {
      await post(kind === "scene" ? "/scenes/reorder" : "/clips/reorder", {
        project_id: project.id, episode_id: episode.id, [kind === "scene" ? "scene_ids" : "clip_ids"]: orderedIds,
      });
      await reload();
    } catch (error) {Message.error(String(error));}
    finally {reorderingEpisodes.delete(key); setBusy(false);}
  };

  if (index < 0 || (!actions && last < 1)) return null;
  const orderActions = [
    ...(actions ? [{ label: `将${label}移到最前方`, icon: ArrowUpToLine, target: 0, endpoint: true }] : []),
    { label: `上移${label}`, icon: ArrowUp, target: index - 1 },
    { label: `下移${label}`, icon: ArrowDown, target: index + 1 },
    ...(actions ? [{ label: `将${label}移到最后方`, icon: ArrowDownToLine, target: last, endpoint: true }] : []),
  ];
  return <Space className="episode-order-controls" size={4} wrap>
    {orderActions.map(({ label: text, icon: Icon, target, endpoint }) => <Button key={text}
      size="mini" aria-label={text} title={text} icon={<Icon size={14}/>}
      disabled={disabled || busy || target < 0 || target > last || target === index}
      onClick={() => {
        if (endpoint) confirmAction({title: text, content: `调整「${items[index].title}」的顺序？`,
          okText: "确认移动", onOk: () => move(target, true)});
        else void move(target);
      }} />)}
    {actions && <Dropdown trigger="click" position="br" disabled={disabled || busy} droplist={
      <Menu onClickMenuItem={key => actions.find(action => action.key === key)?.run()}>
        {actions.map(action => <Menu.Item key={action.key} className={action.danger ? "scene-workspace-danger-item" : undefined}>{action.label}</Menu.Item>)}
      </Menu>
    }>
      <Button size="mini" aria-label={`更多${label}操作：${items[index].title}`}
        title={`插入或复制${label}`} loading={busy} disabled={disabled}>
        插入 / 复制 <ChevronDown size={12}/>
      </Button>
    </Dropdown>}
  </Space>;
}

type Position = "before" | "after";

export function placementActions(label: string, insert: (position: Position) => void, copy: (position: Position) => void): EpisodeItemAction[] {
  return [
    { key: "before", label: `在前方插入${label}`, run: () => insert("before") },
    { key: "after", label: `在后方插入${label}`, run: () => insert("after") },
    { key: "copy-before", label: "复制到前方", run: () => copy("before") },
    { key: "copy-after", label: "复制到后方", run: () => copy("after") },
  ];
}

export function ClipCreationDialog({projectId, episode, sceneId, anchorClipId, position, reload, onClose, onCreated}: {
  projectId: string; episode: Episode; sceneId: number; anchorClipId?: number; position?: Position;
  reload: () => void; onClose: () => void; onCreated: (clip: Clip) => void;
}) {
  const [title, setTitle] = useState(() => `片段 ${(episode.scenes.find(scene => scene.id === sceneId)?.clips.length || 0) + 1}`);
  const [mode, setMode] = useState<"default" | "canvas">("default");
  const [saving, setSaving] = useState(false);
  const inProgress = useRef(false);
  const create = async () => {
    if (inProgress.current) return;
    inProgress.current = true;
    setSaving(true);
    try {
      const clip = await post<Clip>("/clips", {project_id: projectId, episode_id: episode.id, scene_id: sceneId,
        title: title.trim() || "未命名片段", creation_mode: mode, anchor_clip_id: anchorClipId, position});
      try { await reload(); } catch { Message.warning("片段已创建，刷新失败"); }
      onClose();
      onCreated(clip);
    } catch (error) { Message.error(String(error)); throw error; }
    finally { inProgress.current = false; setSaving(false); }
  };
  return <Modal title={position === "before" ? "在前方插入片段" : position === "after" ? "在后方插入片段" : "新建片段"}
    okText="创建片段" visible confirmLoading={saving} onCancel={() => { if (!inProgress.current) onClose(); }} onOk={create}>
    <Form layout="vertical">
      <Form.Item label="片段名称"><Input aria-label="新片段名称" value={title} onChange={setTitle} disabled={saving}/></Form.Item>
      <Form.Item label="创建方式"><div className="scene-creation-options">
        <button type="button" className={mode === "default" ? "selected" : ""} aria-pressed={mode === "default"} disabled={saving}
          onClick={() => setMode("default")}><b>默认方式</b><span>使用片段表单设置画面、描述和生成参数</span></button>
        <button type="button" className={mode === "canvas" ? "selected" : ""} aria-pressed={mode === "canvas"} disabled={saving}
          onClick={() => setMode("canvas")}><b>画布方式</b><span>在画布中连接图片、音频与视频节点创作</span></button>
      </div></Form.Item>
    </Form>
  </Modal>;
}

export function ClipEditorOrderActions({episode, clip, project, reload, disabled, afterSave, onCreated}: {
  episode: Episode; clip: Clip; project: Project; reload: () => void; disabled: boolean;
  afterSave: (action: () => void) => void; onCreated: (clip: Clip) => void;
}) {
  const [position, setPosition] = useState<Position>();
  const [copying, setCopying] = useState(false);
  const copy = async (side: Position) => {
    setCopying(true);
    try {
      await post("/clips/duplicate", {project_id: project.id, id: clip.id, position: side});
      await reload();
      Message.success("片段已复制");
    } catch (error) { Message.error(String(error)); }
    finally { setCopying(false); }
  };
  return <>
    <EpisodeOrderControls episode={episode} id={clip.id} kind="clip" project={project} reload={reload}
      disabled={disabled || copying || !!position}
      actions={placementActions("片段", side => afterSave(() => setPosition(side)), side => afterSave(() => void copy(side)))} />
    {position && <ClipCreationDialog projectId={project.id} episode={episode} sceneId={clip.scene_id} anchorClipId={clip.id}
      position={position} reload={reload} onClose={() => setPosition(undefined)} onCreated={onCreated}/>}
  </>;
}
