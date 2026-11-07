import { useEffect, useState } from "react";

/** One silent decoder, six small frames; never seek or interrupt the preview player. */
export function useVideoTrimFrames(src: string, enabled: boolean, duration: number) {
  const [result, setResult] = useState<{src: string; frames: string[]}>({src: "", frames: []});
  useEffect(() => {
    if (!enabled || !Number.isFinite(duration) || duration <= 0 || result.src === src) return;
    const video = document.createElement("video");
    const canvas = document.createElement("canvas");
    let disposed = false;
    const controller = new AbortController();
    video.muted = true; video.playsInline = true; video.preload = "metadata";
    if (new URL(src, location.href).origin !== location.origin) video.crossOrigin = "anonymous";
    const waitFor = (event: "loadeddata" | "seeked") => new Promise<void>((resolve, reject) => {
      const done = () => { cleanup(); resolve(); };
      const fail = () => { cleanup(); reject(new Error("Thumbnail unavailable")); };
      const timeout = window.setTimeout(fail, 4000);
      const cleanup = () => { clearTimeout(timeout); video.removeEventListener(event, done); video.removeEventListener("error", fail); controller.signal.removeEventListener("abort", fail); };
      video.addEventListener(event, done, {once: true}); video.addEventListener("error", fail, {once: true}); controller.signal.addEventListener("abort", fail, {once: true});
    });
    const generate = async () => {
      try {
        const loaded = waitFor("loadeddata"); video.src = src; video.load(); await loaded;
        canvas.width = 160; canvas.height = 90;
        const context = canvas.getContext("2d"); if (!context) return;
        const frames: string[] = [];
        for (let i = 0; i < 6 && !disposed; i++) {
          const at = Math.min(Math.max(0, duration - 0.05), duration * (i + 0.5) / 6);
          const seeking = waitFor("seeked"); video.currentTime = at; await seeking;
          context.clearRect(0, 0, 160, 90);
          // Center crop the contact sheet without distorting portrait or ultrawide sources.
          const scale = Math.max(160 / video.videoWidth, 90 / video.videoHeight);
          const width = video.videoWidth * scale, height = video.videoHeight * scale;
          context.drawImage(video, (160 - width) / 2, (90 - height) / 2, width, height);
          frames.push(canvas.toDataURL("image/jpeg", 0.6));
        }
        if (!disposed) setResult({src, frames});
      } catch { if (!disposed) setResult({src, frames: []}); }
      finally { video.removeAttribute("src"); video.load(); }
    };
    void generate();
    return () => { disposed = true; controller.abort(); video.removeAttribute("src"); video.load(); };
  }, [src, enabled, duration, result.src]);
  return result.src === src ? result.frames : [];
}
