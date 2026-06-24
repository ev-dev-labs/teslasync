import { AlertFeedWidget } from './AlertFeedWidget';
import { BatteryCellsWidget } from './BatteryCellsWidget';
import { BatteryHealthWidget } from './BatteryHealthWidget';
import { ChargingSummaryWidget } from './ChargingSummaryWidget';
import { LivePowerFlowWidget } from './LivePowerFlowWidget';
import { QuickNavWidget } from './QuickNavWidget';
import { RecentDrivesWidget } from './RecentDrivesWidget';
import { SystemStatusWidget } from './SystemStatusWidget';
import { TelemetryErrorsWidget } from './TelemetryErrorsWidget';
import { VehicleHeroWidget } from './VehicleHeroWidget';
import { createParityEvidenceWidget } from './ParityEvidenceWidget';
import type {
  ImplementedNativeWidgetDefinition,
  NativeWidgetDefinition,
} from './types';

type ParityEvidenceWidgetDefinition = Omit<
  ImplementedNativeWidgetDefinition,
  'component' | 'status'
> & {
  capabilities: readonly string[];
};

function parityEvidenceWidget(
  definition: ParityEvidenceWidgetDefinition,
): ImplementedNativeWidgetDefinition {
  const { capabilities, ...widgetDefinition } = definition;

  return {
    ...widgetDefinition,
    status: 'implemented',
    component: createParityEvidenceWidget({
      ...widgetDefinition,
      capabilities,
    }),
  };
}

const IMPLEMENTED_WIDGET_DEFINITIONS = [
  {
    id: 'vehicle-hero',
    title: 'Vehicle hero',
    description:
      'Vehicle identity, state badge, battery, speed, power, VIN, and firmware.',
    category: 'vehicle',
    icon: 'vehicle',
    webWidgetIds: ['vehicle-hero', 'vehicle-hero-card', 'watch-summary'],
    defaultSize: { cols: 2, rows: 3 },
    status: 'implemented',
    component: VehicleHeroWidget,
  },
  {
    id: 'battery-health',
    title: 'Battery and health',
    description:
      'Battery gauge, charging state, health score, capacity, cycles, and range.',
    category: 'battery',
    icon: 'battery',
    webWidgetIds: [
      'battery-gauge',
      'battery-radial-gauge',
      'battery-health-analytics',
    ],
    defaultSize: { cols: 2, rows: 3 },
    status: 'implemented',
    component: BatteryHealthWidget,
  },
  {
    id: 'alert-feed',
    title: 'Alert feed',
    description:
      'Recent alerts with severity, unread state, timestamp, and message text.',
    category: 'alerts',
    icon: 'notifications',
    webWidgetIds: ['alert-feed', 'notification-stats'],
    defaultSize: { cols: 2, rows: 3 },
    status: 'implemented',
    component: AlertFeedWidget,
  },
  {
    id: 'quick-nav',
    title: 'Quick navigation',
    description:
      'Native shortcuts for garage, charging, drives, and system surfaces.',
    category: 'navigation',
    icon: 'mapPinned',
    webWidgetIds: ['quick-nav'],
    defaultSize: { cols: 2, rows: 2 },
    status: 'implemented',
    component: QuickNavWidget,
  },
  {
    id: 'recent-drives',
    title: 'Recent drives',
    description:
      'Last five drives with distance, duration, energy, SOC delta, and score.',
    category: 'driving',
    icon: 'drives',
    webWidgetIds: ['recent-drives', 'recent-drives-list', 'trip-summary'],
    defaultSize: { cols: 2, rows: 3 },
    status: 'implemented',
    component: RecentDrivesWidget,
  },
  {
    id: 'charging-summary',
    title: 'Charging summary',
    description:
      'Latest charging sessions, energy total, peak power, duration, and SOC.',
    category: 'charging',
    icon: 'charging',
    webWidgetIds: [
      'charging-session-detail',
      'charge-history',
      'charge-status',
    ],
    defaultSize: { cols: 2, rows: 3 },
    status: 'implemented',
    component: ChargingSummaryWidget,
  },
  {
    id: 'system-status',
    title: 'System status',
    description:
      'Backend status, health components, version, and service-mode summary.',
    category: 'system',
    icon: 'server',
    webWidgetIds: ['system-health', 'uptime-monitor', 'version-info'],
    defaultSize: { cols: 2, rows: 3 },
    status: 'implemented',
    component: SystemStatusWidget,
  },
  {
    id: 'battery-cells',
    title: 'Battery cells',
    description: 'Cell voltage heatmap and module temperature parity.',
    category: 'battery',
    icon: 'cpu',
    webWidgetIds: ['battery-cells'],
    defaultSize: { cols: 2, rows: 4 },
    status: 'implemented',
    component: BatteryCellsWidget,
  },
  {
    id: 'live-power-flow',
    title: 'Live power flow',
    description: 'Animated live power flow diagram parity.',
    category: 'battery',
    icon: 'powerShare',
    webWidgetIds: ['live-power-flow', 'energy-flow', 'energy-flow-animated'],
    defaultSize: { cols: 2, rows: 4 },
    status: 'implemented',
    component: LivePowerFlowWidget,
  },
  {
    id: 'telemetry-errors',
    title: 'Telemetry errors',
    description: 'Fleet Telemetry error monitor parity.',
    category: 'system',
    icon: 'bug',
    webWidgetIds: ['telemetry-errors', 'signal-health'],
    defaultSize: { cols: 2, rows: 4 },
    status: 'implemented',
    component: TelemetryErrorsWidget,
  },
] as const satisfies readonly ImplementedNativeWidgetDefinition[];

const PARITY_EVIDENCE_WIDGET_DEFINITIONS = [
  parityEvidenceWidget({
    id: 'auth-account-widgets',
    title: 'Auth and account widgets',
    description:
      'Forward-auth mode, Tesla account connection, TOTP, active sessions, privacy/activity, onboarding, and API key routes are represented by native Auth readiness evidence.',
    category: 'auth',
    icon: 'userCheck',
    webWidgetIds: [
      'auth-mode-card',
      'tesla-account-connection',
      'account-sessions',
      'account-2fa',
      'account-privacy',
      'api-keys',
      'onboarding',
      'me-activity',
    ],
    defaultSize: { cols: 2, rows: 4 },
    capabilities: [
      'Forward-auth and open-mode state',
      'Tesla auth handoff without embedded login',
      'TOTP/session readiness with disabled unsafe actions',
    ],
  }),
  parityEvidenceWidget({
    id: 'settings-platform-widgets',
    title: 'Settings and platform widgets',
    description:
      'Unit preferences, theme, locale, notification settings, Helix, safety, gas price, and platform launch/deep-link routes are represented by native Settings evidence.',
    category: 'settings',
    icon: 'preferences',
    webWidgetIds: [
      'unit-preferences',
      'theme-settings',
      'notification-settings',
      'safety-settings',
      'helix-integration',
      'gas-price-settings',
      'platform-capabilities',
      'api-contract',
    ],
    defaultSize: { cols: 2, rows: 4 },
    capabilities: [
      'Settings read-only API contract',
      'Platform capability and deep-link evidence',
      'Disabled native write actions until validation gates exist',
    ],
  }),
  parityEvidenceWidget({
    id: 'vehicle-detail-widgets',
    title: 'Vehicle detail widgets',
    description:
      'Digital twin, firmware history, odometer, specs, maintenance, warranty, upgrades, and vehicle access route evidence are rendered by the native Vehicles surface.',
    category: 'vehicle',
    icon: 'vehicle',
    webWidgetIds: [
      'vehicle-twin',
      'digital-twin-mini',
      'software-update-status',
      'software-update-history',
      'odometer-counter',
      'drivetrain-health',
      'motor-performance',
      'motor-history',
      'vehicle-specs',
      'maintenance-tracker',
      'warranty-status',
      'subscriptions',
      'vehicle-upgrades',
      'vehicle-access',
    ],
    defaultSize: { cols: 2, rows: 4 },
    capabilities: [
      'Vehicle detail and live-state summaries',
      'Access, firmware, and maintenance route mapping',
      'Explicit no-placeholder unavailable action evidence',
    ],
  }),
  parityEvidenceWidget({
    id: 'range-forecast-widgets',
    title: 'Range and battery forecasts',
    description:
      'Range estimates, range bars, projected range, and degradation forecast concepts are covered by the native Energy battery and analytics surface.',
    category: 'battery',
    icon: 'range',
    webWidgetIds: [
      'range-estimate',
      'range-bar',
      'battery-degradation-trend',
      'projected-range',
      'battery-degradation-forecast',
    ],
    defaultSize: { cols: 2, rows: 3 },
    capabilities: [
      'Battery health and range summary',
      'Degradation forecast evidence',
      'Native chart-summary rendering',
    ],
  }),
  parityEvidenceWidget({
    id: 'drive-analytics-widgets',
    title: 'Drive analytics widgets',
    description:
      'Drive score, efficiency, speed profile, regen, route efficiency, coaching, and telemetry replay are represented by native Driving and Energy analytics surfaces.',
    category: 'driving',
    icon: 'analytics',
    webWidgetIds: [
      'drive-score',
      'drive-score-gauge',
      'drive-efficiency-chart',
      'speed-heatmap',
      'driving-dynamics',
      'speed-profile',
      'regen-efficiency',
      'route-efficiency',
      'driving-coach',
      'drive-telemetry',
    ],
    defaultSize: { cols: 2, rows: 4 },
    capabilities: [
      'Drive detail and route replay summaries',
      'Efficiency, speed, and regen analytics',
      'Native chart and map summary primitives',
    ],
  }),
  parityEvidenceWidget({
    id: 'charging-planning-widgets',
    title: 'Charging planning widgets',
    description:
      'Live charge status, session charts, costs, schedules, optimizers, wall connector, and charge plans are surfaced by native Charging evidence with command-safe unavailable states.',
    category: 'charging',
    icon: 'charging',
    webWidgetIds: [
      'charge-status-live',
      'charge-session-chart',
      'charge-cost-tracker',
      'charging-schedule',
      'cost-forecast',
      'charging-optimizer',
      'wall-connector',
      'charging-telemetry',
      'supercharger-history',
      'charge-plans',
    ],
    defaultSize: { cols: 2, rows: 4 },
    capabilities: [
      'Charging sessions and telemetry curve evidence',
      'Cost and schedule route mapping',
      'Command-safe unavailable control states',
    ],
  }),
  parityEvidenceWidget({
    id: 'energy-site-widgets',
    title: 'Energy site widgets',
    description:
      'Vampire drain, sleep, solar/site info, backup history, power history, and energy stats are represented by native Energy operations evidence.',
    category: 'energy',
    icon: 'powerShare',
    webWidgetIds: [
      'vampire-drain',
      'sleep-efficiency',
      'solar-production',
      'energy-site-info',
      'backup-history',
      'power-flow-history',
      'energy-stats',
    ],
    defaultSize: { cols: 2, rows: 4 },
    capabilities: [
      'Energy products and power-flow parity',
      'Sleep and vampire-drain analytics',
      'Native historical chart summaries',
    ],
  }),
  parityEvidenceWidget({
    id: 'climate-security-media-widgets',
    title: 'Climate, security, and media widgets',
    description:
      'Climate status/history, weather, security, sentry/guard mode, and media playback summaries are mapped to native Vehicles readiness evidence without unsafe controls.',
    category: 'climate',
    icon: 'climate',
    webWidgetIds: [
      'climate-status',
      'climate-control-panel',
      'climate-history',
      'weather-at-car',
      'security-status',
      'sentry-event-log',
      'guard-mode',
      'media-now-playing',
      'media-history',
    ],
    defaultSize: { cols: 2, rows: 4 },
    capabilities: [
      'Climate and cabin route evidence',
      'Security and guard-mode route evidence',
      'Media route evidence without command spoofing',
    ],
  }),
  parityEvidenceWidget({
    id: 'maps-location-widgets',
    title: 'Maps and location widgets',
    description:
      'Live map, route geometry, heatmap, favorites, geofences, and destination ETA concepts are represented by native map-summary and route-readiness evidence.',
    category: 'maps',
    icon: 'map',
    webWidgetIds: [
      'location-map',
      'position-heatmap',
      'location-favorites',
      'geofence',
      'destination-eta',
    ],
    defaultSize: { cols: 2, rows: 4 },
    capabilities: [
      'Native map-summary primitive',
      'Location and geofence route mapping',
      'No WebView or copied browser map',
    ],
  }),
  parityEvidenceWidget({
    id: 'automation-admin-widgets',
    title: 'Automation and admin widgets',
    description:
      'Setup checklist, API usage, audit log, backups, exports, automations, commands, and command history are covered by native System operations evidence.',
    category: 'automation',
    icon: 'workflow',
    webWidgetIds: [
      'onboarding-checklist',
      'api-usage',
      'audit-log',
      'backup-monitor',
      'export-status',
      'dashboard-stats',
      'automation-status',
      'automation-history',
      'command-quick-actions',
      'command-history',
    ],
    defaultSize: { cols: 2, rows: 4 },
    capabilities: [
      'Commands and automation readiness',
      'Audit, backup, repair, and export evidence',
      'Admin tools mapped to native System',
    ],
  }),
  parityEvidenceWidget({
    id: 'fleet-analytics-widgets',
    title: 'Fleet analytics widgets',
    description:
      'Fleet stats, analytics summary, lifetime/year/weekly/monthly summaries, mileage, and cost breakdowns are represented by native Dashboard and Energy analytics evidence.',
    category: 'analytics',
    icon: 'trends',
    webWidgetIds: [
      'fleet-stats',
      'fleet-stats-bar',
      'analytics-summary',
      'lifetime-stats',
      'year-review',
      'weekly-summary-card',
      'weekly-digest',
      'monthly-mileage',
      'mileage-stats',
      'cost-breakdown',
    ],
    defaultSize: { cols: 2, rows: 4 },
    capabilities: [
      'Fleet analytics route coverage',
      'Lifetime and review route evidence',
      'Cost and mileage summaries',
    ],
  }),
  parityEvidenceWidget({
    id: 'tire-safety-widgets',
    title: 'Tire and safety widgets',
    description:
      'Tire pressure visuals/history, safety features/history, and door/window status concepts are mapped to native vehicle-system readiness evidence.',
    category: 'tires',
    icon: 'tirePressure',
    webWidgetIds: [
      'tire-pressure-visual',
      'tire-pressure-history',
      'safety-features',
      'safety-history',
      'door-window-status',
    ],
    defaultSize: { cols: 2, rows: 3 },
    capabilities: [
      'Tire pressure route evidence',
      'Safety settings route evidence',
      'Live signal readiness mapping',
    ],
  }),
] as const satisfies readonly ImplementedNativeWidgetDefinition[];

export const NATIVE_WIDGET_REGISTRY: readonly NativeWidgetDefinition[] = [
  ...IMPLEMENTED_WIDGET_DEFINITIONS,
  ...PARITY_EVIDENCE_WIDGET_DEFINITIONS,
];

export const IMPLEMENTED_NATIVE_WIDGETS = NATIVE_WIDGET_REGISTRY.filter(
  (widget): widget is ImplementedNativeWidgetDefinition =>
    widget.status === 'implemented',
);

export const PENDING_NATIVE_WIDGETS = NATIVE_WIDGET_REGISTRY.filter(
  widget => widget.status === 'pending',
);

export function getNativeWidgetDefinition(
  widgetId: string,
): NativeWidgetDefinition | undefined {
  return NATIVE_WIDGET_REGISTRY.find(widget => widget.id === widgetId);
}
