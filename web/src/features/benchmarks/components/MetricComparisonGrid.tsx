import { useTranslation } from 'react-i18next';
import { EmptyState, StaleRefreshWarning } from '@/components/feedback';
import { OperationalBrief } from '@/components/data-display';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { Caption } from '@/components/ui';
import { LayoutCard } from '@/components/layout';
import { useUnits } from '@/hooks/useUnits';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { convertDistanceToSI } from '@/lib/unitConversion';
import type { DataState } from '@/api/dataState';

import type {
  BenchmarkMetric,
  BenchmarkMetricName,
  BenchmarkRelease,
  BenchmarkReleasePage,
} from '@/api/hooks/useBenchmarks';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { MetricComparisonDetails } from './operationalbrief-all/MetricComparisonDetails';

export function MetricComparisonGrid({
  release,
  loading = false,
  source,
  optedIn,
}: {
  release: BenchmarkRelease | null;
  loading?: boolean;
  source?: DataState<BenchmarkReleasePage>;
  optedIn?: boolean;
}) {
  const { fmtNumber, fmtPercent } = useNumberFormatting();
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
      return `${fmtNumber(value * metersPerUnit / 1000)} Wh/${unitPrefs.distance}`;
    }
    return fmtPercent(value);
  };

  const metrics = release?.metrics ?? [];
  const summaryMetrics: readonly StatMetric[] = metrics.length === 0
    ? (['degradation_pct', 'efficiency_wh_per_km', 'charging_reliability_pct', 'operation_reliability_pct'] as const)
      .map<StatMetric>((name) => ({
        metricId: name === 'efficiency_wh_per_km' ? 'efficiency' : 'percent',
        occurrenceId: name, rawValue: null, label: labels[name],
        description: t('benchmarks.brief.unknownScope', 'No released cohort or source window is available.'),
      }))
    : metrics.map<StatMetric>((metric) => {
      const range = metric.suppressed
        ? t('benchmarks.metrics.suppressed', 'Suppressed below privacy threshold')
        : t('benchmarks.metrics.range', 'Private IQR {{low}}–{{high}}', {
            low: format(metric, metric.noisy_p25),
            high: format(metric, metric.noisy_p75),
          });
      return {
        metricId: metric.metric_name === 'efficiency_wh_per_km' ? 'efficiency' : 'percent',
        occurrenceId: metric.metric_name,
        rawValue: metric.metric_name === 'efficiency_wh_per_km'
          ? metric.target_value == null ? null : metric.target_value / 1000
          : metric.target_value,
        label: labels[metric.metric_name],
        description: range,
        display: {
          formatter: (raw) => ({
            value: format(metric, metric.metric_name === 'efficiency_wh_per_km' ? raw * 1000 : raw),
            unit: '',
          }),
        },
        context: <MetricComparisonDetails metric={metric} />,
      };
    });
  const operationalMetrics = useOperationalMetrics(summaryMetrics);
  const retained = source?.status === 'stale';
  const statusLabel = retained
    ? t('benchmarks.brief.retained', 'Retained release')
    : source?.fatalError
      ? t('benchmarks.brief.unavailable', 'Release unavailable')
      : loading
        ? t('benchmarks.brief.loading', 'Loading release')
        : optedIn === false
          ? t('benchmarks.cohort.optInTitle', 'Consent required')
          : source?.status === 'initial' && optedIn == null && !release
            ? t('benchmarks.brief.participationPending', 'Awaiting participation status')
            : release?.suppressed
              ? t('benchmarks.brief.suppressed', 'Release suppressed')
              : release
                ? t('benchmarks.brief.released', 'Private release')
                : t('benchmarks.cohort.noRelease', 'No stable release yet');
  const scope = release
    ? t('benchmarks.brief.scope', '{{start}}–{{end}}; {{family}}; model-year bucket {{year}}; k ≥ {{minimum}}.', {
        start: release.period_start, end: release.period_end,
        family: release.model_family.replace('_', ' '),
        year: release.model_year_bucket > 0
          ? `${release.model_year_bucket}–${release.model_year_bucket + 4}`
          : t('benchmarks.cohort.unknownYear', 'Unknown'),
        minimum: release.minimum_cohort_size,
      })
    : t('benchmarks.brief.unknownScope', 'No released cohort or source window is available.');
  const created = release
    ? t('benchmarks.brief.created', 'Released {{date}}', { date: release.created_at })
    : t('benchmarks.brief.noTimestamp', 'Release timestamp unavailable');
  const provenance = release
    ? t('benchmarks.brief.provenance', 'Release {{id}}; mechanism version {{version}}. {{scope}} {{created}}', {
        id: release.release_id, version: release.mechanism_version, scope, created,
      })
    : scope;
  const description = t('benchmarks.metrics.subtitle', 'Ranges and percentiles are noisy estimates, not exact fleet rankings.');
  return (
    <LayoutCard
      title={t('benchmarks.metrics.title', 'Private comparisons')}
      description={t(
            'benchmarks.metrics.subtitle',
            'Ranges and percentiles are noisy estimates, not exact fleet rankings.',
          )}
    >
      {source && <StaleRefreshWarning state={source} />}
      <OperationalBrief
        compact
        eyebrow={t('benchmarks.brief.eyebrow', 'Bounded private comparisons')}
        title={t('benchmarks.metrics.title', 'Private comparisons')}
        description={description}
        statusLabel={statusLabel}
        statusTone={retained || release?.suppressed ? 'warning' : source?.fatalError ? 'danger' : 'neutral'}
        metrics={operationalMetrics}
        loading={loading && !release}
        scope={<Caption>{scope}</Caption>}
        freshness={<Caption>{created}</Caption>}
        provenance={provenance}
        narrative={{
          whatChanged: description,
          whyItMatters: null,
          confidence: { label: 'not_scored', score: null, basis: [] },
          likelyCause: null,
          recommendedResponse: null,
          limitations: [
            t('benchmarks.method.limit', 'Differential privacy protects aggregate contributions. It does not make a tiny local fleet representative, comparable, or suitable for causal conclusions.'),
            scope,
          ],
          evidence: [],
          provenance: [{ source: provenance }],
        }}
      />
      {!loading && metrics.length === 0 && (
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
    </LayoutCard>
  );
}
