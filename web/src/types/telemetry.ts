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
  vehicles?: VehicleTelemetry[];
  topics?: string[];
}

export interface VehicleTelemetry {
  vin: string;
  vehicleId?: number;
  state?: string;
  signalCount: number;
  batchCount: number;
  signalsPerSecond?: number;
  lastReceived?: string;
}

export interface RangeStats {
  min: number;
  max: number;
  avg: number;
  count: number;
}
