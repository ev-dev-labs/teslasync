import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/runtime'
import type { Vehicle } from '@/types/vehicle'

const DRILL_VIN = /^DRILL[0-9]{12}$/

export function DemoDataNotice({ vehicles }: { vehicles: readonly Pick<Vehicle, 'vin'>[] }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const detailsId = useId()
  if (!vehicles.some(vehicle => DRILL_VIN.test(vehicle.vin ?? ''))) return null

  return (
    <div
      role="status"
      data-testid="demo-data-notice"
      className="border-b border-amber-500/20 bg-amber-500/[0.08] px-4 text-sm text-[var(--text-secondary)] md:py-2"
    >
      <div className="flex min-h-11 items-center justify-between gap-2 md:hidden">
        <span className="font-semibold text-[var(--text-primary)]">
          {t('demoData.title', 'Sample data present')}
          <span className="font-normal text-[var(--text-secondary)]">
            {' · '}{t('demoData.mobileSummary', 'Not live')}
          </span>
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => setExpanded(value => !value)}
          className="min-h-11 shrink-0 px-2 text-[var(--text-primary)]"
        >
          {expanded ? t('demoData.hideDetails', 'Less') : t('demoData.showDetails', 'Details')}
        </Button>
      </div>
      <p id={detailsId} className={expanded ? 'pb-2 md:hidden' : 'hidden'}>
        {t('demoData.detail', 'DRILL vehicles and their drive and charging history are synthetic, not live activity.')}
      </p>
      <div className="hidden md:block">
        <span className="font-semibold text-[var(--text-primary)]">
          {t('demoData.title', 'Sample data present')}
        </span>
        {' — '}
        {t('demoData.detail', 'DRILL vehicles and their drive and charging history are synthetic, not live activity.')}
      </div>
    </div>
  )
}
