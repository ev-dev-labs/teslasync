import { Battery, BellRing, PlugZap, Route } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { BenchmarkMetric } from '@/api/hooks/useBenchmarks';
import { Badge, Caption } from '@/components/ui';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

const icons = {
  degradation_pct: Battery,
  efficiency_wh_per_km: Route,
  charging_reliability_pct: PlugZap,
  operation_reliability_pct: BellRing,
} as const;

export function MetricComparisonDetails({ metric }: { metric: BenchmarkMetric }) {
  const { t } = useTranslation();
  const { fmtNumber } = useNumberFormatting();
  const Icon = icons[metric.metric_name];
  return (
    <div className="space-y-1">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <Caption className="min-w-0 break-words">
          {metric.percentile != null
            ? t('benchmarks.metrics.percentile', '{{value}}th performance percentile', {
                value: fmtNumber(metric.percentile),
              })
            : t('benchmarks.metrics.noPercentile', 'Percentile unavailable')}
        </Caption>
        <Badge variant={metric.quality === 'strong' ? 'success' : 'neutral'} size="sm">
          <Icon className="me-1 h-3 w-3" aria-hidden />
          {t(`benchmarks.quality.${metric.quality}`, metric.quality)}
        </Badge>
      </div>
      <div>
        {metric.higher_is_better
          ? t('benchmarks.brief.higherBetter', 'Higher source values mean better performance.')
          : t('benchmarks.brief.lowerBetter', 'Lower source values mean better performance.')}
      </div>
      <div>
        {t('benchmarks.brief.uncertainty', 'Noisy cohort size: {{count}}; noise scale: {{scale}}. These are private estimates, not confidence scores.', {
          replace: {
            count: metric.noisy_cohort_size == null ? '—' : fmtNumber(metric.noisy_cohort_size),
            scale: metric.noise_scale == null ? '—' : fmtNumber(metric.noise_scale),
          },
        })}
      </div>
    </div>
  );
}
