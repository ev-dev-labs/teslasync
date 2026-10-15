import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Power } from 'lucide-react'

import { Badge, Button, Text } from '@/components/ui'
import type { Vehicle, VehicleStatus } from '@/api/types'
import { VEHICLE_STATE_LABELS } from '@/types/fsm'
import { statusVariant } from './helpers'

interface VehicleHeaderProps {
  vehicle: Vehicle | undefined
  status: VehicleStatus
  onWake: () => void
  waking: boolean
}

export function VehicleHeader({ vehicle, status, onWake, waking }: VehicleHeaderProps) {
  const { t } = useTranslation()

  // Collapse model + trim into a single clean label: a missing trim must not
  // leave a trailing space, and an absent vehicle (loading) must not render a
  // lone-whitespace chip. Falls back to the em-dash placeholder in the JSX.
  const modelLabel = useMemo(
    () =>
      [vehicle?.model, vehicle?.trim_badging]
        .map((part) => part?.trim())
        .filter(Boolean)
        .join(' '),
    [vehicle?.model, vehicle?.trim_badging],
  )

  // `??` alone can't rescue an empty-string VIN, so normalise then fall back.
  const vin = vehicle?.vin?.trim()

  // Localised, capitalised status label (e.g. "online" → "Online"). The label
  // map covers every VehicleStatus; the `?? status` guard keeps an unexpected
  // runtime value readable instead of surfacing a raw i18n key.
  const statusLabel = t(`vehicle.state.${status}`, VEHICLE_STATE_LABELS[status] ?? status)

  return (
    <div className="min-w-0">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <Link
          to="/vehicles"
          aria-label={t('common.back', 'Back')}
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-shape-sm p-2.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <Badge variant={statusVariant(status)} dot size="lg" className="min-w-0 max-w-full whitespace-normal break-words">
              {statusLabel}
            </Badge>
            <Badge variant="neutral" size="sm" className="min-w-0 max-w-full whitespace-normal break-words">
              {modelLabel || '—'}
            </Badge>
          </div>
          <Text as="p" size="sm" color="muted" mono className="mt-1 break-all">
            {vin || '—'}
          </Text>
        </div>
        <Button
          wrapLabel
          className="min-h-11 w-full md:min-h-10 md:w-auto"
          onClick={onWake}
          loading={waking}
          icon={<Power className="h-4 w-4" aria-hidden="true" />}
        >
          {t('common.wakeUp', 'Wake up')}
        </Button>
      </div>
    </div>
  )
}
