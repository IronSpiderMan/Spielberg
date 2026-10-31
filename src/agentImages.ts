import { type Media } from "./core";

export type ImageMessage = { role: string; content: string; images?: string[]; image_media_ids?: number[]; tool_name?: string; arguments?: unknown; status?: string };

// Only generation output is eligible: reference images in arguments must never
// be presented as successful output. Bounded tool results may wrap data.
export function generatedImages(message: ImageMessage, currentMedia: Map<number, Media>): Media[] {
  if (message.status === "running" || message.status === "failed" || message.status === "skipped" || message.tool_name !== "app_action" ||
      !message.arguments || typeof message.arguments !== "object" ||
      (message.arguments as Record<string, unknown>).operation !== "generations/image") return [];
  try {
    const result = JSON.parse(message.content);
    const found = new Map<number, Media>();
    const visit = (value: unknown) => {
      if (typeof value === "string") { try { visit(JSON.parse(value)); } catch { /* Plain text is not a media result. */ } return; }
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) { value.forEach(visit); return; }
      const item = value as Record<string, unknown>;
      const id = typeof item.media_id === "number" ? item.media_id : item.id;
      const current = typeof id === "number" ? currentMedia.get(id) : undefined;
      if ((current?.kind === "image" && (item.kind === "image" || typeof item.media_id === "number" || typeof item.path === "string")) || (typeof id === "number" && item.kind === "image" && typeof item.path === "string" && item.path)) {
        // Tool history can still contain paths from the machine before migration.
        // Asset IDs survive backup/restore, so use the project's current asset.
        found.set(id as number, current || { id: id as number, kind: "image", path: item.path as string,
          name: typeof item.name === "string" ? item.name : "生成图片", created_at: typeof item.created_at === "string" ? item.created_at : "" });
        return;
      }
      Object.values(item).forEach(visit);
    };
    visit(result);
    return [...found.values()];
  } catch { return []; }
}

export function attachmentImage(message: ImageMessage, messageIndex: number, index: number, media: Map<number, Media>): Media {
  const asset = media.get(message.image_media_ids?.[index] ?? 0);
  return asset?.kind === "image" ? asset : { id: -(messageIndex + 1) * 1000 - index - 1, kind: "image", path: "", preview_url: message.images?.[index], name: `附件图片 ${index + 1}`, created_at: "" };
}

export function conversationImages(messages: ImageMessage[], media: Map<number, Media>): Media[] {
  const found = new Map<string, Media>();
  const add = (image: Media) => {
    const key = image.preview_url || `media:${image.id}`;
    if (!found.has(key)) found.set(key, image);
  };
  messages.forEach((message, messageIndex) => {
    message.images?.forEach((_, index) => add(attachmentImage(message, messageIndex, index, media)));
    generatedImages(message, media).forEach(add);
    if (message.role === "assistant") {
      for (const match of message.content.matchAll(/!\[([^\]]*)\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)/g)) {
        const url = match[2] || match[3];
        if (!/^(https?:\/\/|data:image\/|\/)/i.test(url)) continue;
        add({ id: -1_000_000 - messageIndex * 1000 - found.size, kind: "image", path: "", preview_url: url, name: match[1] || "对话图片", created_at: "" });
      }
    }
  });
  return [...found.values()];
}
