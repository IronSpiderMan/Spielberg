import { useEffect, useId, useRef, useState } from "react";
import { Form, Trigger } from "@arco-design/web-react";
import { Bot, Check, ChevronDown, ChevronRight, Film, Image, Layers, Mic } from "lucide-react";
import type { ModelSettings } from "../../core";
import { channelsFor, generationChoice, modelFamily, selectableModels, MODEL_PROFILES, type GenerationKind, type GenerationSelection } from "../../generation-channels";
import "../../generation-channels.css";

const MODE_LABELS: Record<string, string> = { chat: "对话", tts: "语音合成", t2i: "文生图", i2i: "图生图", t2v: "文生视频", fl2v: "首尾帧", ref2v: "参考生视频" };

export function GenerationSelector({settings,kind,value,onChange,disabled,operation,compact=false}: {settings:ModelSettings;kind:GenerationKind;value:GenerationSelection;onChange:(value:GenerationSelection)=>void;disabled?:boolean;operation?:string;compact?:boolean}) {
  const channels = channelsFor(settings,kind), choice = generationChoice(settings,kind,value,operation);
  const [open,setOpen] = useState(false), [browsing,setBrowsing] = useState<string>(), [filter,setFilter] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useEffect(()=>{
    if (disabled) { setOpen(false); return; }
    if (!open) return;
    // Wait for Trigger to attach its portal, then focus without scrolling the
    // form away from the anchor. Run on reopen even if its exit is still animating.
    const frame = requestAnimationFrame(()=>menu.current?.querySelector<HTMLButtonElement>('.generation-cascade-channels button[aria-pressed="true"]')?.focus({preventScroll:true}));
    return ()=>cancelAnimationFrame(frame);
  },[open,disabled]);
  const active = channels.find(c=>c.id===browsing) || choice?.channel || channels[0];
  const modelsFor = (id: string) => selectableModels((channels.find(c=>c.id===id)?.models || []).filter(m=>!operation || MODEL_PROFILES[m.profile]?.modes.includes(operation)));
  const modesFor = (channelId: string, model: string) => generationChoice(settings,kind,{channel_id:channelId,model})?.capabilities.modes || [];
  const modes = [...new Set(channels.flatMap(c=>modelsFor(c.id).flatMap(m=>modesFor(c.id,m.id))))];
  const models = active ? modelsFor(active.id).filter(m=>!filter || modesFor(active.id,m.id).includes(filter)) : [];
  const label = kind === "llm" ? "Agent" : kind === "image" ? "图片" : kind === "tts" ? "TTS" : "视频", Icon = kind === "llm" ? Bot : kind === "image" ? Image : kind === "tts" ? Mic : Film;
  const close = () => {setOpen(false);trigger.current?.focus({preventScroll:true});};
  const picker = <Trigger escToClose updateOnScroll trigger="click" position={compact ? "tr" : "bl"} popupVisible={open && !disabled} onVisibleChange={visible=>{
        setOpen(visible); if(visible){setBrowsing(choice?.channel.id || value.channel_id);setFilter("");}
      }} popup={()=> <div ref={menu} id={menuId} className={`generation-cascade generation-cascade-${kind}`} role="dialog" tabIndex={-1} aria-label={`${label}渠道与模型`} onKeyDown={event=>{if(event.key==="Escape"){event.preventDefault();event.stopPropagation();close();}}}>
        {modes.length>1 && <div className="generation-model-filters" aria-label="按生成方式筛选">
          {["",...modes].map(mode=><button type="button" key={mode} aria-pressed={filter===mode} onClick={()=>setFilter(mode)}>{MODE_LABELS[mode] || "全部"}</button>)}
        </div>}
        <div className="generation-cascade-columns">
          <div className="generation-cascade-channels" aria-label="生成渠道">
            {channels.map(channel=><button type="button" key={channel.id} aria-pressed={active?.id===channel.id} onMouseEnter={()=>setBrowsing(channel.id)} onFocus={()=>setBrowsing(channel.id)} onClick={()=>setBrowsing(channel.id)}>
              <Layers size={16}/><span>{channel.name}</span><ChevronRight size={14}/>
            </button>)}
          </div>
          <div className="generation-cascade-models" aria-label={`${active?.name || "当前渠道"}的模型`}>
            <div className="generation-cascade-heading">{active?.name} <span>选择模型</span></div>
            {models.map(model=>{
              const selected = choice?.channel.id===active?.id && modelFamily(choice.model)===model.id;
              const cap = generationChoice(settings,kind,{channel_id:active!.id,model:model.id})?.capabilities;
              return <button type="button" key={model.id} aria-pressed={selected} className="generation-model-option" onClick={()=>{onChange({channel_id:active!.id,model:model.id});close();}}>
                <Icon size={18}/><span className="generation-model-detail"><strong>{model.name || model.id}</strong><span className="generation-model-tags">{(cap?.modes || []).map(mode=><span key={mode}>{mode==="fl2v" && !cap?.last_frame ? "首帧" : MODE_LABELS[mode] || mode}</span>)}</span></span>{selected && <Check size={16}/>}
              </button>;
            })}
            {!models.length && <p className="generation-picker-empty">{filter ? "此渠道暂无支持该方式的模型" : "此渠道暂无可用模型"}</p>}
          </div>
        </div>
      </div>}>
        <span className="generation-picker-anchor">
        <button ref={trigger} type="button" className="generation-picker-trigger" aria-label={`${label}渠道与模型`} aria-haspopup="dialog" aria-controls={open ? menuId : undefined} aria-expanded={open && !disabled} title={choice ? `${choice.model.name || choice.model.id} · ${choice.channel.name}` : undefined} disabled={disabled || !channels.length} >
          <Icon size={17}/><span className="generation-picker-value"><strong>{choice ? selectableModels([choice.model])[0].name || choice.model.id : channels.length ? "选择渠道与模型" : "请先在设置中添加渠道"}</strong>{choice && <small>{choice.channel.name}</small>}</span><ChevronDown size={15}/>
        </button>
        </span>
      </Trigger>;
  return <div className={`generation-channel-fields${compact ? " generation-channel-fields-compact" : ""}`}>
    {compact ? picker : <Form.Item label="渠道 / 模型" layout="vertical">{picker}</Form.Item>}
  </div>;
}
