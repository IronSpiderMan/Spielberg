import { ArrowUp, ArrowUpRight, Check, Copy, Keyboard, LoaderCircle, Mic, Plus, Square, Volume2, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { post, type ModelSettings, type Project } from "../core";
import { backendUrl } from "../transport";
import { AGENT_SESSION_CHANGED, notifyAgentSessionChanged, type AgentSessionChange } from "../agent-session-events";
import { startSpeechRecognition } from "../speech-recognition";
import { startSpeechRecognition as startCloudSpeechRecognition } from "../asr-recognition";
import { useAgentFloatSpeechPreferences, type AgentFloatPreferences } from "../agent-float-preferences";
import { stopAgentSpeechPlayback, useAgentReplySpeech } from "../agent-reply-speech";
import { generationChoice, selectionPayload } from "../generation-channels";
import { AgentLivingOrb } from "./AgentLivingOrb";
import "./agent-float.css";

type Position = { x: number; y: number };
type Session = {
  id: string; status: string; error?: string;
  messages: { role: string; content: string }[];
  execution?: { active?: boolean; phase?: string; active_tool?: string };
};
type SpeechController = Awaited<ReturnType<typeof startSpeechRecognition>>;
type ListeningState = "idle" | "starting" | "listening" | "finishing";
const POSITION_KEY = "spielberg-agent-float-position";
const SIZE = 64;
const MARGIN = 16;
const MAX_DRAFT = 16000;
const emptySettings: ModelSettings = {};
const toolLabels: Record<string, string> = { update_plan: "正在更新任务计划", get_project: "正在读取项目", search_conversation: "正在检索对话", list_skills: "正在查找技能", read_skill: "正在读取技能", app_describe: "正在查看操作说明", app_request: "正在操作项目数据", app_action: "正在执行创作操作", web_search: "正在联网搜索", fetch_webpage: "正在读取网页" };
const isRunning = (session: Session | null) => session?.execution?.active ?? session?.status === "running";
function lastReply(session: Session | null): string {
  if (!session) return "";
  const userIndex = session.messages.map(message => message.role).lastIndexOf("user");
  return session.messages.slice(userIndex + 1).filter(message => message.role === "assistant" && message.content?.trim()).pop()?.content || "";
}
const readStorage = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const writeStorage = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* Private browsing may disable persistence. */ } };
function clampPosition(position: Position): Position {
  return { x: Math.max(MARGIN, Math.min(position.x, window.innerWidth - SIZE - MARGIN)), y: Math.max(MARGIN, Math.min(position.y, window.innerHeight - SIZE - MARGIN)) };
}
function initialPosition(): Position {
  try {
    const stored = JSON.parse(readStorage(POSITION_KEY) || "null");
    if (Number.isFinite(stored?.x) && Number.isFinite(stored?.y)) return clampPosition(stored);
  } catch { /* Ignore old or corrupted preferences. */ }
  return clampPosition({ x: window.innerWidth - SIZE - 28, y: window.innerHeight - SIZE - 28 });
}

// Reserve a separate rectangle for the orb even when the reply grows or the window shrinks.
function panelPlacement(position: Position, viewport: { width: number; height: number }, height: number) {
  const gap = 14, margin = 12;
  const width = Math.max(1, Math.min(384, viewport.width - margin * 2));
  const leftRoom = position.x - gap - margin;
  const rightRoom = viewport.width - position.x - SIZE - gap - margin;
  if (Math.max(leftRoom, rightRoom) >= width) {
    return {
      left: leftRoom >= width ? position.x - gap - width : position.x + SIZE + gap,
      top: Math.max(margin, Math.min(position.y + SIZE - height, viewport.height - height - margin)),
      width, maxHeight: viewport.height - margin * 2,
    };
  }
  const above = position.y - gap - margin;
  const below = viewport.height - position.y - SIZE - gap - margin;
  const useAbove = above >= below;
  const maxHeight = Math.max(1, useAbove ? above : below);
  return {
    left: Math.max(margin, Math.min(position.x + SIZE - width, viewport.width - width - margin)),
    top: useAbove ? position.y - gap - Math.min(height, maxHeight) : position.y + SIZE + gap,
    width, maxHeight,
  };
}

export function AgentFloatButton({ project, reload, onOpenSession, onSettings, appearance, modelSettings = emptySettings }: {
  appearance: AgentFloatPreferences;
  modelSettings?: ModelSettings;
  project: Project | null; reload: () => Promise<void>; onOpenSession: (sessionId: string) => void; onSettings?: () => void;
}) {
  const pid = project?.id;
  const sessionKey = `spielberg-agent-float-session-${pid}`;
  const draftKey = `spielberg-agent-float-draft-${pid}`;
  const [speechPreferences, setSpeechPreferences] = useAgentFloatSpeechPreferences(pid);
  const speechProvider = speechPreferences.asr.provider;
  const narration = useAgentReplySpeech(pid, speechPreferences, modelSettings);
  const narrationRef = useRef(narration);
  const speechPreferencesRef = useRef(speechPreferences);
  useLayoutEffect(() => { narrationRef.current = narration; speechPreferencesRef.current = speechPreferences; });
  const [position, setPosition] = useState(initialPosition);
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [open, setOpen] = useState(false);
  const [speechState, setSpeechState] = useState<ListeningState>("idle");
  const [draft, setDraft] = useState(() => readStorage(draftKey)?.slice(0, MAX_DRAFT) || "");
  const [error, setError] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [restoring, setRestoring] = useState(!!pid && !!readStorage(sessionKey));
  const [restoreFailed, setRestoreFailed] = useState(false);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [panelHeight, setPanelHeight] = useState(330);
  const [unread, setUnread] = useState(false);
  const [copied, setCopied] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);
  const sessionRef = useRef<Session | null>(null);
  // Polling, restoration and workspace notifications share a response order.
  // Mutations invalidate earlier reads before and after changing the session.
  const sessionRequestVersion = useRef(0);
  const pendingSessionRefresh = useRef(false);
  const submitting = useRef(false);
  const stoppingRequest = useRef(false);
  const speech = useRef<SpeechController | null>(null);
  const speechAbort = useRef<AbortController | null>(null);
  const speechVersion = useRef(0);
  const transcript = useRef("");
  const draftBeforeSpeech = useRef("");
  const openRef = useRef(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout>>();
  const suppressClick = useRef(false);
  const drag = useRef<{ id: number; startX: number; startY: number; origin: Position; moved: boolean } | null>(null);
  const listening = speechState !== "idle";
  const running = isRunning(session);
  const cancelling = running && (stopping || session?.status === "cancelled" || session?.execution?.phase === "stopping");
  const locked = sending || running || restoring || restoreFailed;
  const call = useCallback(<T,>(action: string, payload: object = {}) => post<T>(`/agent/${action}`, { project_id: pid, ...payload }), [pid]);

  const accept = useCallback((next: Session) => {
    if (!mounted.current) return;
    const previous = sessionRef.current;
    if (isRunning(next) && !isRunning(previous)) narrationRef.current.stop();
    sessionRef.current = next; setSession(next); writeStorage(sessionKey, next.id);
    if (previous?.id !== next.id || previous?.status !== next.status || isRunning(previous) !== isRunning(next)) {
      if (pid) notifyAgentSessionChanged(pid, next.id, "float");
    }
    if (isRunning(previous) && !isRunning(next)) {
      if (!openRef.current) setUnread(true);
      if (speechPreferencesRef.current.autoRead && ["completed", "limited"].includes(next.status) && !speechAbort.current) {
        void narrationRef.current.play(lastReply(next));
      }
      void reload().catch(() => {
        if (mounted.current) setError("操作已结束，但页面刷新失败，请刷新页面查看结果。");
      });
    }
  }, [pid, reload, sessionKey]);

  const refreshCurrentSession = useCallback(async () => {
    const id = sessionRef.current?.id;
    if (!mounted.current || !id) { pendingSessionRefresh.current = false; return; }
    if (submitting.current || stoppingRequest.current) { pendingSessionRefresh.current = true; return; }
    pendingSessionRefresh.current = false;
    const version = ++sessionRequestVersion.current;
    const current = () => mounted.current && version === sessionRequestVersion.current && sessionRef.current?.id === id;
    try {
      const next = await call<Session>("session", { session_id: id });
      if (!current()) return;
      const previous = sessionRef.current;
      if (isRunning(next) || previous?.status !== next.status || previous?.messages.length !== next.messages.length) setError("");
      accept(next);
    } catch (e) { if (current()) setError(error => error || `读取执行进度失败：${String(e)}`); }
  }, [call, accept]);

  const cancelSpeech = useCallback(() => {
    if (speechAbort.current) setDraft(draftBeforeSpeech.current);
    speechVersion.current++;
    speechAbort.current?.abort(); speechAbort.current = null;
    speech.current?.cancel(); speech.current = null;
    setSpeechState("idle");
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; sessionRequestVersion.current++; clearTimeout(copyTimer.current); speechVersion.current++; speechAbort.current?.abort(); speech.current?.cancel(); };
  }, []);
  useEffect(() => { if (pid) writeStorage(draftKey, listening ? draftBeforeSpeech.current : draft); }, [pid, draftKey, draft, listening]);
  useLayoutEffect(() => { openRef.current = open; if (open) setUnread(false); }, [open]);
  useEffect(() => {
    const resize = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
      setPosition(current => { const next = clampPosition(current); writeStorage(POSITION_KEY, JSON.stringify(next)); return next; });
    };
    window.addEventListener("resize", resize);
    const reset = () => {
      const next = clampPosition({ x: window.innerWidth - SIZE - 28, y: window.innerHeight - SIZE - 28 });
      setPosition(next); writeStorage(POSITION_KEY, JSON.stringify(next));
    };
    window.addEventListener("spielberg-agent-float-reset-position", reset);
    return () => { window.removeEventListener("resize", resize); window.removeEventListener("spielberg-agent-float-reset-position", reset); };
  }, []);
  useLayoutEffect(() => {
    if (!open || !panel.current) return;
    const measure = () => setPanelHeight(panel.current?.getBoundingClientRect().height || 330);
    const observer = new ResizeObserver(measure);
    measure();
    observer.observe(panel.current);
    (input.current && !input.current.disabled ? input.current : panel.current).focus({ preventScroll: true });
    return () => observer.disconnect();
  }, [open]);
  useLayoutEffect(() => {
    if (!open || !input.current) return;
    input.current.style.height = "auto";
    input.current.style.height = `${Math.min(120, input.current.scrollHeight)}px`;
  }, [draft, open]);
  useEffect(() => {
    const saved = pid && readStorage(sessionKey);
    if (!saved) { setRestoring(false); return; }
    if (submitting.current || stoppingRequest.current) return;
    let disposed = false;
    const version = ++sessionRequestVersion.current;
    const current = () => !disposed && mounted.current && version === sessionRequestVersion.current;
    setRestoring(true); setRestoreFailed(false);
    void call<Session>("session", { session_id: saved }).then(result => {
      if (current()) { accept(result); setError(""); }
    }).catch(e => {
      if (!current()) return;
      if (String(e).includes("会话不存在")) { writeStorage(sessionKey, ""); sessionRef.current = null; setSession(null); setError(""); return; }
      setError(`无法恢复对话：${String(e)}`); setRestoreFailed(true);
    }).finally(() => { if (!disposed) setRestoring(false); });
    return () => { disposed = true; };
  }, [pid, sessionKey, call, accept, restoreAttempt]);
  useEffect(() => {
    let disposed = false;
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<AgentSessionChange>).detail;
      if (detail.source === "float" || detail.projectId !== pid || detail.sessionId !== sessionRef.current?.id) return;
      if (detail.deleted) {
        sessionRequestVersion.current++;
        pendingSessionRefresh.current = false;
        narrationRef.current.stop();
        sessionRef.current = null; setSession(null); writeStorage(sessionKey, ""); setError("");
        return;
      }
      if (submitting.current || stoppingRequest.current) { pendingSessionRefresh.current = true; return; }
      const version = ++sessionRequestVersion.current;
      void call<Session>("session", { session_id: detail.sessionId }).then(next => {
        if (!disposed && version === sessionRequestVersion.current && sessionRef.current?.id === next.id) accept(next);
      }).catch(e => { if (!disposed && version === sessionRequestVersion.current) setError(String(e)); });
    };
    window.addEventListener(AGENT_SESSION_CHANGED, changed);
    return () => { disposed = true; window.removeEventListener(AGENT_SESSION_CHANGED, changed); };
  }, [pid, sessionKey, call, accept]);
  useEffect(() => {
    if (!running || !session?.id) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (!submitting.current && !stoppingRequest.current) {
        const version = ++sessionRequestVersion.current;
        const current = () => !disposed && version === sessionRequestVersion.current && sessionRef.current?.id === session.id;
        try {
          const next = await call<Session>("session", { session_id: session.id });
          if (current()) { setError(""); accept(next); }
        } catch (e) { if (current()) setError(`读取执行进度失败，正在重试：${String(e)}`); }
      }
      if (!disposed) timer = setTimeout(poll, 1200);
    };
    timer = setTimeout(poll, 400);
    return () => { disposed = true; clearTimeout(timer); };
  }, [running, session?.id, call, accept]);

  const send = async (text: string) => {
    const message = text.trim().slice(0, MAX_DRAFT);
    if (!pid || !message || submitting.current || isRunning(sessionRef.current) || restoring || restoreFailed || !mounted.current) return;
    stopAgentSpeechPlayback();
    narration.stop();
    const version = ++sessionRequestVersion.current;
    const currentRequest = () => mounted.current && version === sessionRequestVersion.current;
    let failed = false;
    submitting.current = true; setSending(true); setError(""); setDraft(message);
    try {
      let current = sessionRef.current;
      if (!current) {
        current = await call<Session>("create", { title: message.slice(0, 40) });
        if (!currentRequest()) return;
        accept(current);
      }
      const result = await call<Session>("run", { session_id: current.id, message, web_enabled: true });
      if (currentRequest()) { accept(result); setDraft(""); }
    } catch (e) { failed = true; if (currentRequest()) setError(String(e).replace(/^Error: /, "")); }
    finally {
      const refresh = currentRequest() && (failed || pendingSessionRefresh.current);
      if (currentRequest()) sessionRequestVersion.current++;
      submitting.current = false; if (mounted.current) setSending(false);
      if (refresh) void refreshCurrentSession();
    }
  };
  const startListening = async () => {
    setOpen(true);
    if (!pid || locked || listening || speechAbort.current) return;
    stopAgentSpeechPlayback();
    narration.stop();
    const asrChoice = speechProvider === "cloud" ? generationChoice(modelSettings, "asr", speechPreferences.asr, "asr") : undefined;
    if (speechProvider === "cloud" && !asrChoice) { setError("请在「Agent 悬浮按钮」设置中选择有效的 ASR 渠道与模型。"); return; }
    const version = ++speechVersion.current;
    const controller = new AbortController(); speechAbort.current = controller;
    transcript.current = ""; draftBeforeSpeech.current = draft; setError(""); setSpeechState("starting");
    const speechDraft = () => [draftBeforeSpeech.current.trimEnd(), transcript.current.trim()].filter(Boolean).join("\n");
    const current = () => mounted.current && version === speechVersion.current && !controller.signal.aborted;
    try {
      const startRecognition = speechProvider === "system" ? startSpeechRecognition : startCloudSpeechRecognition;
      const recognition = await startRecognition({
        onStart: () => { if (current()) setSpeechState("listening"); },
        onResult: text => {
          if (current() && text.trim()) {
            transcript.current = text;
            setDraft(speechDraft().slice(0, MAX_DRAFT));
          }
        },
        onError: message => {
          if (!current()) return;
          speechVersion.current++; speechAbort.current = null; speech.current = null;
          setSpeechState("idle"); setError(message); input.current?.focus();
        },
        onEnd: () => {
          if (!current()) return;
          speechVersion.current++; speechAbort.current = null; speech.current = null; setSpeechState("idle");
          if (transcript.current.trim()) {
            const text = speechDraft(); setDraft(text.slice(0, MAX_DRAFT));
            if (text.length > MAX_DRAFT) { setError("输入超过 16000 字，已保留前 16000 字，请校对后再发送。"); input.current?.focus(); }
            else if (appearance.speechAutoSend) void send(text);
            else input.current?.focus();
          }
          else { setError("没有听到内容，请再试一次，或直接输入指令。"); input.current?.focus(); }
        },
      }, { signal: controller.signal, projectId: pid, selection: selectionPayload(asrChoice), onFinishing: () => { if (current()) setSpeechState("finishing"); } });
      if (current()) speech.current = recognition;
      else recognition.cancel();
    } catch (e) {
      if (!current()) return;
      speechAbort.current = null; speech.current = null; setSpeechState("idle");
      setError(String(e).replace(/^Error: /, "")); input.current?.focus();
    }
  };
  const finishListening = () => {
    if (speechState === "starting") { cancelSpeech(); return; }
    if (!speech.current || speechState === "finishing") return;
    setSpeechState("finishing"); speech.current.stop();
  };
  const close = useCallback(() => { cancelSpeech(); setOpen(false); button.current?.focus({ preventScroll: true }); }, [cancelSpeech]);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      event.preventDefault(); close();
    };
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || panel.current?.contains(event.target) || button.current?.contains(event.target)) return;
      cancelSpeech(); setOpen(false);
    };
    document.addEventListener("keydown", escape);
    document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("keydown", escape); document.removeEventListener("pointerdown", outside); };
  }, [open, close, cancelSpeech]);
  const newConversation = () => {
    sessionRequestVersion.current++;
    pendingSessionRefresh.current = false;
    stopAgentSpeechPlayback();
    narration.stop();
    sessionRef.current = null; setSession(null); writeStorage(sessionKey, "");
    setDraft(""); setError(""); setRestoreFailed(false); setUnread(false);
    requestAnimationFrame(() => input.current?.focus());
  };
  const stopAgent = async () => {
    const id = sessionRef.current?.id;
    if (!id || stoppingRequest.current || cancelling) return;
    const version = ++sessionRequestVersion.current;
    const current = () => mounted.current && version === sessionRequestVersion.current && sessionRef.current?.id === id;
    let failed = false;
    stoppingRequest.current = true;
    setStopping(true); setError("");
    try { const next = await call<Session>("cancel", { session_id: id }); if (current()) accept(next); }
    catch (e) { failed = true; if (current()) setError(String(e)); }
    finally {
      const refresh = current() && (failed || pendingSessionRefresh.current);
      if (current()) sessionRequestVersion.current++;
      stoppingRequest.current = false; if (mounted.current) setStopping(false);
      if (refresh) void refreshCurrentSession();
    }
  };
  const pointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !event.isPrimary) return;
    suppressClick.current = false;
    drag.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY, origin: position, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.startX, dy = event.clientY - current.startY;
    if (!current.moved && Math.hypot(dx, dy) < 6) return;
    current.moved = true; suppressClick.current = true; setDragging(true);
    setPosition(clampPosition({ x: current.origin.x + dx, y: current.origin.y + dy }));
  };
  const pointerEnd = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (drag.current?.id !== event.pointerId) return;
    if (drag.current.moved) {
      const next = clampPosition({ ...position, x: position.x + SIZE / 2 < viewport.width / 2 ? MARGIN : viewport.width - SIZE - MARGIN });
      setPosition(next); writeStorage(POSITION_KEY, JSON.stringify(next));
    }
    if (event.type === "pointercancel") suppressClick.current = true;
    drag.current = null; setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const placement = panelPlacement(position, viewport, panelHeight);
  const speaking = narration.state !== "idle";
  const state = listening ? "listening" : sending || running ? "working" : speaking ? "speaking" : error || session?.status === "failed" ? "error" : "idle";
  const status = speechState === "starting" ? "正在打开麦克风" : speechState === "finishing" ? "正在识别语音" : listening ? "我在听，说完即可（最长 60 秒）" : sending ? "正在发送指令" : cancelling ? "正在停止操作" : running ? (session?.execution?.phase === "streaming" ? "正在回复" : toolLabels[session?.execution?.active_tool || ""] || "Agent 正在执行") : restoring ? "正在恢复会话" : restoreFailed ? "对话恢复失败" : session?.status === "failed" ? "执行未完成" : session?.status === "completed" ? "已完成" : session?.status === "limited" ? "已暂停，可继续" : session?.status === "cancelled" ? "已停止" : "有什么我可以帮你？";
  const lastUserIndex = session?.messages.map(message => message.role).lastIndexOf("user") ?? -1;
  const lastUser = lastUserIndex >= 0 ? session?.messages[lastUserIndex].content : "";
  const reply = session?.messages.slice(lastUserIndex + 1).filter(message => message.role === "assistant" && message.content).map(message => message.content).join("\n\n");
  const speechReply = lastReply(session);
  const asrChoice = generationChoice(modelSettings, "asr", speechPreferences.asr, "asr");
  const ttsChoice = generationChoice(modelSettings, "tts", speechPreferences.tts, "tts");

  useEffect(() => { setCopied(false); clearTimeout(copyTimer.current); }, [reply]);
  const copyReply = async () => {
    try {
      await navigator.clipboard.writeText(reply || "");
      if (!mounted.current) return;
      setCopied(true); clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch { if (mounted.current) setError("复制失败，请选中回复文字后复制。"); }
  };
  const finishLabel = appearance.speechAutoSend ? "结束听写并执行" : "结束听写并校对";
  const orbLabel = listening ? finishLabel : open && appearance.clickAction === "panel" ? "收起 Agent 助手" : running || sending ? "查看 Agent 执行进度" : speaking ? "查看 Agent 朗读进度" : unread ? "查看 Agent 最新结果" : appearance.clickAction === "voice" ? "语音 Agent，点击说话，拖动移动" : "打开 Agent 助手，拖动移动";

  return createPortal(<div className="agent-float" data-state={state}>
    {open && <section ref={panel} id="agent-float-panel" className="agent-float-panel" data-testid="agent-float-panel" role="dialog" aria-label="语音 Agent 助手" tabIndex={-1} style={placement} onKeyDown={event => {
      if (event.key === "Escape" && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); close(); }
    }}>
      <header><div className="agent-float-heading"><span className="agent-float-indicator" /><strong>Agent</strong><span>随时协作</span></div><button type="button" className="agent-float-icon" aria-label="收起语音助手" title="收起 · Esc" onClick={close}><X size={17} /></button></header>
      <div className="agent-float-project" title={project?.name}>{project?.name || "请先打开或创建一个项目"}</div>
      <div className="agent-float-content" tabIndex={0} aria-label="Agent 对话结果">
        <div className="agent-float-status" role="status">
          {listening ? <span className="agent-float-wave" aria-hidden="true">{[0, 1, 2, 3, 4].map(i => <i key={i} />)}</span> : sending || running || restoring ? <LoaderCircle size={16} className="agent-float-spinner" /> : session?.status === "completed" ? <Check size={16} /> : null}
          <span>{status}</span>
        </div>
        {!session && !listening && !restoring && !restoreFailed && <p className="agent-float-empty">{pid ? "整理灵感、修改剧本、安排创作任务。输入指令，或点击麦克风说话。" : "打开项目后，就可以在任意页面与 Agent 协作。"}</p>}
        {lastUser && !listening && <p className="agent-float-request">{lastUser}</p>}
        {reply && !listening && <>
          <div className="agent-float-reply" data-testid="agent-float-reply"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
            a: ({ children, href }) => <a href={href?.startsWith("/api/v1/") || href?.startsWith("/media?") ? backendUrl(href) : href} target="_blank" rel="noopener noreferrer">{children}</a>,
            img: ({ alt }) => <span className="agent-float-media-hint">{alt || "图片"} · 请在完整对话中查看</span>,
          }}>{reply}</ReactMarkdown></div>
          <div className="agent-float-reply-actions"><button type="button" className="agent-float-copy" onClick={() => void copyReply()} disabled={running} aria-label="复制回复">{copied ? <Check size={12} /> : <Copy size={12} />}{copied ? "已复制" : "复制回复"}</button>
          {!speaking && <button type="button" className="agent-float-copy" aria-label="朗读回复" disabled={running || sending || !speechReply} onClick={() => void narration.play(speechReply)}><Volume2 size={13} />朗读回复</button>}</div>
        </>}
        {(error || session?.error) && <div className="agent-float-error" role="alert">{error || session?.error}{restoreFailed && <button type="button" onClick={() => setRestoreAttempt(value => value + 1)}>重新连接</button>}</div>}
        {narration.error && <div className="agent-float-error" role="alert">朗读失败：{narration.error}</div>}
        {onSettings && !listening && (error || narration.error) && <button type="button" className="agent-float-settings" onClick={() => { close(); onSettings(); }}>检查模型设置 <ArrowUpRight size={12} /></button>}
      </div>
      <label className="agent-float-speech-provider"><Mic size={13} aria-hidden="true" /><span>语音识别</span><select aria-label="语音识别方式" value={speechProvider} disabled={listening} onChange={e => setSpeechPreferences({ ...speechPreferences, asr: { ...speechPreferences.asr, provider: e.target.value as "system" | "cloud" } })}><option value="system">系统自带</option><option value="cloud">{asrChoice ? `${asrChoice.channel.name} · ${asrChoice.model.name || asrChoice.model.id}` : "项目 ASR 渠道"}</option></select></label>
      <div className="agent-float-narration" data-state={narration.state}><Volume2 size={13} aria-hidden="true" /><span role="status">{speaking ? narration.state === "loading" ? "正在合成朗读…" : "正在朗读回复" : speechPreferences.tts.provider === "system" ? "系统朗读" : ttsChoice ? `${ttsChoice.channel.name} · ${ttsChoice.model.name || ttsChoice.model.id}` : "尚未选择 TTS 模型"}</span>{speaking ? <button type="button" className="agent-float-icon" aria-label="停止朗读" title="停止朗读" onClick={narration.stop}><Square size={12} /></button> : <label><input type="checkbox" aria-label="自动朗读回复" checked={speechPreferences.autoRead} onChange={e => setSpeechPreferences({ ...speechPreferences, autoRead: e.target.checked })} />自动朗读</label>}</div>
      <form onSubmit={event => { event.preventDefault(); if (!listening) void send(draft); }}>
        <textarea ref={input} data-testid="agent-float-input" value={draft} onChange={event => setDraft(event.target.value)} readOnly={listening} disabled={!pid || locked} rows={2} maxLength={MAX_DRAFT} aria-label="Agent 指令" placeholder={listening ? "正在聆听…" : "告诉我，你想做什么…"} onKeyDown={event => {
          if (event.defaultPrevented || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
          if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (!listening) void send(draft); }
        }} />
        <div className="agent-float-composer-actions"><span>{listening ? appearance.speechAutoSend ? "说完自动发送 · 最长 60 秒" : "说完先校对，再发送" : "Enter 发送 · Shift+Enter 换行"}</span><div>
          {listening ? <button type="button" className="agent-float-icon" aria-label="取消听写，改用文字" title="取消听写，恢复原稿" onClick={() => { cancelSpeech(); input.current?.focus(); }}><Keyboard size={17} /></button> : <button type="button" className="agent-float-icon" aria-label="开始语音输入" title="开始语音输入" disabled={!pid || locked} onClick={() => void startListening()}><Mic size={17} /></button>}
          {running ? <button type="button" data-testid="agent-float-stop" className="agent-float-submit" aria-label="停止 Agent 执行" disabled={cancelling} onClick={() => void stopAgent()}><Square size={14} /></button> : listening ? <button type="button" className="agent-float-submit" aria-label={finishLabel} disabled={speechState !== "listening"} onClick={finishListening}><Check size={18} /></button> : <button type="submit" data-testid="agent-float-send" className="agent-float-submit" aria-label="执行指令" disabled={!pid || !draft.trim() || locked}>{sending ? <LoaderCircle size={18} className="agent-float-spinner" /> : <ArrowUp size={18} />}</button>}
        </div></div>
      </form>
      <footer><button type="button" disabled={!pid || sending || running || restoring || listening || (!session && !restoreFailed && !draft)} onClick={newConversation}><Plus size={13} />新对话</button><button type="button" disabled={!session} onClick={() => { if (session) { cancelSpeech(); onOpenSession(session.id); setOpen(false); } }}>打开完整对话<ArrowUpRight size={13} /></button></footer>
    </section>}
    <button ref={button} type="button" className={`agent-float-button${dragging ? " is-dragging" : ""}`} data-testid="agent-float-button" data-state={state} data-unread={unread && !open} data-edge={position.x < viewport.width / 2 ? "left" : "right"} style={{ left: position.x, top: position.y }} aria-label={orbLabel} aria-expanded={open} aria-controls={open ? "agent-float-panel" : undefined} aria-haspopup="dialog" title={`${listening ? finishLabel : appearance.clickAction === "voice" ? "点击说话" : "点击展开 / 收起"} · 拖动贴边 · 方向键移动`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd} onLostPointerCapture={() => { drag.current = null; setDragging(false); }} onKeyDown={event => {
      const delta: Record<string, Position> = { ArrowLeft: { x: -1, y: 0 }, ArrowRight: { x: 1, y: 0 }, ArrowUp: { x: 0, y: -1 }, ArrowDown: { x: 0, y: 1 } };
      if (!delta[event.key] || event.altKey || event.metaKey || event.ctrlKey) return;
      event.preventDefault(); event.stopPropagation();
      const step = event.shiftKey ? 32 : 12;
      const next = clampPosition({ x: position.x + delta[event.key].x * step, y: position.y + delta[event.key].y * step });
      setPosition(next); writeStorage(POSITION_KEY, JSON.stringify(next));
    }} onClick={event => {
      if (suppressClick.current && event.detail !== 0) { suppressClick.current = false; return; }
      if (listening) finishListening();
      else if (open && appearance.clickAction === "panel") close();
      else if (unread || speaking) setOpen(true);
      else if (appearance.clickAction === "voice" && !locked && pid) void startListening();
      else setOpen(true);
    }}>
      <AgentLivingOrb color={appearance.color} intensity={appearance.intensity} mode={listening ? "listen" : speaking ? "speak" : sending || running ? session?.execution?.phase === "streaming" ? "speak" : "think" : state === "error" ? "error" : "idle"} />
      {(running || sending || (unread && !open)) && <span className={`agent-float-busy-dot${unread && !running && !sending ? " is-unread" : ""}`} aria-hidden="true" />}
      <span className="agent-float-tooltip">{listening ? "点击结束听写" : running || sending ? "正在处理，点击查看" : speaking ? "正在朗读，点击查看" : unread ? "有新的结果，点击查看" : appearance.clickAction === "voice" ? "说一声，交给 Agent" : "打开 Agent · 拖动贴边"}</span>
    </button>
  </div>, document.body);
}
