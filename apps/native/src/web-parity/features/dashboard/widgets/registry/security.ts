// Native parity port of web/src/features/dashboard/widgets/registry/security.ts.
//
// The web file is a pure data module: it exports SECURITY_WIDGETS, the registry
// of 7 security dashboard tiles (id / name / description / icon / category /
// default+min+max grid size / lazy-loaded component). It is non-visual metadata,
// so the port keeps the array verbatim and only adapts the two non-native
// pieces:
//
//   * `icon` was a DOM-only lucide-react component (LucideIcon). Native renders
//     icons through the repo SemanticIcon system, so each lucide glyph is mapped
//     to its closest SemanticIconName and the field is retyped `SemanticIconName`
//     (Shield->security, DoorOpen->doorOpen, Eye->show, ShieldAlert->
//     securityAlert, AlertOctagon->alertCircle, Users->users).
//   * `component` was `lazy(() => import('../SomeWidget'))`. React.lazy + dynamic
//     import are native-safe, but none of the 7 security widget modules have a
//     native port today, so every entry resolves to a shared native-safe
//     "unavailable" placeholder (explicit unavailable state) and keeps a trailing
//     comment recording the web module each one maps to.
//
// `../types` has no native port yet, so the consumed types (WidgetSize,
// WidgetConfig, WidgetProps, WidgetCategory, WidgetHelp, WidgetDef) are mirrored
// field-for-field inline — exactly as the sibling native registry port
// (charging.ts) does — so this module stays self-contained. Only SECURITY_WIDGETS
// is exported, matching the source's single export.
//
// Line-by-line coverage of the source:
//   L1     `import { lazy } from 'react'` -> kept (lazy is native-safe); also
//          pull in createElement + the ComponentType/LazyExoticComponent types
//          for the inlined placeholder and the mirrored WidgetDef.component type.
//   L2     lucide-react icon imports (Shield/DoorOpen/Eye/ShieldAlert/
//          AlertOctagon/Users) -> dropped; replaced by the SemanticIconName
//          string mapping above (no DOM icon component).
//   L3     `import type { WidgetDef } from '../types'` -> mirrored inline below.
//   L5     `export const SECURITY_WIDGETS: WidgetDef[] = [` -> preserved verbatim.
//   L6-16  security-status (Shield->security, 1x2 / 1x2 / 2x40) -> ported;
//          component web ../SecurityStatusWidget (native port pending) ->
//          placeholder.
//   L17-27 door-window-status (DoorOpen->doorOpen, 2x2 / 1x2 / 4x40) -> ported;
//          ../DoorWindowStatusWidget pending -> placeholder.
//   L28-38 sentry-event-log (Eye->show, 2x4 / 2x4 / 4x40) -> ported;
//          ../SentryEventLogWidget pending -> placeholder.
//   L39-49 safety-features (ShieldAlert->securityAlert, 2x4 / 1x2 / 4x40) ->
//          ported; ../SafetyFeaturesWidget pending -> placeholder.
//   L50-60 safety-history (AlertOctagon->alertCircle, 2x4 / 2x4 / 4x40) ->
//          ported; ../SafetyHistoryWidget pending -> placeholder.
//   L61-71 guard-mode (Shield->security, 2x4 / 1x2 / 4x40) -> ported;
//          ../GuardModeWidget pending -> placeholder.
//   L72-82 vehicle-access (Users->users, 2x4 / 1x2 / 4x40) -> ported;
//          ../VehicleAccessWidget pending -> placeholder.
//   L83    closing `];` -> preserved.
//
// No DOM, no lucide-react, no Recharts/Leaflet, and no web UI components are
// imported — only React.lazy/createElement plus existing apps/native primitives,
// components and tokens.

import {
  createElement,
  lazy,
  type ComponentType,
  type LazyExoticComponent,
} from 'react';
import { StyleSheet, View } from 'react-native';

import type { SemanticIconName } from '../../../../../components/icons/SemanticIcon';
import { AppText } from '../../../../../components/ui/AppText';
import { colors, spacing } from '../../../../../theme/tokens';

/* ------------------------------------------------------------------ */
/*  ./types mirror (no native port yet)                                */
/* ------------------------------------------------------------------ */

// Mirrored field-for-field from web ./types so the registry stays self-contained.
interface WidgetSize {
  cols: number;
  rows: number;
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
  learnMore?: { url: string; label?: string };
}

// `icon` is retyped from lucide's LucideIcon to the repo SemanticIconName so the
// native dashboard host can render it via <SemanticIcon name={icon} />.
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
  help?: WidgetHelp;
}

/* ------------------------------------------------------------------ */
/*  Native-safe "unavailable" placeholder (explicit unavailable state) */
/* ------------------------------------------------------------------ */

// Stand-in for the 7 security widgets whose native component is not ported yet.
// React.lazy + dynamic import are native-safe, but the target modules do not
// exist, so the registry points those entries at this placeholder. Built with
// createElement (not JSX) because the required output file is a `.ts` module.
const UNAVAILABLE_LABEL = 'Widget unavailable in native';

const NativeUnavailableWidget: ComponentType<WidgetProps> =
  function NativeUnavailableWidget() {
    return createElement(
      View,
      { style: styles.unavailable },
      createElement(
        AppText,
        { variant: 'caption', tone: 'muted', style: styles.unavailableText },
        UNAVAILABLE_LABEL,
      ),
    );
  };

const UNAVAILABLE_WIDGET: LazyExoticComponent<ComponentType<WidgetProps>> =
  lazy(async () => ({ default: NativeUnavailableWidget }));

/* ------------------------------------------------------------------ */
/*  Registry data (ported verbatim from the source array)              */
/* ------------------------------------------------------------------ */

export const SECURITY_WIDGETS: WidgetDef[] = [
  {
    id: 'security-status',
    name: 'Security',
    description: 'Lock, sentry, doors, windows status',
    icon: 'security',
    category: 'security',
    defaultSize: { cols: 1, rows: 2 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 2, rows: 40 },
    component: UNAVAILABLE_WIDGET, // web: ../SecurityStatusWidget (native port pending)
  },
  {
    id: 'door-window-status',
    name: 'Door & Window Status',
    description:
      'Grid showing 4 doors + 4 windows with open/closed/partial badges',
    icon: 'doorOpen',
    category: 'security',
    defaultSize: { cols: 2, rows: 2 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: UNAVAILABLE_WIDGET, // web: ../DoorWindowStatusWidget (native port pending)
  },
  {
    id: 'sentry-event-log',
    name: 'Sentry Event Log',
    description: 'Recent sentry events with timestamps',
    icon: 'show',
    category: 'security',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 2, rows: 4 },
    maxSize: { cols: 4, rows: 40 },
    component: UNAVAILABLE_WIDGET, // web: ../SentryEventLogWidget (native port pending)
  },
  {
    id: 'safety-features',
    name: 'Safety Features',
    description:
      'ADAS status: autopilot, collision warning, lane departure, blind spot',
    icon: 'securityAlert',
    category: 'security',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: UNAVAILABLE_WIDGET, // web: ../SafetyFeaturesWidget (native port pending)
  },
  {
    id: 'safety-history',
    name: 'Safety History',
    description:
      'ADAS event timeline: collision warnings, AEB, lane departures, disengagements',
    icon: 'alertCircle',
    category: 'security',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 2, rows: 4 },
    maxSize: { cols: 4, rows: 40 },
    component: UNAVAILABLE_WIDGET, // web: ../SafetyHistoryWidget (native port pending)
  },
  {
    id: 'guard-mode',
    name: 'Guard Mode',
    description: 'Anti-theft guard status, recent security events, panic button',
    icon: 'security',
    category: 'security',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: UNAVAILABLE_WIDGET, // web: ../GuardModeWidget (native port pending)
  },
  {
    id: 'vehicle-access',
    name: 'Vehicle Access',
    description: 'Authorized drivers, pending invitations, mobile access status',
    icon: 'users',
    category: 'security',
    defaultSize: { cols: 2, rows: 4 },
    minSize: { cols: 1, rows: 2 },
    maxSize: { cols: 4, rows: 40 },
    component: UNAVAILABLE_WIDGET, // web: ../VehicleAccessWidget (native port pending)
  },
];

const styles = StyleSheet.create({
  unavailable: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surfaceRaised,
  },
  unavailableText: {
    textAlign: 'center',
  },
});
