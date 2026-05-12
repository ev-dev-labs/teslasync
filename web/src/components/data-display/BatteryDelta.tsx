import { useTranslation } from 'react-i18next';
import { Battery } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface BatteryDeltaProps {
  /** Starting state-of-charge percentage (0–100). */
  startPct: number | null | undefined;
  /** Ending state-of-charge percentage (0–100). */
  endPct: number | null | undefined;
  /** When true, render the lucide battery icon to the left. Default `true`. */
  showIcon?: boolean;
  /**
   * Display variant:
   *   - `'compact'` (default): just the delta — "−1%", "+12%", "—"
   *   - `'pair'`: "79% → 78%" (legacy charging-card style)
   */
  variant?: 'compact' | 'pair';
  className?: string;
  /** Test hook. */
  testId?: string;
}

/**
 * `BatteryDelta` — compact battery state-of-charge change.
 *
 * Examples (compact):
 *   start=79 end=78  → "−1%"  amber
 *   start=20 end=80  → "+60%" emerald
 *   start=80 end=80  → "—"    muted
 *   start=null       → "—"    muted
 *
 * The colour rules match the existing in-app convention:
 *   - drop in SoC during *driving* is normal, rendered amber
 *   - rise in SoC (charging) is rendered emerald
 *   - zero or missing renders muted
 *
 * Used by both Drives (where deltas are usually negative — battery
 * drained by the trip) and Charging (where deltas are usually positive
 * — battery filled by the session).
 */
export function BatteryDelta({
  startPct,
  endPct,
  showIcon = true,
  variant = 'compact',
  className,
  testId,
}: BatteryDeltaProps) {
  const { t } = useTranslation();
  const hasData =
    startPct != null &&
    endPct != null &&
    Number.isFinite(startPct) &&
    Number.isFinite(endPct);

  const dash = '—';

  if (!hasData) {
    return (
      <span
        data-testid={testId}
        aria-label={t('battery.delta.unknown', 'Battery delta unknown')}
        className={cn('inline-flex items-center gap-1 text-[var(--text-muted)]', className)}
      >
        {showIcon && <Battery className="h-3 w-3" aria-hidden />}
        <span>{dash}</span>
      </span>
    );
  }

  const delta = endPct - startPct;
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '';
  const magnitude = Math.abs(delta);
  const tone =
    delta > 0
      ? 'text-emerald-300'
      : delta < 0
        ? 'text-amber-300'
        : 'text-[var(--text-muted)]';

  const compactLabel = delta === 0 ? dash : `${sign}${magnitude}%`;
  const pairLabel = `${startPct}% → ${endPct}%`;
  const visible = variant === 'pair' ? pairLabel : compactLabel;
  const a11y = t('battery.delta.aria', 'Battery {{from}}% to {{to}}%', {
    from: startPct,
    to: endPct,
  });

  return (
    <span
      data-testid={testId}
      aria-label={a11y}
      className={cn('inline-flex items-center gap-1', className)}
    >
      {showIcon && <Battery className="h-3 w-3" aria-hidden />}
      <span className={cn('tabular-nums', tone)}>{visible}</span>
    </span>
  );
}
