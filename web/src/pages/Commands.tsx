import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getVehicles, getVehicleState, sendCommand, wakeVehicle, Vehicle, VehicleState } from '../api'
import { PageHeader, GlassPanel, StaggerContainer, StaggerItem, StatusBadge, Skeleton, EmptyState } from '../components/ui'
import { TeslaCarViz, parseModelKey } from '../components/TeslaCarViz'
import {
  Lock, Unlock, Wind, Car, Zap, Power, Shield,
  Volume2, MapPin, GaugeCircle, DoorOpen, AlertTriangle, CheckCircle, Loader2,
  Thermometer, Battery, Wifi
} from 'lucide-react'
import { getVehicleStatus } from '../api'
import { useToast } from '../components/Toast'
import { useSettings } from '../hooks/useSettings'
import clsx from 'clsx'

interface CommandButtonProps {
  icon: React.ReactNode
  label: string
  sublabel?: string
  onClick: () => void
  loading?: boolean
  variant?: 'default' | 'danger' | 'success'
  disabled?: boolean
  active?: boolean
}

function CommandButton({ icon, label, sublabel, onClick, loading, variant = 'default', disabled, active }: CommandButtonProps) {
  const variants = {
    default: 'hover:border-neon-cyan/30 hover:shadow-[0_0_15px_rgba(0,240,255,0.08)]',
    danger: 'hover:border-neon-red/30 hover:shadow-[0_0_15px_rgba(239,68,68,0.08)]',
    success: 'hover:border-neon-green/30 hover:shadow-[0_0_15px_rgba(16,185,129,0.08)]',
  }
  const activeVariants = {
    default: 'border-neon-cyan/20 bg-neon-cyan/5',
    danger: 'border-neon-red/20 bg-neon-red/5',
    success: 'border-neon-green/20 bg-neon-green/5',
  }
  const iconColors = {
    default: active ? 'bg-neon-cyan/20 text-neon-cyan' : 'bg-white/5 text-[var(--text-secondary)]',
    danger: active ? 'bg-neon-red/20 text-neon-red' : 'bg-white/5 text-[var(--text-secondary)]',
    success: active ? 'bg-neon-green/20 text-neon-green' : 'bg-white/5 text-[var(--text-secondary)]',
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={clsx(
        'glass-panel p-4 flex flex-col items-center gap-2 transition-all duration-300 text-center min-h-[100px] justify-center group',
        variants[variant],
        active && activeVariants[variant],
        (disabled || loading) && 'opacity-50 cursor-not-allowed'
      )}
    >
      <div className={clsx('rounded-xl p-2.5 transition-colors', iconColors[variant])}>
        {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : icon}
      </div>
      <div>
        <p className="text-xs font-medium text-[var(--text-primary)] group-hover:text-neon-cyan transition-colors">{label}</p>
        {sublabel && (
          <p className={clsx('text-[10px] mt-0.5 font-medium',
            active ? (variant === 'danger' ? 'text-neon-red' : variant === 'success' ? 'text-neon-green' : 'text-neon-cyan') : 'text-[var(--text-muted)]'
          )}>{sublabel}</p>
        )}
      </div>
    </button>
  )
}

function CommandGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2 font-medium">{title}</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">{children}</div>
    </div>
  )
}

function VehicleCommandCenter({ vehicle, state }: { vehicle: Vehicle; state?: VehicleState | null }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const { convertDistance, convertTemp, distanceUnit, tempUnit } = useSettings()
  const [lastResult, setLastResult] = useState<{ success: boolean; message: string } | null>(null)
  const status = getVehicleStatus(vehicle, state)
  const name = vehicle.display_name || vehicle.vin

  const cmd = useMutation({
    mutationFn: ({ command, params }: { command: string; params?: Record<string, unknown> }) =>
      sendCommand(vehicle.id, command, params),
    onSuccess: (data) => {
      setLastResult(data)
      queryClient.invalidateQueries({ queryKey: ['vehicle-state', vehicle.id] })
      queryClient.invalidateQueries({ queryKey: ['command-vehicle-states'] })
      if (data.success) {
        toast.success(`Command sent to ${name}`)
      } else {
        toast.error(data.message || `Command failed on ${name}`)
      }
    },
    onError: (err: Error) => {
      setLastResult({ success: false, message: err.message })
      toast.error(`Command failed: ${err.message}`)
    },
  })

  const wakeMut = useMutation({
    mutationFn: () => wakeVehicle(vehicle.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicle-state', vehicle.id] })
      queryClient.invalidateQueries({ queryKey: ['command-vehicle-states'] })
      toast.success(`${name} is waking up`)
    },
    onError: (err: Error) => {
      toast.error(`Failed to wake ${name}: ${err.message}`)
    },
  })

  const sendCmd = (command: string, params?: Record<string, unknown>) => {
    setLastResult(null)
    cmd.mutate({ command, params })
  }

  const isAsleep = status === 'asleep' || status === 'offline'

  return (
    <GlassPanel className="p-6">
      {/* Hero header with car viz */}
      <div className="flex flex-col lg:flex-row items-start lg:items-center gap-6 mb-6">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <h3 className="text-lg font-semibold text-[var(--text-primary)]">{name}</h3>
            <StatusBadge status={status} size="md" />
          </div>
          <p className="text-xs text-[var(--text-muted)]">{vehicle.model} {vehicle.trim_badging} · {vehicle.vin}</p>

          {state && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
              {[
                { icon: Battery, label: 'Battery', value: `${state.battery_level}%`, color: state.battery_level > 50 ? 'text-neon-green' : state.battery_level > 20 ? 'text-neon-amber' : 'text-neon-red' },
                { icon: Zap, label: 'Range', value: `${Math.round(convertDistance(state.rated_range))} ${distanceUnit}`, color: 'text-[var(--text-primary)]' },
                { icon: Thermometer, label: 'Inside', value: `${convertTemp(state.inside_temp).toFixed(1)}${tempUnit}`, color: state.inside_temp > 30 ? 'text-neon-red' : 'text-neon-cyan' },
                { icon: Wifi, label: 'Status', value: status, color: status === 'online' || status === 'driving' ? 'text-neon-green' : 'text-[var(--text-secondary)]' },
              ].map(item => (
                <div key={item.label} className="flex items-center gap-2 p-2 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                  <item.icon className="h-3.5 w-3.5 text-[var(--text-muted)] shrink-0" />
                  <div>
                    <p className="text-[10px] text-[var(--text-muted)]">{item.label}</p>
                    <p className={clsx('text-sm font-semibold', item.color)}>{item.value}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Car visualization */}
        <div className="shrink-0">
          <TeslaCarViz
            batteryLevel={state?.battery_level ?? 0}
            isCharging={state?.is_charging ?? false}
            isLocked={state?.is_locked ?? true}
            isClimateOn={state?.is_climate_on ?? false}
            sentryMode={state?.sentry_mode ?? false}
            speed={state?.speed ?? 0}
            model={parseModelKey(vehicle.model)}
            size="md"
          />
        </div>
      </div>

      {/* Status feedback */}
      {lastResult && (
        <div className={clsx(
          'flex items-center gap-2 rounded-xl p-3 mb-4 text-sm animate-in',
          lastResult.success ? 'bg-neon-green/10 text-neon-green border border-neon-green/20' : 'bg-neon-red/10 text-neon-red border border-neon-red/20'
        )}>
          {lastResult.success ? <CheckCircle className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
          <span className="truncate">{lastResult.message}</span>
        </div>
      )}

      {/* Asleep overlay hint */}
      {isAsleep && (
        <div className="flex items-center gap-2 rounded-xl p-3 mb-4 text-sm bg-neon-amber/10 text-neon-amber border border-neon-amber/20">
          <Power className="h-4 w-4 shrink-0" />
          Vehicle is {status}. Wake it up first to send commands.
        </div>
      )}

      {/* Grouped Commands */}
      <div className="space-y-5">
        <CommandGroup title="Security & Access">
          <CommandButton
            icon={<Power className="h-5 w-5" />}
            label="Wake Up"
            sublabel={isAsleep ? 'Required' : 'Awake'}
            onClick={() => wakeMut.mutate()}
            loading={wakeMut.isPending}
            variant="success"
            active={!isAsleep}
          />
          <CommandButton
            icon={state?.is_locked ? <Lock className="h-5 w-5" /> : <Unlock className="h-5 w-5" />}
            label={state?.is_locked ? 'Locked' : 'Unlocked'}
            sublabel={state?.is_locked ? 'Tap to unlock' : 'Tap to lock'}
            onClick={() => sendCmd(state?.is_locked ? 'unlock' : 'lock')}
            loading={cmd.isPending}
            active={state?.is_locked}
          />
          <CommandButton
            icon={<Shield className="h-5 w-5" />}
            label="Sentry"
            sublabel={state?.sentry_mode ? 'Active' : 'Inactive'}
            onClick={() => sendCmd(state?.sentry_mode ? 'sentry_off' : 'sentry_on')}
            loading={cmd.isPending}
            active={state?.sentry_mode}
            variant={state?.sentry_mode ? 'danger' : 'default'}
          />
          <CommandButton
            icon={<GaugeCircle className="h-5 w-5" />}
            label="Speed Limit"
            sublabel="Enable"
            onClick={() => sendCmd('speed_limit_on')}
            loading={cmd.isPending}
            variant="danger"
          />
        </CommandGroup>

        <CommandGroup title="Climate & Comfort">
          <CommandButton
            icon={<Wind className="h-5 w-5" />}
            label="Climate"
            sublabel={state?.is_climate_on ? `ON · ${convertTemp(state.inside_temp).toFixed(0)}${tempUnit}` : 'OFF'}
            onClick={() => sendCmd(state?.is_climate_on ? 'climate_off' : 'climate_on')}
            loading={cmd.isPending}
            active={state?.is_climate_on}
          />
        </CommandGroup>

        <CommandGroup title="Charging">
          <CommandButton
            icon={<Zap className="h-5 w-5" />}
            label="Charge Port"
            sublabel="Open"
            onClick={() => sendCmd('charge_port_open')}
            loading={cmd.isPending}
          />
          <CommandButton
            icon={<Zap className="h-5 w-5" />}
            label="Start Charge"
            sublabel={state?.is_charging ? 'Charging' : 'Idle'}
            onClick={() => sendCmd('charge_start')}
            loading={cmd.isPending}
            variant="success"
            active={state?.is_charging}
          />
          <CommandButton
            icon={<Zap className="h-5 w-5" />}
            label="Stop Charge"
            onClick={() => sendCmd('charge_stop')}
            loading={cmd.isPending}
            variant="danger"
          />
        </CommandGroup>

        <CommandGroup title="Doors & Trunk">
          <CommandButton
            icon={<DoorOpen className="h-5 w-5" />}
            label="Frunk"
            sublabel="Open"
            onClick={() => sendCmd('frunk_open')}
            loading={cmd.isPending}
          />
          <CommandButton
            icon={<DoorOpen className="h-5 w-5" />}
            label="Trunk"
            sublabel="Open"
            onClick={() => sendCmd('trunk_open')}
            loading={cmd.isPending}
          />
        </CommandGroup>

        <CommandGroup title="Alerts & Location">
          <CommandButton
            icon={<Volume2 className="h-5 w-5" />}
            label="Horn"
            onClick={() => sendCmd('honk_horn')}
            loading={cmd.isPending}
            variant="danger"
          />
          <CommandButton
            icon={<MapPin className="h-5 w-5" />}
            label="Flash Lights"
            onClick={() => sendCmd('flash_lights')}
            loading={cmd.isPending}
          />
        </CommandGroup>
      </div>
    </GlassPanel>
  )
}

export default function Commands() {
  const { data: vehicles, isLoading } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })

  const vehicleStates = useQuery({
    queryKey: ['command-vehicle-states', vehicles?.map(v => v.id)],
    queryFn: async () => {
      if (!vehicles) return {}
      const entries = await Promise.all(
        vehicles.map(async v => {
          try {
            const data = await getVehicleState(v.id)
            return [v.id, data.state ?? null] as const
          } catch {
            return [v.id, null] as const
          }
        })
      )
      return Object.fromEntries(entries) as Record<number, VehicleState | null>
    },
    enabled: !!vehicles && vehicles.length > 0,
    refetchInterval: 15_000,
  })

  const states = vehicleStates.data ?? {}
  const statesError = vehicleStates.error
  const onlineCount = vehicles?.filter(v => {
    const s = states[v.id]
    return s && getVehicleStatus(v, s) !== 'offline' && getVehicleStatus(v, s) !== 'asleep'
  }).length ?? 0

  return (
    <div className="space-y-8">
      <PageHeader
        title="Vehicle Commands"
        subtitle="Remote control center for your Tesla fleet"
        actions={
          vehicles && vehicles.length > 0 ? (
            <span className="text-xs text-[var(--text-muted)]">
              <span className="text-neon-green font-medium">{onlineCount}</span>/{vehicles.length} online
            </span>
          ) : undefined
        }
      />

      {vehicles && vehicles.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Vehicles', value: `${vehicles.length}`, color: 'text-neon-cyan' },
            { label: 'Online', value: `${onlineCount}`, color: 'text-neon-green' },
            { label: 'Asleep', value: `${vehicles.length - onlineCount}`, color: 'text-neon-amber' },
            { label: 'Refresh', value: '15s', color: 'text-[var(--text-secondary)]' },
          ].map(m => (
            <div key={m.label} className="glass-panel p-3 text-center">
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">{m.label}</p>
              <p className={`text-sm font-bold ${m.color}`}>{m.value}</p>
            </div>
          ))}
        </div>
      )}

      {statesError && (
        <GlassPanel className="p-4">
          <div className="flex items-center gap-2 text-neon-red text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>Failed to load vehicle states: {(statesError as Error).message}</span>
          </div>
        </GlassPanel>
      )}

      {isLoading ? (
        <div className="space-y-6">
          {[1, 2].map(i => <Skeleton key={i} className="h-72" />)}
        </div>
      ) : vehicles && vehicles.length > 0 ? (
        <StaggerContainer className="space-y-6">
          {vehicles.map(v => (
            <StaggerItem key={v.id}>
              <VehicleCommandCenter vehicle={v} state={states[v.id]} />
            </StaggerItem>
          ))}
        </StaggerContainer>
      ) : (
        <EmptyState
          icon={<Car className="h-8 w-8" />}
          title="No vehicles found"
          description="Connect your Tesla account and sync your fleet to start sending commands."
        />
      )}
    </div>
  )
}
