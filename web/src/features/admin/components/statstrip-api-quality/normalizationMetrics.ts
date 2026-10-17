import type { StatMetric } from '@/components/data-display';
import type { DataQualityFieldScore, NormalizationSummary } from '@/types/admin-operator-confidence';

interface Labels {
  readonly key: string;
  readonly label: string;
  readonly subtitle: string;
}

export function normalizationMetrics(
  normalization: NormalizationSummary | undefined,
  fields: readonly DataQualityFieldScore[],
  hasSnapshot: boolean,
  labels: readonly Labels[],
  unknown: string,
): StatMetric[] {
  const coverage = normalization?.total_sample_count === 0 || normalization?.coverage_state === 'unknown'
    || normalization?.coverage_pct == null || !Number.isFinite(normalization.coverage_pct)
    ? null : normalization.coverage_pct;
  const values: Record<string, number | string | null | undefined> = {
    total: normalization?.total_sample_count,
    versioned: normalization?.versioned_sample_count,
    unversioned: normalization?.unversioned_sample_count,
    coverage,
    required: normalization?.required_version ?? unknown,
    critical: hasSnapshot ? fields.filter(field => field.severity === 'critical').length : null,
  };
  return labels.map(kpi => ({
    metricId: kpi.key === 'coverage' ? 'percent' : kpi.key === 'required'
      ? normalization?.required_version == null ? 'text' : 'identifier' : 'count',
    occurrenceId: `normalization-${kpi.key}`,
    rawValue: values[kpi.key],
    label: kpi.label,
    description: kpi.subtitle,
    display: kpi.key === 'required' && normalization?.required_version != null
      ? { identifierPrefix: 'v' } : undefined,
    missingReason: kpi.key === 'coverage' && coverage == null ? unknown : undefined,
    context: kpi.subtitle,
  }));
}
