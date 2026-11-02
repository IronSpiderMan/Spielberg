import { Switch, Form, Select } from "@arco-design/web-react";
import { GENERATION_SIZES } from "../../generation-sizes";
import { imageSizes, modelImageSize, modelRatio, type GenerationChoice } from "../../generation-channels";
import { MediaSizeFields, VideoDurationField } from "./GenerationFields";

export function ImageModelFields({choice,ratio,size,onChange,disabled,operation="t2i"}: {choice?:GenerationChoice;ratio:string;size?:string;onChange:(v:{ratio:string;size:string})=>void;disabled?:boolean;operation?:string}) {
  if (!choice || choice.capabilities.size_mode === "pixels") return <MediaSizeFields ratio={ratio} size={size} onChange={onChange} disabled={disabled}/>;
  const actualRatio=modelRatio(choice,ratio),sizes=imageSizes(choice,actualRatio,operation);
  return <>
    <Form.Item label="画幅"><Select aria-label="图片画幅" value={actualRatio} disabled={disabled} options={(choice.capabilities.ratios || GENERATION_SIZES.map(g=>g.ratio)).map(r=>({label:r,value:r}))} onChange={ratio=>onChange({ratio,size:modelImageSize(choice,ratio,undefined,operation)})}/></Form.Item>
    <Form.Item label="输出尺寸"><Select aria-label="图片输出尺寸" value={modelImageSize(choice,actualRatio,size,operation)} disabled={disabled} options={sizes} onChange={size=>onChange({ratio:actualRatio,size})}/></Form.Item>
  </>;
}

export function VideoModelFields({choice,mode,duration,onDuration,ratio,size,onSize,resolution,onResolution,audio,onAudio,disabled}: {
  choice?:GenerationChoice;mode:string;duration:number;onDuration:(v:number)=>void;ratio:string;size?:string;onSize:(v:{ratio:string;size:string})=>void;
  resolution?:string;onResolution:(v:string)=>void;audio?:boolean;onAudio?:(v:boolean)=>void;disabled?:boolean;
}) {
  const cap=choice?.capabilities;
  return <>
    <VideoDurationField value={duration} onChange={onDuration} disabled={disabled} wan={!!cap?.smart_duration}/>
    {cap?.audio && onAudio && <Form.Item label="生成声音" className="video-audio-field"><Switch aria-label="生成声音" checked={audio ?? true} disabled={disabled} onChange={onAudio}/></Form.Item>}
    {cap?.size_mode === "resolution" ? <>
      <Form.Item label="分辨率"><Select aria-label="视频分辨率" disabled={disabled} value={resolution || choice?.channel.resolution || "720P"} options={cap.resolutions} onChange={onResolution}/></Form.Item>
      {mode !== "fl2v" ? <Form.Item label="画幅"><Select aria-label="视频画幅" value={modelRatio(choice,ratio)} disabled={disabled} options={cap.ratios} onChange={ratio=>onSize({ratio,size:size || "1344x768"})}/></Form.Item> : <p className="helper">输出画幅跟随首帧图片。</p>}
    </> : <MediaSizeFields ratio={ratio} size={size} ariaPrefix="视频" disabled={disabled} onChange={onSize}/>}
  </>;
}
