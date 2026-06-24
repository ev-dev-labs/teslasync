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
  auth: 'Implemented: AuthScreen renders forward-auth/open-mode, Tesla account, 2FA, sessions, privacy/activity, and unavailable enrollment action evidence.',
  settings:
    'Implemented: SettingsScreen renders platform, preferences, safety, Helix, notification, auth, and API contract evidence.',
};

const implementedRouteIds = new Set<string>([
  'quick-stats',
  'glance',
  'year-review-year',
  'shared-drive-token',
  'watch',
  'onboarding',
  'root-layout',
  'explore',
  'live',
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
  'vehicles-id-access',
  'digital-twin',
  'tire-pressure',
  'software-updates',
  'vehicle-systems-software',
  'climate-control',
  'climate',
  'security-access',
  'safety-settings',
  'maintenance',
  'media-player',
  'guard-mode',
  'charging-curve',
  'charging-curves',
  'charging-vampire-drain',
  'cost-analysis',
  'charging-costs',
  'tesla-charging-history',
  'tesla-charging-sessions',
  'smart-charge',
  'charging-schedule',
  'powershare',
  'charging-heatmap',
  'energy-flow',
  'power-flow',
  'energy-products',
  'battery-cells',
  'vampire-drain',
  'projected-range',
  'analytics-range',
  'tesla-account',
  'search',
  'not-found-layout',
  'not-found-root',
  'sharing-trips',
  'analytics-lifetime',
  'compare',
  'analytics-compare',
  'geofences',
  'locations',
  'timeline',
  'mileage',
  'trip-planner',
  'statistics',
  'lifetime-stats',
  'period-compare',
  'driving-dynamics',
  'drive-score',
  'weekly-digest',
  'drivetrain-health',
  'navigation',
  'vehicle-comparison',
] as const);

const nativeSummaryRouteIds = new Set<string>([
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
  'chatbot',
  'system-status-incidents-id',
  'docs-status-api',
  'roadmap',
  'api-keys',
  'admin-feedback',
  'admin-flags',
  'admin-ingest-xray',
  'admin-schema-drift',
  'admin-slow-queries',
  'admin-vehicle-cost',
  'admin-disk-forecast',
  'admin-secret-rotation',
  'admin-gdpr-exports',
  'fleet-api',
  'tesla-features',
  'tesla-region',
  'tesla-orders',
  'gas-price',
  'api-playground',
  'redis-signals',
  'state-debugger',
  'signal-diff',
  'signal-gaps',
  'db-health',
  'mqtt-inspector',
  'anomaly-detection',
  'analytics-anomalies',
  'data-export',
  'me-activity',
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
    evidence:
      'Implemented: DashboardScreen renders the R0001 quick-stats native surface from /vehicles, /alerts, /system/status, and the widget registry.',
  }),
  webRoute({
    id: 'glance',
    sourcePath: 'glance',
    group: 'command',
    label: 'Glance',
    nativeTarget: 'dashboard',
    evidence:
      'Implemented: DashboardScreen renders glance metrics, chart summary, loading states, and route evidence with React Native primitives.',
  }),
  webRoute({
    id: 'year-review-year',
    sourcePath: 'year-review/:year',
    group: 'command',
    label: 'Year Review',
    nativeTarget: 'dashboard',
    evidence:
      'Implemented: DashboardScreen renders year-review route evidence through native dashboard analytics/widget coverage without fabricating annual totals.',
  }),
  webRoute({
    id: 'shared-drive-token',
    sourcePath: 's/:token',
    group: 'fleet',
    label: 'Shared Drive',
    nativeTarget: 'driving',
    evidence:
      'Implemented: DrivingScreen renders a read-only shared-drive token route surface from selected drive and telemetry data without fake token payloads.',
  }),
  webRoute({
    id: 'watch',
    sourcePath: 'watch',
    group: 'command',
    label: 'Watch Face',
    nativeTarget: 'dashboard',
    evidence:
      'Implemented: DashboardScreen renders watch-face parity through the native vehicle hero/watch summary widget and R0001 command route evidence.',
  }),
  webRoute({
    id: 'onboarding',
    sourcePath: 'onboarding',
    group: 'platform',
    label: 'Onboarding',
    nativeTarget: 'auth',
    evidence:
      'Implemented: AuthScreen renders onboarding route readiness from auth mode, Tesla account handoff, sessions, and TOTP capability evidence.',
  }),
  webRoute({
    id: 'root-layout',
    sourcePath: '/',
    group: 'command',
    label: 'Root Shell',
    nativeTarget: 'dashboard',
    evidence:
      'Implemented: AppRoot and DashboardScreen render the root shell, route search, status panel, and parity evidence without WebView or Electron embedding.',
  }),
  webRoute({
    id: 'explore',
    sourcePath: 'explore',
    group: 'command',
    label: 'Explore',
    nativeTarget: 'dashboard',
    evidence:
      'Implemented: DashboardScreen renders explore route evidence through the native widget registry and command surface instead of a browser shell.',
  }),
  webRoute({
    id: 'live',
    sourcePath: 'live',
    group: 'fleet',
    label: 'Live Map',
    nativeTarget: 'vehicles',
    evidence:
      'Implemented: VehiclesScreen renders a dedicated /live native route surface from /vehicles/{vehicleID}/state coordinates, speed, and power.',
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
    evidence:
      'Implemented: VehiclesScreen renders native vehicle access state from /vehicles/{vehicleID}/state and /security/latest, with invite/driver mutations explicitly unavailable.',
  }),
  webRoute({
    id: 'digital-twin',
    sourcePath: 'digital-twin',
    group: 'fleet',
    label: 'Digital Twin',
    nativeTarget: 'vehicles',
    evidence:
      'Implemented: VehiclesScreen renders digital-twin metadata, firmware, vehicle config, and live state without embedding the web 3D view.',
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
    evidence:
      'Implemented: VehiclesScreen renders geofence centroid, radius, enabled state, and alert flags from /geofences with native chart/list summaries.',
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
    evidence:
      'Implemented: VehiclesScreen renders native TPMS pressure cards from /tire-pressure/latest with visible empty and error states.',
  }),
  webRoute({
    id: 'software-updates',
    sourcePath: 'software-updates',
    group: 'fleet',
    label: 'Software Updates',
    nativeTarget: 'vehicles',
    evidence:
      'Implemented: VehiclesScreen renders software update history and current firmware from /software-updates, /vehicle-config/latest, and live vehicle state.',
  }),
  webRoute({
    id: 'vehicle-systems-software',
    sourcePath: 'vehicle-systems/software',
    group: 'fleet',
    label: 'Vehicle Software',
    nativeTarget: 'vehicles',
    evidence:
      'Implemented: VehiclesScreen renders the vehicle-systems software route through native firmware, config, and update-history sections.',
  }),
  webRoute({
    id: 'vampire-drain',
    sourcePath: 'vampire-drain',
    group: 'operations',
    label: 'Vampire Drain',
    nativeTarget: 'energy',
    evidence:
      'Implemented: EnergyScreen renders vampire-drain analytics from /analytics/sleep and /analytics/temperature-impact without inferring fake idle loss.',
  }),
  webRoute({
    id: 'charging-vampire-drain',
    sourcePath: 'charging/vampire-drain',
    group: 'operations',
    label: 'Charging Vampire Drain',
    nativeTarget: 'energy',
    evidence:
      'Implemented: ChargingScreen and EnergyScreen keep charge-scoped drain visible with explicit unavailable state and sleep-backed vampire-drain analytics.',
  }),
  webRoute({
    id: 'locations',
    sourcePath: 'locations',
    group: 'fleet',
    label: 'Locations',
    nativeTarget: 'vehicles',
    evidence:
      'Implemented: VehiclesScreen renders visited-location counts, duration, last-visited metadata, and live coordinates from /locations and /vehicles/{vehicleID}/state.',
  }),
  webRoute({
    id: 'timeline',
    sourcePath: 'timeline',
    group: 'fleet',
    label: 'Timeline',
    nativeTarget: 'driving',
    evidence:
      'Implemented: DrivingScreen renders trip and drive chronology from /trips and /drives without fake trip rows.',
  }),
  webRoute({
    id: 'mileage',
    sourcePath: 'mileage',
    group: 'fleet',
    label: 'Mileage',
    nativeTarget: 'driving',
    evidence:
      'Implemented: DrivingScreen renders mileage charts and totals from /mileage/daily, /mileage/monthly, /mileage/stats, and real /drives fallback rows.',
  }),
  webRoute({
    id: 'projected-range',
    sourcePath: 'projected-range',
    group: 'operations',
    label: 'Projected Range',
    nativeTarget: 'energy',
    evidence:
      'Implemented: EnergyScreen renders projected range, range gap, and projection trend evidence from battery/degradation analytics.',
  }),
  webRoute({
    id: 'analytics-range',
    sourcePath: 'analytics/range',
    group: 'operations',
    label: 'Analytics Range',
    nativeTarget: 'energy',
    evidence:
      'Implemented: EnergyScreen renders analytics/range evidence using battery health, degradation, and SI energy totals.',
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
    evidence:
      'Implemented: DrivingScreen renders real /trips rows and selected drive telemetry context while keeping share-link creation unavailable instead of fabricating public links.',
  }),
  webRoute({
    id: 'trip-planner',
    sourcePath: 'trip-planner',
    group: 'fleet',
    label: 'Trip Planner',
    nativeTarget: 'driving',
    evidence:
      'Implemented: DrivingScreen renders trip-planner inputs from /trips, /drives, and /drives/{driveID}/telemetry without fake destinations or WebView maps.',
  }),
  webRoute({
    id: 'statistics',
    sourcePath: 'statistics',
    group: 'command',
    label: 'Statistics',
    nativeTarget: 'dashboard',
    evidence:
      'Implemented: DashboardScreen renders statistics summaries from /analytics/fleet and /drives with native MetricGrid and ChartSummary primitives.',
  }),
  webRoute({
    id: 'lifetime-stats',
    sourcePath: 'lifetime-stats',
    group: 'command',
    label: 'Lifetime Stats',
    nativeTarget: 'dashboard',
    evidence:
      'Implemented: DashboardScreen renders lifetime distance, energy, cost, and trend summaries from /analytics/fleet plus real returned drive rows.',
  }),
  webRoute({
    id: 'analytics-lifetime',
    sourcePath: 'analytics/lifetime',
    group: 'command',
    label: 'Analytics Lifetime Redirect',
    nativeTarget: 'dashboard',
    evidence:
      'Implemented: The analytics/lifetime redirect is represented by the native lifetime-stats dashboard summary and typed route manifest redirect evidence.',
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
    evidence:
      'Implemented: The compare redirect is represented by the native period-compare dashboard summary and typed route manifest redirect evidence.',
  }),
  webRoute({
    id: 'analytics-compare',
    sourcePath: 'analytics/compare',
    group: 'command',
    label: 'Analytics Compare Redirect',
    nativeTarget: 'dashboard',
    evidence:
      'Implemented: The analytics/compare redirect is represented by the native period-compare dashboard summary and typed route manifest redirect evidence.',
  }),
  webRoute({
    id: 'period-compare',
    sourcePath: 'period-compare',
    group: 'command',
    label: 'Period Compare',
    nativeTarget: 'dashboard',
    evidence:
      'Implemented: DashboardScreen renders period comparison trend data from /analytics/fleet drive_analytics.daily_trend with real /drives fallback rows.',
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
    evidence:
      'Implemented: DrivingScreen renders driving dynamics from /drives/{driveID}/telemetry speed and power samples with accessible chart data.',
  }),
  webRoute({
    id: 'climate-control',
    sourcePath: 'climate-control',
    group: 'fleet',
    label: 'Climate Control',
    nativeTarget: 'vehicles',
    evidence:
      'Implemented: VehiclesScreen renders native climate-control state from /climate/latest and keeps HVAC command actions unavailable.',
  }),
  webRoute({
    id: 'climate',
    sourcePath: 'climate',
    group: 'fleet',
    label: 'Climate',
    nativeTarget: 'vehicles',
    evidence:
      'Implemented: VehiclesScreen renders cabin temperature, fan, keeper, defrost, and protection summaries from /climate/latest.',
  }),
  webRoute({
    id: 'security-access',
    sourcePath: 'security-access',
    group: 'fleet',
    label: 'Security Access',
    nativeTarget: 'vehicles',
    evidence:
      'Implemented: VehiclesScreen renders lock, door/window, valet, service, and phone-key state from /security/latest without unsafe mutations.',
  }),
  webRoute({
    id: 'charging-curve',
    sourcePath: 'charging-curve',
    group: 'operations',
    label: 'Charging Curve',
    nativeTarget: 'charging',
    evidence:
      'Implemented: ChargingScreen renders charging-curve telemetry with a native chart summary and accessible data table.',
  }),
  webRoute({
    id: 'charging-curves',
    sourcePath: 'charging/curves',
    group: 'operations',
    label: 'Charging Curves',
    nativeTarget: 'charging',
    evidence:
      'Implemented: ChargingScreen renders charging-curves history from selected /charging/{sessionID}/telemetry without web chart embedding.',
  }),
  webRoute({
    id: 'cost-analysis',
    sourcePath: 'cost-analysis',
    group: 'operations',
    label: 'Cost Analysis',
    nativeTarget: 'charging',
    evidence:
      'Implemented: ChargingScreen renders cost-analysis metrics and chart summaries from returned charging session cost fields.',
  }),
  webRoute({
    id: 'charging-costs',
    sourcePath: 'charging/costs',
    group: 'operations',
    label: 'Charging Costs',
    nativeTarget: 'charging',
    evidence:
      'Implemented: ChargingScreen renders charging-costs rows with cost, energy, and per-kWh values derived from /charging.',
  }),
  webRoute({
    id: 'tesla-charging-history',
    sourcePath: 'tesla-charging-history',
    group: 'operations',
    label: 'Tesla Charging History',
    nativeTarget: 'charging',
    evidence:
      'Implemented: ChargingScreen renders Tesla charging history from /charging sessions with duration, SOC, cost, and charger details.',
  }),
  webRoute({
    id: 'tesla-charging-sessions',
    sourcePath: 'tesla-charging-sessions',
    group: 'operations',
    label: 'Tesla Charging Sessions',
    nativeTarget: 'charging',
    evidence:
      'Implemented: ChargingScreen renders Tesla charging sessions through the native session list, detail shell, and telemetry summary.',
  }),
  webRoute({
    id: 'smart-charge',
    sourcePath: 'smart-charge',
    group: 'operations',
    label: 'Smart Charge',
    nativeTarget: 'charging',
    evidence:
      'Implemented: ChargingScreen renders smart-charge route evidence with selected-session context and command-safe unavailable optimizer state.',
  }),
  webRoute({
    id: 'charging-schedule',
    sourcePath: 'charging/schedule',
    group: 'operations',
    label: 'Charging Schedule',
    nativeTarget: 'charging',
    evidence:
      'Implemented: ChargingScreen renders charging-schedule evidence from session timestamps while leaving unavailable write controls honest.',
  }),
  webRoute({
    id: 'powershare',
    sourcePath: 'powershare',
    group: 'operations',
    label: 'Powershare',
    nativeTarget: 'charging',
    evidence:
      'Implemented: ChargingScreen renders powershare route evidence with charger input telemetry and explicit no bidirectional power API state.',
  }),
  webRoute({
    id: 'battery-cells',
    sourcePath: 'battery-cells',
    group: 'operations',
    label: 'Battery Cells',
    nativeTarget: 'energy',
    evidence:
      'Implemented: EnergyScreen renders battery-cells diagnostics from degradation snapshots, temperature, and risk factors without fake cell voltage heatmaps.',
  }),
  webRoute({
    id: 'drive-score',
    sourcePath: 'drive-score',
    group: 'fleet',
    label: 'Drive Score',
    nativeTarget: 'driving',
    evidence:
      'Implemented: DrivingScreen renders selected and average drive scores from returned /drives score fields only.',
  }),
  webRoute({
    id: 'weekly-digest',
    sourcePath: 'weekly-digest',
    group: 'command',
    label: 'Weekly Digest',
    nativeTarget: 'dashboard',
    evidence:
      'Implemented: DashboardScreen renders weekly digest counts using a seven-day window anchored to the latest returned /drives row.',
  }),
  webRoute({
    id: 'maintenance',
    sourcePath: 'maintenance',
    group: 'fleet',
    label: 'Maintenance',
    nativeTarget: 'vehicles',
    evidence:
      'Implemented: VehiclesScreen renders deterministic maintenance reminders and service-record status from /maintenance and /maintenance/records.',
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
    evidence:
      'Implemented: EnergyScreen renders energy-flow summaries from vehicle energy and regen totals with accessible chart data.',
  }),
  webRoute({
    id: 'power-flow',
    sourcePath: 'power-flow',
    group: 'operations',
    label: 'Power Flow',
    nativeTarget: 'energy',
    evidence:
      'Implemented: EnergyScreen renders power-flow as native live power and energy totals without WebView animation embedding.',
  }),
  webRoute({
    id: 'energy-products',
    sourcePath: 'energy-products',
    group: 'operations',
    label: 'Energy Products',
    nativeTarget: 'energy',
    evidence:
      'Implemented: EnergyScreen renders energy-products route evidence and explicitly marks Tesla Energy site inventory unavailable instead of fabricating site data.',
  }),
  webRoute({
    id: 'drivetrain-health',
    sourcePath: 'drivetrain-health',
    group: 'fleet',
    label: 'Drivetrain Health',
    nativeTarget: 'vehicles',
    evidence:
      'Implemented: VehiclesScreen renders drivetrain health from live speed, power, state, vehicle health, and maintenance status without fabricated diagnostics.',
  }),
  webRoute({
    id: 'media-player',
    sourcePath: 'media-player',
    group: 'fleet',
    label: 'Media Player',
    nativeTarget: 'vehicles',
    evidence:
      'Implemented: VehiclesScreen renders now-playing state from /media/latest with play/pause/source controls explicitly unavailable.',
  }),
  webRoute({
    id: 'safety-settings',
    sourcePath: 'safety-settings',
    group: 'fleet',
    label: 'Safety Settings',
    nativeTarget: 'vehicles',
    evidence:
      'Implemented: VehiclesScreen renders read-only ADAS and PIN-to-drive safety settings from /safety/latest.',
  }),
  webRoute({
    id: 'guard-mode',
    sourcePath: 'guard-mode',
    group: 'fleet',
    label: 'Guard Mode',
    nativeTarget: 'vehicles',
    evidence:
      'Implemented: VehiclesScreen renders guard/sentry state from /security/latest and leaves guard commands unavailable.',
  }),
  webRoute({
    id: 'navigation',
    sourcePath: 'navigation',
    group: 'fleet',
    label: 'Navigation',
    nativeTarget: 'driving',
    evidence:
      'Implemented: DrivingScreen renders native navigation and route summaries from /drives/{driveID}/telemetry with no WebView map embedding.',
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
    evidence:
      'Implemented: VehiclesScreen renders vehicle comparison rows from /analytics/fleet and real /vehicles metadata fallback when comparison rows are absent.',
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
    evidence:
      'Implemented: ChargingScreen renders charging-heatmap buckets from /charging started_at timestamps and SI energy totals.',
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
    evidence:
      'Implemented: ShellNavigation renders RouteSearchPanel, resolving route ids and web paths from the typed route manifest.',
  }),
  webRoute({
    id: 'not-found-layout',
    sourcePath: '*',
    group: 'platform',
    label: 'Layout Not Found',
    nativeTarget: 'system',
    evidence:
      'Implemented: SystemScreen renders native not-found route diagnostics for unmatched layout-level paths without redirecting into the web fallback.',
  }),
  webRoute({
    id: 'not-found-root',
    sourcePath: '*',
    group: 'platform',
    label: 'Root Not Found',
    nativeTarget: 'system',
    evidence:
      'Implemented: SystemScreen renders native root fallback diagnostics and route readiness evidence for unmatched paths.',
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
