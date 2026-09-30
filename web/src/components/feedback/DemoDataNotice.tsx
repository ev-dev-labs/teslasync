import { useTranslation } from 'react-i18next'
import type { Vehicle } from '@/types/vehicle'

const DRILL_VIN = /^DRILL[0-9]{12}$/

export function DemoDataNotice({ vehicles }: { vehicles: readonly Pick<Vehicle, 'vin'>[] }) {
  const { t } = useTranslation()
  if (!vehicles.some(vehicle => DRILL_VIN.test(vehicle.vin ?? ''))) return null

  return (
    <div
      role="status"
      data-testid="demo-data-notice"
      className="border-b border-amber-500/20 bg-amber-500/[0.08] px-4 py-2 text-sm text-[var(--text-secondary)]"
    >
      <span className="font-semibold text-[var(--text-primary)]">
        {t('demoData.title', 'Sample data present')}
      </span>
      {' — '}
      {t('demoData.detail', 'DRILL vehicles and their drive and charging history are synthetic, not live activity.')}
    </div>
  )
}
