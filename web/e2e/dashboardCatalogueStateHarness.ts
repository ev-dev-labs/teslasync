import type { Page } from '@playwright/test';
import type { DashboardLayoutsPayload } from '../src/api/hooks/useSettings';
import type { RGLLayouts, SavedDashboard } from '../src/features/dashboard/widgets/types';
import { getWidgetDef } from '../src/features/dashboard/widgets/registry';
import { installCataloguePhotoSource } from './dashboardCatalogueGeometry';
import { installRemainingCatalogueSources } from './dashboardCatalogueRemainingFixtures';
import { installDashboardWidgetSources } from './dashboardWidgetFixtures';
import { fulfillApiFixture, installApiMocks, seedBrowserState } from './mockApi';

export async function prepareCatalogueState(
  page: Page, ids: string[], width: number, theme: 'light' | 'dark',
) {
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await seedBrowserState(page, theme, '/');
  const widgets = ids.map(widgetId => ({ id: `state-${widgetId}`, widgetId, vehicleId: 7 }));
  const layouts: RGLLayouts = {};
  for (const [breakpoint, columns] of Object.entries({ lg: 4, md: 3, sm: 2, xs: 1 })) {
    let row = 0;
    layouts[breakpoint] = widgets.map(widget => {
      const def = getWidgetDef(widget.widgetId);
      if (!def) throw new Error(`Unknown state widget: ${widget.widgetId}`);
      const y = row;
      row += def.defaultSize.rows;
      return { i: widget.id, x: 0, y, w: Math.min(columns, def.defaultSize.cols), h: def.defaultSize.rows };
    });
  }
  const dashboard: SavedDashboard = {
    id: 'catalogue-states', name: 'Catalogue source states', widgets, layouts,
    createdAt: '2026-10-03T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z', isDefault: true,
  };
  await page.addInitScript(saved => {
    localStorage.setItem('teslasync-dashboards', JSON.stringify([saved]));
    localStorage.setItem('teslasync-active-dashboard', saved.id);
  }, dashboard);
  const mocks = await installApiMocks(page, 'populated', theme);
  if (!mocks) throw new Error('Catalogue state acceptance requires strict local mocks');
  await installDashboardWidgetSources(page, mocks);
  await installRemainingCatalogueSources(page, mocks);
  await installCataloguePhotoSource(page, false);
  await page.route('**/api/v1/settings/dashboard-layouts', route => fulfillApiFixture(route, mocks, {
    json: { dashboards: [dashboard], active_id: dashboard.id } satisfies DashboardLayoutsPayload,
  }));
  return mocks;
}
