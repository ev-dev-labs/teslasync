import type {
  AlertDetail, AlertRule, ComputedMetricSummary, NotificationChannel,
  NotificationEventType, NotificationReport, NotificationStats, QuietHoursWindow,
} from '@/api/types'
import { alerts, notificationLogs } from './fixtures'

type Result = { status: number; body: unknown }
const ok = (body: unknown): Result => ({ status: 200, body })
const bad = (): Result => ({ status: 400, body: { error: 'Invalid synthetic notification request', code: 'INVALID_FILTER' } })
const absent = (): Result => ({ status: 404, body: { error: 'Synthetic notification record not found', code: 'NOT_FOUND' } })

const rule: AlertRule = {
  id: 601, name: 'Sample charging completion', description: 'Fictional rule for a sample charging event.',
  enabled: true, vehicle_id: 7, all_vehicles: false, vehicle_ids: [7],
  signal_name: 'DetailedChargeState', op: '=', value_text: 'Complete',
  severity: 'info', cooldown_min: 60, trigger_mode: 'once', kind: 'signal',
  channel_ids: [], include_title: true,
  created_at: notificationLogs[0].created_at, updated_at: notificationLogs[0].created_at,
}

// An inactive example destination is not evidence of a delivered notification.
const channel: NotificationChannel = {
  id: 701, name: 'Sample browser webhook (disabled)', kind: 'webhook', enabled: false,
  url: 'https://demo.invalid/notifications', method: 'POST', headers: {},
  body_template: '{{message}}',
  created_at: notificationLogs[0].created_at, updated_at: notificationLogs[0].created_at,
}

const quietHours: QuietHoursWindow = {
  id: 801, user_id: 'synthetic-demo', enabled: true, start_local: '22:00',
  end_local: '07:00', timezone: 'UTC', weekdays: 127,
  bypass_severities: ['critical'],
  created_at: notificationLogs[0].created_at, updated_at: notificationLogs[0].created_at,
}

const eventTypes: NotificationEventType[] = [
  'telemetry', 'mqtt', 'database', 'redis', 'tesla_api', 'worker',
].flatMap(component => (['outage', 'recovery'] as const).map(transition => ({
  event_type: `system.${component}.${transition}`, component, transition,
  default_enabled: true,
  description: `${component} ${transition} notification option (sample catalog; no event was sent).`,
})))

const metric: ComputedMetricSummary = {
  id: 'charging_cost', label: 'Charging cost', category: 'cost', unit: 'currency',
  windows: ['day', 'week', 'month', 'rolling_7d', 'rolling_30d'],
  ops: ['>', '>=', '<', '<=', '=', '!=', '%_change_>', '%_change_<'],
}

const presets = [
  { id: 'sample-charge-complete', name: 'Sample charging complete',
    description: 'Fictional example; no message is delivered.',
    template: '{{VehicleName}} completed a sample charging session.', kind: 'signal', tags: ['sample'] },
]

const placeholders = [
  { key: 'VehicleName', label: 'Vehicle name', description: 'Name of the sample vehicle', group: 'Built-in', example: 'Aurora' },
  { key: 'Value', label: 'Signal value', description: 'Value that triggered the example rule', group: 'Triggering Signal', example: 'Complete' },
]

function page(params: URLSearchParams): [number, number] | null {
  const numberParam = (key: string, fallback: number, min: number, max: number) => {
    const raw = params.get(key)
    if (raw == null) return fallback
    if (!/^\d+$/.test(raw)) return null
    const parsed = Number(raw)
    return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null
  }
  const limit = numberParam('limit', 50, 1, 1000)
  const offset = numberParam('offset', 0, 0, Number.MAX_SAFE_INTEGER)
  return limit === null || offset === null ? null : [limit, offset]
}

function dateInZone(instant: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant)
  const part = (name: string) => parts.find(item => item.type === name)!.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

function report(params: URLSearchParams): Result {
  const timezone = params.get('timezone') ?? 'UTC'
  try {
    if (!timezone || timezone === 'Local') return bad()
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
  } catch {
    return bad()
  }
  const instant = params.has('from_instant') || params.has('to_exclusive')
  if (instant && (params.has('from') || params.has('to')
    || !params.has('from_instant') || !params.has('to_exclusive'))) return bad()
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const startDay = params.get('from') ?? new Date(Date.parse(`${today}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10)
  const endDay = params.get('to') ?? today
  if (!instant && (![startDay, endDay].every(day => {
    const parsed = Date.parse(`${day}T00:00:00Z`)
    return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(parsed)
      && new Date(parsed).toISOString().startsWith(day)
  }))) return bad()
  const from = instant ? Date.parse(params.get('from_instant')!) : Date.parse(`${startDay}T00:00:00Z`)
  const until = instant ? Date.parse(params.get('to_exclusive')!) : Date.parse(`${endDay}T00:00:00Z`) + 86_400_000
  if (!Number.isFinite(from) || !Number.isFinite(until) || from >= until
    || until - from >= 50 * 366 * 86_400_000) return bad()
  const matching = notificationLogs.filter(row =>
    row.status === 'triggered' && Date.parse(row.created_at) >= from && Date.parse(row.created_at) < until)
  const countBy = (values: string[]) => [...new Set(values)].sort().map(key => ({
    key, count: values.filter(value => value === key).length,
  }))
  const byDay = new Map<string, number>()
  for (const row of matching) {
    const day = dateInZone(Date.parse(row.created_at), timezone)
    byDay.set(day, (byDay.get(day) ?? 0) + 1)
  }
  const daily: NotificationReport['daily'] = []
  const firstDay = dateInZone(from, timezone)
  const lastDay = dateInZone(until - 1, timezone)
  for (let day = firstDay; day <= lastDay; day = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) {
    daily.push({ day, triggered: byDay.get(day) ?? 0, deliveries: 0 })
  }
  const body: NotificationReport = {
    from: firstDay, to: lastDay, from_instant: new Date(from).toISOString(),
    to_exclusive: new Date(until).toISOString(), timezone,
    triggered: matching.length, deliveries: 0, outbound_http_calls: 0,
    uncorrelated_deliveries: 0,
    by_source: countBy(matching.map(row => row.event_type?.startsWith('alert.') ? 'alert' : 'other')),
    by_type: countBy(matching.map(row => row.event_type || 'unknown')),
    by_severity: countBy(matching.map(row => row.severity || 'unknown')),
    by_channel: [], by_status: [], daily,
  }
  return ok(body)
}

export function notificationDomain(pathname: string, params: URLSearchParams): Result | undefined {
  if (pathname === '/alerts/rules') return ok([rule])
  if (pathname === '/alerts/metrics') return ok([metric])
  if (pathname === '/alerts/packs') return ok([{
    id: 'sample', version: 1, name: 'Sample charging alerts',
    description: 'Fictional rule examples only; not installed.',
    rules: [{ id: 'sample-charge-complete', unit: '', rule }],
  }])
  if (pathname === '/alerts/pack-installations') {
    const pagination = page(params)
    return pagination ? ok([]) : bad()
  }
  if (pathname === '/alerts/message-presets') {
    const kind = params.get('kind')
    return ok(kind == null || kind === '' || kind === 'signal' ? presets : [])
  }
  if (pathname === '/alerts/message-placeholders') {
    return ok(params.get('kind') === 'computed_metric' ? placeholders.slice(0, 1) : placeholders)
  }
  if (pathname === '/notifications/stats') {
    const stats: NotificationStats = {
      total_sent: 0, sent: 0, failed: 0, pending: 0, total_channels: 1, enabled_channels: 0,
    }
    return ok(stats)
  }
  if (pathname === '/notifications/report') return report(params)
  if (pathname === '/notifications/analytics') {
    const days = params.get('days')
    const periodDays = days !== null && /^\d+$/.test(days) && Number(days) > 0 && Number(days) <= 365
      ? Number(days) : 30
    return ok({
      total_sent: 0, total_failed: 0, delivery_rate: 0,
      avg_latency_ms: 0, active_channels: 0, period_days: periodDays,
    })
  }
  if (pathname === '/notifications/quiet-hours') return ok({ windows: [quietHours] })
  if (pathname === '/notifications/event-types') return ok(eventTypes)
  if (pathname === '/notifications/schedules') return ok([])
  if (['/alerts/test', '/alerts/message-preview'].includes(pathname)) return undefined
  const alert = /^\/alerts\/([^/]+)$/.exec(pathname)
  if (alert) {
    if (!/^[1-9]\d*$/.test(alert[1]) || !Number.isSafeInteger(Number(alert[1]))) return bad()
    const item = alerts.find(row => row.id === Number(alert[1]))
    if (!item) return absent()
    const detail: AlertDetail = {
      ...item, rule_id: rule.id, rule_signal: rule.signal_name, rule_severity: rule.severity,
      all_vehicles: rule.all_vehicles, vehicle_ids: rule.vehicle_ids,
      acknowledged_at: null, acknowledged_by: null, acknowledgement_note: null,
      events: [{ id: 0, kind: 'created', occurred_at: item.created_at, actor: null, note: null }],
    }
    return ok(detail)
  }
  if (['/notifications/logs', '/notifications/unread-count', '/notifications/mark-read',
    '/notifications/mark-unread', '/notifications/archive', '/notifications/unarchive'].includes(pathname)) {
    return undefined
  }
  const destination = /^\/notifications\/([^/]+)(?:\/(preferences|metrics))?$/.exec(pathname)
  if (destination) {
    if (!/^[1-9]\d*$/.test(destination[1]) || !Number.isSafeInteger(Number(destination[1]))) return bad()
    if (Number(destination[1]) !== channel.id) return absent()
    if (destination[2] === 'preferences') return ok([])
    if (destination[2] === 'metrics') return ok([])
    return ok(channel)
  }
  return undefined
}
