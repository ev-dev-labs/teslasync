/**
 * TelemetryPipelineCard — operator-grade per-vehicle telemetry liveness.
 *
 * Renders:
 *  Compact fleet stats grid (vehicles · positions · drives · charges · signals)
 *  Per-vehicle list showing which vehicles are sending data right now,
 *    when each was last seen (most recent of MQTT stream OR REST poll),
 *    what state it's in, battery %, and the next scheduled poll.
 *
 * TeslaSync has TWO ingest paths and a vehicle can be live on either:
 *   1. Fleet Telemetry streaming → MQTT broker → `/telemetry` (useMQTTStatus)
 *      primary path for + deployments
 *   2. Legacy REST polling engine → `/polling/status` (getPollingStatus)
 *      fallback for vehicles not enrolled in Fleet Telemetry
 *
 * Liveness is the MOST RECENT of {last MQTT message, last poll}.
 * Threshold ladder (applied to the union timestamp):
 *   < 5 min → green (sending)
 *   5–30 min → amber (slow / asleep cadence)
 *   > 30 min → red (stale)
 *   no signal → grey (offline)
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
import { useTranslation } from 'react-i18next'
import { SystemSummaryBrief } from '../operationalbrief-all/SystemSummaryBrief'
import type { TFunction } from 'i18next'
import { useDataState } from '@/hooks/useDataState'
import { QueryError, StaleRefreshWarning } from '@/components/feedback'
import { Caption, Text } from '@/components/ui'
import { MetricBar } from '@/components/data-display'
import { cn } from '@/lib/cn'
import { typography } from '@/lib/tokens'

interface TelemetryPipelineCardProps {
  vehicles: Vehicle[] | undefined
  positionCount: number | undefined
  drivesCount: number | undefined
  chargingSessionsCount: number | undefined
  signalLogCount: number | undefined
  /** "now" passed in so the page-level tick re-renders the relative-time labels. */
  now: number
  retained?: boolean
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
function relativeTime(iso: string | undefined, now: number, translate: TFunction): string {
  if (!iso) return '—'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return '—'
  const diff = now - t
  const past = diff >= 0
  const abs = Math.abs(diff)
  const sec = Math.round(abs / 1000)
  if (sec < 60) return past
    ? translate('systemStatus.pipelineTime.secondsAgo', '{{count}}s ago', { count: sec })
    : translate('systemStatus.pipelineTime.secondsAhead', 'in {{count}}s', { count: sec })
  const min = Math.round(sec / 60)
  if (min < 60) return past
    ? translate('systemStatus.pipelineTime.minutesAgo', '{{count}} min ago', { count: min })
    : translate('systemStatus.pipelineTime.minutesAhead', 'in {{count}} min', { count: min })
  const hr = Math.round(min / 60)
  if (hr < 24) return past
    ? translate('systemStatus.pipelineTime.hoursAgo', '{{count}}h ago', { count: hr })
    : translate('systemStatus.pipelineTime.hoursAhead', 'in {{count}}h', { count: hr })
  const day = Math.round(hr / 24)
  return past
    ? translate('systemStatus.pipelineTime.daysAgo', '{{count}}d ago', { count: day })
    : translate('systemStatus.pipelineTime.daysAhead', 'in {{count}}d', { count: day })
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

function livenessClasses(l: Liveness): { dot: string; chip: string } {
  switch (l) {
    case 'sending':
      return {
        dot: 'bg-emerald-400',
        chip: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30',
      }
    case 'slow':
      return {
        dot: 'bg-amber-400',
        chip: 'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30',
      }
    case 'stale':
      return {
        dot: 'bg-red-500',
        chip: 'bg-red-500/15 text-red-300 ring-1 ring-red-500/30',
      }
    case 'offline':
    default:
      return {
        dot: 'bg-[var(--surface-2)]',
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
  if (pct >= 50) return 'rgb(52 211 153 / 0.7)'
  if (pct >= 20) return 'rgb(251 191 36 / 0.7)'
  return 'rgb(239 68 68 / 0.7)'
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
  retained = false,
}: TelemetryPipelineCardProps) {
  const { t } = useTranslation()
  const livenessLabels: Record<Liveness, string> = {
    sending: t('systemStatus.pipelineStates.sending', 'sending'),
    slow: t('systemStatus.pipelineStates.slow', 'slow'),
    stale: t('systemStatus.pipelineStates.stale', 'stale'),
    offline: t('systemStatus.pipelineStates.offline', 'offline'),
  }
  const stateLabels: Record<string, string> = {
    online: t('systemStatus.pipelineStates.online', 'online'),
    driving: t('systemStatus.pipelineStates.driving', 'driving'),
    charging: t('systemStatus.pipelineStates.charging', 'charging'),
    asleep: t('systemStatus.pipelineStates.asleep', 'asleep'),
    offline: livenessLabels.offline,
    unknown: t('systemStatus.pipelineStates.unknown', 'unknown'),
  }
  const pollingQuery = useQuery({
    queryKey: ['system-status', 'polling-status'],
    queryFn: getPollingStatus,
    refetchInterval: POLLING_REFRESH_MS,
  })
  const pollingStatus = pollingQuery.data
  const pollingState = useDataState(pollingQuery, { provenance: 'live' })

  // Fleet Telemetry streaming status — same source the MQTT Inspector
  // page uses. Without this, vehicles that stream via MQTT but are not
  // REST-polled would render as "offline" even when they're actively
  // sending 240+ signals per minute.
  const mqttQuery = useMQTTStatus()
  const mqttStatus = mqttQuery.data
  const mqttState = useDataState(mqttQuery, { provenance: 'live' })

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
  const mqttConnected = mqttStatus?.connected

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
      <StaleRefreshWarning state={pollingState} label={t('systemStatus.telemetrySources.pollSource', 'REST polling')} />
      {pollingState.fatalError && (
        <QueryError error={pollingState.fatalError} onRetry={() => { void pollingQuery.refetch(); }} />
      )}
      <StaleRefreshWarning state={mqttState} label={t('systemStatus.telemetrySources.streamSource', 'Fleet Telemetry stream')} />
      {mqttState.fatalError && (
        <QueryError error={mqttState.fatalError} onRetry={() => { void mqttQuery.refetch(); }} />
      )}
      {/* Fleet rollup grid */}
      <SystemSummaryBrief
        title={t('systemStatus.telemetryPipeline', 'Telemetry pipeline')}
        description={t('systemStatus.pipelineBrief.description', 'Configured vehicles and recorded table counts; polling and stream liveness remain independent evidence below.')}
        scope={t('systemStatus.pipelineBrief.scope', 'Vehicle response and database row-count snapshot; no shared historical window is supplied.')}
        available={vehicles != null || positionCount != null || drivesCount != null || chargingSessionsCount != null || signalLogCount != null}
        retained={retained}
        metrics={[
          { metricId: 'count', occurrenceId: 'vehicles', rawValue: vehicles == null ? null : list.length,
            label: t('systemStatus.vehicles', 'Vehicles'), context: vehicles == null ? '—' : list.length > 0
              ? t('systemStatus.pipeline.connectedVehicles', '{{count}} connected', { count: list.length })
              : t('systemStatus.pipeline.noneConfigured', 'none configured') },
          { metricId: 'count', occurrenceId: 'positions', rawValue: positionCount, label: t('systemStatus.pipeline.positions', 'GPS positions'), display: { formatter: (raw) => ({ value: fmtCount(raw) }) } },
          { metricId: 'count', occurrenceId: 'drives', rawValue: drivesCount, label: t('systemStatus.pipeline.drives', 'Drives'), display: { formatter: (raw) => ({ value: fmtCount(raw) }) } },
          { metricId: 'count', occurrenceId: 'charging', rawValue: chargingSessionsCount, label: t('systemStatus.pipeline.chargingSessions', 'Charging sessions'), display: { formatter: (raw) => ({ value: fmtCount(raw) }) } },
          { metricId: 'count', occurrenceId: 'signals', rawValue: signalLogCount, label: t('systemStatus.pipeline.signalLog', 'Signal log'), display: { formatter: (raw) => ({ value: fmtCount(raw) }) } },
        ]}
      />

      <SystemSummaryBrief
        title={t('systemStatus.pipeline.liveness', 'Liveness:')}
        description={t('systemStatus.pipelineBrief.livenessDescription', 'Configured vehicles classified by their most recent polling or Fleet Telemetry timestamp, using the existing liveness rules.')}
        scope={t('systemStatus.pipelineBrief.livenessScope', 'Current client-clock age: sending under 5 minutes, slow from 5 to under 30 minutes, stale from 30 minutes; offline means no valid timestamp, not confirmed vehicle disconnection.')}
        available={vehicles != null}
        retained={retained || (pollingState.hasData && !!pollingState.refreshError) || (mqttState.hasData && !!mqttState.refreshError)}
        freshness={t('systemStatus.pipelineBrief.livenessFreshness', 'Polling and stream timestamps remain independently visible on each vehicle row.')}
        metricTones={{ 'liveness-sending': 'success', 'liveness-slow': 'warning', 'liveness-stale': 'danger', 'liveness-offline': 'neutral' }}
        metrics={(['sending', 'slow', 'stale', 'offline'] as const).map(key => ({
          metricId: 'count', occurrenceId: `liveness-${key}`, rawValue: vehicles == null ? null : counts[key],
          label: livenessLabels[key],
          context: key === 'offline' ? t('systemStatus.pipelineBrief.offlineMeaning', 'No valid polling or stream timestamp was supplied; missing evidence is not a measured outage.') : undefined,
        }))}
      />

      {/* Source connectivity chips (only when there are any vehicles) */}
      {list.length > 0 && (
        <div className={cn('flex flex-wrap items-center gap-1.5', typography.size.xs)}>
          {/* MQTT broker connectivity — neutral when connected, warning when not */}
          {mqttConnected ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-cyan-500/10 px-1.5 py-0.5 text-cyan-300 ring-1 ring-cyan-400/20">
              <Radio className="h-3 w-3 shrink-0" aria-hidden="true" />
              {t('systemStatus.pipeline.streamConnected', 'Fleet Telemetry connected')}
            </span>
          ) : mqttConnected === false ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-amber-300 ring-1 ring-amber-500/30">
              <WifiOff className="h-3 w-3 shrink-0" aria-hidden="true" />
              {t('systemStatus.pipeline.brokerDisconnected', 'MQTT broker disconnected')}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[var(--text-muted)] ring-1 ring-white/10">
              <Radio className="h-3 w-3" aria-hidden="true" />
              {t('systemStatus.telemetrySources.streamUnknown', 'Fleet Telemetry connection unknown')}
            </span>
          )}
          {/* Polling-engine state — informational when MQTT is healthy, warning otherwise */}
          {!pollingEnabled && (
            mqttConnected ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[var(--text-muted)] ring-1 ring-white/10">
                {t('systemStatus.pipeline.streamingOnly', 'polling engine off (streaming-only)')}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-amber-300 ring-1 ring-amber-500/30">
                <WifiOff className="h-3 w-3 shrink-0" aria-hidden="true" />
                {t('systemStatus.pipeline.pollingDisabled', 'polling engine disabled')}
              </span>
            )
          )}
        </div>
      )}

      {/* Per-vehicle list */}
      {vehicles == null ? (
        <Text as="p" variant="bodySm" className="rounded-lg bg-white/[0.03] p-4">
          {t('systemStatus.pipeline.vehiclesUnavailable', 'Vehicle telemetry is unavailable until the vehicle list loads.')}
        </Text>
      ) : list.length === 0 ? (
        <Text as="p" variant="bodySm" className="rounded-lg bg-white/[0.03] p-4">
          {t('systemStatus.pipeline.emptyBeforeLink', 'No vehicles configured yet. Add a vehicle from the')}{' '}
          <Link to="/tesla-account" className="text-cyan-300 hover:text-cyan-200">
            {t('systemStatus.pipeline.teslaAccount', 'Tesla account')}
          </Link>{' '}
          {t('systemStatus.pipeline.emptyAfterLink', 'page to see per-vehicle telemetry status.')}
        </Text>
      ) : (
        <ul className="divide-y divide-white/[0.06] overflow-hidden rounded-lg bg-white/[0.03]">
          {list.map((v) => {
            const ps = pollingMap[v.vin]
            const ss = streamMap[v.vin]
            const { level, source, lastSeenIso } = liveness(ps?.last_poll_time, ss?.lastReceived, now)
            const cls = livenessClasses(level)
            const stateLabel = vehicleStateBadge(v.state)
            const rawBattery = ps?.battery_level
            const battery = rawBattery != null && Number.isFinite(rawBattery) ? rawBattery : null
            const sourceLabel = source === 'stream'
              ? t('systemStatus.pipeline.stream', 'stream')
              : source === 'poll' ? t('systemStatus.pipeline.poll', 'poll') : null
            return (
              <li key={v.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-3">
                {/* Status pip + name */}
                <div className="flex min-w-0 flex-1 items-center gap-2.5">
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${cls.dot}`}
                    role="img"
                    aria-label={t('systemStatus.pipeline.statusAria', 'telemetry status: {{status}}', { status: livenessLabels[level] })}
                  />
                  <Car className="h-4 w-4 shrink-0 text-[var(--text-muted)]" aria-hidden />
                  <div className="min-w-0">
                    <Link
                      to={`/vehicles/${v.id}`}
                      className={cn('block break-words hover:text-cyan-300', typography.role.bodySm, typography.weight.medium)}
                    >
                      {v.display_name || t('systemStatus.pipeline.vehicleFallback', 'Vehicle {{id}}', { id: v.id })}
                    </Link>
                    <Caption className="flex flex-wrap items-center gap-2">
                      <Text mono>{t('systemStatus.pipeline.vinTail', 'VIN ···{{tail}}', { tail: vinTail(v.vin) })}</Text>
                      <span aria-hidden>·</span>
                      <span>{stateLabels[stateLabel] ?? stateLabel}</span>
                    </Caption>
                  </div>
                </div>

                {/* Battery */}
                <div className="flex w-28 shrink-0 items-center gap-2 sm:justify-end">
                  <Battery className="h-3.5 w-3.5 text-[var(--text-muted)]" aria-hidden />
                  <div className="w-12 shrink-0">
                    <MetricBar
                      value={battery}
                      max={100}
                      color={batteryColor(battery ?? 0)}
                      ariaLabel={battery == null
                        ? t('systemStatus.pipeline.battery', 'Battery level')
                        : t('systemStatus.pipeline.batteryAria', 'battery {{percent}}%', { percent: Math.round(battery) })}
                      size="slim"
                      fill="solid"
                      showHeader={false}
                    />
                  </div>
                  <Text size="xs" color={battery == null ? 'muted' : 'primary'} className="w-9 text-end tabular-nums">
                    {battery == null ? '—' : `${Math.round(battery)}%`}
                  </Text>
                </div>

                {/* Liveness chip + last/next poll */}
                <div className="flex min-w-0 flex-col items-start gap-0.5 sm:w-52 sm:items-end">
                  <Text size="xs" className={`inline-flex flex-wrap items-center gap-1 rounded-md px-1.5 py-0.5 ${cls.chip}`}>
                    {source === 'stream' ? <Radio className="h-3 w-3 shrink-0" aria-hidden /> : <Wifi className="h-3 w-3 shrink-0" aria-hidden />}
                    {livenessLabels[level]}
                    {sourceLabel && (
                      <Caption className="ms-1">{sourceLabel}</Caption>
                    )}
                  </Text>
                  <Caption className="tabular-nums">
                    {t('systemStatus.pipeline.last', 'last: {{time}}', { time: relativeTime(lastSeenIso, now, t) })}
                    {ps?.next_poll_after && (
                      <>
                        <span className="mx-1" aria-hidden>·</span>
                        {t('systemStatus.pipeline.next', 'next: {{time}}', { time: relativeTime(ps.next_poll_after, now, t) })}
                      </>
                    )}
                  </Caption>
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
          className={cn('inline-flex min-h-11 items-center gap-1.5 rounded-md bg-cyan-500/15 px-3 py-1.5 text-cyan-300 ring-1 ring-cyan-400/30 hover:bg-cyan-500/20', typography.size.xs, typography.weight.medium)}
        >

          {t('systemStatus.pipeline.openCoverage', 'Open telemetry coverage')}
          <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
        </Link>
        <Link
          to="/mqtt-inspector"
          className={cn('inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 py-1.5 text-cyan-300 hover:bg-white/[0.04]', typography.size.xs)}
        >
          <Radio className="h-3.5 w-3.5 shrink-0" aria-hidden />

          {t('systemStatus.pipeline.mqttInspector', 'MQTT inspector')}
        </Link>
        <Link
          to="/vehicles"
          className={cn('inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 py-1.5 text-cyan-300 hover:bg-white/[0.04]', typography.size.xs)}
        >
          <Activity className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {t('systemStatus.pipeline.allVehicles', 'All vehicles')}
        </Link>
      </div>
    </div>
  )
}
