import { Button, Form, Input, Message, Modal, Select, Space, Switch, Tag } from "@arco-design/web-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Film, Play, Save } from "lucide-react";
import { ConfirmPopover } from "./components/ConfirmAction";
import { GenerationSelector } from "./components/generation/GenerationSelector";
import { ClipReferenceImagePicker } from "./components/generation/ClipReferenceImagePicker";
import { ReferenceMediaPicker } from "./components/generation/ReferenceMediaPicker";
import { VideoModelFields } from "./components/generation/ModelGenerationFields";
import { ImageAssetSelect } from "./components/generation/ReferenceImagePicker";
import { VideoPreviewModal } from "./components/VideoPreviewModal";
import { GENERATION_SIZES, imageUrl, normalizeGenerationSize, post, type Episode, type GenerationOptions, type GenerationPreview, type Media, type Scene, type Snapshot } from "./core";
import { generationChoice, modelRatio } from "./generation-channels";
import { confirmDiscard } from "./edit-guard";
import { PromptInput } from "./PromptInput";
import "./scene-composition.css";

export function GenerationPreviewPanel({ preview, media }: { preview: GenerationPreview; media: Media[] }) {
  const sources = [
    ["首帧", preview.first_media_id ? [preview.first_media_id] : []],
    ["尾帧", preview.last_media_id ? [preview.last_media_id] : []],
    ["参考图", preview.image_media_ids || []],
    ["参考视频", preview.reference_video_media_ids || []],
    ["参考音频", preview.reference_audio_media_ids || []],
  ] as const;
  return <div className="scene-generation-preview" aria-live="polite">
    <Space wrap>
      {preview.model && <Tag title={preview.channel_id}>{preview.model}</Tag>}
      {preview.aspect_ratio && <Tag>{preview.aspect_ratio}</Tag>}
      {preview.resolution && <Tag>{preview.resolution}</Tag>}
      {preview.duration > 0 && <Tag>{preview.duration} 秒</Tag>}
      {preview.duration === -1 && <Tag>智能时长</Tag>}
    </Space>
    {preview.warnings?.map(warning => <p className="helper" key={warning}>{warning}</p>)}
    {!!preview.beats?.length && <ol>{preview.beats.map(beat => <li key={beat.clip_id}>{beat.start}–{beat.end} 秒 · {beat.title}</li>)}</ol>}
    <pre aria-label="实际发送的 Prompt">{preview.prompt}</pre>
    <div className="scene-generation-sources">{sources.flatMap(([label, ids]) => ids.map((id, index) => {
      const item = media.find(entry => entry.id === id);
      return <span key={`${label}-${id}`} title={item?.name}>
        {item?.kind === "image" && <img src={imageUrl(item)} alt="" />}
        {label} {ids.length > 1 || label === "参考图" ? `${index + 1} · ` : "· "}{item?.name || `#${id}`}
      </span>;
    }))}</div>
  </div>;
}

export type SceneInsertion = { anchor_scene_id: number; position: "before" | "after" };

export function SceneSettings({ data, episode, scene, clipIds, insertion, reload, close, onSaved, onStatus, renderClips }: {
  data: Snapshot;
  episode: Episode;
  scene?: Scene;
  clipIds?: number[];
  insertion?: SceneInsertion;
  reload: () => void;
  close?: () => void;
  onStatus?: (dirty: boolean, busy: boolean) => void;
  renderClips?: (afterSave: (action: () => void) => void, busy: boolean) => ReactNode;
  onSaved?: (scene: Scene) => void;
}) {
  const [title, setTitle] = useState(scene?.title || `场景 ${episode.scenes.length + 1}`);
  const [description, setDescription] = useState(scene?.description || "");
  const [prompt, setPrompt] = useState(scene?.shared_prompt || "");
  const [imageIds, setImageIds] = useState(scene?.reference_media_ids || []);
  const [audioIds, setAudioIds] = useState(scene?.reference_audio_media_ids || []);
  const [mode, setMode] = useState<Scene["generation_mode"]>(scene?.generation_mode || "clips");
  const [options, setOptions] = useState<Partial<GenerationOptions>>(scene?.generation_options || {});
  const [busy, setBusy] = useState("");
  const [uploadingImages, setUploadingImages] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const locked = !!busy || uploadingImages || uploadingMedia;
  const inProgress = useRef(false);
  const [preview, setPreview] = useState<GenerationPreview>();
  const [video, setVideo] = useState<Media | null>(null);
  const clips = scene?.clips || episode.clips.filter(clip => clipIds?.includes(clip.id));
  const durations = clips.map(clip => clip.generation_options?.duration ?? options.duration ?? 5);
  const duration = Math.round(durations.reduce((sum, value) => sum + Math.max(0, value), 0) * 1000) / 1000;
  const initialFrame = options.first_media_id === undefined ? clips[0]?.first_media_id : options.first_media_id;
  const finalFrame = options.last_media_id === undefined ? clips[clips.length - 1]?.last_media_id : options.last_media_id;
  const hasReferences = imageIds.length || audioIds.length || options.reference_video_media_ids?.length || clips.some(clip =>
    clip.generation_options?.reference_media_ids?.length || clip.generation_options?.reference_audio_media_ids?.length
    || clip.generation_options?.reference_video_media_ids?.length || clip.reference_media_id);
  const videoMode = options.video_mode === "ref2v" ? "i2v" : options.video_mode || (hasReferences ? "i2v" : initialFrame ? "fl2v" : "t2v");
  const operation = videoMode === "i2v" ? "ref2v" : videoMode;
  const defaultChoice = generationChoice(data.settings, "video", options);
  const cap = defaultChoice?.capabilities;
  const choice = generationChoice(data.settings, "video", options, operation);
  const ratio = modelRatio(choice, options.aspect_ratio || "16:9");
  const ratios = choice?.capabilities.ratios || GENERATION_SIZES.map(item => item.ratio);
  const sizes = GENERATION_SIZES.find(item => item.ratio === ratio)?.sizes || [];
  const project_id = data.project.id;
  const signature = JSON.stringify({ title, description, prompt, imageIds, audioIds, mode, options });
  const [savedSignature, setSavedSignature] = useState(signature);
  const dirty = signature !== savedSignature;
  useEffect(() => { onStatus?.(dirty, locked); }, [dirty, locked, onStatus]);
  useEffect(() => () => onStatus?.(false, false), [onStatus]);
  const closeSettings = () => {
    if (locked || inProgress.current || !close) return;
    if (dirty) confirmDiscard(close);
    else close();
  };

  const updateOptions = (values: Partial<GenerationOptions>) => {
    setOptions(previous => ({ ...previous, ...values }));
    setPreview(undefined);
  };
  const save = async () => {
    if (!title.trim()) throw new Error("请输入场景名称");
    const values = { project_id, title: title.trim(), description, shared_prompt: prompt, reference_media_ids: imageIds, reference_audio_media_ids: audioIds, generation_mode: mode,
      generation_options: mode === "one_take" ? { ...options, audio: choice?.capabilities.audio ? options.audio : undefined } : options };
    const result = scene ? await post<Scene>("/scenes/update", { ...values, id: scene.id })
      : await post<Scene>("/scenes", { ...values, episode_id: episode.id, clip_ids: clipIds, ...insertion });
    setSavedSignature(signature);
    return result;
  };
  const run = async (action: string, work: () => Promise<void>) => {
    if (locked || inProgress.current) return;
    inProgress.current = true;
    setBusy(action);
    try { await work(); }
    catch (error) { Message.error(String(error)); }
    finally { inProgress.current = false; setBusy(""); }
  };
  const persist = async () => {
    const result = await save();
    await reload();
    onSaved?.(result);
    if (!renderClips) close?.();
    Message.success(scene ? "场景已保存" : "场景已创建");
  };
  const afterSave = (action: () => void) => {
    if (locked || inProgress.current) return;
    if (!dirty) action();
    else void run("save", async () => { await persist(); action(); });
  };
  const generate = (dryRun: boolean) => run(dryRun ? "preview" : "video", async () => {
    if (!scene) return;
    await save();
    await reload();
    const input = { project_id, scene_id: scene.id };
    const prepared = await post<GenerationPreview>("/generations/scene-preview", input);
    setPreview(prepared);
    if (dryRun) return;
    const result = await post<Media & { generation_context_changed?: boolean }>("/generations/scene-video", input);
    await reload();
    setVideo(result);
    if (result.generation_context_changed) Message.warning("生成期间场景有改动，已将结果添加为候选版本。");
    else Message.success("已添加一个一镜到底版本");
  });
  const selectVideo = (id: number) => run("select", async () => {
    await post("/scenes/select-video", { project_id, scene_id: scene?.id, media_id: id });
    await reload();
  });
  const removeVideo = async (id: number) => {
    setBusy("remove");
    try {
      await post("/scenes/delete-video", { project_id, scene_id: scene?.id, media_id: id });
      await reload();
    } finally { setBusy(""); }
  };

  const saveButton = <Button type="primary" disabled={locked} loading={busy === "save"} icon={<Save size={16}/>}
    onClick={() => void run("save", persist)}>{scene ? "保存场景" : "创建场景"}</Button>;
  const modelSelector = <GenerationSelector settings={data.settings} kind="video" value={options} disabled={locked}
    onChange={value => {
      const capabilities = generationChoice(data.settings, "video", value)?.capabilities;
      const next = capabilities?.modes.includes(operation) ? operation : capabilities?.modes[0];
      updateOptions({
        ...value,
        ...(mode === "one_take" ? { video_mode: next === "ref2v" ? "i2v" : next as GenerationOptions["video_mode"] } : {}),
        resolution: undefined,
        audio: capabilities?.audio ? options.audio : undefined,
      });
    }}/>;
  const form = <>
    <Form layout="vertical" disabled={locked}>
      <Form.Item label="场景名称" required><Input aria-label="场景名称" value={title} onChange={setTitle} /></Form.Item>
      <Form.Item label="场景描述"><Input.TextArea aria-label="场景描述" rows={4} value={description} onChange={value => { setDescription(value); setPreview(undefined); }} /></Form.Item>
      {!!clipIds?.length && <>
        <p className="helper">纳入 {clipIds.length} 个片段 · {clips.map(clip => clip.title).join(" → ")}</p>
        <p className="helper">片段将继承下方设定。原场景的片段全部移出后，将移除该场景的共享设定和场景视频关联。</p>
      </>}
      <Form.Item label="共享 Prompt" extra="场景描述和共享 Prompt 为片段提供通用背景。生成时会与片段自己的 Prompt 合用。">
        <PromptInput ariaLabel="共享 Prompt" value={prompt} onChange={value => { setPrompt(value); setPreview(undefined); }} roles={data.assets} data={data}
          prompts={data.prompts} disabled={locked} placeholder="描述时间地点、画面风格、人物音色、环境声和开场站位，使用 @ 引用资产或提示词" />
      </Form.Item>
      <ClipReferenceImagePicker data={data} label="共享参考图" value={imageIds} reload={reload}
        disabled={!!busy || uploadingMedia} onUploading={setUploadingImages}
        onChange={update => { setImageIds(update); setPreview(undefined); }} />
      <ReferenceMediaPicker shared projectId={project_id} media={data.media} assets={data.assets}
        videoIds={options.reference_video_media_ids} audioIds={audioIds} reload={reload}
        disabled={!!busy || uploadingImages} onUploading={setUploadingMedia}
        onChange={(kind, ids) => {
          if (kind === "video") updateOptions({ reference_video_media_ids: ids });
          else { setAudioIds(ids); setPreview(undefined); }
        }} />
      <p className="helper">共享素材用于片段的全能参考模式。片段可以添加自己的素材或排除指定共享素材。</p>
      <Form.Item label="场景生成方式">
        <Select aria-label="场景生成方式" value={mode} onChange={value => { setMode(value); setPreview(undefined); }}
          options={[{ label: "逐片段生成", value: "clips" }, { label: "一镜到底", value: "one_take" }]} />
      </Form.Item>
      <section className="scene-one-take">
        <h3>{mode === "one_take" ? "一镜到底" : "片段默认生成参数"}</h3>
        {mode === "one_take" ? <p className="helper">{durations.some(value => value <= 0) ? "请为每个片段设置具体时长。" : `合计 ${clips.length ? duration : 5} 秒。`} 根据片段顺序和各自时长组织动作，整场生成一条视频。</p>
          : <p className="helper">未单独配置的片段沿用这里的参数。片段自己的选择优先。</p>}
        {mode === "clips" ? <>
          <div className="scene-generation-settings">
            {modelSelector}
            <VideoModelFields disabled={locked} choice={defaultChoice}
              duration={options.duration ?? 5} onDuration={duration => updateOptions({ duration })}
              ratio={options.aspect_ratio || "16:9"} size={options.size} onSize={value => updateOptions({ aspect_ratio: value.ratio, size: value.size })}
              resolution={options.resolution} onResolution={resolution => updateOptions({ resolution })}
              audio={options.audio} onAudio={audio => updateOptions({ audio })} />
          </div>
          {!!(options.channel_id || options.model) && <Button size="small" disabled={locked}
            onClick={() => updateOptions({ channel_id: undefined, model: undefined })}>使用项目默认渠道</Button>}
        </> : <>
          {modelSelector}
          <Form.Item label="视频输入方式">
            <Select aria-label="视频输入方式" value={videoMode} onChange={value => updateOptions({ video_mode: value })}
              options={[
                { label: "文生视频", value: "t2v", operation: "t2v" },
                { label: "首尾帧", value: "fl2v", operation: "fl2v" },
                { label: "参考素材", value: "i2v", operation: "ref2v" },
              ].map(item => ({ ...item, disabled: !!(options.channel_id || options.model) && !!cap && !cap.modes.includes(item.operation) }))} />
          </Form.Item>
          {videoMode === "fl2v" && <>
            <Form.Item label="开场首帧（默认使用首个片段的首帧）">
              <ImageAssetSelect label="开场首帧" media={data.media} value={initialFrame ?? undefined}
                onChange={id => updateOptions({ first_media_id: id ?? null })} disabled={locked}/>
            </Form.Item>
            {(cap?.last_frame || !!finalFrame) && <Form.Item label={cap?.last_frame === false ? "收尾帧（当前模型不支持，请清除）" : "收尾帧（默认使用末尾片段的尾帧）"}>
              <ImageAssetSelect label="收尾帧" media={data.media} value={finalFrame ?? undefined}
                onChange={id => updateOptions({ last_media_id: id ?? null })} disabled={locked}/>
            </Form.Item>}
          </>}
          <div className="scene-generation-parameters">
            <Form.Item label="画幅">
              <Select aria-label="画幅" value={ratio} onChange={value => updateOptions({ aspect_ratio: value, size: undefined })}
                options={ratios.map(value => ({ value, label: value }))} />
            </Form.Item>
            {choice?.capabilities.size_mode === "resolution" ? <Form.Item label="分辨率">
              <Select aria-label="分辨率" value={options.resolution || choice.channel.resolution || "720P"} onChange={value => updateOptions({ resolution: value })}
                options={(choice.capabilities.resolutions || []).map(value => ({ value, label: value }))} />
            </Form.Item> : <Form.Item label="尺寸">
              <Select aria-label="尺寸" value={normalizeGenerationSize(ratio, options.size)} onChange={value => updateOptions({ size: value })}
                options={sizes.map(value => ({ value, label: value }))} />
            </Form.Item>}
            {choice?.capabilities.audio && <Form.Item label="生成声音">
              <Switch aria-label="生成声音" checked={options.audio ?? true} onChange={audio => updateOptions({ audio })} />
            </Form.Item>}
          </div>
        </>}
        {mode === "one_take" && choice && clips.length > 0 && (Math.ceil(duration) < (choice.capabilities.min_duration ?? 3) || Math.ceil(duration) > (choice.capabilities.max_duration ?? 15)) &&
          <p role="alert" className="generation-error">片段总时长超出当前模型范围，请调整片段时长或选择其他模型。</p>}
        {scene && mode === "one_take" && <Space wrap>
          <Button disabled={locked} loading={busy === "preview"} onClick={() => void generate(true)}>保存并预览生成</Button>
          <Button disabled={locked || !choice} loading={busy === "video"} icon={<Film size={16}/>} onClick={() => void generate(false)}>生成一镜到底</Button>
        </Space>}
        {mode === "one_take" && preview && <GenerationPreviewPanel preview={preview} media={data.media} />}
      </section>
    </Form>
    {!!scene?.videos?.length && <section className="scene-one-take">
      <h3>场景视频版本</h3>
      {scene.videos.map(item => <div key={item.id} className="scene-version-row">
        <Button size="small" type="text" icon={<Play size={14}/>} onClick={() => setVideo(item)}>{item.name}</Button>
        {scene.video_media_id === item.id ? <Tag color="green">主视频</Tag> : <Button size="small" disabled={locked} onClick={() => void selectVideo(item.id)}>设为主视频</Button>}
        <ConfirmPopover title="移除这个场景视频版本？" content="此操作解除场景与该视频的关联。" okText="移除" disabled={locked}
          onOk={() => removeVideo(item.id)}><Button size="small" status="danger" disabled={locked}>移除版本</Button></ConfirmPopover>
      </div>)}
    </section>}
    <VideoPreviewModal media={video} onClose={() => setVideo(null)} projectId={project_id} />
  </>;
  if (renderClips) return <section className="scene-settings-page">
    <div className="scene-settings-page-heading">
      <h2>编辑场景</h2>
      <Space><Tag color={dirty ? "orange" : "green"}>{dirty ? "未保存" : "已保存"}</Tag>{saveButton}</Space>
    </div>
    <div className="scene-editor-content">
      <div className="scene-composer"><div className="scene-form-card">{form}</div></div>
      {renderClips(afterSave, locked)}
    </div>
  </section>;
  const creationTitle = insertion
    ? (insertion.position === "before" ? "在前方插入场景" : "在后方插入场景")
    : clipIds?.length ? "将所选片段归为场景" : "新建场景";
  return <Modal visible title={creationTitle} className="scene-settings-modal"
    style={{ width: 760, maxWidth: "calc(100vw - 32px)" }} onCancel={closeSettings} closable={!locked} maskClosable={false} escToExit={!locked}
    footer={<Space><Button disabled={locked} onClick={closeSettings}>关闭</Button>{saveButton}</Space>}>
    {form}
  </Modal>;
}
