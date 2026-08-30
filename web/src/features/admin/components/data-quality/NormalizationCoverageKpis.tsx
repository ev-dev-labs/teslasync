/**
 * Normalization-coverage KPI band for the Data Quality page.
 *
 * Six operational counters over the bounded scoring window: total samples,
 * version-attested samples, unattested samples, attested coverage, the
 * required contract version, and the count of critical fields. The card model
 * lives in `./coverageKpis` — this file owns only the loading / error / ready
 * rendering so the section never blanks the page.
 *
 * The coverage card is the reason this panel exists: when the backend reports
 * `coverage_state: 'unknown'` (an empty window) it renders an explicit
 * "Unknown" rather than `0.0%`. Showing 0 % for "no rows observed" would
 * invent a failing measurement out of an absence of evidence.
 */
import { useTranslation } from 'react-i18next';

import { GlassPanel } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { Skeleton, QueryError } from '@/components/feedback';
import { useCoverageKpis } from './coverageKpis';
import { type SectionState } from './helpers';
import type {
  DataQualityFieldScore,
  NormalizationSummary,
} from '@/types/admin-operator-confidence';

interface NormalizationCoverageKpisProps extends SectionState {
  normalization: NormalizationSummary | undefined;
  fields: readonly DataQualityFieldScore[];
  windowMins: number | undefined;
}

const GRID = 'grid grid-cols-2 gap-4 lg:grid-cols-3 3xl:grid-cols-6';

export function NormalizationCoverageKpis({
  normalization,
  fields,
  windowMins,
  loading,
  error,
  onRetry,
}: NormalizationCoverageKpisProps) {
  const { t } = useTranslation();
  const kpis = useCoverageKpis(normalization, fields, windowMins, t);

  if (error) {
    return (
      <GlassPanel className="p-4 sm:p-5">
        <QueryError error={error} onRetry={onRetry} />
      </GlassPanel>
    );
  }

  if (loading && !normalization) {
    return (
      <div className={GRID} role="status" aria-busy="true">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} height={88} rounded className="rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <section
      aria-label={t('admin.dataQuality.kpiRegion', 'Normalization coverage totals')}
      className={GRID}
    >
      {kpis.map((k) => (
        <MetricCard
          key={k.key}
          label={k.label}
          value={k.value}
          icon={k.icon}
          color={k.color}
          subtitle={k.subtitle}
        />
      ))}
    </section>
  );
}
