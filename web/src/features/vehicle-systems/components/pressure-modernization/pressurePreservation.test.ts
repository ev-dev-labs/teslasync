import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Works from both repository root and `cd web`, including Windows/jsdom.
// Do not construct filesystem paths from import.meta.url in this environment.
const root = existsSync(path.resolve(process.cwd(), 'src/features'))
  ? process.cwd() : path.resolve(process.cwd(), 'web');
const feature = path.resolve(root, 'src/features/vehicle-systems');
const source = (name: string) => readFileSync(path.resolve(feature, 'components/pressure-modernization', name), 'utf8');
const page = readFileSync(path.resolve(feature, 'pages/TirePressurePage.tsx'), 'utf8');
const hooks = readFileSync(path.resolve(root, 'src/api/hooks/usePressurePage.ts'), 'utf8');

describe('pressure shipping source preservation', () => {
  it('uses one full-width layout and one allocated-width packing observer', () => {
    expect(page.match(/<CardGrid\b/g)).toHaveLength(1);
    expect(page.match(/<PageLayout\b/g)).toHaveLength(1);
    for (const name of ['PressureSummary.tsx', 'PressureHistoryCard.tsx']) {
      expect(source(name)).toContain('useCardPlacement()');
    }
    const shipping = ['pressureData.ts', 'PressureSummary.tsx', 'PressureCurrentCard.tsx', 'PressureHistoryCard.tsx', 'PressureHistoryTable.tsx', 'PressureRefreshNotice.tsx']
      .map(source).join('\n') + page;
    expect(shipping).not.toMatch(/useContainerWidth|new ResizeObserver|max-w-\[1600px\]/);
    expect(shipping).not.toMatch(/style=\{\{|<(button|input|textarea|select|table)\b|from ['"](recharts|react-leaflet|framer-motion)['"]/);
    const grid = readFileSync(path.resolve(root, 'src/components/layout/layout-reference/CardGrid.tsx'), 'utf8');
    expect(grid.match(/useContainerWidth\(\)/g)).toHaveLength(1);
    expect(grid).toContain('CardPlacementContext.Provider');
  });

  it('keeps exact query, workspace, privacy and persistence identities', () => {
    expect(page).toContain('usePressurePageLatest(activeVehicleId)');
    expect(page).toContain('usePressurePageHistory(activeVehicleId, start, end)');
    expect(hooks).toContain("queryKey: ['tire-pressure-latest', activeVehicleId]");
    expect(hooks).toContain("queryKey: ['tire-pressure-history', activeVehicleId, start, end]");
    expect(hooks).toContain('/tire-pressure/latest?vehicle_id=${activeVehicleId}');
    expect(hooks).toContain('/tire-pressure?vehicle_id=${activeVehicleId}&start=${start}&end=${end}');
    expect(page).toContain("persistKey: 'tire-pressure.range'");
    expect(page).toContain('<AITirePressureTrendReasoning vehicleId={activeVehicleId ?? undefined}');
    expect(page).not.toMatch(/<RangePicker|<VehicleSelect|<DateRangeFilter/);
    expect(source('PressureHistoryCard.tsx')).toContain('chartKey="tire-pressure-history"');
    expect(source('PressureHistoryTable.tsx')).toContain('tableId="vehicle-systems:tire-pressure-history"');
    expect(source('PressureHistoryTable.tsx')).toContain("mobileColumns={['created_at', 'warnings']}");
    const router = readFileSync(path.resolve(root, '../internal/api/router.go'), 'utf8');
    expect(router).toContain('r.Route("/tire-pressure"');
    expect(router).toContain('r.Get("/", tirePressureHandler.List)');
    expect(router).toContain('r.Get("/latest", tirePressureHandler.Latest)');
  });

  it('does not add legacy guessing call sites or compute fake healthy/zero measurements', () => {
    const componentBody = page.slice(page.indexOf('export default function'));
    expect(componentBody).not.toMatch(/normaliseTpmsToPa|getTirePressureValue|summaryStats\?\.warningCount \?\? 0/);
    expect(source('pressureData.ts')).not.toMatch(/normaliseTpmsToPa|getTirePressureValue/);
    expect(page).toContain('usePressureFormat()');
    expect(source('PressureSummary.tsx')).toContain('summary.avg / PASCALS_PER_KPA');
    expect(source('PressureSummary.tsx')).toContain('summary?.warningCount ?? null');
    expect(page).toContain('row.tpms_hard_warnings == null || row.tpms_soft_warnings == null');
  });

  it('preserves independent fatal/retained handling and the complete chart/table pipeline', () => {
    expect(page).toContain('deriveDataState(latestQuery');
    expect(page).toContain('deriveDataState(historyQuery');
    expect(page).not.toMatch(/error=\{(?:latest|history)|loading=\{loadingLatest \|\|/);
    for (const name of ['PressureCurrentCard.tsx', 'PressureHistoryCard.tsx', 'PressureHistoryTable.tsx']) {
      expect(source(name)).toContain('<PressureRefreshNotice source={source}');
      expect(source(name)).toContain('source.fatalError');
      expect(source(name)).toContain('source.retry');
    }
    expect(source('PressureRefreshNotice.tsx')).toContain('source.refreshError');
    expect(source('PressureRefreshNotice.tsx')).toContain('source.isRefreshBlocked');
    expect(source('PressureRefreshNotice.tsx')).toContain('variant="warning"');
    const chart = source('PressureHistoryCard.tsx');
    expect(chart.match(/<ChartContainer\b/g)).toHaveLength(1);
    expect(chart).not.toContain('<LayoutCard');
    expect(chart).toContain('ariaLabel=');
    expect(chart).toContain('dataColumns=');
    expect(chart).toContain('exportData={rows}');
    expect(chart).toContain('connectNulls={false}');
    expect(chart).toContain("['fl', 'fr', 'rl', 'rr']");
    expect(chart).toContain('hiddenSeries?.isHidden(pos)');
    expect(chart).toContain('<ChartLegend');
    const table = source('PressureHistoryTable.tsx');
    for (const contract of ['variant="embedded"', 'enableValueFilters', 'pagination', 'onSort={onSort}', 'columns={columns}', 'data={rows}']) {
      expect(table).toContain(contract);
    }
  });
});
