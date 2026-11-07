import { ImagePreviewModal } from "./ImagePreviewModal";
import { Button, Empty, Input, Modal, Space } from "@arco-design/web-react";
import { Check, ZoomIn } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { imageUrl, type Media, type Snapshot } from "../core";
import "./asset-image-picker.css";

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
  const imageCount = data.media.filter(media => media.kind === "image").length;
  const isSelected = (id: number) => multiple ? selectedIds.includes(id) : value === id;
  const choose = (id: number) => {
    if (busy) return;
    if (multiple) onToggle?.(id);
    else onSelect(id);
  };
  return <>
      <Modal
        className="asset-picker-modal asset-image-library-modal"
        wrapClassName="asset-image-library-wrapper"
        title={`为${label}从素材库选择图片`}
        visible={visible}
        footer={<div className="asset-picker-footer"><span role="status">{multiple ? <>已选择 <b>{selectedIds.length}</b> 张图片</> : "点击图片即可选择"}</span><Button type={multiple ? "primary" : "secondary"} disabled={busy} onClick={onClose}>{multiple ? "完成选择" : "关闭"}</Button></div>}
        onCancel={onClose}
        closable={!busy}
        maskClosable={!busy}
        escToExit={!busy}
      >
        <div className="asset-image-library-toolbar"><Input.Search
          value={assetQuery}
          onChange={setAssetQuery}
          allowClear
          aria-label="搜索图片素材名称"
          placeholder="搜索素材名称"
        /><div className="asset-image-library-summary"><span role="status">{assetQuery.trim() ? `找到 ${libraryImages.length} 张图片` : `共 ${imageCount} 张图片`}</span><span>{multiple ? "点击卡片选择或取消，放大查看细节" : "点击卡片选择，放大查看细节"}</span></div></div>
        {libraryImages.length ? (
          <div className="media-picker asset-image-picker" aria-label="图片素材" aria-busy={busy}>
            {libraryImages.map((media) => (
              <div
                key={media.id}
                className={isSelected(media.id) ? "media-option asset-image-library-card selected" : "media-option asset-image-library-card"}
              >
                <button
                  type="button"
                  className="media-option-select"
                  disabled={busy}
                  onClick={() => choose(media.id)}
                  aria-label={`${multiple && isSelected(media.id) ? "取消选择素材" : "选择素材"} ${media.name}`}
                  aria-pressed={isSelected(media.id)}
                  aria-describedby={isSelected(media.id) ? `${selectionId}-selected-${media.id}` : undefined}
                >
                  <div className="asset-image-library-thumbnail"><img src={imageUrl(media)} alt="" loading="lazy" decoding="async" /></div>
                  <span className="asset-image-library-name" title={media.name}>{media.name}</span>
                </button>
                <span className={`asset-image-library-check${isSelected(media.id) ? " is-selected" : ""}`} aria-hidden="true">{isSelected(media.id) && <Check size={14}/>}</span>
                {isSelected(media.id) && <span className="asset-image-library-selected-label" id={`${selectionId}-selected-${media.id}`}>已选择</span>}
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
                choose(assetPreview.id);
                setAssetPreview(null);
              }}
            >
              {multiple && assetPreview && selectedIds.includes(assetPreview.id) ? "取消选择此图片" : "选择此图片"}
            </Button>
          </Space>
        } />
  </>;
}
