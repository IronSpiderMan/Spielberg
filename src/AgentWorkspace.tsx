import { Button, Input, Message, Modal, Select, Spin, Switch } from "@arco-design/web-react";
import { ArrowUp, ArrowUpRight, Clapperboard, Folder, PencilLine, Search, Bot, Check, ChevronDown, Globe, MessageSquare, Plus, Settings2, Sparkles, Square, Trash2, Wrench, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { imageUrl, post, type Media, type Snapshot } from "./core";
import "./agent.css";
import { uploadAsset } from "./api";
import { localId } from "./id";
import { ImagePreviewModal } from "./components/ImagePreviewModal";
import { backendUrl } from "./transport";

type AgentMessage = { role: "user" | "assistant" | "tool"; content: string; images?: string[]; tool_name?: string; tool_call_id?: string; arguments?: unknown; status?: string; tool_calls?: unknown[] };
type ConversationContext = { total_turns: number; recent_turns: number; summarized_turns: number; total_images: number; retained_images: number };
type Session = { id: string; title: string; status: string; messages: AgentMessage[]; error?: string; updated_at: string; context?: ConversationContext };
type Config = { inherit_llm: boolean; base_url: string; model: string; has_api_key: boolean; search_provider: string; has_search_api_key: boolean; max_steps: number; request_timeout_seconds: number };
const initialConfig: Config = { inherit_llm: true, base_url: "", model: "", has_api_key: false, search_provider: "duckduckgo", has_search_api_key: false, max_steps: 16, request_timeout_seconds: 600 };
const statusText: Record<string, string> = { idle: "准备就绪", running: "执行中", completed: "已完成", failed: "执行失败", cancelled: "已停止" };
const toolText: Record<string, string> = { get_project: "读取项目", search_conversation: "检索对话记录", list_skills: "查找技能", read_skill: "读取技能", app_describe: "查看操作说明", app_request: "操作项目数据", app_action: "执行创作操作", web_search: "联网搜索", fetch_webpage: "读取网页" };
function displayJson(value: unknown) { if (typeof value === "string") { try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; } } return JSON.stringify(value, null, 2); }

// Only generation output is eligible: reference images in arguments must never
// be presented as successful output. Bounded tool results may wrap data.
function generatedImages(message: AgentMessage): Media[] {
  if (message.status === "running" || message.status === "failed" || message.tool_name !== "app_action" ||
      !message.arguments || typeof message.arguments !== "object" ||
      (message.arguments as Record<string, unknown>).operation !== "generations/image") return [];
  try {
    const result = JSON.parse(message.content);
    const found = new Map<number, Media>();
    const visit = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) { value.forEach(visit); return; }
      const item = value as Record<string, unknown>;
      if (typeof item.id === "number" && item.kind === "image" && typeof item.path === "string" && item.path) {
        found.set(item.id, { id: item.id, kind: "image", path: item.path,
          name: typeof item.name === "string" ? item.name : "生成图片", created_at: typeof item.created_at === "string" ? item.created_at : "" });
        return;
      }
      Object.values(item).forEach(visit);
    };
    visit(result);
    return [...found.values()];
  } catch { return []; }
}

export default function AgentWorkspace({ data, reload, onNavigate }: { data: Snapshot; reload: () => Promise<void>; onNavigate?: (page: string) => void }) {
  const pid = data.project.id;
  const [preview, setPreview] = useState<Media | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selected, setSelected] = useState<Session | null>(null);
  const selectedRef = useRef<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [imageDrafts, setImageDrafts] = useState<Record<string, { url: string; mediaId: number }[]>>({});
  const [readingImages, setReadingImages] = useState(false);
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [creating, setCreating] = useState(false);
  const [online, setOnline] = useState(true);
  const [config, setConfig] = useState<Config>(initialConfig);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [form, setForm] = useState<Config>(initialConfig);
  const [apiKey, setApiKey] = useState("");
  const [searchKey, setSearchKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [mobileSessions, setMobileSessions] = useState(false);
  const mounted = useRef(true);
  const selectionVersion = useRef(0);
  const busy = useRef(false);
  const log = useRef<HTMLDivElement>(null);
  const followBottom = useRef(true);
  const composer = useRef<HTMLTextAreaElement>(null);
  const history = useRef<HTMLElement>(null);
  const historyTrigger = useRef<HTMLButtonElement>(null);
  const draftKey = selected?.id || "new";
  const draft = drafts[draftKey] || "";
  const images = imageDrafts[draftKey] || [];
  const pasting = useRef(false);
  const pasteImages = async (files: File[]) => {
    if (pasting.current || busy.current) return;
    const key = draftKey;
    if (files.length + images.length > 4) { Message.warning("每条消息最多 4 张图片"); return; }
    if (files.some(file => !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type) || file.size > 2 * 1024 * 1024)) { Message.warning("支持 PNG、JPEG、WebP、GIF，每张不超过 2 MB"); return; }
    pasting.current = true; setReadingImages(true);
    let count = 0;
    try {
      for (const file of files) {
        const url = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("读取图片失败")); reader.readAsDataURL(file); });
        const ext = ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" } as Record<string, string>)[file.type];
        const media = await uploadAsset<Media>(pid, new File([file], `Agent粘贴图片-${localId()}.${ext}`, { type: file.type }));
        count++;
        if (mounted.current) setImageDrafts(items => ({ ...items, [key]: [...(items[key] || []), { url, mediaId: media.id }].slice(0, 4) }));
      }
      if (count) Message.success(`已将 ${count} 张图片加入资产`);
    } catch (e) { Message.error(String(e)); } finally { if (count) { try { await reload(); } catch { Message.error("图片已加入资产，但列表刷新失败，请刷新页面"); } } pasting.current = false; if (mounted.current) setReadingImages(false); }
  };
  const running = selected?.status === "running";
  const configured = !!(config.base_url.trim() && config.model.trim());
  const anyRunning = sessions.some(item => item.status === "running");
  const updateDraft = (text: string) => setDrafts(items => ({ ...items, [draftKey]: text }));
  const call = useCallback(<T,>(action: string, payload: object = {}) => post<T>(`/agent/${action}`, { project_id: pid, ...payload }), [pid]);
  const accept = useCallback((session: Session) => {
    if (!mounted.current) return;
    if (selectedRef.current?.id === session.id && selectedRef.current.status === "running" && session.status !== "running") void reload().catch(() => {});
    selectedRef.current = session; setSelected(session);
    setSessions(items => [session, ...items.filter(item => item.id !== session.id)]);
    localStorage.setItem(`spielberg-agent-session-${pid}`, session.id);
  }, [pid, reload]);
  const choose = async (summary: Session) => {
    const version = ++selectionVersion.current;
    selectedRef.current = summary; setSelected(summary); setLoading(true); setError(""); setMobileSessions(false); followBottom.current = true;
    try { const session = await call<Session>("session", { session_id: summary.id }); if (mounted.current && version === selectionVersion.current) accept(session); }
    catch (e) { if (mounted.current && version === selectionVersion.current) setError(String(e)); }
    finally { if (mounted.current && version === selectionVersion.current) setLoading(false); }
  };
  useEffect(() => {
    mounted.current = true;
    void Promise.all([call<{ items: Session[] }>("sessions"), call<Config>("config")]).then(async ([list, cfg]) => {
      if (!mounted.current) return;
      setSessions(list.items); setConfig(cfg);
      const previous = localStorage.getItem(`spielberg-agent-session-${pid}`);
      const summary = list.items.find(item => item.id === previous) || list.items[0];
      if (summary) { selectedRef.current = summary; const detail = await call<Session>("session", { session_id: summary.id }); if (mounted.current) accept(detail); }
    }).catch(e => { if (mounted.current) setError(String(e)); }).finally(() => { if (mounted.current) setLoading(false); });
    return () => { mounted.current = false; selectionVersion.current++; };
  }, [call, pid, accept]);
  useEffect(() => {
    if (!anyRunning && !running) return;
    let disposed = false; let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const current = selectedRef.current?.id;
      const version = selectionVersion.current;
      try {
        const [list, detail] = await Promise.all([call<{ items: Session[] }>("sessions"), current ? call<Session>("session", { session_id: current }) : Promise.resolve(null)]);
        if (disposed || !mounted.current) return;
        if (version === selectionVersion.current) {
          setError(""); setSessions(list.items);
          if (detail && selectedRef.current?.id === current) accept(detail);
        }
      } catch (e) { if (!disposed && mounted.current) setError(String(e)); }
      if (!disposed) timer = setTimeout(poll, 1200);
    };
    timer = setTimeout(poll, 500);
    return () => { disposed = true; clearTimeout(timer); };
  }, [anyRunning, running, call, accept]);
  useEffect(() => { if (followBottom.current && log.current) log.current.scrollTop = log.current.scrollHeight; }, [selected?.messages, selected?.id, running]);
  useEffect(() => {
    if (!mobileSessions) return;
    const panel = history.current;
    const focusable = () => Array.from(panel?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setMobileSessions(false); }
      if (event.key === "Tab") {
        const buttons = focusable(); const first = buttons[0]; const last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    const onResize = () => { if (window.innerWidth > 800) setMobileSessions(false); };
    document.addEventListener("keydown", onKeyDown); window.addEventListener("resize", onResize);
    return () => { document.removeEventListener("keydown", onKeyDown); window.removeEventListener("resize", onResize); if (window.innerWidth <= 800) historyTrigger.current?.focus(); };
  }, [mobileSessions]);

  const createSession = async () => {
    if (busy.current || creating) return;
    setCreating(true); setError(""); const version = ++selectionVersion.current;
    try { const session = await call<Session>("create"); if (mounted.current && version === selectionVersion.current) { accept(session); setMobileSessions(false); followBottom.current = true; composer.current?.focus(); } }
    catch (e) { if (mounted.current) setError(String(e)); }
    finally { if (mounted.current) setCreating(false); }
  };
  const send = async () => {
    const text = draft.trim(); if ((!text && !images.length) || readingImages || pasting.current || busy.current || running || loading || creating) return;
    if (!configured) { openSettings(); return; }
    busy.current = true; setSending(true); setError(""); const version = ++selectionVersion.current; const key = draftKey;
    try {
      const session = selectedRef.current || await call<Session>("create");
      const result = await call<Session>("run", { session_id: session.id, message: text, images: images.map(image => image.url), image_media_ids: images.map(image => image.mediaId), web_enabled: online });
      if (!mounted.current) return;
      setImageDrafts(items => ({ ...items, [key]: [] }));
      setDrafts(items => ({ ...items, [key]: items[key] === text || items[key]?.trim() === text ? "" : items[key] }));
      if (version === selectionVersion.current) { followBottom.current = true; accept(result); }
      else setSessions(items => [result, ...items.filter(item => item.id !== result.id)]);
    } catch (e) { if (mounted.current) setError(String(e)); }
    finally { busy.current = false; if (mounted.current) setSending(false); }
  };
  const stop = async () => {
    const id = selectedRef.current?.id; if (!id || stopping) return; selectionVersion.current++; setStopping(true);
    try { const result = await call<Session>("cancel", { session_id: id }); if (mounted.current && selectedRef.current?.id === id) accept(result); }
    catch (e) { if (mounted.current) setError(String(e)); } finally { if (mounted.current) setStopping(false); }
  };
  const remove = (session: Session) => Modal.confirm({ title: "删除此会话？", content: "删除对话和执行记录，已完成的项目操作会保留。", okText: "删除", cancelText: "取消", onOk: async () => {
    try { await call("delete", { session_id: session.id }); if (!mounted.current) return; setSessions(items => items.filter(item => item.id !== session.id)); if (selectedRef.current?.id === session.id) { selectionVersion.current++; selectedRef.current = null; setSelected(null); localStorage.removeItem(`spielberg-agent-session-${pid}`); } }
    catch (e) { Message.error(String(e)); }
  } });
  const openSettings = () => { setForm({ ...config }); setApiKey(""); setSearchKey(""); setSettingsOpen(true); };
  const saveSettings = async () => {
    if (saving) return;
    if (!form.inherit_llm && (!form.base_url.trim() || !form.model.trim())) { Message.warning("请填写 Base URL 和模型名称"); return; }
    setSaving(true);
    try { const saved = await call<Config>("config/save", { config: { ...form, api_key: apiKey, search_api_key: searchKey } }); if (mounted.current) { setConfig(saved); setSettingsOpen(false); setApiKey(""); setSearchKey(""); Message.success("Agent 设置已保存"); } }
    catch (e) { Message.error(String(e)); } finally { if (mounted.current) setSaving(false); }
  };

  const empty = !loading && !selected?.messages.length;

  return <section className="agent-workspace" data-testid="agent-workspace">
    <div className="agent-layout">
      {mobileSessions && <button className="agent-history-backdrop" tabIndex={-1} aria-label="关闭会话列表" onClick={() => setMobileSessions(false)} />}
      <aside ref={history} id="agent-history" className={`agent-history${mobileSessions ? " is-open" : ""}`} aria-label="Agent 会话" role={mobileSessions ? "dialog" : undefined} aria-modal={mobileSessions || undefined}>
        <button className="agent-project-picker" title={`切换项目：${data.project.name}`} onClick={() => onNavigate?.("projects")}><span className="agent-project-icon"><Folder size={19} /></span><span className="agent-project-copy"><strong>{data.project.name}</strong><small><i className="agent-status-dot" />本地项目</small></span><ChevronDown size={14} /></button>
        <Button long data-testid="agent-new-session" icon={<Plus size={16} />} loading={creating} disabled={loading || sending} onClick={() => void createSession()}>新建会话</Button>
        <div className="agent-history-heading"><span>项目会话 <small>{sessions.length}</small></span><Button size="mini" type="text" className="agent-mobile-history" aria-label="关闭会话列表" icon={<X size={16} />} onClick={() => setMobileSessions(false)} /></div>
        <div className="agent-session-list">{sessions.length === 0 && <div className="agent-history-empty"><MessageSquare size={28} /><b>暂无会话</b><p>开始创作后，会话将保存在这里</p></div>}{sessions.map(session => <div className={`agent-session${selected?.id === session.id ? " is-selected" : ""}`} key={session.id}>
          <button data-testid={`agent-session-${session.id}`} className="agent-session-select" title={session.title} aria-current={selected?.id === session.id ? "page" : undefined} onClick={() => void choose(session)} disabled={creating}><MessageSquare size={15} /><span><strong>{session.title}</strong><small data-status={session.status}>{statusText[session.status] || session.status}</small></span></button>
          <button type="button" className="agent-delete" aria-label={`删除会话 ${session.title}`} disabled={session.status === "running" || sending} onClick={() => remove(session)}><Trash2 size={14} /></button>
        </div>)}</div>
        <div className="agent-history-footer"><Clapperboard size={15} /><span>每个好故事，都始于一次对话</span></div>
      </aside>
      <div className={`agent-conversation${empty ? " is-empty" : ""}`}>
        <div className="agent-conversation-bar"><div><Button ref={historyTrigger} className="agent-mobile-history" aria-label="打开会话列表" aria-controls="agent-history" aria-expanded={mobileSessions} icon={<MessageSquare size={16} />} onClick={() => setMobileSessions(value => !value)} /><span className="agent-bar-label">创作助手</span><span className="agent-bar-separator">/</span><b>{selected?.title || "新对话"}</b></div><div className="agent-conversation-actions">{running && <span><i className="agent-status-dot" />正在执行</span>}<Button type="text" data-testid="agent-settings" aria-label="Agent 设置" icon={<Settings2 size={15} />} onClick={openSettings}>Agent 设置</Button></div></div>
        {!configured && !loading && <div className="agent-config-notice">配置支持工具调用的 LLM 后，即可开始使用。<button onClick={openSettings}>配置 Agent</button>{onNavigate && <button onClick={() => onNavigate("settings")}>打开项目设置</button>}</div>}
        <div className="agent-stage">
        {!loading && !!selected?.context?.summarized_turns && <div className="agent-memory-notice" data-testid="agent-memory-notice"><MessageSquare size={14} aria-hidden="true" /><span>保留近期 {selected.context.recent_turns} 轮对话，较早 {selected.context.summarized_turns} 轮已整理为摘录；助手可按需检索原记录。</span></div>}
        <div className="agent-messages" ref={log} role="log" aria-label="Agent 对话记录" aria-busy={running || loading} onScroll={() => { const element = log.current; if (element) followBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100; }}>
          {loading ? <div className="agent-loading"><Spin /><span>正在读取会话</span></div> : !selected?.messages.length ? <div className="agent-empty">
            <div className="agent-empty-mark" aria-hidden="true"><Clapperboard size={28} strokeWidth={1.5} /><Sparkles size={13} /></div>
            <span className="agent-empty-eyebrow">灵感就位，即刻开场</span>
            <h2>下一幕，从这里开始<span>。</span></h2><p>从一个想法到一个好故事，和你的 AI 创作搭档一起完成。</p>
          </div> : selected.messages.map((message, index) => message.role === "tool" ? <div className="agent-tool-result" key={`${message.tool_call_id || index}:${index}`}><details className="agent-tool">
            <summary><Wrench size={14} /><span>{toolText[message.tool_name || ""] || message.tool_name || "执行工具"}</span><small>{message.arguments && typeof message.arguments === "object" ? String((message.arguments as Record<string, unknown>).operation || (message.arguments as Record<string, unknown>).resource || "") : ""}</small><span className={`agent-tool-status ${message.status}`}>{message.status === "running" ? "执行中" : message.status === "failed" ? "失败" : <><Check size={12} />完成</>}</span><ChevronDown size={14} /></summary>
            {message.arguments != null && <div><b>参数</b><pre>{displayJson(message.arguments)}</pre></div>}<div><b>结果</b><pre>{message.content ? displayJson(message.content) : "等待执行结果…"}</pre></div>
          </details>
          {generatedImages(message).length > 0 && <div className="agent-generated-images">{generatedImages(message).map(media => <button type="button" key={media.id} onClick={() => setPreview(media)} aria-label={`预览 ${media.name}`}><img src={imageUrl(media)} alt={media.name} onLoad={() => { if (followBottom.current && log.current) log.current.scrollTop = log.current.scrollHeight; }} /><span>{media.name}</span></button>)}</div>}
          </div> : message.content || message.images?.length ? <article className={`agent-message is-${message.role}`} key={index}>
            <div className="agent-message-label">{message.role === "user" ? "你" : <><Bot size={15} />Agent</>}</div><div className="agent-message-content">{message.role === "user" ? <>{message.images?.map((image, i) => <a key={i} href={image} target="_blank" rel="noopener noreferrer"><img className="agent-message-image" src={image} alt={`附件图片 ${i + 1}`} /></a>)}{message.content && <p>{message.content}</p>}</> : <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ children, href, ...props }) => <a {...props} href={href?.startsWith("/api/v1/") ? backendUrl(href) : href} target="_blank" rel="noopener noreferrer">{children}</a> }}>{message.content}</ReactMarkdown>}</div>
          </article> : null)}
          {running && <div className="agent-working"><span className="agent-pulse" /><span>Agent 正在处理项目，可以查看上方执行详情。</span></div>}
          {(error || selected?.error) && <div className="agent-error" role="alert">{error || selected?.error}</div>}
        </div>
        <div className="agent-composer-wrap">
          <div className="agent-composer">
            <div className="agent-composer-context"><Folder size={12} /><span>{data.project.name}</span><span className="agent-context-label">项目上下文</span></div>
            {!!images.length && <div className="agent-image-previews">{images.map((image, i) => <div key={i}><img src={image.url} alt={`待发送图片 ${i + 1}（已加入资产）`} /><button type="button" aria-label={`移除图片 ${i + 1}`} disabled={sending} onClick={() => setImageDrafts(items => ({ ...items, [draftKey]: images.filter((_, index) => index !== i) }))}><X size={14} /></button></div>)}</div>}
            <textarea ref={composer} data-testid="agent-composer" aria-label="向 Agent 发送消息" value={draft} maxLength={16000} disabled={loading || sending || creating} placeholder="写下一个灵感，或粘贴图片告诉我你想完成什么…" onPaste={event => { if (readingImages) return; const files = Array.from(event.clipboardData.items).filter(item => item.type.startsWith("image/")).map(item => item.getAsFile()).filter((file): file is File => !!file); if (files.length) { event.preventDefault(); void pasteImages(files); } }} onChange={event => updateDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
            <div className="agent-composer-actions"><label className={`agent-web-toggle${online ? " is-online" : ""}`}><Globe size={14} /><span>联网搜索</span><Switch size="small" checked={online} onChange={setOnline} disabled={running || sending} aria-label="联网搜索" /></label><Button className="agent-model-button" title={config.model || "配置模型"} onClick={openSettings}><span>{config.model || "配置模型"}</span><ChevronDown size={13} /></Button>{running ? <Button data-testid="agent-stop" aria-label="停止执行" status="danger" icon={<Square size={14} />} loading={stopping} onClick={() => void stop()}>停止</Button> : <Button type="primary" data-testid="agent-send" aria-label="发送消息" icon={<ArrowUp size={19} />} loading={sending} disabled={(!draft.trim() && !images.length) || readingImages || loading || creating} onClick={() => void send()} />}</div>
          </div>
          {empty && <>
            <div className="agent-starters-heading">也可以从这里开始</div>
            <div className="agent-starters">{[
              ["整理项目", "梳理进度，找到下一步", "查看当前项目，整理剧本、角色、剧集和场景的制作进度，并提出下一步建议。"],
              ["开始一个故事", "让一个灵感，长成剧本", "写一个雨夜车站重逢的短片剧本，创建主要角色，并建立第一集和三个场景。"],
              ["搜索创作参考", "发现镜头、光影与灵感", "联网搜索电影雨夜车站场景的灯光和镜头参考，注明来源，并把可用的创作提示词保存到 Prompt 库。"],
            ].map(([label, description, text]) => <button key={label} onClick={() => { updateDraft(text); composer.current?.focus(); }}><span className="agent-starter-icon">{label === "搜索创作参考" ? <Search size={17} /> : label === "整理项目" ? <Folder size={17} /> : <PencilLine size={17} />}</span><span className="agent-starter-copy"><strong>{label}</strong><small>{description}</small></span><ArrowUpRight className="agent-starter-arrow" size={15} /></button>)}</div>
          <p className="agent-keyboard-hint"><kbd>Enter</kbd> 发送<span>·</span><kbd>Shift + Enter</kbd> 换行</p></>}
        </div>
        </div>
      </div>
    </div>
    <ImagePreviewModal media={preview} onClose={() => setPreview(null)} />
    <Modal title="Agent 设置" visible={settingsOpen} onCancel={() => !saving && setSettingsOpen(false)} onOk={() => void saveSettings()} okText="保存设置" cancelText="取消" confirmLoading={saving} maskClosable={!saving} style={{ width: 580 }} className="agent-settings-modal">
      <div className="agent-settings-form"><label className="agent-inherit"><span><b>沿用项目 LLM 配置</b><small>使用「设置」中的 LLM（分镜与 Prompt）服务。</small></span><Switch aria-label="沿用项目 LLM 配置" checked={form.inherit_llm} onChange={value => setForm(item => ({ ...item, inherit_llm: value }))} disabled={saving} /></label>
        <label>Base URL<Input aria-label="Base URL" value={form.base_url} disabled={form.inherit_llm || saving} placeholder="https://your-service.example/v1" onChange={value => setForm(item => ({ ...item, base_url: value }))} /></label>
        <label>模型名称<Input aria-label="模型名称" value={form.model} disabled={form.inherit_llm || saving} placeholder="支持函数工具调用的模型名称" onChange={value => setForm(item => ({ ...item, model: value }))} /></label>
        {!form.inherit_llm && <label>API Key<Input.Password aria-label="API Key" value={apiKey} disabled={saving} placeholder="独立服务 Key；留空保留 Agent 已存 Key" onChange={setApiKey} /></label>}
        <div className="agent-settings-divider" /><label>搜索服务<Select aria-label="搜索服务" value={form.search_provider} disabled={saving} options={[{ label: "自动搜索 · DuckDuckGo / Bing（无需 Key）", value: "duckduckgo" }, { label: "Brave Search", value: "brave" }, { label: "Tavily", value: "tavily" }]} onChange={value => setForm(item => ({ ...item, search_provider: value }))} /></label>
        {form.search_provider !== "duckduckgo" && <label>搜索 API Key<Input.Password aria-label="搜索 API Key" value={searchKey} disabled={saving} placeholder={config.has_search_api_key ? "已保存，留空保留" : "输入搜索服务 API Key"} onChange={setSearchKey} /></label>}
        <label>模型请求等待时间（秒）<input aria-label="模型请求等待时间（秒）" type="number" min={30} max={1800} value={form.request_timeout_seconds ?? 600} disabled={saving} onChange={event => setForm(item => ({ ...item, request_timeout_seconds: Math.min(1800, Math.max(30, Number(event.target.value) || 30)) }))} /></label>
        <label>最多执行步数<input aria-label="最多执行步数" type="number" min={1} max={64} value={form.max_steps} disabled={saving} onChange={event => setForm(item => ({ ...item, max_steps: Math.min(64, Math.max(1, Number(event.target.value) || 1)) }))} /></label>
        <p>模型服务需要支持 OpenAI Chat Completions 工具调用。项目内容和检索资料会发送至该服务；密钥仅保存在后端。停止后已完成的修改会保留，正在执行的生成或导出可能继续完成。</p>
      </div>
    </Modal>
  </section>;
}
