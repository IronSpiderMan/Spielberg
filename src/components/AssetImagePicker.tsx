import { ImagePreviewModal } from "./ImagePreviewModal";
import { Button, Empty, Input, Modal, Space } from "@arco-design/web-react";
import { Check, ZoomIn } from "lucide-react";
import { useEffect, useId, useState } from "react";
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
  const selectionId = useId();
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
        footer={multiple ? <div className="asset-picker-footer"><span role="status">已选择 <b>{selectedIds.length}</b> 张图片</span><Button type="primary" disabled={busy} onClick={onClose}>完成选择</Button></div> : null}
        onCancel={onClose}
        closable={!busy}
        maskClosable={!busy}
        escToExit={!busy}
      >
        <Input.Search
          value={assetQuery}
          onChange={setAssetQuery}
          allowClear
          aria-label="搜索图片素材名称"
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
                  aria-describedby={(multiple ? selectedIds.includes(media.id) : value === media.id) ? `${selectionId}-selected-${media.id}` : undefined}
                >
                  <img src={imageUrl(media)} alt="" loading="lazy" decoding="async" />
                  <span title={media.name}>{media.name}</span>
                </button>
                {(multiple ? selectedIds.includes(media.id) : value === media.id) && <span className="media-option-selected" id={`${selectionId}-selected-${media.id}`}><Check size={12} aria-hidden="true"/>已选择</span>}
                <button
                  type="button"
                  className="media-option-zoom"
                  disabled={busy}
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
          <div className="asset-picker-empty"><Empty description={assetQuery ? "没有匹配的图片素材" : "素材库中暂无图片"} />{assetQuery && <Button type="text" onClick={()=>setAssetQuery("")}>清除搜索</Button>}</div>
        )}
      </Modal>
      <ImagePreviewModal className="asset-picker-preview-modal" media={assetPreview} images={libraryImages} onMediaChange={setAssetPreview} title="图片预览" onClose={()=>setAssetPreview(null)}
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
              {multiple && assetPreview && selectedIds.includes(assetPreview.id) ? "取消选择此图片" : "选择此图片"}
            </Button>
          </Space>
        } />
  </>;
}
