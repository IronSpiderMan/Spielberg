import { useState } from "react";
import { Button, Empty, Form, Input, InputNumber, Message, Select } from "@arco-design/web-react";
import { Mic } from "lucide-react";
import { imageUrl, post, type Media, type Snapshot } from "./core";
import { selectionPayload, useGenerationSelection, type GenerationChoice } from "./generation-channels";
import { GenerationSelector } from "./components/generation/GenerationSelector";
import "./tts.css";

export function TtsStudio({data,reload}:{data:Snapshot;reload:()=>void}) {
  const generation = useGenerationSelection(data.settings,"tts","tts");
  const [text,setText] = useState("");
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState("");
  const [latest,setLatest] = useState<Media>();
  const audios = data.media.filter(m=>m.kind==="audio");
  const items = latest && !audios.some(m=>m.id===latest.id) ? [latest,...audios] : audios;
  return <div className="tts-studio">
    <section className="tts-form">
      <h2><Mic size={20}/>语音合成</h2>
      <GenerationSelector settings={data.settings} kind="tts" operation="tts" value={generation.value} onChange={generation.setValue} disabled={busy}/>
      {!generation.choice&&<p className="helper">请先在工作室设置中添加 TTS 渠道和模型。</p>}
      <Form layout="vertical" disabled={busy}>
        <Form.Item label="合成文本" required extra="最多 4096 字符，支持中文及其他语言。">
          <Input.TextArea aria-label="合成文本" placeholder="输入台词、旁白或需要朗读的文字…" value={text} onChange={setText} maxLength={4096} showWordLimit autoSize={{minRows:6,maxRows:14}}/>
        </Form.Item>
      </Form>
      {generation.choice&&<TtsParameters key={`${generation.choice.channel.id}:${generation.choice.model.id}`} choice={generation.choice} text={text} busy={busy} generate={async fields=>{
        if(busy||!text.trim())return;
        setBusy(true);setError("");
        try {
          const media = await post<Media>("/generations/tts",{project_id:data.project.id,text,...selectionPayload(generation.choice),...fields});
          setLatest(media);Message.success("语音已生成并保存到素材库");
          Promise.resolve().then(reload).catch(()=>Message.warning("语音已保存，素材列表刷新失败，请稍后刷新"));
        } catch(e) {setError(String(e));} finally {setBusy(false);}
      }}/>}
      {error&&<p role="alert" className="tts-error">{error}</p>}
      <p className="helper">生成的声音由 AI 合成，可在素材库、资产音频参考和剪辑中使用。</p>
    </section>
    <section className="tts-results" aria-label="音频素材">
      <h2>音频素材 <span>{items.length}</span></h2>
      {!items.length?<Empty description="输入文字，生成第一段配音"/>:items.map(m=><article className="tts-audio" key={m.id}><strong>{m.name}</strong><audio aria-label={`试听 ${m.name}`} controls preload="none" src={imageUrl(m)}/></article>)}
    </section>
  </div>;
}

function TtsParameters({choice,text,busy,generate}:{choice:GenerationChoice;text:string;busy:boolean;generate:(fields:Record<string,unknown>)=>Promise<void>}) {
  const cap = choice.capabilities;
  const [voice,setVoice] = useState(cap.default_voice || "alloy");
  const [format,setFormat] = useState("mp3");
  const [speed,setSpeed] = useState(1);
  const [instructions,setInstructions] = useState("");
  return <Form layout="vertical" disabled={busy} onSubmit={()=>void generate({voice,format,...(cap.speed?{speed}:{}),...(cap.instructions&&instructions.trim()?{instructions}:{})})}>
    <Form.Item label="音色 ID" required extra={choice.channel.provider==="qianwen-token-plan"?"默认 longanhuan_v3.6；可填写服务支持的其他音色 ID。":"例如 alloy、echo、nova；可填写服务支持的音色 ID。"}>
      <Input aria-label="TTS 音色" value={voice} onChange={setVoice}/>
    </Form.Item>
    <Form.Item label="音频格式"><Select aria-label="TTS 音频格式" value={format} onChange={setFormat} options={(cap.formats || ["mp3","wav"]).map(value=>({label:value.toUpperCase(),value}))}/></Form.Item>
    {cap.speed&&<Form.Item label="语速"><InputNumber aria-label="TTS 语速" min={0.25} max={4} step={0.05} value={speed} onChange={setSpeed}/></Form.Item>}
    {cap.instructions&&<Form.Item label="风格指令（可选）"><Input.TextArea aria-label="TTS 风格指令" placeholder="例如：温柔、平静地讲述，适当停顿。" value={instructions} onChange={setInstructions} maxLength={4096}/></Form.Item>}
    <Button htmlType="submit" type="primary" icon={<Mic size={16}/>} loading={busy} disabled={busy||!text.trim()||!voice.trim()}>生成语音</Button>
  </Form>;
}
