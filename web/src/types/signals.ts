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
