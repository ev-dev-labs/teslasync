import type { SignalUnitKind } from '@/api/types'
import { unitKindForSignalDescriptor } from '@/lib/signals'
import { PASCALS_PER_KPA } from '@/lib/unitConversion'
import { UnitInput, type UnitInputProps } from './UnitInput'

export interface SignalUnitInputProps extends Omit<UnitInputProps, 'unit'> {
  unitKind: SignalUnitKind | undefined
}

export function SignalUnitInput({ unitKind, value, onChange, ...props }: SignalUnitInputProps) {
  const scale = unitKind === 'pressure' ? PASCALS_PER_KPA : 1
  return (
    <UnitInput
      {...props}
      unit={unitKindForSignalDescriptor(unitKind)}
      value={value == null ? null : value / scale}
      onChange={(next) => onChange(next == null ? null : next * scale)}
    />
  )
}
