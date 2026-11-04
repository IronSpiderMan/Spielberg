import { localId } from "./id";

export type SpeechRecognitionCallbacks = {
  onStart: () => void;
  /** The full current transcript, including any interim words. */
  onResult: (text: string, isFinal: boolean) => void;
  onEnd: () => void;
  onError: (message: string) => void;
};

export type SpeechRecognitionControl = { stop: () => void; cancel: () => void };

type NativeSpeechEvent = {
  sessionId: string;
  type: "started" | "result" | "ended" | "error";
  text?: string;
  isFinal?: boolean;
  message?: string;
};

type BrowserSpeechResult = { isFinal: boolean; length: number; [index: number]: { transcript: string } };
type BrowserSpeechRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: { results: ArrayLike<BrowserSpeechResult> }) => void) | null;
  onerror: ((event: { error: string; message?: string }) => void) | null;
  onend: (() => void) | null;
  onspeechend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};
type BrowserSpeechWindow = Window & {
  SpeechRecognition?: new () => BrowserSpeechRecognition;
  webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
};

const recognitionErrors: Record<string, string> = {
  "not-allowed": "麦克风或语音识别权限未开启，请在系统或浏览器设置中允许后重试。",
  "service-not-allowed": "系统语音识别不可用，请检查语音识别权限和系统设置。",
  "audio-capture": "无法使用麦克风，请检查麦克风连接及系统输入设备。",
  "no-speech": "没有听到语音，请靠近麦克风再试一次。",
  network: "系统语音服务连接失败，请检查网络后重试。",
  aborted: "语音识别已中断，请重试。",
  "language-not-supported": "系统暂不支持中文语音识别，请检查语音语言设置。",
};

function speechError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") return recognitionErrors["not-allowed"];
    if (error.name === "NotFoundError" || error.name === "NotReadableError") return recognitionErrors["audio-capture"];
  }
  return error instanceof Error ? error.message : String(error || "无法启动系统语音识别，请稍后重试。");
}

/**
 * Uses the desktop system recognizer, or the browser's built-in Web Speech API.
 * stop() finishes the current utterance; cancel()/AbortSignal never call onEnd.
 * Startup failures reject; failures after startup call onError without onEnd.
 */
export async function startSpeechRecognition(
  callbacks: SpeechRecognitionCallbacks,
  options: { signal?: AbortSignal } = {},
): Promise<SpeechRecognitionControl> {
  const { signal } = options;
  const aborted = () => new DOMException("语音识别已取消", "AbortError");
  if (signal?.aborted) throw aborted();

  if ("__TAURI_INTERNALS__" in window) {
    const { invoke } = await import("@tauri-apps/api/core");
    // Do not silently bypass a broken native bridge or a denied native permission.
    const available = await invoke<boolean>("speech_recognition_available");
    if (signal?.aborted) throw aborted();
    if (available) {
      const { listen } = await import("@tauri-apps/api/event");
      if (signal?.aborted) throw aborted();
      const sessionId = localId();
      let done = false;
      let started = false;
      let stopping = false;
      let transcript = "";
      let unlisten: (() => void) | undefined;
      let durationTimer: ReturnType<typeof setTimeout> | undefined;
      let silenceTimer: ReturnType<typeof setTimeout> | undefined;
      let finishTimer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        clearTimeout(durationTimer); clearTimeout(silenceTimer); clearTimeout(finishTimer);
        signal?.removeEventListener("abort", cancel);
        window.removeEventListener("pagehide", cancel);
        unlisten?.(); unlisten = undefined;
      };
      const stopNative = (cancel: boolean) => invoke<void>("stop_speech_recognition", { sessionId, cancel });
      const fail = (message: string) => {
        if (done) return;
        done = true; cleanup();
        void stopNative(true).catch(() => {});
        callbacks.onError(message);
      };
      const cancel = () => {
        if (done) return;
        done = true; cleanup();
        void stopNative(true).catch(() => {});
      };
      const stop = () => {
        if (done || stopping) return;
        stopping = true;
        clearTimeout(silenceTimer); clearTimeout(durationTimer);
        finishTimer = setTimeout(() => fail("语音识别结束超时，请重试。"), 8000);
        void stopNative(false).catch(error => fail(speechError(error)));
      };
      unlisten = await listen<NativeSpeechEvent>("agent-speech", ({ payload }) => {
        if (done || payload.sessionId !== sessionId) return;
        if (payload.type === "started") {
          if (started) return;
          started = true;
          clearTimeout(durationTimer);
          durationTimer = setTimeout(stop, 60_000);
          silenceTimer = setTimeout(() => fail(recognitionErrors["no-speech"]), 12_000);
          callbacks.onStart();
        } else if (payload.type === "result") {
          transcript = payload.text || "";
          clearTimeout(silenceTimer);
          if (!stopping && transcript.trim()) silenceTimer = setTimeout(stop, 1800);
          callbacks.onResult(transcript, !!payload.isFinal);
        } else if (payload.type === "error") {
          fail(payload.message || "系统语音识别失败，请重试。");
        } else if (payload.type === "ended") {
          done = true; cleanup();
          if (transcript.trim()) callbacks.onEnd();
          else callbacks.onError(recognitionErrors["no-speech"]);
        }
      });
      if (signal?.aborted) { cancel(); throw aborted(); }
      signal?.addEventListener("abort", cancel, { once: true });
      window.addEventListener("pagehide", cancel, { once: true });
      durationTimer = setTimeout(() => fail("等待语音识别启动超时，请检查系统权限后重试。"), 60_000);
      try {
        await invoke<void>("start_speech_recognition", { sessionId, locale: "zh-CN" });
        // Cancellation may have happened while start was awaiting native permission.
        if (done) void stopNative(true).catch(() => {});
        if (signal?.aborted) throw aborted();
      } catch (error) {
        done = true; cleanup();
        void stopNative(true).catch(() => {});
        throw error instanceof DOMException && error.name === "AbortError" ? error : new Error(speechError(error));
      }
      return { stop, cancel };
    }
  }

  const speechWindow = window as BrowserSpeechWindow;
  const Recognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
  if (!Recognition) throw new Error("当前环境不支持系统语音识别，可使用 macOS 桌面版或支持语音识别的浏览器，也可以直接输入指令。");
  if (!window.isSecureContext) throw new Error("语音识别需要安全连接，请使用桌面版、HTTPS 或 localhost，也可以直接输入指令。");
  if (signal?.aborted) throw aborted();

  const recognition = new Recognition();
  recognition.lang = "zh-CN";
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  let done = false;
  let stopping = false;
  let transcript = "";
  let durationTimer: ReturnType<typeof setTimeout> | undefined;
  let silenceTimer: ReturnType<typeof setTimeout> | undefined;
  let finishTimer: ReturnType<typeof setTimeout> | undefined;
  const cleanup = () => {
    clearTimeout(durationTimer); clearTimeout(silenceTimer); clearTimeout(finishTimer);
    signal?.removeEventListener("abort", cancel);
    window.removeEventListener("pagehide", cancel);
    recognition.onstart = null; recognition.onresult = null; recognition.onerror = null;
    recognition.onend = null; recognition.onspeechend = null;
  };
  const cancel = () => {
    if (done) return;
    done = true; cleanup();
    try { recognition.abort(); } catch { /* Already stopped by the browser. */ }
  };
  const fail = (message: string) => {
    if (done) return;
    cancel(); callbacks.onError(message);
  };
  const stop = () => {
    if (done || stopping) return;
    stopping = true;
    clearTimeout(durationTimer); clearTimeout(silenceTimer);
    finishTimer = setTimeout(() => fail("语音识别结束超时，请重试。"), 8000);
    try { recognition.stop(); } catch (error) { fail(speechError(error)); }
  };
  recognition.onstart = () => {
    if (done) return;
    clearTimeout(durationTimer);
    durationTimer = setTimeout(stop, 60_000);
    silenceTimer = setTimeout(() => fail(recognitionErrors["no-speech"]), 12_000);
    callbacks.onStart();
  };
  recognition.onresult = event => {
    if (done) return;
    // results contains the utterance's complete history, not only resultIndex.
    const results = Array.from(event.results);
    transcript = results.map(result => result[0]?.transcript || "").join("");
    clearTimeout(silenceTimer);
    if (!stopping && transcript.trim()) silenceTimer = setTimeout(stop, 1800);
    callbacks.onResult(transcript, results.length > 0 && results.every(result => result.isFinal));
  };
  recognition.onspeechend = stop;
  recognition.onerror = event => fail(recognitionErrors[event.error] || "系统语音识别失败，请重试。");
  recognition.onend = () => {
    if (done) return;
    done = true; cleanup();
    if (transcript.trim()) callbacks.onEnd();
    else callbacks.onError(recognitionErrors["no-speech"]);
  };
  signal?.addEventListener("abort", cancel, { once: true });
  window.addEventListener("pagehide", cancel, { once: true });
  durationTimer = setTimeout(() => fail("等待语音识别启动超时，请检查麦克风权限后重试。"), 60_000);
  try { recognition.start(); }
  catch (error) { cancel(); throw new Error(speechError(error)); }
  return { stop, cancel };
}
