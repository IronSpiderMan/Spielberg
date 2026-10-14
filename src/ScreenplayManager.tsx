import { useEffect, useRef, useState } from "react";
import { Button, Empty, Input, Message, Modal, Select, Space, Tag } from "@arco-design/web-react";
import { Download, FileText, Plus, Save, Trash2 } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { post, type Media, type Screenplay, type Snapshot } from "./core";
import { confirmDiscard, useEditGuard } from "./edit-guard";
import { PageHeading } from "./ui";
import { newShot, parseShotCsv, serializeShotCsv, shotSizes, cameraMoves, type ScriptShot } from "./shot-script";
import { ShotPictureField } from "./components/ShotPictureField";
import { uploadAsset } from "./api";
import { isSupportedImage } from "./hooks/useImageUpload";
import "./screenplays.css";

type Draft = { format: "markdown" | "csv"; id?: number; title: string; content: string };
const template = "# 剧本标题\n\n## 第一场 · 内景 / 房间 / 夜\n\n窗外下着雨，桌上的台灯忽明忽暗。\n\n**林舟**\n> 你终于来了。\n\n**苏晓**\n> 我有一件事必须告诉你。\n\n---\n\n## 第二场 · 外景 / 街道 / 清晨\n\n";
const same = (a: Draft | null, b: Draft | null) => a?.id === b?.id && a?.title === b?.title && a?.content === b?.content && a?.format === b?.format;

export default function ScreenplayManager({ data, reload }: { data: Snapshot; reload: () => Promise<void> }) {
  const scripts = data.screenplays || [];
  const [draft, setDraft] = useState<Draft | null>(() => scripts[0] || null);
  const [saved, setSaved] = useState<Draft | null>(() => scripts[0] || null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const importer = useRef<HTMLInputElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const dirty = !same(draft, saved);
  let shots: ScriptShot[] = [], csvError = "";
  if (draft?.format === "csv") { try { shots = parseShotCsv(draft.content, false); } catch (error) { csvError = (error as Error).message; } }
  const editShots = (next: ScriptShot[]) => { if (draft) setDraft({ ...draft, content: serializeShotCsv(next) }); };
  const editShot = (index: number, change: Partial<ScriptShot>) => editShots(shots.map((shot, i) => i === index ? { ...shot, ...change } : shot));
  const uploadPicture = async (index: number, file: File) => {
    if (busyRef.current) return;
    if (!isSupportedImage(file)) { Message.warning("请选择 PNG、JPEG、WebP 或 GIF 图片"); return; }
    busyRef.current = true; setBusy(true);
    try {
      const media = await uploadAsset<Media>(data.project.id, file);
      editShot(index, { picture: media.path });
      Message.success("画面已上传为资产，请保存分镜头剧本");
      try { await reload(); } catch (error) { Message.error(`图片已上传，刷新资产失败：${String(error)}`); }
    } catch (error) { Message.error(`画面上传失败：${String(error)}`); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const importCsv = async (file: File) => {
    try {
      const content = await file.text();
      const shots = parseShotCsv(content);
      choose({ format: "csv", title: file.name.replace(/\.csv$/i, ""), content: serializeShotCsv(shots) });
    } catch (error) { Message.error(String(error)); }
  };
  useEditGuard(dirty || busy);

  // Background project polling must never replace an unsaved draft.
  useEffect(() => {
    if (dirty || busy || (draft && draft.id === undefined)) return;
    const current = scripts.find(item => item.id === draft?.id) || scripts[0] || null;
    if (!same(current, saved)) { setDraft(current); setSaved(current); }
  }, [data.screenplays, dirty, busy, draft, saved]);

  useEffect(() => {
    if (!dirty && !busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy]);

  const choose = (next: Draft | null) => {
    if (busyRef.current) return;
    const apply = () => { setDraft(next); setSaved(next?.id === undefined ? null : next); };
    if (dirty) confirmDiscard(apply); else apply();
  };
  const save = async () => {
    if (!draft || busyRef.current) return;
    if (!draft.title.trim()) { Message.warning("请输入剧本标题"); return; }
    if (draft.format === "csv") { try { parseShotCsv(draft.content); } catch (error) { Message.warning(String(error)); return; } }
    busyRef.current = true; setBusy(true);
    try {
      const result = await post<Screenplay>(draft.id === undefined ? "/screenplays" : "/screenplays/update", {
        project_id: data.project.id, ...draft, title: draft.title.trim(),
      });
      setDraft(result); setSaved(result);
      await reload();
      Message.success("剧本已保存");
    } catch (error) { Message.error(String(error)); }
    finally { busyRef.current = false; setBusy(false); }
  };
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault(); void save();
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  });

  const remove = () => {
    if (!draft || draft.id === undefined || busyRef.current) return;
    const id = draft.id;
    Modal.confirm({ title: "删除剧本？", content: `“${draft.title}”将被删除${dirty ? "，未保存的修改也会丢失" : ""}。`,
      okText: "删除", cancelText: "取消", okButtonProps: { status: "danger" },
      onOk: async () => {
        busyRef.current = true; setBusy(true);
        try {
          await post("/screenplays/delete", { project_id: data.project.id, id });
          const next = scripts.find(item => item.id !== id) || null;
          setDraft(next); setSaved(next);
          await reload(); Message.success("剧本已删除");
        } catch (error) { Message.error(String(error)); }
        finally { busyRef.current = false; setBusy(false); }
      },
    });
  };
  const insert = (prefix: string, suffix = "", fallback = "文字") => {
    if (!draft || !editor.current) return;
    const { selectionStart: start, selectionEnd: end } = editor.current;
    const text = draft.content.slice(start, end) || fallback;
    setDraft({ ...draft, content: draft.content.slice(0, start) + prefix + text + suffix + draft.content.slice(end) });
    requestAnimationFrame(() => { editor.current?.focus(); editor.current?.setSelectionRange(start + prefix.length, start + prefix.length + text.length); });
  };
  const exportMarkdown = () => {
    if (!draft) return;
    const csv = draft.format === "csv";
    if (csv) { try { parseShotCsv(draft.content); } catch (error) { Message.warning(String(error)); return; } }
    const url = URL.createObjectURL(new Blob([csv ? "\uFEFF" + draft.content.replace(/^\uFEFF/, "") : draft.content], { type: csv ? "text/csv;charset=utf-8" : "text/markdown;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url;
    link.download = `${(draft.title.trim() || "未命名剧本").replace(/[\\/:*?"<>|]/g, "_")}.${csv ? "csv" : "md"}`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return <section className="screenplay-page">
    <PageHeading title="剧本管理" description="编写 Markdown 故事剧本，或用 CSV 管理分镜头剧本。"
      actions={<Space><Button disabled={busy} onClick={() => importer.current?.click()}>导入 CSV</Button><Button disabled={busy} onClick={() => choose({ format: "csv", title: "", content: serializeShotCsv([]) })}>新建分镜头剧本</Button><Button type="primary" icon={<Plus size={16} />} disabled={busy} onClick={() => choose({ format: "markdown", title: "", content: "" })}>新建剧本</Button></Space>} />
    <input ref={importer} type="file" accept=".csv,text/csv" hidden aria-label="导入分镜头 CSV" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importCsv(file); }} />
    <div className="screenplay-workspace">
      <aside className="screenplay-library" aria-label="剧本列表">
        <div className="screenplay-library-head"><strong>项目剧本</strong><span>{scripts.length} 份</span></div>
        <Input.Search aria-label="搜索剧本" placeholder="搜索剧本标题" value={query} onChange={setQuery} allowClear />
        <div className="screenplay-list">
          {draft && draft.id === undefined && <div className="screenplay-new"><FileText size={16} />新剧本 · 尚未保存</div>}
          {scripts.filter(item => item.title.toLowerCase().includes(query.toLowerCase())).map(item =>
            <button type="button" key={item.id} className={`screenplay-item${draft?.id === item.id ? " selected" : ""}`}
              aria-pressed={draft?.id === item.id} disabled={busy} onClick={() => { if (draft?.id !== item.id) choose(item); }}>
              <FileText size={18} /><span><strong>{item.title}</strong><small>{item.format === "csv" ? "CSV 分镜头 · " : "Markdown · "}{item.content.replace(/[#*>`]/g, "").trim().slice(0, 45) || "空白剧本"}</small></span>
            </button>)}
          {!scripts.length && <p className="screenplay-list-empty">还没有剧本，开始写下第一个故事吧。</p>}
          {scripts.length > 0 && !scripts.some(item => item.title.toLowerCase().includes(query.toLowerCase())) && <p className="screenplay-list-empty">没有匹配的剧本</p>}
        </div>
      </aside>
      {draft ? <div className="screenplay-editor">
        <div className="screenplay-titlebar">
          <Input aria-label="剧本标题" placeholder="输入剧本标题" value={draft.title} disabled={busy} maxLength={200} onChange={title => setDraft({ ...draft, title })} />
          <Space><Tag color={dirty ? "orange" : "green"}>{dirty ? "未保存" : "已保存"}</Tag>
            <Button aria-label={draft.format === "csv" ? "导出 CSV" : "导出 Markdown"} title={draft.format === "csv" ? "导出 CSV" : "导出 Markdown"} icon={<Download size={16} />} onClick={exportMarkdown} />
            <Button aria-label="删除剧本" title="删除剧本" status="danger" disabled={busy || draft.id === undefined} icon={<Trash2 size={16} />} onClick={remove} />
            <Button type="primary" icon={<Save size={16} />} loading={busy} onClick={() => void save()}>保存</Button>
          </Space>
        </div>
        {draft.format === "csv" ? <>
          <div className="screenplay-formatbar"><Button disabled={busy || !!csvError} onClick={() => { let number = 1; while (shots.some(s => s.number === String(number))) number++; editShots([...shots, newShot(String(number))]); }}>添加镜头</Button><span>CSV · 画面可选 · Ctrl / ⌘ + S 保存</span></div>
          <div className="shot-script-table">{csvError ? <p role="alert">{csvError}</p> : <table><thead><tr>{["编号", "景别", "运镜", "画面（可选）", "描述", "操作"].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>
            {shots.map((shot, index) => <tr key={index}>
              <td><Input aria-label={`镜头 ${index + 1} 编号`} value={shot.number} disabled={busy} onChange={number => editShot(index, { number })} /></td>
              <td><Select aria-label={`镜头 ${index + 1} 景别`} value={shot.size} disabled={busy} onChange={size => editShot(index, { size })}>{shotSizes.map(size => <Select.Option key={size} value={size}>{size}</Select.Option>)}</Select></td>
              <td><Select aria-label={`镜头 ${index + 1} 运镜`} value={shot.camera} disabled={busy} onChange={camera => editShot(index, { camera })}>{cameraMoves.map(camera => <Select.Option key={camera} value={camera}>{camera}</Select.Option>)}</Select></td>
              <td><ShotPictureField picture={shot.picture} index={index} data={data} busy={busy} onChange={picture => editShot(index, { picture })} onUpload={file => uploadPicture(index, file)} /></td>
              <td><Input.TextArea aria-label={`镜头 ${index + 1} 描述`} value={shot.description} disabled={busy} onChange={description => editShot(index, { description })} /></td>
              <td><Button aria-label={`删除镜头 ${index + 1}`} status="danger" disabled={busy} icon={<Trash2 size={14} />} onClick={() => editShots(shots.filter((_, i) => i !== index))} /></td>
            </tr>)}
          </tbody></table>}{!csvError && !shots.length && <Empty description="添加镜头，开始编写分镜头剧本" />}</div>
        </> : <><div className="screenplay-formatbar">
          <Space size={4}>
            <Button size="small" disabled={busy} title="插入场景标题" onClick={() => insert("\n## ", "\n", "第一场 · 内景 / 房间 / 夜")}>标题</Button>
            <Button size="small" disabled={busy} title="加粗角色名" onClick={() => insert("**", "**", "角色名")}>粗体</Button>
            <Button size="small" disabled={busy} title="插入对白" onClick={() => insert("\n> ", "\n", "角色对白")}>对白</Button>
            <Button size="small" disabled={busy} onClick={() => insert("\n- ", "\n", "场景说明")}>列表</Button>
            {!draft.content && <Button size="small" disabled={busy} onClick={() => setDraft({ ...draft, content: template })}>使用剧本模板</Button>}
          </Space><span>Markdown · Ctrl / ⌘ + S 保存</span>
        </div>
        <div className="screenplay-panels">
          <div className="screenplay-source"><div className="screenplay-panel-label">Markdown 编辑</div>
            <textarea ref={editor} aria-label="Markdown 剧本内容" value={draft.content} disabled={busy} spellCheck={false}
              placeholder={"# 故事标题\n\n## 第一场 · 内景 / 夜\n\n场景描述…\n\n**角色名**\n> 角色对白…"}
              onChange={event => setDraft({ ...draft, content: event.target.value })} />
          </div>
          <div className="screenplay-preview"><div className="screenplay-panel-label">实时预览</div>
            <article className="screenplay-markdown" aria-label="剧本实时预览">
              {draft.content ? <Markdown remarkPlugins={[remarkGfm]} skipHtml
                components={{ a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>{draft.content}</Markdown>
                : <div className="screenplay-preview-empty"><FileText size={32} /><p>在左侧开始编写，预览会实时更新</p></div>}
            </article>
          </div>
        </div>
        <footer className="screenplay-footer"><span>{draft.content.replace(/\s/g, "").length} 字符 · {draft.content.split("\n").length} 行</span><span>支持标题、粗体、对白引用、列表和表格</span></footer></>}
      </div> : <div className="screenplay-empty"><Empty description="新建一份剧本，开始编写你的故事" /><Button type="primary" onClick={() => choose({ format: "markdown", title: "", content: "" })}>新建剧本</Button></div>}
    </div>
  </section>;
}
