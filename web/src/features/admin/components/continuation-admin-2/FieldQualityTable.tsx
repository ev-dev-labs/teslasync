import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Gauge } from 'lucide-react';
import { LayoutCard } from '@/components/layout';
import { Text, Caption, Badge, DataTable, type Column } from '@/components/ui';
import { SeverityBadge } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError, SectionErrorBoundary } from '@/components/feedback';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import type { DataQualityFieldScore } from '@/types/admin-operator-confidence';
import { coverageTrust, formatCoveragePct, formatDuplicateRatio, formatSeconds, sortFieldsWorstFirst, type CoverageTrust, type SectionState } from '../data-quality/helpers';

const TRUST_VARIANT: Record<CoverageTrust, 'success' | 'warning' | 'danger' | 'neutral'> = {
  complete: 'success', partial: 'warning', none: 'danger', unknown: 'neutral',
};

export function FieldQualityTable({ fields, loading, error, onRetry }: SectionState & { fields: readonly DataQualityFieldScore[] }) {
  const { t } = useTranslation();
  const { fmtInt, fmtNumber, precision, locale } = useNumberFormatting();
  const rows = useMemo(() => sortFieldsWorstFirst(fields), [fields]);
  const columns = useMemo<Column<DataQualityFieldScore>[]>(() => {
    const trustLabel: Record<CoverageTrust, string> = {
      complete: t('admin.dataQuality.trustComplete', 'Fully attested'), partial: t('admin.dataQuality.trustPartial', 'Partially attested'),
      none: t('admin.dataQuality.trustNone', 'Unattested'), unknown: t('admin.dataQuality.trustUnknown', 'Unknown'),
    };
    return [
      { key: 'field', header: t('admin.dataQuality.colField', 'Field'), filterValue: (r) => r.field ?? null,
        render: (r) => <div className="min-w-0"><Text weight="medium" className="break-words">{r.field}</Text>
          <Caption>{t('admin.dataQuality.colFieldSamples', '{{samples}} samples', { samples: fmtInt(r.sample_count) })}</Caption></div> },
      { key: 'severity', header: t('admin.dataQuality.colSeverity', 'Quality'), filterValue: (r) => r.severity ?? null,
        render: (r) => <div className="flex flex-wrap items-center gap-2"><SeverityBadge severity={r.severity} size="sm" /><Text className="tabular-nums" color="secondary">{fmtNumber(r.composite_score)}</Text></div> },
      { key: 'freshness', header: t('admin.dataQuality.colFreshness', 'Freshness'), align: 'right', groupStart: true,
        filterValue: (r) => r.freshness_seconds ?? null, filterValueLabel: (_v, r) => formatSeconds(r.freshness_seconds) ?? '—',
        render: (r) => <Text className="tabular-nums">{formatSeconds(r.freshness_seconds) ?? '—'}</Text> },
      { key: 'gap', header: t('admin.dataQuality.colMaxGap', 'Max gap'), align: 'right',
        filterValue: (r) => r.max_gap_seconds ?? null, filterValueLabel: (_v, r) => formatSeconds(r.max_gap_seconds) ?? '—',
        render: (r) => <Text className="tabular-nums">{formatSeconds(r.max_gap_seconds) ?? '—'}</Text> },
      { key: 'duplicates', header: t('admin.dataQuality.colDuplicates', 'Duplicates'), align: 'right',
        filterValue: (r) => r.duplicate_ratio ?? null, filterValueLabel: (_v, r) => formatDuplicateRatio(r.duplicate_ratio) ?? '—',
        render: (r) => <Text className="tabular-nums">{formatDuplicateRatio(r.duplicate_ratio) ?? '—'}</Text> },
      { key: 'versioned', header: t('admin.dataQuality.colVersioned', 'Attested'), align: 'right', groupStart: true,
        filterValue: (r) => r.versioned_sample_count ?? null, filterValueLabel: (_v, r) => r.versioned_sample_count == null ? '—' : fmtInt(r.versioned_sample_count),
        render: (r) => <Text className="tabular-nums">{r.versioned_sample_count == null ? '—' : fmtInt(r.versioned_sample_count)}</Text> },
      { key: 'unversioned', header: t('admin.dataQuality.colUnversioned', 'Unattested'), align: 'right',
        filterValue: (r) => r.unversioned_sample_count ?? null, filterValueLabel: (_v, r) => r.unversioned_sample_count == null ? '—' : fmtInt(r.unversioned_sample_count),
        render: (r) => <Text className={r.unversioned_sample_count != null && r.unversioned_sample_count > 0 ? 'tabular-nums text-amber-300' : 'tabular-nums'}>{r.unversioned_sample_count == null ? '—' : fmtInt(r.unversioned_sample_count)}</Text> },
      { key: 'coverage', header: t('admin.dataQuality.colCoverage', 'Coverage'), align: 'right',
        filterValue: (r) => r.normalization_coverage_pct ?? null,
        filterValueLabel: (_v, r) => formatCoveragePct(r.normalization_coverage_pct, r.normalization_coverage_state) ?? t('admin.dataQuality.unknown', 'Unknown'),
        render: (r) => { const trust = coverageTrust(r.normalization_coverage_pct, r.normalization_coverage_state);
          return <div className="flex flex-wrap items-center justify-end gap-2"><Text className="tabular-nums">{formatCoveragePct(r.normalization_coverage_pct, r.normalization_coverage_state) ?? t('admin.dataQuality.unknown', 'Unknown')}</Text><Badge variant={TRUST_VARIANT[trust]}>{trustLabel[trust]}</Badge></div>; } },
    ];
  }, [t, fmtInt, fmtNumber, precision, locale]);
  return (
    <LayoutCard title={t('admin.dataQuality.tableTitle', 'Per-field quality and provenance')}
      description={t('admin.dataQuality.tableSubtitle', 'Worst-scoring fields first. Coverage is the share of this field’s rows carrying a normalization version.')}>
      <SectionErrorBoundary name="data-quality-fields">
        {error ? <QueryError error={error} onRetry={onRetry} /> : loading && rows.length === 0 ? <Skeleton height={240} />
          : rows.length === 0 ? <EmptyState icon={<Gauge className="h-8 w-8" />} title={t('admin.dataQuality.fieldsEmptyTitle', 'No field scores')}
            action={{ label: t('common.refresh', 'Refresh'), onClick: onRetry }}
            message={t('admin.dataQuality.fieldsEmptyMessage', 'No signal fields were persisted during this scoring window.')} />
            : <DataTable tableId="admin:data-quality-fields" columns={columns} mobileColumns={['field', 'severity', 'freshness']}
              data={rows} enableValueFilters keyExtractor={(r) => r.field} emptyMessage={t('admin.dataQuality.fieldsEmptyTable', 'No field scores')} />}
      </SectionErrorBoundary>
    </LayoutCard>
  );
}
