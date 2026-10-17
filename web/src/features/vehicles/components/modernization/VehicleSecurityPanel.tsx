import type { SecurityEvent, VehicleState } from '@/api/types';
import type { DataStateSource } from '@/api/dataState';
import type { VehicleDetailSummaryProps } from '../statstrip-vehicle-detail/useVehicleDetailSummary';
import { SecuritySection } from '../vehicle-detail/SecuritySection';

/** The live page and shared consumer use the same four source-backed states. */
export function VehicleSecurityPanel({ securityData, state, sourceQuery, liveStateQuery }: VehicleDetailSummaryProps & {
  securityData: SecurityEvent | null | undefined;
  state: VehicleState | undefined;
  liveStateQuery?: DataStateSource<unknown>;
}) {
  return <SecuritySection securityData={securityData} state={state} sourceQuery={sourceQuery} liveStateQuery={liveStateQuery} />;
}
