import type { Media, Snapshot } from "./core";

const imageExtension = /\.(?:png|jpe?g|webp|gif|svg)$/i;
const avExtension = /\.(?:mp4|mov|webm|mkv|mp3|wav|m4a|aac|ogg|flac)$/i;
const segment = (name: string) => name.trim().replace(/\s+/g, " ");
const basename = (name: string) => segment(name.replace(/\.[^.]+$/, "") || name);
const mediaToken = /^(@.+)#([1-9][0-9]*)$/;
const libraryName = (name: string) => `素材库.${name}`;

type Option = { value: string; label: string; media: Media; searchText: string; duplicate?: boolean };
export function buildShotMediaCatalog(assets: Snapshot["assets"], projectMedia: Media[]) {
  const byId = new Map<number, Media>();
  for (const asset of assets) {
    for (const media of asset.images) byId.set(media.id, media);
  }
  for (const media of projectMedia) byId.set(media.id, media);
  const byPath = new Map([...byId.values()].map(media => [media.path, media]));
  const options = new Map<string, Option>();
  const preferred = new Map<number, Option>();
  const add = (media: Media, name: string, fullName: string) => {
    if (media.kind !== "image") return;
    const value = `@${name}#${media.id}`;
    const option = { value, label: "@" + name, media, searchText: `${name} ${fullName} ${media.name}`.toLowerCase() };
    options.set(value, option);
    if (!preferred.has(media.id)) preferred.set(media.id, option);
  };
  for (const asset of assets) {
    if (asset.enabled === false) continue;
    for (const linked of asset.images) {
      const media = byId.get(linked.id) || linked;
      add(media, `${segment(asset.name)}.${basename(media.name)}`, `${segment(asset.name)}.${segment(media.name)}`);
    }
  }
  for (const media of projectMedia) {
    if (!preferred.has(media.id)) add(media, libraryName(basename(media.name)), libraryName(segment(media.name)));
  }
  const labels = new Map<string, Option>();
  for (const option of options.values()) {
    const previous = labels.get(option.label);
    if (previous) previous.duplicate = option.duplicate = true;
    else labels.set(option.label, option);
  }
  return { byId, byPath, preferred, labels, options: [...options.values()] };
}

export function resolveShotImage(reference: string, catalog: ReturnType<typeof buildShotMediaCatalog>) {
  const match = reference.match(mediaToken);
  // Earlier documents stored file paths, and some stored the numeric media ID instead.
  const media = match ? catalog.byId.get(Number(match[2]))
    : catalog.byPath.get(reference) || (/^[1-9][0-9]*$/.test(reference) ? catalog.byId.get(Number(reference)) : undefined);
  if (media) {
    if (media.kind !== "image") return undefined;
    const preferred = catalog.preferred.get(media.id)?.label || "@" + libraryName(basename(media.name));
    return { media, label: match && match[1].includes(".") && match[1] !== "@" + basename(media.name) ? match[1] : preferred };
  }
  if (match) return { label: match[1] };
  if (reference.startsWith("@")) {
    const option = catalog.labels.get(reference);
    return { label: reference, media: option?.duplicate ? undefined : option?.media };
  }
  const name = reference.split(/[\\/]/).pop() || reference;
  if (avExtension.test(name)) return undefined;
  return {
    media: imageExtension.test(name) ? { id: 0, path: reference, name, kind: "image", created_at: "" } : undefined,
    label: "@" + libraryName(basename(name)),
  };
}
