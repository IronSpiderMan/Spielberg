import { Button, Empty, Form, Message, Modal, Select } from "@arco-design/web-react";
import { Film } from "lucide-react";
import { useState } from "react";
import { imageUrl, post, type Media, type Snapshot } from "../core";
import { sceneVideos } from "../scene-generation";

export function ClipFramePicker({data, reload, onSelect, disabled, onExtracting}: {data: Snapshot; reload: () => void | Promise<void>; onSelect: (media: Media) => void; disabled?: boolean; onExtracting?: (busy: boolean) => void}) {
  const [visible, setVisible] = useState(false);
  const [clipId, setClipId] = useState<number>();
  const [videoId, setVideoId] = useState<number>();
  const [frame, setFrame] = useState("first");
  const [busy, setBusy] = useState(false);
  const clips = data.episodes.flatMap(ep => ep.clips.filter(scene => sceneVideos(scene).length).map(scene => ({scene, label: `${ep.title} · ${scene.title}`})));
  const scene = clips.find(item => item.scene.id === clipId)?.scene;
  const videos = scene ? sceneVideos(scene) : [];
  const video = videos.find(item => item.id === videoId);
  const select = async () => {
    if (!scene || !video || busy || disabled) return;
    setBusy(true);
    onExtracting?.(true);
    try {
      const media = await post<Media>("/media/video-frame", {project_id: data.project.id, clip_id: scene.id, media_id: video.id, frame});
      onSelect(media);
      setVisible(false);
      await reload();
    } catch (error) {Message.error(String(error));}
    finally {setBusy(false); onExtracting?.(false);}
  };
  return <>
    <Button disabled={disabled} icon={<Film size={15}/>} onClick={() => {setClipId(undefined); setVideoId(undefined); setFrame("first"); setVisible(true);}}>从片段选择</Button>
    <Modal title="从片段视频选择图片" visible={visible} onCancel={() => !busy && setVisible(false)} maskClosable={!busy} closable={!busy} confirmLoading={busy} okButtonProps={{disabled: disabled || !video}} cancelButtonProps={{disabled: busy}} onOk={select} okText="使用此帧" unmountOnExit>
      {!clips.length ? <Empty description="暂无片段视频，请先生成视频"/> : <Form layout="vertical">
        <Form.Item label="片段"><Select placeholder="选择剧集中的片段" value={clipId} disabled={busy} onChange={id => {setClipId(id); setVideoId(undefined);}} showSearch>{clips.map(item => <Select.Option key={item.scene.id} value={item.scene.id}>{item.label}</Select.Option>)}</Select></Form.Item>
        <Form.Item label="视频版本"><Select placeholder="选择视频版本" value={videoId} disabled={busy || !scene} onChange={setVideoId}>{videos.map((item, i) => <Select.Option key={item.id} value={item.id}>版本 {i + 1} · {item.name}</Select.Option>)}</Select></Form.Item>
        <Form.Item label="选择画面"><Select value={frame} disabled={busy} onChange={setFrame}><Select.Option value="first">首帧</Select.Option><Select.Option value="last">尾帧</Select.Option></Select></Form.Item>
        {video && <video key={video.id} className="frame-picker-video" src={imageUrl(video)} controls preload="metadata"/>}
        <p className="subtle">确认后提取视频的实际首帧或尾帧，并保存为项目图片。</p>
      </Form>}
    </Modal>
  </>;
}
