import { normalizeGenerationSize } from "./generation-sizes";

export type VideoMode = "t2v" | "fl2v" | "i2v";

// All entry points use the same mode contract; irrelevant image inputs must
// never leak from an earlier mode into a submitted request.
export function buildVideoRequest({ mode, prompt, duration, ratio, size, sceneId, firstId, lastId, referenceIds = [], referenceVideoIds = [], referenceAudioIds = [], label = "" }: {
  mode: VideoMode;
  prompt: string;
  duration: number;
  ratio: string;
  size?: string;
  sceneId?: number;
  firstId?: number | null;
  lastId?: number | null;
  referenceIds?: number[];
  referenceVideoIds?: number[];
  referenceAudioIds?: number[];
  label?: string;
}) {
  const fail = (message: string): never => { throw new Error(`${label ? `${label}：` : ""}${message}`); };
  const ids = mode === "i2v" ? [...new Set(referenceIds)] : [];
  const videos = mode === "i2v" ? [...new Set(referenceVideoIds)] : [];
  const audios = mode === "i2v" ? [...new Set(referenceAudioIds)] : [];
  if (!prompt.trim()) fail("请填写视频描述");
  if (mode === "fl2v" && !firstId) fail("请选择首帧图片");
  if (mode === "i2v" && !ids.length && !videos.length && !audios.length) fail("全能参考至少需要一种参考素材（图片、视频或音频）");
  if (ids.length > 9 || videos.length > 3 || audios.length > 3) fail("全能参考最多支持 9 张图片、3 个视频和 3 个音频");
  return {
    ...(sceneId === undefined ? {} : { scene_id: sceneId }),
    operation: mode === "i2v" ? "ref2v" : mode,
    ...(mode === "t2v" ? {} : { video_mode: mode }),
    prompt, duration, aspect_ratio: ratio, size: normalizeGenerationSize(ratio, size),
    first_media_id: mode === "fl2v" ? firstId : null,
    last_media_id: mode === "fl2v" ? lastId : null,
    image_media_ids: ids,
    image_media_id: null,
    ...(videos.length ? { reference_video_media_ids: videos } : {}),
    ...(audios.length ? { reference_audio_media_ids: audios } : {}),
  };
}
