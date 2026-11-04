import { useEffect, useId, useRef, useState } from "react";
import { Form, Tabs, Trigger } from "@arco-design/web-react";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { GENERATION_SIZES, normalizeGenerationSize } from "../../generation-sizes";
import "../../generation-channels.css";

export type DurationControl = { value: number; onChange: (value: number) => void; min?: number; max?: number; smart?: boolean };

type ParametersProps = {
  ratio: string; ratios: string[]; onRatio: (value: string) => void;
  size: string; sizes: string[]; onSize: (value: string) => void;
  disabled?: boolean; ariaPrefix?: string; followsFrame?: boolean; resolution?: boolean;
  duration?: DurationControl;
};
const ratioLabel = (ratio: string) => ratio === "adaptive" ? "自适应" : ratio;

export function DurationSlider({value,onChange,min=3,max=15,smart,disabled}: DurationControl & {disabled?: boolean}) {
  const numeric = value === -1 ? min : Math.min(max,Math.max(min,value));
  return <div className="generation-duration">
    <div className="generation-parameter-heading"><span>生成时长</span>{smart && <button type="button" disabled={disabled} aria-pressed={value===-1} onClick={()=>onChange(value===-1?5:-1)}>智能时长</button>}</div>
    <div className="generation-duration-controls">
      <input type="range" aria-label="视频时长滑块" min={min} max={max} step={1} value={numeric} disabled={disabled || value===-1} onChange={event=>onChange(Number(event.target.value))}/>
      {value===-1 ? <output>智能</output> : <label><input key={value} type="number" aria-label="视频时长" min={min} max={max} step={1} defaultValue={value} disabled={disabled} onBlur={event=>{
        const parsed=Number(event.target.value);const next=event.target.value && Number.isFinite(parsed) ? Math.min(max,Math.max(min,Math.round(parsed))) : numeric;
        event.target.value=String(next);onChange(next);
      }} onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();event.currentTarget.blur();}}}/><span>秒</span></label>}
    </div>
    <div className="generation-duration-bounds"><span>{min} 秒</span><span>{max} 秒</span></div>
  </div>;
}

export function GenerationParameters({ratio,ratios,onRatio,size,sizes,onSize,disabled,ariaPrefix="",followsFrame,resolution,duration}: ParametersProps) {
  const [open,setOpen] = useState(false), trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null), popupId = useId();
  useEffect(()=>{
    if (disabled) { setOpen(false); return; }
    if (!open) return;
    const frame = requestAnimationFrame(()=>{
      const target = popup.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]:not(:disabled)') || popup.current?.querySelector<HTMLButtonElement>('button:not(:disabled)');
      (target || popup.current)?.focus({preventScroll:true});
    });
    return ()=>cancelAnimationFrame(frame);
  },[open,disabled]);
  const ratioColumns = Math.min(5, Math.max(1, ratios.length));
  const sizeColumns = Math.min(3, Math.max(1, sizes.length));
  const popupWidth = Math.max(240, duration ? 360 : 0,
    followsFrame ? 0 : 56 + ratioColumns * 62 + (ratioColumns - 1) * 6,
    52 + sizeColumns * 106 + (sizeColumns - 1) * 5);
  const summary = [followsFrame ? "跟随首帧" : ratioLabel(ratio), size.replace(/x/g," × "), ...(duration ? [duration.value===-1?"智能时长":`${duration.value} 秒`] : [])].join(" / ");
  return <Form.Item label="生成参数" className="generation-parameters-field">
    <Trigger escToClose updateOnScroll trigger="click" position="bl" popupVisible={open && !disabled} onVisibleChange={setOpen} popup={()=> <div ref={popup} id={popupId} className="generation-parameters" style={{width:popupWidth}} role="dialog" tabIndex={-1} aria-label={`${ariaPrefix}生成参数设置`} onKeyDown={event=>{if(event.key==="Escape"){event.preventDefault();event.stopPropagation();setOpen(false);trigger.current?.focus({preventScroll:true});}}}>
      <div className="generation-parameter-heading">比例</div>
      {followsFrame ? <p className="generation-frame-note">输出画面比例跟随首帧图片</p> : <div className="generation-ratio-grid" style={{gridTemplateColumns:`repeat(${ratioColumns}, minmax(0, 1fr))`}} role="group" aria-label={`${ariaPrefix}画幅`}>
        {ratios.map(value=>{const [w,h]=value.split(":").map(Number);return <button type="button" key={value} aria-pressed={ratio===value} disabled={disabled} onClick={()=>onRatio(value)}>
          <span className="generation-ratio-icon" style={w && h ? {width:w>=h?26:26*w/h,height:h>=w?26:26*h/w} : {width:25,height:25,borderStyle:"dashed"}}/>{ratioLabel(value)}
        </button>;})}
      </div>}
      <div className="generation-parameter-heading">{resolution ? "分辨率" : "输出尺寸"}{!resolution && <small>宽 × 高 · 像素</small>}</div>
      <div className={`generation-resolution-grid${resolution?" is-resolution":""}`} style={{gridTemplateColumns:`repeat(${sizeColumns}, minmax(0, 1fr))`}} role="group" aria-label={`${ariaPrefix}${resolution?"分辨率":"输出尺寸"}`}>
        {sizes.map(value=><button type="button" key={value} disabled={disabled} aria-pressed={size===value} onClick={()=>onSize(value)}>{value.replace(/x/g," × ")}</button>)}
      </div>
      {duration && <DurationSlider {...duration} disabled={disabled}/>}
    </div>}>
      <button ref={trigger} type="button" className="generation-picker-trigger generation-parameters-trigger" aria-label={`${ariaPrefix}生成参数`} aria-haspopup="dialog" aria-controls={open ? popupId : undefined} aria-expanded={open && !disabled} title={summary} disabled={disabled} ><SlidersHorizontal size={16}/><span>{summary}</span><ChevronDown size={15}/></button>
    </Trigger>
  </Form.Item>;
}

export function MediaSizeFields({ratio,size,onChange,ariaPrefix="",disabled}: {
  ratio:string;size?:string;onChange:(value:{ratio:string;size:string})=>void;ratioLabel?:string;ariaPrefix?:string;disabled?:boolean;
}) {
  return <GenerationParameters ratio={ratio} ratios={GENERATION_SIZES.map(group=>group.ratio)} onRatio={value=>onChange({ratio:value,size:normalizeGenerationSize(value,size)})}
    size={normalizeGenerationSize(ratio,size)} sizes={GENERATION_SIZES.find(group=>group.ratio===ratio)?.sizes || []} onSize={value=>onChange({ratio,size:value})} disabled={disabled} ariaPrefix={ariaPrefix}/>;
}

export function VideoDurationField({value,onChange,disabled,wan=false}: {value:number;onChange:(value:number)=>void;disabled?:boolean;wan?:boolean}) {
  return <Form.Item label="时长"><DurationSlider value={value} onChange={onChange} disabled={disabled} min={wan?2:3} max={wan?30:15} smart={wan}/></Form.Item>;
}

export function GenerationModeTabs<T extends string>({value,onChange,modes,disabled=false}: {value:T;onChange:(value:T)=>void;modes:{value:T;label:string;disabled?:boolean}[];disabled?:boolean}) {
  return <Tabs className="image-mode-tabs" activeTab={value} onChange={key=>onChange(key as T)}>{modes.map(mode=><Tabs.TabPane key={mode.value} title={mode.label} disabled={disabled || mode.disabled}/>)}</Tabs>;
}
