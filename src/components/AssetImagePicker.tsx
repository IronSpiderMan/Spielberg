import { ImagePreviewModal } from "./ImagePreviewModal";
import { Button, Empty, Input, Modal, Space } from "@arco-design/web-react";
import { ZoomIn } from "lucide-react";
import { useEffect, useState } from "react";
import { imageUrl, type Media, type Snapshot } from "../core";

export function AssetImagePicker({ visible, label, value, data, onSelect, onClose, busy = false, multiple = false, selectedIds = [], onToggle }: {
  visible: boolean;
  label: string;
  value: number | null;
  data: Snapshot;
  onSelect: (id: number) => void;
  onClose: () => void;
  busy?: boolean;
  multiple?: boolean;
  selectedIds?: number[];
  onToggle?: (id: number) => void;
}) {
  const [assetQuery, setAssetQuery] = useState("");
  const [assetPreview, setAssetPreview] = useState<Media | null>(null);
  useEffect(() => {
    if (!visible) {
      setAssetQuery("");
      setAssetPreview(null);
    }
  }, [visible]);
  const libraryImages = data.media.filter(
    media => media.kind === "image" &&
      media.name.toLocaleLowerCase().includes(assetQuery.trim().toLocaleLowerCase()),
  );
  return <>
      <Modal
        className="asset-picker-modal"
        title={`为${label}从素材库选择图片`}
        visible={visible}
        footer={multiple ? <Button type="primary" onClick={onClose}>完成选择</Button> : null}
        onCancel={onClose}
        closable={!busy}
        maskClosable={!busy}
        escToExit={!busy}
      >
        <Input.Search
          value={assetQuery}
          onChange={setAssetQuery}
          allowClear
          placeholder="搜索素材名称"
        />
        {libraryImages.length ? (
          <div className="media-picker asset-image-picker">
            {libraryImages.map((media) => (
              <div
                key={media.id}
                className={(multiple ? selectedIds.includes(media.id) : value === media.id) ? "media-option selected" : "media-option"}
              >
                <button
                  type="button"
                  className="media-option-select"
                  disabled={busy}
                  onClick={() => {
                    setAssetPreview(media);
                  }}
                  aria-label={`选择素材 ${media.name}`}
                >
                  <img src={imageUrl(media)} alt="" />
                  <span>{media.name}</span>
                </button>
                <button
                  type="button"
                  className="media-option-zoom"
                  onClick={() => setAssetPreview(media)}
                  aria-label={`放大预览 ${media.name}`}
                  title="放大预览"
                >
                  <ZoomIn size={16} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <Empty description={assetQuery ? "没有匹配的图片素材" : "素材库中暂无图片"} />
        )}
      </Modal>
      <ImagePreviewModal className="asset-picker-preview-modal" media={assetPreview} title="图片预览" onClose={()=>setAssetPreview(null)}
        footer={
          <Space>
            <Button onClick={() => setAssetPreview(null)}>关闭</Button>
            <Button
              type="primary"
              disabled={busy || !assetPreview}
              loading={busy}
              onClick={() => {
                if (!assetPreview) return;
                if (multiple) onToggle?.(assetPreview.id);
                else onSelect(assetPreview.id);
                setAssetPreview(null);
              }}
            >
              选择此图片
            </Button>
          </Space>
        } />
  </>;
}
