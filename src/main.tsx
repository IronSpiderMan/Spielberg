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
ChevronRight,
Clapperboard,
Film,
FolderOpen,
ImagePlus,
LayoutDashboard,
Moon,
Plus,
Settings,
Sun,
Sparkles,
Users,
WandSparkles
} from "lucide-react";
import { lazy,Suspense,useCallback,useEffect,useRef,useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./role-media.css";
import "./welcome.css";

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
import { PageHeading, PageLoading } from "./ui";
const CreationDesk=lazy(()=>import("./creation").then(m=>({default:m.CreationDesk})));
const AssetLibrary=lazy(()=>import("./AssetLibrary"));
const ProjectTools=lazy(()=>import("./ProjectTools"));

const Studio=lazy(()=>import("./workspace").then(m=>({default:m.Studio})));
const Tasks=lazy(()=>import("./workspace").then(m=>({default:m.Tasks})));
const Episodes=lazy(()=>import("./workspace").then(m=>({default:m.Episodes})));
const SceneEditor=lazy(()=>import("./workspace").then(m=>({default:m.SceneEditor})));
const Roles=lazy(()=>import("./workspace").then(m=>({default:m.Roles})));
const Prompts=lazy(()=>import("./workspace").then(m=>({default:m.Prompts})));
const SettingsPage=lazy(()=>import("./workspace").then(m=>({default:m.SettingsPage})));

function App() {
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem("spielberg-theme") === "dark");
  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? "dark" : "light";
    localStorage.setItem("spielberg-theme", darkMode ? "dark" : "light");
  }, [darkMode]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [active, setActive] = useState<Project | null>(null);
  const [data, setData] = useState<Snapshot | null>(null);
  const snapshotRef = useRef<Snapshot|null>(null);
  const refreshSequence=useRef(0);
  const [locate,setLocate]=useState<AssetUsage|null>(null);
  const activeRef = useRef<string | null>(null);
  const [page, setPage] = useState("studio");
  const [studioTab, setStudioTab] = useState("script");
  const [imageSource, setImageSource] = useState<Media | undefined>();
  const [sceneEditing, setSceneEditing] = useState<{
    scene: Scene;
    isNew: boolean;
  } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => { contentRef.current?.scrollTo({top: 0}); }, [page, sceneEditing, active?.id]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(true);
  const [creatingProject, setCreatingProject] = useState(false);
  const loadVersion = useRef(0);
  const editorDirty = useRef(false);
  const registerDirty = useCallback((dirty: boolean) => { editorDirty.current = dirty; }, []);
  const leaveEditor = (action: () => void) => {
    if (editorDirty.current) confirmDiscard(action);
    else action();
  };
  const load = async (id?: string) => {
    const version = ++loadVersion.current;
    const ps = await api<Project[]>("/projects");
    if (version !== loadVersion.current) return;
    setProjects(ps);
    const target = id || active?.id || ps[0]?.id;
    if (target) {
      const s = await post<Snapshot>("/project", { id: target });
      if (version !== loadVersion.current) return;
      if (activeRef.current !== s.project.id) {
        setSceneEditing(null);
        setStudioTab("script");
        setPage("studio");
      }
      snapshotRef.current=s;refreshSequence.current++;setLocate(null);
      setData(s);
      activeRef.current = s.project.id;
      setActive(s.project);
    } else {
      snapshotRef.current=null;refreshSequence.current++;
      setData(null);
      activeRef.current = null;
      setActive(null);
    }
  };
  const refresh = useCallback(async () => {
    const current=snapshotRef.current;
    const id=activeRef.current;
    if(!id||!current)return;
    const sequence=++refreshSequence.current;
    const changes=await post<Partial<Snapshot>>("/project/changes",{id,revisions:current.revisions||{}});
    if(activeRef.current!==id||sequence!==refreshSequence.current)return;
    const merged={...snapshotRef.current,...changes} as Snapshot;
    snapshotRef.current=merged;
    // No changed domain means no React render or media-grid requery.
    if(Object.keys(changes).some(key=>key!=="project"&&key!=="revisions") || JSON.stringify(current.revisions)!==JSON.stringify(changes.revisions))setData(merged);
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
      const confirmed=await new Promise<boolean>(resolve=>Modal.confirm({title:"打开恢复的项目？",content:"当前修改尚未保存，切换后将丢失。恢复的项目已保存在最近项目中。",okText:"放弃修改并打开",cancelText:"留在当前项目",onOk:()=>resolve(true),onCancel:()=>resolve(false)}));
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
                autoFocus
              />
            </Form.Item>
          </Form>
        </Modal>
      </>
    );
  const locateAsset=(usage:AssetUsage)=>leaveEditor(()=>{
    setLocate(usage);
    if(usage.kind==="scene"){
      const scene=data.episodes.flatMap(e=>e.scenes).find(item=>item.id===usage.target_id);
      if(scene){setSceneEditing({scene,isNew:false});return;}
    }
    setSceneEditing(null);setPage(usage.kind==="role"?"roles":"episodes");
  });
  const navigate = (next: string) => {
    if (next === page && !sceneEditing) return;
    leaveEditor(() => { setLocate(null);setImageSource(undefined);setSceneEditing(null); setPage(next); });
  };
  return (
    <EditGuardContext.Provider value={registerDirty}>
    <Layout className={`app${darkMode ? " dark-theme" : ""}`}>
      <Layout.Sider className="side" width={238}>
        <div className="logo">
          <img className="logo-mark" src={logoSrc} alt="Spielberg" />
          <div>
            <b>Spielberg</b>
            <small>AI COMIC STUDIO</small>
          </div>
        </div>
        <button type="button" title="切换项目" className="project-switch" onClick={() => navigate("projects")}>
          <span className="project-dot" />
          <div>
            <small>当前项目</small>
            <strong>{active?.name}</strong>
          </div>
          <ChevronRight size={15} />
        </button>
        <div className="nav-label">制作空间</div>
        <Menu selectedKeys={[page]} onClickMenuItem={navigate} className="nav">
          <Menu.Item key="studio" title="工作台" aria-label="工作台">
            <LayoutDashboard />
            工作台
          </Menu.Item>
          <Menu.Item key="episodes" title="剧集" aria-label="剧集">
            <Clapperboard />
            剧集
          </Menu.Item>
          <Menu.Item key="assets" title="资产库" aria-label="资产库"><ImagePlus />资产库</Menu.Item>
          <Menu.Item key="roles" title="角色设定" aria-label="角色设定">
            <Users />
            角色设定
          </Menu.Item>
          <Menu.Item key="tasks" title="后台任务" aria-label="后台任务"><Film />后台任务</Menu.Item>
          <Menu.Item key="prompts" title="Prompt 库" aria-label="Prompt 库">
            <WandSparkles />
            Prompt 库
          </Menu.Item>
        </Menu>
        <div className="side-bottom">
          <div className="nav-label">工作室设置</div>
          <Button
            type="text"
            long
            data-active={page === "settings"}
            title="模型与接口"
            aria-label="模型与接口"
            icon={<Settings size={18} />}
            onClick={() => navigate("settings")}
          >
            <span>模型与接口</span>
          </Button>
        </div>
      </Layout.Sider>
      <Layout className="app-main">
        <Layout.Header className="topbar">
          <div>
            <span className="crumb">{active?.name}</span>
            <span className="crumb-sep">/</span>
            <b>
              {sceneEditing
                ? sceneEditing.isNew
                  ? "创建场景"
                  : "编辑场景"
                : (
                    {
                      studio: "工作台",
                      episodes: "剧集管理",
                      assets: "资产库",
                      roles: "角色设定",
                      prompts: "Prompt 库",
                      tasks: "后台任务",
                      settings: "模型与接口",
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
          ref={contentRef}
          key={data.project.id}
          className={sceneEditing ? "content scene-page-content" : "content"}
        >
          <Suspense fallback={<PageLoading/>}>
          {sceneEditing ? (
            <SceneEditor
              scene={sceneEditing.scene}
              isNew={sceneEditing.isNew}
              data={data}
              onClose={() => setSceneEditing(null)}
              reload={refresh}
            />
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
              {page === "episodes" && (
                <Episodes
                  initialEpisodeId={locate?.kind==="episode"?locate.target_id:undefined}
                  data={data}
                  reload={refresh}
                  editScene={(scene, isNew) =>
                    setSceneEditing({ scene, isNew })
                  }
                />
              )}{" "}
              {page === "assets" && <AssetLibrary key={data.project.id} data={data} reload={refresh} onLocate={locateAsset} onImageToImage={media=>leaveEditor(()=>{setLocate(null);setImageSource(media);setStudioTab("images");setSceneEditing(null);setPage("studio");})} />}
              {page === "tasks" && <Tasks />}
              {page === "roles" && <Roles data={data} reload={refresh} initialRoleId={locate?.kind==="role"?locate.target_id:undefined} />}{" "}
              {page === "prompts" && (
                <Prompts data={data} reload={refresh} />
              )}{" "}
              {page === "settings" && (
                <SettingsPage data={data} reload={refresh} />
              )}{" "}
              {page === "projects" && (
                <ProjectPage
                  projects={projects}
                  active={active}
                  select={(id) => { void load(id).catch(e => Message.error(String(e))); }}
                />
              )}
            </>
          )}
          </Suspense>
        </Layout.Content>
      </Layout>
      <Modal title="创建项目" visible={creating} onCancel={() => !creatingProject && setCreating(false)}
        onOk={create} okText="创建项目" confirmLoading={creatingProject} maskClosable={!creatingProject}>
        <Form layout="vertical"><Form.Item label="项目名称" required>
          <Input value={newName} onChange={setNewName} placeholder="为你的故事起个名字" autoFocus
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
        <img className="hero-logo" src={logoSrc} alt="Spielberg" />
        <h1>把灵感，剪成一部漫剧</h1>
        <p>角色、分镜、视觉资产与生成模型都归于一个本地项目。</p>
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
        </div>
        <Suspense fallback={null}><ProjectTools onRestored={onRestored}/></Suspense>
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
}: {
  projects: Project[];
  active: Project | null;
  select: (id: string) => void;
}) {
  return (
    <section>
      <PageHeading title="最近项目" description="每个故事拥有独立的剧集、角色与素材空间。" />
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
              <span>{p.name.slice(0, 1)}</span>
            </div>
            <h3>{p.name}</h3>
            <p>{p.path}</p>
            <small>最近更新 {p.updated_at}</small>
          </Card>
        ))}
      </div>
    </section>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
