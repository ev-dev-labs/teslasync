/**
 * Shared `<ContextMenu>` primitive.
 *
 * Right-click is unused in TeslaSync. Power users expect right-click to
 * surface a contextual action menu on data-table rows, map markers, and
 * other anchor surfaces. This file exposes:
 *
 *   • `useContextMenu()` — returns `{ openMenu, close, contextMenuProps }`.
 *     Callers either spread `contextMenuProps` (when they have a fixed
 *     item list at hook time) or invoke `openMenu(items, x, y)`
 *     imperatively from their own onContextMenu handler (when items
 *     depend on the row / target the user right-clicked).
 *
 *   • `<ContextMenuRoot/>` — single portal-rendered menu host. Mounted
 *     once near the top of the React tree (next to RouteAnnouncer in
 *     `App.tsx`). Subscribes to a module-level pub/sub so any caller
 *     anywhere in the app can open the menu without prop drilling.
 *
 * Behaviour contract:
 *   - Outside-click and Escape close the menu and restore focus to the
 *     element that owned focus when the menu opened.
 *   - Arrow Down / Arrow Up move focus between enabled items (skipping
 *     disabled ones); Home / End jump to first / last; Tab and
 *     Shift+Tab close.
 *   - Enter / Space on a focused item invokes its `onClick`.
 *   - First Arrow Down auto-focuses the first enabled item.
 *   - Viewport overflow is corrected by flipping the menu's anchor edge
 *     after the first measured layout (right-edge flips to x; bottom-edge
 *     flips to y).
 *   - `role="menu"` on the container, `role="menuitem"` per item; the
 *     destructive variant tints the row red but is still a regular
 *     menuitem for assistive tech.
 */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEventHandler,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

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

interface MenuState {
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
function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function getSnapshot(): MenuState | null {
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

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export interface UseContextMenuReturn {
  /** Bind on a trigger element to capture right-click and open the menu
   *  with the items resolved at click time. Only present when the hook
   *  was given an items source. */
  contextMenuProps: { onContextMenu: MouseEventHandler<HTMLElement> };
  /** Imperative open — useful when items depend on the right-clicked
   *  target (e.g. the data-table row). */
  openMenu: (items: ContextMenuItem[], x: number, y: number) => void;
  /** Imperative close. */
  close: () => void;
}

/**
 * Hook that returns a stable `openMenu`/`close` plus an optional
 * `contextMenuProps` convenience for trigger elements that have a fixed
 * (or lazily resolvable) item set.
 *
 * @example imperative
 * ```tsx
 * const { openMenu } = useContextMenu();
 * <tr onContextMenu={(e) => {
 *   const items = buildRowMenu(row);
 *   if (items.length === 0) return;
 *   e.preventDefault();
 *   openMenu(items, e.clientX, e.clientY);
 * }} />
 * ```
 *
 * @example bound
 * ```tsx
 * const { contextMenuProps } = useContextMenu(() => buildItems());
 * <div {...contextMenuProps} />
 * ```
 */
export function useContextMenu(
  itemsOrGetter?: ContextMenuItem[] | (() => ContextMenuItem[]),
): UseContextMenuReturn {
  const itemsRef = useRef(itemsOrGetter);
  itemsRef.current = itemsOrGetter;

  const onContextMenu = useCallback<MouseEventHandler<HTMLElement>>((e) => {
    const source = itemsRef.current;
    if (!source) return;
    const items = typeof source === 'function' ? source() : source;
    if (!items || items.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    const trigger = (e.currentTarget instanceof HTMLElement ? e.currentTarget : null);
    openContextMenu(items, e.clientX, e.clientY, trigger);
  }, []);

  const openMenu = useCallback(
    (items: ContextMenuItem[], x: number, y: number) => {
      // Capture the currently-focused element so close() can restore it.
      const active = (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement)
        ? document.activeElement
        : null;
      openContextMenu(items, x, y, active);
    },
    [],
  );

  const close = useCallback(() => closeContextMenu(), []);

  return { contextMenuProps: { onContextMenu }, openMenu, close };
}

/* ------------------------------------------------------------------ */
/*  Root portal renderer                                               */
/* ------------------------------------------------------------------ */

const VIEWPORT_MARGIN = 8;

/**
 * Mount this component once near the top of the React tree (alongside
 * RouteAnnouncer in `App.tsx`). It subscribes to the module-level menu
 * store and renders the active menu via a portal on `document.body`.
 */
export function ContextMenuRoot() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  if (typeof document === 'undefined') return null;
  if (!snapshot) return null;
  return createPortal(<ContextMenuView state={snapshot} />, document.body);
}

interface ContextMenuViewProps {
  state: MenuState;
}

function ContextMenuView({ state }: ContextMenuViewProps) {
  const { t } = useTranslation();
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Position is mutated directly on the DOM after mount so the
  // measure-and-flip pass doesn't need to schedule a second React
  // render. Initial layout uses (state.x, state.y); the
  // useLayoutEffect below adjusts left/top in place if either edge
  // would overflow the viewport. This avoids the
  // `Warning: An update to ContextMenuRoot inside a test was not
  // wrapped in act(...)` noise that a setState-based flip would
  // otherwise produce.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.style.left = `${state.x}px`;
    el.style.top = `${state.y}px`;
    const rect = el.getBoundingClientRect();
    const viewportW = typeof window !== 'undefined' ? window.innerWidth : rect.width;
    const viewportH = typeof window !== 'undefined' ? window.innerHeight : rect.height;
    let left = state.x;
    let top = state.y;
    if (left + rect.width + VIEWPORT_MARGIN > viewportW) {
      left = Math.max(VIEWPORT_MARGIN, state.x - rect.width);
    }
    if (top + rect.height + VIEWPORT_MARGIN > viewportH) {
      top = Math.max(VIEWPORT_MARGIN, state.y - rect.height);
    }
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [state.x, state.y, state.nonce]);

  // Outside click / wheel / contextmenu / resize / scroll all close.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!containerRef.current) return;
      if (containerRef.current.contains(e.target as Node)) return;
      closeContextMenu();
    };
    const onContextMenu = (e: MouseEvent) => {
      // Allow the next right-click anywhere outside the menu to relocate
      // / replace the menu instead of stacking. The click handler that
      // owns the new location calls openContextMenu() right after.
      if (!containerRef.current) return;
      if (containerRef.current.contains(e.target as Node)) {
        e.preventDefault();
      }
    };
    const onResize = () => closeContextMenu();
    const onScroll = (e: Event) => {
      if (!containerRef.current) return;
      if (containerRef.current.contains(e.target as Node)) return;
      closeContextMenu();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeContextMenu();
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('contextmenu', onContextMenu, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('contextmenu', onContextMenu, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, []);

  // Auto-focus the menu container so Arrow / Home / End / Escape have
  // a keyboard target even when the user opened the menu by pointer.
  useEffect(() => {
    containerRef.current?.focus({ preventScroll: true });
  }, [state.nonce]);

  const enabledIndices = state.items
    .map((it, idx) => (it.disabled ? -1 : idx))
    .filter((idx) => idx >= 0);

  const focusItem = (idx: number) => {
    const target = itemRefs.current[idx];
    target?.focus();
  };

  const focusFirstEnabled = () => {
    if (enabledIndices.length > 0) focusItem(enabledIndices[0]);
  };

  const focusLastEnabled = () => {
    if (enabledIndices.length > 0) focusItem(enabledIndices[enabledIndices.length - 1]);
  };

  const focusNextEnabled = (currentIdx: number, dir: 1 | -1) => {
    if (enabledIndices.length === 0) return;
    const cursor = enabledIndices.indexOf(currentIdx);
    if (cursor === -1) {
      focusItem(dir === 1 ? enabledIndices[0] : enabledIndices[enabledIndices.length - 1]);
      return;
    }
    const nextCursor = (cursor + dir + enabledIndices.length) % enabledIndices.length;
    focusItem(enabledIndices[nextCursor]);
  };

  const handleContainerKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        // If focus is on the container, move to the first enabled item.
        if (e.target === containerRef.current) {
          focusFirstEnabled();
        } else {
          const idx = itemRefs.current.findIndex((el) => el === e.target);
          if (idx >= 0) focusNextEnabled(idx, 1);
          else focusFirstEnabled();
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (e.target === containerRef.current) {
          focusLastEnabled();
        } else {
          const idx = itemRefs.current.findIndex((el) => el === e.target);
          if (idx >= 0) focusNextEnabled(idx, -1);
          else focusLastEnabled();
        }
        break;
      case 'Home':
        e.preventDefault();
        focusFirstEnabled();
        break;
      case 'End':
        e.preventDefault();
        focusLastEnabled();
        break;
      case 'Tab':
        // Tab leaves the menu; close to preserve normal focus order.
        e.preventDefault();
        closeContextMenu();
        break;
      default:
        break;
    }
  };

  const invoke = (item: ContextMenuItem) => {
    if (item.disabled) return;
    closeContextMenu();
    // Run the handler after closeContextMenu() so navigations and DOM
    // re-renders triggered by the action see the menu already torn down.
    queueMicrotask(() => {
      try {
        item.onClick();
      } catch (err) {
        // Surface unexpected handler errors but don't break the menu lifecycle.
        console.error('[ContextMenu] item handler threw', err);
      }
    });
  };

  const containerStyle: CSSProperties = {
    position: 'fixed',
    left: state.x,
    top: state.y,
  };

  return (
    <div
      ref={containerRef}
      role="menu"
      tabIndex={-1}
      id={menuId}
      data-testid="context-menu"
      aria-label={t('contextMenu.menuLabel', 'Context menu')}
      style={containerStyle}
      onKeyDown={handleContainerKey}
      className={cn(
        'z-[100] min-w-[12rem] max-w-[20rem] rounded-lg p-1',
        'border border-[var(--glass-border)] bg-[var(--surface-elevated)] shadow-xl',
        // Forced-colors / Windows High Contrast: surface vars collapse to
        // the OS Canvas, so make the border explicit so the menu remains a
        // distinct rectangle.
        'forced-colors:border forced-colors:border-[CanvasText] forced-colors:bg-[Canvas]',
        'focus-visible:outline-none',
      )}
    >
      <ul className="space-y-0.5" role="none">
        {state.items.map((item, idx) => (
          <li key={item.id} role="none">
            <button
              type="button"
              role="menuitem"
              ref={(el) => { itemRefs.current[idx] = el; }}
              data-testid={`context-menu-item-${item.id}`}
              data-destructive={item.destructive ? 'true' : undefined}
              disabled={item.disabled}
              aria-disabled={item.disabled || undefined}
              tabIndex={-1}
              onClick={() => invoke(item)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  invoke(item);
                }
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm',
                'transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500',
                item.disabled
                  ? 'cursor-not-allowed text-[var(--text-muted)] opacity-60'
                  : item.destructive
                    ? 'text-rose-300 hover:bg-rose-500/10 hover:text-rose-200 focus:bg-rose-500/10'
                    : 'text-[var(--text-secondary)] hover:bg-white/[0.06] hover:text-[var(--text-primary)] focus:bg-white/[0.06] focus:text-[var(--text-primary)]',
              )}
            >
              {item.icon !== undefined && (
                <span aria-hidden="true" className="inline-flex h-4 w-4 shrink-0 items-center justify-center">
                  {item.icon}
                </span>
              )}
              <span className="flex-1 truncate">{item.label}</span>
              {item.shortcut && (
                <span aria-hidden="true" className="ml-2 shrink-0 text-[10px] uppercase tracking-wider text-[var(--text-muted)]">
                  {item.shortcut}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
