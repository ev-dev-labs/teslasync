import type { ShareToken, SharedDriveData } from '@/types/sharing'
import { charging, drives, vehicles } from './fixtures'

const shareForDrive = (id: number): ShareToken => {
  const drive = drives.find(row => row.id === id)!
  return {
    id: 900 + id,
    token: 'sample-link',
    drive_id: id,
    created_by: null,
    title: 'Fictional drive report',
    description: 'An illustrative trip with synthetic telemetry.',
    include_map: true,
    include_telemetry: true,
    include_speed: true,
    views: 8,
    expires_at: null,
    created_at: drive.end_ts,
  }
}

export function driveShares(id: number): ShareToken[] {
  return id === drives[0].id ? [shareForDrive(id)] : []
}

export function sessionShares(id: number): ShareToken[] {
  const session = charging.find(row => row.id === id)
  if (!session || id !== charging[0].id) return []
  return [{
    id: 1200 + id,
    token: 'sample-charge-link',
    charging_session_id: id,
    created_by: null,
    title: 'Fictional charging report',
    description: 'An illustrative charging session.',
    include_map: false,
    include_telemetry: false,
    include_speed: false,
    views: 3,
    expires_at: null,
    created_at: session.ended_at,
  }]
}

export function publicDriveShare(): SharedDriveData {
  const drive = drives[0]
  const vehicle = vehicles.find(row => row.id === drive.vehicle_id)!
  const share = shareForDrive(drive.id)
  return {
    payload_version: 'v2',
    share_type: 'drive',
    title: share.title ?? 'Fictional drive report',
    description: share.description ?? '',
    drive: {
      date: drive.start_ts,
      distance_m: drive.distance_m,
      duration_s: drive.duration_s,
      start_address: drive.start_address,
      end_address: drive.end_address,
      start_battery: drive.start_soc_pct,
      end_battery: drive.end_soc_pct,
      elevation_gain: null,
      elevation_loss: null,
      max_speed_mps: drive.max_speed_mps,
      avg_speed_mps: drive.avg_speed_mps,
      efficiency_wh_per_m: drive.energy_used_wh / drive.distance_m,
    },
    vehicle: { model: vehicle.model, color: vehicle.exterior_color },
    map_points: [
      { lat: drive.start_lat, lng: drive.start_lon },
      { lat: drive.end_lat, lng: drive.end_lon },
    ],
    elevation_profile: null,
    speed_profile: [
      { distance_m: 0, speed_mps: 0 },
      { distance_m: drive.distance_m / 2, speed_mps: drive.avg_speed_mps },
      { distance_m: drive.distance_m, speed_mps: 0 },
    ],
    telemetry: [
      { distance_m: 0, battery_level: drive.start_soc_pct, power: null, elevation: null },
      { distance_m: drive.distance_m, battery_level: drive.end_soc_pct, power: null, elevation: null },
    ],
  }
}
