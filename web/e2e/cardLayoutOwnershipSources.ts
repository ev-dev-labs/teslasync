import {
  complianceReport, consumablesReport, driverReport, governanceReport,
  insuranceReport, invoice, subscription, subscriptionReport, tariff,
  trustReport, warrantyReport,
} from './operationalbrief-contracts/ownership.fixtures';
import { cells, range, vehicleFlow } from './operationalbrief-contracts/battery.fixtures';
import { autopilotProfile, autopilotSavings, fleetHistory, ratePlans } from './operationalbrief-contracts/charging.fixtures';
import { efficiencyShift, navigationHistory, temperatureHistory, componentBoard } from './operationalbrief-contracts/specialized.fixtures';
import { dayFixture } from './operationalbrief-contracts/vehicles.fixtures';
import { recordedSegments } from './operationalbrief-contracts/driving.fixtures';

export const cardLayoutOwnershipSources: Record<string, unknown> = {
  '/consumables-lifecycle': consumablesReport,
  '/consumables-lifecycle/items': { items: [], total: 0 },
  '/data-governance': governanceReport,
  '/data-governance/runs': { items: [], total: 0, limit: 50, offset: 0 },
  '/driver-attribution': driverReport,
  '/driver-attribution/profiles': { items: [], total: 0 },
  '/driver-attribution/ghost-drives': { vehicle_id: 7, scanned: 80, ghosts: [] },
  '/insurance-telematics': insuranceReport,
  '/jurisdiction-compliance': complianceReport,
  '/jurisdiction-compliance/rates': { items: [], total: 0 },
  '/jurisdiction-compliance/filings': { items: [], total: 0, limit: 50, offset: 0 },
  '/model-trust': trustReport,
  '/subscription-roi': subscriptionReport,
  '/subscription-roi/subscriptions': { items: [subscription], total: 9 },
  '/tariff-lab/tariffs': { items: [tariff], total: 81, limit: 100, offset: 0 },
  '/warranty-command': warrantyReport,
  '/warranty-command/warranties': { items: [], total: 0 },
  '/charging-reconciliation/invoices': { items: [invoice], total: 81, limit: 50, offset: 0 },
  '/analytics/battery-cells': cells,
  '/analytics/range-projection': range,
  '/vehicles/7/energy/flow': vehicleFlow,
  '/charge-autopilot/profile': autopilotProfile,
  '/charge-autopilot/savings': autopilotSavings,
  '/charge-planner/rate-plans': ratePlans,
  '/tesla/charging/sessions': fleetHistory,
  '/analytics/temperature-impact': temperatureHistory,
  '/analytics/temperature-impact/shift': efficiencyShift,
  '/location-snapshots': navigationHistory,
  '/vehicles/7/rul': componentBoard,
  '/vehicles/7/segments': recordedSegments,
};

export function resolveCardLayoutDayLog(url: URL): unknown | undefined {
  if (url.pathname !== '/api/v1/day-log') return undefined;
  const date = url.searchParams.get('date');
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  return dayFixture('recorded', date ?? '2026-08-26');
}
