import { ArrowUp, ArrowUpRight, Check, Keyboard, Mic, Plus, Square, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { post, type Project } from "../core";
import { AGENT_SESSION_CHANGED, notifyAgentSessionChanged, type AgentSessionChange } from "../agent-session-events";
import { startSpeechRecognition } from "../speech-recognition";
import { startSpeechRecognition as startCloudSpeechRecognition } from "../asr-recognition";
import type { AgentFloatPreferences } from "../agent-float-preferences";
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
const isRunning = (session: Session | null) => session?.execution?.active ?? session?.status === "running";
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

export function AgentFloatButton({ project, reload, onOpenSession, onSettings, appearance }: {
  appearance: AgentFloatPreferences;
  project: Project | null; reload: () => Promise<void>; onOpenSession: (sessionId: string) => void; onSettings?: () => void;
}) {
  const pid = project?.id;
  const sessionKey = `spielberg-agent-float-session-${pid}`;
  const [position, setPosition] = useState(initialPosition);
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [open, setOpen] = useState(false);
  const [speechProvider, setSpeechProvider] = useState<"system" | "cloud">("system");
  const [speechState, setSpeechState] = useState<ListeningState>("idle");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [restoring, setRestoring] = useState(!!pid && !!readStorage(sessionKey));
  const [restoreFailed, setRestoreFailed] = useState(false);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [panelHeight, setPanelHeight] = useState(330);
  const panel = useRef<HTMLElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);
  const sessionRef = useRef<Session | null>(null);
  const submitting = useRef(false);
  const speech = useRef<SpeechController | null>(null);
  const speechAbort = useRef<AbortController | null>(null);
  const speechVersion = useRef(0);
  const transcript = useRef("");
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
    sessionRef.current = next; setSession(next); writeStorage(sessionKey, next.id);
    if (previous?.id !== next.id || previous?.status !== next.status || isRunning(previous) !== isRunning(next)) {
      if (pid) notifyAgentSessionChanged(pid, next.id, "float");
    }
    if (isRunning(previous) && !isRunning(next)) void reload().catch(() => {
      if (mounted.current) setError("操作已结束，但页面刷新失败，请刷新页面查看结果。");
    });
  }, [pid, reload, sessionKey]);

  const cancelSpeech = useCallback(() => {
    speechVersion.current++;
    speechAbort.current?.abort(); speechAbort.current = null;
    speech.current?.cancel(); speech.current = null;
    setSpeechState("idle");
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; speechVersion.current++; speechAbort.current?.abort(); speech.current?.cancel(); };
  }, []);
  useEffect(() => {
    const resize = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
      setPosition(current => { const next = clampPosition(current); writeStorage(POSITION_KEY, JSON.stringify(next)); return next; });
    };
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useLayoutEffect(() => {
    if (!open || !panel.current) return;
    const observer = new ResizeObserver(() => setPanelHeight(panel.current?.getBoundingClientRect().height || 330));
    observer.observe(panel.current);
    panel.current.focus({ preventScroll: true });
    return () => observer.disconnect();
  }, [open]);
  useEffect(() => {
    const saved = pid && readStorage(sessionKey);
    if (!saved) { setRestoring(false); return; }
    let disposed = false;
    setRestoring(true); setRestoreFailed(false);
    void call<Session>("session", { session_id: saved }).then(result => {
      if (!disposed) { accept(result); setError(""); }
    }).catch(e => {
      if (disposed) return;
      if (String(e).includes("会话不存在")) { writeStorage(sessionKey, ""); return; }
      setError(`无法恢复语音会话：${String(e)}`); setRestoreFailed(true);
    }).finally(() => { if (!disposed) setRestoring(false); });
    return () => { disposed = true; };
  }, [pid, sessionKey, call, accept, restoreAttempt]);
  useEffect(() => {
    let disposed = false;
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<AgentSessionChange>).detail;
      if (detail.source === "float" || detail.projectId !== pid || detail.sessionId !== sessionRef.current?.id) return;
      if (detail.deleted) {
        sessionRef.current = null; setSession(null); writeStorage(sessionKey, ""); setError("");
        return;
      }
      void call<Session>("session", { session_id: detail.sessionId }).then(next => {
        if (!disposed && sessionRef.current?.id === next.id) accept(next);
      }).catch(e => { if (!disposed) setError(String(e)); });
    };
    window.addEventListener(AGENT_SESSION_CHANGED, changed);
    return () => { disposed = true; window.removeEventListener(AGENT_SESSION_CHANGED, changed); };
  }, [pid, sessionKey, call, accept]);
  useEffect(() => {
    if (!running || !session?.id) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await call<Session>("session", { session_id: session.id });
        if (!disposed) { setError(""); accept(next); }
      } catch (e) { if (!disposed) setError(`读取执行进度失败，正在重试：${String(e)}`); }
      if (!disposed) timer = setTimeout(poll, 1200);
    };
    timer = setTimeout(poll, 400);
    return () => { disposed = true; clearTimeout(timer); };
  }, [running, session?.id, call, accept]);

  const send = async (text: string) => {
    const message = text.trim();
    if (!pid || !message || submitting.current || isRunning(sessionRef.current) || restoring || restoreFailed || !mounted.current) return;
    submitting.current = true; setSending(true); setError(""); setDraft(message);
    try {
      let current = sessionRef.current;
      if (!current) {
        current = await call<Session>("create", { title: message.slice(0, 40) });
        if (!mounted.current) return;
        accept(current);
      }
      const result = await call<Session>("run", { session_id: current.id, message, web_enabled: true });
      if (mounted.current) { accept(result); setDraft(""); }
    } catch (e) { if (mounted.current) setError(String(e).replace(/^Error: /, "")); }
    finally { submitting.current = false; if (mounted.current) setSending(false); }
  };
  const startListening = async () => {
    setOpen(true);
    if (!pid || locked || listening || speechAbort.current) return;
    const version = ++speechVersion.current;
    const controller = new AbortController(); speechAbort.current = controller;
    transcript.current = ""; setError(""); setSpeechState("starting");
    const current = () => mounted.current && version === speechVersion.current && !controller.signal.aborted;
    try {
      const startRecognition = speechProvider === "system" ? startSpeechRecognition : startCloudSpeechRecognition;
      const recognition = await startRecognition({
        onStart: () => { if (current()) setSpeechState("listening"); },
        onResult: text => {
          if (current() && text.trim()) {
            transcript.current = text;
            setDraft(transcript.current);
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
          if (transcript.current.trim()) void send(transcript.current);
          else { setError("没有听到内容，请再试一次，或直接输入指令。"); input.current?.focus(); }
        },
      }, { signal: controller.signal, projectId: pid, onFinishing: () => { if (current()) setSpeechState("finishing"); } });
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
  const close = () => { cancelSpeech(); setOpen(false); button.current?.focus({ preventScroll: true }); };
  const stopAgent = async () => {
    if (!session?.id || stopping || cancelling) return;
    setStopping(true); setError("");
    try { accept(await call<Session>("cancel", { session_id: session.id })); }
    catch (e) { if (mounted.current) setError(String(e)); }
    finally { if (mounted.current) setStopping(false); }
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
    if (drag.current.moved) writeStorage(POSITION_KEY, JSON.stringify(position));
    if (event.type === "pointercancel") suppressClick.current = true;
    drag.current = null; setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const panelWidth = Math.min(368, viewport.width - 24);
  const panelLeft = Math.max(12, Math.min(position.x + SIZE - panelWidth, viewport.width - panelWidth - 12));
  const panelTop = Math.max(12, Math.min(position.y >= panelHeight + 24 ? position.y - panelHeight - 14 : position.y + SIZE + 14, viewport.height - panelHeight - 12));
  const state = listening ? "listening" : sending || running ? "working" : error || session?.status === "failed" ? "error" : "idle";
  const status = speechState === "starting" ? "正在打开麦克风" : speechState === "finishing" ? "正在识别语音" : listening ? "我在听，说完即可（最长 60 秒）" : sending ? "正在发送指令" : cancelling ? "正在停止操作" : running ? (session?.execution?.phase === "streaming" ? "正在回复" : "Agent 正在执行") : restoring ? "正在恢复会话" : session?.status === "completed" ? "已完成" : session?.status === "limited" ? "已暂停，可继续" : session?.status === "cancelled" ? "已停止" : "有什么我可以帮你？";
  const lastUserIndex = session?.messages.map(message => message.role).lastIndexOf("user") ?? -1;
  const lastUser = lastUserIndex >= 0 ? session?.messages[lastUserIndex].content : "";
  const reply = session?.messages.slice(lastUserIndex + 1).filter(message => message.role === "assistant" && message.content).map(message => message.content).join("\n\n");

  return createPortal(<div className="agent-float" data-state={state} >
    {open && <section ref={panel} className="agent-float-panel" data-testid="agent-float-panel" role="dialog" aria-label="语音 Agent 助手" tabIndex={-1} style={{ left: panelLeft, top: panelTop, width: panelWidth }}>
      <header><div className="agent-float-heading"><span className="agent-float-indicator" /><strong>Agent</strong><span>随时，说一声</span></div><button type="button" className="agent-float-icon" aria-label="收起语音助手" title="收起 · Esc" onClick={close}><X size={17} /></button></header>
      <label className="agent-float-project">语音识别 <select aria-label="语音识别方式" value={speechProvider} disabled={listening} onChange={e => setSpeechProvider(e.target.value as "system" | "cloud")}><option value="system">系统自带（默认）</option><option value="cloud">项目 ASR 渠道</option></select></label>
      <div className="agent-float-project" title={project?.name}>{project?.name || "请先打开或创建一个项目"}</div>
      <div className="agent-float-status" role="status">{listening && <span className="agent-float-wave" aria-hidden="true">{[0, 1, 2, 3, 4].map(i => <i key={i} />)}</span>}{session?.status === "completed" && !listening && !sending && <Check size={15} />}<span>{status}</span></div>
      {lastUser && !listening && <p className="agent-float-request">{lastUser}</p>}
      {reply && !listening && <div className="agent-float-reply" data-testid="agent-float-reply">{reply}</div>}
      {(error || session?.error) && <div className="agent-float-error" role="alert">{error || session?.error}{restoreFailed && <button onClick={() => setRestoreAttempt(value => value + 1)}>重新连接</button>}</div>}
      {onSettings && !listening && error && <button className="agent-float-settings" onClick={onSettings}>检查模型设置 <ArrowUpRight size={12} /></button>}
      <form onSubmit={event => { event.preventDefault(); if (!listening) void send(draft); }}>
        <textarea ref={input} data-testid="agent-float-input" value={draft} onChange={event => setDraft(event.target.value)} readOnly={listening} disabled={!pid || locked} rows={2} maxLength={16000} aria-label="Agent 指令" placeholder={listening ? "正在聆听…" : "也可以输入你的指令…"}  />
        <div className="agent-float-composer-actions"><span>{listening ? "说完自动执行" : "点击箭头发送"}</span><div>
          {listening ? <button type="button" className="agent-float-icon" aria-label="取消听写，改用文字" title="取消听写，改用文字" onClick={() => { cancelSpeech(); input.current?.focus(); }}><Keyboard size={17} /></button> : <button type="button" className="agent-float-icon" aria-label="开始语音输入" title="开始语音输入" disabled={!pid || locked} onClick={() => void startListening()}><Mic size={17} /></button>}
          {running ? <button type="button" data-testid="agent-float-stop" className="agent-float-submit" aria-label="停止 Agent 执行" disabled={cancelling} onClick={() => void stopAgent()}><Square size={14} /></button> : listening ? <button type="button" className="agent-float-submit" aria-label="结束听写并执行" disabled={speechState !== "listening"} onClick={finishListening}><ArrowUp size={18} /></button> : <button type="submit" data-testid="agent-float-send" className="agent-float-submit" aria-label="执行指令" disabled={!pid || !draft.trim() || locked}><ArrowUp size={18} /></button>}
        </div></div>
      </form>
      <footer><button type="button" disabled={!session || locked || listening} onClick={() => { sessionRef.current = null; setSession(null); writeStorage(sessionKey, ""); setDraft(""); setError(""); input.current?.focus(); }}><Plus size={13} />新对话</button><button type="button" disabled={!session} onClick={() => { if (session) { cancelSpeech(); onOpenSession(session.id); setOpen(false); } }}>打开完整对话<ArrowUpRight size={13} /></button></footer>
    </section>}
    <button ref={button} type="button" className={`agent-float-button${dragging ? " is-dragging" : ""}`} data-testid="agent-float-button" data-state={state} style={{ left: position.x, top: position.y }} aria-label={listening ? "结束听写并执行" : running || sending ? "查看 Agent 执行进度" : "语音 Agent，点击说话，拖动移动"} aria-expanded={open} aria-haspopup="dialog" title="点击说话 · 拖动移动 · 方向键调整位置" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd} onLostPointerCapture={() => { drag.current = null; setDragging(false); }} onClick={event => {
      if (suppressClick.current && event.detail !== 0) { suppressClick.current = false; return; }
      if (listening) finishListening(); else if (running || sending || restoring || restoreFailed || !pid) setOpen(true); else void startListening();
    }} ><AgentLivingOrb color={appearance.color} intensity={appearance.intensity} mode={listening ? "listen" : sending || running ? session?.execution?.phase === "streaming" ? "speak" : "think" : state === "error" ? "error" : "idle"} />{(running || sending) && <span className="agent-float-busy-dot" aria-hidden="true" />}<span className="agent-float-tooltip">{listening ? "点击结束" : running || sending ? "执行中" : "说一声，交给 Agent"}</span></button>
  </div>, document.body);
}
