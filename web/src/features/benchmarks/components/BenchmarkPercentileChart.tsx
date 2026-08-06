import { useTranslation } from 'react-i18next';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ChartContainer,
  CHART_COLORS,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import type { BenchmarkMetricName, BenchmarkRelease } from '@/api/hooks/useBenchmarks';

export function BenchmarkPercentileChart({
  release,
  loading = false,
}: {
  release: BenchmarkRelease | null;
  loading?: boolean;
}) {
  const { t } = useTranslation();
  const labels: Record<BenchmarkMetricName, string> = {
    degradation_pct: t('benchmarks.chart.degradation', 'Degradation'),
    efficiency_wh_per_km: t('benchmarks.chart.efficiency', 'Efficiency'),
    charging_reliability_pct: t('benchmarks.chart.charging', 'Charging'),
    operation_reliability_pct: t('benchmarks.chart.operations', 'Operations'),
  };
  const data = (release?.metrics ?? [])
    .filter((metric) => !metric.suppressed && metric.percentile != null)
    .map((metric) => ({
      metric: labels[metric.metric_name],
      percentile: metric.percentile,
    }));
  return (
    <ChartContainer
      title={t('benchmarks.chart.title', 'Noise-adjusted performance percentiles')}
      subtitle={t('benchmarks.chart.subtitle', 'Higher bars mean better relative performance')}
      height={280}
      loading={loading}
      empty={data.length === 0}
      ariaLabel={t(
        'benchmarks.chart.aria',
        'Performance percentile by private benchmark metric, from zero to one hundred',
      )}
      data={data}
      dataColumns={[
        { key: 'metric', label: t('benchmarks.chart.metric', 'Metric') },
        { key: 'percentile', label: t('benchmarks.chart.percentile', 'Percentile') },
      ]}
    >
      {data.length > 0 ? (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis dataKey="metric" />
            <YAxis domain={[0, 100]} />
            <Tooltip
              formatter={(value) => [
                String(value),
                t('benchmarks.chart.percentile', 'Percentile'),
              ]}
            />
            <Bar dataKey="percentile" fill={CHART_COLORS[0]} radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        // no-action: the "Create release" control lives in the adjacent Cohort Eligibility panel on this same page; nothing to trigger from inside the chart itself.
        <EmptyState
          message={t('benchmarks.chart.empty', 'No released percentiles to chart.')}
          className="py-8"
        />
      )}
    </ChartContainer>
  );
}
