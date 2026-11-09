import { defaultOptions, normalizeGenerationSize, type GenerationOptions, type Clip, type Scene } from "./core";

export const clipDefaultFields = ["channel_id", "model", "duration", "aspect_ratio", "size", "resolution", "audio"] as const;

// Keep authored options separate from these resolved defaults so saving a clip
// never freezes the values it inherits from its scene.
export function sceneGenerationOptions(clip: Pick<Clip, "generation_options" | "reference_media_id" | "script"> & Partial<Pick<Clip, "first_media_id">>, parent?: Scene): GenerationOptions & { video_mode: "t2v" | "fl2v" | "i2v" } {
  const stored = clip.generation_options;
  const defaults = parent?.generation_options;
  const referenceIds = stored?.reference_media_ids ?? (clip.reference_media_id ? [clip.reference_media_id] : []);
  const hasLocalReferences = referenceIds.length || stored?.reference_video_media_ids?.length || stored?.reference_audio_media_ids?.length
    || stored?.reference || clip.script?.reference || clip.script?.references?.some(Boolean);
  const localMode = hasLocalReferences ? "i2v" : clip.first_media_id ? "fl2v" : undefined;
  const { images, videos, audios } = sharedClipReferences(parent, stored);
  const mode = stored?.video_mode ?? localMode ?? (images.length || videos.length || audios.length ? "i2v" : "t2v");
  const ratio = stored?.aspect_ratio ?? defaults?.aspect_ratio ?? defaultOptions.aspect_ratio;
  const hasSelection = !!(stored?.channel_id || stored?.model);
  const selection = hasSelection ? stored : defaults;
  const modelDefaults = !hasSelection ? defaults : undefined;
  return {
    ...defaultOptions,
    ...stored,
    channel_id: selection?.channel_id,
    model: selection?.model,
    duration: stored?.duration ?? defaults?.duration ?? defaultOptions.duration,
    resolution: stored?.resolution ?? modelDefaults?.resolution,
    audio: stored?.audio ?? modelDefaults?.audio,
    video_mode: mode === "ref2v" ? "i2v" : mode,
    aspect_ratio: ratio,
    size: normalizeGenerationSize(ratio, stored?.size ?? defaults?.size),
    reference_media_ids: referenceIds,
  };
}

export function sharedClipReferences(parent?: Scene, local?: Partial<GenerationOptions>) {
  return {
    images: (parent?.reference_media_ids || []).filter(id => !local?.exclude_shared_reference_media_ids?.includes(id)),
    videos: (parent?.generation_options?.reference_video_media_ids || []).filter(id => !local?.exclude_shared_reference_video_media_ids?.includes(id)),
    audios: (parent?.reference_audio_media_ids || []).filter(id => !local?.exclude_shared_reference_audio_media_ids?.includes(id)),
  };
}

export const sceneVideos = (scene: Pick<Clip, "videos" | "video_media">) =>
  scene.videos || (scene.video_media ? [scene.video_media] : []);
