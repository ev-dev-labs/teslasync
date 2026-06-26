// Native parity port of web/src/features/dashboard/widgets/registry/commands.ts.
//
// Registry data module: exports COMMAND_WIDGETS, the ordered list of
// "commands"-category dashboard widget definitions (Quick Actions + Command
// History). It is pure metadata — id / name / description / category, the
// default/min/max grid-size constraints, a per-widget icon, and a lazily-loaded
// widget component. The web file imports three things that are unavailable in
// the React Native parity manifest (contract rules 4, 5 & 7); each is replaced
// with a native-safe equivalent and documented here + in the sidecar:
//
//   - react `lazy` (web L1) is kept verbatim — React.lazy + Suspense work in
//     React Native, so the registry keeps lazily-resolved widget components.
//   - lucide-react `Command` + `Terminal` (web L2, L10, L21) have no native SVG
//     renderer, so the icon field is typed as the shared native SemanticIcon
//     name union and each definition keeps an equivalent semantic glyph:
//     `Command` (the quick-command key, on the "Quick Actions" command grid) ->
//     'bolt' (quick-action intent) and `Terminal` -> 'terminal' (direct match;
//     the command history reads like a terminal log).
//   - `../types` `WidgetDef` (web L3) is inlined below together with the
//     supporting WidgetSize / WidgetConfig / WidgetProps / WidgetCategory /
//     WidgetHelp types it depends on (the established widget-port pattern of
//     inlining the consumed type surface). Only `icon` diverges from the web
//     type (LucideIcon -> SemanticIconName); `component` stays a
//     LazyExoticComponent<ComponentType<WidgetProps>>.
//   - the lazily-imported sibling widgets `../CommandQuickActionsWidget` and
//     `../CommandHistoryWidget` (web L15, L26) are not yet present in the native
//     parity tree, so importing them would fail the typecheck gate. Each lazy()
//     therefore resolves to a native-safe UnavailableNotice placeholder that
//     renders an explicit "unavailable in the native build" state until those
//     two widget files are converted, at which point the lazy() factories should
//     be repointed at them. Widget ids, ordering, sizes and all other metadata
//     are preserved verbatim.
//
// No DOM-only modules, HTML elements, lucide-react, Recharts, Leaflet, or web
// @/ UI components are imported -- only react + react-native primitives and the
// shared native SemanticIcon / AppText / theme tokens.

import React, {
  lazy,
  type ComponentType,
  type LazyExoticComponent,
} from 'react';
import {StyleSheet, View} from 'react-native';

import {
  SemanticIcon,
  type SemanticIconName,
} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {colors, spacing} from '../../../../../theme/tokens';

// ── Inlined native port of the `../types` WidgetDef surface this registry uses ──
interface WidgetSize {
  cols: number; // 1-4
  rows: number; // 1-8
}

interface WidgetConfig {
  vehicleId?: number;
  refreshRate?: number;
  chartType?: string;
  showTitle?: boolean;
  timeRange?: string;
  [key: string]: unknown;
}

interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: WidgetConfig;
}

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

interface WidgetHelp {
  text?: string;
  i18nKey?: string;
  defaultValue?: string;
  learnMore?: {url: string; label?: string};
}

interface WidgetDef {
  id: string;
  name: string;
  description: string;
  // Web uses lucide-react's LucideIcon; native uses the SemanticIcon name union.
  icon: SemanticIconName;
  category: WidgetCategory;
  defaultSize: WidgetSize;
  minSize: WidgetSize;
  maxSize: WidgetSize;
  component: LazyExoticComponent<ComponentType<WidgetProps>>;
  help?: WidgetHelp;
}

// ── Native-safe placeholder for the not-yet-converted command widgets ──
function UnavailableNotice({label}: {label: string}) {
  return React.createElement(
    View,
    {style: styles.unavailable},
    React.createElement(SemanticIcon, {
      name: 'helpCircle',
      size: 'md',
      decorative: true,
    }),
    React.createElement(
      AppText,
      {variant: 'caption', tone: 'muted', style: styles.unavailableLabel},
      `${label} is unavailable in the native build`,
    ),
  );
}

const CommandQuickActionsWidgetUnavailable: ComponentType<WidgetProps> = () =>
  React.createElement(UnavailableNotice, {label: 'Quick Actions'});

const CommandHistoryWidgetUnavailable: ComponentType<WidgetProps> = () =>
  React.createElement(UnavailableNotice, {label: 'Command History'});

export const COMMAND_WIDGETS: WidgetDef[] = [
  {
    id: 'command-quick-actions',
    name: 'Quick Actions',
    description:
      'Grid of command buttons: Lock, Unlock, Climate, Frunk, Horn, Flash',
    icon: 'bolt',
    category: 'commands',
    defaultSize: {cols: 2, rows: 2},
    minSize: {cols: 1, rows: 2},
    maxSize: {cols: 4, rows: 40},
    component: lazy(() =>
      Promise.resolve({default: CommandQuickActionsWidgetUnavailable}),
    ),
  },
  {
    id: 'command-history',
    name: 'Command History',
    description:
      'Recent vehicle commands: lock, unlock, climate — with success/fail status',
    icon: 'terminal',
    category: 'commands',
    defaultSize: {cols: 2, rows: 4},
    minSize: {cols: 1, rows: 2},
    maxSize: {cols: 4, rows: 40},
    component: lazy(() =>
      Promise.resolve({default: CommandHistoryWidgetUnavailable}),
    ),
  },
];

const styles = StyleSheet.create({
  unavailable: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
  },
  unavailableLabel: {
    textAlign: 'center',
  },
});
