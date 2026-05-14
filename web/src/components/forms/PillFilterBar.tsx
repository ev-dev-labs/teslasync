import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { fmtInt } from '@/lib/numberFormat';

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
  /**
   * Optional accent colour used by the dot/active border. Falls back to
   * cyan to match the rest of the app's neon palette.
   */
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
   *   - `pills` (default) — rounded-full chips with active fill
   *   - `tabs`            — flat row with bottom-border underline
   */
  variant?: 'pills' | 'tabs';
  /** Allow horizontal scroll on overflow (mobile). Default `true`. */
  scrollable?: boolean;
  /** Additional class names on the outer container. */
  className?: string;
  /** Test hook for the outer container. */
  testId?: string;
}

const ACCENT_PILL: Record<NonNullable<PillItem['accent']>, { active: string; dot: string }> = {
  cyan:   { active: 'bg-cyan-500/15 text-cyan-300 ring-1 ring-cyan-400/40',   dot: 'bg-cyan-400' },
  green:  { active: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-400/40', dot: 'bg-emerald-400' },
  amber:  { active: 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-400/40', dot: 'bg-amber-400' },
  red:    { active: 'bg-rose-500/15 text-rose-300 ring-1 ring-rose-400/40',   dot: 'bg-rose-400' },
  purple: { active: 'bg-purple-500/15 text-purple-300 ring-1 ring-purple-400/40', dot: 'bg-purple-400' },
  blue:   { active: 'bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-400/40', dot: 'bg-indigo-400' },
};

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
 * and similar "pick one" surfaces where a tab-style affordance is too
 * heavy.
 *
 * Implements the WAI-ARIA Tabs pattern: the row is a `tablist`, each pill
 * is a `tab`, and Left/Right/Home/End move focus + activation. Selected
 * pill receives the only `tabIndex={0}` so the row consumes a single stop
 * in the document tab order.
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
  scrollable = true,
  className,
  testId,
}: PillFilterBarProps) {
  const tablistId = useId();
  const refs = useRef<Map<string, HTMLButtonElement>>(new Map());

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
      role="tablist"
      aria-label={ariaLabel}
      data-testid={testId}
      className={cn(
        'flex items-center gap-1.5',
        scrollable && 'overflow-x-auto scrollbar-thin -mx-1 px-1',
        variant === 'tabs' && 'border-b border-white/[0.06]',
        className,
      )}
    >
      {items.map((item) => {
        const selected = activeKey === item.key;
        const accent = item.accent ?? 'cyan';

        const baseClass =
          variant === 'pills'
            ? cn(
                'inline-flex items-center gap-1.5 shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60',
                selected
                  ? ACCENT_PILL[accent].active
                  : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-white/[0.04]',
                item.disabled && 'cursor-not-allowed opacity-40',
              )
            : cn(
                'inline-flex items-center gap-1.5 shrink-0 px-3 py-2 text-sm font-medium border-b-2 transition-colors',
                'focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60',
                selected
                  ? ACCENT_TAB[accent]
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]',
                item.disabled && 'cursor-not-allowed opacity-40',
              );

        return (
          <button
            key={item.key}
            id={`${tablistId}-tab-${item.key}`}
            ref={(el) => {
              if (el) refs.current.set(item.key, el);
              else refs.current.delete(item.key);
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onChange(item.key)}
            onKeyDown={(e) => handleKeyDown(e, item.key)}
            className={baseClass}
          >
            {variant === 'pills' && selected && (
              <span className={cn('h-1.5 w-1.5 rounded-full', ACCENT_PILL[accent].dot)} aria-hidden />
            )}
            {item.icon && (
              <span className="inline-flex items-center [&>svg]:h-3.5 [&>svg]:w-3.5" aria-hidden>
                {item.icon}
              </span>
            )}
            <span>{item.label}</span>
            {typeof item.count === 'number' && (
              <span
                className={cn(
                  'ml-0.5 text-[10px] tabular-nums',
                  selected ? 'opacity-80' : 'opacity-60',
                )}
              >
                ({fmtInt(item.count)})
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
