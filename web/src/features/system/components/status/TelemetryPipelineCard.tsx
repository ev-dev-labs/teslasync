/**
 * TelemetryPipelineCard — operator-grade per-vehicle telemetry liveness.
 *
 * Replaces the bare 5-row fleet rollup with:
 *  - Compact fleet stats grid (vehicles · positions · drives · charges · signals)
 *  - Per-vehicle list showing which vehicles are sending data right now,
 *    when each was last polled, what state it's in, battery %, and the
 *    next scheduled poll
 *
 * Combines the already-loaded `useVehicles()` data with `/polling/status`
 * (per-VIN engine state). No backend changes required.
 *
 * Liveness severity is derived from the polling engine's `last_poll_time`:
 *   < 5 min   → green (sending)
 *   5–30 min  → amber (slow / asleep cadence)
 *   > 30 min  → red   (stale)
 *   no poll   → grey  (offline / not yet polled)
 */

import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Activity, Battery, Car, ExternalLink, Wifi, WifiOff } from 'lucide-react'

import { getPollingStatus, type VehiclePollingStatus } from '@/api/polling'
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

function liveness(lastPollIso: string | undefined, now: number): Liveness {
  if (!lastPollIso) return 'offline'
  const t = Date.parse(lastPollIso)
  if (!Number.isFinite(t)) return 'offline'
  const ageMin = (now - t) / 60_000
  if (ageMin < 5) return 'sending'
  if (ageMin < 30) return 'slow'
  return 'stale'
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

  const list = vehicles ?? []
  const pollingMap: Record<string, VehiclePollingStatus> = pollingStatus?.vehicles ?? {}
  const pollingEnabled = pollingStatus?.enabled !== false

  // Fleet-wide liveness summary used in the sub-header
  const counts = list.reduce(
    (acc, v) => {
      const ps = pollingMap[v.vin]
      const l = liveness(ps?.last_poll_time, now)
      acc[l] = (acc[l] ?? 0) + 1
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
          {!pollingEnabled && (
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-amber-300 ring-1 ring-amber-500/30">
              <WifiOff className="h-3 w-3" /> polling engine disabled
            </span>
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
            const live = liveness(ps?.last_poll_time, now)
            const cls = livenessClasses(live)
            const stateLabel = vehicleStateBadge(v.state)
            const battery = ps?.battery_level ?? null
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
                <div className="flex shrink-0 flex-col items-start gap-0.5 sm:w-44 sm:items-end">
                  <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] ${cls.chip}`}>
                    <Wifi className="h-3 w-3" /> {cls.label}
                  </span>
                  <div className="text-[11px] tabular-nums text-[var(--text-muted)]">
                    last: {relativeTime(ps?.last_poll_time, now)}
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
