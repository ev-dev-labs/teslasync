import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Windows-safe under both repo-root and web-root test invocations.
 * Do not use URL.pathname (drive letters and escaped spaces are not paths). */
const webRoot = existsSync(resolve(process.cwd(), 'web/src'))
  ? resolve(process.cwd(), 'web') : process.cwd();
const readSource = (path: string) => readFileSync(resolve(webRoot, 'src', path), 'utf8');
const directory = 'features/vehicle-systems/components/maintenance-modernization';

describe('maintenance live source integration and preservation boundaries', () => {
  it('uses matching read hooks rather than inline or legacy query engines', () => {
    const page = readSource('features/vehicle-systems/pages/MaintenancePage.tsx');
    expect(page).toContain("from '@/api/hooks/useMaintenance'");
    expect(page).toContain('useMaintenance(vehicleId)');
    expect(page).toContain('useServiceRecords(vehicleId)');
    expect(page).not.toMatch(/\b(useQuery|request|fetch|useMutation)\s*\(/);
    expect(page).not.toContain('useVehicleSystems');
    expect(page).not.toContain('empty={!data}');
  });

  it('preserves the full query identities, null gate and inherited retry policy', () => {
    const hook = readSource('api/hooks/useMaintenance.ts');
    expect(hook).toContain("queryKey: ['maintenance', vehicleId]");
    expect(hook).toContain("queryKey: ['maintenance-records', vehicleId]");
    expect(hook.match(/enabled: vehicleId !== null/g)).toHaveLength(2);
    expect(hook).not.toMatch(/\bretry\s*:|\bstaleTime\s*:/);
    expect(hook).not.toContain('/api/v1/');
    expect(hook).toContain('vehicle_id=');
    expect(hook).not.toContain('vehicleId=');
  });

  it('keeps the complete raw fields at the one typed read boundary', () => {
    const hook = readSource('api/hooks/useMaintenance.ts');
    for (const field of [
      'id', 'vehicle_id', 'category', 'name', 'description', 'due_date',
      'due_mileage', 'current_mileage', 'last_service_date', 'last_service_mileage',
      'interval_months', 'interval_miles', 'status', 'created_at', 'date',
      'mileage', 'cost', 'provider', 'notes',
    ]) expect(hook).toMatch(new RegExp(`\\b${field}:`));
    expect(readSource(`${directory}/maintenanceModel.ts`)).not.toContain('export interface MaintenanceItem');
  });

  it('retains all seven grid sections and the independent evidence drawer', () => {
    const page = readSource('features/vehicle-systems/pages/MaintenancePage.tsx');
    for (const id of [
      'maintenance-summary', 'maintenance-advisor', 'maintenance-items',
      'maintenance-projections', 'maintenance-cost', 'maintenance-categories',
      'maintenance-records',
    ]) expect(page).toContain(`id: '${id}'`);
    expect(page).toContain('<MaintenanceEvidenceDrawer');
    expect(page).not.toMatch(/max-w-\[1600px\]|max-w-screen|mx-auto/);
    expect(page).not.toContain('<RangePicker');
    expect(page).not.toContain('<VehicleSelect');
  });

  it('has one canonical grid/observer/packer owner, not one per presenter', () => {
    const page = readSource('features/vehicle-systems/pages/MaintenancePage.tsx');
    const slot = readSource(`${directory}/MaintenanceGridSlot.tsx`);
    expect(page.match(/<CardGrid\b/g)).toHaveLength(1);
    expect(page).toContain('<PageLayout');
    expect(slot).toContain('useCardPlacement()');
    for (const name of ['MaintenanceGridSlot.tsx', 'MaintenanceItemsPanel.tsx', 'MaintenanceRecordsPanel.tsx']) {
      expect(readSource(`${directory}/${name}`)).not.toMatch(/new ResizeObserver|useContainerWidth|packCardRows/);
    }
  });

  it('keeps record preference/export/column IDs and all evidence destinations', () => {
    const records = readSource(`${directory}/MaintenanceRecordsPanel.tsx`);
    expect(records).toContain('tableId="vehicle-systems:maintenance-records"');
    expect(records).toContain('variant="embedded"');
    expect(records).toContain('enableValueFilters');
    expect(records).not.toContain('exportable={false}');
    expect(records).not.toContain('exportAll=');
    const columns = readSource(`${directory}/serviceColumns.tsx`);
    for (const key of ['date', 'description', 'mileage', 'cost', 'provider', 'actions']) {
      expect(columns).toContain(`key: '${key}'`);
    }
    const drawer = readSource(`${directory}/MaintenanceEvidenceDrawer.tsx`);
    for (const key of ['vehicle', 'drives', 'charging', 'locations', 'alerts', 'telemetry', 'evidence-pack']) {
      expect(drawer).toContain(`key: '${key}'`);
    }
    for (const route of ['/drives', '/charging', '/locations', '/notifications/inbox', '/signals', '/diagnostics/service-evidence']) {
      expect(drawer).toContain(`'${route}'`);
    }
    expect(drawer).toContain('localDayKey(record?.date)');
  });

  it('uses fatalError locally, keeps retained data and does not invent scheduling', () => {
    const source = readSource(`${directory}/MaintenanceSource.tsx`);
    expect(source).toContain('source.fatalError');
    expect(source).toContain('source.refreshError');
    expect(source).toContain('<SourceContent');
    expect(source).toContain("state={source.fatalError ? 'error'");
    expect(source).toContain("source.data == null ? 'empty'");
    expect(source).toContain('emptyContent=');
    expect(source).toContain('{children}');
    const page = readSource('features/vehicle-systems/pages/MaintenancePage.tsx');
    expect(page).toContain('handleSchedule');
    expect(page).toContain('Preserved inherited no-op');
    expect(page).not.toMatch(/POST|DELETE|confirm\(|useMutation/);
  });
});
