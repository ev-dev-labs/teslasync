import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Database, Search, RefreshCw, Trash2 } from 'lucide-react'

import { PageContainer } from '@/components/layout'
import { GlassPanel, Badge, Button as UiButton, ConfirmDialog, DataTable, useSortToggle, Toggle, Input as UiInput, Select as UiSelect, MaskedValue, type Column } from '@/components/ui'
import { StatCard } from '@/components/data-display'
import { Skeleton, EmptyState } from '@/components/feedback'
import { useToast } from '@/components/feedback/Toast'
import { FadeIn } from '@/components/motion'
import { useVehicles } from '@/api/hooks/useVehicles'
import { getRedisSignals, purgeRedisSignals, purgeAllRedisSignals, type RedisSignalEntry } from '@/api/devtools'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useDateFormat } from '@/hooks/useDateFormat'
import { fmtInt } from '@/lib/numberFormat'
import { INTERVALS } from '@/lib/constants'
import { isApiError, type ApiError } from '@/lib/resilience'
import { RedisDiagnosticEmptyState, type DiagnosticErrorProps } from '../components/RedisDiagnosticEmptyState'

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

/**
 * isLocationSignal — true for lat/lng/gps signal names that should be
 * masked by default. Operators can still reveal the value (the
 * `<MaskedValue>` toggle exposes the raw number) but a casual screen
 * share or screenshot does not leak the parking spot.
 */
function isLocationSignal(name: string): boolean {
  const n = name.toLowerCase()
  return /^(latitude|longitude|gps_lat|gps_lng|gps_latitude|gps_longitude|location_lat|location_lng)$/.test(n)
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
        // Location signals are routed through MaskedValue so the raw
        // coordinate never sits on screen by default. The mask still
        // shows enough structure (••.•••) to confirm the row carries
        // a number, and the operator can click to reveal for ops work.
        if (isLocationSignal(row.name) && (typeof row.value === 'number' || typeof row.value === 'string')) {
          return (
            <MaskedValue
              value={String(row.value)}
              variant="coords"
              ariaLabel={t('redis.maskedCoord', 'Coordinate, click to reveal')}
              copyable
              auditOnReveal
            />
          )
        }
        // Per-type toned-down syntax-highlight colors avoid neon tabular body text.
        // Mirrors common dev-console conventions:
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
  const { formatTime } = useDateFormat()

  const { data: vehicles } = useVehicles()
  const vehicleList = vehicles ?? []

  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [categoryFilter, setCategoryFilter] = useState<string>('all')

  // Purge UI state — `purgeMode` distinguishes the two destructive
  // paths so a single ConfirmDialog can serve both. `purgeTargetId`
  // pins the per-vehicle purge target at the moment the dialog opens
  // so a mid-confirmation vehicle-picker change can't retarget the
  // destructive call. `isPurging` keeps the dialog open with disabled
  // buttons + spinner while the DELETE request is in flight.
  const [purgeMode, setPurgeMode] = useState<'one' | 'all' | null>(null)
  const [purgeTargetId, setPurgeTargetId] = useState<number | null>(null)
  const [purgeTargetLabel, setPurgeTargetLabel] = useState<string>('')
  const [isPurging, setIsPurging] = useState(false)
  const queryClient = useQueryClient()
  const toast = useToast()

  const {
    data: signalData,
    isLoading,
    isFetching,
    error,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['redis-signals', selectedVehicleId],
    queryFn: () => getRedisSignals(selectedVehicleId!),
    enabled: selectedVehicleId !== null,
    refetchInterval: autoRefresh ? INTERVALS.REALTIME : false,
  })

  const selectedVehicle = useMemo(
    () => vehicleList.find((v) => v.id === selectedVehicleId),
    [vehicleList, selectedVehicleId],
  )
  const selectedVehicleLabel =
    selectedVehicle?.display_name || selectedVehicle?.vin || (selectedVehicleId !== null ? `Vehicle ${selectedVehicleId}` : '')

  const handlePurgeConfirm = async () => {
    if (purgeMode === null) return
    setIsPurging(true)
    try {
      if (purgeMode === 'one' && purgeTargetId !== null) {
        const res = await purgeRedisSignals(purgeTargetId)
        if (res.purged) {
          toast.success(
            t('redis.purgeSuccess', 'Redis L2 cache purged'),
            t('redis.purgeSuccessDetail', '{{vehicle}}: Redis HSET removed. L1 in-memory caches on each pod will refill from new telemetry.', { vehicle: purgeTargetLabel }),
          )
        } else {
          toast.info(
            t('redis.purgeNoOpTitle', 'Nothing to purge'),
            t('redis.purgeNoOpDetail', '{{vehicle}} had no cached signals in Redis.', { vehicle: purgeTargetLabel }),
          )
        }
        await queryClient.invalidateQueries({ queryKey: ['redis-signals', purgeTargetId] })
        await queryClient.invalidateQueries({ queryKey: ['redis-signal-keys'] })
      } else if (purgeMode === 'all') {
        const res = await purgeAllRedisSignals()
        if (res.has_more) {
          toast.warning(
            t('redis.purgeAllPartial', 'Redis L2 cache partially purged'),
            t(
              'redis.purgeAllPartialDetail',
              'Removed {{count}} of up to {{limit}} vehicle HSET(s) from Redis. More keys remain — click Purge All Redis again to drain.',
              { count: res.purged, limit: res.limit },
            ),
          )
        } else {
          toast.success(
            t('redis.purgeAllSuccess', 'Redis L2 cache purged'),
            t('redis.purgeAllSuccessDetail', 'Removed {{count}} vehicle HSET(s) from Redis. L1 in-memory caches on each pod will refill from new telemetry.', { count: res.purged }),
          )
        }
        await queryClient.invalidateQueries({ queryKey: ['redis-signals'] })
        await queryClient.invalidateQueries({ queryKey: ['redis-signal-keys'] })
      }
      setPurgeMode(null)
      setPurgeTargetId(null)
      setPurgeTargetLabel('')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(
        t('redis.purgeError', 'Purge failed'),
        msg,
      )
    } finally {
      setIsPurging(false)
    }
  }

  const openPurgeOne = () => {
    if (selectedVehicleId === null) return
    setPurgeTargetId(selectedVehicleId)
    setPurgeTargetLabel(selectedVehicleLabel)
    setPurgeMode('one')
  }

  const openPurgeAll = () => {
    setPurgeTargetId(null)
    setPurgeTargetLabel('')
    setPurgeMode('all')
  }

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

  // When the upstream query failed, the diagnostic
  // banner takes over so the operator sees the real failure mode (cache
  // not wired, redis unreachable, generic 5xx, network) instead of the
  // legacy "no signals cached" black box. Stat cards also display a
  // placeholder so the top-of-page numbers don't lie about a 0 count.
  const errorBannerProps: DiagnosticErrorProps = !isError
    ? {}
    : isApiError(error)
      ? { serverError: error as ApiError }
      : { serverError: null, networkError: true }
  const showStatPlaceholder = isLoading || isError

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

              {/* Purge buttons — destructive ops behind explicit confirm.
                  Per-vehicle uses the standard danger-confirm; cluster-wide
                  PurgeAll requires the operator to type "PURGE ALL" to
                  prevent accidental wipe of every vehicle's L2 cache.
                  The button labels are explicit about Redis L2 so operators
                  don't expect cross-pod L1 invalidation. */}
              <UiButton
                type="button"
                variant="danger"
                onClick={openPurgeOne}
                disabled={selectedVehicleId === null || isPurging}
                className="gap-1.5"
                title={t('redis.purgeButtonTitle', 'Delete this vehicle\u2019s cached signals from Redis (L2). The in-process L1 cache on each pod stays put and refills from new telemetry.')}
              >
                <Trash2 className="h-4 w-4" />
                {t('redis.purgeButton', 'Purge Redis (L2)')}
              </UiButton>

              <UiButton
                type="button"
                variant="danger"
                onClick={openPurgeAll}
                disabled={isPurging}
                className="gap-1.5 !bg-red-700 hover:!bg-red-800"
                title={t('redis.purgeAllButtonTitle', 'Delete every vehicle:*:signals HSET in Redis (L2). Requires typed confirmation.')}
              >
                <Trash2 className="h-4 w-4" />
                {t('redis.purgeAllButton', 'Purge All Redis')}
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
                    date: formatTime(meta.l1_last_seen_at),
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
                value={showStatPlaceholder ? '—' : fmtInt(signalData?.signal_count ?? 0)}
                icon={<Database className="h-5 w-5" />}
              />
              <StatCard
                label={t('redis.numbers', 'Numbers')}
                value={showStatPlaceholder ? '—' : fmtInt(rows.filter((r) => r.type === 'number').length)}
              />
              <StatCard
                label={t('redis.strings', 'Strings')}
                value={showStatPlaceholder ? '—' : fmtInt(rows.filter((r) => r.type === 'string').length)}
              />
              <StatCard
                label={t('redis.booleans', 'Booleans')}
                value={showStatPlaceholder ? '—' : fmtInt(rows.filter((r) => r.type === 'boolean').length)}
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
              rows.length === 0 || isError ? (
                <RedisDiagnosticEmptyState
                  vehicleId={selectedVehicleId!}
                  meta={meta}
                  onSelectVehicle={setSelectedVehicleId}
                  {...errorBannerProps}
                />
              ) : (
                <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                  icon={<Search className="h-10 w-10" />}
                  message={t('redis.noMatch', 'No signals match the current filter')}
                />
              )
            ) : (
              <DataTable
                tableId="admin:redis-signals"
                data={filteredRows}
                columns={columns}
                keyExtractor={(row) => row.name}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={onSort}
                pagination={{ defaultPageSize: 50 }}
                virtualized
                rowHeight={48}
              />
            )}
          </GlassPanel>
        </FadeIn>
      </div>

      <ConfirmDialog
        open={purgeMode !== null}
        variant="danger"
        loading={isPurging}
        title={
          purgeMode === 'all'
            ? t('redis.purgeAllTitle', 'Purge ALL Redis (L2) caches?')
            : t('redis.purgeTitle', 'Purge Redis (L2) cache for {{vehicle}}?', { vehicle: purgeTargetLabel })
        }
        message={
          purgeMode === 'all'
            ? t(
                'redis.purgeAllMessage',
                'This deletes every vehicle:*:signals HSET in Redis (the L2 cache). The L1 in-memory cache on each pod is NOT touched and will refill as new telemetry arrives. Read-paths on other pods may briefly read stale L1 values until the next signal arrives. If more than 1000 keys exist, you may need to click Purge All Redis again to drain.',
              )
            : t(
                'redis.purgeMessage',
                'This deletes the Redis HSET for this vehicle (L2 cache only). The L1 in-memory cache on this pod is NOT touched and will refill as new telemetry arrives. Read-paths on other pods may briefly read stale L1 values until the next signal arrives.',
              )
        }
        confirmLabel={
          purgeMode === 'all'
            ? t('redis.purgeAllConfirm', 'Purge All Vehicles')
            : t('redis.purgeConfirm', 'Purge Redis (L2)')
        }
        cancelLabel={t('common.cancel', 'Cancel')}
        requireTypedConfirmation={purgeMode === 'all' ? 'PURGE ALL' : undefined}
        typedConfirmationLabel={
          purgeMode === 'all'
            ? t('redis.purgeAllTypedLabel', 'Type PURGE ALL to confirm')
            : undefined
        }
        onConfirm={handlePurgeConfirm}
        onCancel={() => {
          if (isPurging) return
          setPurgeMode(null)
          setPurgeTargetId(null)
          setPurgeTargetLabel('')
        }}
      />
    </PageContainer>
  )
}
