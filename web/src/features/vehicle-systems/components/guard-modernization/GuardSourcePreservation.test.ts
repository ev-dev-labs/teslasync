import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Windows-safe whether the parent launches Vitest from repo root or web.
const cwd = process.cwd();
const src = existsSync(resolve(cwd, 'src/features/vehicle-systems/pages/GuardModePage.tsx'))
  ? resolve(cwd, 'src') : resolve(cwd, 'web/src');
const page = readFileSync(resolve(src, 'features/vehicle-systems/pages/GuardModePage.tsx'), 'utf8');
const dir = resolve(src, 'features/vehicle-systems/components/guard-modernization');
const shipping = readdirSync(dir).filter(name => /\.(ts|tsx)$/.test(name) && !name.includes('.test.'));
const sources = shipping.map(name => readFileSync(resolve(dir, name), 'utf8'));
const all = [page, ...sources].join('\n');
const model = readFileSync(resolve(dir, 'useGuardPageModel.ts'), 'utf8');

describe('bounded guard source preservation', () => {
  it('exceeds the 532 shipping-line floor without counting tests or unrelated children', () => {
    expect([page, ...sources].reduce((n, s) => n + s.trimEnd().split(/\r?\n/).length, 0)).toBeGreaterThanOrEqual(532);
  });
  it('uses one canonical layout/grid and placement only in provider-mounted presenters', () => {
    expect(page.match(/<PageLayout\b/g)).toHaveLength(1);
    expect(page.match(/<CardGrid\b/g)).toHaveLength(1);
    expect(all).not.toMatch(/ResizeObserver|useContainerWidth|window\.innerWidth|grid-flow-dense/);
    expect(all).not.toMatch(/<VehicleSelect|<RangePicker|<DateRangeFilter/);
    for (const name of ['GuardLiveMap', 'GuardControls', 'GuardSettings', 'GuardStatus', 'GuardEvents']) {
      expect(page).toContain(`<${name} model={model}`);
      expect(readFileSync(resolve(dir, `${name}.tsx`), 'utf8')).toContain('useCardPlacement()');
    }
  });
  it('retains hooks, polling, null-safe drafts, all command operands and cache ownership', () => {
    for (const hook of ['useGuardConfig', 'useGuardEvents', 'useVehicleState', 'useGeofences',
      'useSetGuardConfig', 'useGuardPanic', 'useAcknowledgeGuardEvent']) expect(model).toContain(hook);
    expect(model).toContain('refetchInterval: guardConfig?.enabled ? 5_000 : 30_000');
    expect(model).toContain('autoPanic ?? guardConfig?.auto_panic ?? false');
    expect(model).toContain("sensitivity || guardConfig?.sensitivity || 'medium'");
    for (const operand of ['enabled: !isArmed', 'enabled: isArmed',
      'home_geofence_id: effectiveHomeGeofenceId ? Number(effectiveHomeGeofenceId) : null',
      'sensitivity: effectiveSensitivity', 'auto_panic: effectiveAutoPanic',
      'panic.mutate(activeVehicleId)', 'ackEvent.mutate({ vehicleId: activeVehicleId, eventId })'])
      expect(model).toContain(operand);
    expect(all).not.toMatch(/fetch\(|localStorage|sessionStorage|invalidateQueries|queryKey:/);
  });
  it('preserves event metadata, live trust, specialist formatting and confirmation', () => {
    for (const token of ['isVehicleStateFieldCurrent', 'acknowledged_at', 'event.from_state', 'event.to_state',
      'event.acknowledged_by', 'event.ts', 'event.id', 'vehicleIcon()', 'MapInvalidator',
      'useNumberFormatting', 'formatDateTime', "useState<MapStyle>('dark')",
      'guard.modernization.panicEffects', 'onConfirm={model.handlePanic}', 'onCancel='])
      expect(all).toContain(token === 'acknowledged_at' ? 'isGuardEventAcknowledged' : token);
    expect(all).not.toMatch(/from ['"](?:recharts|react-leaflet|framer-motion)['"]|style=\{\{|<(?:button|input|textarea|select|table)\b/);
    expect(page).not.toContain('empty=');
    expect(all).toContain('fatalError');
    expect(all).toContain('StaleRefreshWarning');
  });
});
