import { post } from "./core";
import type { SpeechRecognitionCallbacks, SpeechRecognitionControl } from "./speech-recognition";

/** Records mono WAV and transcribes through the project's default ASR channel. */
export async function startSpeechRecognition(callbacks: SpeechRecognitionCallbacks, options: {
  projectId: string; signal?: AbortSignal; onFinishing?: () => void;
}): Promise<SpeechRecognitionControl> {
  const { signal } = options;
  const aborted = () => new DOMException("语音识别已取消", "AbortError");
  if (signal?.aborted) throw aborted();
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("麦克风不可用，请在桌面应用或 HTTPS 页面使用语音输入。");
  let context: AudioContext | undefined;
  let stream: MediaStream | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let processor: ScriptProcessorNode | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;
  let finishing = false;
  const chunks: Float32Array[] = [];
  let samples = 0;
  let heard = false;
  let lastVoice = Date.now();
  const release = () => {
    clearTimeout(timer);
    if (processor) {processor.onaudioprocess = null; processor.disconnect();}
    source?.disconnect(); stream?.getTracks().forEach(track => track.stop());
    if (context && context.state !== "closed") void context.close().catch(() => {});
  };
  const cancel = () => {cancelled = true; release(); chunks.length = 0; signal?.removeEventListener("abort", cancel);};
  signal?.addEventListener("abort", cancel, {once:true});
  const stop = () => {
    if (cancelled || finishing) return;
    finishing = true;
    const rate = context!.sampleRate;
    release(); options.onFinishing?.();
    if (!samples || !heard) {signal?.removeEventListener("abort",cancel); callbacks.onError("没有听到语音，请靠近麦克风再试一次。"); return;}
    const buffer = new ArrayBuffer(44 + samples * 2);
    const view = new DataView(buffer);
    const label = (offset:number, value:string) => {for (let i=0;i<value.length;i++) view.setUint8(offset+i,value.charCodeAt(i));};
    label(0,"RIFF"); view.setUint32(4,36+samples*2,true); label(8,"WAVE"); label(12,"fmt ");
    view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true);
    view.setUint32(24,rate,true); view.setUint32(28,rate*2,true); view.setUint16(32,2,true); view.setUint16(34,16,true);
    label(36,"data"); view.setUint32(40,samples*2,true);
    let offset=44;
    for (const chunk of chunks) for (const value of chunk) {const v=Math.max(-1,Math.min(1,value));view.setInt16(offset,v<0?v*32768:v*32767,true);offset+=2;}
    chunks.length=0;
    const reader = new FileReader();
    reader.onload = () => {
      if (cancelled) return;
      void post<{text:string}>("/speech/transcribe",{project_id:options.projectId,audio_data_url:reader.result}).then(result => {
        if (cancelled) return;
        callbacks.onResult(result.text,true); callbacks.onEnd();
      }).catch(e => {if (!cancelled) callbacks.onError(e instanceof Error ? e.message : String(e));})
        .finally(()=>signal?.removeEventListener("abort",cancel));
    };
    reader.onerror = () => {signal?.removeEventListener("abort",cancel);if (!cancelled) callbacks.onError("读取录音失败，请重试。");};
    reader.readAsDataURL(new Blob([buffer],{type:"audio/wav"}));
  };
  try {
    stream = await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true}});
    if (cancelled || signal?.aborted) {release(); throw aborted();}
    context = new AudioContext(); await context.resume();
    if (cancelled || signal?.aborted) {release(); throw aborted();}
    source = context.createMediaStreamSource(stream);
    processor = context.createScriptProcessor(4096,1,1);
    processor.onaudioprocess = event => {
      if (cancelled || finishing) return;
      const values = new Float32Array(event.inputBuffer.getChannelData(0));
      chunks.push(values); samples += values.length;
      const rms = Math.sqrt(values.reduce((sum,v)=>sum+v*v,0)/values.length);
      if (rms > 0.015) {heard=true;lastVoice=Date.now();}
      if (heard && Date.now()-lastVoice>1800) stop();
    };
    source.connect(processor); processor.connect(context.destination);
    timer = setTimeout(stop,60000);
    callbacks.onStart();
    return {stop,cancel};
  } catch (e) {
    cancel();
    if (e instanceof DOMException && e.name === "NotAllowedError") throw new Error("麦克风权限未开启，请在系统或浏览器设置中允许后重试。");
    throw e;
  }
}
