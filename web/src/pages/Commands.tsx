import { useState, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getVehicles, getVehicleState, sendCommand, wakeVehicle, Vehicle, VehicleState } from '../api'
import { PageHeader, GlassPanel, ConfirmModal, StaggerContainer, StaggerItem, StatusBadge, Skeleton, EmptyState } from '../components/ui'
import { TeslaCarViz, parseModelKey } from '../components/TeslaCarViz'
import {
  Lock, Unlock, Wind, Car, Zap, Power, Shield,
  Volume2, MapPin, GaugeCircle, DoorOpen, AlertTriangle, CheckCircle, Loader2,
  Thermometer, Battery, Wifi, Clock, Keyboard, Check
} from 'lucide-react'
import { getVehicleStatus } from '../api'
import { useToast } from '../components/Toast'
import clsx from 'clsx'

// === Feature 1: Command History Entry ===
interface CommandHistoryEntry {
  command: string
  vehicle: string
  time: Date
  status: 'success' | 'failed'
}

// === Feature 9: Sentry schedule preference ===
const SENTRY_SCHEDULE_KEY = 'teslasync_sentry_schedule'

function getSentrySchedule(): boolean {
  try { return localStorage.getItem(SENTRY_SCHEDULE_KEY) === 'true' } catch { return false }
}

function setSentryScheduleStorage(enabled: boolean) {
  try { localStorage.setItem(SENTRY_SCHEDULE_KEY, String(enabled)) } catch { /* noop */ }
}

// === Feature 6: Destructive commands requiring confirmation ===
const DESTRUCTIVE_COMMANDS = new Set(['unlock', 'open_trunk', 'trunk_open', 'open_frunk', 'frunk_open', 'honk_horn'])

interface CommandButtonProps {
  icon: React.ReactNode
  label: string
  sublabel?: string
  onClick: () => void
  loading?: boolean
  variant?: 'default' | 'danger' | 'success'
  disabled?: boolean
  active?: boolean
  shortcutKey?: string
}

function CommandButton({ icon, label, sublabel, onClick, loading, variant = 'default', disabled, active, shortcutKey }: CommandButtonProps) {
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
        {shortcutKey && (
          <span className="inline-block mt-1 px-1.5 py-0.5 text-[9px] font-mono rounded bg-white/[0.06] text-[var(--text-muted)] border border-white/[0.08]">{shortcutKey}</span>
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

function VehicleCommandCenter({ vehicle, state, onCommandSent }: { vehicle: Vehicle; state?: VehicleState | null; onCommandSent: (entry: CommandHistoryEntry) => void }) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [lastResult, setLastResult] = useState<{ success: boolean; message: string } | null>(null)
  const status = getVehicleStatus(vehicle, state)
  const name = vehicle.display_name || vehicle.vin

  // Feature 4: Charge limit slider
  const [chargeLimit, setChargeLimit] = useState(state?.battery_level ?? 80)

  // Feature 6: Confirmation modal state
  const [confirmAction, setConfirmAction] = useState<{ command: string; params?: Record<string, unknown> } | null>(null)

  // Feature 9: Sentry schedule
  const [sentrySchedule, setSentrySchedule] = useState(getSentrySchedule)

  const cmd = useMutation({
    mutationFn: ({ command, params }: { command: string; params?: Record<string, unknown> }) =>
      sendCommand(vehicle.id, command, params),
    onMutate: ({ command }) => {
      // Feature 7: Pending toast
      toast.info(`⏳ Sending ${command} to ${name}...`)
    },
    onSuccess: (data, { command }) => {
      setLastResult(data)
      queryClient.invalidateQueries({ queryKey: ['vehicle-state', vehicle.id] })
      queryClient.invalidateQueries({ queryKey: ['command-vehicle-states'] })
      // Feature 1: Log entry
      onCommandSent({ command, vehicle: name, time: new Date(), status: data.success ? 'success' : 'failed' })
      // Feature 7: Success/failure toast
      if (data.success) {
        toast.success(`✅ ${name} — ${command} successful`)
      } else {
        toast.error(`❌ Failed to ${command}: ${data.message || 'Unknown error'}`)
      }
    },
    onError: (err: Error, { command }) => {
      setLastResult({ success: false, message: err.message })
      // Feature 1: Log entry
      onCommandSent({ command, vehicle: name, time: new Date(), status: 'failed' })
      // Feature 7: Error toast
      toast.error(`❌ Failed to ${command}: ${err.message}`)
    },
  })

  const wakeMut = useMutation({
    mutationFn: () => wakeVehicle(vehicle.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vehicle-state', vehicle.id] })
      queryClient.invalidateQueries({ queryKey: ['command-vehicle-states'] })
      onCommandSent({ command: 'wake_up', vehicle: name, time: new Date(), status: 'success' })
      toast.success(`${name} is waking up`)
    },
    onError: (err: Error) => {
      onCommandSent({ command: 'wake_up', vehicle: name, time: new Date(), status: 'failed' })
      toast.error(`Failed to wake ${name}: ${err.message}`)
    },
  })

  const sendCmd = (command: string, params?: Record<string, unknown>) => {
    // Feature 6: If destructive, show confirmation modal
    if (DESTRUCTIVE_COMMANDS.has(command)) {
      setConfirmAction({ command, params })
      return
    }
    setLastResult(null)
    cmd.mutate({ command, params })
  }

  const confirmAndSend = () => {
    if (!confirmAction) return
    setLastResult(null)
    cmd.mutate(confirmAction)
    setConfirmAction(null)
  }

  const isAsleep = status === 'asleep' || status === 'offline'

  return (
    <GlassPanel className="p-6">
      {/* Feature 6: Confirmation modal */}
      <ConfirmModal
        open={!!confirmAction}
        title="Confirm Command"
        message={`Are you sure you want to ${confirmAction?.command?.replace(/_/g, ' ')} ${name}?`}
        confirmLabel="Send"
        onConfirm={confirmAndSend}
        onCancel={() => setConfirmAction(null)}
      />

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
                { icon: Zap, label: 'Range', value: `${Math.round(state.rated_range)} km`, color: 'text-[var(--text-primary)]' },
                { icon: Thermometer, label: 'Inside', value: `${state.inside_temp}°C`, color: state.inside_temp > 30 ? 'text-neon-red' : 'text-neon-cyan' },
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
            shortcutKey="L / U"
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
            sublabel={state?.is_climate_on ? `ON · ${state.inside_temp}°C` : 'OFF'}
            onClick={() => sendCmd(state?.is_climate_on ? 'climate_off' : 'climate_on')}
            loading={cmd.isPending}
            active={state?.is_climate_on}
            shortcutKey="C"
          />
          {/* Feature 3: Climate temperature presets */}
          {([
            { label: 'Cool 18°C', temp: 18 },
            { label: 'Comfort 21°C', temp: 21 },
            { label: 'Warm 24°C', temp: 24 },
          ] as const).map(preset => (
            <button
              key={preset.temp}
              onClick={() => sendCmd('climate_on', { temp: preset.temp })}
              disabled={cmd.isPending}
              className="rounded-full px-4 py-2 text-xs font-medium border border-white/[0.08] bg-white/[0.03] text-[var(--text-secondary)] hover:border-neon-cyan/30 hover:text-neon-cyan hover:bg-neon-cyan/5 transition-all disabled:opacity-50"
            >
              {preset.label}
            </button>
          ))}
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

        {/* Feature 4: Charge Limit Slider */}
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2 font-medium">Charge Limit</p>
          <div className="glass-panel p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-[var(--text-primary)]">{chargeLimit}%</span>
              <div className="flex gap-2 text-[10px] text-[var(--text-muted)]">
                <span className="px-2 py-0.5 rounded bg-neon-green/10 text-neon-green border border-neon-green/20">≤80% daily</span>
                <span className="px-2 py-0.5 rounded bg-neon-amber/10 text-neon-amber border border-neon-amber/20">100% trips</span>
              </div>
            </div>
            <input
              type="range"
              min={50}
              max={100}
              value={chargeLimit}
              onChange={e => setChargeLimit(Number(e.target.value))}
              onMouseUp={() => sendCmd('set_charge_limit', { percent: chargeLimit })}
              onTouchEnd={() => sendCmd('set_charge_limit', { percent: chargeLimit })}
              className="w-full h-2 rounded-full appearance-none cursor-pointer bg-white/10 accent-neon-cyan"
            />
            <div className="flex justify-between text-[10px] text-[var(--text-muted)] mt-1">
              <span>50%</span>
              <span>100%</span>
            </div>
          </div>
        </div>

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
            shortcutKey="H"
          />
          <CommandButton
            icon={<MapPin className="h-5 w-5" />}
            label="Flash Lights"
            onClick={() => sendCmd('flash_lights')}
            loading={cmd.isPending}
          />
        </CommandGroup>

        {/* Feature 9: Sentry Mode Schedule */}
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2 font-medium">Sentry Schedule</p>
          <div className="glass-panel p-4 flex items-center justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-[var(--text-primary)]">Auto Sentry when parked away from home</p>
                {sentrySchedule && (
                  <span className="px-1.5 py-0.5 text-[9px] font-medium rounded bg-neon-green/10 text-neon-green border border-neon-green/20">Active</span>
                )}
              </div>
              <p className="text-[10px] text-[var(--text-muted)] mt-0.5">Requires geofence set as &quot;Home&quot;</p>
            </div>
            <button
              onClick={() => { const next = !sentrySchedule; setSentrySchedule(next); setSentryScheduleStorage(next) }}
              className={clsx(
                'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                sentrySchedule ? 'bg-neon-green/30' : 'bg-white/10'
              )}
            >
              <span className={clsx(
                'inline-block h-4 w-4 rounded-full bg-white transition-transform',
                sentrySchedule ? 'translate-x-6' : 'translate-x-1'
              )} />
            </button>
          </div>
        </div>
      </div>
    </GlassPanel>
  )
}

export default function Commands() {
  const { data: vehicles, isLoading } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const toast = useToast()

  // Feature 1: Command history
  const [commandHistory, setCommandHistory] = useState<CommandHistoryEntry[]>([])
  const addHistoryEntry = useCallback((entry: CommandHistoryEntry) => {
    setCommandHistory(prev => [entry, ...prev].slice(0, 20))
  }, [])

  // Feature 8: Bulk vehicle selector
  const [selectedVehicleIds, setSelectedVehicleIds] = useState<Set<number>>(new Set())
  const [bulkCommand, setBulkCommand] = useState<string | null>(null)
  const [bulkProgress, setBulkProgress] = useState<{ sent: number; total: number } | null>(null)

  const toggleVehicleSelection = (id: number) => {
    setSelectedVehicleIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const selectAllVehicles = () => {
    if (!vehicles) return
    if (selectedVehicleIds.size === vehicles.length) {
      setSelectedVehicleIds(new Set())
    } else {
      setSelectedVehicleIds(new Set(vehicles.map(v => v.id)))
    }
  }

  const sendBulkCommand = async (command: string) => {
    if (!vehicles) return
    const ids = Array.from(selectedVehicleIds)
    if (ids.length === 0) { toast.warning('No vehicles selected'); return }
    setBulkCommand(command)
    setBulkProgress({ sent: 0, total: ids.length })
    for (let i = 0; i < ids.length; i++) {
      const v = vehicles.find(veh => veh.id === ids[i])
      const vName = v?.display_name || v?.vin || String(ids[i])
      try {
        const result = await sendCommand(ids[i], command)
        addHistoryEntry({ command, vehicle: vName, time: new Date(), status: result.success ? 'success' : 'failed' })
      } catch {
        addHistoryEntry({ command, vehicle: vName, time: new Date(), status: 'failed' })
      }
      setBulkProgress({ sent: i + 1, total: ids.length })
    }
    toast.success(`Bulk ${command} sent to ${ids.length} vehicle(s)`)
    setBulkCommand(null)
    setBulkProgress(null)
  }

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
  const onlineCount = vehicles?.filter(v => {
    const s = states[v.id]
    return s && getVehicleStatus(v, s) !== 'offline' && getVehicleStatus(v, s) !== 'asleep'
  }).length ?? 0

  // Feature 10: Keyboard shortcuts — send to the first online vehicle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (!vehicles || vehicles.length === 0) return
      const firstVehicle = vehicles[0]
      const name = firstVehicle.display_name || firstVehicle.vin
      const executeShortcut = async (command: string) => {
        e.preventDefault()
        try {
          const result = await sendCommand(firstVehicle.id, command)
          addHistoryEntry({ command, vehicle: name, time: new Date(), status: result.success ? 'success' : 'failed' })
          if (result.success) toast.success(`✅ ${name} — ${command} successful`)
          else toast.error(`❌ Failed to ${command}: ${result.message}`)
        } catch (err) {
          addHistoryEntry({ command, vehicle: name, time: new Date(), status: 'failed' })
          toast.error(`❌ Failed to ${command}: ${err instanceof Error ? err.message : 'Unknown error'}`)
        }
      }
      switch (e.key.toUpperCase()) {
        case 'L': executeShortcut('lock'); break
        case 'U': executeShortcut('unlock'); break
        case 'C': executeShortcut('climate_on'); break
        case 'H': executeShortcut('honk_horn'); break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [vehicles, toast, addHistoryEntry])

  return (
    <div className="space-y-8">
      <PageHeader
        title="Vehicle Commands"
        subtitle="Remote control center for your Tesla fleet"
        actions={
          vehicles && vehicles.length > 0 ? (
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]"><Keyboard className="h-3 w-3" /> L U C H</span>
              <span className="text-xs text-[var(--text-muted)]">
                <span className="text-neon-green font-medium">{onlineCount}</span>/{vehicles.length} online
              </span>
            </div>
          ) : undefined
        }
      />

      {/* Feature 2: Quick Actions */}
      {vehicles && vehicles.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-2 font-medium">Quick Actions</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { icon: '🔒', label: 'Lock All', command: 'lock' },
              { icon: '🔓', label: 'Unlock All', command: 'unlock' },
              { icon: '❄️', label: 'Climate On', command: 'climate_on' },
              { icon: '🌡️', label: 'Climate Off', command: 'climate_off' },
            ].map(action => (
              <button
                key={action.command}
                onClick={() => {
                  if (!vehicles) return
                  const v = vehicles[0]
                  const name = v.display_name || v.vin
                  sendCommand(v.id, action.command)
                    .then(result => addHistoryEntry({ command: action.command, vehicle: name, time: new Date(), status: result.success ? 'success' : 'failed' }))
                    .catch(() => addHistoryEntry({ command: action.command, vehicle: name, time: new Date(), status: 'failed' }))
                }}
                className="glass-panel p-4 flex flex-col items-center gap-2 hover:border-neon-cyan/30 hover:shadow-[0_0_15px_rgba(0,240,255,0.08)] transition-all group"
              >
                <span className="text-2xl">{action.icon}</span>
                <span className="text-xs font-medium text-[var(--text-primary)] group-hover:text-neon-cyan transition-colors">{action.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

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

      {/* Feature 8: Bulk vehicle selector */}
      {vehicles && vehicles.length > 1 && (
        <GlassPanel className="p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-medium">Bulk Commands</p>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedVehicleIds.size === vehicles.length}
                onChange={selectAllVehicles}
                className="rounded border-white/20 bg-white/5 text-neon-cyan focus:ring-neon-cyan/30"
              />
              <span className="text-xs text-[var(--text-secondary)]">Select All</span>
            </label>
          </div>
          <div className="flex flex-wrap gap-2 mb-3">
            {vehicles.map(v => (
              <label key={v.id} className={clsx(
                'flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-pointer text-xs border transition-all',
                selectedVehicleIds.has(v.id) ? 'border-neon-cyan/30 bg-neon-cyan/5 text-neon-cyan' : 'border-white/[0.08] bg-white/[0.02] text-[var(--text-secondary)]'
              )}>
                <input
                  type="checkbox"
                  checked={selectedVehicleIds.has(v.id)}
                  onChange={() => toggleVehicleSelection(v.id)}
                  className="sr-only"
                />
                {selectedVehicleIds.has(v.id) && <Check className="h-3 w-3" />}
                {v.display_name || v.vin}
              </label>
            ))}
          </div>
          {selectedVehicleIds.size > 0 && (
            <div className="flex flex-wrap gap-2">
              {['lock', 'unlock', 'climate_on', 'climate_off', 'flash_lights'].map(c => (
                <button
                  key={c}
                  onClick={() => sendBulkCommand(c)}
                  disabled={!!bulkCommand}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border border-white/[0.08] bg-white/[0.03] text-[var(--text-secondary)] hover:border-neon-cyan/30 hover:text-neon-cyan transition-all disabled:opacity-50"
                >
                  {c.replace(/_/g, ' ')}
                </button>
              ))}
              {bulkProgress && (
                <span className="px-3 py-1.5 text-xs text-neon-cyan flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Sent {bulkProgress.sent}/{bulkProgress.total}...
                </span>
              )}
            </div>
          )}
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
              <VehicleCommandCenter vehicle={v} state={states[v.id]} onCommandSent={addHistoryEntry} />
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

      {/* Feature 1: Command History Log */}
      {commandHistory.length > 0 && (
        <GlassPanel className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="h-4 w-4 text-[var(--text-muted)]" />
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Recent Commands</h3>
            <span className="text-[10px] text-[var(--text-muted)]">({commandHistory.length})</span>
          </div>
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {commandHistory.map((entry, i) => (
              <div key={`${entry.time.getTime()}-${i}`} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-white/[0.02] transition-colors">
                <div className="flex items-center gap-3">
                  <span className={clsx(
                    'h-2 w-2 rounded-full shrink-0',
                    entry.status === 'success' ? 'bg-neon-green' : 'bg-neon-red'
                  )} />
                  <span className="text-xs font-medium text-[var(--text-primary)]">{entry.command.replace(/_/g, ' ')}</span>
                  <span className="text-[10px] text-[var(--text-muted)]">→ {entry.vehicle}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={clsx('text-[10px] font-medium', entry.status === 'success' ? 'text-neon-green' : 'text-neon-red')}>
                    {entry.status}
                  </span>
                  <span className="text-[10px] text-[var(--text-muted)]">
                    {entry.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </GlassPanel>
      )}
    </div>
  )
}
