import { Modal } from "@arco-design/web-react";
import type { ReactNode } from "react";
import { imageUrl, type Media } from "../core";

export function ImagePreviewModal({ media, onClose, title = "参考图片预览", visible = !!media, footer = null, className = "" }: {
  media: Media | null;
  onClose: () => void;
  title?: string;
  visible?: boolean;
  footer?: ReactNode;
  className?: string;
}) {
  return <Modal className={`image-preview-modal ${className}`} title={media?.name || title} visible={visible} footer={footer} onCancel={onClose}>
    <div className="image-preview-full">{media && <img src={imageUrl(media)} alt={media.name} />}</div>
  </Modal>;
}
