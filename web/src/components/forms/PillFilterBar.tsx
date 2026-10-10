import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

import { useNumberFormatting } from '@/hooks/useNumberFormatting';

/**
 * Single pill descriptor for {@link PillFilterBar}.
 */
export interface PillItem {
  /** Stable identifier — written to URL state and used for `onChange`. */
  key: string;
  /** Visible label. */
  label: string;
  /** Optional left-aligned icon (lucide / svg). */
  icon?: ReactNode;
  /** Optional count rendered as a muted suffix, e.g. `(12)`. */
  count?: number;
  /** Optional accent colour for the active underline in the `tabs` variant. */
  accent?: 'cyan' | 'green' | 'amber' | 'red' | 'purple' | 'blue';
  /** Disabled pills are skipped during arrow navigation. */
  disabled?: boolean;
}

export interface PillFilterBarProps {
  items: readonly PillItem[];
  activeKey: string;
  onChange: (key: string) => void;
  /** Localised label announced to assistive tech. */
  ariaLabel: string;
  /**
   * Render style:
   *   - `pills` (default) — outlined buttons with a solid active fill
   *   - `tabs`            — flat row with bottom-border underline
   */
  variant?: 'pills' | 'tabs';
  /**
   * Interaction semantics, independent of visual `variant`:
   * `tabs` (default) uses roving tab activation; `filters` uses pressed
   * buttons in a labelled group, each enabled button in the Tab order.
   */
  semanticMode?: 'tabs' | 'filters';
  /** Allow horizontal scroll on overflow (mobile). Default `true`. */
  scrollable?: boolean;
  /** Additional class names on the outer container. */
  className?: string;
  /** Test hook for the outer container. */
  testId?: string;
}

const ACCENT_TAB: Record<NonNullable<PillItem['accent']>, string> = {
  cyan:   'border-cyan-400 text-cyan-300',
  green:  'border-emerald-400 text-emerald-300',
  amber:  'border-amber-400 text-amber-300',
  red:    'border-rose-400 text-rose-300',
  purple: 'border-purple-400 text-purple-300',
  blue:   'border-indigo-400 text-indigo-300',
};

/**
 * `PillFilterBar` — accessible single-select filter row used for trend
 * metric switchers, list-page collections (All / Anomalies / Notable / …),
 * and similar "pick one" surfaces.
 *
 * By default implements the WAI-ARIA Tabs pattern: the row is a `tablist`, each pill
 * is a `tab`, and Left/Right/Home/End move focus + activation. Selected
 * pill receives the only `tabIndex={0}` so the row consumes a single stop
 * in the document tab order.
 *
 * Opt into `semanticMode="filters"` for list/collection filters rather than
 * document tabs: a labelled group of native pressed buttons, with normal
 * Tab/Enter/Space interaction and no arrow-key activation. `variant` changes
 * only visual chrome, never these semantics.
 *
 * The component does **not** own panels — consumers render whatever
 * content corresponds to the active key beneath the bar. For pages that
 * also need WAI-aria-compliant panels with `aria-labelledby` wiring, use
 * `Tabs` from `@/components/ui/Tabs` instead.
 */
export function PillFilterBar({
  items,
  activeKey,
  onChange,
  ariaLabel,
  variant = 'pills',
  semanticMode = 'tabs',
  scrollable = true,
  className,
  testId,
}: PillFilterBarProps) {
  const { fmtInt } = useNumberFormatting();
  const tablistId = useId();
  const refs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const isTabs = semanticMode === 'tabs';

  const enabledKeys = items.filter((i) => !i.disabled).map((i) => i.key);

  const moveFocus = (nextKey: string) => {
    onChange(nextKey);
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
      role={isTabs ? 'tablist' : 'group'}
      aria-label={ariaLabel}
      data-testid={testId}
      className={cn(
        'flex min-w-0 max-w-full items-center gap-1.5',
        scrollable && 'overflow-x-auto scrollbar-thin px-1',
        variant === 'tabs' && 'border-b border-white/[0.06]',
        className,
      )}
    >
      {items.map((item) => {
        const selected = activeKey === item.key;
        const accent = item.accent ?? 'cyan';

        const baseClass =
          variant === 'pills'
            ? 'shrink-0 gap-1.5 whitespace-nowrap rounded-shape-sm px-3 text-xs'
            : cn(
                'inline-flex items-center gap-1.5 shrink-0 px-3 py-2 text-sm font-medium border-b-2 transition-colors',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60',
                selected
                  ? ACCENT_TAB[accent]
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]',
                item.disabled && 'cursor-not-allowed opacity-40',
              );

        return (
          <Button
            key={item.key}
            id={isTabs ? `${tablistId}-tab-${item.key}` : undefined}
            ref={(el) => {
              if (el) refs.current.set(item.key, el);
              else refs.current.delete(item.key);
            }}
            type="button"
            variant={variant === 'pills' ? (selected ? 'primary' : 'outline') : 'ghost'}
            size="sm"
            role={isTabs ? 'tab' : undefined}
            aria-selected={isTabs ? selected : undefined}
            aria-pressed={isTabs ? undefined : selected}
            tabIndex={isTabs ? (selected ? 0 : -1) : 0}
            disabled={item.disabled}
            onClick={() => onChange(item.key)}
            onKeyDown={isTabs ? (e) => handleKeyDown(e, item.key) : undefined}
            className={cn(baseClass, !scrollable && 'h-auto min-h-9 max-w-full whitespace-normal')}
          >
            {item.icon && (
              <span className="inline-flex items-center [&>svg]:h-3.5 [&>svg]:w-3.5" aria-hidden>
                {item.icon}
              </span>
            )}
            <span className={!scrollable ? 'min-w-0 break-words' : undefined}>{item.label}</span>
            {typeof item.count === 'number' && (
              <span
                className={cn(
                  'ml-0.5 shrink-0 text-2xs tabular-nums',
                  selected ? 'opacity-80' : 'opacity-60',
                )}
              >
                ({fmtInt(item.count)})
              </span>
            )}
          </Button>
        );
      })}
    </div>
  );
}
