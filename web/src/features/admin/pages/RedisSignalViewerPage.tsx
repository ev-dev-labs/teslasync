import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import {
  Database,
  Hash,
  Layers,
  RefreshCw,
  Search,
  Server,
  ToggleLeft,
  Trash2,
  Type as TypeIcon,
} from 'lucide-react'

import { PageContainer } from '@/components/layout'
import {
  Badge,
  Button,
  Code,
  ConfirmDialog,
  DataTable,
  GlassPanel,
  HelperText,
  Input,
  MaskedValue,
  PanelTitle,
  Select,
  Text,
  Toggle,
  useSortToggle,
  type Column,
} from '@/components/ui'
import {
  DataFreshnessAuto,
  KVList,
  MetricBar,
  MetricCard,
} from '@/components/data-display'
import { EmptyState, QueryError, Skeleton } from '@/components/feedback'
import { useToast } from '@/components/feedback/Toast'
import { FadeIn } from '@/components/motion'
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle'
import {
  useRedisSignals,
  usePurgeAllRedisSignals,
  usePurgeRedisSignals,
  type RedisSignalEntry,
} from '@/api/hooks/useRedisSignals'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useDateFormat } from '@/hooks/useDateFormat'
import { fmtInt } from '@/lib/numberFormat'
import { isApiError, type ApiError } from '@/lib/resilience'
import { RedisDiagnosticEmptyState, type DiagnosticErrorProps } from '../components/RedisDiagnosticEmptyState'

/* ─── signal categorization ─────────────────────────────────────────── */

type SignalCategory = 'Battery' | 'Charging' | 'Driving' | 'Climate' | 'Other'

const CATEGORY_ORDER: SignalCategory[] = ['Battery', 'Charging', 'Driving', 'Climate', 'Other']

const CATEGORY_COLORS: Record<SignalCategory, 'success' | 'info' | 'warning' | 'neutral' | 'danger'> = {
  Battery: 'success',
  Charging: 'info',
  Driving: 'warning',
  Climate: 'danger',
  Other: 'neutral',
}

// Toned-down hex per category for the breakdown bars. Passed as a dynamic
// `color` prop to the shared <MetricBar>, never an inline static style, so
// the bars stay on-palette with the category badges without neon body text.
const CATEGORY_BAR_COLOR: Record<SignalCategory, string> = {
  Battery: '#10b981',
  Charging: '#06b6d4',
  Driving: '#f59e0b',
  Climate: '#f43f5e',
  Other: '#64748b',
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
      render: (row) => <Text mono size="sm" color="primary">{row.name}</Text>,
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
              : 'text-amber-300'
        return (
          <Text mono size="sm" className={colorClass}>
            {String(row.value)}
          </Text>
        )
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
          {t(`redis.categoryName.${row.category}`, row.category)}
        </Badge>
      ),
    },
  ]
}

/* ═══════════════════════════════════════════════════════════════════════
   Redis Signal Viewer Page — modern-ui full-width bento redesign
   ═══════════════════════════════════════════════════════════════════════ */

export default function RedisSignalViewerPage() {
  const { t } = useTranslation()
  usePageTitle(t('redis.title', 'Redis Signal Viewer'))
  const { formatDateTime } = useDateFormat()

  const {
    vehicleId: selectedVehicleId,
    vehicles: vehicleList,
    setVehicleId: setSelectedVehicleId,
  } = useSelectedVehicle()
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

  // Data flows exclusively through the @/api/hooks layer. The read query
  // key stays ['redis-signals', vehicleId] so the purge invalidations below
  // still trigger the expected refetch.
  const signalQuery = useRedisSignals(selectedVehicleId, autoRefresh)
  const {
    data: signalData,
    isLoading,
    isFetching,
    error,
    isError,
    refetch,
  } = signalQuery
  const purgeOne = usePurgeRedisSignals()
  const purgeAll = usePurgeAllRedisSignals()

  const selectedVehicle = useMemo(
    () => vehicleList.find((v) => v.id === selectedVehicleId),
    [vehicleList, selectedVehicleId],
  )
  const selectedVehicleLabel =
    selectedVehicle?.display_name ||
    selectedVehicle?.vin ||
    (selectedVehicleId !== null ? t('redis.vehicleFallback', 'Vehicle {{id}}', { id: selectedVehicleId }) : '')

  const handlePurgeConfirm = async () => {
    if (purgeMode === null) return
    setIsPurging(true)
    try {
      if (purgeMode === 'one' && purgeTargetId !== null) {
        const res = await purgeOne.mutateAsync(purgeTargetId)
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
        const res = await purgeAll.mutateAsync()
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
    const counts: Record<SignalCategory, number> = { Battery: 0, Charging: 0, Driving: 0, Climate: 0, Other: 0 }
    for (const row of rows) {
      counts[row.category] = (counts[row.category] ?? 0) + 1
    }
    return counts
  }, [rows])

  const typeCounts = useMemo(() => {
    const counts = { number: 0, string: 0, boolean: 0 }
    for (const row of rows) {
      if (row.type === 'number') counts.number += 1
      else if (row.type === 'string') counts.string += 1
      else if (row.type === 'boolean') counts.boolean += 1
    }
    return counts
  }, [rows])

  const columns = useMemo(() => buildColumns(t), [t])
  const { sortKey, sortDir, onSort } = useSortToggle('name', 'asc')

  const meta = signalData?.meta

  // When the upstream query failed, the diagnostic
  // banner takes over so the operator sees the real failure mode (cache
  // not wired, redis unreachable, generic 5xx, network) instead of the
  // legacy "no signals cached" black box. Metric cards also display a
  // placeholder so the top-of-page numbers don't lie about a 0 count.
  const errorBannerProps: DiagnosticErrorProps = !isError
    ? {}
    : isApiError(error)
      ? { serverError: error as ApiError }
      : { serverError: null, networkError: true }
  const showStatPlaceholder = isLoading || isError

  const vehicleOptions = vehicleList.map((v) => ({
    value: String(v.id),
    label: v.display_name || v.vin || t('redis.vehicleFallback', 'Vehicle {{id}}', { id: v.id }),
  }))

  /* ─── toolbar (header actions) ─── */

  const actions = (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
      <Select
        aria-label={t('redis.selectVehicleLabel', 'Select vehicle')}
        className="min-w-[11rem]"
        value={selectedVehicleId !== null ? String(selectedVehicleId) : ''}
        onChange={(e) => {
          const val = e.target.value
          setSelectedVehicleId(val ? Number(val) : null)
        }}
        options={[{ value: '', label: t('redis.selectVehicle', 'Select vehicle…') }, ...vehicleOptions]}
      />
      <Toggle
        label={t('redis.autoRefresh', 'Auto-refresh')}
        checked={autoRefresh}
        onChange={setAutoRefresh}
      />
      {selectedVehicleId !== null && <DataFreshnessAuto query={signalQuery} />}
      <Button
        type="button"
        variant="ghost"
        aria-label={t('redis.refresh', 'Refresh')}
        onClick={() => refetch()}
        disabled={selectedVehicleId === null || isFetching}
      >
        <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
        <span className="hidden sm:inline">{t('redis.refresh', 'Refresh')}</span>
      </Button>
    </div>
  )

  return (
    <PageContainer
      title={t('redis.title', 'Redis Signal Viewer')}
      subtitle={t('redis.subtitle', 'Inspect cached signal values in Redis (L2)')}
      actions={actions}
    >
      {/* 1 — KPI band: full-width responsive metric grid */}
      <FadeIn>
        <section
          aria-label={t('redis.kpis', 'Cache metrics')}
          className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6"
        >
          <MetricCard
            label={t('redis.totalSignals', 'Total Signals')}
            value={showStatPlaceholder ? '—' : fmtInt(signalData?.signal_count ?? 0)}
            icon={<Database className="h-5 w-5" aria-hidden="true" />}
            color="cyan"
          />
          <MetricCard
            label={t('redis.numbers', 'Numbers')}
            value={showStatPlaceholder ? '—' : fmtInt(typeCounts.number)}
            icon={<Hash className="h-5 w-5" aria-hidden="true" />}
            color="cyan"
          />
          <MetricCard
            label={t('redis.strings', 'Strings')}
            value={showStatPlaceholder ? '—' : fmtInt(typeCounts.string)}
            icon={<TypeIcon className="h-5 w-5" aria-hidden="true" />}
            color="amber"
          />
          <MetricCard
            label={t('redis.booleans', 'Booleans')}
            value={showStatPlaceholder ? '—' : fmtInt(typeCounts.boolean)}
            icon={<ToggleLeft className="h-5 w-5" aria-hidden="true" />}
            color="purple"
          />
          <MetricCard
            label={t('redis.l1Signals', 'L1 Signals')}
            value={showStatPlaceholder || !meta ? '—' : fmtInt(meta.l1_signal_count)}
            subtitle={t('redis.l1Subtitle', 'In-process store')}
            icon={<Layers className="h-5 w-5" aria-hidden="true" />}
            color="blue"
          />
          <MetricCard
            label={t('redis.l2Fields', 'L2 Fields')}
            value={showStatPlaceholder || !meta ? '—' : fmtInt(meta.redis_field_count)}
            subtitle={t('redis.l2Subtitle', 'Redis HSET')}
            icon={<Server className="h-5 w-5" aria-hidden="true" />}
            color="green"
          />
        </section>
      </FadeIn>

      {/* 2 — Main bento: signals table (hero) + cache side column */}
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3 3xl:grid-cols-4">
        {/* Hero — cached signals table with its own filter row */}
        <FadeIn delay={0.05} className="xl:col-span-2 3xl:col-span-3">
          <GlassPanel className="p-4 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <PanelTitle className="flex items-center gap-2">
                <Database className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t('redis.cachedSignals', 'Cached Signals')}
              </PanelTitle>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-muted)]" aria-hidden="true" />
                  <Input
                    aria-label={t('redis.searchLabel', 'Filter signals by name')}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t('redis.searchPlaceholder', 'Filter signals…')}
                    className="pl-9 sm:w-56"
                  />
                </div>
                <Select
                  aria-label={t('redis.categoryLabel', 'Filter by category')}
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  options={[
                    { value: 'all', label: t('redis.allCategories', 'All Categories') },
                    ...CATEGORY_ORDER.map((c) => ({
                      value: c,
                      label: `${t(`redis.categoryName.${c}`, c)} (${categoryCounts[c] ?? 0})`,
                    })),
                  ]}
                />
              </div>
            </div>

            <div className="mt-4">
              {selectedVehicleId === null ? (
                <EmptyState /* no-action: transient empty state — surfaces when no vehicle is selected; no specific recovery action available */
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
                    vehicleId={selectedVehicleId}
                    meta={meta}
                    onSelectVehicle={setSelectedVehicleId}
                    {...errorBannerProps}
                  />
                ) : (
                  <EmptyState /* no-action: transient empty state — surfaces when the filter excludes every row; clearing the filter recovers */
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
            </div>
          </GlassPanel>
        </FadeIn>

        {/* Side column — diagnostics, category mix, destructive cache actions */}
        <div className="space-y-4 xl:col-span-1">
          {/* Cache diagnostics — folds the mode / VIN / last-seen chips into a
              richer meta readout that stays visible alongside the table. */}
          <FadeIn delay={0.1}>
            <GlassPanel className="p-4 sm:p-5">
              <PanelTitle className="flex items-center gap-2">
                <Server className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t('redis.cacheDiagnostics', 'Cache Diagnostics')}
              </PanelTitle>
              <div className="mt-3">
                {selectedVehicleId === null ? (
                  <EmptyState /* no-action: transient — no vehicle selected yet */
                    icon={<Server className="h-8 w-8" />}
                    message={t('redis.diagSelect', 'Select a vehicle to inspect its cache state')}
                  />
                ) : isError ? (
                  <QueryError error={error} onRetry={() => refetch()} resourceName={t('redis.resourceName', 'Redis signals')} />
                ) : isLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-6 w-full" />
                    <Skeleton className="h-6 w-full" />
                    <Skeleton className="h-6 w-full" />
                  </div>
                ) : meta ? (
                  <KVList
                    items={[
                      {
                        label: t('redis.diag.mode', 'Live store mode'),
                        value: (
                          <Badge size="sm" variant={meta.live_signal_store_mode === 'hybrid' ? 'success' : 'danger'}>
                            {meta.live_signal_store_mode}
                          </Badge>
                        ),
                      },
                      { label: t('redis.diag.vin', 'VIN'), value: meta.vehicle_vin ? <Code>{meta.vehicle_vin}</Code> : '—' },
                      { label: t('redis.diag.key', 'Redis key'), value: <Code>{meta.redis_key}</Code> },
                      { label: t('redis.diag.l1', 'L1 signals'), value: fmtInt(meta.l1_signal_count) },
                      { label: t('redis.diag.l2', 'L2 fields (raw)'), value: fmtInt(meta.redis_field_count) },
                      { label: t('redis.diag.l1Seen', 'L1 last seen'), value: meta.l1_last_seen_at ? formatDateTime(meta.l1_last_seen_at) : '—' },
                      { label: t('redis.diag.l2Seen', 'L2 last seen'), value: meta.l2_last_seen_at ? formatDateTime(meta.l2_last_seen_at) : '—' },
                    ]}
                  />
                ) : (
                  <EmptyState /* no-action: backend predates the meta block; nothing to configure */
                    icon={<Server className="h-8 w-8" />}
                    message={t('redis.diagUnavailable', 'Cache diagnostics are unavailable for this vehicle')}
                  />
                )}
              </div>
            </GlassPanel>
          </FadeIn>

          {/* Signal categories — surfaces the category mix that previously
              only lived inside the filter dropdown labels. */}
          <FadeIn delay={0.15}>
            <GlassPanel className="p-4 sm:p-5">
              <PanelTitle className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t('redis.categories', 'Signal Categories')}
              </PanelTitle>
              <div className="mt-3">
                {selectedVehicleId === null ? (
                  <EmptyState /* no-action: transient — no vehicle selected yet */
                    icon={<Layers className="h-8 w-8" />}
                    message={t('redis.catSelect', 'Select a vehicle to see its signal category mix')}
                  />
                ) : isLoading ? (
                  <div className="space-y-3">
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                  </div>
                ) : rows.length === 0 ? (
                  <EmptyState /* no-action: transient — no categorized signals cached */
                    icon={<Layers className="h-8 w-8" />}
                    message={t('redis.catEmpty', 'No categorized signals to summarize')}
                  />
                ) : (
                  <div className="space-y-3">
                    {CATEGORY_ORDER.map((cat) => (
                      <MetricBar
                        key={cat}
                        label={t(`redis.categoryName.${cat}`, cat)}
                        value={categoryCounts[cat] ?? 0}
                        max={Math.max(rows.length, 1)}
                        color={CATEGORY_BAR_COLOR[cat]}
                        sublabel={fmtInt(categoryCounts[cat] ?? 0)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </GlassPanel>
          </FadeIn>

          {/* Danger zone — destructive cache actions behind explicit confirm.
              Per-vehicle uses the standard danger-confirm; cluster-wide
              PurgeAll requires the operator to type "PURGE ALL". */}
          <FadeIn delay={0.2}>
            <GlassPanel className="border border-rose-500/20 bg-rose-500/5 p-4 sm:p-5">
              <PanelTitle className="flex items-center gap-2">
                <Trash2 className="h-4 w-4 text-rose-300" aria-hidden="true" />
                {t('redis.cacheActions', 'Cache Actions')}
              </PanelTitle>
              <HelperText className="mt-2">
                {t('redis.cacheActionsHint', 'Purge deletes the Redis L2 HSET only. The in-process L1 cache on each pod is untouched and refills from new telemetry.')}
              </HelperText>
              <div className="mt-3 flex flex-col gap-2">
                <Button
                  type="button"
                  variant="danger"
                  onClick={openPurgeOne}
                  disabled={selectedVehicleId === null || isPurging}
                  className="justify-center"
                  title={t('redis.purgeButtonTitle', 'Delete this vehicle\u2019s cached signals from Redis (L2). The in-process L1 cache on each pod stays put and refills from new telemetry.')}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  {t('redis.purgeButton', 'Purge Redis (L2)')}
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  onClick={openPurgeAll}
                  disabled={isPurging}
                  className="justify-center !bg-red-700 hover:!bg-red-800"
                  title={t('redis.purgeAllButtonTitle', 'Delete every vehicle:*:signals HSET in Redis (L2). Requires typed confirmation.')}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                  {t('redis.purgeAllButton', 'Purge All Redis')}
                </Button>
              </div>
            </GlassPanel>
          </FadeIn>
        </div>
      </section>

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
