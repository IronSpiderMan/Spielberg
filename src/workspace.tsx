import { ReferenceAnnotationModal } from "./components/ReferenceAnnotationModal";
import { ConfirmPopover, confirmAction } from "./components/ConfirmAction";
import { GenerationSelector } from "./components/generation/GenerationSelector";
import { ImageModelFields, VideoModelFields } from "./components/generation/ModelGenerationFields";
import { channelsFor, generationChoice, modelImageSize, modelRatio, selectionPayload, useGenerationSelection, validateGeneration, type GenerationSelection } from "./generation-channels";
import { RoleAudioReferences } from "./components/RoleAudioReferences";
import { RevealFileButton } from "./components/RevealFileButton";
import AssetRelationships from "./AssetRelationships";
import AssetThumbnail from "./AssetThumbnail";
import { ASSET_CATEGORIES, assetCategoryLabel, supportsAudioReferences, type AssetCategory } from "./asset-categories";
import { PreviewVideo, VideoPreviewModal } from "./components/VideoPreviewModal";
import { sceneVideoPrompt } from "./core";
import { ClipFramePicker } from "./components/ClipFramePicker";
import { ClipReferenceImagePicker } from "./components/generation/ClipReferenceImagePicker";
import { ReferenceMediaPicker } from "./components/generation/ReferenceMediaPicker";
import { buildVideoRequest } from "./generation-request";
import { clipDefaultFields, sceneGenerationOptions, sceneVideos, sharedClipReferences } from "./scene-generation";
import { RoleImagePicker } from "./components/RoleImagePicker";
import { ImagePreviewModal, PreviewImage } from "./components/ImagePreviewModal";
import { usePromptOptimization } from "./hooks/usePromptOptimization";
import { supportedPastedImages, useImageUpload } from "./hooks/useImageUpload";
import { AssetImagePicker } from "./components/AssetImagePicker";
import "./role-editor.css";
import { ClipVideoPicker } from "./components/SceneVideoPicker";
import { MediaSizeFields, VideoDurationField } from "./components/generation/GenerationFields";
import React,{ lazy,useCallback,useEffect,useRef,useState } from "react";

import {
Button,
Card,
Checkbox,
Drawer,
Dropdown,
Empty,
Form,
Input,
Message,
Menu,
Modal,
Pagination,
Select,
Space,
Switch,
Tag,
Tabs
} from "@arco-design/web-react";
import { open,save as saveDialog } from "./platform";
import {
ArrowDown,
ArrowLeft,
ArrowUp,
GitBranch,
GitMerge,
Maximize2,
Minimize2,
MoreHorizontal,
Search,
ChevronDown,
ChevronRight,
Clock3,
Pencil,
Download,
Film,
ImagePlus,
Play,
Plus,
Save,
SlidersHorizontal,
Sparkles,
RectangleHorizontal,
Trash2,
Upload,
Users,
WandSparkles,
ZoomIn
} from "lucide-react";


import { api,normalizeGenerationSize,Episode,FrameKey,GenerationOptions,imageUrl,Media,ModelSettings,post,Project,Asset,Clip,Scene,PlaybackUnit,GenerationPreview,Snapshot } from "./core";
import { confirmDiscard,useEditGuard } from "./edit-guard";
import { resolvePrompt, resolveH3Prompt } from "./resolve-prompt";
import { type Storyboard } from "./StoryboardEditor";
import { GenerationPreviewPanel, SceneSettings } from "./SceneSettings";
import { SceneMergeDialog } from "./SceneMergeDialog";
import ScreenplayManager, { type ScreenplayEditorHandle } from "./ScreenplayManager";
import { PromptInput } from "./PromptInput";
import { findMentions, promptMentions, syncMentionReferences } from "./prompt-mentions";
import { EmptyState } from "./ui";
import { STYLE_PRESETS } from "./prompt-presets";
import { PROMPT_TEMPLATES } from "./prompt-templates";
import "./prompts.css";
const SequencePreview=lazy(()=>import("./creation").then(m=>({default:m.SequencePreview})));
const ImageStudio=lazy(()=>import("./creation").then(m=>({default:m.ImageStudio})));

function videoRequest(scene: Clip, settings: ModelSettings, parent?: Scene) {
  if(scene.creation_mode === "canvas") throw new Error(`${scene.title}：请进入画布，使用视频节点生成；已有片段视频可直接合并`);
  const options = sceneGenerationOptions(scene, parent);
  const mode = options.video_mode;
  const choice=generationChoice(settings,"video",options,mode === "i2v"?"ref2v":mode);
  const request=buildVideoRequest({mode,prompt:sceneVideoPrompt(scene),label:scene.title,clipId:scene.id,
    duration:options.duration,ratio:modelRatio(choice,options.aspect_ratio),size:options.size,firstId:scene.first_media_id,lastId:scene.last_media_id,
    referenceIds:options.reference_media_ids??(scene.reference_media_id?[scene.reference_media_id]:[]),
    referenceVideoIds:options.reference_video_media_ids,referenceAudioIds:options.reference_audio_media_ids});
  const shared = sharedClipReferences(parent, options);
  validateGeneration(choice, mode === "i2v" ? "ref2v" : mode, {
    images: mode === "i2v" ? new Set([...request.image_media_ids, ...shared.images]).size : 0,
    videos: mode === "i2v" ? new Set([...(options.reference_video_media_ids || []), ...shared.videos]).size : 0,
    audios: mode === "i2v" ? new Set([...(options.reference_audio_media_ids || []), ...shared.audios]).size : 0,
    last: !!request.last_media_id,
    duration: options.duration,
  });
  return { ...request, ...selectionPayload(choice),
    inherit_shared_prompt: options.inherit_shared_prompt,
    exclude_shared_reference_media_ids: options.exclude_shared_reference_media_ids,
    exclude_shared_reference_video_media_ids: options.exclude_shared_reference_video_media_ids,
    exclude_shared_reference_audio_media_ids: options.exclude_shared_reference_audio_media_ids,
    ...(choice?.capabilities.size_mode === "resolution" ? { resolution: options.resolution || choice.channel.resolution || "720P" } : {}),
    ...(choice?.capabilities.audio ? { audio: options.audio ?? true } : {}) };
}
const selectPlaybackVideo = (projectId: string, unit: PlaybackUnit, mediaId: number) => post(
  unit.kind === "scene" ? "/scenes/select-video" : "/clips/select-video",
  { project_id: projectId, [unit.kind === "scene" ? "scene_id" : "clip_id"]: unit.id, media_id: mediaId },
);
export function Studio({
  data,
  reload,
  changePage,
  editClip,
}: {
  data: Snapshot;
  reload: () => void;
  changePage: (v: string) => void;
  editClip: (scene: Clip) => void;
}) {
  const [episodeId, setEpisodeId] = useState<number | undefined>(
    data.episodes[0]?.id,
  );
  const episode =
    data.episodes.find((e) => e.id === episodeId) || data.episodes[0];
  const [editing, setEditing] = useState<Episode | null>(null),
    [merged, setMerged] = useState<Media | null>(null),
    [merging, setMerging] = useState(false),
    [saving, setSaving] = useState(false);
  const units = episode?.playback_units || [];
  const ready = units.filter(unit => unit.video_media_id).length;
  const [initialSceneId, setInitialSceneId] = useState<number>();
  const signature = JSON.stringify([
    episode?.id,
    units.map(unit => [unit.kind, unit.id, unit.video_media_id]),
  ]);
  useEffect(() => setMerged(null), [signature]);
  const move = async (index: number, offset: number) => {
    if (!episode) return;
    const current = units[index], target = units[index + offset];
    const currentParent = current.scene_id, targetParent = target.scene_id;
    const movingScene = currentParent !== targetParent;
    const ids = movingScene ? episode.scenes.map(scene => scene.id) : episode.clips.map(clip => clip.id);
    const from = ids.indexOf(movingScene ? currentParent : current.id);
    const to = ids.indexOf(movingScene ? targetParent : target.id);
    if (from === -1 || to === -1) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    setSaving(true);
    try {
      await post(movingScene ? "/scenes/reorder" : "/clips/reorder", {
        project_id: data.project.id,
        episode_id: episode.id,
        [movingScene ? "scene_ids" : "clip_ids"]: ids,
      });
      await reload();
    } catch (e) {
      Message.error(String(e));
    } finally {
      setSaving(false);
    }
  };
  const select = async (unit: PlaybackUnit, id: number) => {
    setSaving(true);
    try {
      await selectPlaybackVideo(data.project.id, unit, id);
      await reload();
    } catch (e) {
      Message.error(String(e));
    } finally {
      setSaving(false);
    }
  };
  const merge = async () => {
    setMerging(true);
    try {
      setMerged(
        await post<Media>("/episodes/merge", {
          project_id: data.project.id,
          episode_id: episode?.id,
        }),
      );
      await reload();
      Message.success("剧集已合并并保存到素材库");
    } catch (e) {
      Message.error(String(e));
    } finally {
      setMerging(false);
    }
  };
  if (editing) return <EpisodeEditor episode={editing} initialSceneId={initialSceneId} project={data.project} data={data} editClip={editClip} onClose={() => { setEditing(null); setInitialSceneId(undefined); }} reload={reload}/>;
  return (
    <section className="studio">
      <div className="cut-toolbar">
        <Select
          disabled={merging}
          aria-label="选择剧集"
          value={episode?.id}
          onChange={setEpisodeId}
          placeholder="选择剧集"
          style={{ width: 260 }}
        >
          {data.episodes.map((ep) => (
            <Select.Option key={ep.id} value={ep.id}>
              {ep.title}
            </Select.Option>
          ))}
        </Select>
        <Button
          disabled={!episode || merging}
          onClick={() => setEditing(episode)}
        >
          编辑剧集
        </Button>
        <span>
          {ready} / {units.length} 项已选视频
        </span>
        <Button
          type="primary"
          icon={<Play size={16} />}
          loading={merging}
          disabled={!units.length || ready !== units.length || saving}
          onClick={merge}
        >
          合并并播放
        </Button>
      </div>
      <div className="cut-workspace">
      <div className="cut-preview">
        {merged ? (
          <PreviewVideo
            key={merged.id}
            media={merged}
            projectId={data.project.id}
            autoPlay
            onError={() => Message.error("无法播放合并视频，请检查本地文件")}
          />
        ) : (
          <SequencePreview units={units} />
        )}
      </div>
      <div className="cut-arrangement">
      <div className="timeline-head">
        <div>
          <h2>剧集编排</h2>
          <span>按播放顺序排列</span>
        </div>
        {merged && (
          <Button
            icon={<Download size={16} />}
            onClick={async () => {
              try {
                const path = await saveDialog({
                  defaultPath: merged.name,
                  filters: [{ name: "视频", extensions: ["mp4"] }],
                });
                if (path)
                  await post("/media/export", {
                    project_id: data.project.id,
                    media_id: merged.id,
                    destination_path: path,
                  });
              } catch (e) {
                Message.error(String(e));
              }
            }}
          >
            导出视频
          </Button>
        )}
      </div>
      <div className="cut-list">
        {units.map((unit, index) => {
          const clip = unit.kind === "clip" ? episode?.clips.find(item => item.id === unit.id) : undefined;
          const scene = episode?.scenes.find(item => item.id === unit.scene_id);
          return <div className="cut-row" key={`${unit.kind}-${unit.id}`}>
            <div className="cut-order">
              <b>{String(index + 1).padStart(2, "0")}</b>
              <Space>
                <Button aria-label={`上移${unit.title}`} size="mini" disabled={!index || saving || merging} onClick={() => move(index, -1)}>↑</Button>
                <Button aria-label={`下移${unit.title}`} size="mini" disabled={index === units.length - 1 || saving || merging} onClick={() => move(index, 1)}>↓</Button>
              </Space>
            </div>
            {clip ? <ClipThumb scene={clip} media={data.media} /> : unit.video_media ? <VideoAsset video={unit.video_media} projectId={data.project.id} thumbnail /> : <div className="cut-thumb"><Film size={24}/></div>}
            <div className="cut-copy">
              <b>{unit.title}</b>
              <p>{clip?.description || scene?.description || "尚未填写描述"}</p>
              {unit.kind === "scene" && <Tag>一镜到底</Tag>}
              <Button type="text" size="mini" disabled={merging} onClick={() => {
                if (clip) editClip(clip);
                else if (episode && scene) { setInitialSceneId(scene.id); setEditing(episode); }
              }}>
                编辑{unit.kind === "scene" ? "场景" : "片段"}
              </Button>
            </div>
            <div className="cut-version">
              <Select aria-label={`${unit.title}的视频版本`} disabled={saving || merging} value={unit.video_media_id || undefined}
                placeholder="选择视频版本" onChange={id => select(unit, id)}>
                {sceneVideos(unit).map((video, i) => <Select.Option key={video.id} value={video.id}>视频 {i + 1} · {video.name}</Select.Option>)}
              </Select>
              {unit.video_media && clip && <VideoAsset video={unit.video_media} scene={clip} projectId={data.project.id} reload={reload} thumbnail />}
            </div>
          </div>;
        })}
        {!units.length && <Empty description="请在剧集页面添加场景" />}
      </div>
      </div>
      </div>
      <EpisodeEditor
        episode={editing}
        project={data.project}
        data={data}
        editClip={editClip}
        onClose={() => setEditing(null)}
        reload={reload}
      />
    </section>
  );
}
function EpisodeCover({episode}: {episode: {cover_media?: Media; playback_units?: PlaybackUnit[]; clips?: Clip[]}}) {
  const scene = episode.playback_units?.[0] || episode.clips?.[0];
  const video = scene && (sceneVideos(scene).find(video => video.id === scene.video_media_id) || sceneVideos(scene)[0]);
  return <div className="episode-cover">{episode.cover_media ? <img src={imageUrl(episode.cover_media)} alt="剧集封面"/> : video ? <video src={`${imageUrl(video)}#t=0.001`} muted preload="auto" aria-label="默认剧集封面"/> : <Film size={28}/>}</div>;
}
function VideoAsset({video, scene, projectId, reload, thumbnail=false}: {video:Media;scene?:Clip;projectId:string;reload?:()=>void;thumbnail?:boolean}) {
  const [preview,setPreview] = useState(false);
  const [deleting,setDeleting] = useState(false);
  const [selecting,setSelecting] = useState(false);
  const inlinePlayer = useRef<HTMLVideoElement>(null);
  const [previewTime,setPreviewTime] = useState(0);
  const openPreview = () => {setPreviewTime(inlinePlayer.current?.currentTime || 0);inlinePlayer.current?.pause();setPreview(true);};
  const download = async () => {
    try {
      const path = await saveDialog({defaultPath:video.name,filters:[{name:"视频",extensions:[video.path.split('.').pop() || "mp4"]}]});
      if(path) {await post("/media/export",{project_id:projectId,media_id:video.id,destination_path:path});Message.success("视频已保存");}
    } catch(e){Message.error(String(e));}
  };
  return <div className="video-asset">
    {thumbnail ? <button type="button" className="video-asset-thumbnail" aria-label={`预览视频 ${video.name}`} onClick={openPreview}>
      <AssetThumbnail key={`${projectId}:${video.id}:${video.path}`} media={video} projectId={projectId}/>
      <span className="video-asset-thumbnail-play" aria-hidden="true"><Play size={24} fill="currentColor"/></span>
    </button> : <video ref={inlinePlayer} src={imageUrl(video)} controls muted playsInline preload="metadata" onLoadedData={event=>{const el=event.currentTarget;if(el.duration>0)el.currentTime=Math.min(.1,el.duration/2);}} onDoubleClick={event=>{event.preventDefault();openPreview();}}/>}
    <Space wrap>
      <Button size="mini" icon={<ZoomIn size={14}/>} onClick={openPreview}>放大预览</Button>
      <Button size="mini" icon={<Download size={14}/>} onClick={download}>下载</Button>
      {scene && reload && <Button size="mini" type={scene.video_media_id === video.id ? "secondary" : "primary"}
        disabled={deleting || selecting || scene.video_media_id === video.id} loading={selecting}
        onClick={async()=>{
          if (selecting || deleting || scene.video_media_id === video.id) return;
          setSelecting(true);
          try {
            await post("/clips/select-video",{project_id:projectId,clip_id:scene.id,media_id:video.id});
            await reload();
            Message.success("已设为主视频");
          } catch(e){Message.error(String(e));} finally {setSelecting(false);}
        }}>{scene.video_media_id === video.id ? "主视频" : "设为主视频"}</Button>}
      {scene && <ConfirmPopover title="移除这个视频版本？" content={scene.video_media_id === video.id ? "将从片段中移除当前主视频，并选用剩余版本（如有）。素材库中的视频文件会保留。" : "将从片段中移除此视频版本，素材库中的视频文件会保留。"} okText="移除版本" disabled={selecting || deleting} onOk={async()=>{
        setDeleting(true);
        try {await post("/clips/delete-video",{project_id:projectId,clip_id:scene.id,media_id:video.id});await reload?.();Message.success("视频版本已移除");} catch(e){Message.error(String(e));throw e;} finally {setDeleting(false);}
      }}><Button size="mini" status="danger" disabled={selecting || deleting} loading={deleting} icon={<Trash2 size={14}/>}>删除</Button></ConfirmPopover>}
    </Space>
    <VideoPreviewModal media={preview?video:null} projectId={projectId} initialTime={previewTime} onClose={()=>setPreview(false)} />
  </div>;
}
type BackgroundJob = {id:number;project_id:string;project_name:string;clip_id?:number;operation:string;status:string;prompt:string;created_at:string;updated_at:string;error?:string;result?:Media};
type JobCursor = Pick<BackgroundJob,"created_at"|"project_id"|"id">;
type JobPage = {items:BackgroundJob[];next_cursor:JobCursor|null;has_more:boolean};
function TaskText({text,error=false}:{text:string;error?:boolean}) {
  const [expanded,setExpanded]=useState(false);
  const [overflowing,setOverflowing]=useState(false);
  const content=useRef<HTMLParagraphElement>(null);
  const id=React.useId();
  useEffect(()=>{
    const element=content.current;
    if(!element)return;
    const measure=()=>setOverflowing(element.scrollHeight>parseFloat(getComputedStyle(element).lineHeight)*6+1);
    const observer=new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return ()=>observer.disconnect();
  },[text]);
  return <div className="task-text">
    <p ref={content} id={id} className={`task-text-content${expanded?" is-expanded":""}${error?" generation-error":""}`} tabIndex={expanded?0:undefined}>{text}</p>
    {overflowing&&<Button type="text" size="mini" aria-expanded={expanded} aria-controls={id} onClick={()=>setExpanded(value=>!value)}>{expanded?"收起":"展开全文"}</Button>}
  </div>;
}
export function Tasks({projectId}:{projectId:string}) {
  const [jobs,setJobs] = useState<BackgroundJob[]>([]);
  const [filter,setFilter] = useState("all");
  const [error,setError] = useState("");
  const [loading,setLoading] = useState(true);
  const [hasMore,setHasMore] = useState(false);
  const loadMore = useRef<()=>void>(()=>{});
  useEffect(()=>{
    let disposed=false, busy=false, initialized=false;
    let cursor:JobCursor|null=null;
    let timer:ReturnType<typeof setTimeout>;
    setJobs([]);setError("");setHasMore(false);setLoading(true);
    const fetchPage=async(more=false)=>{
      if(disposed||busy)return;
      if(document.visibilityState==="hidden"&&!more){timer=setTimeout(()=>void fetchPage(),4000);return;}
      busy=true;
      clearTimeout(timer);
      if(more||!initialized)setLoading(true);
      const paginated=more||!cursor;
      try {
        const page=await post<JobPage>("/tasks",{project_id:projectId,status:filter,limit:20,...(cursor ? more?{before:cursor}:{through:cursor}: {})});
        if(disposed)return;
        setJobs(previous=>more?[...previous,...page.items]:page.items);
        // Refresh preserves the historical boundary, even if filtering removes its job.
        if(paginated){cursor=page.next_cursor||cursor;}
        setHasMore(page.has_more);
        if(!cursor)cursor=page.next_cursor;
        initialized=true;setError("");
        loadMore.current=()=>void fetchPage(true);
      } catch(e){if(!disposed){setError(String(e));loadMore.current=()=>void fetchPage(more);}}
      finally {
        busy=false;
        if(!disposed){setLoading(false);timer=setTimeout(()=>void fetchPage(),2000);}
      }
    };
    loadMore.current=()=>void fetchPage(true);
    void fetchPage();
    return ()=>{disposed=true;clearTimeout(timer);};
  },[filter,projectId]);
  const labels:Record<string,string>={running:"执行中",completed:"已完成",failed:"失败",interrupted:"已中断"};
  return <section><div className="section-title page-actions">
    <div className="page-intro"><h1>后台任务</h1><p>在这里追踪生成进度，查看结果与运行记录。</p></div>
    <Select aria-label="任务状态" value={filter} onChange={setFilter} style={{width:160}}><Select.Option value="all">全部状态</Select.Option>{Object.entries(labels).map(([k,v])=><Select.Option key={k} value={k}>{v}</Select.Option>)}</Select></div>
    {error && <div className="task-load-error" role="alert"><b>任务记录加载失败</b><p>{error}</p><span>已有记录会保留，可点击下方「重试」重新加载。</span></div>}
    <div className="task-list" aria-busy={loading}>{jobs.map(job=><Card key={`${job.project_id}-${job.id}`} className="task-card">
      <div className="task-head">
        <span className={`task-state task-${job.status}`} aria-hidden="true" />
        <b>{job.project_name}</b>
        <Tag>{job.operation.includes("image")?"图片生成":job.operation.includes("video")?"视频生成":job.operation.includes("asr")?"语音识别":job.operation.includes("tts")?"语音合成":"剧集合并"}</Tag>
        <Tag className="task-status" color={job.status==="failed"?"red":job.status==="completed"?"green":"blue"}>{labels[job.status]||job.status}</Tag>
        <small className="task-time">{new Date(Number(job.created_at)*1000).toLocaleString()}</small>
      </div>
      <TaskText text={job.prompt}/>
      <small className="task-id">任务 #{job.id}</small>
      {job.error && <TaskText text={job.error} error/>}
      {job.result?.kind==="video" && <VideoAsset video={job.result} projectId={job.project_id}/>}
      {job.result?.kind==="audio" && <audio controls preload="none" aria-label="试听生成语音" src={imageUrl(job.result)}/>}
      {job.result?.kind==="image" && <PreviewImage className="task-image" media={job.result} alt="生成结果"/>}
    </Card>)}</div>
    <div style={{textAlign:"center",padding:24}}>
      {(hasMore||loading||error)&&<Button loading={loading} onClick={()=>loadMore.current()}>{error?"重试":hasMore?"加载更多":"加载中"}</Button>}
      {!hasMore&&!loading&&jobs.length>0&&<span className="helper">已加载全部任务</span>}
    </div>
    {!jobs.length&&!loading&&!error&&<EmptyState
      title={filter==="all"?"暂无后台任务":"暂无符合此状态的任务"}
      description={filter==="all"?"生成图片、视频、语音或合并剧集后，进度和结果会按时间出现在这里。":"切换到「全部状态」查看其他运行记录。"}
      action={filter!=="all"?<Button onClick={()=>setFilter("all")}>查看全部任务</Button>:undefined}
    />}</section>;
}
function clipThumbnail(clip: Clip, media: Media[]) {
  const image = (id?: number | null) => id == null ? undefined : media.find(item => item.id === id && item.kind === "image");
  return clip.first_media || image(clip.first_media_id) || clip.last_media || image(clip.last_media_id)
    || clip.generation_options?.reference_media_ids?.map(image).find(Boolean) || clip.reference_media || image(clip.reference_media_id);
}
function sceneThumbnail(scene: Scene, media: Media[]) {
  if (scene.video_media) return scene.video_media;
  for (const clip of scene.clips) {
    const thumbnail = clipThumbnail(clip, media);
    if (thumbnail) return thumbnail;
  }
  const reference = scene.reference_media_ids?.[0];
  return (reference === undefined ? undefined : media.find(item => item.id === reference && item.kind === "image"))
    || scene.clips.find(clip => clip.video_media)?.video_media;
}
function ClipThumb({ scene, media, onPreview }: { scene: Clip; media: Media[]; onPreview?: () => void }) {
  const thumbnail = clipThumbnail(scene, media);
  const content = <>
    {thumbnail ? (
      <img src={imageUrl(thumbnail)} alt="" />
    ) : (
      <Film size={20} />
    )}
    <span>{scene.last_media && "⇢"}</span>
    {onPreview && <span className="scene-thumb-play"><Play size={18} fill="currentColor" /></span>}
  </>;
  if (onPreview) return (
    <button className="scene-thumb scene-thumb-button" type="button" onClick={onPreview} aria-label={`预览${scene.title}的视频`}>
      {content}
    </button>
  );
  return (
    <div className="scene-thumb">
      {content}
    </div>
  );
}

export function Episodes({
  initialEpisodeId,
  initialSceneId,
  initialFocusedSceneId,
  initialView,
  data,
  reload,
  editClip,
}: {
  data: Snapshot;
  reload: () => void;
  editClip: (scene: Clip, isNew: boolean, episodeId: number) => void;
  initialEpisodeId?:number;
  initialSceneId?: number;
  initialFocusedSceneId?: number;
  initialView?: "markdown" | "scenes";
}) {

  const [episode, setEpisode] = useState<{
    id: number;
    title: string;
    description: string;
    cover_media?: Media;
    clips?: Clip[];
  } | null>(() => data.episodes.find(item => item.id === initialEpisodeId) || null);
  useEffect(()=>{if(initialEpisodeId)setEpisode(data.episodes.find(e=>e.id===initialEpisodeId)||null);},[initialEpisodeId]);
  const [batch, setBatch] = useState<Episode | null>(null);
  const currentBatch = batch && (data.episodes.find(episode => episode.id === batch.id) || batch);
  const [count, setCount] = useState(1);
  const [batchMode, setBatchMode] = useState("generate");
  const [batchResult, setBatchResult] = useState<Media | null>(null);
  const [progress, setProgress] = useState("");
  const [running, setRunning] = useState(false);
  const [episodeQuery,setEpisodeQuery]=useState("");
  const [episodePage,setEpisodePage]=useState(1);
  const episodeLibraryRef=useRef<HTMLElement>(null);
  const filteredEpisodes=data.episodes.filter(ep=>`${ep.title} ${ep.description}`.toLocaleLowerCase().includes(episodeQuery.trim().toLocaleLowerCase()));
  const episodePageCount=Math.max(1,Math.ceil(filteredEpisodes.length/24));
  const currentEpisodePage=Math.min(episodePage,episodePageCount);
  const pagedEpisodes=filteredEpisodes.slice((currentEpisodePage-1)*24,currentEpisodePage*24);
  useEffect(()=>{setEpisodePage(1);setEpisodeQuery("");},[data.project.id]);
  useEffect(()=>{setEpisodePage(page=>Math.min(page,episodePageCount));},[episodePageCount]);
  useEffect(()=>{episodeLibraryRef.current?.querySelector(".episode-list")?.scrollTo({top:0});},[currentEpisodePage,episodeQuery]);
  const [reorderingEpisodes,setReorderingEpisodes]=useState(false);
  const moveEpisode=async(index:number,offset:number)=>{const ids=data.episodes.map(item=>item.id);[ids[index],ids[index+offset]]=[ids[index+offset],ids[index]];setReorderingEpisodes(true);try{await post("/episodes/reorder",{project_id:data.project.id,episode_ids:ids});reload();}catch(e){Message.error(String(e));}finally{setReorderingEpisodes(false);}};
  const [failures, setFailures] = useState<string[]>([]);

  const generateBatch = async () => {
    if (!currentBatch) return;
    if (batchMode === "existing") {
      setRunning(true); setBatchResult(null);
      try {setBatchResult(await post<Media>("/episodes/merge", {project_id: data.project.id, episode_id: currentBatch.id})); await reload(); Message.success("合并完成，已保存到素材库");}
      catch(e) {Message.error(String(e));} finally {setRunning(false);} return;
    }
    let requests: { path: string; request: object; title: string }[];
    try {
      requests = currentBatch.playback_units.map(unit => {
        if (unit.kind === "scene") return { path: "/generations/scene-video", request: { scene_id: unit.id }, title: unit.title };
        const clip = currentBatch.clips.find(item => item.id === unit.id);
        if (!clip) throw new Error(`找不到片段 ${unit.title}`);
        return { path: "/generations/video", request: videoRequest(clip, data.settings, currentBatch.scenes.find(scene => scene.id === clip.scene_id)), title: unit.title };
      });
    } catch (e) {
      Message.error(String(e));
      return;
    }
    setRunning(true);
    setFailures([]);
    const errors: string[] = [];
    let done = 0;
    try {
      for (const { path, request, title } of requests) {
        for (let i = 0; i < count; i++) {
          setProgress(`正在生成 ${done + 1} / ${requests.length * count}`);
          try {
            await post(path, {
              project_id: data.project.id,
              ...request,
            });
          } catch (e) {
            errors.push(
              `${title}，视频 ${i + 1}：${String(e)}`,
            );
          }
          done++;
        }
      }
      await reload();
      setFailures(errors);
      setProgress(
        `已完成：${done - errors.length} 个成功，${errors.length} 个失败`,
      );
    } finally {
      setRunning(false);
    }
  };
  const makeEpisode = async () => {
    const x = await post("/episodes", {
      project_id: data.project.id,
      title: "未命名剧集",
      description: "",
    });
    await reload();
    setEpisode(x as typeof episode);
  };
  if (episode) return <EpisodeEditor episode={episode} initialView={episode.id === initialEpisodeId ? initialView : undefined} initialSceneId={episode.id === initialEpisodeId ? initialSceneId : undefined} initialFocusedSceneId={episode.id === initialEpisodeId ? initialFocusedSceneId : undefined} project={data.project} data={data} editClip={(scene, isNew = false) => editClip(scene, isNew, episode.id)} onClose={() => setEpisode(null)} reload={reload}/>;
  return (
    <section ref={episodeLibraryRef} className="episode-library" aria-label="剧集管理">
      <div className="section-title page-actions">
        <div className="page-intro"><h1>剧集管理</h1><p>管理剧集、片段与生成素材。</p></div>
        <Button
          type="primary"
          icon={<Plus size={16} />}
          onClick={() => makeEpisode().catch((e) => Message.error(String(e)))}
        >
          新建剧集
        </Button>
      </div>
      <div className="asset-toolbar episode-toolbar">
        <Input.Search aria-label="搜索剧集" placeholder="搜索剧集名称或简介" allowClear value={episodeQuery} onChange={value=>{setEpisodeQuery(value);setEpisodePage(1);}} />
        {episodeQuery&&<Button type="text" size="small" onClick={()=>{setEpisodeQuery("");setEpisodePage(1);}}>清除搜索</Button>}
        <span className="helper asset-total" role="status">共 <b>{filteredEpisodes.length}</b> 集</span>
      </div>
      <div className="episode-list">
        {filteredEpisodes.length ? (
          pagedEpisodes.map(ep => {
            const n=data.episodes.findIndex(item=>item.id===ep.id);
            return (
            <Card key={ep.id} className="episode-card">
              <div className="episode-top">
                <EpisodeCover episode={ep} />
                <div className="episode-number">
                  EP {String(n + 1).padStart(2, "0")}
                </div>
                <div className="episode-info episode-edit-trigger" role="button" tabIndex={0} aria-label={`编辑剧集：${ep.title}`} onClick={() => setEpisode(ep)} onKeyDown={event => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setEpisode(ep);
                  }
                }}>
                  <h3>{ep.title}</h3>
                  <p>{ep.description || "点击编辑剧集简介"}</p>
                </div>
                <Space size={2}><Button size="mini" aria-label="上移剧集" title="上移剧集" disabled={reorderingEpisodes||n===0} icon={<ArrowUp size={14}/>} onClick={()=>void moveEpisode(n,-1)}/><Button size="mini" aria-label="下移剧集" title="下移剧集" disabled={reorderingEpisodes||n===data.episodes.length-1} icon={<ArrowDown size={14}/>} onClick={()=>void moveEpisode(n,1)}/></Space>
                <span className="subtle">{ep.scenes.length} 个场景 · {ep.clips.length} 个片段</span>
                <Button
                  type="primary"
                  disabled={!ep.clips.length || running}
                  icon={<Sparkles size={14} />}
                  onClick={() => {
                    setBatch(ep); setBatchMode("generate"); setBatchResult(null);
                    setProgress("");
                    setFailures([]);
                  }}
                >
                  生成 / 合并
                </Button>
                <Button type="text" onClick={() => setEpisode(ep)}>
                  编辑
                </Button>
                <ConfirmPopover
                  title="删除这集？"
                  content={`将删除「${ep.title}」及其全部剧本、场景和片段，素材库中的文件会保留。删除后无法撤销。`}
                  okText="删除剧集"
                  onOk={() =>
                    post("/episodes/delete", {
                      project_id: data.project.id,
                      id: ep.id,
                    }).then(reload).catch(error => { Message.error(String(error)); throw error; })
                  }
                >
                  <Button
                    type="text"
                    status="danger"
                    aria-label={`删除剧集 ${ep.title}`}
                    icon={<Trash2 size={15} />}
                  />
                </ConfirmPopover>
              </div>

            </Card>
          );})
        ) : (
          <EmptyState
            title={episodeQuery?"没有符合条件的剧集":"还没有剧集"}
            description={episodeQuery?"调整搜索词，再试一次。":"创建第一个剧集，把故事排成连续的片段与镜头。"}
            action={episodeQuery?<Button onClick={()=>{setEpisodeQuery("");setEpisodePage(1);}}>清除搜索</Button>:<Button type="primary" icon={<Plus size={16} />} onClick={() => void makeEpisode().catch((e) => Message.error(String(e)))}>新建剧集</Button>}
          />
        )}
      </div>
      {filteredEpisodes.length>0&&<div className="asset-library-footer">
        <span className="asset-page-announcement" role="status" aria-live="polite">第 {currentEpisodePage} 页，共 {episodePageCount} 页，当前 {pagedEpisodes.length} 集</span>
        <Pagination className="asset-pagination" current={currentEpisodePage} pageSize={24} total={filteredEpisodes.length} onChange={setEpisodePage} showTotal />
      </div>}

      <Modal
        className="batch-generation-modal"
        title={`生成剧集 · ${batch?.title || ""}`}
        visible={!!batch}
        onCancel={() => {
          setBatch(null);
        }}
        maskClosable
        closable
        footer={
          <Space>
            <Button onClick={() => setBatch(null)}>
              关闭
            </Button>
            <Button type="primary" loading={running} disabled={!currentBatch?.playback_units.length || (batchMode === "existing" && !currentBatch.playback_units.every(unit => unit.video_media_id))} onClick={generateBatch}>
              {batchMode === "existing" ? "合并已有视频" : `生成 ${count * (currentBatch?.playback_units.length || 0)} 个视频`}
            </Button>
          </Space>
        }
      >
        <p className="batch-generation-help">
          使用已保存的场景共享设定、片段描述和生成参数。选择一镜到底的场景将生成一条完整视频。
        </p>
        <Form layout="vertical" className="batch-generation-form">
          <Form.Item label="生成方式">
            <Select value={batchMode} onChange={setBatchMode} disabled={running} options={[{label:"生成新视频",value:"generate"},{label:"合并已有视频",value:"existing"}]} />
          </Form.Item>
          {batchMode === "existing" && <div className="concat-pickers">{currentBatch?.playback_units.map(unit =>
            <Form.Item key={`${unit.kind}-${unit.id}`} label={unit.title}>
              <Select disabled={running} value={unit.video_media_id || undefined} placeholder="选择视频版本"
                options={sceneVideos(unit).map((video, index) => ({label:`视频 ${index+1} · ${video.name}`,value:video.id}))}
                onChange={async id => { try { await selectPlaybackVideo(data.project.id, unit, id); setBatchResult(null); await reload(); } catch (e) { Message.error(String(e)); } }} />
            </Form.Item>
          )}</div>}
          <Form.Item hidden={batchMode === "existing"} label="每项生成数量">
            <Select disabled={running} value={count} onChange={setCount}>
              {[1, 2, 3, 4, 5, 6, 8, 10].map((n) => (
                <Select.Option key={n} value={n}>
                  {n} 个视频
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
        </Form>
        {batchResult && <PreviewVideo media={batchResult} projectId={data.project.id}/>}
        {progress && <p role="status">{progress}</p>}
        {failures.map((error, i) => (
          <p className="generation-error" key={i}>
            {error}
          </p>
        ))}
      </Modal>

    </section>
  );
}
const reorderingEpisodes = new Set<string>();
type EpisodeItemAction = { key: string; label: string; danger?: boolean; run: () => void };

function EpisodeOrderControls({episode, id, kind, project, reload, actions, disabled = false}: {
  episode: Episode; id: number; kind: "scene" | "clip"; project: Project; reload: () => void;
  actions?: EpisodeItemAction[]; disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const items = kind === "scene" ? episode.scenes : episode.scenes.find(scene => scene.clips.some(clip => clip.id === id))?.clips || [];
  const index = items.findIndex(item => item.id === id);
  const last = items.length - 1;
  const label = kind === "scene" ? "场景" : "片段";
  const move = async (target: number, toEndpoint = false) => {
    const key = `${project.id}/${episode.id}`;
    if (reorderingEpisodes.has(key) || disabled || index < 0 || target === index || target < 0 || target > last) return;
    const ids = items.map(item => item.id);
    if (toEndpoint) ids.splice(target, 0, ids.splice(index, 1)[0]);
    else [ids[index], ids[target]] = [ids[target], ids[index]];
    const moving = new Set(ids);
    let next = 0;
    const orderedIds = kind === "scene" ? ids : episode.clips.map(clip => moving.has(clip.id) ? ids[next++] : clip.id);
    reorderingEpisodes.add(key);
    setBusy(true);
    try {
      await post(kind === "scene" ? "/scenes/reorder" : "/clips/reorder", {
        project_id: project.id, episode_id: episode.id, [kind === "scene" ? "scene_ids" : "clip_ids"]: orderedIds,
      });
      await reload();
    } catch (error) {Message.error(String(error));}
    finally {reorderingEpisodes.delete(key); setBusy(false);}
  };
  if (index < 0) return null;
  if (actions) {
    const orderActions = [
      { key: "move-up", label: `上移${label}`, target: index - 1 },
      { key: "move-down", label: `下移${label}`, target: index + 1 },
      { key: "move-start", label: `将${label}移到最前方`, target: 0, endpoint: true },
      { key: "move-end", label: `将${label}移到最后方`, target: last, endpoint: true },
    ];
    const menuAction = (key: string) => {
      const ordering = orderActions.find(item => item.key === key);
      if (!ordering) {
        actions.find(item => item.key === key)?.run();
      } else if (ordering.endpoint) {
        confirmAction({title: ordering.label, content: `调整「${items[index].title}」在剧集中的顺序？`,
          okText: "确认移动", onOk: () => move(ordering.target, true)});
      } else {
        void move(ordering.target);
      }
    };
    return <Dropdown trigger="click" position="br" disabled={disabled || busy} droplist={
      <Menu onClickMenuItem={menuAction}>
        {last > 0 && <Menu.ItemGroup title="顺序">
          {orderActions.map(item => <Menu.Item key={item.key}
            disabled={item.target < 0 || item.target > last || item.target === index}>{item.label}</Menu.Item>)}
        </Menu.ItemGroup>}
        {actions.map(item => <Menu.Item key={item.key} className={item.danger ? "scene-workspace-danger-item" : undefined}>{item.label}</Menu.Item>)}
      </Menu>
    }>
      <Button size="mini" aria-label={`更多${label}操作：${items[index].title}`} title={`更多${label}操作`}
        icon={<MoreHorizontal size={18}/>} loading={busy} disabled={disabled}/>
    </Dropdown>;
  }
  if (last < 1) return null;
  return <Space size={4}>
    <Button size="mini" aria-label={`上移${label}`} title={`上移${label}`} disabled={disabled || busy || index === 0} icon={<ArrowUp size={14}/>} onClick={() => move(index - 1)}/>
    <Button size="mini" aria-label={`下移${label}`} title={`下移${label}`} disabled={disabled || busy || index === last} icon={<ArrowDown size={14}/>} onClick={() => move(index + 1)}/>
  </Space>;
}

function EpisodeEditor({
  data,
  episode,
  initialView = "scenes",
  initialSceneId,
  initialFocusedSceneId,
  project,
  onClose,
  reload,
  editClip,
}: {
  data: Snapshot;
  episode: { id: number; title: string; description: string; cover_media?: Media; clips?: Clip[]; storyboard?: Storyboard } | null;
  initialView?: "markdown" | "scenes";
  initialSceneId?: number;
  initialFocusedSceneId?: number;
  project: Project;
  onClose: () => void;
  reload: () => void;
  editClip: (scene: Clip, isNew?: boolean) => void;
}) {
  const [view, setView] = useState<"markdown" | "csv" | "details" | "scenes">(initialView);
  const scriptEditor = useRef<ScreenplayEditorHandle>(null);
  const [scriptStatus, setScriptStatus] = useState({ dirty: false, busy: false });
  const onScriptStatus = useCallback((dirty: boolean, busy: boolean) => setScriptStatus(current => current.dirty === dirty && current.busy === busy ? current : { dirty, busy }), []);
  const [baseline, setBaseline] = useState(episode);
  const [cover, setCover] = useState<Media | undefined>(episode?.cover_media);
  const uploadCover = async () => {
    const path = await open({multiple:false, filters:[{name:"图片",extensions:["png","jpg","jpeg","webp","gif","svg"]}]});
    if (typeof path === "string") setCover(await post<Media>("/media/import",{project_id:project.id,source_path:path}));
  };
  const [title, setTitle] = useState(episode?.title || "");
  const [description, setDescription] = useState(episode?.description || "");
  const [board,setBoard] = useState<Storyboard | undefined>(episode?.storyboard || undefined);
  const [generatingBoard,setGeneratingBoard] = useState(false);
  const boardEpisode=useRef(episode?.id);
  useEffect(() => {
    if(boardEpisode.current===episode?.id) return;
    boardEpisode.current=episode?.id;
    setBaseline(episode);
    setView(initialView);
    setBoard(episode?.storyboard || undefined);
    setCover(episode?.cover_media);
    setTitle(episode?.title || "");
    setDescription(episode?.description || "");
  }, [episode, initialView]);
  const [saving, setSaving] = useState(false);
  const [sceneDraft, setSceneDraft] = useState({ dirty: false, busy: false });
  const onSceneStatus = useCallback((dirty: boolean, busy: boolean) =>
    setSceneDraft(current => current.dirty === dirty && current.busy === busy ? current : { dirty, busy }), []);
  const dirty = JSON.stringify(board || null) !== JSON.stringify(baseline?.storyboard || null) || title !== (baseline?.title || "") || description !== (baseline?.description || "") || cover?.id !== baseline?.cover_media?.id || scriptStatus.dirty;
  useEditGuard(dirty || saving || generatingBoard || scriptStatus.busy || sceneDraft.dirty || sceneDraft.busy);
  useEffect(() => {
    if (!dirty && !saving && !generatingBoard && !scriptStatus.busy && !sceneDraft.dirty && !sceneDraft.busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, saving, generatingBoard, scriptStatus.busy, sceneDraft]);
  const close = () => {
    if (saving || generatingBoard || scriptStatus.busy || sceneDraft.busy) return;
    if (dirty || sceneDraft.dirty) confirmDiscard(onClose);
    else onClose();
  };
  const save = async () => {
    if (saving || generatingBoard || scriptStatus.busy || !episode) return;
    if (!title.trim()) { Message.warning("请输入剧集标题"); return; }
    setSaving(true);
    try {
      if (scriptEditor.current && !await scriptEditor.current.save()) return;
      await post("/episodes/update", {project_id: project.id, id: episode.id, cover_media_id: cover?.id || null, title: title.trim(), description, storyboard: board || null});
      await reload();
      setBaseline({ ...episode, title: title.trim(), description, cover_media: cover, storyboard: board });
      setTitle(title.trim());
      Message.success("已保存");
    } catch (error) { Message.error(String(error)); }
    finally { setSaving(false); }
  };

  const currentEpisode = data.episodes.find(ep => ep.id === episode?.id);
  const editorLocked = saving || generatingBoard || scriptStatus.busy || sceneDraft.busy;
  const openClip = (scene: Clip) => {
    if (editorLocked) return;
    if (dirty) confirmDiscard(() => editClip(scene));
    else editClip(scene);
  };
  const [inserting, setInserting] = useState<number | null>(null);
  const [copyingClip, setCopyingClip] = useState<number | null>(null);
  const copyClip = async (scene: Clip, position: "before" | "after") => {
    setCopyingClip(scene.id);
    try {
      await post("/clips/duplicate", { project_id: data.project.id, id: scene.id, position });
      await reload();
      Message.success("片段已复制");
    } catch (e) { Message.error(String(e)); }
    finally { setCopyingClip(null); }
  };
  const [clipCreation,setClipCreation]=useState<{episodeId:number; sceneId:number; anchorClipId?:number; position?:"before"|"after"}|null>(null);
  const beginClipCreation = (sceneId: number, anchorClipId?: number, position?: "before"|"after") => {
    if (!episode) return;
    setClipCreation({episodeId: episode.id, sceneId, anchorClipId, position});
    setCreationMode("default");
    setNewClipTitle(`片段 ${(currentEpisode?.scenes.find(scene => scene.id === sceneId)?.clips.length || 0) + 1}`);
  };
  const [creationMode,setCreationMode]=useState<"default"|"canvas">("default");
  const [newClipTitle,setNewClipTitle]=useState("");
  const makeClip = async () => {
    if (!clipCreation) return;
    const id = clipCreation.episodeId;
    setInserting(id);
    try {
    const x = await post<Clip>("/clips", {
      project_id: data.project.id,
      episode_id: id,
      scene_id: clipCreation.sceneId,
      title: newClipTitle.trim() || "未命名片段",
      creation_mode: creationMode,
      ...(clipCreation.anchorClipId !== undefined ? {anchor_clip_id: clipCreation.anchorClipId, position: clipCreation.position} : {}),
      description: "",
    });
    await reload();
    setClipCreation(null);
    editClip(x, true);
    } finally { setInserting(null); }
  };
  const initialFocus = initialSceneId ?? initialFocusedSceneId;
  const [editingScene, setEditingScene] = useState<"new" | "group">();
  const [focusedSceneId, setFocusedSceneId] = useState(initialFocus);
  const [sceneQuery, setSceneQuery] = useState("");
  const [sceneView, setSceneView] = useState<"grid" | "detail">(initialFocus === undefined ? "grid" : "detail");
  const [selectionMode, setSelectionMode] = useState<"clips" | "scenes">();
  const [selection, setSelection] = useState<number[]>([]);
  const [mergeOpen, setMergeOpen] = useState(false);
  const sceneGridRef = useRef<HTMLOListElement>(null);
  const sceneDetailRef = useRef<HTMLElement>(null);
  const sceneTitleRef = useRef<HTMLHeadingElement>(null);
  const selecting = selectionMode !== undefined;
  const selectingClips = selectionMode === "clips";
  const selectingScenes = selectionMode === "scenes";
  const resetSelection = () => {
    setSelectionMode(undefined);
    setSelection([]);
    setMergeOpen(false);
  };
  useEffect(() => {
    setEditingScene(undefined);
    setFocusedSceneId(initialFocus);
    setSceneView(initialFocus === undefined ? "grid" : "detail");
    setSceneQuery("");
    resetSelection();
  }, [episode?.id, initialSceneId, initialFocus]);
  const sceneOrder = currentEpisode?.scenes || [];
  const sceneRows = sceneOrder.map((scene, index) => ({
    scene, index, ready: scene.clips.filter(clip => clip.video_media_id).length,
  }));
  const focusedRow = sceneRows.find(row => row.scene.id === focusedSceneId);
  const focusedScene = focusedRow?.scene;
  const showingDetail = sceneView === "detail" && !!focusedScene && !selectingScenes;
  useEffect(() => {
    sceneDetailRef.current?.scrollTo({ top: 0 });
  }, [focusedScene?.id]);
  const query = sceneQuery.trim().toLocaleLowerCase();
  const visibleRows = !selecting && query ? sceneRows.filter(({scene}) =>
    scene.title.toLocaleLowerCase().includes(query) || scene.clips.some(clip => clip.title.toLocaleLowerCase().includes(query))) : sceneRows;
  const selectable = selectingScenes ? sceneOrder : currentEpisode?.clips;
  const selectedIndexes = selectable?.flatMap((item, index) => selection.includes(item.id) ? [index] : []) || [];
  const canCombine = selectedIndexes.length === selection.length && selectedIndexes.length >= 2
    && selectedIndexes[selectedIndexes.length - 1] - selectedIndexes[0] + 1 === selectedIndexes.length;
  const mergeScenes = selectingScenes ? selectedIndexes.map(index => sceneOrder[index]) : [];
  const toggleSelection = (id: number, checked: boolean) => setSelection(previous =>
    checked ? [...previous, id] : previous.filter(item => item !== id));
  const showScene = (id: number) => {
    setFocusedSceneId(id);
    setSceneView("detail");
    requestAnimationFrame(() => {
      sceneTitleRef.current?.focus({preventScroll: true});
    });
  };
  const revealScene = (id: number) => {
    setSceneQuery("");
    showScene(id);
  };
  const showSceneList = (id?: number) => {
    setFocusedSceneId(id);
    setSceneView("grid");
    requestAnimationFrame(() => {
      const grid = sceneGridRef.current;
      (grid?.querySelector<HTMLButtonElement>(`button[data-scene-id="${id}"]`) || grid?.querySelector("button"))?.focus();
    });
  };
  const beginSelection = (mode: "clips" | "scenes") => {
    setSelectionMode(mode);
    setSelection([]);
    setSceneView("grid");
  };
  const onScenesMerged = (merged: Scene) => {
    resetSelection();
    revealScene(merged.id);
    Message.success(`已合并为「${merged.title}」`);
    void Promise.resolve(reload()).catch(error => Message.warning(`场景已合并，刷新失败：${String(error)}`));
  };
  const nextSceneId = (removed: number) => {
    const index = sceneOrder.findIndex(scene => scene.id === removed);
    return (sceneOrder[index + 1] || sceneOrder[index - 1])?.id;
  };
  const updateGroup = async (action: "delete" | "ungroup", sceneId: number) => {
    const result = await post<{scene_ids?: number[]}>(`/scenes/${action}`, { project_id: project.id, scene_id: sceneId, id: sceneId });
    const nextId = result.scene_ids?.[0] ?? nextSceneId(sceneId);
    await reload();
    setSceneQuery("");
    showSceneList(nextId);
    Message.success(action === "delete" ? "场景已删除" : "场景已拆分");
  };
  const [previewTarget, setPreviewTarget] = useState<Pick<PlaybackUnit, "kind" | "id">>();
  const [previewVideoId, setPreviewVideoId] = useState<number | null>(null);
  const [continuousPreview, setContinuousPreview] = useState(false);
  const previewSource = previewTarget?.kind === "scene" ? currentEpisode?.scenes.find(scene => scene.id === previewTarget.id)
    : currentEpisode?.clips.find(clip => clip.id === previewTarget?.id);
  const previewVideos = previewSource ? sceneVideos(previewSource) : [];
  const previewVideo = previewVideos.find(video => video.id === previewVideoId) || previewVideos[0];
  const previewPlaylist = (currentEpisode?.playback_units || []).filter(unit => unit.video_media_id);
  const previewIndex = previewPlaylist.findIndex(unit => unit.kind === previewTarget?.kind && unit.id === previewTarget.id);
  const openPreview = (kind: PlaybackUnit["kind"], source: Clip | Scene) => {
    const videos = sceneVideos(source);
    if (!videos.length) return;
    setPreviewTarget({ kind, id: source.id });
    setPreviewVideoId(source.video_media_id || videos[0].id);
  };
  const renderSceneClips = (afterSave: (action: () => void) => void = action => action(), busy = false) => {
    if (!currentEpisode || !focusedRow || !focusedScene) return null;
    const locked = editorLocked || busy;
    return <aside className="scene-workspace-detail" ref={sceneDetailRef} aria-label="场景片段列表">
      <section className="episode-scene-group" key={focusedScene.id}>
        <div className="episode-scene-group-heading">
          <div className="episode-scene-group-summary">
            <div className="episode-scene-group-title">
              <span className="episode-scene-index" aria-hidden="true">{String(focusedRow.index + 1).padStart(2, "0")}</span>
              <h3 tabIndex={-1} ref={sceneTitleRef}>{focusedScene.title}</h3>
            </div>
            <div className="episode-scene-group-meta">
              <span>{focusedScene.clips.length} 个片段</span>
              <Tag size="small" color={focusedScene.generation_mode === "one_take" ? "arcoblue" : "gray"}>
                {focusedScene.generation_mode === "one_take" ? "一镜到底" : "逐片段生成"}
              </Tag>
              {focusedScene.generation_mode === "one_take"
                ? <span>{focusedScene.video_media_id ? "主视频已选" : focusedScene.videos?.length ? "待选主视频" : "待生成视频"}</span>
                : <span>{focusedRow.ready}/{focusedScene.clips.length} 视频就绪</span>}
            </div>
          </div>
          {!selecting && <Space wrap size={6}>
            {sceneVideos(focusedScene).length > 0 && <Button size="small" disabled={locked}
              aria-label="预览场景视频" icon={<Play size={14}/>} onClick={() => openPreview("scene", focusedScene)}>预览</Button>}
            <Button size="small" type="primary" disabled={locked || inserting !== null} icon={<Plus size={14}/>}
              onClick={() => afterSave(() => beginClipCreation(focusedScene.id))}>添加片段</Button>
            <EpisodeOrderControls episode={currentEpisode} id={focusedScene.id} kind="scene" project={project} reload={reload}
              disabled={locked || copyingClip !== null || inserting !== null} actions={[
                ...(focusedScene.clips.length > 1 ? [{
                  key: "ungroup", label: "拆分场景", run: () => confirmAction({title: "拆分这个场景？",
                    content: "每个片段将成为独立场景并沿用共享设定。原场景及一镜到底视频的关联将移除。",
                    okText: "拆分场景", onOk: () => updateGroup("ungroup", focusedScene.id)}),
                }] : []),
                { key: "delete", label: "删除场景", danger: true, run: () => confirmAction({intent: "danger",
                  title: "删除这个场景？", content: `将删除「${focusedScene.title}」及其中 ${focusedScene.clips.length} 个片段。`,
                  okText: "删除场景", onOk: () => updateGroup("delete", focusedScene.id)}) },
              ]} />
          </Space>}
        </div>
        <div className="episode-scene-grid">{focusedScene.clips.map((clip, index) => {
          const duration = clip.generation_options?.duration ?? focusedScene.generation_options?.duration;
          return <div key={clip.id} className="episode-scene-item">
            {selectingClips && <div className="episode-clip-selection">
              <Checkbox checked={selection.includes(clip.id)} disabled={locked}
                onChange={checked => toggleSelection(clip.id, checked)}>选择「{clip.title}」</Checkbox>
            </div>}
            <div className="episode-scene-card">
              <ClipThumb scene={clip} media={data.media}
                onPreview={!locked && !selecting && sceneVideos(clip).length ? () => openPreview("clip", clip) : undefined}/>
              <button type="button" className="episode-scene-card-body" disabled={locked || selecting}
                aria-label={`编辑片段：${clip.title}`} onClick={() => afterSave(() => openClip(clip))}>
                <div className="episode-scene-card-title">
                  <span className="episode-clip-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                  <b title={clip.title}>{clip.title}</b>
                </div>
                <p>{clip.description || "尚未填写片段描述"}</p>
                <div className="episode-scene-card-footer">
                  <Space size={6} wrap>
                    <Tag size="small" color={clip.video_media_id ? "green" : "gray"}>{clip.video_media_id ? "视频已就绪" :
                      (clip.first_media_id || clip.last_media_id || clip.reference_media_id || clip.generation_options?.reference_media_ids?.length) ? "已设画面" : "待制作"}</Tag>
                    {clip.creation_mode === "canvas" && <Tag size="small">画布</Tag>}
                    {duration !== undefined && duration > 0 && <span className="episode-clip-duration">{duration} 秒</span>}
                  </Space>
                  {!selecting && <span className="episode-scene-edit-link">编辑片段 <ChevronRight size={14}/></span>}
                </div>
              </button>
            </div>
            {!selecting && <div className="episode-scene-item-actions">
              <EpisodeOrderControls episode={currentEpisode} kind="clip" id={clip.id} project={project} reload={reload}
                disabled={locked || copyingClip !== null || inserting !== null} actions={[
                  { key: "before", label: "在前方新建", run: () => afterSave(() => beginClipCreation(clip.scene_id, clip.id, "before")) },
                  { key: "after", label: "在后方新建", run: () => afterSave(() => beginClipCreation(clip.scene_id, clip.id, "after")) },
                  { key: "copy-before", label: "复制到前方", run: () => void copyClip(clip, "before") },
                  { key: "copy-after", label: "复制到后方", run: () => void copyClip(clip, "after") },
                  { key: "delete", label: "删除片段", danger: true, run: () => confirmAction({intent: "danger",
                    title: "删除这个片段？",
                    content: `将删除「${clip.title}」及其片段设置。${focusedScene.clips.length === 1 ? "该片段是本场景的唯一成员，场景也会删除。" : ""}`,
                    okText: "删除片段", onOk: async () => {
                      const removesScene = focusedScene.clips.length === 1;
                      await post("/clips/delete", { project_id: project.id, id: clip.id });
                      await reload();
                      if (removesScene) showSceneList(nextSceneId(clip.scene_id));
                      Message.success("片段已删除");
                    }}) },
                ]} />
            </div>}
          </div>;
        })}</div>
      </section>
    </aside>;
  };
  if (!episode) return null;
  return (
    <section className="episode-editor-page">
      <div className="section-title episode-editor-toolbar">
        <div className="episode-editor-heading"><Button icon={<ArrowLeft size={16}/>} disabled={editorLocked} onClick={close}>返回</Button><h1 title={title}>{title || "未命名剧集"}</h1></div>
        <Space><Tag color={dirty ? "orange" : "green"}>{dirty ? "未保存" : "已保存"}</Tag><Button type={dirty || view !== "scenes" ? "primary" : "default"} icon={<Save size={16}/>} disabled={generatingBoard || scriptStatus.busy} loading={saving} onClick={save}>保存</Button></Space>
      </div>
      <div className="episode-editor-navigation">
        <div className="episode-editor-tabs" role="tablist" aria-label="剧集工作区">
          <button type="button" role="tab" aria-selected={view === "scenes"} disabled={editorLocked} onClick={() => setView("scenes")}>场景</button>
          <button type="button" role="tab" aria-selected={view === "markdown"} disabled={editorLocked} onClick={() => scriptEditor.current?.chooseFormat("markdown")}>剧本</button>
          <button type="button" role="tab" aria-selected={view === "csv"} disabled={editorLocked} onClick={() => scriptEditor.current?.chooseFormat("csv")}>分镜头剧本</button>
          <button type="button" role="tab" aria-selected={view === "details"} disabled={editorLocked} onClick={() => setView("details")}>剧集信息与片段</button>
        </div>
      </div>
      <div className="episode-writing-pane" hidden={view !== "markdown" && view !== "csv"}>
        <ScreenplayManager key={episode.id} ref={scriptEditor} data={data} episodeId={episode.id} reload={async () => { await reload(); }} disabled={saving || generatingBoard} board={board} onBoard={setBoard} onBoardBusy={setGeneratingBoard} onStatus={onScriptStatus} onFormatChange={setView} />
      </div>
      <div className="episode-scene-browser" hidden={view !== "scenes"}>
        <div className="scene-workspace-toolbar">
          {showingDetail && <Button type="text" className="scene-workspace-back" icon={<ArrowLeft size={16}/>}
            disabled={editorLocked} onClick={() => {
              const back = () => showSceneList(focusedSceneId);
              if (sceneDraft.dirty) confirmDiscard(back); else back();
            }}>返回场景列表</Button>}
          {(!showingDetail || selectingClips) && <div className="scene-workspace-toolbar-title">
            <h2>{selectingScenes ? "合并场景" : selectingClips ? "片段分组" : "场景"}</h2>
            <p className="subtle" aria-live="polite">
              {selectingScenes
                ? mergeScenes.length >= 2 && !canCombine ? "所选场景之间有间隔，请选择一段连续的场景。" : "按剧集顺序选择相邻场景。"
                : selectingClips
                  ? "打开场景选择片段，返回列表时会保留已选项。"
                  : `${sceneOrder.length} 个场景 · ${currentEpisode?.clips.length || 0} 个片段`}
            </p>
          </div>}
          <div className="episode-scene-browser-actions">
            {selecting ? <>
              <Button disabled={editorLocked} onClick={resetSelection}>取消选择</Button>
              <Button type="primary" disabled={!canCombine || editorLocked}
                onClick={() => selectingScenes ? setMergeOpen(true) : setEditingScene("group")}>
                {selectingScenes ? "合并所选场景" : "归为新场景"}（{selection.length}）
              </Button>
            </> : !showingDetail && <>
              {!!currentEpisode && currentEpisode.clips.length > 1 && <Dropdown trigger="click" position="br"
                disabled={editorLocked || inserting !== null || copyingClip !== null}
                droplist={<Menu onClickMenuItem={key => beginSelection(key === "scenes" ? "scenes" : "clips")}>
                  <Menu.Item key="scenes" disabled={sceneOrder.length < 2}>合并场景</Menu.Item>
                  <Menu.Item key="clips">选择片段分组</Menu.Item>
                </Menu>}>
                <Button icon={<GitMerge size={15}/>} disabled={editorLocked || inserting !== null || copyingClip !== null}>
                  批量操作 <ChevronDown size={14}/>
                </Button>
              </Dropdown>}
              <Button type="primary" icon={<Plus size={16}/>} disabled={editorLocked || inserting !== null}
                onClick={() => setEditingScene("new")}>新建场景</Button>
            </>}
          </div>
        </div>
        {!showingDetail && <>
          {sceneOrder.length > 0 && !selecting && <div className="scene-workspace-search">
            <Input aria-label="搜索场景或片段" placeholder="搜索场景或片段" value={sceneQuery} onChange={setSceneQuery}
              prefix={<Search size={15}/>} allowClear />
          </div>}
          {visibleRows.length ? <ol className="scene-workspace-grid" ref={sceneGridRef} aria-label="场景列表">
            {visibleRows.map(({scene, index, ready}) => {
              const selected = selectingScenes && selection.includes(scene.id);
              const picked = selectingClips ? scene.clips.filter(clip => selection.includes(clip.id)).length : 0;
              const cover = sceneThumbnail(scene, data.media);
              const card = <>
                <span className="scene-workspace-card-cover" aria-hidden="true">
                  {cover?.kind === "video" ? <AssetThumbnail media={cover} projectId={project.id}/>
                    : cover ? <img src={imageUrl(cover)} loading="lazy" decoding="async" alt=""/> : <Film size={30}/>}
                </span>
                <span className="scene-workspace-card-body">
                  <span className="scene-workspace-card-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                  <span className="scene-workspace-card-title" title={scene.title}>{scene.title}</span>
                  {!selectingScenes && <ChevronRight className="scene-workspace-card-arrow" size={16} aria-hidden="true"/>}
                  {scene.description && <span className="scene-workspace-card-description">{scene.description}</span>}
                  <span className="scene-workspace-card-meta">
                    <span>{scene.clips.length} 个片段</span>
                    <span>{scene.generation_mode === "one_take" ? scene.video_media_id ? "一镜到底已就绪" : "一镜到底"
                      : `${ready}/${scene.clips.length} 就绪`}</span>
                    {picked > 0 && <Tag size="small" color="arcoblue">已选 {picked}</Tag>}
                  </span>
                </span>
              </>;
              return <li key={scene.id} className="scene-workspace-card" data-selected={selected}>
                {selectingScenes ? <label className="scene-workspace-card-link">
                  <input type="checkbox" className="episode-scene-group-checkbox" aria-label={`选择场景「${scene.title}」`}
                    checked={selected} disabled={editorLocked} onChange={event => toggleSelection(scene.id, event.currentTarget.checked)} />
                  {card}
                </label> : <button type="button" className="scene-workspace-card-link" data-scene-id={scene.id}
                  aria-label={`查看场景「${scene.title}」`} disabled={editorLocked} onClick={() => showScene(scene.id)}>
                  {card}
                </button>}
              </li>;
            })}
          </ol> : <Empty description={sceneOrder.length ? "没有匹配的场景或片段" : "本集暂无场景，点击「新建场景」开始创作"}/>}
        </>}
        {showingDetail && currentEpisode && focusedScene && (selecting ? renderSceneClips() : <SceneSettings
          key={focusedScene.id} data={data} episode={currentEpisode} scene={focusedScene} reload={reload}
          onStatus={onSceneStatus} renderClips={renderSceneClips} />)}
      </div>
      {currentEpisode && editingScene && <SceneSettings
        key={editingScene} data={data} episode={currentEpisode} reload={reload}
        clipIds={editingScene === "group" ? selectedIndexes.map(index => currentEpisode.clips[index].id) : undefined}
        close={() => setEditingScene(undefined)} onSaved={scene => {
          resetSelection();
          setSceneQuery("");
          showSceneList(scene.id);
        }} />}
      {currentEpisode && mergeOpen && canCombine && <SceneMergeDialog projectId={project.id} episodeId={currentEpisode.id}
        scenes={mergeScenes}
        close={() => setMergeOpen(false)} onMerged={onScenesMerged} />}
      <Modal title="新建片段" okText="创建片段" visible={clipCreation!==null} confirmLoading={inserting!==null} onCancel={()=>{if(inserting===null)setClipCreation(null);}} onOk={()=>makeClip().catch(e=>{Message.error(String(e));throw e;})}>
        <Form layout="vertical"><Form.Item label="片段名称"><Input aria-label="新片段名称" value={newClipTitle} onChange={setNewClipTitle}/></Form.Item>
        <Form.Item label="创建方式"><div className="scene-creation-options">
          <button type="button" className={creationMode==="default"?"selected":""} aria-pressed={creationMode==="default"} onClick={()=>setCreationMode("default")}><b>默认方式</b><span>使用片段表单设置画面、描述和生成参数</span></button>
          <button type="button" className={creationMode==="canvas"?"selected":""} aria-pressed={creationMode==="canvas"} onClick={()=>setCreationMode("canvas")}><b>画布方式</b><span>在画布中连接图片、音频与视频节点创作</span></button>
        </div></Form.Item></Form>
      </Modal>
      <VideoPreviewModal
        media={previewSource ? previewVideo || null : null}
        playbackKey={previewTarget ? `${previewTarget.kind}-${previewTarget.id}` : undefined}
        autoPlay={continuousPreview && previewIndex >= 0}
        title={`视频预览 · ${previewSource?.title || ""}`}
        videos={previewVideos}
        projectId={data.project.id}
        onClose={()=>{setPreviewTarget(undefined);setPreviewVideoId(null);}}
        footer={<Space wrap>
          <Tag>{previewVideo?.id === previewSource?.video_media_id ? "主视频" : "其他版本"}</Tag>
          <Select value={previewVideo?.id} onChange={setPreviewVideoId} aria-label="视频预览版本" style={{ width: 180 }}>
            {previewVideos.map((video,index)=><Select.Option key={video.id} value={video.id}>版本 {index+1}{video.id === previewSource?.video_media_id ? " · 主视频" : ""}</Select.Option>)}
          </Select>
          <Switch checked={continuousPreview && previewIndex >= 0} disabled={previewIndex < 0} onChange={setContinuousPreview} aria-label="按剧集顺序播放"/>
          <span>按剧集顺序播放</span>
        </Space>}
        onEnded={()=>{
          if(!continuousPreview || previewIndex < 0) return;
          const next = previewPlaylist[previewIndex + 1];
          if(next){setPreviewTarget(next);setPreviewVideoId(next.video_media_id || null);}
        }}
      />
      <div className="episode-editor-columns" hidden={view !== "details"}>
      <Card className="episode-editor-card episode-details-pane">
      <fieldset disabled={saving} className="episode-editor-fields">
      <Form layout="vertical">
        <Form.Item label="剧集封面" extra="默认使用第一个片段的第一个视频画面">
          <div className="episode-cover-controls">
            {episode && <EpisodeCover episode={{...episode, clips: currentEpisode?.clips, playback_units: currentEpisode?.playback_units, cover_media:cover}} />}
            <div className="episode-cover-actions">
              <Button onClick={() => uploadCover().catch(e => Message.error(String(e)))}>上传封面</Button>
              <ClipFramePicker data={data} reload={reload} onSelect={setCover}/>
              <Button onClick={() => setCover(undefined)}>恢复默认</Button>
            </div>
          </div>
        </Form.Item>
        <Form.Item label="剧集标题">
          <Input aria-label="剧集标题" value={title} onChange={setTitle} />
        </Form.Item>
        <Form.Item label="剧集简介" extra="故事正文请在「剧本」中编辑。"><Input.TextArea aria-label="剧集简介" value={description} onChange={setDescription} autoSize={{ minRows: 4 }} /></Form.Item>
      </Form>
      </fieldset>
      </Card>
      <Card className="episode-editor-card episode-scenes-pane">
        <h2>片段顺序 <span className="subtle">{currentEpisode?.clips.length || 0} 个片段</span></h2>
        <p className="subtle">调整后立即保存，并同步到工作台</p>
        <fieldset disabled={saving} className="episode-editor-fields">
          {currentEpisode?.clips.map((scene, index) => {
            const options = sceneGenerationOptions(scene, currentEpisode.scenes.find(parent => parent.id === scene.scene_id));
            const mode = options.video_mode;
            const images = mode === "i2v"
              ? [...new Set(options?.reference_media_ids ?? (scene.reference_media_id ? [scene.reference_media_id] : []))].map((id, i) => ({
                label: `参考图 ${i + 1}`,
                media: data.media.find(media => media.id === id) || (scene.reference_media?.id === id ? scene.reference_media : undefined),
              }))
              : [
                {label: "首帧", media: scene.first_media || data.media.find(media => media.id === scene.first_media_id)},
                {label: "尾帧", media: scene.last_media || data.media.find(media => media.id === scene.last_media_id)},
              ];
            return <div className="episode-scene-order-item" key={scene.id}>
              <div className="episode-scene-order-heading"><b>{String(index + 1).padStart(2, "0")} · {scene.title}</b><EpisodeOrderControls episode={currentEpisode} kind="clip" id={scene.id} project={project} reload={reload}/></div>
              <div className="episode-scene-order-images">
                {images.map(({label, media}) => <figure key={label}>
                  <div className="episode-scene-order-preview">
                    {media ? <img src={imageUrl(media)} alt={`${scene.title} · ${label}`} loading="lazy"/> : <span className="subtle">未设置{label}</span>}
                  </div>
                  <figcaption>{label}</figcaption>
                </figure>)}
                {!images.length && <p className="subtle">未设置参考图</p>}
              </div>
              <details className="episode-scene-order-prompt"><summary><b>Prompt</b><span className="episode-prompt-expand">展开</span><span className="episode-prompt-collapse">收起</span></summary><p className="episode-scene-order-description">{sceneVideoPrompt(scene) || "未填写 Prompt"}</p></details>
            </div>;
          })}
          {!currentEpisode?.clips.length && <Empty description="暂无片段"/>}
        </fieldset>
      </Card>
      </div>
    </section>
  );
}
function ClipImageField({
  reload,
  label,
  value,
  data,
  onChange,
  onUpload,
  onGenerate,
  prompt,
  ratio,
}: {
  reload: () => void;
  label: string;
  value: number | null;
  data: Snapshot;
  onChange: (id: number | null) => void;
  onUpload: () => void;
  onGenerate: () => void;
  prompt: string;
  ratio: string;
}) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [rolesOpen, setRolesOpen] = useState(false);
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [generatorSource, setGeneratorSource] = useState<Media | null>(null);
  const [generatorBusy, setGeneratorBusy] = useState(false);
  const selected = data.media.find((m) => m.id === value);
  return (
    <div className="scene-image-field">
      <div className="scene-image-label">
        <b>{label}</b>
        {value && (
          <Button type="text" size="mini" onClick={() => onChange(null)}>
            清除
          </Button>
        )}
      </div>
      <div className="scene-image-body">
        <button
          type="button"
          className={
            selected ? "scene-image-preview has-image" : "scene-image-preview"
          }
          onClick={() => selected ? setPreviewOpen(true) : setAssetsOpen(true)}
          aria-label={selected ? `预览${label}` : `选择${label}`}
        >
          {selected ? (
            <>
              <img src={imageUrl(selected)} alt={selected.name} />
              <span className="scene-image-preview-hint">
                <ZoomIn size={17} />
                点击预览
              </span>
            </>
          ) : (
            <div>
              <ImagePlus size={25} />
              <span>点击添加图片</span>
            </div>
          )}
        </button>
        <div className="scene-image-actions">
          <Dropdown trigger="click" popupVisible={sourcesOpen} onVisibleChange={setSourcesOpen} unmountOnExit={false}
            droplist={<div className="scene-source-menu" onClick={() => setSourcesOpen(false)}>
              <Button type="text" icon={<ImagePlus size={15} />} onClick={() => setAssetsOpen(true)}>从素材库选择</Button>
              <Button type="text" icon={<Users size={15} />} onClick={() => setRolesOpen(true)}>从资产中选择</Button>
              <ClipFramePicker data={data} reload={reload} onSelect={media => onChange(media.id)}/>
              <Button type="text" icon={<Upload size={15} />} onClick={onUpload}>上传图片</Button>
            </div>}
          >
            <Button size="small">{selected ? "替换" : "选择图片"}<ChevronDown size={13}/></Button>
          </Dropdown>
          <Button type="text" size="small" icon={<Sparkles size={14}/>} onClick={onGenerate}>生成图片</Button>
        </div>
      </div>
      <ImagePreviewModal media={selected||null} title={label} visible={previewOpen} onClose={()=>setPreviewOpen(false)} />
      <AssetImagePicker
        visible={assetsOpen}
        label={label}
        value={value}
        data={data}
        onSelect={id => { onChange(id); setAssetsOpen(false); }}
        onClose={() => setAssetsOpen(false)}
      />
      <Modal
        className="image-generator-modal"
        title={`${label} · 图生图`}
        visible={!!generatorSource}
        style={{ width: "min(1100px, 94vw)" }}
        footer={null}
        unmountOnExit
        closable={!generatorBusy}
        maskClosable={!generatorBusy}
        escToExit={!generatorBusy}
        onCancel={() => { if (!generatorBusy) setGeneratorSource(null); }}
      >
        {generatorSource && <ImageStudio
          key={generatorSource.id}
          data={data}
          reload={reload}
          source={generatorSource}
          initialPrompt={prompt}
          initialRatio={ratio}
          onBusyChange={setGeneratorBusy}
          onUse={(media) => {
            onChange(media.id);
            setGeneratorSource(null);
            Message.success(`${label}已替换，保存片段后生效`);
          }}
        />}
      </Modal>
      <RoleImagePicker title={`为${label}选择资产图片`} visible={rolesOpen} roles={data.assets} selectedIds={value===null?[]:[value]}
        onSelect={media=>{onChange(media.id);setRolesOpen(false);}} onClose={()=>setRolesOpen(false)} />
    </div>
  );
}
export function ClipEditor({
  scene,
  isNew,
  data,
  onClose,
  reload,
  onGenerateFrame,
  generatedFrame,
  onGeneratedApplied,
}: {
  scene: Clip;
  isNew: boolean;
  data: Snapshot;
  onClose: () => void;
  reload: () => void;
  onGenerateFrame?: (key: FrameKey) => void;
  generatedFrame?: { key: FrameKey; media: Media } | null;
  onGeneratedApplied?: () => void;
}) {
  const [title, setTitle] = useState(scene.title || "");
  const [description, setDescription] = useState(scene.description || "");
  const [prompt, setPrompt] = useState(scene.prompt || "");
  const [writing, setWriting] = useState(false);
  const [writingField, setWritingField] = useState<"description" | "prompt">("prompt");
  const [writingSettingsOpen, setWritingSettingsOpen] = useState(false);
  const generationSettingsId = React.useId();
  const [optimizationMenuOpen, setOptimizationMenuOpen] = useState(false);
  const sceneEditorRef = useRef<HTMLElement>(null);
  const composerScroll = useRef(0);
  const changeWriting = (next: boolean) => {
    const editor = sceneEditorRef.current;
    const composer = editor?.querySelector<HTMLElement>(".scene-composer");
    if (next) composerScroll.current = composer?.scrollTop || 0;
    setWriting(next);
    requestAnimationFrame(() => {
      if (composer) composer.scrollTop = next ? 0 : composerScroll.current;
      if (next) {
        editor?.querySelector<HTMLTextAreaElement>(`.scene-${writingField}-field textarea`)?.focus({preventScroll: true});
      } else {
        editor?.querySelector<HTMLButtonElement>(".scene-writing-toggle")?.focus({preventScroll: true});
      }
    });
  };
  const effectivePrompt = prompt.trim() ? prompt : description;
  const parentScene = data.episodes.flatMap(episode => episode.scenes).find(item => item.id === scene.scene_id);
  const { uploading:pastingImages, inProgress:pasteInProgress, uploadImages } = useImageUpload({projectId:data.project.id,reload,refreshError:"图片已上传，但刷新素材失败"});
  const [uploadingMediaReferences, setUploadingMediaReferences] = useState(false);
  const [uploadingImageReferences, setUploadingImageReferences] = useState(false);
  const uploadingReferences = uploadingMediaReferences || uploadingImageReferences;
  const [pastedMedia, setPastedMedia] = useState<Media[]>([]);
  const [frames, setFrames] = useState<Record<FrameKey, number | null>>({
    first: scene.first_media_id || null,
    last: scene.last_media_id || null,
    reference: scene.reference_media_id || null,
  });
  const [localOptions, setOptions] = useState<Partial<GenerationOptions>>(() => ({
    ...scene.generation_options,
    ...(scene.generation_options?.video_mode === "ref2v" ? { video_mode: "i2v" as const } : {}),
    reference_media_ids: scene.generation_options?.reference_media_ids ?? (scene.reference_media_id ? [scene.reference_media_id] : undefined),
  }));
  const options = sceneGenerationOptions({ ...scene, first_media_id: frames.first, generation_options: localOptions }, parentScene);
  const ratio = options.aspect_ratio;
  const hasSceneDefaults = clipDefaultFields.some(key => parentScene?.generation_options?.[key] !== undefined);
  const hasLocalDefaults = clipDefaultFields.some(key => localOptions[key] !== undefined);
  const resetDefaults = () => setOptions(current => {
    const next = { ...current };
    for (const key of clipDefaultFields) delete next[key];
    return next;
  });
  const operation = options.video_mode === "i2v" ? "ref2v" : options.video_mode;
  const videoChoice = generationChoice(data.settings, "video", options, operation);
  const selectVideoModel = (selection: GenerationSelection) => {
    const capabilities = generationChoice(data.settings, "video", selection)?.capabilities;
    const next = capabilities?.modes.includes(operation) ? operation : capabilities?.modes[0];
    setOptions(current => ({
      ...current,
      ...selection,
      ...(next && next !== operation ? { video_mode: next === "ref2v" ? "i2v" : next as GenerationOptions["video_mode"] } : {}),
      resolution: undefined,
      audio: capabilities?.audio ? current.audio : undefined,
    }));
  };
  const generationRatio = modelRatio(videoChoice, ratio);
  const generationRatioLabel = videoChoice?.capabilities.size_mode === "resolution" && options.video_mode === "fl2v"
    ? "跟随首帧" : generationRatio === "adaptive" ? "自适应" : generationRatio;
  const imageGeneration=useGenerationSelection(data.settings,"image");
  const automaticReferenceIds = useRef<number[]>([]);
  const mentionItems = promptMentions(data.assets, data);
  const mentionedReferenceIds = JSON.stringify([...new Set(
    [description, prompt].flatMap(value => findMentions(value, mentionItems))
      .flatMap(mention => mention.media?.kind === "image" ? [mention.media.id] : []),
  )]);
  const previousMentions = useRef(mentionedReferenceIds);
  useEffect(() => {
    if (pastingImages) return;
    const mentionedIds: number[] = JSON.parse(mentionedReferenceIds);
    const previousIds: number[] = JSON.parse(previousMentions.current);
    previousMentions.current = mentionedReferenceIds;
    const addedImage = mentionedIds.some(id => !previousIds.includes(id));
    const switchMode = options.video_mode !== "i2v" && addedImage;
    if (options.video_mode !== "i2v" && !switchMode) return;
    const existing = options.reference_media_ids || [];
    const {ids,automatic} = syncMentionReferences(existing, automaticReferenceIds.current, mentionedIds);
    automaticReferenceIds.current = automatic;
    if (switchMode || ids.length !== existing.length || ids.some((id,index)=>id!==existing[index])) {
      setOptions(current => ({
        ...current,
        ...(switchMode ? {video_mode:"i2v", model:undefined} : {}),
        reference_media_ids:ids,
      }));
    }
  }, [mentionedReferenceIds, options.video_mode, pastingImages]);
  const signature = JSON.stringify({title, description, prompt, frames, localOptions});
  const [savedSignature, setSavedSignature] = useState(signature);
  const dirty = signature !== savedSignature;
  useEditGuard(dirty);
  const closeEditor = () => {
    if (pasteInProgress.current || uploadingImageReferences) return;
    if (optimizingPrompt) return;
    if (!dirty) { onClose(); return; }
    void save();
  };
  const [savingClip, setSavingClip] = useState(false);
  const [videoGenerating, setVideoGenerating] = useState(false);
  const [previewingGeneration, setPreviewingGeneration] = useState(false);
  const [generationPreview, setGenerationPreview] = useState<GenerationPreview>();
  const { optimizing:optimizingPrompt, optimize:optimizePrompt } = usePromptOptimization();
  const [persistedVideoGenerating, setPersistedVideoGenerating] = useState(false);
  const [videoAssetPickerOpen, setVideoAssetPickerOpen] = useState(false);
  const [annotationSource, setAnnotationSource] = useState<Media | null>(null);
  const [attachingVideo, setAttachingVideo] = useState(false);
  const hadPersistedVideoJob = useRef(false);
  useEffect(() => {
    let disposed = false;
    const refreshJob = async () => {
      try {
        const jobs = await api<BackgroundJob[]>("/tasks");
        if (disposed) return;
        const running = jobs.some(
          (job) =>
            job.project_id === data.project.id &&
            job.clip_id === scene.id &&
            job.operation.includes("video") &&
            job.status === "running",
        );
        setPersistedVideoGenerating(running);
        if (hadPersistedVideoJob.current && !running) void reload();
        hadPersistedVideoJob.current = running;
      } catch {
        // The editor remains usable if the task list is temporarily unavailable.
      }
    };
    void refreshJob();
    const timer = setInterval(refreshJob, 2000);
    return () => { disposed = true; clearInterval(timer); };
  }, [data.project.id, scene.id, reload]);
  const currentClip =
    data.episodes.flatMap((ep) => ep.clips).find((s) => s.id === scene.id) ||
    scene;
  const sharedImages = (parentScene?.reference_media_ids || []).map(id => ({ value: id, label: data.media.find(media => media.id === id)?.name || `图片 #${id}` }));
  const sharedVideo = (parentScene?.generation_options?.reference_video_media_ids || []).map(id => ({ value: id, label: data.media.find(media => media.id === id)?.name || `视频 #${id}` }));
  const sharedAudio = (parentScene?.reference_audio_media_ids || []).map(id => ({ value: id, label: data.media.find(media => media.id === id)?.name || `音频 #${id}` }));
  const canSubmitClip = !!effectivePrompt.trim() || (options.inherit_shared_prompt !== false && !!(parentScene?.shared_prompt?.trim() || parentScene?.description?.trim()));
  const [imageTarget, setImageTarget] = useState<FrameKey | null>(null);
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageMode, setImageMode] = useState<"t2i" | "i2i">("t2i");
  const [imageRefs, setImageRefs] = useState<Media[]>([]);
  const [rolePickerOpen, setRolePickerOpen] = useState(false);
  const [imageGenerating, setImageGenerating] = useState(false);
  const choose = (key: FrameKey, id: number | null) =>
    setFrames((current) => ({ ...current, [key]: id }));
  const pasteReferenceImages = async (files: File[]) => {
    if (pasteInProgress.current || uploadingImageReferences || savingClip || videoGenerating || persistedVideoGenerating) return;
    const remaining = Math.max(0, 9 - (options.reference_media_ids || []).length);
    if (!remaining) { Message.warning("最多添加 9 张参考图，请先移除部分图片"); return; }
    const supported = supportedPastedImages(files);
    if (!supported.length) return;
    if (supported.length > remaining) Message.warning(`最多添加 9 张参考图，本次只上传前 ${remaining} 张`);
    await uploadImages(supported.slice(0,remaining), {pasted:true,onUploaded:media=>{
      setPastedMedia(items=>[...items,media]);
      setOptions(current=>({...current,video_mode:"i2v",reference_media_ids:[...new Set([...(current.reference_media_ids||[]),media.id])].slice(0,9)}));
    },onComplete:count=>Message.success(`${count} 张图片已添加为全能参考图，保存片段后生效`)});
  };
  const uploadFrame = async (key: FrameKey) => {
    const source = await open({
      multiple: false,
      filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "gif", "svg"] }],
    });
    if (typeof source !== "string") return;
    const media = await post<Media>("/media/import", {
      project_id: data.project.id,
      source_path: source,
    });
    choose(key, media.id);
    await reload();
  };
  const toggleRef = (media: Media) =>
    setImageRefs((current) =>
      current.some((x) => x.id === media.id)
        ? current.filter((x) => x.id !== media.id)
        : [...current, media],
    );
  const uploadRefs = async () => {
    const selected = await open({
      multiple: true,
      filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "gif", "svg"] }],
    });
    if (!selected) return;
    const paths = typeof selected === "string" ? [selected] : selected;
    const imported = await Promise.all(
      paths.map((source) =>
        post<Media>("/media/import", {
          project_id: data.project.id,
          source_path: source,
        }),
      ),
    );
    setImageRefs((current) => [
      ...current,
      ...imported.filter((media) => !current.some((x) => x.id === media.id)),
    ]);
    await reload();
  };
  const openImageGenerator = (key: FrameKey) => {
    if (onGenerateFrame) { onGenerateFrame(key); return; }
    setImageTarget(key);
    const prompt = scene.script?.[key] || description;
    setImagePrompt(prompt);
    setImageMode("t2i");
    setImageRefs(findMentions(prompt, promptMentions(data.assets, data)).flatMap(mention => mention.media ? [mention.media] : []));
  };
  useEffect(() => {
    if (!generatedFrame) return;
    choose(generatedFrame.key, generatedFrame.media.id);
    Message.success(`${generatedFrame.key === "first" ? "首帧" : "尾帧"}图片已设置，保存片段后生效`);
    onGeneratedApplied?.();
  }, [generatedFrame]);
  const generateImage = async () => {
    if (!imageTarget || !imagePrompt.trim()) return;
    if (imageMode === "i2i" && !imageRefs.length) {
      Message.warning("图生图请至少选择一张参考图");
      return;
    }
    setImageGenerating(true);
    try {
      const media = await post<Media>("/generations/image", {
        project_id: data.project.id,
        operation: imageMode,
        ...selectionPayload(imageGeneration.choice),
        prompt: resolvePrompt(imagePrompt, data.assets),
        aspect_ratio: modelRatio(imageGeneration.choice,ratio),
        size: modelImageSize(imageGeneration.choice,ratio,options.size,imageMode),
        image_media_ids: imageMode === "i2i" ? imageRefs.map((x) => x.id) : [],
      });
      choose(imageTarget, media.id);
      await reload();
      setImageTarget(null);
      setImageRefs([]);
      Message.success("图片已生成并选中");
    } catch (e) {
      Message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setImageGenerating(false);
    }
  };
  const draft = (): Clip => ({
    ...scene,
    title,
    description,
    prompt,
    first_media_id: frames.first,
    last_media_id: frames.last,
    reference_media_id: frames.reference,
    generation_options: localOptions,
  });
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const [autoSaveStatus, setAutoSaveStatus] = useState("");
  const persist = () => {
    const payload = { project_id: data.project.id, ...draft(), title: title.trim() };
    const saved = signature;
    const run = async () => {
      if (!payload.title) throw new Error("请输入片段标题");
      setAutoSaveStatus("正在保存…");
      await post("/clips/update", payload);
      setSavedSignature(saved);
      setAutoSaveStatus("已自动保存");
    };
    const next = saveQueue.current.catch(() => {}).then(run);
    saveQueue.current = next;
    return next;
  };
  useEffect(() => {
    if (!dirty || savingClip || optimizingPrompt || pastingImages || uploadingReferences || videoGenerating) return;
    const timer = window.setTimeout(() => {
      void persist().then(() => reload()).catch(error => {
        setAutoSaveStatus("自动保存失败，请点击保存片段重试");
        Message.error(String(error));
      });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [signature, savedSignature, savingClip, optimizingPrompt, pastingImages, uploadingReferences, videoGenerating]);
  const previewGeneration = async () => {
    setPreviewingGeneration(true);
    try {
      const request = videoRequest(draft(), data.settings, parentScene);
      setGenerationPreview(await post<GenerationPreview>("/generations/clip-preview", { project_id: data.project.id, ...request }));
    } catch (error) { Message.error(String(error)); }
    finally { setPreviewingGeneration(false); }
  };
  const generateVideo = async () => {
    if (pasteInProgress.current || uploadingReferences || optimizingPrompt || savingClip || videoGenerating || persistedVideoGenerating) return;
    try {
      const request = videoRequest(draft(), data.settings, parentScene);
      setVideoGenerating(true);
      await persist();
      await post<Media>("/generations/video", {
        project_id: data.project.id,
        ...request,
      });
      await reload();
      Message.success("已添加一个视频版本");
    } catch (e) {
      Message.error(String(e));
    } finally {
      setVideoGenerating(false);
    }
  };
  const videoImportInProgress = useRef(false);
  const attachVideo = async (media: Media) => {
    if (videoImportInProgress.current) return;
    videoImportInProgress.current = true;
    setAttachingVideo(true);
    try {
      await post('/clips/select-video', {project_id:data.project.id,clip_id:scene.id,media_id:media.id});
      setVideoAssetPickerOpen(false);
      Message.success('已设为片段主视频，原视频保留为候选版本');
      try { await reload(); } catch { Message.warning('主视频已保存，刷新失败，请稍后重试'); }
    } finally { videoImportInProgress.current = false; setAttachingVideo(false); }
  };
  const optimizationDisabled=videoGenerating||persistedVideoGenerating||optimizingPrompt||pastingImages||uploadingReferences||savingClip||!description.trim();
  const optimizeVideoPrompt=(format:"minimax-h3"|"wan3.0")=>{
    if (optimizationDisabled) return;
    if (format==="minimax-h3"&&options.duration<=0) {
      Message.warning("优化成 minimax-h3 形式前，请在生成参数中选择具体时长");
      return;
    }
    const imageIds=options.video_mode==="t2v"?[]:options.video_mode==="i2v"?(options.reference_media_ids||[]):[frames.first,frames.last].filter((id):id is number=>Boolean(id));
    return optimizePrompt({projectId:data.project.id,
    prompt:format==="minimax-h3"?resolveH3Prompt(description,data,imageIds):description,kind:"video",imageIds,
    h3:format==="minimax-h3"?{mode:options.video_mode==="t2v"?"t2va":options.video_mode==="i2v"?"ref2va":frames.first?(frames.last?"fl2va":"i2va"):frames.last?"l2va":"t2va",duration:options.duration,
      videoIds:options.video_mode==="i2v"?options.reference_video_media_ids:[],audioIds:options.video_mode==="i2v"?options.reference_audio_media_ids:[]}:undefined,
    wan:format==="wan3.0"?{mode:options.video_mode||"fl2v",duration:options.duration}:undefined,
    onOptimized:value=>{setPrompt(value);setWritingField("prompt");},successMessage:format==="minimax-h3"?"已转换为 MiniMax-H3 Prompt":"已转换为 Wan 3.0 Prompt"});
  };
  const optimizeImagePrompt=()=>optimizePrompt({projectId:data.project.id,prompt:imagePrompt,kind:"image",imageIds:imageMode==="i2i"?imageRefs.map(media=>media.id):[],onOptimized:setImagePrompt});
  const save = async () => {
    if (savingClip || optimizingPrompt || pasteInProgress.current || uploadingReferences) return;
    setSavingClip(true);
    try { await persist(); await reload(); Message.success("片段已保存"); onClose(); }
    catch(e) { Message.error(String(e)); }
    finally { setSavingClip(false); }
  };
  const optimizationMenu = <Dropdown trigger={["hover","click"]} position="br" popupVisible={optimizationMenuOpen && !optimizationDisabled} onVisibleChange={setOptimizationMenuOpen} disabled={optimizationDisabled} droplist={<Menu onClickMenuItem={key=>{setOptimizationMenuOpen(false); if(key==="minimax-h3"||key==="wan3.0") void optimizeVideoPrompt(key);}}>
    <Menu.Item key="minimax-h3">优化成 minimax-h3 形式</Menu.Item>
    <Menu.Item key="wan3.0">优化成 wan3.0 形式</Menu.Item>
  </Menu>}>
    <Button type="text" size="mini" icon={<WandSparkles size={14}/>} disabled={optimizationDisabled} aria-label={optimizingPrompt?"正在优化…":"优化描述"} aria-haspopup="menu" aria-expanded={optimizationMenuOpen && !optimizationDisabled}>{optimizingPrompt?"正在优化…":"优化描述"}</Button>
  </Dropdown>;
  return (
    <section ref={sceneEditorRef} className={`scene-editor-page${writing ? " is-writing" : ""}`} onFocusCapture={event => {
      if (event.target instanceof HTMLTextAreaElement) {
        if (event.target.closest(".scene-description-field")) setWritingField("description");
        else if (event.target.closest(".scene-prompt-field")) setWritingField("prompt");
      }
    }} onKeyDown={event => {
      if (event.key === "Escape" && !event.defaultPrevented && !event.nativeEvent.isComposing && event.keyCode !== 229 && event.currentTarget.contains(event.target as Node)) {
        if (optimizationMenuOpen) { event.preventDefault(); setOptimizationMenuOpen(false); return; }
        if ((event.target as HTMLElement).closest(".scene-visuals")) return;
        if (!writing) return;
        event.preventDefault();
        changeWriting(false);
      }
    }}>
      <div className="scene-editor-heading">
        <div className="scene-editor-heading-title">
          <Button type="text" disabled={pastingImages || uploadingImageReferences} onClick={closeEditor}>
            ← 返回
          </Button>
        </div>
        <Space>
          <span className="subtle" role="status">{dirty ? (autoSaveStatus.includes("失败") ? autoSaveStatus : "待自动保存…") : autoSaveStatus}</span>
          <Button className="scene-writing-toggle" icon={writing ? <Minimize2 size={15}/> : <Maximize2 size={15}/>} aria-pressed={writing} onClick={() => changeWriting(!writing)}>
            {writing ? "退出对照" : "对照写作"}
          </Button>
          <Button
            type="primary"
            loading={savingClip}
            disabled={optimizingPrompt || videoGenerating || persistedVideoGenerating || imageGenerating || pastingImages || uploadingReferences}
            icon={<Save size={15} />}
            onClick={save}
          >
            保存片段
          </Button>
        </Space>
      </div>
      <div className="scene-editor-content">
        <div className="scene-composer">
          <div className="scene-form-card">
            <Form layout="vertical">
              <Form.Item className="scene-title-field" label="片段标题">
                <Input aria-label="片段标题" value={title} onChange={setTitle} />
              </Form.Item>
              {writing && <div className="scene-writing-toolbar"><div className="scene-writing-tabs" role="group" aria-label="写作内容">
                <Button aria-pressed={writingField === "description"} onClick={() => setWritingField("description")}>片段描述</Button>
                <Button aria-pressed={writingField === "prompt"} onClick={() => setWritingField("prompt")}>视频 Prompt</Button>
              </div>{optimizationMenu}</div>}
              <Form.Item className={`scene-description-field${writingField === "description" ? " is-active" : ""}`} label={<span className="scene-description-label">
                <span className="scene-description-heading"><span>片段描述</span><span className="scene-description-hint" role="status">{pastingImages ? "正在上传粘贴的图片…" : "可在此粘贴图片，自动添加到全能参考（最多 9 张）"}</span></span>
                {!writing && optimizationMenu}
              </span>}>
                <PromptInput ariaLabel="片段描述" value={description} onChange={setDescription} roles={data.assets} data={data} prompts={data.prompts} templates={[...PROMPT_TEMPLATES,...data.prompts]} disabled={optimizingPrompt || pastingImages || savingClip || videoGenerating || persistedVideoGenerating} onPasteImages={files => void pasteReferenceImages(files)} placeholder="描述镜头、人物动作、台词与画面情绪… 输入 @template 选择模板，或引用资产、片段素材与 Prompt" />
              </Form.Item>
              <Form.Item className={`scene-prompt-field${writingField === "prompt" ? " is-active" : ""}`} label={<span className="scene-description-heading"><span>视频 Prompt</span><span className="scene-description-hint">优化描述的结果会填入此栏，保留手工描述。留空时使用片段描述生成视频。</span></span>}>
                <PromptInput ariaLabel="视频 Prompt" value={prompt} onChange={setPrompt} roles={data.assets} data={data} prompts={data.prompts} templates={[...PROMPT_TEMPLATES,...data.prompts]} disabled={optimizingPrompt || pastingImages || savingClip || videoGenerating || persistedVideoGenerating} onPasteImages={files => void pasteReferenceImages(files)} placeholder="实际用于生成视频的提示词；留空时使用片段描述" />
              </Form.Item>
            </Form>
          </div>
          <div className="scene-visuals" tabIndex={-1} role="region" aria-label="片段素材与参数">
          <div className="scene-section-heading"><h2>{writing ? "参考素材" : "画面素材"}</h2><span>{options.video_mode === "t2v" ? "不使用参考素材" : options.video_mode === "i2v" ? "最多 9 张参考图" : "上传首帧，可选尾帧"}</span></div>
          <div className="scene-generation-controls">
          {writing && <button className="scene-settings-toggle" type="button" aria-label="生成设置" aria-describedby={`${generationSettingsId}-model ${generationSettingsId}-summary`} aria-expanded={writingSettingsOpen} aria-controls={generationSettingsId} onClick={() => setWritingSettingsOpen(open => !open)}>
            <span className="scene-settings-heading">
              <span className="scene-settings-icon"><SlidersHorizontal size={17} aria-hidden="true"/></span>
              <span className="scene-settings-copy"><strong>生成设置</strong><span id={`${generationSettingsId}-model`} className="scene-settings-model" title={videoChoice ? `${videoChoice.model.name || videoChoice.model.id} · ${videoChoice.channel.name}` : undefined}>{videoChoice?.model.name || videoChoice?.model.id || "选择渠道与模型"}</span></span>
              <span className="scene-settings-action">{writingSettingsOpen ? "收起" : "调整"}<ChevronDown size={14} aria-hidden="true"/></span>
            </span>
            <span id={`${generationSettingsId}-summary`} className="scene-settings-summary">
              <span title="画幅"><RectangleHorizontal size={12} aria-hidden="true"/>{generationRatioLabel}</span>
              <span title="时长"><Clock3 size={12} aria-hidden="true"/>{options.duration > 0 ? `${options.duration} 秒` : "智能时长"}</span>
              {videoChoice?.capabilities.size_mode === "resolution" && <span title="分辨率">{options.resolution || videoChoice.channel.resolution || "720P"}</span>}
            </span>
          </button>}
          <Form id={generationSettingsId} layout="vertical" className="scene-generation-settings" hidden={writing && !writingSettingsOpen}>
            <GenerationSelector settings={data.settings} kind="video" value={options} disabled={videoGenerating || persistedVideoGenerating}
              onChange={selectVideoModel}/>
            <VideoModelFields disabled={videoGenerating||persistedVideoGenerating} choice={videoChoice} mode={options.video_mode || "fl2v"} duration={options.duration} onDuration={duration=>setOptions(o=>({...o,duration}))} ratio={ratio} size={options.size} onSize={value=>setOptions(o=>({...o,aspect_ratio:value.ratio,size:value.size}))} resolution={options.resolution} onResolution={resolution=>setOptions(o=>({...o,resolution}))} audio={options.audio} onAudio={audio=>setOptions(o=>({...o,audio}))}/>
          </Form>
          {hasSceneDefaults && (!writing || writingSettingsOpen) && <div className="clip-generation-inheritance">
            <span className="helper">{hasLocalDefaults ? "片段参数优先，其余沿用场景默认值。" : "当前沿用场景默认参数。"}</span>
            {hasLocalDefaults && <Button size="mini" type="text" disabled={videoGenerating || persistedVideoGenerating || savingClip}
              onClick={resetDefaults}>恢复场景默认参数</Button>}
          </div>}
          </div>
          <Tabs className="scene-material-tabs" activeTab={options.video_mode} onChange={key => { if (pasteInProgress.current || uploadingImageReferences) return; setOptions(o => ({ ...o, video_mode: key as "t2v" | "fl2v" | "i2v",
            ...(o.channel_id || o.model ? { model: undefined } : {}) })); }}>
          <Tabs.TabPane key="t2v" title="文生视频"><p className="helper">使用视频 Prompt 生成，不传入首尾帧或参考素材。</p></Tabs.TabPane>
          <Tabs.TabPane key="fl2v" title={videoChoice?.capabilities.last_frame?"首尾帧":"首帧"}>
          <div className="scene-image-grid">
            {(
              [
                ["first", "首帧"],
                ["last", "尾帧"],
              ] as const
            ).filter(([key])=>key!=="last" || !videoChoice || videoChoice.capabilities.last_frame || !!frames.last).map(([key, label]) => (
              <ClipImageField
                key={key}
                label={key==="last"&&videoChoice&&!videoChoice.capabilities.last_frame?"尾帧（当前模型不支持，请清除）":label}
                reload={reload}
                value={frames[key]}
                data={data}
                onChange={(id) => choose(key, id)}
                onUpload={() =>
                  uploadFrame(key).catch((e) => Message.error(String(e)))
                }
                onGenerate={() => openImageGenerator(key)}
                prompt={scene.script?.[key] || description}
                ratio={ratio}
              />
            ))}
          </div>
          </Tabs.TabPane>
          <Tabs.TabPane key="i2v" title="全能参考">
          <ClipReferenceImagePicker data={data} value={options.reference_media_ids || []} extraMedia={pastedMedia}
            maxImages={9} writing={writing} supportsPaste reload={reload} onAnnotate={setAnnotationSource}
            disabled={pastingImages || savingClip || videoGenerating || persistedVideoGenerating || uploadingMediaReferences}
            onUploading={setUploadingImageReferences}
            onChange={update => setOptions(current => ({ ...current, reference_media_ids: update(current.reference_media_ids || []) }))} />
          {(!videoChoice || !!videoChoice.capabilities.max_videos || !!options.reference_video_media_ids?.length || !!options.reference_audio_media_ids?.length)&&<ReferenceMediaPicker projectId={data.project.id} media={data.media} assets={data.assets} videoIds={options.reference_video_media_ids} audioIds={options.reference_audio_media_ids}
            reload={reload} disabled={savingClip || videoGenerating || persistedVideoGenerating || pastingImages || uploadingImageReferences} onUploading={setUploadingMediaReferences}
            onChange={(kind, ids) => setOptions(current => ({...current, [kind === "video" ? "reference_video_media_ids" : "reference_audio_media_ids"]: ids}))} />}
          </Tabs.TabPane>
          </Tabs>
          </div>
          {parentScene && (!!parentScene.shared_prompt || !!parentScene.description || !!sharedImages.length || !!sharedVideo.length || !!sharedAudio.length) && <details className="clip-inheritance">
            <summary>继承场景设定 · {parentScene.title}</summary>
            {(parentScene.shared_prompt || parentScene.description) && <>
              <Checkbox checked={options.inherit_shared_prompt !== false} disabled={videoGenerating || persistedVideoGenerating}
                onChange={inherit_shared_prompt => setOptions(previous => ({ ...previous, inherit_shared_prompt }))}>继承场景描述和共享 Prompt</Checkbox>
              {parentScene.description && <p className="helper">{parentScene.description}</p>}
              {parentScene.shared_prompt && <p className="helper">{parentScene.shared_prompt}</p>}
            </>}
            {!!sharedImages.length && <Select aria-label="排除场景共享参考图" placeholder="排除场景共享参考图"
              mode="multiple" options={sharedImages} value={options.exclude_shared_reference_media_ids || []}
              disabled={videoGenerating || persistedVideoGenerating}
              onChange={exclude_shared_reference_media_ids => setOptions(previous => ({ ...previous, exclude_shared_reference_media_ids }))}/>}
            {!!sharedVideo.length && <Select aria-label="排除场景共享参考视频" placeholder="排除场景共享参考视频"
              mode="multiple" options={sharedVideo} value={options.exclude_shared_reference_video_media_ids || []}
              disabled={videoGenerating || persistedVideoGenerating}
              onChange={exclude_shared_reference_video_media_ids => setOptions(previous => ({ ...previous, exclude_shared_reference_video_media_ids }))}/>}
            {!!sharedAudio.length && <Select aria-label="排除场景共享参考音频" placeholder="排除场景共享参考音频"
              mode="multiple" options={sharedAudio} value={options.exclude_shared_reference_audio_media_ids || []}
              disabled={videoGenerating || persistedVideoGenerating}
              onChange={exclude_shared_reference_audio_media_ids => setOptions(previous => ({ ...previous, exclude_shared_reference_audio_media_ids }))}/>}
            {(sharedImages.length > 0 || sharedVideo.length > 0 || sharedAudio.length > 0) && <p className="helper">全能参考模式可继承 {sharedImages.length} 张参考图、{sharedVideo.length} 个参考视频、{sharedAudio.length} 段参考音频。</p>}
          </details>}
          {writing && <div className="scene-writing-context">
            <div className="scene-writing-summary"><span>{writingField === "prompt" ? prompt.length : description.length} 字</span><span>素材可独立滚动 · 点击图片放大查看</span></div>
          </div>}
            <div className="video-generator scene-video-panel">
              <div className="scene-video-action">
                <span className="subtle">
                {options.video_mode === "t2v" ? "文生视频" : options.video_mode === "i2v" ? "全能参考生成" : "首尾帧生成"}
                </span>
              <Space wrap>
              <Button loading={previewingGeneration} disabled={!canSubmitClip || videoGenerating || persistedVideoGenerating || pastingImages || uploadingReferences || savingClip}
                onClick={() => void previewGeneration()}>预览生成输入</Button>
              <Button className="scene-video-import" icon={<Film size={15}/>} disabled={attachingVideo||videoGenerating||persistedVideoGenerating} onClick={()=>setVideoAssetPickerOpen(true)}>选择已有视频</Button>
              <Button
                type="primary"
                icon={<Sparkles size={17} />}
                loading={videoGenerating || persistedVideoGenerating}
                disabled={!canSubmitClip || previewingGeneration || pastingImages || uploadingReferences || optimizingPrompt || savingClip}
                onClick={generateVideo}
              >
                {persistedVideoGenerating ? "后台生成中" : "生成新视频"}
              </Button>
              </Space>
              </div>
            </div>
        </div>
            <aside className="video-library scene-results">
              <h2>
                视频版本 <span>{sceneVideos(currentClip).length}</span>
              </h2>
              {!!sceneVideos(currentClip).length && <p className="helper">主视频用于默认预览和剧集合并，设置后立即保存。</p>}
              {sceneVideos(currentClip).length ? (
                sceneVideos(currentClip).map((video, index) => (
                  <article className="video-version" key={video.id}>
                    <VideoAsset video={video} scene={currentClip} projectId={data.project.id} reload={reload} />
                    <div className="video-version-meta">
                      <b>视频 {index + 1}</b>
                      <Tag
                        color={
                          video.id === currentClip.video_media_id
                            ? "blue"
                            : "gray"
                        }
                      >
                        {video.id === currentClip.video_media_id
                          ? "主视频"
                          : "候选版本"}
                      </Tag>
                    </div>
                  </article>
                ))
              ) : (
                <div className="scene-results-empty"><div className="scene-results-icon"><Film size={28} strokeWidth={1.25}/></div><b>让片段动起来</b><p>填写片段描述后，即可生成第一个视频。</p></div>
              )}
            </aside>
      </div>
      {annotationSource && <ReferenceAnnotationModal key={annotationSource.id} media={annotationSource}
        onClose={() => setAnnotationSource(null)} onApply={async file => {
          const count = await uploadImages([file], { onUploaded: media => {
            setPastedMedia(items => [...items, media]);
            setOptions(current => ({
              ...current,
              reference_media_ids: (current.reference_media_ids || []).map(id => id === annotationSource.id ? media.id : id),
            }));
          } });
          if (count) Message.success("标注图已用作参考图，保存片段后生效");
          return count > 0;
        }} />}
      {generationPreview && <Modal visible title="片段生成输入" style={{ width: 760, maxWidth: "calc(100vw - 32px)" }}
        footer={null} onCancel={() => setGenerationPreview(undefined)}>
        <GenerationPreviewPanel preview={generationPreview} media={data.media} />
      </Modal>}
      {videoAssetPickerOpen && <ClipVideoPicker key={`${data.project.id}:${scene.id}`} projectId={data.project.id} sceneTitle={title}
        primaryId={currentClip.video_media_id ?? null} linkedIds={sceneVideos(currentClip).map(video => video.id)} busy={attachingVideo}
        onClose={() => setVideoAssetPickerOpen(false)} onConfirm={attachVideo} onImported={reload} />}
      <Modal
        title={`生成${imageTarget === "first" ? "首帧" : imageTarget === "last" ? "尾帧" : "参考图"}`}
        visible={!!imageTarget}
        onCancel={() => setImageTarget(null)}
        onOk={generateImage}
        confirmLoading={imageGenerating}
        okText="生成图片"
      >
        <Form layout="vertical"><GenerationSelector settings={data.settings} kind="image" value={imageGeneration.value} onChange={imageGeneration.setValue} disabled={imageGenerating}/>
          <Form.Item label="生成方式">
            <div className="image-generation-modes">
              <button
                type="button"
                className={imageMode === "t2i" ? "active" : ""}
                onClick={() => setImageMode("t2i")}
              >
                <b>文生图</b>
                <span>仅根据画面描述生成</span>
              </button>
              <button
                type="button"
                className={imageMode === "i2i" ? "active" : ""}
                onClick={() => setImageMode("i2i")}
              >
                <b>图生图</b>
                <span>参考多张图片生成</span>
              </button>
            </div>
          </Form.Item>
          {imageMode === "i2i" && (
            <Form.Item
              label="参考图片"
              extra="支持多选，可混合使用资产图片、片段视频帧与本地图片"
            >
              <div className="image-reference-toolbar">
                <Button
                  icon={<Users size={15} />}
                  onClick={() => setRolePickerOpen(true)}
                >
                  从资产中选择
                </Button>
                <Button
                  icon={<Upload size={15} />}
                  onClick={() =>
                    uploadRefs().catch((e) => Message.error(String(e)))
                  }
                >
                  上传图片
                </Button>
                <ClipFramePicker data={data} reload={reload} onSelect={media => setImageRefs(current => current.some(x => x.id === media.id) ? current : [...current, media])}/>
                <span>已选 {imageRefs.length} 张</span>
              </div>
              {imageRefs.length > 0 && (
                <div className="image-reference-list">
                  {imageRefs.map((media) => (
                    <div key={media.id}>
                      <img src={imageUrl(media)} />
                      <button type="button" onClick={() => toggleRef(media)}>
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Form.Item>
          )}
          <Form.Item
            label="画面描述"
            extra={`将使用「设置」中配置的 ${imageMode} 服务`}
          >
            <div className="prompt-tools"><button type="button" disabled={optimizingPrompt||!imagePrompt.trim()} onClick={optimizeImagePrompt}>{optimizingPrompt?"正在优化…":"✨ 优化 Prompt"}</button></div>
            <Input.TextArea
              value={imagePrompt}
              onChange={setImagePrompt}
              disabled={optimizingPrompt}
              autoSize={{ minRows: 5 }}
              placeholder="描述主体、构图、光线、色彩与画风…"
            />
          </Form.Item>
          <ImageModelFields disabled={imageGenerating} choice={imageGeneration.choice} operation={imageMode} ratio={ratio} size={options.size} onChange={value=>setOptions(o=>({...o,aspect_ratio:value.ratio,size:value.size}))}/>

        </Form>
      </Modal>
      <RoleImagePicker title="从资产中选择参考图" visible={rolePickerOpen} roles={data.assets} multiple
        selectedIds={imageRefs.map(media=>media.id)} onSelect={toggleRef} onClose={()=>setRolePickerOpen(false)} />
    </section>
  );
}
function confirmDisableRole(name: string): Promise<boolean> {
  return new Promise(resolve => confirmAction({
    intent: "warning",
    title: "禁用这个资产？",
    content: `「${name}」及其命名图片将无法被 @ 引用，并从默认资产列表中隐藏。可勾选「显示已禁用资产」后重新启用。`,
    okText: "禁用资产",
    cancelText: "取消",
    onOk: () => { resolve(true); },
    onCancel: () => { resolve(false); },
  }));
}
export function Roles({ data, reload, initialRoleId }: { data: Snapshot; reload: () => void; initialRoleId?:number }) {
  const [graphOpen, setGraphOpen] = useState(false);
  const [showDisabled, setShowDisabled] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<AssetCategory | "all">("all");
  const [assetPage, setAssetPage] = useState(1);
  const roleLibraryRef = useRef<HTMLElement>(null);
  const [query, setQuery] = useState("");
  const [updatingRoleId, setUpdatingRoleId] = useState<number | null>(null);
  const [unlinkingImageId, setUnlinkingImageId] = useState<number | null>(null);
  const [settingPrimaryImageId, setSettingPrimaryImageId] = useState<number | null>(null);
  const imageActionBusy = unlinkingImageId !== null || settingPrimaryImageId !== null;
  const [renamingMedia, setRenamingMedia] = useState<{id:number;name:string} | null>(null);
  const [renamingMediaBusy, setRenamingMediaBusy] = useState(false);
  const search = query.trim().toLowerCase();
  const visibleRoles = data.assets.filter(role =>
    (showDisabled || role.enabled !== false) &&
    (categoryFilter === "all" || (role.category || "person") === categoryFilter) &&
    (!search || role.name.toLowerCase().includes(search) || role.description.toLowerCase().includes(search))
  );
  const assetPageCount = Math.max(1, Math.ceil(visibleRoles.length / 24));
  const currentAssetPage = Math.min(assetPage, assetPageCount);
  const pagedRoles = visibleRoles.slice((currentAssetPage - 1) * 24, currentAssetPage * 24);
  useEffect(() => { setAssetPage(1); }, [data.project.id, search, categoryFilter, showDisabled]);
  useEffect(() => { setAssetPage(page => Math.min(page, assetPageCount)); }, [assetPageCount]);
  const changeAssetPage = (page: number) => {
    setAssetPage(page);
    roleLibraryRef.current?.closest<HTMLElement>(".content")?.scrollTo({ top: 0 });
  };
  const [roleImagePreview, setRoleImagePreview] = useState<Media | null>(null);
  const [previewRoleId, setPreviewRoleId] = useState<number | null>(null);
  const openRoleImage = (role: Asset, media: Media) => { setPreviewRoleId(role.id); setRoleImagePreview(media); };
  const [editing, setEditing] = useState<Asset | null>(null);
  const [editorStart, setEditorStart] = useState<"basic" | "references">("basic");
  const [detailId, setDetailId] = useState<number | null>(initialRoleId ?? null);
  const detail = data.assets.find(role => role.id === detailId);
  const openRoleDetail = (id: number) => {
    setDetailId(id);
  };
  const closeRoleDetail = () => {
    setDetailId(null);
  };



  const detailImages = detail ? [...detail.images].sort((a, b) => Number(b.id === detail.design_media_id) - Number(a.id === detail.design_media_id)) : [];
  const previewRole = data.assets.find(role => role.id === previewRoleId);
  const previewImages = [...(previewRole?.images || [])].sort((a, b) => Number(b.id === previewRole?.design_media_id) - Number(a.id === previewRole?.design_media_id));
  useEffect(() => { if (initialRoleId != null) { setDetailId(initialRoleId); setGraphOpen(false); } }, [initialRoleId]);
  const renameMedia = async () => {
    if (!renamingMedia?.name.trim() || renamingMediaBusy) return;
    setRenamingMediaBusy(true);
    try {
      await post("/media/rename", {project_id: data.project.id, id: renamingMedia.id, name: renamingMedia.name.trim()});
      await reload();
      setRenamingMedia(null);
      Message.success("素材名称已更新");
    } catch (e) { Message.error(String(e)); }
    finally { setRenamingMediaBusy(false); }
  };
  const unlinkImage = async (role: Asset, media: Media) => {
    if (imageActionBusy) return;
    setUnlinkingImageId(media.id);
    try {
      await post("/assets/media/delete", {project_id: data.project.id, asset_id: role.id, media_id: media.id});
      if (previewRoleId === role.id && roleImagePreview?.id === media.id) setRoleImagePreview(null);
      await reload();
      Message.success("已从资产中移除图片，素材文件已保留");
    } catch (e) { Message.error(String(e)); throw e; }
    finally { setUnlinkingImageId(null); }
  };
  const setPrimaryImage = async (role: Asset, media: Media) => {
    if (imageActionBusy || role.design_media_id === media.id) return;
    setSettingPrimaryImageId(media.id);
    try {
      await post("/assets/update", {project_id: data.project.id, id: role.id, design_media_id: media.id});
      await reload();
      Message.success("资产主图已更新");
    } catch (e) { Message.error(String(e)); }
    finally { setSettingPrimaryImageId(null); }
  };
  const changeRoleEnabled = async (role: Asset, enabled: boolean) => {
    if (updatingRoleId !== null) return;
    setUpdatingRoleId(role.id);
    try {
      if (!enabled && !await confirmDisableRole(role.name)) return;
      await post("/assets/update", {project_id: data.project.id, id: role.id, enabled});
      await reload();
      Message.success(enabled ? "资产已启用" : "资产已禁用");
    } catch (e) { Message.error(String(e)); }
    finally { setUpdatingRoleId(null); }
  };
  const make = async () => {
    const x = await post<Asset>("/assets", {
      project_id: data.project.id,
      name: `新${assetCategoryLabel(categoryFilter === "all" ? "person" : categoryFilter)}`,
      category: categoryFilter === "all" ? "person" : categoryFilter,
      description: "",
    });
    await reload();
    setEditing(x);
  };
  if (graphOpen) return <AssetRelationships key={data.project.id} data={data} onClose={() => setGraphOpen(false)}/>;
  return (
    <section ref={roleLibraryRef} className="role-library" aria-label="资产库" >
      {detail ? <div className="role-detail-page">
        <div className="role-detail-topbar">
          <Button  type="text" icon={<ArrowLeft size={16} />} onClick={closeRoleDetail}>资产列表</Button>
          <span>资产档案</span>
          <RevealFileButton path={detailImages[0]?.path || (supportsAudioReferences(detail.category) ? detail.audios?.[0]?.path : undefined)} />
          <Button icon={<Pencil size={15} />} disabled={imageActionBusy} onClick={() => setEditing(detail)}>编辑设定</Button>
        </div>
        <div className="role-detail-hero">
          <div className="role-detail-portrait">
            {detailImages[0] ? <button type="button" onClick={() => openRoleImage(detail, detailImages[0])} aria-label={`放大查看${detail.name}的资产图`}>
              <img src={imageUrl(detailImages[0])} alt={`${detail.name}的资产主图`} />
              <span className="role-detail-zoom"><ZoomIn size={16} /> 放大查看</span>
            </button> : <div className="role-detail-no-image"><Users size={48} strokeWidth={1} /><span>暂无资产图片</span></div>}
            <span className="role-detail-portrait-label">资产主图</span>
          </div>
          <section className="role-detail-profile" aria-label="资产描述">
            <div className="role-detail-eyebrow"><span /> {assetCategoryLabel(detail.category)}档案</div>
            <h1>{detail.name}</h1>
            <div className="role-detail-meta"><span>{assetCategoryLabel(detail.category)}</span><i />{detail.images.length} 张参考图片<Tag color={detail.enabled === false ? "gray" : "green"}>{detail.enabled === false ? "已禁用" : "已启用"}</Tag></div>
            <div className="role-detail-description"><h2>资产描述</h2><p>{detail.description || "还没有资产描述。点击编辑设定，记录外观、特征与故事背景。"}</p></div>
          </section>
        </div>
        <RoleAudioReferences key={detail.id} role={detail} data={data} reload={reload}/>
        <section className="role-detail-gallery" aria-label="资产图片">
          <div className="role-detail-gallery-heading"><div><h2>图片参考 <span>{detail.images.length.toString().padStart(2, "0")}</span></h2><p>记录资产的外观、空间布局与细节</p></div><Button size="small" icon={<ImagePlus size={15}/>} onClick={() => { setEditorStart("references"); setEditing(detail); }}>管理参考素材</Button></div>
          {detailImages.length ? <div className="role-detail-images">{detailImages.map((media, index) => <figure key={media.id}>
            <div className="role-detail-image-frame">
            <button type="button" className="role-detail-image-preview" onClick={() => openRoleImage(detail, media)} aria-label={`预览 ${media.name}`}><img src={imageUrl(media)} alt={media.name} loading="lazy" decoding="async" /><span className="role-detail-image-number">{String(index + 1).padStart(2, "0")}</span><span className="role-detail-image-zoom"><ZoomIn size={15}/>放大预览</span>{media.id === detail.design_media_id && <span className="role-detail-main-badge">主图</span>}</button>
            {media.id !== detail.design_media_id && <button type="button" className="role-detail-set-primary" disabled={imageActionBusy} aria-label={`设为主图 ${media.name}`} onClick={() => void setPrimaryImage(detail, media)}>{settingPrimaryImageId === media.id ? "设置中…" : "设为主图"}</button>}
            </div>
            <figcaption title={media.name}>{media.name}</figcaption>
            <div className="role-detail-image-actions">
              <RevealFileButton className="role-detail-image-reveal" size="mini" path={media.path} />
              <Button className="role-detail-image-rename" type="text" size="mini" icon={<Pencil size={13}/>} disabled={imageActionBusy} aria-label={`重命名 ${media.name}`} onClick={() => setRenamingMedia({id:media.id,name:media.name})}>重命名</Button>
              <ConfirmPopover title="移除这张资产图片？" content={media.id === detail.design_media_id ? "将立即解除图片关联并清除该资产的主图设置，素材库中的原文件会保留。" : "将立即解除图片关联，素材库中的原文件会保留。"} okText="移除图片" disabled={imageActionBusy} onOk={() => unlinkImage(detail, media)}>
                <Button type="text" size="mini" status="danger" icon={<Trash2 size={13}/>} loading={unlinkingImageId === media.id} disabled={imageActionBusy} aria-label={`删除 ${media.name}`}>删除</Button>
              </ConfirmPopover>
            </div>
          </figure>)}</div> : <Empty description="添加参考图片，记录资产的外观与细节" />}
        </section>
      </div> : <>
      <div className="section-title page-actions">
        <div className="page-intro"><h1>资产库</h1><p>管理人物、地点、物品、生物、载具等创作资产，保持故事中的视觉与设定一致。</p></div>
        <Space wrap>
          <Button icon={<GitBranch size={16}/>} onClick={() => setGraphOpen(true)}>关系图</Button>
          <Button
            className="role-create-button"

            type="primary"
            icon={<Plus size={18} />}
            onClick={() => make().catch((e) => Message.error(String(e)))}

          >
            创建资产
          </Button>
        </Space>
      </div>
      <div className="role-toolbar">
        <Select aria-label="资产类别筛选" value={categoryFilter} onChange={setCategoryFilter} style={{width: 132}}
          options={[{value: "all", label: "全部类别"}, ...ASSET_CATEGORIES]} />
        <Checkbox checked={showDisabled} onChange={setShowDisabled}>显示已禁用资产</Checkbox>
        <Input.Search aria-label="搜索资产名称或描述" placeholder="搜索资产名称或描述" value={query} onChange={setQuery} allowClear />
        <span className="helper role-total" role="status">共 {visibleRoles.length} 项资产</span>
      </div>
      {(search || data.assets.length > 0) && !visibleRoles.length && <div className="role-search-empty">
        <p className="helper">{search ? "没有匹配的资产，可更换搜索词、切换类别或显示已禁用资产。" : categoryFilter !== "all" ? "当前类别下没有符合条件的资产，可切换类别、显示已禁用资产或创建新资产。" : "当前没有启用的资产，可勾选“显示已禁用资产”查看并重新启用。"}</p>
        {search && <Button type="text" size="small" onClick={() => setQuery("")}>清空搜索</Button>}
      </div>}
      <div className="role-grid" >
        {pagedRoles.map((r, index) => (
          <Card key={r.id} className={`role-card${r.enabled === false ? " role-card-disabled" : ""}`} bodyStyle={{ padding: 16 }}

            role="group" aria-label={r.name}

>
            <div className="role-pic">
              {(r.images.find((image) => image.id === r.design_media_id) || r.images[0]) ? (
                <button type="button" className="role-image-zoom" onClick={() => openRoleImage(r, r.images.find((image) => image.id === r.design_media_id) || r.images[0])} aria-label={`放大查看${r.name}的资产图`} title="放大查看">
                  <img src={imageUrl(r.images.find((image) => image.id === r.design_media_id) || r.images[0])} alt={`${r.name}的资产图片`} />
                  <span><ZoomIn size={16} /> 放大查看</span>
                </button>
              ) : (
                r.name.slice(0, 1)
              )}
              <Tag className="role-kind">{assetCategoryLabel(r.category)}{r.enabled === false ? " · 已禁用" : ""}</Tag>
            </div>
            <button type="button" className="role-details-trigger" aria-label={`查看${r.name}的资产详情`} onClick={() => openRoleDetail(r.id)}>
              <h3>{r.name}</h3>
              <p>{r.description || "添加资产描述，保持生成的一致性。"}</p>
            </button>
            <div className="role-foot">
              <span className="role-asset-count">{r.images.length} 张资产图{supportsAudioReferences(r.category) && ` · ${r.audios?.length || 0} 段音频参考`}</span>
              <div className="role-card-actions">
              <Button type="text" size="mini" onClick={() => setEditing(r)}>
                设定
              </Button>
              <Button type="text" size="mini" loading={updatingRoleId === r.id} disabled={updatingRoleId !== null && updatingRoleId !== r.id}
                onClick={() => void changeRoleEnabled(r, r.enabled === false)}>
                {r.enabled === false ? "启用" : "禁用"}
              </Button>
              <ConfirmPopover
                title="删除这个资产？"
                content={`将删除「${r.name}」及其关联关系，素材库中的图片和音频文件会保留。删除后无法撤销。`}
                okText="删除资产"
                onOk={() =>
                  post("/assets/delete", {
                    project_id: data.project.id,
                    id: r.id,
                  }).then(reload).catch(error => { Message.error(String(error)); throw error; })
                }
              >
                <Button type="text" size="mini" status="danger">
                  删除
                </Button>
              </ConfirmPopover>
              </div>
            </div>
          </Card>
        ))}
      </div>
      {visibleRoles.length > 0 && <div className="asset-library-footer role-library-footer">
        <span className="asset-page-announcement" role="status" aria-live="polite">第 {currentAssetPage} 页，共 {assetPageCount} 页，当前 {pagedRoles.length} 项资产</span>
        <Pagination className="asset-pagination" current={currentAssetPage} pageSize={24} total={visibleRoles.length} onChange={changeAssetPage} showTotal />
      </div>}
      </>}
      <Modal visible={!!renamingMedia} title="重命名素材" okText="保存名称" confirmLoading={renamingMediaBusy}
        okButtonProps={{disabled:!renamingMedia?.name.trim()}} cancelButtonProps={{disabled:renamingMediaBusy}}
        maskClosable={!renamingMediaBusy} closable={!renamingMediaBusy} escToExit={!renamingMediaBusy}
        unmountOnExit onCancel={() => {if (!renamingMediaBusy) setRenamingMedia(null);}} onOk={renameMedia}>
        <Form layout="vertical"><Form.Item label="素材名称" required extra="名称会同步到素材库及其他引用此图片的资产。">
          <Input autoFocus aria-label="素材名称" value={renamingMedia?.name || ""} disabled={renamingMediaBusy}
            onChange={name => setRenamingMedia(current => current ? {...current,name} : null)} onPressEnter={renameMedia}/>
        </Form.Item></Form>
      </Modal>
      <ImagePreviewModal media={roleImagePreview} images={previewImages} onMediaChange={setRoleImagePreview} title="资产图预览" onClose={()=>setRoleImagePreview(null)} />
      <RoleEditor
        role={editing}
        initialSection={editorStart}
        data={data}
        onClose={() => { setEditing(null); setEditorStart("basic"); }}
        reload={reload}
      />
    </section>
  );
}
function RoleEditor({
  role,
  initialSection = "basic",
  data,
  onClose,
  reload,
}: {
  role: Asset | null;
  initialSection?: "basic" | "references";
  data: Snapshot;
  onClose: () => void;
  reload: () => void;
}) {
  const imageGeneration=useGenerationSelection(data.settings,"image");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [category, setCategory] = useState<AssetCategory>("person");
  const [design, setDesign] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [savingRole, setSavingRole] = useState(false);
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [importingAsset, setImportingAsset] = useState(false);
  const [pendingImage, setPendingImage] = useState<{id:number;name:string}|null>(null);
  const [renamingImage, setRenamingImage] = useState<{id:number;name:string}|null>(null);
  const [renamingImageBusy, setRenamingImageBusy] = useState(false);
  const [removingImageId, setRemovingImageId] = useState<number | null>(null);
  const [imagePreview, setImagePreview] = useState<Media | null>(null);
  const basicSection = useRef<HTMLElement>(null);
  const referenceSection = useRef<HTMLElement>(null);
  const generationSection = useRef<HTMLElement>(null);
  const editorBusy = generating || savingRole || importingAsset || renamingImageBusy || removingImageId !== null;
  const currentRole = data.assets.find((x) => x.id === role?.id) || role;
  useEffect(() => {
    setName(role?.name || "");
    setDescription(role?.description || "");
    setEnabled(role?.enabled !== false);
    setCategory(role?.category || "person");
    setDesign(role?.design_media_id || null);
    setAssetsOpen(false);
    setImagePreview(null);
    setPendingImage(null);
    setRenamingImage(null);
  }, [role]);
  const upload = async () => {
    if (!role || editorBusy) return;
    setImportingAsset(true);
    try {
      const source = await open({
        multiple: false,
        filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "gif", "svg"] }],
      });
      if (typeof source !== "string") return;
      const imported = await post<Media>("/media/import", {
        project_id: data.project.id,
        source_path: source,
      });
      await reload();
      setPendingImage({id:imported.id,name:""});
    } finally { setImportingAsset(false); }
  };
  const importAsset = async (mediaId: number) => {
    if (!role || editorBusy) return;
    setAssetsOpen(false);
    if (currentRole?.images.some(image => image.id === mediaId)) {
      setDesign(mediaId);
      return;
    }
    setPendingImage({id:mediaId,name:""});
  };
  const confirmRoleImage = async () => {
    if (!role || !pendingImage || importingAsset) return;
    if (!pendingImage.name.trim()) return Message.warning("请输入资产图片名称");
    setImportingAsset(true);
    try {
      await post("/assets/media/add", {
        project_id: data.project.id, asset_id: role.id,
        media_id: pendingImage.id, name: pendingImage.name.trim(),
      });
      setDesign(pendingImage.id);
      setPendingImage(null);
      await reload();
      Message.success("资产图片已添加，保存资产后设为主图");
    } catch (e) { Message.error(String(e)); }
    finally { setImportingAsset(false); }
  };
  const removeImage = async (id: number) => {
    if (!role || editorBusy) return;
    setRemovingImageId(id);
    try {
      await post("/assets/media/delete", {
        project_id: data.project.id,
        asset_id: role.id,
        media_id: id,
      });
      if (design === id) setDesign(currentRole?.images.find((image) => image.id !== id)?.id ?? null);
      if (imagePreview?.id === id) setImagePreview(null);
      await reload();
      Message.success("已从资产中删除图片，素材文件已保留");
    } finally { setRemovingImageId(null); }
  };
  const renameImage = async () => {
    if (editorBusy) return;
    if (!renamingImage || !renamingImage.name.trim()) return Message.warning("请输入图片名称");
    setRenamingImageBusy(true);
    try {
      await post("/media/rename", { project_id:data.project.id, id:renamingImage.id, name:renamingImage.name.trim() });
      await reload();
      setRenamingImage(null);
      Message.success("资产图片名称已更新，可用 @资产.图片名 引用");
    } catch(error) { Message.error(String(error)); }
    finally { setRenamingImageBusy(false); }
  };
  const generateRoleImage = async (operation: "t2i" | "i2i") => {
    if (!role || generating) return;
    if (!description.trim()) return Message.warning("请先填写资产描述");
    if (operation === "i2i" && !design) return Message.warning("请先选择一张资产设计图作为参考");
    setGenerating(true);
    try {
      const result = await post<Media>("/generations/image", {project_id:data.project.id, operation,
        prompt:resolvePrompt(description, data.assets), ...selectionPayload(imageGeneration.choice), aspect_ratio:"1:1", size:modelImageSize(imageGeneration.choice,"1:1",undefined,operation), image_media_ids:operation === "i2i" ? [design] : []});
      await reload();
      setPendingImage({id:result.id,name:""});
    } catch(e) { Message.error(String(e)); }
    finally { setGenerating(false); }
  };
  const saveRole = async () => {
    if (!role || editorBusy) return;
    if (!name.trim()) return Message.warning("请输入资产名称");
    setSavingRole(true);
    try {
      if (currentRole?.enabled !== false && !enabled && !await confirmDisableRole(name.trim())) return;
      await post("/assets/update", {project_id:data.project.id,id:role.id,name:name.trim(),description,enabled,category,design_media_id:design});
      await reload(); onClose();
    } catch(e) { Message.error(String(e)); }
    finally { setSavingRole(false); }
  };
  return (
    <Drawer
      className="role-editor-drawer"
      width="min(820px, 100vw)"
      title="资产设定"
      visible={!!role}
      afterOpen={() => { if (initialSection === "references") referenceSection.current?.scrollIntoView({block:"start"}); }}
      onCancel={() => { if (!editorBusy) onClose(); }}
      footer={
        <div className="role-editor-footer"><span>名称、描述与主图在保存后生效</span><Space>
          <Button disabled={editorBusy} onClick={onClose}>取消</Button>
          <Button type="primary" loading={savingRole} disabled={editorBusy && !savingRole} onClick={saveRole}>保存资产</Button>
        </Space></div>
      }
    >
      <nav className="role-editor-nav" aria-label="资产设定章节">
        <button type="button" onClick={() => basicSection.current?.scrollIntoView({block:"start"})}>基本信息</button>
        <button type="button" onClick={() => referenceSection.current?.scrollIntoView({block:"start"})}>参考素材 <span>{currentRole?.images.length || 0}</span></button>
        <button type="button" onClick={() => generationSection.current?.scrollIntoView({block:"start"})}>图片生成</button>
      </nav>
      <Form className="role-editor-form" layout="vertical" disabled={editorBusy}>
        <section ref={basicSection} className="role-editor-section" aria-label="基本信息">
        <div className="role-editor-section-heading"><h2>基本信息</h2><p>定义资产的身份、外观与故事背景</p></div>
        <div className="role-editor-basic-grid">
        <Form.Item label="资产名称" required>
          <Input aria-label="资产名称" value={name} onChange={setName} />
        </Form.Item>
        <Form.Item label="资产类别">
          <Select aria-label="资产类别" value={category} onChange={setCategory} options={[...ASSET_CATEGORIES]} disabled={editorBusy} />
        </Form.Item>
        </div>
        <div className="role-editor-enabled"><div><b>启用资产</b><p>启用后可通过 @ 引用资产及其命名图片</p></div><Switch aria-label="启用资产" checked={enabled} onChange={setEnabled} checkedText="启用" uncheckedText="禁用" disabled={editorBusy} /></div>
        <Form.Item label="资产描述">
          <Input.TextArea
            aria-label="资产描述"
            value={description}
            onChange={setDescription}
            placeholder="外观、材质、空间布局、标志性特征、画风或故事背景等。此描述可直接进入生成 Prompt。"
            autoSize={{ minRows: 4, maxRows: 8 }}
          />
        </Form.Item>
        </section>
        <section ref={referenceSection} className="role-editor-section" aria-label="参考素材">
          <div className="role-editor-section-heading"><h2>参考素材</h2><p>添加图片与声音，保持资产在创作中的一致性</p></div>
          <div className="role-editor-image-heading"><h3>图片参考 <span>{currentRole?.images.length || 0}</span></h3><Space wrap>
              <Button
                icon={<ImagePlus size={15} />}
                disabled={editorBusy}
                onClick={() => setAssetsOpen(true)}
              >
                从素材库选择
              </Button>
              <Button
                icon={<Upload size={15} />}
                disabled={editorBusy}
                onClick={() => upload().catch((e) => Message.error(String(e)))}
              >
                导入资产图片
              </Button>
            </Space></div>
            <p className="role-editor-reference-note">点击图片放大预览，选择主图后保存资产。添加、重命名与移除参考素材会立即生效。</p>
            <div className="role-image-library">
              <div className="role-image-library-heading">
                <b>已关联图片</b>
                <span>{design ? "主图已选择" : "尚未选择主图"}</span>
              </div>
              {currentRole?.images.length ? <div className="role-editor-image-grid">
                {currentRole.images.map((m) => (
                  <article
                    key={m.id}
                    className={`role-editor-image-card${design === m.id ? " selected" : ""}`}
                  >
                    <button type="button" className="role-editor-image-preview" aria-label={`放大预览 ${m.name}${design === m.id ? "，当前主图" : ""}`} onClick={() => setImagePreview(m)}>
                      <img src={imageUrl(m)} alt="" loading="lazy" decoding="async" />
                      <span className="role-editor-image-zoom"><ZoomIn size={16}/>预览</span>
                      {design === m.id && <span className="role-editor-main-badge">主图</span>}
                    </button>
                    <p className="role-editor-image-name" title={m.name}>{m.name}</p>
                    <div className="role-editor-image-actions">
                    <Button type="text" size="mini" className="role-editor-primary" disabled={editorBusy || design === m.id} aria-label={`设为主图 ${m.name}`} onClick={() => setDesign(m.id)}>{design === m.id ? "当前主图" : "设为主图"}</Button>
                    <Button type="text" size="mini" icon={<Pencil size={14}/>} disabled={editorBusy} aria-label={`编辑图片名称 ${m.name}`} title="编辑图片名称" onClick={() => setRenamingImage({id:m.id,name:m.name})}/>
                    <ConfirmPopover
                      title="移除这张资产图片？"
                      content="将立即解除图片关联，素材库中的原文件会保留。"
                      okText="移除图片"
                      disabled={editorBusy}
                      onOk={() => removeImage(m.id).catch((e) => { Message.error(String(e)); throw e; })}
                    >
                      <Button
                        type="text" size="mini" status="danger" icon={<Trash2 size={14}/>}
                        disabled={editorBusy} loading={removingImageId === m.id}
                        aria-label={`删除 ${m.name}`}
                        title="从资产中删除图片，保留素材文件"
                      />
                    </ConfirmPopover>
                    </div>
                  </article>
                ))}
              </div> : <p className="subtle role-image-empty">还没有关联图片。可从素材库添加多张，或导入本地图片。</p>}
            </div>
        {currentRole && supportsAudioReferences(category) && (supportsAudioReferences(currentRole.category)
          ? <RoleAudioReferences key={currentRole.id} role={currentRole} data={data} reload={reload} editable/>
          : <p className="helper">保存资产类别后可添加音频参考。</p>)}
        </section>
        <section ref={generationSection} className="role-editor-section" aria-label="图片生成">
        <div className="role-editor-section-heading"><h2>图片生成</h2><p>使用资产描述生成图片，或以当前主图为参考</p></div>
        <GenerationSelector settings={data.settings} kind="image" value={imageGeneration.value} onChange={imageGeneration.setValue} disabled={editorBusy}/>
        <Form.Item label="生成方式">
          <Space>
            <Button icon={<Sparkles size={15} />} type="primary" loading={generating} disabled={editorBusy && !generating} onClick={() => generateRoleImage("t2i")}>
              文生图
            </Button>
            <Button icon={<ImagePlus size={15} />} disabled={editorBusy || !design} onClick={() => generateRoleImage("i2i")}>图生图</Button>
          </Space>
          <p className="subtle">
            使用上方选择的图片渠道与模型生成。
          </p>
        </Form.Item>
        </section>
      </Form>
      <AssetImagePicker
        visible={!!role && assetsOpen}
        label="资产设计图"
        value={design}
        data={data}
        busy={editorBusy}
        onSelect={importAsset}
        onClose={() => { if (!importingAsset) setAssetsOpen(false); }}
      />
      <Modal visible={!!pendingImage} title="设置资产图片名称" okText="确认添加" confirmLoading={importingAsset}
        okButtonProps={{disabled:!pendingImage?.name.trim()}} cancelButtonProps={{disabled:importingAsset}}
        maskClosable={!importingAsset} closable={!importingAsset}
        onCancel={() => { if (!importingAsset) setPendingImage(null); }} onOk={confirmRoleImage}>
        <Form layout="vertical" disabled={importingAsset}><Form.Item label="资产图片名称" required extra="填写名称后才会关联到资产，可用 @资产.图片名称 引用。">
          <Input autoFocus aria-label="资产图片名称" value={pendingImage?.name || ""} placeholder="请输入名称，例如：正面、侧面、校服"
            onChange={name => setPendingImage(current => current ? {...current,name} : null)} onPressEnter={confirmRoleImage}/>
        </Form.Item></Form>
      </Modal>
      <Modal visible={!!renamingImage} title="编辑资产图片名称" okText="保存名称" confirmLoading={renamingImageBusy} okButtonProps={{disabled:!renamingImage?.name.trim()}} maskClosable={!renamingImageBusy} closable={!renamingImageBusy} cancelButtonProps={{disabled:renamingImageBusy}} onCancel={() => {if (!renamingImageBusy) setRenamingImage(null);}} onOk={renameImage}>
        <Form layout="vertical"><Form.Item label="图片名称" extra="图生图时可用 @资产.图片名称 引用这张图片。">
          <Input autoFocus aria-label="图片名称" disabled={renamingImageBusy} value={renamingImage?.name || ""} onChange={name => setRenamingImage(current => current ? {...current,name} : null)} onPressEnter={renameImage}/>
        </Form.Item></Form>
      </Modal>
      <ImagePreviewModal media={imagePreview} images={currentRole?.images || []} onMediaChange={setImagePreview} title="资产图预览" onClose={()=>setImagePreview(null)} />
    </Drawer>
  );
}
export function Prompts({ data, reload }: { data: Snapshot; reload: () => void }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [editorTitle, setEditorTitle] = useState("新建 Prompt");
  const [editing, setEditing] = useState<{
    id?: number;
    name: string;
    content: string;
    category: string;
  } | null>(null);
  const openEditor = (value: NonNullable<typeof editing>, title: string) => {
    setSaveError(""); setEditorTitle(title); setEditing({...value});
  };
  const add = () => openEditor({name: "", content: "", category: "通用"}, "新建 Prompt");
  const savePrompt = async () => {
    if (!editing || saving || !editing.name.trim() || !editing.content.trim()) return;
    setSaving(true); setSaveError("");
    try {
      await post(editing.id == null ? "/prompts" : "/prompts/update", {
        project_id: data.project.id, ...editing, name: editing.name.trim(), content: editing.content.trim(),
      });
      setEditing(null);
      Message.success("Prompt 已保存");
      await Promise.resolve(reload()).catch(error => Message.error(`Prompt 已保存，刷新列表失败：${String(error)}`));
    } catch (error) { setSaveError(String(error)); }
    finally { setSaving(false); }
  };
  const search = query.trim().toLocaleLowerCase();
  const matches = (prompt: {name: string; content: string; category: string}) =>
    (category === "all" || prompt.category === category) &&
    (!search || [prompt.name, prompt.content, prompt.category].some(value => value.toLocaleLowerCase().includes(search)));
  const presets = STYLE_PRESETS.filter(matches);
  const prompts = data.prompts.filter(matches);
  const filtering = !!search || category !== "all";
  const resetFilters = () => { setQuery(""); setCategory("all"); };
  const categories = Array.from(new Set(["通用", "资产", "片段", "风格", ...data.prompts.map(prompt => prompt.category)])).filter(Boolean);
  return (
    <section className="prompt-library">
      <div className="section-title page-actions">
        <div className="page-intro"><h1>Prompt 库</h1><p>管理常用提示词，在资产与片段生成时复用。</p></div>
        <Button
          type="primary"
          className="prompt-create-button"
          icon={<Plus size={16} />}
          onClick={add}
        >
          新建 Prompt
        </Button>
      </div>
      <div className="prompt-library-toolbar">
        <Input.Search aria-label="搜索 Prompt" placeholder="搜索名称、内容或分类" value={query} onChange={setQuery} allowClear />
        <Select aria-label="Prompt 分类筛选" value={category} onChange={setCategory}>
          <Select.Option value="all">全部分类</Select.Option>
          {categories.map(value => <Select.Option key={value} value={value}>{value}</Select.Option>)}
        </Select>
        <span className="helper" role="status">{filtering ? `找到 ${presets.length + prompts.length} 条` : `共 ${STYLE_PRESETS.length + data.prompts.length} 条`}</span>
        {filtering && <Button type="text" size="small" onClick={resetFilters}>清除筛选</Button>}
      </div>
      {(!filtering || presets.length > 0) && <><div className="prompt-library-heading">
        <h2>预设风格 <span className="prompt-section-count">{presets.length}</span></h2>
        <p>生成图片时可直接选用，也可另存后调整为自己的风格。</p>
      </div>
      <div className="prompt-grid prompt-presets">
        {presets.map((preset) => (
          <Card key={preset.id} className="prompt-card" title={<span title={preset.name}>{preset.name}</span>}>
            <p>{preset.content}</p>
            <div className="prompt-card-actions"><Button size="small" onClick={() => openEditor({ name: preset.name, content: preset.content, category: preset.category }, "另存 Prompt")}>另存为我的 Prompt</Button></div>
          </Card>
        ))}
      </div></>}
      {(!filtering || prompts.length > 0) && <div className="prompt-library-heading"><h2>我的 Prompt <span className="prompt-section-count">{prompts.length}</span></h2></div>}
      {!data.prompts.length && !filtering && <EmptyState
        title="还没有自定义 Prompt"
        description="新建一条提示词，或从上方预设风格中另存为你自己的版本。"
        action={<Button type="primary" icon={<Plus size={16} />} onClick={add}>新建 Prompt</Button>}
      />}
      {filtering && !presets.length && !prompts.length && <EmptyState title="没有找到匹配的 Prompt" description="试试其他关键词，或清除筛选查看全部提示词。" action={<Button onClick={resetFilters}>清除筛选</Button>} />}
      <div className="prompt-grid">
        {prompts.map((p) => (
          <Card
            key={p.id}
            className="prompt-card"
            title={<span title={p.name}>{p.name}</span>}
          >
            <Tag>{p.category}</Tag>
            <p>{p.content || "尚未填写内容"}</p>
            <div className="prompt-card-actions"><Button size="small" onClick={() => openEditor(p, "编辑 Prompt")} icon={<Pencil size={14} />}>编辑</Button></div>
          </Card>
        ))}
      </div>
      <Modal
        title={editorTitle}
        className="prompt-editor-modal"
        visible={!!editing}
        onCancel={() => !saving && setEditing(null)}
        onOk={savePrompt}
        okText="保存 Prompt"
        confirmLoading={saving}
        okButtonProps={{disabled: !editing?.name.trim() || !editing?.content.trim()}}
        cancelButtonProps={{disabled: saving}}
        maskClosable={!saving}
        escToExit={!saving}
        unmountOnExit
      >
        <Form layout="vertical">
          <Form.Item label="名称" required>
            <Input
              aria-label="Prompt 名称"
              placeholder="为这条提示词起个名字"
              autoFocus
              disabled={saving}
              value={editing?.name}
              onChange={(v) => setEditing((x) => (x ? { ...x, name: v } : x))}
            />
          </Form.Item>
          <Form.Item label="分类">
            <Select
              aria-label="Prompt 分类"
              disabled={saving}
              value={editing?.category}
              onChange={(v) =>
                setEditing((x) => (x ? { ...x, category: v } : x))
              }
            >
              {categories.map(value => <Select.Option key={value} value={value}>{value}</Select.Option>)}
            </Select>
          </Form.Item>
          <Form.Item label="Prompt 内容" required>
            <Input.TextArea
              aria-label="Prompt 内容"
              disabled={saving}
              value={editing?.content}
              onChange={(v) =>
                setEditing((x) => (x ? { ...x, content: v } : x))
              }
              autoSize={{ minRows: 5, maxRows: 12 }}
              placeholder="用自然语言描述镜头、画风、光线与主体…"
            />
          </Form.Item>
          {saveError && <p className="prompt-save-error" role="alert">保存失败：{saveError}</p>}
        </Form>
      </Modal>
    </section>
  );
}
