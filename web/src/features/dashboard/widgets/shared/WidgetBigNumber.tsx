import { AnimatedNumber } from '@/components/data-display';
import { Badge } from '@/components/ui';
import { cn } from '@/lib/cn';
import { dashboardTokens } from '../../lib/dashboardTokens';

const badgeVariantMap = {
  success: 'success',
  warning: 'warning',
  error: 'danger',
  neutral: 'neutral',
} as const;

export interface WidgetBigNumberProps {
  /** Already converted/formatted at the widget boundary; strings are never recased. */
  value: string | number | null | undefined;
  unit?: string;
  label?: string;
  subtitle?: string;
  badge?: { text: string; variant: 'success' | 'warning' | 'error' | 'neutral' };
  valueColor?: string;
  nullDisplay?: string;
  animated?: boolean;
  decimals?: number;
  align?: 'start' | 'center';
  size?: 'primary' | 'secondary';
}

export function WidgetBigNumber({
  value,
  unit,
  label,
  subtitle,
  badge,
  valueColor = 'text-[var(--text-primary)]',
  nullDisplay = '—',
  animated = true,
  decimals,
  align = 'start',
  size = 'primary',
}: WidgetBigNumberProps) {
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

  return (
    <div className={cn('flex h-full min-w-0 flex-col justify-center gap-1', align === 'center' ? 'items-center text-center' : 'items-start')}>
      {label && (
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

      {subtitle && <span className={dashboardTokens.metricLabel}>{subtitle}</span>}

      {badge && (
        <Badge variant={badgeVariantMap[badge.variant]} size="sm">
          {badge.text}
        </Badge>
      )}
    </div>
  );
}
