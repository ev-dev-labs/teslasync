// Native parity port of web/src/features/dashboard/components/TemplateGallery.tsx.
//
// `TemplateGallery` is the modal that lets a user pick a starting dashboard
// layout. It shows a grid of preset "template" cards (plus a "Blank Dashboard"
// option); tapping a card opens a detail view with a larger preview, the widget
// list, and an "Use This Template" action. Selecting a template calls
// `onApply(presetId)` ('__blank__' for the blank option). Behaviour preserved
// 1:1: the `selectedId` state, `selectedTemplate` lookup against the preset
// list, `handleApply` (apply + clear selection), `handleClose` (clear selection
// + onClose), the blank-option apply, and the card -> detail -> back/apply flow.
//
// The web source pulls several sibling dashboard modules + DOM/web-only
// dependencies that have no native parity surface (conversion rules 4/5/7).
// Because those sibling modules are not yet converted, the data/types they
// provide are reproduced locally here (the same self-contained approach used by
// the KioskSettingsModal port, which reproduced its KioskConfig/SavedDashboard
// subset locally and documented that the source modules are "ported
// separately"). Each mapping is recorded in the sidecar:
//
//   - react-i18next `useTranslation('dashboard')` -> a local fallback resolver
//     returning the inline English string. It additionally interpolates
//     `{{count}}`-style placeholders from the options arg so the "{{count}}
//     widgets" line still shows the real count (i18n key + default kept
//     verbatim). Namespace arg accepted + ignored.
//   - lucide-react `LayoutGrid` / `ArrowLeft` / `Sparkles` (and every widget's
//     lucide `icon`) -> there is no `react-native-svg` dependency, so each
//     renders a decorative aria-hidden glyph stand-in (the KioskSettingsModal /
//     AutomationCard glyph precedent). `ICON_GLYPHS` maps each lucide identifier
//     to its glyph so the web icon intent is preserved + auditable.
//   - `@/lib/cn` Tailwind class merger -> RN has no className; the
//     class-driven variant/hover styling moves to StyleSheet. Hover/translate/
//     shadow affordances collapse to a Pressable `pressed` feedback state.
//   - `@/components/ui` `Modal` (size="lg", the `bg-[#0f1218]` sheet) -> the RN
//     core `Modal` primitive (transparent fade, backdrop-tap + hardware-back
//     close via onRequestClose) with a titled header (X close) and a ScrollView
//     body, max-width 672 (web `sm:max-w-2xl`) and max-height 80% (web
//     `max-h-[80vh]`).
//   - `@/components/ui` `Button` (the card-as-button + Back/Apply/Blank) ->
//     `Pressable` + `AppText` (ghost = bordered surface, primary = accent fill),
//     matching the KioskSettingsModal action-button approach.
//   - `@/components/ui` `Badge` -> the converted web-parity `Badge` port.
//   - `@/components/motion` `FadeIn` / `StaggerContainer` / `StaggerItem` -> the
//     converted web-parity motion port (entrance fade + injected stagger delay).
//   - `../hooks/useDashboardLayout` `DASHBOARD_PRESETS` + the `makePreset` /
//     `buildDefaultLayouts` / `buildLayoutItem` layout generators + `GRID_COLS`
//     -> reproduced verbatim below so the preset content (ids, names, ordered
//     widget lists) and the generated `layouts` (which drive the grid preview)
//     match the web exactly.
//   - `../widgets/registry` `getWidgetDef` -> a local lookup over `WIDGET_META`,
//     a focused table of the 38 widgets the presets reference (name / category /
//     glyph / defaultSize / minSize / maxSize transcribed from the web
//     registry). Unknown ids resolve to undefined exactly like the web.
//   - `../widgets/types` `SavedDashboard` (+ WidgetInstance / WidgetSize /
//     RGLLayout / RGLLayouts) -> reproduced locally (and exported) so this
//     component and any future native consumer agree on the shape.
//   - `./MiniGridPreview` -> reproduced as a native component: the web used
//     absolutely-positioned `<div>`s with percentage left/top/width/height + a
//     CSS `aspect-ratio`; RN supports `position:'absolute'` with percentage
//     dimensions + the `aspectRatio` style, so the mini grid renders faithfully.

import React, {useMemo, useState} from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {Badge} from '../../../components/ui/Badge';
import {FadeIn, StaggerContainer, StaggerItem} from '../../../components/motion';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';

// ── i18n shim ───────────────────────────────────────────────────────────────
// react-i18next has no native parity module; like the other web-parity ports,
// translations resolve to their inline English fallback. Placeholder
// interpolation (`{{count}}`) is supported so the widget-count line keeps the
// real number. The hook shape mirrors web `useTranslation('dashboard')`.
type TOptions = Record<string, string | number>;
type TFunc = (key: string, fallback: string, options?: TOptions) => string;

function useTranslation(_namespace?: string): {t: TFunc} {
  return {
    t: (_key, fallback, options) => {
      if (!options) {
        return fallback;
      }
      return fallback.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
        options[name] != null ? String(options[name]) : match,
      );
    },
  };
}

// ── Type reproductions (web ../widgets/types) ────────────────────────────────
export interface WidgetSize {
  cols: number;
  rows: number;
}

export interface WidgetConfig {
  vehicleId?: number;
  refreshRate?: number;
  chartType?: string;
  showTitle?: boolean;
  timeRange?: string;
  [key: string]: unknown;
}

export interface WidgetInstance {
  id: string;
  widgetId: string;
  config?: WidgetConfig;
}

/** react-grid-layout Layout item (position + size in grid units). */
export interface RGLLayout {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
  maxW?: number;
  maxH?: number;
}

/** react-grid-layout Layouts — keyed by breakpoint string. */
export interface RGLLayouts {
  [breakpoint: string]: RGLLayout[];
}

export interface SavedDashboard {
  id: string;
  name: string;
  icon?: string;
  vehicleId?: number | null;
  widgets: WidgetInstance[];
  layouts: RGLLayouts;
  createdAt: string;
  updatedAt: string;
  isDefault?: boolean;
}

// ── Widget metadata (web ../widgets/registry getWidgetDef subset) ─────────────
// The native app has no `react-native-svg`, so each web lucide icon maps to a
// decorative glyph. This table documents the lucide identifier -> glyph mapping
// used by every preset widget so the icon intent stays auditable.
const ICON_GLYPHS: Record<string, string> = {
  Activity: '〰',
  BarChart3: '📊',
  Battery: '🔋',
  Bell: '🔔',
  Calendar: '📅',
  Car: '🚗',
  CircleDot: '◉',
  CloudSun: '🌤',
  Command: '⌘',
  CreditCard: '💳',
  DollarSign: '＄',
  DoorOpen: '🚪',
  Eye: '👁',
  Gauge: '⏱',
  Grid3X3: '▦',
  HeartPulse: '💓',
  List: '☰',
  MapPin: '📍',
  Monitor: '🖥',
  Rocket: '🚀',
  Shield: '🛡',
  Thermometer: '🌡',
  TrendingUp: '📈',
  Wifi: '📶',
  Workflow: '🔀',
  Zap: '⚡',
};

interface WidgetDef {
  id: string;
  name: string;
  category: string;
  /** Decorative glyph stand-in for the web lucide `icon`. */
  glyph: string;
  defaultSize: WidgetSize;
  minSize: WidgetSize;
  maxSize: WidgetSize;
}

interface WidgetMetaSeed {
  name: string;
  category: string;
  icon: keyof typeof ICON_GLYPHS;
  defaultSize: WidgetSize;
  minSize: WidgetSize;
  maxSize: WidgetSize;
}

// Transcribed from web/src/features/dashboard/widgets/registry/*.ts — only the
// 38 widgets the presets reference are modeled (the full registry is ported
// separately). name / category / size fields are verbatim from the source.
const WIDGET_META: Record<string, WidgetMetaSeed> = {
  'onboarding-checklist': {name: 'Setup Checklist', category: 'system', icon: 'Rocket', defaultSize: {cols: 2, rows: 4}, minSize: {cols: 2, rows: 3}, maxSize: {cols: 4, rows: 8}},
  'vehicle-hero': {name: 'Vehicle Card', category: 'vehicle', icon: 'Car', defaultSize: {cols: 2, rows: 9}, minSize: {cols: 2, rows: 4}, maxSize: {cols: 4, rows: 40}},
  'battery-gauge': {name: 'Battery Level', category: 'battery', icon: 'Battery', defaultSize: {cols: 1, rows: 2}, minSize: {cols: 1, rows: 2}, maxSize: {cols: 2, rows: 40}},
  'climate-status': {name: 'Climate', category: 'climate', icon: 'Thermometer', defaultSize: {cols: 1, rows: 2}, minSize: {cols: 1, rows: 2}, maxSize: {cols: 2, rows: 40}},
  'recent-drives': {name: 'Recent Drives', category: 'driving', icon: 'Car', defaultSize: {cols: 2, rows: 4}, minSize: {cols: 2, rows: 2}, maxSize: {cols: 4, rows: 40}},
  'charge-status': {name: 'Charge Status', category: 'charging', icon: 'Zap', defaultSize: {cols: 2, rows: 2}, minSize: {cols: 1, rows: 2}, maxSize: {cols: 3, rows: 40}},
  'security-status': {name: 'Security', category: 'security', icon: 'Shield', defaultSize: {cols: 1, rows: 2}, minSize: {cols: 1, rows: 2}, maxSize: {cols: 2, rows: 40}},
  'quick-nav': {name: 'Quick Navigation', category: 'system', icon: 'MapPin', defaultSize: {cols: 4, rows: 2}, minSize: {cols: 2, rows: 2}, maxSize: {cols: 4, rows: 40}},
  'range-estimate': {name: 'Range Estimate', category: 'battery', icon: 'Gauge', defaultSize: {cols: 1, rows: 2}, minSize: {cols: 1, rows: 2}, maxSize: {cols: 2, rows: 40}},
  'location-map': {name: 'Vehicle Location Map', category: 'maps', icon: 'MapPin', defaultSize: {cols: 2, rows: 4}, minSize: {cols: 1, rows: 4}, maxSize: {cols: 4, rows: 40}},
  'fleet-stats': {name: 'Fleet Stats', category: 'analytics', icon: 'BarChart3', defaultSize: {cols: 4, rows: 2}, minSize: {cols: 2, rows: 2}, maxSize: {cols: 4, rows: 40}},
  'charge-history': {name: 'Charge History', category: 'charging', icon: 'BarChart3', defaultSize: {cols: 2, rows: 4}, minSize: {cols: 2, rows: 2}, maxSize: {cols: 4, rows: 40}},
  'drive-score': {name: 'Driving Score', category: 'driving', icon: 'TrendingUp', defaultSize: {cols: 1, rows: 2}, minSize: {cols: 1, rows: 2}, maxSize: {cols: 2, rows: 40}},
  'live-signals': {name: 'Live Signals', category: 'telemetry', icon: 'Wifi', defaultSize: {cols: 2, rows: 4}, minSize: {cols: 2, rows: 2}, maxSize: {cols: 4, rows: 40}},
  'energy-flow': {name: 'Energy Flow', category: 'battery', icon: 'Activity', defaultSize: {cols: 2, rows: 4}, minSize: {cols: 2, rows: 4}, maxSize: {cols: 4, rows: 40}},
  'vehicle-twin': {name: 'Digital Twin', category: 'vehicle', icon: 'Monitor', defaultSize: {cols: 2, rows: 4}, minSize: {cols: 2, rows: 4}, maxSize: {cols: 3, rows: 40}},
  'charge-status-live': {name: 'Charge Status Live', category: 'charging', icon: 'Zap', defaultSize: {cols: 2, rows: 2}, minSize: {cols: 1, rows: 2}, maxSize: {cols: 3, rows: 40}},
  'battery-radial-gauge': {name: 'Battery Radial Gauge', category: 'battery', icon: 'Battery', defaultSize: {cols: 1, rows: 2}, minSize: {cols: 1, rows: 2}, maxSize: {cols: 3, rows: 40}},
  'charge-session-chart': {name: 'Charge Session Chart', category: 'charging', icon: 'Zap', defaultSize: {cols: 2, rows: 4}, minSize: {cols: 1, rows: 2}, maxSize: {cols: 4, rows: 40}},
  'charge-cost-tracker': {name: 'Charge Cost Tracker', category: 'charging', icon: 'DollarSign', defaultSize: {cols: 2, rows: 2}, minSize: {cols: 1, rows: 2}, maxSize: {cols: 4, rows: 40}},
  'charging-schedule': {name: 'Charging Schedule', category: 'charging', icon: 'Calendar', defaultSize: {cols: 2, rows: 2}, minSize: {cols: 1, rows: 2}, maxSize: {cols: 4, rows: 40}},
  'range-bar': {name: 'Range Bar', category: 'battery', icon: 'Gauge', defaultSize: {cols: 2, rows: 2}, minSize: {cols: 1, rows: 2}, maxSize: {cols: 4, rows: 40}},
  'energy-flow-animated': {name: 'Energy Flow Animated', category: 'energy', icon: 'Workflow', defaultSize: {cols: 2, rows: 4}, minSize: {cols: 2, rows: 4}, maxSize: {cols: 3, rows: 40}},
  'door-window-status': {name: 'Door & Window Status', category: 'security', icon: 'DoorOpen', defaultSize: {cols: 2, rows: 2}, minSize: {cols: 1, rows: 2}, maxSize: {cols: 4, rows: 40}},
  'sentry-event-log': {name: 'Sentry Event Log', category: 'security', icon: 'Eye', defaultSize: {cols: 2, rows: 4}, minSize: {cols: 2, rows: 4}, maxSize: {cols: 4, rows: 40}},
  'vehicle-hero-card': {name: 'Vehicle Hero Card', category: 'vehicle', icon: 'CreditCard', defaultSize: {cols: 2, rows: 2}, minSize: {cols: 1, rows: 2}, maxSize: {cols: 4, rows: 40}},
  'alert-feed': {name: 'Alert Feed', category: 'alerts', icon: 'Bell', defaultSize: {cols: 2, rows: 4}, minSize: {cols: 2, rows: 4}, maxSize: {cols: 4, rows: 40}},
  'command-quick-actions': {name: 'Quick Actions', category: 'commands', icon: 'Command', defaultSize: {cols: 2, rows: 2}, minSize: {cols: 1, rows: 2}, maxSize: {cols: 4, rows: 40}},
  'weather-at-car': {name: 'Weather at Car', category: 'climate', icon: 'CloudSun', defaultSize: {cols: 1, rows: 2}, minSize: {cols: 1, rows: 2}, maxSize: {cols: 3, rows: 40}},
  'tire-pressure-visual': {name: 'Tire Pressure Visual', category: 'tires', icon: 'CircleDot', defaultSize: {cols: 2, rows: 4}, minSize: {cols: 2, rows: 4}, maxSize: {cols: 4, rows: 40}},
  'climate-control-panel': {name: 'Climate Control Panel', category: 'climate', icon: 'Thermometer', defaultSize: {cols: 2, rows: 4}, minSize: {cols: 1, rows: 2}, maxSize: {cols: 4, rows: 40}},
  'recent-drives-list': {name: 'Recent Drives List', category: 'driving', icon: 'List', defaultSize: {cols: 2, rows: 4}, minSize: {cols: 1, rows: 4}, maxSize: {cols: 4, rows: 40}},
  'drive-efficiency-chart': {name: 'Drive Efficiency Chart', category: 'driving', icon: 'TrendingUp', defaultSize: {cols: 2, rows: 4}, minSize: {cols: 1, rows: 2}, maxSize: {cols: 4, rows: 40}},
  'drive-score-gauge': {name: 'Drive Score Gauge', category: 'driving', icon: 'Gauge', defaultSize: {cols: 1, rows: 2}, minSize: {cols: 1, rows: 2}, maxSize: {cols: 2, rows: 40}},
  'speed-heatmap': {name: 'Speed Heatmap', category: 'driving', icon: 'Grid3X3', defaultSize: {cols: 2, rows: 4}, minSize: {cols: 1, rows: 4}, maxSize: {cols: 4, rows: 40}},
  'battery-degradation-trend': {name: 'Battery Degradation Trend', category: 'battery', icon: 'TrendingUp', defaultSize: {cols: 2, rows: 4}, minSize: {cols: 1, rows: 2}, maxSize: {cols: 4, rows: 40}},
  'live-signal-sparklines': {name: 'Live Signal Sparklines', category: 'telemetry', icon: 'Activity', defaultSize: {cols: 2, rows: 4}, minSize: {cols: 2, rows: 4}, maxSize: {cols: 4, rows: 40}},
  'uptime-monitor': {name: 'Uptime Monitor', category: 'system', icon: 'HeartPulse', defaultSize: {cols: 2, rows: 2}, minSize: {cols: 1, rows: 2}, maxSize: {cols: 4, rows: 40}},
};

/** Native equivalent of web registry `getWidgetDef` (undefined for unknown id). */
function getWidgetDef(widgetId: string): WidgetDef | undefined {
  const seed = WIDGET_META[widgetId];
  if (!seed) {
    return undefined;
  }
  return {
    id: widgetId,
    name: seed.name,
    category: seed.category,
    glyph: ICON_GLYPHS[seed.icon] ?? '▫',
    defaultSize: seed.defaultSize,
    minSize: seed.minSize,
    maxSize: seed.maxSize,
  };
}

// ── Layout generation (web ../hooks/useDashboardLayout) ──────────────────────
const GRID_COLS = {lg: 4, md: 3, sm: 2, xs: 1} as const;

function clampMinMax(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Build an RGL layout item from a WidgetInstance + its WidgetDef, at column x. */
function buildLayoutItem(
  widget: WidgetInstance,
  cols: number,
  x: number,
  y: number,
): RGLLayout {
  const def = getWidgetDef(widget.widgetId);
  const defaultW = def?.defaultSize.cols ?? 1;
  const defaultH = def?.defaultSize.rows ?? 1;
  const minW = Math.min(def?.minSize.cols ?? 1, cols);
  const minH = def?.minSize.rows ?? 1;
  const maxW = Math.min(def?.maxSize.cols ?? cols, cols);
  const maxH = def?.maxSize.rows ?? 20;

  return {
    i: widget.id,
    x: x % cols,
    y,
    w: clampMinMax(Math.min(defaultW, cols), minW, maxW),
    h: clampMinMax(defaultH, minH, maxH),
    minW,
    minH,
    maxW,
    maxH,
  };
}

/** Build multi-breakpoint Layouts from a widget list (auto-flow placement). */
function buildDefaultLayouts(widgets: WidgetInstance[]): RGLLayouts {
  const layouts: RGLLayouts = {};
  for (const [bp, cols] of Object.entries(GRID_COLS)) {
    let x = 0;
    let y = 0;
    let rowMaxH = 0;
    const items: RGLLayout[] = [];

    for (const widget of widgets) {
      const item = buildLayoutItem(widget, cols, x, y);
      if (x + item.w > cols) {
        x = 0;
        y += rowMaxH;
        rowMaxH = 0;
        item.x = 0;
        item.y = y;
      }
      items.push(item);
      x += item.w;
      rowMaxH = Math.max(rowMaxH, item.h);
    }
    layouts[bp] = items;
  }
  return layouts;
}

function makePreset(
  id: string,
  name: string,
  widgetSpecs: {widgetId: string; config?: WidgetConfig}[],
  isDefault?: boolean,
): SavedDashboard {
  const widgets: WidgetInstance[] = widgetSpecs.map((spec, i) => ({
    id: `${id}-${i + 1}`,
    widgetId: spec.widgetId,
    config: spec.config,
  }));
  return {
    id,
    name,
    widgets,
    layouts: buildDefaultLayouts(widgets),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isDefault,
  };
}

const DEFAULT_DASHBOARD = makePreset(
  'default',
  'Default',
  [
    {widgetId: 'onboarding-checklist'},
    {widgetId: 'vehicle-hero'},
    {widgetId: 'battery-gauge'},
    {widgetId: 'climate-status'},
    {widgetId: 'recent-drives'},
    {widgetId: 'charge-status'},
    {widgetId: 'security-status'},
    {widgetId: 'quick-nav'},
  ],
  true,
);

export const DASHBOARD_PRESETS: SavedDashboard[] = [
  DEFAULT_DASHBOARD,
  makePreset('commuter', 'Daily Commuter', [
    {widgetId: 'battery-gauge'},
    {widgetId: 'range-estimate'},
    {widgetId: 'charge-status'},
    {widgetId: 'climate-status'},
    {widgetId: 'security-status'},
    {widgetId: 'location-map'},
    {widgetId: 'quick-nav'},
  ]),
  makePreset('fleet_manager', 'Fleet Manager', [
    {widgetId: 'fleet-stats'},
    {widgetId: 'recent-drives'},
    {widgetId: 'charge-history'},
    {widgetId: 'drive-score'},
    {widgetId: 'vehicle-hero'},
    {widgetId: 'quick-nav'},
  ]),
  makePreset('data_nerd', 'Data Nerd', [
    {widgetId: 'live-signals'},
    {widgetId: 'energy-flow'},
    {widgetId: 'vehicle-twin'},
    {widgetId: 'battery-gauge'},
    {widgetId: 'drive-score'},
  ]),
  makePreset('charging_focus', 'Charging Hub', [
    {widgetId: 'charge-status-live'},
    {widgetId: 'battery-radial-gauge'},
    {widgetId: 'charge-session-chart'},
    {widgetId: 'charge-cost-tracker'},
    {widgetId: 'charging-schedule'},
    {widgetId: 'range-bar'},
    {widgetId: 'energy-flow-animated'},
  ]),
  makePreset('security_monitor', 'Security Monitor', [
    {widgetId: 'door-window-status'},
    {widgetId: 'sentry-event-log'},
    {widgetId: 'location-map'},
    {widgetId: 'vehicle-hero-card'},
    {widgetId: 'alert-feed'},
    {widgetId: 'command-quick-actions'},
  ]),
  makePreset('road_trip', 'Road Trip', [
    {widgetId: 'battery-radial-gauge'},
    {widgetId: 'range-bar'},
    {widgetId: 'location-map'},
    {widgetId: 'weather-at-car'},
    {widgetId: 'tire-pressure-visual'},
    {widgetId: 'climate-control-panel'},
    {widgetId: 'recent-drives-list'},
    {widgetId: 'drive-efficiency-chart'},
  ]),
  makePreset('performance', 'Performance', [
    {widgetId: 'drive-score-gauge'},
    {widgetId: 'speed-heatmap'},
    {widgetId: 'drive-efficiency-chart'},
    {widgetId: 'battery-degradation-trend'},
    {widgetId: 'energy-flow-animated'},
    {widgetId: 'live-signal-sparklines'},
  ]),
  makePreset('kiosk_wall', 'Wall Display', [
    {widgetId: 'vehicle-hero'},
    {widgetId: 'battery-radial-gauge'},
    {widgetId: 'charge-status-live'},
    {widgetId: 'location-map'},
    {widgetId: 'weather-at-car'},
    {widgetId: 'uptime-monitor'},
  ]),
  makePreset('minimal', 'Minimal', [
    {widgetId: 'battery-radial-gauge'},
    {widgetId: 'charge-status'},
    {widgetId: 'climate-status'},
    {widgetId: 'quick-nav'},
  ]),
];

// ── Template descriptions keyed by preset ID ─────────────────────────────────
const TEMPLATE_DESCRIPTIONS: Record<string, {key: string; fallback: string}> = {
  default: {key: 'templates.default.desc', fallback: 'Balanced overview of vehicle status, battery, climate, and recent drives'},
  commuter: {key: 'templates.commuter.desc', fallback: 'Essentials for your daily drive — range, charging, climate, and security'},
  fleet_manager: {key: 'templates.fleetManager.desc', fallback: 'Fleet-wide metrics, drive history, and charging analytics'},
  data_nerd: {key: 'templates.dataNerd.desc', fallback: 'Live signals, energy flow, and deep telemetry data'},
  charging_focus: {key: 'templates.chargingFocus.desc', fallback: 'Focus on charging status, costs, and energy flow'},
  security_monitor: {key: 'templates.securityMonitor.desc', fallback: 'Keep an eye on doors, windows, sentry events, and location'},
  road_trip: {key: 'templates.roadTrip.desc', fallback: 'Everything you need for a long drive — range, weather, tires, and maps'},
  performance: {key: 'templates.performance.desc', fallback: 'Track driving performance, efficiency, and vehicle health'},
  kiosk_wall: {key: 'templates.kioskWall.desc', fallback: 'Clean layout designed for always-on screens and kiosk mode'},
  minimal: {key: 'templates.minimal.desc', fallback: 'Just the essentials — battery, charging, climate, and navigation'},
};

// ── Decorative glyph (lucide stand-in) ───────────────────────────────────────
function Glyph({
  glyph,
  style,
}: {
  glyph: string;
  style?: StyleProp<TextStyle>;
}): React.ReactElement {
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={style}>
      {glyph}
    </AppText>
  );
}

// ── MiniGridPreview (web ./MiniGridPreview) ──────────────────────────────────
function MiniGridPreview({
  dashboard,
  style,
}: {
  dashboard: SavedDashboard;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  const lgLayout = dashboard.layouts.lg ?? [];
  const cols = GRID_COLS.lg; // 4

  const maxY =
    lgLayout.length > 0
      ? Math.max(...lgLayout.map(l => l.y + l.h))
      : 2;

  // Guard against zero/NaN maxY.
  const safeMaxY = maxY > 0 && Number.isFinite(maxY) ? maxY : 2;

  return (
    <View style={[styles.previewRoot, {aspectRatio: cols / safeMaxY}, style]}>
      {lgLayout.map(item => {
        const widget = dashboard.widgets.find(w => w.id === item.i);
        const def = widget ? getWidgetDef(widget.widgetId) : undefined;
        const cellStyle: ViewStyle = {
          left: `${(item.x / cols) * 100}%`,
          top: `${(item.y / safeMaxY) * 100}%`,
          width: `${(item.w / cols) * 100}%`,
          height: `${(item.h / safeMaxY) * 100}%`,
        };
        return (
          <View key={item.i} style={[styles.previewCell, cellStyle]}>
            {def ? <Glyph glyph={def.glyph} style={styles.previewGlyph} /> : null}
          </View>
        );
      })}
    </View>
  );
}

// ── Template Detail View ─────────────────────────────────────────────────────
function TemplateDetail({
  template,
  onApply,
  onBack,
}: {
  template: SavedDashboard;
  onApply: () => void;
  onBack: () => void;
}): React.ReactElement {
  const {t} = useTranslation('dashboard');
  const desc = TEMPLATE_DESCRIPTIONS[template.id];

  return (
    <FadeIn>
      <View style={styles.detailStack}>
        <MiniGridPreview dashboard={template} style={styles.previewTall} />

        <View style={styles.detailHeader}>
          <AppText style={styles.detailTitle} weight="semibold">
            {t(`templates.${template.id}.name`, template.name)}
          </AppText>
          {desc ? (
            <AppText style={styles.detailDesc} tone="secondary">
              {t(desc.key, desc.fallback)}
            </AppText>
          ) : null}
          <AppText style={styles.detailCount} tone="muted">
            {t('templates.widgetCount', '{{count}} widgets', {
              count: template.widgets.length,
            })}
          </AppText>
        </View>

        <View style={styles.widgetGrid}>
          {template.widgets.map(w => {
            const def = getWidgetDef(w.widgetId);
            if (!def) {
              return null;
            }
            return (
              <View key={w.id} style={styles.widgetChip}>
                <Glyph glyph={def.glyph} style={styles.widgetChipGlyph} />
                <AppText
                  numberOfLines={1}
                  style={styles.widgetChipName}
                  tone="secondary">
                  {def.name}
                </AppText>
              </View>
            );
          })}
        </View>

        <View style={styles.detailActions}>
          <Pressable
            accessibilityLabel={t('common.back', 'Back')}
            accessibilityRole="button"
            onPress={onBack}
            style={({pressed}) => [
              styles.button,
              styles.ghostButton,
              pressed && styles.pressed,
            ]}>
            <Glyph glyph="←" style={styles.ghostButtonGlyph} />
            <AppText style={styles.ghostButtonText} weight="semibold">
              {t('common.back', 'Back')}
            </AppText>
          </Pressable>
          <Pressable
            accessibilityLabel={t('templates.apply', 'Use This Template')}
            accessibilityRole="button"
            onPress={onApply}
            style={({pressed}) => [
              styles.button,
              styles.primaryButton,
              pressed && styles.pressed,
            ]}>
            <Glyph glyph="✨" style={styles.primaryButtonGlyph} />
            <AppText style={styles.primaryButtonText} weight="semibold">
              {t('templates.apply', 'Use This Template')}
            </AppText>
          </Pressable>
        </View>
      </View>
    </FadeIn>
  );
}

// ── Unique category icons for a preset (web useCategoryIcons) ─────────────────
function useCategoryIcons(
  dashboard: SavedDashboard,
): {glyph: string; category: string}[] {
  return useMemo(() => {
    const seen = new Set<string>();
    const icons: {glyph: string; category: string}[] = [];
    for (const w of dashboard.widgets) {
      const def = getWidgetDef(w.widgetId);
      if (def && !seen.has(def.category)) {
        seen.add(def.category);
        icons.push({glyph: def.glyph, category: def.category});
      }
    }
    return icons.slice(0, 5); // max 5 category icons
  }, [dashboard.widgets]);
}

// ── Template Card ────────────────────────────────────────────────────────────
function TemplateCard({
  template,
  onPress,
}: {
  template: SavedDashboard;
  onPress: () => void;
}): React.ReactElement {
  const {t} = useTranslation('dashboard');
  const categoryIcons = useCategoryIcons(template);
  const desc = TEMPLATE_DESCRIPTIONS[template.id];
  const title = t(`templates.${template.id}.name`, template.name);

  return (
    <Pressable
      accessibilityLabel={title}
      accessibilityRole="button"
      onPress={onPress}
      style={({pressed}) => [styles.card, pressed && styles.cardPressed]}>
      {/* Preview */}
      <View style={styles.cardPreviewWrap}>
        <MiniGridPreview dashboard={template} />
      </View>

      {/* Info */}
      <View style={styles.cardInfo}>
        <View style={styles.cardInfoRow}>
          <AppText style={styles.cardTitle} weight="semibold">
            {title}
          </AppText>
          <Badge variant="neutral">{template.widgets.length}</Badge>
        </View>

        {desc ? (
          <AppText numberOfLines={2} style={styles.cardDesc} tone="muted">
            {t(desc.key, desc.fallback)}
          </AppText>
        ) : null}

        {/* Category icons */}
        <View style={styles.cardCatRow}>
          {categoryIcons.map(({glyph, category}) => (
            <View key={category} style={styles.catIconBox}>
              <Glyph glyph={glyph} style={styles.catIconGlyph} />
            </View>
          ))}
        </View>
      </View>
    </Pressable>
  );
}

// ── Main Gallery Component ────────────────────────────────────────────────────
export interface TemplateGalleryProps {
  open: boolean;
  onClose: () => void;
  onApply: (presetId: string) => void;
}

export function TemplateGallery({
  open,
  onClose,
  onApply,
}: TemplateGalleryProps): React.ReactElement {
  const {t} = useTranslation('dashboard');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedTemplate = selectedId
    ? DASHBOARD_PRESETS.find(p => p.id === selectedId) ?? null
    : null;

  const handleApply = (): void => {
    if (selectedId) {
      onApply(selectedId);
      setSelectedId(null);
    }
  };

  const handleClose = (): void => {
    setSelectedId(null);
    onClose();
  };

  const title = selectedTemplate
    ? t('templates.detail', 'Template Preview')
    : t('templates.title', 'Dashboard Templates');

  return (
    <Modal
      animationType="fade"
      onRequestClose={handleClose}
      transparent
      visible={open}>
      <View
        accessibilityLabel={title}
        accessibilityViewIsModal
        style={styles.overlay}>
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={handleClose}
          style={styles.backdrop}
        />

        <View style={styles.dialog} testID="template-gallery-modal">
          <View style={styles.dialogHeader}>
            <AppText
              numberOfLines={1}
              style={styles.dialogTitle}
              variant="title"
              weight="bold">
              {title}
            </AppText>
            <Pressable
              accessibilityLabel={t('common.close', 'Close')}
              accessibilityRole="button"
              onPress={handleClose}
              style={({pressed}) => [
                styles.closeButton,
                pressed && styles.pressed,
              ]}>
              <Glyph glyph="✕" style={styles.closeGlyph} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={styles.body}
            style={styles.bodyScroll}>
            {selectedTemplate ? (
              <TemplateDetail
                onApply={handleApply}
                onBack={() => setSelectedId(null)}
                template={selectedTemplate}
              />
            ) : (
              <StaggerContainer>
                {/* Blank option */}
                <StaggerItem>
                  <Pressable
                    accessibilityLabel={t(
                      'templates.blank',
                      'Blank Dashboard',
                    )}
                    accessibilityRole="button"
                    onPress={() => {
                      onApply('__blank__');
                      setSelectedId(null);
                    }}
                    style={({pressed}) => [
                      styles.blankButton,
                      pressed && styles.cardPressed,
                    ]}>
                    <View style={styles.blankIconBox}>
                      <Glyph glyph="▦" style={styles.blankIconGlyph} />
                    </View>
                    <View style={styles.blankTextWrap}>
                      <AppText style={styles.blankTitle} weight="semibold">
                        {t('templates.blank', 'Blank Dashboard')}
                      </AppText>
                      <AppText style={styles.blankDesc} tone="muted">
                        {t(
                          'templates.blank.desc',
                          'Start from scratch and add widgets manually',
                        )}
                      </AppText>
                    </View>
                  </Pressable>
                </StaggerItem>

                {/* Preset templates */}
                {DASHBOARD_PRESETS.map(preset => (
                  <StaggerItem key={preset.id}>
                    <TemplateCard
                      onPress={() => setSelectedId(preset.id)}
                      template={preset}
                    />
                  </StaggerItem>
                ))}
              </StaggerContainer>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

TemplateGallery.displayName = 'TemplateGallery';

const CARD_SURFACE = 'rgba(255, 255, 255, 0.02)';
const CARD_BORDER = 'rgba(255, 255, 255, 0.06)';

const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  blankButton: {
    alignItems: 'center',
    backgroundColor: CARD_SURFACE,
    borderColor: 'rgba(255, 255, 255, 0.10)',
    borderRadius: 12,
    borderStyle: 'dashed',
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
    padding: spacing.xl,
  },
  blankDesc: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  blankIconBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 8,
    padding: 10,
  },
  blankIconGlyph: {
    color: colors.textMuted,
    fontSize: 18,
    lineHeight: 22,
  },
  blankTextWrap: {
    flexShrink: 1,
  },
  blankTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 20,
  },
  body: {
    padding: spacing.lg,
  },
  bodyScroll: {
    flexGrow: 0,
  },
  button: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: spacing.md,
  },
  card: {
    backgroundColor: CARD_SURFACE,
    borderColor: CARD_BORDER,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  cardCatRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  cardDesc: {
    fontSize: 12,
    lineHeight: 16,
  },
  cardInfo: {
    gap: spacing.sm,
    padding: spacing.md,
  },
  cardInfoRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  cardPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  cardPreviewWrap: {
    padding: spacing.md,
    paddingBottom: 0,
  },
  cardTitle: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  catIconBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 4,
    padding: 4,
  },
  catIconGlyph: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 13,
  },
  closeButton: {
    alignItems: 'center',
    borderRadius: 10,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  closeGlyph: {
    color: colors.textSecondary,
    fontSize: 16,
  },
  detailActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
  detailCount: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  detailDesc: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 2,
  },
  detailHeader: {
    gap: 0,
  },
  detailStack: {
    gap: 16,
  },
  detailTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    lineHeight: 24,
  },
  dialog: {
    alignSelf: 'center',
    backgroundColor: '#0f1218',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 16,
    borderWidth: 1,
    maxHeight: '80%',
    maxWidth: 672,
    overflow: 'hidden',
    width: '94%',
  },
  dialogHeader: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  dialogTitle: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 18,
  },
  ghostButton: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  ghostButtonGlyph: {
    color: colors.textPrimary,
    fontSize: 13,
  },
  ghostButtonText: {
    color: colors.textPrimary,
    fontSize: 14,
  },
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  pressed: {
    opacity: 0.82,
  },
  previewCell: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderColor: 'rgba(255, 255, 255, 0.08)',
    borderRadius: 2,
    borderWidth: 1,
    justifyContent: 'center',
    padding: 2,
    position: 'absolute',
  },
  previewGlyph: {
    color: colors.textMuted,
    fontSize: 10,
    lineHeight: 12,
  },
  previewRoot: {
    backgroundColor: CARD_SURFACE,
    borderColor: CARD_BORDER,
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  },
  previewTall: {
    height: 192,
  },
  primaryButton: {
    backgroundColor: colors.accent,
  },
  primaryButtonGlyph: {
    color: colors.background,
    fontSize: 13,
  },
  primaryButtonText: {
    color: colors.background,
    fontSize: 14,
  },
  widgetChip: {
    alignItems: 'center',
    backgroundColor: CARD_SURFACE,
    borderColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    width: '48%',
  },
  widgetChipGlyph: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 14,
  },
  widgetChipName: {
    color: colors.textSecondary,
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 18,
  },
  widgetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
});

export default TemplateGallery;
