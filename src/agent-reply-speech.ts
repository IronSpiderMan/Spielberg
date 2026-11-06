import { useCallback, useEffect, useRef, useState } from "react";
import type { ModelSettings } from "./core";
import type { AgentFloatSpeechPreferences } from "./agent-float-preferences";
import { generationChoice, selectionPayload } from "./generation-channels";
import { request } from "./transport";

const stopPlaybackEvent = "spielberg-agent-speech-stop";
export function stopAgentSpeechPlayback() {
  window.dispatchEvent(new Event(stopPlaybackEvent));
}

export function spokenText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, "\n代码内容请查看文字回复。\n")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
    .replace(/^\s*\[[^\]]+\]:.*$/gm, "")
    .replace(/<[^>]+>/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+(?:\[[ xX]\]\s*)?)/gm, "")
    .replace(/^\s*\|?\s*:?-{3,}.*$/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\|/g, "，")
    .replace(/&(?:amp|lt|gt|quot|nbsp);/g, value => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&nbsp;": " " })[value] || value)
    .replace(/\n{3,}/g, "\n\n").trim();
}

export function speechChunks(text: string, limit = 3500): string[] {
  const chars = Array.from(text), chunks: string[] = [];
  for (let offset = 0; offset < chars.length;) {
    let end = Math.min(offset + limit, chars.length);
    if (end < chars.length) {
      for (let i = end - 1; i > offset + limit / 2; i--) {
        if (/[。！？!?；;\n\s]/.test(chars[i])) { end = i + 1; break; }
      }
    }
    const chunk = chars.slice(offset, end).join("").trim();
    if (chunk) chunks.push(chunk);
    offset = end;
  }
  return chunks;
}

export function useAgentReplySpeech(projectId: string | undefined, preferences: AgentFloatSpeechPreferences, settings: ModelSettings) {
  const [state, setState] = useState<"idle" | "loading" | "speaking">("idle");
  const [error, setError] = useState("");
  const mounted = useRef(true);
  const version = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const cached = useRef<{ key: string; chunks: string[] } | null>(null);
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  const stop = useCallback(() => {
    version.current++;
    pending.current?.abort(); pending.current = null;
    if (audio.current) { audio.current.pause(); audio.current.removeAttribute("src"); audio.current.load(); }
    if (utterance.current) { window.speechSynthesis?.cancel(); utterance.current = null; }
    if (mounted.current) { setState("idle"); setError(""); }
  }, []);
  useEffect(() => {
    mounted.current = true;
    window.addEventListener(stopPlaybackEvent, stop);
    return () => { mounted.current = false; window.removeEventListener(stopPlaybackEvent, stop); stop(); };
  }, [stop]);
  const { provider, channel_id, model, voice, speed } = preferences.tts;
  // Changing voices, disabling automatic playback, or changing projects cancels old audio.
  useEffect(() => { stop(); }, [projectId, provider, channel_id, model, voice, speed, preferences.autoRead, stop]);
  useEffect(() => { cached.current = null; stop(); }, [settings, stop]);

  const play = useCallback(async (markdown: string) => {
    // Settings previews and assistant replies share one speaker; new audio replaces old audio.
    stopAgentSpeechPlayback();
    stop();
    const text = spokenText(markdown);
    if (!projectId || !text || !mounted.current) return;
    const token = version.current;
    const controller = new AbortController(); pending.current = controller;
    const current = () => mounted.current && token === version.current && !controller.signal.aborted;
    try {
      const choice = provider === "cloud" ? generationChoice(settings, "tts", { channel_id, model }, "tts") : undefined;
      if (provider === "cloud" && !choice) throw new Error("请在「Agent 悬浮按钮」设置中选择有效的 TTS 渠道与模型。");
      if (provider === "system" && !("speechSynthesis" in window)) throw new Error("当前环境不支持系统朗读，请在设置中选择项目 TTS 渠道。");
      const cacheKey = JSON.stringify([projectId, provider, selectionPayload(choice), voice, speed, text]);
      if (cached.current?.key !== cacheKey) cached.current = { key: cacheKey, chunks: [] };
      for (const [index, chunk] of speechChunks(text, provider === "system" ? 240 : Math.min(3500, choice?.capabilities.max_text || 3500)).entries()) {
        if (!current()) return;
        setState("loading");
        if (provider === "system") {
          await new Promise<void>((resolve, reject) => {
            const speech = new SpeechSynthesisUtterance(chunk);
            utterance.current = speech;
            speech.lang = "zh-CN"; speech.rate = speed;
            const chinese = window.speechSynthesis.getVoices().find(item => /^zh[-_]CN$/i.test(item.lang))
              || window.speechSynthesis.getVoices().find(item => /^zh/i.test(item.lang));
            if (chinese) speech.voice = chinese;
            const cleanup = () => { controller.signal.removeEventListener("abort", aborted); speech.onend = null; speech.onerror = null; speech.onstart = null; };
            const aborted = () => { cleanup(); reject(new DOMException("朗读已取消", "AbortError")); };
            controller.signal.addEventListener("abort", aborted, { once: true });
            speech.onstart = () => { if (current()) setState("speaking"); };
            speech.onend = () => { cleanup(); utterance.current = null; resolve(); };
            speech.onerror = event => { cleanup(); utterance.current = null; reject(new Error(event.error === "not-allowed" ? "播放被拦截，请点击「朗读回复」重试。" : "系统朗读失败，请重试或切换项目 TTS 渠道。")); };
            window.speechSynthesis.speak(speech);
          });
        } else {
          let source = cached.current?.chunks[index];
          if (!source) {
            const result = await request<{ audio_data_url: string }>("/api/v1/actions/speech/synthesize", {
              method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ project_id: projectId, text: chunk, ...selectionPayload(choice), format: "wav",
                ...(voice.trim() ? { voice: voice.trim() } : {}), ...(choice?.capabilities.speed ? { speed } : {}) }),
            });
            if (!current()) return;
            if (!/^data:audio\/(?:mpeg|wav);base64,/.test(result.audio_data_url)) throw new Error("TTS 服务返回了无效的音频。");
            source = result.audio_data_url;
            cached.current!.chunks[index] = source;
          }
          await new Promise<void>((resolve, reject) => {
            // WebKit grants playback permission per element. Reuse it across chunks,
            // and replay cached audio directly inside the user's click after an autoplay denial.
            const player = audio.current || new Audio(); audio.current = player;
            player.src = source;
            const cleanup = () => { controller.signal.removeEventListener("abort", aborted); player.onended = null; player.onerror = null; };
            const aborted = () => { cleanup(); reject(new DOMException("朗读已取消", "AbortError")); };
            controller.signal.addEventListener("abort", aborted, { once: true });
            player.onended = () => { cleanup(); player.removeAttribute("src"); player.load(); resolve(); };
            player.onerror = () => { cleanup(); reject(new Error("无法播放合成音频，请检查 TTS 渠道后重试。")); };
            void player.play().then(() => { if (current()) setState("speaking"); }).catch(cause => {
              cleanup(); reject(new Error(cause?.name === "NotAllowedError" ? "自动播放被拦截，请点击「朗读回复」重试。" : "无法播放合成音频，请重试。"));
            });
          });
        }
      }
      if (current()) { pending.current = null; setState("idle"); }
    } catch (cause) {
      if (!current()) return;
      stop(); setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [projectId, settings, provider, channel_id, model, voice, speed, stop]);
  return { state, error, play, stop };
}
