import type { DriveDetail } from '@/types/driving';
import type { DriveStats } from './types';

function finite(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

/** Shared source selection only; it never changes wire data or invents net energy. */
export function driveEnergyEvidence(drive: DriveDetail, stats: DriveStats) {
  const hasPower = [...(drive.telemetry ?? []), ...(drive.positions ?? [])]
    .some((row) => finite(row.power) != null);
  const energyWh = finite(drive.energyUsedWh)
    ?? (hasPower || finite(drive.avgPowerW) != null ? finite(stats.energyWh) : null);
  const regenWh = finite(drive.regenEnergyWh)
    ?? (hasPower ? finite(stats.regenWh) : null);
  return { energyWh, regenWh, hasPower };
}
