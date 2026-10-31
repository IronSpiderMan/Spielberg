import { Message } from "@arco-design/web-react";
import { useRef, useState } from "react";
import { uploadMedia } from "../api";
import type { Media } from "../core";
import { localId } from "../id";

const extensions: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg" };
export const isSupportedImage = (file: File) => Boolean(extensions[file.type]);
export function supportedPastedImages(files: File[]) {
  return files.filter(file => {
    if (isSupportedImage(file)) return true;
    Message.error(`不支持粘贴的图片格式：${file.type}`);
    return false;
  });
}

export function useImageUpload({ projectId, reload, refreshError }: {
  projectId: string;
  reload: () => void | Promise<void>;
  refreshError: string;
}) {
  const [uploading, setUploading] = useState(false);
  const inProgress = useRef(false);
  const uploadImages = async (files: File[], { pasted = false, stopOnError = false, onUploaded, onComplete }: {
    pasted?: boolean;
    stopOnError?: boolean;
    onUploaded: (media: Media) => void;
    onComplete?: (count: number) => void;
  }) => {
    if (inProgress.current || !files.length) return 0;
    inProgress.current = true; setUploading(true);
    let count = 0;
    try {
      for (const file of files) {
        if (!isSupportedImage(file)) { Message.error(`不支持${pasted ? "粘贴的" : "的"}图片格式：${file.type}`); continue; }
        try {
          const named = pasted ? new File([file], `粘贴图片-${localId()}.${extensions[file.type]}`, { type: file.type }) : file;
          const media = await uploadMedia<Media>(projectId, named);
          onUploaded(media); count++;
        } catch (error) {
          Message.error(`图片上传失败：${String(error)}`);
          if (stopOnError) break;
        }
      }
      if (count) {
        onComplete?.(count);
        try { await reload(); } catch (error) { Message.error(`${refreshError}：${String(error)}`); }
      }
      return count;
    } finally { inProgress.current = false; setUploading(false); }
  };
  return { uploading, inProgress, uploadImages };
}
