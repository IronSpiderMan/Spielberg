import type { HTMLAttributes, KeyboardEvent, ReactNode } from "react";

export function previewArrowOffset(event: Pick<KeyboardEvent, "key" | "defaultPrevented" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey"> & {isComposing: boolean}, editing: boolean): number {
  if (editing || event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return 0;
  return event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
}

/** Scope shortcuts to the preview dialog, including its toolbar and thumbnails. */
export function PreviewKeyboardNavigation({ children, enabled, move, ...props }: HTMLAttributes<HTMLDivElement> & {children: ReactNode; enabled: boolean; move: (offset: number) => void}) {
  return <div {...props} style={{...props.style,display:"contents"}} onKeyDownCapture={event => {
    if (!enabled || !(event.target instanceof HTMLElement) || !event.currentTarget.contains(event.target)) return;
    const editing = !!event.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"],[role="listbox"],[role="slider"],[role="spinbutton"],[role="menu"]');
    const offset = previewArrowOffset({...event, isComposing:event.nativeEvent.isComposing}, editing);
    if (!offset) return;
    event.preventDefault(); event.stopPropagation(); move(offset);
  }}>{children}</div>;
}
