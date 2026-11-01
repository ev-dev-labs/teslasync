import { useTranslation } from 'react-i18next'
import { Heading, Text } from '@/components/ui'

const PARTS = [
  ['doorFrontLeft', 'Front-left door'], ['doorFrontRight', 'Front-right door'],
  ['doorRearLeft', 'Rear-left door'], ['doorRearRight', 'Rear-right door'],
  ['windowFrontLeft', 'Front-left window'], ['windowFrontRight', 'Front-right window'],
  ['windowRearLeft', 'Rear-left window'], ['windowRearRight', 'Rear-right window'],
  ['wheelFrontLeft', 'Front-left tire'], ['wheelFrontRight', 'Front-right tire'],
  ['wheelRearLeft', 'Rear-left tire'], ['wheelRearRight', 'Rear-right tire'],
  ['frunk', 'Front trunk'], ['trunk', 'Rear trunk'], ['chargePort', 'Charge port'],
  ['headlights', 'Headlights'], ['taillights', 'Taillights'],
] as const

export default function VehicleSummary() {
  const { t } = useTranslation()
  return (
    <section aria-labelledby="vehicle-state-heading" className="rounded-shape-md border border-[var(--border-default)] p-4">
      <Heading level="panel" id="vehicle-state-heading">{t('experiments.vehicleLab.summary', 'Vehicle state')}</Heading>
      <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PARTS.map(([part, fallback]) => (
          <div key={part} className="min-w-0 border-l-2 border-[var(--border-default)] pl-3">
            <Text as="dt" variant="bodySm">{t(`experiments.vehicleLab.parts.${part}`, fallback)}</Text>
            <Text as="dd" variant="caption" className="mt-1">{t('experiments.vehicleLab.unavailable', 'Unavailable')}</Text>
          </div>
        ))}
      </dl>
    </section>
  )
}
