import { Switch, Form } from "@arco-design/web-react";
import { GENERATION_SIZES, normalizeGenerationSize } from "../../generation-sizes";
import { imageSizes, modelImageSize, modelRatio, type GenerationChoice } from "../../generation-channels";
import { GenerationParameters, MediaSizeFields } from "./GenerationFields";

export function ImageModelFields({choice,ratio,size,onChange,disabled,operation="t2i"}: {choice?:GenerationChoice;ratio:string;size?:string;onChange:(v:{ratio:string;size:string})=>void;disabled?:boolean;operation?:string}) {
  if (!choice || choice.capabilities.size_mode === "pixels") return <MediaSizeFields ratio={ratio} size={size} onChange={onChange} disabled={disabled} ariaPrefix="图片"/>;
  const actualRatio=modelRatio(choice,ratio), sizes=imageSizes(choice,actualRatio,operation);
  return <GenerationParameters ratio={actualRatio} ratios={choice?.capabilities.ratios || GENERATION_SIZES.map(g=>g.ratio)} onRatio={ratio=>onChange({ratio,size:modelImageSize(choice,ratio,undefined,operation)})}
    size={modelImageSize(choice,actualRatio,size,operation)} sizes={sizes} onSize={size=>onChange({ratio:actualRatio,size})} disabled={disabled} ariaPrefix="图片"/>;
}

export function VideoModelFields({choice,mode,duration,onDuration,ratio,size,onSize,resolution,onResolution,audio,onAudio,disabled}: {
  choice?:GenerationChoice;mode:string;duration:number;onDuration:(v:number)=>void;ratio:string;size?:string;onSize:(v:{ratio:string;size:string})=>void;
  resolution?:string;onResolution:(v:string)=>void;audio?:boolean;onAudio?:(v:boolean)=>void;disabled?:boolean;
}) {
  const cap=choice?.capabilities, byResolution=cap?.size_mode==="resolution", actualRatio=modelRatio(choice,ratio);
  return <div className="video-model-fields">
    <GenerationParameters ratio={actualRatio} ratios={cap?.ratios || GENERATION_SIZES.map(g=>g.ratio)} onRatio={ratio=>onSize({ratio,size:byResolution?size || "1344x768":normalizeGenerationSize(ratio,size)})}
      size={byResolution?resolution || choice?.channel.resolution || "720P":normalizeGenerationSize(actualRatio,size)} sizes={byResolution?cap.resolutions || []:GENERATION_SIZES.find(g=>g.ratio===actualRatio)?.sizes || []}
      onSize={value=>byResolution?onResolution(value):onSize({ratio:actualRatio,size:value})} disabled={disabled} ariaPrefix="视频" followsFrame={byResolution && mode==="fl2v"} resolution={byResolution}
      duration={{value:duration,onChange:onDuration,min:cap?.min_duration,max:cap?.max_duration,smart:cap?.smart_duration}}/>
    {cap?.audio && onAudio && <Form.Item label="生成声音" className="video-audio-field"><Switch aria-label="生成声音" checked={audio ?? true} disabled={disabled} onChange={onAudio}/></Form.Item>}
  </div>;
}
