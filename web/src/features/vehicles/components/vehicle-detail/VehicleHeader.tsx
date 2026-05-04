import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Power } from 'lucide-react'

import { GlassPanel, Badge, Button } from '@/components/ui'
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
          className="rounded-xl p-2.5 text-[var(--text-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)] transition-all"
        >
          <ArrowLeft className="h-5 w-5" />
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
          <p className="text-sm text-[var(--text-muted)] mt-1 truncate font-mono">
            {vehicle?.vin ?? ''}
          </p>
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
