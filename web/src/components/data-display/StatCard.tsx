import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, MetricValue, Text } from '@/components/ui';
import { Skeleton } from '@/components/feedback/Skeleton';
import { cn } from '@/lib/cn';
import { VisuallyHidden } from '@/components/a11y';

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
    <Card className={cn('flex min-h-28 flex-col gap-2 p-5', className)}>
      <div className="flex items-center justify-between gap-3">
        <Text as="span" size="sm" weight="medium" color="secondary">{label}</Text>
        {icon ? (
          <span
            aria-hidden="true"
            className="rounded-shape-md border border-[var(--border-default)] bg-[var(--surface-2)] p-2 text-[var(--text-muted)]"
          >
            {icon}
          </span>
        ) : null}
      </div>
      <div className="flex items-baseline gap-1">
        <MetricValue>{displayValue}</MetricValue>
        {unit && valueIsPresent ? (
          <Text as="span" size="sm" color="muted">{unit}</Text>
        ) : null}
      </div>
      {trend ? (
        <Text
          as="div"
          size="xs"
          weight="medium"
          className={cn(
            'flex items-center gap-1',
            trend.positive
              ? 'text-emerald-700 dark:text-emerald-300'
              : direction === 'flat'
                ? 'text-[var(--text-muted)]'
                : 'text-rose-700 dark:text-rose-300',
          )}
        >
          <span aria-hidden="true">{TREND_GLYPH[direction]}</span>
          <VisuallyHidden>{trendDescription}</VisuallyHidden>
          <span>{trend.value ?? ''}</span>
        </Text>
      ) : null}
      {sublabel ? <Text as="span" variant="caption">{sublabel}</Text> : null}
    </Card>
  );
}
