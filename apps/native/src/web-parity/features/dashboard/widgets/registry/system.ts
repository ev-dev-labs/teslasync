// Native parity port of
// web/src/features/dashboard/widgets/registry/system.ts.
//
// The web module is the "system" slice of the dashboard widget registry: a
// typed `WidgetDef[]` (SYSTEM_WIDGETS) describing twelve system/admin tiles
// (onboarding-checklist, uptime-monitor, mqtt-status, quick-nav, api-usage,
// system-health, telemetry-errors, audit-log, backup-monitor, export-status,
// version-info, dashboard-stats). Each entry pairs static metadata
// (id / name / description / category / grid sizes) with a lucide-react `icon`
// component and a `React.lazy` loader for the tile's web widget component; the
// first entry also carries `help` i18n metadata.
//
// This native port preserves the registry data 1:1 — the same twelve ids,
// names, descriptions, `system` category, defaultSize/minSize/maxSize grid
// units (in the same order), and the onboarding-checklist `help` metadata —
// using React Native-safe substitutions for the two browser/bundle-only
// fields, documented in the .parity.json sidecar:
//   - lucide-react icons (web L2-5: Rocket, HeartPulse, Radio, MapPin,
//     BarChart2, Server, AlertCircle, FileSearch, HardDrive, Download, Info,
//     LayoutDashboard): DOM SVG icon components are unavailable in React
//     Native, so `icon` becomes a glyph stand-in string that preserves each
//     tile's icon intent.
//   - `lazy(() => import('../OnboardingChecklistWidget'))` & peers
//     (web L18/34/45/56/67/78/89/100/111/122/133/144): the system web widget
//     components are not yet ported into web-parity, so the lazy DOM-component
//     loaders are replaced by a native-safe lazy loader
//     (`createUnavailableWidget`) that renders an explicit "unavailable" state
//     (contract rule 7). The web `LazyExoticComponent<ComponentType<WidgetProps>>`
//     component shape is kept so the registry stays renderable and faithful.
//   - `import type { WidgetDef } from '../types'` (web L6): the web widget
//     registry types (`WidgetDef`, `WidgetHelp`, `WidgetSize`, `WidgetCategory`,
//     `WidgetProps`, `WidgetConfig`) are inlined here as native-safe
//     projections because the `../types` module is not yet ported into
//     web-parity. `WidgetDef.icon` is narrowed from `LucideIcon` to the glyph
//     `string` described above; `WidgetHelp` (used by onboarding-checklist) is
//     mirrored verbatim.

import { createElement, lazy } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '../../../../../components/ui/AppText';
import { spacing } from '../../../../../theme/tokens';

/* ------------------------------------------------------------------ */
/*  Inlined native-safe widget registry types (web ../types.ts)        */
/* ------------------------------------------------------------------ */

export interface WidgetHelp {
  text?: string;
  i18nKey?: string;
  defaultValue?: string;
  learnMore?: { url: string; label?: string };
}

export interface WidgetSize {
  cols: number; // 1-4
  rows: number; // 1-8
}

export interface WidgetConfig {
  vehicleId?: number;
  refreshRate?: number;
  chartType?: string;
  showTitle?: boolean;
  timeRange?: string;
  [key: string]: unknown;
}

export interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: WidgetConfig;
}

export type WidgetCategory =
  | 'vehicle'
  | 'battery'
  | 'energy'
  | 'driving'
  | 'charging'
  | 'climate'
  | 'tires'
  | 'security'
  | 'commands'
  | 'media'
  | 'telemetry'
  | 'analytics'
  | 'alerts'
  | 'automations'
  | 'system'
  | 'maps';

/**
 * Native-safe projection of the web `WidgetDef`. `icon` is narrowed from the
 * DOM-only lucide `LucideIcon` component to a glyph stand-in string; every
 * other field mirrors the web type so the registry data round-trips faithfully.
 */
export interface WidgetDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: WidgetCategory;
  defaultSize: WidgetSize;
  minSize: WidgetSize;
  maxSize: WidgetSize;
  component: LazyExoticComponent<ComponentType<WidgetProps>>;
  help?: WidgetHelp;
}

/* ------------------------------------------------------------------ */
/*  lucide-react glyph stand-ins (web L2-5)                            */
/* ------------------------------------------------------------------ */

const ICON_ROCKET = '\u{1F680}'; // Rocket
const ICON_HEART_PULSE = '\u{1F493}'; // HeartPulse
const ICON_RADIO = '\u{1F4FB}'; // Radio
const ICON_MAP_PIN = '\u{1F4CD}'; // MapPin
const ICON_BAR_CHART = '\u{1F4CA}'; // BarChart2
const ICON_SERVER = '\u{1F5A5}\uFE0F'; // Server
const ICON_ALERT_CIRCLE = '\u26A0\uFE0F'; // AlertCircle
const ICON_FILE_SEARCH = '\u{1F50D}'; // FileSearch
const ICON_HARD_DRIVE = '\u{1F4BE}'; // HardDrive
const ICON_DOWNLOAD = '\u{1F4E5}'; // Download
const ICON_INFO = '\u2139\uFE0F'; // Info
const ICON_LAYOUT_DASHBOARD = '\u{1FA9F}'; // LayoutDashboard

/* ------------------------------------------------------------------ */
/*  Native-safe unavailable placeholder (web lazy() loaders, rule 7)   */
/* ------------------------------------------------------------------ */

/**
 * Builds the `component` for a registry entry whose web widget component is not
 * yet ported into web-parity. The result keeps the web
 * `LazyExoticComponent<ComponentType<WidgetProps>>` shape but renders an
 * explicit, native-safe "unavailable" surface instead of a DOM widget.
 */
function createUnavailableWidget(
  widgetName: string,
): LazyExoticComponent<ComponentType<WidgetProps>> {
  const UnavailableWidget: ComponentType<WidgetProps> = () =>
    createElement(
      View,
      {
        accessibilityLabel: `${widgetName} is not yet available in the native app`,
        accessibilityRole: 'text',
        accessible: true,
        style: styles.unavailable,
      },
      createElement(
        AppText,
        { style: styles.unavailableText, tone: 'muted', variant: 'caption' },
        `${widgetName} unavailable`,
      ),
    );
  UnavailableWidget.displayName = `UnavailableWidget(${widgetName})`;
  return lazy(() => Promise.resolve({ default: UnavailableWidget }));
}

/* ------------------------------------------------------------------ */
/*  SYSTEM_WIDGETS (web L8-146)                                         */
/* ------------------------------------------------------------------ */

export const SYSTEM_WIDGETS: WidgetDef[] = [
  {
    id: 'onboarding-checklist',
    name: 'Setup Checklist',
    description:
      'First-run setup checklist: connect Tesla, pick a theme, create an alert, and more',
    icon: ICON_ROCKET,
    category: 'system',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 2, rows: 3 },
    maxSize: { cols: 4, rows: 8 },
    component: createUnavailableWidget('Setup Checklist'),
    help: {
      i18nKey: 'checklist.help',
      defaultValue:
        'Tracks the few things you need to configure before TeslaSync feels useful. Auto-completes each step as you do it; dismiss it once you’re done.',
    },
  },
  {
    id: 'uptime-monitor',
    name: 'Uptime Monitor',
    description: 'System health: DB, MQTT, Tesla API, Fleet Telemetry status',
    icon: ICON_HEART_PULSE,
    category: 'system',
    defaultSize: { cols: 2, rows: 2 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: createUnavailableWidget('Uptime Monitor'),
  },
  {
    id: 'mqtt-status',
    name: 'MQTT Status',
    description:
      'Fleet Telemetry MQTT connection: status, message rate, throughput',
    icon: ICON_RADIO,
    category: 'system',
    defaultSize: { cols: 2, rows: 2 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 3, rows: 40 },
    component: createUnavailableWidget('MQTT Status'),
  },
  {
    id: 'quick-nav',
    name: 'Quick Navigation',
    description: 'Shortcut links to key pages',
    icon: ICON_MAP_PIN,
    category: 'system',
    defaultSize: { cols: 4, rows: 2 },
    minSize: { cols: 2, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: createUnavailableWidget('Quick Navigation'),
  },
  {
    id: 'api-usage',
    name: 'API Usage',
    description: 'API call volume, response times, error rates, top endpoints',
    icon: ICON_BAR_CHART,
    category: 'system',
    defaultSize: { cols: 2, rows: 2 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: createUnavailableWidget('API Usage'),
  },
  {
    id: 'system-health',
    name: 'System Health',
    description:
      'Server health: DB, MQTT, Tesla API status, memory, connections',
    icon: ICON_SERVER,
    category: 'system',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: createUnavailableWidget('System Health'),
  },
  {
    id: 'telemetry-errors',
    name: 'Telemetry Errors',
    description:
      'Fleet Telemetry error monitor: VINs with errors, error types, counts',
    icon: ICON_ALERT_CIRCLE,
    category: 'system',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: createUnavailableWidget('Telemetry Errors'),
  },
  {
    id: 'audit-log',
    name: 'Audit Log',
    description:
      'Security audit trail: user actions, auth events, permission changes',
    icon: ICON_FILE_SEARCH,
    category: 'system',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 2, rows: 4 },
    maxSize: { cols: 4, rows: 40 },
    component: createUnavailableWidget('Audit Log'),
  },
  {
    id: 'backup-monitor',
    name: 'Backup Monitor',
    description:
      'Database backup status: last run, size, retention, success/fail history',
    icon: ICON_HARD_DRIVE,
    category: 'system',
    defaultSize: { cols: 2, rows: 2 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: createUnavailableWidget('Backup Monitor'),
  },
  {
    id: 'export-status',
    name: 'Export Status',
    description: 'Data export jobs: progress, format, size, success/fail status',
    icon: ICON_DOWNLOAD,
    category: 'system',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: createUnavailableWidget('Export Status'),
  },
  {
    id: 'version-info',
    name: 'Version Info',
    description: 'TeslaSync version, build info, uptime, data capture rates',
    icon: ICON_INFO,
    category: 'system',
    defaultSize: { cols: 2, rows: 2 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: createUnavailableWidget('Version Info'),
  },
  {
    id: 'dashboard-stats',
    name: 'Dashboard Stats',
    description: 'Meta-widget: dashboard usage, widgets placed, FSM current state',
    icon: ICON_LAYOUT_DASHBOARD,
    category: 'system',
    defaultSize: { cols: 2, rows: 2 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: createUnavailableWidget('Dashboard Stats'),
  },
];

const styles = StyleSheet.create({
  unavailable: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.md,
  },
  unavailableText: {
    textAlign: 'center',
  },
});
