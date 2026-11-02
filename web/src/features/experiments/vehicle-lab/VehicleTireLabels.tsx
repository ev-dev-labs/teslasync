import { useTranslation } from 'react-i18next'
import { Html } from '@react-three/drei/web/Html'
import { Button, Caption, Text } from '@/components/ui'
import { usePressureFormat } from '@/hooks/usePressureFormat'
import { PRESSURE_THRESHOLDS_PA } from '@/features/vehicle-systems/components/pressure-modernization/pressureData'
import { cn } from '@/lib/cn'
import type { VehicleLabState, WheelPosition } from './vehicleLabState'
import type { VehiclePart } from './partMapping'

const WHEELS: { corner: WheelPosition; label: string; position: [number, number, number] }[] = [
  { corner: 'FrontLeft', label: 'Front-left tire', position: [1.4, .45, 1.5] },
  { corner: 'FrontRight', label: 'Front-right tire', position: [-1.4, .45, 1.5] },
  { corner: 'RearLeft', label: 'Rear-left tire', position: [1.4, 1.05, -1.5] },
  { corner: 'RearRight', label: 'Rear-right tire', position: [-1.4, 1.05, -1.5] },
]

export default function VehicleTireLabels({ state, onSelect }: { state: VehicleLabState; onSelect?: (part: VehiclePart) => void }) {
  const { t } = useTranslation()
  const { formatPressureValue } = usePressureFormat()
  return (
    <>
      {WHEELS.map(({ corner, label, position }) => {
        const pressure = state.tirePressurePa[corner]
        const warning = pressure !== null && (pressure < PRESSURE_THRESHOLDS_PA.normalMin || pressure > PRESSURE_THRESHOLDS_PA.normalMax)
        return (
          <Html key={corner} position={position} center zIndexRange={[20, 0]}>
            <div role="group" aria-label={t(`experiments.vehicleLab.parts.wheel${corner}`, label)} className={cn('w-28 rounded-shape-sm border bg-[var(--surface-1)] px-2 py-1 text-center shadow-sm', warning ? 'border-[var(--semantic-warning)]' : 'border-[var(--border-default)]')}>
              <Button variant="ghost" wrapLabel className="min-h-11 w-full flex-col px-0" onClick={() => onSelect?.(`wheel${corner}`)}>
                <Caption>{t(`experiments.vehicleLab.parts.wheel${corner}`, label)}</Caption>
                <Text as="span" variant="bodySm">{pressure === null ? t('experiments.vehicleLab.unavailable', 'Unavailable') : formatPressureValue(pressure)}</Text>
                {warning && <Caption>{t('experiments.vehicleLab.pressureWarning', 'Outside normal band')}</Caption>}
              </Button>
            </div>
          </Html>
        )
      })}
    </>
  )
}
