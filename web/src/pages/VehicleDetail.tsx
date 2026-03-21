import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { getVehicle, getVehicleState, getVehiclePositions, wakeVehicle, getDrives, getChargingSessions, getVehicleStatus } from '../api'
import { MapContainer, TileLayer, Polyline, Marker } from 'react-leaflet'
import { LatLngExpression } from 'leaflet'
import {
  Battery, Thermometer, Gauge, Navigation, Lock, Unlock, Shield,
  Zap, ArrowLeft, Power, Activity, Route, Clock, Eye, Wind,
  Cpu, BatteryCharging, ChevronRight, Wrench, Plus, Trash2, X,
} from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { GlassPanel, FadeIn, StaggerContainer, StaggerItem, StatusBadge } from '../components/ui'
import { TeslaCarViz, parseModelKey } from '../components/TeslaCarViz'
import { RadialGauge, AnimatedNumber, MetricBar } from '../components/Widgets'
import { AnimatePresence, motion } from 'framer-motion'
import clsx from 'clsx'

function InfoTile({ icon: Icon, label, value, color = 'text-[var(--text-primary)]', sub }: {
  icon: React.ElementType; label: string; value: string | number | boolean; color?: string; sub?: string
}) {
  const display = typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value
  return (
    <GlassPanel className="p-4">
      <div className="flex items-center gap-2 text-[var(--text-muted)] text-xs mb-1.5">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <p className={clsx('text-lg font-semibold', color)}>{display}</p>
      {sub && <p className="text-[10px] text-gray-600 mt-0.5">{sub}</p>}
    </GlassPanel>
  )
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="glass-panel p-3 text-xs" style={{ background: 'var(--surface-2)', borderColor: 'var(--glass-border)' }}>
      <p style={{ color: 'var(--text-secondary)' }} className="mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: 'var(--text-primary)' }}>
          <span style={{ color: p.color }}>●</span> {p.name}: {p.value}
        </p>
      ))}
    </div>
  )
}

interface MaintenanceRecord {
  id: string
  date: string
  type: 'tire_rotation' | 'cabin_filter' | 'brake_fluid' | 'wiper_blades' | 'tire_replacement' | 'service_visit' | 'other'
  description: string
  cost: number
  odometer: number
  nextDue?: number
}

const maintenanceTypeConfig: Record<MaintenanceRecord['type'], { icon: string; label: string; interval: number }> = {
  tire_rotation: { icon: '🔄', label: 'Tire Rotation', interval: 10000 },
  cabin_filter: { icon: '🌬️', label: 'Cabin Filter', interval: 20000 },
  brake_fluid: { icon: '💧', label: 'Brake Fluid', interval: 40000 },
  wiper_blades: { icon: '🪟', label: 'Wiper Blades', interval: 15000 },
  tire_replacement: { icon: '🛞', label: 'Tire Replacement', interval: 50000 },
  service_visit: { icon: '🔧', label: 'Service Visit', interval: 20000 },
  other: { icon: '📋', label: 'Other', interval: 0 },
}

const MAINTENANCE_TYPES = Object.keys(maintenanceTypeConfig) as MaintenanceRecord['type'][]

function VehicleStatusViz({ state }: { state: any }) {
  const locked = state?.locked ?? true
  const sentry = state?.sentry_mode ?? false
  const charging = state?.is_charging ?? false
  const battery = state?.battery_level ?? 0
  const climateOn = state?.is_climate_on ?? false

  return (
    <GlassPanel className="p-6">
      <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Vehicle Status</h3>
      <div className="flex justify-center">
        <svg viewBox="0 0 400 700" width="100%" style={{ maxWidth: '350px' }} xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="vs-body" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#1a1a3e" />
              <stop offset="100%" stopColor="#0f0f2a" />
            </linearGradient>
            <linearGradient id="vs-glass" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={sentry ? '#ef4444' : '#38bdf8'} stopOpacity={0.3} />
              <stop offset="100%" stopColor={sentry ? '#ef4444' : '#0ea5e9'} stopOpacity={0.1} />
            </linearGradient>
          </defs>

          {/* Car body outline */}
          <path d="M140,100 C140,50 160,20 200,15 C240,20 260,50 260,100 L270,160 L280,280 L280,460 L270,560 C265,620 240,645 200,650 C160,645 135,620 130,560 L120,460 L120,280 L130,160 Z"
            fill="url(#vs-body)" stroke={locked ? '#10b981' : '#ef4444'} strokeWidth="2" />

          {/* Windshield */}
          <path d="M160,110 C165,70 180,45 200,40 C220,45 235,70 240,110 L245,155 L155,155 Z"
            fill="url(#vs-glass)" stroke={sentry ? '#ef4444' : '#38bdf8'} strokeWidth="1.5" strokeOpacity="0.4" />

          {/* Lock indicator */}
          <g transform="translate(200, 340)">
            <circle r="20" fill={locked ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'}
              stroke={locked ? '#10b981' : '#ef4444'} strokeWidth="1.5" />
            <text textAnchor="middle" y="5" fontSize="14" fill={locked ? '#10b981' : '#ef4444'}>
              {locked ? '🔒' : '🔓'}
            </text>
          </g>

          {/* Battery bar on the side */}
          <rect x="85" y="200" width="15" height="200" rx="7" fill="#1a1a3e" stroke="#334155" strokeWidth="1" />
          <rect x="87" y={200 + 200 * (1 - battery / 100)} width="11" height={200 * (battery / 100)} rx="5"
            fill={battery > 60 ? '#10b981' : battery > 30 ? '#f59e0b' : '#ef4444'}>
            {charging && <animate attributeName="height" values={`${200 * (battery / 100)};${200 * ((battery + 5) / 100)};${200 * (battery / 100)}`} dur="2s" repeatCount="indefinite" />}
          </rect>
          <text x="92" y={195} textAnchor="middle" fontSize="10" fill="#9ca3af">{battery}%</text>

          {/* Charging indicator */}
          {charging && (
            <g transform="translate(310, 350)">
              <circle r="18" fill="rgba(0,240,255,0.1)" stroke="#00f0ff" strokeWidth="1.5">
                <animate attributeName="r" values="16;22;16" dur="1.5s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="1;0.5;1" dur="1.5s" repeatCount="indefinite" />
              </circle>
              <text textAnchor="middle" y="5" fontSize="16">⚡</text>
            </g>
          )}

          {/* Climate indicator */}
          {climateOn && (
            <g transform="translate(200, 130)">
              <text textAnchor="middle" fontSize="14" fill="#3b82f6">❄️</text>
              <animate attributeName="opacity" values="1;0.4;1" dur="2s" repeatCount="indefinite" />
            </g>
          )}

          {/* Sentry mode shield */}
          {sentry && (
            <g transform="translate(200, 500)">
              <circle r="15" fill="rgba(239,68,68,0.1)" stroke="#ef4444" strokeWidth="1">
                <animate attributeName="r" values="15;20;15" dur="2s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.8;0.3;0.8" dur="2s" repeatCount="indefinite" />
              </circle>
              <text textAnchor="middle" y="5" fontSize="12">👁️</text>
            </g>
          )}

          {/* Headlights */}
          <ellipse cx="155" cy="115" rx="10" ry="5" fill="#fbbf24" opacity={charging ? 0.3 : 0.7}>
            <animate attributeName="opacity" values="0.4;0.8;0.4" dur="3s" repeatCount="indefinite" />
          </ellipse>
          <ellipse cx="245" cy="115" rx="10" ry="5" fill="#fbbf24" opacity={charging ? 0.3 : 0.7}>
            <animate attributeName="opacity" values="0.4;0.8;0.4" dur="3s" repeatCount="indefinite" />
          </ellipse>

          {/* Status labels */}
          <text x="200" y="680" textAnchor="middle" fontSize="11" fill="#9ca3af">
            {locked ? 'Locked' : 'Unlocked'} · {sentry ? 'Sentry On' : 'Sentry Off'} · {charging ? 'Charging' : climateOn ? 'Climate On' : 'Idle'}
          </text>
        </svg>
      </div>
    </GlassPanel>
  )
}

function MaintenanceLog({ vehicleId }: { vehicleId: number }) {
  const storageKey = `teslasync-maintenance-${vehicleId}`
  const [records, setRecords] = useState<MaintenanceRecord[]>(() => {
    const stored = localStorage.getItem(storageKey)
    return stored ? JSON.parse(stored) : []
  })
  const [showForm, setShowForm] = useState(false)
  const [formType, setFormType] = useState<MaintenanceRecord['type']>('service_visit')
  const [formDate, setFormDate] = useState(new Date().toISOString().slice(0, 10))
  const [formDesc, setFormDesc] = useState('')
  const [formCost, setFormCost] = useState('')
  const [formOdo, setFormOdo] = useState('')
  const [formNextDue, setFormNextDue] = useState('')

  const addRecord = (record: MaintenanceRecord) => {
    const updated = [record, ...records]
    setRecords(updated)
    localStorage.setItem(storageKey, JSON.stringify(updated))
    setShowForm(false)
    resetForm()
  }

  const deleteRecord = (id: string) => {
    const updated = records.filter(r => r.id !== id)
    setRecords(updated)
    localStorage.setItem(storageKey, JSON.stringify(updated))
  }

  const resetForm = () => {
    setFormType('service_visit')
    setFormDate(new Date().toISOString().slice(0, 10))
    setFormDesc('')
    setFormCost('')
    setFormOdo('')
    setFormNextDue('')
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    addRecord({
      id: Date.now().toString(),
      date: formDate,
      type: formType,
      description: formDesc,
      cost: parseFloat(formCost) || 0,
      odometer: parseFloat(formOdo) || 0,
      nextDue: formNextDue ? parseFloat(formNextDue) : undefined,
    })
  }

  const totalCost = records.reduce((s, r) => s + r.cost, 0)

  return (
    <FadeIn delay={0.35}>
      <GlassPanel className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="section-title flex items-center gap-2">
            <Wrench className="h-4 w-4 text-neon-amber" /> Maintenance Log
          </h3>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium bg-neon-amber/10 text-neon-amber hover:bg-neon-amber/20 border border-neon-amber/20 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" /> Add Record
          </button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="rounded-xl p-3 text-center" style={{ background: 'var(--surface-2)', border: '1px solid var(--glass-border)' }}>
            <p className="text-lg font-bold text-neon-cyan">{records.length}</p>
            <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Total Records</p>
          </div>
          <div className="rounded-xl p-3 text-center" style={{ background: 'var(--surface-2)', border: '1px solid var(--glass-border)' }}>
            <p className="text-lg font-bold text-neon-green">${totalCost.toFixed(0)}</p>
            <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Total Cost</p>
          </div>
          <div className="rounded-xl p-3 text-center" style={{ background: 'var(--surface-2)', border: '1px solid var(--glass-border)' }}>
            <p className="text-lg font-bold text-neon-amber">{records[0]?.date ? new Date(records[0].date).toLocaleDateString() : '—'}</p>
            <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Last Service</p>
          </div>
        </div>

        {/* Add form modal */}
        <AnimatePresence>
          {showForm && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
              onClick={() => setShowForm(false)}
            >
              <motion.div
                initial={{ scale: 0.95, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                onClick={e => e.stopPropagation()}
                className="glass-panel p-6 w-full max-w-md space-y-4"
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Add Maintenance Record</h2>
                  <button onClick={() => setShowForm(false)} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
                    <X className="h-5 w-5" style={{ color: 'var(--text-secondary)' }} />
                  </button>
                </div>
                <form onSubmit={handleSubmit} className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>Service Type</label>
                    <select
                      value={formType}
                      onChange={e => setFormType(e.target.value as MaintenanceRecord['type'])}
                      className="w-full rounded-xl border px-4 py-2.5 text-sm outline-none"
                      style={{ background: 'var(--surface-2)', borderColor: 'var(--glass-border)', color: 'var(--text-primary)' }}
                    >
                      {MAINTENANCE_TYPES.map(t => (
                        <option key={t} value={t}>{maintenanceTypeConfig[t].icon} {maintenanceTypeConfig[t].label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>Date</label>
                    <input type="date" value={formDate} onChange={e => setFormDate(e.target.value)}
                      className="w-full rounded-xl border px-4 py-2.5 text-sm outline-none"
                      style={{ background: 'var(--surface-2)', borderColor: 'var(--glass-border)', color: 'var(--text-primary)' }} />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>Description</label>
                    <input type="text" value={formDesc} onChange={e => setFormDesc(e.target.value)} placeholder="Brief description..."
                      className="w-full rounded-xl border px-4 py-2.5 text-sm outline-none"
                      style={{ background: 'var(--surface-2)', borderColor: 'var(--glass-border)', color: 'var(--text-primary)' }} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>Cost ($)</label>
                      <input type="number" step="0.01" value={formCost} onChange={e => setFormCost(e.target.value)} placeholder="0.00"
                        className="w-full rounded-xl border px-4 py-2.5 text-sm outline-none"
                        style={{ background: 'var(--surface-2)', borderColor: 'var(--glass-border)', color: 'var(--text-primary)' }} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>Odometer (km)</label>
                      <input type="number" value={formOdo} onChange={e => setFormOdo(e.target.value)} placeholder="0"
                        className="w-full rounded-xl border px-4 py-2.5 text-sm outline-none"
                        style={{ background: 'var(--surface-2)', borderColor: 'var(--glass-border)', color: 'var(--text-primary)' }} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>Next Due (km, optional)</label>
                    <input type="number" value={formNextDue} onChange={e => setFormNextDue(e.target.value)} placeholder="e.g. 60000"
                      className="w-full rounded-xl border px-4 py-2.5 text-sm outline-none"
                      style={{ background: 'var(--surface-2)', borderColor: 'var(--glass-border)', color: 'var(--text-primary)' }} />
                  </div>
                  <div className="flex justify-end gap-3 pt-2">
                    <button type="button" onClick={() => setShowForm(false)} className="rounded-xl px-4 py-2 text-sm font-medium hover:bg-white/5 transition-colors" style={{ color: 'var(--text-secondary)' }}>Cancel</button>
                    <button type="submit" className="rounded-xl px-5 py-2 text-sm font-medium bg-neon-amber/10 text-neon-amber hover:bg-neon-amber/20 border border-neon-amber/20 transition-colors">Add Record</button>
                  </div>
                </form>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Records list */}
        <div className="space-y-2">
          {records.map(r => (
            <div key={r.id} className="flex items-center gap-3 p-3 rounded-xl" style={{ background: 'var(--surface-2)' }}>
              <span className="text-xl">{maintenanceTypeConfig[r.type]?.icon || '📋'}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{maintenanceTypeConfig[r.type]?.label}: {r.description}</p>
                <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  {new Date(r.date).toLocaleDateString()} · {r.odometer.toLocaleString()} km · ${r.cost}
                  {r.nextDue ? ` · Next: ${r.nextDue.toLocaleString()} km` : ''}
                </p>
              </div>
              <button onClick={() => deleteRecord(r.id)} className="text-xs text-red-400 hover:text-red-300 shrink-0 flex items-center gap-1 transition-colors">
                <Trash2 className="h-3 w-3" /> Delete
              </button>
            </div>
          ))}
          {records.length === 0 && (
            <p className="text-xs text-center py-6" style={{ color: 'var(--text-muted)' }}>No maintenance records yet. Add your first record above.</p>
          )}
        </div>
      </GlassPanel>
    </FadeIn>
  )
}

export default function VehicleDetail() {
  const { id } = useParams<{ id: string }>()
  const vehicleId = Number(id)

  const { data: vehicle } = useQuery({
    queryKey: ['vehicle', vehicleId],
    queryFn: () => getVehicle(vehicleId),
  })

  const { data: stateData, refetch: refetchState } = useQuery({
    queryKey: ['vehicle-state', vehicleId],
    queryFn: () => getVehicleState(vehicleId),
    refetchInterval: 30_000,
  })

  const { data: positions } = useQuery({
    queryKey: ['vehicle-positions', vehicleId],
    queryFn: () => getVehiclePositions(vehicleId, 200),
  })

  const { data: drives } = useQuery({
    queryKey: ['drives', vehicleId],
    queryFn: () => getDrives(vehicleId, 5),
  })

  const { data: sessions } = useQuery({
    queryKey: ['charging', vehicleId],
    queryFn: () => getChargingSessions(vehicleId, 5),
  })

  const wakeMut = useMutation({
    mutationFn: () => wakeVehicle(vehicleId),
    onSuccess: () => { setTimeout(() => refetchState(), 5000) },
  })

  const state = stateData?.state
  const status = vehicle ? getVehicleStatus(vehicle, state) : 'offline'
  const trail: LatLngExpression[] = positions
    ?.filter(p => p.latitude && p.longitude)
    .map(p => [p.latitude, p.longitude] as LatLngExpression) ?? []

  const batteryData = positions?.map(p => ({
    time: new Date(p.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    battery: p.battery_level,
    speed: p.speed ?? 0,
  })).reverse() ?? []

  return (
    <div className="space-y-6">
      {/* Back button + header */}
      <FadeIn>
        <div className="flex items-center gap-4">
          <Link to="/vehicles" className="rounded-xl p-2.5 text-[var(--text-muted)] hover:bg-white/5 hover:text-[var(--text-primary)] transition-all">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight text-[var(--text-primary)]">
                {vehicle?.display_name || vehicle?.vin || 'Vehicle'}
              </h1>
              <StatusBadge status={status as 'online' | 'offline' | 'asleep' | 'driving' | 'charging' | 'updating'} size="md" />
            </div>
            <p className="text-sm text-[var(--text-muted)] mt-0.5">
              {vehicle?.model} {vehicle?.trim_badging} &middot; <span className="font-mono">{vehicle?.vin}</span>
            </p>
          </div>
          <button
            onClick={() => wakeMut.mutate()}
            disabled={wakeMut.isPending}
            className="neon-button flex items-center gap-2 text-sm"
          >
            <Power className="h-4 w-4" />
            {wakeMut.isPending ? 'Waking...' : 'Wake Up'}
          </button>
        </div>
      </FadeIn>

      <FadeIn delay={0.02}>
        <VehicleStatusViz state={state} />
      </FadeIn>

      {state ? (
        <>
          {/* ============ HERO: Car Viz + Gauges ============ */}
          <FadeIn delay={0.05}>
            <GlassPanel className="relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-neon-cyan/[0.02] via-transparent to-neon-purple/[0.02]" />
              <div className="relative grid grid-cols-1 lg:grid-cols-[auto,1fr] gap-8 p-6 lg:p-8">
                {/* Car visualization */}
                <div className="flex items-center justify-center">
                  <TeslaCarViz
                    batteryLevel={state.battery_level}
                    isCharging={state.is_charging}
                    isLocked={state.is_locked}
                    isClimateOn={state.is_climate_on}
                    sentryMode={state.sentry_mode}
                    speed={state.speed}
                    size="lg"
                    model={parseModelKey(vehicle?.model)}
                  />
                </div>

                {/* Gauges + metrics */}
                <div className="flex flex-col gap-6">
                  {/* Radial gauge row */}
                  <div className="flex items-center gap-5 flex-wrap">
                    <RadialGauge
                      value={state.battery_level} max={100}
                      label="Battery" unit="%"
                      color={state.battery_level > 50 ? '#10b981' : state.battery_level > 20 ? '#f59e0b' : '#ef4444'}
                      size={110}
                    />
                    <RadialGauge
                      value={Math.round(state.rated_range)} max={600}
                      label="Range" unit="km"
                      color="#00f0ff" size={110}
                    />
                    <RadialGauge
                      value={state.speed} max={250}
                      label="Speed" unit="km/h"
                      color={state.speed > 0 ? '#a855f7' : '#374151'}
                      size={110}
                    />
                    <RadialGauge
                      value={state.charger_power} max={250}
                      label="Power" unit="kW"
                      color={state.is_charging ? '#10b981' : '#374151'}
                      size={110}
                    />
                  </div>

                  {/* Metric bars */}
                  <div className="space-y-3">
                    <MetricBar value={state.battery_level} max={100} color={state.battery_level > 50 ? '#10b981' : '#f59e0b'} label="Battery Level" sublabel={`${state.battery_level}%`} />
                    <MetricBar value={state.rated_range} max={600} color="#00f0ff" label="Estimated Range" sublabel={`${Math.round(state.rated_range)} km`} />
                    {state.is_charging && (
                      <MetricBar value={state.charge_rate} max={state.charger_power || 100} color="#10b981" label="Charge Rate" sublabel={`${state.charge_rate} km/h added`} />
                    )}
                  </div>

                  {/* Quick info chips */}
                  <div className="flex flex-wrap gap-2">
                    {[
                      { icon: state.is_locked ? Lock : Unlock, label: state.is_locked ? 'Locked' : 'Unlocked', color: state.is_locked ? '#10b981' : '#f59e0b' },
                      { icon: Shield, label: state.sentry_mode ? 'Sentry ON' : 'Sentry OFF', color: state.sentry_mode ? '#ef4444' : '#4b5563' },
                      { icon: Wind, label: state.is_climate_on ? 'Climate ON' : 'Climate OFF', color: state.is_climate_on ? '#00f0ff' : '#4b5563' },
                      { icon: Cpu, label: state.software_version || 'N/A', color: '#a855f7' },
                    ].map(chip => (
                      <span key={chip.label} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-medium border border-white/[0.06] bg-white/[0.02]">
                        <chip.icon className="h-3 w-3" style={{ color: chip.color }} />
                        <span className="text-gray-300">{chip.label}</span>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </GlassPanel>
          </FadeIn>

          {/* ============ TELEMETRY GRID ============ */}
          <StaggerContainer className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            <StaggerItem>
              <InfoTile icon={Battery} label="Battery" value={`${state.battery_level}%`}
                color={state.battery_level > 50 ? 'text-neon-green' : state.battery_level > 20 ? 'text-neon-amber' : 'text-neon-red'}
                sub={`${Math.round(state.rated_range)} km range`} />
            </StaggerItem>
            <StaggerItem>
              <InfoTile icon={Gauge} label="Speed" value={`${state.speed} km/h`}
                sub={state.speed > 0 ? 'Driving' : 'Parked'} />
            </StaggerItem>
            <StaggerItem>
              <InfoTile icon={Thermometer} label="Inside" value={`${state.inside_temp}°C`}
                sub={`Outside: ${state.outside_temp}°C`} />
            </StaggerItem>
            <StaggerItem>
              <InfoTile icon={Navigation} label="Odometer" value={`${Math.round(state.odometer).toLocaleString()} km`} />
            </StaggerItem>
            <StaggerItem>
              <InfoTile icon={BatteryCharging} label="Charger" value={state.is_charging ? `${state.charger_power} kW` : 'Not charging'}
                color={state.is_charging ? 'text-neon-green' : 'text-[var(--text-muted)]'}
                sub={state.is_charging && state.time_to_full_charge != null ? `Full in ${state.time_to_full_charge.toFixed(1)}h` : undefined} />
            </StaggerItem>
            <StaggerItem>
              <InfoTile icon={Eye} label="Sentry" value={state.sentry_mode ? 'Active' : 'Off'}
                color={state.sentry_mode ? 'text-neon-red' : 'text-[var(--text-muted)]'} />
            </StaggerItem>
          </StaggerContainer>

          {/* ============ MAP + CHARTS ROW ============ */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Live Map */}
            {state.latitude && state.longitude && (
              <FadeIn delay={0.15}>
                <GlassPanel className="overflow-hidden h-full">
                  <div className="p-4 pb-0">
                    <h3 className="section-title flex items-center gap-2 mb-3">
                      <Navigation className="h-4 w-4 text-neon-cyan" /> Location
                    </h3>
                  </div>
                  <div className="h-72">
                    <MapContainer center={[state.latitude, state.longitude]} zoom={14} scrollWheelZoom className="h-full w-full">
                      <TileLayer
                        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                        attribution='&copy; <a href="https://carto.com/">CARTO</a>'
                      />
                      <Marker position={[state.latitude, state.longitude]} />
                      {trail.length > 1 && (
                        <Polyline positions={trail} pathOptions={{ color: '#00f0ff', weight: 3, opacity: 0.6 }} />
                      )}
                    </MapContainer>
                  </div>
                  <div className="p-3 text-center">
                    <p className="text-[10px] text-[var(--text-muted)] font-mono">
                      {state.latitude.toFixed(5)}, {state.longitude.toFixed(5)}
                    </p>
                  </div>
                </GlassPanel>
              </FadeIn>
            )}

            {/* Battery & Speed chart */}
            <FadeIn delay={0.2}>
              <GlassPanel className="p-6 h-full">
                <h3 className="section-title mb-4 flex items-center gap-2">
                  <Activity className="h-4 w-4 text-neon-cyan" />
                  Battery & Speed History
                </h3>
                {batteryData.length > 0 ? (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={batteryData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                        <XAxis dataKey="time" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                        <YAxis yAxisId="left" domain={[0, 100]} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                        <YAxis yAxisId="right" orientation="right" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                        <Tooltip content={<ChartTooltip />} />
                        <Area yAxisId="left" type="monotone" dataKey="battery" stroke="#10b981" fill="#10b981" fillOpacity={0.1} name="Battery %" />
                        <Area yAxisId="right" type="monotone" dataKey="speed" stroke="#00f0ff" fill="#00f0ff" fillOpacity={0.1} name="Speed km/h" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="h-64 flex items-center justify-center">
                    <p className="text-xs text-gray-600">Position data will appear here</p>
                  </div>
                )}
              </GlassPanel>
            </FadeIn>
          </div>

          {/* ============ RECENT DRIVES & CHARGES ============ */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <FadeIn delay={0.25}>
              <GlassPanel className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="section-title flex items-center gap-2">
                    <Route className="h-4 w-4 text-neon-cyan" /> Recent Drives
                  </h3>
                  <Link to="/drives" className="text-xs text-[var(--text-muted)] hover:text-neon-cyan transition-colors flex items-center gap-1">
                    View all <ChevronRight className="h-3 w-3" />
                  </Link>
                </div>
                {drives && drives.length > 0 ? (
                  <div className="space-y-2">
                    {drives.slice(0, 5).map(d => (
                      <Link key={d.id} to={`/drives/${d.id}`} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/[0.03] transition-colors group">
                        <div className="rounded-lg bg-neon-cyan/10 p-2 text-neon-cyan">
                          <Route className="h-3.5 w-3.5" />
                        </div>
                        <div className="flex-1 text-sm">
                          <p className="text-[var(--text-primary)] font-medium group-hover:text-neon-cyan transition-colors">
                            <AnimatedNumber value={d.distance} decimals={1} suffix=" km" />
                          </p>
                          <p className="text-xs text-[var(--text-muted)]">{new Date(d.start_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                        </div>
                        <div className="text-right">
                          <span className="text-xs text-[var(--text-muted)] flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {Math.floor(d.duration_min / 60)}h {Math.round(d.duration_min % 60)}m
                          </span>
                          {d.start_battery_level != null && d.end_battery_level != null && (
                            <span className="text-[10px] text-gray-600">{d.start_battery_level}% → {d.end_battery_level}%</span>
                          )}
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-600 text-center py-6">No drives recorded yet</p>
                )}
              </GlassPanel>
            </FadeIn>

            <FadeIn delay={0.3}>
              <GlassPanel className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="section-title flex items-center gap-2">
                    <Zap className="h-4 w-4 text-neon-green" /> Recent Charges
                  </h3>
                  <Link to="/charging" className="text-xs text-[var(--text-muted)] hover:text-neon-cyan transition-colors flex items-center gap-1">
                    View all <ChevronRight className="h-3 w-3" />
                  </Link>
                </div>
                {sessions && sessions.length > 0 ? (
                  <div className="space-y-2">
                    {sessions.slice(0, 5).map(s => (
                      <Link key={s.id} to={`/charging/${s.id}`} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-white/[0.03] transition-colors group">
                        <div className="rounded-lg bg-neon-green/10 p-2 text-neon-green">
                          <Zap className="h-3.5 w-3.5" />
                        </div>
                        <div className="flex-1 text-sm">
                          <p className="text-[var(--text-primary)] font-medium group-hover:text-neon-green transition-colors">
                            <AnimatedNumber value={s.charge_energy_added} decimals={1} suffix=" kWh" />
                          </p>
                          <p className="text-xs text-[var(--text-muted)]">{new Date(s.start_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                        </div>
                        <div className="text-right">
                          <span className="text-xs text-[var(--text-muted)]">{s.start_battery_level}% → {s.end_battery_level ?? '—'}%</span>
                          {s.cost != null && s.cost > 0 && (
                            <p className="text-[10px] text-neon-amber">${s.cost.toFixed(2)}</p>
                          )}
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-600 text-center py-6">No charge sessions yet</p>
                )}
              </GlassPanel>
            </FadeIn>

            <MaintenanceLog vehicleId={vehicleId} />
          </div>
        </>
      ) : (
        <FadeIn delay={0.1}>
          <GlassPanel className="p-12 text-center relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-neon-cyan/[0.02] via-transparent to-neon-purple/[0.02]" />
            <div className="relative">
              <TeslaCarViz batteryLevel={50} isCharging={false} isLocked={true} isClimateOn={false} sentryMode={false} speed={0} model={parseModelKey(vehicle?.model)} size="sm" />
              <p className="text-white/80 font-medium mt-4">No live state available</p>
              <p className="text-sm text-[var(--text-muted)] mt-1">The vehicle may be asleep. Try waking it to fetch current data.</p>
            </div>
          </GlassPanel>
        </FadeIn>
      )}
    </div>
  )
}
