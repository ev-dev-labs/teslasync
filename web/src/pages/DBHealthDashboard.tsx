import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Database, ArrowUpDown, RefreshCw, CheckCircle, AlertTriangle } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from 'recharts'
import { PageHeader, GlassPanel, FadeIn, Skeleton, StatCard, Button, DataTable } from '../components/ui'
import type { Column } from '../components/ui'
import { ChartTooltip } from '../components/Charts'
import { request } from '../api/client'
import { formatDateTime } from '../lib/dateFormat'
import { fmtNumber, fmtInt } from '../lib/numberFormat'
import clsx from 'clsx'

interface TableInfo {
  name: string
  schema?: string
  row_count: number
  size_bytes?: number
  size_human?: string
  last_vacuum?: string
  index_count?: number
}

interface DBStats {
  tables: TableInfo[]
  table_count: number
  database_size: number
  total_size_bytes?: number
  total_size_human?: string
  connection_pool?: {
    max_open: number
    open: number
    in_use: number
    idle: number
    wait_count: number
    wait_duration_ms: number
  }
}

interface MigrationStatus {
  current_version: number
  dirty: boolean
  pending: number
  migrations: { version: number; name: string; applied_at?: string }[]
}

type SortKey = 'size' | 'rows' | 'name'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

const LARGE_TABLE_THRESHOLD = 100 * 1024 * 1024 // 100MB

export default function DBHealthDashboard() {
  const [sortKey, setSortKey] = useState<SortKey>('size')

  const { data: dbStats, isLoading: statsLoading } = useQuery<DBStats>({
    queryKey: ['db-stats'],
    queryFn: () => request('/dev-tools/db-stats'),
    refetchInterval: 30_000,
  })

  const { data: migrationStatus, isLoading: migrationLoading } = useQuery<MigrationStatus>({
    queryKey: ['migration-status'],
    queryFn: () => request('/dev-tools/migration-status'),
    refetchInterval: 60_000,
  })

  const tables = dbStats?.tables ?? []

  const sortedTables = useMemo(() => {
    const sorted = [...tables]
    sorted.sort((a, b) => {
      if (sortKey === 'size') return (b.size_bytes ?? b.row_count) - (a.size_bytes ?? a.row_count)
      if (sortKey === 'rows') return b.row_count - a.row_count
      return a.name.localeCompare(b.name)
    })
    return sorted
  }, [tables, sortKey])

  const chartData = useMemo(() =>
    [...tables]
      .sort((a, b) => b.row_count - a.row_count)
      .slice(0, 15)
      .map(t => ({
        name: t.name.length > 20 ? t.name.slice(0, 18) + '…' : t.name,
        rows: t.row_count,
      })),
  [tables])

  const pool = dbStats?.connection_pool

  const tableColumns: Column<TableInfo>[] = useMemo(() => [
    {
      key: 'name',
      header: 'Table',
      render: (t) => {
        const isLarge = (t.size_bytes ?? 0) > LARGE_TABLE_THRESHOLD
        return (
          <div className="flex items-center gap-2">
            {isLarge && <AlertTriangle className="h-3 w-3 text-neon-amber shrink-0" />}
            <span className={clsx('font-mono', isLarge ? 'text-neon-amber' : 'text-[var(--text-primary)]')}>
              {t.name}
            </span>
          </div>
        )
      },
    },
    { key: 'rows', header: 'Rows', render: (t) => <span className="font-mono text-[var(--text-secondary)]">{fmtInt(t.row_count)}</span>, className: 'text-right' },
    { key: 'size', header: 'Size', render: (t) => <span className="font-mono text-[var(--text-secondary)]">{t.size_human || (t.size_bytes ? formatBytes(t.size_bytes) : '—')}</span>, className: 'text-right' },
    { key: 'indexes', header: 'Indexes', render: (t) => <span className="font-mono text-[var(--text-muted)]">{t.index_count ?? '—'}</span>, className: 'text-right' },
    { key: 'vacuum', header: 'Last Vacuum', render: (t) => <span className="text-[var(--text-muted)] whitespace-nowrap">{t.last_vacuum ? formatDateTime(t.last_vacuum) : '—'}</span>, className: 'text-right' },
  ], [])

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="DB Health Dashboard"
        subtitle="Database health metrics and table statistics"
        icon={<Database className="h-6 w-6 text-neon-cyan" />}
        actions={
          <span className="text-xs text-[var(--text-muted)]">
            <RefreshCw className="inline h-3 w-3 mr-1" />
            Auto-refresh 30s
          </span>
        }
      />

      {/* Summary Cards */}
      <FadeIn delay={0.1}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          <StatCard
            label="Total DB Size"
            value={dbStats ? formatBytes(dbStats.database_size ?? dbStats.total_size_bytes ?? 0) : '—'}
            icon={<Database className="h-4 w-4" />}
            color="cyan"
          />
          <StatCard
            label="Tables"
            value={statsLoading ? '—' : tables.length}
            icon={<Database className="h-4 w-4" />}
            color="purple"
          />
          <StatCard
            label="Large Tables (>100MB)"
            value={tables.filter(t => (t.size_bytes ?? 0) > LARGE_TABLE_THRESHOLD).length}
            icon={<AlertTriangle className="h-4 w-4" />}
            color={tables.some(t => (t.size_bytes ?? 0) > LARGE_TABLE_THRESHOLD) ? 'amber' : 'green'}
          />
          <StatCard
            label="Migration Version"
            value={migrationStatus?.current_version ?? '—'}
            icon={<CheckCircle className="h-4 w-4" />}
            color={migrationStatus?.dirty ? 'red' : 'green'}
            subtitle={migrationStatus?.dirty ? 'DIRTY' : migrationStatus?.pending ? `${migrationStatus.pending} pending` : 'Up to date'}
          />
        </div>
      </FadeIn>

      {/* Table Size Bar Chart */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-5">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4">Table Sizes (Top 15)</h2>
          {statsLoading ? (
            <Skeleton className="h-72" />
          ) : chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData} layout="vertical" margin={{ left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                <XAxis type="number" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} tickFormatter={v => `${fmtNumber(v, 1)} MB`} />
                <YAxis type="category" dataKey="name" tick={{ fill: 'var(--text-secondary)', fontSize: 10 }} width={140} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="rows" name="Rows" fill="#00f0ff" radius={[0, 4, 4, 0]} barSize={16} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-center py-12 text-[var(--text-muted)]">No table data available</p>
          )}
        </GlassPanel>
      </FadeIn>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        {/* Table List */}
        <FadeIn delay={0.3} className="lg:col-span-2">
          <GlassPanel className="p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-[var(--text-primary)]">Tables</h2>
              <div className="flex items-center gap-2">
                <ArrowUpDown className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                {(['size', 'rows', 'name'] as SortKey[]).map(key => (
                  <Button
                    key={key}
                    onClick={() => setSortKey(key)}
                    variant={sortKey === key ? 'primary' : 'secondary'}
                    size="sm"
                  >
                    {key === 'size' ? 'Size' : key === 'rows' ? 'Rows' : 'Name'}
                  </Button>
                ))}
              </div>
            </div>

            {statsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
              </div>
            ) : (
              <DataTable<TableInfo>
                columns={tableColumns}
                data={sortedTables}
                keyExtractor={t => t.name}
                compact
                className="max-h-[50vh] overflow-auto"
              />
            )}
          </GlassPanel>
        </FadeIn>

        {/* Sidebar: Migration & Connection Pool */}
        <FadeIn delay={0.4}>
          <div className="space-y-4">
            {/* Migration Status */}
            <GlassPanel className="p-5">
              <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4">Migration Status</h2>
              {migrationLoading ? (
                <Skeleton className="h-32" />
              ) : migrationStatus ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--text-muted)]">Current Version</span>
                    <span className="text-sm font-mono font-bold text-[var(--text-primary)]">{migrationStatus.current_version}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[var(--text-muted)]">Status</span>
                    <span className={clsx('text-xs font-medium', migrationStatus.dirty ? 'text-neon-red' : 'text-neon-green')}>
                      {migrationStatus.dirty ? '⚠ Dirty' : '✓ Clean'}
                    </span>
                  </div>
                  {migrationStatus.pending > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[var(--text-muted)]">Pending</span>
                      <span className="text-xs font-medium text-neon-amber">{migrationStatus.pending}</span>
                    </div>
                  )}
                  {migrationStatus.migrations?.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-[var(--border)]">
                      <p className="text-[10px] text-[var(--text-muted)] mb-2 uppercase tracking-wider">Recent Migrations</p>
                      <div className="space-y-1.5 max-h-40 overflow-auto">
                        {migrationStatus.migrations.slice(-5).reverse().map(m => (
                          <div key={m.version} className="flex items-center justify-between text-[11px]">
                            <span className="font-mono text-[var(--text-secondary)] truncate mr-2">v{m.version} {m.name}</span>
                            {m.applied_at && (
                              <span className="text-[var(--text-muted)] shrink-0 text-[10px]">{formatDateTime(m.applied_at)}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-[var(--text-muted)] text-sm">Migration data unavailable</p>
              )}
            </GlassPanel>

            {/* Connection Pool */}
            {pool && (
              <GlassPanel className="p-5">
                <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-4">Connection Pool</h2>
                <div className="space-y-3">
                  {[
                    { label: 'Max Open', value: pool.max_open },
                    { label: 'Open', value: pool.open },
                    { label: 'In Use', value: pool.in_use },
                    { label: 'Idle', value: pool.idle },
                    { label: 'Wait Count', value: pool.wait_count },
                    { label: 'Wait Duration', value: `${fmtNumber(pool.wait_duration_ms, 0)}ms` },
                  ].map(item => (
                    <div key={item.label} className="flex items-center justify-between">
                      <span className="text-xs text-[var(--text-muted)]">{item.label}</span>
                      <span className="text-sm font-mono text-[var(--text-primary)]">{item.value}</span>
                    </div>
                  ))}
                  {/* Usage bar */}
                  <div className="mt-2">
                    <div className="flex justify-between text-[10px] text-[var(--text-muted)] mb-1">
                      <span>Pool Usage</span>
                      <span>{pool.max_open > 0 ? Math.round((pool.in_use / pool.max_open) * 100) : 0}%</span>
                    </div>
                    <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                      <div
                        className={clsx('h-full rounded-full transition-all', pool.in_use / pool.max_open > 0.8 ? 'bg-neon-red' : 'bg-neon-cyan')}
                        style={{ width: `${pool.max_open > 0 ? Math.min((pool.in_use / pool.max_open) * 100, 100) : 0}%` }}
                      />
                    </div>
                  </div>
                </div>
              </GlassPanel>
            )}
          </div>
        </FadeIn>
      </div>
    </div>
  )
}
