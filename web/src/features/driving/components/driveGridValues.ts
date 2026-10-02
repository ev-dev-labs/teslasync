import { endpointLabel } from '@/components/data-display';
import { getEfficiency, gradeFromEfficiency } from '@/lib/drivesAggregation';
import type { Drive } from '@/types/driving';
import type { DriveFsdInsight } from '@/types/fsd';
import { driveAverageSpeed, driveBattery } from './driveGridMetrics';
import { compactTableValueSelection, parseTableValueSelections, tableValueKey, type TableValueSelection } from '@/components/ui';

export const DRIVE_VALUE_COLUMNS = ['date', 'start', 'destination', 'distance', 'duration', 'speed', 'maxSpeed', 'avgPower', 'outsideTemp', 'insideTemp', 'efficiency', 'startBattery', 'battery', 'batteryUsed', 'energy', 'regen', 'fsd', 'grade', 'score', 'cost', 'status'] as const;
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

export function driveColumnValue(drive: Drive, column: DriveValueColumn, fsd: ReadonlyMap<number, DriveFsdInsight>, anomalies: ReadonlySet<number>, fsdAvailable = true): string | number | null {
  switch (column) {
    case 'date': return drive.startTs;
    case 'start': return endpointLabel({ address: drive.startAddress, lat: drive.startLat, lon: drive.startLon });
    case 'destination': return endpointLabel({ address: drive.endAddress, lat: drive.endLat, lon: drive.endLon });
    case 'distance': return drive.distanceM > 0 ? drive.distanceM : null;
    case 'duration': return drive.durationS;
    case 'speed': return driveAverageSpeed(drive);
    case 'maxSpeed': return drive.maxSpeedMps;
    case 'avgPower': return drive.avgPowerW;
    case 'outsideTemp': return drive.outsideTempAvgC;
    case 'insideTemp': return drive.insideTempAvgC;
    case 'efficiency': return getEfficiency(drive);
    case 'startBattery': return driveBattery(drive).start;
    case 'battery': return driveBattery(drive).end;
    case 'batteryUsed': return driveBattery(drive).used;
    case 'cost':
    case 'energy': return drive.energyUsedWh != null && drive.energyUsedWh > 0 ? drive.energyUsedWh : null;
    case 'regen': return drive.regenEnergyWh;
    case 'fsd': {
      const insight = fsd.get(drive.id);
      if (!fsdAvailable || !insight || insight.confidence === 'unknown' || insight.fsd_distance_m == null) return null;
      return insight.fsd_share_pct != null ? `share:${insight.fsd_share_pct}` : `distance:${insight.fsd_distance_m}`;
    }
    case 'grade': {
      const grade = gradeFromEfficiency(getEfficiency(drive)).label;
      return grade === '—' ? null : grade;
    }
    case 'score': return drive.score;
    case 'status': return driveStatusFlags(drive, anomalies.has(drive.id)).join('|') || null;
  }
}

export function driveValueKey(value: string | number | null): string {
  return tableValueKey(value);
}
