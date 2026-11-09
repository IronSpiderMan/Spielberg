import type {AssetCategory} from "./asset-categories";

export type Media = {
  preview_url?: string;
  id: number;
  name: string;
  path: string;
  kind: string;
  created_at: string;
};
export type Asset = {
  id: number;
  name: string;
  description: string;
  enabled: boolean;
  category: AssetCategory;
  design_media_id: number | null;
  images: Media[];
  audios?: Media[];
};
export type FrameKey = "first" | "last" | "reference";
export type GenerationOptions = {
  video_mode?: "t2v" | "fl2v" | "i2v" | "ref2v";
  custom?: boolean;
  first: boolean;
  last: boolean;
  reference: boolean;
  duration: number;
  aspect_ratio: string;
  size?: string;
  channel_id?: string;
  model?: string;
  resolution?: string;
  audio?: boolean;
  reference_media_ids?: number[];
  reference_video_media_ids?: number[];
  reference_audio_media_ids?: number[];
  exclude_shared_reference_media_ids?: number[];
  exclude_shared_reference_audio_media_ids?: number[];
  exclude_shared_reference_video_media_ids?: number[];
  inherit_shared_prompt?: boolean;
  first_media_id?: number | null;
  last_media_id?: number | null;
};
export const defaultOptions: GenerationOptions = {
  custom: false,
  first: true,
  last: true,
  reference: false,
  duration: 5,
  aspect_ratio: "16:9",
  size: "1344x768",
};
export { GENERATION_SIZES, defaultGenerationSize, normalizeGenerationSize } from "./generation-sizes";
export function sceneVideoPrompt(scene: {prompt?: string; description: string}): string {
  return scene.prompt?.trim() ? scene.prompt : scene.description;
}
export type Clip = {
  scene_id: number;
  creation_mode?: "default" | "canvas";
  prompt?: string;
  script?: Record<FrameKey, string> & { references?: string[] };
  generation_options?: Partial<GenerationOptions>;
  videos?: Media[];
  id: number;
  title: string;
  description: string;
  sort_order: number;
  first_media_id: number | null;
  last_media_id: number | null;
  reference_media_id: number | null;
  video_media_id?: number | null;
  first_media?: Media;
  last_media?: Media;
  reference_media?: Media;
  video_media?: Media;
};
export type PlaybackUnit = Pick<Clip, "id" | "scene_id" | "title" | "video_media_id" | "video_media" | "videos"> & { kind: "scene" | "clip" };
export type Scene = {
  id: number;
  episode_id: number;
  title: string;
  description: string;
  sort_order: number;
  shared_prompt: string;
  reference_media_ids: number[];
  reference_audio_media_ids: number[];
  generation_mode: "clips" | "one_take";
  generation_options: Partial<GenerationOptions>;
  clips: Clip[];
  videos?: Media[];
  video_media_id?: number | null;
  video_media?: Media;
};
export type GenerationPreview = {
  prompt: string;
  channel_id?: string;
  model?: string;
  aspect_ratio?: string;
  resolution?: string;
  duration: number;
  image_media_ids?: number[];
  reference_audio_media_ids?: number[];
  reference_video_media_ids?: number[];
  first_media_id?: number | null;
  last_media_id?: number | null;
  beats?: { clip_id: number; title: string; start: number; end: number }[];
  warnings?: string[];
};
export type Episode = {
  storyboard?: import("./StoryboardEditor").Storyboard;
  id: number;
  title: string;
  description: string;
  clips: Clip[];
  scenes: Scene[];
  playback_units: PlaybackUnit[];
  cover_media?: Media;
};
export type ProjectDocument = { id: string; title: string; content: string };
export type ProjectTimelineEvent = { id: string; content: string };
export type ProjectTimelineEntry = { id: string; time: string; events: ProjectTimelineEvent[] };
export type ProjectTimeline = { id: string; title: string; description: string; entries: ProjectTimelineEntry[] };
export type Project = { id: string; name: string; path: string; updated_at: string; outline?: string; agents_md?: string; documents?: ProjectDocument[]; timelines?: ProjectTimeline[] };
export type ModelSettings = Record<
  string,
  {
    provider?: import("./generation-channels").ChannelProvider;
    url: string;
    base_url?: string;
    api_key: string;
    model?: string;
    i2v_model?: string;
    r2v_model?: string;
    resolution?: string;
    cast_base_url?: string;
    qianwen_base_url?: string;
    channels?: import("./generation-channels").GenerationChannel[];
    default_channel_id?: string;
    description: string;
  }
>;
export type Screenplay = { episode_id: number; format: "markdown" | "csv"; id: number; title: string; content: string; created_at: string; updated_at: string };
export type Snapshot = {
  asset_relations?: import("./AssetRelationships").AssetRelation[];
  screenplays?: Screenplay[];
  revisions?: Record<string,number>;
  project: Project;
  assets: Asset[];
  prompts: { id: number; name: string; content: string; category: string }[];
  episodes: Episode[];
  media: Media[];
  settings: ModelSettings;
};
export { api, post } from "./api";
import { backendUrl } from "./transport";
export const fileUrl = (path: string) => backendUrl(`/media?path=${encodeURIComponent(path)}`);
export const imageUrl = (m?: Media) => (m ? m.preview_url || fileUrl(m.path) : "");
