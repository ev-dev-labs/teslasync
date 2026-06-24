import { AlertFeedWidget } from './AlertFeedWidget';
import { BatteryHealthWidget } from './BatteryHealthWidget';
import { ChargingSummaryWidget } from './ChargingSummaryWidget';
import { QuickNavWidget } from './QuickNavWidget';
import { RecentDrivesWidget } from './RecentDrivesWidget';
import { SystemStatusWidget } from './SystemStatusWidget';
import { VehicleHeroWidget } from './VehicleHeroWidget';
import type {
  ImplementedNativeWidgetDefinition,
  NativeWidgetDefinition,
  PendingNativeWidgetDefinition,
} from './types';

export const NATIVE_WIDGET_REGISTRY: readonly NativeWidgetDefinition[] = [
  {
    id: 'vehicle-hero',
    title: 'Vehicle hero',
    description: 'Vehicle identity, state badge, battery, speed, power, VIN, and firmware.',
    category: 'vehicle',
    icon: 'vehicle',
    webWidgetIds: ['vehicle-hero', 'vehicle-hero-card', 'watch-summary'],
    defaultSize: {cols: 2, rows: 3},
    status: 'implemented',
    component: VehicleHeroWidget,
  },
  {
    id: 'battery-health',
    title: 'Battery and health',
    description: 'Battery gauge, charging state, health score, capacity, cycles, and range.',
    category: 'battery',
    icon: 'battery',
    webWidgetIds: ['battery-gauge', 'battery-radial-gauge', 'battery-health-analytics'],
    defaultSize: {cols: 2, rows: 3},
    status: 'implemented',
    component: BatteryHealthWidget,
  },
  {
    id: 'alert-feed',
    title: 'Alert feed',
    description: 'Recent alerts with severity, unread state, timestamp, and message text.',
    category: 'alerts',
    icon: 'notifications',
    webWidgetIds: ['alert-feed', 'notification-stats'],
    defaultSize: {cols: 2, rows: 3},
    status: 'implemented',
    component: AlertFeedWidget,
  },
  {
    id: 'quick-nav',
    title: 'Quick navigation',
    description: 'Native shortcuts for garage, charging, drives, and system surfaces.',
    category: 'navigation',
    icon: 'mapPinned',
    webWidgetIds: ['quick-nav'],
    defaultSize: {cols: 2, rows: 2},
    status: 'implemented',
    component: QuickNavWidget,
  },
  {
    id: 'recent-drives',
    title: 'Recent drives',
    description: 'Last five drives with distance, duration, energy, SOC delta, and score.',
    category: 'driving',
    icon: 'drives',
    webWidgetIds: ['recent-drives', 'recent-drives-list', 'trip-summary'],
    defaultSize: {cols: 2, rows: 3},
    status: 'implemented',
    component: RecentDrivesWidget,
  },
  {
    id: 'charging-summary',
    title: 'Charging summary',
    description: 'Latest charging sessions, energy total, peak power, duration, and SOC.',
    category: 'charging',
    icon: 'charging',
    webWidgetIds: ['charging-session-detail', 'charge-history', 'charge-status'],
    defaultSize: {cols: 2, rows: 3},
    status: 'implemented',
    component: ChargingSummaryWidget,
  },
  {
    id: 'system-status',
    title: 'System status',
    description: 'Backend status, health components, version, and service-mode summary.',
    category: 'system',
    icon: 'server',
    webWidgetIds: ['system-health', 'uptime-monitor', 'version-info'],
    defaultSize: {cols: 2, rows: 3},
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
    defaultSize: {cols: 2, rows: 4},
    status: 'pending',
    pendingReason: 'Requires a native cell heatmap primitive and battery-cell API coverage.',
  },
  {
    id: 'live-power-flow',
    title: 'Live power flow',
    description: 'Animated live power flow diagram parity.',
    category: 'battery',
    icon: 'powerShare',
    webWidgetIds: ['live-power-flow', 'energy-flow', 'energy-flow-animated'],
    defaultSize: {cols: 2, rows: 4},
    status: 'pending',
    pendingReason: 'Requires native animation primitives for the web power-flow diagram.',
  },
  {
    id: 'telemetry-errors',
    title: 'Telemetry errors',
    description: 'Fleet Telemetry error monitor parity.',
    category: 'system',
    icon: 'bug',
    webWidgetIds: ['telemetry-errors', 'signal-health'],
    defaultSize: {cols: 2, rows: 4},
    status: 'pending',
    pendingReason: 'Requires native telemetry diagnostics screens and error detail drill-through.',
  },
] as const;

export const IMPLEMENTED_NATIVE_WIDGETS = NATIVE_WIDGET_REGISTRY.filter(
  (widget): widget is ImplementedNativeWidgetDefinition => widget.status === 'implemented',
);

export const PENDING_NATIVE_WIDGETS = NATIVE_WIDGET_REGISTRY.filter(
  (widget): widget is PendingNativeWidgetDefinition => widget.status === 'pending',
);

export function getNativeWidgetDefinition(widgetId: string): NativeWidgetDefinition | undefined {
  return NATIVE_WIDGET_REGISTRY.find(widget => widget.id === widgetId);
}
