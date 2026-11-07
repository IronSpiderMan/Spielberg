import { Button, Empty, Input, Message, Modal, Pagination, Spin, Tag } from "@arco-design/web-react";
import { Check, CheckCircle2, Film, Search, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import AssetThumbnail, { cachedThumbnailUrl } from "../AssetThumbnail";
import { imageUrl, post, type Media } from "../core";
import { open } from "../platform";
import "./scene-video-picker.css";

const PAGE_SIZE = 12;

export function SceneVideoPicker({ projectId, sceneTitle, primaryId, linkedIds, busy, onClose, onConfirm, onImported }: {
  projectId: string;
  sceneTitle: string;
  primaryId: number | null;
  linkedIds: number[];
  busy: boolean;
  onClose: () => void;
  onConfirm: (media: Media) => Promise<void>;
  onImported: () => void | Promise<void>;
}) {
  const [filter, setFilter] = useState({ query: "", page: 1 });
  const [result, setResult] = useState<{ items: Media[]; total: number }>({ items: [], total: 0 });
  const [selected, setSelected] = useState<Media | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [retry, setRetry] = useState(0);
  const [uploading, setUploading] = useState(false);
  const submitting = useRef(false);
  const importing = useRef(false);
  const detail = useRef<HTMLElement>(null);
  const locked = busy || uploading;
  // Retain the selected object across pages and searches. Ignore late responses
  // after a new search, closing the picker, or changing projects.
  useEffect(() => {
    let disposed = false;
    setLoading(true);
    setError("");
    const timer = window.setTimeout(() => {
      void post<{ items: Media[]; total: number }>("/media/list", {
        project_id: projectId, kind: "video", query: filter.query.trim(), page: filter.page, limit: PAGE_SIZE,
      }).then(value => {
        if (disposed) return;
        const lastPage = Math.max(1, Math.ceil(value.total / PAGE_SIZE));
        if (filter.page > lastPage) { setFilter(current => ({ ...current, page: lastPage })); return; }
        setResult(value);
        setLoading(false);
      }).catch(reason => {
        if (!disposed) { setError(reason instanceof Error ? reason.message : String(reason)); setLoading(false); }
      });
    }, filter.query.trim() ? 250 : 0);
    return () => { disposed = true; window.clearTimeout(timer); };
  }, [projectId, filter.query, filter.page, retry]);
  const confirm = async () => {
    if (!selected || selected.id === primaryId || locked || submitting.current || importing.current) return;
    submitting.current = true;
    setSubmitError("");
    try { await onConfirm(selected); }
    catch (reason) { setSubmitError(`设置失败：${reason instanceof Error ? reason.message : String(reason)}。可重新点击确认。`); }
    finally { submitting.current = false; }
  };
  const select = (media: Media) => {
    setSelected(media);
    setSubmitError("");
    if (window.matchMedia("(max-width: 760px)").matches) detail.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  const upload = async () => {
    if (locked || importing.current || submitting.current) return;
    importing.current = true;
    setUploading(true);
    setSubmitError("");
    try {
      const source = await open({ multiple: false, filters: [{ name: "视频", extensions: ["mp4", "mov", "webm", "mkv"] }] });
      if (typeof source !== "string") return;
      const media = await post<Media>("/media/import", { project_id: projectId, source_path: source });
      select(media);
      setFilter({ query: "", page: 1 });
      setRetry(value => value + 1);
      Message.success("视频已上传，预览后点击确认即可设为主视频");
      try { await onImported(); } catch { Message.warning("视频已上传，项目刷新失败，请稍后重试"); }
    } catch (reason) { setSubmitError(`上传失败：${reason instanceof Error ? reason.message : String(reason)}`); }
    finally { importing.current = false; setUploading(false); }
  };
  return <Modal visible title={<span className="scene-video-picker-title"><Film size={19} />选择场景视频</span>}
    className="scene-video-picker" style={{ width: 1040 }}
    onCancel={onClose} closable={!locked} maskClosable={false} escToExit={!locked} unmountOnExit
    footer={<div className="scene-video-picker-footer">
      <div className="scene-video-picker-selection" role="status" aria-live="polite">
        {selected ? <><CheckCircle2 size={16} /><span>已选：<strong title={selected.name}>{selected.name}</strong></span></> : <span>选择一个视频，预览后确认使用</span>}
      </div>
      <div className="scene-video-picker-actions"><Button disabled={locked} onClick={onClose}>取消</Button>
        <Button type="primary" icon={<Check size={15} />} loading={busy} disabled={uploading || !selected || selected.id === primaryId} onClick={() => void confirm()}>
          {selected?.id === primaryId ? "已是主视频" : "使用并设为主视频"}
        </Button></div>
    </div>}>
    <p className="scene-video-picker-intro">为「{sceneTitle}」选择已有成片，用于场景预览和剧集合并。</p>
    <div className="scene-video-picker-layout">
      <section className="scene-video-picker-browser" aria-label="视频素材列表">
        <div className="scene-video-picker-toolbar">
          <Input value={filter.query} onChange={query => { setLoading(true); setFilter({ query, page: 1 }); }} allowClear
            disabled={locked} prefix={<Search size={16} />} aria-label="搜索全部视频素材" placeholder="搜索全部视频素材…" />
          <Button icon={<Upload size={15} />} disabled={busy} loading={uploading} onClick={() => void upload()}>本地上传</Button>
        </div>
        <div className="scene-video-picker-list-heading"><b>项目视频</b><span role="status">{loading ? "正在搜索…" : error ? "加载失败" : `共 ${result.total} 个${filter.query.trim() ? "搜索结果" : "视频"}`}</span><span>最新优先 · 单选</span></div>
        <div className="scene-video-picker-scroll" aria-busy={loading}>
          {loading ? <div className="scene-video-picker-state"><Spin /><p>正在加载视频素材…</p></div>
            : error ? <div className="scene-video-picker-state" role="alert"><Empty description="视频素材加载失败" /><p>{error}</p><Button onClick={() => setRetry(value => value + 1)}>重新加载</Button></div>
              : result.items.length ? <div className="scene-video-picker-grid">
                {result.items.map(media => <button type="button" key={media.id} className={`scene-video-picker-card${selected?.id === media.id ? " is-selected" : ""}`}
                  aria-label={`选择视频 ${media.name}`} aria-pressed={selected?.id === media.id} disabled={locked}
                  onClick={() => select(media)}>
                  <div className="scene-video-picker-thumbnail"><AssetThumbnail media={media} projectId={projectId} />
                    <span className="scene-video-picker-check" aria-hidden="true">{selected?.id === media.id && <Check size={13} />}</span>
                    {media.id === primaryId ? <Tag className="scene-video-picker-badge" size="small" color="green">当前主视频</Tag>
                      : linkedIds.includes(media.id) && <Tag className="scene-video-picker-badge" size="small">已在此场景</Tag>}
                  </div>
                  <strong title={media.name}>{media.name}</strong><span className="scene-video-picker-card-meta">视频 · #{media.id}</span>
                </button>)}
              </div> : <div className="scene-video-picker-state"><Empty description={filter.query.trim() ? "没有找到匹配的视频" : "项目中还没有视频素材"} />
                <p>{filter.query.trim() ? "试试其他关键词，或清除搜索查看全部视频。" : "上传已有成片，或返回场景生成新视频。"}</p>
                {filter.query.trim() ? <Button disabled={locked} onClick={() => setFilter({ query: "", page: 1 })}>清除搜索</Button> : <Button icon={<Upload size={15} />} onClick={() => void upload()} loading={uploading} disabled={busy}>上传视频</Button>}
              </div>}
        </div>
        <div className="scene-video-picker-pagination"><span>点击缩略图选择，右侧播放预览</span>
          {!error && result.total > PAGE_SIZE && <Pagination simple size="small" sizeCanChange={false} current={filter.page} total={result.total} pageSize={PAGE_SIZE} disabled={loading || locked}
            onChange={page => { setLoading(true); setFilter(current => ({ ...current, page })); }} />}
        </div>
      </section>
      <aside className="scene-video-picker-detail" aria-label="所选视频预览" ref={detail}>
        <div className="scene-video-picker-detail-heading"><b>视频预览</b>{selected && <Tag size="small">已选择 1 个</Tag>}</div>
        {selected ? <SelectedVideo key={`${projectId}:${selected.id}`} media={selected} projectId={projectId} />
          : <div className="scene-video-picker-preview-empty"><Film size={36} strokeWidth={1.2} /><b>先看，再使用</b><p>选择左侧视频，在这里查看画面与时长。</p></div>}
        <div className="scene-video-picker-notice"><CheckCircle2 size={16} /><p>确认后立即保存为场景主视频。原主视频会保留在候选版本中。</p></div>
        {submitError && <div className="scene-video-picker-submit-error" role="alert">{submitError}</div>}
      </aside>
    </div>
  </Modal>;
}

function SelectedVideo({ media, projectId }: { media: Media; projectId: string }) {
  const [metadata, setMetadata] = useState("");
  const [failed, setFailed] = useState(false);
  return <div className="scene-video-picker-preview">
    <div className="scene-video-picker-player">
      {failed ? <div className="scene-video-picker-play-error" role="status"><Film size={28} /><p>当前格式无法在此播放，可确认使用后下载查看。</p></div>
        : <video src={imageUrl(media)} poster={cachedThumbnailUrl(media, projectId) || undefined} controls playsInline preload="metadata" aria-label={`预览 ${media.name}`}
          onError={() => setFailed(true)} onLoadedMetadata={event => {
            const video = event.currentTarget;
            const seconds = Math.max(0, Math.round(video.duration));
            setMetadata(`${video.videoWidth} × ${video.videoHeight}${Number.isFinite(seconds) ? ` · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : ""}`);
          }} />}
    </div>
    <strong title={media.name}>{media.name}</strong>
    <span>{metadata || "视频素材"} · #{media.id}</span>
  </div>;
}
