import { PreviewVideo } from "./components/VideoPreviewModal";
import { ReferenceMediaPicker } from "./components/generation/ReferenceMediaPicker";
import { buildVideoRequest, type VideoMode } from "./generation-request";
import { GenerationModeTabs, MediaSizeFields, VideoDurationField } from "./components/generation/GenerationFields";
import { ImageAssetSelect, ReferenceImagePicker } from "./components/generation/ReferenceImagePicker";
import { Button, Empty, Form, Message, Tag } from "@arco-design/web-react";
import { Film, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { isSupportedImage, useImageUpload } from "./hooks/useImageUpload";
import { usePromptOptimization } from "./hooks/usePromptOptimization";
import { defaultGenerationSize, Media, Snapshot, post } from "./core";
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
  const [referenceVideos, setReferenceVideos] = useState<number[]>([]);
  const [referenceAudios, setReferenceAudios] = useState<number[]>([]);
  const [uploadingReferences, setUploadingReferences] = useState(false);
  const [refs, setRefs] = useState<number[]>([]);
  const [uploaded, setUploaded] = useState<Media[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Media>();
  const [error, setError] = useState("");
  const generating = useRef(false);
  const { uploading, inProgress: importing, uploadImages } = useImageUpload({ projectId:data.project.id,reload,refreshError:"刷新素材失败" });
  const { optimizing, optimize: optimizePrompt } = usePromptOptimization();
  const fileInput = useRef<HTMLInputElement>(null);
  const images = [...uploaded.filter(m => !data.media.some(item => item.id === m.id)), ...data.media].filter(m => m.kind === "image");
  const prompts = [...data.prompts, ...STYLE_PRESETS];
  const expanded = resolvePromptReferences(prompt, prompts);
  const mentions = mode === "i2v" ? findMentions(expanded, promptMentions(data.assets, data)) : [];
  const referenceIds = [...new Set([...refs, ...mentions.flatMap(item => item.media ? [item.media.id] : [])])];
  const disabled = busy || uploading || optimizing || uploadingReferences;

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
    if (generating.current || importing.current || optimizing || uploadingReferences) return;
    if (mode === "i2v" && mentions.some(item => !item.media)) return void Message.warning("引用的资产或场景尚无图片");
    let request: ReturnType<typeof buildVideoRequest>;
    try {
      request=buildVideoRequest({mode,prompt:mode==="i2v"?resolveReferencePrompt(expanded,data):resolvePrompt(expanded,data.assets),
        duration,ratio,size,firstId:first,lastId:last,referenceIds,referenceVideoIds:referenceVideos,referenceAudioIds:referenceAudios});
    } catch(e) { Message.warning(e instanceof Error?e.message:String(e)); return; }
    generating.current = true; setBusy(true); setError("");
    try {
      const media = await post<Media>("/generations/video", {project_id:data.project.id,...request});
      setResult(media); Message.success("视频已保存到素材库");
      try { await reload(); } catch (e) { Message.error(`视频已入库，但刷新素材失败：${String(e)}`); }
    } catch (e) { setError(String(e)); Message.error(String(e)); }
    finally { generating.current = false; setBusy(false); }
  };

  return <div className="creation-split video-creation-split">
    <div className="creation-panel">
      <div className="generation-panel-heading"><h2>视频生成</h2></div>
      <Form layout="vertical" disabled={disabled}>
        <GenerationModeTabs value={mode} onChange={setMode} disabled={disabled} modes={[
          { value: "t2v", label: "文生视频" }, { value: "fl2v", label: "首尾帧" }, { value: "i2v", label: "全能参考" },
        ]} />
        <Form.Item label="视频描述" required>
          <PromptInput value={prompt} onChange={setPrompt} roles={data.assets} data={mode === "i2v" ? data : undefined} prompts={prompts} templates={[...PROMPT_TEMPLATES, ...data.prompts]} placeholder="描述画面、动作和镜头运动，输入 @ 引用资产或提示词" disabled={disabled} onOptimize={optimize} optimizing={optimizing} onPasteImages={files => void importImages(files)} />
          <p className="helper">{uploading ? "正在上传图片…" : "可粘贴图片作为参考，生成的视频会自动存入素材库"}</p>
        </Form.Item>
        {mode === "fl2v" && <>
          <Form.Item label="首帧" required><ImageAssetSelect media={images} value={first} onChange={setFirst} label="首帧" disabled={disabled} /></Form.Item>
          <Form.Item label="尾帧（可选）"><ImageAssetSelect media={images} value={last} onChange={setLast} label="尾帧（可选）" disabled={disabled} /></Form.Item>
        </>}
        {mode === "i2v" && <Form.Item label={`参考图片 · ${referenceIds.length} / 9`}>
          <ReferenceImagePicker media={images} value={refs} mentionedIds={mentions.flatMap(item => item.media ? [item.media.id] : [])} presentation="select" disabled={disabled} ariaLabel="视频参考图片"
            onChange={ids => { if (new Set([...ids, ...mentions.flatMap(item => item.media ? [item.media.id] : [])]).size > 9) Message.warning("最多选择 9 张参考图"); else setRefs(ids); }} />
          {mentions.filter(item => !item.media).map(item => <Tag color="red" key={item.id}>{item.name} 缺少图片</Tag>)}
        </Form.Item>}
        {mode !== "t2v" && <Form.Item><Button icon={<Upload size={15} />} disabled={disabled} onClick={() => fileInput.current?.click()}>上传参考图片</Button><input ref={fileInput} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" multiple={mode === "i2v"} onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ""; void importImages(files); }} /></Form.Item>}
        {mode === "i2v" && <ReferenceMediaPicker projectId={data.project.id} media={data.media} videoIds={referenceVideos} audioIds={referenceAudios} reload={reload} disabled={busy || uploading || optimizing} onUploading={setUploadingReferences} onChange={(kind, ids) => kind === "video" ? setReferenceVideos(ids) : setReferenceAudios(ids)} />}
        <VideoDurationField value={duration} onChange={setDuration} />
        <MediaSizeFields ratio={ratio} size={size} ariaPrefix="视频" onChange={value => { setRatio(value.ratio); setSize(value.size); }} />
        </Form>
      <Button className="generation-submit" type="primary" long icon={<Film size={16} />} loading={busy} disabled={uploading || optimizing || uploadingReferences} onClick={() => void generate()}>{busy ? "视频生成中…" : "生成视频"}</Button>
    </div>
    <div className="creation-panel image-result video-result" aria-busy={busy}>
      <div className="generation-preview-heading"><h2>生成预览</h2><span className={`generation-state${busy ? " is-busy" : result ? " is-ready" : ""}`}>{busy ? "生成中" : result ? "已完成" : "等待创作"}</span></div>
      <div className="generation-preview-body">
      {result ? <><PreviewVideo key={result.id} media={result} projectId={data.project.id} /><p className="helper">{result.name} · 已保存到素材库</p></> : <Empty icon={<Film size={28} />} description={<><b>{busy ? "视频正在生成" : "下一个精彩镜头，从这里开始"}</b><p>{busy ? "稍候片刻，完成后将自动展示" : "在左侧描述画面，生成的视频将自动存入素材库"}</p></>} />}
      {error && <p className="image-generation-errors" role="alert">{error}</p>}
      </div>
      <p className="helper generation-result-note">生成任务可在「后台任务」中查看进度与错误信息。</p>
    </div>
  </div>;
}
