import { useEffect, useId, useLayoutEffect, useRef, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';
import { closeContextMenu, type ContextMenuItem, type MenuState } from './contextMenuStore';

const VIEWPORT_MARGIN = 8;

export default function ContextMenuView({ state }: { state: MenuState }) {
  const { t } = useTranslation();
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

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

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!containerRef.current || containerRef.current.contains(e.target as Node)) return;
      closeContextMenu();
    };
    const onContextMenu = (e: MouseEvent) => {
      if (containerRef.current?.contains(e.target as Node)) e.preventDefault();
    };
    const onResize = () => closeContextMenu();
    const onScroll = (e: Event) => {
      if (!containerRef.current || containerRef.current.contains(e.target as Node)) return;
      closeContextMenu();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
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

  useEffect(() => {
    containerRef.current?.focus({ preventScroll: true });
  }, [state.nonce]);

  const enabledIndices = state.items.map((item, index) => item.disabled ? -1 : index).filter(index => index >= 0);
  const focusItem = (index: number) => itemRefs.current[index]?.focus();
  const focusFirstEnabled = () => {
    if (enabledIndices.length > 0) focusItem(enabledIndices[0]);
  };
  const focusLastEnabled = () => {
    if (enabledIndices.length > 0) focusItem(enabledIndices[enabledIndices.length - 1]);
  };
  const focusNextEnabled = (currentIndex: number, direction: 1 | -1) => {
    if (enabledIndices.length === 0) return;
    const cursor = enabledIndices.indexOf(currentIndex);
    if (cursor === -1) {
      focusItem(direction === 1 ? enabledIndices[0] : enabledIndices[enabledIndices.length - 1]);
      return;
    }
    focusItem(enabledIndices[(cursor + direction + enabledIndices.length) % enabledIndices.length]);
  };
  const handleContainerKey = (e: KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        e.preventDefault();
        const direction = e.key === 'ArrowDown' ? 1 : -1;
        const index = itemRefs.current.findIndex(element => element === e.target);
        if (e.target !== containerRef.current && index >= 0) focusNextEnabled(index, direction);
        else if (direction === 1) focusFirstEnabled();
        else focusLastEnabled();
        break;
      }
      case 'Home':
        e.preventDefault();
        focusFirstEnabled();
        break;
      case 'End':
        e.preventDefault();
        focusLastEnabled();
        break;
      case 'Tab':
        e.preventDefault();
        closeContextMenu();
        break;
    }
  };
  const invoke = (item: ContextMenuItem) => {
    if (item.disabled) return;
    closeContextMenu();
    queueMicrotask(() => {
      try {
        item.onClick();
      } catch (error) {
        console.error('[ContextMenu] item handler threw', error);
      }
    });
  };
  const containerStyle: CSSProperties = { position: 'fixed', left: state.x, top: state.y };

  return createPortal(
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
        'forced-colors:border forced-colors:border-[CanvasText] forced-colors:bg-[Canvas]',
        'focus-visible:outline-none',
      )}
    >
      <ul className="space-y-0.5" role="none">
        {state.items.map((item, index) => (
          <li key={item.id} role="none">
            <button
              type="button"
              role="menuitem"
              ref={element => { itemRefs.current[index] = element; }}
              data-testid={`context-menu-item-${item.id}`}
              data-destructive={item.destructive ? 'true' : undefined}
              disabled={item.disabled}
              aria-disabled={item.disabled || undefined}
              tabIndex={-1}
              onClick={() => invoke(item)}
              onKeyDown={e => {
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
                <span aria-hidden="true" className="ml-2 shrink-0 text-2xs uppercase tracking-wider text-[var(--text-muted)]">
                  {item.shortcut}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>,
    document.body,
  );
}
