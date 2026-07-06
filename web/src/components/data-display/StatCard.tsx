import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/feedback/Skeleton';
import { cn } from '@/lib/cn';

export interface StatCardTrend {
  direction: 'up' | 'down' | 'flat';
  value: string;
  /** When `true` the trend renders in the positive (good) colour. */
  positive?: boolean;
}

export interface StatCardProps {
  label: string;
  /**
   * Primary metric value. `null` / `undefined` / non-finite numbers and the
   * empty string degrade to an em-dash instead of rendering a blank cell.
   */
  value: string | number | null | undefined;
  unit?: string;
  icon?: ReactNode;
  trend?: StatCardTrend;
  sublabel?: string;
  loading?: boolean;
  className?: string;
}

const TREND_GLYPH: Record<StatCardTrend['direction'], string> = {
  up: '↑',
  down: '↓',
  flat: '—',
};

/** True when `value` is a renderable, meaningful metric (numeric 0 counts). */
function hasMeaningfulValue(value: StatCardProps['value']): value is string | number {
  if (value === null || value === undefined || value === '') return false;
  if (typeof value === 'number') return Number.isFinite(value);
  return true;
}

/**
 * Compact KPI tile: a labelled metric with an optional unit, leading icon,
 * directional trend chip and sublabel. Purely presentational — callers own the
 * data fetching and pass already-formatted display strings.
 */
export function StatCard({ label, value, unit, icon, trend, sublabel, loading, className }: StatCardProps) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <Card
        className={className}
        role="status"
        aria-busy="true"
        aria-label={t('statCard.loading', 'Loading')}
      >
        <Skeleton width="60%" height={16} />
        <Skeleton width="40%" height={32} className="mt-2" />
      </Card>
    );
  }

  const valueIsPresent = hasMeaningfulValue(value);
  const displayValue = valueIsPresent ? value : '—';

  const direction = trend?.direction ?? 'flat';
  const trendDescription =
    direction === 'up'
      ? t('statCard.trend.increased', 'increased')
      : direction === 'down'
        ? t('statCard.trend.decreased', 'decreased')
        : t('statCard.trend.unchanged', 'no change');

  return (
    <Card className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-[var(--text-muted)]">{label}</span>
        {icon ? (
          <span aria-hidden="true" className="text-[var(--text-muted)]">
            {icon}
          </span>
        ) : null}
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold">{displayValue}</span>
        {unit && valueIsPresent ? (
          <span className="text-sm text-[var(--text-muted)]">{unit}</span>
        ) : null}
      </div>
      {trend ? (
        <div
          className={cn(
            'flex items-center gap-1 text-xs',
            trend.positive
              ? 'text-green-600'
              : direction === 'flat'
                ? 'text-[var(--text-muted)]'
                : 'text-red-600',
          )}
        >
          <span aria-hidden="true">{TREND_GLYPH[direction]}</span>
          <span className="sr-only">{trendDescription}</span>
          <span>{trend.value ?? ''}</span>
        </div>
      ) : null}
      {sublabel ? <span className="text-xs text-[var(--text-muted)]">{sublabel}</span> : null}
    </Card>
  );
}
