import { Icons } from '@/lib/icons';
import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutCard } from '@/components/layout';
import { Text, Caption, Badge, DataTable, type Column, type MobileDataTablePresentation } from '@/components/ui';
import { SeverityBadge } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError, SectionErrorBoundary } from '@/components/feedback';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { applyColumnLayout, getColumnLayout, readLegacyVisibleLayout } from '@/lib/columnOrderStore';
import { defaultExportFilename, downloadCSV, downloadJSON, toCSV } from '@/lib/csvExport';
import type { DataQualityFieldScore } from '@/types/admin-operator-confidence';
import { coverageTrust, formatCoveragePct, formatDuplicateRatio, formatSeconds, sortFieldsWorstFirst, type CoverageTrust, type SectionState } from '../data-quality/helpers';

const TRUST_VARIANT: Record<CoverageTrust, 'success' | 'warning' | 'danger' | 'neutral'> = {
  complete: 'success', partial: 'warning', none: 'danger', unknown: 'neutral',
};
const TABLE_ID = 'admin:data-quality-fields';

export function FieldQualityTable({ fields, loading, error, onRetry }: SectionState & { fields: readonly DataQualityFieldScore[] }) {
  const { t } = useTranslation();
  const { fmtInt, fmtNumber, precision, locale } = useNumberFormatting();
  const rows = useMemo(() => sortFieldsWorstFirst(fields), [fields]);
  const columns = useMemo<Column<DataQualityFieldScore>[]>(() => {
    const trustLabel: Record<CoverageTrust, string> = {
      complete: t('admin.dataQuality.trustComplete', 'Fully attested'), partial: t('admin.dataQuality.trustPartial', 'Partially attested'),
      none: t('admin.dataQuality.trustNone', 'Unattested'), unknown: t('admin.dataQuality.trustUnknown', 'Unknown'),
    };
    const severityLabel = {
      ok: t('admin.diskForecast.severityOk', 'OK'),
      warn: t('severity.warn', 'Warning'),
      critical: t('severity.critical', 'Critical'),
    };
    const durationUnits = {
      m: t('recentPages.shortMinute', 'm'), h: t('recentPages.shortHour', 'h'), d: t('recentPages.shortDay', 'd'),
    };
    const duration = (seconds: number | null | undefined) => formatSeconds(seconds, durationUnits) ?? '—';
    const coverage = (r: DataQualityFieldScore) => formatCoveragePct(r.normalization_coverage_pct, r.normalization_coverage_state) ?? t('admin.dataQuality.unknown', 'Unknown');
    const trust = (r: DataQualityFieldScore) => trustLabel[coverageTrust(r.normalization_coverage_pct, r.normalization_coverage_state)];
    return [
      { key: 'field', header: t('admin.dataQuality.colField', 'Field'), filterValue: (r) => r.field ?? null,
        exportValue: (r) => `${r.field} ${t('admin.dataQuality.colFieldSamples', '{{samples}} samples', { samples: fmtInt(r.sample_count) })}`,
        render: (r) => <div className="min-w-0"><Text weight="medium" className="break-words">{r.field}</Text>
          <Caption>{t('admin.dataQuality.colFieldSamples', '{{samples}} samples', { samples: fmtInt(r.sample_count) })}</Caption></div> },
      { key: 'severity', header: t('admin.dataQuality.colSeverity', 'Quality'), filterValue: (r) => r.severity ?? null,
        exportValue: (r) => `${severityLabel[r.severity]} ${fmtNumber(r.composite_score)}`,
        render: (r) => <div className="flex flex-wrap items-center gap-2"><SeverityBadge severity={r.severity} size="sm">{severityLabel[r.severity]}</SeverityBadge><Text className="tabular-nums" color="secondary">{fmtNumber(r.composite_score)}</Text></div> },
      { key: 'freshness', header: t('admin.dataQuality.colFreshness', 'Freshness'), align: 'right', groupStart: true,
        exportValue: (r) => duration(r.freshness_seconds),
        filterValue: (r) => r.freshness_seconds ?? null, filterValueLabel: (_v, r) => duration(r.freshness_seconds),
        render: (r) => <Text className="tabular-nums">{duration(r.freshness_seconds)}</Text> },
      { key: 'gap', header: t('admin.dataQuality.colMaxGap', 'Max gap'), align: 'right',
        exportValue: (r) => duration(r.max_gap_seconds),
        filterValue: (r) => r.max_gap_seconds ?? null, filterValueLabel: (_v, r) => duration(r.max_gap_seconds),
        render: (r) => <Text className="tabular-nums">{duration(r.max_gap_seconds)}</Text> },
      { key: 'duplicates', header: t('admin.dataQuality.colDuplicates', 'Duplicates'), align: 'right',
        exportValue: (r) => formatDuplicateRatio(r.duplicate_ratio) ?? '—',
        filterValue: (r) => r.duplicate_ratio ?? null, filterValueLabel: (_v, r) => formatDuplicateRatio(r.duplicate_ratio) ?? '—',
        render: (r) => <Text className="tabular-nums">{formatDuplicateRatio(r.duplicate_ratio) ?? '—'}</Text> },
      { key: 'versioned', header: t('admin.dataQuality.colVersioned', 'Attested'), align: 'right', groupStart: true,
        exportValue: (r) => r.versioned_sample_count == null ? '—' : fmtInt(r.versioned_sample_count),
        filterValue: (r) => r.versioned_sample_count ?? null, filterValueLabel: (_v, r) => r.versioned_sample_count == null ? '—' : fmtInt(r.versioned_sample_count),
        render: (r) => <Text className="tabular-nums">{r.versioned_sample_count == null ? '—' : fmtInt(r.versioned_sample_count)}</Text> },
      { key: 'unversioned', header: t('admin.dataQuality.colUnversioned', 'Unattested'), align: 'right',
        exportValue: (r) => r.unversioned_sample_count == null ? '—' : fmtInt(r.unversioned_sample_count),
        filterValue: (r) => r.unversioned_sample_count ?? null, filterValueLabel: (_v, r) => r.unversioned_sample_count == null ? '—' : fmtInt(r.unversioned_sample_count),
        render: (r) => <Text className={r.unversioned_sample_count != null && r.unversioned_sample_count > 0 ? 'tabular-nums text-amber-300' : 'tabular-nums'}>{r.unversioned_sample_count == null ? '—' : fmtInt(r.unversioned_sample_count)}</Text> },
      { key: 'coverage', header: t('admin.dataQuality.colCoverage', 'Coverage'), align: 'right',
        exportValue: (r) => `${coverage(r)} ${trust(r)}`,
        filterValue: (r) => r.normalization_coverage_pct ?? null,
        filterValueLabel: (_v, r) => formatCoveragePct(r.normalization_coverage_pct, r.normalization_coverage_state) ?? t('admin.dataQuality.unknown', 'Unknown'),
        render: (r) => { const trust = coverageTrust(r.normalization_coverage_pct, r.normalization_coverage_state);
          return <div className="flex flex-wrap items-center justify-end gap-2"><Text className="tabular-nums">{formatCoveragePct(r.normalization_coverage_pct, r.normalization_coverage_state) ?? t('admin.dataQuality.unknown', 'Unknown')}</Text><Badge variant={TRUST_VARIANT[trust]}>{trustLabel[trust]}</Badge></div>; } },
    ];
  }, [t, fmtInt, fmtNumber, precision, locale]);
  const mobilePresentation = useMemo<MobileDataTablePresentation<DataQualityFieldScore>>(() => ({
    roles: { field: 'title', severity: 'badge', freshness: 'primary', gap: 'meta', duplicates: 'meta', coverage: 'meta', versioned: 'hidden', unversioned: 'hidden' },
    displayValue: (row, key) => key === 'field' ? row.field : String(columns.find(column => column.key === key)?.exportValue?.(row) ?? '—'),
  }), [columns]);
  const onExport = useCallback((format: 'csv' | 'json', scopedRows: readonly DataQualityFieldScore[]) => {
    const filename = defaultExportFilename(TABLE_ID);
    if (format === 'json') {
      // Canonical producer fields only: display aliases and rounded values never
      // replace seconds, ratios, counts, scores or nullable provenance.
      downloadJSON(filename, scopedRows.map(row => ({
        field: row.field, sample_count: row.sample_count, last_seen_at: row.last_seen_at,
        freshness_seconds: row.freshness_seconds, max_gap_seconds: row.max_gap_seconds,
        duplicate_ratio: row.duplicate_ratio, versioned_sample_count: row.versioned_sample_count,
        unversioned_sample_count: row.unversioned_sample_count,
        normalization_coverage_pct: row.normalization_coverage_pct,
        normalization_coverage_state: row.normalization_coverage_state,
        composite_score: row.composite_score, severity: row.severity,
      })));
    } else {
      // Reuse the shared saved layout and CSV serializer; DataTable still owns
      // loaded-row search/filter scope, column changes and export actions.
      const layout = getColumnLayout(TABLE_ID) ?? readLegacyVisibleLayout(TABLE_ID, columns.map(column => column.key));
      downloadCSV(filename, toCSV(scopedRows, applyColumnLayout(columns, layout).map(column => ({
        key: column.key, header: column.header, accessor: column.exportValue,
      }))));
    }
  }, [columns]);
  return (
    <LayoutCard title={t('admin.dataQuality.tableTitle', 'Per-field quality and provenance')}
      description={t('admin.dataQuality.tableSubtitle', 'Worst-scoring fields first. Coverage is the share of this field’s rows carrying a normalization version.')}>
      <SectionErrorBoundary name="data-quality-fields">
        {error ? <QueryError error={error} onRetry={onRetry} /> : loading && rows.length === 0 ? <Skeleton height={240} />
          : rows.length === 0 ? <EmptyState icon={<Icons.speed className="h-8 w-8" />} title={t('admin.dataQuality.fieldsEmptyTitle', 'No field scores')}
            action={{ label: t('common.refresh', 'Refresh'), onClick: onRetry }}
            message={t('admin.dataQuality.fieldsEmptyMessage', 'No signal fields were persisted during this scoring window.')} />
            : <DataTable tableId={TABLE_ID} caption={t('admin.dataQuality.tableTitle', 'Per-field quality and provenance')}
              variant="embedded" columns={columns} mobileColumns={['field', 'severity', 'freshness']} mobilePresentation={mobilePresentation}
              data={rows} enableValueFilters onExport={onExport} keyExtractor={(r) => r.field} rowLabel={(r) => r.field}
              emptyMessage={t('admin.dataQuality.fieldsEmptyTable', 'No field scores')} />}
      </SectionErrorBoundary>
    </LayoutCard>
  );
}
