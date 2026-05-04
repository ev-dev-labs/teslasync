import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Database, Search, RefreshCw } from 'lucide-react'

import { PageContainer } from '@/components/layout'
import { GlassPanel, Badge, Button as UiButton, DataTable, useSortToggle, Toggle, Input as UiInput, Select as UiSelect, type Column } from '@/components/ui'
import { StatCard } from '@/components/data-display'
import { Skeleton, EmptyState } from '@/components/feedback'
import { FadeIn } from '@/components/motion'
import { useVehicles } from '@/api/hooks/useVehicles'
import { getRedisSignals, type RedisSignalEntry } from '@/api/devtools'
import { usePageTitle } from '@/hooks/usePageTitle'
import { fmtInt } from '@/lib/numberFormat'
import { INTERVALS } from '@/lib/constants'
import { RedisDiagnosticEmptyState } from '../components/RedisDiagnosticEmptyState'

/* ─── signal categorization ─────────────────────────────────────────── */

type SignalCategory = 'Battery' | 'Charging' | 'Driving' | 'Climate' | 'Other'

const CATEGORY_COLORS: Record<SignalCategory, 'success' | 'info' | 'warning' | 'neutral' | 'danger'> = {
  Battery: 'success',
  Charging: 'info',
  Driving: 'warning',
  Climate: 'danger',
  Other: 'neutral',
}

function categorizeSignal(name: string): SignalCategory {
  const n = name.toLowerCase()
  if (/^(battery|bms|pack|brick|module)/.test(n)) return 'Battery'
  if (/^(ac|dc|charge|charger)/.test(n)) return 'Charging'
  if (/^(vehicle|odometer|latitude|longitude|gps)/.test(n)) return 'Driving'
  if (/(temp|hvac|inside|outside|climate)/.test(n)) return 'Climate'
  return 'Other'
}

/* ─── table row type ────────────────────────────────────────────────── */

interface SignalRow {
  name: string
  value: number | string | boolean
  type: string
  category: SignalCategory
}

/* ─── table columns ─────────────────────────────────────────────────── */

function buildColumns(t: (key: string, fb: string) => string): Column<SignalRow>[] {
  return [
    {
      key: 'name',
      header: t('redis.signalName', 'Signal Name'),
      sortable: true,
      render: (row) => <span className="font-mono text-sm text-[var(--text-primary)]">{row.name}</span>,
    },
    {
      key: 'value',
      header: t('redis.value', 'Value'),
      render: (row) => {
        // Per-type toned-down syntax-highlight colors (phase-40/02 forbids
        // neon for tabular body text). Mirrors common dev-console conventions:
        //   number  → cyan-300, string → amber-300, boolean → purple-300.
        const colorClass =
          typeof row.value === 'number'
            ? 'text-cyan-300'
            : typeof row.value === 'boolean'
              ? 'text-purple-300'
              : 'text-amber-300';
        return (
          <span className={`font-mono text-sm ${colorClass}`}>
            {String(row.value)}
          </span>
        );
      },
    },
    {
      key: 'type',
      header: t('redis.type', 'Type'),
      sortable: true,
      render: (row) => (
        <Badge
          variant={row.type === 'number' ? 'info' : row.type === 'boolean' ? 'warning' : 'neutral'}
          size="sm"
        >
          {row.type}
        </Badge>
      ),
    },
    {
      key: 'category',
      header: t('redis.category', 'Category'),
      sortable: true,
      render: (row) => (
        <Badge variant={CATEGORY_COLORS[row.category]} size="sm">
          {row.category}
        </Badge>
      ),
    },
  ]
}

/* ═══════════════════════════════════════════════════════════════════════
   Redis Signal Viewer Page
   ═══════════════════════════════════════════════════════════════════════ */

export default function RedisSignalViewerPage() {
  const { t } = useTranslation()
  usePageTitle(t('redis.title', 'Redis Signal Viewer'))

  const { data: vehicles } = useVehicles()
  const vehicleList = vehicles ?? []

  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState<string>('all')

  const {
    data: signalData,
    isLoading,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ['redis-signals', selectedVehicleId],
    queryFn: () => getRedisSignals(selectedVehicleId!),
    enabled: selectedVehicleId !== null,
    refetchInterval: autoRefresh ? INTERVALS.REALTIME : false,
  })

  const rows = useMemo<SignalRow[]>(() => {
    if (!signalData?.signals) return []
    return Object.entries(signalData.signals)
      .map(([name, entry]: [string, RedisSignalEntry]) => ({
        name,
        value: entry.value,
        type: entry.type,
        category: categorizeSignal(name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [signalData])

  const filteredRows = useMemo(() => {
    let result = rows
    if (search) {
      const q = search.toLowerCase()
      result = result.filter((r) => r.name.toLowerCase().includes(q))
    }
    if (categoryFilter !== 'all') {
      result = result.filter((r) => r.category === categoryFilter)
    }
    return result
  }, [rows, search, categoryFilter])

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { Battery: 0, Charging: 0, Driving: 0, Climate: 0, Other: 0 }
    for (const row of rows) {
      counts[row.category] = (counts[row.category] ?? 0) + 1
    }
    return counts
  }, [rows])

  const columns = useMemo(() => buildColumns(t), [t])
  const { sortKey, sortDir, onSort } = useSortToggle('name', 'asc')

  const meta = signalData?.meta

  const vehicleOptions = vehicleList.map((v) => ({
    value: String(v.id),
    label: v.display_name || v.vin || `Vehicle ${v.id}`,
  }))

  return (
    <PageContainer
      title={t('redis.title', 'Redis Signal Viewer')}
      subtitle={t('redis.subtitle', 'Inspect cached signal values in Redis')}
    >
      <div className="space-y-6">
        {/* Controls */}
        <FadeIn>
          <GlassPanel>
            <div className="flex flex-wrap items-center gap-4">
              <div className="w-64">
                <UiSelect
                  value={selectedVehicleId !== null ? String(selectedVehicleId) : ''}
                  onChange={(e) => {
                    const val = e.target.value
                    setSelectedVehicleId(val ? Number(val) : null)
                  }}
                  options={[{ value: '', label: t('redis.selectVehicle', 'Select vehicle…') }, ...vehicleOptions]}
                />
              </div>

              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
                <UiInput
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('redis.searchPlaceholder', 'Filter signals…')}
                  className="pl-9"
                />
              </div>

              <UiSelect
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                options={[
                  { value: 'all', label: t('redis.allCategories', 'All Categories') },
                  { value: 'Battery', label: `Battery (${categoryCounts.Battery})` },
                  { value: 'Charging', label: `Charging (${categoryCounts.Charging})` },
                  { value: 'Driving', label: `Driving (${categoryCounts.Driving})` },
                  { value: 'Climate', label: `Climate (${categoryCounts.Climate})` },
                  { value: 'Other', label: `Other (${categoryCounts.Other})` },
                ]}
              />

              <div className="flex items-center gap-2">
                <Toggle checked={autoRefresh} onChange={setAutoRefresh} />
                <span className="text-sm text-[var(--text-secondary)]">{t('redis.autoRefresh', 'Auto-refresh')}</span>
              </div>

              <UiButton
                type="button"
                variant="secondary"
                onClick={() => refetch()}
                disabled={selectedVehicleId === null || isFetching}
                className="gap-1.5 !rounded-lg !bg-white/[0.06] !px-3 !py-2 text-sm text-[var(--text-primary)] hover:!bg-[var(--surface-2)] disabled:opacity-40"
              >
                <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
                {t('redis.refresh', 'Refresh')}
              </UiButton>
            </div>
          </GlassPanel>
        </FadeIn>

        {/* Persistent diagnostic chips — visible whenever a vehicle is
            selected so engineers don't have to clear the table to see
            mode/VIN/last-seen. */}
        {selectedVehicleId !== null && meta && (
          <FadeIn>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge
                size="sm"
                variant={meta.live_signal_store_mode === 'hybrid' ? 'success' : 'danger'}
              >
                {t('redis.headerChip.mode', 'Mode: {{mode}}', { mode: meta.live_signal_store_mode })}
              </Badge>
              {meta.vehicle_vin && (
                <Badge size="sm" variant="neutral">
                  <code className="font-mono">{meta.vehicle_vin}</code>
                </Badge>
              )}
              {meta.l1_last_seen_at && (
                <Badge size="sm" variant="info">
                  {t('redis.headerChip.l1Seen', 'L1 last: {{date}}', {
                    date: new Date(meta.l1_last_seen_at).toLocaleTimeString(),
                  })}
                </Badge>
              )}
            </div>
          </FadeIn>
        )}

        {/* Stats */}
        {selectedVehicleId !== null && (
          <FadeIn>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <StatCard
                label={t('redis.totalSignals', 'Total Signals')}
                value={isLoading ? '—' : fmtInt(signalData?.signal_count ?? 0)}
                icon={<Database className="h-5 w-5" />}
              />
              <StatCard
                label={t('redis.numbers', 'Numbers')}
                value={isLoading ? '—' : fmtInt(rows.filter((r) => r.type === 'number').length)}
              />
              <StatCard
                label={t('redis.strings', 'Strings')}
                value={isLoading ? '—' : fmtInt(rows.filter((r) => r.type === 'string').length)}
              />
              <StatCard
                label={t('redis.booleans', 'Booleans')}
                value={isLoading ? '—' : fmtInt(rows.filter((r) => r.type === 'boolean').length)}
              />
            </div>
          </FadeIn>
        )}

        {/* Table */}
        <FadeIn>
          <GlassPanel>
            {selectedVehicleId === null ? (
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                icon={<Database className="h-10 w-10" />}
                message={t('redis.selectPrompt', 'Select a vehicle to view its cached Redis signals')}
              />
            ) : isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : filteredRows.length === 0 ? (
              rows.length === 0 ? (
                <RedisDiagnosticEmptyState
                  vehicleId={selectedVehicleId!}
                  meta={meta}
                  onSelectVehicle={setSelectedVehicleId}
                />
              ) : (
                <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                  icon={<Search className="h-10 w-10" />}
                  message={t('redis.noMatch', 'No signals match the current filter')}
                />
              )
            ) : (
              <DataTable
                data={filteredRows}
                columns={columns}
                keyExtractor={(row) => row.name}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={onSort}
                pagination={{ defaultPageSize: 50 }}
              />
            )}
          </GlassPanel>
        </FadeIn>
      </div>
    </PageContainer>
  )
}
