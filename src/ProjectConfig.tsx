import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Button, Input, Message } from "@arco-design/web-react";
import { BookOpen, Bot, Check, FileText, GitBranch, Plus, Save, Settings2, Trash2, Upload } from "lucide-react";
import { post, type Project, type ProjectDocument } from "./core";
import { useEditGuard } from "./edit-guard";
import { localId } from "./id";
import { ConfirmPopover } from "./components/ConfirmAction";
import { MarkdownEditor } from "./components/MarkdownEditor";
import ProjectTimelineEditor from "./components/ProjectTimelineEditor";
import "./project-config.css";

const draftOf = (project: Project) => ({
  name: project.name, outline: project.outline || "", agents_md: project.agents_md || "",
  documents: project.documents || [], timelines: project.timelines || [],
});
const sections = [
  { id: "general", label: "基本设置", icon: Settings2 },
  { id: "timelines", label: "时间线", icon: GitBranch },
  { id: "documents", label: "项目文档", icon: FileText },
  { id: "agents", label: "Agent 规范", icon: Bot },
] as const;
type Section = typeof sections[number]["id"];

export default function ProjectConfig({ project, reload }: { project: Project; reload: () => Promise<void> }) {
  const [draft, setDraft] = useState(() => draftOf(project));
  const [saved, setSaved] = useState(() => JSON.stringify(draftOf(project)));
  const [section, setSection] = useState<Section>("general");
  const [revealTimeline, setRevealTimeline] = useState<{ id: string }>();
  const [selected, setSelected] = useState<string | null>(() => project.documents?.[0]?.id || null);
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const dirty = JSON.stringify(draft) !== saved;
  const disabled = busy || importing;
  useEditGuard(dirty || disabled);
  useEffect(() => {
    if (!dirty && !disabled) {
      const next = draftOf(project);
      setDraft(next); setSaved(JSON.stringify(next));
    }
  }, [project]);
  useEffect(() => {
    if (!dirty && !disabled) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, disabled]);
  // A refreshed or deleted document always falls back to an available document.
  const current = draft.documents.find(doc => doc.id === selected) || draft.documents[0];
  const updateDoc = (patch: Partial<ProjectDocument>) => setDraft(value => ({ ...value, documents: value.documents.map(doc => doc.id === current?.id ? { ...doc, ...patch } : doc) }));
  const addDoc = (title = "未命名文档", content = "") => {
    const id = localId();
    setDraft(value => ({ ...value, documents: [...value.documents, { id, title, content }] }));
    setSelected(id);
  };
  const save = async () => {
    if (disabled) return;
    if (!draft.name.trim()) { setSection("general"); return Message.warning("请输入项目名称"); }
    const untitled = draft.documents.find(doc => !doc.title.trim());
    if (untitled) { setSection("documents"); setSelected(untitled.id); return Message.warning("请为每份文档填写标题"); }
    for (const timeline of draft.timelines) {
      let error = !timeline.title.trim() ? "请为每条时间线填写名称" : "";
      for (const [index, entry] of timeline.entries.entries()) {
        if (error) break;
        const location = `「${timeline.title.trim()}」第 ${index + 1} 个时间点`;
        if (!entry.time.trim()) error = `${location}：请填写时间`;
        else if (!entry.events.length) error = `${location}：请添加至少一个事件，或删除这个时间点`;
        else if (entry.events.some(event => !event.content.trim())) error = `${location}：请填写事件内容`;
      }
      if (error) { setSection("timelines"); setRevealTimeline({ id: timeline.id }); return Message.warning(error); }
    }
    setBusy(true);
    try {
      const next = {
        ...draft, name: draft.name.trim(),
        documents: draft.documents.map(doc => ({ ...doc, title: doc.title.trim() })),
        timelines: draft.timelines.map(timeline => ({ ...timeline, title: timeline.title.trim(), description: timeline.description.trim(),
          entries: timeline.entries.map(entry => ({ ...entry, time: entry.time.trim(), events: entry.events.map(event => ({ ...event, content: event.content.trim() })) })),
        })),
      };
      await post("/projects/update", { id: project.id, ...next });
      setDraft(next); setSaved(JSON.stringify(next));
      Message.success("项目配置已保存");
      try { await reload(); } catch (error) { Message.error(`配置已保存，但刷新失败：${String(error)}`); }
    } catch (error) { Message.error(String(error)); }
    finally { setBusy(false); }
  };
  const importDoc = async (file: File) => {
    if (disabled) return;
    if (!/\.(md|txt|markdown)$/i.test(file.name)) return Message.warning("请选择 Markdown 或 TXT 文档");
    if (file.size > 2 * 1024 * 1024) return Message.warning("单份文档不能超过 2 MB");
    setImporting(true);
    try { addDoc(file.name.replace(/\.(md|txt|markdown)$/i, ""), await file.text()); }
    catch (error) { Message.error(`导入失败：${String(error)}`); }
    finally { setImporting(false); }
  };
  const exportDoc = () => {
    if (!current) return;
    const url = URL.createObjectURL(new Blob([current.content], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `${current.title.replace(/[\\/:*?"<>|]/g, "_") || "文档"}.md`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const navigateTabs = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const target = event.key === "ArrowRight" ? (index + 1) % sections.length : event.key === "ArrowLeft" ? (index + sections.length - 1) % sections.length : event.key === "Home" ? 0 : event.key === "End" ? sections.length - 1 : null;
    if (target === null) return;
    event.preventDefault(); setSection(sections[target].id);
    tabs.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[target]?.focus();
  };
  const eventCount = draft.timelines.reduce((total, timeline) => total + timeline.entries.reduce((count, entry) => count + entry.events.length, 0), 0);

  return <div className="project-config-page">
    <header className="project-config-heading">
      <div><h1>项目配置</h1><p>维护故事设定、时间线与创作资料。</p></div>
      <div className="project-config-save">
        <span role="status" className={`project-config-status${dirty ? " is-dirty" : ""}`}>{dirty ? <><i />未保存的修改</> : <><Check size={14} />已保存</>}</span>
        <Button type="primary" icon={<Save size={16} />} loading={busy} disabled={!dirty || importing} onClick={() => void save()}>保存配置</Button>
      </div>
    </header>
    <div className="project-config-workspace">
      <div className="project-config-tabs" role="tablist" aria-label="项目配置分区" ref={tabs}>
        {sections.map(({ id, label, icon: Icon }, index) => <button key={id} type="button" role="tab" id={`project-config-tab-${id}`} aria-label={label} aria-controls={`project-config-panel-${id}`} aria-selected={section === id} tabIndex={section === id ? 0 : -1} onClick={() => setSection(id)} onKeyDown={event => navigateTabs(event, index)}>
          <Icon size={16} /><span>{label}</span>{(id === "documents" || id === "timelines") && <small>{draft[id].length}</small>}
        </button>)}
      </div>
      <section className="project-config-panel project-config-general" role="tabpanel" id="project-config-panel-general" aria-labelledby="project-config-tab-general" hidden={section !== "general"}>
        <div className="project-config-identity">
          <div className="project-config-name"><label htmlFor="project-config-name">项目名称 <span>*</span></label><Input id="project-config-name" aria-label="项目名称" disabled={disabled} value={draft.name} maxLength={100} showWordLimit onChange={name => setDraft(value => ({ ...value, name }))} placeholder="为你的故事起个名字" /></div>
          <div className="project-config-summary" aria-label="项目资料概览"><button type="button" onClick={() => setSection("timelines")}><strong>{draft.timelines.length}</strong><span>时间线</span></button><div><strong>{eventCount}</strong><span>故事事件</span></div><button type="button" onClick={() => setSection("documents")}><strong>{draft.documents.length}</strong><span>项目文档</span></button></div>
        </div>
        <div className="project-config-section-heading"><div><h2><BookOpen size={18} />故事大纲</h2><p>记录故事背景、主线、关键转折与结局，让创作始终围绕同一个方向。</p></div><span className="project-config-word-count">{draft.outline.replace(/\s/g, "").length} 字</span></div>
        <Input.TextArea className="project-config-writing" aria-label="项目大纲" disabled={disabled} value={draft.outline} onChange={outline => setDraft(value => ({ ...value, outline }))} placeholder={"故事从哪里开始？\n\n主角想要什么，又将面对什么？\n\n写下主线、关键转折与结局……"} />
      </section>
      <section className="project-config-panel project-config-timelines" role="tabpanel" id="project-config-panel-timelines" aria-labelledby="project-config-tab-timelines" hidden={section !== "timelines"}>
        <ProjectTimelineEditor timelines={draft.timelines} onChange={timelines => setDraft(value => ({ ...value, timelines }))} disabled={disabled} revealTimeline={revealTimeline} />
      </section>
      <section className="project-config-panel project-config-documents" role="tabpanel" id="project-config-panel-documents" aria-labelledby="project-config-tab-documents" hidden={section !== "documents"}>
        <input ref={input} type="file" hidden accept=".md,.markdown,.txt" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importDoc(file); }} />
        <div className="project-config-section-heading"><div><h2>项目文档</h2><p>集中保存世界观、人物关系与创作笔记，支持 Markdown / TXT。</p></div><div className="project-config-actions"><Button disabled={disabled} loading={importing} icon={<Upload size={15} />} onClick={() => input.current?.click()}>导入文档</Button><Button disabled={disabled} icon={<Plus size={15} />} onClick={() => addDoc()}>新建文档</Button></div></div>
        {current ? <div className="project-document-layout">
          <nav aria-label="项目文档列表">{draft.documents.map(doc => <button type="button" key={doc.id} aria-pressed={current.id === doc.id} onClick={() => setSelected(doc.id)}><FileText size={16} /><span>{doc.title || "未命名文档"}</span></button>)}</nav>
          <div className="project-document-editor">
            <div className="project-document-title"><Input aria-label="文档标题" disabled={disabled} value={current.title} onChange={title => updateDoc({ title })} placeholder="文档标题" /><ConfirmPopover title="删除这份项目文档？" content={`「${current.title || "未命名文档"}」将从项目文档中移除，保存配置后生效。`} okText="删除文档" onOk={() => { if (disabled) return; setDraft(value => ({ ...value, documents: value.documents.filter(doc => doc.id !== current.id) })); setSelected(null); }}><Button type="text" status="danger" icon={<Trash2 size={16} />} aria-label="删除文档" disabled={disabled} /></ConfirmPopover></div>
            <div className="screenplay-workspace"><div className="screenplay-editor"><MarkdownEditor key={current.id} value={current.content} onChange={content => updateDoc({ content })} disabled={disabled} onExport={exportDoc} label="文档正文" /></div></div>
          </div>
        </div> : <div className="project-config-empty"><span><FileText size={28} /></span><h3>给故事一个资料库</h3><p>从一份世界观设定、人物小传或创作笔记开始。</p><Button disabled={disabled} icon={<Plus size={15} />} onClick={() => addDoc()}>创建第一份文档</Button></div>}
      </section>
      <section className="project-config-panel project-config-agents" role="tabpanel" id="project-config-panel-agents" aria-labelledby="project-config-tab-agents" hidden={section !== "agents"}>
        <div className="project-config-section-heading"><div><h2><Bot size={18} />Agent 规范 <code>AGENTS.md</code></h2><p>项目 Agent 每次执行都会读取这里的指令，保存后生效。</p></div></div>
        <div className="project-config-agent-note">可以约定创作规范、工作流程与输出要求，例如：保持人物设定一致；剧本使用中文；完成后汇报修改内容。</div>
        <Input.TextArea className="project-config-writing project-config-code" aria-label="AGENTS.md" disabled={disabled} value={draft.agents_md} onChange={agents_md => setDraft(value => ({ ...value, agents_md }))} placeholder={"# 创作规范\n\n# 工作流程\n\n# 输出要求"} />
      </section>
    </div>
  </div>;
}
