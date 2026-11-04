export const STUDIO_IMAGE_MIME = "application/x-spielberg-image";

export type StudioImageDragPayload = {
  projectId: string;
  mediaId: number;
};

export function serializeStudioImageDrag(payload: StudioImageDragPayload): string {
  return JSON.stringify(payload);
}

export function parseStudioImageDrag(raw: string): StudioImageDragPayload | null {
  try {
    const payload: unknown = JSON.parse(raw);
    if (!payload || typeof payload !== "object") return null;
    const { projectId, mediaId } = payload as Partial<StudioImageDragPayload>;
    if (typeof projectId !== "string" || !projectId.trim()
      || typeof mediaId !== "number" || !Number.isSafeInteger(mediaId) || mediaId <= 0) return null;
    return { projectId, mediaId };
  } catch {
    return null;
  }
}
