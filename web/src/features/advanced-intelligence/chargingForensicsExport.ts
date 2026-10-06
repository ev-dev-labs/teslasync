import type { ChargingForensicsItem } from '@/types/advancedIntelligence';

/** Reconciliation packets retain the original SI/minor-unit schema, independent of visible columns. */
export function chargingForensicsExportRow(row: ChargingForensicsItem) {
  return {
    session_id: row.session_id,
    started_at: row.started_at,
    vehicle_energy_wh: row.vehicle_energy_wh,
    meter_energy_wh: row.meter_energy_wh ?? '',
    estimated_loss_wh: row.estimated_loss_wh ?? '',
    estimated_loss_low_wh: row.estimated_loss_low_wh ?? '',
    estimated_loss_high_wh: row.estimated_loss_high_wh ?? '',
    recorded_cost_minor: row.recorded_cost_minor ?? '',
    expected_cost_minor: row.expected_cost_minor ?? '',
    cost_discrepancy_minor: row.cost_discrepancy_minor ?? '',
    currency: row.currency ?? '',
    status: row.status,
  };
}
