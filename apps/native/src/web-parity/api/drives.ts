import { request } from '../../api/client';
import type { Drive, DriveTelemetryReading } from '../../api/types';

interface Position {
  vehicle_id: number;
  ts: string;
  latitude: number;
  longitude: number;
  heading: number | null;
  speed_mph: number | null;
  elevation_m: number | null;
  gps_state: string | null;
  source: string;
}

// === Drives ===
/** Fetches paginated driving sessions for a vehicle, optionally filtered by date range. */
export const getDrives = (
  vehicleId: number,
  limit = 50,
  offset = 0,
  start?: string,
  end?: string,
) => {
  const params = new URLSearchParams({
    vehicle_id: String(vehicleId),
    limit: String(limit),
    offset: String(offset),
  });
  if (start) {
    params.append('start', start);
  }
  if (end) {
    params.append('end', end);
  }
  return request<Drive[]>(`/drives?${params}`);
};

/** Fetches a single drive session by ID. */
export const getDrive = (id: number) => request<Drive>(`/drives/${id}`);

/** Fetches positions within a drive's time window. */
export const getDrivePositions = (driveId: number) =>
  request<Position[]>(`/drives/${driveId}/positions`);

/** Fetches detailed telemetry readings for a drive session. */
export const getDriveTelemetry = (driveId: number) =>
  request<DriveTelemetryReading[]>(`/drives/${driveId}/telemetry`);
