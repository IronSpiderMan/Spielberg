import { GenerationSelector } from "./components/generation/GenerationSelector";
import { VideoModelFields } from "./components/generation/ModelGenerationFields";
import { generationChoice, modelRatio, selectionPayload, useGenerationSelection, validateGeneration } from "./generation-channels";
import { PreviewVideo } from "./components/VideoPreviewModal";
import { StudioMediaLibrary, useStudioMedia } from "./components/StudioMediaLibrary";
import { ReferenceMediaPicker } from "./components/generation/ReferenceMediaPicker";
import { buildVideoRequest, type VideoMode } from "./generation-request";
import { GenerationModeTabs, MediaSizeFields, VideoDurationField } from "./components/generation/GenerationFields";
import { ImageAssetSelect, ReferenceImagePicker } from "./components/generation/ReferenceImagePicker";
import { Button, Checkbox, Empty, Form, Message, Select, Tag } from "@arco-design/web-react";
import { Film, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { isSupportedImage, useImageUpload } from "./hooks/useImageUpload";
import { usePromptOptimization } from "./hooks/usePromptOptimization";
import { defaultGenerationSize, Media, Snapshot, post } from "./core";
import { PromptInput } from "./PromptInput";
import { findMentions, promptMentions, resolvePromptReferences } from "./prompt-mentions";
import { STYLE_PRESETS } from "./prompt-presets";
import { PROMPT_TEMPLATES } from "./prompt-templates";
import { resolvePrompt, resolveReferencePrompt } from "./resolve-prompt";


export function VideoStudio({ data, reload }: { data: Snapshot; reload: () => void }) {
  const [resolution,setResolution]=useState("720P");
  const [mode, setMode] = useState<VideoMode>("t2v");
  const generation=useGenerationSelection(data.settings,"video",mode==="i2v"?"ref2v":mode);
  const [prompt, setPrompt] = useState("");
  const [ratio, setRatio] = useState("16:9");
  const [size, setSize] = useState(defaultGenerationSize("16:9"));
  const [duration, setDuration] = useState(5);
  const [audio, setAudio] = useState(true);
  const [first, setFirst] = useState<number>();
  const [last, setLast] = useState<number>();
  const [referenceVideos, setReferenceVideos] = useState<number[]>([]);
  const [referenceAudios, setReferenceAudios] = useState<number[]>([]);
  const [uploadingReferences, setUploadingReferences] = useState(false);
  const [refs, setRefs] = useState<number[]>([]);
  const [uploaded, setUploaded] = useState<Media[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Media>();
  const videoLibrary = useStudioMedia(data.media, "video");
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
  const cap=generationChoice(data.settings,"video",generation.value)?.capabilities;
  const qianwen=generation.choice?.channel.provider === "qianwen-token-plan";
  const happyhorse=cap?.label.startsWith("HappyHorse");
  useEffect(()=>{
    if (!cap) return;
    const operation=mode === "i2v"?"ref2v":mode;
    if (!cap.modes.includes(operation)) setMode(cap.modes[0] === "ref2v"?"i2v":cap.modes[0] as VideoMode);
    if (!(duration===-1&&cap.smart_duration) && (duration<(cap.min_duration||3)||duration>(cap.max_duration||15))) setDuration(5);
  },[generation.choice?.channel.id,generation.choice?.model.id]);

  const importImages = async (files: File[]) => {
    if (generating.current || importing.current || !files.length) return;
    if (cap && !cap.modes.includes("ref2v") && !cap.modes.includes("fl2v")) {
      Message.warning("当前模型不支持图片输入，请先切换到首帧或图片参考模型"); return;
    }
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
      validateGeneration(generation.choice,mode==="i2v"?"ref2v":mode,{images:mode==="i2v"?referenceIds.length:0,videos:mode==="i2v"?referenceVideos.length:0,audios:mode==="i2v"?referenceAudios.length:0,last:mode==="fl2v"&&!!last,duration});
      request=buildVideoRequest({mode,prompt:mode==="i2v"?resolveReferencePrompt(expanded,data,qianwen?referenceIds:undefined):resolvePrompt(expanded,data.assets),
        duration,ratio:modelRatio(generation.choice,ratio),size,firstId:first,lastId:cap?.last_frame?last:undefined,referenceIds,
        referenceVideoIds:cap?.max_videos?referenceVideos:[],referenceAudioIds:cap?.max_audios?referenceAudios:[]});
    } catch(e) { Message.warning(e instanceof Error?e.message:String(e)); return; }
    generating.current = true; setBusy(true); setError("");
    try {
      const media = await post<Media>("/generations/video", {project_id:data.project.id,...request,...selectionPayload(generation.choice),...(cap?.size_mode==="resolution"?{resolution}:{}),...(cap?.audio?{audio}:{})});
      setResult(media); videoLibrary.remember(media); Message.success("视频已保存到素材库");
      try { await reload(); } catch (e) { Message.error(`视频已入库，但刷新素材失败：${String(e)}`); }
    } catch (e) { setError(String(e)); Message.error(String(e)); }
    finally { generating.current = false; setBusy(false); }
  };

  return <div className="creation-split video-creation-split">
    <div className="creation-panel">
      <div className="generation-panel-heading"><h2>视频生成</h2></div>
      <Form layout="vertical" disabled={disabled}>
        <GenerationSelector settings={data.settings} kind="video" value={generation.value} onChange={value=>{generation.setValue(value);setLast(undefined);setReferenceVideos([]);setReferenceAudios([]);}} disabled={disabled}/>
        <GenerationModeTabs value={mode} onChange={value=>setMode(value as VideoMode)} disabled={disabled} modes={[
          { value: "t2v", label: "文生视频" }, { value: "fl2v", label: cap?.last_frame ? "首尾帧" : "首帧生视频" }, { value: "i2v", label: cap?.max_videos ? "全能参考" : "图片参考" },
        ].filter(item=>!cap || cap.modes.includes(item.value === "i2v"?"ref2v":item.value))} />
        <Form.Item label="视频描述" required>
          <PromptInput value={prompt} onChange={setPrompt} roles={data.assets} data={mode === "i2v" ? data : undefined} prompts={prompts} templates={[...PROMPT_TEMPLATES, ...data.prompts]} placeholder="描述画面、动作和镜头运动，输入 @ 引用资产或提示词" disabled={disabled} onOptimize={optimize} optimizing={optimizing} onPasteImages={files => void importImages(files)} />
          <p className="helper">{uploading ? "正在上传图片…" : "可粘贴图片作为参考，生成的视频会自动存入素材库"}</p>
        </Form.Item>
        {mode === "fl2v" && <>
          <Form.Item label="首帧" required><ImageAssetSelect media={images} value={first} onChange={setFirst} label="首帧" disabled={disabled} /></Form.Item>
          {cap?.last_frame && <Form.Item label="尾帧（可选）"><ImageAssetSelect media={images} value={last} onChange={setLast} label="尾帧（可选）" disabled={disabled} /></Form.Item>}
        </>}
        {mode === "i2v" && <Form.Item label={`参考图片 · ${referenceIds.length} / 9`}>
          <ReferenceImagePicker media={images} value={refs} mentionedIds={mentions.flatMap(item => item.media ? [item.media.id] : [])} presentation="select" disabled={disabled} ariaLabel="视频参考图片"
            onChange={ids => { if (new Set([...ids, ...mentions.flatMap(item => item.media ? [item.media.id] : [])]).size > 9) Message.warning("最多选择 9 张参考图"); else setRefs(ids); }} />
          {mentions.filter(item => !item.media).map(item => <Tag color="red" key={item.id}>{item.name} 缺少图片</Tag>)}
        </Form.Item>}
        {mode !== "t2v" && <Form.Item><Button icon={<Upload size={15} />} disabled={disabled} onClick={() => fileInput.current?.click()}>上传参考图片</Button><input ref={fileInput} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" multiple={mode === "i2v"} onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ""; void importImages(files); }} /></Form.Item>}
        {mode === "i2v" && !!cap?.max_videos && <ReferenceMediaPicker projectId={data.project.id} media={data.media} videoIds={referenceVideos} audioIds={referenceAudios} reload={reload} disabled={busy || uploading || optimizing} onUploading={setUploadingReferences} onChange={(kind, ids) => kind === "video" ? setReferenceVideos(ids) : setReferenceAudios(ids)} />}
        <VideoModelFields disabled={disabled} choice={generation.choice} mode={mode} duration={duration} onDuration={setDuration} ratio={ratio} size={size} onSize={value=>{setRatio(value.ratio);setSize(value.size);}} resolution={resolution} onResolution={setResolution} audio={audio} onAudio={setAudio}/>
        {qianwen&&mode==="i2v"&&<p className="helper">使用 [Image 1]、[Image 2] 引用所选图片。{cap?.max_videos?"参考视频支持 MP4/MOV，音频支持 MP3/WAV；视频和音频各自总时长不超过 15 秒，输入视频与输出视频总时长不超过 30 秒。":""}</p>}
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
      <StudioMediaLibrary kind="video" items={videoLibrary.items} projectId={data.project.id} />
    </div>
  </div>;
}
