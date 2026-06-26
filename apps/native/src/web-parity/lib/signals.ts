// Native parity port of web/src/lib/signals.ts.
//
// Signal field registry for automation conditions and state checks.
//
// ## Native conversion (contract rules 6 + 7)
//
// signals.ts is non-visual utility/type code: a SignalFieldType string-literal
// union, a SignalField interface, the static SIGNAL_FIELDS registry, and four
// pure derived helpers. It has no imports and touches no DOM, no browser
// globals, no Recharts/Leaflet, and no web UI components, so the logic/types
// port 1:1 to React Native-compatible TypeScript (contract rule 6).
//
// The `key` values ('battery_level', 'speed', 'state', …) are API/DB field
// names and the `unit` values ('%', '°C', 'mph') are human-readable display
// hints rendered at the UI boundary; both are preserved verbatim for
// behavioral parity (contract rule 3). They are NOT new Go struct fields or
// DB columns, so Phase-48 SI-canonical naming rules do not apply to this
// faithful port.

export type SignalFieldType = 'numeric' | 'boolean' | 'string';

export interface SignalField {
  key: string; // DB column / API field name
  label: string; // Human-readable label
  type: SignalFieldType;
  unit?: string; // e.g. 'mph', '°C', '%'
}

/** All signals available for automation conditions and state checks */
export const SIGNAL_FIELDS: SignalField[] = [
  {key: 'battery_level', label: 'Battery Level', type: 'numeric', unit: '%'},
  {key: 'inside_temp', label: 'Inside Temperature', type: 'numeric', unit: '°C'},
  {
    key: 'outside_temp',
    label: 'Outside Temperature',
    type: 'numeric',
    unit: '°C',
  },
  {key: 'speed', label: 'Speed', type: 'numeric', unit: 'mph'},
  {key: 'is_locked', label: 'Is Locked', type: 'boolean'},
  {key: 'is_charging', label: 'Is Charging', type: 'boolean'},
  {key: 'is_climate_on', label: 'Climate On', type: 'boolean'},
  {key: 'sentry_mode', label: 'Sentry Mode', type: 'boolean'},
  {key: 'state', label: 'Vehicle State', type: 'string'},
  // extensible — add new signals here
];

/** Derived helpers */
export const NUMERIC_SIGNAL_FIELDS = SIGNAL_FIELDS.filter(
  f => f.type === 'numeric',
);
export const BOOLEAN_SIGNAL_FIELDS = SIGNAL_FIELDS.filter(
  f => f.type === 'boolean',
);
export const BOOL_FIELD_KEYS = new Set(BOOLEAN_SIGNAL_FIELDS.map(f => f.key));

/** For Select dropdowns */
export const SIGNAL_FIELD_OPTIONS = SIGNAL_FIELDS.map(f => ({
  value: f.key,
  label: f.label,
}));
