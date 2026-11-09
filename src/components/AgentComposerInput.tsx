import { Trigger } from "@arco-design/web-react";
import { Sparkles } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { RefObject, TextareaHTMLAttributes } from "react";
import { listSkills, skillName, type Skill } from "../skills-catalog";
import "./agent-skill-menu.css";

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange" | "onKeyDown"> & {
  inputRef: RefObject<HTMLTextAreaElement>;
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
};

function insertionPoint(input: HTMLTextAreaElement) {
  return input.selectionStart === input.selectionEnd ? input.selectionStart : null;
}

export function AgentComposerInput({ inputRef, value, onChange, onSend, ...props }: Props) {
  const [caret, setCaret] = useState<number | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(0);
  const [catalog, setCatalog] = useState<Skill[] | "error" | null>(null);
  const nextCaret = useRef<number | null>(null);
  const listId = useId();

  const command = caret !== null && !/\S/.test(value.charAt(caret))
    ? value.slice(0, caret).match(/(?:^|\n)[ \t]*\/([\p{L}\p{N}-]*)$/u)
    : null;
  const visible = !!command && !dismissed && !props.disabled && !props.readOnly;
  const query = command?.[1].toLowerCase() || "";
  const options = Array.isArray(catalog) ? catalog.filter(skill =>
    `${skillName(skill)} ${skill.name} ${skill.id}`.toLowerCase().includes(query)) : [];
  const selected = Math.min(active, options.length - 1);

  useEffect(() => {
    if (!visible) return;
    let disposed = false;
    setCatalog(null);
    void listSkills().then(({ items }) => {
      if (!disposed) setCatalog(items.filter(skill => skill.enabled));
    }).catch(() => {
      if (!disposed) setCatalog("error");
    });
    return () => { disposed = true; };
  }, [visible]);

  useLayoutEffect(() => {
    if (nextCaret.current === null) return;
    inputRef.current?.setSelectionRange(nextCaret.current, nextCaret.current);
    nextCaret.current = null;
  }, [inputRef, value]);

  const choose = (skill: Skill) => {
    if (!command || caret === null) return;
    const start = caret - command[1].length - 1;
    const token = `$${skill.id}`;
    const separator = value.charAt(caret) === " " ? "" : " ";
    const next = value.slice(0, start) + token + separator + value.slice(caret);
    if (props.maxLength !== undefined && next.length > props.maxLength) return;
    nextCaret.current = start + token.length + 1;
    setCaret(nextCaret.current);
    setDismissed(true);
    onChange(next);
  };

  return <Trigger trigger={[]} position="tl" popupVisible={visible} updateOnScroll duration={0}
    popupAlign={{ top: 8 }} popupStyle={{ zIndex: 1000 }} onVisibleChange={open => { if (!open) setDismissed(true); }}
    popup={() => <div className="agent-skill-menu" onPointerDown={event => event.stopPropagation()}>
      <div className="agent-skill-menu-heading"><Sparkles size={14} aria-hidden="true" />技能 <small>↑↓ 选择 · Enter 插入 · Esc 关闭</small></div>
      <div className="agent-skill-options" id={listId} role="listbox" aria-label="已启用的技能" aria-busy={catalog === null}>
        {options.map((skill, index) => <button type="button" role="option" tabIndex={-1}
          key={skill.id} id={`${listId}-${index}`} aria-selected={index === selected}
          onMouseDown={event => event.preventDefault()} onClick={() => choose(skill)}
          ref={node => { if (index === selected) node?.scrollIntoView({ block: "nearest" }); }}>
          <span><strong>{skillName(skill)}</strong><code>/{skill.id}</code></span>
          {skill.description && <small>{skill.description}</small>}
        </button>)}
      </div>
      {!options.length && <p role="status">{catalog === null ? "正在读取技能…" : catalog === "error" ? "技能列表读取失败，请重新打开菜单。" : catalog.length ? "没有匹配的技能" : "请先在「设置 → Skills 技能」中启用技能。"}</p>}
    </div>}>
    <textarea {...props} ref={inputRef} value={value} aria-autocomplete="list"
      aria-controls={visible ? listId : undefined}
      aria-activedescendant={visible && selected >= 0 ? `${listId}-${selected}` : undefined}
      onFocus={event => { setCaret(insertionPoint(event.currentTarget)); setDismissed(false); }}
      onBlur={() => setCaret(null)}
      onSelect={event => setCaret(insertionPoint(event.currentTarget))}
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
