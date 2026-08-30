/**
 * Per-field quality table for the Data Quality page.
 *
 * One row per signal_log `field` observed in the bounded window, worst-first by
 * composite score. Columns pair the three quality axes the scorer measures
 * (freshness, largest gap, duplicate ratio) with the normalization provenance
 * evidence for the same field (attested / unattested counts and coverage).
 *
 * Every optional numeric renders an explicit em-dash when the backend could not
 * measure it, so "unknown" is never displayed as a confident zero.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Gauge } from 'lucide-react';

import { GlassPanel, PanelTitle, Caption, Text, Badge, DataTable, type Column } from '@/components/ui';
import { SeverityBadge } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError, SectionErrorBoundary } from '@/components/feedback';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import {
  coverageTrust,
  formatCoveragePct,
  formatDuplicateRatio,
  formatSeconds,
  sortFieldsWorstFirst,
  type CoverageTrust,
  type SectionState,
} from './helpers';
import type { DataQualityFieldScore } from '@/types/admin-operator-confidence';

interface FieldQualityTableProps extends SectionState {
  fields: readonly DataQualityFieldScore[];
}

const TRUST_VARIANT: Record<CoverageTrust, 'success' | 'warning' | 'danger' | 'neutral'> = {
  complete: 'success',
  partial: 'warning',
  none: 'danger',
  unknown: 'neutral',
};

const NO_VALUE = '—';

export function FieldQualityTable({ fields, loading, error, onRetry }: FieldQualityTableProps) {
  const { t } = useTranslation();

  const rows = useMemo(() => sortFieldsWorstFirst(fields), [fields]);

  const trustLabel = useMemo<Record<CoverageTrust, string>>(
    () => ({
      complete: t('admin.dataQuality.trustComplete', 'Fully attested'),
      partial: t('admin.dataQuality.trustPartial', 'Partially attested'),
      none: t('admin.dataQuality.trustNone', 'Unattested'),
      unknown: t('admin.dataQuality.trustUnknown', 'Unknown'),
    }),
    [t],
  );

  const columns = useMemo<Column<DataQualityFieldScore>[]>(
    () => [
      {
        key: 'field',
        header: t('admin.dataQuality.colField', 'Field'),
        render: (r) => (
          <div className="flex flex-col">
            <Text weight="medium" color="primary">
              {r.field}
            </Text>
            <Caption>
              {t('admin.dataQuality.colFieldSamples', '{{samples}} samples', {
                samples: fmtInt(r.sample_count),
              })}
            </Caption>
          </div>
        ),
      },
      {
        key: 'severity',
        header: t('admin.dataQuality.colSeverity', 'Quality'),
        render: (r) => (
          <div className="flex items-center gap-2">
            <SeverityBadge severity={r.severity} size="sm" />
            <Text className="tabular-nums" color="secondary">
              {fmtNumber(r.composite_score, 0)}
            </Text>
          </div>
        ),
      },
      {
        key: 'freshness',
        header: t('admin.dataQuality.colFreshness', 'Freshness'),
        align: 'right',
        render: (r) => (
          <Text className="tabular-nums">{formatSeconds(r.freshness_seconds) ?? NO_VALUE}</Text>
        ),
      },
      {
        key: 'gap',
        header: t('admin.dataQuality.colMaxGap', 'Max gap'),
        align: 'right',
        render: (r) => (
          <Text className="tabular-nums">{formatSeconds(r.max_gap_seconds) ?? NO_VALUE}</Text>
        ),
      },
      {
        key: 'duplicates',
        header: t('admin.dataQuality.colDuplicates', 'Duplicates'),
        align: 'right',
        render: (r) => (
          <Text className="tabular-nums">{formatDuplicateRatio(r.duplicate_ratio) ?? NO_VALUE}</Text>
        ),
      },
      {
        key: 'versioned',
        header: t('admin.dataQuality.colVersioned', 'Attested'),
        align: 'right',
        render: (r) => <Text className="tabular-nums">{fmtInt(r.versioned_sample_count)}</Text>,
      },
      {
        key: 'unversioned',
        header: t('admin.dataQuality.colUnversioned', 'Unattested'),
        align: 'right',
        render: (r) => {
          const unversioned = r.unversioned_sample_count ?? 0;
          const cls =
            unversioned > 0
              ? 'tabular-nums text-amber-300'
              : 'tabular-nums text-[var(--text-secondary)]';
          return <Text className={cls}>{fmtInt(unversioned)}</Text>;
        },
      },
      {
        key: 'coverage',
        header: t('admin.dataQuality.colCoverage', 'Coverage'),
        align: 'right',
        render: (r) => {
          const trust = coverageTrust(
            r.normalization_coverage_pct,
            r.normalization_coverage_state,
          );
          const pct = formatCoveragePct(
            r.normalization_coverage_pct,
            r.normalization_coverage_state,
          );
          return (
            <div className="flex items-center justify-end gap-2">
              <Text className="tabular-nums">
                {pct ?? t('admin.dataQuality.unknown', 'Unknown')}
              </Text>
              <Badge variant={TRUST_VARIANT[trust]}>{trustLabel[trust]}</Badge>
            </div>
          );
        },
      },
    ],
    [t, trustLabel],
  );

  return (
    <GlassPanel className="p-4 sm:p-5">
      <PanelTitle className="mb-1">
        {t('admin.dataQuality.tableTitle', 'Per-field quality and provenance')}
      </PanelTitle>
      <Caption className="mb-3 block">
        {t(
          'admin.dataQuality.tableSubtitle',
          'Worst-scoring fields first. Coverage is the share of this field’s rows carrying a normalization version.',
        )}
      </Caption>
      <SectionErrorBoundary name="data-quality-fields">
        {error ? (
          <QueryError error={error} onRetry={onRetry} />
        ) : loading && rows.length === 0 ? (
          <Skeleton height={240} />
        ) : rows.length === 0 ? (
          // no-action: fields populate this view by ingesting telemetry; not a user-actionable surface
          <EmptyState
            icon={<Gauge className="h-8 w-8" />}
            title={t('admin.dataQuality.fieldsEmptyTitle', 'No field scores')}
            message={t(
              'admin.dataQuality.fieldsEmptyMessage',
              'No signal fields were persisted during this scoring window.',
            )}
          />
        ) : (
          <DataTable
            tableId="admin:data-quality-fields"
            columns={columns}
            data={rows}
            keyExtractor={(r) => r.field}
            emptyMessage={t('admin.dataQuality.fieldsEmptyTable', 'No field scores')}
          />
        )}
      </SectionErrorBoundary>
    </GlassPanel>
  );
}
