import { useContext } from 'react';
import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { AnimatedNumber } from '@/components/data-display';
import { Badge } from '@/components/ui';
import { cn } from '@/lib/cn';
import { dashboardTokens } from '../../lib/dashboardTokens';
import { WidgetTitleContext } from '../WidgetTitleContext';

const badgeVariantMap = {
  success: 'success',
  warning: 'warning',
  error: 'danger',
  neutral: 'neutral',
} as const;

/** Status-only tone for the delta line. Never inferred from the sign of the text. */
const deltaToneClass = {
  good: 'text-[var(--semantic-success)]',
  bad: 'text-[var(--semantic-danger)]',
  neutral: 'text-[var(--text-muted)]',
} as const;

export interface WidgetBigNumberDelta {
  /**
   * Caller-formatted delta text, sign included (e.g. "+4 vs last week",
   * "−6.6%", "Saved $96 vs gas"). Rendered verbatim; never recased.
   */
  text: string;
  /**
   * Status meaning only (spec `.delta.g/.b/.n`): good → success hue, bad →
   * danger hue, neutral → muted. Defaults to neutral and is never inferred
   * from the sign — a negative delta can be neutral context ("−6.6% since
   * new") and a positive one can be bad.
   */
  tone?: 'good' | 'bad' | 'neutral';
  /** Optional direction glyph rendered before the text (decorative, aria-hidden). */
  trend?: 'up' | 'down' | 'flat';
}

export interface WidgetBigNumberProps {
  /** Already converted/formatted at the widget boundary; strings are never recased. */
  value: string | number | null | undefined;
  unit?: string;
  label?: string;
  subtitle?: string;
  /** Spec delta line: small semibold tone-colored text under the value. Hidden when there is no value. */
  delta?: WidgetBigNumberDelta;
  badge?: { text: string; variant: 'success' | 'warning' | 'error' | 'neutral' };
  valueColor?: string;
  nullDisplay?: string;
  animated?: boolean;
  decimals?: number;
  align?: 'start' | 'center';
  size?: 'primary' | 'secondary';
}

const trendGlyph = {
  up: TrendingUp,
  down: TrendingDown,
  flat: Minus,
} as const;

export function WidgetBigNumber({
  value,
  unit,
  label,
  subtitle,
  delta,
  badge,
  valueColor = 'text-[var(--text-primary)]',
  nullDisplay = '—',
  animated = true,
  decimals,
  align = 'start',
  size = 'primary',
}: WidgetBigNumberProps) {
  const widgetTitle = useContext(WidgetTitleContext);
  // A "big number" is only meaningful when it is a finite number. Guarding on
  // `!== null` alone let NaN / ±Infinity through — the non-animated path then
  // rendered the literal string "NaN"/"Infinity", and AnimatedNumber silently
  // coerced non-finite input to a misleading "0". A runtime-`undefined` value
  // (the type says `number | null`, but callers pass `data?.field`) slipped
  // through the same crack. Treat every non-finite input as absent so it lands
  // on the placeholder instead.
  const hasValue = typeof value === 'number'
    ? Number.isFinite(value)
    : typeof value === 'string' && value.trim() !== '';
  const metricClass = size === 'primary' ? dashboardTokens.metric : dashboardTokens.secondaryMetric;
  // A delta without a headline value is meaningless ("+4 vs last week" next
  // to "—"), so it follows the unit's rule: only rendered alongside a value.
  const deltaText = delta?.text?.trim() ? delta.text : null;
  const TrendIcon = delta?.trend ? trendGlyph[delta.trend] : null;

  return (
    <div className={cn('flex h-full min-w-0 flex-col justify-center gap-1', align === 'center' ? 'items-center text-center' : 'items-start')}>
      {label && label !== widgetTitle && (
        <span className={dashboardTokens.metricLabel}>{label}</span>
      )}
      <div className="flex max-w-full flex-wrap items-baseline gap-x-1.5 gap-y-1">
        {hasValue ? (
          animated && typeof value === 'number' ? (
            <AnimatedNumber value={value} decimals={decimals} className={cn(metricClass, 'break-all', valueColor)} />
          ) : (
            <span className={cn(metricClass, 'min-w-0 break-all', valueColor)}>{value}</span>
          )
        ) : (
          <span className={cn(metricClass, 'text-[var(--text-muted)]')}>{nullDisplay}</span>
        )}
        {unit && hasValue && <span className={dashboardTokens.unit}>{unit}</span>}
      </div>

      {deltaText && hasValue && (
        <span className={cn('inline-flex items-center gap-1 text-xs font-semibold tabular-nums', deltaToneClass[delta?.tone ?? 'neutral'])}>
          {TrendIcon && <TrendIcon className="h-3.5 w-3.5" aria-hidden="true" />}
          {deltaText}
        </span>
      )}

      {subtitle && <span className={dashboardTokens.metricLabel}>{subtitle}</span>}

      {badge && (
        <Badge variant={badgeVariantMap[badge.variant]} size="sm">
          {badge.text}
        </Badge>
      )}
    </div>
  );
}
