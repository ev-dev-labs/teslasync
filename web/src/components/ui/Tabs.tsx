import { useId, useMemo, useRef, type KeyboardEvent } from 'react';
import { cn } from '@/lib/cn';

export interface TabItem {
  key: string;
  label: string;
  disabled?: boolean;
}

export interface TabsProps {
  tabs: TabItem[];
  activeTab: string;
  onChange: (key: string) => void;
  className?: string;
  /** Optional accessible label for the tablist (overrides `aria-labelledby`). */
  ariaLabel?: string;
}

/**
 * Accessible tabs (WAI-ARIA Tabs pattern):
 * - `role="tablist"` on the container.
 * - Each tab is `role="tab"` with `aria-selected` and roving `tabindex` so
 *   the tab strip is one stop in the document tab order. The selected tab is
 *   the tab stop; if `activeTab` matches no enabled tab (unknown key, or the
 *   selected tab is disabled) the first enabled tab becomes the tab stop so the
 *   strip never drops out of the keyboard tab order.
 * - Left/Right arrows move focus and activation between tabs (automatic
 *   activation — `onChange` fires immediately). Home/End jump to first/last.
 * - Disabled tabs are skipped during arrow navigation.
 *
 * The component does not own the tab panels; consumers render them with
 * `role="tabpanel"` and `aria-labelledby` pointing back to the matching tab's
 * generated id (`{tablistId}-tab-{tab.key}`).
 */
export function Tabs({ tabs, activeTab, onChange, className, ariaLabel }: TabsProps) {
  const tablistId = useId();
  const refs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const items = tabs ?? [];
  const enabledKeys = useMemo(
    () => items.filter(t => !t.disabled).map(t => t.key),
    [items],
  );

  // Roving tabindex: exactly one tab sits in the document tab order. That is the
  // selected tab when it is enabled, but if `activeTab` matches no enabled tab
  // (unknown key, or the selected tab is disabled) we fall back to the first
  // enabled tab so the tablist never becomes unreachable by keyboard.
  const focusableKey = enabledKeys.includes(activeTab) ? activeTab : enabledKeys[0];

  const moveFocus = (nextKey: string) => {
    onChange(nextKey);
    // Defer focus to next tick so React commits aria-selected change first.
    requestAnimationFrame(() => {
      refs.current.get(nextKey)?.focus();
    });
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLButtonElement>, currentKey: string) => {
    if (enabledKeys.length === 0) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const idx = enabledKeys.indexOf(currentKey);
      if (idx === -1) return;
      const delta = e.key === 'ArrowRight' ? 1 : -1;
      const nextIdx = (idx + delta + enabledKeys.length) % enabledKeys.length;
      moveFocus(enabledKeys[nextIdx]);
    } else if (e.key === 'Home') {
      e.preventDefault();
      moveFocus(enabledKeys[0]);
    } else if (e.key === 'End') {
      e.preventDefault();
      moveFocus(enabledKeys[enabledKeys.length - 1]);
    }
  };

  return (
    <div
      className={cn('flex gap-1 border-b border-[var(--panel-border)]', className)}
      role="tablist"
      aria-label={ariaLabel}
    >
      {items.map((tab) => {
        const selected = activeTab === tab.key;
        return (
          <button
            key={tab.key}
            id={`${tablistId}-tab-${tab.key}`}
            ref={(el) => {
              if (el) refs.current.set(tab.key, el);
              else refs.current.delete(tab.key);
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`${tablistId}-panel-${tab.key}`}
            tabIndex={tab.key === focusableKey ? 0 : -1}
            disabled={tab.disabled}
            onClick={() => onChange(tab.key)}
            onKeyDown={(e) => handleKeyDown(e, tab.key)}
            className={cn(
              '-mb-px border-b-2 border-transparent px-4 py-2.5 text-sm font-medium transition-colors',
              'focus-visible:rounded-shape-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]',
              selected
                ? 'border-[var(--theme-primary)] text-[var(--text-primary)]'
                : 'text-[var(--text-muted)] hover:border-[var(--border-default)] hover:text-[var(--text-primary)]',
              tab.disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
