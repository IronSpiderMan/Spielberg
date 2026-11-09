import { confirmAction } from "./components/ConfirmAction";
import {
Button,
Card,
Form,
Input,
Layout,
Message,
Modal,
Space,
Spin,
Tag
} from "@arco-design/web-react";
import "@arco-design/web-react/dist/css/arco.css";
import { open } from "./platform";
import {
ChevronRight,
Clapperboard,
Film,
FolderOpen,
FileText,

Moon,
PanelLeftOpen,
Plus,
Settings,
Sun,
Sparkles,
Users,
X
} from "lucide-react";
import { lazy,Suspense,useCallback,useEffect,useRef,useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./role-media.css";

import "./logo.css";
import "./studio-modern.css";
const logoSrc = "/spielberg-logo-s.png";

import type { AssetUsage } from "./AssetLibrary";
import { api,Media,post,Project,Clip,Snapshot } from "./core";
import { confirmDiscard,EditGuardContext } from "./edit-guard";
import "./creation.css";
import "./assets.css";
import "./layout.css";
import "./design-system.css";
import "./scene-editor.css";
import "./studio-polish.css";
import "./library-polish.css";
import "./creation-polish.css";
import "./image-generator-modal.css";
import "./editors-polish.css";
import "./welcome.css";
import "./studio-direction.css";
import "./dialogs.css";


import { PageHeading, PageLoading } from "./ui";
import { FloatingImageGenerator } from "./components/FloatingImageGenerator";
import { agentFloatPreferencesKey, readAgentFloatPreferences } from "./agent-float-preferences";
import { AgentFloatButton } from "./components/AgentFloatButton";
import { StudioNavigation, studioNavigationId } from "./components/StudioNavigation";
const CreationDesk=lazy(()=>import("./creation").then(m=>({default:m.CreationDesk})));
const InfiniteCanvas=lazy(()=>import("./InfiniteCanvas"));
const MediaEditor=lazy(()=>import("./MediaEditor"));
const AssetLibrary=lazy(()=>import("./AssetLibrary"));
const ProjectConfig=lazy(()=>import("./ProjectConfig"));
const ProjectTools=lazy(()=>import("./ProjectTools"));
const AgentWorkspace=lazy(()=>import("./AgentWorkspace"));

const Studio=lazy(()=>import("./workspace").then(m=>({default:m.Studio})));
const Tasks=lazy(()=>import("./workspace").then(m=>({default:m.Tasks})));
const Episodes=lazy(()=>import("./workspace").then(m=>({default:m.Episodes})));
const ClipEditor=lazy(()=>import("./workspace").then(m=>({default:m.ClipEditor})));
const Roles=lazy(()=>import("./workspace").then(m=>({default:m.Roles})));
const Prompts=lazy(()=>import("./workspace").then(m=>({default:m.Prompts})));
const SettingsPage=lazy(()=>import("./SettingsPage"));
const ListenerSettings=lazy(()=>import("./ListenerSettings"));

function App() {
  const [agentFloat, setAgentFloat] = useState(readAgentFloatPreferences);
  useEffect(() => {
    localStorage.setItem(agentFloatPreferencesKey, JSON.stringify(agentFloat));
  }, [agentFloat]);


  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("spielberg-sidebar-collapsed") === "true");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mobileNavTrigger = useRef<HTMLButtonElement>(null);
  const mainLayout = useRef<HTMLElement>(null);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 600px)");
    const update = () => { if (!media.matches) setMobileNavOpen(false); };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!mobileNavOpen || !mainLayout.current) return;
    const workspace = mainLayout.current;
    const trigger = mobileNavTrigger.current;
    const drawer = document.getElementById(studioNavigationId)?.closest(".side-navigation-body");
    workspace.inert = true;
    drawer?.querySelector<HTMLButtonElement>(".mobile-nav-close")?.focus();
    return () => {
      workspace.inert = false;
      if (document.activeElement === document.body || drawer?.contains(document.activeElement)) {
        trigger?.focus();
      }
    };
  }, [mobileNavOpen]);

  useEffect(() => {
    localStorage.setItem("spielberg-sidebar-collapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("spielberg-theme") === "dark");
  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? "dark" : "light";
    // Arco popups render under body and need the library theme as well.
    if (darkMode) document.body.setAttribute("arco-theme", "dark");
    else document.body.removeAttribute("arco-theme");
    localStorage.setItem("spielberg-theme", darkMode ? "dark" : "light");
  }, [darkMode]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [active, setActive] = useState<Project | null>(null);
  const [data, setData] = useState<Snapshot | null>(null);
  const snapshotRef = useRef<Snapshot|null>(null);
  const refreshSequence=useRef(0);
  const refreshQueue=useRef<Promise<void>>(Promise.resolve());
  const [locate,setLocate]=useState<AssetUsage|null>(null);
  const activeRef = useRef<string | null>(null);
  const [page, setPage] = useState("studio");
  const [agentViewVersion, setAgentViewVersion] = useState(0);
  const [studioTab, setStudioTab] = useState("images");
  const [imageSource, setImageSource] = useState<Media | undefined>();
  const [sceneEditing, setClipEditing] = useState<{
    scene: Clip;
    isNew: boolean;
  } | null>(null);
  const [episodeClipReturn, setEpisodeClipReturn] = useState<{episodeId: number; sceneId: number} | null>(null);
  const [sceneImageFlow, setClipImageFlow] = useState<{ key: "first" | "last"; media?: Media } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => { contentRef.current?.scrollTo({top: 0}); }, [page, sceneEditing, active?.id]);
  const [creating, setCreating] = useState(false);
  const [listenerSettingsOpen, setListenerSettingsOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(true);
  const [creatingProject, setCreatingProject] = useState(false);
  const loadVersion = useRef(0);
  const editorDirty = useRef(false);
  const registerDirty = useCallback((dirty: boolean) => { editorDirty.current = dirty; }, []);
  const leaveEditor = (action: () => void, afterLeave?: () => void) => {
    if (editorDirty.current) confirmDiscard(action, afterLeave);
    else { action(); afterLeave?.(); }
  };
  const load = async (id?: string) => {
    const version = ++loadVersion.current;
    const ps = await api<Project[]>("/projects");
    if (version !== loadVersion.current) return;
    setProjects(ps);
    const lastOpenedId = localStorage.getItem("spielberg-last-project");
    const target = id || (ps.some(p=>p.id===active?.id) ? active?.id : undefined) || (lastOpenedId && ps.some(project => project.id === lastOpenedId) ? lastOpenedId : undefined) || ps[0]?.id;
    if (target) {
      const s = await post<Snapshot>("/project", { id: target });
      if (version !== loadVersion.current) return;
      if (activeRef.current !== s.project.id) {
        setClipEditing(null);
        setEpisodeClipReturn(null);
        setStudioTab("images");
        setPage("studio");
      }
      snapshotRef.current=s;refreshSequence.current++;setLocate(null);
      setData(s);
      activeRef.current = s.project.id;
      setActive(s.project);
      localStorage.setItem("spielberg-last-project", s.project.id);
    } else {
      snapshotRef.current=null;refreshSequence.current++;
      setData(null);
      activeRef.current = null;
      setActive(null);
      localStorage.removeItem("spielberg-last-project");
    }
  };
  const refresh = useCallback(() => {
    const run = async () => {
      const current=snapshotRef.current;
      const id=activeRef.current;
      if(!id||!current)return;
      const sequence=++refreshSequence.current;
      const changes=await post<Partial<Snapshot>>("/project/changes",{id,revisions:current.revisions||{}});
      if(activeRef.current!==id||sequence!==refreshSequence.current)return;
      const merged={...snapshotRef.current,...changes} as Snapshot;
      snapshotRef.current=merged;
      const projectChanged=JSON.stringify(current.project)!==JSON.stringify(merged.project);
      if(projectChanged){
        setActive(merged.project);
        setProjects(items=>items.map(project=>project.id===id?merged.project:project));
      }
      // No changed domain means no React render or media-grid requery.
      if(projectChanged || Object.keys(changes).some(key=>key!=="project"&&key!=="revisions") || JSON.stringify(current.revisions)!==JSON.stringify(changes.revisions))setData(merged);
    };
    const next=refreshQueue.current.catch(()=>{}).then(run);
    refreshQueue.current=next;
    return next;
  }, []);
  useEffect(() => {
    const mediaSaved = (event: Event) => {
      if ((event as CustomEvent<{ projectId: string }>).detail?.projectId === activeRef.current) void refresh().catch(() => {});
    };
    window.addEventListener("spielberg:media-saved", mediaSaved);
    return () => window.removeEventListener("spielberg:media-saved", mediaSaved);
  }, [refresh]);
  useEffect(() => {
    load().catch(e=>Message.error(String(e))).finally(()=>setBusy(false));
  }, []);
  useEffect(() => {
    if(!active?.id)return;
    let disposed=false, pending=false;
    let timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{
      clearTimeout(timer);
      if(disposed||pending)return;
      if(document.visibilityState!=="hidden"){
        pending=true;
        try{await refresh();}catch{/* Explicit actions report failures. */}finally{pending=false;}
      }
      if(!disposed)timer=setTimeout(poll,4000);
    };
    const resume=()=>{if(document.visibilityState!=="hidden")void poll();};
    timer=setTimeout(poll,4000);
    document.addEventListener("visibilitychange",resume);window.addEventListener("focus",resume);
    return()=>{disposed=true;clearTimeout(timer);document.removeEventListener("visibilitychange",resume);window.removeEventListener("focus",resume);};
  },[active?.id,refresh]);
  const create = async () => {
    if (!newName.trim()) {
      Message.warning("请输入项目名称");
      return;
    }
    if (creatingProject) return;
    setCreatingProject(true);
    try {
      const p = await post<Project>("/projects",{name:newName.trim()});
      await load(p.id);
      setCreating(false);
      setNewName("");
      Message.success("漫剧项目已创建");
    } catch (e) { Message.error(String(e)); }
    finally { setCreatingProject(false); }
  };
  const openProject = () => leaveEditor(() => { void (async () => {
    try {
    const chosen = await open({
      directory: true,
      multiple: false,
      title: "选择漫剧项目文件夹",
    });
    if (typeof chosen !== "string") return;
    const p = await post<Project>("/projects/open", { path: chosen });
    await load(p.id);
    } catch (e) { Message.error(String(e)); }
    })();
  });
  const openRestored=async(id:string)=>{
    if(editorDirty.current){
      const confirmed=await new Promise<boolean>(resolve=>confirmAction({intent:"danger",title:"打开恢复的项目？",content:"当前修改尚未保存，切换后将丢失。恢复的项目已保存在最近项目中。",okText:"放弃修改并打开",cancelText:"留在当前项目",onOk:()=>resolve(true),onCancel:()=>resolve(false)}));
      if(!confirmed)return;
    }
    await load(id);
  };
  if (busy)
    return (
      <div className="splash">
        <Sparkles size={32} />
        <Spin />
        <span>正在打开 Spielberg 工作室</span>
      </div>
    );
  if (!data)
    return (
      <>
        <Welcome onCreate={() => setCreating(true)} onOpen={openProject} onRestored={openRestored} onSettings={() => setListenerSettingsOpen(true)} />
        <Modal title="端口设置" visible={listenerSettingsOpen} footer={null} maskClosable={false}
          className="studio-settings-page" onCancel={() => leaveEditor(() => setListenerSettingsOpen(false))}>
          {listenerSettingsOpen && <Suspense fallback={<Spin />}><ListenerSettings onDirtyChange={registerDirty} /></Suspense>}
        </Modal>
        {agentFloat.visible && <AgentFloatButton appearance={agentFloat} project={null} reload={refresh} onOpenSession={() => {}} />}
        <Modal
          title="创建项目"
          visible={creating}
          onCancel={() => !creatingProject && setCreating(false)}
          onOk={create}
          okText="创建项目"
          confirmLoading={creatingProject}
          maskClosable={!creatingProject}
        >
          <Form layout="vertical">
            <Form.Item label="项目名称" required>
              <Input
                value={newName}
                onChange={setNewName}
                placeholder="为你的故事起个名字"
                aria-label="项目名称"
                maxLength={100}
                disabled={creatingProject}
                onPressEnter={create}
                autoFocus
              />
            </Form.Item>
          </Form>
        </Modal>
      </>
    );
  const locateAsset=(usage:AssetUsage)=>leaveEditor(()=>{
    setEpisodeClipReturn(null);
    setLocate(usage);
    if(usage.kind==="canvas" || usage.kind==="clip"){
      const episode=data.episodes.find(item=>item.clips.some(clip=>clip.id===usage.target_id));
      const scene=episode?.clips.find(item=>item.id===usage.target_id);
      if(episode && scene){setEpisodeClipReturn({episodeId:episode.id,sceneId:scene.scene_id});setClipEditing({scene,isNew:false});setPage("episodes");}return;
    }
    setClipEditing(null);setPage(usage.kind==="asset"?"roles":"episodes");
  });
  const navigate = (next: string, afterNavigate?: () => void) => {
    setMobileNavOpen(false);
    if (next === page && !sceneEditing) { afterNavigate?.(); return; }
    leaveEditor(() => { setLocate(null);setEpisodeClipReturn(null);setImageSource(undefined);setClipEditing(null);setClipImageFlow(null); setPage(next); }, afterNavigate);
  };

  return (
    <EditGuardContext.Provider value={registerDirty}>
    <Layout hasSider className={`app${mobileNavOpen ? " mobile-nav-open" : ""}${page === "agent" && !sceneEditing ? " agent-page" : ""}${agentFloat.visible ? " agent-float-visible" : ""}${darkMode ? " dark-theme" : ""}${sceneEditing?.scene.creation_mode === "canvas" ? " canvas-mode" : ""}`}>
      <a className="skip-to-content" href="#workspace-content" tabIndex={mobileNavOpen ? -1 : undefined}>跳转到工作区</a>
      {mobileNavOpen && <div className="mobile-nav-backdrop" aria-hidden="true" onClick={() => setMobileNavOpen(false)} />}
      <StudioNavigation
        collapsed={sidebarCollapsed}
        mobileOpen={mobileNavOpen}
        page={page}
        projectName={data.project.name}
        onToggle={() => setSidebarCollapsed(value => !value)}
        onCloseMobile={() => setMobileNavOpen(false)}
        onNavigate={navigate}
        onOpenProject={() => { setMobileNavOpen(false); openProject(); }}
        onCreateProject={() => { setMobileNavOpen(false); leaveEditor(() => setCreating(true)); }}
      />
      <Layout className="app-main" ref={mainLayout}>
        <Layout.Header className="topbar">
          <div>
            <Button
              ref={mobileNavTrigger}
              type="text"
              className="sidebar-toggle mobile-sidebar-toggle"
              title="打开工作室导航"
              aria-label="切换导航"
              aria-controls={studioNavigationId}
              aria-expanded={mobileNavOpen}
              icon={<PanelLeftOpen size={18} />}
              onClick={() => setMobileNavOpen(value => !value)}
            />
            <b>
              {sceneImageFlow
                ? "工作台 · 图片生成"
                : sceneEditing
                ? sceneEditing.isNew
                  ? (sceneEditing.scene.creation_mode === "canvas" ? "创建画布片段" : "创建片段")
                  : (sceneEditing.scene.creation_mode === "canvas" ? "画布片段" : "编辑片段")
                : (
                    {
                      studio: "工作台",
                      agent: "Agent 助手",
                      episodes: "剧集管理",
                      assets: "素材库",
                      editor: "音视频剪辑",
                      roles: "资产库",
                      prompts: "Prompt 库",
                      tasks: "后台任务",
                      settings: "设置",
                      "project-config": "项目配置",
                      projects: "项目",
                    } as Record<string, string>
                  )[page]}
            </b>
          </div>
          <Space>
            <Button
              className="theme-toggle"
              aria-label={darkMode ? "切换到浅色模式" : "切换到暗夜模式"}
              title={darkMode ? "切换到浅色模式" : "切换到暗夜模式"}
              icon={darkMode ? <Sun size={16} /> : <Moon size={16} />}
              onClick={() => setDarkMode(value => !value)}
            />
            <Tag color="green">本地项目</Tag>
            <Suspense fallback={null}><ProjectTools project={data.project} onRestored={openRestored}/></Suspense>
            <Button icon={<FolderOpen size={16} />} onClick={openProject}>
              打开项目
            </Button>
            <Button
              icon={<Plus size={16} />}
              onClick={() => leaveEditor(() => setCreating(true))}
            >
              新建项目
            </Button>
          </Space>
        </Layout.Header>
        <Layout.Content
          id="workspace-content"
          tabIndex={-1}
          aria-label="项目工作区"
          data-page={sceneEditing ? "scene" : page}
          ref={contentRef}
          key={`workspace:${data.project.id}`}
          className={sceneEditing ? `content scene-page-content${sceneImageFlow ? " scene-image-workbench-content" : ""}` : "content"}
        >
          <Suspense fallback={<PageLoading/>}>
          {sceneEditing ? (
            sceneEditing.scene.creation_mode === "canvas" ? <InfiniteCanvas key={`${data.project.id}:${sceneEditing.scene.id}`} data={data} scene={data.episodes.flatMap(e=>e.clips).find(s=>s.id===sceneEditing.scene.id)||sceneEditing.scene} reload={refresh} onClose={()=>leaveEditor(()=>setClipEditing(null))} /> : <>
            <div className="scene-editor-host" hidden={!!sceneImageFlow}>
            <ClipEditor
              key={`${data.project.id}:${sceneEditing.scene.id}`}
              scene={sceneEditing.scene}
              isNew={sceneEditing.isNew}
              data={data}
              onClose={() => setClipEditing(null)}
              reload={refresh}
              onGenerateFrame={key => { if (key === "reference") return; setClipImageFlow({ key }); setStudioTab("images"); }}
              generatedFrame={sceneImageFlow?.media ? { key: sceneImageFlow.key, media: sceneImageFlow.media } : null}
              onGeneratedApplied={() => setClipImageFlow(null)}
            />
            </div>
            {sceneImageFlow && <div className="scene-image-workbench">
              <div className="scene-editor-heading"><div className="scene-editor-heading-title"><Button type="text" onClick={() => setClipImageFlow(null)}>← 返回片段编辑</Button></div></div>
              <CreationDesk data={data} reload={refresh} activeTab="images" onTabChange={setStudioTab} changePage={navigate} editClip={() => {}} renderSequence={() => null}
                initialPrompt={sceneEditing.scene.script?.[sceneImageFlow.key] || sceneEditing.scene.description}
                initialRatio={sceneEditing.scene.generation_options?.aspect_ratio || "16:9"}
                onImageUse={media => { void refresh().then(() => setClipImageFlow(current => current ? { ...current, media } : current)).catch(e => Message.error(String(e))); }} />
            </div>}
            </>
          ) : (
            <>
              {page === "studio" && (
                <CreationDesk
                  key={data.project.id}
                  activeTab={studioTab}
                  onTabChange={setStudioTab}
                  renderSequence={() => <Studio data={data} reload={refresh} changePage={navigate} editClip={scene => setClipEditing({scene, isNew: false})} />}
                  data={data}
                  reload={refresh}
                  changePage={navigate}
                  imageSource={imageSource}
                  editClip={(scene) =>
                    setClipEditing({ scene, isNew: false })
                  }
                />
              )}{" "}
              {page === "agent" && <AgentWorkspace key={`${data.project.id}:${agentViewVersion}`} data={data} reload={refresh} onNavigate={navigate} />}
              {page === "episodes" && (
                <Episodes
                  initialEpisodeId={episodeClipReturn?.episodeId ?? (locate?.kind==="episode" ? locate.target_id : locate?.kind==="scene" ? locate.episode_id : undefined)}
                  initialSceneId={locate?.kind==="scene" ? locate.target_id : undefined}
                  initialFocusedSceneId={episodeClipReturn?.sceneId}
                  initialView={episodeClipReturn !== null || locate?.kind==="scene" ? "scenes" : undefined}
                  data={data}
                  reload={refresh}
                  editClip={(scene, isNew, episodeId) => {
                    setLocate(null);
                    setEpisodeClipReturn({episodeId,sceneId:scene.scene_id});
                    setClipEditing({ scene, isNew });
                  }}
                />
              )}{" "}
              {page === "editor" && <MediaEditor key={data.project.id} data={data} reload={refresh} />}
              {page === "assets" && <AssetLibrary key={data.project.id} data={data} reload={refresh} onLocate={locateAsset} onImageToImage={media=>leaveEditor(()=>{setLocate(null);setImageSource(media);setStudioTab("images");setClipEditing(null);setPage("studio");})} />}
              {page === "tasks" && <Tasks key={data.project.id} projectId={data.project.id} />}
              {page === "roles" && <Roles data={data} reload={refresh} initialRoleId={locate?.kind==="asset"?locate.target_id:undefined} />}{" "}
              {page === "prompts" && (
                <Prompts data={data} reload={refresh} />
              )}{" "}
              {page === "project-config" && <ProjectConfig key={data.project.id} project={data.project} reload={refresh} />}
              {page === "settings" && (
                <SettingsPage data={data} reload={refresh} agentFloat={agentFloat} onAgentFloatChange={setAgentFloat} />
              )}{" "}
              {page === "projects" && (
                <ProjectPage
                  projects={projects}
                  active={active}
                  onCreate={() => leaveEditor(() => setCreating(true))}
                  changed={async () => { await load(); setPage("projects"); }}
                  select={(id) => { void load(id).catch(e => Message.error(String(e))); }}
                />
              )}
            </>
          )}
          </Suspense>
        </Layout.Content>
        {(
          <FloatingImageGenerator showButton={!!((sceneEditing && sceneEditing.scene.creation_mode !== "canvas") || page === "roles")} key={`floating-generator:${data.project.id}`} data={data} reload={refresh} />
        )}
        {agentFloat.visible && <AgentFloatButton appearance={agentFloat} modelSettings={data.settings} key={`agent-float:${data.project.id}`} project={data.project} reload={refresh} onSettings={() => navigate("settings")} onOpenSession={sessionId => navigate("agent", () => {
          localStorage.setItem(`spielberg-agent-session-${data.project.id}`, sessionId);
          setAgentViewVersion(value => value + 1);
        })} />}
      </Layout>

      <Modal title="创建项目" visible={creating} onCancel={() => !creatingProject && setCreating(false)}
        onOk={create} okText="创建项目" confirmLoading={creatingProject} maskClosable={!creatingProject}>
        <Form layout="vertical"><Form.Item label="项目名称" required>
          <Input value={newName} onChange={setNewName} placeholder="为你的故事起个名字" aria-label="项目名称" maxLength={100} autoFocus
            disabled={creatingProject} onPressEnter={create}/>
        </Form.Item></Form>
      </Modal>
    </Layout>
    </EditGuardContext.Provider>
  );
}

function Welcome({
  onCreate,
  onOpen,
  onRestored,
  onSettings,
}: {
  onCreate: () => void;
  onOpen: () => void;
  onRestored:(id:string)=>Promise<void>;
  onSettings: () => void;
}) {
  return (
    <div className="welcome">
      <div className="welcome-card">
        <div className="welcome-brand"><img className="hero-logo" src={logoSrc} alt="" /><div><b>Spielberg</b><span>AI COMIC STUDIO</span></div></div>
        <h1>把灵感，剪成一部漫剧</h1>
        <p>资产、分镜、视觉素材与生成模型都归于一个本地项目。</p>
        <div className="welcome-actions">
          <Button
            type="primary"
            size="large"
            icon={<Plus />}
            onClick={onCreate}
          >
            创建漫剧项目
          </Button>
          <Button size="large" icon={<FolderOpen />} onClick={onOpen}>
            打开已有项目
          </Button>
          <Suspense fallback={null}><ProjectTools onRestored={onRestored}/></Suspense>
          <Button size="large" icon={<Settings size={18} />} onClick={onSettings}>端口设置</Button>
        </div>
        <div className="welcome-features">
          <div><FileText size={20}/><b>故事与分镜</b><span>从一个想法，到完整镜头脚本</span></div>
          <div><Users size={20}/><b>创作资产与素材</b><span>为每个故事建立自己的视觉世界</span></div>
          <div><Clapperboard size={20}/><b>生成与剪辑</b><span>让画面动起来，串联成你的作品</span></div>
        </div>
        <div className="welcome-slate" aria-hidden="true"><Clapperboard size={48} strokeWidth={1}/><span>Spielberg</span><p>每一个镜头<br/>都从一个想法开始。</p><div><span>故事</span><ChevronRight size={14}/><span>分镜</span><ChevronRight size={14}/><span>成片</span></div></div>
        <div className="welcome-notes">
          <span>本地项目</span>
          <i /> <span>统一素材管理</span>
          <i /> <span>从分镜到成片</span>
        </div>
      </div>
    </div>
  );
}
function ProjectPage({
  projects,
  active,
  select,
  changed,
  onCreate,
}: {
  changed: () => Promise<void>;
  projects: Project[];
  active: Project | null;
  select: (id: string) => void;
  onCreate: () => void;
}) {
  const [editing,setEditing]=useState<Project|null>(null);
  const [name,setName]=useState("");
  const [pending,setPending]=useState(false);
  const run=async(action:()=>Promise<unknown>)=>{
    setPending(true);
    try {await action(); await changed(); Message.success("项目已更新");}
    catch(e){Message.error(String(e)); throw e;}
    finally{setPending(false);}
  };
  const relocate=async(p:Project)=>{
    try {
      const path=await open({directory:true,title:"选择迁移目标文件夹"});
      if(typeof path!=="string")return;
      confirmAction({intent:"info",title:"迁移这个项目？",content:`将「${p.name}」的数据库和素材复制到 ${path}，完成后使用新位置。原目录保留，可在确认后自行清理。`,okText:"迁移",onOk:()=>run(()=>post("/projects/migrate",{id:p.id,path}))});
    }catch(e){Message.error(String(e));}
  };
  return (
    <section>
      <Modal title="重命名项目" visible={!!editing} confirmLoading={pending} maskClosable={!pending}
        onCancel={()=>!pending&&setEditing(null)} okText="保存"
        onOk={async()=>{if(!name.trim()){Message.warning("请输入项目名称");return;}await run(()=>post("/projects/update",{id:editing!.id,name:name.trim()}));setEditing(null);}}>
        <Input autoFocus value={name} onChange={setName} maxLength={100} placeholder="项目名称" disabled={pending}/>
      </Modal>
      <PageHeading title="最近项目" description="每个故事拥有独立的剧集、资产与素材空间。" />
      <div className="project-grid">
        {projects.map((p) => (
          <Card
            key={p.id}
            hoverable
            role="button"
            tabIndex={0}
            aria-label={`打开项目 ${p.name}`}
            aria-pressed={active?.id === p.id}
            onKeyDown={event => { if(event.key === "Enter" || event.key === " ") { event.preventDefault(); select(p.id); } }}
            className={
              active?.id === p.id ? "project-card selected" : "project-card"
            }
            onClick={() => select(p.id)}
          >
            <div className="project-art">
              <Film />
              <span className="project-art-initial">{p.name.slice(0, 1)}</span>
              {active?.id === p.id && <Tag className="project-active-tag">当前项目</Tag>}
            </div>
            <h3 title={p.name}>{p.name}</h3>
            <p title={p.path}>{p.path}</p>
            <small>最近更新 {p.updated_at}</small>
            <div className="project-card-actions" onClick={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}>
              <Space size="mini">
                <Button size="small" disabled={pending} onClick={()=>{setEditing(p);setName(p.name);}}>重命名</Button>
                <Button size="small" disabled={pending} onClick={()=>void relocate(p)}>迁移</Button>
                <Button size="small" status="danger" disabled={pending} onClick={()=>confirmAction({
                  intent:"danger",title:"移除这个最近项目？",content:`「${p.name}」将从最近项目列表移除，本地项目文件保留，之后可通过「打开项目」重新添加。`,okText:"移除项目",
                  onOk:()=>run(()=>post("/projects/delete",{id:p.id})),
                })}>移除</Button>
              </Space>
            </div>
          </Card>
        ))}
        <button type="button" className="project-create" onClick={onCreate}>
          <span className="project-create-mark"><Plus size={22} /></span>
          <b>新建项目</b>
          <small>创建一个独立的漫剧工作区</small>
        </button>
      </div>
    </section>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
