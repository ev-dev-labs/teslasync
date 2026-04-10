import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getAlerts, markAlertRead, getAlertRules,
  getNotificationChannels, getNotificationLogs, getNotificationStats,
  Alert,
} from '../api'
import { formatDateTime } from '../lib/dateFormat'
import { CHART_COLORS } from '../lib/colors'
import { PageHeader, GlassPanel, FadeIn, StaggerContainer, StaggerItem, TabNav, Skeleton, EmptyState, Pagination, Badge, MetricCard, Button, DataTable, type Column, Toggle, Input } from '../components/ui'
import { RadialGauge, AnimatedNumber } from '../components/Widgets'
import {
  Bell, BellOff, AlertTriangle, Info, AlertCircle, MapPin, Battery,
  Zap, Shield, Gauge, Thermometer, Eye, Filter, Settings, CheckCircle, Clock,
  Settings2, BarChart3, PieChart as PieChartIcon, Moon, Send, TrendingDown,
  Lock, Droplets, Database, Radio, Wifi, HardDrive, Activity,
} from 'lucide-react'
import { useState, useMemo, useCallback } from 'react'
import { useToast } from '../components/Toast'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import clsx from 'clsx'
import { ChartTooltip } from '../components/Charts'
import { usePageTitle } from '../hooks/usePageTitle'

// ─── Severity config ─────────────────────────────────────────────────────────

const severityConfig = {
  info: { icon: Info, color: 'text-neon-cyan', bg: 'bg-neon-cyan/10', border: 'border-neon-cyan/20', dot: 'bg-neon-cyan', hex: '#00f0ff' },
  warning: { icon: AlertTriangle, color: 'text-neon-amber', bg: 'bg-neon-amber/10', border: 'border-neon-amber/20', dot: 'bg-neon-amber', hex: '#f59e0b' },
  critical: { icon: AlertCircle, color: 'text-neon-red', bg: 'bg-neon-red/10', border: 'border-neon-red/20', dot: 'bg-neon-red', hex: '#ef4444' },
}

// ─── Alert type → icon mapping (expanded) ────────────────────────────────────

const typeIcons: Record<string, React.ElementType> = {
  geofence_exit: MapPin,
  geofence_enter: MapPin,
  low_battery: Battery,
  battery_low: Battery,
  battery_high: Battery,
  charging_complete: Zap,
  charging_cost: Zap,
  sentry_event: Shield,
  speed_limit: Gauge,
  temperature: Thermometer,
  software_update: Settings,
  vampire_drain: TrendingDown,
  tire_pressure_low: Droplets,
  idle_unlocked: Lock,
  efficiency_drop: BarChart3,
  // System health alerts
  system_database: Database,
  system_mqtt: Wifi,
  system_redis: HardDrive,
  system_tesla_api: Radio,
  system_worker: Activity,
}

// ─── Tooltip for recharts ────────────────────────────────────────────────────

// ─── Time helper ─────────────────────────────────────────────────────────────

function getTimeAgo(dateStr: string): string {
  usePageTitle('Alerts')
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

// ─── Quiet Hours helpers ─────────────────────────────────────────────────────

interface QuietHours { start: string; end: string; enabled: boolean }

function loadQuietHours(): QuietHours {
  try {
    const raw = localStorage.getItem('teslasync-quiet-hours')
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return { start: '22:00', end: '07:00', enabled: false }
}

function isQuietHoursActive(qh: QuietHours): boolean {
  if (!qh.enabled) return false
  const now = new Date()
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  if (qh.start <= qh.end) return hhmm >= qh.start && hhmm < qh.end
  return hhmm >= qh.start || hhmm < qh.end
}

// ─── Digest mode ─────────────────────────────────────────────────────────────

type DigestMode = 'instant' | 'hourly' | 'daily'

function loadDigestMode(): DigestMode {
  const v = localStorage.getItem('teslasync-alert-digest')
  if (v === 'hourly' || v === 'daily') return v
  return 'instant'
}

// ─── AlertCard ───────────────────────────────────────────────────────────────

function AlertCard({ alert, onMarkRead }: { alert: Alert; onMarkRead: () => void }) {
  const sev = severityConfig[alert.severity]
  const Icon = typeIcons[alert.type] || Bell
  const timeAgo = getTimeAgo(alert.created_at)

  return (
    <div className={clsx(
      'glass-panel p-4 flex items-start gap-4 transition-all duration-200 group',
      !alert.is_read && `${sev.border} ${sev.bg.replace('/10', '/5')}`
    )}>
      <div className="flex flex-col items-center gap-1 shrink-0">
        <div className={clsx('rounded-xl p-2.5 ring-1', sev.bg, sev.border)}>
          <Icon className={clsx('h-4 w-4', sev.color)} />
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className={clsx('text-sm font-medium', alert.is_read ? 'text-[var(--text-secondary)]' : 'text-[var(--text-primary)]')}>
              {alert.title}
            </p>
            <p className="text-xs text-[var(--text-muted)] mt-0.5 line-clamp-2">{alert.message}</p>
          </div>
          {!alert.is_read && (
            <span className={clsx('h-2 w-2 rounded-full shrink-0 mt-1.5 animate-pulse', sev.dot)} />
          )}
        </div>
        <div className="flex items-center gap-3 mt-2">
          <span className="text-[10px] text-gray-600 flex items-center gap-1"><Clock className="h-2.5 w-2.5" />{timeAgo}</span>
          <Badge color={alert.severity === 'critical' ? 'red' : alert.severity === 'warning' ? 'amber' : 'cyan'} size="sm">
            {alert.severity}
          </Badge>
          <span className="text-[10px] text-gray-600">{alert.type.replace(/_/g, ' ')}</span>
          {!alert.is_read && (
            <Button variant="ghost" size="sm" icon={<Eye className="h-3 w-3" />} onClick={onMarkRead} className="ml-auto opacity-0 group-hover:opacity-100">Mark read</Button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Notification History Section ────────────────────────────────────────────

function NotificationHistory() {
  const [logPage, setLogPage] = useState(1)
  const logPageSize = 25

  const { data: logs, isLoading: logsLoading } = useQuery({
    queryKey: ['notification-logs', logPage],
    queryFn: () => getNotificationLogs(logPageSize, (logPage - 1) * logPageSize),
  })

  const { data: stats } = useQuery({
    queryKey: ['notification-stats'],
    queryFn: getNotificationStats,
  })

  const { data: channels } = useQuery({
    queryKey: ['notification-channels'],
    queryFn: getNotificationChannels,
  })

  const channelMap = useMemo(() => {
    const m: Record<number, string> = {}
    channels?.forEach(c => { m[c.id] = `${c.name} (${c.type})` })
    return m
  }, [channels])

  const totalSent = stats?.sent ?? 0
  const totalFailed = stats?.failed ?? 0
  const total = stats?.total_sent ?? (totalSent + totalFailed + (stats?.pending ?? 0))
  const successRate = total > 0 ? Math.round((totalSent / total) * 100) : 0

  const logTypeCounts = useMemo(() => {
    if (!logs?.length) return []
    const counts: Record<string, number> = {}
    logs.forEach(l => {
      const key = l.status
      counts[key] = (counts[key] || 0) + 1
    })
    const colors: Record<string, string> = { sent: '#10b981', failed: '#ef4444', pending: '#f59e0b' }
    return Object.entries(counts).map(([status, value]) => ({
      name: status, value, fill: colors[status] || '#00f0ff',
    }))
  }, [logs])

  return (
    <div className="space-y-6">
      {/* Analytics cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard label="Total Sent" value={totalSent} icon={<Send className="h-4 w-4" />} color="cyan" />
        <MetricCard label="Failed" value={totalFailed} icon={<AlertCircle className="h-4 w-4" />} color="red" />
        <MetricCard label="Success Rate" value={`${successRate}%`} icon={<CheckCircle className="h-4 w-4" />} color="green" />
        <MetricCard label="Channels" value={`${stats?.enabled_channels ?? 0} / ${stats?.total_channels ?? 0}`} icon={<Bell className="h-4 w-4" />} color="purple" />
      </div>

      {/* Delivery status pie */}
      {logTypeCounts.length > 0 && (
        <GlassPanel className="p-4 sm:p-6">
          <h3 className="section-title mb-4 flex items-center gap-2">
            <PieChartIcon className="h-4 w-4 text-neon-purple" /> Delivery Status
          </h3>
          <div className="h-40 flex flex-col sm:flex-row items-center">
            <ResponsiveContainer width="50%" height="100%">
              <PieChart>
                <Pie data={logTypeCounts} cx="50%" cy="50%" innerRadius={35} outerRadius={60} paddingAngle={3} dataKey="value">
                  {logTypeCounts.map((entry, i) => <Cell key={i} fill={entry.fill} stroke="transparent" />)}
                </Pie>
                <Tooltip content={<ChartTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 space-y-2">
              {logTypeCounts.map(d => (
                <div key={d.name} className="flex items-center gap-2 text-xs">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: d.fill }} />
                  <span className="text-[var(--text-secondary)] capitalize">{d.name}</span>
                  <span className="ml-auto text-[var(--text-primary)] font-mono">{d.value}</span>
                </div>
              ))}
            </div>
          </div>
        </GlassPanel>
      )}

      {/* Log table */}
      <GlassPanel className="p-4 sm:p-6">
        <h3 className="section-title mb-4 flex items-center gap-2">
          <Send className="h-4 w-4 text-neon-cyan" /> Notification Log
        </h3>
        {logsLoading ? (
          <div className="space-y-2">{[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-10" />)}</div>
        ) : logs && logs.length > 0 ? (
          <>
            <div className="overflow-x-auto -mx-4 sm:mx-0">
              <DataTable
                columns={[
                  { key: 'time', header: 'Time', render: (log) => <span className="text-[var(--text-muted)] whitespace-nowrap">{formatDateTime(log.created_at)}</span> },
                  { key: 'title', header: 'Title', render: (log) => <span className="text-[var(--text-primary)] max-w-[200px] truncate block">{log.title}</span> },
                  { key: 'channel', header: 'Channel', render: (log) => <span className="text-[var(--text-secondary)]">{channelMap[log.channel_id] || `#${log.channel_id}`}</span> },
                  { key: 'status', header: 'Status', render: (log) => <Badge color={log.status === 'sent' ? 'green' : log.status === 'failed' ? 'red' : 'amber'} size="sm">{log.status}</Badge> },
                ] satisfies Column<(typeof logs)[number]>[]}
                data={logs}
                keyExtractor={(log) => log.id}
                compact
              />
            </div>
            <Pagination
              page={logPage}
              pageSize={logPageSize}
              total={total}
              onPageChange={setLogPage}
            />
          </>
        ) : (
          <EmptyState
            icon={<Send className="h-8 w-8" />}
            title="No notification logs"
            description="Notification logs will appear here once alerts are sent."
          />
        )}
      </GlassPanel>
    </div>
  )
}

// ─── Preferences Section ─────────────────────────────────────────────────────

function PreferencesSection() {
  const [quietHours, setQuietHours] = useState<QuietHours>(loadQuietHours)
  const [digestMode, setDigestMode] = useState<DigestMode>(loadDigestMode)
  const toast = useToast()

  const saveQuietHours = useCallback((qh: QuietHours) => {
    setQuietHours(qh)
    localStorage.setItem('teslasync-quiet-hours', JSON.stringify(qh))
  }, [])

  const saveDigest = useCallback((mode: DigestMode) => {
    setDigestMode(mode)
    localStorage.setItem('teslasync-alert-digest', mode)
  }, [])

  const quietActive = isQuietHoursActive(quietHours)

  return (
    <div className="space-y-6">
      {/* Quiet hours badge */}
      {quietActive && (
        <div className="flex items-center gap-2 rounded-xl bg-neon-purple/10 px-4 py-2 ring-1 ring-neon-purple/20">
          <Moon className="h-4 w-4 text-neon-purple" />
          <span className="text-xs font-medium text-neon-purple">
            🌙 Quiet hours active ({quietHours.start} – {quietHours.end})
          </span>
          <span className="text-[10px] text-[var(--text-muted)] ml-2">Only critical alerts send notifications</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Quiet Hours */}
        <GlassPanel className="p-5">
          <h4 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-4">
            <Moon className="h-4 w-4 text-neon-purple" /> Quiet Hours
          </h4>
          <p className="text-xs text-[var(--text-muted)] mb-3">During quiet hours, only critical alerts send notifications.</p>
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-[var(--text-secondary)]">Enable quiet hours</span>
            <Toggle
              checked={quietHours.enabled}
              onChange={(v) => {
                saveQuietHours({ ...quietHours, enabled: v })
                toast.info(v ? 'Quiet hours enabled' : 'Quiet hours disabled')
              }}
            />
          </div>
          {quietHours.enabled && (
            <div className="flex items-center gap-3">
              <div>
                <label htmlFor="quiet-start" className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Start</label>
                <Input
                  id="quiet-start"
                  type="time"
                  value={quietHours.start}
                  onChange={e => saveQuietHours({ ...quietHours, start: e.target.value })}
                  className="mt-1"
                />
              </div>
              <span className="text-[var(--text-muted)] mt-4">—</span>
              <div>
                <label htmlFor="quiet-end" className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">End</label>
                <Input
                  id="quiet-end"
                  type="time"
                  value={quietHours.end}
                  onChange={e => saveQuietHours({ ...quietHours, end: e.target.value })}
                  className="mt-1"
                />
              </div>
            </div>
          )}
        </GlassPanel>

        {/* Alert Digest */}
        <GlassPanel className="p-5">
          <h4 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-4">
            <Settings2 className="h-4 w-4 text-neon-amber" /> Alert Digest
          </h4>
          <p className="text-xs text-[var(--text-muted)] mb-3">Choose how non-critical alerts are delivered.</p>
          <div className="space-y-2">
            {([
              { value: 'instant' as const, label: 'Instant', desc: 'Every alert notifies immediately' },
              { value: 'hourly' as const, label: 'Hourly Digest', desc: 'Batch non-critical alerts every hour' },
              { value: 'daily' as const, label: 'Daily Digest', desc: 'Batch non-critical alerts into daily summary' },
            ]).map(opt => (
              <label
                key={opt.value}
                className={clsx(
                  'flex items-center gap-3 rounded-lg px-3 py-2 cursor-pointer transition-all',
                  digestMode === opt.value ? 'bg-neon-amber/10 ring-1 ring-neon-amber/20' : 'hover:bg-white/[0.03]'
                )}
              >
                <input
                  type="radio"
                  name="digest"
                  checked={digestMode === opt.value}
                  onChange={() => {
                    saveDigest(opt.value)
                    toast.info(`Alert digest set to ${opt.label}`)
                  }}
                  className="accent-[#f59e0b]"
                />
                <div>
                  <span className={clsx('text-xs font-medium', digestMode === opt.value ? 'text-neon-amber' : 'text-[var(--text-secondary)]')}>
                    {opt.label}
                  </span>
                  <p className="text-[10px] text-[var(--text-muted)]">{opt.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </GlassPanel>
      </div>

      {/* Alert Studio link */}
      <GlassPanel className="p-5">
        <h4 className="text-sm font-semibold text-[var(--text-primary)] flex items-center gap-2 mb-2">
          <BarChart3 className="h-4 w-4 text-neon-green" /> Rule Management
        </h4>
        <p className="text-xs text-[var(--text-muted)] mb-3">
          Create, edit, and manage alert rules in the Alert Studio — build custom rules from any of 230+ Fleet Telemetry signals.
        </p>
        <a href="/alert-studio" className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium bg-neon-cyan/15 text-neon-cyan ring-1 ring-neon-cyan/25 hover:bg-neon-cyan/25 transition-all">
          Open Alert Studio →
        </a>
      </GlassPanel>
    </div>
  )
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function Alerts() {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [tab, setTab] = useState<'alerts' | 'history' | 'preferences'>('alerts')
  const [filter, setFilter] = useState<'all' | 'unread' | 'critical'>('all')

  // ─ Data queries ─
  const { data: alerts, isLoading: alertsLoading } = useQuery({
    queryKey: ['alerts'],
    queryFn: () => getAlerts(100),
    refetchInterval: 30_000,
  })

  const { data: rules } = useQuery({
    queryKey: ['alert-rules'],
    queryFn: getAlertRules,
  })

  // ─ Mutations ─
  const markReadMut = useMutation({
    mutationFn: markAlertRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['alerts'] })
      toast.info('Alert marked as read')
    },
  })

  // ─ Computed ─
  const filteredAlerts = useMemo(() => alerts?.filter(a => {
    if (filter === 'unread') return !a.is_read
    if (filter === 'critical') return a.severity === 'critical'
    return true
  }) ?? [], [alerts, filter])

  const unreadCount = useMemo(() => alerts?.filter(a => !a.is_read).length ?? 0, [alerts])
  const criticalCount = useMemo(() => alerts?.filter(a => a.severity === 'critical' && !a.is_read).length ?? 0, [alerts])
  const infoCount = useMemo(() => alerts?.filter(a => a.severity === 'info').length ?? 0, [alerts])
  const warningCount = useMemo(() => alerts?.filter(a => a.severity === 'warning').length ?? 0, [alerts])
  const readCount = useMemo(() => alerts?.filter(a => a.is_read).length ?? 0, [alerts])
  const totalCount = alerts?.length ?? 0

  const alertsByType = useMemo(() => {
    if (!alerts?.length) return []
    const counts: Record<string, number> = {}
    alerts.forEach(a => { counts[a.type] = (counts[a.type] || 0) + 1 })
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count], i) => ({
        name: type.replace(/_/g, ' '),
        value: count,
        fill: CHART_COLORS[i % CHART_COLORS.length],
      }))
  }, [alerts])

  const alertsByDay = useMemo(() => {
    if (!alerts?.length) return []
    const days: Record<string, { info: number; warning: number; critical: number }> = {}
    const now = Date.now()
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now - i * 86400000)
      const key = d.toLocaleDateString(undefined, { weekday: 'short' })
      days[key] = { info: 0, warning: 0, critical: 0 }
    }
    alerts.forEach(a => {
      const d = new Date(a.created_at)
      if (now - d.getTime() > 7 * 86400000) return
      const key = d.toLocaleDateString(undefined, { weekday: 'short' })
      if (days[key]) days[key][a.severity]++
    })
    return Object.entries(days).map(([day, v]) => ({ day, ...v }))
  }, [alerts])

  const enabledRules= rules?.filter(r => r.enabled).length ?? 0

  const weekAlertCount = useMemo(() =>
    alertsByDay.reduce((s, d) => s + d.info + d.warning + d.critical, 0)
  , [alertsByDay])

  const allSeverityCounts = useMemo(() => ({
    info: alerts?.filter(a => a.severity === 'info').length ?? 0,
    warning: alerts?.filter(a => a.severity === 'warning').length ?? 0,
    critical: alerts?.filter(a => a.severity === 'critical').length ?? 0,
  }), [alerts])

  // ─ Quiet hours status ─
  const [quietHours] = useState<QuietHours>(loadQuietHours)
  const quietActive = isQuietHoursActive(quietHours)

  return (
    <div className="space-y-8">
      <PageHeader
        title="Alerts & Notifications"
        subtitle="Monitor events, configure alert rules, and stay informed"
        actions={
          <div className="flex items-center gap-3">
            {quietActive && (
              <Badge color="purple" size="md" dot>🌙 Quiet hours</Badge>
            )}
            {unreadCount > 0 && (
              <Badge color="cyan" size="md" dot>{unreadCount} unread</Badge>
            )}
            {criticalCount > 0 && (
              <Badge color="red" size="md" dot>{criticalCount} critical</Badge>
            )}
          </div>
        }
      />

      {/* Alert Stats Row */}
      <FadeIn>
        <GlassPanel className="p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-8 text-center">
            <div>
              <p className="text-lg font-bold text-neon-cyan"><AnimatedNumber value={totalCount} /></p>
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Total</p>
            </div>
            <div className="h-8 w-px bg-white/[0.06] hidden sm:block" />
            <div>
              <p className="text-lg font-bold text-neon-amber"><AnimatedNumber value={weekAlertCount} /></p>
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">This Week</p>
            </div>
            <div className="h-8 w-px bg-white/[0.06] hidden sm:block" />
            <div>
              <p className="text-lg font-bold text-neon-purple"><AnimatedNumber value={unreadCount} /></p>
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">Unread</p>
            </div>
            <div className="h-8 w-px bg-white/[0.06] hidden sm:block" />
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1 text-xs"><Info className="h-3 w-3 text-neon-cyan" /><span className="font-mono text-neon-cyan">{allSeverityCounts.info}</span></span>
              <span className="flex items-center gap-1 text-xs"><AlertTriangle className="h-3 w-3 text-neon-amber" /><span className="font-mono text-neon-amber">{allSeverityCounts.warning}</span></span>
              <span className="flex items-center gap-1 text-xs"><AlertCircle className="h-3 w-3 text-neon-red" /><span className="font-mono text-neon-red">{allSeverityCounts.critical}</span></span>
            </div>
          </div>
        </GlassPanel>
      </FadeIn>

      {/* Summary gauges */}
      <FadeIn>
        <GlassPanel className="p-4 sm:p-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 items-center">
            <RadialGauge value={totalCount} max={Math.max(totalCount, 20)} label="Total" unit="" color="#00f0ff" />
            <RadialGauge value={unreadCount} max={Math.max(totalCount, 1)} label="Unread" unit="" color="#f59e0b" />
            <RadialGauge value={criticalCount} max={Math.max(totalCount, 1)} label="Critical" unit="" color="#ef4444" />
            <div className="flex flex-col items-center text-center">
              <div className="flex items-center gap-2">
                <Info className="h-4 w-4 text-neon-cyan" />
                <span className="text-lg font-bold text-neon-cyan"><AnimatedNumber value={infoCount} /></span>
              </div>
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mt-1">Info</p>
            </div>
            <div className="flex flex-col items-center text-center">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-neon-amber" />
                <span className="text-lg font-bold text-neon-amber"><AnimatedNumber value={warningCount} /></span>
              </div>
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mt-1">Warnings</p>
            </div>
            <div className="flex flex-col items-center text-center">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-neon-green" />
                <span className="text-lg font-bold text-neon-green"><AnimatedNumber value={readCount} /></span>
              </div>
              <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mt-1">Resolved</p>
            </div>
          </div>
        </GlassPanel>
      </FadeIn>

      {/* Quick metrics */}
      <FadeIn delay={0.05}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Active Rules', value: `${enabledRules}/${rules?.length ?? 0}`, color: 'text-neon-cyan', link: '/alert-studio' },
            { label: 'Read Rate', value: totalCount > 0 ? `${Math.round((readCount / totalCount) * 100)}%` : '—', color: 'text-neon-green' },
            { label: 'Most Common', value: alertsByType[0]?.name ?? '—', color: 'text-neon-purple' },
            { label: 'Last 7 Days', value: `${weekAlertCount}`, color: 'text-neon-amber' },
          ].map(m => {
            const content = (
              <div key={m.label} className={clsx('glass-panel p-3 text-center', 'link' in m && 'cursor-pointer hover:border-neon-cyan/30 transition-colors')}>
                <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider mb-1">{m.label}</p>
                <p className={`text-sm font-bold ${m.color}`}>{m.value}</p>
                {'link' in m && <p className="text-[9px] text-neon-cyan mt-1">→ Alert Studio</p>}
              </div>
            )
            if ('link' in m) {
              return <a key={m.label} href={(m as { link: string }).link}>{content}</a>
            }
            return content
          })}
        </div>
      </FadeIn>

      {/* Charts: severity trend + type breakdown */}
      {totalCount > 0 && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <FadeIn delay={0.1}>
            <GlassPanel className="p-4 sm:p-6">
              <h3 className="section-title mb-4 flex items-center gap-2">
                <Bell className="h-4 w-4 text-neon-cyan" /> Alert Trend (7 Days)
              </h3>
              <div className="h-40 sm:h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={alertsByDay}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                    <XAxis dataKey="day" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                    <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} allowDecimals={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="critical" name="Critical" stackId="a" fill="#ef4444" fillOpacity={0.7} radius={[0, 0, 0, 0]} />
                    <Bar dataKey="warning" name="Warning" stackId="a" fill="#f59e0b" fillOpacity={0.6} />
                    <Bar dataKey="info" name="Info" stackId="a" fill="#00f0ff" fillOpacity={0.5} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </GlassPanel>
          </FadeIn>

          <FadeIn delay={0.15}>
            <GlassPanel className="p-4 sm:p-6">
              <h3 className="section-title mb-4 flex items-center gap-2">
                <Filter className="h-4 w-4 text-neon-purple" /> Alerts by Type
              </h3>
              <div className="h-40 sm:h-48 flex flex-col sm:flex-row items-center">
                <ResponsiveContainer width="60%" height="100%">
                  <PieChart>
                    <Pie data={alertsByType} cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={2} dataKey="value">
                      {alertsByType.map((entry, i) => <Cell key={i} fill={entry.fill} stroke="transparent" />)}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-1.5">
                  {alertsByType.map((d, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: d.fill }} />
                      <span className="text-[var(--text-secondary)] truncate">{d.name}</span>
                      <span className="ml-auto text-[var(--text-primary)] font-mono">{d.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </GlassPanel>
          </FadeIn>
        </div>
      )}

      {/* Tab navigation */}
      <FadeIn delay={0.2}>
        <TabNav
          tabs={[
            { key: 'alerts', label: 'Alerts', icon: <Bell className="h-4 w-4" /> },
            { key: 'history', label: 'History', icon: <Send className="h-4 w-4" /> },
            { key: 'preferences', label: 'Preferences', icon: <Settings2 className="h-4 w-4" /> },
          ]}
          active={tab}
          onChange={k => setTab(k as typeof tab)}
        />
      </FadeIn>

      {/* ── Alerts Tab ── */}
      {tab === 'alerts' && (
        <>
          <FadeIn delay={0.05}>
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-[var(--text-muted)]" />
              <TabNav
                tabs={[
                  { key: 'all', label: `All (${totalCount})` },
                  { key: 'unread', label: `Unread (${unreadCount})` },
                  { key: 'critical', label: `Critical (${criticalCount})` },
                ]}
                active={filter}
                onChange={k => setFilter(k as 'all' | 'unread' | 'critical')}
              />
            </div>
          </FadeIn>

          {alertsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-20" />)}
            </div>
          ) : filteredAlerts.length > 0 ? (
            <StaggerContainer className="space-y-2">
              {filteredAlerts.map(a => (
                <StaggerItem key={a.id}>
                  <AlertCard alert={a} onMarkRead={() => markReadMut.mutate(a.id)} />
                </StaggerItem>
              ))}
            </StaggerContainer>
          ) : (
            <EmptyState
              icon={<BellOff className="h-8 w-8" />}
              title="No alerts"
              description={filter === 'all' ? 'Your fleet is running smoothly. Alerts will appear here.' : `No ${filter} alerts right now.`}
            />
          )}
        </>
      )}

      {/* ── History Tab ── */}
      {tab === 'history' && <NotificationHistory />}

      {/* ── Preferences Tab ── */}
      {tab === 'preferences' && <PreferencesSection />}
    </div>
  )
}
