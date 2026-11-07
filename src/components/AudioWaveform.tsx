import { memo, useEffect, useId, useMemo, useState } from "react";
import { post, type Media } from "../core";

export type WaveformData = {duration: number; peaks: number[]; rms: number[]; silence_threshold: number};

export function useAudioWaveform(media: Media, projectId: string | undefined, enabled: boolean) {
  const key = `${projectId}:${media.id}:${media.path}`;
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{key: string; data?: WaveformData; error?: string}>({key: ""});
  useEffect(()=>{
    if (!enabled || !projectId) return;
    let active = true;
    setState({key});
    void post<WaveformData>("/media/audio-waveform", {project_id: projectId, media_id: media.id, source_path: media.path}).then(data=>{
      if (!data.peaks?.length || !Array.isArray(data.rms) || data.rms.length !== data.peaks.length || !data.rms.every(n=>Number.isFinite(n) && n >= 0) || !Number.isFinite(data.duration) || data.duration <= 0 || !Number.isFinite(data.silence_threshold) || !data.peaks.every(n=>Number.isFinite(n) && n >= 0)) throw Error("波形数据不可用");
      if (active) setState({key, data});
    }).catch(error=>{if(active)setState({key, error: error instanceof Error ? error.message : String(error)});});
    return ()=>{active = false;};
  }, [enabled, projectId, media.id, media.path, key, attempt]);
  return {data: enabled && state.key === key ? state.data : undefined, error: enabled && state.key === key ? state.error : undefined, retry: ()=>setAttempt(value=>value+1)};
}

export const AudioWaveform = memo(function AudioWaveform({data, start, end, duration}: {data: WaveformData; start: number; end: number; duration: number}) {
  const selectedId = useId();
  const shape = useMemo(()=>{
    const max = Math.max(...data.peaks, 0.01);
    const height = (value: number) => value <= data.silence_threshold ? 0.5 : Math.min(66, Math.pow(value / max, 0.65) * 66);
    const outline = (values: number[]) => {
      const top = values.map((value,i)=>`${(i/(values.length-1 || 1)*1000).toFixed(2)},${(80-height(value)).toFixed(2)}`);
      const bottom = values.map((value,i)=>`${(i/(values.length-1 || 1)*1000).toFixed(2)},${(80+height(value)).toFixed(2)}`).reverse();
      return `M${top.join(" L")} L${bottom.join(" L")} Z`;
    };
    const silence: {start: number; end: number}[] = [];
    let from = -1;
    for (let i=0;i<=data.peaks.length;i++) {
      if (i < data.peaks.length && data.peaks[i] <= data.silence_threshold) {if(from<0)from=i;}
      else if (from>=0) {
        const start=from/data.peaks.length, end=i/data.peaks.length;
        if ((end-start)*data.duration>=0.12) silence.push({start,end});
        from=-1;
      }
    }
    return {peak: outline(data.peaks), rms: outline(data.rms), silence};
  }, [data]);
  const left = duration>0 ? start/duration*1000 : 0;
  const width = duration>0 ? (end-start)/duration*1000 : 1000;
  return <div className="audio-waveform" role="img" aria-label={`真实音频波形，${shape.silence.length} 处静音或极低音量区域`}>
    <svg viewBox="0 0 1000 160" preserveAspectRatio="none" aria-hidden="true">
      <defs><clipPath id={selectedId}><rect x={left} y="0" width={Math.max(0,width)} height="160"/></clipPath></defs>
      <path className="audio-waveform-peak is-outside" d={shape.peak}/>
      <g clipPath={`url(#${selectedId})`}><path className="audio-waveform-peak" d={shape.peak}/><path className="audio-waveform-rms" d={shape.rms}/></g>
    </svg>
    {shape.silence.map((range,i)=><span key={i} className="audio-waveform-silence" data-start={range.start*data.duration} data-end={range.end*data.duration} style={{left:`${range.start*100}%`,width:`${(range.end-range.start)*100}%`}}>{range.end-range.start>0.055 && <small>静音</small>}</span>)}
  </div>;
});
