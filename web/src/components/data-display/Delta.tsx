import { type ReactNode } from 'react';
import { ArrowUp, ArrowDown, ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  resolveSemantic,
  type Direction,
  type MetricId,
  type MetricSemantic,
  type MetricUnit,
} from '@/lib/metricSemantics';
import { fmtNumber } from '@/lib/numberFormat';
import { useFormatting } from '@/hooks/useFormatting';
import { useUnits } from '@/hooks/useUnits';
import { Skeleton } from '@/components/feedback/Skeleton';
import { cn } from '@/lib/cn';

export interface DeltaProps {
  /** Either a registered metric id, a `MetricSemantic`, or an inline `{direction, unit?}`. */
  metric: MetricId | MetricSemantic | { direction: Direction; unit?: MetricUnit };
  /** Current period value, in the metric's display units (caller-converted). */
  current: number | null | undefined;
  /** Previous period value. `null`/`undefined` renders "—" with no colour. */
  previous: number | null | undefined;
  /** Which form to render. Defaults to `percent`. */
  display?: 'percent' | 'absolute' | 'both';
  /** Trailing label, e.g. "vs last week". Pass `useCompareWindow(...).previousLabel`. */
  comparedTo?: string;
  size?: 'sm' | 'md';
  /** If true, render in a tight chip; if false, a stat row. */
  inline?: boolean;
  /** Hide the directional arrow. */
  hideArrow?: boolean;
  /** Force the loading skeleton. */
  loading?: boolean;
  className?: string;
  /** Override the default precision (defaults to 1 for percent, settings precision for absolute). */
  precision?: number;
}

interface ResolvedUnitLabels {
  /** Prefix shown before the value (e.g. currency symbol). */
  prefix: string;
  /** Suffix shown after the value with a leading space (e.g. "kWh"). */
  suffix: string;
}

function useUnitLabels(unit: MetricUnit | undefined): ResolvedUnitLabels {
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const speedUnit = unitPrefs.speed;
  const tempUnit = unitPrefs.temperature;
  const pressureUnit = unitPrefs.pressure;
  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';
  const { currencySymbol } = useFormatting();
  switch (unit) {
    case 'currency':
      return { prefix: currencySymbol, suffix: '' };
    case 'percent':
      return { prefix: '', suffix: '%' };
    case 'mi':
    case 'km':
      return { prefix: '', suffix: distanceUnit };
    case 'kwh':
      return { prefix: '', suffix: 'kWh' };
    case 'wh':
      return { prefix: '', suffix: 'Wh' };
    case 'wh_per_mi':
      return { prefix: '', suffix: efficiencyUnit };
    case 'h':
      return { prefix: '', suffix: 'h' };
    case 'min':
      return { prefix: '', suffix: 'min' };
    case 'mph':
    case 'kph':
      return { prefix: '', suffix: speedUnit };
    case 'c':
    case 'f':
      return { prefix: '', suffix: tempUnit };
    case 'bar':
      return { prefix: '', suffix: pressureUnit };
    case 'count':
    default:
      return { prefix: '', suffix: '' };
  }
}

function formatAbsolute(value: number, labels: ResolvedUnitLabels, precision: number | undefined): string {
  const num = fmtNumber(value, precision);
  if (labels.prefix && labels.suffix) return `${labels.prefix}${num} ${labels.suffix}`;
  if (labels.prefix) return `${labels.prefix}${num}`;
  if (labels.suffix === '%') return `${num}%`;
  if (labels.suffix) return `${num} ${labels.suffix}`;
  return num;
}

function colorForDelta(direction: Direction, signedDelta: number): string {
  if (signedDelta === 0) return 'text-[var(--text-muted)]';
  if (direction === 'neutral') return 'text-[var(--text-secondary)]';
  const positiveOutcome =
    (direction === 'higher_better' && signedDelta > 0) ||
    (direction === 'lower_better' && signedDelta < 0);
  return positiveOutcome ? 'text-emerald-400' : 'text-rose-400';
}

/**
 * `<Delta>` — direction-aware change indicator with a unified arrow and colour.
 *
 * See `web/src/lib/metricSemantics.ts` for the registry of metric ids. Pass
 * an inline `{ direction, unit? }` for one-off metrics.
 *
 * Behaviour:
 *   - `previous == null`              → renders an em-dash with no colour.
 *   - `previous === 0` and percent    → percent omitted; absolute is shown.
 *   - `delta === 0`                   → "→" arrow + muted colour.
 *   - `direction === 'neutral'`       → never coloured good/bad.
 *
 * The arrow encodes the sign — the absolute value is always rendered as a
 * positive number ("↓ 5%" never "↑ -5%").
 */
export function Delta({
  metric,
  current,
  previous,
  display = 'percent',
  comparedTo,
  size = 'sm',
  inline = true,
  hideArrow = false,
  loading = false,
  className,
  precision,
}: DeltaProps) {
  const { t } = useTranslation();
  const semantic = resolveSemantic(metric);
  const labels = useUnitLabels(semantic.unit);

  const sizeClass = size === 'md' ? 'text-sm' : 'text-xs';
  const iconClass = size === 'md' ? 'h-3.5 w-3.5' : 'h-3 w-3';

  if (loading) {
    return (
      <span className={cn('inline-flex items-center', className)} data-testid="delta-skeleton">
        <Skeleton width="60px" height={size === 'md' ? 16 : 14} />
      </span>
    );
  }

  // Missing inputs — render em-dash, no colour.
  if (
    current == null || !Number.isFinite(current) ||
    previous == null || !Number.isFinite(previous)
  ) {
    return (
      <span
        className={cn('inline-flex items-center gap-1 text-[var(--text-muted)]', sizeClass, className)}
        title={t('delta.noComparison', 'No comparison data')}
        data-testid="delta-empty"
      >
        —{comparedTo ? <span className="text-[var(--text-muted)]">{comparedTo}</span> : null}
      </span>
    );
  }

  const signedDelta = current - previous;
  // Percent only when previous is non-zero and finite.
  const canPercent = previous !== 0;
  const signedPct = canPercent ? (signedDelta / Math.abs(previous)) * 100 : null;

  const color = colorForDelta(semantic.direction, signedDelta);

  let Arrow: typeof ArrowUp;
  if (signedDelta > 0) Arrow = ArrowUp;
  else if (signedDelta < 0) Arrow = ArrowDown;
  else Arrow = ArrowRight;

  const absDelta = Math.abs(signedDelta);
  const absPct = signedPct == null ? null : Math.abs(signedPct);

  const absText = formatAbsolute(absDelta, labels, precision);
  const pctText = absPct == null ? null : `${fmtNumber(absPct, precision ?? 1)}%`;

  let valueNode: ReactNode;
  if (display === 'absolute') {
    valueNode = absText;
  } else if (display === 'both') {
    valueNode = pctText ? <>{absText} <span className="opacity-70">({pctText})</span></> : absText;
  } else {
    // percent — when previous=0 the percent is undefined; fall back to em-dash
    // rather than fabricating Infinity% or showing the absolute (caller asked
    // for percent specifically).
    valueNode = pctText ?? '—';
  }

  const wrapperClass = inline
    ? cn('inline-flex items-center gap-1 font-medium', sizeClass, color, className)
    : cn('flex items-center gap-1.5 font-medium', sizeClass, color, className);

  return (
    <span
      className={wrapperClass}
      title={t('delta.title', '{{current}} vs {{previous}}', {
        current: fmtNumber(current, precision ?? 2),
        previous: fmtNumber(previous, precision ?? 2),
      })}
    >
      {!hideArrow ? <Arrow className={cn(iconClass, 'shrink-0')} aria-hidden="true" /> : null}
      <span>{valueNode}</span>
      {comparedTo ? (
        <span className="text-[var(--text-muted)] font-normal">{comparedTo}</span>
      ) : null}
    </span>
  );
}
