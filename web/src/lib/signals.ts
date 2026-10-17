import type { TFunction } from 'i18next'
import type { SignalUnitKind } from '@/api/types'
import { unitSymbol, type UnitKind, type UnitInputSettings } from './unitInput'

export type SignalFieldType = 'numeric' | 'boolean' | 'string'

export interface SignalField {
  /** DB column / live-signal API field name (snake_case). */
  key: string
  /** English fallback label. Rendered only when no i18n translation exists. */
  label: string
  /**
   * i18n key resolved at the render boundary by {@link buildSignalFieldOptions}.
   * The raw {@link SIGNAL_FIELDS} table stays framework-agnostic (no `t`) so it
   * remains unit-testable and importable from non-React modules.
   */
  labelKey: string
  type: SignalFieldType
  /** Canonical unit; preferred display labels are derived at the UI boundary. */
  unit?: string
}

/** A ready-to-render `<Select>` option: a stable `value` and a display `label`. */
export interface SignalFieldOption {
  value: string
  label: string
}

/** All signals available for automation conditions and state checks. */
export const SIGNAL_FIELDS: readonly SignalField[] = [
  { key: 'battery_level', label: 'Battery Level', labelKey: 'automations.builder.signals.batteryLevel', type: 'numeric', unit: '%' },
  { key: 'inside_temp', label: 'Inside Temperature', labelKey: 'automations.builder.signals.insideTemp', type: 'numeric', unit: '°C' },
  { key: 'outside_temp', label: 'Outside Temperature', labelKey: 'automations.builder.signals.outsideTemp', type: 'numeric', unit: '°C' },
  { key: 'speed', label: 'Speed', labelKey: 'automations.builder.signals.speed', type: 'numeric', unit: 'm/s' },
  { key: 'is_locked', label: 'Is Locked', labelKey: 'automations.builder.signals.isLocked', type: 'boolean' },
  { key: 'is_charging', label: 'Is Charging', labelKey: 'automations.builder.signals.isCharging', type: 'boolean' },
  { key: 'is_climate_on', label: 'Climate On', labelKey: 'automations.builder.signals.isClimateOn', type: 'boolean' },
  { key: 'sentry_mode', label: 'Sentry Mode', labelKey: 'automations.builder.signals.sentryMode', type: 'boolean' },
  { key: 'state', label: 'Vehicle State', labelKey: 'automations.builder.signals.state', type: 'string' },
  // extensible — add new signals here
]

/** Derived helpers */
export const NUMERIC_SIGNAL_FIELDS: SignalField[] = SIGNAL_FIELDS.filter(f => f.type === 'numeric')
export const BOOLEAN_SIGNAL_FIELDS: SignalField[] = SIGNAL_FIELDS.filter(f => f.type === 'boolean')

/** Keys whose value is a boolean — used to pick the true/false value editor. */
export const BOOL_FIELD_KEYS: ReadonlySet<string> = new Set(BOOLEAN_SIGNAL_FIELDS.map(f => f.key))

/**
 * Untranslated `<Select>` options (English `label`). Kept for non-React callers
 * and as the fallback catalog; React surfaces should prefer
 * {@link buildSignalFieldOptions} so labels honour the active locale.
 */
export const SIGNAL_FIELD_OPTIONS: SignalFieldOption[] = SIGNAL_FIELDS.map(f => ({
  value: f.key,
  label: f.label,
}))

/**
 * Build locale-aware `<Select>` options. Call at the render boundary and
 * memoise on `t`, e.g. `useMemo(() => buildSignalFieldOptions(t), [t])`.
 * Option `value`s are always the raw signal keys; only the `label` is
 * translated (falling back to the English {@link SignalField.label}).
 */
export function unitKindForSignal(key: string): UnitKind {
  switch (SIGNAL_FIELDS.find(field => field.key === key)?.unit) {
    case 'm': return 'distance'
    case 'm/s': return 'speed'
    case '°C': return 'temperature'
    case 'kPa': return 'pressure'
    case 'Wh': return 'energy'
    case '%': return 'percent'
    default: return 'number'
  }
}

const SIGNAL_INPUT_UNITS: Record<SignalUnitKind, UnitKind> = {
  distance: 'distance',
  temperature: 'temperature',
  pressure: 'pressure',
  speed: 'speed',
  charge: 'percent',
  none: 'number',
}

export function unitKindForSignalDescriptor(kind: SignalUnitKind | undefined): UnitKind {
  return kind === undefined ? 'number' : SIGNAL_INPUT_UNITS[kind]
}

export function buildSignalFieldOptions(t: TFunction, settings?: UnitInputSettings): SignalFieldOption[] {
  return SIGNAL_FIELDS.map(field => {
    const label = t(field.labelKey, field.label)
    const symbol = settings && field.type === 'numeric' ? unitSymbol(unitKindForSignal(field.key), settings) : ''
    return { value: field.key, label: symbol ? `${label} (${symbol})` : label }
  })
}
