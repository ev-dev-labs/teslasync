/**
 * TelemetryPipelineCard — operator-grade per-vehicle telemetry liveness.
 *
 * Renders:
 *  - Compact fleet stats grid (vehicles · positions · drives · charges · signals)
 *  - Per-vehicle list showing which vehicles are sending data right now,
 *    when each was last seen (most recent of MQTT stream OR REST poll),
 *    what state it's in, battery %, and the next scheduled poll.
 *
 * TeslaSync has TWO ingest paths and a vehicle can be live on either:
 *   1. Fleet Telemetry streaming → MQTT broker → `/telemetry` (useMQTTStatus)
 *      — primary path for phase-42+ deployments
 *   2. Legacy REST polling engine → `/polling/status` (getPollingStatus)
 *      — fallback for vehicles not enrolled in Fleet Telemetry
 *
 * Liveness is the MOST RECENT of {last MQTT message, last poll}.
 * Threshold ladder (applied to the union timestamp):
 *   < 5 min   → green (sending)
 *   5–30 min  → amber (slow / asleep cadence)
 *   > 30 min  → red   (stale)
 *   no signal → grey  (offline)
 *
 * The "polling engine disabled" chip is informational, NOT a problem
 * state, when MQTT streaming is healthy — many production setups disable
 * polling entirely once Fleet Telemetry is wired up.
 */

import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Activity, Battery, Car, ExternalLink, Radio, Wifi, WifiOff } from 'lucide-react'

import { getPollingStatus, type VehiclePollingStatus } from '@/api/polling'
import { useMQTTStatus } from '@/api/hooks/useTelemetry'
import type { Vehicle } from '@/api/types'
import { fmtInt } from '@/lib/numberFormat'

interface TelemetryPipelineCardProps {
  vehicles: Vehicle[] | undefined
  positionCount: number
  drivesCount: number
  chargingSessionsCount: number | undefined
  signalLogCount: number | undefined
  /** "now" passed in so the page-level tick re-renders the relative-time labels. */
  now: number
}

type Liveness = 'sending' | 'slow' | 'stale' | 'offline'
type LivenessSource = 'stream' | 'poll' | 'none'

const POLLING_REFRESH_MS = 15_000

function fmtCount(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return fmtInt(n)
}

// Render an absolute-clock-skew-tolerant relative time using the shared
// `now` tick the page already drives every 5s.
function relativeTime(iso: string | undefined, now: number): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return '—'
  const diff = now - t
  const past = diff >= 0
  const abs = Math.abs(diff)
  const sec = Math.round(abs / 1000)
  if (sec < 60) return past ? `${sec}s ago` : `in ${sec}s`
  const min = Math.round(sec / 60)
  if (min < 60) return past ? `${min} min ago` : `in ${min} min`
  const hr = Math.round(min / 60)
  if (hr < 24) return past ? `${hr}h ago` : `in ${hr}h`
  const day = Math.round(hr / 24)
  return past ? `${day}d ago` : `in ${day}d`
}

// Parse an ISO timestamp into ms-since-epoch, returning undefined for
// null / empty / malformed input. Used to defensively union the polling
// and streaming last-seen timestamps before applying the age ladder.
function parseIso(iso: string | undefined | null): number | undefined {
  if (!iso) return undefined
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : undefined
}

/**
 * Derive per-vehicle liveness from the UNION of both ingest paths.
 * Returns the severity bucket and which source produced the freshest
 * timestamp so the UI can label the chip with "stream" or "poll".
 */
function liveness(
  lastPollIso: string | undefined,
  lastStreamIso: string | undefined,
  now: number,
): { level: Liveness; source: LivenessSource; lastSeenIso: string | undefined } {
  const pollMs = parseIso(lastPollIso)
  const streamMs = parseIso(lastStreamIso)

  let lastSeenMs: number | undefined
  let source: LivenessSource = 'none'
  let lastSeenIso: string | undefined

  if (pollMs != null && streamMs != null) {
    if (streamMs >= pollMs) {
      lastSeenMs = streamMs
      source = 'stream'
      lastSeenIso = lastStreamIso
    } else {
      lastSeenMs = pollMs
      source = 'poll'
      lastSeenIso = lastPollIso
    }
  } else if (streamMs != null) {
    lastSeenMs = streamMs
    source = 'stream'
    lastSeenIso = lastStreamIso
  } else if (pollMs != null) {
    lastSeenMs = pollMs
    source = 'poll'
    lastSeenIso = lastPollIso
  }

  if (lastSeenMs == null) {
    return { level: 'offline', source: 'none', lastSeenIso: undefined }
  }
  const ageMin = (now - lastSeenMs) / 60_000
  if (ageMin < 5) return { level: 'sending', source, lastSeenIso }
  if (ageMin < 30) return { level: 'slow', source, lastSeenIso }
  return { level: 'stale', source, lastSeenIso }
}

function livenessClasses(l: Liveness): { dot: string; label: string; chip: string } {
  switch (l) {
    case 'sending':
      return {
        dot: 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]',
        label: 'sending',
        chip: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30',
      }
    case 'slow':
      return {
        dot: 'bg-amber-400',
        label: 'slow',
        chip: 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30',
      }
    case 'stale':
      return {
        dot: 'bg-red-500',
        label: 'stale',
        chip: 'bg-red-500/15 text-red-300 ring-1 ring-red-500/30',
      }
    case 'offline':
    default:
      return {
        dot: 'bg-[var(--surface-2)]',
        label: 'offline',
        chip: 'bg-white/[0.06] text-[var(--text-muted)] ring-1 ring-white/10',
      }
  }
}

function vinTail(vin: string | undefined | null): string {
  if (!vin) return '????'
  const t = vin.trim()
  if (t.length <= 4) return t
  return t.slice(-4)
}

function batteryColor(pct: number): string {
  if (pct >= 50) return 'bg-emerald-400/70'
  if (pct >= 20) return 'bg-amber-400/70'
  return 'bg-red-500/70'
}

function vehicleStateBadge(state: string | undefined): string {
  if (!state) return 'unknown'
  const s = state.toLowerCase()
  if (s === 'online' || s === 'driving' || s === 'charging') return s
  if (s === 'asleep' || s === 'sleeping') return 'asleep'
  if (s === 'offline') return 'offline'
  return s
}

export function TelemetryPipelineCard({
  vehicles,
  positionCount,
  drivesCount,
  chargingSessionsCount,
  signalLogCount,
  now,
}: TelemetryPipelineCardProps) {
  const { data: pollingStatus } = useQuery({
    queryKey: ['system-status', 'polling-status'],
    queryFn: getPollingStatus,
    refetchInterval: POLLING_REFRESH_MS,
  })

  // Fleet Telemetry streaming status — same source the MQTT Inspector
  // page uses. Without this, vehicles that stream via MQTT but are not
  // REST-polled would render as "offline" even when they're actively
  // sending 240+ signals per minute.
  const { data: mqttStatus } = useMQTTStatus()

  const list = vehicles ?? []
  const pollingMap: Record<string, VehiclePollingStatus> = pollingStatus?.vehicles ?? {}
  const pollingEnabled = pollingStatus?.enabled !== false

  // Index streaming vehicles by VIN so we can join against the vehicle list.
  const streamMap: Record<string, { lastReceived?: string; signalsPerSecond?: number; signalCount?: number }> = {}
  const mqttVehicles = mqttStatus?.vehicles ?? []
  for (const sv of mqttVehicles) {
    if (!sv?.vin) continue
    streamMap[sv.vin] = {
      lastReceived: sv.lastReceived ?? sv.last_received,
      signalsPerSecond: sv.signalsPerSecond ?? sv.signals_per_second,
      signalCount: sv.signalCount ?? sv.signal_count,
    }
  }
  const mqttConnected = mqttStatus?.connected === true

  // Fleet-wide liveness summary used in the sub-header
  const counts = list.reduce(
    (acc, v) => {
      const ps = pollingMap[v.vin]
      const ss = streamMap[v.vin]
      const { level } = liveness(ps?.last_poll_time, ss?.lastReceived, now)
      acc[level] = (acc[level] ?? 0) + 1
      return acc
    },
    { sending: 0, slow: 0, stale: 0, offline: 0 } as Record<Liveness, number>,
  )

  return (
    <div className="space-y-4">
      {/* Fleet rollup grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:grid-cols-5">
        <div>
          <div className="text-xs text-[var(--text-muted)]">Vehicles</div>
          <div className="tabular-nums text-[var(--text-primary)]">
            {list.length > 0 ? `${list.length} connected` : 'none configured'}
          </div>
        </div>
        <div>
          <div className="text-xs text-[var(--text-muted)]">GPS positions</div>
          <div className="tabular-nums text-[var(--text-primary)]">{fmtCount(positionCount)}</div>
        </div>
        <div>
          <div className="text-xs text-[var(--text-muted)]">Drives</div>
          <div className="tabular-nums text-[var(--text-primary)]">{fmtCount(drivesCount)}</div>
        </div>
        <div>
          <div className="text-xs text-[var(--text-muted)]">Charging sessions</div>
          <div className="tabular-nums text-[var(--text-primary)]">{fmtCount(chargingSessionsCount)}</div>
        </div>
        <div>
          <div className="text-xs text-[var(--text-muted)]">Signal log</div>
          <div className="tabular-nums text-[var(--text-primary)]">{fmtCount(signalLogCount)}</div>
        </div>
      </div>

      {/* Liveness summary chips (only when there are any vehicles) */}
      {list.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-[var(--text-muted)]">Liveness:</span>
          {(['sending', 'slow', 'stale', 'offline'] as Liveness[])
            .filter((k) => counts[k] > 0)
            .map((k) => {
              const cls = livenessClasses(k)
              return (
                <span
                  key={k}
                  className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 ${cls.chip}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${cls.dot}`} aria-hidden />
                  {counts[k]} {cls.label}
                </span>
              )
            })}
          {/* MQTT broker connectivity — neutral when connected, warning when not */}
          {mqttConnected ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-cyan-500/10 px-1.5 py-0.5 text-cyan-300 ring-1 ring-cyan-400/20">
              <Radio className="h-3 w-3" /> Fleet Telemetry connected
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-amber-300 ring-1 ring-amber-500/30">
              <WifiOff className="h-3 w-3" /> MQTT broker disconnected
            </span>
          )}
          {/* Polling-engine state — informational when MQTT is healthy, warning otherwise */}
          {!pollingEnabled && (
            mqttConnected ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[var(--text-muted)] ring-1 ring-white/10">
                polling engine off (streaming-only)
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-amber-300 ring-1 ring-amber-500/30">
                <WifiOff className="h-3 w-3" /> polling engine disabled
              </span>
            )
          )}
        </div>
      )}

      {/* Per-vehicle list */}
      {list.length === 0 ? (
        <div className="rounded-lg bg-white/[0.03] p-4 text-sm text-[var(--text-muted)]">
          No vehicles configured yet. Add a vehicle from the{' '}
          <Link to="/tesla-account" className="text-cyan-300 hover:text-cyan-200">
            Tesla account
          </Link>{' '}
          page to see per-vehicle telemetry status.
        </div>
      ) : (
        <ul className="divide-y divide-white/[0.06] overflow-hidden rounded-lg bg-white/[0.03]">
          {list.map((v) => {
            const ps = pollingMap[v.vin]
            const ss = streamMap[v.vin]
            const { level, source, lastSeenIso } = liveness(ps?.last_poll_time, ss?.lastReceived, now)
            const cls = livenessClasses(level)
            const stateLabel = vehicleStateBadge(v.state)
            const battery = ps?.battery_level ?? null
            const sourceLabel = source === 'stream' ? 'stream' : source === 'poll' ? 'poll' : null
            return (
              <li key={v.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-3">
                {/* Status pip + name */}
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${cls.dot}`}
                    aria-label={`telemetry status: ${cls.label}`}
                  />
                  <Car className="h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden />
                  <div className="min-w-0">
                    <Link
                      to={`/vehicles/${v.id}`}
                      className="block truncate text-sm font-medium text-[var(--text-primary)] hover:text-cyan-200"
                    >
                      {v.display_name || `Vehicle ${v.id}`}
                    </Link>
                    <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)]">
                      <span className="font-mono">VIN ···{vinTail(v.vin)}</span>
                      <span aria-hidden>·</span>
                      <span>{stateLabel}</span>
                    </div>
                  </div>
                </div>

                {/* Battery */}
                <div className="flex w-28 shrink-0 items-center gap-2 sm:justify-end">
                  <Battery className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden />
                  {battery != null ? (
                    <>
                      <div
                        className="h-1.5 w-12 overflow-hidden rounded-full bg-white/[0.08]"
                        role="progressbar"
                        aria-valuenow={Math.round(battery)}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`battery ${Math.round(battery)}%`}
                      >
                        <div
                          className={`h-full ${batteryColor(battery)}`}
                          style={{ width: `${Math.min(100, Math.max(0, battery))}%` }}
                        />
                      </div>
                      <span className="w-9 text-right text-xs tabular-nums text-[var(--text-primary)]">
                        {Math.round(battery)}%
                      </span>
                    </>
                  ) : (
                    <span className="text-xs text-[var(--text-muted)]">—</span>
                  )}
                </div>

                {/* Liveness chip + last/next poll */}
                <div className="flex shrink-0 flex-col items-start gap-0.5 sm:w-52 sm:items-end">
                  <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] ${cls.chip}`}>
                    {source === 'stream' ? <Radio className="h-3 w-3" /> : <Wifi className="h-3 w-3" />}
                    {cls.label}
                    {sourceLabel && (
                      <span className="ml-1 text-[10px] uppercase tracking-wide opacity-70">{sourceLabel}</span>
                    )}
                  </span>
                  <div className="text-[11px] tabular-nums text-[var(--text-muted)]">
                    last: {relativeTime(lastSeenIso, now)}
                    {ps?.next_poll_after && (
                      <>
                        <span className="mx-1" aria-hidden>·</span>
                        next: {relativeTime(ps.next_poll_after, now)}
                      </>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {/* Footer links */}
      <div className="flex flex-wrap gap-2 pt-2 border-t border-white/[0.06]">
        <Link
          to="/admin/telemetry/coverage"
          className="inline-flex items-center gap-1.5 rounded-md bg-cyan-500/15 px-3 py-1.5 text-xs font-medium text-cyan-200 ring-1 ring-cyan-400/30 hover:bg-cyan-500/20 min-h-[36px]"
        >
          Open Telemetry Coverage
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
        <Link
          to="/mqtt-inspector"
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-cyan-300 hover:text-cyan-200 hover:bg-white/[0.04] min-h-[36px]"
        >
          <Radio className="h-3.5 w-3.5" />
          MQTT Inspector
        </Link>
        <Link
          to="/vehicles"
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-cyan-300 hover:text-cyan-200 hover:bg-white/[0.04] min-h-[36px]"
        >
          <Activity className="h-3.5 w-3.5" />
          All vehicles
        </Link>
      </div>
    </div>
  )
}
