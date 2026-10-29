import { Button, Message, Modal } from "@arco-design/web-react";
import { ChevronLeft, ChevronRight, Download, Image as ImageIcon, Maximize, Minus, Mouse, Plus, RotateCw, WandSparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { imageUrl, type Media } from "../core";
import "./image-preview.css";

export function ImagePreviewModal({ media, onClose, title = "参考图片预览", visible = !!media, footer = null, className = "", images = [], onMediaChange }: {
  media: Media | null;
  images?: Media[];
  onMediaChange?: (media: Media) => void;
  onClose: () => void;
  title?: string;
  visible?: boolean;
  footer?: ReactNode;
  className?: string;
}) {
  const currentIndex = images.findIndex(item => item.id === media?.id);
  const canNavigate = images.length > 1 && currentIndex >= 0 && !!onMediaChange;
  const move = (offset: number) => {
    if (canNavigate) onMediaChange?.(images[(currentIndex + offset + images.length) % images.length]);
  };
  useEffect(() => {
    if (!visible || !canNavigate) return;
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable="true"]') || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        onMediaChange?.(images[(currentIndex + (event.key === "ArrowLeft" ? -1 : 1) + images.length) % images.length]);
      }
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [visible, canNavigate, currentIndex, images, onMediaChange]);
  const [rotation, setRotation] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [fit, setFit] = useState(true);
  const [failed, setFailed] = useState(false);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const rotatedSize = rotation % 180 === 0 ? imageSize : { width: imageSize.height, height: imageSize.width };
  const ready = imageSize.width > 0 && viewportSize.width > 0 && viewportSize.height > 0;
  const fitScale = ready ? Math.min(1, viewportSize.width / rotatedSize.width, viewportSize.height / rotatedSize.height) : 1;
  const minScale = Math.min(0.05, fitScale);
  const canDrag = ready && (rotatedSize.width * view.scale > viewportSize.width || rotatedSize.height * view.scale > viewportSize.height);
  const constrain = useCallback((next: typeof view) => {
    const maxX = Math.max(0, (rotatedSize.width * next.scale - viewportSize.width) / 2);
    const maxY = Math.max(0, (rotatedSize.height * next.scale - viewportSize.height) / 2);
    return { scale: next.scale, x: Math.max(-maxX, Math.min(maxX, next.x)), y: Math.max(-maxY, Math.min(maxY, next.y)) };
  }, [rotatedSize.width, rotatedSize.height, viewportSize.width, viewportSize.height]);
  const reset = useCallback(() => {
    setFit(true);
    setView({ scale: fitScale, x: 0, y: 0 });
  }, [fitScale]);
  useEffect(() => {
    setFit(true);
    setView({ scale: 1, x: 0, y: 0 });
    setImageSize({ width: 0, height: 0 });
    setFailed(false);
    setRotation(0);
    drag.current = null;
  }, [media?.id, media?.path, visible]);
  useEffect(() => {
    if (!viewport) return;
    const observer = new ResizeObserver(([entry]) => {
      setViewportSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [viewport]);
  useEffect(() => {
    if (!ready) return;
    setView(previous => fit ? { scale: fitScale, x: 0, y: 0 } : constrain(previous));
  }, [fit, fitScale, ready, constrain]);
  const zoom = useCallback((factor: number, x = 0, y = 0) => {
    if (!ready) return;
    setFit(false);
    setView(previous => {
      const scale = Math.min(16, Math.max(minScale, previous.scale * factor));
      const ratio = scale / previous.scale;
      return constrain({ scale, x: x - (x - previous.x) * ratio, y: y - (y - previous.y) * ratio });
    });
  }, [ready, minScale, constrain]);
  const actualSize = useCallback(() => {
    setFit(false);
    setView({ scale: 1, x: 0, y: 0 });
  }, []);
  // Portal content mounts after the parent's effect on first open. Track the actual
  // node so the non-passive listener is attached whenever that content becomes ready.
  useEffect(() => {
    if (!visible || !viewport) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const bounds = viewport.getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1);
      zoom(Math.exp(-Math.max(-100, Math.min(100, delta)) * 0.002),
        event.clientX - bounds.left - bounds.width / 2, event.clientY - bounds.top - bounds.height / 2);
    };
    viewport.addEventListener("wheel", wheel, { passive: false });
    return () => viewport.removeEventListener("wheel", wheel);
  }, [visible, viewport, zoom]);
  useEffect(() => {
    if (!visible) return;
    const keydown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]') || event.altKey || event.ctrlKey || event.metaKey) return;
      if (["+", "=", "-", "0", "1"].includes(event.key)) {
        event.preventDefault();
        if (event.key === "0") reset();
        else if (event.key === "1") actualSize();
        else zoom(event.key === "-" ? 1 / 1.25 : 1.25);
      }
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [visible, zoom, reset, actualSize]);
  return <Modal className={`image-preview-modal is-fullscreen ${className}`} wrapClassName="image-preview-wrapper" alignCenter={false} title={<div className="image-preview-heading"><span className="image-preview-file-icon"><ImageIcon size={20} /></span><div><strong title={media?.name || title}>{media?.name || title}</strong><span>{ready ? `${imageSize.width} × ${imageSize.height} px` : "图片预览"}</span></div></div>} visible={visible} footer={footer} onCancel={onClose}>
    <div className="image-preview-toolbar" role="toolbar" aria-label="图片预览工具">
      <div className="image-preview-tools">
      <div className="image-preview-zoom-controls">
      <Button aria-label="缩小" title="缩小 (-)" disabled={!ready || view.scale <= minScale} onClick={() => zoom(1 / 1.25)} icon={<Minus size={16} />} />
      <span className="image-preview-scale" aria-live="polite">{ready ? `${Math.round(view.scale * 100)}%` : "—"}</span>
      <Button aria-label="放大" title="放大 (+)" disabled={!ready || view.scale >= 16} onClick={() => zoom(1.25)} icon={<Plus size={16} />} />
      </div>
      <Button disabled={!ready} className={fit ? "is-active" : ""} onClick={reset} title="适应窗口 (0)" icon={<Maximize size={16} />}>适应窗口</Button>
      <Button disabled={!ready} onClick={actualSize} title="原始尺寸 (1)">1:1</Button>
      <span className="image-preview-divider" />
      <Button aria-label="旋转图片" disabled={!ready} onClick={() => { setFit(true); setRotation(value => (value + 90) % 360); }} icon={<RotateCw size={16} />}>旋转</Button>
      </div>
      <div className="image-preview-tools image-preview-actions">
      <Button loading={downloading} disabled={!media} icon={<Download size={16} />} onClick={async () => {
        if (!media) return;
        setDownloading(true);
        try {
          const response = await fetch(imageUrl(media));
          if (!response.ok) throw new Error(`下载失败：${response.status}`);
          const url = URL.createObjectURL(await response.blob());
          const link = document.createElement("a");
          link.href = url;
          link.download = /\.[a-z0-9]+$/i.test(media.name) ? media.name : `${media.name}.${media.path.split(".").pop() || "png"}`;
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (error) { Message.error(String(error)); }
        finally { setDownloading(false); }
      }}>下载</Button>
      <Button type="primary" disabled={!media} icon={<WandSparkles size={16} />} onClick={() => {
        if (!media) return;
        window.dispatchEvent(new CustomEvent("spielberg:image-to-image", { detail: media }));
        onClose();
      }}>图生图</Button>
      </div>
    </div>
    <div className="image-preview-stage">
    {canNavigate && <button type="button" className="image-preview-nav is-previous" aria-label="上一张图片" onClick={() => move(-1)}><ChevronLeft size={24} /></button>}
    <div ref={setViewport} className={`image-preview-full${canDrag ? " is-zoomed" : ""}`} aria-label="图片画布"
      onDoubleClick={reset}
      onPointerDown={event => {
        if (!canDrag || event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
      }}
      onPointerMove={event => {
        const start = drag.current;
        if (!start || start.id !== event.pointerId) return;
        const dx = event.clientX - start.x, dy = event.clientY - start.y;
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
        setView(previous => constrain({ ...previous, x: previous.x + dx, y: previous.y + dy }));
      }}
      onPointerUp={() => { drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}
      onLostPointerCapture={() => { drag.current = null; }}>
      {media && <img key={`${media.id}:${media.path}:${visible}`} src={imageUrl(media)} alt={media.name} draggable={false}
        onLoad={event => { setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }); setFailed(false); }}
        onError={() => setFailed(true)}
        style={{ width: imageSize.width || undefined, height: imageSize.height || undefined, visibility: ready && !failed ? "visible" : "hidden", transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.scale}) rotate(${rotation}deg)` }} />}
      {(!ready || failed) && <div className="image-preview-placeholder" role="status"><ImageIcon size={28} /><span>{failed ? "图片加载失败，请关闭后重试" : "正在加载图片…"}</span></div>}
    </div>
    {canNavigate && <button type="button" className="image-preview-nav is-next" aria-label="下一张图片" onClick={() => move(1)}><ChevronRight size={24} /></button>}
    </div>
    <div className="image-preview-status"><span><Mouse size={14} />滚轮缩放 · 放大后拖动 · 双击适应窗口</span><span>{fit ? "适应窗口" : "自由缩放"}<i />Esc 关闭</span></div>
    {canNavigate && <div className="image-preview-filmstrip" aria-label="角色图片列表">
      <span className="image-preview-position" aria-live="polite">{currentIndex + 1} / {images.length}</span>
      <div>{images.map((item, index) => <button type="button" key={item.id} aria-label={`查看第 ${index + 1} 张：${item.name}`} aria-pressed={item.id === media?.id} onClick={() => onMediaChange?.(item)} ref={element => { if (item.id === media?.id) element?.scrollIntoView({ block: "nearest", inline: "nearest" }); }}><img src={imageUrl(item)} alt={item.name} /></button>)}</div>
      <span className="image-preview-key-hint">← → 切换图片</span>
    </div>}
  </Modal>;
}

export function PreviewImage({ media, ...props }: Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> & { media: Media }) {
  const [open, setOpen] = useState(false);
  return <><button type="button" className="image-result-preview" aria-label={`预览 ${media.name}`} onClick={event => { event.stopPropagation(); setOpen(true); }}><img {...props} src={imageUrl(media)} alt={props.alt || media.name} /></button><ImagePreviewModal media={open ? media : null} onClose={() => setOpen(false)} /></>;
}
