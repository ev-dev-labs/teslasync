import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Gauge } from 'lucide-react'

import { Tooltip } from '@/components/ui/runtime'
import { Icon } from '@/components/ui/Icon'
import { useLiveConnection } from '@/hooks/useLiveConnection'
import { describeFleetState, useVehicles, useFleetStates } from '@/api/hooks/useVehicles'
import { honestyFromLiveConnection, tallyHonesty, type HonestyKind } from '@/lib/fleetHonesty'
import { cn } from '@/lib/cn'
import { neonColorMap, typography } from '@/lib/tokens'
import { PrefetchLink } from '../PrefetchLink'
import { useStatusBarAnnouncer } from './StatusBarContext'
import { StatusOverflowRowContent, statusOverflowRowClass } from './StatusOverflowRow'

const STALE_AFTER_MS = 2 * 60_000

const TONE: Record<HonestyKind, string> = {
  live: neonColorMap.green.text,
  stale: neonColorMap.amber.text,
  guessed: neonColorMap.cyan.text,
  missing: typography.color.secondary,
}

const DOT: Record<HonestyKind, string> = {
  live: neonColorMap.green.dot,
  stale: neonColorMap.amber.dot,
  guessed: neonColorMap.cyan.dot,
  missing: neonColorMap.neutral.dot,
}

export interface HonestyMeterSegmentProps {
  iconOnly?: boolean
  /** Render as a labelled row inside the More menu. */
  embedded?: boolean
  onAction?: () => void
}

export function HonestyMeterSegment({ iconOnly = false, embedded = false, onAction }: HonestyMeterSegmentProps) {
  const { t } = useTranslation()
  const { status, lastMessageAt } = useLiveConnection()
  const vehiclesQuery = useVehicles()
  const vehicles = vehiclesQuery.data ?? []
  const fleetQuery = useFleetStates(vehicles)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 10_000)
    return () => window.clearInterval(timer)
  }, [])
  const counts = useMemo(() => {
    const byId = new Map((fleetQuery.data ?? []).map((entry) => [entry.vehicle.id, entry]))
    return tallyHonesty(
      vehicles.map((vehicle) => describeFleetState(byId.get(vehicle.id), now).condition),
    )
  }, [vehicles, fleetQuery.data, now])
  const ageMs = lastMessageAt ? now - new Date(lastMessageAt).getTime() : null
  const streamStale = status === 'connected' && ageMs != null && ageMs >= STALE_AFTER_MS
  const streamHonesty = honestyFromLiveConnection(status, streamStale)
  const headline: HonestyKind = counts.missing > 0 && counts.live === 0
    ? 'missing'
    : counts.stale > 0
      ? 'stale'
      : counts.guessed > 0
        ? 'guessed'
        : streamHonesty
  const announce = useStatusBarAnnouncer()
  const previous = useRef(headline)
  useEffect(() => {
    if (previous.current !== headline) {
      announce?.(`${t('honesty.title', 'Telemetry honesty')}: ${headline}`)
      previous.current = headline
    }
  }, [announce, headline, t])

  const tooltip = t(
    'honesty.tooltip',
    'Live {{live}} · stale {{stale}} · Guessed {{guessed}} · missing {{missing}} · stream {{stream}}',
    {
      live: counts.live,
      stale: counts.stale,
      guessed: counts.guessed,
      missing: counts.missing,
      stream: streamHonesty,
    },
  )

  const headlineLabel = headline === 'live'
    ? t('statusBar.fleet.label', 'Fleet')
    : t(`honesty.${headline}`, headline)
  const ratio = vehicles.length > 0 ? `${counts.live}/${vehicles.length}` : null

  if (embedded) {
    return (
      <PrefetchLink
        to="/"
        onClick={onAction}
        aria-label={`${t('honesty.title', 'Telemetry honesty')}: ${headlineLabel}${ratio ? ` · ${ratio}` : ''}`}
        className={statusOverflowRowClass}
      >
        <StatusOverflowRowContent
          dotClassName={DOT[headline]}
          icon={<Icon icon={Gauge} size="sm" className={TONE[headline]} />}
          label={t('honesty.title', 'Telemetry honesty')}
          value={ratio ? `${headlineLabel} · ${ratio}` : headlineLabel}
          valueClassName={TONE[headline]}
        />
      </PrefetchLink>
    )
  }

  return (
    <Tooltip content={tooltip} side="top">
      <PrefetchLink
        to="/"
        aria-label={t('honesty.aria', 'Telemetry honesty meter')}
        className={cn(
          'inline-flex min-h-11 min-w-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-shape-sm px-1.5 py-0.5 leading-none xl:min-h-0 xl:min-w-0',
          typography.size.xs,
          'hover:bg-[var(--surface-3)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]',
          TONE[headline],
        )}
      >
        <span className={cn('inline-block h-1.5 w-1.5 shrink-0 rounded-full', DOT[headline])} aria-hidden />
        <Icon icon={Gauge} size="xs" />
        {!iconOnly && (
          <span className={cn('whitespace-nowrap', typography.weight.medium)}>
            {headlineLabel}
            {ratio && (
              <span className={typography.color.muted}>
                {' '}· {ratio}
              </span>
            )}
          </span>
        )}
      </PrefetchLink>
    </Tooltip>
  )
}
