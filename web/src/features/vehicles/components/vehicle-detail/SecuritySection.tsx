import { useTranslation } from 'react-i18next'
import { Shield, Lock, Unlock, Eye, Car } from 'lucide-react'

import { GlassPanel } from '@/components/ui'
import { MetricCard } from '@/components/data-display'
import { Skeleton } from '@/components/feedback'
import type { SecurityEvent, VehicleState } from '@/api/types'

interface SecuritySectionProps {
  securityData: SecurityEvent | null | undefined
  state: VehicleState
}

export function SecuritySection({ securityData, state }: SecuritySectionProps) {
  const { t } = useTranslation()

  return (
    <GlassPanel className="p-6">
      <div className="flex items-center gap-2 mb-4">
        <Shield className="h-4 w-4 text-[var(--neon-cyan)]" />
        <span className="text-lg font-bold text-[var(--text-primary)]">
          {t('vehicles.detail.security', 'Security')}
        </span>
      </div>
      {securityData ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <MetricCard
            label={t('common.locked', 'Locked')}
            value={state.is_locked ? t('common.yes', 'Yes') : t('common.no', 'No')}
            icon={state.is_locked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
            color={state.is_locked ? 'green' : 'cyan'}
          />
          <MetricCard
            label={t('common.sentry', 'Sentry')}
            value={state.sentry_mode ? t('common.active', 'Active') : t('common.off', 'Off')}
            icon={<Eye className="h-4 w-4" />}
            color={state.sentry_mode ? 'green' : 'cyan'}
          />
          <MetricCard
            label={t('vehicles.detail.doors', 'Doors')}
            value={securityData.door_state ?? '—'}
            icon={<Car className="h-4 w-4" />}
            color="cyan"
          />
          <MetricCard
            label={t('vehicles.detail.windows', 'Windows')}
            value={
              [securityData.fd_window, securityData.fp_window, securityData.rd_window, securityData.rp_window]
                .every((w) => w === 'Closed')
                ? t('common.allClosed', 'All Closed')
                : t('common.someOpen', 'Some Open')
            }
            icon={<Car className="h-4 w-4" />}
            color={
              [securityData.fd_window, securityData.fp_window, securityData.rd_window, securityData.rp_window]
                .every((w) => w === 'Closed')
                ? 'green'
                : 'cyan'
            }
          />
        </div>
      ) : (
        <Skeleton lines={2} height={16} />
      )}
    </GlassPanel>
  )
}
