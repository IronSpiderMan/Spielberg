import { useEffect, useRef, useState } from "react";
import { Button, Form, Input, Message, Slider, Space, Switch } from "@arco-design/web-react";
import { AlertCircle, Check, FolderOpen, Image, LoaderCircle, MessageSquare, Mic, Save, Sparkles, Video } from "lucide-react";
import { type ModelSettings, type Snapshot, post } from "./core";
import { useEditGuard } from "./edit-guard";
import { type GenerationKind } from "./generation-channels";
import { GenerationChannelsSettings } from "./GenerationChannelsSettings";
import { SkillsSettings } from "./SkillsSettings";
import { open } from "./platform";
import { isLocalDesktop } from "./transport";
import { agentFloatColors, type AgentFloatPreferences } from "./agent-float-preferences";
import "./settings.css";

const categories = [
  { id: "llm", label: "文本与推理", icon: MessageSquare },
  { id: "image", label: "图片生成", icon: Image },
  { id: "video", label: "视频生成", icon: Video },
  { id: "asr", label: "语音识别", icon: Mic },
  { id: "tts", label: "语音合成", icon: Mic },
  { id: "skills", label: "Skills 技能", icon: Sparkles },
  { id: "agent-float", label: "Agent 悬浮按钮", icon: Sparkles },
  { id: "storage", label: "项目存储", icon: FolderOpen },
] as const;
type Category = typeof categories[number]["id"];
const serviceKinds: GenerationKind[] = ["llm", "image", "video", "tts", "asr"];

export default function SettingsPage({ data, reload, agentFloat, onAgentFloatChange }: {
  data: Snapshot; reload: () => void | Promise<void>;
  agentFloat: AgentFloatPreferences; onAgentFloatChange: (value: AgentFloatPreferences) => void;
}) {
  const [category, setCategory] = useState<Category>("llm");
  const tabsRef = useRef<HTMLDivElement>(null);
  const [skillsVisited, setSkillsVisited] = useState(false);
  const [settings, setSettings] = useState<ModelSettings>({ ...data.settings });
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const savingRef = useRef(false);
  const [projectsDirectory, setProjectsDirectory] = useState("");
  const [savedDirectory, setSavedDirectory] = useState<string | null>(null);
  const [loadingDirectory, setLoadingDirectory] = useState(true);
  const [directoryError, setDirectoryError] = useState("");
  const [savingDirectory, setSavingDirectory] = useState(false);
  const directoryUnavailable = loadingDirectory || savingDirectory || savedDirectory === null;
  const directoryDirty = savedDirectory !== null && projectsDirectory !== savedDirectory;
  useEditGuard(dirty || directoryDirty || saving || savingDirectory);

  const loadDirectory = async () => {
    setLoadingDirectory(true);
    setDirectoryError("");
    try {
      const config = await post<{ projects_directory: string }>("/app/settings/load");
      setProjectsDirectory(config.projects_directory);
      setSavedDirectory(config.projects_directory);
    } catch (error) { setDirectoryError(error instanceof Error ? error.message : String(error)); }
    finally { setLoadingDirectory(false); }
  };
  useEffect(() => { void loadDirectory(); }, []);
  useEffect(() => { if (!dirty) setSettings({ ...data.settings }); }, [data.settings, dirty]);
  useEffect(() => {
    const tabs = tabsRef.current;
    if (!tabs) return;
    const keepSelectedVisible = () => {
      const selected = tabs.querySelector('[aria-selected="true"]');
      if (!selected) return;
      const bounds = tabs.getBoundingClientRect();
      const item = selected.getBoundingClientRect();
      if (item.left < bounds.left) tabs.scrollLeft += item.left - bounds.left;
      else if (item.right > bounds.right) tabs.scrollLeft += item.right - bounds.right;
    };
    keepSelectedVisible();
    const observer = new ResizeObserver(keepSelectedVisible);
    observer.observe(tabs);
    return () => observer.disconnect();
  }, [category]);
  const chooseDirectory = async () => {
    try {
      const selected = await open({ directory: true, multiple: false, title: "选择项目存储目录", defaultPath: projectsDirectory || undefined });
      if (typeof selected === "string") setProjectsDirectory(selected);
    } catch (error) { Message.error(String(error)); }
  };
  const saveDirectory = async () => {
    if (savingDirectory || !directoryDirty) return;
    if (!projectsDirectory.trim()) { Message.warning("请输入项目存储路径"); return; }
    setSavingDirectory(true);
    setDirectoryError("");
    try {
      const config = await post<{ projects_directory: string }>("/app/settings/save", { projects_directory: projectsDirectory.trim() });
      setProjectsDirectory(config.projects_directory);
      setSavedDirectory(config.projects_directory);
      Message.success("项目存储路径已保存");
    } catch (error) { setDirectoryError(error instanceof Error ? error.message : String(error)); }
    finally { setSavingDirectory(false); }
  };
  const save = async () => {
    if (savingRef.current || !dirty) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError("");
    try {
      await post("/settings", { project_id: data.project.id, settings });
      await reload();
      setDirty(false);
      Message.success("接口配置已保存");
    } catch (error) { setSaveError(error instanceof Error ? error.message : String(error)); Message.error(String(error)); }
    finally { savingRef.current = false; setSaving(false); }
  };
  const selectCategory = (next: Category) => {
    setCategory(next);
    if (next === "skills") setSkillsVisited(true);
  };
  const changed = (kind: GenerationKind) => dirty && JSON.stringify(settings[kind]) !== JSON.stringify(data.settings[kind]);

  return <section className="studio-settings-page">
    <div className="section-title page-actions settings-page-heading">
      <div className="page-intro"><h1>工作室设置</h1><p>管理 AI 创作服务与工作室偏好。</p></div>
      <div className="settings-save-actions">
        <span className="settings-save-state" data-dirty={dirty} role="status" aria-live="polite">{saving ? <><LoaderCircle size={14} className="settings-saving-icon" />正在保存配置…</> : dirty ? <><i />渠道配置有未保存更改</> : <><Check size={14} />渠道配置已保存</>}</span>
        <Button type="primary" icon={<Save size={15} />} loading={saving} disabled={!dirty} title="保存文本、图片、视频与语音的所有渠道配置" onClick={() => void save()}>保存配置</Button>
      </div>
    </div>
    {saveError && <div className="settings-feedback" role="alert"><AlertCircle size={16} /><div><strong>配置未能保存，修改已保留</strong><p>{saveError}</p></div></div>}
    <div ref={tabsRef} className="settings-category-tabs" role="tablist" aria-label="设置分类">
      {categories.map(({ id, label, icon: Icon }, index) => {
        const service = serviceKinds.includes(id as GenerationKind);
        const pending = service ? changed(id as GenerationKind) : id === "storage" && directoryDirty;
        return <button key={id} id={`settings-tab-${id}`} type="button" role="tab" aria-selected={category === id} aria-controls={`settings-panel-${id}`} tabIndex={0} onClick={() => selectCategory(id)} ><Icon size={16} /><span>{label}</span>{pending && <i className="settings-pending-dot" aria-label="有未保存修改" />}</button>;
      })}
    </div>
    {serviceKinds.map(kind => <div key={kind} id={`settings-panel-${kind}`} role="tabpanel" aria-labelledby={`settings-tab-${kind}`} className="studio-settings-panel settings-service-panel" hidden={category !== kind}>
      <GenerationChannelsSettings kind={kind} settings={settings} disabled={saving} onChange={next => { setSettings(next); setDirty(true); }} />
    </div>)}
    <div id="settings-panel-skills" role="tabpanel" aria-labelledby="settings-tab-skills" className="studio-settings-panel settings-shared-panel" hidden={category !== "skills"}>{skillsVisited && <SkillsSettings />}</div>
    <div id="settings-panel-agent-float" role="tabpanel" aria-labelledby="settings-tab-agent-float" className="studio-settings-panel settings-shared-panel" hidden={category !== "agent-float"}>
      <div className="settings-shared-section">
        <div className="setting-heading">
          <div className="settings-panel-title"><h3>Agent 悬浮按钮</h3><span className="settings-scope">本机偏好</span></div>
          <p>更改即时生效，并自动保存在当前客户端。</p>
        </div>
        <Form layout="vertical" className="settings-agent-float-form">
          <Form.Item label="显示悬浮按钮">
            <Switch aria-label="显示悬浮按钮" checked={agentFloat.visible} onChange={visible => onAgentFloatChange({ ...agentFloat, visible })} />
          </Form.Item>
          <Form.Item label="按钮颜色">
            <div className="settings-agent-float-colors" role="radiogroup" aria-label="按钮颜色">
              {(Object.keys(agentFloatColors) as AgentFloatPreferences["color"][]).map(color => (
                <label key={color} className="settings-agent-float-color" data-color={color}>
                  <input type="radio" name="agent-float-color" value={color} checked={agentFloat.color === color}
                    onChange={() => onAgentFloatChange({ ...agentFloat, color })} />
                  <span className="settings-agent-float-swatch" aria-hidden="true"><Check size={16} /></span>
                  <span>{agentFloatColors[color]}</span>
                </label>
              ))}
            </div>
          </Form.Item>
          <Form.Item label={`动态强度 · ${agentFloat.intensity}%`} extra="0% 为静态，100% 为默认强度。">
            <Slider aria-label="动态强度" min={0} max={200} step={5} value={agentFloat.intensity}
              onChange={intensity => onAgentFloatChange({ ...agentFloat, intensity: Number(intensity) })} />
          </Form.Item>
        </Form>
      </div>
    </div>
    <div id="settings-panel-storage" role="tabpanel" aria-labelledby="settings-tab-storage" className="studio-settings-panel settings-shared-panel" hidden={category !== "storage"}>
      <div className="settings-shared-section settings-storage" aria-busy={loadingDirectory || savingDirectory}>
        <div className="setting-heading"><div className="settings-panel-title"><h3>项目存储</h3><span className="settings-scope">工作室共享</span></div><p>设置新建和恢复项目的默认保存位置。</p></div>
        {loadingDirectory && <p className="settings-directory-loading" role="status"><LoaderCircle size={14} className="settings-saving-icon" />正在读取项目存储路径…</p>}
        {directoryError && <div className="settings-feedback" role="alert"><AlertCircle size={16} /><div><strong>{savedDirectory === null ? "无法读取项目存储路径" : "项目路径未能保存"}</strong><p>{directoryError}</p></div>{savedDirectory === null && <Button size="small" loading={loadingDirectory} onClick={() => void loadDirectory()}>重新加载</Button>}</div>}
        <Form layout="vertical" disabled={directoryUnavailable}>
          <Form.Item label="项目存储路径" extra={`每个项目使用独立子文件夹。修改后，已有项目仍保留在原位置。${isLocalDesktop ? "" : "请填写后端服务器上的绝对路径。"}`}>
            <div className="project-directory-input"><Input value={projectsDirectory} disabled={directoryUnavailable} onChange={setProjectsDirectory} placeholder="输入项目存储目录的完整路径" aria-label="项目存储路径" />{isLocalDesktop && <Button disabled={directoryUnavailable} onClick={() => void chooseDirectory()}>选择文件夹</Button>}</div>
          </Form.Item>
          <Space wrap><Button type="primary" loading={savingDirectory} disabled={!directoryDirty || loadingDirectory} onClick={() => void saveDirectory()}>保存项目路径</Button><span className="settings-directory-state" data-dirty={directoryDirty} role="status">{savingDirectory ? "正在保存路径…" : directoryDirty ? "路径有未保存修改" : savedDirectory !== null ? "项目路径已保存" : ""}</span></Space>
        </Form>
      </div>
    </div>
  </section>;
}
