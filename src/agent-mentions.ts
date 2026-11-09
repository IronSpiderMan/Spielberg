import { assetCategoryLabel } from "./asset-categories";
import type { Snapshot } from "./core";
import { mentionPattern } from "./prompt-mentions";

type Target = { id: number } & (
  { resource: "assets" | "episodes" } |
  { resource: "media"; asset_id: number } |
  { resource: "scenes"; episode_id: number } |
  { resource: "clips"; episode_id: number; scene_id: number }
);
export type AgentReference = Target & { name: string };
export type AgentMention = AgentReference & { description: string };

const segment = (name: string) => name.trim().replace(/\s+/g, " ").replace(/@/g, "＠");
const targetKey = (target: Target) => [target.resource, target.id,
  "asset_id" in target ? target.asset_id : 0,
  "episode_id" in target ? target.episode_id : 0,
  "scene_id" in target ? target.scene_id : 0].join(":");

export function agentMentions(assets: Snapshot["assets"], episodes: Snapshot["episodes"], pinned: AgentReference[]): AgentMention[] {
  const reserved = new Map(pinned.map(item => [item.name, targetKey(item)]));
  const names = new Set<string>();
  const options: AgentMention[] = [];
  const add = (target: Target, path: string, description: string) => {
    const key = targetKey(target);
    const taken = (name: string) => names.has(name) || (reserved.has(name) && reserved.get(name) !== key);
    let name = path;
    if (taken(name)) name += `#${target.resource}-${target.id}`;
    while (taken(name)) name += "#";
    names.add(name);
    options.push({ ...target, name, description });
    return name;
  };
  const enabled = assets.filter(asset => asset.enabled !== false);
  const assetNames = new Map(enabled.map(asset => [asset.id, add({ resource: "assets", id: asset.id },
    segment(asset.name), `资产 · ${assetCategoryLabel(asset.category)}`)]));
  const episodeNames = new Map(episodes.map(episode => [episode.id, add({ resource: "episodes", id: episode.id },
    segment(episode.title), "剧集")]));
  for (const asset of enabled) {
    const images = asset.images.map(media => ({ media, name: media.name.replace(/\.[^.]+$/, "") || media.name, type: "图片" }));
    const audios = (asset.audios || []).map(media => ({ media, name: media.name, type: "音频" }));
    for (const { media, name, type } of [...images, ...audios]) {
      add({ resource: "media", id: media.id, asset_id: asset.id }, `${assetNames.get(asset.id)}.${segment(name)}`, `资产素材 · ${type} · ${media.name}`);
    }
  }
  for (const episode of episodes) {
    for (const scene of episode.scenes) {
      const parent = { episode_id: episode.id };
      const sceneName = add({ ...parent, resource: "scenes", id: scene.id }, `${episodeNames.get(episode.id)}.${segment(scene.title)}`, "场景");
      for (const clip of scene.clips) {
        add({ ...parent, resource: "clips", id: clip.id, scene_id: scene.id }, `${sceneName}.${segment(clip.title)}`, "片段");
      }
    }
  }
  return options;
}

export function referencedIn(text: string, selected: AgentReference[]): AgentReference[] {
  const pattern = mentionPattern(selected);
  if (!pattern) return selected;
  const names = new Set(Array.from(text.matchAll(pattern))
    .filter(match => !/[a-z0-9_@]/i.test(text.charAt(match.index! - 1)))
    .map(match => match[1]));
  return names.size === selected.length ? selected : selected.filter(reference => names.has(reference.name));
}
