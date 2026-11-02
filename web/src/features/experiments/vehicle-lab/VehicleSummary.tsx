import { useTranslation } from 'react-i18next'
import { Button, GlassPanel, Heading, Text } from '@/components/ui'
import type { VehicleLabState } from './vehicleLabState'
import { useVehicleReadings, type VehicleReadingId } from './useVehicleReadings'

export default function VehicleSummary({ state, onSelect }: { state: VehicleLabState; onSelect: (id: VehicleReadingId) => void }) {
  const { t } = useTranslation()
  const readings = useVehicleReadings(state)
  return (
    <GlassPanel role="region" aria-labelledby="vehicle-state-heading" padding="md">
      <Heading level="panel" id="vehicle-state-heading">{t('experiments.vehicleLab.summary', 'Vehicle state')}</Heading>
      <Text as="p" variant="caption" className="mt-2">{t('experiments.vehicleLab.inspectHint', 'Select a reading or a vehicle part to inspect it.')}</Text>
      <dl className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1">
        {readings.map(({ id, label, value }) => (
          <div key={id} className="grid min-w-0 grid-cols-[1fr_auto] items-center gap-2 border-b border-[var(--border-default)] pb-2">
            <dt><Button variant="ghost" wrapLabel className="min-h-11 justify-start px-2 text-left" aria-label={t('experiments.vehicleLab.inspect', 'Inspect {{part}}', { part: label })} onClick={() => onSelect(id)}>{label}</Button></dt>
            <Text as="dd" variant="caption" className="max-w-36 break-words text-right">{value}</Text>
          </div>
        ))}
      </dl>
    </GlassPanel>
  )
}
