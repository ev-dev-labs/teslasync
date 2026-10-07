/**
 * Composes the vault's evidence sections from the app's EXISTING TanStack
 * Query hooks (no new backend endpoints, no new hooks added to
 * `@/api/hooks/**`) into a single, already-normalized `VaultEvidence`
 * object, ready to hand to `reportBuilder.ts`.
 *
 * This hook only reads data — it applies no disclosure/section filtering
 * itself (that happens in `buildVaultReport()`), but it DOES apply the
 * sensitive-field selection (VIN disclosure, date precision) up front via
 * the normalizers, since those need the raw vehicle/session data the
 * normalizers alone have access to.
 */
import { useMemo } from 'react';
import { useVehicle } from '@/api/hooks/useVehicles';
import { useBatteryPassport } from '@/api/hooks/useBatteryPassport';
import { useMaintenance, useServiceRecords, useSoftwareUpdates } from '@/api/hooks/useVehicleSystems';
import { useWarrantyDetails } from '@/api/hooks/useVehicles';
import { useDriveHistory, useDriveScore, useDrivingStats } from '@/api/hooks/useDriving';
import { useChargingHistory } from '@/api/hooks/useCharging';
import { useGuardEvents } from '@/api/hooks/useGuard';
import {
  normalizeBattery,
  normalizeChargingHistory,
  normalizeDrivingHistory,
  normalizeMaintenance,
  normalizeSecurityIncidents,
  normalizeSoftwareUpdates,
  normalizeVehicleIdentity,
  normalizeWarranty,
} from '../lib/evidenceNormalizers';
import type { DatePrecision, SensitiveFieldSelection, VaultEvidence } from '../lib/types';

export interface UseVaultEvidenceResult {
  evidence: VaultEvidence;
  isLoading: boolean;
  /** True if at least one underlying query is in an error state — evidence for that section is simply omitted (null), never fabricated. */
  hasPartialErrors: boolean;
}

/**
 * @param vehicleId - stringified vehicle id, as every existing hook expects.
 * @param sensitive - the user's current VIN/timestamp disclosure selection.
 */
export function useVaultEvidence(vehicleId: string | null, sensitive: SensitiveFieldSelection): UseVaultEvidenceResult {
  const precision: DatePrecision = sensitive.exactTimestamps ? 'exact' : 'day';
  const numericVehicleId = vehicleId != null ? Number(vehicleId) : 0;

  const vehicleQuery = useVehicle(vehicleId ?? '');
  const passportQuery = useBatteryPassport(vehicleId);
  const maintenanceQuery = useMaintenance();
  const serviceRecordsQuery = useServiceRecords();
  const softwareUpdatesQuery = useSoftwareUpdates(vehicleId ?? '');
  const warrantyQuery = useWarrantyDetails(vehicleId ?? undefined);
  const driveHistoryQuery = useDriveHistory(vehicleId ?? undefined);
  const drivingStatsQuery = useDrivingStats(vehicleId ?? undefined);
  const driveScoreQuery = useDriveScore(vehicleId ?? undefined);
  const chargingHistoryQuery = useChargingHistory(vehicleId ?? undefined);
  const guardEventsQuery = useGuardEvents(numericVehicleId);

  const isLoading =
    vehicleQuery.isLoading ||
    passportQuery.isLoading ||
    maintenanceQuery.isLoading ||
    serviceRecordsQuery.isLoading ||
    softwareUpdatesQuery.isLoading ||
    warrantyQuery.isLoading ||
    driveHistoryQuery.isLoading ||
    drivingStatsQuery.isLoading ||
    driveScoreQuery.isLoading ||
    chargingHistoryQuery.isLoading ||
    guardEventsQuery.isLoading;

  const hasPartialErrors =
    vehicleQuery.isError ||
    passportQuery.isError ||
    maintenanceQuery.isError ||
    serviceRecordsQuery.isError ||
    softwareUpdatesQuery.isError ||
    warrantyQuery.isError ||
    driveHistoryQuery.isError ||
    drivingStatsQuery.isError ||
    driveScoreQuery.isError ||
    chargingHistoryQuery.isError ||
    guardEventsQuery.isError;

  const evidence = useMemo<VaultEvidence>(
    () => ({
      vehicle_identity: normalizeVehicleIdentity(vehicleQuery.data, sensitive.vinDisclosure),
      battery: normalizeBattery(passportQuery.data, precision),
      maintenance: normalizeMaintenance(maintenanceQuery.data, serviceRecordsQuery.data, precision),
      software_updates: normalizeSoftwareUpdates(softwareUpdatesQuery.data),
      warranty: normalizeWarranty(warrantyQuery.data ?? null, precision),
      driving_history: normalizeDrivingHistory(driveHistoryQuery.data, drivingStatsQuery.data, driveScoreQuery.data, precision),
      charging_history: normalizeChargingHistory(chargingHistoryQuery.data, precision),
      security_incidents: normalizeSecurityIncidents(guardEventsQuery.data, precision),
    }),
    [
      vehicleQuery.data,
      sensitive.vinDisclosure,
      passportQuery.data,
      precision,
      maintenanceQuery.data,
      serviceRecordsQuery.data,
      softwareUpdatesQuery.data,
      warrantyQuery.data,
      driveHistoryQuery.data,
      drivingStatsQuery.data,
      driveScoreQuery.data,
      chargingHistoryQuery.data,
      guardEventsQuery.data,
    ],
  );

  return { evidence, isLoading, hasPartialErrors };
}
