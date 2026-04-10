import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getStaleSessions,
  updateChargingSession,
  updateDrive,
  closeChargingSession,
  closeDrive,
  deleteChargingSession,
  deleteDrive,
} from '../api'
import type { ChargingSession, Drive } from '../api'
import { PageHeader, GlassPanel, FadeIn, EmptyState, Skeleton, Badge, Button } from '../components/ui'
import { useToast } from '../components/Toast'
import { formatDateTime } from '../lib/dateFormat'
import { Wrench, BatteryCharging, Route, AlertTriangle, CheckCircle, X, Save, Clock, Trash2 } from 'lucide-react'
import { tableTokens } from '../lib/tokens'
import clsx from 'clsx'
import { usePageTitle } from '../hooks/usePageTitle'

type Tab = 'charging' | 'drives'

function hoursOpen(startDate: string): string {
  usePageTitle('Data Repair')
  const h = Math.round((Date.now() - new Date(startDate).getTime()) / 3600000)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h`
}

/* ───────── Charging edit form ───────── */
function ChargingEditForm({
  session,
  onClose,
}: {
  session: ChargingSession
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const toast = useToast()

  const [form, setForm] = useState({
    end_date: '',
    charge_energy_added: String(session.charge_energy_added ?? ''),
    end_battery_level: String(session.end_battery_level ?? ''),
    charger_power: String(session.charger_power ?? ''),
    duration_min: String(session.duration_min ?? ''),
    cost: String(session.cost ?? ''),
  })

  const update = useMutation({
    mutationFn: () => {
      const data: Record<string, unknown> = {}
      if (form.end_date) data.end_date = form.end_date
      if (form.charge_energy_added) data.charge_energy_added = Number(form.charge_energy_added)
      if (form.end_battery_level) data.end_battery_level = Number(form.end_battery_level)
      if (form.charger_power) data.charger_power = Number(form.charger_power)
      if (form.duration_min) data.duration_min = Number(form.duration_min)
      if (form.cost) data.cost = Number(form.cost)
      return updateChargingSession(session.id, data as Partial<ChargingSession>)
    },
    onSuccess: () => {
      toast.success('Session updated')
      queryClient.invalidateQueries({ queryKey: ['stale-sessions'] })
      onClose()
    },
    onError: () => toast.error('Failed to update session'),
  })

  const close = useMutation({
    mutationFn: () => closeChargingSession(session.id),
    onSuccess: () => {
      toast.success('Session closed')
      queryClient.invalidateQueries({ queryKey: ['stale-sessions'] })
      onClose()
    },
    onError: () => toast.error('Failed to close session'),
  })

  const discard = useMutation({
    mutationFn: () => deleteChargingSession(session.id),
    onSuccess: () => {
      toast.success('Session discarded')
      queryClient.invalidateQueries({ queryKey: ['stale-sessions'] })
      onClose()
    },
    onError: () => toast.error('Failed to discard session'),
  })

  return (
    <div className="border-t border-white/[0.06] px-4 py-4 space-y-4" style={{ background: 'rgba(245,158,11,0.03)' }}>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <Field label="End Date (ISO)" value={form.end_date} placeholder="2026-03-30T04:00:00Z" onChange={v => setForm(f => ({ ...f, end_date: v }))} />
        <Field label="Energy Added (kWh)" value={form.charge_energy_added} onChange={v => setForm(f => ({ ...f, charge_energy_added: v }))} type="number" />
        <Field label="End Battery %" value={form.end_battery_level} onChange={v => setForm(f => ({ ...f, end_battery_level: v }))} type="number" />
        <Field label="Charger Power (kW)" value={form.charger_power} onChange={v => setForm(f => ({ ...f, charger_power: v }))} type="number" />
        <Field label="Duration (min)" value={form.duration_min} onChange={v => setForm(f => ({ ...f, duration_min: v }))} type="number" />
        <Field label="Cost ($)" value={form.cost} onChange={v => setForm(f => ({ ...f, cost: v }))} type="number" />
      </div>
      <div className="flex items-center gap-2 pt-2">
        <Button variant="secondary" size="sm" onClick={() => update.mutate()} disabled={update.isPending} icon={<Save className="h-3.5 w-3.5" />}>
          Save
        </Button>
        <Button variant="secondary" size="sm" onClick={() => close.mutate()} disabled={close.isPending} icon={<Clock className="h-3.5 w-3.5" />}>
          Close Session
        </Button>
        <Button variant="danger" size="sm" onClick={() => { if (confirm('Delete this session permanently?')) discard.mutate() }} disabled={discard.isPending} icon={<Trash2 className="h-3.5 w-3.5" />}>
          Discard
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose} icon={<X className="h-3.5 w-3.5" />} className="ml-auto">
          Cancel
        </Button>
      </div>
    </div>
  )
}

/* ───────── Drive edit form ───────── */
function DriveEditForm({
  drive,
  onClose,
}: {
  drive: Drive
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const toast = useToast()

  const [form, setForm] = useState({
    end_date: '',
    distance: String(drive.distance ?? ''),
    duration_min: String(drive.duration_min ?? ''),
    end_battery_level: String(drive.end_battery_level ?? ''),
    speed_max: String(drive.speed_max ?? ''),
    end_range_km: String(drive.end_range_km ?? ''),
  })

  const update = useMutation({
    mutationFn: () => {
      const data: Record<string, unknown> = {}
      if (form.end_date) data.end_date = form.end_date
      if (form.distance) data.distance = Number(form.distance)
      if (form.duration_min) data.duration_min = Number(form.duration_min)
      if (form.end_battery_level) data.end_battery_level = Number(form.end_battery_level)
      if (form.speed_max) data.speed_max = Number(form.speed_max)
      if (form.end_range_km) data.end_range_km = Number(form.end_range_km)
      return updateDrive(drive.id, data as Partial<Drive>)
    },
    onSuccess: () => {
      toast.success('Drive updated')
      queryClient.invalidateQueries({ queryKey: ['stale-sessions'] })
      onClose()
    },
    onError: () => toast.error('Failed to update drive'),
  })

  const close = useMutation({
    mutationFn: () => closeDrive(drive.id),
    onSuccess: () => {
      toast.success('Drive closed')
      queryClient.invalidateQueries({ queryKey: ['stale-sessions'] })
      onClose()
    },
    onError: () => toast.error('Failed to close drive'),
  })

  const discard = useMutation({
    mutationFn: () => deleteDrive(drive.id),
    onSuccess: () => {
      toast.success('Drive discarded')
      queryClient.invalidateQueries({ queryKey: ['stale-sessions'] })
      onClose()
    },
    onError: () => toast.error('Failed to discard drive'),
  })

  return (
    <div className="border-t border-white/[0.06] px-4 py-4 space-y-4" style={{ background: 'rgba(245,158,11,0.03)' }}>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <Field label="End Date (ISO)" value={form.end_date} placeholder="2026-03-30T04:00:00Z" onChange={v => setForm(f => ({ ...f, end_date: v }))} />
        <Field label="Distance (km)" value={form.distance} onChange={v => setForm(f => ({ ...f, distance: v }))} type="number" />
        <Field label="Duration (min)" value={form.duration_min} onChange={v => setForm(f => ({ ...f, duration_min: v }))} type="number" />
        <Field label="End Battery %" value={form.end_battery_level} onChange={v => setForm(f => ({ ...f, end_battery_level: v }))} type="number" />
        <Field label="Max Speed (km/h)" value={form.speed_max} onChange={v => setForm(f => ({ ...f, speed_max: v }))} type="number" />
        <Field label="End Range (km)" value={form.end_range_km} onChange={v => setForm(f => ({ ...f, end_range_km: v }))} type="number" />
      </div>
      <div className="flex items-center gap-2 pt-2">
        <Button variant="secondary" size="sm" onClick={() => update.mutate()} disabled={update.isPending} icon={<Save className="h-3.5 w-3.5" />}>
          Save
        </Button>
        <Button variant="secondary" size="sm" onClick={() => close.mutate()} disabled={close.isPending} icon={<Clock className="h-3.5 w-3.5" />}>
          Close Drive
        </Button>
        <Button variant="danger" size="sm" onClick={() => { if (confirm('Delete this drive permanently?')) discard.mutate() }} disabled={discard.isPending} icon={<Trash2 className="h-3.5 w-3.5" />}>
          Discard
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose} icon={<X className="h-3.5 w-3.5" />} className="ml-auto">
          Cancel
        </Button>
      </div>
    </div>
  )
}

/* ───────── Input field component ───────── */
function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
}) {
  return (
    <div>
      <label className="block text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)] mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-amber-500/40 focus:outline-none focus:ring-1 focus:ring-amber-500/20 transition-colors"
      />
    </div>
  )
}

/* ───────── Main page ───────── */
export default function DataRepair() {
  const [tab, setTab] = useState<Tab>('charging')
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const { data, isLoading, error } = useQuery({
    queryKey: ['stale-sessions'],
    queryFn: getStaleSessions,
    refetchInterval: 30_000,
  })

  const staleCharging = data?.stale_charging ?? []
  const staleDrives = data?.stale_drives ?? []
  const totalStale = staleCharging.length + staleDrives.length

  return (
    <>
      <PageHeader
        title="Data Repair"
        subtitle={totalStale > 0 ? `${totalStale} incomplete session${totalStale !== 1 ? 's' : ''} found` : 'Fix incomplete or stale sessions'}
        icon={<Wrench className="h-7 w-7 text-amber-400" />}
      />

      {/* Tabs */}
      <FadeIn delay={0.1}>
        <div className="flex items-center gap-1 mb-6 rounded-xl bg-white/[0.03] p-1 ring-1 ring-white/[0.06] w-fit">
          <TabButton active={tab === 'charging'} onClick={() => { setTab('charging'); setExpandedId(null) }} icon={<BatteryCharging className="h-4 w-4" />} label="Charging Sessions" count={staleCharging.length} />
          <TabButton active={tab === 'drives'} onClick={() => { setTab('drives'); setExpandedId(null) }} icon={<Route className="h-4 w-4" />} label="Drives" count={staleDrives.length} />
        </div>
      </FadeIn>

      {/* Content */}
      <FadeIn delay={0.15}>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : error ? (
          <GlassPanel className="p-6 text-center">
            <AlertTriangle className="h-8 w-8 text-red-400 mx-auto mb-2" />
            <p className="text-sm text-red-400">Failed to load stale sessions</p>
          </GlassPanel>
        ) : tab === 'charging' ? (
          staleCharging.length === 0 ? (
            <EmptyState icon={<CheckCircle className="h-10 w-10" />} title="All sessions are complete ✓" description="No stale charging sessions found." />
          ) : (
            <GlassPanel className="overflow-hidden">
              <table className={tableTokens.wrapper}>
                <thead>
                  <tr className={tableTokens.head}>
                    <Th>ID</Th>
                    <Th>Start Date</Th>
                    <Th>Start Battery</Th>
                    <Th>Vehicle ID</Th>
                    <Th>Duration</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody className={tableTokens.body}>
                  {staleCharging.map(s => (
                    <ChargingRow key={s.id} session={s} expanded={expandedId === s.id} onToggle={() => setExpandedId(expandedId === s.id ? null : s.id)} />
                  ))}
                </tbody>
              </table>
            </GlassPanel>
          )
        ) : (
          staleDrives.length === 0 ? (
            <EmptyState icon={<CheckCircle className="h-10 w-10" />} title="All sessions are complete ✓" description="No stale drives found." />
          ) : (
            <GlassPanel className="overflow-hidden">
              <table className={tableTokens.wrapper}>
                <thead>
                  <tr className={tableTokens.head}>
                    <Th>ID</Th>
                    <Th>Start Date</Th>
                    <Th>Start Battery</Th>
                    <Th>Vehicle ID</Th>
                    <Th>Duration</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody className={tableTokens.body}>
                  {staleDrives.map(d => (
                    <DriveRow key={d.id} drive={d} expanded={expandedId === d.id} onToggle={() => setExpandedId(expandedId === d.id ? null : d.id)} />
                  ))}
                </tbody>
              </table>
            </GlassPanel>
          )
        )}
      </FadeIn>
    </>
  )
}

/* ───────── Table rows ───────── */

function ChargingRow({ session, expanded, onToggle }: { session: ChargingSession; expanded: boolean; onToggle: () => void }) {
  return (
    <>
      <tr onClick={onToggle} className={clsx(tableTokens.row, 'border-b border-white/[0.04] cursor-pointer', expanded && 'bg-amber-500/[0.06]')}>
        <Td>{session.id}</Td>
        <Td>{formatDateTime(session.start_date)}</Td>
        <Td>{session.start_battery_level}%</Td>
        <Td>{session.vehicle_id}</Td>
        <Td><span className="text-amber-400">{hoursOpen(session.start_date)}</span></Td>
        <Td><StatusBadge /></Td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={6}><ChargingEditForm session={session} onClose={onToggle} /></td>
        </tr>
      )}
    </>
  )
}

function DriveRow({ drive, expanded, onToggle }: { drive: Drive; expanded: boolean; onToggle: () => void }) {
  return (
    <>
      <tr onClick={onToggle} className={clsx(tableTokens.row, 'border-b border-white/[0.04] cursor-pointer', expanded && 'bg-amber-500/[0.06]')}>
        <Td>{drive.id}</Td>
        <Td>{formatDateTime(drive.start_date)}</Td>
        <Td>{drive.start_battery_level != null ? `${drive.start_battery_level}%` : '—'}</Td>
        <Td>{drive.vehicle_id}</Td>
        <Td><span className="text-amber-400">{hoursOpen(drive.start_date)}</span></Td>
        <Td><StatusBadge /></Td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={6}><DriveEditForm drive={drive} onClose={onToggle} /></td>
        </tr>
      )}
    </>
  )
}

/* ───────── Small UI pieces ───────── */

function StatusBadge() {
  return (
    <Badge color="amber">
      <AlertTriangle className="h-3 w-3" /> Open
    </Badge>
  )
}

function TabButton({ active, onClick, icon, label, count }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count: number }) {
  return (
    <button onClick={onClick} className={clsx(
      'flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-medium transition-all',
      active ? 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/20 shadow-[0_0_10px_rgba(245,158,11,0.1)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/[0.04]',
    )}>
      {icon}
      {label}
      {count > 0 && (
        <span className={clsx(
          'flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold',
          active ? 'bg-amber-500/20 text-amber-300' : 'bg-white/[0.06] text-[var(--text-muted)]',
        )}>{count}</span>
      )}
    </button>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className={tableTokens.headCell}>{children}</th>
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className={clsx(tableTokens.cell, 'text-[var(--text-secondary)]')}>{children}</td>
}
