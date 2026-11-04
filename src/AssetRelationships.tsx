import { useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Button, Checkbox, Empty, Form, Input, Message, Modal, Select, Space, Spin, Tag } from "@arco-design/web-react";
import { ArrowLeft, ArrowRight, GitBranch, Maximize, Minus, Pencil, Plus, RotateCcw, Save, Trash2, Users } from "lucide-react";
import { imageUrl, type Asset, type Snapshot } from "./core";
import { assetCategoryLabel } from "./asset-categories";
import { jsonRequest } from "./transport";
import { confirmDiscard, useEditGuard } from "./edit-guard";
import "./asset-relationships.css";

export type AssetRelation = { id: number; source_asset_id: number; target_asset_id: number; label: string; directed: boolean; description: string; created_at: string; updated_at: string };
type Point = { x: number; y: number };
export type AssetGraph = { positions: Record<string, Point>; revision: number };
type RelationDraft = Pick<AssetRelation, "source_asset_id" | "target_asset_id" | "label" | "directed" | "description"> & { id?: number };
type View = Point & { zoom: number };
type Gesture = { pointer: number; start: Point; kind: "pan"; view: View } | { pointer: number; start: Point; kind: "node"; asset: number; position: Point } | { pointer: number; start: Point; kind: "link"; asset: number };
const WIDTH = 218, HEIGHT = 86;
const clampZoom = (value: number) => Math.max(.25, Math.min(2, value));
const initialPositions = (assets: Asset[], saved: Record<string, Point>): Record<string, Point> => Object.fromEntries([...assets].sort((a, b) => a.id - b.id).map((asset, index) => [asset.id, saved[asset.id] || { x: 60 + index % 4 * 285, y: 65 + Math.floor(index / 4) * 170 }]));
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

export default function AssetRelationships({ data, onClose }: { data: Snapshot; onClose: () => void }) {
  const [relations, setRelations] = useState<AssetRelation[]>([]), [positions, setPositions] = useState<Record<string, Point>>({});
  const [revision, setRevision] = useState(0), [savedPositions, setSavedPositions] = useState("");
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState("");
  const [showDisabled, setShowDisabled] = useState(false), [query, setQuery] = useState("");
  const [view, setView] = useState<View>({ x: 30, y: 25, zoom: 1 }), [selected, setSelected] = useState<number | null>(null);
  const [linkFrom, setLinkFrom] = useState<number | null>(null), [linkPoint, setLinkPoint] = useState<Point | null>(null);
  const [editing, setEditing] = useState<RelationDraft | null>(null), [relationBusy, setRelationBusy] = useState(false), [formError, setFormError] = useState("");
  const stage = useRef<HTMLDivElement>(null), gesture = useRef<Gesture | null>(null), positionsRef = useRef(positions), viewRef = useRef(view), assetsRef = useRef(data.assets);
  const fitOnLoad = useRef(false);
  const observedRelationVersion = useRef<number | undefined>(undefined), mutationEpoch = useRef(0);
  positionsRef.current = positions; viewRef.current = view; assetsRef.current = data.assets;
  const markerId = `asset-relation-arrow-${useId().replace(/:/g, "")}`;
  const base = `/api/v1/projects/${encodeURIComponent(data.project.id)}`;
  const dirty = savedPositions !== "" && JSON.stringify(positions) !== savedPositions;
  useEditGuard(dirty || saving || editing !== null);
  const assetMap = useMemo(() => new Map(data.assets.map(asset => [asset.id, asset])), [data.assets]);
  const visibleAssets = useMemo(() => data.assets.filter(asset => (showDisabled || asset.enabled !== false) && (!query.trim() || `${asset.name} ${assetCategoryLabel(asset.category)}`.toLowerCase().includes(query.trim().toLowerCase()))), [data.assets, showDisabled, query]);
  const visibleIds = new Set(visibleAssets.map(asset => asset.id));
  const visibleRelations = relations.filter(relation => visibleIds.has(relation.source_asset_id) && visibleIds.has(relation.target_asset_id));
  const listedRelations = visibleRelations.filter(relation => selected === null || relation.source_asset_id === selected || relation.target_asset_id === selected);

  const fit = (nodes = visibleAssets, nextPositions = positionsRef.current) => {
    const box = stage.current?.getBoundingClientRect();
    const points = nodes.map(asset => nextPositions[asset.id]).filter(Boolean);
    if (!box || !points.length) return;
    const minX = Math.min(...points.map(point => point.x)), minY = Math.min(...points.map(point => point.y));
    const maxX = Math.max(...points.map(point => point.x + WIDTH)), maxY = Math.max(...points.map(point => point.y + HEIGHT));
    const zoom = clampZoom(Math.min(1, (box.width - 100) / Math.max(1, maxX - minX), (box.height - 100) / Math.max(1, maxY - minY)));
    setView({ x: (box.width - (maxX - minX) * zoom) / 2 - minX * zoom, y: (box.height - (maxY - minY) * zoom) / 2 - minY * zoom, zoom });
  };
  const load = async () => {
    setLoading(true); setError("");
    try {
      const [items, graph] = await Promise.all([jsonRequest<AssetRelation[]>(`${base}/asset-relations`, "GET"), jsonRequest<AssetGraph>(`${base}/asset-graph`, "GET")]);
      const next = initialPositions(assetsRef.current, graph.positions);
      setRelations(items); setPositions(next); positionsRef.current = next; setSavedPositions(JSON.stringify(next)); setRevision(graph.revision); fitOnLoad.current = true;
    } catch (e) { setError(errorText(e)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [base]);
  useEffect(() => {
    if (loading || !fitOnLoad.current) return;
    fitOnLoad.current = false;
    fit();
  }, [loading]);
  useEffect(() => {
    if (loading || savedPositions === "") return;
    setPositions(current => initialPositions(data.assets, current));
    if (selected !== null && !assetMap.has(selected)) setSelected(null);
  }, [data.assets]);
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => { if (event.key === "Escape") { setLinkFrom(null); setLinkPoint(null); gesture.current = null; } };
    window.addEventListener("keydown", cancel); return () => window.removeEventListener("keydown", cancel);
  }, []);
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const box = element.getBoundingClientRect(), current = viewRef.current;
      const next = clampZoom(current.zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12));
      const x = event.clientX - box.left, y = event.clientY - box.top;
      const updated = { x: x - (x - current.x) * next / current.zoom, y: y - (y - current.y) * next / current.zoom, zoom: next };
      viewRef.current = updated;
      setView(updated);
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [loading, error]);
  useEffect(() => {
    const version = data.revisions?.asset_relations;
    if (loading || relationBusy || editing !== null || version === undefined || version === observedRelationVersion.current) return;
    let cancelled = false;
    const epoch = mutationEpoch.current;
    void jsonRequest<AssetRelation[]>(`${base}/asset-relations`, "GET").then(items => {
      if (!cancelled && epoch === mutationEpoch.current) { setRelations(items); observedRelationVersion.current = version; }
    }).catch(() => { /* Keep the usable graph; the reload button exposes connection errors. */ });
    return () => { cancelled = true; };
  }, [base, data.revisions?.asset_relations, loading, relationBusy, editing === null]);
  const saveLayout = async () => {
    if (saving || loading) return;
    setSaving(true);
    const submitted = positionsRef.current;
    try {
      const graph = await jsonRequest<AssetGraph>(`${base}/asset-graph`, "PATCH", { positions: submitted, revision });
      setRevision(graph.revision); setSavedPositions(JSON.stringify(submitted)); Message.success("关系图布局已保存");
    } catch (e) { Message.error(errorText(e)); }
    finally { setSaving(false); }
  };
  const newRelation = (source?: number, target?: number) => {
    setFormError(""); setLinkFrom(null); setLinkPoint(null);
    setEditing({ source_asset_id: source || 0, target_asset_id: target || 0, label: "", directed: false, description: "" });
  };
  const editRelation = (relation: AssetRelation) => {
    setFormError("");
    setEditing({ id: relation.id, source_asset_id: relation.source_asset_id, target_asset_id: relation.target_asset_id, label: relation.label, directed: relation.directed, description: relation.description });
  };
  const saveRelation = async () => {
    if (!editing || relationBusy) return;
    if (!editing.source_asset_id || !editing.target_asset_id) { setFormError("请选择两个资产"); return; }
    if (editing.source_asset_id === editing.target_asset_id) { setFormError("请选择两个不同的资产"); return; }
    if (!editing.label.trim()) { setFormError("请填写关系名称，例如兄妹、故乡或持有"); return; }
    setRelationBusy(true); setFormError("");
    mutationEpoch.current += 1;
    try {
      const { id, source_asset_id, target_asset_id, directed } = editing;
      const relation = await jsonRequest<AssetRelation>(`${base}/asset-relations${id ? `/${id}` : ""}`, id ? "PATCH" : "POST", { source_asset_id, target_asset_id, directed, label: editing.label.trim(), description: editing.description.trim() });
      setRelations(current => [...current.filter(item => item.id !== relation.id), relation].sort((a, b) => a.id - b.id));
      setEditing(null); Message.success(id ? "关系已更新" : "关系已建立");
    } catch (e) { setFormError(errorText(e)); }
    finally { setRelationBusy(false); }
  };
  const deleteRelation = (relation: AssetRelation) => Modal.confirm({
    title: "删除这条资产关系？", content: `${assetMap.get(relation.source_asset_id)?.name || "资产"} — ${relation.label} — ${assetMap.get(relation.target_asset_id)?.name || "资产"}`, okText: "删除关系", okButtonProps: { status: "danger" },
    onOk: async () => {
      mutationEpoch.current += 1;
      try { await jsonRequest(`${base}/asset-relations/${relation.id}`, "DELETE"); setRelations(current => current.filter(item => item.id !== relation.id)); Message.success("关系已删除"); }
      catch (e) { Message.error(errorText(e)); throw e; }
    },
  });
  const worldPoint = (event: { clientX: number; clientY: number }): Point => {
    const box = stage.current!.getBoundingClientRect(), currentView = viewRef.current;
    return { x: (event.clientX - box.left - currentView.x) / currentView.zoom, y: (event.clientY - box.top - currentView.y) / currentView.zoom };
  };
  const nodeDown = (event: ReactPointerEvent, asset: Asset) => {
    if (event.button !== 0 || saving) return;
    event.stopPropagation(); setSelected(asset.id);
    gesture.current = { pointer: event.pointerId, start: { x: event.clientX, y: event.clientY }, kind: "node", asset: asset.id, position: positionsRef.current[asset.id] };
    stage.current?.setPointerCapture(event.pointerId);
  };
  const portDown = (event: ReactPointerEvent, id: number) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    if (linkFrom !== null && linkFrom !== id) { newRelation(linkFrom, id); return; }
    setLinkFrom(id); setLinkPoint(worldPoint(event));
    gesture.current = { pointer: event.pointerId, start: { x: event.clientX, y: event.clientY }, kind: "link", asset: id };
    stage.current?.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = gesture.current;
    if (linkFrom !== null) setLinkPoint(worldPoint(event));
    if (!active || active.pointer !== event.pointerId) return;
    const dx = event.clientX - active.start.x, dy = event.clientY - active.start.y;
    if (active.kind === "node") {
      const point = { x: Math.max(-100000, Math.min(100000, active.position.x + dx / viewRef.current.zoom)), y: Math.max(-100000, Math.min(100000, active.position.y + dy / viewRef.current.zoom)) };
      setPositions(current => { const next = { ...current, [active.asset]: point }; positionsRef.current = next; return next; });
    } else if (active.kind === "pan") setView({ ...active.view, x: active.view.x + dx, y: active.view.y + dy });
  };
  const pointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = gesture.current;
    if (!active || active.pointer !== event.pointerId) return;
    gesture.current = null;
    if (stage.current?.hasPointerCapture(event.pointerId)) stage.current.releasePointerCapture(event.pointerId);
    if (active.kind === "link") {
      const port = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-asset-port]");
      const target = Number(port?.dataset.assetPort);
      if (target && target !== active.asset) newRelation(active.asset, target);
    }
  };
  const zoom = (factor: number) => {
    const box = stage.current?.getBoundingClientRect(); if (!box) return;
    setView(current => { const next = clampZoom(current.zoom * factor); return { x: box.width / 2 - (box.width / 2 - current.x) * next / current.zoom, y: box.height / 2 - (box.height / 2 - current.y) * next / current.zoom, zoom: next }; });
  };
  const relationOptions = data.assets.map(asset => ({ value: asset.id, label: `${asset.name} · ${assetCategoryLabel(asset.category)}${asset.enabled === false ? "（已禁用）" : ""}` }));
  const selectedAsset = selected === null ? undefined : assetMap.get(selected);

  return <section className="asset-relationships" aria-label="资产关系图">
    <div className="asset-graph-heading">
      <div><Button type="text" icon={<ArrowLeft size={16}/>} onClick={() => dirty ? confirmDiscard(onClose) : onClose()}>资产列表</Button><h1>资产关系图 <span>{data.assets.length} 个资产 · {relations.length} 条关系</span></h1><p>连起人物、地点与物品，梳理故事中的联系。</p></div>
      <Space wrap><Button icon={<RotateCcw size={15}/>} disabled={loading || saving || relationBusy} onClick={() => dirty ? confirmDiscard(() => void load()) : void load()}>重新加载</Button><Button icon={<Save size={15}/>} loading={saving} disabled={loading || !dirty} onClick={() => void saveLayout()}>保存布局{dirty ? " ·" : ""}</Button><Button type="primary" icon={<Plus size={16}/>} disabled={loading || data.assets.length < 2} onClick={() => newRelation(selected || undefined)}>新建关系</Button></Space>
    </div>
    {error ? <div className="asset-graph-load-error" role="alert"><p>{error}</p><Button onClick={() => void load()}>重新加载</Button></div> : <Spin loading={loading} style={{ display: "block" }}>
      <div className="asset-graph-toolbar"><Input.Search aria-label="搜索关系图资产" placeholder="搜索资产名称或类别" value={query} onChange={value => { setQuery(value); setSelected(null); }} allowClear/><Checkbox checked={showDisabled} onChange={value => { setShowDisabled(value); setSelected(null); }}>显示已禁用资产</Checkbox><span className="asset-graph-hint">拖动资产调整位置；拖动或依次点击两个圆点建立关系。</span></div>
      <div className="asset-graph-workspace">
        <div ref={stage} className={`asset-graph-stage${linkFrom !== null ? " is-connecting" : ""}`} aria-label="资产关系画布" tabIndex={0}
          onPointerDown={event => { if (event.button !== 0 || (event.target as Element).closest("button, .asset-graph-node, .asset-graph-edge")) return; setSelected(null); if (linkFrom !== null) { setLinkFrom(null); setLinkPoint(null); return; } gesture.current = { pointer: event.pointerId, start: { x: event.clientX, y: event.clientY }, kind: "pan", view: viewRef.current }; event.currentTarget.setPointerCapture(event.pointerId); }}
          onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => { gesture.current = null; setLinkFrom(null); setLinkPoint(null); }}>
          <div className="asset-graph-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
            <svg className="asset-graph-lines" width="1" height="1" aria-label="资产关系连线">
              <defs><marker id={markerId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M 0 0 L 8 4 L 0 8 z" fill="currentColor"/></marker></defs>
              {visibleRelations.map((relation, index) => {
                const source = positions[relation.source_asset_id], target = positions[relation.target_asset_id]; if (!source || !target) return null;
                const right = target.x >= source.x, x1 = source.x + (right ? WIDTH : 0), x2 = target.x + (right ? 0 : WIDTH), y1 = source.y + HEIGHT / 2, y2 = target.y + HEIGHT / 2;
                const siblings = visibleRelations.filter(item => [relation.source_asset_id, relation.target_asset_id].includes(item.source_asset_id) && [relation.source_asset_id, relation.target_asset_id].includes(item.target_asset_id));
                const offset = (siblings.findIndex(item => item.id === relation.id) - (siblings.length - 1) / 2) * 36;
                const distance = Math.max(65, Math.abs(x2 - x1) * .45), sign = right ? 1 : -1;
                const path = `M ${x1} ${y1} C ${x1 + sign * distance} ${y1 + offset}, ${x2 - sign * distance} ${y2 + offset}, ${x2} ${y2}`;
                const textX = (x1 + x2) / 2, textY = (y1 + y2) / 2 + offset * .75;
                const displayLabel = relation.label.length > 16 ? `${relation.label.slice(0, 16)}…` : relation.label;
                const labelWidth = Math.max(64, displayLabel.length * 14 + 24);
                return <g key={relation.id} className={`asset-graph-edge${selected === relation.source_asset_id || selected === relation.target_asset_id ? " is-highlighted" : ""}`} onClick={() => editRelation(relation)}>
                  <title>{assetMap.get(relation.source_asset_id)?.name} {relation.directed ? "→" : "—"} {assetMap.get(relation.target_asset_id)?.name}：{relation.label}</title>
                  <path className="asset-graph-edge-hit" d={path}/><path className="asset-graph-edge-line" d={path} markerEnd={relation.directed ? `url(#${markerId})` : undefined}/>
                  <rect x={textX - labelWidth / 2} y={textY - 13} width={labelWidth} height="26" rx="13"/>
                  <text x={textX} y={textY + 4} textAnchor="middle">{displayLabel}</text>
                  <circle cx={x1} cy={y1} r="3"/><circle cx={x2} cy={y2} r="3"/>
                  <desc>{index + 1}</desc>
                </g>;
              })}
              {linkFrom !== null && linkPoint && positions[linkFrom] && <path className="asset-graph-pending" d={`M ${positions[linkFrom].x + WIDTH} ${positions[linkFrom].y + HEIGHT / 2} L ${linkPoint.x} ${linkPoint.y}`}/>}
            </svg>
            {visibleAssets.map(asset => {
              const point = positions[asset.id]; if (!point) return null;
              const picture = asset.images.find(image => image.id === asset.design_media_id) || asset.images[0];
              return <article key={asset.id} data-asset-node={asset.id} className={`asset-graph-node${selected === asset.id ? " is-selected" : ""}${linkFrom === asset.id ? " is-source" : ""}${asset.enabled === false ? " is-disabled" : ""}`} style={{ left: point.x, top: point.y }} onPointerDown={event => nodeDown(event, asset)}>
                <button className="asset-graph-port asset-graph-port-left" aria-label={`连接至 ${asset.name}`} data-asset-port={asset.id} title="连接此资产" onPointerDown={event => portDown(event, asset.id)} onClick={event => { if (event.detail === 0) { event.stopPropagation(); if (linkFrom !== null && linkFrom !== asset.id) newRelation(linkFrom, asset.id); else setLinkFrom(asset.id); } }}/>
                <div className="asset-graph-avatar">{picture ? <img src={imageUrl(picture)} alt="" draggable={false} loading="lazy"/> : <Users size={23} strokeWidth={1.4}/>}</div><div className="asset-graph-node-copy"><strong title={asset.name}>{asset.name}</strong><span>{assetCategoryLabel(asset.category)}{asset.enabled === false ? " · 已禁用" : ""}</span></div>
                <button className="asset-graph-port asset-graph-port-right" aria-label={`连接 ${asset.name}`} data-asset-port={asset.id} title="拖动或点击圆点建立关系" onPointerDown={event => portDown(event, asset.id)} onClick={event => { if (event.detail === 0) { event.stopPropagation(); if (linkFrom !== null && linkFrom !== asset.id) newRelation(linkFrom, asset.id); else setLinkFrom(asset.id); } }}/>
              </article>;
            })}
          </div>
          {!loading && !visibleAssets.length && <div className="asset-graph-empty"><Empty description={data.assets.length ? "没有符合条件的资产" : "先在资产库创建人物、地点或物品，再来建立联系"}/>{data.assets.length > 0 && <Button onClick={() => { setQuery(""); setShowDisabled(true); }}>显示全部资产</Button>}</div>}
          {linkFrom !== null && <div className="asset-graph-connection-tip">从「{assetMap.get(linkFrom)?.name}」连接到另一个资产的圆点 <Button type="text" size="mini" onClick={() => { setLinkFrom(null); setLinkPoint(null); }}>取消</Button></div>}
          <div className="asset-graph-view-controls"><Button aria-label="缩小关系图" icon={<Minus size={15}/>} onClick={() => zoom(1 / 1.2)}/><span>{Math.round(view.zoom * 100)}%</span><Button aria-label="放大关系图" icon={<Plus size={15}/>} onClick={() => zoom(1.2)}/><Button aria-label="适应画布" icon={<Maximize size={15}/>} onClick={() => fit()}/></div>
        </div>
        <aside className="asset-graph-sidebar" aria-label="关系列表">
          <div className="asset-graph-sidebar-title"><GitBranch size={17}/><h2>{selectedAsset ? selectedAsset.name : "全部关系"}</h2><Tag>{listedRelations.length}</Tag></div>
          {selectedAsset && <div className="asset-graph-selected"><span>{assetCategoryLabel(selectedAsset.category)}</span><p>{selectedAsset.description || "选择关系可编辑名称与说明。"}</p><Button size="small" icon={<Plus size={14}/>} onClick={() => newRelation(selectedAsset.id)}>为此资产建立关系</Button><Button type="text" size="mini" onClick={() => setSelected(null)}>查看全部关系</Button></div>}
          <div className="asset-graph-relation-list">{listedRelations.map(relation => <article key={relation.id} className="asset-graph-relation-record"><div className="asset-graph-relation-names"><span>{assetMap.get(relation.source_asset_id)?.name}</span>{relation.directed ? <ArrowRight size={13}/> : <span>—</span>}<span>{assetMap.get(relation.target_asset_id)?.name}</span></div><strong>{relation.label}</strong>{relation.description && <p>{relation.description}</p>}<div><Button type="text" size="mini" icon={<Pencil size={13}/>} aria-label={`编辑关系 ${relation.label}`} onClick={() => editRelation(relation)}>编辑</Button><Button type="text" status="danger" size="mini" icon={<Trash2 size={13}/>} aria-label={`删除关系 ${relation.label}`} onClick={() => deleteRelation(relation)}>删除</Button></div></article>)}{!listedRelations.length && <div className="asset-graph-no-relations"><GitBranch size={30} strokeWidth={1.2}/><p>{relations.length && !visibleRelations.length ? "调整筛选以查看已有关系" : selectedAsset ? "此资产还没有关系" : "还没有建立关系"}</p><span>例如「魏来 — 兄妹 — 魏宁」<br/>或「魏来 → 故乡 → 魏来老家」</span></div>}</div>
          <p className="asset-graph-save-hint">关系保存后立即生效；调整位置后点击「保存布局」。</p>
        </aside>
      </div>
    </Spin>}
    <Modal visible={editing !== null} title={editing?.id ? "编辑资产关系" : "新建资产关系"} okText="保存关系" confirmLoading={relationBusy} onOk={saveRelation} onCancel={() => { if (!relationBusy) setEditing(null); }} maskClosable={!relationBusy} closable={!relationBusy} escToExit={!relationBusy} cancelButtonProps={{ disabled: relationBusy }} unmountOnExit>
      <Form layout="vertical" disabled={relationBusy}>
        <Form.Item label="起点资产" required><Select aria-label="起点资产" placeholder="选择资产" showSearch value={editing?.source_asset_id || undefined} options={relationOptions} onChange={source_asset_id => setEditing(current => current ? { ...current, source_asset_id } : null)}/></Form.Item>
        <Form.Item label="终点资产" required><Select aria-label="终点资产" placeholder="选择另一个资产" showSearch value={editing?.target_asset_id || undefined} options={relationOptions.filter(option => option.value !== editing?.source_asset_id)} onChange={target_asset_id => setEditing(current => current ? { ...current, target_asset_id } : null)}/></Form.Item>
        <Form.Item label="关系名称" required extra="例如：兄妹、故乡、居住于、持有"><Input aria-label="关系名称" maxLength={80} showWordLimit value={editing?.label || ""} placeholder="填写两个资产之间的关系" onChange={label => setEditing(current => current ? { ...current, label } : null)}/></Form.Item>
        <Form.Item><Checkbox checked={editing?.directed || false} onChange={directed => setEditing(current => current ? { ...current, directed } : null)}>有向关系</Checkbox><p className="helper">有向关系以箭头表示「起点 → 终点」，例如「魏来 → 居住于 → 魏来老家」。兄妹等对等关系可保持无方向。</p></Form.Item>
        <Form.Item label="关系说明"><Input.TextArea aria-label="关系说明" maxLength={2000} showWordLimit autoSize={{ minRows: 3, maxRows: 6 }} value={editing?.description || ""} placeholder="补充关系背景、故事变化或其他设定（选填）" onChange={description => setEditing(current => current ? { ...current, description } : null)}/></Form.Item>
        {formError && <p className="asset-graph-form-error" role="alert">{formError}</p>}
      </Form>
    </Modal>
  </section>;
}
