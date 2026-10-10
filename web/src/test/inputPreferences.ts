import type { UnitInputSettings } from '@/lib/unitInput'

export function inputPreferences(overrides: Partial<UnitInputSettings> = {}): UnitInputSettings {
  return {
    unit_of_length: 'km',
    unit_of_temp: 'C',
    unit_of_pressure: 'bar',
    decimal_precision: 2,
    locale: 'en-US',
    currency_symbol: '$',
    ...overrides,
  }
}
