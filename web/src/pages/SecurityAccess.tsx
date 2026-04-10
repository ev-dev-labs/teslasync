import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getVehicles, getSecurityEvents, getSecurityLatest, SecurityEvent } from '../api'
import { useVehicleLive } from '../hooks/useVehicleLive'
import { useAdaptiveInterval } from '../hooks/useAdaptiveInterval'
import { PageHeader, GlassPanel, FadeIn, Skeleton, Badge, AlertBanner } from '../components/ui'
import {
  Lock, Unlock, Shield, ShieldCheck, ShieldAlert, Eye,
  DoorOpen, DoorClosed, Home, UserCheck, AlertTriangle, CheckCircle,
  Car, Activity, Clock, Hash, Lightbulb, Key, Gauge, User, Settings, Monitor,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts'
import clsx from 'clsx'
import { formatDateShort } from '../lib/dateFormat'
import { ChartTooltip } from '../components/Charts'
import { usePageTitle } from '../hooks/usePageTitle'

// ─── Helpers ────────────────────────────────────────────────────────────────────

type WindowState = 'Closed' | 'Venting' | 'Open' | 'Unknown'

function parseWindowState(val?: string): WindowState {
  usePageTitle('Security & Access')
  if (!val) return 'Unknown'
  const v = val.toLowerCase()
  if (v === 'closed' || v === 'close') return 'Closed'
  if (v.includes('vent')) return 'Venting'
  if (v === 'open') return 'Open'
  return 'Unknown'
}

function windowColor(state: WindowState): string {
  if (state === 'Closed') return '#10b981'
  if (state === 'Venting') return '#f59e0b'
  if (state === 'Open') return '#ef4444'
  return '#64748b'
}

function windowTextClass(state: WindowState): string {
  if (state === 'Closed') return 'text-neon-green'
  if (state === 'Venting') return 'text-neon-amber'
  if (state === 'Open') return 'text-neon-red'
  return 'text-[var(--text-muted)]'
}

function doorClosed(state?: string): boolean {
  if (!state) return true
  return state.toLowerCase() === 'closed' || state.toLowerCase() === 'close'
}

function formatTimestamp(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function timeSince(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ${hrs % 24}h ago`
}

// ─── Tooltip ────────────────────────────────────────────────────────────────────

// ─── Security Car SVG Visualization ─────────────────────────────────────────────

interface CarVisualizationProps {
  locked?: boolean
  sentryMode?: boolean
  doorState?: string
  fdWindow?: string
  fpWindow?: string
  rdWindow?: string
  rpWindow?: string
  homelinkNearby?: boolean
  guestMode?: boolean
}

function SecurityCarVisualization({
  locked, sentryMode, doorState, fdWindow, fpWindow, rdWindow, rpWindow, homelinkNearby, guestMode,
}: CarVisualizationProps) {
  const isDoorClosed = doorClosed(doorState)
  const doorColor = isDoorClosed ? '#10b981' : '#ef4444'
  const lockColor = locked ? '#10b981' : '#ef4444'
  const sentryColor = sentryMode ? '#3b82f6' : '#64748b'

  const windows = [
    { label: 'FD', state: parseWindowState(fdWindow), cx: 145, cy: 180 },
    { label: 'FP', state: parseWindowState(fpWindow), cx: 255, cy: 180 },
    { label: 'RD', state: parseWindowState(rdWindow), cx: 145, cy: 360 },
    { label: 'RP', state: parseWindowState(rpWindow), cx: 255, cy: 360 },
  ]

  const doors = [
    { label: 'FL', cx: 115, cy: 230, side: 'left' as const },
    { label: 'FR', cx: 285, cy: 230, side: 'right' as const },
    { label: 'RL', cx: 115, cy: 390, side: 'left' as const },
    { label: 'RR', cx: 285, cy: 390, side: 'right' as const },
  ]

  const isSecure = locked && isDoorClosed && windows.every(w => w.state === 'Closed')
  const statusColor = isSecure ? '#10b981' : '#ef4444'

  return (
    <svg viewBox="0 0 400 620" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', maxWidth: '100%' }} role="img" aria-label="Vehicle security visualization">
      <style>{`
        .scv-pulse{animation:scvPulse 2s ease-in-out infinite}
        .scv-glow{animation:scvGlow 3s ease-in-out infinite}
        .scv-scan{animation:scvScan 4s linear infinite}
        .scv-sentry{animation:scvSentry 1.5s ease-in-out infinite}
        @keyframes scvPulse{0%,100%{opacity:0.3}50%{opacity:1}}
        @keyframes scvGlow{0%,100%{opacity:0.4}50%{opacity:1}}
        @keyframes scvScan{0%{opacity:0}10%{opacity:0.2}90%{opacity:0.2}100%{opacity:0}}
        @keyframes scvSentry{0%,100%{opacity:0.6;r:6}50%{opacity:1;r:9}}
      `}</style>
      <defs>
        <linearGradient id="scvStroke" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#06b6d4" /><stop offset="100%" stopColor="#10b981" />
        </linearGradient>
        <linearGradient id="scvBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1e293b" stopOpacity="0.85" /><stop offset="100%" stopColor="#0f172a" stopOpacity="0.95" />
        </linearGradient>
        <linearGradient id="scvGlass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.2" /><stop offset="100%" stopColor="#06b6d4" stopOpacity="0.05" />
        </linearGradient>
        <filter id="scvGlowF">
          <feGaussianBlur stdDeviation="4" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="scvSentryGlow">
          <feGaussianBlur stdDeviation="6" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Car body */}
      <path d="M200,78 C245,78 270,100 274,135 L278,210 L280,370 L277,445 C274,495 252,518 200,522 C148,518 126,495 123,445 L120,370 L122,210 L126,135 C130,100 155,78 200,78Z" fill="url(#scvBody)" stroke="url(#scvStroke)" strokeWidth="2" />
      <line x1="135" y1="220" x2="265" y2="220" stroke="#334155" strokeWidth="0.8" opacity="0.4" />
      <line x1="132" y1="380" x2="268" y2="380" stroke="#334155" strokeWidth="0.8" opacity="0.4" />

      {/* Windshield */}
      <path d="M165,128 C170,105 182,92 200,88 C218,92 230,105 235,128 L240,168 L160,168Z" fill="url(#scvGlass)" stroke="#22d3ee" strokeWidth="1" strokeOpacity="0.3" />
      {/* Rear window */}
      <path d="M160,440 L240,440 L235,478 C230,498 218,508 200,512 C182,508 170,498 165,478Z" fill="url(#scvGlass)" stroke="#22d3ee" strokeWidth="1" strokeOpacity="0.3" />

      {/* Headlights */}
      <ellipse cx="140" cy="118" rx="10" ry="5" fill="#fbbf24" className="scv-glow" filter="url(#scvGlowF)" />
      <ellipse cx="260" cy="118" rx="10" ry="5" fill="#fbbf24" className="scv-glow" filter="url(#scvGlowF)" />

      {/* Taillights */}
      <ellipse cx="145" cy="490" rx="8" ry="4" fill="#ef4444" opacity="0.6" filter="url(#scvGlowF)">
        <animate attributeName="opacity" values="0.3;0.7;0.3" dur="2.5s" repeatCount="indefinite" />
      </ellipse>
      <ellipse cx="255" cy="490" rx="8" ry="4" fill="#ef4444" opacity="0.6" filter="url(#scvGlowF)">
        <animate attributeName="opacity" values="0.3;0.7;0.3" dur="2.5s" repeatCount="indefinite" />
      </ellipse>

      {/* Side mirrors */}
      <ellipse cx="115" cy="175" rx="8" ry="5" fill="#1e293b" stroke="#334155" strokeWidth="1" />
      <ellipse cx="285" cy="175" rx="8" ry="5" fill="#1e293b" stroke="#334155" strokeWidth="1" />

      {/* Door indicators */}
      {doors.map(d => (
        <g key={d.label}>
          <circle cx={d.cx} cy={d.cy} r="10" fill="#0f172a" stroke={doorColor} strokeWidth="1.5" />
          <circle cx={d.cx} cy={d.cy} r="4" fill={doorColor}>
            <animate attributeName="opacity" values="0.6;1;0.6" dur="2s" repeatCount="indefinite" />
          </circle>
          {/* Pulse ring for open doors */}
          {!isDoorClosed && (
            <circle cx={d.cx} cy={d.cy} fill="none" stroke={doorColor} strokeWidth="1" r="10" opacity="0">
              <animate attributeName="r" values="10;24" dur="1.5s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.5;0" dur="1.5s" repeatCount="indefinite" />
            </circle>
          )}
          <text x={d.cx} y={d.cy + 22} textAnchor="middle" fontSize="7" fill="#9ca3af" fontFamily="system-ui,sans-serif">{d.label}</text>
        </g>
      ))}

      {/* Window indicators */}
      {windows.map(w => {
        const c = windowColor(w.state)
        return (
          <g key={w.label}>
            <rect x={w.cx - 12} y={w.cy - 8} width={24} height={16} rx={3} fill="#0f172a" stroke={c} strokeWidth="1.2" />
            <line x1={w.cx - 7} y1={w.cy - 2} x2={w.cx + 7} y2={w.cy - 2} stroke={c} strokeWidth="1" opacity="0.6" />
            <line x1={w.cx - 7} y1={w.cy + 2} x2={w.cx + 7} y2={w.cy + 2} stroke={c} strokeWidth="1" opacity="0.4" />
            <text x={w.cx} y={w.cy + 20} textAnchor="middle" fontSize="6" fill={c} fontFamily="system-ui,sans-serif">{w.label}: {w.state}</text>
          </g>
        )
      })}

      {/* Center lock status */}
      <rect x="168" y="268" width="64" height="64" rx="12" fill="#0f172a" stroke={lockColor} strokeWidth="1.5" opacity="0.9" />
      {locked ? (
        <g transform="translate(188, 282)">
          <rect x="2" y="8" width="20" height="14" rx="3" fill="none" stroke={lockColor} strokeWidth="2" />
          <path d="M6,8 V5 C6,2 8,0 12,0 C16,0 18,2 18,5 V8" fill="none" stroke={lockColor} strokeWidth="2" strokeLinecap="round" />
          <circle cx="12" cy="17" r="2" fill={lockColor} />
        </g>
      ) : (
        <g transform="translate(188, 282)">
          <rect x="2" y="8" width="20" height="14" rx="3" fill="none" stroke={lockColor} strokeWidth="2" />
          <path d="M6,8 V5 C6,2 8,0 12,0 C16,0 18,2 18,5" fill="none" stroke={lockColor} strokeWidth="2" strokeLinecap="round" />
          <circle cx="12" cy="17" r="2" fill={lockColor} />
        </g>
      )}
      <text x="200" y="345" textAnchor="middle" fontSize="8" fontWeight="600" fill={lockColor} fontFamily="system-ui,sans-serif">
        {locked ? 'LOCKED' : 'UNLOCKED'}
      </text>

      {/* Sentry mode indicator at top center */}
      {sentryMode && (
        <g>
          <circle cx="200" cy="108" r="8" fill="none" stroke={sentryColor} strokeWidth="1.5" filter="url(#scvSentryGlow)">
            <animate attributeName="r" values="8;14" dur="2s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.6;0" dur="2s" repeatCount="indefinite" />
          </circle>
          <circle cx="200" cy="108" className="scv-sentry" fill={sentryColor} filter="url(#scvSentryGlow)" />
        </g>
      )}
      <text x="200" y={sentryMode ? 130 : 112} textAnchor="middle" fontSize="7" fill={sentryColor} fontFamily="system-ui,sans-serif" fontWeight="600">
        {sentryMode ? 'SENTRY ON' : 'SENTRY OFF'}
      </text>

      {/* HomeLink indicator */}
      {homelinkNearby && (
        <g>
          <rect x="150" y="540" width="50" height="18" rx="4" fill="#0f172a" stroke="#a855f7" strokeWidth="1" opacity="0.9" />
          <text x="175" y="553" textAnchor="middle" fontSize="7" fill="#a855f7" fontFamily="system-ui,sans-serif" fontWeight="600">HOMELINK</text>
        </g>
      )}

      {/* Guest mode indicator */}
      {guestMode && (
        <g>
          <rect x="200" y="540" width="50" height="18" rx="4" fill="#0f172a" stroke="#f59e0b" strokeWidth="1" opacity="0.9" />
          <text x="225" y="553" textAnchor="middle" fontSize="7" fill="#f59e0b" fontFamily="system-ui,sans-serif" fontWeight="600">GUEST</text>
        </g>
      )}

      {/* Status HUD */}
      <rect x="155" y="560" width="90" height="30" rx="6" fill="#0f172a" stroke={statusColor} strokeWidth="1" opacity="0.8" />
      <text x="200" y="578" textAnchor="middle" fontSize="10" fontWeight="bold" fill={statusColor} fontFamily="system-ui,sans-serif" letterSpacing="2">
        {isSecure ? 'SECURE' : 'ALERT'}
      </text>
      <circle cx="200" cy="596" r="3" fill={statusColor}>
        <animate attributeName="opacity" values="1;0.3;1" dur="2s" repeatCount="indefinite" />
      </circle>

      {/* Tesla T logo */}
      <text x="200" y="262" textAnchor="middle" fontSize="14" fontWeight="bold" fill="#22d3ee" opacity="0.4" fontFamily="system-ui,sans-serif">
        {'T'}
        <animate attributeName="opacity" values="0.2;0.5;0.2" dur="4s" repeatCount="indefinite" />
      </text>

      {/* Scanner line */}
      <line x1="130" y1="100" x2="270" y2="100" stroke="#22d3ee" strokeWidth="1.5" opacity="0" className="scv-scan">
        <animate attributeName="y1" values="100;520" dur="4s" repeatCount="indefinite" />
        <animate attributeName="y2" values="100;520" dur="4s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0;0.2;0.2;0" dur="4s" repeatCount="indefinite" />
      </line>
    </svg>
  )
}

// ─── Event Categorization ───────────────────────────────────────────────────────

interface EventChange {
  type: 'lock' | 'sentry' | 'door' | 'window' | 'homelink' | 'guest'
  label: string
  color: string
  icon: 'lock' | 'unlock' | 'shield-on' | 'shield-off' | 'door-open' | 'door-closed' | 'window' | 'home' | 'user'
}

function describeEvent(event: SecurityEvent, prev?: SecurityEvent): EventChange[] {
  const changes: EventChange[] = []
  if (prev) {
    if (event.locked !== prev.locked) {
      changes.push({
        type: 'lock',
        label: event.locked ? 'Vehicle Locked' : 'Vehicle Unlocked',
        color: event.locked ? '#10b981' : '#ef4444',
        icon: event.locked ? 'lock' : 'unlock',
      })
    }
    if (event.sentry_mode !== prev.sentry_mode) {
      changes.push({
        type: 'sentry',
        label: event.sentry_mode ? 'Sentry Mode Activated' : 'Sentry Mode Deactivated',
        color: event.sentry_mode ? '#3b82f6' : '#64748b',
        icon: event.sentry_mode ? 'shield-on' : 'shield-off',
      })
    }
    if (event.door_state !== prev.door_state) {
      const closed = doorClosed(event.door_state)
      changes.push({
        type: 'door',
        label: closed ? 'Doors Closed' : `Doors: ${event.door_state}`,
        color: '#f59e0b',
        icon: closed ? 'door-closed' : 'door-open',
      })
    }
    const winKeys = ['fd_window', 'fp_window', 'rd_window', 'rp_window'] as const
    for (const k of winKeys) {
      if (event[k] !== prev[k]) {
        const label_map = { fd_window: 'FD Window', fp_window: 'FP Window', rd_window: 'RD Window', rp_window: 'RP Window' }
        changes.push({
          type: 'window',
          label: `${label_map[k]}: ${event[k] ?? 'Unknown'}`,
          color: '#f59e0b',
          icon: 'window',
        })
      }
    }
    if (event.homelink_nearby !== prev.homelink_nearby) {
      changes.push({
        type: 'homelink',
        label: event.homelink_nearby ? 'HomeLink Detected' : 'HomeLink Lost',
        color: '#a855f7',
        icon: 'home',
      })
    }
    if (event.guest_mode !== prev.guest_mode) {
      changes.push({
        type: 'guest',
        label: event.guest_mode ? 'Guest Mode Enabled' : 'Guest Mode Disabled',
        color: '#f59e0b',
        icon: 'user',
      })
    }
  }
  if (changes.length === 0) {
    changes.push({
      type: 'lock',
      label: event.locked ? 'Locked' : event.sentry_mode ? 'Sentry Active' : 'Security Event',
      color: '#22d3ee',
      icon: event.locked ? 'lock' : 'shield-on',
    })
  }
  return changes
}

function EventIcon({ icon, className }: { icon: EventChange['icon']; className?: string }) {
  const cls = className ?? 'h-4 w-4'
  switch (icon) {
    case 'lock': return <Lock className={cls} />
    case 'unlock': return <Unlock className={cls} />
    case 'shield-on': return <ShieldCheck className={cls} />
    case 'shield-off': return <ShieldAlert className={cls} />
    case 'door-open': return <DoorOpen className={cls} />
    case 'door-closed': return <DoorClosed className={cls} />
    case 'window': return <Car className={cls} />
    case 'home': return <Home className={cls} />
    case 'user': return <UserCheck className={cls} />
  }
}

// ─── Main Component ─────────────────────────────────────────────────────────────

export default function SecurityAccess() {
  const { data: vehicles } = useQuery({ queryKey: ['vehicles'], queryFn: getVehicles })
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null)
  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null
  const [limit] = useState(100)

  // SSE live state for instant updates
  const { state: live, connected: sseConnected } = useVehicleLive(vehicleId ?? undefined)
  const pollInterval = useAdaptiveInterval()

  const { data: securityData, isLoading: loadingHistory } = useQuery({
    queryKey: ['security', vehicleId, limit],
    queryFn: () => getSecurityEvents(vehicleId!, limit),
    enabled: !!vehicleId,
    refetchInterval: 5000,
  })

  const { data: latest, isLoading: loadingLatest } = useQuery({
    queryKey: ['security-latest', vehicleId],
    queryFn: () => getSecurityLatest(vehicleId!),
    enabled: !!vehicleId,
    refetchInterval: pollInterval,
  })

  // ── Computed values ──────────────────────────────────────────────────────────

  const history = securityData ?? []
  const sortedHistory = useMemo(() => [...history].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()), [history])

  const windowSummary = useMemo(() => {
    if (!latest) return 'N/A'
    const states = [
      { name: 'FD', state: parseWindowState(latest.fd_window) },
      { name: 'FP', state: parseWindowState(latest.fp_window) },
      { name: 'RD', state: parseWindowState(latest.rd_window) },
      { name: 'RP', state: parseWindowState(latest.rp_window) },
    ]
    if (states.every(s => s.state === 'Closed')) return 'All Closed'
    return states.filter(s => s.state !== 'Closed').map(s => `${s.name}: ${s.state}`).join(', ')
  }, [latest])

  const stats = useMemo(() => {
    const events = history
    const lockEvents = events.filter((e, i) => i === 0 || e.locked !== events[i - 1]?.locked).length
    const sentryOnCount = events.filter(e => e.sentry_mode).length
    const sentryPct = events.length > 0 ? Math.round((sentryOnCount / events.length) * 100) : 0
    const doorOpenCount = events.filter(e => !doorClosed(e.door_state)).length
    const windowOpenCount = events.filter(e =>
      parseWindowState(e.fd_window) !== 'Closed' ||
      parseWindowState(e.fp_window) !== 'Closed' ||
      parseWindowState(e.rd_window) !== 'Closed' ||
      parseWindowState(e.rp_window) !== 'Closed'
    ).length
    const homelinkCount = events.filter(e => e.homelink_nearby).length
    const guestCount = events.filter(e => e.guest_mode).length
    return { lockEvents, sentryPct, doorOpenCount, windowOpenCount, homelinkCount, guestCount, total: events.length }
  }, [history])

  const sentryChartData = useMemo(() => {
    const reversed = [...history].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    const buckets: Record<string, { on: number; off: number }> = {}
    for (const e of reversed) {
      const key = formatDateShort(e.created_at)
      if (!buckets[key]) buckets[key] = { on: 0, off: 0 }
      if (e.sentry_mode) buckets[key].on++
      else buckets[key].off++
    }
    return Object.entries(buckets).map(([day, v]) => ({ day, on: v.on, off: v.off }))
  }, [history])

  const isSecure = latest?.locked && doorClosed(latest?.door_state) &&
    parseWindowState(latest?.fd_window) === 'Closed' &&
    parseWindowState(latest?.fp_window) === 'Closed' &&
    parseWindowState(latest?.rd_window) === 'Closed' &&
    parseWindowState(latest?.rp_window) === 'Closed'

  const lastLockChangeTime = useMemo(() => {
    for (let i = 0; i < sortedHistory.length - 1; i++) {
      if (sortedHistory[i].locked !== sortedHistory[i + 1]?.locked) {
        return sortedHistory[i].created_at
      }
    }
    return sortedHistory[0]?.created_at
  }, [sortedHistory])

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <FadeIn>
      {/* Header + Vehicle Selector */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 mb-6 sm:mb-8">
        <PageHeader title="Security & Access" subtitle="Vehicle lock status, sentry mode monitoring, and access events" icon={<Shield className="h-7 w-7 text-neon-cyan" />} />
        {vehicles && vehicles.length > 1 && (
          <select
            value={vehicleId ?? ''}
            onChange={e => setSelectedVehicle(Number(e.target.value))}
            className="px-3 py-2 text-sm rounded-lg border-0 focus:ring-1 focus:ring-neon-cyan/50"
            style={{ background: 'var(--surface-2)', color: 'var(--text-primary)' }}
          >
            {vehicles.map(v => <option key={v.id} value={v.id}>{v.display_name || v.vin}</option>)}
          </select>
        )}
      </div>

      {/* Alert banner for insecure state */}
      {!loadingLatest && latest && !isSecure && (
        <AlertBanner variant="danger" icon={<AlertTriangle className="h-5 w-5" />} className="mb-6">
          Vehicle is not fully secure. Check lock status, doors, and windows.
        </AlertBanner>
      )}

      {/* ── Summary Stats Row ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
        {loadingLatest ? [1,2,3,4].map(i => <Skeleton key={i} className="h-24 rounded-xl" />) : (
          <>
            <GlassPanel className="p-4 flex flex-col items-center gap-2">
              {isSecure ? <CheckCircle className="h-6 w-6 text-neon-green" /> : <AlertTriangle className="h-6 w-6 text-neon-red" />}
              <span className={clsx('text-lg font-bold', isSecure ? 'text-neon-green' : 'text-neon-red')}>{isSecure ? 'Secure' : 'Unsecure'}</span>
              <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Current Status</span>
            </GlassPanel>
            <GlassPanel className="p-4 flex flex-col items-center gap-2">
              <Clock className="h-6 w-6 text-neon-cyan" />
              <span className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{lastLockChangeTime ? timeSince(lastLockChangeTime) : '--'}</span>
              <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Last Lock Change</span>
            </GlassPanel>
            <GlassPanel className="p-4 flex flex-col items-center gap-2">
              <Eye className="h-6 w-6 text-neon-blue" />
              <span className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{stats.sentryPct}%</span>
              <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Sentry Uptime</span>
            </GlassPanel>
            <GlassPanel className="p-4 flex flex-col items-center gap-2">
              <Hash className="h-6 w-6 text-neon-purple" />
              <span className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{stats.total}</span>
              <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Total Events</span>
            </GlassPanel>
          </>
        )}
      </div>

      {/* ── Live Security Visualization ────────────────────────────────────────── */}
      {!loadingLatest && latest && (
        <div className="mb-6 sm:mb-8">
          <GlassPanel className="p-6 flex justify-center">
            <div className="w-full max-w-sm">
              <SecurityCarVisualization
                locked={latest.locked}
                sentryMode={latest.sentry_mode}
                doorState={latest.door_state}
                fdWindow={latest.fd_window}
                fpWindow={latest.fp_window}
                rdWindow={latest.rd_window}
                rpWindow={latest.rp_window}
                homelinkNearby={latest.homelink_nearby}
                guestMode={latest.guest_mode}
              />
            </div>
          </GlassPanel>
        </div>
      )}

      {/* ── Security Status Cards (2×3 grid) ──────────────────────────────────── */}
      {loadingLatest ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-6 sm:mb-8">
          {[1,2,3,4,5,6].map(i => <Skeleton key={i} className="h-32 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 mb-6 sm:mb-8">
          {/* Lock Status */}
          <GlassPanel className="p-5 flex flex-col items-center gap-3">
            <div className={clsx('p-3 rounded-full', latest?.locked ? 'bg-neon-green/10' : 'bg-neon-red/10')}>
              {latest?.locked ? <Lock className="h-7 w-7 text-neon-green" /> : <Unlock className="h-7 w-7 text-neon-red" />}
            </div>
            <span className={clsx('text-lg font-bold', latest?.locked ? 'text-neon-green' : 'text-neon-red')}>
              {latest?.locked ? 'Locked' : 'Unlocked'}
            </span>
            <Badge color={latest?.locked ? 'green' : 'red'} size="sm">Lock Status</Badge>
          </GlassPanel>

          {/* Sentry Mode */}
          <GlassPanel className={clsx('p-5 flex flex-col items-center gap-3 transition-shadow', latest?.sentry_mode && 'shadow-[0_0_20px_rgba(59,130,246,0.15)]')}>
            <div className={clsx('p-3 rounded-full', latest?.sentry_mode ? 'bg-blue-500/10' : 'bg-white/5')}>
              {latest?.sentry_mode ? <ShieldCheck className="h-7 w-7 text-blue-400" /> : <ShieldAlert className="h-7 w-7 text-[var(--text-muted)]" />}
            </div>
            <span className={clsx('text-lg font-bold', latest?.sentry_mode ? 'text-blue-400' : 'text-[var(--text-muted)]')}>
              {latest?.sentry_mode ? 'Active' : 'Inactive'}
            </span>
            <Badge color={latest?.sentry_mode ? 'cyan' : 'neutral'} size="sm">Sentry Mode</Badge>
          </GlassPanel>

          {/* Doors */}
          <GlassPanel className="p-5 flex flex-col items-center gap-3">
            <div className={clsx('p-3 rounded-full', doorClosed(latest?.door_state) ? 'bg-neon-green/10' : 'bg-neon-amber/10')}>
              {doorClosed(latest?.door_state) ? <DoorClosed className="h-7 w-7 text-neon-green" /> : <DoorOpen className="h-7 w-7 text-neon-amber" />}
            </div>
            <span className={clsx('text-lg font-bold', doorClosed(latest?.door_state) ? 'text-neon-green' : 'text-neon-amber')}>
              {doorClosed(latest?.door_state) ? 'Closed' : latest?.door_state ?? 'Unknown'}
            </span>
            <Badge color={doorClosed(latest?.door_state) ? 'green' : 'amber'} size="sm">Doors</Badge>
          </GlassPanel>

          {/* Windows */}
          <GlassPanel className="p-5 flex flex-col items-center gap-3">
            <div className={clsx('p-3 rounded-full', windowSummary === 'All Closed' ? 'bg-neon-green/10' : 'bg-neon-amber/10')}>
              <Car className={clsx('h-7 w-7', windowSummary === 'All Closed' ? 'text-neon-green' : 'text-neon-amber')} />
            </div>
            <span className={clsx('text-sm font-bold text-center', windowSummary === 'All Closed' ? 'text-neon-green' : 'text-neon-amber')}>
              {windowSummary}
            </span>
            <Badge color={windowSummary === 'All Closed' ? 'green' : 'amber'} size="sm">Windows</Badge>
          </GlassPanel>

          {/* HomeLink */}
          <GlassPanel className="p-5 flex flex-col items-center gap-3">
            <div className={clsx('p-3 rounded-full', latest?.homelink_nearby ? 'bg-purple-500/10' : 'bg-white/5')}>
              <Home className={clsx('h-7 w-7', latest?.homelink_nearby ? 'text-purple-400' : 'text-[var(--text-muted)]')} />
            </div>
            <span className={clsx('text-lg font-bold', latest?.homelink_nearby ? 'text-purple-400' : 'text-[var(--text-muted)]')}>
              {latest?.homelink_nearby ? 'Nearby' : 'Not Detected'}
            </span>
            <Badge color={latest?.homelink_nearby ? 'purple' : 'neutral'} size="sm">HomeLink</Badge>
          </GlassPanel>

          {/* Guest Mode */}
          <GlassPanel className="p-5 flex flex-col items-center gap-3">
            <div className={clsx('p-3 rounded-full', latest?.guest_mode ? 'bg-neon-amber/10' : 'bg-white/5')}>
              <UserCheck className={clsx('h-7 w-7', latest?.guest_mode ? 'text-neon-amber' : 'text-[var(--text-muted)]')} />
            </div>
            <span className={clsx('text-lg font-bold', latest?.guest_mode ? 'text-neon-amber' : 'text-[var(--text-muted)]')}>
              {latest?.guest_mode ? 'Enabled' : 'Disabled'}
            </span>
            <Badge color={latest?.guest_mode ? 'amber' : 'neutral'} size="sm">Guest Mode</Badge>
          </GlassPanel>
        </div>
      )}

      {/* ── Window Status Detail Panel ─────────────────────────────────────────── */}
      <GlassPanel className="p-4 sm:p-6 mb-6 sm:mb-8">
        <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Window Status Detail</h3>
        {loadingLatest ? <Skeleton className="h-28 rounded-xl" /> : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'Front Driver Window', val: latest?.fd_window },
              { label: 'Front Passenger Window', val: latest?.fp_window },
              { label: 'Rear Driver Window', val: latest?.rd_window },
              { label: 'Rear Passenger Window', val: latest?.rp_window },
            ].map(w => {
              const state = parseWindowState(w.val)
              return (
                <GlassPanel key={w.label} className="p-4 flex items-center gap-3">
                  <div className={clsx('p-2 rounded-lg', state === 'Closed' ? 'bg-neon-green/10' : state === 'Venting' ? 'bg-neon-amber/10' : state === 'Open' ? 'bg-neon-red/10' : 'bg-white/5')}>
                    <Car className={clsx('h-5 w-5', windowTextClass(state))} />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{w.label}</span>
                    <span className={clsx('text-sm font-semibold', windowTextClass(state))}>{state}</span>
                  </div>
                </GlassPanel>
              )
            })}
          </div>
        )}
      </GlassPanel>

      {/* ── Live Vehicle State Signals ──────────────────────────────────────── */}
      <GlassPanel className="p-4 sm:p-6 mb-6 sm:mb-8">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Live Vehicle State</h3>
          {sseConnected && (
            <span className="flex items-center gap-1.5 text-[10px] text-neon-green">
              <span className="w-1.5 h-1.5 rounded-full bg-neon-green animate-pulse" />
              Live
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {/* Lights */}
          <GlassPanel className="p-3 flex items-center gap-3">
            <div className={clsx('p-2 rounded-lg', live.lightsHazards ? 'bg-neon-red/10' : 'bg-white/5')}>
              <AlertTriangle className={clsx('h-4 w-4', live.lightsHazards ? 'text-neon-red' : 'text-[var(--text-muted)]')} />
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Hazards</span>
              <span className={clsx('text-sm font-semibold', live.lightsHazards ? 'text-neon-red' : 'text-[var(--text-muted)]')}>
                {live.lightsHazards ? 'Active' : 'Off'}
              </span>
            </div>
          </GlassPanel>

          <GlassPanel className="p-3 flex items-center gap-3">
            <div className={clsx('p-2 rounded-lg', live.lightsHighBeams ? 'bg-neon-cyan/10' : 'bg-white/5')}>
              <Lightbulb className={clsx('h-4 w-4', live.lightsHighBeams ? 'text-neon-cyan' : 'text-[var(--text-muted)]')} />
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>High Beams</span>
              <span className={clsx('text-sm font-semibold', live.lightsHighBeams ? 'text-neon-cyan' : 'text-[var(--text-muted)]')}>
                {live.lightsHighBeams ? 'On' : 'Off'}
              </span>
            </div>
          </GlassPanel>

          <GlassPanel className="p-3 flex items-center gap-3">
            <div className={clsx('p-2 rounded-lg', live.lightsTurnSignal && live.lightsTurnSignal !== 'Off' ? 'bg-neon-amber/10' : 'bg-white/5')}>
              <Car className={clsx('h-4 w-4', live.lightsTurnSignal && live.lightsTurnSignal !== 'Off' ? 'text-neon-amber' : 'text-[var(--text-muted)]')} />
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Turn Signal</span>
              <span className={clsx('text-sm font-semibold', live.lightsTurnSignal && live.lightsTurnSignal !== 'Off' ? 'text-neon-amber' : 'text-[var(--text-muted)]')}>
                {live.lightsTurnSignal || 'Off'}
              </span>
            </div>
          </GlassPanel>

          {/* Driver & Keys */}
          <GlassPanel className="p-3 flex items-center gap-3">
            <div className={clsx('p-2 rounded-lg', live.driverSeatOccupied ? 'bg-neon-green/10' : 'bg-white/5')}>
              <User className={clsx('h-4 w-4', live.driverSeatOccupied ? 'text-neon-green' : 'text-[var(--text-muted)]')} />
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Driver Seat</span>
              <span className={clsx('text-sm font-semibold', live.driverSeatOccupied ? 'text-neon-green' : 'text-[var(--text-muted)]')}>
                {live.driverSeatOccupied ? 'Occupied' : 'Empty'}
              </span>
            </div>
          </GlassPanel>

          <GlassPanel className="p-3 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-neon-cyan/10">
              <Key className="h-4 w-4 text-neon-cyan" />
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Paired Keys</span>
              <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                {live.pairedKeyCount || '--'}
              </span>
            </div>
          </GlassPanel>

          {/* Access Modes */}
          <GlassPanel className="p-3 flex items-center gap-3">
            <div className={clsx('p-2 rounded-lg', live.valetMode ? 'bg-neon-purple/10' : 'bg-white/5')}>
              <Car className={clsx('h-4 w-4', live.valetMode ? 'text-neon-purple' : 'text-[var(--text-muted)]')} />
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Valet Mode</span>
              <span className={clsx('text-sm font-semibold', live.valetMode ? 'text-neon-purple' : 'text-[var(--text-muted)]')}>
                {live.valetMode ? 'Enabled' : 'Off'}
              </span>
            </div>
          </GlassPanel>

          <GlassPanel className="p-3 flex items-center gap-3">
            <div className={clsx('p-2 rounded-lg', live.serviceMode ? 'bg-neon-amber/10' : 'bg-white/5')}>
              <Settings className={clsx('h-4 w-4', live.serviceMode ? 'text-neon-amber' : 'text-[var(--text-muted)]')} />
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Service Mode</span>
              <span className={clsx('text-sm font-semibold', live.serviceMode ? 'text-neon-amber' : 'text-[var(--text-muted)]')}>
                {live.serviceMode ? 'Active' : 'Off'}
              </span>
            </div>
          </GlassPanel>

          <GlassPanel className="p-3 flex items-center gap-3">
            <div className={clsx('p-2 rounded-lg', live.speedLimitMode ? 'bg-neon-cyan/10' : 'bg-white/5')}>
              <Gauge className={clsx('h-4 w-4', live.speedLimitMode ? 'text-neon-cyan' : 'text-[var(--text-muted)]')} />
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Speed Limit</span>
              <span className={clsx('text-sm font-semibold', live.speedLimitMode ? 'text-neon-cyan' : 'text-[var(--text-muted)]')}>
                {live.speedLimitMode ? `${Math.round(live.currentSpeedLimit)} mph` : 'Off'}
              </span>
            </div>
          </GlassPanel>

          {/* Homelink Device Count */}
          <GlassPanel className="p-3 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-500/10">
              <Home className="h-4 w-4 text-purple-400" />
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>HomeLink Devices</span>
              <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                {live.homelinkDeviceCount || '--'}
              </span>
            </div>
          </GlassPanel>

          {/* Center Display */}
          <GlassPanel className="p-3 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-neon-cyan/10">
              <Monitor className="h-4 w-4 text-neon-cyan" />
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Center Display</span>
              <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                {live.centerDisplay || '--'}
              </span>
            </div>
          </GlassPanel>
        </div>
      </GlassPanel>

      {/* ── Security Statistics Panel ──────────────────────────────────────────── */}
      <GlassPanel className="p-4 sm:p-6 mb-6 sm:mb-8">
        <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Security Statistics</h3>
        {loadingHistory ? <Skeleton className="h-28 rounded-xl" /> : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {[
              { label: 'Lock/Unlock Events', value: stats.lockEvents, icon: <Lock className="h-4 w-4" />, color: 'text-neon-green' },
              { label: 'Sentry Uptime', value: `${stats.sentryPct}%`, icon: <Eye className="h-4 w-4" />, color: 'text-blue-400' },
              { label: 'Door Open Events', value: stats.doorOpenCount, icon: <DoorOpen className="h-4 w-4" />, color: 'text-neon-amber' },
              { label: 'Window Open Events', value: stats.windowOpenCount, icon: <Car className="h-4 w-4" />, color: 'text-neon-amber' },
              { label: 'HomeLink Detections', value: stats.homelinkCount, icon: <Home className="h-4 w-4" />, color: 'text-purple-400' },
              { label: 'Guest Mode Usage', value: stats.guestCount, icon: <UserCheck className="h-4 w-4" />, color: 'text-neon-amber' },
              { label: 'Total Events', value: stats.total, icon: <Activity className="h-4 w-4" />, color: 'text-neon-cyan' },
            ].map(s => (
              <GlassPanel key={s.label} className="p-3 sm:p-4 flex flex-col items-center gap-2">
                <div className={clsx(s.color)}>{s.icon}</div>
                <span className={clsx('text-xl font-bold', s.color)}>{s.value}</span>
                <span className="text-[10px] text-center uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{s.label}</span>
              </GlassPanel>
            ))}
          </div>
        )}
      </GlassPanel>

      {/* ── Sentry Mode Activity Chart ─────────────────────────────────────────── */}
      <GlassPanel className="p-4 sm:p-6 mb-6 sm:mb-8">
        <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Sentry Mode Activity</h3>
        {loadingHistory ? <Skeleton className="h-72 rounded-xl" /> : sentryChartData.length === 0 ? (
          <div className="flex items-center justify-center h-72 text-[var(--text-muted)] text-sm">No sentry mode data available</div>
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={sentryChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} />
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
              <Tooltip content={<ChartTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="on" name="Sentry On" stackId="a" fill="#3b82f6" radius={[0, 0, 0, 0]} />
              <Bar dataKey="off" name="Sentry Off" stackId="a" fill="#334155" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </GlassPanel>

      {/* ── Security Event Timeline ────────────────────────────────────────────── */}
      <GlassPanel className="p-4 sm:p-6">
        <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Security Event Timeline</h3>
        {loadingHistory ? <Skeleton className="h-64 rounded-xl" /> : sortedHistory.length === 0 ? (
          <div className="flex items-center justify-center h-64 text-[var(--text-muted)] text-sm">No security events recorded</div>
        ) : (
          <div className="max-h-[28rem] overflow-y-auto pr-1 space-y-2">
            {sortedHistory.map((event, idx) => {
              const prev = sortedHistory[idx + 1]
              const changes = describeEvent(event, prev)
              return (
                <GlassPanel key={event.id} className="p-3 flex items-start gap-3 transition-colors hover:bg-white/[0.02]">
                  <div className="flex flex-col items-center gap-1 shrink-0 pt-0.5">
                    {changes.slice(0, 1).map((c, ci) => (
                      <div key={ci} className="p-1.5 rounded-lg" style={{ backgroundColor: `${c.color}15` }}>
                        <EventIcon icon={c.icon} className="h-4 w-4" />
                      </div>
                    ))}
                  </div>
                  <div className="flex-1 min-w-0">
                    {changes.map((c, ci) => (
                      <p key={ci} className="text-sm font-medium" style={{ color: c.color }}>{c.label}</p>
                    ))}
                    <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{formatTimestamp(event.created_at)}</p>
                  </div>
                  <div className="shrink-0 flex items-center gap-1.5">
                    {event.locked && <Lock className="h-3 w-3 text-neon-green" />}
                    {event.sentry_mode && <Eye className="h-3 w-3 text-blue-400" />}
                    {!doorClosed(event.door_state) && <DoorOpen className="h-3 w-3 text-neon-amber" />}
                  </div>
                </GlassPanel>
              )
            })}
          </div>
        )}
      </GlassPanel>
    </FadeIn>
  )
}
