import { Message } from "@arco-design/web-react";
import { useRef, useState } from "react";
import { post } from "../core";

export function usePromptOptimization() {
  const [optimizing, setOptimizing] = useState(false);
  const running = useRef(false);
  const optimize = async ({ projectId, prompt, kind, imageIds = [], instruction, h3, onOptimized, successMessage = "Prompt 已优化" }: {
    projectId: string;
    prompt: string;
    kind: "image" | "video";
    imageIds?: number[];
    instruction?: string;
    h3?: { mode: "t2va" | "i2va" | "l2va" | "fl2va" | "ref2va"; duration: number; videoIds?: number[]; audioIds?: number[] };
    onOptimized: (prompt: string) => void;
    successMessage?: string | null;
  }) => {
    if (running.current || !prompt.trim()) return;
    running.current = true; setOptimizing(true);
    try {
      const result = await post<{ prompt: string }>("/prompts/optimize", {
        project_id: projectId, prompt, kind, instruction, image_media_ids: h3?.mode === "fl2va" ? imageIds : [...new Set(imageIds)],
        ...(h3 ? { prompt_format: "minimax-h3", h3_mode: h3.mode, duration: h3.duration,
          reference_video_media_ids: [...new Set(h3.videoIds || [])], reference_audio_media_ids: [...new Set(h3.audioIds || [])] } : {}),
      });
      onOptimized(result.prompt);
      if (successMessage) Message.success(successMessage);
    } catch (error) { Message.error(String(error)); }
    finally { running.current = false; setOptimizing(false); }
  };
  return { optimizing, optimize };
}
