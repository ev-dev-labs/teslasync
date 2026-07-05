import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/cn';

export interface TransitionArrowProps {
  /** Source state / value label. Falls back to an em-dash when empty. */
  from?: string | null;
  /** Destination state / value label. Falls back to an em-dash when empty. */
  to?: string | null;
  /** Extra classes merged onto the root element. */
  className?: string;
  /** Test hook. */
  testId?: string;
}

/** Shown for a side of the transition that has no usable value. */
const PLACEHOLDER = '—';

/**
 * Resolve a display label. A non-blank string renders as-is; `null`,
 * `undefined`, empty/whitespace-only strings, and (defensively) any
 * non-string value that leaks through loosely-typed API data all render
 * the em-dash placeholder instead of a blank gap.
 */
function displayLabel(value: string | null | undefined): string {
  return typeof value === 'string' && value.trim() !== '' ? value : PLACEHOLDER;
}

/**
 * `TransitionArrow` — compact "from → to" label for FSM / state-change
 * timelines (e.g. `parked → driving`). The middle glyph is decorative, so
 * the control is exposed to assistive tech as a single `role="img"` with a
 * translated "{from} to {to}" label — announced once, cleanly — while each
 * side degrades to an em-dash placeholder when its value is missing.
 */
export function TransitionArrow({ from, to, className, testId }: TransitionArrowProps) {
  const { t } = useTranslation();
  const fromLabel = displayLabel(from);
  const toLabel = displayLabel(to);

  return (
    <span
      role="img"
      aria-label={t('transitionArrow.label', '{{from}} to {{to}}', {
        from: fromLabel,
        to: toLabel,
      })}
      data-testid={testId}
      className={cn('inline-flex items-center font-mono text-xs', className)}
    >
      <span aria-hidden className="text-[var(--text-secondary)]">{fromLabel}</span>
      <span aria-hidden className="mx-1 text-[var(--text-muted)]">→</span>
      <span aria-hidden className="text-[var(--text-primary)]">{toLabel}</span>
    </span>
  );
}
