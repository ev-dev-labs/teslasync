// automations.ts — native parity port of
// web/src/features/dashboard/widgets/registry/automations.ts.
//
// The "automations" slice of the dashboard widget registry: a static
// `AUTOMATION_WIDGETS: WidgetDef[]` array describing the two automation widgets
// (automation-status, automation-history). Every id, name, description,
// category and size (defaultSize / minSize / maxSize) is preserved verbatim
// from the web source so the native registry slice carries identical metadata.
//
// Native adaptations vs. the web source (browser-only bits become native-safe):
//   - lucide-react `Workflow` / `PlayCircle` icons (web L2) -> native
//     `SemanticIconName` values (`'workflow'` / `'play'`); lucide is browser-only
//     and the SemanticIcon glyph table is the established native icon source.
//   - `../types` WidgetDef (web L3) -> the widget-registry types
//     (WidgetSize / WidgetConfig / WidgetProps / WidgetCategory / WidgetDef) are
//     reproduced self-contained here. `../types` is its own later manifest entry
//     and is not in the native tree yet, so it is inlined per the established
//     DashboardGrid / AuditLogWidget inline-reproduction precedent. The only
//     shape change is `icon: LucideIcon` -> `icon: SemanticIconName`.
//   - `lazy(() => import('../AutomationStatusWidget'))` /
//     `lazy(() => import('../AutomationHistoryWidget'))` (web L15 / L26) -> each
//     `component` is still a `React.lazy` `LazyExoticComponent<...>` (RN supports
//     React.lazy), but because the native AutomationStatusWidget /
//     AutomationHistoryWidget bodies are their own later manifest entries and do
//     not exist in the native tree yet, the lazy factory resolves — per
//     conversion-contract rule 7 — to an explicit "pending native conversion"
//     placeholder instead of a dynamic `import()` of a non-existent module. The
//     web code-split lazy shape is preserved so wiring a real native body later
//     is a one-line swap.
//
// The output path is a `.ts` file, so the placeholder is built with
// `React.createElement` rather than JSX. No DOM / lucide-react / Recharts /
// Leaflet / react-router / old web-UI imports reach the native output — only
// react, react-native primitives, the canonical AppText, the SemanticIcon name
// type, and theme tokens.

import {
  createElement,
  lazy,
  type ComponentType,
  type LazyExoticComponent,
} from 'react';
import {StyleSheet, View} from 'react-native';

import type {SemanticIconName} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {colors, spacing} from '../../../../../theme/tokens';

// ── Ported widget-registry types (web `../types`) ────────────────────────────

/** Grid footprint in cols/rows (web `../types` WidgetSize). */
interface WidgetSize {
  cols: number; // 1-4
  rows: number; // 1-8
}

/** Per-instance widget configuration (web `../types` WidgetConfig). */
interface WidgetConfig {
  vehicleId?: number;
  refreshRate?: number;
  chartType?: string;
  showTitle?: boolean;
  timeRange?: string;
  [key: string]: unknown;
}

/** Widget render props (web `../types` WidgetProps). */
interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: WidgetConfig;
}

/** Widget category union (web `../types` WidgetCategory). */
type WidgetCategory =
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
 * Widget definition (web `../types` WidgetDef). The web `icon: LucideIcon`
 * becomes `icon: SemanticIconName` (lucide is browser-only); `help` is unused by
 * this registry slice and omitted, matching the web source which never sets it.
 */
interface WidgetDef {
  id: string;
  name: string;
  description: string;
  icon: SemanticIconName;
  category: WidgetCategory;
  defaultSize: WidgetSize;
  minSize: WidgetSize;
  maxSize: WidgetSize;
  component: LazyExoticComponent<ComponentType<WidgetProps>>;
}

// ── Native-safe lazy widget body (conversion-contract rule 7) ────────────────
//
// The web registry lazy-imports each widget's own bundle. The native widget
// bodies are their own later manifest entries and are not in the native tree
// yet, so each `component` resolves — through the same React.lazy shape — to an
// explicit, named "pending native conversion" placeholder. This keeps the web
// `LazyExoticComponent` type intact while never importing a non-existent module.
function pendingWidgetBody(
  name: string,
): LazyExoticComponent<ComponentType<WidgetProps>> {
  const PendingWidgetBody: ComponentType<WidgetProps> = () =>
    createElement(
      View,
      {style: styles.pending},
      createElement(
        AppText,
        {variant: 'caption', tone: 'muted'},
        `${name} — native widget pending conversion`,
      ),
    );
  PendingWidgetBody.displayName = `PendingWidgetBody(${name})`;

  return lazy(() => Promise.resolve({default: PendingWidgetBody}));
}

export const AUTOMATION_WIDGETS: WidgetDef[] = [
  {
    id: 'automation-status',
    name: 'Automation Status',
    description:
      'Active automations: last run, success/fail badge, next scheduled',
    icon: 'workflow',
    category: 'automations',
    defaultSize: {cols: 2, rows: 4},
    minSize: {cols: 1, rows: 2},
    maxSize: {cols: 4, rows: 40},
    component: pendingWidgetBody('Automation Status'),
  },
  {
    id: 'automation-history',
    name: 'Automation History',
    description:
      'Recent automation runs: success/failure status, execution times',
    icon: 'play',
    category: 'automations',
    defaultSize: {cols: 2, rows: 4},
    minSize: {cols: 1, rows: 2},
    maxSize: {cols: 4, rows: 40},
    component: pendingWidgetBody('Automation History'),
  },
];

const styles = StyleSheet.create({
  pending: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
});
