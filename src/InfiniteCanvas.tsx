import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button, Form, Input, Message, Modal, Select } from "@arco-design/web-react";
import { Plus, Save, Undo2, Redo2, Maximize, Download, StickyNote, Trash2, ArrowLeft, Image, Film, Music, Upload } from "lucide-react";
import { defaultGenerationSize, normalizeGenerationSize, imageUrl, post, type Media, type Scene, type Snapshot } from "./core";
import { uploadAsset } from "./api";
import { buildVideoRequest } from "./generation-request";
import { resolvePrompt } from "./resolve-prompt";
import { MediaSizeFields, VideoDurationField } from "./components/generation/GenerationFields";
import AssetThumbnail from "./AssetThumbnail";
import { confirmDiscard, useEditGuard } from "./edit-guard";
import "./infinite-canvas.css";

type MediaKind = "image" | "audio" | "video";
type Kind = MediaKind | "note" | "scene" | "role" | "media" | "prompt";
type Node = { id: string; kind: Kind; ref_id?: number; text?: string; prompt?: string; duration?: number; ratio?: string; size?: string; x: number; y: number };
type Edge = { id: string; from: string; to: string };
type Draft = { version: 1; nodes: Node[]; edges: Edge[]; viewport: { x: number; y: number; zoom: number } };
type Board = { draft: Draft; revision: number };
const empty = (): Draft => ({ version: 1, nodes: [], edges: [], viewport: { x: 80, y: 80, zoom: 1 } });
function normalizeDraftSizes(draft: Draft): Draft {
  return { ...draft, nodes: draft.nodes.map(node => {
    if (node.kind !== "image" && node.kind !== "video") return node;
    const ratio = node.ratio || "16:9";
    return { ...node, ratio, size: normalizeGenerationSize(ratio, node.size) };
  }) };
}
const labels: Record<Kind, string> = { image: "图片", audio: "音频", video: "视频", scene: "场景", role: "角色", media: "素材", prompt: "Prompt", note: "便签" };
const mediaKind = (kind: Kind): kind is MediaKind => ["image", "video", "audio"].includes(kind);
const uid = () => crypto.randomUUID();
const clamp = (n: number) => Math.max(.2, Math.min(2, n));
const WIDTH = 300;
export default function InfiniteCanvas({ data, scene, reload, onClose }: {
  data: Snapshot; scene: Scene; reload: () => Promise<void>; onClose: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(empty), [saved, setSaved] = useState("");
  const [title, setTitle] = useState(scene.title), [savedTitle, setSavedTitle] = useState(scene.title);
  const [revision, setRevision] = useState(0), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState("");
  const [past, setPast] = useState<Draft[]>([]), [future, setFuture] = useState<Draft[]>([]);
  const [linkPoint, setLinkPoint] = useState<{ x: number; y: number } | null>(null);
  const linkDrag = useRef<{ x: number; y: number } | null>(null);
  const [selected, setSelected] = useState(""), [linkFrom, setLinkFrom] = useState("");
  const [linkTo, setLinkTo] = useState("");
  const [imageEditor, setImageEditor] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; worldX: number; worldY: number; from?: string; to?: string } | null>(null);
  const [picker, setPicker] = useState<Node | null>(null), [search, setSearch] = useState("");
  const [assets, setAssets] = useState<Media[]>([]), [assetPage, setAssetPage] = useState(1), [assetTotal, setAssetTotal] = useState(0), [assetLoading, setAssetLoading] = useState(false);
  const [localMedia, setLocalMedia] = useState<Media[]>([]), [busyNode, setBusyNode] = useState("");
  const stage = useRef<HTMLDivElement>(null), current = useRef(draft), fileInput = useRef<HTMLInputElement>(null), busy = useRef(false);
  current.current = draft;
  const available = [...data.media, ...localMedia.filter(m => !data.media.some(item => item.id === m.id))];
  const drag = useRef<{ pointer: number; x: number; y: number; before: Draft; node?: string }>();
  const dirty = !!saved && (JSON.stringify(draft) !== saved || title !== savedTitle);
  useEditGuard(dirty || !!busyNode);
  const payload = { project_id: data.project.id, scene_id: scene.id };
  const load = async () => {
    setLoading(true); setError("");
    try {
      const b = await post<Board>("/canvas/load", payload);
      const loaded = normalizeDraftSizes(b.draft);
      current.current = loaded; setDraft(loaded); setSaved(JSON.stringify(b.draft)); setRevision(b.revision); setPast([]); setFuture([]); setSelected(""); setLinkFrom(""); setLinkTo(""); setLinkPoint(null);
      setTitle(scene.title); setSavedTitle(scene.title);
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [data.project.id, scene.id]);
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => { if (dirty || busyNode) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", unload); return () => window.removeEventListener("beforeunload", unload);
  }, [dirty, busyNode]);
  useEffect(() => {
    if (!picker || !mediaKind(picker.kind)) return;
    let alive = true; setAssetLoading(true);
    void post<{ items: Media[]; total: number }>("/media/list", { project_id: data.project.id, kind: picker.kind, query: search, page: assetPage, limit: 24, usage: "all" })
      .then(result => { if (alive) { setAssets(result.items); setAssetTotal(result.total); } }).catch(e => { if (alive) Message.error(String(e)); }).finally(() => { if (alive) setAssetLoading(false); });
    return () => { alive = false; };
  }, [picker?.id, search, assetPage, data.project.id, data.revisions?.media]);
  const commit = (next: Draft) => {
    if (JSON.stringify(next) === JSON.stringify(current.current)) return;
    setPast(p => [...p.slice(-49), current.current]); setFuture([]); current.current = next; setDraft(next);
  };
  const patch = (id: string, changes: Partial<Node>) => commit({ ...current.current, nodes: current.current.nodes.map(n => n.id === id ? { ...n, ...changes } : n) });
  const undo = () => { const prev = past[past.length - 1]; if (!prev) return; setFuture(f => [current.current, ...f]); setPast(p => p.slice(0, -1)); setDraft(prev); setSelected(""); setLinkFrom(""); setLinkTo(""); setLinkPoint(null); };
  const redo = () => { const next = future[0]; if (!next) return; setPast(p => [...p, current.current]); setFuture(f => f.slice(1)); setDraft(next); setSelected(""); setLinkFrom(""); setLinkTo(""); setLinkPoint(null); };
  const save = async () => {
    if (saving || loading || error || drag.current || busy.current) return;
    if (!title.trim()) return void Message.warning("请填写场景名称");
    const value = current.current; setSaving(true);
    try {
      const b = await post<Board>("/canvas/save", { ...payload, draft: value, revision });
      setRevision(b.revision); setSaved(JSON.stringify(value));
      if (title !== savedTitle) { await post("/scenes/update", { project_id: data.project.id, id: scene.id, title: title.trim() }); setTitle(title.trim()); setSavedTitle(title.trim()); await reload(); }
      Message.success("画布场景已保存");
    } catch (e) { Message.error(String(e)); } finally { setSaving(false); }
  };
  const zoomAt = (zoom: number, x: number, y: number) => {
    const d = current.current, v = d.viewport, z = clamp(zoom);
    setDraft({ ...d, viewport: { x: x - (x - v.x) * z / v.zoom, y: y - (y - v.y) * z / v.zoom, zoom: z } });
  };
  useEffect(() => {
    const el = stage.current; if (!el || loading || error) return;
    const wheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest("textarea,input,select,.ic-context-menu")) return;
      e.preventDefault(); setMenu(null); const r = el.getBoundingClientRect(), d = current.current;
      if (e.ctrlKey || e.metaKey) zoomAt(d.viewport.zoom * Math.exp(-e.deltaY * .01), e.clientX - r.left, e.clientY - r.top);
      else setDraft({ ...d, viewport: { ...d.viewport, x: d.viewport.x - e.deltaX, y: d.viewport.y - e.deltaY } });
    };
    el.addEventListener("wheel", wheel, { passive: false }); return () => el.removeEventListener("wheel", wheel);
  }, [loading, error]);
  const add = (kind: Kind) => {
    if (busy.current) return;
    if (draft.nodes.length >= 500) return void Message.warning("每张画布最多 500 个节点");
    const v = draft.viewport;
    const position = menu ? { x: menu.worldX, y: menu.worldY } : { x: ((stage.current?.clientWidth || 800) / 2 - v.x) / v.zoom - WIDTH / 2, y: ((stage.current?.clientHeight || 600) / 2 - v.y) / v.zoom - 130 };
    while (draft.nodes.some(n => Math.abs(n.x - position.x) < 30 && Math.abs(n.y - position.y) < 30)) { position.x += 40; position.y += 40; }
    const node: Node = { id: uid(), kind, ...position, ...(kind === "note" ? { text: "" } : (kind === "video" || kind === "image") ? { prompt: "", duration: 5, ratio: "16:9", size: defaultGenerationSize("16:9") } : {}) };
    const edge = menu?.to ? { id: uid(), from: node.id, to: menu.to } : menu?.from ? { id: uid(), from: menu.from, to: node.id } : null;
    if (edge && draft.edges.length >= 1000) return void Message.warning("最多 1000 条连线");
    commit({ ...draft, nodes: [...draft.nodes, node], edges: edge ? [...draft.edges, edge] : draft.edges }); setSelected(node.id); setMenu(null); setLinkFrom(""); setLinkTo(""); setLinkPoint(null);
  };
  const fit = () => {
    const nodes = draft.nodes;
    if (!nodes.length) { setDraft({ ...draft, viewport: empty().viewport }); return; }
    const minX = Math.min(...nodes.map(n => n.x)), minY = Math.min(...nodes.map(n => n.y));
    const width = Math.max(...nodes.map(n => n.x)) - minX + WIDTH, height = Math.max(...nodes.map(n => n.y + (n.kind === "video" ? 580 : 300))) - minY;
    const w = stage.current?.clientWidth || 800, h = stage.current?.clientHeight || 600, zoom = clamp(Math.min((w - 80) / width, (h - 80) / height, 1));
    setDraft({ ...current.current, viewport: { x: (w - width * zoom) / 2 - minX * zoom, y: (h - height * zoom) / 2 - minY * zoom, zoom } });
  };
  const describe = (node: Node) => {
    if (mediaKind(node.kind) || node.kind === "media") {
      const media = available.find(m => m.id === node.ref_id);
      return { title: media?.name || `${labels[node.kind]}节点`, text: media ? `已选择${labels[node.kind]}素材` : node.ref_id ? "素材已移除，请替换素材" : "选择已有素材或上传文件", media };
    }
    const original = node.kind === "scene" ? data.episodes.flatMap(e => e.scenes).find(s => s.id === node.ref_id) : node.kind === "role" ? data.roles.find(r => r.id === node.ref_id) : data.prompts.find(p => p.id === node.ref_id);
    return { title: node.kind === "note" ? "创作便签" : original ? ("title" in original ? original.title : original.name) : `${labels[node.kind]}已移除`, text: node.text || (original ? ("description" in original ? original.description : original.content) : "") };
  };
  const remove = () => { if (busy.current) return; commit({ ...draft, nodes: draft.nodes.filter(n => n.id !== selected), edges: draft.edges.filter(e => e.from !== selected && e.to !== selected && e.id !== selected) }); setSelected(""); setLinkFrom(""); setLinkTo(""); setLinkPoint(null); };
  const start = (e: ReactPointerEvent, node?: string) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button,textarea,input,a,select,.arco-select")) return;
    if (node && busy.current) return;
    e.preventDefault(); e.stopPropagation(); stage.current?.focus(); setMenu(null); setLinkFrom(""); setLinkTo(""); setLinkPoint(null);
    if (node) setSelected(node); else setSelected("");
    drag.current = { pointer: e.pointerId, x: e.clientX, y: e.clientY, before: current.current, node };
    stage.current?.setPointerCapture(e.pointerId);
  };
  const finish = () => {
    const d = drag.current; drag.current = undefined;
    if (d?.node && JSON.stringify(d.before.nodes) !== JSON.stringify(current.current.nodes)) { setPast(p => [...p.slice(-49), d.before]); setFuture([]); }
  };
  const compatible = (from: Node, to: Node) => to.kind === "video" ? mediaKind(from.kind) || from.kind === "note" : to.kind === "image" && (from.kind === "image" || from.kind === "note");
  const connect = (to: string, from = linkFrom) => {
    setLinkPoint(null);
    if (!from) return;
    const source = draft.nodes.find(n => n.id === from), target = draft.nodes.find(n => n.id === to);
    if (!source || !target || !compatible(source, target)) return void Message.warning("图片输入仅支持图片或便签，视频输入支持素材或便签");
    if (from === to) return void Message.warning("节点不能连接到自己");
    if (draft.edges.some(e => e.from === from && e.to === to)) { setLinkFrom(""); setLinkTo(""); return; }
    const seen = new Set<string>();
    const reaches = (id: string): boolean => { if (id === from) return true; if (seen.has(id)) return false; seen.add(id); return draft.edges.filter(e => e.from === id).some(e => reaches(e.to)); };
    if (reaches(to)) return void Message.warning("连接不能形成循环");
    if (draft.edges.length >= 1000) return void Message.warning("最多 1000 条连线");
    commit({ ...draft, edges: [...draft.edges, { id: uid(), from: from, to }] }); setLinkFrom(""); setLinkTo("");
  };
  const openPicker = (node: Node) => { setPicker(node); setSearch(""); setAssetPage(1); setAssets([]); };
  const assign = (media: Media) => {
    if (!picker || media.kind !== picker.kind) return void Message.warning("素材类型与节点不符");
    setLocalMedia(items => [...items.filter(m => m.id !== media.id), media]); patch(picker.id, { ref_id: media.id }); setPicker(null);
  };
  const upload = async (file: File) => {
    if (!picker || busy.current) return; busy.current = true; setBusyNode(picker.id);
    try { const media = await uploadAsset<Media>(data.project.id, file); assign(media); await reload(); }
    catch (e) { Message.error(String(e)); } finally { busy.current = false; setBusyNode(""); }
  };
  const generate = async (node: Node) => {
    if (busy.current) return;
    const incoming = draft.edges.filter(e => e.to === node.id).map(e => draft.nodes.find(n => n.id === e.from)!);
    const references = incoming.filter(n => mediaKind(n.kind)).map(n => available.find(m => m.id === n.ref_id));
    const prompt = [...incoming.filter(n => n.kind === "note").map(n => n.text || ""), node.prompt || ""].filter(Boolean).join("\n\n");
    if (node.ref_id && (draft.nodes.length >= 500 || draft.edges.length >= 1000)) return void Message.warning("画布节点或连线已达上限");
    if (references.some(m => !m)) return void Message.warning("请先为所有上游节点选择素材或生成视频");
    if (!prompt.trim()) return void Message.warning("请填写画面描述");
    const imageIds = [...new Set([...references.filter(m => m?.kind === "image").map(m => m!.id), ...(node.kind === "image" && node.ref_id ? [node.ref_id] : [])])];
    let request: object;
    try {
      request = node.kind === "image" ? { operation: imageIds.length ? "i2i" : "t2i", prompt: resolvePrompt(prompt, data.roles, data.prompts), aspect_ratio: node.ratio || "16:9", size: normalizeGenerationSize(node.ratio || "16:9", node.size), image_media_ids: imageIds } : buildVideoRequest({ mode: references.length ? "i2v" : "t2v", prompt: resolvePrompt(prompt, data.roles, data.prompts), duration: node.duration || 5, ratio: node.ratio || "16:9", size: normalizeGenerationSize(node.ratio || "16:9", node.size), sceneId: scene.id,
        referenceIds: references.filter(m => m?.kind === "image").map(m => m!.id), referenceVideoIds: references.filter(m => m?.kind === "video").map(m => m!.id), referenceAudioIds: references.filter(m => m?.kind === "audio").map(m => m!.id) });
    } catch (e) { return void Message.warning(String(e)); }
    busy.current = true; setBusyNode(node.id);
    try {
      const media = await post<Media>(node.kind === "image" ? "/generations/image" : "/generations/video", { project_id: data.project.id, ...request });
      setLocalMedia(items => [...items.filter(m => m.id !== media.id), media]); if (node.ref_id) {
        const d = current.current;
        const result: Node = { ...node, id: uid(), ref_id: media.id, x: node.x + WIDTH + 100, y: node.y };
        while (d.nodes.some(n => Math.abs(n.x - result.x) < WIDTH && Math.abs(n.y - result.y) < 600)) result.y += 640;
        commit({ ...d, nodes: [...d.nodes, result], edges: [...d.edges, { id: uid(), from: node.id, to: result.id }] }); setSelected(result.id);
      } else patch(node.id, { ref_id: media.id });
      setImageEditor(""); await reload(); Message.success(`${labels[node.kind]}已生成，保存画布后保留节点结果`);
    } catch (e) { Message.error(String(e)); } finally { busy.current = false; setBusyNode(""); }
  };
  const selectVideo = async (media: Media) => {
    if (busy.current) return; busy.current = true; setBusyNode("select-video");
    try { await post("/scenes/select-video", { ...payload, media_id: media.id }); await reload(); Message.success("已设为场景视频，可参与剧集合并"); }
    catch (e) { Message.error(String(e)); } finally { busy.current = false; setBusyNode(""); }
  };
  const exportDraft = () => { const url = URL.createObjectURL(new Blob([JSON.stringify({ ...payload, ...draft }, null, 2)], { type: "application/json" })); const a = document.createElement("a"); a.href = url; a.download = `spielberg-scene-${scene.id}-canvas.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
  return <section className="infinite-canvas">
    <header className="ic-heading"><div><Button type="text" icon={<ArrowLeft size={15} />} disabled={!!busyNode} onClick={onClose}>返回场景列表</Button><h1>画布场景</h1><Input aria-label="画布场景名称" value={title} onChange={setTitle} disabled={!!busyNode} /><p>右键添加节点 · 图片 / 音频 / 视频 → 视频</p></div><div className="ic-actions"><span className={`ic-save-state${dirty ? " is-dirty" : ""}`} role="status">{dirty ? "未保存" : saved ? "已保存" : ""}</span><Button onClick={exportDraft} disabled={loading || !!error} icon={<Download size={16} />}>导出草稿</Button><Button disabled={!!busyNode} onClick={() => dirty ? confirmDiscard(() => void load()) : void load()}>重新加载</Button><Button type="primary" loading={saving} disabled={loading || !!error || !dirty || !!busyNode} onClick={() => void save()} icon={<Save size={16} />}>保存画布</Button></div></header>
    {loading ? <p role="status">正在加载画布…</p> : error ? <p role="alert">{error}</p> : <>
    <div className="ic-toolbar"><Button icon={<Plus size={16} />} disabled={!!busyNode} onClick={() => { const el = stage.current; if (!el) return; const v = draft.viewport; setMenu({ x: 20, y: Math.max(80, el.clientHeight - (el.clientWidth <= 700 ? 310 : 270)), worldX: (el.clientWidth / 2 - v.x) / v.zoom, worldY: (el.clientHeight / 2 - v.y) / v.zoom }); }}>添加节点</Button><Button aria-label="撤销画布操作" disabled={!past.length || !!busyNode} onClick={undo} icon={<Undo2 size={16} />} /><Button aria-label="重做画布操作" disabled={!future.length || !!busyNode} onClick={redo} icon={<Redo2 size={16} />} /><Button disabled={!selected || !!busyNode} onClick={remove} icon={<Trash2 size={16} />}>移除选中</Button><span>{draft.nodes.length} 个节点 · {draft.edges.length} 条连线</span><small>拖动标题移动 · 空白处平移 · Ctrl / ⌘ + 滚轮缩放</small></div>
    <div className="ic-workspace"><div ref={stage} className="ic-stage" tabIndex={0} aria-label="创作画布" style={{ backgroundSize: `${24 * draft.viewport.zoom}px ${24 * draft.viewport.zoom}px`, backgroundPosition: `${draft.viewport.x}px ${draft.viewport.y}px` }} onContextMenu={e => {
      e.preventDefault(); if (busy.current) return; const el = stage.current!, r = el.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, v = draft.viewport;
      setLinkFrom(""); setLinkTo(""); setLinkPoint(null); setMenu({ x: Math.max(0, Math.min(x, el.clientWidth - 180)), y: Math.max(0, Math.min(y, el.clientHeight - 190)), worldX: (x - v.x) / v.zoom, worldY: (y - v.y) / v.zoom });
    }} onPointerDown={e => start(e)} onPointerMove={e => {
      if (linkFrom || linkTo) {
        const r = stage.current!.getBoundingClientRect(), v = current.current.viewport;
        setLinkPoint({ x: (e.clientX - r.left - v.x) / v.zoom, y: (e.clientY - r.top - v.y) / v.zoom });
      }
      const d = drag.current; if (!d || d.pointer !== e.pointerId) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y, v = d.before.viewport;
      setDraft(d.node ? { ...current.current, nodes: d.before.nodes.map(n => n.id === d.node ? { ...n, x: Math.max(-999000, Math.min(999000, n.x + dx / v.zoom)), y: Math.max(-999000, Math.min(999000, n.y + dy / v.zoom)) } : n) } : { ...current.current, viewport: { ...v, x: v.x + dx, y: v.y + dy } });
    }} onPointerUp={e => {
      if (linkDrag.current) {
        const moved = Math.hypot(e.clientX - linkDrag.current.x, e.clientY - linkDrag.current.y) > 4;
        linkDrag.current = null;
        if (moved) {
          const input = document.elementFromPoint(e.clientX, e.clientY)?.closest(linkTo ? ".ic-output" : ".ic-input");
          const id = input?.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId;
          if (id) linkTo ? connect(linkTo, id) : connect(id); else {
            const r = stage.current!.getBoundingClientRect(), v = current.current.viewport, x = e.clientX - r.left, y = e.clientY - r.top;
            if (!(document.elementFromPoint(e.clientX, e.clientY)?.closest(".ic-node"))) setMenu({ x: Math.max(0, Math.min(x, r.width - 180)), y: Math.max(0, Math.min(y, r.height - 190)), worldX: (x - v.x) / v.zoom - (linkTo ? WIDTH : 0), worldY: (y - v.y) / v.zoom - 26, from: linkFrom || undefined, to: linkTo || undefined });
            else { setLinkFrom(""); setLinkTo(""); setLinkPoint(null); }
          }
        }
      }
      finish();
    }} onPointerCancel={() => { finish(); linkDrag.current = null; setLinkTo(""); setLinkFrom(""); setLinkPoint(null); }} onKeyDown={e => {
      if (e.key === "Escape") { setLinkPoint(null); linkDrag.current = null; setLinkTo(""); setLinkFrom(""); setSelected(""); setMenu(null); }
      if ((e.target as HTMLElement).closest("input,textarea,button,.arco-select")) return;
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); remove(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !busyNode) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); void save(); }
    }}>
      {!draft.nodes.length && <div className="ic-empty"><div className="ic-empty-mark"><Film size={30} strokeWidth={1.5} /></div><span className="ic-eyebrow">无限画布 · 自由创作</span><h2>让灵感，在这里连接</h2><p>从一张图片、一段音频或一个想法开始，<br />连接节点，构建你的下一个镜头。</p><div className="ic-empty-actions" onPointerDown={e => e.stopPropagation()}>{(["image", "video", "audio", "note"] as const).map(kind => <button key={kind} disabled={!!busyNode} onClick={() => add(kind)}>{kind === "image" ? <Image size={19} /> : kind === "video" ? <Film size={19} /> : kind === "audio" ? <Music size={19} /> : <StickyNote size={19} />}<span>{labels[kind]}</span><Plus size={13} /></button>)}</div><small>也可以在空白处右键添加节点</small></div>}
      <div className="ic-world" style={{ transform: `translate(${draft.viewport.x}px, ${draft.viewport.y}px) scale(${draft.viewport.zoom})` }}>
        <svg className="ic-edges" width="1" height="1" aria-label="创作关系"><defs><marker id="ic-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" /></marker></defs>{draft.edges.map(edge => {
          const a = draft.nodes.find(n => n.id === edge.from), b = draft.nodes.find(n => n.id === edge.to); if (!a || !b) return null;
          const x = a.x + WIDTH, y = a.y + 26, bx = b.x, by = b.y + 26, bend = Math.max(80, Math.abs(bx - x) / 2), path = `M ${x} ${y} C ${x + bend} ${y}, ${bx - bend} ${by}, ${bx} ${by}`;
          return <g key={edge.id} className={selected === edge.id ? "selected" : ""}><path d={path} markerEnd="url(#ic-arrow)" /><path className="ic-edge-hit" d={path} onPointerDown={e => e.stopPropagation()} onClick={() => setSelected(edge.id)}><title>点击选中连线，再移除</title></path></g>;
        })}{(linkFrom || linkTo) && linkPoint && (() => {
          const source = draft.nodes.find(n => n.id === (linkFrom || linkTo)); if (!source) return null;
          const x = source.x + (linkTo ? 0 : WIDTH), y = source.y + 26, direction = linkTo ? -1 : 1, bend = Math.max(80, Math.abs(linkPoint.x - x) / 2);
          return <path className="ic-link-preview" d={`M ${x} ${y} C ${x + direction * bend} ${y}, ${linkPoint.x - direction * bend} ${linkPoint.y}, ${linkPoint.x} ${linkPoint.y}`} />;
        })()}</svg>
        {draft.nodes.map(node => {
          const info = describe(node), inputs = draft.edges.filter(e => e.to === node.id).map(e => draft.nodes.find(n => n.id === e.from)!);
          return <article key={node.id} data-node-id={node.id} className={`ic-node ic-${node.kind}${selected === node.id ? " selected" : ""}${linkFrom === node.id ? " linking" : ""}`} style={{ left: node.x, top: node.y }} onPointerDown={e => e.stopPropagation()} onClick={() => setSelected(node.id)}>
            <header className={node.kind === "image" && info.media ? "ic-image-title" : undefined} onPointerDown={e => start(e, node.id)}><small>{node.kind === "image" ? <Image size={13} /> : node.kind === "video" ? <Film size={13} /> : node.kind === "audio" ? <Music size={13} /> : <StickyNote size={13} />}{labels[node.kind]}</small><strong title={info.title}>{info.title}</strong></header>
            {(node.kind === "video" || node.kind === "image") && <button className="ic-port ic-input" aria-label={`输入${info.title}`} title="拖出连线添加上游节点，或连接已有节点" disabled={!!busyNode} onPointerDown={e => { e.stopPropagation(); if (linkFrom) { connect(node.id); return; } stage.current?.focus(); setLinkTo(node.id); setLinkFrom(""); setMenu(null); linkDrag.current = { x: e.clientX, y: e.clientY }; stage.current?.setPointerCapture(e.pointerId); }} />}
            {(mediaKind(node.kind) || node.kind === "note") && <button className="ic-port ic-output" aria-label={`输出${info.title}`} title="素材输出：点击后选择视频输入" disabled={!!busyNode} onPointerDown={e => { e.stopPropagation(); stage.current?.focus(); if (linkTo) { connect(linkTo, node.id); return; } setLinkTo(""); setLinkFrom(node.id); setMenu(null); linkDrag.current = { x: e.clientX, y: e.clientY }; stage.current?.setPointerCapture(e.pointerId); }} />}
            {info.media && (info.media.kind === "audio" ? <audio controls preload="none" src={imageUrl(info.media)} /> : info.media.kind === "video" ? <video controls preload="none" src={imageUrl(info.media)} /> : <div className="ic-node-preview" onPointerDown={e => node.kind === "image" && start(e, node.id)}>{node.kind === "image" ? <img draggable={false} src={imageUrl(info.media)} alt={info.title} /> : <AssetThumbnail media={info.media} projectId={data.project.id} />}</div>)}
            {node.kind === "image" && <Button className="ic-image-create" size="mini" disabled={!!busyNode} onClick={() => setImageEditor(node.id)}>{info.media ? "图生图" : "文生图 / 图生图"}</Button>}
            {mediaKind(node.kind) && <div className="ic-node-media"><Button size="mini" disabled={!!busyNode} onClick={() => openPicker(node)}>{info.media ? "替换素材" : `选择 / 上传${labels[node.kind]}`}</Button>{info.media && <Button size="mini" disabled={!!busyNode} onClick={() => patch(node.id, { ref_id: undefined })}>清除素材</Button>}</div>}
            {node.kind === "note" ? <textarea aria-label="便签内容" placeholder="记录创作思路…" value={node.text || ""} disabled={!!busyNode} maxLength={5000} onFocus={() => { setPast(p => [...p.slice(-49), current.current]); setFuture([]); }} onChange={e => setDraft({ ...draft, nodes: draft.nodes.map(n => n.id === node.id ? { ...n, text: e.target.value } : n) })} /> : node.kind === "video" ? <div className="ic-video-fields">
              <div className="ic-input-summary">参考输入：{inputs.length ? inputs.map(n => labels[n.kind]).join("、") : "无 · 文生视频"}</div>
              <textarea aria-label="视频节点描述" placeholder="描述要生成的视频…" disabled={!!busyNode} maxLength={5000} value={node.prompt || ""} onFocus={() => { setPast(p => [...p.slice(-49), current.current]); setFuture([]); }} onChange={e => setDraft({ ...draft, nodes: draft.nodes.map(n => n.id === node.id ? { ...n, prompt: e.target.value } : n) })} />
              <Form layout="vertical"><div className="ic-video-options"><VideoDurationField value={node.duration || 5} disabled={!!busyNode} onChange={duration => patch(node.id, { duration })} /><MediaSizeFields ratio={node.ratio || "16:9"} size={node.size} disabled={!!busyNode} onChange={value => patch(node.id, { ratio: value.ratio, size: value.size })} /></div></Form>
              <Button type="primary" long loading={busyNode === node.id} disabled={!!busyNode && busyNode !== node.id} onClick={() => void generate(node)}>生成视频</Button>
              {info.media?.kind === "video" && <Button long size="small" disabled={!!busyNode || scene.video_media_id === info.media.id} onClick={() => void selectVideo(info.media!)}>{scene.video_media_id === info.media.id ? "当前场景视频" : "设为场景视频"}</Button>}
            </div> : node.kind === "image" && info.media ? null : <p>{info.text}</p>}
          </article>;
        })}
      </div>
      {menu && <div role="menu" aria-label="添加画布节点" className="ic-context-menu" style={{ left: menu.x, top: menu.y }} onPointerDown={e => e.stopPropagation()}>{(["image", "video", "audio", "note"] as const).filter(kind => menu.to ? compatible({ kind } as Node, draft.nodes.find(n => n.id === menu.to)!) : menu.from ? compatible(draft.nodes.find(n => n.id === menu.from)!, { kind } as Node) : true).map(kind => <button role="menuitem" key={kind} onClick={() => add(kind)}>{kind === "image" ? <Image size={16} /> : kind === "video" ? <Film size={16} /> : kind === "audio" ? <Music size={16} /> : <StickyNote size={16} />}添加{labels[kind]}节点</button>)}</div>}
      <div className="ic-view-tools" onPointerDown={e => e.stopPropagation()}><Button aria-label="缩小画布" onClick={() => zoomAt(draft.viewport.zoom / 1.2, (stage.current?.clientWidth || 800) / 2, (stage.current?.clientHeight || 600) / 2)}>−</Button><span>{Math.round(draft.viewport.zoom * 100)}%</span><Button aria-label="放大画布" onClick={() => zoomAt(draft.viewport.zoom * 1.2, (stage.current?.clientWidth || 800) / 2, (stage.current?.clientHeight || 600) / 2)}>+</Button><Button onClick={fit} icon={<Maximize size={15} />}>适应画布</Button></div>
      {(linkFrom || linkTo) && <div className="ic-link-hint">拖到端口连接，拖到空白处添加节点 · Esc 取消</div>}
    </div></div></>}
    <Modal title="生成图片" visible={!!imageEditor} footer={null} onCancel={() => { if (!busyNode) setImageEditor(""); }}>
      {(() => { const node = draft.nodes.find(n => n.id === imageEditor); if (!node) return null;
        const inputs = draft.edges.filter(e => e.to === node.id).map(e => draft.nodes.find(n => n.id === e.from)!);
        return <div className="ic-video-fields"><p>{node.ref_id || inputs.some(n => n.kind === "image") ? "图生图：使用当前图片和上游图片作为参考" : "文生图：连接图片节点后可使用图生图"}</p>
          <textarea aria-label="图片节点描述" placeholder="描述要生成的图片…" maxLength={5000} value={node.prompt || ""} disabled={!!busyNode} onChange={e => patch(node.id, { prompt: e.target.value })} />
          <Form layout="vertical"><MediaSizeFields ratio={node.ratio || "16:9"} size={node.size} disabled={!!busyNode} onChange={value => patch(node.id, { ratio: value.ratio, size: value.size })} /></Form>
          <Button type="primary" long loading={busyNode === node.id} disabled={!!busyNode && busyNode !== node.id} onClick={() => void generate(node)}>生成图片</Button>
        </div>;
      })()}
    </Modal>
    <Modal title={`选择${picker ? labels[picker.kind] : ""}素材`} visible={!!picker} footer={null} onCancel={() => { if (!busyNode) setPicker(null); }} className="ic-asset-picker">
      <div className="ic-picker-tools"><Input aria-label="搜索节点素材" placeholder="搜索项目素材" value={search} disabled={!!busyNode} onChange={v => { setSearch(v); setAssetPage(1); }} /><Button icon={<Upload size={15} />} loading={!!busyNode} onClick={() => fileInput.current?.click()}>上传文件</Button></div>
      <input ref={fileInput} type="file" hidden aria-label="上传节点素材" accept={picker?.kind === "image" ? ".png,.jpg,.jpeg,.webp,.gif" : picker?.kind === "video" ? ".mp4,.mov,.webm,.mkv" : ".mp3,.wav,.m4a,.aac,.ogg,.flac"} onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void upload(file); }} />
      <div className="ic-picker-list">{assetLoading ? <p>加载素材…</p> : assets.length ? assets.map(m => <button key={m.id} aria-label={`选择${m.name}`} disabled={!!busyNode} onClick={() => assign(m)}>{m.kind === "image" ? <AssetThumbnail media={m} projectId={data.project.id} /> : m.kind === "video" ? <Film size={24} /> : <Music size={24} />}<span>{m.name}</span></button>) : <p>暂无匹配素材，可以上传文件。</p>}</div>
      <div className="ic-pagination"><Button disabled={assetPage <= 1 || assetLoading || !!busyNode} onClick={() => setAssetPage(p => p - 1)}>上一页</Button><span>{assetPage} / {Math.max(1, Math.ceil(assetTotal / 24))}</span><Button disabled={assetPage * 24 >= assetTotal || assetLoading || !!busyNode} onClick={() => setAssetPage(p => p + 1)}>下一页</Button></div>
    </Modal>
  </section>;
}
