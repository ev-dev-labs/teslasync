// Native parity port of web/src/features/dashboard/widgets/registry/alerts.ts.
//
// The web file is a pure widget-registry data module: it exports
// `ALERT_WIDGETS: WidgetDef[]`, the two "alerts" category dashboard widgets
// (`alert-feed` + `notification-stats`). It carries no UI of its own — every
// entry is metadata (id / name / description / icon / category / size bounds)
// plus a `React.lazy(() => import('../<Widget>'))` reference used for
// code-splitting. Behaviour/metadata is preserved 1:1 (conversion rule 3):
// both entries keep their verbatim id, name, description, category 'alerts',
// and defaultSize / minSize / maxSize (alert-feed 2x4 / 2x4 / 4x40,
// notification-stats 2x2 / 1x2 / 4x40).
//
// Web/DOM-only deps mapped native-safe + documented (rules 4/5/7):
//   - `lucide-react` `Bell` (source L2) -> there is no `react-native-svg`
//     dependency in the native app, so the lucide icon cannot render as an SVG
//     component. The source field name `icon` is kept, but it now holds a
//     decorative glyph string '🔔' — the exact `Bell -> '🔔'` mapping the
//     sibling `dashboard/components/TemplateGallery` ICON_GLYPHS table already
//     uses, so the icon intent stays consistent + auditable across the parity
//     layer.
//   - `../types` `WidgetDef` (source L3) is NOT yet ported to the native parity
//     layer, so the `WidgetDef` contract (+ its `WidgetSize` / `WidgetConfig` /
//     `WidgetProps` / `WidgetCategory` / `WidgetHelp` deps) is reproduced and
//     exported locally — the same self-contained approach the sibling widget
//     ports (FleetStats / QuickNav / AnomalyDetector) use for `./types`
//     `WidgetProps`. The only field that changes shape is `icon`
//     (LucideIcon -> glyph string, see above); every other field matches the
//     web `../types` `WidgetDef` verbatim.
//   - `React.lazy(() => import('../AlertFeedWidget'))` /
//     `import('../NotificationStatsWidget')` (source L15 / L26): the native
//     `AlertFeedWidget` / `NotificationStatsWidget` widgets are NOT yet ported
//     (they are converted in their own file-by-file passes). A `lazy()` import
//     of a not-yet-existent native module would not type-check, so each lazy
//     ref instead resolves — via the same `React.lazy` code-split shape and the
//     same `LazyExoticComponent<ComponentType<WidgetProps>>` type — to an
//     explicit native-safe "unavailable" placeholder that names the intended
//     widget (rule 7). When those widgets are ported, a future pass swaps the
//     placeholder factory for the real native `import()`.
//
// No DOM elements, Recharts, Leaflet, framer-motion, lucide-react, or old web
// UI components are imported — only `react` (lazy/createElement), the RN
// primitives (View/StyleSheet), and the native app `AppText`.

import React, { lazy } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '../../../../../components/ui/AppText';

// ── Native-safe WidgetDef contract (web ../types not yet ported) ─────────────
// Reproduced from web/src/features/dashboard/widgets/types.ts. Field shapes are
// verbatim except `icon`, which becomes a decorative glyph string on native
// (the lucide SVG component has no native analog — see the header note).

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

export interface WidgetHelp {
  text?: string;
  i18nKey?: string;
  defaultValue?: string;
  learnMore?: { url: string; label?: string };
}

export interface WidgetDef {
  id: string;
  name: string;
  description: string;
  /**
   * Decorative glyph stand-in for the web lucide `icon` (no react-native-svg).
   * Web type was `LucideIcon`; native carries the mapped glyph string.
   */
  icon: string;
  category: WidgetCategory;
  defaultSize: WidgetSize;
  minSize: WidgetSize;
  maxSize: WidgetSize;
  component: LazyExoticComponent<ComponentType<WidgetProps>>;
  help?: WidgetHelp;
}

// ── lucide `Bell` glyph stand-in ─────────────────────────────────────────────
// Matches the TemplateGallery ICON_GLYPHS `Bell: '🔔'` mapping.
const BELL_GLYPH = '🔔';

// ── Native-safe lazy placeholder (rule 7) ────────────────────────────────────
// Stands in for `lazy(() => import('../<Widget>'))` until the native widget is
// ported. Renders an explicit "unavailable" state naming the intended widget,
// so the absence is surfaced (never silently blank) if the registry entry is
// ever mounted on native.
function makeUnavailableWidget(
  widgetName: string,
): ComponentType<WidgetProps> {
  function UnavailableWidget(_props: WidgetProps) {
    return React.createElement(
      View,
      { style: styles.placeholder },
      React.createElement(
        AppText,
        { tone: 'muted', variant: 'caption', style: styles.placeholderText },
        `${widgetName} unavailable on native`,
      ),
    );
  }
  UnavailableWidget.displayName = `Unavailable(${widgetName})`;
  return UnavailableWidget;
}

const AlertFeedWidget = lazy(async () => ({
  default: makeUnavailableWidget('AlertFeedWidget'),
}));

const NotificationStatsWidget = lazy(async () => ({
  default: makeUnavailableWidget('NotificationStatsWidget'),
}));

export const ALERT_WIDGETS: WidgetDef[] = [
  {
    id: 'alert-feed',
    name: 'Alert Feed',
    description: 'Recent alerts reverse-chronological with severity badges',
    icon: BELL_GLYPH,
    category: 'alerts',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 2, rows: 4 },
    maxSize: { cols: 4, rows: 40 },
    component: AlertFeedWidget,
  },
  {
    id: 'notification-stats',
    name: 'Notification Stats',
    description:
      'Notification delivery rate, active channels, recent delivery log',
    icon: BELL_GLYPH,
    category: 'alerts',
    defaultSize: { cols: 2, rows: 2 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: NotificationStatsWidget,
  },
];

const styles = StyleSheet.create({
  placeholder: {
    flex: 1,
    minHeight: 64,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  placeholderText: {
    textAlign: 'center',
  },
});
