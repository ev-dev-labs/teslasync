export type DataScenario =
  | 'empty'
  | 'loading'
  | 'error'
  | 'stale'
  | 'partial'
  | 'populated'
  | 'large-fleet';

export interface QualityRoute {
  name: string;
  path: string;
  scenarios: readonly DataScenario[];
  visual?: boolean;
}

export const QUALITY_ROUTE_BY_NAME = {
  dashboard: { name: 'dashboard', path: '/', scenarios: ['loading', 'empty', 'populated'], visual: true },
  fleet: { name: 'fleet', path: '/vehicles', scenarios: ['empty', 'partial', 'populated'], visual: true },
  drives: { name: 'drives', path: '/drives', scenarios: ['empty', 'stale', 'partial', 'populated'], visual: true },
  charging: { name: 'charging', path: '/charging', scenarios: ['empty', 'stale', 'partial', 'populated'], visual: true },
  battery: { name: 'battery', path: '/battery', scenarios: ['loading', 'error', 'partial', 'populated'], visual: true },
  notifications: { name: 'notifications', path: '/notifications/inbox', scenarios: ['empty', 'populated'], visual: true },
  settings: { name: 'settings', path: '/settings', scenarios: ['error', 'populated'], visual: true },
  dataRepair: { name: 'data-repair', path: '/data-repair', scenarios: ['loading', 'error', 'stale', 'populated'], visual: true },
} as const satisfies Record<string, QualityRoute>;

export const QUALITY_ROUTES: readonly QualityRoute[] = Object.values(QUALITY_ROUTE_BY_NAME);
export const VISUAL_ROUTES = QUALITY_ROUTES.filter((route) => route.visual);

export const FIXTURE_MATRIX: ReadonlyArray<{
  route: QualityRoute;
  scenario: DataScenario;
}> = QUALITY_ROUTES.flatMap((route) =>
  route.scenarios.map((scenario) => ({ route, scenario })),
);
