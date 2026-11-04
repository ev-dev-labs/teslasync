/** Keep shell subscription independent of route-bound trigger bindings and
 * the renderer, which is loaded only when a menu is requested. */

import type { ReactNode } from 'react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ContextMenuItem {
  /** Stable identifier used as React key. */
  id: string;
  /** Display label rendered inline inside the menu row. */
  label: string;
  /** Optional leading icon. */
  icon?: ReactNode;
  /** Action invoked when the user clicks / Enters / Spaces the item.
   *  The menu auto-closes after the handler runs (sync or async). */
  onClick: () => void;
  /** When true, the item is rendered visibly but is non-interactive. */
  disabled?: boolean;
  /** When true, the item is tinted red (e.g. Delete, Archive). */
  destructive?: boolean;
  /** Optional right-aligned shortcut hint (e.g. "⌘⇧D"). */
  shortcut?: string;
}

export interface MenuState {
  items: ContextMenuItem[];
  x: number;
  y: number;
  /** Element that had focus when the menu opened. Restored on close. */
  restoreFocusEl: HTMLElement | null;
  /** Monotonic open-counter so re-opens with identical (items,x,y) still
   *  re-render the menu (e.g. user right-clicks twice in the same spot). */
  nonce: number;
}

type Listener = (s: MenuState | null) => void;

/* ------------------------------------------------------------------ */
/*  Module-level store                                                 */
/* ------------------------------------------------------------------ */

let state: MenuState | null = null;
let nonceCounter = 0;
const listeners = new Set<Listener>();

function emit(): void {
  for (const fn of listeners) fn(state);
}

/** Subscribe to menu-state changes. Returns an unsubscribe function. */
export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getSnapshot(): MenuState | null {
  return state;
}

/** Imperatively open the context menu at viewport coordinates. */
export function openContextMenu(
  items: ContextMenuItem[],
  x: number,
  y: number,
  restoreFocusEl: HTMLElement | null = null,
): void {
  if (!items || items.length === 0) return;
  nonceCounter += 1;
  state = { items, x, y, restoreFocusEl, nonce: nonceCounter };
  emit();
}

/** Close the context menu (no-op when already closed). */
export function closeContextMenu(): void {
  if (state === null) return;
  const prev = state;
  state = null;
  emit();
  // Restore focus to the trigger so keyboard users don't lose their place.
  // Defer one tick so React's commit (which removed the menu portal) has a
  // chance to settle first; otherwise some browsers swallow the .focus()
  // call when the previously-focused descendant element was just unmounted.
  if (prev.restoreFocusEl && document.body.contains(prev.restoreFocusEl)) {
    queueMicrotask(() => prev.restoreFocusEl?.focus({ preventScroll: true }));
  }
}

/** Test-only — wipe store between tests. */
export function __resetContextMenuForTests(): void {
  state = null;
  nonceCounter = 0;
  listeners.clear();
}
