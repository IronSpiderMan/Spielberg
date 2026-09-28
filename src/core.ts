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
};
export type FrameKey = "first" | "last" | "reference";
export type GenerationOptions = {
  custom?: boolean;
  first: boolean;
  last: boolean;
  reference: boolean;
  duration: number;
  aspect_ratio: string;
  size?: string;
};
export const defaultOptions: GenerationOptions = {
  custom: false,
  first: true,
  last: true,
  reference: false,
  duration: 5,
  aspect_ratio: "16:9",
  size: "1280x736",
};
export const GENERATION_SIZES = [
  { ratio: "16:9", label: "16:9 横屏", sizes: ["832x480", "1024x576", "1280x736", "1920x1088"] },
  { ratio: "9:16", label: "9:16 竖屏", sizes: ["480x832", "576x1024", "736x1280", "1088x1920"] },
  { ratio: "3:2", label: "3:2 横向照片", sizes: ["640x416", "960x640", "1536x1024", "1920x1280"] },
  { ratio: "2:3", label: "2:3 纵向照片", sizes: ["416x640", "640x960", "1024x1536", "1280x1920"] },
  { ratio: "1:1", label: "1:1 方形", sizes: ["512x512", "768x768", "1024x1024", "1536x1536", "2048x2048"] },
];
export type Scene = {
  script?: Record<FrameKey, string>;
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
  id: number;
  title: string;
  description: string;
  scenes: Scene[];
  cover_media?: Media;
};
export type Project = { id: string; name: string; path: string; updated_at: string };
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
export type Snapshot = {
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
