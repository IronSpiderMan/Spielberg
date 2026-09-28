import React,{ lazy,useEffect,useRef,useState } from "react";

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
Select,
Space,
Tag,
Typography
} from "@arco-design/web-react";
import { open,save as saveDialog } from "./platform";
import {
ArrowDown,
ArrowUp,
ChevronDown,
ChevronRight,
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


import { api,defaultOptions,Episode,FrameKey,GenerationOptions,GENERATION_SIZES,imageUrl,Media,ModelSettings,post,Project,Role,Scene,Snapshot } from "./core";
import { confirmDiscard,useEditGuard } from "./edit-guard";
import { resolvePrompt } from "./resolve-prompt";
import { findMentions, promptMentions } from "./prompt-mentions";
import { STYLE_PRESETS } from "./prompt-presets";
const SequencePreview=lazy(()=>import("./creation").then(m=>({default:m.SequencePreview})));
const ImageStudio=lazy(()=>import("./creation").then(m=>({default:m.ImageStudio})));

function videoRequest(scene: Scene, settings: ModelSettings, roles: Role[]) {
  const options = scene.generation_options || defaultOptions;
  const selected = options.custom
    ? { first: options.first, last: options.last, reference: options.reference }
    : {
        first: Boolean(scene.first_media_id),
        last: Boolean(scene.last_media_id),
        reference: Boolean(scene.reference_media_id),
      };
  if (!scene.description.trim()) throw new Error(`${scene.title}：请填写描述`);
  for (const key of ["first", "last", "reference"] as const) {
    if (selected[key] && !scene[`${key}_media_id`])
      throw new Error(
        `${scene.title}：请选择${{ first: "首帧", last: "尾帧", reference: "参考图" }[key]}或取消勾选`,
      );
  }
  const first = selected.first ? scene.first_media_id : null,
    last = selected.last ? scene.last_media_id : null,
    reference = selected.reference ? scene.reference_media_id : null;
  const operation =
    first && last ? "flf2v" : first || last || reference ? "i2v" : "t2v";
  if (!(settings.video?.base_url || settings.video?.url || settings[operation]?.url || (operation === "flf2v" && settings.fl2v?.url)))
    throw new Error("请先配置视频生成 Base URL");
  return {
    scene_id: scene.id,
    prompt: resolvePrompt(scene.description, roles),
    operation,
    duration: options.duration,
    aspect_ratio: options.aspect_ratio,
    size: options.size,
    first_media_id: first,
    last_media_id: last,
    image_media_id: reference || (first && last ? null : first || last),
  };
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
  return (
    <section className="studio">
      <div className="page-heading">
        <div>
          <h2>剧集编排</h2>
          <p>为每个场景选一个版本，串起你的故事。</p>
        </div>
        <Button
          icon={<Plus size={16} />}
          onClick={() => changePage("episodes")}
        >
          管理场景
        </Button>
      </div>
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
      <div className="cut-preview">
        {merged ? (
          <video
            key={merged.id}
            src={imageUrl(merged)}
            controls
            autoPlay
            onError={() => Message.error("无法播放合并视频，请检查本地文件")}
          />
        ) : (
          <SequencePreview scenes={scenes} />
        )}
      </div>
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
      <div className="sequence-flow" hidden={!scenes.length}>{scenes.map((s,i) => <React.Fragment key={s.id}><span className={s.video_media_id ? "ready" : ""}>{`场景 ${String(i+1).padStart(2,"0")}`}<small>{s.title}</small></span><ChevronRight size={18}/></React.Fragment>)}<span className="sequence-result">成片<small>编排结果</small></span></div>
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
            <SceneThumb scene={scene} />
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
      <EpisodeEditor
        episode={editing}
        project={data.project}
        data={data}
        onClose={() => setEditing(null)}
        reload={reload}
      />
    </section>
  );
}
function EpisodeCover({episode}: {episode: {cover_media?: Media; scenes?: Scene[]}}) {
  const video = episode.scenes?.[0] && sceneVideos(episode.scenes[0])[0];
  return <div className="episode-cover">{episode.cover_media ? <img src={imageUrl(episode.cover_media)} alt="剧集封面"/> : video ? <video src={`${imageUrl(video)}#t=0.001`} muted preload="auto" aria-label="默认剧集封面"/> : <Film size={28}/>}</div>;
}
function VideoAsset({video, scene, projectId, reload}: {video:Media;scene?:Scene;projectId:string;reload?:()=>void}) {
  const [preview,setPreview] = useState(false);
  const [deleting,setDeleting] = useState(false);
  const [resolution,setResolution] = useState("");
  const onMetadata = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    const el = event.currentTarget;
    if (el.videoWidth && el.videoHeight) setResolution(`${el.videoWidth} × ${el.videoHeight}`);
  };
  const download = async () => {
    try {
      const path = await saveDialog({defaultPath:video.name,filters:[{name:"视频",extensions:[video.path.split('.').pop() || "mp4"]}]});
      if(path) {await post("/media/export",{project_id:projectId,media_id:video.id,destination_path:path});Message.success("视频已保存");}
    } catch(e){Message.error(String(e));}
  };
  return <div className="video-asset">
    <video src={imageUrl(video)} controls muted playsInline preload="auto" onLoadedMetadata={onMetadata} onLoadedData={event=>{const el=event.currentTarget;if(el.duration>0)el.currentTime=Math.min(.1,el.duration/2);}} onDoubleClick={()=>setPreview(true)}/>
    <Space wrap>
      <Button size="mini" icon={<ZoomIn size={14}/>} onClick={()=>setPreview(true)}>放大预览</Button>
      <Button size="mini" icon={<Download size={14}/>} onClick={download}>下载</Button>
      {scene && <Popconfirm title="删除这个场景视频版本？" onOk={async()=>{
        setDeleting(true);
        try {await post("/scenes/delete-video",{project_id:projectId,scene_id:scene.id,media_id:video.id});await reload?.();Message.success("视频版本已删除");} catch(e){Message.error(String(e));} finally {setDeleting(false);}
      }}><Button size="mini" status="danger" loading={deleting} icon={<Trash2 size={14}/>}>删除</Button></Popconfirm>}
    </Space>
    <Modal title={video.name} visible={preview} onCancel={()=>setPreview(false)} footer={null} style={{width:"min(1100px, 90vw)"}} unmountOnExit>
      <div className="video-resolution">{resolution ? `分辨率 ${resolution}` : "正在读取分辨率…"}</div>
      <video style={{width:"100%",maxHeight:"75vh",background:"#000"}} src={imageUrl(video)} controls autoPlay onLoadedMetadata={onMetadata}/>
    </Modal>
  </div>;
}
type BackgroundJob = {id:number;project_id:string;project_name:string;scene_id?:number;operation:string;status:string;prompt:string;created_at:string;updated_at:string;error?:string;result?:Media};
type JobCursor = Pick<BackgroundJob,"created_at"|"project_id"|"id">;
type JobPage = {items:BackgroundJob[];next_cursor:JobCursor|null;has_more:boolean};
export function Tasks() {
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
        const page=await post<JobPage>("/tasks",{status:filter,limit:20,...(cursor ? more?{before:cursor}:{through:cursor}: {})});
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
  },[filter]);
  const labels:Record<string,string>={running:"执行中",completed:"已完成",failed:"失败",interrupted:"已中断"};
  return <section><div className="section-title"><div><h1>后台任务</h1><p>所有项目的图片、视频生成与合并任务，页面可见时自动更新，可切换页面继续编辑。</p></div>
    <Select aria-label="任务状态" value={filter} onChange={setFilter} style={{width:160}}><Select.Option value="all">全部状态</Select.Option>{Object.entries(labels).map(([k,v])=><Select.Option key={k} value={k}>{v}</Select.Option>)}</Select></div>
    {error && <p role="alert">{error}</p>}
    <div className="task-list">{jobs.map(job=><Card key={`${job.project_id}-${job.id}`}>
      <Space wrap><b>{job.project_name}</b><Tag>{job.operation.includes("image")?"图片生成":job.operation.includes("video")?"视频生成":"剧集合并"}</Tag><Tag color={job.status==="failed"?"red":job.status==="completed"?"green":"blue"}>{labels[job.status]||job.status}</Tag></Space>
      <p>{job.prompt}</p><small>{new Date(Number(job.created_at)*1000).toLocaleString()} · #{job.id}</small>
      {job.error && <p className="generation-error">{job.error}</p>}
      {job.result?.kind==="video" && <VideoAsset video={job.result} projectId={job.project_id}/>}
      {job.result?.kind==="image" && <img className="task-image" src={imageUrl(job.result)} alt="生成结果"/>}
    </Card>)}</div>
    <div style={{textAlign:"center",padding:24}}>
      {(hasMore||loading||error)&&<Button loading={loading} onClick={()=>loadMore.current()}>{error?"重试":hasMore?"加载更多":"加载中"}</Button>}
      {!hasMore&&!loading&&jobs.length>0&&<span className="helper">已加载全部任务</span>}
    </div>
    {!jobs.length&&!loading&&!error&&<Empty description={filter==="all"?"暂无后台任务":"暂无符合此状态的任务"}/>}</section>;
}
function SceneThumb({ scene, onPreview }: { scene: Scene; onPreview?: () => void }) {
  const content = <>
    {scene.first_media ? (
      <img src={imageUrl(scene.first_media)} alt="" />
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
  const [failures, setFailures] = useState<string[]>([]);
  const [previewSceneId, setPreviewSceneId] = useState<number | null>(null);
  const [previewVideoId, setPreviewVideoId] = useState<number | null>(null);
  const previewScene = data.episodes.flatMap((item) => item.scenes).find((scene) => scene.id === previewSceneId);
  const previewVideos = previewScene ? sceneVideos(previewScene) : [];
  const previewVideo = previewVideos.find((video) => video.id === previewVideoId) || previewVideos[0];
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
        videoRequest(scene, data.settings, data.roles),
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
  const makeScene = async (id: number) => {
    setInserting(id);
    try {
    const x = await post<Scene>("/scenes", {
      project_id: data.project.id,
      episode_id: id,
      title: "空场景",
      description: "",
    });
    await reload();
    editScene(x, true);
    } finally { setInserting(null); }
  };
  return (
    <section>
      <div className="section-title">
        <div>
          <p className="eyebrow">EPISODES & SHOTS</p>
          <h1>剧集管理</h1><p>管理故事结构、镜头素材与生成版本。</p>
        </div>
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
                  title="确认删除这集及全部场景？"
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
                    <SceneThumb scene={s} onPreview={sceneVideos(s).length ? () => openScenePreview(s) : undefined} />
                    <div className="scene-copy"><b>{s.title}</b><p>{s.description || "尚未填写镜头描述"}</p></div>
                    <div className="scene-actions">
                    <Tag color={s.video_media_id ? "green" : "gray"}>
                      {s.video_media_id ? "视频已就绪" : (s.first_media_id || s.last_media_id || s.reference_media_id) ? "已设画面" : "待制作"}
                    </Tag>
                    <SceneOrderControls episode={ep} index={i} project={data.project} reload={reload}/>
                    <Button size="mini" disabled={!sceneVideos(s).length} icon={<Play size={13}/>} onClick={() => openScenePreview(s)}>预览</Button>
                    <Button size="mini" onClick={() => editScene(s, false)}>编辑</Button>
                    <Popconfirm title="确认删除这个场景？场景中的视频版本关联也会移除。" onOk={async()=>{
                      try {await post("/scenes/delete",{project_id:data.project.id,id:s.id});await reload();Message.success("场景已删除");} catch(e){Message.error(String(e));}
                    }}><Button size="mini" status="danger" icon={<Trash2 size={14}/>}>删除</Button></Popconfirm>
                    </div>
                  </div>
                ))}
                <Button
                  loading={inserting === ep.id}
                  disabled={inserting !== null}
                  className="empty-scene"
                  type="text"
                  icon={<Plus size={14} />}
                  onClick={() =>
                    makeScene(ep.id).catch((e) => Message.error(String(e)))
                  }
                >
                  插入空场景
                </Button>
              </div>
            </Card>
          ))
        ) : (
          <Empty description="创建第一个剧集，开始排布场景" />
        )}
      </div>
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
        {batchResult && <video className="asset-preview" controls src={imageUrl(batchResult)}/>}
        {progress && <p role="status">{progress}</p>}
        {failures.map((error, i) => (
          <p className="generation-error" key={i}>
            {error}
          </p>
        ))}
      </Modal>
      <Modal
        className="scene-video-preview-modal"
        title={`视频预览 · ${previewScene?.title || ""}`}
        visible={!!previewScene}
        footer={null}
        unmountOnExit
        onCancel={() => {setPreviewSceneId(null); setPreviewVideoId(null);}}
      >
        {previewVideo && <>
          <div className="scene-video-preview-toolbar">
            <div>
              <b>{previewVideo.name}</b>
              <span>{previewVideo.id === previewScene?.video_media_id ? "当前采用" : "其他版本"}</span>
            </div>
            {previewVideos.length > 1 && <Select aria-label="选择视频版本" value={previewVideo.id} onChange={setPreviewVideoId}>
              {previewVideos.map((video, index) => <Select.Option key={video.id} value={video.id}>版本 {index + 1}{video.id === previewScene?.video_media_id ? " · 当前采用" : ""}</Select.Option>)}
            </Select>}
          </div>
          <video key={previewVideo.id} className="scene-video-preview" controls autoPlay preload="metadata" src={imageUrl(previewVideo)} onError={() => Message.error("视频无法播放，请检查文件或更换版本")} />
        </>}
      </Modal>
      <EpisodeEditor
        episode={episode}
        project={data.project}
        data={data}
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
}: {
  data: Snapshot;
  episode: { id: number; title: string; description: string; cover_media?: Media; scenes?: Scene[] } | null;
  project: Project;
  onClose: () => void;
  reload: () => void;
}) {
  const [cover, setCover] = useState<Media | undefined>(episode?.cover_media);
  const [coverPrompt, setCoverPrompt] = useState("");
  const [generating, setGenerating] = useState(false);
  const uploadCover = async () => {
    const path = await open({multiple:false, filters:[{name:"图片",extensions:["png","jpg","jpeg","webp"]}]});
    if (typeof path === "string") setCover(await post<Media>("/media/import",{project_id:project.id,source_path:path}));
  };
  const generateCover = async () => {
    if (!coverPrompt.trim()) { Message.warning("请输入封面画面描述"); return; }
    setGenerating(true);
    try {setCover(await post<Media>("/generations/image",{project_id:project.id,operation:"t2i",prompt:coverPrompt,aspect_ratio:"16:9"}));}
    catch(e) {Message.error(String(e));} finally {setGenerating(false);}
  };
  const [title, setTitle] = useState(episode?.title || "");
  const [description, setDescription] = useState(episode?.description || "");
  useEffect(() => {
    setCover(episode?.cover_media);
    setCoverPrompt(episode?.description || "");
    setTitle(episode?.title || "");
    setDescription(episode?.description || "");
  }, [episode]);
  return (
    <Modal
      title="编辑剧集"
      className="episode-editor-modal"
      style={{ width: 640, maxWidth: "calc(100vw - 32px)" }}
      visible={!!episode}
      onCancel={onClose}
      okText="保存"
      okButtonProps={{disabled: generating}}
      onOk={() =>
        post("/episodes/update", {
          project_id: project.id,
          id: episode?.id,
          cover_media_id: cover?.id || null,
          title,
          description,
        })
          .then(reload)
          .then(onClose)
          .catch(e => Message.error(String(e)))
      }
    >
      <Form layout="vertical">
        <Form.Item label="剧集封面" extra="默认使用第一个场景的第一个视频画面">
          <div className="episode-cover-controls">
            {episode && <EpisodeCover episode={{...episode, scenes: data.episodes.find(ep => ep.id === episode.id)?.scenes, cover_media:cover}} />}
            <div className="episode-cover-actions">
              <Button disabled={generating} onClick={() => uploadCover().catch(e => Message.error(String(e)))}>上传封面</Button>
              <SceneFramePicker data={data} reload={reload} onSelect={setCover} disabled={generating}/>
              <Button disabled={generating} onClick={() => setCover(undefined)}>恢复默认</Button>
            </div>
          </div>
        </Form.Item>
        <Form.Item label="封面画面描述">
          <div className="episode-cover-generator">
            <Input.TextArea value={coverPrompt} onChange={setCoverPrompt} autoSize={{ minRows: 2, maxRows: 4 }} placeholder="描述想生成的封面画面" />
            <Button loading={generating} disabled={!coverPrompt.trim()} onClick={generateCover} icon={<Sparkles size={14}/>}>文生图生成封面</Button>
          </div>
        </Form.Item>
        <Form.Item label="剧集标题">
          <Input value={title} onChange={setTitle} />
        </Form.Item>
        <Form.Item label="剧集简介">
          <Input.TextArea value={description} onChange={setDescription} />
        </Form.Item>
        <Form.Item label="场景顺序" extra="调整后立即保存，并同步到工作台">
          {(data.episodes.find(ep => ep.id === episode?.id)?.scenes || []).map((scene, index) => <div className="episode-order-row" key={scene.id}><span>{index + 1}. {scene.title}</span><SceneOrderControls episode={data.episodes.find(ep => ep.id === episode?.id)!} index={index} project={project} reload={reload}/></div>)}
          {!data.episodes.find(ep => ep.id === episode?.id)?.scenes.length && <span className="subtle">暂无场景</span>}
        </Form.Item>
      </Form>
    </Modal>
  );
}
function AssetImagePicker({ visible, label, value, data, onSelect, onClose, busy = false }: {
  visible: boolean;
  label: string;
  value: number | null;
  data: Snapshot;
  onSelect: (id: number) => void;
  onClose: () => void;
  busy?: boolean;
}) {
  const [assetQuery, setAssetQuery] = useState("");
  const [assetPreview, setAssetPreview] = useState<Media | null>(null);
  useEffect(() => {
    if (!visible) {
      setAssetQuery("");
      setAssetPreview(null);
    }
  }, [visible]);
  const libraryImages = data.media.filter(
    media => media.kind === "image" &&
      media.name.toLocaleLowerCase().includes(assetQuery.trim().toLocaleLowerCase()),
  );
  return <>
      <Modal
        className="asset-picker-modal"
        title={`为${label}从资产库选择图片`}
        visible={visible}
        footer={null}
        onCancel={onClose}
        closable={!busy}
        maskClosable={!busy}
        escToExit={!busy}
      >
        <Input.Search
          value={assetQuery}
          onChange={setAssetQuery}
          allowClear
          placeholder="搜索资产名称"
        />
        {libraryImages.length ? (
          <div className="media-picker asset-image-picker">
            {libraryImages.map((media) => (
              <div
                key={media.id}
                className={value === media.id ? "media-option selected" : "media-option"}
              >
                <button
                  type="button"
                  className="media-option-select"
                  disabled={busy}
                  onClick={() => {
                    onSelect(media.id);
                  }}
                  aria-label={`选择资产 ${media.name}`}
                >
                  <img src={imageUrl(media)} alt="" />
                  <span>{media.name}</span>
                </button>
                <button
                  type="button"
                  className="media-option-zoom"
                  onClick={() => setAssetPreview(media)}
                  aria-label={`放大预览 ${media.name}`}
                  title="放大预览"
                >
                  <ZoomIn size={16} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <Empty description={assetQuery ? "没有匹配的图片资产" : "资产库中暂无图片"} />
        )}
      </Modal>
      <Modal
        className="image-preview-modal asset-picker-preview-modal"
        title={assetPreview?.name || "图片预览"}
        visible={!!assetPreview}
        onCancel={() => setAssetPreview(null)}
        footer={
          <Space>
            <Button onClick={() => setAssetPreview(null)}>关闭</Button>
            <Button
              type="primary"
              disabled={busy || !assetPreview}
              loading={busy}
              onClick={() => {
                if (!assetPreview) return;
                onSelect(assetPreview.id);
              }}
            >
              选择此图片
            </Button>
          </Space>
        }
      >
        <div className="image-preview-full">
          {assetPreview && <img src={imageUrl(assetPreview)} alt={assetPreview.name} />}
        </div>
      </Modal>
  </>;
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
  const download = async () => {
    if (!selected) return;
    const extension = selected.path.split(".").pop() || "png";
    const destination = await saveDialog({
      title: "下载图片",
      defaultPath: selected.name,
      filters: [{ name: "图片", extensions: [extension] }],
    });
    if (!destination) return;
    await post("/media/export", {
      project_id: data.project.id,
      media_id: selected.id,
      destination_path: destination,
    });
    Message.success("图片已保存");
  };
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
      <Modal
        className="image-preview-modal"
        title={selected?.name || label}
        visible={previewOpen}
        onCancel={() => setPreviewOpen(false)}
        footer={
          <Space>
            <Button onClick={() => setPreviewOpen(false)}>关闭</Button>
            <Button icon={<ImagePlus size={15} />} disabled={!selected} onClick={() => {
              if (!selected) return;
              setGeneratorSource(selected);
              setPreviewOpen(false);
            }}>图生图</Button>
            <Button
              type="primary"
              icon={<Download size={15} />}
              onClick={() =>
                download().catch((e) =>
                  Message.error(e instanceof Error ? e.message : String(e)),
                )
              }
            >
              下载图片
            </Button>
          </Space>
        }
      >
        <div className="image-preview-full">
          {selected && <img src={imageUrl(selected)} alt={selected.name} />}
        </div>
      </Modal>
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
      <Modal
        title={`为${label}选择角色图片`}
        visible={rolesOpen}
        footer={null}
        onCancel={() => setRolesOpen(false)}
      >
        <div className="role-image-groups">
          {data.roles.map((role) => (
            <div key={role.id}>
              <b>{role.name}</b>
              <div className="media-picker">
                {role.images.map((media) => (
                  <div
                    key={media.id}
                    className={
                      value === media.id
                        ? "media-option selected"
                        : "media-option"
                    }
                    onClick={() => {
                      onChange(media.id);
                      setRolesOpen(false);
                    }}
                  >
                    <img src={imageUrl(media)} />
                    <span>{media.id === role.design_media_id ? `主图 · ${media.name}` : media.name}</span>
                  </div>
                ))}
              </div>
              {!role.images.length && (
                <p className="subtle">该角色还没有图片</p>
              )}
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}
export function SceneEditor({
  scene,
  isNew,
  data,
  onClose,
  reload,
}: {
  scene: Scene;
  isNew: boolean;
  data: Snapshot;
  onClose: () => void;
  reload: () => void;
}) {
  const [title, setTitle] = useState(scene.title || "");
  const [description, setDescription] = useState(scene.description || "");
  const [frames, setFrames] = useState<Record<FrameKey, number | null>>({
    first: scene.first_media_id || null,
    last: scene.last_media_id || null,
    reference: scene.reference_media_id || null,
  });
  const [options, setOptions] = useState<GenerationOptions>(
    { ...defaultOptions, ...scene.generation_options },
  );
  const [ratio, setRatio] = useState(
    (scene.generation_options || defaultOptions).aspect_ratio,
  );
  const signature = JSON.stringify({title, description, frames, options, ratio});
  const [savedSignature, setSavedSignature] = useState(signature);
  const dirty = signature !== savedSignature;
  useEditGuard(dirty);
  const closeEditor = () => dirty ? confirmDiscard(onClose) : onClose();
  const [savingScene, setSavingScene] = useState(false);
  const [videoGenerating, setVideoGenerating] = useState(false);
  const [optimizingPrompt,setOptimizingPrompt]=useState(false);
  const [persistedVideoGenerating, setPersistedVideoGenerating] = useState(false);
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
    setImageTarget(key);
    const prompt = scene.script?.[key] || description;
    setImagePrompt(prompt);
    setImageMode("t2i");
    setImageRefs(findMentions(prompt, promptMentions(data.roles, data)).flatMap(mention => mention.media ? [mention.media] : []));
  };
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
    first_media_id: frames.first,
    last_media_id: frames.last,
    reference_media_id: frames.reference,
    generation_options: { ...options, aspect_ratio: ratio },
  });
  const persist = async () => {
    if (!title.trim()) throw new Error("请输入场景标题");
    await post("/scenes/update", { project_id: data.project.id, ...draft(), title: title.trim() });
    setSavedSignature(signature);
  };
  const generateVideo = async () => {
    try {
      const request = videoRequest(draft(), data.settings, data.roles);
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
  const optimizeVideoPrompt=async()=>{if(optimizingPrompt||!description.trim())return;setOptimizingPrompt(true);try{const frameIds=[currentScene.first_media_id,currentScene.last_media_id,currentScene.reference_media_id].filter((id):id is number=>Boolean(id));const result=await post<{prompt:string}>("/prompts/optimize",{project_id:data.project.id,prompt:description,kind:"video",image_media_ids:frameIds});setDescription(result.prompt);Message.success("Prompt 已优化");}catch(e){Message.error(String(e));}finally{setOptimizingPrompt(false);}};
  const optimizeImagePrompt=async()=>{if(optimizingPrompt||!imagePrompt.trim())return;setOptimizingPrompt(true);try{const result=await post<{prompt:string}>("/prompts/optimize",{project_id:data.project.id,prompt:imagePrompt,kind:"image",image_media_ids:imageMode==="i2i"?imageRefs.map(media=>media.id):[]});setImagePrompt(result.prompt);Message.success("Prompt 已优化");}catch(e){Message.error(String(e));}finally{setOptimizingPrompt(false);}};
  const save = async () => {
    if (savingScene) return;
    setSavingScene(true);
    try { await persist(); await reload(); Message.success("场景已保存"); onClose(); }
    catch(e) { Message.error(String(e)); }
    finally { setSavingScene(false); }
  };
  return (
    <section className="scene-editor-page">
      <div className="scene-editor-heading">
        <div className="scene-editor-heading-title">
          <Button type="text" onClick={closeEditor}>
            ← 返回
          </Button>
          <h1>{isNew ? "创建场景" : "编辑场景"}</h1>
        </div>
        <Space>
          <Button
            type="primary"
            loading={savingScene}
            disabled={videoGenerating || persistedVideoGenerating || imageGenerating}
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
              <Form.Item label={<span className="scene-description-label"><span>场景描述</span><Button type="text" size="mini" icon={<WandSparkles size={14}/>} disabled={videoGenerating||optimizingPrompt||!description.trim()} onClick={optimizeVideoPrompt}>{optimizingPrompt?"正在优化…":"优化描述"}</Button></span>}>
                <Input.TextArea
                  value={description}
                  onChange={setDescription}
                  disabled={optimizingPrompt}
                  autoSize={{ minRows: 3, maxRows: 4 }}
                  placeholder="描述镜头、人物动作、台词与画面情绪…"
                />
              </Form.Item>
            </Form>
          </div>
          <div className="scene-visuals">
          <div className="scene-section-heading"><h2>画面素材</h2><span>可选 · 不添加图片时使用文字生成</span></div>
          <div className="scene-image-grid">
            {(
              [
                ["first", "首帧"],
                ["last", "尾帧"],
                ["reference", "参考图"],
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
          </div>
            <div className="video-generator scene-video-panel">
              <div className="generation-inputs">
                <Checkbox
                  checked={Boolean(options.custom)}
                  onChange={(checked) =>
                    setOptions((o) => ({ ...o, custom: checked }))
                  }
                >
                  自定义使用的图片
                </Checkbox>
                {options.custom && (
                  [
                    ["first", "首帧"],
                    ["last", "尾帧"],
                    ["reference", "参考图"],
                  ] as const
                ).map(([key, label]) => (
                  <Checkbox
                    key={key}
                    checked={options[key]}
                    onChange={(checked) =>
                      setOptions((o) => ({ ...o, [key]: checked }))
                    }
                  >
                    {label}
                  </Checkbox>
                ))}
              </div>
              <Form layout="vertical">
                <div className="generation-options">
                  <Form.Item label="时长">
                    <Select
                      value={options.duration}
                      onChange={(duration) =>
                        setOptions((o) => ({ ...o, duration }))
                      }
                    >
                      {[3, 5, 8, 10, 15].map((x) => (
                        <Select.Option key={x} value={x}>
                          {x} 秒
                        </Select.Option>
                      ))}
                    </Select>
                  </Form.Item>
                  <Form.Item label="画面比例">
                    <Select value={ratio} onChange={value=>{setRatio(value);setOptions(o=>({...o,aspect_ratio:value,size:GENERATION_SIZES.find(g=>g.ratio===value)?.sizes[0]}));}}>{GENERATION_SIZES.map(group=><Select.Option key={group.ratio} value={group.ratio}>{group.label}</Select.Option>)}</Select>
                  </Form.Item>
                  <Form.Item label="输出尺寸">
                    <Select aria-label="视频输出尺寸" value={options.size||GENERATION_SIZES.find(g=>g.ratio===ratio)?.sizes[0]} onChange={size=>setOptions(o=>({...o,size}))}>{GENERATION_SIZES.find(g=>g.ratio===ratio)?.sizes.map(size=><Select.Option key={size} value={size}>{size}</Select.Option>)}</Select>
                  </Form.Item>
                </div>
              </Form>
              <div className="scene-video-action">
                <span className="subtle">
                {(options.custom ? options.first : Boolean(frames.first)) &&
                (options.custom ? options.last : Boolean(frames.last))
                  ? "首尾帧生成"
                  : (options.custom ? options.first : Boolean(frames.first)) ||
                      (options.custom ? options.last : Boolean(frames.last)) ||
                      (options.custom ? options.reference : Boolean(frames.reference))
                    ? "图片生成"
                    : "文字生成"}
                </span>
              <Button
                type="primary"
                icon={<Sparkles size={17} />}
                loading={videoGenerating || persistedVideoGenerating}
                disabled={!description.trim()}
                onClick={generateVideo}
              >
                {persistedVideoGenerating ? "后台生成中" : "生成新视频"}
              </Button>
              </div>
            </div>
        </div>
            <aside className="video-library scene-results">
              <h2>
                视频版本 <span>{sceneVideos(currentScene).length}</span>
              </h2>
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
                          ? "工作台已选"
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
            extra={`将使用「模型与接口」中配置的 ${imageMode} 服务`}
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
            <Select value={ratio} onChange={setRatio}>
              <Select.Option value="16:9">16:9 横屏</Select.Option>
              <Select.Option value="9:16">9:16 竖屏</Select.Option>
              <Select.Option value="1:1">1:1 方形</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title="从角色中选择参考图"
        visible={rolePickerOpen}
        footer={
          <Button type="primary" onClick={() => setRolePickerOpen(false)}>
            完成
          </Button>
        }
        onCancel={() => setRolePickerOpen(false)}
      >
        <div className="role-image-groups">
          {data.roles.map((role) => (
            <div key={role.id}>
              <b>{role.name}</b>
              <div className="media-picker">
                {role.images.map((media) => (
                  <div
                    key={media.id}
                    className={
                      imageRefs.some((x) => x.id === media.id)
                        ? "media-option selected"
                        : "media-option"
                    }
                    onClick={() => toggleRef(media)}
                  >
                    <img src={imageUrl(media)} />
                    <span>{media.id === role.design_media_id ? `主图 · ${media.name}` : media.name}</span>
                  </div>
                ))}
              </div>
              {!role.images.length && (
                <p className="subtle">该角色还没有图片</p>
              )}
            </div>
          ))}
        </div>
      </Modal>
    </section>
  );
}
export function Roles({ data, reload, initialRoleId }: { data: Snapshot; reload: () => void; initialRoleId?:number }) {
  const [roleImagePreview, setRoleImagePreview] = useState<Media | null>(null);
  const [editing, setEditing] = useState<Role | null>(()=>data.roles.find(r=>r.id===initialRoleId)||null);
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
      <div className="section-title">
        <div>
          <p className="eyebrow">CHARACTER BIBLE</p>
          <h1>角色设定</h1><p>建立角色档案，保持每个镜头中的视觉一致性。</p>
        </div>
        <Button
          type="primary"
          icon={<Plus />}
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
                <button type="button" className="role-image-zoom" onClick={() => setRoleImagePreview(r.images.find((image) => image.id === r.design_media_id) || r.images[0])} aria-label={`放大查看${r.name}的角色图`} title="放大查看">
                  <img src={imageUrl(r.images.find((image) => image.id === r.design_media_id) || r.images[0])} alt={`${r.name}的角色图片`} />
                  <span><ZoomIn size={16} /> 放大查看</span>
                </button>
              ) : (
                r.name.slice(0, 1)
              )}
              <Tag
                color="arcoblue"
                style={{ position: "absolute", top: 9, left: 9 }}
              >
                角色
              </Tag>
            </div>
            <h3>{r.name}</h3>
            <p>{r.description || "添加角色形象描述，保持生成的一致性。"}</p>
            <div className="role-foot">
              <span>{r.images.length} 张角色图</span>
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
          </Card>
        ))}
        <Card
          className="role-card role-create"
          role="button"
          tabIndex={0}
          aria-label="创建角色"
          onKeyDown={event => { if(event.key === "Enter" || event.key === " ") { event.preventDefault(); void make().catch(e => Message.error(String(e))); } }}
          bodyStyle={{ padding: 0 }}
          onClick={() => make().catch((e) => Message.error(String(e)))}
          hoverable
        >
          <div
            className="role-pic"

          >
            <div style={{ textAlign: "center" }}>
              <Plus size={26} />
              <p>创建角色</p>
            </div>
          </div>
        </Card>
      </div>
      <Modal className="image-preview-modal" title={roleImagePreview?.name || "角色图预览"} visible={!!roleImagePreview} footer={null} onCancel={() => setRoleImagePreview(null)}>
        {roleImagePreview && <div className="image-preview-full"><img src={imageUrl(roleImagePreview)} alt={roleImagePreview.name} /></div>}
      </Modal>
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
  const currentRole = data.roles.find((x) => x.id === role?.id) || role;
  useEffect(() => {
    setName(role?.name || "");
    setDescription(role?.description || "");
    setDesign(role?.design_media_id || null);
    setAssetsOpen(false);
  }, [role]);
  const upload = async () => {
    const source = await open({
      multiple: false,
      filters: [{ name: "图片", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    if (typeof source !== "string" || !role) return;
    await post("/media/import", {
      project_id: data.project.id,
      role_id: role.id,
      source_path: source,
    });
    await reload();
    Message.success("角色图片已导入");
  };
  const importAsset = async (mediaId: number) => {
    if (!role || importingAsset) return;
    setImportingAsset(true);
    try {
      await post("/roles/media/add", {
        project_id: data.project.id,
        role_id: role.id,
        media_id: mediaId,
      });
      setDesign(mediaId);
      await reload();
      setAssetsOpen(false);
      Message.success("角色图片已导入，保存角色后设为主图");
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
    if (design === id) setDesign(null);
    await reload();
    Message.success("角色图片已删除");
  };
  const generateRoleImage = async (operation: "t2i" | "i2i") => {
    if (!role || generating) return;
    if (!description.trim()) return Message.warning("请先填写角色形象描述");
    if (operation === "i2i" && !design) return Message.warning("请先选择一张角色设计图作为参考");
    setGenerating(true);
    try {
      const result = await post<Media>("/generations/image", {project_id:data.project.id, operation,
        prompt:resolvePrompt(description, data.roles), aspect_ratio:"1:1", image_media_ids:operation === "i2i" ? [design] : []});
      const imported = await post<Media>("/media/import", {project_id:data.project.id, role_id:role.id, source_path:result.path});
      setDesign(imported.id);
      await reload();
      Message.success("角色图片已生成，保存角色后设为主图");
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
          extra="一个角色可以关联多张图片。点击图片或“设为主图”选择主图，再点底部“保存角色”生效。"
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
                    onClick={() => setDesign(m.id)}
                    aria-label={`${m.name}${design === m.id ? "，当前主图" : ""}`}
                  >
                    <img src={imageUrl(m)} alt={m.name} />
                    <span>{design === m.id ? "主图 · " : ""}{m.name}</span>
                    {design !== m.id && <button type="button" className="role-image-primary" onClick={(e) => { e.stopPropagation(); setDesign(m.id); }}>设为主图</button>}
                    <Popconfirm
                      title="从该角色中删除这张图片？"
                      onOk={() => removeImage(m.id).catch((e) => Message.error(String(e)))}
                    >
                      <button
                        type="button"
                        className="media-delete"
                        aria-label={`删除 ${m.name}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Trash2 size={13} />
                      </button>
                    </Popconfirm>
                  </div>
                ))}
              </div> : <p className="subtle role-image-empty">还没有关联图片。可从资产库添加多张，或导入本地图片。</p>}
            </div>
          </Space>
        </Form.Item>
        <Form.Item label="生成方式">
          <Space>
            <Button icon={<Sparkles size={15} />} type="primary" loading={generating} onClick={() => generateRoleImage("t2i")}>
              文生图
            </Button>
            <Button icon={<ImagePlus size={15} />} disabled={generating || !design} onClick={() => generateRoleImage("i2i")}>图生图</Button>
          </Space>
          <p className="subtle">
            创建生成任务会使用「模型与接口」中配置的 t2i / i2i 服务。
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
      <div className="section-title">
        <div>
          <p className="eyebrow">PROMPT LIBRARY</p>
          <h1>Prompt 库</h1><p>保存可复用的角色、场景与风格描述。</p>
        </div>
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
          <Card key={preset.id} className="prompt-card" title={preset.name}
            extra={<Button type="text" size="mini" onClick={() => setEditing({ name: preset.name, content: preset.content, category: preset.category })}>另存为我的 Prompt</Button>}>
            <Tag>风格</Tag>
            <p>{preset.content}</p>
          </Card>
        ))}
      </div>
      <div className="prompt-library-heading"><h2>我的 Prompt</h2></div>
      {!data.prompts.length && <Empty description="暂无自定义 Prompt，可新建或从预设风格另存"/>}
      <div className="prompt-grid">
        {data.prompts.map((p) => (
          <Card
            key={p.id}
            className="prompt-card"
            title={
              <Space>
                <span>{p.name}</span>
              </Space>
            }
            extra={
              <Button type="text" size="mini" onClick={() => setEditing(p)}>
                编辑
              </Button>
            }
          >
            <Tag>{p.category}</Tag>
            <p>{p.content || "尚未填写内容"}</p>
            <div className="prompt-meta">可在角色与场景生成时复用</div>
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
    flf2v: data.settings.flf2v || data.settings.fl2v,
  });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  useEditGuard(dirty);
  useEffect(
    () => {
      if (dirty) return;
      setSettings({
        ...data.settings,
        flf2v: data.settings.flf2v || data.settings.fl2v,
      });
    },
    [data.settings, dirty],
  );
  const methods = [
    ["image", "图片生成", "Text / Image to Image"],
    ["video", "视频生成", "Text / Image to Video"],
    ["llm", "Prompt 优化模型", "OpenAI Chat Completions"],
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
      <div className="section-title">
        <div>
          <p className="eyebrow">MODEL CONNECTIONS</p>
          <h1>模型与接口</h1>
          <p>
            图片生成支持 CAST 与 OpenAI 官方兼容接口；视频生成继续使用 CAST。
          </p>
        </div>
        <Button
          type="primary"
          icon={<Save size={16} />}
          loading={saving}
          disabled={!dirty}
          onClick={() => save().catch((e) => Message.error(String(e)))}
        >
          保存配置
        </Button>
      </div>
      {methods.map(([key, label, sub]) => {
        const image = key === "image";
        const video = key === "video";
        const llm = key === "llm";
        const provider = settings[key]?.provider || "cast";
        return (
          <div className="setting-block" key={key}>
            <div className="setting-heading"><span className="setting-code">{key.toUpperCase()}</span><h3>{label}</h3>
            <p>{sub}</p></div>
            <Form layout="vertical" disabled={saving}>
              {image && <Form.Item label="接口类型">
                <Select value={provider} onChange={v => set(key, "provider", v)} style={{width:260}}
                  options={[{label:"CAST 兼容接口",value:"cast"},{label:"OpenAI 官方兼容接口",value:"openai"}]}/>
              </Form.Item>}
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
        <Typography.Paragraph
          style={{ margin: 0, color: "#64748b", fontSize: 12 }}
        >
          图片配置共用一组 URL 与 API Key；OpenAI 模式会根据 Base URL 自动调用 <code>/images/generations</code>
          （t2i）或 <code>/images/edits</code>
          （i2i），并将画面比例映射为官方支持的尺寸。视频 Base URL 会按生成方式补全接口路径。Prompt 优化使用 OpenAI 格式的{" "}
          <code>/chat/completions</code>。CAST 图片接口也会按生成方式补全路径。{" "}
          <code>
            POST /v1/generations/{"{"}t2i | i2i | t2v | i2v | flf2v{"}"}
          </code>{" "}
          格式。
        </Typography.Paragraph>
      </Card>
    </section>
  );
}
