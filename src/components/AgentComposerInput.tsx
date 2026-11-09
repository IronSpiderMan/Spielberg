import { Trigger } from "@arco-design/web-react";
import { AtSign, Sparkles } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { RefObject, TextareaHTMLAttributes } from "react";
import { listSkills, skillName, type Skill } from "../skills-catalog";
import type { AgentMention, AgentReference } from "../agent-mentions";
import "./agent-composer-menu.css";

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange" | "onKeyDown"> & {
  inputRef: RefObject<HTMLTextAreaElement>;
  value: string;
  onChange: (value: string, mention?: AgentReference) => void;
  onSend: () => void;
  mentions?: AgentMention[];
};

function insertionPoint(input: HTMLTextAreaElement) {
  return input.selectionStart === input.selectionEnd ? input.selectionStart : null;
}

export function AgentComposerInput({ inputRef, value, onChange, onSend, mentions, ...props }: Props) {
  const [caret, setCaret] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);
  const [composing, setComposing] = useState(false);
  const [catalog, setCatalog] = useState<Skill[] | "error" | null>(null);
  const nextCaret = useRef<number | null>(null);
  const listId = useId();

  const before = caret === null ? "" : value.slice(0, caret);
  const after = caret === null ? "" : value.charAt(caret);
  const command = !/\S/.test(after) ? before.match(/(?:^|\n)[ \t]*\/([\p{L}\p{N}-]*)$/u) : null;
  const reference = mentions && !/\s$/.test(before) && (!after || /[\s，。！？、；：,!?;:()（）]/.test(after))
    ? before.match(/(?:^|[^a-z0-9_@])@([^@\n，。！？、；：,!?;]*)$/i) : null;
  const match = command || reference;
  const query = match?.[1].toLowerCase() || "";
  const menuReady = !dismissed && !composing && !props.disabled && !props.readOnly;
  const showSkills = menuReady && !!command;
  const matchedMentions = menuReady && reference && mentions ? mentions.filter(item => item.name.toLowerCase().includes(query)) : [];
  const exact = matchedMentions.find(item => item.name.toLowerCase() === query);
  const showReferences = menuReady && !!reference && (!query || matchedMentions.length > 0);
  const visible = showSkills || showReferences;
  const options = showReferences
    ? (exact ? [exact, ...matchedMentions.filter(item => item !== exact)] : matchedMentions).slice(0, 80).map(mention => ({
      id: mention.name, title: `@${mention.name}`, description: mention.description, token: `@${mention.name}`, mention,
    }))
    : Array.isArray(catalog) ? catalog.filter(skill => `${skillName(skill)} ${skill.name} ${skill.id}`.toLowerCase().includes(query)).map(skill => ({
      id: skill.id, title: skillName(skill), description: skill.description, token: `$${skill.id}`, code: `/${skill.id}`, mention: undefined,
    })) : [];
  const selected = Math.min(active, options.length - 1);

  useEffect(() => {
    if (!showSkills) return;
    let disposed = false;
    setCatalog(null);
    void listSkills().then(({ items }) => {
      if (!disposed) setCatalog(items.filter(skill => skill.enabled));
    }).catch(() => {
      if (!disposed) setCatalog("error");
    });
    return () => { disposed = true; };
  }, [showSkills]);

  useLayoutEffect(() => {
    if (nextCaret.current === null) return;
    inputRef.current?.setSelectionRange(nextCaret.current, nextCaret.current);
    nextCaret.current = null;
  }, [inputRef, value]);

  const choose = ({ token, mention }: typeof options[number]) => {
    if (!match || caret === null) return;
    const start = caret - match[1].length - 1;
    const separator = value.charAt(caret) === " " ? "" : " ";
    const next = value.slice(0, start) + token + separator + value.slice(caret);
    if (props.maxLength !== undefined && next.length > props.maxLength) return;
    nextCaret.current = start + token.length + 1;
    setCaret(nextCaret.current);
    setDismissed(true);
    if (mention) {
      const { description, ...reference } = mention;
      onChange(next, reference);
    } else onChange(next);
  };

  return <Trigger trigger={[]} position="tl" popupVisible={visible} updateOnScroll duration={0}
    popupAlign={{ top: 8 }} popupStyle={{ zIndex: 1000 }} onVisibleChange={open => { if (!open) setDismissed(true); }}
    popup={() => <div className="agent-composer-menu" onPointerDown={event => event.stopPropagation()}>
      <div className="agent-composer-menu-heading">{showReferences ? <><AtSign size={14} aria-hidden="true" />项目引用</> : <><Sparkles size={14} aria-hidden="true" />技能</>} <small>↑↓ 选择 · Enter 插入 · Esc 关闭</small></div>
      <div className="agent-composer-options" id={listId} role="listbox" aria-label={showReferences ? "项目引用" : "已启用的技能"} aria-busy={showSkills && catalog === null}>
        {options.map((option, index) => <button type="button" role="option" tabIndex={-1}
          key={option.id} id={`${listId}-${index}`} aria-selected={index === selected}
          onMouseDown={event => event.preventDefault()} onClick={() => choose(option)}
          ref={node => { if (index === selected) node?.scrollIntoView({ block: "nearest" }); }}>
          <span><strong>{option.title}</strong>{"code" in option && <code>{option.code}</code>}</span>
          {option.description && <small>{option.description}</small>}
        </button>)}
      </div>
      {showReferences && (matchedMentions.length > 80 || !options.length) && <p role="status">{options.length ? "继续输入名称或点号路径以缩小范围。" : "当前项目还没有可引用的对象。"}</p>}
      {showSkills && !options.length && <p role="status">{catalog === null ? "正在读取技能…" : catalog === "error" ? "技能列表读取失败，请重新打开菜单。" : catalog.length ? "没有匹配的技能" : "请先在「设置 → Skills 技能」中启用技能。"}</p>}
    </div>}>
    <textarea {...props} ref={inputRef} value={value} aria-autocomplete="list"
      aria-controls={visible ? listId : undefined}
      aria-activedescendant={visible && selected >= 0 ? `${listId}-${selected}` : undefined}
      onFocus={event => { setCaret(insertionPoint(event.currentTarget)); setDismissed(false); }}
      onBlur={() => setCaret(null)}
      onSelect={event => setCaret(insertionPoint(event.currentTarget))}
      onCompositionStart={() => setComposing(true)}
      onCompositionEnd={event => { setComposing(false); setCaret(insertionPoint(event.currentTarget)); }}
      onChange={event => {
        setCaret(insertionPoint(event.currentTarget));
        setDismissed(false);
        setActive(0);
        onChange(event.currentTarget.value);
      }}
      onKeyDown={event => {
        if (event.defaultPrevented || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        if (visible && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setDismissed(true);
          return;
        }
        if (visible && options.length && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey &&
          (event.key === "ArrowDown" || event.key === "ArrowUp")) {
          event.preventDefault();
          const delta = event.key === "ArrowDown" ? 1 : -1;
          setActive((selected + delta + options.length) % options.length);
        }
        if (event.key !== "Enter" || event.shiftKey) return;
        event.preventDefault();
        if (!visible) onSend();
        else if (selected >= 0) choose(options[selected]);
      }} />
  </Trigger>;
}
