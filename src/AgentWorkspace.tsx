import { Button, Input, Message, Modal, Select, Spin, Switch } from "@arco-design/web-react";
import { ArrowUp, Folder, PencilLine, Search, Bot, Check, ChevronDown, Globe, MessageSquare, Plus, Settings2, Square, Trash2, Wrench, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { post, type Snapshot } from "./core";
import "./agent.css";
import { backendUrl } from "./transport";

type AgentMessage = { role: "user" | "assistant" | "tool"; content: string; tool_name?: string; tool_call_id?: string; arguments?: unknown; status?: string; tool_calls?: unknown[] };
type Session = { id: string; title: string; status: string; messages: AgentMessage[]; error?: string; updated_at: string };
type Config = { inherit_llm: boolean; base_url: string; model: string; has_api_key: boolean; search_provider: string; has_search_api_key: boolean; max_steps: number };
const initialConfig: Config = { inherit_llm: true, base_url: "", model: "", has_api_key: false, search_provider: "duckduckgo", has_search_api_key: false, max_steps: 16 };
const statusText: Record<string, string> = { idle: "新对话", running: "执行中", completed: "已完成", failed: "执行失败", cancelled: "已停止" };
const toolText: Record<string, string> = { get_project: "读取项目", list_skills: "查找技能", read_skill: "读取技能", app_describe: "查看操作说明", app_request: "操作项目数据", app_action: "执行创作操作", web_search: "联网搜索", fetch_webpage: "读取网页" };
function displayJson(value: unknown) { if (typeof value === "string") { try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; } } return JSON.stringify(value, null, 2); }

export default function AgentWorkspace({ data, reload, onNavigate }: { data: Snapshot; reload: () => Promise<void>; onNavigate?: (page: string) => void }) {
  const pid = data.project.id;
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selected, setSelected] = useState<Session | null>(null);
  const selectedRef = useRef<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
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
  const draftKey = selected?.id || "new";
  const draft = drafts[draftKey] || "";
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

  const createSession = async () => {
    if (busy.current || creating) return;
    setCreating(true); setError(""); const version = ++selectionVersion.current;
    try { const session = await call<Session>("create"); if (mounted.current && version === selectionVersion.current) { accept(session); setMobileSessions(false); followBottom.current = true; composer.current?.focus(); } }
    catch (e) { if (mounted.current) setError(String(e)); }
    finally { if (mounted.current) setCreating(false); }
  };
  const send = async () => {
    const text = draft.trim(); if (!text || busy.current || running || loading || creating) return;
    if (!configured) { openSettings(); return; }
    busy.current = true; setSending(true); setError(""); const version = ++selectionVersion.current; const key = draftKey;
    try {
      const session = selectedRef.current || await call<Session>("create");
      const result = await call<Session>("run", { session_id: session.id, message: text, web_enabled: online });
      if (!mounted.current) return;
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
      <aside className={`agent-history${mobileSessions ? " is-open" : ""}`} aria-label="Agent 会话">
        <button className="agent-project-picker" onClick={() => onNavigate?.("projects")}><Folder size={21} /><strong>{data.project.name}</strong><ChevronDown size={14} /><small><i className="agent-status-dot" />本地项目</small></button>
        <Button long data-testid="agent-new-session" icon={<Plus size={16} />} loading={creating} disabled={loading || sending} onClick={() => void createSession()}>新建会话</Button>
        <div className="agent-history-heading"><span>项目会话</span><Button size="mini" type="text" className="agent-mobile-history" aria-label="关闭会话列表" icon={<X size={16} />} onClick={() => setMobileSessions(false)} /></div>
        <div className="agent-session-list">{sessions.length === 0 && <div className="agent-history-empty"><MessageSquare size={28} /><b>暂无会话</b><p>开始创作后，会话将保存在这里</p></div>}{sessions.map(session => <div className={`agent-session${selected?.id === session.id ? " is-selected" : ""}`} key={session.id}>
          <button data-testid={`agent-session-${session.id}`} className="agent-session-select" onClick={() => void choose(session)} disabled={creating}><MessageSquare size={15} /><span><strong>{session.title}</strong><small data-status={session.status}>{statusText[session.status] || session.status}</small></span></button>
          <button type="button" className="agent-delete" aria-label={`删除会话 ${session.title}`} disabled={session.status === "running" || sending} onClick={() => remove(session)}><Trash2 size={14} /></button>
        </div>)}</div>
      </aside>
      <div className={`agent-conversation${empty ? " is-empty" : ""}`}>
        <div className="agent-conversation-bar"><div><Button className="agent-mobile-history" aria-label="打开会话列表" icon={<MessageSquare size={16} />} onClick={() => setMobileSessions(value => !value)} /><b>{selected?.title || "Agent 助手"}</b></div><div className="agent-conversation-actions">{running && <span><i className="agent-status-dot" />正在执行</span>}<Button type="text" data-testid="agent-settings" aria-label="Agent 设置" icon={<Settings2 size={16} />} onClick={openSettings}>Agent 设置</Button></div></div>
        {!configured && !loading && <div className="agent-config-notice">配置支持工具调用的 LLM 后，即可开始使用。<button onClick={openSettings}>配置 Agent</button>{onNavigate && <button onClick={() => onNavigate("settings")}>打开项目设置</button>}</div>}
        <div className="agent-messages" ref={log} role="log" aria-label="Agent 对话记录" aria-busy={running || loading} onScroll={() => { const element = log.current; if (element) followBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100; }}>
          {loading ? <div className="agent-loading"><Spin /><span>正在读取会话</span></div> : !selected?.messages.length ? <div className="agent-empty">
            <h2>下一幕，从这里开始</h2><p>描述你的目标，我会结合当前项目开始创作。</p>
          </div> : selected.messages.map((message, index) => message.role === "tool" ? <details className="agent-tool" key={`${message.tool_call_id || index}:${index}`}>
            <summary><Wrench size={14} /><span>{toolText[message.tool_name || ""] || message.tool_name || "执行工具"}</span><small>{message.arguments && typeof message.arguments === "object" ? String((message.arguments as Record<string, unknown>).operation || (message.arguments as Record<string, unknown>).resource || "") : ""}</small><span className={`agent-tool-status ${message.status}`}>{message.status === "running" ? "执行中" : message.status === "failed" ? "失败" : <><Check size={12} />完成</>}</span><ChevronDown size={14} /></summary>
            {message.arguments != null && <div><b>参数</b><pre>{displayJson(message.arguments)}</pre></div>}<div><b>结果</b><pre>{message.content ? displayJson(message.content) : "等待执行结果…"}</pre></div>
          </details> : message.content ? <article className={`agent-message is-${message.role}`} key={index}>
            <div className="agent-message-label">{message.role === "user" ? "你" : <><Bot size={15} />Agent</>}</div><div className="agent-message-content">{message.role === "user" ? <p>{message.content}</p> : <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ children, href, ...props }) => <a {...props} href={href?.startsWith("/api/v1/") ? backendUrl(href) : href} target="_blank" rel="noopener noreferrer">{children}</a> }}>{message.content}</ReactMarkdown>}</div>
          </article> : null)}
          {running && <div className="agent-working"><span className="agent-pulse" /><span>Agent 正在处理项目，可以查看上方执行详情。</span></div>}
          {(error || selected?.error) && <div className="agent-error" role="alert">{error || selected?.error}</div>}
        </div>
        <div className="agent-composer-wrap">
          <div className="agent-composer"><textarea ref={composer} data-testid="agent-composer" aria-label="向 Agent 发送消息" value={draft} maxLength={16000} disabled={loading || sending || creating} placeholder="描述你想完成的创作…" onChange={event => updateDraft(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
            <div className="agent-composer-actions"><label className="agent-web-toggle"><Switch size="small" checked={online} onChange={setOnline} disabled={running || sending} aria-label="联网搜索" /><Globe size={14} />联网搜索</label><Button className="agent-model-button" onClick={openSettings}>{config.model || "配置模型"}<ChevronDown size={14} /></Button>{running ? <Button data-testid="agent-stop" aria-label="停止执行" status="danger" icon={<Square size={14} />} loading={stopping} onClick={() => void stop()}>停止</Button> : <Button type="primary" data-testid="agent-send" aria-label="发送消息" icon={<ArrowUp size={20} />} loading={sending} disabled={!draft.trim() || loading || creating} onClick={() => void send()} />}</div>
          </div>
          {empty && <>
            <div className="agent-starters">{[
              ["整理项目", "查看当前项目，整理剧本、角色、剧集和场景的制作进度，并提出下一步建议。"],
              ["开始一个故事", "写一个雨夜车站重逢的短片剧本，创建主要角色，并建立第一集和三个场景。"],
              ["搜索创作参考", "联网搜索电影雨夜车站场景的灯光和镜头参考，注明来源，并把可用的创作提示词保存到 Prompt 库。"],
            ].map(([label, text]) => <button key={label} onClick={() => { updateDraft(text); composer.current?.focus(); }}><span>{label === "搜索创作参考" ? <Search size={20} /> : label === "整理项目" ? <Folder size={20} /> : <PencilLine size={20} />}{label}</span></button>)}</div>
          <p className="agent-keyboard-hint">Enter 发送 · Shift + Enter 换行</p></>}
        </div>
      </div>
    </div>
    <Modal title="Agent 设置" visible={settingsOpen} onCancel={() => !saving && setSettingsOpen(false)} onOk={() => void saveSettings()} okText="保存设置" cancelText="取消" confirmLoading={saving} maskClosable={!saving} style={{ width: 580 }} className="agent-settings-modal">
      <div className="agent-settings-form"><label className="agent-inherit"><span><b>沿用项目 LLM 配置</b><small>使用「设置」中的 LLM（分镜与 Prompt）服务。</small></span><Switch aria-label="沿用项目 LLM 配置" checked={form.inherit_llm} onChange={value => setForm(item => ({ ...item, inherit_llm: value }))} disabled={saving} /></label>
        <label>Base URL<Input aria-label="Base URL" value={form.base_url} disabled={form.inherit_llm || saving} placeholder="https://your-service.example/v1" onChange={value => setForm(item => ({ ...item, base_url: value }))} /></label>
        <label>模型名称<Input aria-label="模型名称" value={form.model} disabled={form.inherit_llm || saving} placeholder="支持函数工具调用的模型名称" onChange={value => setForm(item => ({ ...item, model: value }))} /></label>
        {!form.inherit_llm && <label>API Key<Input.Password aria-label="API Key" value={apiKey} disabled={saving} placeholder="独立服务 Key；留空保留 Agent 已存 Key" onChange={setApiKey} /></label>}
        <div className="agent-settings-divider" /><label>搜索服务<Select aria-label="搜索服务" value={form.search_provider} disabled={saving} options={[{ label: "自动搜索 · DuckDuckGo / Bing（无需 Key）", value: "duckduckgo" }, { label: "Brave Search", value: "brave" }, { label: "Tavily", value: "tavily" }]} onChange={value => setForm(item => ({ ...item, search_provider: value }))} /></label>
        {form.search_provider !== "duckduckgo" && <label>搜索 API Key<Input.Password aria-label="搜索 API Key" value={searchKey} disabled={saving} placeholder={config.has_search_api_key ? "已保存，留空保留" : "输入搜索服务 API Key"} onChange={setSearchKey} /></label>}
        <label>最多执行步数<input aria-label="最多执行步数" type="number" min={1} max={64} value={form.max_steps} disabled={saving} onChange={event => setForm(item => ({ ...item, max_steps: Math.min(64, Math.max(1, Number(event.target.value) || 1)) }))} /></label>
        <p>模型服务需要支持 OpenAI Chat Completions 工具调用。项目内容和检索资料会发送至该服务；密钥仅保存在后端。停止后已完成的修改会保留，正在执行的生成或导出可能继续完成。</p>
      </div>
    </Modal>
  </section>;
}
