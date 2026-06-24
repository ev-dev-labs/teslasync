export type RouteId =
  | 'dashboard'
  | 'vehicles'
  | 'charging'
  | 'driving'
  | 'energy'
  | 'alerts'
  | 'system'
  | 'auth'
  | 'settings';

export type RouteGroup = 'command' | 'fleet' | 'operations' | 'platform';
export type RouteImplementationStatus = 'implemented' | 'pending';

export interface RouteParitySummary {
  total: number;
  implemented: number;
  pending: number;
}

export interface RouteDefinition {
  id: RouteId;
  group: RouteGroup;
  label: string;
  shortDescription: string;
  description: string;
  icon: string;
  webPaths: string[];
  parity: RouteParitySummary;
}

export interface WebRouteDefinition {
  id: string;
  sourcePath: string;
  webPath: string;
  group: RouteGroup;
  label: string;
  implementationStatus: RouteImplementationStatus;
  nativeTarget: RouteId;
  evidence: string;
}

interface NativeRouteDefinition {
  id: RouteId;
  group: RouteGroup;
  label: string;
  shortDescription: string;
  description: string;
  icon: string;
}

interface WebRouteInput {
  id: string;
  sourcePath: string;
  group: RouteGroup;
  label: string;
  implementationStatus: RouteImplementationStatus;
  nativeTarget: RouteId;
  evidence?: string;
}

export const EXPECTED_WEB_ROUTE_COUNT = 157;

const pendingRouteEvidence =
  'Pending: web/src/App.tsx declares this route, but N0001 only maps it to a typed native target; no route-specific native screen is implemented yet.';

const redirectRouteEvidence =
  'Pending redirect parity: web/src/App.tsx redirects this route, but native deep-link redirect handling is not implemented in N0001.';

const implementedEvidenceByTarget: Record<RouteId, string> = {
  dashboard:
    'Implemented: DashboardScreen renders the native shell for this command route.',
  vehicles:
    'Implemented: VehiclesScreen renders API-backed native vehicle cards.',
  charging:
    'Implemented: ChargingScreen renders API-backed native charging sessions.',
  driving: 'Implemented: DrivingScreen renders API-backed native drive rows.',
  energy:
    'Implemented: EnergyScreen renders API-backed native vehicle energy data.',
  alerts:
    'Implemented: AlertsScreen renders the native notification inbox surface.',
  system: 'Implemented: SystemScreen renders API-backed native system status.',
  auth: 'Implemented: AuthScreen renders the native identity contract surface.',
  settings:
    'Implemented: SettingsScreen renders native platform and API contract settings.',
};

function normalizeWebPath(sourcePath: string) {
  if (sourcePath === '/' || sourcePath === '*') {
    return sourcePath;
  }

  return `/${sourcePath}`;
}

function webRoute(definition: WebRouteInput): WebRouteDefinition {
  return {
    ...definition,
    webPath: normalizeWebPath(definition.sourcePath),
    evidence:
      definition.evidence ??
      (definition.implementationStatus === 'implemented'
        ? implementedEvidenceByTarget[definition.nativeTarget]
        : pendingRouteEvidence),
  };
}

const nativeRoutes = [
  {
    id: 'dashboard',
    group: 'command',
    label: 'Dashboard',
    shortDescription: 'Fleet command',
    description: 'Live fleet health, alerts, and premium operational overview.',
    icon: 'D',
  },
  {
    id: 'vehicles',
    group: 'fleet',
    label: 'Vehicles',
    shortDescription: 'Garage state',
    description:
      'Native vehicle cards, health state, and route-ready telemetry shells.',
    icon: 'V',
  },
  {
    id: 'charging',
    group: 'fleet',
    label: 'Charging',
    shortDescription: 'Sessions',
    description:
      'Charging sessions, energy added, cost-ready states, and live session shells.',
    icon: 'C',
  },
  {
    id: 'driving',
    group: 'fleet',
    label: 'Driving',
    shortDescription: 'Trips',
    description:
      'Recent drives, distance, energy, speed, scoring, and replay-ready metadata.',
    icon: 'R',
  },
  {
    id: 'energy',
    group: 'operations',
    label: 'Energy',
    shortDescription: 'Battery',
    description:
      'Battery health, energy usage, sleep efficiency, and range intelligence.',
    icon: 'E',
  },
  {
    id: 'alerts',
    group: 'operations',
    label: 'Alerts',
    shortDescription: 'Inbox',
    description:
      'Notification inbox, alert severity, unread state, and escalation surfaces.',
    icon: 'A',
  },
  {
    id: 'system',
    group: 'platform',
    label: 'System',
    shortDescription: 'Ops',
    description:
      'Backend status, service health, version, and operational readiness.',
    icon: 'O',
  },
  {
    id: 'auth',
    group: 'platform',
    label: 'Auth',
    shortDescription: 'Identity',
    description:
      'Forward-auth/open-mode state, subject, capabilities, and account readiness.',
    icon: 'I',
  },
  {
    id: 'settings',
    group: 'platform',
    label: 'Settings',
    shortDescription: 'Platform',
    description:
      'API base, platform support, and React Native parity milestones.',
    icon: 'S',
  },
] as const satisfies readonly NativeRouteDefinition[];

export const webRouteManifest = [
  webRoute({
    id: 'quick-stats',
    sourcePath: 'quick-stats',
    group: 'command',
    label: 'Quick Stats',
    implementationStatus: 'pending',
    nativeTarget: 'dashboard',
  }),
  webRoute({
    id: 'glance',
    sourcePath: 'glance',
    group: 'command',
    label: 'Glance',
    implementationStatus: 'pending',
    nativeTarget: 'dashboard',
  }),
  webRoute({
    id: 'year-review-year',
    sourcePath: 'year-review/:year',
    group: 'command',
    label: 'Year Review',
    implementationStatus: 'pending',
    nativeTarget: 'dashboard',
  }),
  webRoute({
    id: 'shared-drive-token',
    sourcePath: 's/:token',
    group: 'fleet',
    label: 'Shared Drive',
    implementationStatus: 'pending',
    nativeTarget: 'driving',
  }),
  webRoute({
    id: 'watch',
    sourcePath: 'watch',
    group: 'command',
    label: 'Watch Face',
    implementationStatus: 'pending',
    nativeTarget: 'dashboard',
  }),
  webRoute({
    id: 'onboarding',
    sourcePath: 'onboarding',
    group: 'platform',
    label: 'Onboarding',
    implementationStatus: 'pending',
    nativeTarget: 'auth',
  }),
  webRoute({
    id: 'root-layout',
    sourcePath: '/',
    group: 'command',
    label: 'Root Shell',
    implementationStatus: 'implemented',
    nativeTarget: 'dashboard',
  }),
  webRoute({
    id: 'explore',
    sourcePath: 'explore',
    group: 'command',
    label: 'Explore',
    implementationStatus: 'pending',
    nativeTarget: 'dashboard',
  }),
  webRoute({
    id: 'live',
    sourcePath: 'live',
    group: 'fleet',
    label: 'Live Map',
    implementationStatus: 'pending',
    nativeTarget: 'vehicles',
  }),
  webRoute({
    id: 'vehicles',
    sourcePath: 'vehicles',
    group: 'fleet',
    label: 'Vehicles',
    implementationStatus: 'implemented',
    nativeTarget: 'vehicles',
  }),
  webRoute({
    id: 'vehicles-id',
    sourcePath: 'vehicles/:id',
    group: 'fleet',
    label: 'Vehicle Detail',
    implementationStatus: 'pending',
    nativeTarget: 'vehicles',
  }),
  webRoute({
    id: 'vehicles-id-access',
    sourcePath: 'vehicles/:id/access',
    group: 'fleet',
    label: 'Vehicle Access',
    implementationStatus: 'pending',
    nativeTarget: 'vehicles',
  }),
  webRoute({
    id: 'digital-twin',
    sourcePath: 'digital-twin',
    group: 'fleet',
    label: 'Digital Twin',
    implementationStatus: 'pending',
    nativeTarget: 'vehicles',
  }),
  webRoute({
    id: 'energy',
    sourcePath: 'energy',
    group: 'operations',
    label: 'Energy',
    implementationStatus: 'implemented',
    nativeTarget: 'energy',
  }),
  webRoute({
    id: 'battery',
    sourcePath: 'battery',
    group: 'operations',
    label: 'Battery',
    implementationStatus: 'implemented',
    nativeTarget: 'energy',
    evidence:
      'Implemented: EnergyScreen renders API-backed native battery metrics from /vehicles/{vehicleID}/battery.',
  }),
  webRoute({
    id: 'battery-health',
    sourcePath: 'battery/health',
    group: 'operations',
    label: 'Battery Health',
    implementationStatus: 'implemented',
    nativeTarget: 'energy',
    evidence:
      'Implemented: EnergyScreen renders battery health trend, capacity, degradation, and range summaries.',
  }),
  webRoute({
    id: 'drives',
    sourcePath: 'drives',
    group: 'fleet',
    label: 'Drives',
    implementationStatus: 'implemented',
    nativeTarget: 'driving',
  }),
  webRoute({
    id: 'charging',
    sourcePath: 'charging',
    group: 'operations',
    label: 'Charging',
    implementationStatus: 'implemented',
    nativeTarget: 'charging',
  }),
  webRoute({
    id: 'analytics',
    sourcePath: 'analytics',
    group: 'operations',
    label: 'Analytics',
    implementationStatus: 'implemented',
    nativeTarget: 'energy',
    evidence:
      'Implemented: EnergyScreen renders native fleet analytics summaries from /analytics/fleet.',
  }),
  webRoute({
    id: 'commands',
    sourcePath: 'commands',
    group: 'platform',
    label: 'Commands',
    implementationStatus: 'pending',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'command-history',
    sourcePath: 'command-history',
    group: 'platform',
    label: 'Command History',
    implementationStatus: 'pending',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'automations',
    sourcePath: 'automations',
    group: 'operations',
    label: 'Automations',
    implementationStatus: 'pending',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'automations-list',
    sourcePath: 'automations/list',
    group: 'operations',
    label: 'Automations List',
    implementationStatus: 'pending',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'automations-new',
    sourcePath: 'automations/new',
    group: 'operations',
    label: 'New Automation',
    implementationStatus: 'pending',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'automations-id-edit',
    sourcePath: 'automations/:id/edit',
    group: 'operations',
    label: 'Edit Automation',
    implementationStatus: 'pending',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'alerts',
    sourcePath: 'alerts',
    group: 'operations',
    label: 'Legacy Alerts Redirect',
    implementationStatus: 'implemented',
    nativeTarget: 'alerts',
    evidence:
      'Implemented: AlertsScreen renders the legacy /alerts compatibility feed alongside notification inbox data.',
  }),
  webRoute({
    id: 'alert-studio',
    sourcePath: 'alert-studio',
    group: 'operations',
    label: 'Legacy Alert Studio Redirect',
    implementationStatus: 'pending',
    nativeTarget: 'alerts',
  }),
  webRoute({
    id: 'alert-rules',
    sourcePath: 'alert-rules',
    group: 'operations',
    label: 'Legacy Alert Rules Redirect',
    implementationStatus: 'implemented',
    nativeTarget: 'alerts',
    evidence:
      'Implemented: AlertsScreen renders read-only alert rule inventory from /alerts/rules.',
  }),
  webRoute({
    id: 'notifications',
    sourcePath: 'notifications',
    group: 'operations',
    label: 'Notifications',
    implementationStatus: 'implemented',
    nativeTarget: 'alerts',
    evidence:
      'Implemented: AlertsScreen renders notification stats, inbox, rules, channels, quiet hours, and native push availability.',
  }),
  webRoute({
    id: 'notifications-inbox',
    sourcePath: 'notifications/inbox',
    group: 'operations',
    label: 'Notifications Inbox',
    implementationStatus: 'implemented',
    nativeTarget: 'alerts',
  }),
  webRoute({
    id: 'notifications-archived',
    sourcePath: 'notifications/archived',
    group: 'operations',
    label: 'Archived Notifications',
    implementationStatus: 'pending',
    nativeTarget: 'alerts',
  }),
  webRoute({
    id: 'notifications-alerts',
    sourcePath: 'notifications/alerts',
    group: 'operations',
    label: 'Notification Alerts',
    implementationStatus: 'implemented',
    nativeTarget: 'alerts',
    evidence:
      'Implemented: AlertsScreen renders active alert severity and read state from /alerts.',
  }),
  webRoute({
    id: 'notifications-channels',
    sourcePath: 'notifications/channels',
    group: 'operations',
    label: 'Notification Channels',
    implementationStatus: 'implemented',
    nativeTarget: 'alerts',
    evidence:
      'Implemented: AlertsScreen renders read-only delivery channel state from /notifications.',
  }),
  webRoute({
    id: 'notifications-webhooks',
    sourcePath: 'notifications/webhooks',
    group: 'operations',
    label: 'Notification Webhooks',
    implementationStatus: 'implemented',
    nativeTarget: 'alerts',
    evidence:
      'Implemented: AlertsScreen renders webhook-capable notification channels without exposing secret config values.',
  }),
  webRoute({
    id: 'notifications-browser',
    sourcePath: 'notifications/browser',
    group: 'operations',
    label: 'Browser Notifications',
    implementationStatus: 'implemented',
    nativeTarget: 'alerts',
    evidence:
      'Implemented: AlertsScreen renders native push registration as unavailable, so browser/push parity is visible without fake success.',
  }),
  webRoute({
    id: 'notifications-quiet-hours',
    sourcePath: 'notifications/quiet-hours',
    group: 'operations',
    label: 'Notification Quiet Hours',
    implementationStatus: 'implemented',
    nativeTarget: 'alerts',
    evidence:
      'Implemented: AlertsScreen renders quiet-hours windows from /notifications/quiet-hours.',
  }),
  webRoute({
    id: 'notifications-rules',
    sourcePath: 'notifications/rules',
    group: 'operations',
    label: 'Notification Rules',
    implementationStatus: 'implemented',
    nativeTarget: 'alerts',
    evidence:
      'Implemented: AlertsScreen renders alert notification rules from /alerts/rules.',
  }),
  webRoute({
    id: 'notifications-studio',
    sourcePath: 'notifications/studio',
    group: 'operations',
    label: 'Notifications Studio',
    implementationStatus: 'pending',
    nativeTarget: 'alerts',
  }),
  webRoute({
    id: 'notifications-audit',
    sourcePath: 'notifications/audit',
    group: 'operations',
    label: 'Notifications Audit',
    implementationStatus: 'pending',
    nativeTarget: 'alerts',
  }),
  webRoute({
    id: 'geofences',
    sourcePath: 'geofences',
    group: 'fleet',
    label: 'Geofences',
    implementationStatus: 'pending',
    nativeTarget: 'vehicles',
  }),
  webRoute({
    id: 'settings',
    sourcePath: 'settings',
    group: 'platform',
    label: 'Settings',
    implementationStatus: 'implemented',
    nativeTarget: 'settings',
  }),
  webRoute({
    id: 'settings-safety',
    sourcePath: 'settings/safety',
    group: 'platform',
    label: 'Safety Settings',
    implementationStatus: 'pending',
    nativeTarget: 'settings',
  }),
  webRoute({
    id: 'account-2fa',
    sourcePath: 'account/2fa',
    group: 'platform',
    label: 'Two-Factor Auth',
    implementationStatus: 'pending',
    nativeTarget: 'auth',
  }),
  webRoute({
    id: 'account-sessions',
    sourcePath: 'account/sessions',
    group: 'platform',
    label: 'Active Sessions',
    implementationStatus: 'pending',
    nativeTarget: 'auth',
  }),
  webRoute({
    id: 'account-privacy',
    sourcePath: 'account/privacy',
    group: 'platform',
    label: 'Privacy',
    implementationStatus: 'pending',
    nativeTarget: 'auth',
  }),
  webRoute({
    id: 'integrations-helix',
    sourcePath: 'integrations/helix',
    group: 'platform',
    label: 'Helix Integration',
    implementationStatus: 'pending',
    nativeTarget: 'settings',
  }),
  webRoute({
    id: 'drives-id',
    sourcePath: 'drives/:id',
    group: 'fleet',
    label: 'Drive Detail',
    implementationStatus: 'pending',
    nativeTarget: 'driving',
  }),
  webRoute({
    id: 'drives-id-replay',
    sourcePath: 'drives/:id/replay',
    group: 'fleet',
    label: 'Trip Replay',
    implementationStatus: 'pending',
    nativeTarget: 'driving',
  }),
  webRoute({
    id: 'charging-id',
    sourcePath: 'charging/:id',
    group: 'operations',
    label: 'Charge Detail',
    implementationStatus: 'pending',
    nativeTarget: 'charging',
  }),
  webRoute({
    id: 'chatbot',
    sourcePath: 'chatbot',
    group: 'command',
    label: 'Chatbot',
    implementationStatus: 'pending',
    nativeTarget: 'dashboard',
  }),
  webRoute({
    id: 'tire-pressure',
    sourcePath: 'tire-pressure',
    group: 'fleet',
    label: 'Tire Pressure',
    implementationStatus: 'pending',
    nativeTarget: 'vehicles',
  }),
  webRoute({
    id: 'software-updates',
    sourcePath: 'software-updates',
    group: 'fleet',
    label: 'Software Updates',
    implementationStatus: 'pending',
    nativeTarget: 'vehicles',
  }),
  webRoute({
    id: 'vehicle-systems-software',
    sourcePath: 'vehicle-systems/software',
    group: 'fleet',
    label: 'Vehicle Software',
    implementationStatus: 'pending',
    nativeTarget: 'vehicles',
  }),
  webRoute({
    id: 'vampire-drain',
    sourcePath: 'vampire-drain',
    group: 'operations',
    label: 'Vampire Drain',
    implementationStatus: 'pending',
    nativeTarget: 'energy',
  }),
  webRoute({
    id: 'charging-vampire-drain',
    sourcePath: 'charging/vampire-drain',
    group: 'operations',
    label: 'Charging Vampire Drain',
    implementationStatus: 'pending',
    nativeTarget: 'energy',
  }),
  webRoute({
    id: 'locations',
    sourcePath: 'locations',
    group: 'fleet',
    label: 'Locations',
    implementationStatus: 'pending',
    nativeTarget: 'vehicles',
  }),
  webRoute({
    id: 'timeline',
    sourcePath: 'timeline',
    group: 'fleet',
    label: 'Timeline',
    implementationStatus: 'pending',
    nativeTarget: 'driving',
  }),
  webRoute({
    id: 'mileage',
    sourcePath: 'mileage',
    group: 'fleet',
    label: 'Mileage',
    implementationStatus: 'pending',
    nativeTarget: 'driving',
  }),
  webRoute({
    id: 'projected-range',
    sourcePath: 'projected-range',
    group: 'operations',
    label: 'Projected Range',
    implementationStatus: 'pending',
    nativeTarget: 'energy',
  }),
  webRoute({
    id: 'analytics-range',
    sourcePath: 'analytics/range',
    group: 'operations',
    label: 'Analytics Range',
    implementationStatus: 'pending',
    nativeTarget: 'energy',
  }),
  webRoute({
    id: 'efficiency',
    sourcePath: 'efficiency',
    group: 'operations',
    label: 'Efficiency',
    implementationStatus: 'implemented',
    nativeTarget: 'energy',
    evidence:
      'Implemented: EnergyScreen renders fleet and vehicle efficiency metrics from energy analytics routes.',
  }),
  webRoute({
    id: 'trips',
    sourcePath: 'trips',
    group: 'fleet',
    label: 'Trips',
    implementationStatus: 'pending',
    nativeTarget: 'driving',
  }),
  webRoute({
    id: 'trips-id',
    sourcePath: 'trips/:id',
    group: 'fleet',
    label: 'Trip Detail',
    implementationStatus: 'pending',
    nativeTarget: 'driving',
  }),
  webRoute({
    id: 'sharing-trips',
    sourcePath: 'sharing/trips',
    group: 'fleet',
    label: 'Sharing Trips',
    implementationStatus: 'pending',
    nativeTarget: 'driving',
  }),
  webRoute({
    id: 'trip-planner',
    sourcePath: 'trip-planner',
    group: 'fleet',
    label: 'Trip Planner',
    implementationStatus: 'pending',
    nativeTarget: 'driving',
  }),
  webRoute({
    id: 'statistics',
    sourcePath: 'statistics',
    group: 'command',
    label: 'Statistics',
    implementationStatus: 'pending',
    nativeTarget: 'dashboard',
  }),
  webRoute({
    id: 'lifetime-stats',
    sourcePath: 'lifetime-stats',
    group: 'command',
    label: 'Lifetime Stats',
    implementationStatus: 'pending',
    nativeTarget: 'dashboard',
  }),
  webRoute({
    id: 'analytics-lifetime',
    sourcePath: 'analytics/lifetime',
    group: 'command',
    label: 'Analytics Lifetime Redirect',
    implementationStatus: 'pending',
    nativeTarget: 'dashboard',
    evidence: redirectRouteEvidence,
  }),
  webRoute({
    id: 'system-status',
    sourcePath: 'system-status',
    group: 'platform',
    label: 'System Status',
    implementationStatus: 'implemented',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'system-status-incidents-id',
    sourcePath: 'system-status/incidents/:id',
    group: 'platform',
    label: 'Incident Timeline',
    implementationStatus: 'pending',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'docs-status-api',
    sourcePath: 'docs/status-api',
    group: 'platform',
    label: 'Status API Docs',
    implementationStatus: 'pending',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'roadmap',
    sourcePath: 'roadmap',
    group: 'platform',
    label: 'Roadmap',
    implementationStatus: 'pending',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'api-keys',
    sourcePath: 'api-keys',
    group: 'platform',
    label: 'API Keys',
    implementationStatus: 'pending',
    nativeTarget: 'auth',
  }),
  webRoute({
    id: 'compare',
    sourcePath: 'compare',
    group: 'command',
    label: 'Compare Redirect',
    implementationStatus: 'pending',
    nativeTarget: 'dashboard',
    evidence: redirectRouteEvidence,
  }),
  webRoute({
    id: 'analytics-compare',
    sourcePath: 'analytics/compare',
    group: 'command',
    label: 'Analytics Compare Redirect',
    implementationStatus: 'pending',
    nativeTarget: 'dashboard',
    evidence: redirectRouteEvidence,
  }),
  webRoute({
    id: 'period-compare',
    sourcePath: 'period-compare',
    group: 'command',
    label: 'Period Compare',
    implementationStatus: 'pending',
    nativeTarget: 'dashboard',
  }),
  webRoute({
    id: 'admin',
    sourcePath: 'admin',
    group: 'platform',
    label: 'Admin Redirect',
    implementationStatus: 'pending',
    nativeTarget: 'system',
    evidence: redirectRouteEvidence,
  }),
  webRoute({
    id: 'admin-feedback',
    sourcePath: 'admin/feedback',
    group: 'platform',
    label: 'Feedback Queue',
    implementationStatus: 'pending',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'admin-telemetry-coverage',
    sourcePath: 'admin/telemetry/coverage',
    group: 'platform',
    label: 'Fleet Telemetry Coverage',
    implementationStatus: 'implemented',
    nativeTarget: 'system',
    evidence:
      'Implemented: SystemScreen renders Fleet Telemetry coverage from /tesla/fleet-telemetry/coverage.',
  }),
  webRoute({
    id: 'admin-dlq',
    sourcePath: 'admin/dlq',
    group: 'platform',
    label: 'DLQ Inspector',
    implementationStatus: 'pending',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'admin-flags',
    sourcePath: 'admin/flags',
    group: 'platform',
    label: 'Feature Flags Admin',
    implementationStatus: 'pending',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'admin-ingest-xray',
    sourcePath: 'admin/ingest-xray',
    group: 'platform',
    label: 'Ingest X-Ray',
    implementationStatus: 'pending',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'admin-live-signals',
    sourcePath: 'admin/live-signals',
    group: 'platform',
    label: 'Live Signal Inspector',
    implementationStatus: 'implemented',
    nativeTarget: 'system',
    evidence:
      'Implemented: SystemScreen renders live signal diagnostics from /signals/{vehicleID}/live.',
  }),
  webRoute({
    id: 'admin-schema-drift',
    sourcePath: 'admin/schema-drift',
    group: 'platform',
    label: 'Schema Drift',
    implementationStatus: 'pending',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'admin-slow-queries',
    sourcePath: 'admin/slow-queries',
    group: 'platform',
    label: 'Slow Queries',
    implementationStatus: 'pending',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'admin-vehicle-cost',
    sourcePath: 'admin/vehicle-cost',
    group: 'platform',
    label: 'Vehicle Cost',
    implementationStatus: 'pending',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'admin-disk-forecast',
    sourcePath: 'admin/disk-forecast',
    group: 'platform',
    label: 'Disk Forecast',
    implementationStatus: 'pending',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'admin-secret-rotation',
    sourcePath: 'admin/secret-rotation',
    group: 'platform',
    label: 'Secret Rotation',
    implementationStatus: 'pending',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'admin-audit-log',
    sourcePath: 'admin/audit-log',
    group: 'platform',
    label: 'Audit Log',
    implementationStatus: 'implemented',
    nativeTarget: 'system',
    evidence:
      'Implemented: SystemScreen renders recent audit rows from /system/audit.',
  }),
  webRoute({
    id: 'admin-gdpr-exports',
    sourcePath: 'admin/gdpr-exports',
    group: 'platform',
    label: 'GDPR Exports',
    implementationStatus: 'pending',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'api-logs',
    sourcePath: 'api-logs',
    group: 'platform',
    label: 'API Logs',
    implementationStatus: 'pending',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'fleet-api',
    sourcePath: 'fleet-api',
    group: 'platform',
    label: 'Fleet API',
    implementationStatus: 'pending',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'tesla-features',
    sourcePath: 'tesla-features',
    group: 'platform',
    label: 'Tesla Feature Flags',
    implementationStatus: 'pending',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'tesla-region',
    sourcePath: 'tesla-region',
    group: 'platform',
    label: 'Tesla Region',
    implementationStatus: 'pending',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'tesla-orders',
    sourcePath: 'tesla-orders',
    group: 'platform',
    label: 'Tesla Orders',
    implementationStatus: 'pending',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'gas-price',
    sourcePath: 'gas-price',
    group: 'platform',
    label: 'Gas Price',
    implementationStatus: 'pending',
    nativeTarget: 'settings',
  }),
  webRoute({
    id: 'dev-tools',
    sourcePath: 'dev-tools',
    group: 'platform',
    label: 'Dev Tools',
    implementationStatus: 'pending',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'api-playground',
    sourcePath: 'api-playground',
    group: 'platform',
    label: 'API Playground',
    implementationStatus: 'pending',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'power-sql',
    sourcePath: 'power/sql',
    group: 'platform',
    label: 'Power SQL',
    implementationStatus: 'pending',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'power-grafana',
    sourcePath: 'power/grafana',
    group: 'platform',
    label: 'Power Grafana',
    implementationStatus: 'pending',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'power-dashboards',
    sourcePath: 'power/dashboards',
    group: 'platform',
    label: 'Power Dashboards',
    implementationStatus: 'pending',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'redis-signals',
    sourcePath: 'redis-signals',
    group: 'platform',
    label: 'Redis Signals',
    implementationStatus: 'pending',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'signals',
    sourcePath: 'signals',
    group: 'platform',
    label: 'Signals Workspace',
    implementationStatus: 'implemented',
    nativeTarget: 'system',
    evidence:
      'Implemented: SystemScreen renders signal catalog and live state diagnostics for the selected vehicle.',
  }),
  webRoute({
    id: 'signal-explorer',
    sourcePath: 'signal-explorer',
    group: 'platform',
    label: 'Signal Explorer',
    implementationStatus: 'implemented',
    nativeTarget: 'system',
    evidence:
      'Implemented: SystemScreen renders available signal catalog categories from /signals/{vehicleID}/available.',
  }),
  webRoute({
    id: 'signal-log',
    sourcePath: 'signal-log',
    group: 'platform',
    label: 'Signal Log',
    implementationStatus: 'pending',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'live-monitor',
    sourcePath: 'live-monitor',
    group: 'platform',
    label: 'Live Monitor',
    implementationStatus: 'implemented',
    nativeTarget: 'system',
    evidence:
      'Implemented: SystemScreen renders live signal source and freshness metadata without WebView embedding.',
  }),
  webRoute({
    id: 'state-debugger',
    sourcePath: 'state-debugger',
    group: 'platform',
    label: 'State Debugger',
    implementationStatus: 'pending',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'signal-diff',
    sourcePath: 'signal-diff',
    group: 'platform',
    label: 'Signal Diff',
    implementationStatus: 'pending',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'signal-gaps',
    sourcePath: 'signal-gaps',
    group: 'platform',
    label: 'Signal Gaps',
    implementationStatus: 'pending',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'db-health',
    sourcePath: 'db-health',
    group: 'platform',
    label: 'DB Health',
    implementationStatus: 'pending',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'mqtt-inspector',
    sourcePath: 'mqtt-inspector',
    group: 'platform',
    label: 'MQTT Inspector',
    implementationStatus: 'pending',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'anomaly-detection',
    sourcePath: 'anomaly-detection',
    group: 'command',
    label: 'Anomaly Detection',
    implementationStatus: 'pending',
    nativeTarget: 'dashboard',
  }),
  webRoute({
    id: 'analytics-anomalies',
    sourcePath: 'analytics/anomalies',
    group: 'command',
    label: 'Analytics Anomalies',
    implementationStatus: 'pending',
    nativeTarget: 'dashboard',
  }),
  webRoute({
    id: 'driving-dynamics',
    sourcePath: 'driving-dynamics',
    group: 'fleet',
    label: 'Driving Dynamics',
    implementationStatus: 'pending',
    nativeTarget: 'driving',
  }),
  webRoute({
    id: 'climate-control',
    sourcePath: 'climate-control',
    group: 'fleet',
    label: 'Climate Control',
    implementationStatus: 'pending',
    nativeTarget: 'vehicles',
  }),
  webRoute({
    id: 'climate',
    sourcePath: 'climate',
    group: 'fleet',
    label: 'Climate',
    implementationStatus: 'pending',
    nativeTarget: 'vehicles',
  }),
  webRoute({
    id: 'security-access',
    sourcePath: 'security-access',
    group: 'fleet',
    label: 'Security Access',
    implementationStatus: 'pending',
    nativeTarget: 'vehicles',
  }),
  webRoute({
    id: 'charging-curve',
    sourcePath: 'charging-curve',
    group: 'operations',
    label: 'Charging Curve',
    implementationStatus: 'pending',
    nativeTarget: 'charging',
  }),
  webRoute({
    id: 'charging-curves',
    sourcePath: 'charging/curves',
    group: 'operations',
    label: 'Charging Curves',
    implementationStatus: 'pending',
    nativeTarget: 'charging',
  }),
  webRoute({
    id: 'cost-analysis',
    sourcePath: 'cost-analysis',
    group: 'operations',
    label: 'Cost Analysis',
    implementationStatus: 'pending',
    nativeTarget: 'charging',
  }),
  webRoute({
    id: 'charging-costs',
    sourcePath: 'charging/costs',
    group: 'operations',
    label: 'Charging Costs',
    implementationStatus: 'pending',
    nativeTarget: 'charging',
  }),
  webRoute({
    id: 'tesla-charging-history',
    sourcePath: 'tesla-charging-history',
    group: 'operations',
    label: 'Tesla Charging History',
    implementationStatus: 'pending',
    nativeTarget: 'charging',
  }),
  webRoute({
    id: 'tesla-charging-sessions',
    sourcePath: 'tesla-charging-sessions',
    group: 'operations',
    label: 'Tesla Charging Sessions',
    implementationStatus: 'pending',
    nativeTarget: 'charging',
  }),
  webRoute({
    id: 'smart-charge',
    sourcePath: 'smart-charge',
    group: 'operations',
    label: 'Smart Charge',
    implementationStatus: 'pending',
    nativeTarget: 'charging',
  }),
  webRoute({
    id: 'charging-schedule',
    sourcePath: 'charging/schedule',
    group: 'operations',
    label: 'Charging Schedule',
    implementationStatus: 'pending',
    nativeTarget: 'charging',
  }),
  webRoute({
    id: 'powershare',
    sourcePath: 'powershare',
    group: 'operations',
    label: 'Powershare',
    implementationStatus: 'pending',
    nativeTarget: 'charging',
  }),
  webRoute({
    id: 'battery-cells',
    sourcePath: 'battery-cells',
    group: 'operations',
    label: 'Battery Cells',
    implementationStatus: 'pending',
    nativeTarget: 'energy',
  }),
  webRoute({
    id: 'drive-score',
    sourcePath: 'drive-score',
    group: 'fleet',
    label: 'Drive Score',
    implementationStatus: 'pending',
    nativeTarget: 'driving',
  }),
  webRoute({
    id: 'weekly-digest',
    sourcePath: 'weekly-digest',
    group: 'command',
    label: 'Weekly Digest',
    implementationStatus: 'pending',
    nativeTarget: 'dashboard',
  }),
  webRoute({
    id: 'maintenance',
    sourcePath: 'maintenance',
    group: 'fleet',
    label: 'Maintenance',
    implementationStatus: 'pending',
    nativeTarget: 'vehicles',
  }),
  webRoute({
    id: 'data-export',
    sourcePath: 'data-export',
    group: 'platform',
    label: 'Data Export',
    implementationStatus: 'pending',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'exports',
    sourcePath: 'exports',
    group: 'platform',
    label: 'Exports',
    implementationStatus: 'pending',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'energy-flow',
    sourcePath: 'energy-flow',
    group: 'operations',
    label: 'Energy Flow',
    implementationStatus: 'pending',
    nativeTarget: 'energy',
  }),
  webRoute({
    id: 'power-flow',
    sourcePath: 'power-flow',
    group: 'operations',
    label: 'Power Flow',
    implementationStatus: 'pending',
    nativeTarget: 'energy',
  }),
  webRoute({
    id: 'energy-products',
    sourcePath: 'energy-products',
    group: 'operations',
    label: 'Energy Products',
    implementationStatus: 'pending',
    nativeTarget: 'energy',
  }),
  webRoute({
    id: 'drivetrain-health',
    sourcePath: 'drivetrain-health',
    group: 'fleet',
    label: 'Drivetrain Health',
    implementationStatus: 'pending',
    nativeTarget: 'vehicles',
  }),
  webRoute({
    id: 'media-player',
    sourcePath: 'media-player',
    group: 'fleet',
    label: 'Media Player',
    implementationStatus: 'pending',
    nativeTarget: 'vehicles',
  }),
  webRoute({
    id: 'safety-settings',
    sourcePath: 'safety-settings',
    group: 'platform',
    label: 'Safety Settings',
    implementationStatus: 'pending',
    nativeTarget: 'settings',
  }),
  webRoute({
    id: 'guard-mode',
    sourcePath: 'guard-mode',
    group: 'fleet',
    label: 'Guard Mode',
    implementationStatus: 'pending',
    nativeTarget: 'vehicles',
  }),
  webRoute({
    id: 'navigation',
    sourcePath: 'navigation',
    group: 'fleet',
    label: 'Navigation',
    implementationStatus: 'pending',
    nativeTarget: 'driving',
  }),
  webRoute({
    id: 'data-repair',
    sourcePath: 'data-repair',
    group: 'platform',
    label: 'Data Repair',
    implementationStatus: 'pending',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'backup',
    sourcePath: 'backup',
    group: 'platform',
    label: 'Backup',
    implementationStatus: 'pending',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'temperature-impact',
    sourcePath: 'temperature-impact',
    group: 'operations',
    label: 'Temperature Impact',
    implementationStatus: 'implemented',
    nativeTarget: 'energy',
    evidence:
      'Implemented: EnergyScreen renders temperature impact buckets from /analytics/temperature-impact.',
  }),
  webRoute({
    id: 'route-efficiency',
    sourcePath: 'route-efficiency',
    group: 'operations',
    label: 'Route Efficiency',
    implementationStatus: 'implemented',
    nativeTarget: 'energy',
    evidence:
      'Implemented: EnergyScreen renders route efficiency rows from /analytics/route-efficiency.',
  }),
  webRoute({
    id: 'regen-efficiency',
    sourcePath: 'regen-efficiency',
    group: 'operations',
    label: 'Regen Efficiency',
    implementationStatus: 'implemented',
    nativeTarget: 'energy',
    evidence:
      'Implemented: EnergyScreen renders regen recovery and ratio metrics from /analytics/regen.',
  }),
  webRoute({
    id: 'battery-degradation',
    sourcePath: 'battery-degradation',
    group: 'operations',
    label: 'Battery Degradation',
    implementationStatus: 'implemented',
    nativeTarget: 'energy',
    evidence:
      'Implemented: EnergyScreen renders predictive battery degradation analytics from /analytics/battery-degradation.',
  }),
  webRoute({
    id: 'tco',
    sourcePath: 'tco',
    group: 'operations',
    label: 'True Cost of Ownership',
    implementationStatus: 'implemented',
    nativeTarget: 'energy',
    evidence:
      'Implemented: EnergyScreen renders TCO savings metrics and monthly savings summary from /analytics/tco.',
  }),
  webRoute({
    id: 'analytics-tco',
    sourcePath: 'analytics/tco',
    group: 'operations',
    label: 'Analytics TCO',
    implementationStatus: 'implemented',
    nativeTarget: 'energy',
    evidence:
      'Implemented: EnergyScreen renders the analytics TCO route via /analytics/tco.',
  }),
  webRoute({
    id: 'vehicle-comparison',
    sourcePath: 'vehicle-comparison',
    group: 'fleet',
    label: 'Vehicle Comparison',
    implementationStatus: 'pending',
    nativeTarget: 'vehicles',
  }),
  webRoute({
    id: 'sleep-efficiency',
    sourcePath: 'sleep-efficiency',
    group: 'operations',
    label: 'Sleep Efficiency',
    implementationStatus: 'implemented',
    nativeTarget: 'energy',
    evidence:
      'Implemented: EnergyScreen renders sleep efficiency metrics from /analytics/sleep.',
  }),
  webRoute({
    id: 'charging-heatmap',
    sourcePath: 'charging-heatmap',
    group: 'operations',
    label: 'Charging Heatmap',
    implementationStatus: 'pending',
    nativeTarget: 'charging',
  }),
  webRoute({
    id: 'speed-profile',
    sourcePath: 'speed-profile',
    group: 'operations',
    label: 'Speed Profile',
    implementationStatus: 'implemented',
    nativeTarget: 'energy',
    evidence:
      'Implemented: EnergyScreen renders speed profile chart summaries from /analytics/speed-profile.',
  }),
  webRoute({
    id: 'tesla-account',
    sourcePath: 'tesla-account',
    group: 'platform',
    label: 'Tesla Account',
    implementationStatus: 'pending',
    nativeTarget: 'auth',
  }),
  webRoute({
    id: 'me-activity',
    sourcePath: 'me/activity',
    group: 'platform',
    label: 'My Activity',
    implementationStatus: 'pending',
    nativeTarget: 'auth',
  }),
  webRoute({
    id: 'search',
    sourcePath: 'search',
    group: 'command',
    label: 'Search',
    implementationStatus: 'pending',
    nativeTarget: 'dashboard',
  }),
  webRoute({
    id: 'not-found-layout',
    sourcePath: '*',
    group: 'platform',
    label: 'Layout Not Found',
    implementationStatus: 'pending',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'not-found-root',
    sourcePath: '*',
    group: 'platform',
    label: 'Root Not Found',
    implementationStatus: 'pending',
    nativeTarget: 'system',
  }),
] as const satisfies readonly WebRouteDefinition[];

function summarizeRoutes(
  routeList: readonly WebRouteDefinition[],
): RouteParitySummary {
  const implemented = routeList.filter(
    route => route.implementationStatus === 'implemented',
  ).length;

  return {
    total: routeList.length,
    implemented,
    pending: routeList.length - implemented,
  };
}

export function getRoutesForNativeTarget(nativeTarget: RouteId) {
  return webRouteManifest.filter(route => route.nativeTarget === nativeTarget);
}

export function getPendingRoutesForNativeTarget(nativeTarget: RouteId) {
  return getRoutesForNativeTarget(nativeTarget).filter(
    route => route.implementationStatus === 'pending',
  );
}

export function getRouteParityForTarget(nativeTarget: RouteId) {
  return summarizeRoutes(getRoutesForNativeTarget(nativeTarget));
}

export function getRouteParitySummary() {
  return summarizeRoutes(webRouteManifest);
}

export const routeParitySummary = getRouteParitySummary();

export const routes: RouteDefinition[] = nativeRoutes.map(route => {
  const targetRoutes = getRoutesForNativeTarget(route.id);

  return {
    ...route,
    webPaths: targetRoutes.map(
      webRouteDefinition => webRouteDefinition.webPath,
    ),
    parity: summarizeRoutes(targetRoutes),
  };
});

export const routeGroupLabels: Record<RouteGroup, string> = {
  command: 'Command',
  fleet: 'Fleet',
  operations: 'Operations',
  platform: 'Platform',
};
