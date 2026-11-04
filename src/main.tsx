import { confirmAction } from "./components/ConfirmAction";
import {
Button,
Card,
Form,
Input,
Layout,
Menu,
Message,
Modal,
Space,
Spin,
Tag
} from "@arco-design/web-react";
import "@arco-design/web-react/dist/css/arco.css";
import { open } from "./platform";
import {
Bot,
Boxes,
ChevronRight,
Clapperboard,
Film,
FolderOpen,
FileText,
ImagePlus,
Keyboard,
LayoutDashboard,
Moon,
PanelLeftClose,
PanelLeftOpen,
Plus,
Settings,
Sun,
Sparkles,
Users,
WandSparkles,
X
} from "lucide-react";
import { lazy,Suspense,useCallback,useEffect,useRef,useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./role-media.css";

import "./logo.css";
import "./studio-modern.css";
const logoSrc = "/spielberg-logo-s.png";

import type { AssetUsage } from "./AssetLibrary";
import { api,Media,post,Project,Scene,Snapshot } from "./core";
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
import "./keyboard.css";
import { focusKeyboardTarget, hasOpenKeyboardLayer, isKeyboardEventBlocked, isKeyboardInput, isKeyboardTargetVisible } from "./keyboard";
import { PageHeading, PageLoading } from "./ui";
import { FloatingImageGenerator } from "./components/FloatingImageGenerator";
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
const SceneEditor=lazy(()=>import("./workspace").then(m=>({default:m.SceneEditor})));
const Roles=lazy(()=>import("./workspace").then(m=>({default:m.Roles})));
const Prompts=lazy(()=>import("./workspace").then(m=>({default:m.Prompts})));
const SettingsPage=lazy(()=>import("./SettingsPage"));

const workspacePages = [
  { id: "agent", label: "Agent 助手", icon: Bot },
  { id: "studio", label: "工作台", icon: LayoutDashboard },
  { id: "episodes", label: "剧集", icon: Clapperboard },
  { id: "editor", label: "音视频剪辑", icon: Film },
  { id: "assets", label: "素材库", icon: ImagePlus },
  { id: "roles", label: "资产库", icon: Boxes },
  { id: "project-config", label: "项目配置", icon: Settings },
  { id: "tasks", label: "后台任务", icon: Film },
  { id: "prompts", label: "Prompt 库", icon: WandSparkles },
];

function keyboardRegions() {
  const nav = document.getElementById("studio-navigation");
  const sessions = document.querySelector<HTMLElement>('[data-keyboard-region="sessions"]');
  const conversation = document.querySelector<HTMLElement>('[data-keyboard-region="conversation"]');
  const composer = document.querySelector<HTMLElement>('[data-keyboard-region="composer"]');
  const content = document.querySelector<HTMLElement>('[data-keyboard-region="content"]') || document.getElementById("workspace-content");
  return [
    { region: nav, target: nav?.querySelector<HTMLElement>('[aria-current="page"]') || nav?.querySelector<HTMLElement>('[data-workspace-nav]') || null },
    { region: sessions, target: sessions?.querySelector<HTMLElement>('.agent-session-select[aria-current="page"]:not(:disabled)') || sessions?.querySelector<HTMLElement>('.agent-session-select:not(:disabled), [data-testid="agent-new-session"]:not(:disabled)') || null },
    ...(conversation ? [{ region: conversation, target: conversation }, { region: composer, target: composer }] : [{ region: content, target: content?.querySelector<HTMLElement>("[data-keyboard-entry]") || content }]),
  ].filter(item => isKeyboardTargetVisible(item.region) && isKeyboardTargetVisible(item.target) && !item.target.matches(':disabled, [aria-disabled="true"]'));
}

function App() {
  const [keyboardHelpOpen, setKeyboardHelpOpen] = useState(false);
  const keyboardHelpReturn = useRef<HTMLElement | null>(null);
  const openKeyboardHelp = () => {
    keyboardHelpReturn.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setMobileNavOpen(false);
    setKeyboardHelpOpen(true);
  };
  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey || hasOpenKeyboardLayer()) return;
      if (event.key === "F6") {
        const regions = keyboardRegions();
        if (!regions.length) return;
        const current = regions.findIndex(item => item.region?.contains(document.activeElement));
        const index = current < 0 ? (event.shiftKey ? regions.length - 1 : 0) : (current + (event.shiftKey ? -1 : 1) + regions.length) % regions.length;
        event.preventDefault();
        focusKeyboardTarget(regions[index].target);
      } else if (event.key === "?" && !event.repeat && !isKeyboardInput(event.target) && document.getElementById("workspace-content")) {
        event.preventDefault();
        openKeyboardHelp();
      }
    };
    document.addEventListener("keydown", shortcuts);
    return () => document.removeEventListener("keydown", shortcuts);
  }, []);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem("spielberg-sidebar-collapsed") === "true");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia("(max-width: 600px)").matches);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 600px)");
    const update = () => { setIsMobile(media.matches); if (!media.matches) setMobileNavOpen(false); };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!mobileNavOpen) return;
    const sidebar = document.getElementById("studio-navigation");
    const main = document.querySelector<HTMLElement>(".app-main");
    const frame = requestAnimationFrame(() => {
      sidebar?.querySelector<HTMLElement>(".arco-menu-selected, .mobile-nav-close")?.focus();
      main?.setAttribute("inert", "");
    });
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileNavOpen(false);
      }
      if (event.key === "Tab" && sidebar) {
        const items = Array.from(sidebar.querySelectorAll<HTMLElement>('button:not(:disabled), [tabindex="0"], a[href]'))
          .filter(element => element.getClientRects().length > 0);
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && (document.activeElement === first || !sidebar.contains(document.activeElement))) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !sidebar.contains(document.activeElement))) {
          event.preventDefault(); first?.focus();
        }
      }
    };
    window.addEventListener("keydown", close);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", close);
      main?.removeAttribute("inert");
      document.querySelector<HTMLButtonElement>(".sidebar-toggle")?.focus();
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
  const [studioTab, setStudioTab] = useState("images");
  const [imageSource, setImageSource] = useState<Media | undefined>();
  const [sceneEditing, setSceneEditing] = useState<{
    scene: Scene;
    isNew: boolean;
  } | null>(null);
  const [episodeSceneReturnId, setEpisodeSceneReturnId] = useState<number | null>(null);
  const [sceneImageFlow, setSceneImageFlow] = useState<{ key: "first" | "last"; media?: Media } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => { contentRef.current?.scrollTo({top: 0}); }, [page, sceneEditing, active?.id]);
  const [creating, setCreating] = useState(false);
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
        setSceneEditing(null);
        setEpisodeSceneReturnId(null);
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
        <Welcome onCreate={() => setCreating(true)} onOpen={openProject} onRestored={openRestored} />
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
    setEpisodeSceneReturnId(null);
    setLocate(usage);
    if(usage.kind==="canvas"){
      const scene=data.episodes.flatMap(e=>e.scenes).find(item=>item.id===usage.target_id);
      if(scene){setSceneEditing({scene,isNew:false});setPage("episodes");}return;
    }
    if(usage.kind==="scene"){
      const scene=data.episodes.flatMap(e=>e.scenes).find(item=>item.id===usage.target_id);
      if(scene){setSceneEditing({scene,isNew:false});return;}
    }
    setSceneEditing(null);setPage(usage.kind==="asset"?"roles":"episodes");
  });
  const navigate = (next: string, afterNavigate?: () => void) => {
    setMobileNavOpen(false);
    if (next === page && !sceneEditing) { afterNavigate?.(); return; }
    leaveEditor(() => { setLocate(null);setEpisodeSceneReturnId(null);setImageSource(undefined);setSceneEditing(null);setSceneImageFlow(null); setPage(next); }, afterNavigate);
  };
  const navigateWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (isKeyboardEventBlocked(event.nativeEvent)) return;
    const current = (event.target as Element).closest<HTMLElement>("[data-workspace-nav]");
    if (!current) return;
    if (event.key === "ArrowRight") {
      event.preventDefault(); event.stopPropagation();
      navigate(current.dataset.workspaceNav!, () => requestAnimationFrame(() => {
        const regions = keyboardRegions();
        focusKeyboardTarget(regions.find(item => item.region?.id !== "studio-navigation")?.target || contentRef.current);
      }));
      return;
    }
    if (!["ArrowUp", "ArrowDown", "Home", "End", " "].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-workspace-nav]")).filter(isKeyboardTargetVisible);
    const index = items.indexOf(current);
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : event.key === "ArrowUp" ? Math.max(0, index - 1) : event.key === "ArrowDown" ? Math.min(items.length - 1, index + 1) : index;
    const next = items[nextIndex];
    if (next) navigate(next.dataset.workspaceNav!, () => focusKeyboardTarget(next));
  };
  return (
    <EditGuardContext.Provider value={registerDirty}>
    <Layout className={`app${mobileNavOpen ? " mobile-nav-open" : ""}${page === "agent" && !sceneEditing ? " agent-page" : ""}${darkMode ? " dark-theme" : ""}${sceneEditing?.scene.creation_mode === "canvas" ? " canvas-mode" : ""}`}>
      <a className="skip-to-content" href="#workspace-content">跳转到工作区</a>
      {mobileNavOpen && <button className="mobile-nav-backdrop" aria-label="关闭导航" onClick={() => setMobileNavOpen(false)} />}
      <Layout.Sider className={`side${sidebarCollapsed ? " side-collapsed" : ""}`} width={216}>
        <div id="studio-navigation" className="side-navigation-body" data-keyboard-region="navigation" onKeyDownCapture={navigateWithKeyboard} role={isMobile && mobileNavOpen ? "dialog" : "navigation"} aria-modal={isMobile && mobileNavOpen ? true : undefined} aria-label="工作室导航">
        <div className="mobile-nav-heading"><b>工作室导航</b><Button className="mobile-nav-close" type="text" aria-label="关闭导航" icon={<X size={18}/>} onClick={() => setMobileNavOpen(false)}/></div>
        <div className="logo">
          <img className="logo-mark" src={logoSrc} alt="Spielberg" />
          <div>
            <b>Spielberg</b>
            <small>漫剧制作工作室</small>
          </div>
        </div>
        <button type="button" title={`切换项目：${active?.name}`} aria-label={`切换项目：${active?.name}`} aria-current={page === "projects" ? "page" : undefined} className="project-switch" onClick={() => navigate("projects")}>
          <span className="project-dot" />
          <div>
            <small>当前项目</small>
            <strong>{active?.name}</strong>
          </div>
          <ChevronRight size={15} />
        </button>
        <div className="nav-label">制作空间</div>
        <Menu selectedKeys={[page]} onClickMenuItem={key => navigate(key)} className="nav">
          {workspacePages.map(({ id, label, icon: Icon }) => <Menu.Item key={id} title={`${label} · ↑↓ 切换 · → 进入`} aria-label={label} data-workspace-nav={id} aria-current={page === id ? "page" : undefined} tabIndex={isMobile || page === id || (page === "projects" && id === "agent") ? 0 : -1}><Icon />{label}</Menu.Item>)}
        </Menu>
        <div className="mobile-project-actions">
          <Button icon={<FolderOpen size={16}/>} onClick={() => { setMobileNavOpen(false); openProject(); }}>打开项目</Button>
          <Button icon={<Plus size={16}/>} onClick={() => { setMobileNavOpen(false); leaveEditor(() => setCreating(true)); }}>新建项目</Button>
        </div>
        <div className="side-bottom">
          <div className="studio-local-note"><span className="project-dot" /><span>故事与素材，保存在本地</span></div>
          <div className="nav-label">工作室设置</div>
          <Button
            type="text"
            long
            data-active={page === "settings"}
            title="设置"
            aria-label="设置"
            data-workspace-nav="settings"
            aria-current={page === "settings" ? "page" : undefined}
            tabIndex={isMobile || page === "settings" ? 0 : -1}
            icon={<Settings size={18} />}
            onClick={() => navigate("settings")}
          >
            <span>设置</span>
          </Button>
          <Button className="keyboard-help-button" type="text" long title="键盘快捷键（?）" aria-label="键盘快捷键" icon={<Keyboard size={18} />} onClick={openKeyboardHelp}><span>键盘快捷键 <kbd>?</kbd></span></Button>
        </div>
        </div>
      </Layout.Sider>
      <Layout className="app-main">
        <Layout.Header className="topbar">
          <div>
            <Button
              type="text"
              className="mobile-projects-button"
              title={`最近项目 · 当前：${active?.name}`}
              aria-label="最近项目"
              aria-pressed={page === "projects" && !sceneEditing}
              icon={<FolderOpen size={18} />}
              onClick={() => navigate("projects")}
            >
              最近项目
            </Button>
            <Button
              type="text"
              className="sidebar-toggle"
              title="切换导航"
              aria-label="切换导航"
              aria-controls="studio-navigation"
              aria-expanded={isMobile ? mobileNavOpen : !sidebarCollapsed}
              icon={(isMobile ? !mobileNavOpen : sidebarCollapsed) ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
              onClick={() => isMobile ? setMobileNavOpen(value => !value) : setSidebarCollapsed(value => !value)}
            />
            <span className="crumb" title={active?.name}>{active?.name}</span>
            <span className="crumb-sep">/</span>
            <b>
              {sceneImageFlow
                ? "工作台 · 图片生成"
                : sceneEditing
                ? sceneEditing.isNew
                  ? (sceneEditing.scene.creation_mode === "canvas" ? "创建画布场景" : "创建场景")
                  : (sceneEditing.scene.creation_mode === "canvas" ? "画布场景" : "编辑场景")
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
            sceneEditing.scene.creation_mode === "canvas" ? <InfiniteCanvas key={`${data.project.id}:${sceneEditing.scene.id}`} data={data} scene={data.episodes.flatMap(e=>e.scenes).find(s=>s.id===sceneEditing.scene.id)||sceneEditing.scene} reload={refresh} onClose={()=>leaveEditor(()=>setSceneEditing(null))} /> : <>
            <div className="scene-editor-host" hidden={!!sceneImageFlow}>
            <SceneEditor
              key={`${data.project.id}:${sceneEditing.scene.id}`}
              scene={sceneEditing.scene}
              isNew={sceneEditing.isNew}
              data={data}
              onClose={() => setSceneEditing(null)}
              reload={refresh}
              onGenerateFrame={key => { if (key === "reference") return; setSceneImageFlow({ key }); setStudioTab("images"); }}
              generatedFrame={sceneImageFlow?.media ? { key: sceneImageFlow.key, media: sceneImageFlow.media } : null}
              onGeneratedApplied={() => setSceneImageFlow(null)}
            />
            </div>
            {sceneImageFlow && <div className="scene-image-workbench">
              <div className="scene-editor-heading"><div className="scene-editor-heading-title"><Button type="text" onClick={() => setSceneImageFlow(null)}>← 返回场景编辑</Button></div></div>
              <CreationDesk data={data} reload={refresh} activeTab="images" onTabChange={setStudioTab} changePage={navigate} editScene={() => {}} renderSequence={() => null}
                initialPrompt={sceneEditing.scene.script?.[sceneImageFlow.key] || sceneEditing.scene.description}
                initialRatio={sceneEditing.scene.generation_options?.aspect_ratio || "16:9"}
                onImageUse={media => { void refresh().then(() => setSceneImageFlow(current => current ? { ...current, media } : current)).catch(e => Message.error(String(e))); }} />
            </div>}
            </>
          ) : (
            <>
              {page === "studio" && (
                <CreationDesk
                  key={data.project.id}
                  activeTab={studioTab}
                  onTabChange={setStudioTab}
                  renderSequence={() => <Studio data={data} reload={refresh} changePage={navigate} editScene={scene => setSceneEditing({scene, isNew: false})} />}
                  data={data}
                  reload={refresh}
                  changePage={navigate}
                  imageSource={imageSource}
                  editScene={(scene) =>
                    setSceneEditing({ scene, isNew: false })
                  }
                />
              )}{" "}
              {page === "agent" && <AgentWorkspace key={data.project.id} data={data} reload={refresh} onNavigate={navigate} />}
              {page === "episodes" && (
                <Episodes
                  initialEpisodeId={episodeSceneReturnId ?? (locate?.kind==="episode"?locate.target_id:undefined)}
                  initialView={episodeSceneReturnId !== null ? "scenes" : undefined}
                  data={data}
                  reload={refresh}
                  editScene={(scene, isNew, episodeId) => {
                    setEpisodeSceneReturnId(episodeId);
                    setSceneEditing({ scene, isNew });
                  }}
                />
              )}{" "}
              {page === "editor" && <MediaEditor key={data.project.id} data={data} reload={refresh} />}
              {page === "assets" && <AssetLibrary key={data.project.id} data={data} reload={refresh} onLocate={locateAsset} onImageToImage={media=>leaveEditor(()=>{setLocate(null);setImageSource(media);setStudioTab("images");setSceneEditing(null);setPage("studio");})} />}
              {page === "tasks" && <Tasks key={data.project.id} projectId={data.project.id} />}
              {page === "roles" && <Roles data={data} reload={refresh} initialRoleId={locate?.kind==="asset"?locate.target_id:undefined} />}{" "}
              {page === "prompts" && (
                <Prompts data={data} reload={refresh} />
              )}{" "}
              {page === "project-config" && <ProjectConfig key={data.project.id} project={data.project} reload={refresh} />}
              {page === "settings" && (
                <SettingsPage data={data} reload={refresh} />
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
      </Layout>
      <Modal className="keyboard-help-modal" title="键盘快捷键" visible={keyboardHelpOpen} onCancel={() => setKeyboardHelpOpen(false)} footer={null} autoFocus focusLock afterClose={() => { if (!focusKeyboardTarget(keyboardHelpReturn.current)) focusKeyboardTarget(document.querySelector<HTMLElement>(".sidebar-toggle")); }} style={{ width: 480, maxWidth: "calc(100vw - 32px)" }}>
        <div className="keyboard-shortcuts">
          <div><h3>工作区导航</h3><dl>
            <div><dt>切换焦点区域 / 反向切换</dt><dd><kbd>F6</kbd> / <kbd>Shift F6</kbd></dd></div>
            <div><dt>侧栏切换页面、列表切换会话</dt><dd><kbd>↑</kbd> <kbd>↓</kbd></dd></div>
            <div><dt>侧栏 → 会话 → 对话 → 输入框</dt><dd><kbd>→</kbd></dd></div>
            <div><dt>对话 → 会话 → 侧栏</dt><dd><kbd>←</kbd></dd></div>
            <div><dt>列表第一项 / 最后一项</dt><dd><kbd>Home</kbd> / <kbd>End</kbd></dd></div>
          </dl></div>
          <div><h3>资产库与素材库</h3><dl>
            <div><dt>从侧栏选中第一张卡片</dt><dd><kbd>→</kbd></dd></div>
            <div><dt>按网格位置选择卡片</dt><dd><kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd></dd></div>
            <div><dt>最左列返回侧栏</dt><dd><kbd>←</kbd></dd></div>
            <div><dt>查看资产详情 / 预览素材</dt><dd><kbd>Enter</kbd></dd></div>
            <div><dt>选择当前列表第一张 / 最后一张</dt><dd><kbd>Home</kbd> / <kbd>End</kbd></dd></div>
            <div><dt>素材库翻页</dt><dd>底部分页控件</dd></div>
          </dl></div>
          <div><h3>素材库与对话</h3><dl>
            <div><dt>整屏滚动</dt><dd><kbd>PageUp</kbd> <kbd>PageDown</kbd></dd></div>
            <div><dt>搜索素材 / 输入消息</dt><dd><kbd>/</kbd></dd></div>
            <div><dt>离开搜索框或消息输入框</dt><dd><kbd>Esc</kbd></dd></div>
          </dl></div>
          <p>方向键跟随当前焦点区域，输入文字时保留光标操作。弹窗和下拉菜单使用各自的快捷键。按 <kbd>?</kbd> 查看帮助，按 <kbd>Esc</kbd> 关闭。Mac 的功能键可能需要同时按住 <kbd>Fn</kbd>。</p>
        </div>
      </Modal>
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
}: {
  onCreate: () => void;
  onOpen: () => void;
  onRestored:(id:string)=>Promise<void>;
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
