import { Message } from "@arco-design/web-react";
import { useRef, useState } from "react";
import { post } from "../core";

export function usePromptOptimization() {
  const [optimizing, setOptimizing] = useState(false);
  const running = useRef(false);
  const optimize = async ({ projectId, prompt, kind, imageIds = [], instruction, onOptimized, successMessage = "Prompt 已优化" }: {
    projectId: string;
    prompt: string;
    kind: "image" | "video";
    imageIds?: number[];
    instruction?: string;
    onOptimized: (prompt: string) => void;
    successMessage?: string | null;
  }) => {
    if (running.current || !prompt.trim()) return;
    running.current = true; setOptimizing(true);
    try {
      const result = await post<{ prompt: string }>("/prompts/optimize", {
        project_id: projectId, prompt, kind, instruction, image_media_ids: [...new Set(imageIds)],
      });
      onOptimized(result.prompt);
      if (successMessage) Message.success(successMessage);
    } catch (error) { Message.error(String(error)); }
    finally { running.current = false; setOptimizing(false); }
  };
  return { optimizing, optimize };
}
