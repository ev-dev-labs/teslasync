import { endpointLabel } from '@/components/data-display';
import type { Drive } from '@/types/driving';
import { compactTableValueSelection, parseTableValueSelections, type TableValueSelection } from '@/components/ui';

export const DRIVE_VALUE_COLUMNS = ['route', 'date', 'start', 'destination', 'distance', 'duration', 'speed', 'maxSpeed', 'avgPower', 'outsideTemp', 'insideTemp', 'efficiency', 'startBattery', 'battery', 'batteryUsed', 'energy', 'regen', 'fsd', 'grade', 'score', 'cost', 'status'] as const;
export type DriveValueColumn = typeof DRIVE_VALUE_COLUMNS[number];
export type DriveValueSelection = TableValueSelection;
export type DriveValueSelections = Partial<Record<DriveValueColumn, DriveValueSelection>>;

export function parseDriveValueSelections(raw: string): { selections: DriveValueSelections; invalid: boolean } {
  return parseTableValueSelections(raw, DRIVE_VALUE_COLUMNS);
}

export function compactDriveValueSelection(selected: string[], available: string[]): DriveValueSelection {
  return compactTableValueSelection(selected, available);
}

export function driveStatusFlags(drive: Drive, anomalous: boolean) {
  const flags: Array<'inProgress' | 'noTelemetry' | 'highSpeed' | 'highEnergyUse'> = [];
  if (drive.endTs == null) flags.push('inProgress');
  if (drive.endTs != null && drive.distanceM <= 0 && drive.durationS <= 0) flags.push('noTelemetry');
  if (drive.maxSpeedMps != null && drive.maxSpeedMps > 58.1152) flags.push('highSpeed');
  if (anomalous) flags.push('highEnergyUse');
  return flags;
}

export const DRIVE_REVIEW_STATUSES = ['recorded', 'needsReview', 'inProgress'] as const;
export type DriveReviewStatus = typeof DRIVE_REVIEW_STATUSES[number];

export function driveReviewStatus(drive: Drive, anomalous: boolean): DriveReviewStatus {
  if (drive.endTs == null) return 'inProgress';
  return driveStatusFlags(drive, anomalous).length > 0 ? 'needsReview' : 'recorded';
}

export function driveRouteLabel(drive: Drive): string | null {
  const start = endpointLabel({ address: drive.startAddress, lat: drive.startLat, lon: drive.startLon });
  const end = endpointLabel({ address: drive.endAddress, lat: drive.endLat, lon: drive.endLon });
  return start || end ? `${start ?? '—'} → ${end ?? '—'}` : null;
}
