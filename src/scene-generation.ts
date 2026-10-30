import { defaultOptions, normalizeGenerationSize, type GenerationOptions, type Scene } from "./core";

// Stored projects may use the API name ref2v for the UI's i2v mode.
// Resolve it once for editor tabs, script drafts, previews and batch requests.
export function sceneGenerationOptions(scene: Pick<Scene, "generation_options" | "reference_media_id" | "script">): GenerationOptions & { video_mode: "fl2v" | "i2v" } {
  const stored = scene.generation_options;
  const referenceIds = stored?.reference_media_ids ?? (scene.reference_media_id ? [scene.reference_media_id] : []);
  const hasReferences = referenceIds.length || stored?.reference_video_media_ids?.length || stored?.reference_audio_media_ids?.length || stored?.reference || scene.script?.reference || scene.script?.references?.some(Boolean);
  const mode = stored?.video_mode;
  const ratio = stored?.aspect_ratio || defaultOptions.aspect_ratio;
  return {
    ...defaultOptions,
    ...stored,
    video_mode: mode === "fl2v" ? "fl2v" : mode === "i2v" || mode === "ref2v" || hasReferences ? "i2v" : "fl2v",
    aspect_ratio: ratio,
    size: normalizeGenerationSize(ratio, stored?.size),
    reference_media_ids: referenceIds,
  };
}
