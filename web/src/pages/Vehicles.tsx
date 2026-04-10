import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { getVehicles, syncVehicles, deleteVehicle, getVehicleState, Vehicle, getVehicleStatus } from '../api'
import { Car, RefreshCw, Trash2, ExternalLink, Gauge, Lock, Shield, Battery, Zap, Activity } from 'lucide-react'
import { PageHeader, GlassPanel, FadeIn, StaggerContainer, StaggerItem, StatusBadge, ProgressRing, Skeleton, EmptyState, ConfirmModal, Button, AlertBanner } from '../components/ui'
import { AnimatedNumber } from '../components/Widgets'
import { TeslaCarViz } from '../components/TeslaCarViz'
import { useSettings } from '../hooks/useSettings'
import { useVehicleLive } from '../hooks/useVehicleLive'
import { fmtNumber } from '../lib/numberFormat'
import { usePageTitle } from '../hooks/usePageTitle'

function VehicleCard({ vehicle, onDelete }: { vehicle: Vehicle; onDelete: (v: Vehicle) => void }) {
  usePageTitle('Vehicles')
  const { convertDistance, convertTemp, distanceUnit, tempUnit } = useSettings()
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
            </div>
            <p className="text-xs text-[var(--text-muted)] mb-3">
              {vehicle.model} {vehicle.trim_badging} · <span className="font-mono text-gray-600">{vehicle.vin}</span>
            </p>

            {/* Stats row */}
            {state && (
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <div className="flex items-center gap-2">
                  <ProgressRing value={state.battery_level} size={36} strokeWidth={3} color={batteryColor} label="" />
                  <div>
                    <p className="text-sm font-bold text-[var(--text-primary)]">{state.battery_level}%</p>
                    <p className="text-[10px] text-[var(--text-muted)]">{Math.round(convertDistance(state.rated_range))} {distanceUnit}</p>
                  </div>
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-[var(--text-primary)]">{fmtNumber(convertTemp(state.inside_temp))} {tempUnit}</p>
                  <p className="text-[10px] text-[var(--text-muted)]">Interior</p>
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-[var(--text-primary)]">{Math.round(convertDistance(state.odometer)).toLocaleString()}</p>
                  <p className="text-[10px] text-[var(--text-muted)]">{distanceUnit}</p>
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
  const { convertDistance, distanceUnit } = useSettings()
  // Batch-fetch all vehicle states in a single query
  const { data: allStates } = useQuery({
    queryKey: ['fleet-vehicle-states', vehicles.map(v => v.id).sort()],
    queryFn: async () => {
      const entries = await Promise.all(
        vehicles.map(async v => {
          try {
            const data = await getVehicleState(v.id)
            return data?.state ?? null
          } catch {
            return null
          }
        })
      )
      return entries
    },
    enabled: vehicles.length > 0,
    refetchInterval: 30_000,
  })

  const states = (allStates ?? []).filter(Boolean)
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
          <p className="text-2xl font-bold text-[var(--text-primary)]"><AnimatedNumber value={Math.round(convertDistance(totalRange))} /></p>
          <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Total Range {distanceUnit}</p>
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
  const { convertDistance, distanceUnit } = useSettings()
  const { data: allStates } = useQuery({
    queryKey: ['fleet-battery-states', vehicles.map(v => v.id).sort()],
    queryFn: async () => {
      const entries = await Promise.all(
        vehicles.map(async v => {
          try {
            const data = await getVehicleState(v.id)
            return { vehicle: v, state: data?.state ?? null }
          } catch {
            return { vehicle: v, state: null }
          }
        })
      )
      return entries
    },
    enabled: vehicles.length > 0,
    refetchInterval: 30_000,
  })

  const bars = (allStates ?? []).filter(q => q.state)

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
                <span className="text-[10px] text-gray-600 w-16 text-right">{Math.round(convertDistance(state?.rated_range ?? 0))} {distanceUnit}</span>
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

  const primaryVehicleId = vehicles?.[0]?.id
  const { state: live } = useVehicleLive(primaryVehicleId)

  const syncMut = useMutation({
    mutationFn: syncVehicles,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['vehicles'] }),
  })

  const deleteMut = useMutation({
    mutationFn: deleteVehicle,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicles'] })
      queryClient.invalidateQueries({ queryKey: ['vehicle-state'] })
      queryClient.invalidateQueries({ queryKey: ['fleet-vehicle-states'] })
      queryClient.invalidateQueries({ queryKey: ['fleet-battery-states'] })
      setDeleteTarget(null)
    },
  })

  const [deleteTarget, setDeleteTarget] = useState<Vehicle | null>(null)

  return (
    <div className="space-y-8">
      <PageHeader
        title="Fleet Management"
        subtitle={live.vehicleName ? `${live.vehicleName} · View, manage, and sync your Tesla vehicles` : "View, manage, and sync your Tesla vehicles"}
        actions={
          <Button
            onClick={() => syncMut.mutate()}
            loading={syncMut.isPending}
            icon={<RefreshCw className="h-4 w-4" />}
          >
            Sync from Tesla
          </Button>
        }
      />

      {syncMut.isSuccess && (
        <FadeIn>
          <AlertBanner variant="success">
            Synced {syncMut.data.synced} vehicle(s) successfully.
          </AlertBanner>
        </FadeIn>
      )}
      {syncMut.isError && (
        <FadeIn>
          <AlertBanner variant="danger" title="Sync failed">
            {(syncMut.error as Error).message}
          </AlertBanner>
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
              <Car className="h-4 w-4 text-neon-purple" /> All Vehicles
            </h3>
          </FadeIn>
          <StaggerContainer className="space-y-4">
            {vehicles.map((v: Vehicle) => (
              <StaggerItem key={v.id}>
                <VehicleCard vehicle={v} onDelete={setDeleteTarget} />
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
