import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, Form, Input, InputNumber, Message, Slider, Space, Switch } from "@arco-design/web-react";
import { AlertCircle, Check, FolderOpen, Image, LoaderCircle, MessageSquare, Mic, Network, Save, Sparkles, Square, Video, Volume2 } from "lucide-react";
import { type ModelSettings, type Snapshot, post } from "./core";
import { useEditGuard } from "./edit-guard";
import { generationChoice, type GenerationKind } from "./generation-channels";
import { GenerationChannelsSettings } from "./GenerationChannelsSettings";
import { GenerationSelector } from "./components/generation/GenerationSelector";
import { SkillsSettings } from "./SkillsSettings";
import ListenerSettings from "./ListenerSettings";
import { open } from "./platform";
import { isLocalDesktop } from "./transport";
import { agentFloatColors, useAgentFloatSpeechPreferences, type AgentFloatPreferences } from "./agent-float-preferences";
import { useAgentReplySpeech } from "./agent-reply-speech";
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
  { id: "listener", label: "端口设置", icon: Network },
] as const;
type Category = typeof categories[number]["id"];
const serviceKinds: GenerationKind[] = ["llm", "image", "video", "tts", "asr"];

export default function SettingsPage({ data, reload, agentFloat, onAgentFloatChange }: {
  data: Snapshot; reload: () => void | Promise<void>;
  agentFloat: AgentFloatPreferences; onAgentFloatChange: (value: AgentFloatPreferences) => void;
}) {
  const [category, setCategory] = useState<Category>("llm");
  const [agentSection, setAgentSection] = useState<"speech" | "appearance">("speech");
  const pageRef = useRef<HTMLElement>(null);
  const agentScrollRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const [skillsVisited, setSkillsVisited] = useState(false);
  const [listenerVisited, setListenerVisited] = useState(false);
  const [listenerDirty, setListenerDirty] = useState(false);
  const [settings, setSettings] = useState<ModelSettings>({ ...data.settings });
  const [agentSpeech, setAgentSpeech] = useAgentFloatSpeechPreferences(data.project.id);
  const asrChoice = generationChoice(data.settings, "asr", agentSpeech.asr, "asr");
  const ttsChoice = generationChoice(data.settings, "tts", agentSpeech.tts, "tts");
  const speechPreview = useAgentReplySpeech(data.project.id, agentSpeech, data.settings);
  const previewActive = speechPreview.state !== "idle";
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
  useEditGuard(dirty || directoryDirty || listenerDirty || saving || savingDirectory);

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
  useEffect(() => { speechPreview.stop(); }, [category, agentSection, data.project.id, agentSpeech, speechPreview.stop]);
  useEffect(() => { setAgentSection("speech"); }, [data.project.id]);
  useLayoutEffect(() => {
    // Each category starts at its heading, including nested channel editors.
    pageRef.current?.querySelectorAll<HTMLElement>(".studio-settings-panel, .settings-channel-editor-scroll, .settings-channel-list").forEach(element => { element.scrollTop = 0; });
    if (agentScrollRef.current) agentScrollRef.current.scrollTop = 0;
  }, [category, data.project.id]);
  useLayoutEffect(() => { if (agentScrollRef.current) agentScrollRef.current.scrollTop = 0; }, [agentSection]);
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
    speechPreview.stop();
    if (next === "agent-float" && category !== "agent-float") setAgentSection("speech");
    setCategory(next);
    if (next === "skills") setSkillsVisited(true);
    if (next === "listener") setListenerVisited(true);
  };
  const changed = (kind: GenerationKind) => dirty && JSON.stringify(settings[kind]) !== JSON.stringify(data.settings[kind]);

  return <section ref={pageRef} className="studio-settings-page">
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
        const pending = service ? changed(id as GenerationKind) : (id === "storage" && directoryDirty) || (id === "listener" && listenerDirty);
        return <button key={id} id={`settings-tab-${id}`} type="button" role="tab" aria-selected={category === id} aria-controls={`settings-panel-${id}`} tabIndex={0} onClick={() => selectCategory(id)} ><Icon size={16} /><span>{label}</span>{pending && <i className="settings-pending-dot" aria-label="有未保存修改" />}</button>;
      })}
    </div>
    {serviceKinds.map(kind => <div key={kind} id={`settings-panel-${kind}`} role="tabpanel" aria-labelledby={`settings-tab-${kind}`} className="studio-settings-panel settings-service-panel" hidden={category !== kind}>
      <GenerationChannelsSettings kind={kind} settings={settings} disabled={saving} onChange={next => { setSettings(next); setDirty(true); }} />
    </div>)}
    <div id="settings-panel-skills" role="tabpanel" aria-labelledby="settings-tab-skills" className="studio-settings-panel settings-shared-panel" hidden={category !== "skills"}>{skillsVisited && <SkillsSettings />}</div>
    <div id="settings-panel-listener" role="tabpanel" aria-labelledby="settings-tab-listener" className="studio-settings-panel settings-shared-panel" hidden={category !== "listener"}>
      {listenerVisited && <ListenerSettings onDirtyChange={setListenerDirty} />}
    </div>
    <div id="settings-panel-agent-float" role="tabpanel" aria-labelledby="settings-tab-agent-float" className="studio-settings-panel settings-agent-panel" hidden={category !== "agent-float"}>
      <div className="settings-agent-navigation">
        <div className="settings-agent-subtabs" role="tablist" aria-label="浮标设置分组" onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === "Home" ? "speech" : event.key === "End" ? "appearance" : agentSection === "speech" ? "appearance" : "speech";
          setAgentSection(next);
          event.currentTarget.querySelector<HTMLButtonElement>(`[data-section="${next}"]`)?.focus();
        }}>
          {([{ id: "speech", label: "语音服务", icon: Volume2 }, { id: "appearance", label: "浮标与交互", icon: Sparkles }] as const).map(({ id, label, icon: Icon }) =>
            <button key={id} type="button" id={`agent-settings-tab-${id}`} role="tab" data-section={id} aria-selected={agentSection === id} aria-controls={`agent-settings-${id}`} tabIndex={agentSection === id ? 0 : -1} onClick={() => setAgentSection(id)}><Icon size={15} />{label}</button>
          )}
        </div>
        <span className="settings-agent-autosave"><Check size={13} />更改自动保存</span>
      </div>
      <div ref={agentScrollRef} className="settings-agent-body">
        <section id="agent-settings-speech" role="tabpanel" aria-labelledby="agent-settings-tab-speech" className="settings-agent-subpanel" hidden={agentSection !== "speech"}>
          <div className="settings-agent-section-intro"><h3>语音服务</h3><p>按当前项目保存在本机。项目渠道需先配置并保存，再在这里选择。</p></div>
          <div className="settings-agent-speech-grid">
            <section className="settings-agent-speech-card" aria-label="浮标 ASR 设置">
              <header className="settings-agent-card-heading"><Mic size={18} /><div><h4>语音识别 ASR</h4><p>把你的语音转为指令</p></div></header>
              <div className="settings-agent-card-body">
                <div className="settings-agent-field"><span>识别方式</span><div className="settings-agent-float-actions" role="radiogroup" aria-label="ASR 识别方式">
                  {([{ value: "system", label: "系统识别" }, { value: "cloud", label: "项目 ASR 渠道" }] as const).map(option => (
                    <label key={option.value}><input type="radio" name="agent-float-asr-provider" value={option.value} checked={agentSpeech.asr.provider === option.value}
                      onChange={() => setAgentSpeech({ ...agentSpeech, asr: { ...agentSpeech.asr, provider: option.value } })} /><span>{option.label}</span></label>
                  ))}
                </div></div>
                {agentSpeech.asr.provider === "cloud" ? <div className="settings-agent-field"><span>渠道与模型</span><div className="settings-agent-field-content">
                  <GenerationSelector compact settings={data.settings} kind="asr" operation="asr" value={agentSpeech.asr}
                    onChange={next => setAgentSpeech({ ...agentSpeech, asr: { ...agentSpeech.asr, ...next } })} />
                  {!asrChoice ? <div className="settings-agent-speech-notice" role="status"><p>{agentSpeech.asr.channel_id || agentSpeech.asr.model ? "所选 ASR 渠道或模型已不可用，请重新选择。" : "还没有可用的 ASR 渠道和模型。"}</p><Button size="small" type="text" onClick={() => selectCategory("asr")}>配置语音识别渠道</Button></div>
                    : <p className="settings-agent-speech-hint">{!agentSpeech.asr.channel_id && !agentSpeech.asr.model ? "使用项目已保存的默认渠道和模型。" : "使用所选渠道识别录音。"}</p>}
                </div></div> : <p className="settings-agent-speech-hint">使用系统中文识别，无需配置渠道；首次使用需授权麦克风与语音识别。</p>}
              </div>
            </section>
            <section className="settings-agent-speech-card" aria-label="浮标 TTS 设置">
              <header className="settings-agent-card-heading"><Volume2 size={18} /><div><h4>回复朗读 TTS</h4><p>用选定声音朗读回复</p></div></header>
              <div className="settings-agent-card-body">
                <div className="settings-agent-field"><span>朗读方式</span><div className="settings-agent-float-actions" role="radiogroup" aria-label="TTS 朗读方式">
                  {([{ value: "system", label: "系统朗读" }, { value: "cloud", label: "项目 TTS 渠道" }] as const).map(option => (
                    <label key={option.value}><input type="radio" name="agent-float-tts-provider" value={option.value} checked={agentSpeech.tts.provider === option.value}
                      onChange={() => setAgentSpeech({ ...agentSpeech, tts: { ...agentSpeech.tts, provider: option.value } })} /><span>{option.label}</span></label>
                  ))}
                </div></div>
                {agentSpeech.tts.provider === "cloud" && <div className="settings-agent-field"><span>渠道与模型</span><div className="settings-agent-field-content">
                  <GenerationSelector compact settings={data.settings} kind="tts" operation="tts" value={agentSpeech.tts}
                    onChange={next => setAgentSpeech({ ...agentSpeech, tts: { ...agentSpeech.tts, ...next, voice: "", speed: 1 } })} />
                  {!ttsChoice ? <div className="settings-agent-speech-notice" role="status"><p>{agentSpeech.tts.channel_id || agentSpeech.tts.model ? "所选 TTS 渠道或模型已不可用，请重新选择。" : "还没有可用的 TTS 渠道和模型。"}</p><Button size="small" type="text" onClick={() => selectCategory("tts")}>配置语音合成渠道</Button></div>
                    : !agentSpeech.tts.channel_id && !agentSpeech.tts.model && <p className="settings-agent-speech-hint">使用项目已保存的默认渠道和模型。</p>}
                </div></div>}
                <div className="settings-agent-voice-fields">
                  {agentSpeech.tts.provider === "cloud" ? <label><span>音色 ID</span><Input aria-label="TTS 音色 ID" value={agentSpeech.tts.voice} maxLength={256} disabled={!ttsChoice}
                    placeholder={ttsChoice?.capabilities.default_voice || "模型默认音色"} onChange={voice => setAgentSpeech({ ...agentSpeech, tts: { ...agentSpeech.tts, voice } })} /><small>留空使用模型默认音色。</small></label>
                    : <div><span>音色</span><p className="settings-agent-system-voice">系统默认中文音色</p></div>}
                  {(agentSpeech.tts.provider === "system" || ttsChoice?.capabilities.speed) ? <label><span>语速</span><InputNumber aria-label="TTS 语速" min={0.25} max={4} step={0.05} suffix="×" value={agentSpeech.tts.speed}
                    onChange={speed => setAgentSpeech({ ...agentSpeech, tts: { ...agentSpeech.tts, speed: Number(speed) } })} /><small>1× 为正常语速。</small></label>
                    : <div><span>语速</span><p className="settings-agent-system-voice">{ttsChoice ? "模型固定语速" : "选择模型后显示"}</p></div>}
                </div>
                <div className="settings-agent-switch-row"><div><strong>自动朗读 Agent 回复</strong><p>回复完成后播放，也可在浮标里手动朗读。</p></div><Switch aria-label="自动朗读 Agent 回复" checked={agentSpeech.autoRead} onChange={autoRead => setAgentSpeech({ ...agentSpeech, autoRead })} /></div>
                <div className="settings-agent-preview-row">
                  <Button type={previewActive ? "default" : "primary"} icon={previewActive ? <Square size={13} /> : <Volume2 size={15} />} aria-label={previewActive ? "停止试听" : "试听声音"} disabled={!previewActive && agentSpeech.tts.provider === "cloud" && !ttsChoice} onClick={() => {
                    if (previewActive) speechPreview.stop();
                    else if (category === "agent-float" && agentSection === "speech") void speechPreview.play("你好，我是你的创作助手。");
                  }}>{previewActive ? "停止试听" : "试听声音"}</Button>
                  <span role="status">{speechPreview.state === "loading" ? "正在生成试听…" : speechPreview.state === "speaking" ? "正在播放试听" : "先试听，确认渠道和音色可用。"}</span>
                </div>
                {speechPreview.error && <div className="settings-agent-preview-error" role="alert"><AlertCircle size={15} /><div><strong>试听未成功</strong><p>{speechPreview.error.replace(/朗读回复/g, "试听声音")}</p></div></div>}
              </div>
            </section>
          </div>
        </section>
        <section id="agent-settings-appearance" role="tabpanel" aria-labelledby="agent-settings-tab-appearance" className="settings-agent-subpanel" hidden={agentSection !== "appearance"}>
          <div className="settings-agent-section-intro"><h3>浮标与交互</h3><p>外观和操作习惯应用于本机的所有项目。</p></div>
          <div className="settings-agent-appearance-grid">
            <section className="settings-agent-preference-card" aria-label="浮标交互设置"><h4>交互方式</h4>
              <Form layout="vertical" className="settings-agent-float-form">
                <div className="settings-agent-switch-row"><div><strong>显示悬浮按钮</strong><p>在各个工作页面快速打开 Agent。</p></div><Switch aria-label="显示悬浮按钮" checked={agentFloat.visible} onChange={visible => onAgentFloatChange({ ...agentFloat, visible })} /></div>
                <Form.Item label="点击浮标时" extra="展开对话后，也可点击麦克风说话。"><div className="settings-agent-float-actions" role="radiogroup" aria-label="点击浮标时">
                  {([{ value: "panel", label: "展开对话" }, { value: "voice", label: "开始语音" }] as const).map(action => <label key={action.value}><input type="radio" name="agent-float-click-action" value={action.value} checked={agentFloat.clickAction === action.value} onChange={() => onAgentFloatChange({ ...agentFloat, clickAction: action.value })} /><span>{action.label}</span></label>)}
                </div></Form.Item>
                <div className="settings-agent-switch-row"><div><strong>语音识别后自动发送</strong><p>关闭时先校对文字，开启后说完即执行。</p></div><Switch aria-label="语音识别后自动发送" checked={agentFloat.speechAutoSend} onChange={speechAutoSend => onAgentFloatChange({ ...agentFloat, speechAutoSend })} /></div>
                <div className="settings-agent-switch-row"><div><strong>浮标位置</strong><p>拖动后自动贴边，位置保存在本机。</p></div><Button size="small" onClick={() => {
                  try { localStorage.removeItem("spielberg-agent-float-position"); } catch { /* Private browsing may disable persistence. */ }
                  window.dispatchEvent(new Event("spielberg-agent-float-reset-position"));
                }}>重置到右下角</Button></div>
              </Form>
            </section>
            <section className="settings-agent-preference-card" aria-label="浮标外观设置"><h4>外观</h4>
              <Form layout="vertical" className="settings-agent-float-form">
                <Form.Item label="按钮颜色"><div className="settings-agent-float-colors" role="radiogroup" aria-label="按钮颜色">
                  {(Object.keys(agentFloatColors) as AgentFloatPreferences["color"][]).map(color => <label key={color} className="settings-agent-float-color" data-color={color}><input type="radio" name="agent-float-color" value={color} checked={agentFloat.color === color} onChange={() => onAgentFloatChange({ ...agentFloat, color })} /><span className="settings-agent-float-swatch" aria-hidden="true"><Check size={16} /></span><span>{agentFloatColors[color]}</span></label>)}
                </div></Form.Item>
                <Form.Item label={`动态强度 · ${agentFloat.intensity}%`} extra="0% 为静态，100% 为默认强度。"><Slider aria-label="动态强度" min={0} max={200} step={5} value={agentFloat.intensity} onChange={intensity => onAgentFloatChange({ ...agentFloat, intensity: Number(intensity) })} /></Form.Item>
              </Form>
            </section>
          </div>
        </section>
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
