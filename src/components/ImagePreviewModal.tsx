import { Button, Message, Modal } from "@arco-design/web-react";
import { Download, Minus, Plus, RotateCcw, RotateCw, WandSparkles } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { imageUrl, type Media } from "../core";
import "./image-preview.css";

export function ImagePreviewModal({ media, onClose, title = "参考图片预览", visible = !!media, footer = null, className = "" }: {
  media: Media | null;
  onClose: () => void;
  title?: string;
  visible?: boolean;
  footer?: ReactNode;
  className?: string;
}) {
  const [rotation, setRotation] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const reset = () => setView({ scale: 1, x: 0, y: 0 });
  useEffect(() => {
    reset();
    setRotation(0);
    drag.current = null;
  }, [media?.id, visible]);
  const zoom = (factor: number, x = 0, y = 0) => setView(previous => {
    const scale = Math.min(8, Math.max(1, previous.scale * factor));
    const ratio = scale / previous.scale;
    return scale === 1 ? { scale, x: 0, y: 0 } : {
      scale, x: x - (x - previous.x) * ratio, y: y - (y - previous.y) * ratio,
    };
  });
  // A non-passive listener keeps wheel zoom from scrolling the page behind the dialog.
  useEffect(() => {
    if (!visible) return;
    const element = viewport.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const bounds = element.getBoundingClientRect();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? bounds.height : 1);
      zoom(Math.exp(-Math.max(-100, Math.min(100, delta)) * 0.002),
        event.clientX - bounds.left - bounds.width / 2, event.clientY - bounds.top - bounds.height / 2);
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [visible, media?.id]);
  return <Modal className={`image-preview-modal is-fullscreen ${className}`} wrapClassName="image-preview-wrapper" alignCenter={false} title={media?.name || title} visible={visible} footer={footer} onCancel={onClose}>
    <div className="image-preview-toolbar" role="toolbar" aria-label="图片预览工具">
      <Button aria-label="缩小" title="缩小" disabled={view.scale <= 1} onClick={() => zoom(1 / 1.25)} icon={<Minus size={16} />} />
      <span className="image-preview-scale" aria-live="polite">{Math.round(view.scale * 100)}%</span>
      <Button aria-label="放大" title="放大" disabled={view.scale >= 8} onClick={() => zoom(1.25)} icon={<Plus size={16} />} />
      <Button aria-label="旋转图片" onClick={() => setRotation(value => (value + 90) % 360)} icon={<RotateCw size={16} />}>旋转</Button>
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
      <Button disabled={!media} icon={<WandSparkles size={16} />} onClick={() => {
        if (!media) return;
        window.dispatchEvent(new CustomEvent("spielberg:image-to-image", { detail: media }));
        onClose();
      }}>图生图</Button>
      <Button onClick={reset} icon={<RotateCcw size={16} />}>适应窗口</Button>
    </div>
    <div ref={viewport} className={`image-preview-full${view.scale > 1 ? " is-zoomed" : ""}`} title="滚轮缩放，放大后可拖动；双击复位"
      onDoubleClick={reset}
      onPointerDown={event => {
        if (view.scale <= 1 || event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
      }}
      onPointerMove={event => {
        const start = drag.current;
        if (!start || start.id !== event.pointerId) return;
        const dx = event.clientX - start.x, dy = event.clientY - start.y;
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
        setView(previous => ({ ...previous, x: previous.x + dx, y: previous.y + dy }));
      }}
      onPointerUp={() => { drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}
      onLostPointerCapture={() => { drag.current = null; }}>
      {media && <img src={imageUrl(media)} alt={media.name} draggable={false}
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale}) rotate(${rotation}deg)` }} />}
    </div>
  </Modal>;
}

export function PreviewImage({ media, ...props }: Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> & { media: Media }) {
  const [open, setOpen] = useState(false);
  return <><button type="button" className="image-result-preview" aria-label={`预览 ${media.name}`} onClick={event => { event.stopPropagation(); setOpen(true); }}><img {...props} src={imageUrl(media)} alt={props.alt || media.name} /></button><ImagePreviewModal media={open ? media : null} onClose={() => setOpen(false)} /></>;
}
