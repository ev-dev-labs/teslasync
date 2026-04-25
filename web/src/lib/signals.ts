export type SignalFieldType = 'numeric' | 'boolean' | 'string'

export interface SignalField {
  key: string          // DB column / API field name
  label: string        // Human-readable label
  type: SignalFieldType
  unit?: string        // e.g. 'mph', '°C', '%'
}

/** All signals available for automation conditions and state checks */
export const SIGNAL_FIELDS: SignalField[] = [
  { key: 'battery_level', label: 'Battery Level', type: 'numeric', unit: '%' },
  { key: 'inside_temp', label: 'Inside Temperature', type: 'numeric', unit: '°C' },
  { key: 'outside_temp', label: 'Outside Temperature', type: 'numeric', unit: '°C' },
  { key: 'speed', label: 'Speed', type: 'numeric', unit: 'mph' },
  { key: 'is_locked', label: 'Is Locked', type: 'boolean' },
  { key: 'is_charging', label: 'Is Charging', type: 'boolean' },
  { key: 'is_climate_on', label: 'Climate On', type: 'boolean' },
  { key: 'sentry_mode', label: 'Sentry Mode', type: 'boolean' },
  { key: 'state', label: 'Vehicle State', type: 'string' },
  // extensible — add new signals here
]

/** Derived helpers */
export const NUMERIC_SIGNAL_FIELDS = SIGNAL_FIELDS.filter(f => f.type === 'numeric')
export const BOOLEAN_SIGNAL_FIELDS = SIGNAL_FIELDS.filter(f => f.type === 'boolean')
export const BOOL_FIELD_KEYS = new Set(BOOLEAN_SIGNAL_FIELDS.map(f => f.key))

/** For Select dropdowns */
export const SIGNAL_FIELD_OPTIONS = SIGNAL_FIELDS.map(f => ({ value: f.key, label: f.label }))
