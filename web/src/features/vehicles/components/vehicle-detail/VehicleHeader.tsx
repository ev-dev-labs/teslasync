import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Power } from 'lucide-react'

import { GlassPanel, Badge, Button, Text } from '@/components/ui'
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
    <GlassPanel className="p-6">
      <div className="flex items-center gap-4">
        <Link
          to="/vehicles"
          aria-label={t('common.back', 'Back')}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl p-2.5 text-[var(--text-muted)] transition-all hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap">
            <Badge variant={statusVariant(status)} dot size="lg">
              {statusLabel}
            </Badge>
            <Badge variant="neutral" size="sm">
              {modelLabel || '—'}
            </Badge>
          </div>
          <Text as="p" size="sm" color="muted" mono className="mt-1 truncate">
            {vin || '—'}
          </Text>
        </div>
        <Button
          onClick={onWake}
          loading={waking}
          icon={<Power className="h-4 w-4" aria-hidden="true" />}
        >
          {t('common.wakeUp', 'Wake Up')}
        </Button>
      </div>
    </GlassPanel>
  )
}
