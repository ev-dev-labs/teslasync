import { useTranslation } from 'react-i18next';
import { OperationalBrief, type StatMetric, type StatPeriod } from '@/components/data-display';
import { Badge, Text } from '@/components/ui';
import type { DataState } from '@/api/dataState';
import type { ConnectionPool, DBStats, MigrationStatus } from '@/types/admin';
import type { MetricDisplayOptions } from '@/lib/metric-reference';
import { fmtNumber } from '@/lib/numberFormat';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { sourceBriefStatus } from '@/features/admin/components/statstrip-api-quality/sourceBriefStatus';

const databaseSizeDisplay: NonNullable<MetricDisplayOptions['formatter']> = (raw, preferences) => {
  const scale = raw < 1024 ? 1 : raw < 1024 ** 2 ? 1024 : raw < 1024 ** 3 ? 1024 ** 2 : 1024 ** 3;
  const unit = scale === 1 ? 'B' : scale === 1024 ? 'KB' : scale === 1024 ** 2 ? 'MB' : 'GB';
  return { value: fmtNumber(raw / scale, preferences.units.precision, preferences.units.locale), unit };
};

interface Props {
  stats: DataState<DBStats>;
  migration: DataState<MigrationStatus>;
  pool: DataState<ConnectionPool>;
  statsLoading: boolean;
  migrationLoading: boolean;
  poolLoading: boolean;
  sizeBytes: number | null;
  totalRows: number | null;
  largeTables: number | null;
  migrationVersion: unknown;
  migrationDirty: boolean | null;
  poolUsage: number | null;
}

export function DBHealthSummary(props: Props) {
  const { t } = useTranslation();
  const sources = [props.stats, props.migration, props.pool];
  const labels = [
    t('dataSources.labels.databaseStatistics', 'Database statistics'),
    t('dataSources.labels.migrationStatus', 'Migration status'),
    t('dataSources.labels.connectionPool', 'Connection pool'),
  ];
  const periods: Extract<StatPeriod, { kind: 'snapshot' }>[] = sources.map((state, index) => ({
    kind: 'snapshot', observedAt: state.updatedAt == null ? null : new Date(state.updatedAt).toISOString(),
    label: t('dbHealth.summary.snapshot', '{{source}} snapshot', { source: labels[index] }),
    provenance: state.updatedAt == null
      ? t('dbHealth.summary.unknownObservation', 'Last successful fetch time unknown; this source is independent of the other database sources.')
      : t('dbHealth.summary.observed', 'Last successful fetch: {{time}}. This source is independent of the other database sources.',
        { time: new Date(state.updatedAt).toISOString() }),
  }));
  const storage: StatMetric[] = [
    { metricId: 'bytes', occurrenceId: 'db-total-size', rawValue: props.sizeBytes,
      display: { formatter: databaseSizeDisplay },
      label: t('dbHealth.totalSize', 'Total DB size'), description: t('dbHealth.totalSize', 'Total DB size') },
    { metricId: 'count', occurrenceId: 'db-table-count', rawValue: props.stats.data?.tables?.length,
      label: t('dbHealth.tables', 'Tables'), description: t('dbHealth.tables', 'Tables') },
    { metricId: 'count', occurrenceId: 'db-row-count', rawValue: props.totalRows,
      label: t('dbHealth.totalRows', 'Total rows'), description: t('dbHealth.totalRows', 'Total rows') },
    { metricId: 'count', occurrenceId: 'db-large-tables', rawValue: props.largeTables,
      label: t('dbHealth.largeTables', 'Large tables'), description: t('dbHealth.largeTablesHint', '> 100 MB'),
      context: t('dbHealth.largeTablesHint', '> 100 MB') },
  ];
  const migration: StatMetric[] = [{
    metricId: 'text', occurrenceId: 'db-migration-version',
    rawValue: props.migration.hasData && props.migrationVersion !== '—' ? String(props.migrationVersion) : null,
    label: t('dbHealth.migration', 'Migration'), description: t('dbHealth.migration', 'Migration'),
    context: props.migrationDirty == null ? undefined : <Badge variant={props.migrationDirty ? 'danger' : 'success'}>
      {props.migrationDirty ? t('dbHealth.dirtyShort', 'Dirty') : t('dbHealth.cleanShort', 'Clean')}
    </Badge>,
  }];
  const pool: StatMetric[] = [{
    metricId: 'percent', occurrenceId: 'db-pool-usage', rawValue: props.poolUsage,
    label: t('dbHealth.poolUsage', 'Pool usage'), description: t('dbHealth.poolUsage', 'Pool usage'),
    context: props.poolUsage != null && props.poolUsage >= 80
      ? <Badge variant="danger">{t('dbHealth.summary.busyPool', 'Pool usage ≥ 80%')}</Badge> : undefined,
  }];
  const banks = [storage, migration, pool];
  const briefBanks = [useOperationalMetrics(storage), useOperationalMetrics(migration), useOperationalMetrics(pool)];
  const loading = [props.statsLoading, props.migrationLoading, props.poolLoading];
  return <section aria-label={t('dbHealth.kpis', 'Summary metrics')} className="space-y-3">
    {banks.map((_metrics, index) => <div key={index}>
      {sources[index].hasData && (sources[index].status === 'stale' || sources[index].isRefreshing)
        && <Text role="status">{t('developerReference.stats.state.retained', 'Showing retained measurements')}</Text>}
      {(sources[index].fatalError ?? sources[index].refreshError)
        && <Text role="alert">{(sources[index].fatalError ?? sources[index].refreshError)?.message}</Text>}
      <OperationalBrief testId={`db-health-summary-${index}`} compact
        eyebrow={t('dbHealth.title', 'DB health')} title={labels[index]}
        description={periods[index].provenance}
        scope={<Text as="span" variant="caption">{periods[index].label}</Text>}
        metrics={briefBanks[index]} {...sourceBriefStatus(sources[index], loading[index] && !sources[index].hasData, t)}
        loading={loading[index] && !sources[index].hasData} />
    </div>)}
  </section>;
}
