type KeyboardIntent = {
  target: EventTarget | null;
  defaultPrevented: boolean;
  isComposing?: boolean;
  keyCode?: number;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
};

export function isKeyboardTargetVisible(element: HTMLElement | null): element is HTMLElement {
  return !!element && element.isConnected && element.getClientRects().length > 0
    && !element.closest('[hidden], [inert], [aria-hidden="true"]')
    && getComputedStyle(element).visibility !== "hidden";
}

// Portalled menus and previews own their keys even if focus remains on a trigger.
export function hasOpenKeyboardLayer() {
  return Array.from(document.querySelectorAll<HTMLElement>(
    '[role="dialog"], [role="alertdialog"], .arco-select-popup, .arco-dropdown, .arco-popover, .arco-picker-container, .generation-cascade, .generation-parameters',
  )).some(isKeyboardTargetVisible);
}

export function isKeyboardInput(target: EventTarget | null) {
  const element = target instanceof Element ? target : null;
  return !!element?.closest(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="slider"], [role="spinbutton"], [role="listbox"], [role="tree"], [role="grid"], [role="tablist"], audio, video, .arco-select, .arco-trigger-popup, .ic-stage, .asset-graph-stage',
  );
}

export function isKeyboardEventBlocked(event: KeyboardIntent) {
  return event.defaultPrevented || event.isComposing || event.keyCode === 229
    || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
    || isKeyboardInput(event.target) || hasOpenKeyboardLayer();
}

export function focusKeyboardTarget(element: HTMLElement | null) {
  if (!isKeyboardTargetVisible(element) || element.matches(':disabled, [aria-disabled="true"]')) return false;
  element.focus({ preventScroll: true });
  if (document.activeElement !== element) return false;
  element.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
  return true;
}

export function moveCardGridFocus(
  key: string,
  current: HTMLElement,
  cards: HTMLElement[],
  leaveLeft: () => void,
) {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(key)) return false;
  const visible = cards.filter(isKeyboardTargetVisible);
  if (!visible.includes(current)) return false;
  // Layout offsets ignore hover transforms and follow the current responsive grid.
  const rows: HTMLElement[][] = [];
  for (const card of visible) {
    const row = rows.find(items => Math.abs(items[0].offsetTop - card.offsetTop) < 2);
    if (row) row.push(card);
    else rows.push([card]);
  }
  rows.sort((a, b) => a[0].offsetTop - b[0].offsetTop);
  rows.forEach(row => row.sort((a, b) => a.offsetLeft - b.offsetLeft));
  const rowIndex = rows.findIndex(row => row.includes(current));
  const row = rows[rowIndex];
  const column = row.indexOf(current);
  let next: HTMLElement | undefined;
  if (key === "ArrowLeft") {
    if (column === 0) leaveLeft();
    else next = row[column - 1];
  } else if (key === "ArrowRight") next = row[column + 1];
  else if (key === "Home") next = visible[0];
  else if (key === "End") next = visible[visible.length - 1];
  else {
    const nextRow = rows[rowIndex + (key === "ArrowUp" ? -1 : 1)];
    // A short final row lands on its closest available column.
    next = nextRow?.reduce((closest, card) =>
      Math.abs(card.offsetLeft - current.offsetLeft) < Math.abs(closest.offsetLeft - current.offsetLeft) ? card : closest,
    );
  }
  if (next) focusKeyboardTarget(next);
  return true;
}

export function scrollWithKeyboard(event: { key: string; preventDefault: () => void }, element: HTMLElement | null) {
  if (!element || !["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)) return false;
  const page = Math.max(80, element.clientHeight * .85);
  const delta = event.key === "ArrowUp" ? -64 : event.key === "ArrowDown" ? 64 : event.key === "PageUp" ? -page : page;
  const top = event.key === "Home" ? 0 : event.key === "End" ? element.scrollHeight : element.scrollTop + delta;
  event.preventDefault();
  // Immediate scrolling also works reliably with held keys and reduced motion.
  element.scrollTo({ top, behavior: "instant" });
  return true;
}
