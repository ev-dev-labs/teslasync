export type SignalSource = 'fleet_telemetry' | 'fleet_api' | 'manual' | 'backfill';

export interface SignalObservation {
  vehicle_id: number;
  ts: string;
  signal_name: string;
  value_numeric: number | null;
  value_text: string | null;
  value_bool: boolean | null;
  source: SignalSource;
}

export type SignalValueType = 'numeric' | 'text' | 'bool';

export interface SignalCatalogEntry {
  name: string;
  value_type: SignalValueType;
  source_module: string;
  unit: string | null;
  description: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

// Discriminated children — exactly one value_* is populated
export interface NumericSignalObservation extends SignalObservation {
  value_type: 'numeric';
  value: number;
}
export interface TextSignalObservation extends SignalObservation {
  value_type: 'text';
  value: string;
}
export interface BoolSignalObservation extends SignalObservation {
  value_type: 'bool';
  value: boolean;
}

export type TypedSignalObservation =
  | NumericSignalObservation
  | TextSignalObservation
  | BoolSignalObservation;

/**
 * Narrows a raw SignalObservation against its catalog entry, surfacing the
 * single populated value via `.value` and `.value_type`. Returns null if the
 * row is malformed — either the discriminant column is empty (e.g.,
 * value_type=numeric but value_numeric is null) or the catalog reports an
 * unrecognized value_type. The catalog is sourced from an unvalidated API
 * response, so the default branch keeps the declared `| null` return honest
 * at runtime rather than leaking an `undefined` a caller would dereference.
 */
export function narrowSignal(
  obs: SignalObservation,
  catalog: SignalCatalogEntry,
): TypedSignalObservation | null {
  switch (catalog.value_type) {
    case 'numeric':
      return obs.value_numeric == null
        ? null
        : { ...obs, value_type: 'numeric', value: obs.value_numeric };
    case 'text':
      return obs.value_text == null
        ? null
        : { ...obs, value_type: 'text', value: obs.value_text };
    case 'bool':
      return obs.value_bool == null
        ? null
        : { ...obs, value_type: 'bool', value: obs.value_bool };
    default:
      return null;
  }
}
