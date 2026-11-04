import { useId, useState } from "react";
import { Button, Empty, Form, Input, InputNumber, Message, Select } from "@arco-design/web-react";
import { Headphones, Mic, Search } from "lucide-react";
import { imageUrl, post, type Media, type Snapshot } from "./core";
import { selectionPayload, useGenerationSelection, type GenerationChoice } from "./generation-channels";
import { GenerationSelector } from "./components/generation/GenerationSelector";
import "./tts.css";
import "./components/studio-media-library.css";

export function TtsStudio({data,reload}:{data:Snapshot;reload:()=>void}) {
  const parameterFormId = useId();
  const generation = useGenerationSelection(data.settings,"tts","tts");
  const [text,setText] = useState("");
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [latest,setLatest] = useState<Media>();
  const [selected,setSelected] = useState<Media>();
  const [query,setQuery] = useState("");
  const audios = data.media.filter(m=>m.kind==="audio");
  const items = latest ? [audios.find(m=>m.id===latest.id) || latest,...audios.filter(m=>m.id!==latest.id)] : audios;
  const preview = selected || latest;
  const filtered = items.filter(item=>item.name.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="creation-split tts-studio tts-creation-split">
    <section className="creation-panel tts-form">
      <div className="generation-panel-heading"><h2>语音合成</h2></div>
      <div className="tts-controls-scroll">
      <GenerationSelector settings={data.settings} kind="tts" operation="tts" value={generation.value} onChange={generation.setValue} disabled={busy}/>
      {!generation.choice&&<p className="helper">请先在工作室设置中添加 TTS 渠道和模型。</p>}
      <Form layout="vertical" disabled={busy}>
        <Form.Item label="合成文本" required extra="最多 4096 字符，支持中文及其他语言。">
          <Input.TextArea aria-label="合成文本" placeholder="输入台词、旁白或需要朗读的文字…" value={text} onChange={setText} maxLength={4096} showWordLimit autoSize={{minRows:6,maxRows:14}}/>
        </Form.Item>
      </Form>
      {generation.choice&&<TtsParameters formId={parameterFormId} key={`${generation.choice.channel.id}:${generation.choice.model.id}`} choice={generation.choice} text={text} busy={busy} generate={async fields=>{
        if(busy||!text.trim())return;
        setBusy(true);setError("");
        try {
          const media = await post<Media>("/generations/tts",{project_id:data.project.id,text,...selectionPayload(generation.choice),...fields});
          setLatest(media);setSelected(media);Message.success("语音已生成并保存到素材库");
          Promise.resolve().then(reload).catch(()=>Message.warning("语音已保存，素材列表刷新失败，请稍后刷新"));
        } catch(e) {setError(String(e));} finally {setBusy(false);}
      }}/>}
      {error&&<p role="alert" className="tts-error image-generation-errors">{error}</p>}
      <p className="helper">生成的声音由 AI 合成，可在素材库、资产音频参考和剪辑中使用。</p>
      </div>
      <div className="generation-submit-row"><Button form={parameterFormId} htmlType="submit" className="generation-submit" long type="primary" icon={<Mic size={16}/>} loading={busy} disabled={busy||!generation.choice||!text.trim()}>{busy?"语音合成中…":"生成语音"}</Button></div>
    </section>
    <section className="creation-panel image-result tts-results" aria-label="音频生成预览" aria-busy={busy}>
      <div className="generation-preview-heading"><h2>生成预览</h2><span role="status" className={`generation-state${busy?" is-busy":error?" is-error":latest?" is-ready":""}`}>{busy?"合成中":error?"合成失败":latest?"已完成":"等待创作"}</span></div>
      <div className="generation-preview-body">
        {busy&&<p className="tts-progress" role="status">正在合成配音，完成后可在这里试听。</p>}
        {preview?<article className="tts-audio-preview"><Headphones size={40} aria-hidden="true"/><h3>{preview.name}</h3><audio key={preview.id} aria-label={`试听 ${preview.name}`} controls preload="metadata" src={imageUrl(preview)}/></article>:<Empty icon={<Headphones size={28}/>} description={<><b>{busy?"声音正在生成":error?"本次未生成配音":"音频预览"}</b><p>{busy?"稍候片刻，音频会自动保存到素材库。":error?"检查错误信息，调整音色或文本后重试。":"生成配音，或从右侧选择音频试听。"}</p></>}/>}
        <p className="helper generation-result-note">生成进度与错误信息可在「后台任务」中查看。</p>
      </div>
      <section className="studio-media-library" aria-label="音频素材">
        <h2>音频素材 <span role="status">{query.trim()?`${filtered.length} / ${items.length}`:items.length}</span></h2>
        <Input className="studio-media-search" aria-label="搜索音频素材" placeholder="搜索素材名称" prefix={<Search size={14}/>} value={query} onChange={setQuery} allowClear/>
        <div className="studio-media-grid">{filtered.map(media=><button type="button" key={media.id} className={`studio-media-item tts-media-item${preview?.id===media.id?" is-selected":""}`} onClick={()=>setSelected(media)} aria-label={`预览 ${media.name}`} aria-pressed={preview?.id===media.id} title={media.name}><span className="tts-media-art"><Headphones size={28} aria-hidden="true"/></span><span className="studio-media-name">{media.name}</span></button>)}</div>
        {!filtered.length&&<div className="studio-media-empty"><Empty description={query.trim()?"没有匹配的音频素材":"生成或导入的音频会显示在这里"}/></div>}
      </section>
    </section>
  </div>;
}

function TtsParameters({formId,choice,text,busy,generate}:{formId:string;choice:GenerationChoice;text:string;busy:boolean;generate:(fields:Record<string,unknown>)=>Promise<void>}) {
  const cap = choice.capabilities;
  const [voice,setVoice] = useState(cap.default_voice || "alloy");
  const [format,setFormat] = useState("mp3");
  const [speed,setSpeed] = useState(1);
  const [instructions,setInstructions] = useState("");
  return <Form id={formId} layout="vertical" disabled={busy} onSubmit={()=>{if(busy)return;if(!text.trim()){Message.warning("请输入合成文本");return;}if(!voice.trim()){Message.warning("请输入音色 ID");return;}void generate({voice:voice.trim(),format,...(cap.speed?{speed}:{}),...(cap.instructions&&instructions.trim()?{instructions}:{})});}}>
    <Form.Item label="音色 ID" required extra={choice.channel.provider==="qianwen-token-plan"?"默认 longanhuan_v3.6；可填写服务支持的其他音色 ID。":"例如 alloy、echo、nova；可填写服务支持的音色 ID。"}>
      <Input aria-label="TTS 音色" value={voice} onChange={setVoice}/>
    </Form.Item>
    <div className="tts-parameter-row">
    <Form.Item label="音频格式"><Select aria-label="TTS 音频格式" value={format} onChange={setFormat} options={(cap.formats || ["mp3","wav"]).map(value=>({label:value.toUpperCase(),value}))}/></Form.Item>
    {cap.speed&&<Form.Item label="语速"><InputNumber aria-label="TTS 语速" min={0.25} max={4} step={0.05} value={speed} onChange={setSpeed}/></Form.Item>}
    </div>
    {cap.instructions&&<Form.Item label="风格指令（可选）"><Input.TextArea autoSize={{minRows:3,maxRows:6}} aria-label="TTS 风格指令" placeholder="例如：温柔、平静地讲述，适当停顿。" value={instructions} onChange={setInstructions} maxLength={4096}/></Form.Item>}
  </Form>;
}
