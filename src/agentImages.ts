import { imageUrl, type Media } from "./core";
import { backendUrl } from "./transport";

export type ImageMessage = { role: string; content: string; images?: string[]; image_media_ids?: number[]; tool_name?: string; arguments?: unknown; status?: string };

// Preview only media created by generation actions, never queries or exports.
// Bounded tool results and saved task results can wrap or JSON-encode data.
export function toolMedia(message: ImageMessage, currentMedia: Map<number, Media>): Media[] {
  if (message.tool_name === "request_user_input" && message.status === "completed") {
    try {
      const result = JSON.parse(message.content);
      const tool = (message.arguments as { tool?: { name: string; arguments: unknown } } | undefined)?.tool;
      if (!tool || result.approved !== true || result.executed !== true || result.tool_error) return [];
      return toolMedia({ ...message, tool_name: tool.name, arguments: tool.arguments, content: JSON.stringify(result.tool_result) }, currentMedia);
    } catch { return []; }
  }
  if (["running", "failed", "skipped", "cancelled"].includes(message.status || "") || !message.arguments || typeof message.arguments !== "object") return [];
  const args = message.arguments as Record<string, unknown>;
  const output = message.tool_name === "app_action" && ["generations/image", "generations/video", "generations/tts", "media/create-svg"].includes(String(args.operation));
  if (!output) return [];
  try {
    const result = JSON.parse(message.content);
    const found = new Map<number, Media>();
    const visit = (value: unknown) => {
      if (typeof value === "string") { try { visit(JSON.parse(value)); } catch { /* Plain text is not a media result. */ } return; }
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) { value.forEach(visit); return; }
      const item = value as Record<string, unknown>;
      if (["running", "pending", "failed", "skipped", "cancelled", "interrupted"].includes(String(item.status))) return;
      const id = typeof item.media_id === "number" ? item.media_id : item.id;
      const current = typeof id === "number" ? currentMedia.get(id) : undefined;
      if ((current && ["image", "audio", "video"].includes(current.kind) && (item.kind === current.kind || typeof item.media_id === "number" || typeof item.path === "string")) || (typeof id === "number" && ["image", "audio", "video"].includes(String(item.kind)) && typeof item.path === "string" && item.path)) {
        // Tool history can still contain paths from the machine before migration.
        // Asset IDs survive backup/restore, so use the project's current asset.
        found.set(id as number, current || { id: id as number, kind: item.kind as string, path: item.path as string,
          name: typeof item.name === "string" ? item.name : "媒体素材", created_at: typeof item.created_at === "string" ? item.created_at : "" });
        return;
      }
      Object.entries(item).forEach(([key, value]) => {
        if (!["arguments", "request", "request_json", "input", "references", "resume_json"].includes(key)) visit(value);
      });
    };
    visit(result);
    return [...found.values()];
  } catch { return []; }
}

export function mediaFromUrl(source: string, name: string, media: Map<number, Media>, projectId: string, image = false): Media | null {
  const src = /^(\/api\/v1\/|\/media(?:\?|$))/.test(source) ? backendUrl(source) : source;
  const current = [...media.values()].find(item => source === item.path || src === imageUrl(item));
  if (current) return current;
  if (!/^(https?:\/\/|data:image\/|\/)/i.test(src)) return null;
  try {
    const url = new URL(src, location.href);
    const backend = new URL(backendUrl("/"), location.href);
    if (url.origin === backend.origin) {
      const match = url.pathname.match(/^\/api\/v1\/projects\/([^/]+)\/media\/(\d+)\/content$/);
      if (match && decodeURIComponent(match[1]) === projectId) {
        const asset = media.get(Number(match[2]));
        if (asset) return asset;
      }
      const path = url.pathname === "/media" ? url.searchParams.get("path") : null;
      const asset = path && [...media.values()].find(item => item.path === path);
      if (asset) return asset;
    }
    const path = url.pathname === "/media" ? url.searchParams.get("path") || "" : url.pathname;
    const kind = image || /^data:image\//i.test(src) || /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(path) ? "image"
      : /\.(mp4|webm|mov|m4v|ogv|mkv)$/i.test(path) ? "video"
      : /\.(mp3|wav|ogg|m4a|aac|flac|opus)$/i.test(path) ? "audio" : null;
    if (!kind) return null;
    // Stable across renders, without colliding with positive project media IDs.
    let hash = 0;
    for (const char of src) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
    return { id: -10_000_000 - hash, kind, path: "", preview_url: src, name: name || "对话媒体", created_at: "" };
  } catch { return null; }
}

export function attachmentImage(message: ImageMessage, messageIndex: number, index: number, media: Map<number, Media>): Media {
  const asset = media.get(message.image_media_ids?.[index] ?? 0);
  return asset?.kind === "image" ? asset : { id: -(messageIndex + 1) * 1000 - index - 1, kind: "image", path: "", preview_url: message.images?.[index], name: `附件图片 ${index + 1}`, created_at: "" };
}

export function conversationImages(messages: ImageMessage[], media: Map<number, Media>, projectId: string): Media[] {
  const found = new Map<string, Media>();
  const add = (image: Media) => {
    const key = image.preview_url || `media:${image.id}`;
    if (!found.has(key)) found.set(key, image);
  };
  messages.forEach((message, messageIndex) => {
    message.images?.forEach((_, index) => add(attachmentImage(message, messageIndex, index, media)));
    toolMedia(message, media).filter(item => item.kind === "image").forEach(add);
    if (message.role === "assistant") {
      for (const match of message.content.matchAll(/!\[([^\]]*)\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)/g)) {
        const url = match[2] || match[3];
        const asset = mediaFromUrl(url, match[1] || "对话图片", media, projectId, true);
        if (asset?.kind === "image") add(asset);
      }
    }
  });
  return [...found.values()];
}
