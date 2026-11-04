import { useState } from "react";
import { Button, Form, Input, Select } from "@arco-design/web-react";
import { type Snapshot, imageUrl, post } from "./core";
import { GenerationSelector } from "./components/generation/GenerationSelector";
import { selectionPayload, useGenerationSelection } from "./generation-channels";
import "./tts.css";

export function AsrStudio({ data }: { data: Snapshot }) {
  const generation = useGenerationSelection(data.settings, "asr", "asr");
  const [mediaId, setMediaId] = useState<number>();
  const [language, setLanguage] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const audio = data.media.filter(m => m.kind === "audio");
  const selected = audio.find(m => m.id === mediaId);
  return <div className="creation-split tts-studio tts-creation-split">
    <section className="creation-panel tts-form"><h2>语音识别</h2><p>从素材库选择音频，将台词、配音或旁白转为文字。音频最大 25 MB；Qwen Token Plan 单次不超过 5 分钟。</p>
      <Form layout="vertical" disabled={busy}>
        <GenerationSelector settings={data.settings} kind="asr" operation="asr" value={generation.value} onChange={generation.setValue} disabled={busy}/>
        <Form.Item label="音频素材"><Select aria-label="识别音频" placeholder="请先将音频导入素材库" showSearch value={mediaId} onChange={setMediaId} options={audio.map(m => ({ label: m.name, value: m.id }))}/></Form.Item>
        {selected && <audio controls src={imageUrl(selected)} preload="metadata"/>}
        <Form.Item label="语言"><Select aria-label="识别语言" value={language} onChange={setLanguage} options={[{label:"自动识别",value:""},{label:"中文",value:"zh"},{label:"英语",value:"en"},{label:"日语",value:"ja"}]}/></Form.Item>
        <Button type="primary" loading={busy} disabled={!selected || !generation.choice || busy} onClick={async () => {
          setBusy(true); setError(""); setText("");
          try {
            const result = await post<{text:string}>("/generations/asr", {project_id:data.project.id,media_id:mediaId,...selectionPayload(generation.choice),...(language ? {language} : {})});
            setText(result.text);
          } catch (e) {setError(e instanceof Error ? e.message : String(e));}
          finally {setBusy(false);}
        }}>开始识别</Button>
      </Form>
      {error && <p role="alert" className="tts-error">{error}</p>}
    </section>
    <section className="creation-panel tts-results" aria-label="转写结果" aria-busy={busy}><h2>转写结果</h2>{busy && <p role="status">正在识别音频，请稍候。</p>}<Input.TextArea aria-label="转写文本" value={text} onChange={setText} autoSize={{minRows:14,maxRows:30}} placeholder="识别完成后，文字会显示在这里，可编辑或下载。"/><Button disabled={!text || busy} onClick={() => {
      const url = URL.createObjectURL(new Blob([text],{type:"text/plain;charset=utf-8"}));
      const a = document.createElement("a"); a.href=url; a.download="transcription.txt"; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
    }}>下载文本</Button></section>
  </div>;
}
