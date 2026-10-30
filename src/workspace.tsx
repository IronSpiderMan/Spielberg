import { RoleAudioReferences } from "./components/RoleAudioReferences";
import { PreviewVideo, VideoPreviewModal } from "./components/VideoPreviewModal";
import { sceneVideoPrompt } from "./core";
import { ReferenceMediaPicker } from "./components/generation/ReferenceMediaPicker";
import { buildVideoRequest } from "./generation-request";
import { RoleImagePicker } from "./components/RoleImagePicker";
import { ImagePreviewModal, PreviewImage } from "./components/ImagePreviewModal";
import { usePromptOptimization } from "./hooks/usePromptOptimization";
import { supportedPastedImages, useImageUpload } from "./hooks/useImageUpload";
import { AssetImagePicker } from "./components/AssetImagePicker";
import { SkillsSettings } from "./SkillsSettings";
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
Modal,
Popconfirm,
Pagination,
Select,
Space,
Tag,
Tabs,
Typography
} from "@arco-design/web-react";
import { open,save as saveDialog } from "./platform";
import { isLocalDesktop } from "./transport";
import {
ArrowDown,
ArrowLeft,
ArrowUp,
ChevronDown,
ChevronRight,
Pencil,
Download,
Film,
ImagePlus,
Play,
Plus,
Save,
Sparkles,
Trash2,
Upload,
Users,
WandSparkles,
ZoomIn
} from "lucide-react";


import { api,defaultOptions,normalizeGenerationSize,Episode,FrameKey,GenerationOptions,imageUrl,Media,ModelSettings,post,Project,Role,Scene,Snapshot } from "./core";
import { confirmDiscard,useEditGuard } from "./edit-guard";
import { resolvePrompt, resolveH3Prompt } from "./resolve-prompt";
import { type Storyboard } from "./StoryboardEditor";
import ScreenplayManager, { type ScreenplayEditorHandle } from "./ScreenplayManager";
import { PromptInput } from "./PromptInput";
import { findMentions, promptMentions, syncMentionReferences } from "./prompt-mentions";
import { EmptyState } from "./ui";
import { STYLE_PRESETS } from "./prompt-presets";
import { PROMPT_TEMPLATES } from "./prompt-templates";
const SequencePreview=lazy(()=>import("./creation").then(m=>({default:m.SequencePreview})));
const ImageStudio=lazy(()=>import("./creation").then(m=>({default:m.ImageStudio})));

function videoRequest(scene: Scene, settings: ModelSettings, roles: Role[], prompts: Snapshot["prompts"] = []) {
  if(scene.creation_mode === "canvas") throw new Error(`${scene.title}：请进入画布，使用视频节点生成；已有场景视频可直接合并`);
  const options = scene.generation_options || defaultOptions;
  const mode = options.video_mode || ((options.reference_media_ids?.length || scene.reference_media_id) ? "i2v" : "fl2v");
  const request=buildVideoRequest({mode,prompt:resolvePrompt(sceneVideoPrompt(scene),roles,prompts),label:scene.title,sceneId:scene.id,
    duration:options.duration,ratio:options.aspect_ratio,size:options.size,firstId:scene.first_media_id,lastId:scene.last_media_id,
    referenceIds:options.reference_media_ids??(scene.reference_media_id?[scene.reference_media_id]:[]),
    referenceVideoIds:options.reference_video_media_ids,referenceAudioIds:options.reference_audio_media_ids});
  if (!(settings.video?.base_url || settings.video?.url || settings[mode]?.url)) throw new Error("请先配置视频生成 Base URL");
  return request;
}
const sceneVideos = (scene: Scene) =>
  scene.videos || (scene.video_media ? [scene.video_media] : []);
export function Studio({
  data,
  reload,
  changePage,
  editScene,
}: {
  data: Snapshot;
  reload: () => void;
  changePage: (v: string) => void;
  editScene: (scene: Scene) => void;
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
  const scenes = episode?.scenes || [];
  const ready = scenes.filter((s) => s.video_media_id).length;
  const signature = JSON.stringify([
    episode?.id,
    scenes.map((s) => [s.id, s.video_media_id]),
  ]);
  useEffect(() => setMerged(null), [signature]);
  const move = async (index: number, offset: number) => {
    if (!episode) return;
    setSaving(true);
    try {
      const ids = scenes.map((s) => s.id);
      [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
      await post("/scenes/reorder", {
        project_id: data.project.id,
        episode_id: episode.id,
        scene_ids: ids,
      });
      await reload();
    } catch (e) {
      Message.error(String(e));
    } finally {
      setSaving(false);
    }
  };
  const select = async (scene: Scene, id: number) => {
    setSaving(true);
    try {
      await post("/scenes/select-video", {
        project_id: data.project.id,
        scene_id: scene.id,
        media_id: id,
      });
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
      Message.success("剧集已合并并保存到资产库");
    } catch (e) {
      Message.error(String(e));
    } finally {
      setMerging(false);
    }
  };
  if (editing) return <EpisodeEditor episode={editing} project={data.project} data={data} editScene={editScene} onClose={() => setEditing(null)} reload={reload}/>;
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
          {ready} / {scenes.length} 个场景已选视频
        </span>
        <Button
          type="primary"
          icon={<Play size={16} />}
          loading={merging}
          disabled={!scenes.length || ready !== scenes.length || saving}
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
          <SequencePreview scenes={scenes} />
        )}
      </div>
      <div className="cut-arrangement">
      <div className="timeline-head">
        <div>
          <h2>场景编排</h2>
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
        {scenes.map((scene, index) => (
          <div className="cut-row" key={scene.id}>
            <div className="cut-order">
              <b>{String(index + 1).padStart(2, "0")}</b>
              <Space>
                <Button
                  aria-label={`上移${scene.title}`}
                  size="mini"
                  disabled={!index || saving || merging}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </Button>
                <Button
                  aria-label={`下移${scene.title}`}
                  size="mini"
                  disabled={index === scenes.length - 1 || saving || merging}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </Button>
              </Space>
            </div>
            <SceneThumb scene={scene} media={data.media} />
            <div className="cut-copy">
              <b>{scene.title}</b>
              <p>{scene.description || "尚未填写描述"}</p>
              <Button
                type="text"
                size="mini"
                disabled={merging}
                onClick={() => editScene(scene)}
              >
                编辑场景
              </Button>
            </div>
            <div className="cut-version">
              <Select
                aria-label={`${scene.title}的视频版本`}
                disabled={saving || merging}
                value={scene.video_media_id || undefined}
                placeholder="选择当前场景的视频"
                onChange={(id) => select(scene, id)}
              >
                {sceneVideos(scene).map((video, i) => (
                  <Select.Option key={video.id} value={video.id}>
                    视频 {i + 1} · {video.name}
                  </Select.Option>
                ))}
              </Select>
              {scene.video_media && (
                <VideoAsset video={scene.video_media} scene={scene} projectId={data.project.id} reload={reload} />
              )}
            </div>
          </div>
        ))}
        {!scenes.length && <Empty description="请在剧集页面添加场景" />}
      </div>
      </div>
      </div>
      <EpisodeEditor
        episode={editing}
        project={data.project}
        data={data}
        editScene={editScene}
        onClose={() => setEditing(null)}
        reload={reload}
      />
    </section>
  );
}
function EpisodeCover({episode}: {episode: {cover_media?: Media; scenes?: Scene[]}}) {
  const scene = episode.scenes?.[0];
  const video = scene && (sceneVideos(scene).find(video => video.id === scene.video_media_id) || sceneVideos(scene)[0]);
  return <div className="episode-cover">{episode.cover_media ? <img src={imageUrl(episode.cover_media)} alt="剧集封面"/> : video ? <video src={`${imageUrl(video)}#t=0.001`} muted preload="auto" aria-label="默认剧集封面"/> : <Film size={28}/>}</div>;
}
function VideoAsset({video, scene, projectId, reload}: {video:Media;scene?:Scene;projectId:string;reload?:()=>void}) {
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
    <video ref={inlinePlayer} src={imageUrl(video)} controls muted playsInline preload="metadata" onLoadedData={event=>{const el=event.currentTarget;if(el.duration>0)el.currentTime=Math.min(.1,el.duration/2);}} onDoubleClick={event=>{event.preventDefault();openPreview();}}/>
    <Space wrap>
      <Button size="mini" icon={<ZoomIn size={14}/>} onClick={openPreview}>放大预览</Button>
      <Button size="mini" icon={<Download size={14}/>} onClick={download}>下载</Button>
      {scene && reload && <Button size="mini" type={scene.video_media_id === video.id ? "secondary" : "primary"}
        disabled={deleting || selecting || scene.video_media_id === video.id} loading={selecting}
        onClick={async()=>{
          if (selecting || deleting || scene.video_media_id === video.id) return;
          setSelecting(true);
          try {
            await post("/scenes/select-video",{project_id:projectId,scene_id:scene.id,media_id:video.id});
            await reload();
            Message.success("已设为主视频");
          } catch(e){Message.error(String(e));} finally {setSelecting(false);}
        }}>{scene.video_media_id === video.id ? "主视频" : "设为主视频"}</Button>}
      {scene && <Popconfirm title="删除这个场景视频版本？" onOk={async()=>{
        setDeleting(true);
        try {await post("/scenes/delete-video",{project_id:projectId,scene_id:scene.id,media_id:video.id});await reload?.();Message.success("视频版本已删除");} catch(e){Message.error(String(e));} finally {setDeleting(false);}
      }}><Button size="mini" status="danger" disabled={selecting || deleting} loading={deleting} icon={<Trash2 size={14}/>}>删除</Button></Popconfirm>}
    </Space>
    <VideoPreviewModal media={preview?video:null} projectId={projectId} initialTime={previewTime} onClose={()=>setPreview(false)} />
  </div>;
}
type BackgroundJob = {id:number;project_id:string;project_name:string;scene_id?:number;operation:string;status:string;prompt:string;created_at:string;updated_at:string;error?:string;result?:Media};
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
    {error && <p role="alert">{error}</p>}
    <div className="task-list">{jobs.map(job=><Card key={`${job.project_id}-${job.id}`} className="task-card">
      <div className="task-head">
        <span className={`task-state task-${job.status}`} aria-hidden="true" />
        <b>{job.project_name}</b>
        <Tag>{job.operation.includes("image")?"图片生成":job.operation.includes("video")?"视频生成":"剧集合并"}</Tag>
        <Tag className="task-status" color={job.status==="failed"?"red":job.status==="completed"?"green":"blue"}>{labels[job.status]||job.status}</Tag>
        <small className="task-time">{new Date(Number(job.created_at)*1000).toLocaleString()}</small>
      </div>
      <TaskText text={job.prompt}/>
      <small className="task-id">任务 #{job.id}</small>
      {job.error && <TaskText text={job.error} error/>}
      {job.result?.kind==="video" && <VideoAsset video={job.result} projectId={job.project_id}/>}
      {job.result?.kind==="image" && <PreviewImage className="task-image" media={job.result} alt="生成结果"/>}
    </Card>)}</div>
    <div style={{textAlign:"center",padding:24}}>
      {(hasMore||loading||error)&&<Button loading={loading} onClick={()=>loadMore.current()}>{error?"重试":hasMore?"加载更多":"加载中"}</Button>}
      {!hasMore&&!loading&&jobs.length>0&&<span className="helper">已加载全部任务</span>}
    </div>
    {!jobs.length&&!loading&&!error&&<EmptyState
      title={filter==="all"?"暂无后台任务":"暂无符合此状态的任务"}
      description={filter==="all"?"生成图片、视频或合并剧集后，进度和结果会按时间出现在这里。":"切换到「全部状态」查看其他运行记录。"}
    />}</section>;
}
function SceneThumb({ scene, media, onPreview }: { scene: Scene; media: Media[]; onPreview?: () => void }) {
  const thumbnail = scene.first_media || media.find(m=>m.id===scene.first_media_id&&m.kind==='image')
    || scene.last_media || media.find(m=>m.id===scene.last_media_id&&m.kind==='image')
    || (scene.generation_options?.reference_media_ids || []).map(id=>media.find(m=>m.id===id&&m.kind==='image')).find(Boolean)
    || scene.reference_media || media.find(m=>m.id===scene.reference_media_id&&m.kind==='image');
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
  data,
  reload,
  editScene,
}: {
  data: Snapshot;
  reload: () => void;
  editScene: (scene: Scene, isNew: boolean) => void;
  initialEpisodeId?:number;
}) {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [episode, setEpisode] = useState<{
    id: number;
    title: string;
    description: string;
    cover_media?: Media;
    scenes?: Scene[];
  } | null>(null);
  useEffect(()=>{if(initialEpisodeId)setEpisode(data.episodes.find(e=>e.id===initialEpisodeId)||null);},[initialEpisodeId]);
  const [batch, setBatch] = useState<Episode | null>(null);
  const [count, setCount] = useState(1);
  const [batchMode, setBatchMode] = useState("generate");
  const [batchResult, setBatchResult] = useState<Media | null>(null);
  const [progress, setProgress] = useState("");
  const [running, setRunning] = useState(false);
  const [reorderingEpisodes,setReorderingEpisodes]=useState(false);
  const moveEpisode=async(index:number,offset:number)=>{const ids=data.episodes.map(item=>item.id);[ids[index],ids[index+offset]]=[ids[index+offset],ids[index]];setReorderingEpisodes(true);try{await post("/episodes/reorder",{project_id:data.project.id,episode_ids:ids});reload();}catch(e){Message.error(String(e));}finally{setReorderingEpisodes(false);}};
  const [failures, setFailures] = useState<string[]>([]);
  const [previewSceneId, setPreviewSceneId] = useState<number | null>(null);
  const [previewVideoId, setPreviewVideoId] = useState<number | null>(null);
  const [continuousPreview, setContinuousPreview] = useState(false);
  const previewScene = data.episodes.flatMap((item) => item.scenes).find((scene) => scene.id === previewSceneId);
  const previewVideos = previewScene ? sceneVideos(previewScene) : [];
  const previewVideo = previewVideos.find((video) => video.id === previewVideoId) || previewVideos[0];
  const previewPlaylist = previewScene ? [...(data.episodes.find(item => item.scenes.some(scene => scene.id === previewScene.id))?.scenes || [])].sort((a,b)=>a.sort_order-b.sort_order || a.id-b.id).filter(scene=>sceneVideos(scene).length) : [];
  const openScenePreview = (scene: Scene) => {
    const videos = sceneVideos(scene);
    if (!videos.length) return;
    setPreviewSceneId(scene.id);
    setPreviewVideoId(scene.video_media_id || videos[0].id);
  };
  const generateBatch = async () => {
    if (!batch) return;
    if (batchMode === "existing") {
      setRunning(true); setBatchResult(null);
      try {setBatchResult(await post<Media>("/episodes/merge", {project_id: data.project.id, episode_id: batch.id})); await reload(); Message.success("合并完成，已保存到资产库");}
      catch(e) {Message.error(String(e));} finally {setRunning(false);} return;
    }
    let requests: ReturnType<typeof videoRequest>[];
    try {
      requests = batch.scenes.map((scene) =>
        videoRequest(scene, data.settings, data.roles, data.prompts),
      );
    } catch (e) {
      Message.error(String(e));
      return;
    }
    setRunning(true);
    setFailures([]);
    const errors: string[] = [];
    let done = 0;
    try {
      for (const request of requests) {
        for (let i = 0; i < count; i++) {
          setProgress(`正在生成 ${done + 1} / ${requests.length * count}`);
          try {
            await post("/generations/video", {
              project_id: data.project.id,
              ...request,
            });
          } catch (e) {
            errors.push(
              `场景 ${batch.scenes.find((s) => s.id === request.scene_id)?.title}，视频 ${i + 1}：${String(e)}`,
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
  const [inserting, setInserting] = useState<number | null>(null);
  const [copyingScene, setCopyingScene] = useState<number | null>(null);
  const copyScene = async (scene: Scene) => {
    setCopyingScene(scene.id);
    try {
      await post("/scenes/duplicate", { project_id: data.project.id, id: scene.id });
      await reload();
      Message.success("场景已复制");
    } catch (e) { Message.error(String(e)); }
    finally { setCopyingScene(null); }
  };
  const [sceneCreation,setSceneCreation]=useState<number|null>(null);
  const [creationMode,setCreationMode]=useState<"default"|"canvas">("default");
  const [newSceneTitle,setNewSceneTitle]=useState("");
  const makeScene = async (id: number) => {
    setInserting(id);
    try {
    const x = await post<Scene>("/scenes", {
      project_id: data.project.id,
      episode_id: id,
      title: newSceneTitle.trim() || `场景 ${(data.episodes.find(ep => ep.id === id)?.scenes.length ?? 0) + 1}`,
      creation_mode: creationMode,
      description: "",
    });
    await reload();
    setSceneCreation(null);
    editScene(x, true);
    } finally { setInserting(null); }
  };
  if (episode) return <EpisodeEditor episode={episode} project={data.project} data={data} editScene={scene => editScene(scene, false)} onClose={() => setEpisode(null)} reload={reload}/>;
  return (
    <section>
      <div className="section-title page-actions">
        <div className="page-intro"><h1>剧集管理</h1><p>管理剧集、场景与生成素材。</p></div>
        <Button
          type="primary"
          icon={<Plus size={16} />}
          onClick={() => makeEpisode().catch((e) => Message.error(String(e)))}
        >
          新建剧集
        </Button>
      </div>
      <div className="episode-list">
        {data.episodes.length ? (
          data.episodes.map((ep, n) => (
            <Card key={ep.id} className="episode-card">
              <div className="episode-top">
                <EpisodeCover episode={ep} />
                <div className="episode-number">
                  EP {String(n + 1).padStart(2, "0")}
                </div>
                <div className="episode-info">
                  <h3>{ep.title}</h3>
                  <p>{ep.description || "点击编辑剧集简介"}</p>
                </div>
                <Space size={2}><Button size="mini" aria-label="上移剧集" title="上移剧集" disabled={reorderingEpisodes||n===0} icon={<ArrowUp size={14}/>} onClick={()=>void moveEpisode(n,-1)}/><Button size="mini" aria-label="下移剧集" title="下移剧集" disabled={reorderingEpisodes||n===data.episodes.length-1} icon={<ArrowDown size={14}/>} onClick={()=>void moveEpisode(n,1)}/></Space>
                <Button type="text" aria-expanded={!collapsed.has(ep.id)} icon={collapsed.has(ep.id) ? <ChevronRight size={16}/> : <ChevronDown size={16}/>} onClick={() => setCollapsed(current => {const next = new Set(current); next.has(ep.id) ? next.delete(ep.id) : next.add(ep.id); return next;})}>{ep.scenes.length} 个场景</Button>
                <Button
                  type="primary"
                  disabled={!ep.scenes.length || running}
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
                <Popconfirm
                  title="确认删除这集及全部剧本、分镜和场景？"
                  onOk={() =>
                    post("/episodes/delete", {
                      project_id: data.project.id,
                      id: ep.id,
                    }).then(reload)
                  }
                >
                  <Button
                    type="text"
                    status="danger"
                    icon={<Trash2 size={15} />}
                  />
                </Popconfirm>
              </div>
              <div className="scene-list" hidden={collapsed.has(ep.id)}>
                {ep.scenes.map((s, i) => (
                  <div className="scene-row" key={s.id}>
                    <span>{String(i + 1).padStart(2, "0")}</span>
                    <SceneThumb scene={s} media={data.media} onPreview={sceneVideos(s).length ? () => openScenePreview(s) : undefined} />
                    <div className="scene-copy">
                      <div className="scene-title-line">
                        <b>{s.title}</b>
                        {s.creation_mode === "canvas" && <Tag className="scene-mode">画布</Tag>}
                        <Tag className="scene-state" color={s.video_media_id ? "green" : "gray"}>
                          {s.video_media_id ? "视频已就绪" : (s.first_media_id || s.last_media_id || s.reference_media_id || s.generation_options?.reference_media_ids?.length) ? "已设画面" : "待制作"}
                        </Tag>
                      </div>
                      <p>{s.description || "尚未填写镜头描述"}</p>
                    </div>
                    <div className="scene-actions">
                    <SceneOrderControls episode={ep} index={i} project={data.project} reload={reload}/>
                    <Button size="mini" disabled={!sceneVideos(s).length} icon={<Play size={13}/>} onClick={() => openScenePreview(s)}>预览</Button>
                    <Button size="mini" onClick={() => editScene(s, false)}>编辑</Button>
                    <Button size="mini" loading={copyingScene === s.id} disabled={copyingScene !== null || inserting !== null} onClick={() => void copyScene(s)}>复制</Button>
                    <Popconfirm title="确认删除这个场景？场景中的视频版本关联也会移除。" onOk={async()=>{
                      try {await post("/scenes/delete",{project_id:data.project.id,id:s.id});await reload();Message.success("场景已删除");} catch(e){Message.error(String(e));}
                    }}><Button size="mini" status="danger" icon={<Trash2 size={14}/>}>删除</Button></Popconfirm>
                    </div>
                  </div>
                ))}
                <Button
                  loading={inserting === ep.id}
                  disabled={inserting !== null}
                  className={`empty-scene${ep.scenes.length ? " scene-create-button" : ""}`}
                  type="text"
                  icon={<Plus size={14} />}
                  onClick={() =>
                    { setSceneCreation(ep.id); setCreationMode("default"); setNewSceneTitle(`场景 ${ep.scenes.length+1}`); }
                  }
                >
                  新建场景
                </Button>
              </div>
            </Card>
          ))
        ) : (
          <EmptyState
            title="还没有剧集"
            description="创建第一个剧集，把故事排成连续的场景与镜头。"
            action={<Button type="primary" icon={<Plus size={16} />} onClick={() => void makeEpisode().catch((e) => Message.error(String(e)))}>新建剧集</Button>}
          />
        )}
      </div>
      <Modal title="新建场景" visible={sceneCreation!==null} confirmLoading={inserting!==null} onCancel={()=>{if(inserting===null)setSceneCreation(null);}} onOk={()=>sceneCreation!==null?makeScene(sceneCreation).catch(e=>{Message.error(String(e));throw e;}):undefined}>
        <Form layout="vertical"><Form.Item label="场景名称"><Input aria-label="新场景名称" value={newSceneTitle} onChange={setNewSceneTitle}/></Form.Item>
        <Form.Item label="创建方式"><div className="scene-creation-options">
          <button type="button" className={creationMode==="default"?"selected":""} aria-pressed={creationMode==="default"} onClick={()=>setCreationMode("default")}><b>默认方式</b><span>使用场景表单设置画面、描述和生成参数</span></button>
          <button type="button" className={creationMode==="canvas"?"selected":""} aria-pressed={creationMode==="canvas"} onClick={()=>setCreationMode("canvas")}><b>画布方式</b><span>在画布中连接图片、音频与视频节点创作</span></button>
        </div></Form.Item></Form>
      </Modal>
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
            <Button type="primary" loading={running} disabled={batchMode === "existing" && !batch?.scenes.every(s => s.video_media_id)} onClick={generateBatch}>
              {batchMode === "existing" ? "合并已有视频" : `生成 ${count * (batch?.scenes.length || 0)} 个视频`}
            </Button>
          </Space>
        }
      >
        <p className="batch-generation-help">
          使用各场景已保存的描述、图片选择、时长和比例。新视频会添加为独立版本。
        </p>
        <Form layout="vertical" className="batch-generation-form">
          <Form.Item label="生成方式">
            <Select value={batchMode} onChange={setBatchMode} disabled={running} options={[{label:"生成新视频",value:"generate"},{label:"使用已有视频 concat",value:"existing"}]} />
          </Form.Item>
          {batchMode === "existing" && <div className="concat-pickers">{batch?.scenes.map(scene => {
            const currentScene = data.episodes.find(ep=>ep.id===batch.id)?.scenes.find(s=>s.id===scene.id) || scene;
            return <Form.Item key={scene.id} label={scene.title}><Select disabled={running} value={currentScene.video_media_id || undefined} placeholder="选择当前场景的视频" options={sceneVideos(currentScene).map((video,index)=>({label:`视频 ${index+1} · ${video.name}`,value:video.id}))} onChange={async id=>{try {await post("/scenes/select-video",{project_id:data.project.id,scene_id:scene.id,media_id:id});setBatch(current=>current ? {...current,scenes:current.scenes.map(s=>s.id===scene.id?{...s,video_media_id:id}:s)}:null);setBatchResult(null);await reload();}catch(e){Message.error(String(e));}}}/></Form.Item>;
          })}</div>}
          <Form.Item hidden={batchMode === "existing"} label="每个场景生成数量">
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
      <VideoPreviewModal
        media={previewScene ? previewVideo || null : null}
        playbackKey={previewScene?.id}
        autoPlay={continuousPreview}
        title={`视频预览 · ${previewScene?.title || ""}`}
        videos={previewVideos}
        projectId={data.project.id}
        onMediaChange={video=>setPreviewVideoId(video.id)}
        onClose={()=>{setPreviewSceneId(null);setPreviewVideoId(null);}}
        allowLoop={!continuousPreview}
        toolbar={<>
          <Tag>{previewVideo?.id === previewScene?.video_media_id ? "主视频" : "其他版本"}</Tag>
          {previewVideos.length > 1 && <Select style={{width:180}} aria-label="选择视频版本" value={previewVideo?.id} onChange={setPreviewVideoId}>
            {previewVideos.map((video,index)=><Select.Option key={video.id} value={video.id}>版本 {index+1}{video.id === previewScene?.video_media_id ? " · 主视频" : ""}</Select.Option>)}
          </Select>}
          <Button type={continuousPreview ? "primary" : "secondary"} onClick={()=>setContinuousPreview(value=>!value)} disabled={previewPlaylist.length<2}>{continuousPreview ? "连续播放中" : "连续播放"}</Button>
        </>}
        onEnded={()=>{
          if(!continuousPreview || !previewScene)return;
          const index=previewPlaylist.findIndex(scene=>scene.id===previewScene.id), next=previewPlaylist[index+1];
          if(next){setPreviewSceneId(next.id);const videos=sceneVideos(next);setPreviewVideoId(next.video_media_id || videos[0].id);}
          else setContinuousPreview(false);
        }}
      />
      <EpisodeEditor
        episode={episode}
        project={data.project}
        data={data}
        editScene={scene => editScene(scene, false)}
        onClose={() => setEpisode(null)}
        reload={reload}
      />
    </section>
  );
}
const reorderingEpisodes = new Set<string>();
function SceneOrderControls({episode, index, project, reload}: {episode: Episode; index: number; project: Project; reload: () => void}) {
  const [busy, setBusy] = useState(false);
  const move = async (offset: number) => {
    const key = `${project.id}/${episode.id}`;
    if (reorderingEpisodes.has(key)) return;
    const ids = episode.scenes.map(scene => scene.id);
    if (index + offset < 0 || index + offset >= ids.length) return;
    reorderingEpisodes.add(key);
    setBusy(true);
    try {
      [ids[index], ids[index + offset]] = [ids[index + offset], ids[index]];
      await post("/scenes/reorder", {project_id: project.id, episode_id: episode.id, scene_ids: ids});
      await reload();
    } catch (error) {Message.error(String(error));}
    finally {reorderingEpisodes.delete(key); setBusy(false);}
  };
  return <Space size={4}><Button size="mini" aria-label="上移场景" title="上移场景" disabled={busy || index === 0} icon={<ArrowUp size={14}/>} onClick={() => move(-1)}/><Button size="mini" aria-label="下移场景" title="下移场景" disabled={busy || index === episode.scenes.length - 1} icon={<ArrowDown size={14}/>} onClick={() => move(1)}/></Space>;
}
function SceneFramePicker({data, reload, onSelect, disabled}: {data: Snapshot; reload: () => void; onSelect: (media: Media) => void; disabled?: boolean}) {
  const [visible, setVisible] = useState(false);
  const [sceneId, setSceneId] = useState<number>();
  const [videoId, setVideoId] = useState<number>();
  const [frame, setFrame] = useState("first");
  const [busy, setBusy] = useState(false);
  const scenes = data.episodes.flatMap(ep => ep.scenes.filter(scene => sceneVideos(scene).length).map(scene => ({scene, label: `${ep.title} · ${scene.title}`})));
  const scene = scenes.find(item => item.scene.id === sceneId)?.scene;
  const videos = scene ? sceneVideos(scene) : [];
  const video = videos.find(item => item.id === videoId);
  const select = async () => {
    if (!scene || !video || busy) return;
    setBusy(true);
    try {
      const media = await post<Media>("/media/video-frame", {project_id: data.project.id, scene_id: scene.id, media_id: video.id, frame});
      await reload();
      onSelect(media);
      setVisible(false);
    } catch (error) {Message.error(String(error));}
    finally {setBusy(false);}
  };
  return <>
    <Button disabled={disabled} icon={<Film size={15}/>} onClick={() => {setSceneId(undefined); setVideoId(undefined); setFrame("first"); setVisible(true);}}>从场景选择</Button>
    <Modal title="从场景视频选择图片" visible={visible} onCancel={() => !busy && setVisible(false)} maskClosable={!busy} closable={!busy} confirmLoading={busy} okButtonProps={{disabled: !video}} cancelButtonProps={{disabled: busy}} onOk={select} okText="使用此帧" unmountOnExit>
      {!scenes.length ? <Empty description="暂无场景视频，请先生成视频"/> : <Form layout="vertical">
        <Form.Item label="场景"><Select placeholder="选择剧集中的场景" value={sceneId} disabled={busy} onChange={id => {setSceneId(id); setVideoId(undefined);}} showSearch>{scenes.map(item => <Select.Option key={item.scene.id} value={item.scene.id}>{item.label}</Select.Option>)}</Select></Form.Item>
        <Form.Item label="视频版本"><Select placeholder="选择视频版本" value={videoId} disabled={busy || !scene} onChange={setVideoId}>{videos.map((item, i) => <Select.Option key={item.id} value={item.id}>版本 {i + 1} · {item.name}</Select.Option>)}</Select></Form.Item>
        <Form.Item label="选择画面"><Select value={frame} disabled={busy} onChange={setFrame}><Select.Option value="first">首帧</Select.Option><Select.Option value="last">尾帧</Select.Option></Select></Form.Item>
        {video && <video key={video.id} className="frame-picker-video" src={imageUrl(video)} controls preload="metadata"/>}
        <p className="subtle">确认后提取视频的实际首帧或尾帧，并保存为项目图片。</p>
      </Form>}
    </Modal>
  </>;
}

function EpisodeEditor({
  data,
  episode,
  project,
  onClose,
  reload,
  editScene,
}: {
  data: Snapshot;
  episode: { id: number; title: string; description: string; cover_media?: Media; scenes?: Scene[]; storyboard?: Storyboard } | null;
  project: Project;
  onClose: () => void;
  reload: () => void;
  editScene: (scene: Scene) => void;
}) {
  const [view, setView] = useState<"markdown" | "csv" | "details" | "scenes">("markdown");
  const scriptEditor = useRef<ScreenplayEditorHandle>(null);
  const [scriptStatus, setScriptStatus] = useState({ dirty: false, busy: false });
  const onScriptStatus = useCallback((dirty: boolean, busy: boolean) => setScriptStatus(current => current.dirty === dirty && current.busy === busy ? current : { dirty, busy }), []);
  const [baseline, setBaseline] = useState(episode);
  const [cover, setCover] = useState<Media | undefined>(episode?.cover_media);
  const uploadCover = async () => {
    const path = await open({multiple:false, filters:[{name:"图片",extensions:["png","jpg","jpeg","webp"]}]});
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
    setView("markdown");
    setBoard(episode?.storyboard || undefined);
    setCover(episode?.cover_media);
    setTitle(episode?.title || "");
    setDescription(episode?.description || "");
  }, [episode]);
  const [saving, setSaving] = useState(false);
  const dirty = JSON.stringify(board || null) !== JSON.stringify(baseline?.storyboard || null) || title !== (baseline?.title || "") || description !== (baseline?.description || "") || cover?.id !== baseline?.cover_media?.id || scriptStatus.dirty;
  useEditGuard(dirty || saving || generatingBoard || scriptStatus.busy);
  useEffect(() => {
    if (!dirty && !saving && !generatingBoard && !scriptStatus.busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, saving, generatingBoard, scriptStatus.busy]);
  const close = () => {
    if (saving || generatingBoard || scriptStatus.busy) return;
    if (dirty) confirmDiscard(onClose);
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
  useEffect(() => {
    if (!episode) return;
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault(); void save();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  });
  const currentEpisode = data.episodes.find(ep => ep.id === episode?.id);
  const editorLocked = saving || generatingBoard || scriptStatus.busy;
  const openScene = (scene: Scene) => {
    if (editorLocked) return;
    if (dirty) confirmDiscard(() => editScene(scene));
    else editScene(scene);
  };
  if (!episode) return null;
  return (
    <section className="episode-editor-page">
      <div className="section-title episode-editor-toolbar">
        <div className="episode-editor-heading"><Button icon={<ArrowLeft size={16}/>} disabled={editorLocked} onClick={close}>返回</Button><h1 title={title}>{title || "未命名剧集"}</h1></div>
        <Space><Tag color={dirty ? "orange" : "green"}>{dirty ? "未保存" : "已保存"}</Tag><Button type="primary" icon={<Save size={16}/>} disabled={generatingBoard || scriptStatus.busy} loading={saving} onClick={save}>保存</Button></Space>
      </div>
      <div className="episode-editor-navigation">
        <div className="episode-editor-tabs" role="tablist" aria-label="剧集工作区">
          <button type="button" role="tab" aria-selected={view === "markdown"} disabled={editorLocked} onClick={() => scriptEditor.current?.chooseFormat("markdown")}>剧本</button>
          <button type="button" role="tab" aria-selected={view === "csv"} disabled={editorLocked} onClick={() => scriptEditor.current?.chooseFormat("csv")}>分镜头剧本</button>
          <button type="button" role="tab" aria-selected={view === "details"} disabled={editorLocked} onClick={() => setView("details")}>剧集信息与场景</button>
          <button type="button" role="tab" aria-selected={view === "scenes"} disabled={editorLocked} onClick={() => setView("scenes")}>场景</button>
        </div>
      </div>
      <div className="episode-writing-pane" hidden={view !== "markdown" && view !== "csv"}>
        <ScreenplayManager key={episode.id} ref={scriptEditor} data={data} episodeId={episode.id} reload={async () => { await reload(); }} disabled={saving || generatingBoard} board={board} onBoard={setBoard} onBoardBusy={setGeneratingBoard} onStatus={onScriptStatus} onFormatChange={setView} />
      </div>
      <div className="episode-scene-browser" hidden={view !== "scenes"}>
        <div className="episode-scene-browser-heading"><h2>全部场景 <span className="subtle">{currentEpisode?.scenes.length || 0} 个场景</span></h2><p className="subtle">按剧集顺序查看场景，点击进入编辑。</p></div>
        {currentEpisode?.scenes.length ? <div className="episode-scene-grid">
          {currentEpisode.scenes.map((scene, index) => <button type="button" className="episode-scene-card" key={scene.id} disabled={editorLocked} aria-label={`编辑场景：${scene.title}`} onClick={() => openScene(scene)}>
            <SceneThumb scene={scene} media={data.media}/>
            <div className="episode-scene-card-body">
              <div className="episode-scene-card-title"><span className="subtle">{String(index + 1).padStart(2, "0")}</span><b>{scene.title}</b></div>
              <p>{scene.description || "尚未填写场景描述"}</p>
              <div className="episode-scene-card-footer"><Space size={6} wrap>
                <Tag color={scene.video_media_id ? "green" : "gray"}>{scene.video_media_id ? "视频已就绪" : (scene.first_media_id || scene.last_media_id || scene.reference_media_id || scene.generation_options?.reference_media_ids?.length) ? "已设画面" : "待制作"}</Tag>
                {scene.creation_mode === "canvas" && <Tag>画布</Tag>}
              </Space><span className="episode-scene-edit-link">编辑场景 <ChevronRight size={14}/></span></div>
            </div>
          </button>)}
        </div> : <Empty description="本集暂无场景，可返回剧集列表新建场景"/>}
      </div>
      <div className="episode-editor-columns" hidden={view !== "details"}>
      <Card className="episode-editor-card episode-details-pane">
      <fieldset disabled={saving} className="episode-editor-fields">
      <Form layout="vertical">
        <Form.Item label="剧集封面" extra="默认使用第一个场景的第一个视频画面">
          <div className="episode-cover-controls">
            {episode && <EpisodeCover episode={{...episode, scenes: data.episodes.find(ep => ep.id === episode.id)?.scenes, cover_media:cover}} />}
            <div className="episode-cover-actions">
              <Button onClick={() => uploadCover().catch(e => Message.error(String(e)))}>上传封面</Button>
              <SceneFramePicker data={data} reload={reload} onSelect={setCover}/>
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
        <h2>场景顺序 <span className="subtle">{currentEpisode?.scenes.length || 0} 个场景</span></h2>
        <p className="subtle">调整后立即保存，并同步到工作台</p>
        <fieldset disabled={saving} className="episode-editor-fields">
          {currentEpisode?.scenes.map((scene, index) => {
            const options = scene.generation_options;
            const mode = options?.video_mode || ((options?.reference_media_ids?.length || scene.reference_media_id) ? "i2v" : "fl2v");
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
              <div className="episode-scene-order-heading"><b>{String(index + 1).padStart(2, "0")} · {scene.title}</b><SceneOrderControls episode={currentEpisode} index={index} project={project} reload={reload}/></div>
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
          {!currentEpisode?.scenes.length && <Empty description="暂无场景"/>}
        </fieldset>
      </Card>
      </div>
    </section>
  );
}
function SceneImageField({
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
              <Button type="text" icon={<ImagePlus size={15} />} onClick={() => setAssetsOpen(true)}>从资产库选择</Button>
              <Button type="text" icon={<Users size={15} />} onClick={() => setRolesOpen(true)}>从角色中选择</Button>
              <SceneFramePicker data={data} reload={reload} onSelect={media => onChange(media.id)}/>
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
            Message.success(`${label}已替换，保存场景后生效`);
          }}
        />}
      </Modal>
      <RoleImagePicker title={`为${label}选择角色图片`} visible={rolesOpen} roles={data.roles} selectedIds={value===null?[]:[value]}
        onSelect={media=>{onChange(media.id);setRolesOpen(false);}} onClose={()=>setRolesOpen(false)} />
    </div>
  );
}
export function SceneEditor({
  scene,
  isNew,
  data,
  onClose,
  reload,
  onGenerateFrame,
  generatedFrame,
  onGeneratedApplied,
}: {
  scene: Scene;
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
  const effectivePrompt = prompt.trim() ? prompt : description;
  const { uploading:pastingImages, inProgress:pasteInProgress, uploadImages } = useImageUpload({projectId:data.project.id,reload,refreshError:"图片已上传，但刷新资产失败"});
  const [uploadingReferences, setUploadingReferences] = useState(false);
  const [pastedMedia, setPastedMedia] = useState<Media[]>([]);
  const draggedReference = useRef<number | null>(null);
  const [referenceDropTarget, setReferenceDropTarget] = useState<number | null>(null);
  const [frames, setFrames] = useState<Record<FrameKey, number | null>>({
    first: scene.first_media_id || null,
    last: scene.last_media_id || null,
    reference: scene.reference_media_id || null,
  });
  const [options, setOptions] = useState<GenerationOptions>(
    { ...defaultOptions, ...scene.generation_options,
      size: normalizeGenerationSize(scene.generation_options?.aspect_ratio || defaultOptions.aspect_ratio, scene.generation_options?.size),
      video_mode: scene.generation_options?.video_mode || ((scene.generation_options?.reference_media_ids?.length || scene.reference_media_id) ? "i2v" : "fl2v"),
      reference_media_ids: scene.generation_options?.reference_media_ids ?? (scene.reference_media_id ? [scene.reference_media_id] : []),
    },
  );
  const [ratio, setRatio] = useState(
    scene.generation_options?.aspect_ratio || defaultOptions.aspect_ratio,
  );
  const automaticReferenceIds = useRef<number[]>([]);
  const mentionedReferenceIds = JSON.stringify([...new Set(
    findMentions(effectivePrompt, promptMentions(data.roles, data))
      .flatMap(mention => mention.media?.kind === "image" ? [mention.media.id] : []),
  )]);
  useEffect(() => {
    if (options.video_mode !== "i2v" || pastingImages) return;
    const mentionedIds: number[] = JSON.parse(mentionedReferenceIds);
    const existing = options.reference_media_ids || [];
    const {ids,automatic} = syncMentionReferences(existing, automaticReferenceIds.current, mentionedIds);
    automaticReferenceIds.current = automatic;
    if (ids.length !== existing.length || ids.some((id,index)=>id!==existing[index])) {
      setOptions(current => ({...current, reference_media_ids:ids}));
    }
  }, [mentionedReferenceIds, options.video_mode, pastingImages]);
  const signature = JSON.stringify({title, description, prompt, frames, options, ratio});
  const [savedSignature, setSavedSignature] = useState(signature);
  const dirty = signature !== savedSignature;
  useEditGuard(dirty);
  const closeEditor = () => {
    if (pasteInProgress.current) return;
    if (optimizingPrompt) return;
    if (!dirty) { onClose(); return; }
    void save();
  };
  const [savingScene, setSavingScene] = useState(false);
  const [videoGenerating, setVideoGenerating] = useState(false);
  const { optimizing:optimizingPrompt, optimize:optimizePrompt } = usePromptOptimization();
  const [optimizationInstruction,setOptimizationInstruction]=useState("");
  const [optimizationInstructionOpen,setOptimizationInstructionOpen]=useState(false);
  const [persistedVideoGenerating, setPersistedVideoGenerating] = useState(false);
  const [videoAssets, setVideoAssets] = useState<Media[]>([]);
  const [videoAssetPage, setVideoAssetPage] = useState(1);
  const [videoAssetTotal, setVideoAssetTotal] = useState(0);
  const [videoAssetPickerOpen, setVideoAssetPickerOpen] = useState(false);
  const [selectedVideoAsset, setSelectedVideoAsset] = useState<number | undefined>();
  const [multiReferencePickerOpen, setMultiReferencePickerOpen] = useState(false);
  const [referenceRolePickerOpen, setReferenceRolePickerOpen] = useState(false);
  const [referenceSourcesOpen, setReferenceSourcesOpen] = useState(false);
  const [referencePreview, setReferencePreview] = useState<Media | null>(null);
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
            job.scene_id === scene.id &&
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
  const currentScene =
    data.episodes.flatMap((ep) => ep.scenes).find((s) => s.id === scene.id) ||
    scene;
  const [imageTarget, setImageTarget] = useState<FrameKey | null>(null);
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageMode, setImageMode] = useState<"t2i" | "i2i">("t2i");
  const [imageRefs, setImageRefs] = useState<Media[]>([]);
  const [rolePickerOpen, setRolePickerOpen] = useState(false);
  const [imageGenerating, setImageGenerating] = useState(false);
  const choose = (key: FrameKey, id: number | null) =>
    setFrames((current) => ({ ...current, [key]: id }));
  const pasteReferenceImages = async (files: File[]) => {
    if (pasteInProgress.current || savingScene || videoGenerating || persistedVideoGenerating) return;
    const remaining = Math.max(0, 9 - (options.reference_media_ids || []).length);
    if (!remaining) { Message.warning("最多添加 9 张参考图，请先移除部分图片"); return; }
    const supported = supportedPastedImages(files);
    if (!supported.length) return;
    if (supported.length > remaining) Message.warning(`最多添加 9 张参考图，本次只上传前 ${remaining} 张`);
    await uploadImages(supported.slice(0,remaining), {pasted:true,onUploaded:media=>{
      setPastedMedia(items=>[...items,media]);
      setOptions(current=>({...current,video_mode:"i2v",reference_media_ids:[...new Set([...(current.reference_media_ids||[]),media.id])].slice(0,9)}));
    },onComplete:count=>Message.success(`${count} 张图片已添加为全能参考图，保存场景后生效`)});
  };
  const uploadFrame = async (key: FrameKey) => {
    const source = await open({
      multiple: false,
      filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    if (typeof source !== "string") return;
    const media = await post<Media>("/media/import", {
      project_id: data.project.id,
      source_path: source,
    });
    choose(key, media.id);
    await reload();
  };
  const addReferenceImages = async () => {
    const selected = await open({ multiple: true, filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp"] }] });
    if (!selected) return;
    const paths = typeof selected === "string" ? [selected] : selected;
    const imported = await Promise.all(paths.slice(0, Math.max(0, 9 - (options.reference_media_ids || []).length)).map(source => post<Media>("/media/import", { project_id: data.project.id, source_path: source })));
    setOptions(o => ({ ...o, reference_media_ids: [...new Set([...(o.reference_media_ids || []), ...imported.map(m => m.id)])].slice(0, 9) }));
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
      filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp"] }],
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
    setImageRefs(findMentions(prompt, promptMentions(data.roles, data)).flatMap(mention => mention.media ? [mention.media] : []));
  };
  useEffect(() => {
    if (!generatedFrame) return;
    choose(generatedFrame.key, generatedFrame.media.id);
    Message.success(`${generatedFrame.key === "first" ? "首帧" : "尾帧"}图片已设置，保存场景后生效`);
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
        prompt: resolvePrompt(imagePrompt, data.roles),
        aspect_ratio: ratio,
        size: options.size,
        image_media_ids: imageRefs.map((x) => x.id),
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
  const draft = (): Scene => ({
    ...scene,
    title,
    description,
    prompt,
    first_media_id: frames.first,
    last_media_id: frames.last,
    reference_media_id: frames.reference,
    generation_options: { ...options, aspect_ratio: ratio },
  });
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const [autoSaveStatus, setAutoSaveStatus] = useState("");
  const persist = () => {
    const payload = { project_id: data.project.id, ...draft(), title: title.trim() };
    const saved = signature;
    const run = async () => {
      if (!payload.title) throw new Error("请输入场景标题");
      setAutoSaveStatus("正在保存…");
      await post("/scenes/update", payload);
      setSavedSignature(saved);
      setAutoSaveStatus("已自动保存");
    };
    const next = saveQueue.current.catch(() => {}).then(run);
    saveQueue.current = next;
    return next;
  };
  useEffect(() => {
    if (!dirty || savingScene || optimizingPrompt || pastingImages || uploadingReferences || videoGenerating) return;
    const timer = window.setTimeout(() => {
      void persist().then(() => reload()).catch(error => {
        setAutoSaveStatus("自动保存失败，请点击保存场景重试");
        Message.error(String(error));
      });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [signature, savedSignature, savingScene, optimizingPrompt, pastingImages, uploadingReferences, videoGenerating]);
  const generateVideo = async () => {
    if (pasteInProgress.current || uploadingReferences) return;
    try {
      const request = videoRequest(draft(), data.settings, data.roles, data.prompts);
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
  const openVideoAssetPicker = async () => {
    try {
      const result = await post<{items: Media[];total:number}>('/media/list', {project_id:data.project.id,kind:'video',page:1,limit:60});
      setVideoAssets(result.items);
      setVideoAssetPage(1);
      setVideoAssetTotal(result.total);
      setSelectedVideoAsset(undefined);
      setVideoAssetPickerOpen(true);
    } catch (e) { Message.error(String(e)); }
  };
  const loadVideoAssetPage = async (page:number) => {
    try {
      const result = await post<{items: Media[];total:number}>('/media/list', {project_id:data.project.id,kind:'video',page,limit:60});
      setVideoAssets(result.items);
      setVideoAssetPage(page);
      setVideoAssetTotal(result.total);
      setSelectedVideoAsset(undefined);
    } catch (e) { Message.error(String(e)); }
  };
  const attachVideo = async (media: Media) => {
    if (attachingVideo) return;
    setAttachingVideo(true);
    try {
      await post('/scenes/select-video', {project_id:data.project.id,scene_id:scene.id,media_id:media.id});
      await reload();
      setVideoAssetPickerOpen(false);
      Message.success('视频已关联到场景');
    } catch (e) { Message.error(String(e)); }
    finally { setAttachingVideo(false); }
  };
  const uploadSceneVideo = async () => {
    const source = await open({multiple:false,filters:[{name:'视频',extensions:['mp4','mov','webm','mkv']}]});
    if (typeof source !== 'string') return;
    setAttachingVideo(true);
    try {
      const media = await post<Media>('/media/import',{project_id:data.project.id,source_path:source});
      await post('/scenes/select-video',{project_id:data.project.id,scene_id:scene.id,media_id:media.id});
      await reload();
      Message.success('视频已上传并关联到场景');
    } catch (e) { Message.error(String(e)); }
    finally { setAttachingVideo(false); }
  };
  const optimizeVideoPrompt=()=>{
    const imageIds=options.video_mode==="i2v"?(options.reference_media_ids||[]):[frames.first,frames.last].filter((id):id is number=>Boolean(id));
    return optimizePrompt({projectId:data.project.id,
    prompt:resolveH3Prompt(description,data,imageIds),kind:"video",instruction:optimizationInstruction,imageIds,
    h3:{mode:options.video_mode==="i2v"?"ref2va":frames.first?(frames.last?"fl2va":"i2va"):frames.last?"l2va":"t2va",duration:options.duration,
      videoIds:options.video_mode==="i2v"?options.reference_video_media_ids:[],audioIds:options.video_mode==="i2v"?options.reference_audio_media_ids:[]},
    onOptimized:setPrompt,successMessage:"已转换为 MiniMax-H3 Prompt"});
  };
  const optimizeImagePrompt=()=>optimizePrompt({projectId:data.project.id,prompt:imagePrompt,kind:"image",imageIds:imageMode==="i2i"?imageRefs.map(media=>media.id):[],onOptimized:setImagePrompt});
  const save = async () => {
    if (savingScene || optimizingPrompt || pasteInProgress.current || uploadingReferences) return;
    setSavingScene(true);
    try { await persist(); await reload(); Message.success("场景已保存"); onClose(); }
    catch(e) { Message.error(String(e)); }
    finally { setSavingScene(false); }
  };
  return (
    <section className="scene-editor-page">
      <div className="scene-editor-heading">
        <div className="scene-editor-heading-title">
          <Button type="text" disabled={pastingImages} onClick={closeEditor}>
            ← 返回
          </Button>
        </div>
        <Space>
          <span className="subtle" role="status">{dirty ? (autoSaveStatus.includes("失败") ? autoSaveStatus : "待自动保存…") : autoSaveStatus}</span>
          <Button
            type="primary"
            loading={savingScene}
            disabled={optimizingPrompt || videoGenerating || persistedVideoGenerating || imageGenerating || pastingImages || uploadingReferences}
            icon={<Save size={15} />}
            onClick={save}
          >
            保存场景
          </Button>
        </Space>
      </div>
      <div className="scene-editor-content">
        <div className="scene-composer">
          <div className="scene-form-card">
            <Form layout="vertical">
              <Form.Item label="场景标题">
                <Input value={title} onChange={setTitle} />
              </Form.Item>
              <Form.Item label={<span className="scene-description-label"><span>场景描述</span><Space size={2}><Button type="text" size="mini" onClick={()=>setOptimizationInstructionOpen(true)}>优化指令</Button><Button type="text" size="mini" icon={<WandSparkles size={14}/>} disabled={videoGenerating||optimizingPrompt||!description.trim()} onClick={optimizeVideoPrompt}>{optimizingPrompt?"正在优化…":"优化描述"}</Button></Space></span>}>
                <PromptInput value={description} onChange={setDescription} roles={data.roles} data={data} prompts={data.prompts} templates={[...PROMPT_TEMPLATES,...data.prompts]} disabled={optimizingPrompt || pastingImages || savingScene || videoGenerating || persistedVideoGenerating} onPasteImages={files => void pasteReferenceImages(files)} placeholder="描述镜头、人物动作、台词与画面情绪… 输入 @template 选择模板，或引用角色、场景素材与 Prompt" />
                <p className="helper" role="status">{pastingImages ? "正在上传粘贴的图片…" : "可在此粘贴图片，自动添加到全能参考（最多 9 张）"}</p>
              </Form.Item>
              <Form.Item label="视频 Prompt">
                <PromptInput value={prompt} onChange={setPrompt} roles={data.roles} data={data} prompts={data.prompts} templates={[...PROMPT_TEMPLATES,...data.prompts]} disabled={optimizingPrompt || pastingImages || savingScene || videoGenerating || persistedVideoGenerating} onPasteImages={files => void pasteReferenceImages(files)} placeholder="实际用于生成视频的提示词；留空时使用场景描述" />
                <p className="helper">优化描述的结果会填入此栏，保留手工描述。留空时使用场景描述生成视频。</p>
              </Form.Item>
              <Modal title="自定义提示词优化指令" visible={optimizationInstructionOpen} onCancel={()=>setOptimizationInstructionOpen(false)} onOk={()=>setOptimizationInstructionOpen(false)} okText="完成">
                <p className="helper">按当前素材转换为 MiniMax-H3 官方格式，英文描述、原语言对白。可补充镜头、节奏或风格要求。</p>
                <Input.TextArea value={optimizationInstruction} onChange={setOptimizationInstruction} autoSize={{minRows:3,maxRows:7}} placeholder="例如：保留六个分镜，强调角色表情，不添加背景音乐。" />
              </Modal>
            </Form>
          </div>
          <div className="scene-visuals">
          <div className="scene-section-heading"><h2>画面素材</h2><span>{options.video_mode === "i2v" ? "最多 9 张参考图" : "上传首帧，可选尾帧"}</span></div>
          <Tabs activeTab={options.video_mode} onChange={key => { if (pasteInProgress.current) return; setOptions(o => ({...o, video_mode: key as "fl2v" | "i2v"})); setReferenceSourcesOpen(false); }}>
          <Tabs.TabPane key="fl2v" title="首尾帧">
          <div className="scene-image-grid">
            {(
              [
                ["first", "首帧"],
                ["last", "尾帧"],
              ] as const
            ).map(([key, label]) => (
              <SceneImageField
                key={key}
                label={label}
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
          <div className="scene-multi-reference">
            <div className="scene-section-heading"><h2>多张参考图</h2><span>最多 9 张 · 拖拽调整顺序 · 可从资产库选择或上传</span></div>
            <Space wrap>
              <Dropdown trigger="click" popupVisible={referenceSourcesOpen} onVisibleChange={setReferenceSourcesOpen} unmountOnExit={false}
                droplist={<div className="scene-source-menu" onClick={() => setReferenceSourcesOpen(false)}>
                  <Button type="text" icon={<ImagePlus size={15}/>} onClick={() => setMultiReferencePickerOpen(true)}>从资产库选择</Button>
                  <Button type="text" icon={<Users size={15}/>} onClick={() => setReferenceRolePickerOpen(true)}>从角色中选择</Button>
                  <SceneFramePicker data={data} reload={reload} onSelect={media => setOptions(o => ({...o, reference_media_ids: [...new Set([...(o.reference_media_ids || []), media.id])].slice(0, 9)}))}/>
                  <Button type="text" icon={<Upload size={15}/>} onClick={() => void addReferenceImages().catch(e => Message.error(String(e)))}>上传图片</Button>
                </div>}>
                <Button size="small" disabled={pastingImages}>添加参考图<ChevronDown size={13}/></Button>
              </Dropdown>
              {(options.reference_media_ids || []).length > 0 && <div className="scene-reference-grid" data-count={(options.reference_media_ids || []).length}>
                {(options.reference_media_ids || []).map((id,index) => { const media=data.media.find(m=>m.id===id) || pastedMedia.find(m=>m.id===id); return media ? <figure className={`scene-reference-thumb${referenceDropTarget===id?' drop-target':''}`} key={id} data-reference-id={id}>
                  <button type="button" className="scene-reference-preview" onClick={() => setReferencePreview(media)} aria-label={`预览参考图 ${media.name}`}><img src={imageUrl(media)} alt={media.name} draggable={false}/></button>
                  <button type="button" className="scene-reference-remove" onClick={() => setOptions(o=>({...o,reference_media_ids:(o.reference_media_ids||[]).filter(x=>x!==id)}))} aria-label={`移除参考图 ${media.name}`} title="移除">×</button>
                  <figcaption title={`拖动调整顺序：${media.name}`}
                    onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();draggedReference.current=id;event.currentTarget.setPointerCapture(event.pointerId);}}
                    onPointerMove={event=>{if(draggedReference.current===null)return;const target=document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>('[data-reference-id]');const targetId=target?Number(target.dataset.referenceId):null;setReferenceDropTarget(targetId===id?null:targetId);}}
                    onPointerUp={event=>{const source=draggedReference.current;const target=document.elementFromPoint(event.clientX,event.clientY)?.closest<HTMLElement>('[data-reference-id]');const targetId=target?Number(target.dataset.referenceId):null;draggedReference.current=null;setReferenceDropTarget(null);if(source===null||targetId===null||source===targetId)return;setOptions(o=>{const ids=[...(o.reference_media_ids||[])];const from=ids.indexOf(source),to=ids.indexOf(targetId);if(from<0||to<0)return o;ids.splice(from,1);ids.splice(to,0,source);return {...o,reference_media_ids:ids};});}}
                    onPointerCancel={()=>{draggedReference.current=null;setReferenceDropTarget(null);}}
                    onLostPointerCapture={()=>{draggedReference.current=null;setReferenceDropTarget(null);}}
                  >⠿ 参考图 {index+1} · {media.name}</figcaption>
                </figure> : null; })}
              </div>}
            </Space>
          </div>
          <Form layout="vertical"><ReferenceMediaPicker projectId={data.project.id} media={data.media} videoIds={options.reference_video_media_ids} audioIds={options.reference_audio_media_ids}
            reload={reload} disabled={savingScene || videoGenerating || persistedVideoGenerating || pastingImages} onUploading={setUploadingReferences}
            onChange={(kind, ids) => setOptions(current => ({...current, [kind === "video" ? "reference_video_media_ids" : "reference_audio_media_ids"]: ids}))} /></Form>
          </Tabs.TabPane>
          </Tabs>
          </div>
            <div className="video-generator scene-video-panel">
              <Form layout="vertical">
                <div className="generation-options">
                  <VideoDurationField value={options.duration} onChange={duration => setOptions(o => ({ ...o, duration }))} />
                  <MediaSizeFields ratio={ratio} size={options.size} ratioLabel="画面比例" ariaPrefix="视频"
                    onChange={value => { setRatio(value.ratio); setOptions(o => ({ ...o, aspect_ratio: value.ratio, size: value.size })); }} />
                </div>
              </Form>
              <div className="scene-video-action">
                <span className="subtle">
                {options.video_mode === "i2v" ? "全能参考生成" : "首尾帧生成"}
                </span>
              <Space wrap>
              <Button icon={<Film size={15}/>} disabled={attachingVideo||videoGenerating||persistedVideoGenerating} onClick={()=>void openVideoAssetPicker()}>从资产库选择</Button>
              <Button icon={<Upload size={15}/>} loading={attachingVideo} disabled={videoGenerating||persistedVideoGenerating} onClick={()=>void uploadSceneVideo()}>上传视频</Button>
              <Button
                type="primary"
                icon={<Sparkles size={17} />}
                loading={videoGenerating || persistedVideoGenerating}
                disabled={!description.trim() || pastingImages || uploadingReferences}
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
                视频版本 <span>{sceneVideos(currentScene).length}</span>
              </h2>
              {!!sceneVideos(currentScene).length && <p className="helper">主视频用于默认预览和剧集合并，设置后立即保存。</p>}
              {sceneVideos(currentScene).length ? (
                sceneVideos(currentScene).map((video, index) => (
                  <article className="video-version" key={video.id}>
                    <VideoAsset video={video} scene={currentScene} projectId={data.project.id} reload={reload} />
                    <div className="video-version-meta">
                      <b>视频 {index + 1}</b>
                      <Tag
                        color={
                          video.id === currentScene.video_media_id
                            ? "blue"
                            : "gray"
                        }
                      >
                        {video.id === currentScene.video_media_id
                          ? "主视频"
                          : "候选版本"}
                      </Tag>
                    </div>
                  </article>
                ))
              ) : (
                <div className="scene-results-empty"><div className="scene-results-icon"><Film size={28} strokeWidth={1.25}/></div><b>让场景动起来</b><p>填写场景描述后，即可生成第一个视频。</p></div>
              )}
            </aside>
      </div>
      <AssetImagePicker
        visible={multiReferencePickerOpen}
        label="多张参考图"
        value={null}
        data={data}
        multiple
        selectedIds={options.reference_media_ids || []}
        onSelect={() => {}}
        onToggle={id => setOptions(o => {
          const ids = o.reference_media_ids || [];
          if (ids.includes(id)) return { ...o, reference_media_ids: ids.filter(x => x !== id) };
          if (ids.length >= 9) { Message.warning("最多选择 9 张参考图"); return o; }
          return { ...o, reference_media_ids: [...ids, id] };
        })}
        onClose={() => setMultiReferencePickerOpen(false)}
      />
      <RoleImagePicker title="从角色中选择参考图" visible={referenceRolePickerOpen} roles={data.roles} multiple showPrimary={false}
        selectedIds={options.reference_media_ids||[]} onClose={()=>setReferenceRolePickerOpen(false)} onSelect={media=>setOptions(o=>{
          const ids=o.reference_media_ids||[];
          if(ids.includes(media.id))return {...o,reference_media_ids:ids.filter(id=>id!==media.id)};
          if(ids.length>=9){Message.warning("最多选择 9 张参考图");return o;}
          return {...o,reference_media_ids:[...ids,media.id]};
        })} />
      <ImagePreviewModal media={referencePreview} title="参考图预览" onClose={()=>setReferencePreview(null)} />
      <Modal
        title="选择视频资产"
        visible={videoAssetPickerOpen}
        onCancel={()=>setVideoAssetPickerOpen(false)}
        onOk={()=>{const media=videoAssets.find(item=>item.id===selectedVideoAsset);if(media)void attachVideo(media);}}
        confirmLoading={attachingVideo}
        okButtonProps={{disabled:selectedVideoAsset===undefined}}
        okText="关联到场景"
      >
        {videoAssets.length ? <><Select showSearch placeholder="搜索并选择视频" value={selectedVideoAsset} onChange={setSelectedVideoAsset} style={{width:'100%'}}>
          {videoAssets.map(media=><Select.Option key={media.id} value={media.id}>{media.name}</Select.Option>)}
        </Select>{videoAssetTotal>60&&<Pagination sizeCanChange={false} size="small" current={videoAssetPage} total={videoAssetTotal} pageSize={60} onChange={page=>void loadVideoAssetPage(page)} style={{marginTop:16,textAlign:'right'}}/>}</> : <Empty description="资产库中还没有视频"/>}
      </Modal>
      <Modal
        title={`生成${imageTarget === "first" ? "首帧" : imageTarget === "last" ? "尾帧" : "参考图"}`}
        visible={!!imageTarget}
        onCancel={() => setImageTarget(null)}
        onOk={generateImage}
        confirmLoading={imageGenerating}
        okText="生成图片"
      >
        <Form layout="vertical">
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
              extra="支持多选，可混合使用角色图片、场景视频帧与本地图片"
            >
              <div className="image-reference-toolbar">
                <Button
                  icon={<Users size={15} />}
                  onClick={() => setRolePickerOpen(true)}
                >
                  从角色中选择
                </Button>
                <Button
                  icon={<Upload size={15} />}
                  onClick={() =>
                    uploadRefs().catch((e) => Message.error(String(e)))
                  }
                >
                  上传图片
                </Button>
                <SceneFramePicker data={data} reload={reload} onSelect={media => setImageRefs(current => current.some(x => x.id === media.id) ? current : [...current, media])}/>
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
          <Form.Item label="画面比例">
            <Select value={ratio} onChange={value => { setRatio(value); setOptions(o => ({ ...o, aspect_ratio: value, size: normalizeGenerationSize(value, o.size) })); }}>
              <Select.Option value="16:9">16:9 横屏</Select.Option>
              <Select.Option value="9:16">9:16 竖屏</Select.Option>
              <Select.Option value="1:1">1:1 方形</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>
      <RoleImagePicker title="从角色中选择参考图" visible={rolePickerOpen} roles={data.roles} multiple
        selectedIds={imageRefs.map(media=>media.id)} onSelect={toggleRef} onClose={()=>setRolePickerOpen(false)} />
    </section>
  );
}
export function Roles({ data, reload, initialRoleId }: { data: Snapshot; reload: () => void; initialRoleId?:number }) {
  const [roleImagePreview, setRoleImagePreview] = useState<Media | null>(null);
  const [previewRoleId, setPreviewRoleId] = useState<number | null>(null);
  const openRoleImage = (role: Role, media: Media) => { setPreviewRoleId(role.id); setRoleImagePreview(media); };
  const [editing, setEditing] = useState<Role | null>(null);
  const [detailId, setDetailId] = useState<number | null>(initialRoleId ?? null);
  const detail = data.roles.find(role => role.id === detailId);
  const detailImages = detail ? [...detail.images].sort((a, b) => Number(b.id === detail.design_media_id) - Number(a.id === detail.design_media_id)) : [];
  const previewRole = data.roles.find(role => role.id === previewRoleId);
  const previewImages = [...(previewRole?.images || [])].sort((a, b) => Number(b.id === previewRole?.design_media_id) - Number(a.id === previewRole?.design_media_id));
  useEffect(() => { if (initialRoleId != null) setDetailId(initialRoleId); }, [initialRoleId]);
  const make = async () => {
    const x = await post<Role>("/roles", {
      project_id: data.project.id,
      name: "新角色",
      description: "",
    });
    await reload();
    setEditing(x);
  };
  return (
    <section>
      {detail ? <div className="role-detail-page">
        <div className="role-detail-topbar">
          <Button type="text" icon={<ArrowLeft size={16} />} onClick={() => setDetailId(null)}>角色列表</Button>
          <span>角色档案</span>
          <Button icon={<Pencil size={15} />} onClick={() => setEditing(detail)}>编辑设定</Button>
        </div>
        <div className="role-detail-hero">
          <div className="role-detail-portrait">
            {detailImages[0] ? <button type="button" onClick={() => openRoleImage(detail, detailImages[0])} aria-label={`放大查看${detail.name}的角色图`}>
              <img src={imageUrl(detailImages[0])} alt={`${detail.name}的角色主图`} />
              <span className="role-detail-zoom"><ZoomIn size={16} /> 放大查看</span>
            </button> : <div className="role-detail-no-image"><Users size={48} strokeWidth={1} /><span>暂无角色图片</span></div>}
            <span className="role-detail-portrait-label">角色主图</span>
          </div>
          <section className="role-detail-profile" aria-label="角色描述">
            <div className="role-detail-eyebrow"><span /> 人物档案</div>
            <h1>{detail.name}</h1>
            <div className="role-detail-meta"><span>角色设定</span><i />{detail.images.length} 张形象参考</div>
            <div className="role-detail-description"><h2>人物描述</h2><p>{detail.description || "还没有人物描述。点击编辑设定，记录这个角色的故事与形象。"}</p></div>
          </section>
        </div>
        <RoleAudioReferences key={detail.id} role={detail} data={data} reload={reload}/>
        <section className="role-detail-gallery" aria-label="角色图片">
          <div className="role-detail-gallery-heading"><div><h2>形象参考 <span>{detail.images.length.toString().padStart(2, "0")}</span></h2><p>记录角色的每一种样子</p></div><span>点击图片放大查看</span></div>
          {detailImages.length ? <div className="role-detail-images">{detailImages.map((media, index) => <figure key={media.id}>
            <button type="button" onClick={() => openRoleImage(detail, media)} aria-label={`预览 ${media.name}`}><img src={imageUrl(media)} alt={media.name} /><span className="role-detail-image-number">{String(index + 1).padStart(2, "0")}</span>{media.id === detail.design_media_id && <span className="role-detail-main-badge">主图</span>}</button>
            <figcaption title={media.name}>{media.name}</figcaption>
          </figure>)}</div> : <Empty description="添加角色图片，让人物形象更清晰" />}
        </section>
      </div> : <>
      <div className="section-title page-actions">
        <div className="page-intro"><h1>角色设定</h1><p>记录人物特征，保持故事中的角色形象一致。</p></div>
        <Button
          className="role-create-button"
          type="primary"
          icon={<Plus size={18} />}
          onClick={() => make().catch((e) => Message.error(String(e)))}
        >
          创建角色
        </Button>
      </div>
      <div className="role-grid">
        {data.roles.map((r) => (
          <Card key={r.id} className="role-card" bodyStyle={{ padding: 16 }}>
            <div className="role-pic">
              {(r.images.find((image) => image.id === r.design_media_id) || r.images[0]) ? (
                <button type="button" className="role-image-zoom" onClick={() => openRoleImage(r, r.images.find((image) => image.id === r.design_media_id) || r.images[0])} aria-label={`放大查看${r.name}的角色图`} title="放大查看">
                  <img src={imageUrl(r.images.find((image) => image.id === r.design_media_id) || r.images[0])} alt={`${r.name}的角色图片`} />
                  <span><ZoomIn size={16} /> 放大查看</span>
                </button>
              ) : (
                r.name.slice(0, 1)
              )}
              <Tag className="role-kind">角色</Tag>
            </div>
            <button type="button" className="role-details-trigger" aria-label={`查看${r.name}的角色详情`} onClick={() => setDetailId(r.id)}>
              <h3>{r.name}</h3>
              <p>{r.description || "添加角色形象描述，保持生成的一致性。"}</p>
            </button>
            <div className="role-foot">
              <span className="role-asset-count">{r.images.length} 张角色图 · {r.audios?.length || 0} 段音色参考</span>
              <div className="role-card-actions">
              <Button type="text" size="mini" onClick={() => setEditing(r)}>
                设定
              </Button>
              <Popconfirm
                title="删除角色？"
                onOk={() =>
                  post("/roles/delete", {
                    project_id: data.project.id,
                    id: r.id,
                  }).then(reload)
                }
              >
                <Button type="text" size="mini" status="danger">
                  删除
                </Button>
              </Popconfirm>
              </div>
            </div>
          </Card>
        ))}
        <Card
          className="role-card role-create"
          bodyStyle={{ padding: 16 }}
          role="button"
          tabIndex={0}
          aria-label="创建角色"
          onClick={() => void make().catch((e) => Message.error(String(e)))}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              void make().catch((e) => Message.error(String(e)));
            }
          }}
        >
          <div className="role-pic"><Plus size={28} strokeWidth={1.4} /></div>
          <h3>创建角色</h3>
          <p>{data.roles.length ? "继续添加人物设定" : "记录第一个角色，让镜头保持形象一致。"}</p>
        </Card>
      </div>
      </>}
      <ImagePreviewModal media={roleImagePreview} images={previewImages} onMediaChange={setRoleImagePreview} title="角色图预览" onClose={()=>setRoleImagePreview(null)} />
      <RoleEditor
        role={editing}
        data={data}
        onClose={() => setEditing(null)}
        reload={reload}
      />
    </section>
  );
}
function RoleEditor({
  role,
  data,
  onClose,
  reload,
}: {
  role: Role | null;
  data: Snapshot;
  onClose: () => void;
  reload: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [design, setDesign] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [savingRole, setSavingRole] = useState(false);
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [importingAsset, setImportingAsset] = useState(false);
  const [pendingImage, setPendingImage] = useState<{id:number;name:string}|null>(null);
  const [renamingImage, setRenamingImage] = useState<{id:number;name:string}|null>(null);
  const [imagePreview, setImagePreview] = useState<Media | null>(null);
  const currentRole = data.roles.find((x) => x.id === role?.id) || role;
  useEffect(() => {
    setName(role?.name || "");
    setDescription(role?.description || "");
    setDesign(role?.design_media_id || null);
    setAssetsOpen(false);
    setImagePreview(null);
    setPendingImage(null);
  }, [role]);
  const upload = async () => {
    const source = await open({
      multiple: false,
      filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    if (typeof source !== "string" || !role) return;
    const imported = await post<Media>("/media/import", {
      project_id: data.project.id,
      source_path: source,
    });
    await reload();
    setPendingImage({id:imported.id,name:""});
  };
  const importAsset = async (mediaId: number) => {
    if (!role || importingAsset) return;
    setAssetsOpen(false);
    setPendingImage({id:mediaId,name:""});
  };
  const confirmRoleImage = async () => {
    if (!role || !pendingImage || importingAsset) return;
    if (!pendingImage.name.trim()) return Message.warning("请输入角色图片名称");
    setImportingAsset(true);
    try {
      await post("/roles/media/add", {
        project_id: data.project.id, role_id: role.id,
        media_id: pendingImage.id, name: pendingImage.name.trim(),
      });
      setDesign(pendingImage.id);
      setPendingImage(null);
      await reload();
      Message.success("角色图片已添加，保存角色后设为主图");
    } catch (e) { Message.error(String(e)); }
    finally { setImportingAsset(false); }
  };
  const removeImage = async (id: number) => {
    if (!role) return;
    await post("/roles/media/delete", {
      project_id: data.project.id,
      role_id: role.id,
      media_id: id,
    });
    if (design === id) setDesign(currentRole?.images.find((image) => image.id !== id)?.id ?? null);
    if (imagePreview?.id === id) setImagePreview(null);
    await reload();
    Message.success("角色图片已删除");
  };
  const renameImage = async () => {
    if (!renamingImage || !renamingImage.name.trim()) return Message.warning("请输入图片名称");
    try {
      await post("/media/rename", { project_id:data.project.id, id:renamingImage.id, name:renamingImage.name.trim() });
      await reload();
      setRenamingImage(null);
      Message.success("角色图片名称已更新，可用 @角色.图片名 引用");
    } catch(error) { Message.error(String(error)); }
  };
  const generateRoleImage = async (operation: "t2i" | "i2i") => {
    if (!role || generating) return;
    if (!description.trim()) return Message.warning("请先填写角色形象描述");
    if (operation === "i2i" && !design) return Message.warning("请先选择一张角色设计图作为参考");
    setGenerating(true);
    try {
      const result = await post<Media>("/generations/image", {project_id:data.project.id, operation,
        prompt:resolvePrompt(description, data.roles), aspect_ratio:"1:1", image_media_ids:operation === "i2i" ? [design] : []});
      await reload();
      setPendingImage({id:result.id,name:""});
    } catch(e) { Message.error(String(e)); }
    finally { setGenerating(false); }
  };
  const saveRole = async () => {
    if (!role || savingRole || importingAsset) return;
    if (!name.trim()) return Message.warning("请输入角色名称");
    setSavingRole(true);
    try {
      await post("/roles/update", {project_id:data.project.id,id:role.id,name:name.trim(),description,design_media_id:design});
      await reload(); onClose();
    } catch(e) { Message.error(String(e)); }
    finally { setSavingRole(false); }
  };
  return (
    <Drawer
      width="min(620px, 100vw)"
      title="角色设定"
      visible={!!role}
      onCancel={() => { if (!generating && !savingRole && !importingAsset) onClose(); }}
      footer={
        <Button
          type="primary"
          loading={savingRole}
          disabled={generating || importingAsset}
          onClick={saveRole}
        >
          保存角色
        </Button>
      }
    >
      <Form layout="vertical">
        <Form.Item label="角色名称">
          <Input value={name} onChange={setName} />
        </Form.Item>
        <Form.Item label="角色形象描述">
          <Input.TextArea
            value={description}
            onChange={setDescription}
            placeholder="年龄、发型、服装、表情、画风等。此描述可直接进入生成 Prompt。"
            autoSize={{ minRows: 5 }}
          />
        </Form.Item>
        <Form.Item
          label="角色设计图"
          extra="一个角色可以关联多张图片。点击图片放大预览，点击“设为主图”选择主图，再点底部“保存角色”生效。"
        >
          <Space direction="vertical" style={{ width: "100%" }}>
            <Space wrap>
              <Button
                icon={<ImagePlus size={15} />}
                disabled={generating || savingRole || importingAsset}
                onClick={() => setAssetsOpen(true)}
              >
                从资产库选择
              </Button>
              <Button
                icon={<Upload size={15} />}
                onClick={() => upload().catch((e) => Message.error(String(e)))}
              >
                导入角色图片
              </Button>
            </Space>
            <div className="role-image-library">
              <div className="role-image-library-heading">
                <b>已关联图片</b>
                <span>{currentRole?.images.length || 0} 张</span>
              </div>
              {currentRole?.images.length ? <div className="media-picker">
                {currentRole.images.map((m) => (
                  <div
                    key={m.id}
                    className={design === m.id ? "media-option selected" : "media-option"}
                    onClick={() => setImagePreview(m)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setImagePreview(m); } }}
                    aria-label={`放大预览 ${m.name}${design === m.id ? "，当前主图" : ""}`}
                  >
                    <img src={imageUrl(m)} alt={m.name} />
                    <span>{design === m.id ? "主图 · " : ""}{m.name}</span>
                    <button type="button" className="role-image-rename" aria-label={`编辑图片名称 ${m.name}`} title="编辑图片名称" onClick={(e) => { e.stopPropagation(); setRenamingImage({id:m.id,name:m.name}); }}><Pencil size={12}/></button>
                    {design !== m.id && <button type="button" className="role-image-primary" onClick={(e) => { e.stopPropagation(); setDesign(m.id); }}>设为主图</button>}
                    <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                    <Popconfirm
                      title="从该角色中删除这张图片？"
                      onOk={() => removeImage(m.id).catch((e) => Message.error(String(e)))}
                    >
                      <button
                        type="button"
                        className="role-image-delete"
                        aria-label={`删除 ${m.name}`}
                        title="从角色中删除图片"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Trash2 size={13} /> 删除
                      </button>
                    </Popconfirm>
                    </div>
                  </div>
                ))}
              </div> : <p className="subtle role-image-empty">还没有关联图片。可从资产库添加多张，或导入本地图片。</p>}
            </div>
      </Space>
        </Form.Item>
        {currentRole&&<RoleAudioReferences key={currentRole.id} role={currentRole} data={data} reload={reload} editable/>}
        <Form.Item label="生成方式">
          <Space>
            <Button icon={<Sparkles size={15} />} type="primary" loading={generating} onClick={() => generateRoleImage("t2i")}>
              文生图
            </Button>
            <Button icon={<ImagePlus size={15} />} disabled={generating || !design} onClick={() => generateRoleImage("i2i")}>图生图</Button>
          </Space>
          <p className="subtle">
            创建生成任务会使用「设置」中配置的 t2i / i2i 服务。
          </p>
        </Form.Item>
      </Form>
      <AssetImagePicker
        visible={!!role && assetsOpen}
        label="角色设计图"
        value={design}
        data={data}
        busy={importingAsset}
        onSelect={importAsset}
        onClose={() => { if (!importingAsset) setAssetsOpen(false); }}
      />
      <Modal visible={!!pendingImage} title="设置角色图片名称" okText="确认添加" confirmLoading={importingAsset}
        okButtonProps={{disabled:!pendingImage?.name.trim()}} cancelButtonProps={{disabled:importingAsset}}
        maskClosable={!importingAsset} closable={!importingAsset}
        onCancel={() => { if (!importingAsset) setPendingImage(null); }} onOk={confirmRoleImage}>
        <Form layout="vertical" disabled={importingAsset}><Form.Item label="角色图片名称" required extra="填写名称后才会关联到角色，可用 @角色.图片名称 引用。">
          <Input autoFocus aria-label="角色图片名称" value={pendingImage?.name || ""} placeholder="请输入名称，例如：正面、侧面、校服"
            onChange={name => setPendingImage(current => current ? {...current,name} : null)} onPressEnter={confirmRoleImage}/>
        </Form.Item></Form>
      </Modal>
      <Modal visible={!!renamingImage} title="编辑角色图片名称" okText="保存名称" onCancel={() => setRenamingImage(null)} onOk={renameImage}>
        <Form layout="vertical"><Form.Item label="图片名称" extra="图生图时可用 @角色.图片名称 引用这张图片。">
          <Input autoFocus value={renamingImage?.name || ""} onChange={name => setRenamingImage(current => current ? {...current,name} : null)} onPressEnter={renameImage}/>
        </Form.Item></Form>
      </Modal>
      <ImagePreviewModal media={imagePreview} images={currentRole?.images || []} onMediaChange={setImagePreview} title="角色图预览" onClose={()=>setImagePreview(null)} />
    </Drawer>
  );
}
export function Prompts({ data, reload }: { data: Snapshot; reload: () => void }) {
  const [editing, setEditing] = useState<{
    id?: number;
    name: string;
    content: string;
    category: string;
  } | null>(null);
  const add = async () => {
    const p = await post<typeof editing>("/prompts", {
      project_id: data.project.id,
      name: "新 Prompt",
      content: "",
      category: "通用",
    });
    await reload();
    setEditing(p);
  };
  return (
    <section>
      <div className="section-title page-actions">
        <div className="page-intro"><h1>Prompt 库</h1><p>管理常用提示词，在角色与场景生成时复用。</p></div>
        <Button
          type="primary"
          className="prompt-create-button"
          icon={<Plus size={16} />}
          onClick={() => add().catch((e) => Message.error(String(e)))}
        >
          新建 Prompt
        </Button>
      </div>
      <div className="prompt-library-heading">
        <h2>预设风格</h2>
        <p>生成图片时可直接选用，也可另存后调整为自己的风格。</p>
      </div>
      <div className="prompt-grid prompt-presets">
        {STYLE_PRESETS.map((preset) => (
          <Card key={preset.id} className="prompt-card" title={preset.name}>
            <p>{preset.content}</p>
            <div className="prompt-card-actions"><Button size="small" onClick={() => setEditing({ name: preset.name, content: preset.content, category: preset.category })}>另存为我的 Prompt</Button></div>
          </Card>
        ))}
      </div>
      <div className="prompt-library-heading"><h2>我的 Prompt</h2></div>
      {!data.prompts.length && <EmptyState
        title="还没有自定义 Prompt"
        description="新建一条提示词，或从上方预设风格中另存为你自己的版本。"
        action={<Button type="primary" icon={<Plus size={16} />} onClick={() => void add().catch((e) => Message.error(String(e)))}>新建 Prompt</Button>}
      />}
      <div className="prompt-grid">
        {data.prompts.map((p) => (
          <Card
            key={p.id}
            className="prompt-card"
            title={p.name}
          >
            <Tag>{p.category}</Tag>
            <p>{p.content || "尚未填写内容"}</p>
            <div className="prompt-card-actions"><Button size="small" onClick={() => setEditing(p)} icon={<Pencil size={14} />}>编辑</Button></div>
          </Card>
        ))}
      </div>
      <Modal
        title={editing?.id == null ? "另存 Prompt" : "编辑 Prompt"}
        visible={!!editing}
        onCancel={() => setEditing(null)}
        onOk={() =>
          post(editing?.id == null ? "/prompts" : "/prompts/update", { project_id: data.project.id, ...editing })
            .then(reload)
            .then(() => setEditing(null))
        }
      >
        <Form layout="vertical">
          <Form.Item label="名称">
            <Input
              value={editing?.name}
              onChange={(v) => setEditing((x) => (x ? { ...x, name: v } : x))}
            />
          </Form.Item>
          <Form.Item label="分类">
            <Select
              value={editing?.category}
              onChange={(v) =>
                setEditing((x) => (x ? { ...x, category: v } : x))
              }
            >
              <Select.Option value="通用">通用</Select.Option>
              <Select.Option value="角色">角色</Select.Option>
              <Select.Option value="场景">场景</Select.Option>
              <Select.Option value="风格">风格</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item label="Prompt 内容">
            <Input.TextArea
              value={editing?.content}
              onChange={(v) =>
                setEditing((x) => (x ? { ...x, content: v } : x))
              }
              autoSize={{ minRows: 7 }}
              placeholder="用自然语言描述镜头、画风、光线与主体…"
            />
          </Form.Item>
        </Form>
      </Modal>
    </section>
  );
}
export function SettingsPage({
  data,
  reload,
}: {
  data: Snapshot;
  reload: () => void;
}) {
  const [settings, setSettings] = useState<ModelSettings>({
    ...data.settings,
  });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [projectsDirectory, setProjectsDirectory] = useState("");
  const [savedDirectory, setSavedDirectory] = useState<string | null>(null);
  const [loadingDirectory, setLoadingDirectory] = useState(true);
  const [savingDirectory, setSavingDirectory] = useState(false);
  const directoryDirty = savedDirectory !== null && projectsDirectory !== savedDirectory;
  useEditGuard(dirty || directoryDirty);
  const loadDirectory = async () => {
    setLoadingDirectory(true);
    try {
      const config = await post<{ projects_directory: string }>("/app/settings/load");
      setProjectsDirectory(config.projects_directory);
      setSavedDirectory(config.projects_directory);
    } catch (e) { Message.error(String(e)); }
    finally { setLoadingDirectory(false); }
  };
  useEffect(() => { void loadDirectory(); }, []);
  const chooseDirectory = async () => {
    try {
      const selected = await open({ directory: true, multiple: false, title: "选择项目存储目录", defaultPath: projectsDirectory || undefined });
      if (typeof selected === "string") setProjectsDirectory(selected);
    } catch (e) { Message.error(String(e)); }
  };
  const saveDirectory = async () => {
    if (savingDirectory || !directoryDirty) return;
    if (!projectsDirectory.trim()) { Message.warning("请输入项目存储路径"); return; }
    setSavingDirectory(true);
    try {
      const config = await post<{ projects_directory: string }>("/app/settings/save", { projects_directory: projectsDirectory.trim() });
      setProjectsDirectory(config.projects_directory);
      setSavedDirectory(config.projects_directory);
      Message.success("项目存储路径已保存");
    } catch (e) { Message.error(String(e)); }
    finally { setSavingDirectory(false); }
  };
  useEffect(
    () => {
      if (dirty) return;
      setSettings({
        ...data.settings,
      });
    },
    [data.settings, dirty],
  );
  const methods = [
    ["image", "图片生成", "Text / Image to Image"],
    ["video", "视频生成", "Text / Image to Video"],
    ["llm", "LLM（分镜与 Prompt）", "OpenAI Chat Completions"],
  ];
  const set = (key: string, field: string, value: string) => {
    setDirty(true);
    setSettings((s) => ({
      ...s,
      [key]: {
        ...(s[key] || { url: "", api_key: "", description: "" }),
        [field]: value,
      },
    }));
  };
  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await post("/settings", { project_id: data.project.id, settings });
      await reload(); setDirty(false); Message.success("接口配置已保存");
    } finally { setSaving(false); }
  };
  return (
    <section>
      <div className="section-title page-actions">
        <div className="page-intro"><h1>工作室设置</h1><p>管理项目存储位置、Skills 技能与创作服务配置。</p></div>
        <Button
          type="primary"
          icon={<Save size={16} />}
          loading={saving}
          disabled={!dirty}
          onClick={() => save().catch((e) => Message.error(String(e)))}
        >
          {dirty ? "保存配置" : "配置已保存"}
        </Button>
      </div>
      <div className="setting-block">
        <div className="setting-heading">
          <h3>项目存储</h3>
          <p>项目地址路径</p>
        </div>
        <Form layout="vertical" disabled={loadingDirectory || savingDirectory || savedDirectory === null}>
          <Form.Item label="项目存储路径" extra={`新建项目和从备份恢复的项目会保存在此目录，每个项目使用独立子文件夹。修改后已有项目仍保留在原位置。${isLocalDesktop ? "" : "请填写后端服务器上的绝对路径。"}`}>
            <div className="project-directory-input">
              <Input value={projectsDirectory} onChange={setProjectsDirectory} placeholder="输入项目存储目录的完整路径" aria-label="项目存储路径" />
              {isLocalDesktop && <Button onClick={() => void chooseDirectory()}>选择文件夹</Button>}
            </div>
          </Form.Item>
          <Space>
            <Button type="primary" loading={savingDirectory} disabled={!directoryDirty || loadingDirectory} onClick={() => void saveDirectory()}>保存项目路径</Button>
            {savedDirectory === null && !loadingDirectory && <Button onClick={() => void loadDirectory()} disabled={false}>重新加载</Button>}
          </Space>
        </Form>
      </div>
      <SkillsSettings />
      {methods.map(([key, label, sub]) => {
        const image = key === "image";
        const video = key === "video";
        const llm = key === "llm";
        const provider = settings[key]?.provider || "cast";
        return (
          <div className="setting-block" key={key}>
            <div className="setting-heading"><h3>{label}</h3>
            <p>{sub}</p></div>
            <Form layout="vertical" disabled={saving}>
              <div className={`settings-fields ${image && provider === "openai" ? "settings-fields-openai" : ""}`}>
                {image && <Form.Item label="接口类型">
                  <Select value={provider} onChange={v => set(key, "provider", v)} style={{width:260}}
                    options={[{label:"CAST 兼容接口",value:"cast"},{label:"OpenAI 官方兼容接口",value:"openai"}]}/>
                </Form.Item>}
                {image && provider === "openai" ? <>
                  <Form.Item label="服务地址（Base URL）"><Input value={settings[key]?.base_url || ""}
                    onChange={v => set(key,"base_url",v)} placeholder="https://api.openai.com/v1"/></Form.Item>
                  <Form.Item label="模型名称"><Input value={settings[key]?.model || ""}
                    onChange={v => set(key,"model",v)} placeholder="默认 gpt-image-1"/></Form.Item>
                </> : <Form.Item label={image || video || llm ? "服务地址（Base URL）" : "服务地址"}><Input value={(settings[key]?.base_url || settings[key]?.url || (image ? settings.t2i?.url : video ? (settings.t2v?.url || settings.i2v?.url) : "")) || ""}
                  onChange={v => set(key,image||video||llm ? "base_url" : "url",v)} placeholder={llm ? "https://api.openai.com/v1" : video ? "http://127.0.0.1:8190" : "http://127.0.0.1:8190"}/></Form.Item>}
                <Form.Item label={provider === "openai" ? "API Key" : "API Key（可选）"}>
                  <Input.Password value={settings[key]?.api_key || (image ? settings.t2i?.api_key : "") || ""} onChange={v => set(key,"api_key",v)} placeholder="输入 API Key"/>
                </Form.Item>
                {llm&&<Form.Item label="模型名称"><Input value={settings[key]?.model || ""} onChange={v=>set(key,"model",v)} placeholder="例如 gpt-4o-mini"/></Form.Item>}
              </div>
            </Form>
          </div>
        );
      })}
      <Card className="connection-help" title="接口约定" bordered={false}>
        <Typography.Paragraph style={{ margin: 0 }}>
          图片配置共用一组 URL 与 API Key；OpenAI 模式会根据 Base URL 自动调用 <code>/images/generations</code>
          （t2i）或 <code>/images/edits</code>
          （i2i），并将画面比例映射为官方支持的尺寸。视频 Base URL 会按生成方式补全接口路径。Prompt 优化使用 OpenAI 格式的{" "}
          <code>/chat/completions</code>。CAST 图片接口也会按生成方式补全路径。{" "}
          <code>
            POST /v1/generations/{"{"}t2i | i2i | t2v | ref2v | fl2v{"}"}
          </code>{" "}
          格式。
        </Typography.Paragraph>
      </Card>
    </section>
  );
}
