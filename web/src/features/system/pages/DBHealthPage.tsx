import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Database, ArrowUpDown, RefreshCw, CheckCircle, AlertTriangle,
} from 'lucide-react';
import { PageContainer, Grid } from '@/components/layout';
import { GlassPanel, Button, DataTable } from '@/components/ui';
import type { Column } from '@/components/ui';
import { StatCard, TimeStamp } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { Skeleton, EmptyState, AlertBanner } from '@/components/feedback';
import {
  ChartContainer, BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip,
  ChartTooltip, axisTick, CHART_COLORS,
} from '@/components/charts';
import { useDBStats, useMigrations, useConnectionPool } from '@/api/hooks/useAdmin';
import { usePageTitle } from '@/hooks/usePageTitle';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import type { TableInfo } from '@/types/admin';

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

  const {
    data: dbStats, isLoading: statsLoading, isFetching: statsFetching, error: statsError,
  } = useDBStats();
  const {
    data: migrationData, isLoading: migrationLoading, error: migrationError,
  } = useMigrations();
  const { data: poolData, isLoading: poolLoading } = useConnectionPool();

  const queryError = statsError || migrationError;
  const tables: TableInfo[] = dbStats?.tables ?? [];

  const sortedTables = useMemo(() => {
    const sorted = [...tables];
    sorted.sort((a, b) => {
      if (sortKey === 'size') return (b.sizeBytes ?? b.rowCount) - (a.sizeBytes ?? a.rowCount);
      if (sortKey === 'rows') return b.rowCount - a.rowCount;
      return a.name.localeCompare(b.name);
    });
    return sorted;
  }, [tables, sortKey]);

  // Chart data — always sorted by row count, independent of table sort
  const chartData = useMemo(
    () =>
      [...tables]
        .sort((a, b) => b.rowCount - a.rowCount)
        .slice(0, 15)
        .map((tbl) => ({
          name: tbl.name.length > 20 ? tbl.name.slice(0, 18) + '…' : tbl.name,
          rows: tbl.rowCount,
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
      ? Math.min((pool.inUse / pool.maxOpen) * 100, 100)
      : 0;

  const largeTables = tables.filter(
    (tbl) => (tbl.sizeBytes ?? 0) > LARGE_TABLE_THRESHOLD,
  ).length;

  // databaseSize is numeric bytes from the backend
  const dbSizeDisplay = dbStats
    ? formatBytes(Number(dbStats.databaseSize) || 0)
    : '—';

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
                <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0" />
              )}
              <span
                className={cn(
                  'font-mono',
                  isLarge ? 'text-amber-400' : 'text-[var(--text-primary)]',
                )}
              >
                {tbl.name}
              </span>
            </div>
          );
        },
      },
      {
        key: 'rows',
        header: t('dbHealth.table.rows', 'Rows'),
        render: (tbl: TableInfo) => (
          <span className="font-mono text-[var(--text-secondary)]">{fmtInt(tbl.rowCount)}</span>
        ),
        className: 'text-right',
      },
      {
        key: 'size',
        header: t('dbHealth.table.size', 'Size'),
        render: (tbl: TableInfo) => (
          <span className="font-mono text-[var(--text-secondary)]">
            {tbl.sizeBytes ? formatBytes(tbl.sizeBytes) : '—'}
          </span>
        ),
        className: 'text-right',
      },
      {
        key: 'indexes',
        header: t('dbHealth.table.indexes', 'Indexes'),
        render: (tbl: TableInfo) => (
          <span className="font-mono text-[var(--text-muted)]">{tbl.indexCount ?? '—'}</span>
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

  return (
    <PageContainer
      title={t('dbHealth.title', 'DB Health Dashboard')}
      subtitle={t('dbHealth.subtitle', 'Database health metrics and table statistics')}
      loading={statsLoading && migrationLoading}
      actions={
        <span className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
          <RefreshCw className={cn('h-3 w-3', statsFetching && 'animate-spin')} />
          {t('dbHealth.autoRefresh', 'Auto-refresh 30s')}
        </span>
      }
    >
      {queryError && (
        <AlertBanner
          variant="danger"
          title={t('dbHealth.error', 'Error loading data')}
        >
          {(queryError as Error).message}
        </AlertBanner>
      )}

      {/* Summary Cards */}
      <FadeIn delay={0.1}>
        <Grid cols={{ default: 2, lg: 4 }} gap={4}>
          <StatCard
            label={t('dbHealth.totalSize', 'Total DB Size')}
            value={dbSizeDisplay}
            icon={<Database className="h-4 w-4" />}
            loading={statsLoading}
          />
          <StatCard
            label={t('dbHealth.tables', 'Tables')}
            value={statsLoading ? '—' : tables.length}
            icon={<Database className="h-4 w-4" />}
          />
          <StatCard
            label={t('dbHealth.largeTables', 'Large Tables (>100MB)')}
            value={largeTables}
            icon={<AlertTriangle className="h-4 w-4" />}
          />
          <StatCard
            label={t('dbHealth.migration', 'Migration Version')}
            value={String(migrationVersion)}
            icon={<CheckCircle className="h-4 w-4" />}
            loading={migrationLoading}
          />
        </Grid>
      </FadeIn>

      {/* Table Size Bar Chart */}
      <FadeIn delay={0.2}>
        <ChartContainer
          title={t('dbHealth.chartTitle', 'Table Sizes (Top 15)')}
          ariaLabel={t('dbHealth.chartTitle.aria', 'Top fifteen database table sizes horizontal bar chart')}
          data={chartData.map((r) => ({ name: r.name, rows: r.rows }))}
          dataColumns={[
            { key: 'name', label: t('dbHealth.col.table', 'Table') },
            { key: 'rows', label: t('dbHealth.col.rows', 'Rows') },
          ]}
          loading={statsLoading}
          height={300}
        >
          <ResponsiveContainer width="100%" height={300}>
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
      </FadeIn>

      {/* Table List + Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        {/* Table List — 2/3 width */}
        <FadeIn delay={0.3} className="lg:col-span-2">
          <GlassPanel className="p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">
                {t('dbHealth.tablesTitle', 'Tables')}
              </h2>
              <div className="flex items-center gap-2">
                <ArrowUpDown className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                {(['size', 'rows', 'name'] as SortKey[]).map((key) => (
                  <Button
                    key={key}
                    onClick={() => setSortKey(key)}
                    variant={sortKey === key ? 'primary' : 'secondary'}
                    size="sm"
                  >
                    {key === 'size'
                      ? t('dbHealth.sort.size', 'Size')
                      : key === 'rows'
                        ? t('dbHealth.sort.rows', 'Rows')
                        : t('dbHealth.sort.name', 'Name')}
                  </Button>
                ))}
              </div>
            </div>

            {statsLoading ? (
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
                className="max-h-[50vh] overflow-auto"
              />
            )}
          </GlassPanel>
        </FadeIn>

        {/* Sidebar: Migration Status + Connection Pool */}
        <FadeIn delay={0.4}>
          <div className="space-y-4">
            {/* Migration Status */}
            <GlassPanel className="p-5">
              <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4">
                {t('dbHealth.migrationTitle', 'Migration Status')}
              </h2>
              {migrationLoading ? (
                <Skeleton height={128} />
              ) : migrationData ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--text-muted)]">
                      {t('dbHealth.currentVersion', 'Current Version')}
                    </span>
                    <span className="text-sm font-mono font-bold text-[var(--text-primary)]">
                      {String(migrationVersion)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--text-muted)]">
                      {t('dbHealth.status', 'Status')}
                    </span>
                    <span
                      className={cn(
                        'text-xs font-medium',
                        migrationDirty ? 'text-red-400' : 'text-green-400',
                      )}
                    >
                      {migrationDirty
                        ? t('dbHealth.dirty', '⚠ Dirty')
                        : t('dbHealth.clean', '✓ Clean')}
                    </span>
                  </div>
                  {migrationPending > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[var(--text-muted)]">
                        {t('dbHealth.pending', 'Pending')}
                      </span>
                      <span className="text-xs font-medium text-amber-400">
                        {migrationPending}
                      </span>
                    </div>
                  )}
                  {migrations.length > 0 ? (
                    <div className="mt-3 pt-3 border-t border-white/[0.06]">
                      <p className="text-[10px] text-[var(--text-muted)] mb-2 uppercase tracking-wider">
                        {t('dbHealth.recentMigrations', 'Recent Migrations')}
                      </p>
                      <div className="space-y-1.5 max-h-40 overflow-auto">
                        {migrations
                          .slice(-5)
                          .reverse()
                          .map((m) => (
                            <div
                              key={m.version}
                              className="flex items-center justify-between text-[11px]"
                            >
                              <span className="font-mono text-[var(--text-secondary)] truncate mr-2">
                                v{m.version} {m.name}
                              </span>
                              {m.appliedAt && (
                                <TimeStamp
                                  value={m.appliedAt}
                                  className="text-[var(--text-muted)] shrink-0 text-[10px]"
                                />
                              )}
                            </div>
                          ))}
                      </div>
                    </div>
                  ) : (
                    <EmptyState message={t('dbHealth.noMigrations', 'No migration history available')} />
                  )}
                </div>
              ) : (
                <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                  message={t(
                    'dbHealth.noMigrationData',
                    'Migration data unavailable',
                  )}
                />
              )}
            </GlassPanel>

            {/* Connection Pool */}
            <GlassPanel className="p-5">
              <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4">
                {t('dbHealth.poolTitle', 'Connection Pool')}
              </h2>
              {poolLoading ? (
                <Skeleton height={160} />
              ) : pool?.maxOpen != null ? (
                <div className="space-y-3">
                  {[
                    { label: t('dbHealth.pool.maxOpen', 'Max Open'), value: pool.maxOpen },
                    { label: t('dbHealth.pool.open', 'Open'), value: pool.open },
                    { label: t('dbHealth.pool.inUse', 'In Use'), value: pool.inUse },
                    { label: t('dbHealth.pool.idle', 'Idle'), value: pool.idle },
                    { label: t('dbHealth.pool.waitCount', 'Wait Count'), value: pool.waitCount },
                    {
                      label: t('dbHealth.pool.waitDuration', 'Wait Duration'),
                      value: `${fmtInt(pool.waitDurationMs ?? 0)}ms`,
                    },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="flex items-center justify-between"
                    >
                      <span className="text-xs text-[var(--text-muted)]">{item.label}</span>
                      <span className="text-sm font-mono text-[var(--text-primary)]">
                        {item.value}
                      </span>
                    </div>
                  ))}
                  {/* Usage bar */}
                  <div className="mt-2">
                    <div className="flex justify-between text-[10px] text-[var(--text-muted)] mb-1">
                      <span>{t('dbHealth.poolUsage', 'Pool Usage')}</span>
                      <span>{fmtInt(poolUsage)}%</span>
                    </div>
                    <div className="h-2 bg-[var(--surface-2)] rounded-full overflow-hidden">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all',
                          poolUsage >= 80 ? 'bg-red-400' : 'bg-cyan-400',
                        )}
                        style={{ width: `${poolUsage}%` }}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                  message={t(
                    'dbHealth.noPoolData',
                    'Connection pool data unavailable',
                  )}
                />
              )}
            </GlassPanel>
          </div>
        </FadeIn>
      </div>
    </PageContainer>
  );
}
