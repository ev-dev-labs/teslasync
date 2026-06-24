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
export type RouteImplementationStatus =
  | 'implemented'
  | 'native-summary'
  | 'pending';
export type WebRouteImplementationStatus = 'implemented';
export type OldWebDeletionStatus = 'blocked';

export const routeGroups = [
  'command',
  'fleet',
  'operations',
  'platform',
] as const satisfies readonly RouteGroup[];

export interface RouteParitySummary {
  total: number;
  implemented: number;
  pending: number;
}

export interface RouteGroupParitySummary extends RouteParitySummary {
  group: RouteGroup;
  label: string;
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

export interface RouteDeletionReadiness {
  status: OldWebDeletionStatus;
  canDeleteWebRoute: false;
  finalParityGateRequired: true;
  blocker: string;
}

export interface WebRouteDefinition {
  id: string;
  sourcePath: string;
  webPath: string;
  group: RouteGroup;
  label: string;
  webImplementationStatus: WebRouteImplementationStatus;
  nativeImplementationStatus: RouteImplementationStatus;
  implementationStatus: RouteImplementationStatus;
  nativeTarget: RouteId;
  evidence: string;
  deletionReadiness: RouteDeletionReadiness;
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
  implementationStatus?: RouteImplementationStatus;
  nativeImplementationStatus?: RouteImplementationStatus;
  nativeTarget: RouteId;
  evidence?: string;
  deletionBlocker?: string;
}

export const EXPECTED_WEB_ROUTE_COUNT = 157;

const redirectRouteEvidence =
  'Native summary: Native deep-link parsing resolves this redirect route to a typed native target without embedding the web app; destination-specific parity remains gated.';

const implementedEvidenceByTarget: Record<RouteId, string> = {
  dashboard:
    'Implemented: DashboardScreen renders command, dashboard, search, analytics, and widget evidence for this web route family.',
  vehicles:
    'Implemented: VehiclesScreen renders API-backed vehicle garage, detail, live-state, map-coordinate, access, climate, security, and system-summary evidence.',
  charging:
    'Implemented: ChargingScreen renders API-backed charging list, session detail, telemetry curve, cost/schedule, and unavailable native action evidence.',
  driving:
    'Implemented: DrivingScreen renders API-backed drive/trip lists, detail, route replay summaries, navigation, sharing, and trip-planning evidence.',
  energy:
    'Implemented: EnergyScreen renders API-backed energy, battery, analytics, range, TCO, sleep, regen, route-efficiency, and power-flow summary evidence.',
  alerts:
    'Implemented: AlertsScreen renders API-backed inbox, alert rules, channels, audit, quiet-hours, studio-unavailable, and native push-readiness evidence.',
  system:
    'Implemented: SystemScreen renders API-backed status, health, audit, telemetry coverage/errors, live signals, admin tooling, export, repair, and backup evidence.',
  auth:
    'Implemented: AuthScreen renders forward-auth/open-mode, Tesla account, 2FA, sessions, privacy/activity, and unavailable enrollment action evidence.',
  settings:
    'Implemented: SettingsScreen renders platform, preferences, safety, Helix, notification, auth, and API contract evidence.',
};

const implementedRouteIds = new Set<string>([
  'vehicles',
  'vehicles-id',
  'charging',
  'charging-id',
  'drives',
  'drives-id',
  'drives-id-replay',
  'trips',
  'trips-id',
  'energy',
  'battery',
  'battery-health',
  'analytics',
  'efficiency',
  'battery-degradation',
  'tco',
  'analytics-tco',
  'sleep-efficiency',
  'temperature-impact',
  'route-efficiency',
  'regen-efficiency',
  'speed-profile',
  'alerts',
  'notifications',
  'notifications-inbox',
  'notifications-archived',
  'notifications-alerts',
  'notifications-channels',
  'notifications-webhooks',
  'notifications-quiet-hours',
  'notifications-audit',
  'system-status',
  'admin-telemetry-coverage',
  'admin-live-signals',
  'admin-audit-log',
  'signals',
  'signal-explorer',
  'live-monitor',
  'tesla-account',
] as const);

const nativeSummaryRouteIds = new Set<string>([
  'year-review-year',
  'shared-drive-token',
  'root-layout',
  'live',
  'vehicles-id-access',
  'digital-twin',
  'commands',
  'command-history',
  'automations',
  'automations-list',
  'automations-new',
  'automations-id-edit',
  'alert-studio',
  'alert-rules',
  'notifications-browser',
  'notifications-rules',
  'notifications-studio',
  'settings',
  'settings-safety',
  'account-2fa',
  'account-sessions',
  'account-privacy',
  'integrations-helix',
  'charging-curve',
  'charging-curves',
  'charging-vampire-drain',
  'sharing-trips',
  'analytics-lifetime',
  'compare',
  'analytics-compare',
  'admin',
  'admin-dlq',
  'api-logs',
  'dev-tools',
  'power-sql',
  'power-grafana',
  'power-dashboards',
  'signal-log',
  'data-repair',
  'backup',
  'exports',
  'energy-flow',
  'power-flow',
  'energy-products',
  'battery-cells',
  'safety-settings',
  'not-found-layout',
  'not-found-root',
] as const);

function normalizeWebPath(sourcePath: string) {
  if (sourcePath === '/' || sourcePath === '*') {
    return sourcePath;
  }

  return `/${sourcePath}`;
}

function nativeStatusForRoute(
  definition: WebRouteInput,
): RouteImplementationStatus {
  if (definition.nativeImplementationStatus) {
    return definition.nativeImplementationStatus;
  }
  if (definition.implementationStatus) {
    return definition.implementationStatus;
  }
  if (implementedRouteIds.has(definition.id)) {
    return 'implemented';
  }
  if (nativeSummaryRouteIds.has(definition.id)) {
    return 'native-summary';
  }
  return 'pending';
}

function defaultEvidenceForRoute(
  definition: WebRouteInput,
  status: RouteImplementationStatus,
) {
  if (status === 'implemented') {
    return implementedEvidenceByTarget[definition.nativeTarget];
  }
  if (status === 'native-summary') {
    return `Native summary: ${definition.label} is mapped to the ${definition.nativeTarget} native route with visible readiness evidence, but dedicated deletion-ready parity is still pending.`;
  }
  return `Pending: ${definition.label} is tracked from web/src/App.tsx and mapped to the ${definition.nativeTarget} native route, but dedicated React Native parity has not been implemented yet.`;
}

function deletionReadinessForRoute(
  definition: WebRouteInput,
  status: RouteImplementationStatus,
): RouteDeletionReadiness {
  const blocker =
    definition.deletionBlocker ??
    (status === 'implemented'
      ? 'Old-web deletion remains blocked until the final parity gate validates this route across native targets.'
      : `${definition.label} is ${status}; old-web deletion remains blocked until dedicated native parity and the final parity gate are complete.`);

  return {
    status: 'blocked',
    canDeleteWebRoute: false,
    finalParityGateRequired: true,
    blocker,
  };
}

function webRoute(definition: WebRouteInput): WebRouteDefinition {
  const nativeImplementationStatus = nativeStatusForRoute(definition);
  const evidence =
    definition.evidence ??
    defaultEvidenceForRoute(definition, nativeImplementationStatus);

  return {
    ...definition,
    webImplementationStatus: 'implemented',
    nativeImplementationStatus,
    implementationStatus: nativeImplementationStatus,
    webPath: normalizeWebPath(definition.sourcePath),
    evidence,
    deletionReadiness: deletionReadinessForRoute(
      definition,
      nativeImplementationStatus,
    ),
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
    nativeTarget: 'dashboard',
  }),
  webRoute({
    id: 'glance',
    sourcePath: 'glance',
    group: 'command',
    label: 'Glance',
    nativeTarget: 'dashboard',
  }),
  webRoute({
    id: 'year-review-year',
    sourcePath: 'year-review/:year',
    group: 'command',
    label: 'Year Review',
    nativeTarget: 'dashboard',
  }),
  webRoute({
    id: 'shared-drive-token',
    sourcePath: 's/:token',
    group: 'fleet',
    label: 'Shared Drive',
    nativeTarget: 'driving',
  }),
  webRoute({
    id: 'watch',
    sourcePath: 'watch',
    group: 'command',
    label: 'Watch Face',
    nativeTarget: 'dashboard',
  }),
  webRoute({
    id: 'onboarding',
    sourcePath: 'onboarding',
    group: 'platform',
    label: 'Onboarding',
    nativeTarget: 'auth',
  }),
  webRoute({
    id: 'root-layout',
    sourcePath: '/',
    group: 'command',
    label: 'Root Shell',
    nativeTarget: 'dashboard',
  }),
  webRoute({
    id: 'explore',
    sourcePath: 'explore',
    group: 'command',
    label: 'Explore',
    nativeTarget: 'dashboard',
  }),
  webRoute({
    id: 'live',
    sourcePath: 'live',
    group: 'fleet',
    label: 'Live Map',
    nativeTarget: 'vehicles',
  }),
  webRoute({
    id: 'vehicles',
    sourcePath: 'vehicles',
    group: 'fleet',
    label: 'Vehicles',
    nativeTarget: 'vehicles',
  }),
  webRoute({
    id: 'vehicles-id',
    sourcePath: 'vehicles/:id',
    group: 'fleet',
    label: 'Vehicle Detail',
    nativeTarget: 'vehicles',
  }),
  webRoute({
    id: 'vehicles-id-access',
    sourcePath: 'vehicles/:id/access',
    group: 'fleet',
    label: 'Vehicle Access',
    nativeTarget: 'vehicles',
  }),
  webRoute({
    id: 'digital-twin',
    sourcePath: 'digital-twin',
    group: 'fleet',
    label: 'Digital Twin',
    nativeTarget: 'vehicles',
  }),
  webRoute({
    id: 'energy',
    sourcePath: 'energy',
    group: 'operations',
    label: 'Energy',
    nativeTarget: 'energy',
  }),
  webRoute({
    id: 'battery',
    sourcePath: 'battery',
    group: 'operations',
    label: 'Battery',
    nativeTarget: 'energy',
    evidence:
      'Implemented: EnergyScreen renders API-backed native battery metrics from /vehicles/{vehicleID}/battery.',
  }),
  webRoute({
    id: 'battery-health',
    sourcePath: 'battery/health',
    group: 'operations',
    label: 'Battery Health',
    nativeTarget: 'energy',
    evidence:
      'Implemented: EnergyScreen renders battery health trend, capacity, degradation, and range summaries.',
  }),
  webRoute({
    id: 'drives',
    sourcePath: 'drives',
    group: 'fleet',
    label: 'Drives',
    nativeTarget: 'driving',
  }),
  webRoute({
    id: 'charging',
    sourcePath: 'charging',
    group: 'operations',
    label: 'Charging',
    nativeTarget: 'charging',
  }),
  webRoute({
    id: 'analytics',
    sourcePath: 'analytics',
    group: 'operations',
    label: 'Analytics',
    nativeTarget: 'energy',
    evidence:
      'Implemented: EnergyScreen renders native fleet analytics summaries from /analytics/fleet.',
  }),
  webRoute({
    id: 'commands',
    sourcePath: 'commands',
    group: 'platform',
    label: 'Commands',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'command-history',
    sourcePath: 'command-history',
    group: 'platform',
    label: 'Command History',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'automations',
    sourcePath: 'automations',
    group: 'operations',
    label: 'Automations',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'automations-list',
    sourcePath: 'automations/list',
    group: 'operations',
    label: 'Automations List',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'automations-new',
    sourcePath: 'automations/new',
    group: 'operations',
    label: 'New Automation',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'automations-id-edit',
    sourcePath: 'automations/:id/edit',
    group: 'operations',
    label: 'Edit Automation',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'alerts',
    sourcePath: 'alerts',
    group: 'operations',
    label: 'Legacy Alerts Redirect',
    nativeTarget: 'alerts',
    evidence:
      'Implemented: AlertsScreen renders the legacy /alerts compatibility feed alongside notification inbox data.',
  }),
  webRoute({
    id: 'alert-studio',
    sourcePath: 'alert-studio',
    group: 'operations',
    label: 'Legacy Alert Studio Redirect',
    nativeTarget: 'alerts',
    evidence:
      'Native summary: AlertsScreen renders notification-studio write actions as unavailable instead of claiming unsupported rule editing.',
  }),
  webRoute({
    id: 'alert-rules',
    sourcePath: 'alert-rules',
    group: 'operations',
    label: 'Legacy Alert Rules Redirect',
    nativeTarget: 'alerts',
    evidence:
      'Native summary: AlertsScreen renders read-only alert rule inventory from /alerts/rules while edits, snooze, and test sends remain unavailable.',
  }),
  webRoute({
    id: 'notifications',
    sourcePath: 'notifications',
    group: 'operations',
    label: 'Notifications',
    nativeTarget: 'alerts',
    evidence:
      'Implemented: AlertsScreen renders notification stats, inbox, rules, channels, quiet hours, and native push availability.',
  }),
  webRoute({
    id: 'notifications-inbox',
    sourcePath: 'notifications/inbox',
    group: 'operations',
    label: 'Notifications Inbox',
    nativeTarget: 'alerts',
  }),
  webRoute({
    id: 'notifications-archived',
    sourcePath: 'notifications/archived',
    group: 'operations',
    label: 'Archived Notifications',
    nativeTarget: 'alerts',
    evidence:
      'Implemented: AlertsScreen renders archived notification rows from /notifications/logs?archived=true.',
  }),
  webRoute({
    id: 'notifications-alerts',
    sourcePath: 'notifications/alerts',
    group: 'operations',
    label: 'Notification Alerts',
    nativeTarget: 'alerts',
    evidence:
      'Implemented: AlertsScreen renders active alert severity and read state from /alerts.',
  }),
  webRoute({
    id: 'notifications-channels',
    sourcePath: 'notifications/channels',
    group: 'operations',
    label: 'Notification Channels',
    nativeTarget: 'alerts',
    evidence:
      'Implemented: AlertsScreen renders read-only delivery channel state from /notifications.',
  }),
  webRoute({
    id: 'notifications-webhooks',
    sourcePath: 'notifications/webhooks',
    group: 'operations',
    label: 'Notification Webhooks',
    nativeTarget: 'alerts',
    evidence:
      'Implemented: AlertsScreen renders webhook-capable notification channels without exposing secret config values.',
  }),
  webRoute({
    id: 'notifications-browser',
    sourcePath: 'notifications/browser',
    group: 'operations',
    label: 'Browser Notifications',
    nativeTarget: 'alerts',
    evidence:
      'Native summary: AlertsScreen renders native push registration as unavailable, so browser/push parity is visible without fake success.',
  }),
  webRoute({
    id: 'notifications-quiet-hours',
    sourcePath: 'notifications/quiet-hours',
    group: 'operations',
    label: 'Notification Quiet Hours',
    nativeTarget: 'alerts',
    evidence:
      'Implemented: AlertsScreen renders quiet-hours windows from /notifications/quiet-hours.',
  }),
  webRoute({
    id: 'notifications-rules',
    sourcePath: 'notifications/rules',
    group: 'operations',
    label: 'Notification Rules',
    nativeTarget: 'alerts',
    evidence:
      'Native summary: AlertsScreen renders alert notification rules from /alerts/rules while write actions remain blocked.',
  }),
  webRoute({
    id: 'notifications-studio',
    sourcePath: 'notifications/studio',
    group: 'operations',
    label: 'Notifications Studio',
    nativeTarget: 'alerts',
    evidence:
      'Native summary: AlertsScreen renders native notification studio actions as unavailable until validation and confirmation gates exist.',
  }),
  webRoute({
    id: 'notifications-audit',
    sourcePath: 'notifications/audit',
    group: 'operations',
    label: 'Notifications Audit',
    nativeTarget: 'alerts',
    evidence:
      'Implemented: AlertsScreen renders notification delivery rows as an audit-style trail with status and error context.',
  }),
  webRoute({
    id: 'geofences',
    sourcePath: 'geofences',
    group: 'fleet',
    label: 'Geofences',
    nativeTarget: 'vehicles',
  }),
  webRoute({
    id: 'settings',
    sourcePath: 'settings',
    group: 'platform',
    label: 'Settings',
    nativeTarget: 'settings',
  }),
  webRoute({
    id: 'settings-safety',
    sourcePath: 'settings/safety',
    group: 'platform',
    label: 'Safety Settings',
    nativeTarget: 'settings',
  }),
  webRoute({
    id: 'account-2fa',
    sourcePath: 'account/2fa',
    group: 'platform',
    label: 'Two-Factor Auth',
    nativeTarget: 'auth',
  }),
  webRoute({
    id: 'account-sessions',
    sourcePath: 'account/sessions',
    group: 'platform',
    label: 'Active Sessions',
    nativeTarget: 'auth',
  }),
  webRoute({
    id: 'account-privacy',
    sourcePath: 'account/privacy',
    group: 'platform',
    label: 'Privacy',
    nativeTarget: 'auth',
  }),
  webRoute({
    id: 'integrations-helix',
    sourcePath: 'integrations/helix',
    group: 'platform',
    label: 'Helix Integration',
    nativeTarget: 'settings',
  }),
  webRoute({
    id: 'drives-id',
    sourcePath: 'drives/:id',
    group: 'fleet',
    label: 'Drive Detail',
    nativeTarget: 'driving',
  }),
  webRoute({
    id: 'drives-id-replay',
    sourcePath: 'drives/:id/replay',
    group: 'fleet',
    label: 'Trip Replay',
    nativeTarget: 'driving',
  }),
  webRoute({
    id: 'charging-id',
    sourcePath: 'charging/:id',
    group: 'operations',
    label: 'Charge Detail',
    nativeTarget: 'charging',
  }),
  webRoute({
    id: 'chatbot',
    sourcePath: 'chatbot',
    group: 'command',
    label: 'Chatbot',
    nativeTarget: 'dashboard',
  }),
  webRoute({
    id: 'tire-pressure',
    sourcePath: 'tire-pressure',
    group: 'fleet',
    label: 'Tire Pressure',
    nativeTarget: 'vehicles',
  }),
  webRoute({
    id: 'software-updates',
    sourcePath: 'software-updates',
    group: 'fleet',
    label: 'Software Updates',
    nativeTarget: 'vehicles',
  }),
  webRoute({
    id: 'vehicle-systems-software',
    sourcePath: 'vehicle-systems/software',
    group: 'fleet',
    label: 'Vehicle Software',
    nativeTarget: 'vehicles',
  }),
  webRoute({
    id: 'vampire-drain',
    sourcePath: 'vampire-drain',
    group: 'operations',
    label: 'Vampire Drain',
    nativeTarget: 'energy',
  }),
  webRoute({
    id: 'charging-vampire-drain',
    sourcePath: 'charging/vampire-drain',
    group: 'operations',
    label: 'Charging Vampire Drain',
    nativeTarget: 'energy',
  }),
  webRoute({
    id: 'locations',
    sourcePath: 'locations',
    group: 'fleet',
    label: 'Locations',
    nativeTarget: 'vehicles',
  }),
  webRoute({
    id: 'timeline',
    sourcePath: 'timeline',
    group: 'fleet',
    label: 'Timeline',
    nativeTarget: 'driving',
  }),
  webRoute({
    id: 'mileage',
    sourcePath: 'mileage',
    group: 'fleet',
    label: 'Mileage',
    nativeTarget: 'driving',
  }),
  webRoute({
    id: 'projected-range',
    sourcePath: 'projected-range',
    group: 'operations',
    label: 'Projected Range',
    nativeTarget: 'energy',
  }),
  webRoute({
    id: 'analytics-range',
    sourcePath: 'analytics/range',
    group: 'operations',
    label: 'Analytics Range',
    nativeTarget: 'energy',
  }),
  webRoute({
    id: 'efficiency',
    sourcePath: 'efficiency',
    group: 'operations',
    label: 'Efficiency',
    nativeTarget: 'energy',
    evidence:
      'Implemented: EnergyScreen renders fleet and vehicle efficiency metrics from energy analytics routes.',
  }),
  webRoute({
    id: 'trips',
    sourcePath: 'trips',
    group: 'fleet',
    label: 'Trips',
    nativeTarget: 'driving',
  }),
  webRoute({
    id: 'trips-id',
    sourcePath: 'trips/:id',
    group: 'fleet',
    label: 'Trip Detail',
    nativeTarget: 'driving',
  }),
  webRoute({
    id: 'sharing-trips',
    sourcePath: 'sharing/trips',
    group: 'fleet',
    label: 'Sharing Trips',
    nativeTarget: 'driving',
  }),
  webRoute({
    id: 'trip-planner',
    sourcePath: 'trip-planner',
    group: 'fleet',
    label: 'Trip Planner',
    nativeTarget: 'driving',
  }),
  webRoute({
    id: 'statistics',
    sourcePath: 'statistics',
    group: 'command',
    label: 'Statistics',
    nativeTarget: 'dashboard',
  }),
  webRoute({
    id: 'lifetime-stats',
    sourcePath: 'lifetime-stats',
    group: 'command',
    label: 'Lifetime Stats',
    nativeTarget: 'dashboard',
  }),
  webRoute({
    id: 'analytics-lifetime',
    sourcePath: 'analytics/lifetime',
    group: 'command',
    label: 'Analytics Lifetime Redirect',
    nativeTarget: 'dashboard',
    evidence: redirectRouteEvidence,
  }),
  webRoute({
    id: 'system-status',
    sourcePath: 'system-status',
    group: 'platform',
    label: 'System Status',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'system-status-incidents-id',
    sourcePath: 'system-status/incidents/:id',
    group: 'platform',
    label: 'Incident Timeline',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'docs-status-api',
    sourcePath: 'docs/status-api',
    group: 'platform',
    label: 'Status API Docs',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'roadmap',
    sourcePath: 'roadmap',
    group: 'platform',
    label: 'Roadmap',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'api-keys',
    sourcePath: 'api-keys',
    group: 'platform',
    label: 'API Keys',
    nativeTarget: 'auth',
  }),
  webRoute({
    id: 'compare',
    sourcePath: 'compare',
    group: 'command',
    label: 'Compare Redirect',
    nativeTarget: 'dashboard',
    evidence: redirectRouteEvidence,
  }),
  webRoute({
    id: 'analytics-compare',
    sourcePath: 'analytics/compare',
    group: 'command',
    label: 'Analytics Compare Redirect',
    nativeTarget: 'dashboard',
    evidence: redirectRouteEvidence,
  }),
  webRoute({
    id: 'period-compare',
    sourcePath: 'period-compare',
    group: 'command',
    label: 'Period Compare',
    nativeTarget: 'dashboard',
  }),
  webRoute({
    id: 'admin',
    sourcePath: 'admin',
    group: 'platform',
    label: 'Admin Redirect',
    nativeTarget: 'system',
    evidence: redirectRouteEvidence,
  }),
  webRoute({
    id: 'admin-feedback',
    sourcePath: 'admin/feedback',
    group: 'platform',
    label: 'Feedback Queue',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'admin-telemetry-coverage',
    sourcePath: 'admin/telemetry/coverage',
    group: 'platform',
    label: 'Fleet Telemetry Coverage',
    nativeTarget: 'system',
    evidence:
      'Implemented: SystemScreen renders Fleet Telemetry coverage from /tesla/fleet-telemetry/coverage.',
  }),
  webRoute({
    id: 'admin-dlq',
    sourcePath: 'admin/dlq',
    group: 'platform',
    label: 'DLQ Inspector',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'admin-flags',
    sourcePath: 'admin/flags',
    group: 'platform',
    label: 'Feature Flags Admin',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'admin-ingest-xray',
    sourcePath: 'admin/ingest-xray',
    group: 'platform',
    label: 'Ingest X-Ray',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'admin-live-signals',
    sourcePath: 'admin/live-signals',
    group: 'platform',
    label: 'Live Signal Inspector',
    nativeTarget: 'system',
    evidence:
      'Implemented: SystemScreen renders live signal diagnostics from /signals/{vehicleID}/live.',
  }),
  webRoute({
    id: 'admin-schema-drift',
    sourcePath: 'admin/schema-drift',
    group: 'platform',
    label: 'Schema Drift',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'admin-slow-queries',
    sourcePath: 'admin/slow-queries',
    group: 'platform',
    label: 'Slow Queries',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'admin-vehicle-cost',
    sourcePath: 'admin/vehicle-cost',
    group: 'platform',
    label: 'Vehicle Cost',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'admin-disk-forecast',
    sourcePath: 'admin/disk-forecast',
    group: 'platform',
    label: 'Disk Forecast',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'admin-secret-rotation',
    sourcePath: 'admin/secret-rotation',
    group: 'platform',
    label: 'Secret Rotation',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'admin-audit-log',
    sourcePath: 'admin/audit-log',
    group: 'platform',
    label: 'Audit Log',
    nativeTarget: 'system',
    evidence:
      'Implemented: SystemScreen renders recent audit rows from /system/audit.',
  }),
  webRoute({
    id: 'admin-gdpr-exports',
    sourcePath: 'admin/gdpr-exports',
    group: 'platform',
    label: 'GDPR Exports',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'api-logs',
    sourcePath: 'api-logs',
    group: 'platform',
    label: 'API Logs',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'fleet-api',
    sourcePath: 'fleet-api',
    group: 'platform',
    label: 'Fleet API',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'tesla-features',
    sourcePath: 'tesla-features',
    group: 'platform',
    label: 'Tesla Feature Flags',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'tesla-region',
    sourcePath: 'tesla-region',
    group: 'platform',
    label: 'Tesla Region',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'tesla-orders',
    sourcePath: 'tesla-orders',
    group: 'platform',
    label: 'Tesla Orders',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'gas-price',
    sourcePath: 'gas-price',
    group: 'platform',
    label: 'Gas Price',
    nativeTarget: 'settings',
  }),
  webRoute({
    id: 'dev-tools',
    sourcePath: 'dev-tools',
    group: 'platform',
    label: 'Dev Tools',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'api-playground',
    sourcePath: 'api-playground',
    group: 'platform',
    label: 'API Playground',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'power-sql',
    sourcePath: 'power/sql',
    group: 'platform',
    label: 'Power SQL',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'power-grafana',
    sourcePath: 'power/grafana',
    group: 'platform',
    label: 'Power Grafana',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'power-dashboards',
    sourcePath: 'power/dashboards',
    group: 'platform',
    label: 'Power Dashboards',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'redis-signals',
    sourcePath: 'redis-signals',
    group: 'platform',
    label: 'Redis Signals',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'signals',
    sourcePath: 'signals',
    group: 'platform',
    label: 'Signals Workspace',
    nativeTarget: 'system',
    evidence:
      'Implemented: SystemScreen renders signal catalog and live state diagnostics for the selected vehicle.',
  }),
  webRoute({
    id: 'signal-explorer',
    sourcePath: 'signal-explorer',
    group: 'platform',
    label: 'Signal Explorer',
    nativeTarget: 'system',
    evidence:
      'Implemented: SystemScreen renders available signal catalog categories from /signals/{vehicleID}/available.',
  }),
  webRoute({
    id: 'signal-log',
    sourcePath: 'signal-log',
    group: 'platform',
    label: 'Signal Log',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'live-monitor',
    sourcePath: 'live-monitor',
    group: 'platform',
    label: 'Live Monitor',
    nativeTarget: 'system',
    evidence:
      'Implemented: SystemScreen renders live signal source and freshness metadata without WebView embedding.',
  }),
  webRoute({
    id: 'state-debugger',
    sourcePath: 'state-debugger',
    group: 'platform',
    label: 'State Debugger',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'signal-diff',
    sourcePath: 'signal-diff',
    group: 'platform',
    label: 'Signal Diff',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'signal-gaps',
    sourcePath: 'signal-gaps',
    group: 'platform',
    label: 'Signal Gaps',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'db-health',
    sourcePath: 'db-health',
    group: 'platform',
    label: 'DB Health',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'mqtt-inspector',
    sourcePath: 'mqtt-inspector',
    group: 'platform',
    label: 'MQTT Inspector',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'anomaly-detection',
    sourcePath: 'anomaly-detection',
    group: 'command',
    label: 'Anomaly Detection',
    nativeTarget: 'dashboard',
  }),
  webRoute({
    id: 'analytics-anomalies',
    sourcePath: 'analytics/anomalies',
    group: 'command',
    label: 'Analytics Anomalies',
    nativeTarget: 'dashboard',
  }),
  webRoute({
    id: 'driving-dynamics',
    sourcePath: 'driving-dynamics',
    group: 'fleet',
    label: 'Driving Dynamics',
    nativeTarget: 'driving',
  }),
  webRoute({
    id: 'climate-control',
    sourcePath: 'climate-control',
    group: 'fleet',
    label: 'Climate Control',
    nativeTarget: 'vehicles',
  }),
  webRoute({
    id: 'climate',
    sourcePath: 'climate',
    group: 'fleet',
    label: 'Climate',
    nativeTarget: 'vehicles',
  }),
  webRoute({
    id: 'security-access',
    sourcePath: 'security-access',
    group: 'fleet',
    label: 'Security Access',
    nativeTarget: 'vehicles',
  }),
  webRoute({
    id: 'charging-curve',
    sourcePath: 'charging-curve',
    group: 'operations',
    label: 'Charging Curve',
    nativeTarget: 'charging',
  }),
  webRoute({
    id: 'charging-curves',
    sourcePath: 'charging/curves',
    group: 'operations',
    label: 'Charging Curves',
    nativeTarget: 'charging',
  }),
  webRoute({
    id: 'cost-analysis',
    sourcePath: 'cost-analysis',
    group: 'operations',
    label: 'Cost Analysis',
    nativeTarget: 'charging',
  }),
  webRoute({
    id: 'charging-costs',
    sourcePath: 'charging/costs',
    group: 'operations',
    label: 'Charging Costs',
    nativeTarget: 'charging',
  }),
  webRoute({
    id: 'tesla-charging-history',
    sourcePath: 'tesla-charging-history',
    group: 'operations',
    label: 'Tesla Charging History',
    nativeTarget: 'charging',
  }),
  webRoute({
    id: 'tesla-charging-sessions',
    sourcePath: 'tesla-charging-sessions',
    group: 'operations',
    label: 'Tesla Charging Sessions',
    nativeTarget: 'charging',
  }),
  webRoute({
    id: 'smart-charge',
    sourcePath: 'smart-charge',
    group: 'operations',
    label: 'Smart Charge',
    nativeTarget: 'charging',
  }),
  webRoute({
    id: 'charging-schedule',
    sourcePath: 'charging/schedule',
    group: 'operations',
    label: 'Charging Schedule',
    nativeTarget: 'charging',
  }),
  webRoute({
    id: 'powershare',
    sourcePath: 'powershare',
    group: 'operations',
    label: 'Powershare',
    nativeTarget: 'charging',
  }),
  webRoute({
    id: 'battery-cells',
    sourcePath: 'battery-cells',
    group: 'operations',
    label: 'Battery Cells',
    nativeTarget: 'energy',
  }),
  webRoute({
    id: 'drive-score',
    sourcePath: 'drive-score',
    group: 'fleet',
    label: 'Drive Score',
    nativeTarget: 'driving',
  }),
  webRoute({
    id: 'weekly-digest',
    sourcePath: 'weekly-digest',
    group: 'command',
    label: 'Weekly Digest',
    nativeTarget: 'dashboard',
  }),
  webRoute({
    id: 'maintenance',
    sourcePath: 'maintenance',
    group: 'fleet',
    label: 'Maintenance',
    nativeTarget: 'vehicles',
  }),
  webRoute({
    id: 'data-export',
    sourcePath: 'data-export',
    group: 'platform',
    label: 'Data Export',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'exports',
    sourcePath: 'exports',
    group: 'platform',
    label: 'Exports',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'energy-flow',
    sourcePath: 'energy-flow',
    group: 'operations',
    label: 'Energy Flow',
    nativeTarget: 'energy',
  }),
  webRoute({
    id: 'power-flow',
    sourcePath: 'power-flow',
    group: 'operations',
    label: 'Power Flow',
    nativeTarget: 'energy',
  }),
  webRoute({
    id: 'energy-products',
    sourcePath: 'energy-products',
    group: 'operations',
    label: 'Energy Products',
    nativeTarget: 'energy',
  }),
  webRoute({
    id: 'drivetrain-health',
    sourcePath: 'drivetrain-health',
    group: 'fleet',
    label: 'Drivetrain Health',
    nativeTarget: 'vehicles',
  }),
  webRoute({
    id: 'media-player',
    sourcePath: 'media-player',
    group: 'fleet',
    label: 'Media Player',
    nativeTarget: 'vehicles',
  }),
  webRoute({
    id: 'safety-settings',
    sourcePath: 'safety-settings',
    group: 'platform',
    label: 'Safety Settings',
    nativeTarget: 'settings',
  }),
  webRoute({
    id: 'guard-mode',
    sourcePath: 'guard-mode',
    group: 'fleet',
    label: 'Guard Mode',
    nativeTarget: 'vehicles',
  }),
  webRoute({
    id: 'navigation',
    sourcePath: 'navigation',
    group: 'fleet',
    label: 'Navigation',
    nativeTarget: 'driving',
  }),
  webRoute({
    id: 'data-repair',
    sourcePath: 'data-repair',
    group: 'platform',
    label: 'Data Repair',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'backup',
    sourcePath: 'backup',
    group: 'platform',
    label: 'Backup',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'temperature-impact',
    sourcePath: 'temperature-impact',
    group: 'operations',
    label: 'Temperature Impact',
    nativeTarget: 'energy',
    evidence:
      'Implemented: EnergyScreen renders temperature impact buckets from /analytics/temperature-impact.',
  }),
  webRoute({
    id: 'route-efficiency',
    sourcePath: 'route-efficiency',
    group: 'operations',
    label: 'Route Efficiency',
    nativeTarget: 'energy',
    evidence:
      'Implemented: EnergyScreen renders route efficiency rows from /analytics/route-efficiency.',
  }),
  webRoute({
    id: 'regen-efficiency',
    sourcePath: 'regen-efficiency',
    group: 'operations',
    label: 'Regen Efficiency',
    nativeTarget: 'energy',
    evidence:
      'Implemented: EnergyScreen renders regen recovery and ratio metrics from /analytics/regen.',
  }),
  webRoute({
    id: 'battery-degradation',
    sourcePath: 'battery-degradation',
    group: 'operations',
    label: 'Battery Degradation',
    nativeTarget: 'energy',
    evidence:
      'Implemented: EnergyScreen renders predictive battery degradation analytics from /analytics/battery-degradation.',
  }),
  webRoute({
    id: 'tco',
    sourcePath: 'tco',
    group: 'operations',
    label: 'True Cost of Ownership',
    nativeTarget: 'energy',
    evidence:
      'Implemented: EnergyScreen renders TCO savings metrics and monthly savings summary from /analytics/tco.',
  }),
  webRoute({
    id: 'analytics-tco',
    sourcePath: 'analytics/tco',
    group: 'operations',
    label: 'Analytics TCO',
    nativeTarget: 'energy',
    evidence:
      'Implemented: EnergyScreen renders the analytics TCO route via /analytics/tco.',
  }),
  webRoute({
    id: 'vehicle-comparison',
    sourcePath: 'vehicle-comparison',
    group: 'fleet',
    label: 'Vehicle Comparison',
    nativeTarget: 'vehicles',
  }),
  webRoute({
    id: 'sleep-efficiency',
    sourcePath: 'sleep-efficiency',
    group: 'operations',
    label: 'Sleep Efficiency',
    nativeTarget: 'energy',
    evidence:
      'Implemented: EnergyScreen renders sleep efficiency metrics from /analytics/sleep.',
  }),
  webRoute({
    id: 'charging-heatmap',
    sourcePath: 'charging-heatmap',
    group: 'operations',
    label: 'Charging Heatmap',
    nativeTarget: 'charging',
  }),
  webRoute({
    id: 'speed-profile',
    sourcePath: 'speed-profile',
    group: 'operations',
    label: 'Speed Profile',
    nativeTarget: 'energy',
    evidence:
      'Implemented: EnergyScreen renders speed profile chart summaries from /analytics/speed-profile.',
  }),
  webRoute({
    id: 'tesla-account',
    sourcePath: 'tesla-account',
    group: 'platform',
    label: 'Tesla Account',
    nativeTarget: 'auth',
  }),
  webRoute({
    id: 'me-activity',
    sourcePath: 'me/activity',
    group: 'platform',
    label: 'My Activity',
    nativeTarget: 'auth',
  }),
  webRoute({
    id: 'search',
    sourcePath: 'search',
    group: 'command',
    label: 'Search',
    nativeTarget: 'dashboard',
  }),
  webRoute({
    id: 'not-found-layout',
    sourcePath: '*',
    group: 'platform',
    label: 'Layout Not Found',
    nativeTarget: 'system',
  }),
  webRoute({
    id: 'not-found-root',
    sourcePath: '*',
    group: 'platform',
    label: 'Root Not Found',
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

export function getRouteParityForTarget(nativeTarget: RouteId) {
  return summarizeRoutes(getRoutesForNativeTarget(nativeTarget));
}

export function getRouteParityForGroup(group: RouteGroup) {
  return summarizeRoutes(
    webRouteManifest.filter(route => route.group === group),
  );
}

export function getRouteParitySummary() {
  return summarizeRoutes(webRouteManifest);
}

export const routeParitySummary = getRouteParitySummary();

export const oldWebDeletionReadiness = {
  status: 'blocked',
  canDeleteOldWeb: false,
  finalParityGateRequired: true,
  totalRoutes: routeParitySummary.total,
  implementedRoutes: routeParitySummary.implemented,
  unresolvedRoutes: routeParitySummary.pending,
  blocker:
    'Old-web deletion is blocked until every web/src/App.tsx route has dedicated React Native parity and the final parity gate passes.',
} as const;

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

export const routeGroupParitySummaries: RouteGroupParitySummary[] =
  routeGroups.map(group => ({
    group,
    label: routeGroupLabels[group],
    ...getRouteParityForGroup(group),
  }));
