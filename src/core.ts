import { convertFileSrc, invoke } from "@tauri-apps/api/core";
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
};
export const defaultOptions: GenerationOptions = {
  custom: false,
  first: true,
  last: true,
  reference: false,
  duration: 5,
  aspect_ratio: "16:9",
};
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
  project: Project;
  roles: Role[];
  prompts: { id: number; name: string; content: string; category: string }[];
  episodes: Episode[];
  media: Media[];
  settings: ModelSettings;
};
export const api = async <T,>(path: string, options: RequestInit = {}): Promise<T> =>
  invoke<T>("api_request", {
    method: options.method || "GET",
    path,
    payload: options.body ? JSON.parse(String(options.body)) : null,
  });
export const post = <T,>(path: string, data?: unknown) =>
  api<T>(path, { method: "POST", body: JSON.stringify(data || {}) });
export const imageUrl = (m?: Media) => (m ? convertFileSrc(m.path) : "");
