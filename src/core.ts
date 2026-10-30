export type Media = {
  id: number;
  name: string;
  path: string;
  kind: string;
  created_at: string;
};
export type Role = {
  id: number;
  name: string;
  description: string;
  design_media_id: number | null;
  images: Media[];
  audios?: Media[];
};
export type FrameKey = "first" | "last" | "reference";
export type GenerationOptions = {
  video_mode?: "fl2v" | "i2v" | "ref2v";
  custom?: boolean;
  first: boolean;
  last: boolean;
  reference: boolean;
  duration: number;
  aspect_ratio: string;
  size?: string;
  reference_media_ids?: number[];
  reference_video_media_ids?: number[];
  reference_audio_media_ids?: number[];
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
export type Scene = {
  creation_mode?: "default" | "canvas";
  prompt?: string;
  script?: Record<FrameKey, string> & { references?: string[] };
  generation_options?: GenerationOptions;
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
export type Episode = {
  storyboard?: import("./StoryboardEditor").Storyboard;
  id: number;
  title: string;
  description: string;
  scenes: Scene[];
  cover_media?: Media;
};
export type ProjectDocument = { id: string; title: string; content: string };
export type Project = { id: string; name: string; path: string; updated_at: string; outline?: string; documents?: ProjectDocument[] };
export type ModelSettings = Record<
  string,
  {
    provider?: "cast" | "openai";
    url: string;
    base_url?: string;
    api_key: string;
    model?: string;
    description: string;
  }
>;
export type Screenplay = { episode_id: number; format: "markdown" | "csv"; id: number; title: string; content: string; created_at: string; updated_at: string };
export type Snapshot = {
  screenplays?: Screenplay[];
  revisions?: Record<string,number>;
  project: Project;
  roles: Role[];
  prompts: { id: number; name: string; content: string; category: string }[];
  episodes: Episode[];
  media: Media[];
  settings: ModelSettings;
};
export { api, post } from "./api";
import { backendUrl } from "./transport";
export const fileUrl = (path: string) => backendUrl(`/media?path=${encodeURIComponent(path)}`);
export const imageUrl = (m?: Media) => (m ? fileUrl(m.path) : "");
