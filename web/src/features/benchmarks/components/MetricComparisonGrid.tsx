import { Battery, BellRing, PlugZap, Route } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState, StatSkeleton } from '@/components/feedback';
import { MetricCard } from '@/components/data-display';
import { Badge, GlassPanel } from '@/components/ui';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceToSI } from '@/lib/unitConversion';
import { fmtNumber, fmtPercent } from '@/lib/numberFormat';
import type {
  BenchmarkMetric,
  BenchmarkMetricName,
  BenchmarkRelease,
} from '@/api/hooks/useBenchmarks';

const icons = {
  degradation_pct: Battery,
  efficiency_wh_per_km: Route,
  charging_reliability_pct: PlugZap,
  operation_reliability_pct: BellRing,
} as const;

export function MetricComparisonGrid({
  release,
  loading = false,
}: {
  release: BenchmarkRelease | null;
  loading?: boolean;
}) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();

  const labels: Record<BenchmarkMetricName, string> = {
    degradation_pct: t('benchmarks.metrics.degradation', 'Battery degradation'),
    efficiency_wh_per_km: t('benchmarks.metrics.efficiency', 'Driving efficiency'),
    charging_reliability_pct: t('benchmarks.metrics.charging', 'Charging reliability'),
    operation_reliability_pct: t(
      'benchmarks.metrics.operations',
      'Notification & command reliability',
    ),
  };
  const format = (metric: BenchmarkMetric, value: number | null) => {
    if (value == null) return '—';
    if (metric.metric_name === 'efficiency_wh_per_km') {
      const metersPerUnit = convertDistanceToSI(1, unitPrefs.distance);
      return `${fmtNumber(value * metersPerUnit / 1000, 0)} Wh/${unitPrefs.distance}`;
    }
    return fmtPercent(value, 1);
  };

  const metrics = release?.metrics ?? [];
  return (
    <GlassPanel className="p-5 md:p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
          {t('benchmarks.metrics.title', 'Private comparisons')}
        </h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {t(
            'benchmarks.metrics.subtitle',
            'Ranges and percentiles are noisy estimates, not exact fleet rankings.',
          )}
        </p>
      </div>
      {loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => <StatSkeleton key={index} />)}
        </div>
      ) : metrics.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric) => {
            const Icon = icons[metric.metric_name];
            const range = metric.suppressed
              ? t('benchmarks.metrics.suppressed', 'Suppressed below privacy threshold')
              : t('benchmarks.metrics.range', 'Private IQR {{low}}–{{high}}', {
                  low: format(metric, metric.noisy_p25),
                  high: format(metric, metric.noisy_p75),
                });
            return (
              <div key={metric.metric_name} className="space-y-2">
                <MetricCard
                  label={labels[metric.metric_name]}
                  value={format(metric, metric.target_value)}
                  subtitle={range}
                  icon={<Icon className="h-4 w-4" />}
                  color={metric.suppressed ? 'amber' : 'cyan'}
                />
                <div className="flex items-center justify-between px-1 text-xs text-[var(--text-muted)]">
                  <span>
                    {metric.percentile != null
                      ? t('benchmarks.metrics.percentile', '{{value}}th performance percentile', {
                          value: fmtNumber(metric.percentile, 0),
                        })
                      : t('benchmarks.metrics.noPercentile', 'Percentile unavailable')}
                  </span>
                  <Badge variant={metric.quality === 'strong' ? 'success' : 'neutral'} size="sm">
                    {t(`benchmarks.quality.${metric.quality}`, metric.quality)}
                  </Badge>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        // no-action: the "Create release" control lives in the adjacent Cohort Eligibility panel on this same page; nothing to trigger from inside this grid.
        <EmptyState
          title={t('benchmarks.metrics.emptyTitle', 'No comparison released')}
          message={t(
            'benchmarks.metrics.empty',
            'Metric cards remain unavailable until an eligible private release exists.',
          )}
          className="py-8"
        />
      )}
    </GlassPanel>
  );
}
