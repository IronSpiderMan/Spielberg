export type VideoMode = "t2v" | "fl2v" | "i2v";

// All entry points use the same mode contract; irrelevant image inputs must
// never leak from an earlier mode into a submitted request.
export function buildVideoRequest({ mode, prompt, duration, ratio, size, sceneId, firstId, lastId, referenceIds = [], label = "" }: {
  mode: VideoMode;
  prompt: string;
  duration: number;
  ratio: string;
  size?: string;
  sceneId?: number;
  firstId?: number | null;
  lastId?: number | null;
  referenceIds?: number[];
  label?: string;
}) {
  const fail = (message: string): never => { throw new Error(`${label ? `${label}：` : ""}${message}`); };
  const ids = mode === "i2v" ? [...new Set(referenceIds)] : [];
  if (!prompt.trim()) fail("请填写视频描述");
  if (mode === "fl2v" && !firstId) fail("请选择首帧图片");
  if (mode === "i2v" && (!ids.length || ids.length > 9)) fail("全能参考需要 1 到 9 张参考图");
  return {
    ...(sceneId === undefined ? {} : { scene_id: sceneId }),
    operation: mode,
    ...(mode === "t2v" ? {} : { video_mode: mode }),
    prompt, duration, aspect_ratio: ratio, size,
    first_media_id: mode === "fl2v" ? firstId : null,
    last_media_id: mode === "fl2v" ? lastId : null,
    image_media_ids: ids,
    image_media_id: null,
  };
}
