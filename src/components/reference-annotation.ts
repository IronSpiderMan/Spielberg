export type Point = { x: number; y: number };
export type AnnotationTool = "pen" | "rectangle" | "ellipse" | "text";

type AnnotationStyle = { color: string; opacity: number };
export type PenAnnotation = AnnotationStyle & { type: "pen"; lineWidth: number; points: Point[] };
export type ShapeAnnotation = AnnotationStyle & {
  type: "rectangle" | "ellipse";
  lineWidth: number;
  filled: boolean;
  start: Point;
  end: Point;
};
export type TextAnnotation = AnnotationStyle & {
  type: "text";
  position: Point;
  text: string;
  fontSize: number;
  width: number;
};
export type Annotation = PenAnnotation | ShapeAnnotation | TextAnnotation;
export const ANNOTATION_FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
export const TEXT_LINE_HEIGHT = 1.35;

// All annotation geometry is stored in original image pixels, independent of the preview size.
export function shapeEnd(start: Point, point: Point, square: boolean, width: number, height: number): Point {
  if (!square) return point;
  const dx = point.x - start.x;
  const dy = point.y - start.y;
  const size = Math.min(Math.max(Math.abs(dx), Math.abs(dy)), dx < 0 ? start.x : width - start.x, dy < 0 ? start.y : height - start.y);
  return { x: start.x + (dx < 0 ? -size : size), y: start.y + (dy < 0 ? -size : size) };
}

function textLines(context: CanvasRenderingContext2D, text: string, width: number): string[] {
  return text.split("\n").flatMap(paragraph => {
    const lines: string[] = [];
    let line = "";
    for (const character of Array.from(paragraph)) {
      if (line && context.measureText(line + character).width > width) {
        lines.push(line);
        line = "";
      }
      line += character;
    }
    lines.push(line);
    return lines;
  });
}

export function drawAnnotations(target: HTMLCanvasElement, source: HTMLImageElement, annotations: Annotation[]) {
  const context = target.getContext("2d");
  if (!context) throw new Error("无法创建标注画布");
  context.clearRect(0, 0, target.width, target.height);
  context.drawImage(source, 0, 0);
  for (const annotation of annotations) {
    context.save();
    context.globalAlpha = annotation.opacity;
    context.strokeStyle = context.fillStyle = annotation.color;
    context.lineCap = context.lineJoin = "round";
    if (annotation.type === "text") {
      context.font = `600 ${annotation.fontSize}px ${ANNOTATION_FONT}`;
      context.textBaseline = "top";
      textLines(context, annotation.text, annotation.width).forEach((line, index) => {
        context.fillText(line, annotation.position.x, annotation.position.y + index * annotation.fontSize * TEXT_LINE_HEIGHT);
      });
    } else {
      context.lineWidth = annotation.lineWidth;
      context.beginPath();
      if (annotation.type === "pen") {
        const first = annotation.points[0];
        if (annotation.points.length === 1) {
          context.arc(first.x, first.y, annotation.lineWidth / 2, 0, Math.PI * 2);
          context.fill();
        } else {
          context.moveTo(first.x, first.y);
          for (const point of annotation.points.slice(1)) context.lineTo(point.x, point.y);
          context.stroke();
        }
      } else {
        const x = Math.min(annotation.start.x, annotation.end.x);
        const y = Math.min(annotation.start.y, annotation.end.y);
        const width = Math.abs(annotation.end.x - annotation.start.x);
        const height = Math.abs(annotation.end.y - annotation.start.y);
        if (annotation.type === "rectangle") context.rect(x, y, width, height);
        else context.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
        if (annotation.filled) context.fill();
        context.stroke();
      }
    }
    context.restore();
  }
}
