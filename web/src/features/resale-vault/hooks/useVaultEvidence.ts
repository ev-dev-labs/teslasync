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
import { deriveDataState, type DataState, type DataStateSource } from '@/api/dataState';
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
import type { EvidenceSectionId } from '../lib/constants';

export interface VaultEvidenceSource {
  id: string;
  section: EvidenceSectionId;
  labelKey: string;
  label: string;
  loading: boolean;
  state: DataState<unknown>;
}

export interface UseVaultEvidenceResult {
  evidence: VaultEvidence;
  isLoading: boolean;
  /** Failures never discard any evidence retained by the underlying queries. */
  hasPartialErrors: boolean;
  sources: readonly VaultEvidenceSource[];
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

  const sources: VaultEvidenceSource[] = ([
    { id: 'vehicle', section: 'vehicle_identity', labelKey: 'resaleVault.section.vehicleIdentity', label: 'Vehicle identity', query: vehicleQuery },
    { id: 'battery', section: 'battery', labelKey: 'resaleVault.battery.title', label: 'Battery health', query: passportQuery },
    { id: 'maintenance', section: 'maintenance', labelKey: 'resaleVault.maintenance.scheduledCount', label: 'Scheduled items', query: maintenanceQuery },
    { id: 'service', section: 'maintenance', labelKey: 'resaleVault.maintenance.records', label: 'Service records', query: serviceRecordsQuery },
    { id: 'software', section: 'software_updates', labelKey: 'resaleVault.software.title', label: 'Software updates', query: softwareUpdatesQuery },
    { id: 'warranty', section: 'warranty', labelKey: 'resaleVault.warranty.title', label: 'Warranty', query: warrantyQuery },
    { id: 'drives', section: 'driving_history', labelKey: 'resaleVault.usage.drives', label: 'Drives observed', query: driveHistoryQuery },
    { id: 'driving-stats', section: 'driving_history', labelKey: 'resaleVault.usage.driving', label: 'Driving', query: drivingStatsQuery },
    { id: 'driving-score', section: 'driving_history', labelKey: 'resaleVault.usage.score', label: 'Driving score', query: driveScoreQuery },
    { id: 'charging', section: 'charging_history', labelKey: 'resaleVault.usage.charging', label: 'Charging', query: chargingHistoryQuery },
    { id: 'security', section: 'security_incidents', labelKey: 'resaleVault.incidents.title', label: 'Security incidents', query: guardEventsQuery },
  ] satisfies {
    id: string;
    section: EvidenceSectionId;
    labelKey: string;
    label: string;
    query: DataStateSource<unknown>;
  }[]).map(({ query, ...source }) => ({
    ...source,
    loading: query.isLoading && query.data === undefined,
    state: deriveDataState<unknown>(query),
  }));

  return { evidence, isLoading, hasPartialErrors, sources };
}
