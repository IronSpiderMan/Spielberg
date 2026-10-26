import { useEffect, useRef, useState } from "react";
import { Button, Empty, Input, Message, Modal, Spin, Switch, Tabs, Tag } from "@arco-design/web-react";
import { Download, FileText, FolderOpen, RefreshCw, Search, Trash2, Upload } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { post } from "./core";
import "./skills.css";

type Skill = {
  id: string; name: string; description: string; enabled: boolean; source: string;
  installed_at: string; updated_at: string; files_count: number;
};
type SkillDetail = Skill & { content: string; files: { path: string; size: number }[] };
type Installing = "github" | "file" | "folder" | null;
const MAX_FILES = 256;
const MAX_TOTAL = 10 * 1024 * 1024;
const MAX_ASSET = 2 * 1024 * 1024;
const MAX_SKILL = 32 * 1024;
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);
const byteSize = (size: number) => size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KiB` : `${(size / 1024 / 1024).toFixed(1)} MiB`;
const dateText = (value: string) => {
  const numeric = value.trim() !== "" && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;
  const date = new Date(Number.isFinite(numeric) ? numeric < 1e12 ? numeric * 1000 : numeric : value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
};
const markdownBody = (content: string) => content.replace(/^\uFEFF/, "").replace(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, "");
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = () => reject(new Error(`无法读取文件：${file.name}`));
    reader.onabort = () => reject(new Error(`文件读取已取消：${file.name}`));
    reader.readAsDataURL(file);
  });
}

export function SkillsSettings() {
  const [items, setItems] = useState<Skill[]>([]);
  const [directory, setDirectory] = useState("");
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [actionError, setActionError] = useState("");
  const [source, setSource] = useState("");
  const [query, setQuery] = useState("");
  const [installing, setInstalling] = useState<Installing>(null);
  const [busy, setBusy] = useState<{ id: string; action: "toggle" | "update" | "delete" } | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [removeTarget, setRemoveTarget] = useState<Skill | null>(null);
  const [removeError, setRemoveError] = useState("");
  const [reinstallTarget, setReinstallTarget] = useState<Skill | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const directoryInput = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<Skill | null>(null);
  const detailRequest = useRef(0);
  const locked = !!installing || !!busy;
  const loadSkills = async () => {
    setLoading(true);
    setListError("");
    try {
      const result = await post<{ items: Skill[]; directory: string }>("/skills/list");
      setItems(result.items); setDirectory(result.directory);
    } catch (error) { setListError(errorText(error)); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    directoryInput.current?.setAttribute("webkitdirectory", "");
    void loadSkills();
  }, []);
  const loadDetail = async (id: string) => {
    const request = ++detailRequest.current;
    setDetailId(id); setDetail(null); setDetailLoading(true); setDetailError("");
    try {
      const result = await post<SkillDetail>("/skills/detail", { id });
      if (request === detailRequest.current) setDetail(result);
    } catch (error) { if (request === detailRequest.current) setDetailError(errorText(error)); }
    finally { if (request === detailRequest.current) setDetailLoading(false); }
  };
  const installGithub = async () => {
    if (locked) return;
    setActionError("");
    let url: URL;
    try { url = new URL(source.trim()); } catch { setActionError("请输入完整的 GitHub 仓库或 Skill 文件夹链接。"); return; }
    const parts = url.pathname.split("/").filter(Boolean);
    if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || parts.length < 2 || (parts.length > 2 && (parts[2] !== "tree" || parts.length < 4))) {
      setActionError("请使用 https://github.com/作者/仓库 或仓库中的 /tree/分支/Skill目录 链接。"); return;
    }
    setInstalling("github");
    try {
      await post("/skills/install", { source: source.trim() });
      setSource(""); Message.success("Skill 已安装，可供所有项目使用"); await loadSkills();
    } catch (error) { setActionError(errorText(error)); }
    finally { setInstalling(null); }
  };
  const chooseFiles = (kind: "file" | "folder", target: Skill | null = null) => {
    uploadTarget.current = target;
    (kind === "file" ? fileInput : directoryInput).current?.click();
  };
  const installFiles = async (selected: FileList | null, kind: "file" | "folder", replace: Skill | null = null) => {
    if (!selected?.length || locked) return;
    setActionError(""); setInstalling(kind);
    try {
      const files = Array.from(selected);
      const paths = files.map(file => kind === "folder" ? file.webkitRelativePath || file.name : file.name);
      const top = paths[0].split("/")[0];
      const stripTop = kind === "folder" && paths.every(path => path.startsWith(`${top}/`));
      const entries = files.map((file, index) => ({ file, path: stripTop ? paths[index].slice(top.length + 1) : paths[index] }));
      if (!entries.some(entry => entry.path === "SKILL.md")) throw new Error("请选择名为 SKILL.md 的文件，或根目录包含 SKILL.md 的 Skill 文件夹。");
      if (entries.some(entry => entry.path.split("/").some(part => [".git", "node_modules"].includes(part)))) throw new Error("文件夹含有 .git 或 node_modules，请仅选择具体的 Skill 目录。");
      if (entries.length > MAX_FILES) throw new Error(`最多上传 ${MAX_FILES} 个文件，请仅选择具体的 Skill 目录。`);
      if (files.reduce((total, file) => total + file.size, 0) > MAX_TOTAL) throw new Error("文件总大小不能超过 10 MiB。");
      for (const entry of entries) {
        const limit = entry.path === "SKILL.md" ? MAX_SKILL : MAX_ASSET;
        if (entry.file.size > limit) throw new Error(`${entry.path} 超过大小限制（${entry.path === "SKILL.md" ? "32 KiB" : "2 MiB"}）。`);
      }
      const payload = await Promise.all(entries.map(async entry => ({ path: entry.path, content_base64: await toBase64(entry.file) })));
      await post("/skills/install", { files: payload, source_name: kind === "folder" ? top : "SKILL.md", ...(replace ? { replace_id: replace.id } : {}) });
      if (replace) setReinstallTarget(null);
      Message.success(replace ? "Skill 已重装，启用状态已保留" : "Skill 已安装，可供所有项目使用"); await loadSkills();
    } catch (error) { setActionError(errorText(error)); }
    finally { setInstalling(null); }
  };
  const changeSkill = async (skill: Skill, action: "toggle" | "update", enabled?: boolean) => {
    if (locked) return;
    setBusy({ id: skill.id, action }); setActionError("");
    try {
      await post(`/skills/${action}`, { id: skill.id, ...(action === "toggle" ? { enabled } : {}) });
      Message.success(action === "update" ? "Skill 已从 GitHub 更新" : enabled ? "Skill 已启用" : "Skill 已停用");
      await loadSkills();
      if (detailId === skill.id) await loadDetail(skill.id);
    } catch (error) { setActionError(errorText(error)); }
    finally { setBusy(null); }
  };
  const removeSkill = async () => {
    if (!removeTarget || locked) return;
    setBusy({ id: removeTarget.id, action: "delete" }); setRemoveError("");
    try {
      await post("/skills/delete", { id: removeTarget.id });
      if (detailId === removeTarget.id) { ++detailRequest.current; setDetailId(null); }
      setRemoveTarget(null); Message.success("Skill 已卸载"); await loadSkills();
    } catch (error) { setRemoveError(errorText(error)); }
    finally { setBusy(null); }
  };
  const filtered = items.filter(skill => `${skill.name} ${skill.description} ${skill.source}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="setting-block skills-settings" data-testid="skills-settings">
    <div className="setting-heading"><span className="setting-code">SKILLS</span><h3>Skills 技能</h3><p>安装与管理 Agent 的工作技能。全工作室共享，所有项目均可使用。</p></div>
    <div className="skills-body">
      <p className="skills-explanation">Agent 会根据任务按需读取已启用的 Skill 说明和参考文件。Skill 中的 Shell 脚本不会被执行。</p>
      <div className="skills-install-form">
        <label htmlFor="skills-source">从 GitHub 安装</label>
        <div className="skills-source-row"><Input id="skills-source" data-testid="skills-source" aria-label="GitHub Skill 链接" value={source} onChange={setSource} disabled={locked} placeholder="https://github.com/作者/仓库/tree/main/技能目录" onPressEnter={() => void installGithub()} />
          <Button type="primary" data-testid="skills-install" icon={<Download size={15} />} loading={installing === "github"} disabled={locked || !source.trim()} onClick={() => void installGithub()}>安装 GitHub Skill</Button></div>
        <div className="skills-upload-row"><Button icon={<Upload size={15} />} loading={installing === "file"} disabled={locked} onClick={() => chooseFiles("file")}>上传 SKILL.md</Button><Button icon={<FolderOpen size={15} />} loading={installing === "folder"} disabled={locked} onClick={() => chooseFiles("folder")}>上传文件夹</Button></div>
        <p className="skills-upload-help">文件夹根目录需包含 SKILL.md。最多 256 个文件、总计 10 MiB；SKILL.md 不超过 32 KiB，其他单个文件不超过 2 MiB。</p>
        <input ref={fileInput} className="skills-file-input" type="file" accept=".md,text/markdown,text/plain" data-testid="skills-file-input" aria-label="选择 SKILL.md 文件" onChange={event => { void installFiles(event.target.files, "file", uploadTarget.current); uploadTarget.current = null; event.target.value = ""; }} />
        <input ref={directoryInput} className="skills-file-input" type="file" multiple data-testid="skills-directory-input" aria-label="选择 Skill 文件夹" onChange={event => { void installFiles(event.target.files, "folder", uploadTarget.current); uploadTarget.current = null; event.target.value = ""; }} />
      </div>
      {actionError && <div className="skills-error" role="alert">{actionError}</div>}
      <div className="skills-list-heading"><strong>已安装技能 <span>{items.length}</span></strong><div className="skills-list-tools"><Input data-testid="skills-search" aria-label="搜索已安装技能" value={query} onChange={setQuery} allowClear placeholder="搜索名称、描述或来源" prefix={<Search size={14} />} /><Button aria-label="刷新技能列表" title="刷新技能列表" icon={<RefreshCw size={15} />} loading={loading} disabled={locked} onClick={() => void loadSkills()} /></div></div>
      {listError ? <div className="skills-error skills-load-error" role="alert"><div><strong>技能列表加载失败</strong><p>{listError}</p></div><Button onClick={() => void loadSkills()} loading={loading}>重新加载</Button></div> : <Spin loading={loading} style={{ display: "block" }}>
        {!filtered.length ? <Empty description={loading ? "正在读取技能…" : query.trim() ? "没有匹配的技能，试试其他关键词" : "还没有安装技能，通过 GitHub 链接或本地文件添加你的第一个 Skill"} /> : <div className="skills-list">{filtered.map(skill => <div className="skills-item" data-testid={`skill-row-${skill.id}`} key={skill.id}>
          <div className="skills-item-copy"><div className="skills-item-title"><FileText size={17} /><strong>{skill.name}</strong><Tag color={skill.enabled ? "green" : undefined}>{skill.enabled ? "已启用" : "已停用"}</Tag></div><p>{skill.description || "暂无描述"}</p><div className="skills-item-meta"><span title={skill.source}>{skill.source.startsWith("https://github.com/") ? "GitHub" : "本地上传"} · {skill.files_count} 个文件</span><span>更新于 {dateText(skill.updated_at)}</span></div></div>
          <div className="skills-item-actions"><label className="skills-toggle"><span>{skill.enabled ? "启用中" : "已停用"}</span><Switch size="small" checked={skill.enabled} loading={busy?.id === skill.id && busy.action === "toggle"} disabled={locked} aria-label={`${skill.name} 启用状态`} data-testid={`skill-toggle-${skill.id}`} onChange={enabled => void changeSkill(skill, "toggle", enabled)} /></label><div className="skills-item-buttons"><Button size="small" data-testid={`skill-detail-${skill.id}`} onClick={() => void loadDetail(skill.id)}>详情</Button>{skill.source.startsWith("https://github.com/") ? <Button size="small" data-testid={`skill-update-${skill.id}`} loading={busy?.id === skill.id && busy.action === "update"} disabled={locked} onClick={() => void changeSkill(skill, "update")}>更新</Button> : <Button size="small" data-testid={`skill-reinstall-${skill.id}`} disabled={locked} onClick={() => { setActionError(""); setReinstallTarget(skill); }}>重装</Button>}<Button size="small" status="danger" data-testid={`skill-delete-${skill.id}`} icon={<Trash2 size={13} />} disabled={locked} onClick={() => { setRemoveError(""); setRemoveTarget(skill); }}>卸载</Button></div></div>
        </div>)}</div>}
      </Spin>}
      {directory && <p className="skills-storage">技能存储位置：<code>{directory}</code></p>}
    </div>
    <Modal visible={detailId !== null} title={detail?.name || "Skill 详情"} data-testid="skill-detail" className="skills-detail-modal" style={{ width: "min(880px, 94vw)" }} footer={<Button onClick={() => { ++detailRequest.current; setDetailId(null); }}>关闭</Button>} onCancel={() => { ++detailRequest.current; setDetailId(null); }} unmountOnExit>
      {detailLoading ? <div className="skills-detail-loading"><Spin /><span>正在读取技能详情</span></div> : detailError ? <div className="skills-error" role="alert"><p>{detailError}</p><Button onClick={() => detailId && void loadDetail(detailId)}>重新加载</Button></div> : detail && <>
        <p className="skills-detail-description">{detail.description}</p><dl className="skills-detail-meta"><div><dt>状态</dt><dd>{detail.enabled ? "已启用" : "已停用"} · 所有项目共享</dd></div><div><dt>来源</dt><dd>{detail.source.startsWith("https://github.com/") ? <a href={detail.source} target="_blank" rel="noopener noreferrer">{detail.source}</a> : detail.source}</dd></div><div><dt>安装时间</dt><dd>{dateText(detail.installed_at)}</dd></div><div><dt>最近更新</dt><dd>{dateText(detail.updated_at)}</dd></div></dl>
        <Tabs defaultActiveTab="preview"><Tabs.TabPane key="preview" title="技能说明"><article className="skills-markdown"><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{ a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>{markdownBody(detail.content)}</Markdown></article></Tabs.TabPane><Tabs.TabPane key="source" title="SKILL.md 原文"><pre className="skills-source-preview">{detail.content}</pre></Tabs.TabPane></Tabs>
        <details className="skills-files" open><summary>文件列表（{detail.files.length}）</summary><ul>{detail.files.map(file => <li key={file.path}><code>{file.path}</code><span>{byteSize(file.size)}</span></li>)}</ul></details>
      </>}
    </Modal>
    <Modal visible={!!reinstallTarget} title={`重装 ${reinstallTarget?.name || "Skill"}`} data-testid="skill-reinstall-dialog" footer={null} closable={!installing} maskClosable={!installing} onCancel={() => !installing && setReinstallTarget(null)}>
      <p>选择更新后的 SKILL.md 或完整 Skill 文件夹，替换「{reinstallTarget?.name}」的所有文件。SKILL.md 前置信息中的 name 必须与现有技能一致，启用状态会保留。</p>
      <div className="skills-upload-row"><Button type="primary" data-testid="skills-reinstall-file" icon={<Upload size={15} />} disabled={locked} loading={installing === "file"} onClick={() => chooseFiles("file", reinstallTarget)}>选择 SKILL.md 重装</Button><Button data-testid="skills-reinstall-folder" icon={<FolderOpen size={15} />} disabled={locked} loading={installing === "folder"} onClick={() => chooseFiles("folder", reinstallTarget)}>选择文件夹重装</Button></div>
      {actionError && <div className="skills-error" role="alert">{actionError}</div>}
    </Modal>
    <Modal visible={!!removeTarget} title="卸载此 Skill？" okText="卸载" cancelText="取消" okButtonProps={{ status: "danger" }} confirmLoading={busy?.action === "delete"} closable={!busy} maskClosable={!busy} cancelButtonProps={{ disabled: !!busy }} onCancel={() => !busy && setRemoveTarget(null)} onOk={() => void removeSkill()}>
      <p>卸载「{removeTarget?.name}」后，所有项目的 Agent 将无法继续加载此技能。你可以随时重新安装。</p>{removeError && <div className="skills-error" role="alert">{removeError}</div>}
    </Modal>
  </div>;
}
