import { memo, useMemo, useRef } from "react";
import { Button, Space } from "@arco-design/web-react";
import { Download, FileText } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ScreenplayInput } from "./ScreenplayInput";
import type { PromptMention } from "../prompt-mentions";
import "../screenplays.css";

const Preview = memo(function Preview({ content }: { content: string }) {
  return <Markdown remarkPlugins={[remarkGfm]} skipHtml
    components={{ a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>{content}</Markdown>;
});
const noMentions: PromptMention[] = [];
type Props = {
  value: string; onChange: (value: string) => void; disabled?: boolean;
  mentions?: PromptMention[]; screenplay?: boolean; template?: string;
  onExport?: () => void; label?: string; previewLabel?: string; placeholder?: string;
};

/** Shared Markdown writing surface for episode scripts and project documents. */
export function MarkdownEditor({ value, onChange, disabled = false, mentions = noMentions, screenplay = false,
  template, onExport, label = "Markdown 文档内容", previewLabel = "文档实时预览", placeholder = "在这里编写 Markdown 文档…" }: Props) {
  const editor = useRef<HTMLTextAreaElement>(null);
  const stats = useMemo(() => ({ characters: value.replace(/\s/g, "").length, lines: value.split("\n").length }), [value]);
  const insert = (prefix: string, suffix = "", fallback = "文字") => {
    if (!editor.current || disabled) return;
    const { selectionStart: start, selectionEnd: end } = editor.current;
    const text = value.slice(start, end) || fallback;
    onChange(value.slice(0, start) + prefix + text + suffix + value.slice(end));
    requestAnimationFrame(() => { editor.current?.focus(); editor.current?.setSelectionRange(start + prefix.length, start + prefix.length + text.length); });
  };
  return <>
    <div className="screenplay-formatbar"><Space size={4} wrap>
      <Button size="small" disabled={disabled} title={screenplay ? "插入场景标题" : "插入标题"} onClick={() => insert("\n## ", "\n", screenplay ? "第一场 · 内景 / 房间 / 夜" : "章节标题")}>标题</Button>
      <Button size="small" disabled={disabled} title={screenplay ? "加粗角色名" : "加粗文字"} onClick={() => insert("**", "**", screenplay ? "角色名" : "文字")}>粗体</Button>
      <Button size="small" disabled={disabled} title={screenplay ? "插入对白" : "插入引用"} onClick={() => insert("\n> ", "\n", screenplay ? "角色对白" : "引用内容")}>{screenplay ? "对白" : "引用"}</Button>
      <Button size="small" disabled={disabled} onClick={() => insert("\n- ", "\n", screenplay ? "场景说明" : "列表内容")}>列表</Button>
      {template && !value && <Button size="small" disabled={disabled} onClick={() => onChange(template)}>使用剧本模板</Button>}
    </Space>{onExport && <Button icon={<Download size={15} />} aria-label="导出 Markdown" onClick={onExport}>导出</Button>}</div>
    <div className="screenplay-panels"><div className="screenplay-source"><div className="screenplay-panel-label">编辑</div>
      <ScreenplayInput inputRef={editor} value={value} disabled={disabled} mentions={mentions} onChange={onChange} label={label} placeholder={placeholder} />
    </div><div className="screenplay-preview"><div className="screenplay-panel-label">预览</div><article className="screenplay-markdown" aria-label={previewLabel}>
      {value ? <Preview content={value} /> : <div className="screenplay-preview-empty"><FileText size={32} /><p>在左侧开始编写，预览会实时更新</p></div>}
    </article></div></div>
    <footer className="screenplay-footer"><span>{stats.characters} 字符 · {stats.lines} 行</span></footer>
  </>;
}
