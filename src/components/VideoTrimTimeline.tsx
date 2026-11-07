import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";

type Edge = "start" | "end";
type Props = {
  duration: number;
  start: number;
  end: number;
  currentTime: number;
  disabled: boolean;
  onChange: (edge: Edge, value: number) => void;
  onSeek: (value: number) => void;
  onGestureStart: () => void;
  onGestureEnd: (cancel?: boolean) => void;
  frames?: string[];
};
type Gesture = {
  kind: "trim";
  edge: Edge;
  pointerId: number;
  owner: HTMLButtonElement;
  x: number;
  value: number;
  width: number;
  duration: number;
} | {
  kind: "seek";
  pointerId: number;
  owner: HTMLDivElement;
};

const MINIMUM = 0.05;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
function labelTime(value: number, fractional = false) {
  const ticks = Math.round(Math.max(0, value) * (fractional ? 100 : 1));
  const seconds = fractional ? ticks / 100 : ticks;
  const rest = seconds % 60;
  return `${Math.floor(seconds / 60)}:${fractional ? rest.toFixed(2).padStart(5, "0") : String(rest).padStart(2, "0")}`;
}

/** A source-time ruler: scrubbing only seeks, while the two handles change the retained range. */
export function VideoTrimTimeline(props: Props) {
  const track = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const duration = Number.isFinite(props.duration) ? Math.max(0, props.duration) : 0;
  const start = clamp(Number.isFinite(props.start) ? props.start : 0, 0, duration);
  const end = clamp(Number.isFinite(props.end) ? props.end : duration, start, duration);
  const currentTime = clamp(Number.isFinite(props.currentTime) ? props.currentTime : 0, 0, duration);
  const disabled = props.disabled || duration < MINIMUM;
  const percent = (seconds: number) => duration ? seconds / duration * 100 : 0;

  const finish = (pointerId: number | undefined, cancel: boolean) => {
    const active = gesture.current;
    if (!active || (pointerId !== undefined && active.pointerId !== pointerId)) return;
    // Clear before releasing capture: lostpointercapture must not finish the gesture twice.
    gesture.current = null;
    if (active.owner.hasPointerCapture(active.pointerId)) active.owner.releasePointerCapture(active.pointerId);
    if (active.kind === "trim") latest.current.onGestureEnd(cancel);
  };
  useEffect(() => {
    if (disabled) finish(undefined, true);
  }, [disabled]);
  useEffect(() => () => finish(undefined, true), []);

  const bounds = (edge: Edge) => {
    const value = latest.current;
    const limit = Math.max(0, value.duration);
    return edge === "start"
      ? { min: 0, max: Math.max(0, Math.min(limit, value.end) - MINIMUM) }
      : { min: Math.min(limit, Math.max(0, value.start) + MINIMUM), max: limit };
  };
  const beginTrim = (event: PointerEvent<HTMLButtonElement>, edge: Edge) => {
    if (disabled || gesture.current || event.button !== 0 || !track.current) return;
    const width = track.current.getBoundingClientRect().width;
    if (width <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    gesture.current = { kind: "trim", edge, pointerId: event.pointerId, owner: event.currentTarget,
      x: event.clientX, value: edge === "start" ? start : end, width, duration };
    event.currentTarget.setPointerCapture(event.pointerId);
    props.onGestureStart();
  };
  const moveTrim = (event: PointerEvent<HTMLButtonElement>) => {
    const active = gesture.current;
    if (!active || active.kind !== "trim" || active.pointerId !== event.pointerId || latest.current.disabled) return;
    event.preventDefault();
    event.stopPropagation();
    const { min, max } = bounds(active.edge);
    const value = active.value + (event.clientX - active.x) / active.width * active.duration;
    // Clamp without rounding: fractional source durations must still retain at least 0.05 seconds.
    latest.current.onChange(active.edge, clamp(value, min, max));
  };
  const seekAt = (clientX: number) => {
    const value = latest.current;
    const rect = track.current?.getBoundingClientRect();
    if (value.disabled || !rect || rect.width <= 0 || !(value.duration >= MINIMUM)) return;
    value.onSeek(clamp((clientX - rect.left) / rect.width * value.duration, 0, value.duration));
  };
  const handleKey = (event: KeyboardEvent<HTMLButtonElement>, edge: Edge) => {
    if (disabled || gesture.current) return;
    const { min, max } = bounds(edge);
    const value = edge === "start" ? start : end;
    const step = event.shiftKey ? 0.1 : 0.01;
    let next: number;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") next = value + step;
    else if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = value - step;
    else if (event.key === "Home") next = min;
    else if (event.key === "End") next = max;
    else return;
    event.preventDefault(); event.stopPropagation();
    next = clamp(next, min, max);
    if (next === value) return;
    props.onGestureStart();
    try { props.onChange(edge, next); }
    finally { props.onGestureEnd(); }
  };

  const roughStep = duration / 8 || 1;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const step = ([1, 2, 5, 10].find(value => value * magnitude >= roughStep) || 10) * magnitude;
  const ticks = duration ? Array.from({ length: Math.floor(duration / step) + 1 }, (_, index) => index * step) : [0];
  if (duration && duration - ticks[ticks.length - 1] >= step * 0.5) ticks.push(duration);

  return <div className={`video-trim-timeline${disabled ? " is-disabled" : ""}`} aria-disabled={disabled}>
    <div className="video-trim-ruler ruler" aria-hidden="true">
      {ticks.map((value, index) => <span key={index} style={{ position: "absolute", left: `${percent(value)}%` }}>{labelTime(value, step < 1)}</span>)}
    </div>
    <div ref={track} className="video-trim-track" role="group" aria-label="视频裁剪时间轴" tabIndex={disabled ? -1 : 0}
      onPointerDown={event => {
        if (disabled || gesture.current || event.button !== 0) return;
        event.preventDefault();
        gesture.current = { kind: "seek", pointerId: event.pointerId, owner: event.currentTarget };
        event.currentTarget.setPointerCapture(event.pointerId);
        seekAt(event.clientX);
      }} onPointerMove={event => {
        if (gesture.current?.kind === "seek" && gesture.current.pointerId === event.pointerId) seekAt(event.clientX);
      }} onPointerUp={event => finish(event.pointerId, false)} onPointerCancel={event => finish(event.pointerId, true)}
      onLostPointerCapture={event => finish(event.pointerId, true)} onKeyDown={event => {
        if (disabled || event.target !== event.currentTarget) return;
        const step = event.shiftKey ? 0.1 : 0.01;
        let next: number;
        if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = currentTime - step;
        else if (event.key === "ArrowRight" || event.key === "ArrowUp") next = currentTime + step;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = duration;
        else return;
        event.preventDefault(); event.stopPropagation(); props.onSeek(clamp(next, 0, duration));
      }}>
      {!!props.frames?.length && <div className="video-trim-frames" aria-hidden="true">{props.frames.map((src, index) => <img key={`${index}:${src}`} src={src} alt="" draggable={false} />)}</div>}
      <div className="video-trim-discard is-before" style={{ position: "absolute", left: 0, width: `${percent(start)}%`, pointerEvents: "none" }} />
      <div className="video-trim-discard is-after" style={{ position: "absolute", left: `${percent(end)}%`, right: 0, pointerEvents: "none" }} />
      <div className="video-trim-selection" style={{ position: "absolute", left: `${percent(start)}%`, width: `${percent(end - start)}%`, pointerEvents: "none" }} />
      {(["start", "end"] as const).map(edge => <button key={edge} type="button" role="slider"
        className={`video-trim-handle is-${edge}`} disabled={disabled} aria-label={edge === "start" ? "拖动裁剪起点" : "拖动裁剪终点"}
        aria-valuemin={edge === "start" ? 0 : Math.min(duration, start + MINIMUM)} aria-valuemax={edge === "start" ? Math.max(0, end - MINIMUM) : duration}
        aria-valuenow={edge === "start" ? start : end} aria-valuetext={`${labelTime(edge === "start" ? start : end, true)}，${edge === "start" ? "起点" : "终点"}`}
        aria-orientation="horizontal" style={{ position: "absolute", left: `${percent(edge === "start" ? start : end)}%` }}
        onPointerDown={event => beginTrim(event, edge)} onPointerMove={moveTrim}
        onPointerUp={event => { event.stopPropagation(); finish(event.pointerId, false); }}
        onPointerCancel={event => { event.stopPropagation(); finish(event.pointerId, true); }}
        onLostPointerCapture={event => { event.stopPropagation(); finish(event.pointerId, true); }}
        onKeyDown={event => handleKey(event, edge)}><span aria-hidden="true" /></button>)}
      <div className="video-trim-playhead" aria-hidden="true" style={{ position: "absolute", left: `${percent(currentTime)}%`, pointerEvents: "none" }} />
    </div>
  </div>;
}
