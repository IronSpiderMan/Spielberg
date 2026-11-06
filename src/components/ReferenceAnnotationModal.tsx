import { Button, Message, Modal, Spin } from "@arco-design/web-react";
import { Check, Circle, ImageOff, Info, Paintbrush, PaintBucket, Pencil, Redo2, Square, Trash2, Type, Undo2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { fileUrl, type Media } from "../core";
import { ANNOTATION_FONT, TEXT_LINE_HEIGHT, drawAnnotations, shapeEnd, type Annotation, type AnnotationTool, type PenAnnotation, type Point, type ShapeAnnotation, type TextAnnotation } from "./reference-annotation";
import "./reference-annotation.css";

type History = { past: Annotation[][]; present: Annotation[]; future: Annotation[][] };
type Drawing = { pointerId: number; annotation: PenAnnotation | ShapeAnnotation };
const emptyHistory = (): History => ({ past: [], present: [], future: [] });
const palette = [
  { color: "#ff3b30", name: "红色" }, { color: "#ffcc00", name: "黄色" },
  { color: "#34c759", name: "绿色" }, { color: "#007aff", name: "蓝色" },
  { color: "#ffffff", name: "白色" }, { color: "#202124", name: "黑色" },
];
const toolOptions = [
  { type: "pen", name: "画笔", key: "B", icon: Pencil },
  { type: "rectangle", name: "矩形", key: "R", icon: Square },
  { type: "ellipse", name: "圆形", key: "O", icon: Circle },
  { type: "text", name: "文字", key: "T", icon: Type },
] as const;
const toolHints: Record<AnnotationTool, string> = {
  pen: "拖动绘制 · Esc 取消当前笔画",
  rectangle: "拖动绘制矩形 · 按住 Shift 绘制正方形",
  ellipse: "拖动绘制圆形 / 椭圆 · 按住 Shift 绘制正圆",
  text: "点击图片添加文字 · Enter 完成 · Shift + Enter 换行 · Esc 取消",
};

export function ReferenceAnnotationModal({ media, onClose, onApply }: {
  media: Media;
  onClose: () => void;
  onApply: (file: File) => Promise<boolean>;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const image = useRef<HTMLImageElement | null>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const saving = useRef(false);
  const historyRef = useRef<History>(emptyHistory());
  const drawingRef = useRef<Drawing | null>(null);
  const textRef = useRef<TextAnnotation | null>(null);
  const [history, setHistory] = useState(historyRef.current);
  const [drawing, setDrawingState] = useState<Drawing | null>(null);
  const [textDraft, setTextState] = useState<TextAnnotation | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [tool, setTool] = useState<AnnotationTool>("pen");
  const [color, setColor] = useState("#ff3b30");
  const [lineWidth, setLineWidth] = useState(4);
  const [fontSize, setFontSize] = useState(24);
  const [filled, setFilled] = useState(false);
  const [opacity, setOpacity] = useState(100);
  const [displayScale, setDisplayScale] = useState(1);

  function setDrawing(value: Drawing | null) { drawingRef.current = value; setDrawingState(value); }
  function setText(value: TextAnnotation | null) { textRef.current = value; setTextState(value); }
  function updateHistory(value: History) { historyRef.current = value; setHistory(value); }
  function commit(annotations: Annotation[]) {
    const current = historyRef.current;
    updateHistory({ past: [...current.past, current.present], present: annotations, future: [] });
  }
  function commitText() {
    const draft = textRef.current;
    if (!draft) return;
    setText(null);
    if (draft.text.trim()) commit([...historyRef.current.present, { ...draft, text: draft.text.trimEnd() }]);
  }
  function undo() {
    if (saving.current || drawingRef.current) return;
    commitText();
    const current = historyRef.current;
    if (!current.past.length) return;
    updateHistory({ past: current.past.slice(0, -1), present: current.past[current.past.length - 1], future: [current.present, ...current.future] });
  }
  function redo() {
    if (saving.current || drawingRef.current) return;
    commitText();
    const current = historyRef.current;
    if (!current.future.length) return;
    updateHistory({ past: [...current.past, current.present], present: current.future[0], future: current.future.slice(1) });
  }
  function cancelDrawing() {
    const pointerId = drawingRef.current?.pointerId;
    setDrawing(null);
    if (pointerId !== undefined && canvas.current?.hasPointerCapture(pointerId)) canvas.current.releasePointerCapture(pointerId);
  }
  function chooseTool(value: AnnotationTool) {
    if (saving.current || drawingRef.current) return;
    commitText();
    setTool(value);
  }

  useEffect(() => {
    const controller = new AbortController();
    let url: string | undefined;
    image.current = null;
    setStatus("loading");
    updateHistory(emptyHistory());
    setDrawing(null);
    setText(null);
    async function load() {
      try {
        const response = await fetch(fileUrl(media.path), { signal: controller.signal });
        if (!response.ok) throw new Error("图片读取失败");
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        const source = new Image();
        source.src = url;
        await source.decode();
        if (controller.signal.aborted) return;
        if (!source.naturalWidth || !source.naturalHeight) throw new Error("图片尺寸无效");
        image.current = source;
        setStatus("ready");
      } catch {
        if (!controller.signal.aborted) setStatus("error");
      }
    }
    void load();
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [media.path, retry]);

  useLayoutEffect(() => {
    if (!canvas.current || !image.current) return;
    drawAnnotations(canvas.current, image.current, drawing ? [...history.present, drawing.annotation] : history.present);
  }, [status, history.present, drawing]);

  useEffect(() => {
    const target = canvas.current;
    if (!target) return;
    const measure = () => setDisplayScale(target.getBoundingClientRect().width / target.width || 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    return () => observer.disconnect();
  }, [status]);

  useLayoutEffect(() => {
    // Consecutive canvas clicks may reuse the textarea DOM node after committing a label.
    textarea.current?.focus({ preventScroll: true });
  }, [textDraft?.position]);

  useLayoutEffect(() => {
    const input = textarea.current;
    if (!input || !textDraft || !image.current) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, (image.current.naturalHeight - textDraft.position.y) * displayScale)}px`;
  }, [textDraft, displayScale]);

  useEffect(() => {
    // Scope shortcuts to this dialog so the scene editor never handles drawing keystrokes.
    const handleKey = (event: KeyboardEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".reference-annotation-wrapper")) return;
      if (event.isComposing || event.target.closest("input, textarea, select, [contenteditable=true]")) return;
      if (saving.current) return;
      const key = event.key.toLowerCase();
      if (event.key === "Escape" && drawingRef.current) {
        event.preventDefault(); event.stopImmediatePropagation(); cancelDrawing(); return;
      }
      if (event.ctrlKey || event.metaKey) {
        if (key === "z" || key === "y") {
          event.preventDefault(); event.stopImmediatePropagation();
          if (key === "y" || event.shiftKey) redo(); else undo();
        }
        return;
      }
      if (event.altKey) return;
      const option = toolOptions.find(item => item.key.toLowerCase() === key);
      if (option) { event.preventDefault(); event.stopImmediatePropagation(); chooseTool(option.type); }
    };
    document.addEventListener("keydown", handleKey, true);
    return () => document.removeEventListener("keydown", handleKey, true);
  }, []);

  function position(event: PointerEvent<HTMLCanvasElement>): Point {
    const target = event.currentTarget;
    const bounds = target.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(target.width, (event.clientX - bounds.left) * target.width / bounds.width)),
      y: Math.max(0, Math.min(target.height, (event.clientY - bounds.top) * target.height / bounds.height)),
    };
  }
  function startDrawing(event: PointerEvent<HTMLCanvasElement>) {
    if (saving.current || drawingRef.current || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    commitText();
    event.currentTarget.focus({ preventScroll: true });
    const point = position(event);
    const scale = event.currentTarget.getBoundingClientRect().width / event.currentTarget.width;
    if (tool === "text") {
      const size = fontSize / scale;
      const x = Math.max(0, Math.min(point.x, event.currentTarget.width - Math.min(160 / scale, event.currentTarget.width)));
      const y = Math.max(0, Math.min(point.y, event.currentTarget.height - size * TEXT_LINE_HEIGHT));
      setText({ type: "text", color, opacity: opacity / 100, fontSize: size, position: { x, y }, width: Math.min(360 / scale, event.currentTarget.width - x), text: "" });
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const style = { color, lineWidth: lineWidth / scale, opacity: opacity / 100 };
    setDrawing({ pointerId: event.pointerId, annotation: tool === "pen"
      ? { ...style, type: "pen", points: [point] }
      : { ...style, type: tool, filled, start: point, end: point } });
  }
  function extendDrawing(event: PointerEvent<HTMLCanvasElement>): Drawing | null {
    const current = drawingRef.current;
    if (!current || current.pointerId !== event.pointerId) return null;
    const point = position(event);
    const annotation = current.annotation;
    if (annotation.type === "pen") {
      const last = annotation.points[annotation.points.length - 1];
      return { ...current, annotation: { ...annotation, points: last.x === point.x && last.y === point.y ? annotation.points : [...annotation.points, point] } };
    }
    return { ...current, annotation: { ...annotation, end: shapeEnd(annotation.start, point, event.shiftKey, event.currentTarget.width, event.currentTarget.height) } };
  }
  function finishDrawing(event: PointerEvent<HTMLCanvasElement>) {
    const result = extendDrawing(event);
    if (!result) return;
    const annotation = result.annotation;
    setDrawing(null);
    // Ignore accidental clicks with a shape tool; a single pen click is a dot.
    if (annotation.type === "pen" || (Math.abs(annotation.end.x - annotation.start.x) * displayScale >= 1 && Math.abs(annotation.end.y - annotation.start.y) * displayScale >= 1)) {
      commit([...historyRef.current.present, annotation]);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  async function apply() {
    const target = canvas.current;
    const source = image.current;
    if (!target || !source || saving.current || drawingRef.current) return;
    commitText();
    const annotations = historyRef.current.present;
    if (!annotations.length) return;
    saving.current = true;
    setBusy(true);
    try {
      drawAnnotations(target, source, annotations);
      const blob = await new Promise<Blob>((resolve, reject) => {
        target.toBlob(value => value ? resolve(value) : reject(new Error("无法导出标注图片")), "image/png");
      });
      const name = media.name.replace(/\.[^.]+$/, "");
      if (await onApply(new File([blob], `${name}-标注.png`, { type: "image/png" }))) onClose();
    } catch (error) {
      Message.error(String(error));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  const source = image.current;
  const disabled = busy || status !== "ready" || !!drawing;
  const isShape = tool === "rectangle" || tool === "ellipse";
  const hasText = !!textDraft?.text.trim();
  const displayWidth = source ? `min(100%, ${source.naturalWidth}px, ${50 * source.naturalWidth / source.naturalHeight}vh)` : undefined;

  // Keep escToExit stable: Arco otherwise refocuses its wrapper after every completed mark.
  // Drawing/text handlers consume Escape, and onCancel guards an in-flight export.
  return <Modal className="reference-annotation-modal" wrapClassName="reference-annotation-wrapper" title={<div className="annotation-title">
    <span className="annotation-title-icon"><Paintbrush size={20} /></span>
    <div><strong>标注参考图</strong><span title={media.name}>{media.name}</span></div>
  </div>} visible style={{ width: "min(1120px, 96vw)" }}
    maskClosable={false} closable={!busy} escToExit
    onCancel={() => { if (!saving.current) onClose(); }}
    footer={<div className="annotation-footer">
      <span className="annotation-footer-note"><Info />应用后替换当前参考图，原图保留在素材库</span>
      <div className="annotation-footer-actions">
        <Button disabled={busy} onClick={onClose}>取消</Button>
        <Button type="primary" loading={busy} disabled={disabled || (!history.present.length && !hasText)} onClick={() => void apply()}><Check size={16} />用作参考图</Button>
      </div>
    </div>}>
    <div className="annotation-editor">
      <div className="annotation-toolbar">
        <div className="annotation-tool-group" role="group" aria-label="标注工具">
          {toolOptions.map(({ type, name, key, icon: Icon }) => <button key={type} type="button" aria-label={name} aria-pressed={tool === type}
            className={`annotation-tool${tool === type ? " is-active" : ""}`} title={`${name} (${key})`} disabled={disabled} onClick={() => chooseTool(type)}>
            <Icon /><span>{name}</span>
          </button>)}
        </div>
        <div className="annotation-history" role="group" aria-label="标注历史">
          <button type="button" aria-label="撤销" title="撤销 (Ctrl / ⌘ Z)" disabled={disabled || (!history.past.length && !hasText)} onClick={undo}><Undo2 /></button>
          <button type="button" aria-label="重做" title="重做 (Ctrl / ⌘ Shift Z)" disabled={disabled || !history.future.length || hasText} onClick={redo}><Redo2 /></button>
          <button type="button" aria-label="清空标注" title="清空标注（可撤销）" disabled={disabled || (!history.present.length && !hasText)} onClick={() => { commitText(); if (historyRef.current.present.length) commit([]); }}><Trash2 /></button>
        </div>
        <div className="annotation-style-controls">
          <div className="annotation-control annotation-color-control"><span>颜色</span>
            <input className="annotation-color-swatch" type="color" aria-label="标注颜色" value={color} disabled={disabled} onChange={event => setColor(event.target.value)} />
            <div className="annotation-palette" role="group" aria-label="常用颜色">{palette.map(item => <button key={item.color} type="button" aria-label={item.name} title={item.name} aria-pressed={color.toLowerCase() === item.color}
              className={color.toLowerCase() === item.color ? "is-active" : ""} style={{ "--swatch": item.color } as CSSProperties} disabled={disabled} onClick={() => setColor(item.color)} />)}</div>
          </div>
          <span className="annotation-toolbar-divider" />
          {isShape && <div className="annotation-fill-toggle" role="group" aria-label="形状样式">
            <button type="button" className={!filled ? "is-active" : ""} aria-pressed={!filled} disabled={disabled} onClick={() => setFilled(false)}><Square size={14} />空心</button>
            <button type="button" className={filled ? "is-active" : ""} aria-pressed={filled} disabled={disabled} onClick={() => setFilled(true)}><PaintBucket size={14} />填充</button>
          </div>}
          <label className="annotation-control"><span>{tool === "text" ? "字号" : "线宽"}</span>
            {tool === "text" ? <select aria-label="字号" value={fontSize} disabled={disabled} onChange={event => setFontSize(Number(event.target.value))}>
              {[16, 24, 32, 48, 64].map(size => <option key={size} value={size}>{size} px</option>)}
            </select> : <select aria-label="线宽" value={lineWidth} disabled={disabled} onChange={event => setLineWidth(Number(event.target.value))}>
              {[2, 4, 8, 12].map(size => <option key={size} value={size}>{size} px</option>)}
            </select>}
          </label>
          <label className="annotation-control"><span>不透明度</span><input type="range" aria-label="不透明度" min={20} max={100} step={10} value={opacity} disabled={disabled} onChange={event => setOpacity(Number(event.target.value))} /><span>{opacity}%</span></label>
        </div>
      </div>
      <div className="annotation-canvas-area">
        {status !== "ready" ? <div className="annotation-empty-state" role="status">
          {status === "loading" ? <><Spin /><p>正在读取原图…</p></> : <><ImageOff size={32} /><p>无法读取原图，请重试</p><Button onClick={() => setRetry(value => value + 1)}>重新加载</Button></>}
        </div> : <div className="annotation-canvas-stage" style={{ width: displayWidth }}>
          <canvas className="annotation-canvas" ref={canvas} width={source?.naturalWidth} height={source?.naturalHeight} tabIndex={0}
            aria-label={`标注画布：${media.name}`} aria-describedby="annotation-tool-hint"
            style={{ cursor: busy ? "wait" : tool === "text" ? "text" : "crosshair" }}
            onPointerDown={startDrawing} onPointerMove={event => { const next = extendDrawing(event); if (next) setDrawing(next); }}
            onPointerUp={finishDrawing} onPointerCancel={event => { if (drawingRef.current?.pointerId === event.pointerId) cancelDrawing(); }}
            onLostPointerCapture={event => { if (drawingRef.current?.pointerId === event.pointerId) setDrawing(null); }} />
          {textDraft && source && <textarea ref={textarea} className="annotation-text-editor" aria-label="标注文字" placeholder="输入文字" rows={1} spellCheck={false} value={textDraft.text}
            style={{ left: `${textDraft.position.x / source.naturalWidth * 100}%`, top: `${textDraft.position.y / source.naturalHeight * 100}%`, width: `${textDraft.width / source.naturalWidth * 100}%`,
              color: textDraft.color, opacity: textDraft.opacity, fontFamily: ANNOTATION_FONT, fontWeight: 600, fontSize: textDraft.fontSize * displayScale, lineHeight: TEXT_LINE_HEIGHT }}
            onChange={event => setText({ ...textDraft, text: event.target.value })} onBlur={commitText}
            onKeyDown={event => {
              event.stopPropagation();
              if (event.nativeEvent.isComposing || event.keyCode === 229) return;
              if (event.key === "Escape") { event.preventDefault(); setText(null); canvas.current?.focus({ preventScroll: true }); }
              else if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); commitText(); canvas.current?.focus({ preventScroll: true }); }
            }} />}
        </div>}
      </div>
      <div className="annotation-canvas-status">
        <span className="annotation-tool-hint" id="annotation-tool-hint"><Info /><span>{toolHints[tool]}</span></span>
        <span className="annotation-image-meta"><span>{history.present.length} 处标注</span>{source && <span>{source.naturalWidth} × {source.naturalHeight} · 原图导出</span>}</span>
      </div>
    </div>
  </Modal>;
}
