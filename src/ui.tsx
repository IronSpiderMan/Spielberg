import type { ReactNode } from "react";
import type { Snapshot } from "./core";

/** Shared visual primitives; all values come from the existing project snapshot. */
export function PageHeading({title, description, actions}: {title:string;description?:string;actions?:ReactNode}) {
  return <div className="section-title"><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{actions}</div>;
}
export function ProjectSummary({data}: {data:Snapshot}) {
  const scenes=data.episodes.flatMap(episode=>episode.scenes);
  const ready=scenes.filter(scene=>scene.video_media_id).length;
  return <dl className="project-summary" aria-label="项目制作概况">
    <div><dt>剧集</dt><dd>{data.episodes.length}<span>集</span></dd></div>
    <div><dt>场景</dt><dd>{scenes.length}<span>个镜头</span></dd></div>
    <div><dt>角色</dt><dd>{data.roles.length}<span>份设定</span></dd></div>
    <div className="summary-progress"><dt>已选视频</dt><dd>{ready}<span>/ {scenes.length} 个场景</span></dd><progress aria-label="已选视频的场景比例" max={Math.max(scenes.length,1)} value={ready}/></div>
  </dl>;
}
export function PageLoading() {
  return <div className="page-loading" role="status" aria-live="polite"><span>正在加载页面…</span><div/><div/><div/></div>;
}
