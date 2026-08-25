import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Database, Table2, Layers, AlertTriangle, GitCommitHorizontal, Gauge,
  RefreshCw, ArrowUpDown, CheckCircle2, XCircle, ListChecks, Server,
} from 'lucide-react';
import { PageContainer } from '@/components/layout';
import {
  GlassPanel, Button, DataTable, PanelTitle, Caption, Label, Text, type Column,
} from '@/components/ui';
import { MetricCard, TimeStamp } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import {
  ChartContainer, BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip,
  ChartTooltip, axisTick, CHART_COLORS,
} from '@/components/charts';
import { useDBStats, useMigrations, useConnectionPool } from '@/api/hooks/useAdmin';
import { usePageTitle } from '@/hooks/usePageTitle';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import { typography, type NeonColor } from '@/lib/tokens';
import type { TableInfo } from '@/types/admin';
import { VisuallyHidden } from '@/components/a11y';

const LARGE_TABLE_THRESHOLD = 100 * 1024 * 1024; // 100MB

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

type SortKey = 'size' | 'rows' | 'name';

export default function DBHealthPage() {
  const { t } = useTranslation();
  usePageTitle(t('dbHealth.title', 'DB Health'));
  const [sortKey, setSortKey] = useState<SortKey>('size');

  const statsQuery = useDBStats();
  const migrationQuery = useMigrations();
  const poolQuery = useConnectionPool();
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
    error: statsError, refetch: refetchStats,
  } = statsQuery;
  const {
    data: migrationData, isLoading: migrationLoading,
    error: migrationError, refetch: refetchMigration,
  } = migrationQuery;
  const {
    data: poolData, isLoading: poolLoading,
    error: poolError, refetch: refetchPool,
  } = poolQuery;

  const refreshAll = () => {
    refetchStats();
    refetchMigration();
    refetchPool();
  };

  const tables: TableInfo[] = dbStats?.tables ?? [];

  const sortedTables = useMemo(() => {
    const sorted = [...tables];
    sorted.sort((a, b) => {
      if (sortKey === 'size') return (b.sizeBytes ?? b.rowCount ?? 0) - (a.sizeBytes ?? a.rowCount ?? 0);
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
          name: tbl.name.length > 20 ? tbl.name.slice(0, 18) + '…' : tbl.name,
          rows: tbl.rowCount ?? 0,
        })),
    [tables],
  );

  // Backend returns {version, dirty} — handle both field names
  const migrationVersion =
    (migrationData as Record<string, unknown> | undefined)?.version ??
    migrationData?.currentVersion ??
    '—';
  const migrationDirty = migrationData?.dirty ?? false;
  const migrationPending = migrationData?.pending ?? 0;
  const migrations = migrationData?.migrations ?? [];

  const pool = poolData;
  const poolUsage =
    pool?.maxOpen && pool.maxOpen > 0
      ? Math.min(Math.max(((pool.inUse ?? 0) / pool.maxOpen) * 100, 0), 100)
      : 0;

  const totalRows = useMemo(
    () => tables.reduce((sum, tbl) => sum + (tbl.rowCount ?? 0), 0),
    [tables],
  );
  const largeTables = tables.filter(
    (tbl) => (tbl.sizeBytes ?? 0) > LARGE_TABLE_THRESHOLD,
  ).length;

  // databaseSize is numeric bytes from the backend
  const dbSizeDisplay = dbStats ? formatBytes(Number(dbStats.databaseSize) || 0) : '—';

  // ── KPI band config — 6 metrics fill the width on wide screens ──
  const kpis: Array<{
    key: string; label: string; value: string; icon: React.ReactNode;
    color: NeonColor; subtitle?: string;
  }> = [
    {
      key: 'size',
      label: t('dbHealth.totalSize', 'Total DB Size'),
      value: dbSizeDisplay,
      icon: <Database className="h-5 w-5" aria-hidden="true" />,
      color: 'cyan',
    },
    {
      key: 'tables',
      label: t('dbHealth.tables', 'Tables'),
      value: dbStats ? fmtInt(tables.length) : '—',
      icon: <Table2 className="h-5 w-5" aria-hidden="true" />,
      color: 'blue',
    },
    {
      key: 'rows',
      label: t('dbHealth.totalRows', 'Total Rows'),
      value: dbStats ? fmtInt(totalRows) : '—',
      icon: <Layers className="h-5 w-5" aria-hidden="true" />,
      color: 'purple',
    },
    {
      key: 'large',
      label: t('dbHealth.largeTables', 'Large Tables'),
      value: dbStats ? fmtInt(largeTables) : '—',
      icon: <AlertTriangle className="h-5 w-5" aria-hidden="true" />,
      color: 'amber',
      subtitle: t('dbHealth.largeTablesHint', '> 100 MB'),
    },
    {
      key: 'migration',
      label: t('dbHealth.migration', 'Migration'),
      value: migrationLoading ? '—' : String(migrationVersion),
      icon: <GitCommitHorizontal className="h-5 w-5" aria-hidden="true" />,
      color: migrationDirty ? 'red' : 'green',
      subtitle: migrationLoading
        ? undefined
        : migrationDirty
          ? t('dbHealth.dirtyShort', 'Dirty')
          : t('dbHealth.cleanShort', 'Clean'),
    },
    {
      key: 'pool',
      label: t('dbHealth.poolUsage', 'Pool Usage'),
      value: pool ? `${fmtInt(poolUsage)}%` : '—',
      icon: <Gauge className="h-5 w-5" aria-hidden="true" />,
      color: poolUsage >= 80 ? 'red' : 'cyan',
    },
  ];

  const tableColumns: Column<TableInfo>[] = useMemo(
    () => [
      {
        key: 'name',
        header: t('dbHealth.table.name', 'Table'),
        render: (tbl: TableInfo) => {
          const isLarge = (tbl.sizeBytes ?? 0) > LARGE_TABLE_THRESHOLD;
          return (
            <div className="flex items-center gap-2">
              {isLarge && (
                <AlertTriangle className="h-3 w-3 text-amber-300 shrink-0" aria-hidden="true" />
              )}
              <Text
                mono
                className={cn(isLarge ? 'text-amber-300' : typography.color.primary)}
              >
                {tbl.name}
              </Text>
            </div>
          );
        },
      },
      {
        key: 'rows',
        header: t('dbHealth.table.rows', 'Rows'),
        render: (tbl: TableInfo) => (
          <Text mono color="secondary">{fmtInt(tbl.rowCount ?? 0)}</Text>
        ),
        className: 'text-right',
      },
      {
        key: 'size',
        header: t('dbHealth.table.size', 'Size'),
        render: (tbl: TableInfo) => (
          <Text mono color="secondary">
            {tbl.sizeBytes ? formatBytes(tbl.sizeBytes) : '—'}
          </Text>
        ),
        className: 'text-right',
      },
      {
        key: 'indexes',
        header: t('dbHealth.table.indexes', 'Indexes'),
        render: (tbl: TableInfo) => (
          <Text mono color="muted">{tbl.indexCount ?? '—'}</Text>
        ),
        className: 'text-right',
      },
      {
        key: 'vacuum',
        header: t('dbHealth.table.lastVacuum', 'Last Vacuum'),
        render: (tbl: TableInfo) => (
          <TimeStamp value={tbl.lastVacuum ?? null} className="text-[var(--text-muted)] whitespace-nowrap" />
        ),
        className: 'text-right',
      },
    ],
    [t],
  );

  const sortOptions: SortKey[] = ['size', 'rows', 'name'];
  const sortLabel: Record<SortKey, string> = {
    size: t('dbHealth.sort.size', 'Size'),
    rows: t('dbHealth.sort.rows', 'Rows'),
    name: t('dbHealth.sort.name', 'Name'),
  };

  const actions = (
    <div className="flex items-center gap-2">
      <Caption className="flex items-center gap-1.5">
        <RefreshCw
          className={cn('h-3.5 w-3.5', statsFetching && 'animate-spin')}
          aria-hidden="true"
        />
        {t('dbHealth.autoRefresh', 'Auto-refresh 30s')}
      </Caption>
      <Button
        variant="ghost"
        size="sm"
        onClick={refreshAll}
        aria-label={t('dbHealth.refresh', 'Refresh now')}
      >
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );

  return (
    <PageContainer
      title={t('dbHealth.title', 'DB Health Dashboard')}
      subtitle={t('dbHealth.subtitle', 'Database health metrics and table statistics')}
      actions={actions}
      query={[statsQuery, migrationQuery, poolQuery]}
      dataSources={dataSources}
    >
      {/* 1 — KPI band: full-width responsive metric grid */}
      <FadeIn>
        <section
          aria-label={t('dbHealth.kpis', 'Summary metrics')}
          className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 xl:grid-cols-6"
        >
          {statsLoading && !dbStats
            ? Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} height={84} className="rounded-xl" />
              ))
            : kpis.map((kpi) => (
                <MetricCard
                  key={kpi.key}
                  label={kpi.label}
                  value={kpi.value}
                  icon={kpi.icon}
                  color={kpi.color}
                  subtitle={kpi.subtitle}
                />
              ))}
        </section>
      </FadeIn>

      {/* 2 — Primary bento: hero table-size chart + migration status */}
      <FadeIn delay={0.1}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <VisuallyHidden as="h2">
            {t('dbHealth.section.storage', 'Storage and migrations')}
          </VisuallyHidden>

          {/* Hero — table sizes (spans 2 of 3 columns on wide screens) */}
          <div className="xl:col-span-2">
            {statsError ? (
              <GlassPanel className="p-4 sm:p-5">
                <PanelTitle className="mb-3">
                  {t('dbHealth.chartTitle', 'Table Sizes (Top 15)')}
                </PanelTitle>
                <QueryError error={statsError} onRetry={() => refetchStats()} />
              </GlassPanel>
            ) : (
              <ChartContainer
                title={t('dbHealth.chartTitle', 'Table Sizes (Top 15)')}
                ariaLabel={t('dbHealth.chartTitle.aria', 'Top fifteen database table sizes horizontal bar chart')}
                data={chartData.map((r) => ({ name: r.name, rows: r.rows }))}
                dataColumns={[
                  { key: 'name', label: t('dbHealth.col.table', 'Table') },
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
              <ListChecks className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('dbHealth.migrationTitle', 'Migration Status')}
            </PanelTitle>
            {migrationLoading ? (
              <Skeleton height={180} />
            ) : migrationError ? (
              <QueryError error={migrationError} onRetry={() => refetchMigration()} />
            ) : migrationData ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Caption>
                    {t('dbHealth.currentVersion', 'Current Version')}
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
                      migrationDirty ? 'text-rose-300' : 'text-emerald-300',
                    )}
                  >
                    {migrationDirty ? (
                      <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    {migrationDirty
                      ? t('dbHealth.dirty', 'Dirty')
                      : t('dbHealth.clean', 'Clean')}
                  </Text>
                </div>
                {migrationPending > 0 && (
                  <div className="flex items-center justify-between">
                    <Caption>
                      {t('dbHealth.pending', 'Pending')}
                    </Caption>
                    <Text size="xs" weight="medium" className="text-amber-300">
                      {fmtInt(migrationPending)}
                    </Text>
                  </div>
                )}
                <div className="mt-3 border-t border-white/[0.06] pt-3">
                  <Label className="mb-2 block">
                    {t('dbHealth.recentMigrations', 'Recent Migrations')}
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
                <Table2 className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t('dbHealth.tablesTitle', 'Tables')}
              </PanelTitle>
              <div
                className="flex items-center gap-2"
                role="group"
                aria-label={t('dbHealth.sortBy', 'Sort tables by')}
              >
                <ArrowUpDown className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden="true" />
                {sortOptions.map((key) => (
                  <Button
                    key={key}
                    onClick={() => setSortKey(key)}
                    variant={sortKey === key ? 'primary' : 'secondary'}
                    size="sm"
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
                columns={tableColumns}
                data={sortedTables}
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
              <Server className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('dbHealth.poolTitle', 'Connection Pool')}
            </PanelTitle>
            {poolLoading ? (
              <Skeleton height={200} />
            ) : poolError ? (
              <QueryError error={poolError} onRetry={() => refetchPool()} />
            ) : pool?.maxOpen != null ? (
              <div className="space-y-3">
                {[
                  { label: t('dbHealth.pool.maxOpen', 'Max Open'), value: fmtInt(pool.maxOpen ?? 0) },
                  { label: t('dbHealth.pool.open', 'Open'), value: fmtInt(pool.open ?? 0) },
                  { label: t('dbHealth.pool.inUse', 'In Use'), value: fmtInt(pool.inUse ?? 0) },
                  { label: t('dbHealth.pool.idle', 'Idle'), value: fmtInt(pool.idle ?? 0) },
                  { label: t('dbHealth.pool.waitCount', 'Wait Count'), value: fmtInt(pool.waitCount ?? 0) },
                  {
                    label: t('dbHealth.pool.waitDuration', 'Wait Duration'),
                    value: `${fmtInt(pool.waitDurationMs ?? 0)}ms`,
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
                    <Text size="2xs" color="muted">{t('dbHealth.poolUsage', 'Pool Usage')}</Text>
                    <Text size="2xs" color="muted">{fmtInt(poolUsage)}%</Text>
                  </div>
                  <div
                    className="h-2 overflow-hidden rounded-full bg-[var(--surface-2)]"
                    role="progressbar"
                    aria-label={t('dbHealth.poolUsage', 'Pool Usage')}
                    aria-valuenow={Math.round(poolUsage)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <div
                      className={cn(
                        'h-full rounded-full transition-all',
                        poolUsage >= 80 ? 'bg-rose-400' : 'bg-cyan-400',
                      )}
                      style={{ width: `${poolUsage}%` }}
                    />
                  </div>
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
    </PageContainer>
  );
}
