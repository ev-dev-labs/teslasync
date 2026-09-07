import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Radio } from 'lucide-react'

import { Tooltip } from '@/components/ui/runtime'
import { useLiveConnection } from '@/hooks/useLiveConnection'
import { describeFleetState, useVehicles, useFleetStates } from '@/api/hooks/useVehicles'
import { honestyFromLiveConnection, tallyHonesty, type HonestyKind } from '@/lib/fleetHonesty'
import { cn } from '@/lib/cn'
import { PrefetchLink } from '../PrefetchLink'
import { useStatusBarAnnouncer } from './StatusBarContext'

const STALE_AFTER_MS = 2 * 60_000

const TONE: Record<HonestyKind, string> = {
  live: 'text-emerald-300',
  stale: 'text-amber-300',
  guessed: 'text-cyan-300',
  missing: 'text-[var(--text-muted)]',
}

export function HonestyMeterSegment({ iconOnly = false }: { iconOnly?: boolean }) {
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
    'Live {{live}} · Stale {{stale}} · Guessed {{guessed}} · Missing {{missing}} · Stream {{stream}}',
    {
      live: counts.live,
      stale: counts.stale,
      guessed: counts.guessed,
      missing: counts.missing,
      stream: streamHonesty,
    },
  )

  return (
    <Tooltip content={tooltip} side="top">
      <PrefetchLink
        to="/"
        aria-label={t('honesty.aria', 'Telemetry honesty meter')}
        className={cn(
          'inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs leading-none',
          'hover:bg-white/[0.04] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--theme-primary)]',
          TONE[headline],
        )}
      >
        <Radio className="h-3 w-3 shrink-0" aria-hidden />
        {!iconOnly && (
          <span className="font-medium">
            {t(`honesty.${headline}`, headline)}
            {vehicles.length > 0 && (
              <span className="text-[var(--text-muted)]">
                {' '}· {counts.live}/{vehicles.length}
              </span>
            )}
          </span>
        )}
      </PrefetchLink>
    </Tooltip>
  )
}
