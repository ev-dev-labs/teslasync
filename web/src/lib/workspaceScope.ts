export interface WorkspaceRouteScope {
  range: boolean;
  vehicle: boolean;
}

export type WorkspaceScopedControlKind = keyof WorkspaceRouteScope;

export const WORKSPACE_SCOPED_CONTROL = Symbol('teslasync.workspace-scoped-control');

export type WorkspaceScopedComponent = {
  [WORKSPACE_SCOPED_CONTROL]?: WorkspaceScopedControlKind;
};

const RANGE_ENABLED_PATHS = new Set([
  '/activity',
  '/analytics',
  '/analytics/carbon',
  '/api-logs',
  '/charging',
  '/charging-curve',
  '/charging-heatmap',
  '/charging/costs',
  '/charging/curves',
  '/cold-start',
  '/command-history',
  '/cost-analysis',
  '/drive-score',
  '/drives',
  '/drivetrain-health',
  '/driving-dynamics',
  '/driving-rhythm',
  '/efficiency',
  '/energy',
  '/energy-flow',
  '/locations',
  '/logbook',
  '/media-player',
  '/me/activity',
  '/notifications/alerts',
  '/notifications/archived',
  '/notifications/inbox',
  '/parking',
  '/power-flow',
  '/range-buffer',
  '/regen-efficiency',
  '/route-efficiency',
  '/security-access',
  '/share-card',
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
  '/trips',
  '/utilization',
  '/vehicle-systems/software',
]);

const VEHICLE_DISABLED_PREFIXES = [
  '/account',
  '/admin',
  '/automations',
  '/benchmarks',
  '/docs',
  '/integrations',
  '/me',
  '/notifications',
  '/onboarding',
  '/settings',
] as const;

const VEHICLE_DISABLED_PATHS = new Set([
  '/action-center',
  '/api-keys',
  '/api-logs',
  '/api-playground',
  '/backup',
  '/data-export',
  '/data-repair',
  '/db-health',
  '/dev-tools',
  '/exports',
  '/fleet-api',
  '/fleet-operations',
  '/mqtt-inspector',
  '/period-compare',
  '/power-flow',
  '/redis-signals',
  '/roadmap',
  '/search',
  '/signal-diff',
  '/system-status',
  '/tesla-charging-history',
  '/tesla-charging-sessions',
  '/tesla-account',
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
