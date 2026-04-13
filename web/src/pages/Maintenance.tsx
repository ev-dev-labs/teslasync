import { useState, useMemo, useCallback, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVehicles, getVehicleState, getDrives, getMileageStats, getDailyMileage } from '../api'
import type { Vehicle } from '../api'
import { PageHeader, GlassPanel, FadeIn, Skeleton, StatCard, EmptyState, QueryError, Badge, AlertBanner, Button, Select, Input, DataTable, type Column } from '../components/ui'
import {
  Wrench, RefreshCw, Wind, Droplets, CloudRain, Crosshair, Snowflake,
  Thermometer, Gauge, CheckCircle, AlertTriangle, Clock, Plus,
  Calendar, Car, TrendingUp, DollarSign,
} from 'lucide-react'
import clsx from 'clsx'
import { useSettings } from '../hooks/useSettings'
import { useVehicleLive } from '../hooks/useVehicleLive'
import { formatDate } from '../lib/dateFormat'
import { fmtNumber, fmtInt } from '../lib/numberFormat'
import { UNITS } from '../lib/constants'
import { usePageTitle } from '../hooks/usePageTitle'

/* ────────────────────────────── Types ────────────────────────────── */

interface MaintenanceItem {
  id: string
  name: string
  description: string
  intervalKm: number | null
  intervalMonths: number | null
  icon: React.ComponentType<{ className?: string }>
  category: 'tires' | 'fluids' | 'filters' | 'exterior' | 'inspection'
  estimatedCostUsd: number
}

interface ServiceRecord {
  itemId: string
  date: string
  odometerKm: number
  notes: string
}

/* ────────────────────────── Maintenance schedule ────────────────────────── */

const MAINTENANCE_SCHEDULE: MaintenanceItem[] = [
  { id: 'tire-rotation', name: 'Tire Rotation', description: 'Rotate tires for even wear', intervalKm: 10000, intervalMonths: 12, icon: RefreshCw, category: 'tires', estimatedCostUsd: 50 },
  { id: 'cabin-filter', name: 'Cabin Air Filter', description: 'Replace cabin air filter', intervalKm: 30000, intervalMonths: 24, icon: Wind, category: 'filters', estimatedCostUsd: 60 },
  { id: 'brake-fluid', name: 'Brake Fluid Check', description: 'Test brake fluid moisture content', intervalKm: null, intervalMonths: 24, icon: Droplets, category: 'fluids', estimatedCostUsd: 100 },
  { id: 'wiper-blades', name: 'Wiper Blades', description: 'Replace windshield wiper blades', intervalKm: null, intervalMonths: 12, icon: CloudRain, category: 'exterior', estimatedCostUsd: 30 },
  { id: 'wheel-alignment', name: 'Wheel Alignment', description: 'Check and adjust wheel alignment', intervalKm: 20000, intervalMonths: 24, icon: Crosshair, category: 'tires', estimatedCostUsd: 150 },
  { id: 'hvac-desiccant', name: 'A/C Desiccant Bag', description: 'Replace A/C desiccant bag', intervalKm: null, intervalMonths: 48, icon: Snowflake, category: 'filters', estimatedCostUsd: 40 },
  { id: 'coolant', name: 'Battery Coolant', description: 'Check battery coolant level and condition', intervalKm: 80000, intervalMonths: 48, icon: Thermometer, category: 'fluids', estimatedCostUsd: 120 },
  { id: 'tire-pressure-check', name: 'Tire Pressure Check', description: 'Verify and adjust tire pressure', intervalKm: 5000, intervalMonths: 3, icon: Gauge, category: 'tires', estimatedCostUsd: 0 },
]

const STORAGE_KEY = 'teslasync-maintenance-log'
const ICE_ANNUAL_COST = 1200

/* ────────────────────────── Helpers ────────────────────────── */

function monthsFromNow(iso: string): number {
  const d = new Date(iso)
  const now = new Date()
  return (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth())
}

/** Compute % progress toward the next service for a single item. 0 = just serviced, 100+ = overdue */
function computeProgress(
  item: MaintenanceItem,
  lastRecord: ServiceRecord | undefined,
  currentOdometerKm: number,
): { pctKm: number; pctTime: number; pct: number; kmRemaining: number | null; monthsRemaining: number | null } {
  let pctKm = 0
  let pctTime = 0
  let kmRemaining: number | null = null
  let monthsRemaining: number | null = null
  if (item.intervalKm!== null) {
    const lastKm = lastRecord ? lastRecord.odometerKm : 0
    const driven = currentOdometerKm - lastKm
    pctKm = Math.min((driven / item.intervalKm) * 100, 150)
    kmRemaining = item.intervalKm - driven
  }

  if (item.intervalMonths !== null) {
    const lastDate = lastRecord ? lastRecord.date : new Date(Date.now() - 365 * 86400000).toISOString()
    const elapsed = monthsFromNow(lastDate)
    pctTime = Math.min((elapsed / item.intervalMonths) * 100, 150)
    monthsRemaining = item.intervalMonths - elapsed
  }

  const pct = Math.max(pctKm, pctTime)
  return { pctKm, pctTime, pct, kmRemaining, monthsRemaining }
}

function statusFromPct(pct: number): 'good' | 'soon' | 'overdue' {
  if (pct >= 100) return 'overdue'
  if (pct >= 80) return 'soon'
  return 'good'
}

const statusConfig = {
  good: { color: 'text-neon-green', bg: 'bg-neon-green/15', label: 'Up to date' },
  soon: { color: 'text-neon-amber', bg: 'bg-neon-amber/15', label: 'Due soon' },
  overdue: { color: 'text-neon-red', bg: 'bg-neon-red/15', label: 'Overdue' },
}

/* ────────────────────────── Sub-components ────────────────────────── */

function ProgressBar({ pct, className }: { pct: number; className?: string }) {
  const clamped = Math.min(pct, 100)
  const color = pct >= 100 ? 'bg-neon-red' : pct >= 80 ? 'bg-neon-amber' : 'bg-neon-green'
  const glow = pct >= 100
    ? 'shadow-[0_0_8px_rgba(239,68,68,.5)]'
    : pct >= 80
      ? 'shadow-[0_0_8px_rgba(245,158,11,.4)]'
      : 'shadow-[0_0_6px_rgba(16,185,129,.35)]'

  return (
    <div className={clsx('w-full h-2 rounded-full bg-white/5 overflow-hidden', className)}>
      <div
        className={clsx('h-full rounded-full transition-all duration-700', color, glow)}
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}

function CategoryBadge({ category }: { category: string }) {
  const colorMap: Record<string, 'cyan' | 'purple' | 'green' | 'amber' | 'red'> = {
    tires: 'cyan', fluids: 'purple', filters: 'green', exterior: 'amber', inspection: 'red',
  }
  return <Badge color={colorMap[category] ?? 'cyan'}>{category}</Badge>
}

/* ────────────────────────── Main component ────────────────────────── */

export default function Maintenance() {
  usePageTitle('Maintenance')
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null)
  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null
  const { state: live } = useVehicleLive(vehicleId ?? undefined)

  const { convertDistance, distanceUnit, isMiles } = useSettings()

  /* ── Service log (localStorage) ── */
  const [serviceLog, setServiceLog] = useState<ServiceRecord[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved ? JSON.parse(saved) : []
    } catch { return [] }
  })

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serviceLog))
  }, [serviceLog])

  /* ── Form state ── */
  const [showForm, setShowForm] = useState(false)
  const [formItemId, setFormItemId] = useState(MAINTENANCE_SCHEDULE[0].id)
  const [formDate, setFormDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [formOdometer, setFormOdometer] = useState('')
  const [formNotes, setFormNotes] = useState('')

  /* ── Sorting state for table ── */
  const [sortCol, setSortCol] = useState<'name' | 'category' | 'interval' | 'status'>('status')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  /* ── API queries ── */
  const { data: stateResp, isLoading: loadingState, error: stateError, refetch } = useQuery({
    queryKey: ['vehicle-state', vehicleId],
    queryFn: () => getVehicleState(vehicleId!),
    enabled: vehicleId !== null,
    refetchInterval: 30000,
  })

  const { data: drives } = useQuery({
    queryKey: ['drives-recent', vehicleId],
    queryFn: () => getDrives(vehicleId!, 5),
    enabled: vehicleId !== null,
  })

  const { data: mileageStats, isLoading: loadingStats } = useQuery({
    queryKey: ['mileage-stats', vehicleId],
    queryFn: () => getMileageStats(vehicleId!),
    enabled: vehicleId !== null,
  })

  const { data: dailyMileage } = useQuery({
    queryKey: ['daily-mileage-recent', vehicleId],
    queryFn: () => getDailyMileage(vehicleId!, 90),
    enabled: vehicleId !== null,
  })

  /* ── Derive current odometer (km) ── */
  const currentOdometerKm = useMemo(() => {
    if (live.odometer) return live.odometer
    if (stateResp?.state?.odometer) return stateResp.state.odometer
    if (dailyMileage?.length) return dailyMileage[0].odometer_end
    if (drives?.length) {
      const totalDist = drives.reduce((s, d) => s + d.distance, 0)
      if (mileageStats?.total_distance) return mileageStats.total_distance
      return totalDist
    }
    return mileageStats?.total_distance ?? 0
  }, [live, stateResp, dailyMileage, drives, mileageStats])

  /* ── Avg daily km ── */
  const avgDailyKm = mileageStats?.avg_daily ?? 0

  /* ── Compute status for each item ── */
  const itemStatuses = useMemo(() => {
    return MAINTENANCE_SCHEDULE.map(item => {
      const records = serviceLog.filter(r => r.itemId === item.id).sort((a, b) => b.date.localeCompare(a.date))
      const lastRecord = records[0]
      const progress = computeProgress(item, lastRecord, currentOdometerKm)
      const status = statusFromPct(progress.pct)
      return { item, lastRecord, progress, status, records }
    })
  }, [serviceLog, currentOdometerKm])

  /* ── Summary counts ── */
  const counts = useMemo(() => {
    let good = 0, soon = 0, overdue = 0
    for (const s of itemStatuses) {
      if (s.status === 'good') good++
      else if (s.status === 'soon') soon++
      else overdue++
    }
    return { good, soon, overdue }
  }, [itemStatuses])

  /* ── Next service item ── */
  const nextService = useMemo(() => {
    const sorted = [...itemStatuses].sort((a, b) => b.progress.pct - a.progress.pct)
    return sorted[0]
  }, [itemStatuses])

  /* ── Sorted items for table ── */
  const sortedItems = useMemo(() => {
    const copy = [...itemStatuses]
    copy.sort((a, b) => {
      let cmp = 0
      switch (sortCol) {
        case 'name': cmp = a.item.name.localeCompare(b.item.name); break
        case 'category': cmp = a.item.category.localeCompare(b.item.category); break
        case 'interval': cmp = (a.item.intervalKm ?? 999999) - (b.item.intervalKm ?? 999999); break
        case 'status': cmp = a.progress.pct - b.progress.pct; break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [itemStatuses, sortCol, sortDir])

  /* ── Upcoming items sorted by urgency ── */
  const upcomingItems = useMemo(() => {
    return [...itemStatuses].sort((a, b) => b.progress.pct - a.progress.pct)
  }, [itemStatuses])

  /* ── History sorted by date ── */
  const sortedHistory = useMemo(() => {
    return [...serviceLog].sort((a, b) => b.date.localeCompare(a.date))
  }, [serviceLog])

  /* ── Annual cost estimate ── */
  const annualCost = useMemo(() => {
    let total = 0
    for (const item of MAINTENANCE_SCHEDULE) {
      const months = item.intervalMonths ?? 12
      const yearlyFraction = 12 / months
      total += item.estimatedCostUsd * yearlyFraction
    }
    return total
  }, [])

  const savingsVsIce = Math.round(((ICE_ANNUAL_COST - annualCost) / ICE_ANNUAL_COST) * 100)

  /* ── Mileage projection for each item ── */
  const projections = useMemo(() => {
    if (avgDailyKm <= 0) return null
    return itemStatuses.map(({ item, progress }) => {
      let daysUntilDue: number | null = null
      if (progress.kmRemaining !== null && progress.kmRemaining > 0) {
        daysUntilDue = Math.ceil(progress.kmRemaining / avgDailyKm)
      }
      if (progress.monthsRemaining !== null && progress.monthsRemaining > 0) {
        const timeDays = progress.monthsRemaining * 30
        if (daysUntilDue === null || timeDays < daysUntilDue) daysUntilDue = timeDays
      }
      const estDate = daysUntilDue !== null && daysUntilDue > 0
        ? new Date(Date.now() + daysUntilDue * 86400000).toISOString()
        : null
      return { item, daysUntilDue, estDate }
    })
  }, [itemStatuses, avgDailyKm])

  /* ── Handlers ── */
  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col as typeof sortCol); setSortDir('desc') }
  }

  const handleAddRecord = useCallback(() => {
    const odomKm = parseFloat(formOdometer)
    if (isNaN(odomKm) || odomKm <= 0) return
    const record: ServiceRecord = {
      itemId: formItemId,
      date: formDate,
      odometerKm: isMiles ? odomKm : odomKm / UNITS.MI_TO_KM,
      notes: formNotes.trim(),
    }
    setServiceLog(prev => [...prev, record])
    setFormNotes('')
    setShowForm(false)
  }, [formItemId, formDate, formOdometer, formNotes, isMiles])

  const handleDeleteRecord = useCallback((idx: number) => {
    setServiceLog(prev => prev.filter((_, i) => i !== idx))
  }, [])

  const isLoading = loadingState || loadingStats

  /* ────────────────────────── RENDER ────────────────────────── */

  return (
    <FadeIn>
      {/* Header */}
      <PageHeader
        title="Maintenance"
        subtitle="Service schedule, maintenance tracking, and service history"
        icon={<Wrench className="h-7 w-7 text-neon-cyan" />}
        actions={
          vehicles && vehicles.length > 1 ? (
            <Select
              value={vehicleId ?? ''}
              onChange={e => setSelectedVehicle(Number(e.target.value))}
              options={vehicles.map((v: Vehicle) => ({ value: String(v.id), label: v.display_name || v.vin }))}
            />
          ) : undefined
        }
      />

      {stateError && <QueryError error={stateError} onRetry={refetch} />}

      {/* ── Current Odometer ── */}
      <GlassPanel className="p-5 sm:p-6 mb-6 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Car className="h-6 w-6 text-neon-cyan" />
          <div>
            <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Current Odometer</p>
            {isLoading ? (
              <Skeleton className="h-8 w-40 mt-1 rounded" />
            ) : (
              <p className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
                {fmtInt(convertDistance(currentOdometerKm))}
                <span className="text-base font-normal ml-1" style={{ color: 'var(--text-secondary)' }}>{distanceUnit}</span>
              </p>
            )}
          </div>
        </div>
        {avgDailyKm > 0 && (
          <div className="text-right">
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Average daily</p>
            <p className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              {fmtNumber(convertDistance(avgDailyKm))} {distanceUnit}/day
            </p>
          </div>
        )}
      </GlassPanel>

      {/* ── Service Overview Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <StatCard
          label="Up to Date"
          value={String(counts.good)}
          icon={<CheckCircle className="h-5 w-5" />}
          color="green"
          subtitle="items on schedule"
        />
        <StatCard
          label="Due Soon"
          value={String(counts.soon)}
          icon={<Clock className="h-5 w-5" />}
          color="amber"
          subtitle="within 20% of interval"
        />
        <StatCard
          label="Overdue"
          value={String(counts.overdue)}
          icon={<AlertTriangle className="h-5 w-5" />}
          color="red"
          subtitle="past service interval"
        />
        <StatCard
          label="Next Service"
          value={nextService ? nextService.item.name : '—'}
          icon={<TrendingUp className="h-5 w-5" />}
          color="cyan"
          subtitle={
            nextService
              ? nextService.status === 'overdue'
                ? 'Overdue!'
                : `${Math.round(nextService.progress.pct)}% of interval`
              : ''
          }
        />
      </div>

      {/* ── Overdue Alert ── */}
      {counts.overdue > 0 && (
        <AlertBanner variant="danger" icon={<AlertTriangle className="h-5 w-5" />} className="mb-6">
          {counts.overdue} maintenance {counts.overdue === 1 ? 'item is' : 'items are'} overdue. Schedule service soon.
        </AlertBanner>
      )}

      {/* ── Upcoming Maintenance ── */}
      <GlassPanel className="p-5 sm:p-6 mb-6">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <Clock className="h-4 w-4 text-neon-cyan" />
          Upcoming Maintenance
        </h3>
        <div className="space-y-3">
          {upcomingItems.map(({ item, lastRecord, progress, status }) => {
            const Icon = item.icon
            const cfg = statusConfig[status]
            return (
              <GlassPanel key={item.id} className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className={clsx('p-2 rounded-lg shrink-0', cfg.bg)}>
                    <Icon className={clsx('h-5 w-5', cfg.color)} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{item.name}</p>
                    <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{item.description}</p>
                  </div>
                </div>

                <div className="flex-1 min-w-[140px]">
                  <ProgressBar pct={progress.pct} className="mb-1" />
                  <div className="flex justify-between text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    <span>
                      {lastRecord ? `Last: ${formatDate(lastRecord.date)}` : 'Never serviced'}
                    </span>
                    <span>{Math.round(progress.pct)}%</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {status === 'overdue' ? (
                    <Badge color="red" className="animate-pulse">Overdue</Badge>
                  ) : (
                    <span className="text-xs whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                      {progress.kmRemaining !== null && progress.kmRemaining > 0
                        ? `${fmtInt(convertDistance(progress.kmRemaining))} ${distanceUnit}`
                        : ''}
                      {progress.kmRemaining !== null && progress.kmRemaining > 0 && progress.monthsRemaining !== null && progress.monthsRemaining > 0
                        ? ' / '
                        : ''}
                      {progress.monthsRemaining !== null && progress.monthsRemaining > 0
                        ? `${progress.monthsRemaining} mo`
                        : ''}
                    </span>
                  )}
                </div>
              </GlassPanel>
            )
          })}
        </div>
      </GlassPanel>

      {/* ── Maintenance Schedule Table ── */}
      <GlassPanel className="p-5 sm:p-6 mb-6 overflow-x-auto">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <Calendar className="h-4 w-4 text-neon-cyan" />
          Maintenance Schedule
        </h3>
        <DataTable
          columns={[
            { key: 'name', header: 'Item', sortable: true, render: ({ item, status }) => {
              const cfg = statusConfig[status]
              return <div className="flex items-center gap-2"><item.icon className={clsx('h-4 w-4 shrink-0', cfg.color)} /><span className="font-medium">{item.name}</span></div>
            }},
            { key: 'category', header: 'Category', sortable: true, render: ({ item }) => <CategoryBadge category={item.category} /> },
            { key: 'interval', header: 'Interval', sortable: true, render: ({ item }) => <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{item.intervalKm !== null && <span>{fmtInt(convertDistance(item.intervalKm))} {distanceUnit}</span>}{item.intervalKm !== null && item.intervalMonths !== null && ' / '}{item.intervalMonths !== null && <span>{item.intervalMonths} mo</span>}</span> },
            { key: 'status', header: 'Status', sortable: true, render: ({ status }) => <Badge color={status === 'overdue' ? 'red' : status === 'soon' ? 'amber' : 'green'}>{statusConfig[status].label}</Badge> },
            { key: 'lastService', header: 'Last Service', render: ({ lastRecord }) => <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{lastRecord ? formatDate(lastRecord.date) : '—'}</span> },
            { key: 'nextDue', header: 'Next Due', render: ({ status, progress }) => <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{status === 'overdue' ? <span className="text-neon-red font-semibold">Now</span> : progress.kmRemaining !== null && progress.kmRemaining > 0 ? <span>{fmtInt(convertDistance(progress.kmRemaining))} {distanceUnit}</span> : progress.monthsRemaining !== null && progress.monthsRemaining > 0 ? <span>{progress.monthsRemaining} months</span> : '—'}</span> },
          ] as Column<(typeof sortedItems)[number]>[]}
          data={sortedItems}
          keyExtractor={({ item }) => item.id}
          sortKey={sortCol}
          sortDir={sortDir}
          onSort={handleSort}
        />
      </GlassPanel>

      {/* ── Log Service Form ── */}
      <GlassPanel className="p-5 sm:p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Plus className="h-4 w-4 text-neon-cyan" />
            Log Service
          </h3>
          <Button
            variant={showForm ? 'secondary' : 'primary'}
            size="sm"
            onClick={() => setShowForm(v => !v)}
          >
            {showForm ? 'Cancel' : 'Add Record'}
          </Button>
        </div>

        {showForm && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            {/* Item selector */}
            <div>
              <label className="text-[10px] uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>Service Item</label>
              <Select
                value={formItemId}
                onChange={e => setFormItemId(e.target.value)}
                options={MAINTENANCE_SCHEDULE.map(i => ({ value: i.id, label: i.name }))}
                className="w-full"
              />
            </div>

            {/* Date */}
            <div>
              <label className="text-[10px] uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>Date</label>
              <Input
                type="date"
                value={formDate}
                onChange={e => setFormDate(e.target.value)}
                className="w-full"
              />
            </div>

            {/* Odometer */}
            <div>
              <label className="text-[10px] uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>
                Odometer ({distanceUnit})
              </label>
              <Input
                type="number"
                placeholder={fmtInt(convertDistance(currentOdometerKm))}
                value={formOdometer}
                onChange={e => setFormOdometer(e.target.value)}
                className="w-full"
              />
            </div>

            {/* Notes */}
            <div>
              <label className="text-[10px] uppercase tracking-wider mb-1 block" style={{ color: 'var(--text-muted)' }}>Notes</label>
              <Input
                type="text"
                placeholder="Optional notes…"
                value={formNotes}
                onChange={e => setFormNotes(e.target.value)}
                className="w-full"
              />
            </div>

            <div className="sm:col-span-2 lg:col-span-4 flex justify-end">
              <Button onClick={handleAddRecord}>
                Save Record
              </Button>
            </div>
          </div>
        )}
      </GlassPanel>

      {/* ── Service History Log ── */}
      <GlassPanel className="p-5 sm:p-6 mb-6">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <Clock className="h-4 w-4 text-neon-cyan" />
          Service History
        </h3>
        {sortedHistory.length === 0 ? (
          <EmptyState
            icon={<Wrench className="h-10 w-10" />}
            title="No service records yet"
            description="Use the form above to log your first maintenance service."
          />
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto pr-1 custom-scrollbar">
            {sortedHistory.map((record, idx) => {
              const item = MAINTENANCE_SCHEDULE.find(m => m.id === record.itemId)
              if (!item) return null
              const Icon = item.icon
              return (
                <GlassPanel key={`${record.itemId}-${record.date}-${idx}`} className="p-3 flex items-center gap-3">
                  <div className="p-1.5 rounded-lg bg-neon-cyan/10 shrink-0">
                    <Icon className="h-4 w-4 text-neon-cyan" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{item.name}</p>
                    <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                      {formatDate(record.date)} · {fmtInt(convertDistance(record.odometerKm))} {distanceUnit}
                      {record.notes && ` · ${record.notes}`}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDeleteRecord(serviceLog.indexOf(record))}
                    className="text-neon-red/60 hover:text-neon-red text-xs px-2 py-1 rounded transition-colors"
                    title="Remove record"
                  >
                    ✕
                  </button>
                </GlassPanel>
              )
            })}
          </div>
        )}
      </GlassPanel>

      {/* ── Estimated Annual Cost ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <GlassPanel className="p-5 sm:p-6">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <DollarSign className="h-4 w-4 text-neon-green" />
            Estimated Annual Cost
          </h3>
          <div className="space-y-2.5 mb-5">
            {MAINTENANCE_SCHEDULE.filter(i => i.estimatedCostUsd > 0).map(item => {
              const months = item.intervalMonths ?? 12
              const yearlyFraction = 12 / months
              const yearlyCost = item.estimatedCostUsd * yearlyFraction
              return (
                <div key={item.id} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <item.icon className="h-3.5 w-3.5 text-neon-cyan" />
                    <span style={{ color: 'var(--text-secondary)' }}>{item.name}</span>
                  </div>
                  <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                    ~${Math.round(yearlyCost)}/yr
                  </span>
                </div>
              )
            })}
          </div>
          <div className="border-t border-white/10 pt-3 flex items-center justify-between">
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Total Estimated</span>
            <span className="text-xl font-bold text-neon-green">~${Math.round(annualCost)}/yr</span>
          </div>
          <div className="mt-3 p-3 rounded-lg bg-neon-green/5 border border-neon-green/20">
            <p className="text-xs text-neon-green">
              <span className="font-bold">{savingsVsIce}% cheaper</span> than average ICE vehicle (${fmtInt(ICE_ANNUAL_COST)}/year)
            </p>
          </div>
        </GlassPanel>

        {/* ── Vehicle Mileage Projection ── */}
        <GlassPanel className="p-5 sm:p-6">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <TrendingUp className="h-4 w-4 text-neon-purple" />
            Service Projections
          </h3>
          {!projections || avgDailyKm <= 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Not enough driving data to project service dates.
            </p>
          ) : (
            <div className="space-y-2.5">
              {projections
                .filter(p => p.daysUntilDue !== null && p.daysUntilDue > 0)
                .sort((a, b) => (a.daysUntilDue ?? 0) - (b.daysUntilDue ?? 0))
                .slice(0, 6)
                .map(({ item, daysUntilDue, estDate }) => {
                  const months = daysUntilDue !== null ? Math.round(daysUntilDue / 30) : null
                  return (
                    <GlassPanel key={item.id} className="flex items-center justify-between text-sm p-3">
                      <div className="flex items-center gap-2">
                        <item.icon className="h-3.5 w-3.5 text-neon-purple" />
                        <span style={{ color: 'var(--text-secondary)' }}>{item.name}</span>
                      </div>
                      <div className="text-right">
                        <span className="font-medium text-xs" style={{ color: 'var(--text-primary)' }}>
                          {months !== null && months > 0 ? `~${months} month${months !== 1 ? 's' : ''}` : 'Soon'}
                        </span>
                        {estDate && (
                          <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                            {formatDate(estDate)}
                          </p>
                        )}
                      </div>
                    </GlassPanel>
                  )
                })}
              {projections && projections.filter(p => p.daysUntilDue !== null && p.daysUntilDue > 0).length === 0 && (
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  All items are overdue or have no mileage interval.
                </p>
              )}
            </div>
          )}
          {avgDailyKm > 0 && (
            <div className="mt-4 p-3 rounded-lg bg-neon-purple/5 border border-neon-purple/20">
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                Based on your average of{' '}
                <span className="font-semibold text-neon-purple">
                  {fmtNumber(convertDistance(avgDailyKm))} {distanceUnit}/day
                </span>
              </p>
            </div>
          )}
        </GlassPanel>
      </div>
    </FadeIn>
  )
}
