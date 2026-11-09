import { confirmAction } from "./components/ConfirmAction";
import { forwardRef, useImperativeHandle, useEffect, useMemo, useRef, useState } from "react";
import { Button, Empty, Input, Message, Select, Space } from "@arco-design/web-react";
import { Download, Trash2 } from "lucide-react";
import { post, type Screenplay, type Snapshot } from "./core";
import { newShot, parseShotCsv, serializeShotCsv, shotHeaders, shotDurations, shotSizes, cameraMoves, type ScriptShot } from "./shot-script";
import { ShotMediaField } from "./components/ShotMediaField";
import { buildShotMediaCatalog, resolveShotImage } from "./shot-media";
import { MarkdownEditor } from "./components/MarkdownEditor";
import { promptMentions, savedPromptMentions } from "./prompt-mentions";
import { StoryboardEditor, type Storyboard } from "./StoryboardEditor";
import "./screenplays.css";

type Format = "markdown" | "csv";
type Draft = { id?: number; title: string; content: string };
type Documents = Record<Format, Draft>;
type EditorState = { drafts: Documents; saved: Documents };
const formats: Format[] = ["markdown", "csv"];
const same = (a: Draft, b: Draft) => a.id === b.id && a.content === b.content;
function readDocuments(data: Snapshot, episodeId: number): Documents {
  const title = data.episodes.find(episode => episode.id === episodeId)?.title || "本集";
  const read = (format: Format): Draft => (data.screenplays || []).find(script => script.episode_id === episodeId && script.format === format)
    || { title: `${title} · ${format === "csv" ? "分镜头剧本" : "剧本"}`, content: format === "csv" ? serializeShotCsv([]) : "" };
  return { markdown: read("markdown"), csv: read("csv") };
}
const template = "# 剧本标题\n\n## 第一场 · 内景 / 房间 / 夜\n\n窗外下着雨，桌上的台灯忽明忽暗。\n\n**林舟**\n> 你终于来了。\n\n**苏晓**\n> 我有一件事必须告诉你。\n\n---\n\n## 第二场 · 外景 / 街道 / 清晨\n\n";

export type ScreenplayEditorHandle = { save: () => Promise<boolean>; chooseFormat: (format: Format) => void };
type Props = { data: Snapshot; episodeId: number; reload: () => Promise<void>; disabled: boolean;
  board?: Storyboard; onBoard: (board: Storyboard) => void; onBoardBusy: (busy: boolean) => void;
  onStatus: (dirty: boolean, busy: boolean) => void; onFormatChange: (format: Format) => void };
const ScreenplayManager = forwardRef<ScreenplayEditorHandle, Props>(function ScreenplayManager({ data, episodeId, reload, disabled, board, onBoard, onBoardBusy, onStatus, onFormatChange }, ref) {
  const [format, setFormat] = useState<Format>("markdown");
  const [state, setState] = useState<EditorState>(() => {
    const documents = readDocuments(data, episodeId);
    return { drafts: documents, saved: documents };
  });
  const [working, setWorking] = useState(false);
  const busyRef = useRef(false);
  const busy = working || disabled;
  const draft = state.drafts[format];
  const dirty = formats.some(key => !same(state.drafts[key], state.saved[key]));
  const editContent = (key: Format, content: string) => setState(current => ({ ...current, drafts: { ...current.drafts, [key]: { ...current.drafts[key], content } } }));
  useEffect(() => { onStatus(dirty, working); }, [dirty, working, onStatus]);
  // Refresh clean documents individually; edits in either tab survive project polling.
  useEffect(() => {
    if (busyRef.current) return;
    const documents = readDocuments(data, episodeId);
    setState(current => {
      const next = { drafts: { ...current.drafts }, saved: { ...current.saved } };
      let changed = false;
      for (const key of formats) {
        if (same(current.drafts[key], current.saved[key]) && !same(documents[key], current.saved[key])) {
          next.drafts[key] = documents[key]; next.saved[key] = documents[key]; changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [data.screenplays, episodeId]);
  const { shots, csvError } = useMemo(() => {
    if (format !== "csv") return { shots: [] as ScriptShot[], csvError: "" };
    try { return { shots: parseShotCsv(draft.content, false), csvError: "" }; }
    catch (error) { return { shots: [] as ScriptShot[], csvError: (error as Error).message }; }
  }, [format, draft.content]);
  const mentions = useMemo(() => [...promptMentions(data.assets, data), ...savedPromptMentions(data.prompts)], [data.assets, data.media, data.episodes, data.prompts]);
  const mediaCatalog = useMemo(() => buildShotMediaCatalog(data.assets, data.media), [data.assets, data.media]);
  const editShots = (next: ScriptShot[]) => editContent("csv", serializeShotCsv(next));
  const editShot = (index: number, change: Partial<ScriptShot>) => editShots(shots.map((shot, i) => i === index ? { ...shot, ...change } : shot));
  const save = async (): Promise<boolean> => {
    if (busyRef.current) return false;
    const changed = formats.filter(key => !same(state.drafts[key], state.saved[key]));
    if (!changed.length) return true;
    if (changed.includes("csv")) {
      try { parseShotCsv(state.drafts.csv.content); }
      catch (error) { Message.warning(String(error)); return false; }
    }
    busyRef.current = true; setWorking(true);
    try {
      for (const key of changed) {
        const document = state.drafts[key];
        const result = await post<Screenplay>(document.id === undefined ? "/screenplays" : "/screenplays/update", {
          project_id: data.project.id, episode_id: episodeId, ...document, format: key,
        });
        // Save each successful response so a later failure can be retried safely.
        setState(current => ({ drafts: { ...current.drafts, [key]: result }, saved: { ...current.saved, [key]: result } }));
      }
      return true;
    } catch (error) { Message.error(String(error)); return false; }
    finally { busyRef.current = false; setWorking(false); }
  };
  useImperativeHandle(ref, () => ({ save, chooseFormat: next => {
    if (busy) return;
    setFormat(next); onFormatChange(next);
  } }));
  const exportDocument = () => {
    const csv = format === "csv";
    let content = draft.content;
    if (csv) {
      try {
        const imageShots = parseShotCsv(content).map(shot => ({
          ...shot, media: shot.media.filter(reference => resolveShotImage(reference, mediaCatalog)),
        }));
        content = "\uFEFF" + serializeShotCsv(imageShots);
      } catch (error) { Message.warning(String(error)); return; }
    }
    const url = URL.createObjectURL(new Blob([content], { type: csv ? "text/csv;charset=utf-8" : "text/markdown;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url;
    const title = data.episodes.find(episode => episode.id === episodeId)?.title || "本集";
    link.download = `${title.replace(/[\\/:*?"<>|]/g, "_")}${csv ? " · 分镜头剧本.csv" : ".md"}`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const copyBoardToTable = () => {
    if (!board?.clips.length || busy) return;
    const next = board.clips.flatMap(scene => {
      const image = mediaCatalog.preferred.get(scene.plan?.reference_media_ids[0] || scene.plan?.image_tasks.find(task => task.media_id)?.media_id || 0);
      return scene.shots.map(shot => ({
        ...newShot(),
        size: [...shotSizes].sort((a, b) => b.length - a.length).find(size => shot.camera.includes(size)) || "中景",
        camera: cameraMoves.find(camera => shot.camera.includes(camera)) || "固定",
        media: image ? [image.value] : [],
        description: `${scene.title} · ${shot.duration} 秒\n${shot.description}${shot.camera ? `\n镜头：${shot.camera}` : ""}${shot.sound ? `\n声音与对白：${shot.sound}` : ""}`,
      }));
    });
    const apply = () => editShots(next);
    if (shots.length || csvError) confirmAction({ intent: "warning", title: "替换当前分镜表？", content: "当前镜头表将替换为 AI 分镜，保存后生效。", okText: "替换分镜表", onOk: apply });
    else apply();
  };
  return <section className="screenplay-page episode-single-script">
    {format === "csv" && <details className="episode-storyboard-tools">
      <summary>AI 分镜与片段制作{board?.clips.length ? ` · ${board.clips.length} 个片段` : ""}</summary>
      <div className="episode-storyboard-body">
        {!!board?.clips.length && <Button disabled={busy} onClick={copyBoardToTable}>转为分镜表</Button>}
        <p className="subtle">使用本集剧本生成分镜；编辑完成后统一点击顶部「保存」。</p>
        <StoryboardEditor data={data} episodeId={episodeId} script={state.drafts.markdown.content} onScript={() => {}} readOnlySource board={board} onChange={onBoard} onBusy={onBoardBusy} reload={reload} disabled={busy} />
      </div>
    </details>}
    <div className="screenplay-workspace"><div className="screenplay-editor">
        {format === "csv" ? <>
          <div className="screenplay-formatbar"><Button disabled={busy || !!csvError} onClick={() => editShots([...shots, newShot()])}>添加镜头</Button><Space><span>{shots.length} 个镜头</span><Button icon={<Download size={15}/>} aria-label="导出 CSV" onClick={exportDocument}>导出 CSV</Button></Space></div>
          <div className="shot-script-table">{csvError ? <p role="alert">{csvError}</p> : <table><colgroup><col className="shot-col-number" /><col className="shot-col-size" /><col className="shot-col-camera" /><col className="shot-col-duration" /><col className="shot-col-media" /><col /><col className="shot-col-actions" /></colgroup><thead><tr>{[...shotHeaders, "操作"].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>
            {shots.map((shot, index) => <tr key={index}>
              <td><span className="shot-number">{index + 1}</span></td>
              <td><Select aria-label={`镜头 ${index + 1} 景别`} value={shot.size} disabled={busy} onChange={size => editShot(index, { size })}>{shotSizes.map(size => <Select.Option key={size} value={size}>{size}</Select.Option>)}</Select></td>
              <td><Select aria-label={`镜头 ${index + 1} 运镜`} value={shot.camera} disabled={busy} onChange={camera => editShot(index, { camera })}>{cameraMoves.map(camera => <Select.Option key={camera} value={camera}>{camera}</Select.Option>)}</Select></td>
              <td><select className="shot-duration-select" aria-label={`镜头 ${index + 1} 时长`} value={shot.duration ?? ""} disabled={busy} onChange={event => editShot(index, { duration: event.target.value ? Number(event.target.value) : null })}>
                <option value="">未设置</option>
                {shotDurations.map(duration => <option key={duration} value={duration}>{duration} 秒</option>)}
              </select></td>
              <td><ShotMediaField references={shot.media} catalog={mediaCatalog} index={index} busy={busy} onChange={media => editShot(index, { media })} /></td>
              <td><Input.TextArea aria-label={`镜头 ${index + 1} 描述`} autoSize={{ minRows: 3 }} value={shot.description} disabled={busy} onChange={description => editShot(index, { description })} /></td>
              <td><Button aria-label={`删除镜头 ${index + 1}`} status="danger" disabled={busy} icon={<Trash2 size={14} />} onClick={() => editShots(shots.filter((_, i) => i !== index))} /></td>
            </tr>)}
          </tbody></table>}{!csvError && !shots.length && <Empty description="添加镜头，开始编写分镜头剧本" />}</div>
          <footer className="screenplay-footer"><span>共 {shots.length} 个镜头 · {shots.filter(shot => shot.media.some(reference => resolveShotImage(reference, mediaCatalog)?.media)).length} 个已关联图片</span><span>输入 @ 搜索图片，点击引用预览</span></footer>
        </> : <MarkdownEditor value={draft.content} onChange={content => editContent("markdown", content)} disabled={busy} mentions={mentions} screenplay template={template} onExport={exportDocument} label="Markdown 剧本内容" previewLabel="剧本实时预览" placeholder="输入剧本，使用 @ 引用资产、片段或提示词…" />}
    </div></div>
  </section>;
});
export default ScreenplayManager;
