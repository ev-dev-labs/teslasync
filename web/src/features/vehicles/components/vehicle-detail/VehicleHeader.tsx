import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Power } from 'lucide-react'

import { GlassPanel, Badge, Button, Text } from '@/components/ui'
import type { Vehicle, VehicleStatus } from '@/api/types'
import { statusVariant } from './helpers'

interface VehicleHeaderProps {
  vehicle: Vehicle | undefined
  status: VehicleStatus
  onWake: () => void
  waking: boolean
}

export function VehicleHeader({ vehicle, status, onWake, waking }: VehicleHeaderProps) {
  const { t } = useTranslation()

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
              {status}
            </Badge>
            <Badge variant="neutral" size="sm">
              {vehicle?.model ?? ''} {vehicle?.trim_badging ?? ''}
            </Badge>
          </div>
          <Text as="p" size="sm" color="muted" mono className="mt-1 truncate">
            {vehicle?.vin ?? ''}
          </Text>
        </div>
        <Button
          onClick={onWake}
          loading={waking}
          icon={<Power className="h-4 w-4" />}
        >
          {t('common.wakeUp', 'Wake Up')}
        </Button>
      </div>
    </GlassPanel>
  )
}
