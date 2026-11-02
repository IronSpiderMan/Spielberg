import { Form, Select } from "@arco-design/web-react";
import type { ModelSettings } from "../../core";
import { channelsFor, generationChoice, modelFamily, selectableModels, MODEL_PROFILES, type GenerationKind, type GenerationSelection } from "../../generation-channels";

export function GenerationSelector({settings,kind,value,onChange,disabled,operation}: {settings:ModelSettings;kind:GenerationKind;value:GenerationSelection;onChange:(value:GenerationSelection)=>void;disabled?:boolean;operation?:string}) {
  const channels=channelsFor(settings,kind), choice=generationChoice(settings,kind,value,operation);
  const channel=choice?.channel || channels.find(c=>c.id===value.channel_id);
  const label=kind === "image" ? "图片" : "视频";
  return <div className="generation-channel-fields">
    <Form.Item label="渠道"><Select aria-label={`${label}生成渠道`} value={choice?.channel.id || value.channel_id} disabled={disabled} placeholder={channels.length ? "选择生成渠道" : "请先在设置中添加渠道"} options={channels.map(c=>({label:c.name,value:c.id}))}
      onChange={id=>onChange({channel_id:id,model:generationChoice(settings,kind,{channel_id:id},operation)?.model.id})}/></Form.Item>
    <Form.Item label="模型"><Select aria-label={`${label}生成模型`} value={choice ? modelFamily(choice.model) : value.model} disabled={disabled || !channel} placeholder="选择生成模型" options={selectableModels((channel?.models || []).filter(m=>!operation || MODEL_PROFILES[m.profile]?.modes.includes(operation))).map(m=>({label:m.name || m.id,value:m.id}))}
      onChange={model=>onChange({channel_id:channel?.id,model})}/></Form.Item>
  </div>;
}
