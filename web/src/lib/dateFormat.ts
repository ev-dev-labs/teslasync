/**
 * Centralized date/time formatting utilities.
 *
 * All timestamps from the backend are ISO 8601 UTC (ending in "Z").
 * These helpers convert to the user's local timezone for display,
 * keeping the source-of-truth as UTC.
 */

/** Full date + time: "Apr 4, 2026, 2:30 AM" */
export function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

/** Date only: "Apr 4, 2026" */
export function formatDate(iso: string | Date | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  })
}

/** Short date: "Apr 4" */
export function formatDateShort(iso: string | Date | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, {
    month: 'short', day: 'numeric',
  })
}

/** Time only: "02:30" (24h) or "2:30 AM" (based on locale) */
export function formatTime(iso: string | Date | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** Relative time: "3 min ago", "2 hours ago", "yesterday" */
export function formatRelative(iso: string | Date | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  const now = Date.now()
  const diff = now - d.getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return formatDate(iso)
}

/** Relative time matching dashboard activity feeds: "Just now", "5m ago", or "Apr 4, 02:30 AM" */
export function formatRelativeTime(iso: string | Date | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const diffMs = Date.now() - d.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return 'Just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHrs = Math.floor(diffMin / 60)
  if (diffHrs < 24) return `${diffHrs}h ago`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** Millisecond duration for short activity entries: "250ms", "1.5s", or "—" for nullish values. */
export function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

/** Millisecond duration with decimal minute rollover: "250ms", "1.5s", "2.5m". */
export function formatDurationMsCompact(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60_000).toFixed(1)}m`
}

/** Millisecond duration with minute/second output for longer jobs: "1m 05s". */
export function formatDurationMsLong(ms: number | null | undefined): string {
  if (!ms) return '—'
  if (ms < 1000) return `${ms}ms`
  const sec = ms / 1000
  if (sec < 60) return `${sec.toFixed(1)}s`
  const min = Math.floor(sec / 60)
  return `${min}m ${formatRoundedInt(sec % 60)}s`
}

/** Seconds represented as rounded minutes/hours: "5m", "2h 10m", or "2h". */
export function formatDurationSecondsAsMinutes(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = (seconds % 3600) / 60
  if (h === 0) return `${formatRoundedInt(m)}m`
  return m >= 0.5 ? `${h}h ${formatRoundedInt(m)}m` : `${h}h`
}

/** Minute duration with rounded minute remainder: "5m" or "2h 05m". */
export function formatDurationMinutes(minutes: number, options: { subMinuteLabel?: string } = {}): string {
  if (options.subMinuteLabel && minutes < 1) return options.subMinuteLabel
  const h = Math.floor(minutes / 60)
  const m = formatRoundedInt(minutes % 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

/** Duration between two timestamps, rounded to whole minutes. */
export function formatDurationRange(start: string | Date, end: string | Date | null | undefined): string {
  if (!end) return '—'
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (ms <= 0) return '—'
  return formatDurationMinutes(Math.round(ms / 60_000))
}

/** Media/player clock duration: "3:07". */
export function formatDurationClock(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** Local datetime string for `<input type="datetime-local">` value: "2026-04-04T14:30:00" */
export function toLocalDatetimeStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** Weekday + short date: "Fri, Apr 4" */
export function formatDateWithDay(iso: string | Date | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

function formatRoundedInt(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}
