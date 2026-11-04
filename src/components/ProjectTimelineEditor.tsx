import { useEffect, useId, useRef, useState } from "react";
import { Button, Input } from "@arco-design/web-react";
import { ArrowDown, ArrowUp, Clock3, GitBranch, Pencil, Plus, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import type { ProjectTimeline, ProjectTimelineEntry } from "../core";
import { localId } from "../id";
import { ConfirmPopover } from "./ConfirmAction";
import "./project-timeline-editor.css";

type Props = {
  timelines: ProjectTimeline[];
  onChange: (timelines: ProjectTimeline[]) => void;
  disabled?: boolean;
  revealTimeline?: { id: string };
};

const eventCount = (timeline: ProjectTimeline) => timeline.entries.reduce((count, entry) => count + entry.events.length, 0);

export default function ProjectTimelineEditor({ timelines, onChange, disabled = false, revealTimeline }: Props) {
  const controlPrefix = useId();
  const [editing, setEditing] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [selectedId, setSelectedId] = useState<string | null>(timelines[0]?.id ?? null);
  const root = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<{ kind: "point" | "event"; id: string } | null>(null);
  const current = timelines.find(timeline => timeline.id === selectedId) ?? timelines[0];

  useEffect(() => {
    if (revealTimeline) { setSelectedId(revealTimeline.id); setEditing(true); }
  }, [revealTimeline]);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    const element = root.current?.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      `[data-${target.kind}-id="${target.id}"] ${target.kind === "point" ? "input" : "textarea"}`,
    );
    if (element) {
      element.focus();
      pendingFocus.current = null;
    }
  }, [timelines]);

  const updateTimeline = (patch: Partial<ProjectTimeline>) => {
    if (!current || disabled) return;
    onChange(timelines.map(timeline => timeline.id === current.id ? { ...timeline, ...patch } : timeline));
  };
  const updateEntry = (id: string, patch: Partial<ProjectTimelineEntry>) => {
    if (!current) return;
    updateTimeline({ entries: current.entries.map(entry => entry.id === id ? { ...entry, ...patch } : entry) });
  };
  const addTimeline = () => {
    if (disabled) return;
    const id = localId();
    let title = "主时间线";
    if (timelines.length) {
      let number = timelines.length + 1;
      while (timelines.some(timeline => timeline.title === `时间线 ${number}`)) number++;
      title = `时间线 ${number}`;
    }
    onChange([...timelines, { id, title, description: "", entries: [] }]);
    setSelectedId(id);
    setEditing(true);
  };
  const removeTimeline = () => {
    if (!current || disabled) return;
    const index = timelines.findIndex(timeline => timeline.id === current.id);
    const next = timelines.filter(timeline => timeline.id !== current.id);
    onChange(next);
    setSelectedId(next[Math.min(index, next.length - 1)]?.id ?? null);
  };
  const addEntry = () => {
    if (!current || disabled) return;
    const id = localId();
    pendingFocus.current = { kind: "point", id };
    updateTimeline({ entries: [...current.entries, { id, time: "", events: [{ id: localId(), content: "" }] }] });
  };
  const addEvent = (entry: ProjectTimelineEntry) => {
    if (disabled) return;
    const id = localId();
    pendingFocus.current = { kind: "event", id };
    updateEntry(entry.id, { events: [...entry.events, { id, content: "" }] });
  };
  const moveEntry = (index: number, direction: -1 | 1) => {
    if (!current || disabled || index + direction < 0 || index + direction >= current.entries.length) return;
    const entries = [...current.entries];
    [entries[index], entries[index + direction]] = [entries[index + direction], entries[index]];
    updateTimeline({ entries });
  };

  return <div className="project-timeline-editor" ref={root}>
    <aside className="project-timeline-sidebar" aria-label="项目时间线列表">
      <div className="project-timeline-list-heading"><span>时间线 <small>{timelines.length}</small></span><Button type="text" size="small" icon={<Plus size={16} />} aria-label="新建时间线" title="新建时间线" disabled={disabled} onClick={addTimeline} /></div>
      <nav aria-label="选择时间线">
        {timelines.map(timeline => <button type="button" key={timeline.id} aria-pressed={current?.id === timeline.id} className="project-timeline-option" onClick={() => { setSelectedId(timeline.id); setEditing(false); }}>
          <GitBranch size={17} aria-hidden="true" />
          <span><strong>{timeline.title || "未命名时间线"}</strong><small>{timeline.entries.length} 个时间点 · {eventCount(timeline)} 个事件</small></span>
        </button>)}
        {!timelines.length && <p className="project-timeline-list-empty">把主线、人物经历或不同年代，整理成独立的时间线。</p>}
      </nav>
      <div className="project-timeline-sidebar-note"><Clock3 size={14} aria-hidden="true" /><span>每个时间点可记录多个事件</span></div>
    </aside>

    {current ? <div className="project-timeline-workspace" key={current.id}>
      <div className="project-timeline-view-toolbar">
        <span>{editing ? "编辑时间线" : "时间轴"}</span>
        <Button icon={editing ? <GitBranch size={15} /> : <Pencil size={15} />} onClick={() => setEditing(value => !value)}>{editing ? "查看时间轴" : "编辑时间线"}</Button>
      </div>
      {editing ? <>
      <div className="project-timeline-details">
        <div className="project-timeline-title-row"><label className="project-timeline-title-field"><span>时间线名称 <i aria-hidden="true">*</i></span><Input aria-label="时间线名称" value={current.title} disabled={disabled} placeholder="例如：故事主线、人物成长线" onChange={title => updateTimeline({ title })} /></label>
          <ConfirmPopover title="删除这条时间线？" content={`「${current.title || "未命名时间线"}」及其中的 ${eventCount(current)} 个事件将被移除，保存配置后生效。`} okText="删除时间线" onOk={removeTimeline}><Button className="project-timeline-delete" type="text" status="danger" icon={<Trash2 size={16} />} aria-label="删除时间线" title="删除时间线" disabled={disabled} /></ConfirmPopover>
        </div>
        <label className="project-timeline-description-field"><span>时间线说明 <small>选填</small></span><Input.TextArea aria-label="时间线说明" value={current.description} disabled={disabled} autoSize={{ minRows: 1, maxRows: 3 }} placeholder="描述这条时间线的范围与视角……" onChange={description => updateTimeline({ description })} /></label>
      </div>
      <div className="project-timeline-toolbar"><div><strong>{current.entries.length} 个时间点 <span>· {eventCount(current)} 个事件</span></strong><p>时间支持日期或「第三天」「高三开学」等描述，按排列顺序展示。</p></div><Button icon={<Plus size={15} />} disabled={disabled} onClick={addEntry}>添加时间点</Button></div>
      <div className="project-timeline-scroll" aria-label="时间线事件">
        {current.entries.length ? <div className="project-timeline-points">
          {current.entries.map((entry, entryIndex) => <section key={entry.id} data-point-id={entry.id} className="project-timeline-point" aria-label={`第 ${entryIndex + 1} 个时间点`}>
            <div className="project-timeline-point-time"><label><span>时间点 {String(entryIndex + 1).padStart(2, "0")} <i aria-hidden="true">*</i></span><Input aria-label={`时间点 ${entryIndex + 1}`} value={entry.time} disabled={disabled} placeholder="例如：2008 年 9 月" onChange={time => updateEntry(entry.id, { time })} /></label>
              <div className="project-timeline-point-actions">
                <Button type="text" size="small" icon={<ArrowUp size={14} />} aria-label={`上移时间点 ${entryIndex + 1}`} title="上移时间点" disabled={disabled || entryIndex === 0} onClick={() => moveEntry(entryIndex, -1)} />
                <Button type="text" size="small" icon={<ArrowDown size={14} />} aria-label={`下移时间点 ${entryIndex + 1}`} title="下移时间点" disabled={disabled || entryIndex === current.entries.length - 1} onClick={() => moveEntry(entryIndex, 1)} />
                <ConfirmPopover title="删除这个时间点？" content={`「${entry.time || "未填写时间"}」及其中的 ${entry.events.length} 个事件将被移除。`} okText="删除时间点" onOk={() => updateTimeline({ entries: current.entries.filter(item => item.id !== entry.id) })}><Button type="text" size="small" status="danger" icon={<Trash2 size={14} />} aria-label={`删除时间点 ${entryIndex + 1}`} title="删除时间点" disabled={disabled} /></ConfirmPopover>
              </div>
            </div>
            <div className="project-timeline-events">
              {entry.events.map((event, eventIndex) => <div className="project-timeline-event" data-event-id={event.id} key={event.id}>
                <div className="project-timeline-event-heading"><label htmlFor={`${controlPrefix}-event-${entryIndex}-${eventIndex}`}>事件 {String(eventIndex + 1).padStart(2, "0")}</label><ConfirmPopover title="删除这个事件？" content="此事件将从时间点中移除，保存配置后生效。" okText="删除事件" onOk={() => updateEntry(entry.id, { events: entry.events.filter(item => item.id !== event.id) })}><Button type="text" size="small" icon={<Trash2 size={14} />} aria-label={`删除时间点 ${entryIndex + 1} 的事件 ${eventIndex + 1}`} title="删除事件" disabled={disabled} /></ConfirmPopover></div>
                <Input.TextArea id={`${controlPrefix}-event-${entryIndex}-${eventIndex}`} aria-label={`时间点 ${entryIndex + 1} 的事件 ${eventIndex + 1}`} value={event.content} disabled={disabled} autoSize={{ minRows: 2, maxRows: 10 }} placeholder="记录此时发生的事件、涉及的人物和关键变化……" onChange={content => updateEntry(entry.id, { events: entry.events.map(item => item.id === event.id ? { ...item, content } : item) })} />
              </div>)}
              {!entry.events.length && <p className="project-timeline-no-events">这个时间点还没有事件，添加一个开始记录。</p>}
              <Button className="project-timeline-add-event" type="text" size="small" icon={<Plus size={14} />} aria-label={`为时间点 ${entryIndex + 1} 添加事件`} disabled={disabled} onClick={() => addEvent(entry)}>添加同一时间的事件</Button>
            </div>
          </section>)}
          <Button className="project-timeline-add-point" long icon={<Plus size={15} />} disabled={disabled} onClick={addEntry}>继续添加时间点</Button>
        </div> : <div className="project-timeline-empty"><span className="project-timeline-empty-icon"><Clock3 size={28} strokeWidth={1.5} /></span><h3>从第一个时间点开始</h3><p>记录故事中的关键时刻，把同时发生的事件放在一起。</p><Button icon={<Plus size={15} />} disabled={disabled} onClick={addEntry}>添加第一个时间点</Button></div>}
      </div>
      </> : <>
        <header className="project-timeline-overview"><h2>{current.title || "未命名时间线"}</h2>{current.description && <p>{current.description}</p>}<small>{current.entries.length} 个时间点 · {eventCount(current)} 个事件 · 按编排顺序展示</small></header>
        <div className="project-timeline-zoom" role="group" aria-label="时间轴缩放">
          <Button size="small" icon={<ZoomOut size={16} />} aria-label="缩小时间轴" disabled={zoom <= 50} onClick={() => setZoom(value => Math.max(50, value - 25))} />
          <input aria-label="时间轴缩放比例" type="range" min="50" max="200" step="10" value={zoom} onChange={event => setZoom(Number(event.target.value))} />
          <Button size="small" icon={<ZoomIn size={16} />} aria-label="放大时间轴" disabled={zoom >= 200} onClick={() => setZoom(value => Math.min(200, value + 25))} />
          <output>{zoom}%</output><Button size="small" type="text" onClick={() => setZoom(100)}>重置</Button>
        </div>
        {current.entries.length ? <div className="project-timeline-axis-scroll" tabIndex={0} aria-label="时间轴，左右滚动浏览时间点">
          <div className="project-timeline-axis" style={{ gridTemplateColumns: `repeat(${current.entries.length}, ${280 * zoom / 100}px)` }}>
            {current.entries.map((entry, index) => <section className="project-timeline-axis-point" key={entry.id}>
              <div className="project-timeline-axis-time"><small>{String(index + 1).padStart(2, "0")}</small><h3>{entry.time || "未填写时间"}</h3></div>
              <div className="project-timeline-axis-events">{entry.events.map((event, eventIndex) => <article key={event.id}><small>事件 {String(eventIndex + 1).padStart(2, "0")}</small><p>{event.content || "未填写事件"}</p></article>)}{!entry.events.length && <p className="project-timeline-no-events">暂无事件</p>}</div>
            </section>)}
          </div>
        </div> : <div className="project-timeline-empty"><span className="project-timeline-empty-icon"><Clock3 size={28} /></span><h3>还没有时间点</h3><p>进入编辑界面，记录故事中的关键时刻。</p><Button icon={<Plus size={15} />} disabled={disabled} onClick={() => { setEditing(true); addEntry(); }}>添加第一个时间点</Button></div>}
      </>}
    </div> : <div className="project-timeline-empty project-timeline-start"><span className="project-timeline-empty-icon"><GitBranch size={30} strokeWidth={1.5} /></span><h3>让故事的脉络更清晰</h3><p>一个项目可以拥有多条时间线。<br />分别梳理故事主线、人物经历与平行事件。</p><Button type="primary" icon={<Plus size={16} />} disabled={disabled} onClick={addTimeline}>创建第一条时间线</Button></div>}
  </div>;
}
