import { Button, Message, Modal, Space } from "@arco-design/web-react";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { fileUrl, type Media } from "../core";

type Point = { x: number; y: number };
type Stroke = { color: string; points: Point[] };

export function ReferenceAnnotationModal({ media, onClose, onApply }: {
  media: Media;
  onClose: () => void;
  onApply: (file: File) => Promise<boolean>;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const image = useRef<HTMLImageElement | null>(null);
  const pointer = useRef<number | null>(null);
  const saving = useRef(false);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [color, setColor] = useState("#ff3b30");
  const [strokes, setStrokes] = useState<Stroke[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    let url: string | undefined;
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
  }, [media.path]);

  function draw() {
    const target = canvas.current;
    const source = image.current;
    const context = target?.getContext("2d");
    if (!target || !source || !context) return;
    context.clearRect(0, 0, target.width, target.height);
    context.drawImage(source, 0, 0);
    context.lineWidth = Math.max(2, Math.min(target.width, target.height) * 0.008);
    context.lineCap = context.lineJoin = "round";
    for (const { color, points } of strokes) {
      context.strokeStyle = context.fillStyle = color;
      context.beginPath();
      context.arc(points[0].x, points[0].y, context.lineWidth / 2, 0, 2 * Math.PI);
      context.fill();
      context.beginPath();
      context.moveTo(points[0].x, points[0].y);
      for (const point of points.slice(1)) context.lineTo(point.x, point.y);
      context.stroke();
    }
  }

  useEffect(draw, [status, strokes]);

  function position(event: PointerEvent<HTMLCanvasElement>): Point {
    const target = event.currentTarget;
    const bounds = target.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) * target.width / bounds.width,
      y: (event.clientY - bounds.top) * target.height / bounds.height,
    };
  }

  async function apply() {
    const target = canvas.current;
    if (!target || saving.current || pointer.current !== null || !strokes.length) return;
    saving.current = true;
    setBusy(true);
    try {
      draw();
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
  const displayWidth = source && `min(100%, ${source.naturalWidth}px, ${60 * source.naturalWidth / source.naturalHeight}vh)`;

  return <Modal title="标注参考图" visible style={{ width: "min(960px, 94vw)" }}
    maskClosable={false} closable={!busy} escToExit={!busy}
    onCancel={() => { if (!saving.current) onClose(); }}
    footer={<Space>
      <Button disabled={busy} onClick={onClose}>取消</Button>
      <Button type="primary" loading={busy} disabled={!strokes.length} onClick={() => void apply()}>用作参考图</Button>
    </Space>}>
    <Space wrap>
      <label>画笔颜色 <input type="color" value={color} disabled={busy} onChange={event => setColor(event.target.value)} /></label>
      <Button disabled={busy || !strokes.length} onClick={() => setStrokes(items => items.slice(0, -1))}>撤销一笔</Button>
      <Button disabled={busy || !strokes.length} onClick={() => setStrokes([])}>清空标注</Button>
    </Space>
    <p className="helper">在图上拖动画笔。应用后将替换当前参考图，原图保留在素材库。</p>
    {status !== "ready" ? <p role="status">{status === "loading" ? "正在读取原图…" : "无法读取原图"}</p> :
      <canvas ref={canvas} width={source?.naturalWidth} height={source?.naturalHeight}
        aria-label={`标注画布：${media.name}`}
        style={{ display: "block", margin: "0 auto", width: displayWidth ?? undefined, height: "auto", touchAction: "none", cursor: "crosshair" }}
        onPointerDown={event => {
          if (saving.current || pointer.current !== null || event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          pointer.current = event.pointerId;
          const point = position(event);
          setStrokes(items => [...items, { color, points: [point] }]);
        }}
        onPointerMove={event => {
          if (pointer.current !== event.pointerId) return;
          const point = position(event);
          setStrokes(items => {
            const stroke = items[items.length - 1];
            return stroke ? [...items.slice(0, -1), { ...stroke, points: [...stroke.points, point] }] : items;
          });
        }}
        onLostPointerCapture={() => { pointer.current = null; }} />}
  </Modal>;
}
