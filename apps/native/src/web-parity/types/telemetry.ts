export interface SignalPoint {
  timestamp: string;
  valueNum?: number;
  valueStr?: string;
  valueBool?: boolean;
}

export interface SignalStats {
  vehicleId: number;
  count: number;
  oldest: string | null;
  newest: string | null;
}

export interface SignalHistoryResponse {
  vehicleId: number;
  signal: string;
  from: string;
  to: string;
  count: number;
  data: SignalPoint[];
}

export interface SignalLogEntry {
  timestamp: string;
  valueNum?: number;
  valueStr?: string;
  valueBool?: boolean;
}

export interface SignalRow {
  name: string;
  value: string;
  timestamp: string | null;
  staleness: number;
  category: 'active' | 'stale' | 'never';
}

export interface SignalEntry {
  id: number;
  timestamp: string;
  name: string;
  value: string;
  type: 'number' | 'string' | 'boolean';
}

export interface TelemetryStatus {
  connected: boolean;
  broker?: string;
  uptimeSeconds?: number;
  uptime_seconds?: number;
  vehicles?: Record<string, VehicleTelemetry> | VehicleTelemetry[];
  streaming_vehicles?: Record<string, VehicleTelemetry>;
  topics?: string[];
}

export interface VehicleTelemetry {
  vin: string;
  vehicleId?: number;
  vehicle_id?: number;
  state?: string;
  signalCount: number;
  signal_count?: number;
  batchCount: number;
  batch_count?: number;
  signalsPerSecond?: number;
  signals_per_second?: number;
  lastReceived?: string;
  last_received?: string;
  is_streaming?: boolean;
  data_source?: string;
  latency_ms?: number;
  uptime_seconds?: number;
}

export interface RangeStats {
  min: number;
  max: number;
  avg: number;
  count: number;
}
