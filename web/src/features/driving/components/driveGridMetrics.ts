import type { Drive } from '@/types/driving';

export function driveAverageSpeed(drive: Drive): number | null {
  return drive.avgSpeedMps ?? (drive.durationS > 0 ? drive.distanceM / drive.durationS : null);
}

export function driveBattery(drive: Drive) {
  const start = drive.startBatteryPct;
  const end = drive.endBatteryPct;
  if (start === 0 && end === 0 && drive.endTs != null) {
    return { start: null, end: null, used: null };
  }
  return { start, end, used: start != null && end != null ? start - end : null };
}
