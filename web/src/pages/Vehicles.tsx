import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { getVehicles, syncVehicles, deleteVehicle, getVehicleState, Vehicle, getVehicleStatus } from '../api'
import { Car, RefreshCw, Trash2, ExternalLink, Gauge, Lock, Shield, Battery, Zap, Activity, Tag, Plus, X, Filter, Star } from 'lucide-react'
import { PageHeader, GlassPanel, FadeIn, StaggerContainer, StaggerItem, StatusBadge, ProgressRing, Skeleton, EmptyState, ConfirmModal } from '../components/ui'
import { AnimatedNumber } from '../components/Widgets'
import { TeslaCarViz } from '../components/TeslaCarViz'
import clsx from 'clsx'

const FAVORITES_KEY = 'teslasync-favorite-vehicles'

function getFavorites(): number[] {
  try {
    const val = localStorage.getItem(FAVORITES_KEY)
    return val ? JSON.parse(val) : []
  } catch { return [] }
}

function toggleFavoriteVehicle(vehicleId: number): number[] {
  const favs = getFavorites()
  const idx = favs.indexOf(vehicleId)
  if (idx >= 0) {
    favs.splice(idx, 1)
  } else {
    favs.push(vehicleId)
  }
  localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs))
  return [...favs]
}

interface VehicleTag { name: string; color: string }

function loadTags(): Record<number, VehicleTag[]> {
  try { return JSON.parse(localStorage.getItem('teslasync-vehicle-tags') ?? '{}') } catch { return {} }
}
function saveTags(tags: Record<number, VehicleTag[]>) {
  localStorage.setItem('teslasync-vehicle-tags', JSON.stringify(tags))
}

const TAG_COLORS = ['#00f0ff', '#10b981', '#a855f7', '#f59e0b', '#ef4444', '#ec4899', '#4f46e5', '#14b8a6']

function TagBadge({ tag, onRemove }: { tag: VehicleTag; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: `${tag.color}20`, color: tag.color }}>
      {tag.name}
      {onRemove && <X className="h-2.5 w-2.5 cursor-pointer hover:opacity-60" onClick={onRemove} />}
    </span>
  )
}

function AddTagPopover({ onAdd }: { vehicleId: number; onAdd: (tag: VehicleTag) => void }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState(TAG_COLORS[0])

  if (!open) return (
    <button onClick={() => setOpen(true)} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] text-[var(--text-muted)] hover:bg-white/5 transition-colors" title="Add tag">
      <Plus className="h-2.5 w-2.5" /> Tag
    </button>
  )

  return (
    <div className="flex items-center gap-1.5">
      <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Tag"
        className="w-16 px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] text-[var(--text-primary)] focus:outline-none"
        onKeyDown={e => { if (e.key === 'Enter' && name.trim()) { onAdd({ name: name.trim(), color }); setName(''); setOpen(false) } }}
        autoFocus />
      <div className="flex gap-0.5">
        {TAG_COLORS.map(c => (
          <button key={c} onClick={() => setColor(c)}
            className={clsx('w-3 h-3 rounded-full border', color === c ? 'border-white' : 'border-transparent')}
            style={{ backgroundColor: c }} />
        ))}
      </div>
      <button onClick={() => { if (name.trim()) { onAdd({ name: name.trim(), color }); setName(''); setOpen(false) } }}
        className="text-[10px] text-neon-cyan hover:underline">Add</button>
      <button onClick={() => setOpen(false)} className="text-[10px] text-[var(--text-muted)] hover:underline">Cancel</button>
    </div>
  )
}

function VehicleCard({ vehicle, onDelete, tags, onAddTag, onRemoveTag, isFavorite, onToggleFavorite }: { vehicle: Vehicle; onDelete: (v: Vehicle) => void; tags: VehicleTag[]; onAddTag: (tag: VehicleTag) => void; onRemoveTag: (idx: number) => void; isFavorite: boolean; onToggleFavorite: () => void }) {
  const { data: stateData } = useQuery({
    queryKey: ['vehicle-state', vehicle.id],
    queryFn: () => getVehicleState(vehicle.id),
    refetchInterval: 30_000,
  })

  const state = stateData?.state
  const status = getVehicleStatus(vehicle, state)

  const batteryColor = state && state.battery_level > 50 ? '#10b981' : state && state.battery_level > 20 ? '#f59e0b' : '#ef4444'

  return (
    <GlassPanel hover glow="cyan" className="p-0 overflow-hidden transition-all duration-300 group">
      {/* Gradient accent strip */}
      <div className="h-1 bg-gradient-to-r from-neon-cyan via-neon-purple to-neon-green opacity-40 group-hover:opacity-80 transition-opacity" />

      <div className="p-5">
        <div className="flex items-start gap-5">
          {/* Car viz */}
          <div className="shrink-0 opacity-80 group-hover:opacity-100 transition-opacity">
            <TeslaCarViz
              model={(vehicle.model?.toLowerCase().includes('model 3') || vehicle.model?.toLowerCase().includes('m3')) ? 'model3' :
                     (vehicle.model?.toLowerCase().includes('model y') || vehicle.model?.toLowerCase().includes('my')) ? 'modely' :
                     (vehicle.model?.toLowerCase().includes('model s') || vehicle.model?.toLowerCase().includes('ms')) ? 'models' :
                     (vehicle.model?.toLowerCase().includes('model x') || vehicle.model?.toLowerCase().includes('mx')) ? 'modelx' :
                     'cybertruck'}
              size="sm"
              batteryLevel={state?.battery_level ?? 50}
              isCharging={state?.is_charging ?? false}
              isLocked={state?.is_locked ?? true}
              isClimateOn={false}
              speed={0}
              sentryMode={state?.sentry_mode ?? false}
            />
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-1.5">
              <Link to={`/vehicles/${vehicle.id}`} className="text-base font-semibold text-[var(--text-primary)] hover:text-neon-cyan transition-colors truncate">
                {vehicle.display_name || vehicle.vin}
              </Link>
              <StatusBadge status={status} />
              {(() => {
                const driver = localStorage.getItem(`teslasync-driver-${vehicle.id}`)
                return driver ? <span className="text-[10px] text-[var(--text-muted)] flex items-center gap-1">👤 {driver}</span> : null
              })()}
            </div>
            <p className="text-xs text-[var(--text-muted)] mb-3">
              {vehicle.model} {vehicle.trim_badging} · <span className="font-mono text-gray-600">{vehicle.vin}</span>
            </p>

            {/* Tags */}
            <div className="flex flex-wrap items-center gap-1 mb-2">
              {tags.map((t, i) => <TagBadge key={i} tag={t} onRemove={() => onRemoveTag(i)} />)}
              <AddTagPopover vehicleId={vehicle.id} onAdd={onAddTag} />
            </div>

            {/* Stats row */}
            {state && (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <div className="flex items-center gap-2">
                  <ProgressRing value={state.battery_level} size={36} strokeWidth={3} color={batteryColor} label="" />
                  <div>
                    <p className="text-sm font-bold text-[var(--text-primary)]">{state.battery_level}%</p>
                    <p className="text-[10px] text-[var(--text-muted)]">{Math.round(state.rated_range)} km</p>
                  </div>
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-[var(--text-primary)]">{state.inside_temp}°C</p>
                  <p className="text-[10px] text-[var(--text-muted)]">Interior</p>
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-[var(--text-primary)]">{Math.round(state.odometer).toLocaleString()}</p>
                  <p className="text-[10px] text-[var(--text-muted)]">km</p>
                </div>
                {state.is_charging && (
                  <div className="text-center">
                    <p className="text-sm font-medium text-neon-green">{state.charger_power} kW</p>
                    <p className="text-[10px] text-[var(--text-muted)]">Charging</p>
                  </div>
                )}
                <div className="flex items-center gap-2 ml-auto">
                  {state.is_locked && <Lock className="h-3.5 w-3.5 text-neon-green" />}
                  {state.sentry_mode && <Shield className="h-3.5 w-3.5 text-neon-cyan" />}
                </div>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-col items-center gap-1 shrink-0">
            <button
              onClick={onToggleFavorite}
              className={clsx('rounded-lg p-2 transition-all', isFavorite ? 'text-yellow-400 hover:bg-yellow-400/10' : 'text-gray-600 hover:bg-yellow-400/10 hover:text-yellow-400')}
              title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            >
              <Star className="h-4 w-4" fill={isFavorite ? 'currentColor' : 'none'} />
            </button>
            <Link
              to={`/vehicles/${vehicle.id}`}
              className="rounded-lg p-2 text-gray-600 hover:bg-neon-cyan/10 hover:text-neon-cyan transition-all"
              title="View details"
            >
              <ExternalLink className="h-4 w-4" />
            </Link>
            <button
              onClick={() => onDelete(vehicle)}
              className="rounded-lg p-2 text-gray-600 hover:bg-neon-red/10 hover:text-neon-red transition-all"
              title="Remove vehicle"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </GlassPanel>
  )
}

function FleetSummary({ vehicles }: { vehicles: Vehicle[] }) {
  // Gather all states
  const stateQueries = vehicles.map(v => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { data } = useQuery({
      queryKey: ['vehicle-state', v.id],
      queryFn: () => getVehicleState(v.id),
      refetchInterval: 30_000,
    })
    return data?.state
  })

  const states = stateQueries.filter(Boolean)
  const avgBattery = states.length > 0 ? states.reduce((s, st) => s + (st?.battery_level ?? 0), 0) / states.length : 0
  const totalRange = states.reduce((s, st) => s + (st?.rated_range ?? 0), 0)
  const chargingCount = states.filter(st => st?.is_charging).length
  const onlineCount = states.filter(st => st).length

  return (
    <FadeIn delay={0.05}>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <GlassPanel className="p-4 text-center hover:scale-[1.02] transition-transform duration-200">
          <Car className="h-5 w-5 text-neon-cyan mx-auto mb-2" />
          <p className="text-2xl font-bold text-[var(--text-primary)]"><AnimatedNumber value={vehicles.length} /></p>
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Vehicles</p>
        </GlassPanel>
        <GlassPanel className="p-4 text-center hover:scale-[1.02] transition-transform duration-200">
          <Battery className="h-5 w-5 text-neon-green mx-auto mb-2" />
          <p className="text-2xl font-bold text-[var(--text-primary)]"><AnimatedNumber value={Math.round(avgBattery)} />%</p>
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Avg Battery</p>
        </GlassPanel>
        <GlassPanel className="p-4 text-center hover:scale-[1.02] transition-transform duration-200">
          <Gauge className="h-5 w-5 text-neon-purple mx-auto mb-2" />
          <p className="text-2xl font-bold text-[var(--text-primary)]"><AnimatedNumber value={Math.round(totalRange)} /></p>
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Total Range km</p>
        </GlassPanel>
        <GlassPanel className="p-4 text-center hover:scale-[1.02] transition-transform duration-200">
          <Zap className="h-5 w-5 text-neon-amber mx-auto mb-2" />
          <p className="text-2xl font-bold text-neon-green"><AnimatedNumber value={chargingCount} /> <span className="text-sm text-[var(--text-muted)]">/ {onlineCount}</span></p>
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Charging / Online</p>
        </GlassPanel>
      </div>
    </FadeIn>
  )
}

// Battery comparison bar chart
function BatteryComparison({ vehicles }: { vehicles: Vehicle[] }) {
  const stateQueries = vehicles.map(v => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { data } = useQuery({
      queryKey: ['vehicle-state', v.id],
      queryFn: () => getVehicleState(v.id),
      refetchInterval: 30_000,
    })
    return { vehicle: v, state: data?.state }
  })

  const bars = stateQueries.filter(q => q.state)

  if (bars.length === 0) return null

  return (
    <FadeIn delay={0.1}>
      <GlassPanel className="p-5">
        <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
          <Activity className="h-4 w-4 text-neon-cyan" /> Fleet Battery Status
        </h3>
        <div className="space-y-3">
          {bars.map(({ vehicle, state }) => {
            const level = state?.battery_level ?? 0
            const color = level > 50 ? '#10b981' : level > 20 ? '#f59e0b' : '#ef4444'
            return (
              <div key={vehicle.id} className="flex items-center gap-3">
                <span className="text-xs text-[var(--text-secondary)] w-24 truncate">{vehicle.display_name || vehicle.vin}</span>
                <div className="flex-1 h-3 rounded-full bg-white/[0.04] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-1000"
                    style={{ width: `${level}%`, background: `linear-gradient(90deg, ${color}80, ${color})`, boxShadow: `0 0 10px ${color}40` }}
                  />
                </div>
                <span className="text-xs font-medium text-[var(--text-primary)] w-10 text-right">{level}%</span>
                <span className="text-[10px] text-gray-600 w-16 text-right">{Math.round(state?.rated_range ?? 0)} km</span>
              </div>
            )
          })}
        </div>
      </GlassPanel>
    </FadeIn>
  )
}

export default function Vehicles() {
  const queryClient = useQueryClient()
  const { data: vehicles, isLoading, error } = useQuery({
    queryKey: ['vehicles'],
    queryFn: getVehicles,
  })

  const syncMut = useMutation({
    mutationFn: syncVehicles,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['vehicles'] }),
  })

  const deleteMut = useMutation({
    mutationFn: deleteVehicle,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      setDeleteTarget(null)
    },
  })

  const [deleteTarget, setDeleteTarget] = useState<Vehicle | null>(null)
  const [allTags, setAllTags] = useState<Record<number, VehicleTag[]>>(loadTags)
  const [filterTag, setFilterTag] = useState<string>('')
  const [favorites, setFavorites] = useState<number[]>(getFavorites)

  const handleToggleFavorite = (vehicleId: number) => {
    setFavorites(toggleFavoriteVehicle(vehicleId))
  }

  useEffect(() => { saveTags(allTags) }, [allTags])

  const handleAddTag = (vehicleId: number, tag: VehicleTag) => {
    setAllTags(prev => ({ ...prev, [vehicleId]: [...(prev[vehicleId] ?? []), tag] }))
  }
  const handleRemoveTag = (vehicleId: number, idx: number) => {
    setAllTags(prev => ({ ...prev, [vehicleId]: (prev[vehicleId] ?? []).filter((_, i) => i !== idx) }))
  }

  // Collect all unique tag names for filter dropdown
  const uniqueTagNames = Array.from(new Set(Object.values(allTags).flat().map(t => t.name)))

  // Filter vehicles by tag
  const filteredVehicles = vehicles?.filter(v => {
    if (!filterTag) return true
    return (allTags[v.id] ?? []).some(t => t.name === filterTag)
  })?.sort((a, b) => {
    const aFav = favorites.includes(a.id) ? 0 : 1
    const bFav = favorites.includes(b.id) ? 0 : 1
    return aFav - bFav
  })

  return (
    <div className="space-y-8">
      <PageHeader
        title="Fleet Management"
        subtitle="View, manage, and sync your Tesla vehicles"
        actions={
          <button
            onClick={() => syncMut.mutate()}
            disabled={syncMut.isPending}
            className="neon-button flex items-center gap-2 text-sm"
          >
            <RefreshCw className={clsx('h-4 w-4', syncMut.isPending && 'animate-spin')} />
            Sync from Tesla
          </button>
        }
      />

      {syncMut.isSuccess && (
        <FadeIn>
          <GlassPanel className="p-3 border-neon-green/20 bg-neon-green/5">
            <p className="text-sm text-neon-green flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-neon-green" />
              Synced {syncMut.data.synced} vehicle(s) successfully.
            </p>
          </GlassPanel>
        </FadeIn>
      )}
      {syncMut.isError && (
        <FadeIn>
          <GlassPanel className="p-3 border-neon-red/20 bg-neon-red/5">
            <p className="text-sm text-neon-red">Sync failed: {(syncMut.error as Error).message}</p>
          </GlassPanel>
        </FadeIn>
      )}

      {/* Tag Filter */}
      {uniqueTagNames.length > 0 && (
        <FadeIn>
          <div className="flex items-center gap-2 flex-wrap">
            <Filter className="h-3.5 w-3.5 text-[var(--text-muted)]" />
            <button onClick={() => setFilterTag('')}
              className={clsx('px-2 py-0.5 rounded text-[10px] font-medium transition-colors',
                !filterTag ? 'bg-neon-cyan/20 text-neon-cyan' : 'text-[var(--text-muted)] hover:bg-white/5')}>
              All
            </button>
            {uniqueTagNames.map(name => (
              <button key={name} onClick={() => setFilterTag(filterTag === name ? '' : name)}
                className={clsx('px-2 py-0.5 rounded text-[10px] font-medium transition-colors',
                  filterTag === name ? 'bg-neon-cyan/20 text-neon-cyan' : 'text-[var(--text-muted)] hover:bg-white/5')}>
                <Tag className="h-2.5 w-2.5 inline mr-0.5" />{name}
              </button>
            ))}
          </div>
        </FadeIn>
      )}

      {isLoading ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-24" />)}
          </div>
          <Skeleton className="h-32" />
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : error ? (
        <GlassPanel className="p-6 text-center">
          <p className="text-neon-red text-sm">Failed to load vehicles.</p>
        </GlassPanel>
      ) : vehicles && vehicles.length > 0 ? (
        <>
          {/* Fleet summary */}
          <FleetSummary vehicles={vehicles} />

          {/* Battery comparison */}
          <BatteryComparison vehicles={vehicles} />

          {/* Vehicle cards */}
          <FadeIn delay={0.15}>
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-4 flex items-center gap-2">
              <Car className="h-4 w-4 text-neon-purple" /> All Vehicles {filterTag && <span className="text-[10px] text-[var(--text-muted)]">(filtered by &ldquo;{filterTag}&rdquo;)</span>}
            </h3>
          </FadeIn>
          <StaggerContainer className="space-y-4">
            {(filteredVehicles ?? []).map((v: Vehicle) => (
              <StaggerItem key={v.id}>
                <VehicleCard
                  vehicle={v}
                  onDelete={setDeleteTarget}
                  tags={allTags[v.id] ?? []}
                  onAddTag={(tag) => handleAddTag(v.id, tag)}
                  onRemoveTag={(idx) => handleRemoveTag(v.id, idx)}
                  isFavorite={favorites.includes(v.id)}
                  onToggleFavorite={() => handleToggleFavorite(v.id)}
                />
              </StaggerItem>
            ))}
          </StaggerContainer>
        </>
      ) : (
        <EmptyState
          icon={<Car className="h-10 w-10" />}
          title="No vehicles yet"
          description="Connect your Tesla account and sync your vehicles to get started with fleet tracking, battery monitoring, and trip analysis."
        />
      )}

      {/* Styled delete confirmation modal */}
      <ConfirmModal
        open={deleteTarget !== null}
        title="Remove Vehicle"
        message={`Are you sure you want to remove "${deleteTarget?.display_name || deleteTarget?.vin}"? This will delete all associated data including drives, charges, and state history.`}
        confirmLabel="Remove"
        variant="danger"
        onConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}
