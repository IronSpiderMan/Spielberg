import { confirmAction } from "./components/ConfirmAction";
import { Button, Input, Message, Modal, Select, Spin, Switch } from "@arco-design/web-react";
import { ArrowUp, ArrowUpRight, CircleAlert, LoaderCircle, Pause, Circle, Clapperboard, Folder, PencilLine, Search, Bot, Check, ChevronDown, Globe, MessageSquare, Plus, Settings2, Sparkles, Square, Trash2, Wrench, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { imageUrl, post, type Media, type ModelSettings, type Snapshot } from "./core";
import "./agent.css";
import { uploadMedia } from "./api";
import { localId } from "./id";
import { ImagePreviewModal } from "./components/ImagePreviewModal";
import { VideoPreviewModal } from "./components/VideoPreviewModal";
import { AgentMediaPreview } from "./components/AgentMediaPreview";
import { toolMedia, conversationImages, attachmentImage, mediaFromUrl } from "./agentImages";
import { backendUrl } from "./transport";
import { AGENT_SESSION_CHANGED, notifyAgentSessionChanged, type AgentSessionChange } from "./agent-session-events";
import { GenerationSelector } from "./components/generation/GenerationSelector";
import { channelsFor, selectionPayload, useGenerationSelection } from "./generation-channels";
import { AgentUserInput, type UserInputRequest, type UserInputAnswers } from "./components/AgentUserInput";
import { AgentComposerInput } from "./components/AgentComposerInput";
import { agentMentions, referencedIn, type AgentReference } from "./agent-mentions";


type AgentMessage = { role: "user" | "assistant" | "tool"; content: string; images?: string[]; image_media_ids?: number[]; tool_name?: string; tool_call_id?: string; arguments?: unknown; status?: string; tool_calls?: unknown[] };
type MessageEntry = { message: AgentMessage; index: number; tools: AgentMessage[] };
type Draft = { text: string; references: AgentReference[] };
const emptyDraft: Draft = { text: "", references: [] };
// Empty assistant tool-call envelopes do not break a visible run of operations.
function messageEntries(messages: AgentMessage[]): MessageEntry[] {
  const entries: MessageEntry[] = [];
  messages.forEach((message, index) => {
    if (message.role !== "tool" && !message.content && !message.images?.length && message.status !== "streaming" && message.status !== "interrupted") return;
    const previous = entries[entries.length - 1];
    if (message.role === "tool" && previous?.tools.length) previous.tools.push(message);
    else entries.push({ message, index, tools: message.role === "tool" ? [message] : [] });
  });
  return entries;
}

type ConversationContext = { total_turns: number; recent_turns: number; summarized_turns: number; total_images: number; retained_images: number; active_compacted_messages?: number; estimated_text_bytes?: number };
type PlanStep = { step: string; status: "pending" | "in_progress" | "completed" };
type Execution = { active?: boolean; phase?: string; tool_calls?: number; max_steps?: number; retries?: number; active_tool?: string; plan?: PlanStep[]; stop_reason?: string; user_input?: UserInputRequest; user_input_response?: unknown };
type Session = { id: string; title: string; status: string; messages: AgentMessage[]; error?: string; updated_at: string; context?: ConversationContext; execution?: Execution };
type Config = { inherit_llm: boolean; base_url: string; model: string; has_api_key: boolean; search_provider: string; has_search_api_key: boolean; max_steps: number; max_steps_limit?: number; request_timeout_seconds: number };
const initialConfig: Config = { inherit_llm: true, base_url: "", model: "", has_api_key: false, search_provider: "duckduckgo", has_search_api_key: false, max_steps: 16, request_timeout_seconds: 600 };
const INDEPENDENT_CHANNEL = "__agent_independent__";
const statusText: Record<string, string> = { idle: "准备就绪", running: "执行中", completed: "本轮结束", limited: "已暂停，可继续", failed: "执行失败", cancelled: "已停止" };
const toolText: Record<string, string> = { request_user_input: "请求用户决定", update_plan: "更新任务计划", get_project: "读取项目", search_conversation: "检索对话记录", list_skills: "查找技能", read_skill: "读取技能", app_describe: "查看操作说明", app_request: "操作项目数据", app_action: "执行创作操作", web_search: "联网搜索", fetch_webpage: "读取网页" };
const toolTargetText: Record<string, string> = {
  assets: "资产库", media: "素材库", episodes: "剧集", scenes: "场景", clips: "片段", prompts: "提示词", screenplays: "剧本",
  "assets/media/add": "关联资产图片", "assets/media/delete": "解除资产图片关联",
  "assets/audio/save": "保存资产音频引用", "assets/audio/delete": "解除资产音频关联",
  "generations/image": "生成图片", "generations/video": "生成视频", "generations/scene-video": "生成一镜到底", "generations/clip-preview": "预览片段生成", "generations/scene-preview": "预览场景生成", "generations/tts": "合成配音", "generations/asr": "识别语音",
};
function toolTarget(args: unknown): string {
  if (!args || typeof args !== "object") return "";
  const fields = args as Record<string, unknown>;
  const target = String(fields.operation || fields.resource || "");
  return toolTargetText[target] || target;
}
const phaseText: Record<string, string> = { waiting_input: "等待你的回答", thinking: "正在整理下一步", streaming: "正在回复", stopping: "正在停止，等待当前操作结束", retrying: "模型服务暂时不可用，正在重试", finalizing: "正在整理执行结果", tool: "正在执行操作" };
function displayJson(value: unknown) { if (typeof value === "string") { try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; } } return JSON.stringify(value, null, 2); }
function hasActiveRun(session: Session | null): boolean { return session?.execution?.active ?? session?.status === "running"; }
function sessionStatus(session: Session): string { if (hasActiveRun(session) && session.execution?.phase === "waiting_input") return "等待回答"; return hasActiveRun(session) ? (session.status === "cancelled" ? "正在停止" : "执行中") : statusText[session.status] || session.status; }
function SessionStatusIcon({ session }: { session: Session }) {
  const status = hasActiveRun(session) ? session.execution?.phase === "waiting_input" ? "waiting_input" : "running" : session.status;
  const Icon = ({ waiting_input: MessageSquare, running: LoaderCircle, completed: Circle, limited: Pause, failed: CircleAlert, cancelled: Square } as Record<string, typeof Check>)[status] || Circle;
  return <span className="agent-session-state" data-status={status} title={sessionStatus(session)} role="img" aria-label={sessionStatus(session)}><Icon size={15} aria-hidden="true" /></span>;
}

function updateSession(items: Session[], session: Session): Session[] {
  return items.some(item => item.id === session.id)
    ? items.map(item => item.id === session.id ? session : item)
    : [session, ...items];
}

export default function AgentWorkspace({ data, reload, onNavigate }: { data: Snapshot; reload: () => Promise<void>; onNavigate?: (page: string) => void }) {
  const pid = data.project.id;
  const currentMedia = useMemo(() => new Map(data.media.map(media => [media.id, media])), [data.media]);
  const [preview, setPreview] = useState<Media | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selected, setSelected] = useState<Session | null>(null);
  const gallery = useMemo(() => conversationImages(selected?.messages || [], currentMedia, pid), [selected?.messages, currentMedia, pid]);
  useEffect(() => setPreview(null), [selected?.id]);
  const selectedRef = useRef<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [imageDrafts, setImageDrafts] = useState<Record<string, { url: string; mediaId: number }[]>>({});
  const [readingImages, setReadingImages] = useState(false);
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [creating, setCreating] = useState(false);
  const [online, setOnline] = useState(true);
  const [config, setConfig] = useState<Config>(initialConfig);
  const modelSettings = useMemo<ModelSettings>(() => {
    if (config.inherit_llm || !config.base_url.trim() || !config.model.trim()) return data.settings;
    // Offer the existing independent Agent service alongside the shared channels.
    // Its credentials stay in the backend; choosing it uses the saved Agent config.
    return { ...data.settings, llm: { ...data.settings.llm, default_channel_id: INDEPENDENT_CHANNEL, channels: [
      { id: INDEPENDENT_CHANNEL, name: "Agent 独立配置", provider: "openai", base_url: config.base_url, api_key: "", default_model_id: config.model, models: [{ id: config.model, name: config.model, profile: "openai-chat" }] },
      ...channelsFor(data.settings, "llm"),
    ] } };
  }, [data.settings, config.inherit_llm, config.base_url, config.model]);
  const modelSelection = useGenerationSelection(modelSettings, "llm", "chat");
  useEffect(() => modelSelection.setValue({}), [pid]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [form, setForm] = useState<Config>(initialConfig);
  const [searchKey, setSearchKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [mobileSessions, setMobileSessions] = useState(false);
  const mounted = useRef(true);
  const selectionVersion = useRef(0);
  const busy = useRef(false);
  const log = useRef<HTMLDivElement>(null);
  const followBottom = useRef(true);
  const followMedia = () => { if (followBottom.current && log.current) log.current.scrollTop = log.current.scrollHeight; };
  const composer = useRef<HTMLTextAreaElement>(null);
  const history = useRef<HTMLElement>(null);
  const historyTrigger = useRef<HTMLButtonElement>(null);
  const draftKey = selected?.id || "new";
  const { text: draft, references } = drafts[draftKey] || emptyDraft;
  const mentions = useMemo(() => agentMentions(data.assets, data.episodes, references), [data.assets, data.episodes, references]);
  const images = imageDrafts[draftKey] || [];
  const pasting = useRef(false);
  const pasteImages = async (files: File[]) => {
    if (pasting.current || busy.current) return;
    const key = draftKey;
    if (files.length + images.length > 4) { Message.warning("每条消息最多 4 张图片"); return; }
    if (files.some(file => !["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"].includes(file.type) || file.size > 2 * 1024 * 1024)) { Message.warning("支持 PNG、JPEG、WebP、GIF、SVG，每张不超过 2 MB"); return; }
    pasting.current = true; setReadingImages(true);
    let count = 0;
    try {
      for (const file of files) {
        const url = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("读取图片失败")); reader.readAsDataURL(file); });
        const ext = ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg" } as Record<string, string>)[file.type];
        const media = await uploadMedia<Media>(pid, new File([file], `Agent粘贴图片-${localId()}.${ext}`, { type: file.type }));
        count++;
        if (mounted.current) setImageDrafts(items => ({ ...items, [key]: [...(items[key] || []), { url, mediaId: media.id }].slice(0, 4) }));
      }
      if (count) Message.success(`已将 ${count} 张图片加入素材`);
    } catch (e) { Message.error(String(e)); } finally { if (count) { try { await reload(); } catch { Message.error("图片已加入素材，但列表刷新失败，请刷新页面"); } } pasting.current = false; if (mounted.current) setReadingImages(false); }
  };
  const running = hasActiveRun(selected);
  const cancelling = running && (selected?.status === "cancelled" || selected?.execution?.phase === "stopping");
  const execution = selected?.execution;
  const configured = !!modelSelection.choice;
  const anyRunning = sessions.some(hasActiveRun);
  const updateDraft = (text: string, mention?: AgentReference) => setDrafts(items => {
    const previous = (items[draftKey] || emptyDraft).references;
    const selected = mention ? [...previous.filter(item => item.name !== mention.name), mention] : previous;
    return { ...items, [draftKey]: { text, references: referencedIn(text, selected) } };
  });
  const call = useCallback(<T,>(action: string, payload: object = {}) => post<T>(`/agent/${action}`, { project_id: pid, ...payload }), [pid]);
  const accept = useCallback((session: Session) => {
    if (!mounted.current) return;
    const previous = selectedRef.current;
    if (selectedRef.current?.id === session.id && hasActiveRun(selectedRef.current) && !hasActiveRun(session)) void reload().catch(() => {});
    selectedRef.current = session; setSelected(session);
    setSessions(items => updateSession(items, session));
    localStorage.setItem(`spielberg-agent-session-${pid}`, session.id);
    if (previous?.id !== session.id || previous?.status !== session.status || previous?.execution?.phase !== session.execution?.phase || hasActiveRun(previous) !== hasActiveRun(session)) notifyAgentSessionChanged(pid, session.id, "workspace");
  }, [pid, reload]);
  useEffect(() => {
    let disposed = false;
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<AgentSessionChange>).detail;
      if (detail.source === "workspace" || detail.projectId !== pid) return;
      const version = selectionVersion.current;
      void call<{ items: Session[] }>("sessions").then(list => { if (!disposed) setSessions(list.items); }).catch(() => {});
      if (selectedRef.current?.id === detail.sessionId) {
        void call<Session>("session", { session_id: detail.sessionId }).then(next => {
          if (!disposed && version === selectionVersion.current && selectedRef.current?.id === next.id) accept(next);
        }).catch(() => {});
      }
    };
    window.addEventListener(AGENT_SESSION_CHANGED, changed);
    return () => { disposed = true; window.removeEventListener(AGENT_SESSION_CHANGED, changed); };
  }, [pid, call, accept]);
  const choose = async (summary: Session, keepHistoryOpen = false) => {
    if (selectedRef.current?.id === summary.id && !error) return;
    const version = ++selectionVersion.current;
    selectedRef.current = summary; setSelected(summary); setLoading(true); setLoadFailed(false); setError(""); if (!keepHistoryOpen) setMobileSessions(false); followBottom.current = true;
    try { const session = await call<Session>("session", { session_id: summary.id }); if (mounted.current && version === selectionVersion.current) accept(session); }
    catch (e) { if (mounted.current && version === selectionVersion.current) { setError(String(e)); setLoadFailed(true); } }
    finally { if (mounted.current && version === selectionVersion.current) setLoading(false); }
  };
  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    const version = selectionVersion.current;
    setLoading(true); setLoadFailed(false); setError("");
    void Promise.all([call<{ items: Session[] }>("sessions"), call<Config>("config")]).then(async ([list, cfg]) => {
      if (disposed || !mounted.current || version !== selectionVersion.current) return;
      setSessions(list.items); setConfig(cfg);
      const previous = localStorage.getItem(`spielberg-agent-session-${pid}`);
      const summary = list.items.find(item => item.id === previous) || list.items[0];
      if (summary) { selectedRef.current = summary; setSelected(summary); const detail = await call<Session>("session", { session_id: summary.id }); if (!disposed && mounted.current && version === selectionVersion.current) accept(detail); }
      else { selectedRef.current = null; setSelected(null); }
    }).catch(e => { if (!disposed && mounted.current && version === selectionVersion.current) { setError(String(e)); setLoadFailed(true); } }).finally(() => { if (!disposed && mounted.current && version === selectionVersion.current) setLoading(false); });
    return () => { disposed = true; mounted.current = false; selectionVersion.current++; };
  }, [call, pid, accept, loadAttempt]);
  useEffect(() => {
    if ((!anyRunning && !running) || loading || loadFailed) return;
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
      } catch (e) { if (!disposed && mounted.current && version === selectionVersion.current) setError(String(e)); }
      if (!disposed) timer = setTimeout(poll, 1200);
    };
    timer = setTimeout(poll, 500);
    return () => { disposed = true; clearTimeout(timer); };
  }, [anyRunning, running, loading, loadFailed, call, accept]);
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
    if (busy.current || creating || loading || loadFailed) return;
    setCreating(true); setError(""); const version = ++selectionVersion.current;
    try { const session = await call<Session>("create"); if (mounted.current && version === selectionVersion.current) { accept(session); setMobileSessions(false); followBottom.current = true; composer.current?.focus(); } }
    catch (e) { if (mounted.current && version === selectionVersion.current) setError(String(e)); }
    finally { if (mounted.current) setCreating(false); }
  };
  const send = async () => {
    const text = draft.trim(); if ((!text && !images.length) || readingImages || pasting.current || busy.current || running || loading || loadFailed || creating) return;
    if (!configured) { if (channelsFor(modelSettings, "llm").length) Message.warning("请选择渠道与模型"); else { Message.warning("请先在统一渠道配置中添加支持工具调用的模型"); onNavigate?.("settings"); } return; }
    busy.current = true; setSending(true); setError(""); const version = ++selectionVersion.current; const sourceKey = draftKey;
    try {
      let session = selectedRef.current;
      if (!session) {
        const created = await call<Session>("create");
        // Keep the new session and its draft even when starting the run fails.
        // A retry must use this session instead of creating another empty one.
        if (mounted.current) {
          const id = created.id;
          setDrafts(items => ({ ...items, [id]: items[sourceKey] || emptyDraft, [sourceKey]: emptyDraft }));
          setImageDrafts(items => ({ ...items, [id]: items[sourceKey] || [], [sourceKey]: [] }));
          if (version === selectionVersion.current) accept(created);
          else setSessions(items => updateSession(items, created));
        }
        session = created;
      }
      const key = session.id;
      const model = modelSelection.choice?.channel.id === INDEPENDENT_CHANNEL ? {} : selectionPayload(modelSelection.choice);
      const result = await call<Session>("run", { session_id: session.id, message: text, ...(references.length ? { references } : {}), images: images.map(image => image.url), image_media_ids: images.map(image => image.mediaId), web_enabled: online, ...model });
      if (!mounted.current) return;
      setImageDrafts(items => ({ ...items, [key]: [] }));
      setDrafts(items => ({ ...items, [key]: items[key]?.text.trim() === text ? emptyDraft : items[key] }));
      if (version === selectionVersion.current) { followBottom.current = true; accept(result); }
      else setSessions(items => updateSession(items, result));
    } catch (e) { if (mounted.current && version === selectionVersion.current) setError(String(e)); }
    finally { busy.current = false; if (mounted.current) setSending(false); }
  };
  const stop = async () => {
    const id = selectedRef.current?.id; if (!id || stopping || cancelling) return;
    const version = ++selectionVersion.current; setStopping(true); setError("");
    try {
      const result = await call<Session>("cancel", { session_id: id });
      if (!mounted.current) return;
      if (version === selectionVersion.current && selectedRef.current?.id === id) { accept(result); setLoading(false); setLoadFailed(false); }
      else setSessions(items => updateSession(items, result));
    } catch (e) { if (mounted.current && version === selectionVersion.current) { setError(String(e)); setLoading(false); setLoadFailed(loading); } }
    finally { if (mounted.current) setStopping(false); }
  };
  const answerUserInput = async (answers: UserInputAnswers) => {
    const session = selectedRef.current;
    const request = session?.execution?.user_input;
    if (!session || !request) throw new Error("此问题已失效，请刷新会话");
    const version = selectionVersion.current;
    const result = await call<Session>("respond", { session_id: session.id, request_id: request.id, answers });
    if (!mounted.current) return;
    if (version === selectionVersion.current && selectedRef.current?.id === session.id) accept(result);
    else setSessions(items => updateSession(items, result));
  };
  const remove = (session: Session) => confirmAction({ intent: "danger", title: "删除此会话？", content: "将删除此会话的对话和执行记录，已完成的项目操作会保留。", okText: "删除会话", onOk: async () => {
    try { await call("delete", { session_id: session.id }); if (!mounted.current) return; setSessions(items => items.filter(item => item.id !== session.id)); if (selectedRef.current?.id === session.id) { selectionVersion.current++; selectedRef.current = null; setSelected(null); localStorage.removeItem(`spielberg-agent-session-${pid}`); } notifyAgentSessionChanged(pid, session.id, "workspace", true); }
    catch (e) { Message.error(String(e)); throw e; }
  } });
  const openSettings = () => { setForm({ ...config }); setSearchKey(""); setSettingsOpen(true); };
  const maxToolSteps = form.max_steps_limit ?? 64;
  const saveSettings = async () => {
    if (saving) return;
    setSaving(true);
    try { const saved = await call<Config>("config/save", { config: { search_provider: form.search_provider, search_api_key: searchKey, max_steps: form.max_steps, request_timeout_seconds: form.request_timeout_seconds } }); if (mounted.current) { setConfig(saved); setSettingsOpen(false); setSearchKey(""); Message.success("Agent 设置已保存"); } }
    catch (e) { Message.error(String(e)); } finally { if (mounted.current) setSaving(false); }
  };

  const empty = !loading && !selected?.messages.length;




  const renderTool = (message: AgentMessage, toolIndex: number) => <div className="agent-tool-result" key={`${message.tool_call_id || toolIndex}:${toolIndex}`}><details className="agent-tool">
            <summary><Wrench size={14} /><span>{toolText[message.tool_name || ""] || message.tool_name || "执行工具"}</span><small>{toolTarget(message.arguments)}</small><span className={`agent-tool-status ${message.status}`}>{message.status === "waiting_input" ? "等待回答" : message.status === "running" ? "执行中" : message.status === "failed" ? "失败" : message.status === "skipped" ? "未执行" : <><Check size={12} />完成</>}</span><ChevronDown size={14} /></summary>
            {message.arguments != null && <div><b>参数</b><pre>{displayJson(message.arguments)}</pre></div>}<div><b>结果</b><pre>{message.content ? displayJson(message.content) : "等待执行结果…"}</pre></div>
          </details>
          </div>;

  return <section className="agent-workspace" data-testid="agent-workspace" >
    <div className="agent-layout">
      {mobileSessions && <button className="agent-history-backdrop" tabIndex={-1} aria-label="关闭会话列表" onClick={() => setMobileSessions(false)} />}
      <aside ref={history} id="agent-history"  className={`agent-history${mobileSessions ? " is-open" : ""}`} aria-label="Agent 会话"  role={mobileSessions ? "dialog" : undefined} aria-modal={mobileSessions || undefined} >
        <Button long data-testid="agent-new-session" icon={<Plus size={16} />} loading={creating} disabled={loading || loadFailed || sending} onClick={() => void createSession()}>新建会话</Button>
        <div className="agent-history-heading"><span>项目会话 <small>{sessions.length}</small></span><Button size="mini" type="text" className="agent-mobile-history" aria-label="关闭会话列表" icon={<X size={16} />} onClick={() => setMobileSessions(false)} /></div>
        <div className="agent-session-list">{sessions.length === 0 && <div className="agent-history-empty"><MessageSquare size={28} /><b>暂无会话</b><p>开始创作后，会话将保存在这里</p></div>}{sessions.map(session => <div className={`agent-session${selected?.id === session.id ? " is-selected" : ""}`} key={session.id}>
          <button data-testid={`agent-session-${session.id}`} data-session-id={session.id} className="agent-session-select" title={`${session.title} · ${sessionStatus(session)}`} aria-label={`${session.title}，${sessionStatus(session)}`} aria-current={selected?.id === session.id ? "page" : undefined} onClick={() => void choose(session)} disabled={creating}><span className="agent-session-title"><strong>{session.title}</strong></span><SessionStatusIcon session={session} /></button>
          <button type="button" className="agent-delete" aria-label={`删除会话 ${session.title}`} disabled={hasActiveRun(session) || sending} onClick={() => remove(session)}><Trash2 size={14} /></button>
        </div>)}</div>
      </aside>
      <div className={`agent-conversation${empty ? " is-empty" : ""}`}>
        <div className="agent-conversation-bar"><div><Button ref={historyTrigger} className="agent-mobile-history" aria-label="打开会话列表" aria-controls="agent-history" aria-expanded={mobileSessions} icon={<MessageSquare size={16} />} onClick={() => setMobileSessions(value => !value)} /><b>{selected?.title || "新对话"}</b></div><div className="agent-conversation-actions">{running && <span><i className="agent-status-dot" />{cancelling ? "正在停止" : execution?.phase === "waiting_input" ? "等待回答" : "正在执行"}</span>}<Button type="text" data-testid="agent-settings" aria-label="Agent 设置" icon={<Settings2 size={15} />} onClick={openSettings}>Agent 设置</Button></div></div>
        {!configured && !loading && !loadFailed && <div className="agent-config-notice">请在统一渠道配置中添加支持工具调用的模型，并在输入框右下角选择渠道与模型。{onNavigate && <button onClick={() => onNavigate("settings")}>配置统一渠道</button>}</div>}
        <div className="agent-stage">
        {!loading && selected?.context && (!!selected.context.summarized_turns || !!selected.context.active_compacted_messages) && <div className="agent-memory-notice" data-testid="agent-memory-notice"><MessageSquare size={14} aria-hidden="true" /><span>{!!selected.context.summarized_turns && <>保留近期 {selected.context.recent_turns} 轮对话，较早 {selected.context.summarized_turns} 轮已整理为摘录。</>}{!!selected.context.active_compacted_messages && <>本轮较早的 {selected.context.active_compacted_messages} 条执行记录已压缩。</>}助手可按需检索完整记录。</span></div>}
        <div className="agent-messages" ref={log} role="log" aria-label="Agent 对话记录"  aria-busy={(running && execution?.phase !== "waiting_input") || loading}  onScroll={() => { const element = log.current; if (element) followBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100; }}>
          {loading ? <div className="agent-loading"><Spin /><span>正在读取会话</span></div> : !selected?.messages.length ? <div className="agent-empty">
            <div className="agent-empty-mark" aria-hidden="true"><Clapperboard size={28} strokeWidth={1.5} /><Sparkles size={13} /></div>
            <span className="agent-empty-eyebrow">灵感就位，即刻开场</span>
            <h2>下一幕，从这里开始<span>。</span></h2><p>从一个想法到一个好故事，和你的 AI 创作搭档一起完成。</p>
          </div> : messageEntries(selected.messages).map(({ message, index, tools }) => tools.length ? <div className="agent-operation-block" key={`${selected.id}:${index}`}>
            {tools.length > 1 ? <details className="agent-tool-group">
              <summary><Wrench size={14} /><span>操作记录 <small>{tools.length} 项</small></span><span className={`agent-tool-status ${tools.some(tool => tool.status === "failed") ? "failed" : tools.some(tool => tool.status === "waiting_input") ? "waiting_input" : tools.some(tool => tool.status === "running") ? "running" : ""}`}>
                {tools.some(tool => tool.status === "waiting_input") ? "等待回答 · " : tools.some(tool => tool.status === "running") ? "执行中 · " : ""}{tools.filter(tool => !tool.status || tool.status === "completed").length} 项完成
                {tools.some(tool => tool.status === "failed") && ` · ${tools.filter(tool => tool.status === "failed").length} 项失败`}
                {tools.some(tool => tool.status === "skipped") && ` · ${tools.filter(tool => tool.status === "skipped").length} 项未执行`}
              </span><ChevronDown size={14} /></summary>
              <div className="agent-tool-group-items">{tools.map((message, toolIndex) => renderTool(message, toolIndex))}</div>
            </details> : renderTool(tools[0], 0)}
            <div className="agent-generated-images agent-media-results">{tools.flatMap(tool => toolMedia(tool, currentMedia)).filter((media, index, items) => items.findIndex(item => item.id === media.id) === index).map(media => <AgentMediaPreview key={media.id} media={media} onPreview={setPreview} onLoad={followMedia} />)}</div>
          </div> : message.content || message.images?.length || message.status === "streaming" || message.status === "interrupted" ? <article className={`agent-message is-${message.role}`} data-status={message.status} key={index}>
            <div className="agent-message-label">{message.role === "user" ? "你" : <><Bot size={15} />Agent{message.status === "streaming" && <span className="agent-message-state" role="status">正在回复</span>}{message.status === "interrupted" && <span className="agent-message-state is-interrupted">回复已中断</span>}</>}</div><div className="agent-message-content">{message.role === "user" ? <>{message.images?.map((_, i) => {
              const media = attachmentImage(message, index, i, currentMedia);
              return <button type="button" key={i} className="agent-attachment-preview" aria-label={`预览附件图片 ${i + 1}`} onClick={() => setPreview(media)}><img className="agent-message-image" src={imageUrl(media)} alt={`附件图片 ${i + 1}`} onLoad={followMedia} /></button>;
            })}{message.content && <p>{message.content}</p>}</> : <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
              img: ({ src, alt }) => {
                const media = src ? mediaFromUrl(src, alt || "图片", currentMedia, pid, true) : null;
                return media ? <AgentMediaPreview key={imageUrl(media)} media={media} inline onPreview={setPreview} onLoad={followMedia} /> : <span>{alt || "图片不可用"}</span>;
              },
              a: ({ children, href, node: _node, ...props }) => {
                return <a {...props} href={href?.startsWith("/api/v1/") || href?.startsWith("/media?") ? backendUrl(href) : href} target="_blank" rel="noopener noreferrer">{children}</a>;
              },
            }}>{message.content}</ReactMarkdown>}</div>
          </article> : null)}
          {running && !cancelling && execution?.phase === "waiting_input" && execution.user_input && <AgentUserInput key={`${selected?.id}:${execution.user_input.id}`} request={execution.user_input} disabled={!!execution.user_input_response} onSubmit={answerUserInput} />}
          {!!execution?.plan?.length && <section className="agent-plan" data-testid="agent-plan" aria-label="任务计划">
            <div className="agent-plan-heading"><b>任务计划</b><span>{execution.plan.filter(item => item.status === "completed").length}/{execution.plan.length}</span></div>
            <ol>{execution.plan.map((item, index) => <li key={index} data-status={item.status}><span aria-hidden="true">{item.status === "completed" ? <Check size={14} /> : item.status === "in_progress" ? "◉" : "○"}</span><span>{item.step}</span><small>{item.status === "completed" ? "已完成" : item.status === "in_progress" ? running ? "进行中" : "待继续" : "待处理"}</small></li>)}</ol>
          </section>}
          {running && <div className="agent-working" role="status"><span className="agent-pulse" /><span>{cancelling ? phaseText.stopping : execution?.phase === "tool" && execution.active_tool ? toolText[execution.active_tool] || "正在执行操作" : phaseText[execution?.phase || "thinking"] || "正在处理项目"}{execution?.max_steps != null && ` · ${execution.tool_calls || 0}/${execution.max_steps} 步`}</span></div>}
          {selected?.status === "limited" && <div className="agent-limit-notice" role="status">{execution?.stop_reason === "repeated_tool_failure" ? "相同操作连续失败，已暂停以便调整。" : "本轮已达到执行步数上限。"}已完成的操作已保留，可以补充要求或发送“继续”。</div>}
          {(error || selected?.error) && <div className="agent-error" role="alert"><span>{error || selected?.error}</span>{error && <Button size="mini" type="text" data-testid="agent-reload" disabled={loading || sending || creating || stopping} onClick={() => setLoadAttempt(value => value + 1)}>重新加载</Button>}</div>}
        </div>
        <div className="agent-composer-wrap">
          <div className="agent-composer">
            {!!images.length && <div className="agent-image-previews">{images.map((image, i) => <div key={i}><img src={image.url} alt={`待发送图片 ${i + 1}（已加入素材）`} /><button type="button" aria-label={`移除图片 ${i + 1}`} disabled={sending} onClick={() => setImageDrafts(items => ({ ...items, [draftKey]: images.filter((_, index) => index !== i) }))}><X size={14} /></button></div>)}</div>}
            <AgentComposerInput key={draftKey} inputRef={composer} data-testid="agent-composer" aria-label="向 Agent 发送消息" value={draft} mentions={mentions} maxLength={16000} disabled={loading || sending || creating} placeholder="输入 @ 引用项目内容，或 / 选择技能…" onPaste={event => { if (readingImages) return; const files = Array.from(event.clipboardData.items).filter(item => item.type.startsWith("image/")).map(item => item.getAsFile()).filter((file): file is File => !!file); if (files.length) { event.preventDefault(); void pasteImages(files); } }} onChange={updateDraft} onSend={() => void send()} />
            <div className="agent-composer-actions"><label className={`agent-web-toggle${online ? " is-online" : ""}`}><Globe size={14} /><span>联网搜索</span><Switch size="small" checked={online} onChange={setOnline} disabled={running || sending} aria-label="联网搜索" /></label><GenerationSelector compact settings={modelSettings} kind="llm" operation="chat" value={modelSelection.value} onChange={modelSelection.setValue} disabled={loading || loadFailed || running || sending || creating || saving} />{running ? <Button data-testid="agent-stop" aria-label={cancelling ? "正在停止" : "停止执行"} status="danger" icon={<Square size={14} />} loading={stopping || cancelling} disabled={cancelling} onClick={() => void stop()}>{cancelling ? "正在停止" : "停止"}</Button> : <Button type="primary" data-testid="agent-send" aria-label="发送消息" icon={<ArrowUp size={19} />} loading={sending} disabled={(!draft.trim() && !images.length) || readingImages || loading || loadFailed || creating} onClick={() => void send()} />}</div>
          </div>
          {empty && <>
            <div className="agent-starters-heading">也可以从这里开始</div>
            <div className="agent-starters">{[
              ["整理项目", "梳理进度，找到下一步", "查看当前项目，整理剧本、资产、剧集和场景的制作进度，并提出下一步建议。"],
              ["开始一个故事", "让一个灵感，长成剧本", "写一个雨夜车站重逢的短片剧本，创建主要资产，并建立第一集和三个场景，按动作划分片段。"],
              ["搜索创作参考", "发现镜头、光影与灵感", "联网搜索电影雨夜车站场景的灯光和镜头参考，注明来源，并把可用的创作提示词保存到 Prompt 库。"],
            ].map(([label, description, text]) => <button key={label} onClick={() => { updateDraft(text); composer.current?.focus(); }}><span className="agent-starter-icon">{label === "搜索创作参考" ? <Search size={17} /> : label === "整理项目" ? <Folder size={17} /> : <PencilLine size={17} />}</span><span className="agent-starter-copy"><strong>{label}</strong><small>{description}</small></span><ArrowUpRight className="agent-starter-arrow" size={15} /></button>)}</div>
          </>}
        </div>
        </div>
      </div>
    </div>
    <ImagePreviewModal media={preview?.kind === "image" ? preview : null} images={gallery} title="对话图片预览" onMediaChange={setPreview} onClose={() => setPreview(null)} />
    <VideoPreviewModal projectId={pid} media={preview?.kind === "video" ? preview : null} onClose={() => setPreview(null)} />
    <Modal title="Agent 设置" visible={settingsOpen} onCancel={() => !saving && setSettingsOpen(false)} onOk={() => void saveSettings()} okText="保存设置" cancelText="取消" confirmLoading={saving} maskClosable={!saving} style={{ width: 580 }} className="agent-settings-modal">
      <div className="agent-settings-form">
        <label>搜索服务<Select aria-label="搜索服务" value={form.search_provider} disabled={saving} options={[{ label: "自动搜索 · DuckDuckGo / Bing（无需 Key）", value: "duckduckgo" }, { label: "Brave Search", value: "brave" }, { label: "Tavily", value: "tavily" }]} onChange={value => setForm(item => ({ ...item, search_provider: value }))} /></label>
        {form.search_provider !== "duckduckgo" && <label>搜索 API Key<Input.Password aria-label="搜索 API Key" value={searchKey} disabled={saving} placeholder={config.has_search_api_key ? "已保存，留空保留" : "输入搜索服务 API Key"} onChange={setSearchKey} /></label>}
        <label>模型请求等待时间（秒）<input aria-label="模型请求等待时间（秒）" type="number" min={30} max={1800} value={form.request_timeout_seconds ?? 600} disabled={saving} onChange={event => setForm(item => ({ ...item, request_timeout_seconds: Math.min(1800, Math.max(30, Number(event.target.value) || 30)) }))} /></label>
        <label>最多执行步数（1–{maxToolSteps}）<input aria-label="最多执行步数" type="number" min={1} max={maxToolSteps} value={form.max_steps} disabled={saving} onChange={event => setForm(item => ({ ...item, max_steps: Math.min(maxToolSteps, Math.max(1, Math.trunc(event.target.valueAsNumber) || 1)) }))} /></label>
        <p>模型服务需要支持 OpenAI Chat Completions 工具调用。项目内容和检索资料会发送至该服务；密钥仅保存在后端。停止后已完成的修改会保留，正在执行的生成或导出可能继续完成。</p>
      </div>
    </Modal>
  </section>;
}
