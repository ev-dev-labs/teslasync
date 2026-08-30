import { useCallback, useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Power } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { FadeIn } from '@/components/motion/FadeIn'
import { StatusBadge } from '@/components/data-display/StatusBadge'
import { useWakeVehicle, getVehicleStatus } from '@/api/hooks/useVehicles'
import type { Vehicle, VehicleState, VehicleStatus } from '@/api/types'

interface VehicleHeaderProps {
  vehicle: Vehicle | undefined
  state: VehicleState | undefined
  onRefetchState: () => void
}

/**
 * After a wake command Tesla needs a few seconds to bring the car back online,
 * so we refetch live state once after this delay to update the status badge.
 */
const WAKE_REFETCH_DELAY_MS = 5000

export function VehicleHeader({ vehicle, state, onRefetchState }: VehicleHeaderProps) {
  const { t } = useTranslation()
  const vehicleId = vehicle?.id ?? 0
  const canWake = vehicleId > 0

  const status: VehicleStatus = vehicle ? getVehicleStatus(state) : 'offline'

  const wakeMut = useWakeVehicle()
  const wakeMutate = wakeMut.mutate

  // Keep the latest refetch callback in a ref so the post-wake timer always
  // invokes the current prop without needing to reschedule on every change.
  const refetchRef = useRef(onRefetchState)
  useEffect(() => {
    refetchRef.current = onRefetchState
  }, [onRefetchState])

  // Track the pending post-wake timer so it is cancelled on unmount — otherwise
  // navigating away between the wake and the refetch fires a state update on an
  // unmounted tree.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    },
    [],
  )

  const handleWake = useCallback(() => {
    if (vehicleId <= 0) return
    wakeMutate(vehicleId, {
      onSuccess: () => {
        if (timerRef.current !== null) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => {
          timerRef.current = null
          refetchRef.current()
        }, WAKE_REFETCH_DELAY_MS)
      },
    })
  }, [vehicleId, wakeMutate])

  const displayName =
    vehicle?.display_name?.trim() || vehicle?.vin?.trim() || t('common.vehicle', 'Vehicle')

  const modelTrim = useMemo(
    () =>
      [vehicle?.model, vehicle?.trim_badging]
        .map((part) => part?.trim())
        .filter((part): part is string => Boolean(part))
        .join(' '),
    [vehicle?.model, vehicle?.trim_badging],
  )
  const vin = vehicle?.vin?.trim() ?? ''
  const hasMeta = Boolean(modelTrim || vin)

  return (
    <FadeIn>
      <div className="flex items-center gap-4">
        <Link
          to="/vehicles"
          aria-label={t('common.back', 'Back')}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl p-2.5 text-[var(--text-muted)] transition-all hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1
              className="text-3xl font-bold tracking-tight text-[var(--text-primary)] outline-none"
              tabIndex={-1}
              data-route-focus-target="true"
            >
              {displayName}
            </h1>
            <StatusBadge status={status} size="md" />
          </div>
          <p className="mt-0.5 text-sm text-[var(--text-muted)]" data-testid="vehicle-header-subtitle">
            {hasMeta ? (
              <>
                {modelTrim && <span>{modelTrim}</span>}
                {modelTrim && vin && <span aria-hidden="true"> &middot; </span>}
                {vin && <span className="font-mono">{vin}</span>}
              </>
            ) : (
              t('vehicles.detail.detailsUnavailable', 'Vehicle details unavailable')
            )}
          </p>
        </div>
        <Button
          onClick={handleWake}
          loading={wakeMut.isPending}
          disabled={!canWake}
          icon={<Power className="h-4 w-4" aria-hidden="true" />}
        >
          {t('common.wakeUp', 'Wake Up')}
        </Button>
      </div>
    </FadeIn>
  )
}
