import { useEffect, useRef, useState } from "react";
import { Button, Card, Empty, Form, Input, Message, Popconfirm, Space, Tag } from "@arco-design/web-react";
import { FileText, Plus, Save, Upload } from "lucide-react";
import { post, type Project, type ProjectDocument } from "./core";
import { useEditGuard } from "./edit-guard";
import "./project-config.css";
import { MarkdownEditor } from "./components/MarkdownEditor";

const draftOf = (project: Project) => ({ name: project.name, outline: project.outline || "", documents: project.documents || [] });
export default function ProjectConfig({ project, reload }: { project: Project; reload: () => Promise<void> }) {
  const [draft, setDraft] = useState(() => draftOf(project));
  const [saved, setSaved] = useState(() => JSON.stringify(draftOf(project)));
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const dirty = JSON.stringify(draft) !== saved;
  useEditGuard(dirty || busy);
  useEffect(() => {
    if (!dirty && !busy) {
      const next = draftOf(project);
      setDraft(next); setSaved(JSON.stringify(next));
    }
  }, [project]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const current = draft.documents.find(doc => doc.id === selected);
  const updateDoc = (patch: Partial<ProjectDocument>) => setDraft(value => ({ ...value, documents: value.documents.map(doc => doc.id === selected ? { ...doc, ...patch } : doc) }));
  const addDoc = (title = "未命名文档", content = "") => {
    const id = crypto.randomUUID();
    setDraft(value => ({ ...value, documents: [...value.documents, { id, title, content }] }));
    setSelected(id);
  };
  const save = async () => {
    if (busy) return;
    if (!draft.name.trim()) return Message.warning("请输入项目名称");
    if (draft.documents.some(doc => !doc.title.trim())) return Message.warning("请为每份文档填写标题");
    setBusy(true);
    try {
      const next = { ...draft, name: draft.name.trim(), documents: draft.documents.map(doc => ({ ...doc, title: doc.title.trim() })) };
      await post("/projects/update", { id: project.id, ...next });
      setDraft(next); setSaved(JSON.stringify(next));
      Message.success("项目配置已保存");
      try { await reload(); } catch (error) { Message.error(`配置已保存，但刷新失败：${String(error)}`); }
    } catch (error) { Message.error(String(error)); }
    finally { setBusy(false); }
  };
  const importDoc = async (file: File) => {
    if (!/\.(md|txt|markdown)$/i.test(file.name)) return Message.warning("请选择 Markdown 或 TXT 文档");
    if (file.size > 2 * 1024 * 1024) return Message.warning("单份文档不能超过 2 MB");
    try { addDoc(file.name.replace(/\.(md|txt|markdown)$/i, ""), await file.text()); }
    catch (error) { Message.error(`导入失败：${String(error)}`); }
  };
  const exportDoc = () => {
    if (!current) return;
    const url = URL.createObjectURL(new Blob([current.content], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `${current.title.replace(/[\\/:*?"<>|]/g, "_") || "文档"}.md`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div className="project-config-page">
    <div className="project-config-heading"><div><h1>项目配置</h1><p>从故事大纲到创作资料，整理这个项目的共同设定。</p></div><Space>{dirty && <Tag color="orange">未保存</Tag>}<Button type="primary" icon={<Save size={16} />} loading={busy} onClick={() => void save()}>保存配置</Button></Space></div>
    <Card className="project-config-info" title="基本信息"><Form layout="vertical" disabled={busy}><Form.Item label="项目名称" required><Input aria-label="项目名称" value={draft.name} maxLength={100} onChange={name => setDraft(value => ({ ...value, name }))} /></Form.Item></Form></Card>
    <Card className="project-config-outline" title="故事大纲"><Input.TextArea aria-label="项目大纲" disabled={busy} value={draft.outline} onChange={outline => setDraft(value => ({ ...value, outline }))} placeholder="记录故事背景、主线、关键转折与结局……" /></Card>
    <Card className="project-config-documents" title="项目文档" extra={<Space><Button disabled={busy} icon={<Upload size={15} />} onClick={() => input.current?.click()}>导入文档</Button><Button disabled={busy} icon={<Plus size={15} />} onClick={() => addDoc()}>新建文档</Button></Space>}>
      <input ref={input} type="file" hidden accept=".md,.markdown,.txt" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importDoc(file); }} />
      <p className="helper">保存世界观、人物关系与创作笔记。支持导入 Markdown / TXT，修改后点击「保存配置」。</p>
      {draft.documents.length ? <div className="project-document-layout"><nav aria-label="项目文档列表">{draft.documents.map(doc => <button type="button" key={doc.id} aria-pressed={selected === doc.id} onClick={() => setSelected(doc.id)}><FileText size={16} /><span>{doc.title || "未命名文档"}</span></button>)}</nav>
        <div className="project-document-editor">{current ? <><Form layout="vertical" disabled={busy}><Form.Item label="文档标题" required><Input aria-label="文档标题" value={current.title} onChange={title => updateDoc({ title })} /></Form.Item></Form><div className="screenplay-workspace"><div className="screenplay-editor"><MarkdownEditor key={current.id} value={current.content} onChange={content => updateDoc({ content })} disabled={busy} onExport={exportDoc} label="文档正文" /></div></div><Space><Popconfirm title="删除这份项目文档？保存配置后生效。" onOk={() => { setDraft(value => ({ ...value, documents: value.documents.filter(doc => doc.id !== selected) })); setSelected(null); }}><Button status="danger" disabled={busy}>删除文档</Button></Popconfirm></Space></> : <Empty description="选择一份文档开始编辑" />}</div>
      </div> : <Empty description="还没有项目文档，创建一份世界观或创作笔记吧" />}
    </Card>
  </div>;
}
