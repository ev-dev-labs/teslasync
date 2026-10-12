import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Table2, AlertTriangle,
  RefreshCw, ArrowUpDown, CheckCircle2, XCircle, ListChecks, Server,
} from 'lucide-react';
import { PageLayout } from '@/components/layout';
import {
  GlassPanel, Button, DataTable, PanelTitle, Caption, Label, Text, Icon,
  type Column, type MobileDataTablePresentation,
} from '@/components/ui';
import { MetricBar, TimeStamp } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { Skeleton, EmptyState, QueryError, StaleRefreshWarning } from '@/components/feedback';
import {
  ChartContainer, BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip,
  ChartTooltip, axisTick, CHART_COLORS,
} from '@/components/charts';
import { useDBStats, useMigrations, useConnectionPool } from '@/api/hooks/useAdmin';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDataState } from '@/hooks/useDataState';

import { cn } from '@/lib/cn';
import { neonColorMap, typography } from '@/lib/tokens';
import type { TableInfo } from '@/types/admin';
import { VisuallyHidden } from '@/components/a11y';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { DBHealthSummary } from '../components/statstrip-db-health/DBHealthSummary';

const LARGE_TABLE_THRESHOLD = 100 * 1024 * 1024; // 100MB

type SortKey = 'size' | 'rows' | 'name';

export default function DBHealthPage() {
  const { fmtInt, fmtNumber, formatBytes } = useNumberFormatting();
  const { t } = useTranslation();
  usePageTitle(t('dbHealth.title', 'DB health'));
  const [sortKey, setSortKey] = useState<SortKey>('size');

  const statsQuery = useDBStats();
  const migrationQuery = useMigrations();
  const poolQuery = useConnectionPool();
  const statsState = useDataState(statsQuery);
  const migrationState = useDataState(migrationQuery);
  const poolState = useDataState(poolQuery);
  const dataSources = useMemo(
    () => [
      {
        id: 'database-statistics',
        label: t('dataSources.labels.databaseStatistics', 'Database statistics'),
        query: statsQuery,
      },
      {
        id: 'migration-status',
        label: t('dataSources.labels.migrationStatus', 'Migration status'),
        query: migrationQuery,
      },
      {
        id: 'connection-pool',
        label: t('dataSources.labels.connectionPool', 'Connection pool'),
        query: poolQuery,
      },
    ],
    [migrationQuery, poolQuery, statsQuery, t],
  );

  const {
    data: dbStats, isLoading: statsLoading, isFetching: statsFetching,
    refetch: refetchStats,
  } = statsQuery;
  const {
    data: migrationData, isLoading: migrationLoading,
    refetch: refetchMigration,
  } = migrationQuery;
  const {
    data: poolData, isLoading: poolLoading,
    refetch: refetchPool,
  } = poolQuery;
  const statsError = statsState.fatalError;
  const migrationError = migrationState.fatalError;
  const poolError = poolState.fatalError;
  const isRefreshing = statsFetching || migrationQuery.isFetching || poolQuery.isFetching;
  const tableSizeLabel = useCallback((bytes: number | null | undefined) => {
    if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '—';
    return bytes < 1024 ? `${fmtNumber(bytes)} B` : formatBytes(bytes);
  }, [fmtNumber, formatBytes]);

  const refreshAll = () => {
    refetchStats();
    refetchMigration();
    refetchPool();
  };

  const tables: TableInfo[] = dbStats?.tables ?? [];

  const sortedTables = useMemo(() => {
    const sorted = [...tables];
    sorted.sort((a, b) => {
      if (sortKey === 'size') {
        const aSize = a.sizeBytes != null && Number.isFinite(a.sizeBytes) && a.sizeBytes >= 0 ? a.sizeBytes : null;
        const bSize = b.sizeBytes != null && Number.isFinite(b.sizeBytes) && b.sizeBytes >= 0 ? b.sizeBytes : null;
        return aSize == null ? (bSize == null ? 0 : 1) : bSize == null ? -1 : bSize - aSize;
      }
      if (sortKey === 'rows') return (b.rowCount ?? 0) - (a.rowCount ?? 0);
      return (a.name ?? '').localeCompare(b.name ?? '');
    });
    return sorted;
  }, [tables, sortKey]);

  // Chart data — always sorted by row count, independent of table sort
  const chartData = useMemo(
    () =>
      [...tables]
        .sort((a, b) => (b.rowCount ?? 0) - (a.rowCount ?? 0))
        .slice(0, 15)
        .map((tbl) => ({
          name: tbl.name,
          rows: tbl.rowCount != null && Number.isFinite(tbl.rowCount) ? tbl.rowCount : null,
        })),
    [tables],
  );

  // Backend returns {version, dirty} — handle both field names
  const migrationVersion =
    (migrationData as Record<string, unknown> | undefined)?.version ??
    migrationData?.currentVersion ??
    '—';
  const migrationDirty = typeof migrationData?.dirty === 'boolean' ? migrationData.dirty : null;
  const migrationPending = migrationData?.pending ?? null;
  const migrations = migrationData?.migrations ?? [];

  const pool = poolData;
  const poolUsage =
    pool?.maxOpen != null && Number.isFinite(pool.maxOpen) && pool.maxOpen > 0 &&
    pool.inUse != null && Number.isFinite(pool.inUse)
      ? Math.min(Math.max((pool.inUse / pool.maxOpen) * 100, 0), 100)
      : null;

  const totalRows = useMemo(
    () => dbStats?.tables != null && tables.every((tbl) => tbl.rowCount != null && Number.isFinite(tbl.rowCount))
      ? tables.reduce((sum, tbl) => sum + tbl.rowCount, 0)
      : null,
    [dbStats?.tables, tables],
  );
  const largeTables = dbStats?.tables != null && tables.every((tbl) => tbl.sizeBytes != null && Number.isFinite(tbl.sizeBytes))
    ? tables.filter((tbl) => tbl.sizeBytes > LARGE_TABLE_THRESHOLD).length
    : null;

  const dbSizeBytes = dbStats?.databaseSize != null && String(dbStats.databaseSize).trim() !== ''
    ? Number(dbStats.databaseSize) : null;

  const tableColumns: Column<TableInfo>[] = useMemo(
    () => [
      {
        key: 'name',
        filterValue: (tbl) => tbl.name ?? null,
        header: t('dbHealth.table.name', 'Hypertable'),
        render: (tbl: TableInfo) => {
          const isLarge = (tbl.sizeBytes ?? 0) > LARGE_TABLE_THRESHOLD;
          return (
            <div className="flex items-center gap-2">
              {isLarge && (
                <Icon icon={AlertTriangle} size="xs" className={neonColorMap.amber.text} />
              )}
              <Text
                mono
                className={cn(isLarge ? neonColorMap.amber.text : typography.color.primary)}
              >
                {tbl.name}
              </Text>
            </div>
          );
        },
      },
      {
        key: 'rows',
        filterValue: (tbl) => tbl.rowCount ?? null,
        filterValueLabel: (_value, tbl) => tbl.rowCount == null ? '—' : fmtInt(tbl.rowCount),
        align: 'right',
        groupStart: true,
        header: t('dbHealth.table.rows', 'Rows'),
        render: (tbl: TableInfo) => (
          <Text mono color="secondary">{tbl.rowCount != null ? fmtInt(tbl.rowCount) : '—'}</Text>
        ),
        className: 'text-right',
      },
      {
        key: 'size',
        filterValue: (tbl) => tbl.sizeBytes ?? null,
        filterValueLabel: (_value, tbl) => tableSizeLabel(tbl.sizeBytes),
        align: 'right',
        header: t('dbHealth.table.size', 'Size'),
        render: (tbl: TableInfo) => (
          <Text mono color="secondary">
            {tableSizeLabel(tbl.sizeBytes)}
          </Text>
        ),
        className: 'text-right',
      },
      {
        key: 'indexes',
        filterValue: (tbl) => tbl.indexCount ?? null,
        align: 'right',
        header: t('dbHealth.table.indexes', 'Indexes'),
        render: (tbl: TableInfo) => (
          <Text mono color="muted">{tbl.indexCount ?? '—'}</Text>
        ),
        className: 'text-right',
      },
      {
        key: 'vacuum',
        filterValue: (tbl) => tbl.lastVacuum ?? null,
        header: t('dbHealth.table.lastVacuum', 'Last vacuum'),
        render: (tbl: TableInfo) => (
          <TimeStamp value={tbl.lastVacuum ?? null} className="text-[var(--text-muted)] whitespace-nowrap" />
        ),
        className: 'text-right',
      },
    ],
    [t, fmtInt, tableSizeLabel],
  );

  const mobilePresentation: MobileDataTablePresentation<TableInfo> = useMemo(() => ({
    roles: { name: 'title', size: 'primary', rows: 'meta', indexes: 'meta', vacuum: 'hidden' },
    displayValue: (tbl, key) => {
      if (key === 'name') return tbl.name;
      if (key === 'size') return tableSizeLabel(tbl.sizeBytes);
      if (key === 'rows') return tbl.rowCount != null ? fmtInt(tbl.rowCount) : '—';
      if (key === 'indexes') return tbl.indexCount != null ? fmtInt(tbl.indexCount) : '—';
      return tbl.lastVacuum ?? '—';
    },
  }), [fmtInt, tableSizeLabel]);

  const sortOptions: SortKey[] = ['size', 'rows', 'name'];
  const sortLabel: Record<SortKey, string> = {
    size: t('dbHealth.sort.size', 'Size'),
    rows: t('dbHealth.sort.rows', 'Rows'),
    name: t('dbHealth.sort.name', 'Name'),
  };

  const actions = (
    <div className="flex items-center gap-2">
      <Button
        variant="ghost"
        size="sm"
        className="min-h-11 min-w-11 md:min-h-9 md:min-w-9"
        onClick={refreshAll}
        aria-busy={isRefreshing}
        aria-label={t('dbHealth.refresh', 'Refresh now')}
      >
        <Icon icon={RefreshCw} />
      </Button>
    </div>
  );

  return (
    <PageLayout
      title={t('dbHealth.title', 'DB health dashboard')}
      subtitle={t('dbHealth.subtitle', 'Database health metrics and table statistics')}
      metadataActions={
        <Caption className="flex items-center gap-1.5">
          <Icon
            icon={RefreshCw}
            size="sm"
            className={cn(isRefreshing && 'animate-spin motion-reduce:animate-none')}
          />
          {t('common.refresh', 'Refresh')}
        </Caption>
      }
      secondaryActions={actions}
      query={[statsQuery, migrationQuery, poolQuery]}
      dataSources={dataSources}
    >
      {/* 1 — KPI band: full-width responsive metric grid */}
      <FadeIn>
        <DBHealthSummary stats={statsState} migration={migrationState} pool={poolState}
          statsLoading={statsLoading} migrationLoading={migrationLoading} poolLoading={poolLoading}
          sizeBytes={dbSizeBytes} totalRows={totalRows} largeTables={largeTables}
          migrationVersion={migrationVersion} migrationDirty={migrationDirty} poolUsage={poolUsage} />
      </FadeIn>

      {/* 2 — Primary bento: table row-count chart + migration status */}
      <FadeIn delay={0.1}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <VisuallyHidden as="h2">
            {t('dbHealth.section.storage', 'Storage and migrations')}
          </VisuallyHidden>

          {/* Top-15 table row counts (spans 2 of 3 columns on wide screens) */}
          <div className="xl:col-span-2">
            <StaleRefreshWarning state={statsState} label={t('dbHealth.rows', 'Rows')} />
            {statsError ? (
              <GlassPanel className="p-4 sm:p-5">
                <PanelTitle className="mb-3">
                  {t('dbHealth.rows', 'Rows')}
                </PanelTitle>
                <QueryError error={statsError} onRetry={() => refetchStats()} />
              </GlassPanel>
            ) : (
              <ChartContainer
                title={t('dbHealth.rows', 'Rows')}
                ariaLabel={t('dbHealth.rows', 'Rows')}
                data={chartData.map((r) => ({ name: r.name, rows: r.rows }))}
                dataColumns={[
                  { key: 'name', label: t('dbHealth.col.table', 'Hypertable') },
                  { key: 'rows', label: t('dbHealth.col.rows', 'Rows') },
                ]}
                loading={statsLoading}
                empty={!statsLoading && chartData.length === 0}
                height={340}
              >
                <ResponsiveContainer width="100%" height={340}>
                  <BarChart data={chartData} layout="vertical" margin={{ left: 10 }}>
                    <XAxis
                      type="number"
                      tick={axisTick}
                      tickFormatter={(v: number) => fmtNumber(v)}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      tick={axisTick}
                      width={140}
                      tickFormatter={(name: string) => name.length > 20 ? `${name.slice(0, 18)}…` : name}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar
                      dataKey="rows"
                      name={t('dbHealth.rows', 'Rows')}
                      fill={CHART_COLORS[0]}
                      radius={[0, 4, 4, 0]}
                      barSize={16}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
            )}
          </div>

          {/* Migration status */}
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-4 flex items-center gap-2">
              <Icon icon={ListChecks} className={typography.color.muted} />
              {t('dbHealth.migrationTitle', 'Migration status')}
            </PanelTitle>
            <StaleRefreshWarning state={migrationState} label={t('dbHealth.migrationTitle', 'Migration status')} />
            {migrationLoading ? (
              <Skeleton height={180} />
            ) : migrationError ? (
              <QueryError error={migrationError} onRetry={() => refetchMigration()} />
            ) : migrationData ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Caption>
                    {t('dbHealth.currentVersion', 'Current version')}
                  </Caption>
                  <Text mono size="sm" weight="bold" color="primary">
                    {String(migrationVersion)}
                  </Text>
                </div>
                <div className="flex items-center justify-between">
                  <Caption>
                    {t('dbHealth.status', 'Status')}
                  </Caption>
                  <Text
                    size="xs"
                    weight="medium"
                    className={cn(
                      'inline-flex items-center gap-1.5',
                      migrationDirty == null ? typography.color.muted : migrationDirty ? neonColorMap.red.text : neonColorMap.green.text,
                    )}
                  >
                    {migrationDirty == null ? null : migrationDirty ? (
                      <Icon icon={XCircle} size="sm" />
                    ) : (
                      <Icon icon={CheckCircle2} size="sm" />
                    )}
                    {migrationDirty == null ? '—' : migrationDirty
                      ? t('dbHealth.dirty', 'Dirty')
                      : t('dbHealth.clean', 'Clean')}
                  </Text>
                </div>
                {migrationPending != null && migrationPending > 0 && (
                  <div className="flex items-center justify-between">
                    <Caption>
                      {t('dbHealth.pending', 'Pending')}
                    </Caption>
                    <Text size="xs" weight="medium" className={neonColorMap.amber.text}>
                      {fmtInt(migrationPending)}
                    </Text>
                  </div>
                )}
                <div className="mt-3 border-t border-[var(--border-subtle)] pt-3">
                  <Label className="mb-2 block">
                    {t('dbHealth.recentMigrations', 'Recent migrations')}
                  </Label>
                  {migrations.length > 0 ? (
                    <ul className="max-h-44 space-y-1.5 overflow-auto">
                      {migrations
                        .slice(-5)
                        .reverse()
                        .map((m) => (
                          <li
                            key={m.version}
                            className="flex items-center justify-between"
                          >
                            <Text mono size="xs" color="secondary" className="mr-2 truncate">
                              v{m.version} {m.name}
                            </Text>
                            {m.appliedAt && (
                              <TimeStamp
                                value={m.appliedAt}
                                className={cn('shrink-0', typography.size['2xs'], typography.color.muted)}
                              />
                            )}
                          </li>
                        ))}
                    </ul>
                  ) : (
                    <EmptyState /* no-action: transient — no migration history recorded yet */
                      message={t('dbHealth.noMigrations', 'No migration history available')}
                    />
                  )}
                </div>
              </div>
            ) : (
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                message={t('dbHealth.noMigrationData', 'Migration data unavailable')}
              />
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* 3 — Detail bento: tables list + connection pool */}
      <FadeIn delay={0.2}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <VisuallyHidden as="h2">
            {t('dbHealth.section.runtime', 'Tables and runtime')}
          </VisuallyHidden>

          {/* Tables list (spans 2 of 3 columns on wide screens) */}
          <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <PanelTitle className="flex items-center gap-2">
                <Icon icon={Table2} className={typography.color.muted} />
                {t('dbHealth.tablesTitle', 'Tables')}
              </PanelTitle>
              <div
                className="flex flex-wrap items-center gap-2"
                role="group"
                aria-label={t('dbHealth.sortBy', 'Sort tables by')}
              >
                <Icon icon={ArrowUpDown} size="sm" className={typography.color.muted} />
                {sortOptions.map((key) => (
                  <Button
                    key={key}
                    onClick={() => setSortKey(key)}
                    variant={sortKey === key ? 'primary' : 'secondary'}
                    size="sm"
                    className="min-h-11 min-w-11 md:min-h-9 md:min-w-0"
                    wrapLabel
                    aria-pressed={sortKey === key}
                  >
                    {sortLabel[key]}
                  </Button>
                ))}
              </div>
            </div>

            {statsError ? (
              <QueryError error={statsError} onRetry={() => refetchStats()} />
            ) : statsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} height={40} />
                ))}
              </div>
            ) : (
              <DataTable<TableInfo>
                tableId="system:db-health-tables"
                caption={t('dbHealth.tablesTitle', 'Tables')}
                columns={tableColumns}
                mobileColumns={['name', 'size', 'rows']}
                mobilePresentation={mobilePresentation}
                data={sortedTables}
                enableValueFilters
                keyExtractor={(tbl) => tbl.name}
                compact
                pagination
                emptyMessage={t('dbHealth.noTables', 'No tables found')}
                className="max-h-[55vh] overflow-auto"
              />
            )}
          </GlassPanel>

          {/* Connection pool */}
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-4 flex items-center gap-2">
              <Icon icon={Server} className={typography.color.muted} />
              {t('dbHealth.poolTitle', 'Connection pool')}
            </PanelTitle>
            <StaleRefreshWarning state={poolState} label={t('dbHealth.poolTitle', 'Connection pool')} />
            {poolLoading ? (
              <Skeleton height={200} />
            ) : poolError ? (
              <QueryError error={poolError} onRetry={() => refetchPool()} />
            ) : pool?.maxOpen != null ? (
              <div className="space-y-3">
                {[
                  { label: t('dbHealth.pool.maxOpen', 'Max open'), value: fmtInt(pool.maxOpen) },
                  { label: t('dbHealth.pool.open', 'Open'), value: pool.open != null ? fmtInt(pool.open) : '—' },
                  { label: t('dbHealth.pool.inUse', 'In use'), value: pool.inUse != null ? fmtInt(pool.inUse) : '—' },
                  { label: t('dbHealth.pool.idle', 'Idle'), value: pool.idle != null ? fmtInt(pool.idle) : '—' },
                  { label: t('dbHealth.pool.waitCount', 'Wait count'), value: pool.waitCount != null ? fmtInt(pool.waitCount) : '—' },
                  {
                    label: t('dbHealth.pool.waitDuration', 'Wait duration'),
                    value: pool.waitDurationMs != null ? `${fmtNumber(pool.waitDurationMs)}ms` : '—',
                  },
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-between">
                    <Caption>{item.label}</Caption>
                    <Text mono size="sm" color="primary">
                      {item.value}
                    </Text>
                  </div>
                ))}
                {/* Usage bar */}
                <div className="mt-2">
                  <div className="mb-1 flex justify-between">
                    <Text size="2xs" color="muted">{t('dbHealth.poolUsage', 'Pool usage')}</Text>
                    <Text size="2xs" color="muted">{poolUsage != null ? `${fmtNumber(poolUsage)}%` : '—'}</Text>
                  </div>
                  <MetricBar
                    value={poolUsage}
                    max={100}
                    ariaLabel={t('dbHealth.poolUsage', 'Pool usage')}
                    color={poolUsage == null ? 'var(--text-muted)' : poolUsage >= 80 ? 'var(--semantic-danger)' : 'var(--semantic-info)'}
                    showHeader={false}
                    size="slim"
                    fill="solid"
                  />
                </div>
              </div>
            ) : (
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                message={t('dbHealth.noPoolData', 'Connection pool data unavailable')}
              />
            )}
          </GlassPanel>
        </section>
      </FadeIn>
    </PageLayout>
  );
}
