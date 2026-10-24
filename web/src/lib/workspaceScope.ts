import type { WorkspaceRangePreset } from './workspacePreferences';

export interface WorkspaceRouteScope {
  range: boolean;
  vehicle: boolean;
}

export type WorkspaceScopedControlKind = keyof WorkspaceRouteScope;
export type WorkspaceQuickRangePreset = WorkspaceRangePreset | '6h' | 'ytd';

export const WORKSPACE_SCOPED_CONTROL = Symbol('teslasync.workspace-scoped-control');

export type WorkspaceScopedComponent = {
  [WORKSPACE_SCOPED_CONTROL]?: WorkspaceScopedControlKind;
};

/**
 * Routes that OWN the global analysis window.
 *
 * Exported so the contract can be drift-tested against the generated route
 * registry: a range-owning path that no longer exists means the shell shows
 * a control for a page that cannot consume it.
 */
export const RANGE_ENABLED_PATHS: ReadonlySet<string> = new Set([
  '/activity',
  '/admin/audit-log',
  '/admin/vehicle-cost',
  '/analytics',
  '/analytics/carbon',
  '/api-logs',
  '/automations/history',
  '/battery-degradation',
  '/cabin-thermal',
  '/charging',
  '/charging-curve',
  '/charging-heatmap',
  '/charging/costs',
  '/charging/curves',
  '/climate',
  '/climate-control',
  '/cold-start',
  '/comfort-consistency',
  '/command-history',
  '/command-reliability',
  '/cost-analysis',
  '/diagnostics/root-cause',
  '/drive-calendar',
  '/drive-score',
  '/drives',
  '/drivetrain-health',
  '/driving-dynamics',
  '/driving-rhythm',
  '/efficiency',
  '/energy',
  '/energy-flow',
  '/explorer',
  '/fsd',
  '/hvac-cycling',
  '/locations',
  '/logbook',
  '/media-player',
  '/me/activity',
  '/notifications/archived',
  '/notifications/inbox',
  '/parking',
  '/tesla-physics/ledger',
  '/power-flow',
  '/preconditioning-effectiveness',
  '/range-buffer',
  '/regen-efficiency',
  '/route-efficiency',
  '/security-access',
  '/science',
  '/share-card',
  '/signal-change-points',
  '/signal-correlation',
  '/signal-deadband',
  '/signal-explorer',
  '/signal-log',
  '/signals',
  '/sleep-efficiency',
  '/software-updates',
  '/speed-profile',
  '/speed-sweetspot',
  '/state-debugger',
  '/statistics',
  '/tesla-charging-history',
  '/tesla-charging-sessions',
  '/timeline',
  '/tire-pressure',
  '/tire-differential-drift',
  '/trips',
  '/utilization',
  '/vehicle-systems/software',
]);

const STANDARD_QUICK_PRESETS = ['24h', '7d', '30d', '90d'] as const;
const CALENDAR_QUICK_PRESETS = ['7d', '30d', '90d', 'ytd'] as const;

export function getWorkspaceQuickRangePresets(pathname: string): readonly WorkspaceQuickRangePreset[] {
  const normalized = normalizePathname(pathname);
  if (normalized === '/tesla-physics/ledger') return ['6h', '24h'];
  return normalized === '/drive-calendar'
    ? CALENDAR_QUICK_PRESETS
    : STANDARD_QUICK_PRESETS;
}

export function isWorkspaceRangePresetAvailable(pathname: string, id: string): boolean {
  const normalized = normalizePathname(pathname);
  if (id === '6h') return normalized === '/tesla-physics/ledger';
  if (normalized === '/drive-calendar') {
    return id !== 'live' && id !== '24h' && id !== 'today' && id !== '1y';
  }
  return id !== '1y' && id !== 'ytd';
}

export const VEHICLE_DISABLED_PREFIXES = [
  '/account',
  '/admin',
  '/automations',
  '/benchmarks',
  '/dev',
  '/docs',
  '/integrations',
  '/me',
  '/notifications',
  '/onboarding',
  '/settings',
] as const;

export const VEHICLE_DISABLED_PATHS: ReadonlySet<string> = new Set([
  '/action-center',
  '/analytics',
  '/api-keys',
  '/api-logs',
  '/api-playground',
  '/backup',
  '/data-export',
  '/data-repair',
  '/db-health',
  '/dev-tools',
  '/energy-orchestrator',
  '/energy-products',
  '/exports',
  '/fleet-api',
  '/fleet-operations',
  '/gas-price',
  '/mqtt-inspector',
  '/power/dashboards',
  '/power/sql',
  '/power-flow',
  '/redis-signals',
  '/roadmap',
  '/search',
  '/signal-diff',
  '/system-status',
  '/tesla-api-usage',
  '/tesla-charging-history',
  '/tesla-charging-sessions',
  '/tesla-account',
  '/tesla-region',
  '/vehicle-comparison',
  '/vehicles',
]);

function normalizePathname(pathname: string): string {
  const path = pathname.split(/[?#]/, 1)[0] || '/';
  const absolute = path.startsWith('/') ? path : `/${path}`;
  return absolute.length > 1 ? absolute.replace(/\/+$/, '') : absolute;
}

function isAtOrBelow(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Decides which global scope controls are meaningful for the active route.
 *
 * Range ownership is intentionally opt-in: every enabled route consumes
 * `useRangeState`, so changing the shell control always changes that page's
 * query. Vehicle ownership is broadly available across vehicle intelligence
 * surfaces and disabled for fleet, account, administration, and workflow
 * routes where a single selected vehicle would be misleading.
 */
export function getWorkspaceRouteScope(pathname: string): WorkspaceRouteScope {
  const normalized = normalizePathname(pathname);
  const vehicleDisabled =
    VEHICLE_DISABLED_PATHS.has(normalized) ||
    VEHICLE_DISABLED_PREFIXES.some((prefix) =>
      isAtOrBelow(normalized, prefix),
    );

  return {
    range: RANGE_ENABLED_PATHS.has(normalized),
    vehicle: !vehicleDisabled,
  };
}
