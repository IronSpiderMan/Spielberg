import { Button, Form, Input, Popconfirm, Select, Space, Switch } from "@arco-design/web-react";
import { Plus, Trash2 } from "lucide-react";
import type { ModelSettings } from "./core";
import { localId } from "./id";
import { channelBaseUrl, channelsFor, MODEL_PROFILES, presetsFor, profilesFor, type ChannelProvider, type GenerationChannel, type GenerationKind, type GenerationModel } from "./generation-channels";
import "./generation-channels.css";

export function GenerationChannelsSettings({settings,onChange,disabled}: {settings:ModelSettings;onChange:(settings:ModelSettings)=>void;disabled?:boolean}) {
  const save=(kind:GenerationKind,channels:GenerationChannel[],defaultId?:string)=>onChange({...settings,[kind]:{
    ...(settings[kind] || {url:"",api_key:"",description:""}),channels,default_channel_id:defaultId !== undefined ? defaultId : settings[kind]?.default_channel_id || channels[0]?.id,
  }});
  return <>{(["llm","image","video","tts"] as const).map(kind=>{
    const channels=channelsFor(settings,kind),label=kind === "llm" ? "LLM" : kind === "image" ? "图片" : kind === "tts" ? "TTS" : "视频";
    const update=(channel:GenerationChannel)=>save(kind,channels.map(c=>c.id===channel.id?channel:c));
    const add=()=>{
      const provider=kind === "video" ? "cast" : "openai";
      const models=presetsFor(kind,provider).map(m=>({...m}));
      const channel:GenerationChannel={id:localId(),name:`${label}渠道 ${channels.length+1}`,provider,base_url:channelBaseUrl(kind,provider),api_key:"",models,default_model_id:models[0]?.id};
      save(kind,[...channels,channel]);
    };
    return <div className="setting-block generation-channels-settings" key={kind}>
      <div className="setting-heading"><h3>{kind === "llm" ? "统一渠道配置" : `${label}生成渠道`}</h3><p>{kind === "llm" ? "管理 OpenAI、DeepSeek 和 Qwen Token Plan 渠道。分镜、Prompt 优化和沿用项目配置的 Agent 共用默认渠道与模型。" : "添加服务渠道与模型，生成时可自由选择。"}</p></div>
      {!channels.length&&<p className="helper">还没有{label}渠道，添加后配置接口地址与模型。</p>}
      {channels.map(channel=>{
        const change=(patch:Partial<GenerationChannel>)=>update({...channel,...patch});
        const setModels=(models:GenerationModel[])=>change({models,default_model_id:models.some(m=>m.id===channel.default_model_id)?channel.default_model_id:models[0]?.id});
        const defaultChannel=(settings[kind]?.default_channel_id || channels[0]?.id)===channel.id;
        return <article className="generation-channel-card" key={channel.id}>
          <div className="generation-channel-heading"><strong>{channel.name || "未命名渠道"}</strong><Space>
            <Button size="small" type={defaultChannel?"primary":"secondary"} disabled={disabled || defaultChannel} onClick={()=>save(kind,channels,channel.id)}>{defaultChannel?"默认渠道":"设为默认"}</Button>
            <Popconfirm title={`删除渠道「${channel.name}」？`} content={kind === "llm" ? "删除默认渠道后将使用剩余的第一个渠道。" : "已有素材会保留，使用此渠道的场景需重新选择。"} onOk={()=>{const next=channels.filter(c=>c.id!==channel.id);save(kind,next,defaultChannel?next[0]?.id || "":undefined);}}><Button aria-label={`删除渠道 ${channel.name}`} size="small" status="danger" icon={<Trash2 size={14}/>} disabled={disabled}/></Popconfirm>
          </Space></div>
          <Form layout="vertical" disabled={disabled}>
            <div className="generation-channel-config">
              <Form.Item label="渠道名称"><Input aria-label={`${label}渠道名称`} value={channel.name} onChange={name=>change({name})}/></Form.Item>
              <Form.Item label="接口类型"><Select aria-label={`${label}渠道接口类型`} value={channel.provider} options={[
                {label:kind === "llm"?"OpenAI":kind === "image"?"OpenAI 兼容图片接口":kind === "tts"?"OpenAI 兼容语音接口":"RunningHub / ComfyUI 兼容接口",value:kind === "video"?"cast":"openai"},
                ...(kind === "llm"?[{label:"DeepSeek",value:"deepseek"}]:[]),
                {label:kind === "llm" ? "Qwen Token Plan" : "千问 Token Plan",value:"qianwen-token-plan"},
                ...(kind === "image"&&channel.provider === "cast"?[{label:"CAST 图片接口（旧配置）",value:"cast"}]:[]),
              ]} onChange={(provider:ChannelProvider)=>{const models=presetsFor(kind,provider).map(m=>({...m}));change({provider,models,default_model_id:models[0]?.id,base_url:channelBaseUrl(kind,provider),api_key:"",operation_urls:undefined,operation_api_keys:undefined});}}/></Form.Item>
              <Form.Item label="接口地址（Base URL）"><Input aria-label={`${label}渠道地址`} value={channel.base_url} placeholder={channelBaseUrl(kind,channel.provider) || "http://127.0.0.1:8190"} onChange={base_url=>change({base_url,operation_urls:undefined})}/></Form.Item>
              <Form.Item label={channel.provider === "qianwen-token-plan"?"Token Plan API Key":"API Key"}><Input.Password aria-label={`${label}渠道 API Key`} value={channel.api_key} placeholder={channel.provider === "qianwen-token-plan"?"sk-sp- 开头的专属 Key":"输入 API Key"} onChange={api_key=>change({api_key,operation_api_keys:undefined})}/></Form.Item>
            </div>
            <div className="generation-channel-models"><strong>渠道模型</strong>{channel.models.map((model,index)=>{
              const set=(patch:Partial<GenerationModel>)=>setModels(channel.models.map((m,i)=>i===index?{...m,...patch}:m));
              const cap=MODEL_PROFILES[model.profile];
              return <div className="generation-channel-model" key={index}>
                <div className={`generation-channel-model-fields${kind === "llm" ? " generation-channel-chat-model-fields" : ""}`}>
                  <Form.Item label="模型 ID">{channel.provider === "qianwen-token-plan" && kind !== "llm"?<Select aria-label={`${label}模型 ID`} value={model.id} options={presetsFor(kind,channel.provider).map(m=>({label:m.id,value:m.id}))} onChange={id=>{const preset=presetsFor(kind,channel.provider).find(m=>m.id===id)!;set(preset);}}/>:<Input aria-label={`${label}模型 ID`} value={model.id} onChange={id=>set({id})}/>}</Form.Item>
                  <Form.Item label="显示名称"><Input aria-label={`${label}模型名称`} value={model.name} onChange={name=>set({name})}/></Form.Item>
                  {kind !== "llm" && <Form.Item label="参数能力"><Select aria-label={`${label}模型参数能力`} value={model.profile} disabled={channel.provider === "qianwen-token-plan"} options={profilesFor(kind,channel.provider).map(([value,p])=>({label:p.label,value}))} onChange={profile=>set({profile})}/></Form.Item>}
                </div>
                <div className="generation-model-summary"><span>{cap?.label}{cap?.min_duration?` · ${cap.min_duration}–${cap.max_duration} 秒`:""}{cap?.smart_duration?" · 智能时长":""}{cap?.max_images?` · 最多 ${cap.max_images} 张参考图`:""}{cap?.last_frame?" · 支持尾帧":""}</span><Space>
                  <Button size="mini" disabled={disabled || channel.default_model_id===model.id} onClick={()=>change({default_model_id:model.id})}>{channel.default_model_id===model.id?"默认模型":"设为默认"}</Button>
                  <Button aria-label={`删除模型 ${model.name}`} size="mini" disabled={disabled} status="danger" icon={<Trash2 size={13}/>} onClick={()=>setModels(channel.models.filter((_,i)=>i!==index))}/>
                </Space></div>
                {channel.provider === "cast"&&<div className="generation-model-route"><Form.Item label="模型服务地址（可选）" extra="同一渠道下的模型由不同服务提供时，填写该模型的完整服务地址。"><Input aria-label={`${label}模型服务地址`} value={model.base_url || ""} onChange={base_url=>set({base_url})} placeholder="留空使用渠道地址"/></Form.Item><label><Switch size="small" checked={!!model.send_model} onChange={send_model=>set({send_model})}/> 接口接收 model 参数</label><p className="helper">现有固定模型的 RunningHub 适配服务保持关闭；支持按 model 分发的服务可开启。</p></div>}
              </div>;
            })}</div>
            <Space wrap>
              <Select aria-label={`添加${label}预设模型`} placeholder="添加预设模型" value={undefined} style={{minWidth:200}} options={presetsFor(kind,channel.provider).filter(m=>!channel.models.some(x=>x.id===m.id)).map(m=>({label:m.name,value:m.id}))} onChange={id=>{const model=presetsFor(kind,channel.provider).find(m=>m.id===id)!;setModels([...channel.models,{...model}]);}}/>
              {(channel.provider !== "qianwen-token-plan" || kind === "llm")&&<Button icon={<Plus size={14}/>} onClick={()=>setModels([...channel.models,{id:`model-${channel.models.length+1}`,name:"新模型",profile:profilesFor(kind,channel.provider)[0][0]}])}>添加自定义模型</Button>}
            </Space>
          </Form>
        </article>;
      })}
      <Button icon={<Plus size={15}/>} disabled={disabled} onClick={add}>添加{label}渠道</Button>
    </div>;
  })}</>;
}
