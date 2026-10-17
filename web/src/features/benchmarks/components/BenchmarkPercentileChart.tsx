import { useTranslation } from 'react-i18next';
import {
  Bar,
  BarChart,
  CartesianGrid,
  CHART_COLORS,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  chartAnimationProps,
} from '@/components/charts';
import { EmptyState, StaleRefreshWarning } from '@/components/feedback';
import { ChartCard, SourceContent } from '@/components/layout';
import type { BenchmarkMetricName, BenchmarkPrivacyStatus, BenchmarkRelease, BenchmarkReleasePage } from '@/api/hooks/useBenchmarks';
import type { DataState } from '@/api/dataState';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export function BenchmarkPercentileChart({
  release,
  loading = false,
  source,
  optedIn,
  participationSource,
}: {
  release: BenchmarkRelease | null;
  loading?: boolean;
  source?: DataState<BenchmarkReleasePage>;
  optedIn?: boolean;
  participationSource?: DataState<BenchmarkPrivacyStatus>;
}) {
  const { t } = useTranslation();
  const { fmtNumber } = useNumberFormatting();
  const fatalError = optedIn == null ? participationSource?.fatalError : source?.fatalError;
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
    <ChartCard
      title={t('benchmarks.chart.title', 'Noise-adjusted performance percentiles')}
      subtitle={t('benchmarks.chart.subtitle', 'Higher bars mean better relative performance')}
      height={280}
      size="standard"
      exportable
      loading={loading && !release && !fatalError}
      empty={data.length === 0 && !fatalError && (optedIn != null || !source)}
      footer={source && <StaleRefreshWarning state={source} />}
      ariaLabel={t(
        'benchmarks.chart.aria',
        'Performance percentile by private benchmark metric, from zero to one hundred',
      )}
      data={data}
      dataColumns={[
        { key: 'metric', label: t('benchmarks.chart.metric', 'Metric') },
        { key: 'percentile', label: t('benchmarks.chart.percentile', 'Percentile'), format: fmtNumber },
      ]}
    >
      <SourceContent
        state={fatalError ? 'error' : optedIn == null && !release && source ? 'loading' : 'ready'}
        label={t('benchmarks.chart.title', 'Noise-adjusted performance percentiles')}
        emptyMessage={t('benchmarks.chart.empty', 'No released percentiles to chart.')}
        errorMessage={t('error.loadFailed', 'Failed to load data')}
        error={fatalError}
        errorRecovery={{ onRetry: (optedIn == null ? participationSource?.retry : source?.retry) ?? undefined }}
      >
      {data.length > 0 ? (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis dataKey="metric" />
            <YAxis domain={[0, 100]} tickFormatter={fmtNumber} />
            <Tooltip
              formatter={(value) => [
                fmtNumber(value),
                t('benchmarks.chart.percentile', 'Percentile'),
              ]}
            />
            <Bar dataKey="percentile" fill={CHART_COLORS[0]} radius={[6, 6, 0, 0]} {...chartAnimationProps()} />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        // no-action: the "Create release" control lives in the adjacent Cohort Eligibility panel on this same page; nothing to trigger from inside the chart itself.
        <EmptyState
          message={t('benchmarks.chart.empty', 'No released percentiles to chart.')}
          className="py-8"
        />
      )}
      </SourceContent>
    </ChartCard>
  );
}
