/**
 * Data Quality page.
 *
 * Operator view over GET /api/v1/admin/observability/data-quality
 * (internal/api/dataquality/handler.go → internal/dataquality.Scorer). Two
 * bounded aggregates over the same signal_log window are surfaced:
 *
 *   1. Normalization coverage KPI band — total / attested / unattested sample
 *      counts and the attested coverage percentage.
 *   2. Normalization-version distribution — one bucket per
 *      `normalization_version`, legacy/unknown rows kept as their own bucket.
 *   3. Per-field quality table — freshness, largest gap and duplicate ratio
 *      alongside the field's own attested/unattested counts and trust state.
 *
 * Evidence honesty is the point of this page: when the scoring window held no
 * rows, coverage is reported as "Unknown", never as 0 %. A 503 from the
 * endpoint means the signal_log pool was not wired on this deployment and is
 * rendered as an explanatory notice rather than a red error, while every panel
 * stays mounted with its own empty state.
 *
 * The payload is operational (counts, ratios, seconds) — no physical
 * measurement units, so no unit conversion applies.
 */
import { useTranslation } from 'react-i18next';

import { PageLayout } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { DataStateNotice } from '@/components/feedback';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDataQuality } from '@/api/hooks/useOperatorConfidence';
import { isApiError } from '@/lib/resilience';
import { deriveDataState } from '@/api/dataState';
import {
  FieldQualityTable,
  NormalizationCoverageKpis,
  NormalizationVersionPanel,
} from '../components/continuation-admin-2/dataQuality';
import type { DataQualityFieldScore } from '@/types/admin-operator-confidence';

// Stable empty-array reference so the child sections' memoised derives are not
// invalidated on every render before the first successful fetch lands.
const EMPTY_FIELDS: DataQualityFieldScore[] = [];

export default function DataQualityPage() {
  const { t } = useTranslation();
  usePageTitle(t('admin.dataQuality.pageTitle', 'Data quality'));

  const query = useDataQuality();
  const source = deriveDataState(query);
  const subsystemMissing = isApiError(source.fatalError) && source.fatalError.status === 503;

  // When the 503 notice already explains the empty page, suppress the raw
  // query error for the individual sections so they render calm empty states
  // instead of duplicating a "server error" panel three times.
  const sectionError = subsystemMissing ? null : source.fatalError;
  const retry = () => {
    void query.refetch();
  };

  const snapshot = query.data;
  const fields = snapshot?.fields ?? EMPTY_FIELDS;

  return (
    <PageLayout
      title={t('admin.dataQuality.pageTitle', 'Data quality')}
      subtitle={t(
        'admin.dataQuality.subtitle',
        'Per-field signal freshness, gaps and duplicates, with normalization-version provenance for the same bounded window.',
      )}
      query={query}
      dataSources={[{ id: 'data-quality', label: t('admin.dataQuality.pageTitle', 'Data quality'), query }]}
    >
      <div className="space-y-6">
        {subsystemMissing && (
          <DataStateNotice
            state="unsupported"
            title={t('admin.subsystem.unsupportedTitle', 'Feature not supported')}
          >
            {t(
              'admin.dataQuality.notConfigured',
              'The data-quality scorer is not configured on this deployment. Scoring requires the signal_log hypertable connection to be wired.',
            )}
          </DataStateNotice>
        )}

        {/* 1 — Normalization coverage KPI band */}
        <FadeIn>
          <NormalizationCoverageKpis
            normalization={snapshot?.normalization}
            fields={fields}
            windowMins={snapshot?.window_mins}
            windowStart={snapshot?.window_start}
            windowEnd={snapshot?.window_end}
            hasSnapshot={source.hasData}
            retained={source.hasData && (source.status === 'stale' || source.isRefreshing)}
            sourceStatus={source.status}
            loading={query.isLoading && !source.hasData}
            error={sectionError}
            onRetry={retry}
          />
        </FadeIn>

        {/* 2 — Version distribution over the same window */}
        <FadeIn delay={0.1}>
          <NormalizationVersionPanel
            normalization={snapshot?.normalization}
            loading={query.isLoading && !source.hasData}
            error={sectionError}
            onRetry={retry}
          />
        </FadeIn>

        {/* 3 — Per-field quality + provenance breakdown */}
        <FadeIn delay={0.2}>
          <FieldQualityTable
            fields={fields}
            loading={query.isLoading && !source.hasData}
            error={sectionError}
            onRetry={retry}
          />
        </FadeIn>
      </div>
    </PageLayout>
  );
}
