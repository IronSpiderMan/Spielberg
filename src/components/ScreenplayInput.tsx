import {assetCategoryLabel} from "../asset-categories";
import { useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { PromptMention } from "../prompt-mentions";

// Measure wrapped text with the same typography, without moving the real caret.
function caretPosition(input: HTMLTextAreaElement) {
  const mirror = document.createElement("div");
  const style = getComputedStyle(input);
  for (const property of Array.from(style)) mirror.style.setProperty(property, style.getPropertyValue(property));
  Object.assign(mirror.style, {
    position: "fixed", left: "0", top: "0", visibility: "hidden", height: "auto",
    minHeight: "0", maxHeight: "none", width: `${input.clientWidth}px`,
    overflow: "hidden", whiteSpace: "pre-wrap", overflowWrap: "break-word", scrollbarGutter: "auto",
  });
  mirror.textContent = input.value.slice(0, input.selectionStart);
  const marker = document.createElement("span");
  marker.textContent = input.value.slice(input.selectionStart) || "\u200b";
  mirror.append(marker);
  document.body.append(mirror);
  const position = { left: marker.offsetLeft - input.scrollLeft, top: marker.offsetTop - input.scrollTop, lineHeight: parseFloat(style.lineHeight) };
  mirror.remove();
  return position;
}

export function ScreenplayInput({ inputRef, value, onChange, mentions, disabled, label = "Markdown 剧本内容", placeholder = "输入剧本，使用 @ 引用资产、场景或提示词…" }: {
  inputRef: RefObject<HTMLTextAreaElement>; value: string; onChange: (value: string) => void;
  mentions: PromptMention[]; disabled: boolean; label?: string; placeholder?: string;
}) {
  const listId = useId();
  const list = useRef<HTMLDivElement>(null);
  const pendingCaret = useRef<number>();
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [composing, setComposing] = useState(false);
  const [active, setActive] = useState(0);
  const [position, setPosition] = useState({ left: 8, top: 0, maxHeight: 240 });
  const query = value.slice(0, selection.start).match(/(?:^|[^\w@])@([^@\n]*)$/);
  const search = query?.[1];
  const options = search !== undefined && !/\s$/.test(search)
    ? mentions.filter(item => item.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())) : [];
  const show = focused && !dismissed && !disabled && !composing && selection.start === selection.end && options.length > 0;
  const selected = Math.min(active, options.length - 1);

  const updateSelection = (input: HTMLTextAreaElement) => {
    setSelection({ start: input.selectionStart, end: input.selectionEnd });
  };
  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    if (caret === undefined) return;
    pendingCaret.current = undefined;
    inputRef.current?.focus();
    inputRef.current?.setSelectionRange(caret, caret);
    setSelection({ start: caret, end: caret });
  }, [value]);
  const placeSuggestions = () => {
    const input = inputRef.current;
    if (!input) return;
    const caret = caretPosition(input);
    const below = input.clientHeight - caret.top - caret.lineHeight - 8;
    const above = caret.top - 8;
    const desiredHeight = Math.min(240, (list.current?.scrollHeight ?? 238) + 2);
    const height = Math.min(desiredHeight, Math.max(below, above), input.clientHeight - 16);
    const top = below >= height ? caret.top + caret.lineHeight : caret.top - height;
    setPosition({ left: Math.max(8, Math.min(caret.left, input.clientWidth - 348)), top: Math.max(8, top), maxHeight: Math.max(40, height) });
  };
  useLayoutEffect(() => {
    if (!show) return;
    placeSuggestions();
    const observer = new ResizeObserver(placeSuggestions);
    if (inputRef.current) observer.observe(inputRef.current);
    return () => observer.disconnect();
  }, [show, value, selection.start, options.length]);
  useLayoutEffect(() => {
    if (show) list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [show, selected]);

  const choose = (index: number) => {
    if (!show || search === undefined || !options[index]) return;
    const start = selection.start - search.length - 1;
    const token = `@${options[index].name} `;
    const caret = start + token.length;
    pendingCaret.current = caret;
    onChange(value.slice(0, start) + token + value.slice(selection.start));
    setDismissed(true);
  };
  return <div className="screenplay-input">
    <textarea ref={inputRef} aria-label={label} value={value} disabled={disabled} spellCheck={false}
      aria-autocomplete="list" aria-controls={show ? listId : undefined} aria-activedescendant={show ? `${listId}-${selected}` : undefined}
      placeholder={placeholder}
      onFocus={event => { setFocused(true); updateSelection(event.currentTarget); }} onBlur={() => setFocused(false)}
      onSelect={event => updateSelection(event.currentTarget)}
      onChange={event => { onChange(event.currentTarget.value); updateSelection(event.currentTarget); setActive(0); setDismissed(false); }}
      onCompositionStart={() => setComposing(true)} onCompositionEnd={event => { setComposing(false); updateSelection(event.currentTarget); }}
      onScroll={() => { if (show) placeSuggestions(); }}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.keyCode === 229 || !show) return;
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setDismissed(true); }
        else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault(); setActive((selected + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
        } else if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); choose(selected); }
      }} />
    {show && <div ref={list} id={listId} className="screenplay-suggestions" role="listbox" aria-label="剧本引用" style={position}>
      {options.map((item, index) => <button key={item.id} type="button" role="option" id={`${listId}-${index}`} aria-selected={index === selected}
        onMouseDown={event => event.preventDefault()} onClick={() => choose(index)}>
        <b>@{item.name}</b><small>{item.kind === "role" ? assetCategoryLabel(item.category) : item.kind === "prompt" ? "提示词" : "场景 / 图片"}{item.description ? ` · ${item.description}` : ""}</small>
      </button>)}
    </div>}
  </div>;
}
