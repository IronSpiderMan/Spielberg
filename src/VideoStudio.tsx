import { buildVideoRequest, type VideoMode } from "./generation-request";
import { GenerationModeTabs, MediaSizeFields, VideoDurationField } from "./components/generation/GenerationFields";
import { ImageAssetSelect, ReferenceImagePicker } from "./components/generation/ReferenceImagePicker";
import { Button, Empty, Form, Message, Tag } from "@arco-design/web-react";
import { Film, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { isSupportedImage, useImageUpload } from "./hooks/useImageUpload";
import { usePromptOptimization } from "./hooks/usePromptOptimization";
import { defaultGenerationSize, Media, Snapshot, imageUrl, post } from "./core";
import { PromptInput } from "./PromptInput";
import { findMentions, promptMentions, resolvePromptReferences } from "./prompt-mentions";
import { STYLE_PRESETS } from "./prompt-presets";
import { PROMPT_TEMPLATES } from "./prompt-templates";
import { resolvePrompt, resolveReferencePrompt } from "./resolve-prompt";


export function VideoStudio({ data, reload }: { data: Snapshot; reload: () => void }) {
  const [mode, setMode] = useState<VideoMode>("t2v");
  const [prompt, setPrompt] = useState("");
  const [ratio, setRatio] = useState("16:9");
  const [size, setSize] = useState(defaultGenerationSize("16:9"));
  const [duration, setDuration] = useState(5);
  const [first, setFirst] = useState<number>();
  const [last, setLast] = useState<number>();
  const [refs, setRefs] = useState<number[]>([]);
  const [uploaded, setUploaded] = useState<Media[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Media>();
  const [error, setError] = useState("");
  const generating = useRef(false);
  const { uploading, inProgress: importing, uploadImages } = useImageUpload({ projectId:data.project.id,reload,refreshError:"刷新资产失败" });
  const { optimizing, optimize: optimizePrompt } = usePromptOptimization();
  const fileInput = useRef<HTMLInputElement>(null);
  const images = [...uploaded.filter(m => !data.media.some(item => item.id === m.id)), ...data.media].filter(m => m.kind === "image");
  const prompts = [...data.prompts, ...STYLE_PRESETS];
  const expanded = resolvePromptReferences(prompt, prompts);
  const mentions = mode === "i2v" ? findMentions(expanded, promptMentions(data.roles, data)) : [];
  const referenceIds = [...new Set([...refs, ...mentions.flatMap(item => item.media ? [item.media.id] : [])])];
  const disabled = busy || uploading || optimizing;

  const importImages = async (files: File[]) => {
    if (generating.current || importing.current || !files.length) return;
    if (files.some(file => !isSupportedImage(file))) {
      Message.warning("请选择 PNG、JPG、WebP 或 GIF 图片"); return;
    }
    if (mode !== "fl2v" && referenceIds.length + files.length > 9) {
      Message.warning("全能参考最多支持 9 张图片"); return;
    }
    await uploadImages(files, {stopOnError:true,onUploaded:media=>{
      setUploaded(items=>[...items,media]);
      if(mode==="fl2v")setFirst(media.id);
      else {setRefs(ids=>[...ids,media.id]);setMode("i2v");}
    },onComplete:()=>Message.success("图片已入库并选为视频参考图")});
  };

  const optimize = () => {
    if(disabled)return;
    return optimizePrompt({projectId:data.project.id,prompt,kind:"video",onOptimized:setPrompt,successMessage:null,
      imageIds:mode==="i2v"?referenceIds:mode==="fl2v"?[first,last].filter((id):id is number=>id!==undefined):[]});
  };

  const generate = async () => {
    if (generating.current || importing.current || optimizing) return;
    if (mode === "i2v" && mentions.some(item => !item.media)) return void Message.warning("引用的角色或场景尚无图片");
    let request: ReturnType<typeof buildVideoRequest>;
    try {
      request=buildVideoRequest({mode,prompt:mode==="i2v"?resolveReferencePrompt(expanded,data):resolvePrompt(expanded,data.roles),
        duration,ratio,size,firstId:first,lastId:last,referenceIds});
    } catch(e) { Message.warning(e instanceof Error?e.message:String(e)); return; }
    generating.current = true; setBusy(true); setError("");
    try {
      const media = await post<Media>("/generations/video", {project_id:data.project.id,...request});
      setResult(media); Message.success("视频已保存到资产库");
      try { await reload(); } catch (e) { Message.error(`视频已入库，但刷新资产失败：${String(e)}`); }
    } catch (e) { setError(String(e)); Message.error(String(e)); }
    finally { generating.current = false; setBusy(false); }
  };

  return <div className="creation-split video-creation-split">
    <div className="creation-panel">
      <Form layout="vertical" disabled={disabled}>
        <GenerationModeTabs value={mode} onChange={setMode} disabled={disabled} modes={[
          { value: "t2v", label: "文生视频" }, { value: "fl2v", label: "首尾帧" }, { value: "i2v", label: "全能参考" },
        ]} />
        <Form.Item label="视频描述" required>
          <PromptInput value={prompt} onChange={setPrompt} roles={data.roles} data={mode === "i2v" ? data : undefined} prompts={prompts} templates={[...PROMPT_TEMPLATES, ...data.prompts]} placeholder="描述画面、动作和镜头运动，输入 @ 引用角色或提示词" disabled={disabled} onOptimize={optimize} optimizing={optimizing} onPasteImages={files => void importImages(files)} />
          <p className="helper">{uploading ? "正在上传图片…" : "可粘贴图片作为参考，生成的视频会自动存入资产库"}</p>
        </Form.Item>
        {mode === "fl2v" && <>
          <Form.Item label="首帧" required><ImageAssetSelect media={images} value={first} onChange={setFirst} label="首帧" disabled={disabled} /></Form.Item>
          <Form.Item label="尾帧（可选）"><ImageAssetSelect media={images} value={last} onChange={setLast} label="尾帧（可选）" disabled={disabled} /></Form.Item>
        </>}
        {mode === "i2v" && <Form.Item label={`参考图片 · ${referenceIds.length} / 9`} required>
          <ReferenceImagePicker media={images} value={refs} mentionedIds={mentions.flatMap(item => item.media ? [item.media.id] : [])} presentation="select" disabled={disabled} ariaLabel="视频参考图片"
            onChange={ids => { if (new Set([...ids, ...mentions.flatMap(item => item.media ? [item.media.id] : [])]).size > 9) Message.warning("最多选择 9 张参考图"); else setRefs(ids); }} />
          {mentions.filter(item => !item.media).map(item => <Tag color="red" key={item.id}>{item.name} 缺少图片</Tag>)}
        </Form.Item>}
        {mode !== "t2v" && <Form.Item><Button icon={<Upload size={15} />} disabled={disabled} onClick={() => fileInput.current?.click()}>上传参考图片</Button><input ref={fileInput} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple={mode === "i2v"} onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ""; void importImages(files); }} /></Form.Item>}
        <VideoDurationField value={duration} onChange={setDuration} />
        <MediaSizeFields ratio={ratio} size={size} ariaPrefix="视频" onChange={value => { setRatio(value.ratio); setSize(value.size); }} />
        <Button type="primary" long icon={<Film size={16} />} loading={busy} disabled={uploading || optimizing} onClick={() => void generate()}>{busy ? "视频生成中…" : "生成视频"}</Button>
      </Form>
    </div>
    <div className="creation-panel image-result video-result" aria-busy={busy}>
      {result ? <><video key={result.id} src={imageUrl(result)} controls preload="metadata" /><p className="helper">{result.name} · 已保存到资产库</p></> : <Empty description={busy ? "正在生成视频，请稍候…" : "生成的视频将在这里展示，并自动进入资产库"} />}
      {error && <p className="image-generation-errors" role="alert">{error}</p>}
      <p className="helper">生成任务可在「后台任务」中查看进度与错误信息。</p>
    </div>
  </div>;
}
