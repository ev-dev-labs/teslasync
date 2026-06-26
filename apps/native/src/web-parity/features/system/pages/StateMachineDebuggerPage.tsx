// StateMachineDebuggerPage — native parity port of
// web/src/features/system/pages/StateMachineDebuggerPage.tsx.
//
// Multi-FSM transition analysis surface (vehicle / telemetry-connection plus
// drive/charge sub-FSMs). It reads the live vehicle state, FSM stats, and a
// calendar-windowed transition log, then renders ten sections: page filters,
// FSM health, the AI narrator, the live vehicle-state hero, active sub-FSMs, a
// Live/Freeze/Step timeline + snapshot inspector, a state diagram, a
// distribution donut + transition-count table, four summary stat cards, a
// transitions-over-time chart, a paginated transition log, and a selected
// transition detail panel. Every React state name, API path, derived-data
// computation, handler, and i18n key from the web source is preserved.
//
// Native adaptations vs. the web source (behavior/state/keys/intent kept):
//   - react-i18next `useTranslation` -> a native-safe t(key, default?, values?)
//     fallback. The en.json fsm.* / debugger.* / stateMachineDebugger.* /
//     help.fsm.* subtrees are embedded verbatim so the rendered English (and
//     {{count}}/{{n}}/{{range}}/{{rel}}/… interpolation) matches the web exactly;
//     every web key is preserved as the first t() argument.
//   - react-router-dom `useSearchParams` (initial fsm/selected/at reads + the
//     permalink sync effect + window.location permalink) -> a native-safe
//     in-memory params shim. Native has no URL bar, so the permalink CopyButton
//     is absent (web rendered it only when window.location existed) and the sync
//     effect is a documented no-op that preserves the same dependency list.
//   - `@/hooks/useSelectedVehicle` (router/store backed) -> useVehicles() + a
//     local selected-id state that defaults to the first vehicle (the same
//     precedence tail the web hook falls back to; URL/store precedence is
//     native-safe-dropped and documented).
//   - `@/hooks/useRangeState` + `@/lib/timezone` (URL/localStorage/calendar
//     RangePicker) -> an in-memory preset range state (default 7d) with
//     device-local day→instant bucketing; the canonical RangePicker calendar is
//     represented by a preset Select (24h/7d/30d/90d/All), preserving start/end,
//     startInstant/endInstantExclusive, the `hours` derivation, and the
//     half-open [start,end) API window.
//   - `@/components/layout` PageContainer/Grid -> inline RN PageScaffold + gapped
//     stacks; `@/components/ui` GlassPanel/Button/Select/DataTable/Pagination/
//     HelpTooltip/CopyButton + `@/components/data-display` StatCard/TimeStamp +
//     `@/components/feedback` Skeleton/EmptyState -> the canonical native
//     GlassPanel + AppText, the already-ported native Select, and inline native
//     Button/Badge/EmptyState/StatCard/Pagination/Toggle/HelpTooltip/TimeStamp.
//   - `@/components/charts` ChartContainer/PieChart/Pie/Cell/ResponsiveContainer/
//     Tooltip (Recharts) -> native-safe renderings: the state-distribution donut
//     is a colored legend list (same per-state counts + CHART_COLORS), and the
//     FSMTimelineChart stacked area is a native bucketed bar list (same bucketing
//     logic). Recharts is browser-only.
//   - lucide-react icons (RefreshCw/ChevronDown/ChevronRight/Activity/Zap/
//     AlertTriangle and the Car/Zap/Timer/RotateCw used by sub-panels) ->
//     SemanticIcon glyphs.
//   - `@/lib/cn` Tailwind merge dropped (native uses StyleSheet + tokens);
//     `@/lib/numberFormat` fmtInt and the FSM theme `getStateColor` are ported
//     inline as native-safe helpers returning RN color values.
//   - The sibling sub-components (StateBadge / FSMHealthPanel+computeFlapIds /
//     FSMSubFSMPanel / FSMStateDiagram / FSMTimelineChart / state-machine
//     StateTimeline+LiveControls+SnapshotInspector+windowTransitions) are not yet
//     ported as standalone native modules, so each is reproduced inline here with
//     its pure logic ported verbatim and its visual intent preserved. The AI
//     narrator IS already ported and is imported from the native parity module.
//   - The web CopyButton (clipboard) on the snapshot inspector -> Share.share of
//     the same JSON payload (no clipboard module is wired in this build; the same
//     primitive the sibling DiagnosticPage/LiveLogsPage use).
//
// No DOM/react-router/react-i18next/lucide/Recharts/Leaflet/framer-motion/
// old-web-UI import reaches the native output — only react, react-native
// primitives, the canonical AppText/GlassPanel/SemanticIcon + theme tokens, the
// native parity Select / StaggerContainer / AIStateMachineDebuggerNarrator, and
// the native parity API hooks + shared types.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import {
  SemanticIcon,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import { AppText } from '../../../../components/ui/AppText';
import { GlassPanel } from '../../../../components/ui/GlassPanel';
import { colors, spacing } from '../../../../theme/tokens';
import { Select } from '../../../components/ui/Select';
import { AIStateMachineDebuggerNarrator } from '../../../components/ai/AIStateMachineDebuggerNarrator';
import { useVehicleStateMachine } from '../../../api/hooks/useAdmin';
import {
  useFSMStats,
  useFSMTransitions,
  type FSMTransition,
  type FSMType,
} from '../../../api/hooks/useFSM';
import {
  useSignalSnapshot,
  type SignalSnapshotResponse,
  type SignalSourceLayer,
} from '../../../api/hooks/useTelemetry';
import { useVehicles } from '../../../api/hooks/useVehicles';
import type { VehicleState } from '../../../api/types';

// ── Native-safe i18n fallback (web react-i18next useTranslation) ─────────────
//
// The web app renders the en.json fsm.* / debugger.* / stateMachineDebugger.* /
// help.fsm.* resource bundle (the inline source defaults are dead fallbacks
// that never fire because the keys exist). To match the web UI exactly, those
// subtrees are embedded verbatim. `t` resolves the embedded value first, then a
// call-site default (string arg OR a `defaultValue` property on the values
// object, the i18next convention), then the key; it interpolates {{name}}
// placeholders and selects the `_other` plural form when an interpolation
// `count` is not exactly 1 (mirroring i18next).

type TranslationValues = Record<string, string | number>;

const FSM_EN: Record<string, string> = {
  'debugger.controls.buffered': '{{n}} buffered',
  'debugger.controls.bufferedDual': '{{inWindow}} in window · {{total}} in 24 h',
  'debugger.controls.bufferedTooltip':
    'Counts inside the {{minutes}}-minute Window dropdown. {{outside}} more transitions fetched in the last 24 h.',
  'debugger.controls.clear': 'Clear buffer',
  'debugger.controls.freeze': 'Freeze',
  'debugger.controls.live': 'Live',
  'debugger.controls.stepNext': 'Step to next transition',
  'debugger.controls.stepPrev': 'Step to previous transition',
  'debugger.controls.window': 'Window',
  'debugger.inspector.copy': 'Copy snapshot',
  'debugger.inspector.diffMode': 'Diff vs previous',
  'debugger.inspector.duration': 'Duration',
  'debugger.inspector.empty': 'Select a transition to inspect its snapshot',
  'debugger.inspector.emptyOutsideWindow':
    'Nothing in the current window. Last transition {{rel}}.',
  'debugger.inspector.from': 'From',
  'debugger.inspector.jumpToLast': 'Jump to last transition',
  'debugger.inspector.loading': 'Loading…',
  'debugger.inspector.noSignals': 'No signals captured for this transition',
  'debugger.inspector.signalsTitle': 'Signals at transition',
  'debugger.inspector.title': 'Transition snapshot',
  'debugger.inspector.to': 'To',
  'debugger.inspector.trigger': 'Trigger',
  'debugger.share': 'Share permalink',
  'debugger.timeline.empty': 'No transitions in window',
  'debugger.timeline.jumpToLast': 'Jump to last transition',
  'debugger.timeline.lastSeen': 'Last transition {{rel}}',
  'debugger.timeline.tickAria': '{{from}} to {{to}}',
  'debugger.timeline.widenTo': 'Widen window to {{label}}',
  'debugger.timeline.windowLabel': 'Window: {{minutes}} min',
  'debugger.window.day': '24 h',
  'debugger.window.hours': '{{n}} h',
  'debugger.window.minutes': '{{n}} min',
  'fsm.activeCharge': 'Charge Session',
  'fsm.activeDrive': 'Drive Session',
  'fsm.autoRefresh': 'Live 10s',
  'fsm.avgInterval': 'Avg Interval',
  'fsm.col.count': 'Count',
  'fsm.col.state': 'State',
  'fsm.count': 'Transitions',
  'fsm.currentState': 'Current State',
  'fsm.detail.context': 'Context Snapshot',
  'fsm.detail.duration': 'Duration in State',
  'fsm.detail.from': 'From State',
  'fsm.detail.guard': 'Guard',
  'fsm.detail.id': 'Transition ID',
  'fsm.detail.instanceId': 'Instance ID',
  'fsm.detail.timestamp': 'Timestamp',
  'fsm.detail.to': 'To State',
  'fsm.detail.trigger': 'Trigger',
  'fsm.detail.vehicleId': 'Vehicle ID',
  'fsm.detailTitle': 'Transition Detail',
  'fsm.distributionByState': 'State Distribution',
  'fsm.flapCount': 'Flap Warnings',
  'fsm.from': 'From',
  'fsm.fsmType': 'FSM Type',
  'fsm.health.allClear':
    'All FSMs healthy — no flapping, stuck sessions, or recoveries detected',
  'fsm.health.flapping':
    '{{count}} transitions flagged as state flapping (>5 same-FSM transitions/min)',
  'fsm.health.flapTitle': 'State Flapping',
  'fsm.health.recoveries': '{{count}} session(s) recovered after pod restart',
  'fsm.health.recoveryTitle': 'Pod Recoveries',
  'fsm.health.stuck': '{{count}} session(s) stuck in pending/active for >4 hours',
  'fsm.health.stuckTitle': 'Stuck Sessions',
  'fsm.health.title': 'FSM Health',
  'fsm.mode': 'Mode',
  'fsm.noState': 'No state data available',
  'fsm.noStats': 'No transition data recorded',
  'fsm.noSubFSMs': 'No active drive or charge sessions',
  'fsm.noTimeline': 'No transitions in selected time range',
  'fsm.noTimelineData': 'No transition data for timeline',
  'fsm.noTransitions': 'No transitions recorded',
  'fsm.noTransitionsInRange':
    'No transitions in {{range}}. Try expanding the time range.',
  'fsm.noVehicles': 'No vehicles available',
  'fsm.perPage': 'Per Page',
  'fsm.selectFsmType': 'Select a specific FSM type to view its state diagram',
  'fsm.since': 'Since',
  'fsm.state': 'State',
  'fsm.stateDiagram': 'State Diagram',
  'fsm.subFSMs': 'Active Sub-FSMs',
  'fsm.subtitle':
    'Multi-FSM transition analysis — vehicle, drive, charge, command, notification',
  'fsm.time': 'Time',
  'fsm.timelineChart': 'Transitions Over Time',
  'fsm.timelineTitle': 'Transition Log',
  'fsm.timeRange': 'Time Range',
  'fsm.title': 'FSM Debugger',
  'fsm.to': 'To',
  'fsm.total': 'total',
  'fsm.totalOnPage': 'Transitions (Page)',
  'fsm.totalTransitions': 'Total Transitions',
  'fsm.transitionCounts': 'Transition Counts',
  'fsm.trigger': 'Trigger',
  'fsm.type': 'FSM Type',
  'fsm.vehicle': 'Vehicle',
  'fsm.vehicleLiveState': 'Vehicle Live State',
  'fsm.viewDetail': 'View detail',
  'help.fsm.liveState':
    'The current state the FSM resolved to from the most recent telemetry. The FSM stays in a terminal state until external evidence (telemetry or poll) triggers an explicit transition out.',
  'help.fsm.type':
    'Finite-state machine. Tracks vehicle high-level state (driving, charging, parked, online, asleep, offline) and the transitions between them. Sub-FSMs cover drive, charge, command, and notification lifecycles.',
  'stateMachineDebugger.aiNarrator.badge': 'Helix',
  'stateMachineDebugger.aiNarrator.button': 'Narrate transitions',
  'stateMachineDebugger.aiNarrator.description':
    'Get a 3-6 sentence factual narration of the current vehicle FSM transition trace. The narrator reads only the deterministic FSM envelope (vehicle id, window bounds, per-FSM-name counts, per-edge counts, flap count, transition stream) — VINs, coordinates, place names, IPs, and personal identifiers are redacted before the message reaches the provider. The narration is informational; the transition table, state diagram, and FSM health panel above remain the canonical raw view.',
  'stateMachineDebugger.aiNarrator.emptyHint':
    'Select a vehicle and a valid time window first.',
  'stateMachineDebugger.aiNarrator.title': 'Helix FSM narrator',
};

function interpolate(template: string, values?: TranslationValues): string {
  if (!values) {
    return template;
  }
  return template.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(values, name)
      ? String(values[name])
      : match,
  );
}

type NativeTFunction = (
  key: string,
  defaultOrValues?: string | TranslationValues,
  maybeValues?: TranslationValues,
) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((key, defaultOrValues, maybeValues) => {
    const stringDefault =
      typeof defaultOrValues === 'string' ? defaultOrValues : undefined;
    const values =
      typeof defaultOrValues === 'string' ? maybeValues : defaultOrValues;
    // i18next convention: a `defaultValue` key on the values object is the
    // fallback when the key is missing (used by the page's `.aria` keys and the
    // empty-range message).
    const objectDefault =
      values && typeof values.defaultValue === 'string'
        ? (values.defaultValue as string)
        : undefined;

    let lookupKey = key;
    if (values && typeof values.count === 'number' && values.count !== 1) {
      const pluralKey = `${key}_other`;
      if (FSM_EN[pluralKey] != null) {
        lookupKey = pluralKey;
      }
    }

    const template =
      FSM_EN[lookupKey] ?? stringDefault ?? objectDefault ?? key;
    return interpolate(template, values);
  }, []);
}

// ── Native-safe usePageTitle (web @/hooks/usePageTitle) ──────────────────────

/**
 * Web `usePageTitle` writes `"{title} — TeslaSync"` to `document.title`. React
 * Native has no browser tab / document title, so this is a no-op that preserves
 * the call site and argument.
 */
function usePageTitle(title: string): void {
  useEffect(() => {
    // No document.title on native — intentional no-op mirroring the web hook's
    // `title` dependency so it re-runs on title changes.
  }, [title]);
}

// ── numberFormat fmtInt (web @/lib/numberFormat) ─────────────────────────────

/** Integer with locale separators: fmtInt(12345.6) → "12,346". */
function fmtInt(v: unknown): string {
  const n = typeof v === 'number' && isFinite(v) ? v : 0;
  try {
    return n.toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  } catch {
    return String(Math.round(n));
  }
}

/** Duration helper ported verbatim from the web source (L58-64). */
function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${fmtInt(seconds)}s`;
  }
  if (seconds < 3600) {
    return `${fmtInt(seconds / 60)}m`;
  }
  const h = Math.floor(seconds / 3600);
  const mRaw = (seconds % 3600) / 60;
  return mRaw >= 0.5 ? `${h}h ${fmtInt(mRaw)}m` : `${h}h`;
}

// ── dateFormat helpers (web @/lib/dateFormat formatRelative + useDateFormat) ──

/** Relative label ported from web `formatRelative` (dateFormat.ts L94-109). */
function formatRelative(iso: string | Date | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  const diff = Date.now() - d.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }
  return formatAbsolute(d);
}

/** "Apr 4, 2026, 2:30 AM" absolute label (web TimeStamp format="absolute"). */
function formatAbsolute(value: string | Date | null | undefined): string {
  if (!value) {
    return '—';
  }
  const d = new Date(value);
  if (isNaN(d.getTime())) {
    return typeof value === 'string' ? value : '—';
  }
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** "14:30" clock label (web useDateFormat formatTime). */
function formatTime(value: string | Date | null | undefined): string {
  if (!value) {
    return '—';
  }
  const d = new Date(value);
  if (isNaN(d.getTime())) {
    return '—';
  }
  return `${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`;
}

// ── FSM state-color system (web @/types/fsm theme + registry getStateColor) ──
//
// VARIANT_THEME + per-FSM StateEntry overrides ported to RN color values. The
// web Tailwind classes (bg-*-500/10, text-*-400, *-dot) are mapped to their hex
// / rgba equivalents so the badge tints match the web exactly.

interface StateColor {
  bg: string;
  text: string;
  dot: string;
}

const PALETTE = {
  green400: '#4ade80',
  green500a: 'rgba(34, 197, 94, 0.1)',
  amber400: '#fbbf24',
  amber500a: 'rgba(245, 158, 11, 0.1)',
  red400: '#f87171',
  red500a: 'rgba(239, 68, 68, 0.1)',
  blue400: '#60a5fa',
  blue500a: 'rgba(59, 130, 246, 0.1)',
  gray400: '#9ca3af',
  gray500: '#6b7280',
  gray500a: 'rgba(107, 114, 128, 0.1)',
  gray600a: 'rgba(75, 85, 99, 0.1)',
  cyan400: '#22d3ee',
  cyan500a: 'rgba(6, 182, 212, 0.1)',
  purple400: '#c084fc',
  purple500a: 'rgba(168, 85, 247, 0.1)',
  indigo400: '#818cf8',
  indigo500a: 'rgba(99, 102, 241, 0.1)',
  orange400: '#fb923c',
  orange500a: 'rgba(249, 115, 22, 0.1)',
} as const;

type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const VARIANT_THEME: Record<BadgeVariant, StateColor> = {
  success: { bg: PALETTE.green500a, text: PALETTE.green400, dot: PALETTE.green400 },
  warning: { bg: PALETTE.amber500a, text: PALETTE.amber400, dot: PALETTE.amber400 },
  danger: { bg: PALETTE.red500a, text: PALETTE.red400, dot: PALETTE.red400 },
  info: { bg: PALETTE.blue500a, text: PALETTE.blue400, dot: PALETTE.blue400 },
  neutral: { bg: PALETTE.gray500a, text: colors.textMuted, dot: PALETTE.gray400 },
};

interface StateEntry {
  variant: BadgeVariant;
  overrides?: Partial<StateColor>;
}

const VEHICLE_ENTRIES: Record<string, StateEntry> = {
  online: { variant: 'success' },
  driving: {
    variant: 'success',
    overrides: { bg: PALETTE.green500a, text: PALETTE.green400, dot: PALETTE.green400 },
  },
  charging: {
    variant: 'warning',
    overrides: { bg: PALETTE.cyan500a, text: PALETTE.cyan400, dot: PALETTE.cyan400 },
  },
  parked: {
    variant: 'info',
    overrides: { bg: PALETTE.purple500a, text: PALETTE.purple400, dot: PALETTE.purple400 },
  },
  updating: {
    variant: 'info',
    overrides: { bg: PALETTE.indigo500a, text: PALETTE.indigo400, dot: PALETTE.indigo400 },
  },
  asleep: { variant: 'neutral' },
  offline: {
    variant: 'danger',
    overrides: { bg: PALETTE.gray600a, text: colors.textMuted, dot: PALETTE.gray500 },
  },
};

const DRIVE_SESSION_ENTRIES: Record<string, StateEntry> = {
  pending: { variant: 'warning' },
  active: { variant: 'success' },
  ending: {
    variant: 'warning',
    overrides: { bg: PALETTE.orange500a, text: PALETTE.orange400, dot: PALETTE.orange400 },
  },
  completed: {
    variant: 'info',
    overrides: { bg: PALETTE.indigo500a, text: PALETTE.indigo400, dot: PALETTE.indigo400 },
  },
  recovered: {
    variant: 'neutral',
    overrides: { bg: PALETTE.purple500a, text: PALETTE.purple400, dot: PALETTE.purple400 },
  },
};

const CHARGE_SESSION_ENTRIES: Record<string, StateEntry> = {
  pending: { variant: 'warning' },
  active: {
    variant: 'success',
    overrides: { bg: PALETTE.cyan500a, text: PALETTE.cyan400, dot: PALETTE.cyan400 },
  },
  completing: { variant: 'info' },
  done: { variant: 'success' },
  recovered: {
    variant: 'neutral',
    overrides: { bg: PALETTE.purple500a, text: PALETTE.purple400, dot: PALETTE.purple400 },
  },
};

const TELEMETRY_CONNECTION_ENTRIES: Record<string, StateEntry> = {
  unknown: { variant: 'neutral' },
  connecting: { variant: 'warning' },
  streaming: { variant: 'success' },
  stale: { variant: 'warning' },
  disconnected: { variant: 'danger' },
  polling_only: { variant: 'info' },
};

const FSM_REGISTRY: Record<string, Record<string, StateEntry>> = {
  vehicle: VEHICLE_ENTRIES,
  drive_session: DRIVE_SESSION_ENTRIES,
  charge_session: CHARGE_SESSION_ENTRIES,
  telemetry_connection: TELEMETRY_CONNECTION_ENTRIES,
};

/** State name arrays per FSM type (web FSM_STATES), used by the state diagram. */
const FSM_STATES: Record<string, readonly string[]> = {
  vehicle: ['online', 'driving', 'charging', 'parked', 'updating', 'asleep', 'offline'],
  drive_session: ['pending', 'active', 'ending', 'completed', 'recovered'],
  charge_session: ['pending', 'active', 'completing', 'done', 'recovered'],
  telemetry_connection: [
    'unknown',
    'connecting',
    'streaming',
    'stale',
    'disconnected',
    'polling_only',
  ],
};

/** Resolve a state's RN colors (web getStateColor — registry + neutral default). */
function getStateColor(fsmType: string, state: string): StateColor {
  const def = FSM_REGISTRY[fsmType] ?? FSM_REGISTRY.vehicle;
  const entry = def[state.toLowerCase()];
  if (!entry) {
    return VARIANT_THEME.neutral;
  }
  return { ...VARIANT_THEME[entry.variant], ...entry.overrides };
}

/** Vehicle-state hero styling, ported from the web `vehicleStateStyle` map. */
const VEHICLE_HERO_STYLE: Record<string, StateColor> = {
  driving: { bg: PALETTE.green500a, text: PALETTE.green400, dot: PALETTE.green400 },
  charging: { bg: PALETTE.cyan500a, text: PALETTE.cyan400, dot: PALETTE.cyan400 },
  parked: { bg: PALETTE.purple500a, text: PALETTE.purple400, dot: PALETTE.purple400 },
  online: { bg: PALETTE.blue500a, text: PALETTE.blue400, dot: PALETTE.blue400 },
  offline: { bg: PALETTE.gray500a, text: colors.textSecondary, dot: PALETTE.gray400 },
  asleep: { bg: PALETTE.gray600a, text: colors.textMuted, dot: PALETTE.gray500 },
};

function getVehicleStyle(state?: string | null): StateColor {
  if (!state) {
    return VEHICLE_HERO_STYLE.offline;
  }
  return VEHICLE_HERO_STYLE[state.toLowerCase()] ?? VEHICLE_HERO_STYLE.offline;
}

/** Recharts CHART_COLORS palette (web @/components/charts), inlined for native. */
const CHART_COLORS = [
  '#35d5ff',
  '#a78bfa',
  '#34d399',
  '#fbbf24',
  '#fb7185',
  '#60a5fa',
  '#f472b6',
  '#4ade80',
  '#f59e0b',
  '#818cf8',
];

// ── FSM type options (web @/types/fsm FSM_TYPE_OPTIONS) ───────────────────────

const FSM_TYPE_OPTIONS: { value: FSMType; label: string }[] = [
  { value: 'all', label: 'All FSMs' },
  { value: 'vehicle', label: 'Vehicle' },
  { value: 'telemetry_connection', label: 'Telemetry Connection' },
];

// ── windowTransitions (web state-machine/windowTransitions.ts) ────────────────

interface WindowedTransitions {
  inWindow: FSMTransition[];
  outsideWindow: FSMTransition[];
  lastTransition: FSMTransition | null;
  anchor: Date;
  minutes: number;
}

const PRESETS_MIN = [5, 10, 30, 120, 360, 1440] as const;

function windowTransitions(
  transitions: FSMTransition[],
  minutes: number,
  anchor?: Date,
): WindowedTransitions {
  const a = anchor ?? new Date();
  const endTs = a.getTime();
  const startTs = endTs - minutes * 60_000;
  const inWindow: FSMTransition[] = [];
  const outsideWindow: FSMTransition[] = [];
  let lastTs = -Infinity;
  let last: FSMTransition | null = null;
  for (const tr of transitions) {
    const ts = new Date(tr.ts).getTime();
    if (!Number.isFinite(ts)) {
      continue;
    }
    if (ts > lastTs) {
      lastTs = ts;
      last = tr;
    }
    if (ts >= startTs && ts <= endTs) {
      inWindow.push(tr);
    } else {
      outsideWindow.push(tr);
    }
  }
  inWindow.sort((x, y) => new Date(x.ts).getTime() - new Date(y.ts).getTime());
  outsideWindow.sort(
    (x, y) => new Date(x.ts).getTime() - new Date(y.ts).getTime(),
  );
  return { inWindow, outsideWindow, lastTransition: last, anchor: a, minutes };
}

function nextWiderPreset(
  lastTs: number,
  anchor: Date,
  currentMinutes: number,
): number | null {
  if (!Number.isFinite(lastTs)) {
    return null;
  }
  const gapMs = anchor.getTime() - lastTs;
  if (gapMs < 0) {
    return null;
  }
  for (const p of PRESETS_MIN) {
    if (p > currentMinutes && p * 60_000 >= gapMs) {
      return p;
    }
  }
  return null;
}

// ── computeFlapIds (web FSMHealthPanel.tsx L153-183) ──────────────────────────

function computeFlapIds(transitions: FSMTransition[]): Set<number> {
  const flapped = new Set<number>();
  const byType = new Map<string, FSMTransition[]>();
  for (const tr of transitions) {
    const list = byType.get(tr.fsm_name) ?? [];
    list.push(tr);
    byType.set(tr.fsm_name, list);
  }
  for (const [, list] of byType) {
    const sorted = [...list].sort(
      (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
    );
    for (let i = 0; i < sorted.length; i++) {
      const windowEnd = new Date(sorted[i].ts).getTime() + 60_000;
      let count = 0;
      for (let j = i; j < sorted.length; j++) {
        if (new Date(sorted[j].ts).getTime() <= windowEnd) {
          count++;
        } else {
          break;
        }
      }
      if (count > 5) {
        for (let j = i; j < sorted.length; j++) {
          if (new Date(sorted[j].ts).getTime() <= windowEnd) {
            flapped.add(sorted[j].id);
          } else {
            break;
          }
        }
      }
    }
  }
  return flapped;
}

// ── Native-safe range state (web @/hooks/useRangeState + @/lib/timezone) ──────
//
// The web hook persists a calendar range in the URL + localStorage and resolves
// tz-aware instants via the canonical RangePicker. Native has no URL bar and no
// vehicle-tz library wired in this build, so the range is held in-memory as a
// preset (default 7d) and day→instant bucketing is device-local. The contract
// the page depends on — start/end calendar strings, startInstant /
// endInstantExclusive (half-open [start,end) instants), and setRange — is
// preserved so the FSM transitions hook receives the same shaped window.

interface RangeValue {
  start: string;
  end: string;
}

interface RangePreset {
  id: string;
  label: string;
  days: number; // 0 = all time
}

const RANGE_PRESETS: RangePreset[] = [
  { id: '24h', label: 'Last 24 hours', days: 1 },
  { id: '7d', label: 'Last 7 days', days: 7 },
  { id: '30d', label: 'Last 30 days', days: 30 },
  { id: '90d', label: 'Last 90 days', days: 90 },
  { id: 'all', label: 'All time', days: 0 },
];

function ymdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function presetToRange(days: number): RangeValue {
  if (days <= 0) {
    return { start: '', end: '' };
  }
  const end = new Date();
  const start = new Date(end.getTime() - (days - 1) * 86_400_000);
  return { start: ymdLocal(start), end: ymdLocal(end) };
}

interface UseRangeStateReturn {
  start: string;
  end: string;
  startInstant: string;
  endInstantExclusive: string;
  presetId: string;
  setRange: (range: RangeValue) => void;
  setPresetId: (id: string) => void;
}

function useNativeRangeState(defaultPresetId: string): UseRangeStateReturn {
  const initial =
    RANGE_PRESETS.find(p => p.id === defaultPresetId) ?? RANGE_PRESETS[1];
  const [presetId, setPresetId] = useState<string>(initial.id);
  const [range, setRange] = useState<RangeValue>(() =>
    presetToRange(initial.days),
  );

  const setPreset = useCallback((id: string) => {
    const preset = RANGE_PRESETS.find(p => p.id === id);
    if (!preset) {
      return;
    }
    setPresetId(id);
    setRange(presetToRange(preset.days));
  }, []);

  const { startInstant, endInstantExclusive } = useMemo(() => {
    if (!range.start || !range.end) {
      return { startInstant: '', endInstantExclusive: '' };
    }
    const startMidnight = new Date(`${range.start}T00:00:00`);
    const endNext = new Date(`${range.end}T00:00:00`);
    endNext.setDate(endNext.getDate() + 1);
    const toIso = (d: Date) => (isNaN(d.getTime()) ? '' : d.toISOString());
    return {
      startInstant: toIso(startMidnight),
      endInstantExclusive: toIso(endNext),
    };
  }, [range.start, range.end]);

  return {
    start: range.start,
    end: range.end,
    startInstant,
    endInstantExclusive,
    presetId,
    setRange,
    setPresetId: setPreset,
  };
}

// ── Native-safe search-params shim (web react-router-dom useSearchParams) ────
//
// Native has no URL bar. The shim reproduces the page's initial reads (fsm /
// selected / at — all absent on first mount) and the permalink-sync setter as a
// stable no-op, so the page's permalink-sync effect ports structurally without
// touching a non-existent URL.

interface ParamsShim {
  get: (key: string) => string | null;
}

function useSearchParamsShim(): [ParamsShim, (next: ParamsShim) => void] {
  const params = useRef<ParamsShim>({ get: () => null }).current;
  const setParams = useCallback((_next: ParamsShim) => {
    // No URL to write on native — intentional no-op preserving the call site.
  }, []);
  return [params, setParams];
}

// ── Shared native primitives (web @/components/ui + data-display + feedback) ──

function SectionLabel({ children }: { children: ReactNode }): React.ReactElement {
  return (
    <AppText style={s.sectionLabel} variant="caption" weight="semibold">
      {children}
    </AppText>
  );
}

function PanelHeading({
  children,
}: {
  children: ReactNode;
}): React.ReactElement {
  return (
    <AppText style={s.panelHeading} weight="semibold">
      {children}
    </AppText>
  );
}

/** Inline native EmptyState (web @/components/feedback EmptyState). */
function EmptyState({ message }: { message: string }): React.ReactElement {
  return (
    <View style={s.emptyState}>
      <AppText style={s.emptyMessage} tone="muted" variant="caption">
        {message}
      </AppText>
    </View>
  );
}

/** Inline native skeleton (web @/components/feedback Skeleton). */
function Skeleton({ height }: { height: number }): React.ReactElement {
  return <View style={[s.skeleton, { height }]} />;
}

/** Inline native HelpTooltip (web @/components/ui HelpTooltip) — a glyph hint. */
function HelpTooltip({
  accessibilityLabel,
}: {
  accessibilityLabel: string;
}): React.ReactElement {
  return (
    <SemanticIcon
      accessibilityLabel={accessibilityLabel}
      name="helpCircle"
      size="sm"
    />
  );
}

/** Inline native TimeStamp (web @/components/data-display TimeStamp). */
function TimeStamp({
  value,
  format = 'relative',
  style,
}: {
  value: string | Date | null | undefined;
  format?: 'relative' | 'absolute';
  style?: StyleProp<TextStyle>;
}): React.ReactElement {
  const text =
    format === 'absolute' ? formatAbsolute(value) : formatRelative(value);
  return (
    <AppText style={style} variant="caption">
      {text}
    </AppText>
  );
}

/** Inline native StateBadge (web features/system/components/StateBadge). */
function StateBadge({
  state,
  fsmType,
}: {
  state: string;
  fsmType: string;
}): React.ReactElement {
  const color = getStateColor(fsmType, state);
  return (
    <View style={[s.stateBadge, { backgroundColor: color.bg }]}>
      <View style={[s.stateBadgeDot, { backgroundColor: color.dot }]} />
      <AppText style={[s.stateBadgeText, { color: color.text }]} variant="caption">
        {state}
      </AppText>
    </View>
  );
}

/** Inline native Button (web @/components/ui Button). */
function Button({
  label,
  onPress,
  variant = 'secondary',
  size = 'md',
  disabled = false,
  active = false,
  testID,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md';
  disabled?: boolean;
  active?: boolean;
  testID?: string;
}): React.ReactElement {
  const primary = variant === 'primary' || active;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled, selected: active }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        size === 'sm' && s.buttonSm,
        primary ? s.buttonPrimary : s.buttonSecondary,
        variant === 'ghost' && !active && s.buttonGhost,
        disabled && s.buttonDisabled,
        pressed && !disabled && s.buttonPressed,
      ]}
      testID={testID}
    >
      <AppText
        style={primary ? s.buttonPrimaryText : s.buttonSecondaryText}
        variant="caption"
        weight="semibold"
      >
        {label}
      </AppText>
    </Pressable>
  );
}

/** Inline native Toggle (web @/components/ui Toggle). */
function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}): React.ReactElement {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked }}
      accessibilityLabel={label}
      onPress={() => onChange(!checked)}
      style={s.toggleRow}
    >
      <View style={[s.toggleTrack, checked && s.toggleTrackOn]}>
        <View style={[s.toggleThumb, checked && s.toggleThumbOn]} />
      </View>
      <AppText style={s.toggleLabel} tone="secondary" variant="caption">
        {label}
      </AppText>
    </Pressable>
  );
}

/** Inline native StatCard (web @/components/data-display StatCard). */
function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: SemanticIconName;
}): React.ReactElement {
  return (
    <GlassPanel style={s.statCard}>
      <View style={s.statCardHeader}>
        <SemanticIcon decorative name={icon} size="sm" />
        <AppText style={s.statCardLabel} tone="muted" variant="caption">
          {label}
        </AppText>
      </View>
      <AppText style={s.statCardValue} weight="bold">
        {value}
      </AppText>
    </GlassPanel>
  );
}

// ── FSMHealthPanel (web features/system/components/FSMHealthPanel.tsx) ────────

interface HealthAlert {
  type: 'flap' | 'stuck' | 'recovery';
  severity: 'warning' | 'info';
  message: string;
  count: number;
}

function FSMHealthPanel({
  transitions,
  t,
}: {
  transitions: FSMTransition[];
  t: NativeTFunction;
}): React.ReactElement {
  const alerts = useMemo(() => {
    const result: HealthAlert[] = [];
    const flapped = new Set<number>();

    const byType = new Map<string, FSMTransition[]>();
    for (const tr of transitions) {
      const list = byType.get(tr.fsm_name) ?? [];
      list.push(tr);
      byType.set(tr.fsm_name, list);
    }

    for (const [, list] of byType) {
      const sorted = [...list].sort(
        (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
      );
      for (let i = 0; i < sorted.length; i++) {
        const windowEnd = new Date(sorted[i].ts).getTime() + 60_000;
        let count = 0;
        for (let j = i; j < sorted.length; j++) {
          if (new Date(sorted[j].ts).getTime() <= windowEnd) {
            count++;
          } else {
            break;
          }
        }
        if (count > 5) {
          for (let j = i; j < sorted.length; j++) {
            if (new Date(sorted[j].ts).getTime() <= windowEnd) {
              flapped.add(sorted[j].id);
            } else {
              break;
            }
          }
        }
      }
      if (flapped.size > 0 && !result.some(a => a.type === 'flap')) {
        result.push({
          type: 'flap',
          severity: 'warning',
          message: t(
            'fsm.health.flapping',
            '{{count}} transitions flagged as state flapping (>5 same-FSM transitions/min)',
            { count: flapped.size },
          ),
          count: flapped.size,
        });
      }
    }

    const now = Date.now();
    const FOUR_HOURS = 4 * 60 * 60 * 1000;
    const sessionTypes = ['drive_session', 'charge_session'];
    const stuckStates = ['pending', 'active'];
    const instanceLatest = new Map<string, FSMTransition>();
    for (const tr of transitions) {
      if (!sessionTypes.includes(tr.fsm_name)) {
        continue;
      }
      const key = `${tr.fsm_name}:${tr.vehicle_id ?? tr.vehicle_id}`;
      const existing = instanceLatest.get(key);
      if (
        !existing ||
        new Date(tr.ts).getTime() > new Date(existing.ts).getTime()
      ) {
        instanceLatest.set(key, tr);
      }
    }
    let stuckCount = 0;
    for (const [, tr] of instanceLatest) {
      if (
        stuckStates.includes(tr.to_state) &&
        now - new Date(tr.ts).getTime() > FOUR_HOURS
      ) {
        stuckCount++;
      }
    }
    if (stuckCount > 0) {
      result.push({
        type: 'stuck',
        severity: 'warning',
        message: t(
          'fsm.health.stuck',
          '{{count}} session(s) stuck in pending/active for >4 hours',
          { count: stuckCount },
        ),
        count: stuckCount,
      });
    }

    const recoveryCount = transitions.filter(
      tr => tr.to_state === 'recovered',
    ).length;
    if (recoveryCount > 0) {
      result.push({
        type: 'recovery',
        severity: 'info',
        message: t(
          'fsm.health.recoveries',
          '{{count}} session(s) recovered after pod restart',
          { count: recoveryCount },
        ),
        count: recoveryCount,
      });
    }

    return result;
  }, [transitions, t]);

  if (alerts.length === 0) {
    return (
      <GlassPanel style={s.panel}>
        <View style={s.healthClearRow}>
          <View style={[s.healthDot, { backgroundColor: PALETTE.green400 }]} />
          <AppText style={s.healthClearText} variant="caption">
            {t(
              'fsm.health.allClear',
              'All FSMs healthy — no flapping, stuck sessions, or recoveries detected',
            )}
          </AppText>
        </View>
      </GlassPanel>
    );
  }

  return (
    <GlassPanel style={s.panel}>
      <SectionLabel>{t('fsm.health.title', 'FSM Health')}</SectionLabel>
      <View style={s.healthGrid}>
        {alerts.map(alert => {
          const icon: SemanticIconName =
            alert.type === 'flap'
              ? 'warning'
              : alert.type === 'stuck'
              ? 'timer'
              : 'refresh';
          const tint =
            alert.severity === 'warning' ? PALETTE.amber400 : PALETTE.blue400;
          const title =
            alert.type === 'flap'
              ? t('fsm.health.flapTitle', 'State Flapping')
              : alert.type === 'stuck'
              ? t('fsm.health.stuckTitle', 'Stuck Sessions')
              : t('fsm.health.recoveryTitle', 'Pod Recoveries');
          return (
            <View key={alert.type} style={[s.healthAlert, { borderColor: tint }]}>
              <SemanticIcon decorative name={icon} size="sm" />
              <View style={s.healthAlertBody}>
                <AppText style={{ color: tint }} variant="caption" weight="semibold">
                  {title}
                </AppText>
                <AppText style={s.healthAlertMessage} tone="secondary" variant="caption">
                  {alert.message}
                </AppText>
              </View>
              <AppText style={[s.healthAlertCount, { color: tint }]} weight="bold">
                {fmtInt(alert.count)}
              </AppText>
            </View>
          );
        })}
      </View>
    </GlassPanel>
  );
}

// ── FSMSubFSMPanel (web features/system/components/FSMSubFSMPanel.tsx) ────────

interface ActiveSubFSM {
  type: 'drive' | 'charge';
  state: string;
  start_time: string;
  drive_id?: number;
  session_id?: number;
}

function FSMSubFSMPanel({
  activeSubs,
  fsmType,
  t,
}: {
  activeSubs?: ActiveSubFSM[];
  fsmType: string;
  t: NativeTFunction;
}): React.ReactElement | null {
  const isVehicleView = fsmType === 'vehicle' || fsmType === 'all';
  if (!isVehicleView) {
    return null;
  }

  const subs = activeSubs ?? [];

  if (subs.length === 0) {
    return (
      <GlassPanel style={s.panel}>
        <SectionLabel>{t('fsm.subFSMs', 'Active Sub-FSMs')}</SectionLabel>
        <EmptyState
          message={t('fsm.noSubFSMs', 'No active drive or charge sessions')}
        />
      </GlassPanel>
    );
  }

  return (
    <GlassPanel style={s.panel}>
      <SectionLabel>{t('fsm.subFSMs', 'Active Sub-FSMs')}</SectionLabel>
      <View style={s.subGrid}>
        {subs.map(sub => {
          const icon: SemanticIconName = sub.type === 'drive' ? 'drive' : 'bolt';
          const label =
            sub.type === 'drive'
              ? t('fsm.activeDrive', 'Drive Session')
              : t('fsm.activeCharge', 'Charge Session');
          const terminalStates =
            sub.type === 'drive'
              ? ['completed', 'recovered']
              : ['done', 'recovered'];
          const isActive = !terminalStates.includes(sub.state);
          return (
            <View key={sub.type} style={s.subCard}>
              <SemanticIcon decorative name={icon} size="sm" />
              <View style={s.subCardBody}>
                <View style={s.subCardTitleRow}>
                  <AppText style={s.subCardTitle} variant="caption" weight="semibold">
                    {label}
                  </AppText>
                  {isActive ? (
                    <View style={[s.healthDot, { backgroundColor: PALETTE.green400 }]} />
                  ) : null}
                </View>
                <View style={s.subCardStateRow}>
                  <StateBadge
                    state={sub.state}
                    fsmType={sub.type === 'drive' ? 'drive_session' : 'charge_session'}
                  />
                  <TimeStamp style={s.subCardTime} value={sub.start_time} />
                </View>
              </View>
            </View>
          );
        })}
      </View>
    </GlassPanel>
  );
}

// ── FSMStateDiagram (web features/system/components/FSMStateDiagram.tsx) ──────

function FSMStateDiagram({
  fsmType,
  transitions,
  t,
}: {
  fsmType: string;
  transitions: FSMTransition[];
  t: NativeTFunction;
}): React.ReactElement {
  const states = FSM_STATES[fsmType];

  const { stateCounts, edgeCounts, latestState } = useMemo(() => {
    const sc = new Map<string, number>();
    const ec = new Map<string, number>();
    let latest = '';
    let latestTime = 0;
    for (const tr of transitions) {
      if (fsmType !== 'all' && tr.fsm_name !== fsmType) {
        continue;
      }
      sc.set(tr.to_state, (sc.get(tr.to_state) ?? 0) + 1);
      sc.set(tr.from_state, (sc.get(tr.from_state) ?? 0) + 1);
      const edgeKey = `${tr.from_state}->${tr.to_state}`;
      ec.set(edgeKey, (ec.get(edgeKey) ?? 0) + 1);
      const time = new Date(tr.ts).getTime();
      if (time > latestTime) {
        latestTime = time;
        latest = tr.to_state;
      }
    }
    return { stateCounts: sc, edgeCounts: ec, latestState: latest };
  }, [transitions, fsmType]);

  if (!states) {
    return (
      <GlassPanel style={s.panel}>
        <PanelHeading>{t('fsm.stateDiagram', 'State Diagram')}</PanelHeading>
        <EmptyState
          message={t(
            'fsm.selectFsmType',
            'Select a specific FSM type to view its state diagram',
          )}
        />
      </GlassPanel>
    );
  }

  const topEdges = Array.from(edgeCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  return (
    <GlassPanel style={s.panel}>
      <PanelHeading>{t('fsm.stateDiagram', 'State Diagram')}</PanelHeading>
      <View style={s.diagramRow}>
        {states.map((state, i) => {
          const color = getStateColor(fsmType, state);
          const count = stateCounts.get(state) ?? 0;
          const isCurrent = state === latestState;
          const hasArrow = i < states.length - 1;
          return (
            <View key={state} style={s.diagramNodeWrap}>
              <View
                style={[
                  s.diagramNode,
                  isCurrent && s.diagramNodeCurrent,
                  !isCurrent && count === 0 && s.diagramNodeIdle,
                ]}
              >
                <View style={[s.diagramDot, { backgroundColor: color.dot }]} />
                <AppText style={{ color: color.text }} variant="caption" weight="semibold">
                  {state}
                </AppText>
                {count > 0 ? (
                  <AppText style={s.diagramCount} tone="muted" variant="caption">
                    {fmtInt(count)}
                  </AppText>
                ) : null}
              </View>
              {hasArrow ? (
                <AppText style={s.diagramArrow} tone="muted" variant="caption">
                  →
                </AppText>
              ) : null}
            </View>
          );
        })}
      </View>
      {topEdges.length > 0 ? (
        <View style={s.edgeWrap}>
          {topEdges.map(([edge, count]) => {
            const [from, to] = edge.split('->');
            return (
              <View key={edge} style={s.edgeChip}>
                <AppText style={{ color: getStateColor(fsmType, from).text }} variant="caption">
                  {from}
                </AppText>
                <AppText style={s.edgeArrow} tone="muted" variant="caption">
                  →
                </AppText>
                <AppText style={{ color: getStateColor(fsmType, to).text }} variant="caption">
                  {to}
                </AppText>
                <AppText style={s.edgeCount} tone="muted" variant="caption">
                  ×{count}
                </AppText>
              </View>
            );
          })}
        </View>
      ) : null}
    </GlassPanel>
  );
}

// ── LiveControls (web state-machine/LiveControls.tsx) ─────────────────────────

const WINDOW_OPTIONS = [
  { value: '5', label: '5 min' },
  { value: '10', label: '10 min' },
  { value: '30', label: '30 min' },
  { value: '120', label: '2 h' },
];

function LiveControls({
  isLive,
  onToggleLive,
  onStepPrev,
  onStepNext,
  canStepPrev = false,
  canStepNext = false,
  windowMinutes,
  onWindowChange,
  onClearBuffer,
  windowCount,
  totalCount,
  t,
}: {
  isLive: boolean;
  onToggleLive: (live: boolean) => void;
  onStepPrev: () => void;
  onStepNext: () => void;
  canStepPrev?: boolean;
  canStepNext?: boolean;
  windowMinutes: number;
  onWindowChange: (minutes: number) => void;
  onClearBuffer: () => void;
  windowCount: number;
  totalCount: number;
  t: NativeTFunction;
}): React.ReactElement {
  const inWindow = windowCount;
  const total = totalCount;
  const outside = Math.max(0, total - inWindow);

  const counterLabel =
    outside > 0
      ? t(
          'debugger.controls.bufferedDual',
          '{{inWindow}} in window · {{total}} in 24 h',
          { inWindow, total },
        )
      : t('debugger.controls.buffered', '{{n}} buffered', { n: inWindow });

  return (
    <View style={s.controls} testID="live-controls">
      <View style={s.controlsRow}>
        <Button
          active={isLive}
          label={t('debugger.controls.live', 'Live')}
          onPress={() => onToggleLive(true)}
          size="sm"
        />
        <Button
          active={!isLive}
          label={t('debugger.controls.freeze', 'Freeze')}
          onPress={() => onToggleLive(false)}
          size="sm"
        />
        <Button
          disabled={!canStepPrev}
          label="←"
          onPress={onStepPrev}
          size="sm"
          variant="ghost"
        />
        <Button
          disabled={!canStepNext}
          label="→"
          onPress={onStepNext}
          size="sm"
          variant="ghost"
        />
        <Button
          label={t('debugger.controls.clear', 'Clear buffer')}
          onPress={onClearBuffer}
          size="sm"
          variant="ghost"
        />
      </View>
      <View style={s.controlsRow}>
        <View style={s.controlsWindow}>
          <Select
            label={t('debugger.controls.window', 'Window')}
            onValueChange={value => onWindowChange(Number(value))}
            options={WINDOW_OPTIONS}
            size="sm"
            value={String(windowMinutes)}
          />
        </View>
        <AppText style={s.controlsCounter} tone="muted" variant="caption" testID="live-controls-counter">
          {counterLabel}
        </AppText>
      </View>
    </View>
  );
}

// ── StateTimeline (web state-machine/StateTimeline.tsx) ───────────────────────

function presetLabel(min: number, t: NativeTFunction): string {
  if (min < 60) {
    return t('debugger.window.minutes', '{{n}} min', { n: min });
  }
  if (min < 1440) {
    return t('debugger.window.hours', '{{n}} h', { n: Math.round(min / 60) });
  }
  return t('debugger.window.day', '24 h');
}

function StateTimeline({
  transitions,
  fsmType,
  selectedId,
  onSelect,
  windowMinutes = 10,
  anchor,
  lastTransition,
  widerPreset,
  onWidenWindow,
  onJumpToLast,
  t,
}: {
  transitions: FSMTransition[];
  fsmType: string;
  selectedId?: number | null;
  onSelect?: (transition: FSMTransition) => void;
  windowMinutes?: number;
  anchor?: Date;
  lastTransition?: FSMTransition | null;
  widerPreset?: number | null;
  onWidenWindow?: () => void;
  onJumpToLast?: () => void;
  t: NativeTFunction;
}): React.ReactElement {
  const { ticks, end, start } = useMemo(() => {
    const endTs = (anchor ?? new Date()).getTime();
    const startTs = endTs - windowMinutes * 60_000;
    const span = endTs - startTs || 1;
    const sorted = [...transitions].sort(
      (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
    );
    return {
      ticks: sorted.map(tr => ({
        tr,
        leftPct: ((new Date(tr.ts).getTime() - startTs) / span) * 100,
      })),
      end: new Date(endTs),
      start: new Date(startTs),
    };
  }, [transitions, anchor, windowMinutes]);

  if (ticks.length === 0) {
    const hasHint = Boolean(lastTransition);
    const showWiden = widerPreset != null && onWidenWindow != null;
    const showJump = lastTransition != null && onJumpToLast != null;
    return (
      <View style={s.timelineEmpty} testID="state-timeline-empty">
        <AppText style={s.timelineEmptyText} tone="muted" variant="caption">
          {t('debugger.timeline.empty', 'No transitions in window')}
          {hasHint
            ? ` · ${t('debugger.timeline.lastSeen', 'Last transition {{rel}}', {
                rel: formatRelative(lastTransition!.ts),
              })}`
            : ''}
        </AppText>
        {hasHint && (showWiden || showJump) ? (
          <View style={s.controlsRow}>
            {showWiden ? (
              <Button
                label={t('debugger.timeline.widenTo', 'Widen window to {{label}}', {
                  label: presetLabel(widerPreset!, t),
                })}
                onPress={onWidenWindow!}
                size="sm"
                variant="primary"
              />
            ) : null}
            {showJump ? (
              <Button
                label={t('debugger.timeline.jumpToLast', 'Jump to last transition')}
                onPress={onJumpToLast!}
                size="sm"
                variant="ghost"
              />
            ) : null}
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={s.timeline} testID="state-timeline">
      <View style={s.timelineAxis}>
        <AppText style={s.timelineAxisLabel} tone="muted" variant="caption">
          {formatTime(start)}
        </AppText>
        <AppText style={s.timelineAxisLabel} tone="muted" variant="caption">
          {t('debugger.timeline.windowLabel', 'Window: {{minutes}} min', {
            minutes: windowMinutes,
          })}
        </AppText>
        <AppText style={s.timelineAxisLabel} tone="muted" variant="caption">
          {formatTime(end)}
        </AppText>
      </View>
      <View style={s.timelineTrack}>
        <View style={s.timelineLine} />
        {ticks.map(({ tr, leftPct }) => {
          const color = getStateColor(fsmType, tr.to_state);
          const isSelected = selectedId != null && tr.id === selectedId;
          return (
            <Pressable
              key={tr.id}
              accessibilityLabel={t('debugger.timeline.tickAria', '{{from}} to {{to}}', {
                from: tr.from_state,
                to: tr.to_state,
              })}
              accessibilityRole="button"
              onPress={() => onSelect?.(tr)}
              style={[
                s.timelineTick,
                isSelected && s.timelineTickSelected,
                { backgroundColor: color.dot, left: `${Math.max(0, Math.min(100, leftPct))}%` },
              ]}
              testID={`state-timeline-tick-${tr.id}`}
            />
          );
        })}
      </View>
    </View>
  );
}

// ── SnapshotInspector (web state-machine/SnapshotInspector.tsx) ───────────────

const SOURCE_LABEL: Record<SignalSourceLayer, string> = {
  l1: 'L1',
  l2: 'L2',
  log: 'LOG',
  stale: 'STALE',
  unknown: '?',
};

function SourceLayerBadge({
  source,
  ageMs,
}: {
  source?: SignalSourceLayer;
  ageMs?: number;
}): React.ReactElement | null {
  if (!source) {
    return null;
  }
  const age =
    typeof ageMs === 'number' && Number.isFinite(ageMs)
      ? ` · ${formatDuration(ageMs / 1000)}`
      : '';
  return (
    <View style={s.sourceBadge}>
      <AppText style={s.sourceBadgeText} tone="muted" variant="caption">
        {SOURCE_LABEL[source]}
        {age}
      </AppText>
    </View>
  );
}

function formatSignalValue(v: unknown): string {
  if (v == null) {
    return '—';
  }
  if (typeof v === 'boolean') {
    return v ? 'true' : 'false';
  }
  if (typeof v === 'number') {
    return Number.isFinite(v) ? String(v) : '—';
  }
  if (typeof v === 'string') {
    return v;
  }
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function SnapshotInspector({
  fsmType,
  transition,
  snapshot,
  previousSnapshot,
  loading,
  lastTransition,
  inWindowCount,
  onJumpToLast,
  t,
}: {
  fsmType: string;
  transition?: FSMTransition | null;
  snapshot?: SignalSnapshotResponse | null;
  previousSnapshot?: SignalSnapshotResponse | null;
  loading?: boolean;
  lastTransition?: FSMTransition | null;
  inWindowCount?: number;
  onJumpToLast?: () => void;
  t: NativeTFunction;
}): React.ReactElement {
  const [diffMode, setDiffMode] = useState(false);

  const rows = useMemo(() => {
    if (!snapshot?.signals) {
      return [] as Array<{
        name: string;
        value: unknown;
        source?: SignalSourceLayer;
        ageMs?: number;
        changed: boolean;
        previous?: unknown;
      }>;
    }
    const prev = previousSnapshot?.signals ?? {};
    return Object.entries(snapshot.signals)
      .map(([name, entry]) => {
        const prevEntry = prev[name];
        const changed =
          previousSnapshot != null &&
          JSON.stringify(prevEntry?.value ?? null) !==
            JSON.stringify(entry?.value ?? null);
        return {
          name,
          value: entry?.value,
          source: entry?.source,
          ageMs: entry?.age_ms,
          changed,
          previous: prevEntry?.value,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [snapshot, previousSnapshot]);

  const copyPayload = useMemo(() => {
    if (!transition || !snapshot) {
      return '';
    }
    return JSON.stringify(
      { transition, snapshot: snapshot.signals, at: snapshot.at },
      null,
      2,
    );
  }, [transition, snapshot]);

  const handleCopy = useCallback(() => {
    if (!copyPayload) {
      return;
    }
    void Share.share({ message: copyPayload }).catch(() => undefined);
  }, [copyPayload]);

  if (!transition) {
    if (loading) {
      return (
        <GlassPanel style={s.panel}>
          <AppText style={s.inspectorEmptyText} tone="muted" variant="caption" testID="snapshot-inspector-loading">
            {t('debugger.inspector.loading', 'Loading…')}
          </AppText>
        </GlassPanel>
      );
    }
    if ((inWindowCount ?? 0) === 0 && lastTransition && onJumpToLast) {
      return (
        <GlassPanel style={s.panel}>
          <AppText style={s.inspectorEmptyText} tone="muted" variant="caption" testID="snapshot-inspector-outside-window">
            {t(
              'debugger.inspector.emptyOutsideWindow',
              'Nothing in the current window. Last transition {{rel}}.',
              { rel: formatRelative(lastTransition.ts) },
            )}
          </AppText>
          <Button
            label={t('debugger.inspector.jumpToLast', 'Jump to last transition')}
            onPress={onJumpToLast}
            size="sm"
            variant="primary"
          />
        </GlassPanel>
      );
    }
    return (
      <GlassPanel style={s.panel}>
        <AppText style={s.inspectorEmptyText} tone="muted" variant="caption" testID="snapshot-inspector-empty">
          {t('debugger.inspector.empty', 'Select a transition to inspect its snapshot')}
        </AppText>
      </GlassPanel>
    );
  }

  const durationRaw = transition.details?.duration_in_state_ms;
  const durationMs =
    typeof durationRaw === 'number' ? fmtInt(durationRaw) : null;

  return (
    <GlassPanel style={s.panel}>
      <View style={s.inspectorHeader}>
        <PanelHeading>{t('debugger.inspector.title', 'Transition snapshot')}</PanelHeading>
        {copyPayload ? (
          <Button
            label={t('debugger.inspector.copy', 'Copy snapshot')}
            onPress={handleCopy}
            size="sm"
            variant="ghost"
          />
        ) : null}
      </View>

      <View style={s.inspectorGrid}>
        <View style={s.inspectorCell}>
          <SectionLabel>{t('debugger.inspector.from', 'From')}</SectionLabel>
          <StateBadge state={transition.from_state} fsmType={fsmType} />
        </View>
        <View style={s.inspectorCell}>
          <SectionLabel>{t('debugger.inspector.to', 'To')}</SectionLabel>
          <StateBadge state={transition.to_state} fsmType={fsmType} />
        </View>
        <View style={s.inspectorCell}>
          <SectionLabel>{t('debugger.inspector.trigger', 'Trigger')}</SectionLabel>
          <AppText variant="caption">{transition.trigger || '—'}</AppText>
        </View>
        <View style={s.inspectorCell}>
          <SectionLabel>{t('debugger.inspector.duration', 'Duration')}</SectionLabel>
          <AppText variant="caption">{`${durationMs ?? '—'} ms`}</AppText>
        </View>
      </View>

      <View style={s.inspectorSignalsHeader}>
        <PanelHeading>
          {t('debugger.inspector.signalsTitle', 'Signals at transition')}
        </PanelHeading>
        <Toggle
          checked={diffMode}
          label={t('debugger.inspector.diffMode', 'Diff vs previous')}
          onChange={setDiffMode}
        />
      </View>

      {rows.length === 0 ? (
        <EmptyState
          message={t(
            'debugger.inspector.noSignals',
            'No signals captured for this transition',
          )}
        />
      ) : (
        <View style={s.signalList}>
          {rows.map(row => {
            const dim = diffMode && !row.changed;
            const highlight = diffMode && row.changed;
            return (
              <View
                key={row.name}
                style={[
                  s.signalRow,
                  highlight && s.signalRowHighlight,
                  dim && s.signalRowDim,
                ]}
              >
                <View style={s.signalMain}>
                  <AppText style={s.signalName} tone="secondary" variant="caption">
                    {row.name}
                  </AppText>
                  <AppText variant="caption">{formatSignalValue(row.value)}</AppText>
                  {diffMode && row.changed && row.previous !== undefined ? (
                    <AppText style={s.signalPrev} tone="muted" variant="caption">
                      {formatSignalValue(row.previous)}
                    </AppText>
                  ) : null}
                </View>
                <SourceLayerBadge source={row.source} ageMs={row.ageMs} />
              </View>
            );
          })}
        </View>
      )}
    </GlassPanel>
  );
}

// ── FSMTimelineChart (web FSMTimelineChart.tsx) — native bucketed bar list ─────
//
// The web stacked AreaChart is Recharts-only; the bucketing logic is ported
// verbatim and the per-bucket totals are rendered as a native bar list so the
// "transitions over time" intent is preserved.

interface TimelineBucket {
  time: string;
  total: number;
  byType: Record<string, number>;
}

function FSMTimelineChart({
  transitions,
  hours,
  emptyMessage,
  t,
}: {
  transitions: FSMTransition[];
  hours: number;
  emptyMessage?: string;
  t: NativeTFunction;
}): React.ReactElement {
  const { buckets, max } = useMemo(() => {
    if (transitions.length === 0) {
      return { buckets: [] as TimelineBucket[], max: 0 };
    }
    const bucketMs =
      hours <= 6 ? 10 * 60_000 : hours <= 24 ? 30 * 60_000 : 2 * 60 * 60_000;
    const now = Date.now();
    const start = now - hours * 60 * 60_000;

    const typeSet = new Set<string>();
    for (const tr of transitions) {
      typeSet.add(tr.fsm_name);
    }
    const types = Array.from(typeSet).sort();

    const bucketMap = new Map<number, Record<string, number>>();
    for (let ts = start; ts <= now; ts += bucketMs) {
      const key = Math.floor(ts / bucketMs) * bucketMs;
      const record: Record<string, number> = {};
      for (const type of types) {
        record[type] = 0;
      }
      bucketMap.set(key, record);
    }

    for (const tr of transitions) {
      const ts = new Date(tr.ts).getTime();
      const key = Math.floor(ts / bucketMs) * bucketMs;
      const bucket = bucketMap.get(key);
      if (bucket) {
        bucket[tr.fsm_name] = (bucket[tr.fsm_name] ?? 0) + 1;
      }
    }

    let peak = 0;
    const result: TimelineBucket[] = Array.from(bucketMap.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([ts, counts]) => {
        const d = new Date(ts);
        const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(
          d.getMinutes(),
        ).padStart(2, '0')}`;
        const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
        if (total > peak) {
          peak = total;
        }
        return { time: timeStr, total, byType: counts };
      });

    return { buckets: result, max: peak };
  }, [transitions, hours]);

  return (
    <GlassPanel style={s.panel}>
      <PanelHeading>{t('fsm.timelineChart', 'Transitions Over Time')}</PanelHeading>
      {buckets.length > 0 ? (
        <View style={s.barChart}>
          {buckets.map((b, i) => {
            const heightPct = max > 0 ? (b.total / max) * 100 : 0;
            return (
              <View key={`${b.time}-${i}`} style={s.barColumn}>
                <View style={s.barTrack}>
                  <View
                    style={[
                      s.barFill,
                      { height: `${Math.max(b.total > 0 ? 6 : 0, heightPct)}%` },
                    ]}
                  />
                </View>
              </View>
            );
          })}
        </View>
      ) : (
        <EmptyState
          message={
            emptyMessage ??
            t('fsm.noTimelineData', 'No transition data for timeline')
          }
        />
      )}
    </GlassPanel>
  );
}

// ── Pagination (web @/components/ui Pagination) ───────────────────────────────

function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}): React.ReactElement {
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <View style={s.pagination}>
      <AppText tone="muted" variant="caption">
        {`${fmtInt(from)}–${fmtInt(to)} / ${fmtInt(total)}`}
      </AppText>
      <View style={s.controlsRow}>
        <Button
          disabled={page <= 1}
          label="←"
          onPress={() => onPageChange(Math.max(1, page - 1))}
          size="sm"
          variant="ghost"
        />
        <AppText tone="secondary" variant="caption">
          {`${fmtInt(page)} / ${fmtInt(totalPages)}`}
        </AppText>
        <Button
          disabled={page >= totalPages}
          label="→"
          onPress={() => onPageChange(Math.min(totalPages, page + 1))}
          size="sm"
          variant="ghost"
        />
        <View style={s.paginationSize}>
          <Select
            onValueChange={value => onPageSizeChange(Number(value))}
            options={[
              { value: '25', label: '25' },
              { value: '50', label: '50' },
              { value: '100', label: '100' },
            ]}
            size="sm"
            value={String(pageSize)}
          />
        </View>
      </View>
    </View>
  );
}

// ── TransitionDetail (web source L879-951) ────────────────────────────────────

function DetailField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): React.ReactElement {
  return (
    <View style={s.detailField}>
      <AppText style={s.detailFieldLabel} tone="muted" variant="caption">
        {label}
      </AppText>
      {children}
    </View>
  );
}

function TransitionDetail({
  transition,
  t,
}: {
  transition: FSMTransition;
  t: NativeTFunction;
}): React.ReactElement {
  const guardRaw = transition.details?.guard;
  const guard = typeof guardRaw === 'string' ? guardRaw : '';
  const durationRaw = transition.details?.duration_in_state_ms;
  const durationMs = typeof durationRaw === 'number' ? durationRaw : 0;
  const detailEntries = transition.details
    ? Object.entries(transition.details)
    : [];

  return (
    <View style={s.detailGrid}>
      <DetailField label={t('fsm.detail.id', 'Transition ID')}>
        <AppText variant="caption">{String(transition.id)}</AppText>
      </DetailField>
      <DetailField label={t('fsm.detail.vehicleId', 'Vehicle ID')}>
        <AppText variant="caption">{String(transition.vehicle_id)}</AppText>
      </DetailField>
      {transition.fsm_name ? (
        <DetailField label={t('fsm.detail.name', 'FSM Name')}>
          <AppText variant="caption">{transition.fsm_name}</AppText>
        </DetailField>
      ) : null}
      <DetailField label={t('fsm.detail.from', 'From State')}>
        <StateBadge state={transition.from_state} fsmType={transition.fsm_name || 'vehicle'} />
      </DetailField>
      <DetailField label={t('fsm.detail.to', 'To State')}>
        <StateBadge state={transition.to_state} fsmType={transition.fsm_name || 'vehicle'} />
      </DetailField>
      <DetailField label={t('fsm.detail.trigger', 'Trigger')}>
        <AppText variant="caption">{transition.trigger}</AppText>
      </DetailField>
      {guard ? (
        <DetailField label={t('fsm.detail.guard', 'Guard')}>
          <AppText variant="caption">{guard}</AppText>
        </DetailField>
      ) : null}
      {durationMs > 0 ? (
        <DetailField label={t('fsm.detail.duration', 'Duration in State')}>
          <AppText variant="caption">{formatDuration(durationMs / 1000)}</AppText>
        </DetailField>
      ) : null}
      <DetailField label={t('fsm.detail.timestamp', 'Timestamp')}>
        <View style={s.detailTimestamp}>
          <TimeStamp format="absolute" value={transition.ts} />
          <TimeStamp style={s.detailRelative} value={transition.ts} />
        </View>
      </DetailField>
      {detailEntries.length > 0 ? (
        <DetailField label={t('fsm.detail.context', 'Context Snapshot')}>
          <View style={s.detailChips}>
            {detailEntries.map(([key, val]) => (
              <View key={key} style={s.detailChip}>
                <AppText style={s.detailChipText} tone="secondary" variant="caption">
                  {`${key}: ${String(val)}`}
                </AppText>
              </View>
            ))}
          </View>
        </DetailField>
      ) : null}
    </View>
  );
}

// ── Page scaffold (web @/components/layout PageContainer) ─────────────────────

function PageScaffold({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle: string;
  actions?: ReactNode;
  children: ReactNode;
}): React.ReactElement {
  return (
    <ScrollView contentContainerStyle={s.scrollContent} style={s.scroll}>
      <View style={s.pageHeader}>
        <AppText style={s.pageTitle} variant="display" weight="bold">
          {title}
        </AppText>
        <AppText style={s.pageSubtitle} tone="muted" variant="caption">
          {subtitle}
        </AppText>
        {actions ? <View style={s.headerActions}>{actions}</View> : null}
      </View>
      {children}
    </ScrollView>
  );
}

// ── Derived helper types ──────────────────────────────────────────────────────

interface StateResponse {
  state?: VehicleState;
  live?: boolean;
  data_source?: string;
}

interface StatSummaryRow {
  to_state: string;
  count: number;
  avg_interval_sec: number;
}

// ── Page (web StateMachineDebuggerPage) ───────────────────────────────────────

export default function StateMachineDebuggerPage(): React.ReactElement {
  const t = useNativeTranslationFallback();
  usePageTitle(t('fsm.title', 'FSM Debugger'));

  // Vehicle selector — native useVehicles + local selected id (web
  // useSelectedVehicle store/URL precedence tail: default to first vehicle).
  const { data: vehiclesData } = useVehicles();
  const vehicles = useMemo(() => vehiclesData ?? [], [vehiclesData]);
  const [storeVehicleId, setStoreVehicleId] = useState<number | null>(null);
  useEffect(() => {
    if (storeVehicleId == null && vehicles.length > 0) {
      setStoreVehicleId(vehicles[0].id);
    }
  }, [storeVehicleId, vehicles]);
  const selectedVehicleId = storeVehicleId;
  const activeId = selectedVehicleId != null ? String(selectedVehicleId) : '';

  const [searchParams, setSearchParams] = useSearchParamsShim();

  // FSM filters.
  const initialFsm = (searchParams.get('fsm') ?? 'all') as FSMType;
  const [fsmType, setFsmType] = useState<FSMType>(initialFsm);

  // Time range — native preset range state (default 7d). The half-open
  // [startInstant, endInstantExclusive) window + `hours` mirror the web hook.
  const { start, end, startInstant, endInstantExclusive, presetId, setPresetId } =
    useNativeRangeState('7d');
  const hours = useMemo(() => {
    if (!start || !end) {
      return 0;
    }
    const startMs = new Date(`${start}T00:00:00`).getTime();
    const endMs = new Date(`${end}T23:59:59.999`).getTime();
    return Math.max(1, Math.round((endMs - startMs) / 3_600_000));
  }, [start, end]);

  const [serverPage, setServerPage] = useState(1);
  const [perPage, setPerPage] = useState(50);

  // Detail panel.
  const [selectedId, setSelectedId] = useState<number | null>(() => {
    const id = searchParams.get('selected');
    return id ? Number(id) : null;
  });

  // Live/freeze + timeline window.
  const initialAt = searchParams.get('at');
  const [isLive, setIsLive] = useState<boolean>(!initialAt);
  const [windowMinutes, setWindowMinutes] = useState(10);
  const [bufferClearedAt, setBufferClearedAt] = useState<Date | null>(null);

  // Data hooks.
  const { data: stateData, isLoading: stateLoading } =
    useVehicleStateMachine(activeId);
  const { data: statsData } = useFSMStats(activeId);
  const { data: transData, isLoading: transLoading } = useFSMTransitions(
    activeId,
    fsmType,
    hours,
    serverPage,
    perPage,
    startInstant,
    endInstantExclusive,
  );

  // Derived data.
  const stateResponse = stateData as unknown as StateResponse | undefined;
  const currentState = stateResponse?.state;
  const stateName = currentState?.state?.toLowerCase() ?? null;
  const style = getVehicleStyle(stateName);

  const transitions = useMemo<FSMTransition[]>(
    () => transData?.data ?? [],
    [transData],
  );
  const totalRows = transData?.total ?? 0;

  const flapIds = useMemo(() => computeFlapIds(transitions), [transitions]);

  const pieData = useMemo(() => {
    const byState = new Map<string, number>();
    for (const tr of transitions) {
      byState.set(tr.to_state, (byState.get(tr.to_state) ?? 0) + 1);
    }
    return Array.from(byState.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, value], i) => ({
        name,
        value,
        fill: CHART_COLORS[i % CHART_COLORS.length],
      }));
  }, [transitions]);

  const summaryRows: StatSummaryRow[] = useMemo(() => {
    const byState = new Map<string, number[]>();
    const counts = new Map<string, number>();
    for (const tr of transitions) {
      const key = tr.to_state;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      const list = byState.get(key) ?? [];
      list.push(new Date(tr.ts).getTime());
      byState.set(key, list);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => {
        const times = byState.get(name) ?? [];
        let avgInterval = 0;
        if (times.length > 1) {
          const sorted = [...times].sort((a, b) => a - b);
          let totalGap = 0;
          for (let i = 1; i < sorted.length; i++) {
            totalGap += sorted[i] - sorted[i - 1];
          }
          avgInterval = totalGap / (sorted.length - 1) / 1000;
        }
        return { to_state: name, count, avg_interval_sec: avgInterval };
      });
  }, [transitions]);

  const vehicleOptions = vehicles.map(v => ({
    value: String(v.id),
    label: v.display_name || v.vin,
  }));

  const activeRangeLabel = useMemo(() => {
    if (!start || !end) {
      return t('fsm.allTime', 'All time');
    }
    if (start === end) {
      return start;
    }
    return `${start} → ${end}`;
  }, [start, end, t]);
  const emptyRangeMessage = t('fsm.noTransitionsInRange', {
    range: activeRangeLabel,
    defaultValue: 'No transitions in {{range}}. Try expanding the time range.',
  });

  const fsmTypeOptions = FSM_TYPE_OPTIONS.map(o => ({
    value: o.value,
    label: o.label,
  }));

  const perPageOptions = [
    { value: '25', label: '25' },
    { value: '50', label: '50' },
    { value: '100', label: '100' },
  ];

  const totalTransitionsOnPage = transitions.length;

  const timelineTransitions = useMemo(
    () => transitions.map(tr => ({ ...tr, fsm_name: tr.to_state })),
    [transitions],
  );

  // Derived selection + step navigation.
  const sortedByTime = useMemo(
    () =>
      [...transitions].sort(
        (a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime(),
      ),
    [transitions],
  );

  const selectedTransition = useMemo(
    () =>
      selectedId != null
        ? transitions.find(tr => tr.id === selectedId) ?? null
        : null,
    [transitions, selectedId],
  );
  const selectedIndex = useMemo(
    () =>
      selectedTransition
        ? sortedByTime.findIndex(tr => tr.id === selectedTransition.id)
        : -1,
    [sortedByTime, selectedTransition],
  );

  const previousTransition = useMemo(() => {
    if (selectedIndex <= 0) {
      return null;
    }
    return sortedByTime[selectedIndex - 1] ?? null;
  }, [sortedByTime, selectedIndex]);

  const visibleTransitions = useMemo(() => {
    if (!bufferClearedAt) {
      return sortedByTime;
    }
    return sortedByTime.filter(tr => new Date(tr.ts) >= bufferClearedAt);
  }, [sortedByTime, bufferClearedAt]);

  const windowed = useMemo(
    () => windowTransitions(visibleTransitions, windowMinutes),
    [visibleTransitions, windowMinutes],
  );

  const widerPreset = useMemo(() => {
    if (windowed.inWindow.length > 0) {
      return null;
    }
    if (!windowed.lastTransition) {
      return null;
    }
    return nextWiderPreset(
      new Date(windowed.lastTransition.ts).getTime(),
      windowed.anchor,
      windowMinutes,
    );
  }, [windowed, windowMinutes]);

  const handleWidenWindow = useCallback(() => {
    if (widerPreset != null) {
      setWindowMinutes(widerPreset);
    }
  }, [widerPreset]);

  const handleJumpToLast = useCallback(() => {
    const last = windowed.lastTransition;
    if (!last) {
      return;
    }
    setIsLive(false);
    setSelectedId(last.id);
  }, [windowed.lastTransition]);

  const handleStepPrev = useCallback(() => {
    if (sortedByTime.length === 0) {
      return;
    }
    setIsLive(false);
    if (selectedIndex <= 0) {
      setSelectedId(sortedByTime[0].id);
    } else {
      setSelectedId(sortedByTime[selectedIndex - 1].id);
    }
  }, [sortedByTime, selectedIndex]);

  const handleStepNext = useCallback(() => {
    if (sortedByTime.length === 0) {
      return;
    }
    setIsLive(false);
    if (selectedIndex < 0) {
      setSelectedId(sortedByTime[sortedByTime.length - 1].id);
    } else if (selectedIndex < sortedByTime.length - 1) {
      setSelectedId(sortedByTime[selectedIndex + 1].id);
    }
  }, [sortedByTime, selectedIndex]);

  const handleClearBuffer = useCallback(() => {
    setBufferClearedAt(new Date());
    setSelectedId(null);
  }, []);

  // Snapshot hooks: live (no `at`) + selected/previous (when frozen).
  const selectedAtIso = selectedTransition?.ts ?? '';
  const previousAtIso = previousTransition?.ts ?? '';
  const numericVehicleId = Number(activeId) || 0;

  const { data: selectedSnapshot, isFetching: snapshotFetching } =
    useSignalSnapshot(numericVehicleId, selectedAtIso, '', {
      enabled: numericVehicleId > 0 && Boolean(selectedAtIso),
    });

  const { data: previousSnapshot } = useSignalSnapshot(
    numericVehicleId,
    previousAtIso,
    '',
    { enabled: numericVehicleId > 0 && Boolean(previousAtIso) },
  );

  // Permalink: web kept ?vehicle_id/?fsm/?selected/?at in sync. Native has no
  // URL bar, so this preserves the same dependency-tracked structure but writes
  // through the no-op shim setter.
  useEffect(() => {
    setSearchParams({ get: () => null });
  }, [fsmType, selectedId, isLive, selectedAtIso, setSearchParams]);

  const subFsmType = fsmType === 'all' ? 'vehicle' : fsmType;
  const activeSubs = (statsData as { active_subs?: ActiveSubFSM[] } | undefined)
    ?.active_subs;

  return (
    <PageScaffold
      actions={
        <View style={s.actions} testID="debugger-share">
          {vehicleOptions.length > 0 ? (
            <View style={s.actionSelect}>
              <Select
                onValueChange={value => {
                  setStoreVehicleId(Number(value));
                  setServerPage(1);
                }}
                options={vehicleOptions}
                value={activeId}
              />
            </View>
          ) : null}
          <View style={s.actionSelect}>
            <Select
              onValueChange={value => {
                setPresetId(value);
                setServerPage(1);
              }}
              options={RANGE_PRESETS.map(p => ({ value: p.id, label: p.label }))}
              value={presetId}
            />
          </View>
          <View style={s.autoRefresh}>
            <SemanticIcon decorative name="refresh" size="sm" />
            <AppText tone="muted" variant="caption">
              {t('fsm.autoRefresh', 'Live 10s')}
            </AppText>
          </View>
        </View>
      }
      subtitle={t(
        'fsm.subtitle',
        'Multi-FSM transition analysis — vehicle, drive, charge, command, notification',
      )}
      title={t('fsm.title', 'FSM Debugger')}
    >
      {/* Section 1: Page-specific filters (FSM Type + Per Page) */}
      <GlassPanel style={s.panel}>
        {vehicleOptions.length > 0 ? (
          <View style={s.filterGrid}>
            <View style={s.filterCell}>
              <View style={s.filterLabelRow}>
                <SectionLabel>{t('fsm.fsmType', 'FSM Type')}</SectionLabel>
                <HelpTooltip
                  accessibilityLabel={t('help.fsm.type.aria', {
                    defaultValue: 'More info about FSM types',
                  })}
                />
              </View>
              <Select
                onValueChange={value => {
                  setFsmType(value as FSMType);
                  setServerPage(1);
                }}
                options={fsmTypeOptions}
                value={fsmType}
              />
            </View>
            <View style={s.filterCell}>
              <Select
                label={t('fsm.perPage', 'Per Page')}
                onValueChange={value => {
                  setPerPage(Number(value));
                  setServerPage(1);
                }}
                options={perPageOptions}
                value={String(perPage)}
              />
            </View>
          </View>
        ) : (
          <EmptyState message={t('fsm.noVehicles', 'No vehicles available')} />
        )}
      </GlassPanel>

      {/* Section 2: FSM Health Indicators */}
      <FSMHealthPanel transitions={transitions} t={t} />

      {/* Section 2b: AI FSM narrator */}
      <AIStateMachineDebuggerNarrator
        fromUnix={
          startInstant
            ? Math.floor(new Date(startInstant).getTime() / 1000)
            : undefined
        }
        toUnix={
          endInstantExclusive
            ? Math.floor(new Date(endInstantExclusive).getTime() / 1000)
            : undefined
        }
        vehicleId={Number(activeId) > 0 ? Number(activeId) : undefined}
      />

      {/* Section 3: Current Vehicle State */}
      <GlassPanel style={s.panel}>
        <View style={s.filterLabelRow}>
          <SectionLabel>{t('fsm.vehicleLiveState', 'Vehicle Live State')}</SectionLabel>
          <HelpTooltip
            accessibilityLabel={t('help.fsm.liveState.aria', {
              defaultValue: 'More info about FSM live state',
            })}
          />
        </View>
        {stateLoading ? (
          <Skeleton height={80} />
        ) : currentState ? (
          <View style={s.heroRow}>
            <View style={[s.heroPill, { backgroundColor: style.bg }]}>
              <View style={[s.heroDot, { backgroundColor: style.dot }]} />
              <AppText style={[s.heroState, { color: style.text }]} weight="bold">
                {currentState.state ?? '—'}
              </AppText>
            </View>
            <View style={s.heroMeta}>
              <AppText tone="secondary" variant="caption">
                <AppText tone="muted" variant="caption">
                  {`${t('fsm.type', 'FSM Type')}: `}
                </AppText>
                {t('fsm.vehicle', 'Vehicle')}
              </AppText>
              <AppText tone="secondary" variant="caption">
                <AppText tone="muted" variant="caption">
                  {`${t('fsm.mode', 'Mode')}: `}
                </AppText>
                {currentState.is_charging
                  ? 'Charging'
                  : currentState.speed && currentState.speed > 0
                  ? 'Drive'
                  : currentState.state === 'asleep'
                  ? 'Sleep'
                  : 'Idle'}
              </AppText>
              <View style={s.heroMetaRow}>
                <AppText tone="muted" variant="caption">
                  {`${t('fsm.since', 'Since')}: `}
                </AppText>
                <TimeStamp format="absolute" value={currentState.since} />
              </View>
              <TimeStamp style={s.heroRelative} value={currentState.since} />
            </View>
          </View>
        ) : (
          <EmptyState message={t('fsm.noState', 'No state data available')} />
        )}
      </GlassPanel>

      {/* Section 4: Sub-FSM Panel */}
      <FSMSubFSMPanel activeSubs={activeSubs} fsmType={subFsmType} t={t} />

      {/* Live controls + state timeline + inspector */}
      <GlassPanel style={s.panel} testID="debugger-timeline">
        <LiveControls
          canStepNext={!isLive && sortedByTime.length > 0 && selectedIndex < sortedByTime.length - 1}
          canStepPrev={!isLive && sortedByTime.length > 0 && selectedIndex > 0}
          isLive={isLive}
          onClearBuffer={handleClearBuffer}
          onStepNext={handleStepNext}
          onStepPrev={handleStepPrev}
          onToggleLive={live => {
            setIsLive(live);
            if (live) {
              setSelectedId(null);
            }
          }}
          onWindowChange={setWindowMinutes}
          t={t}
          totalCount={visibleTransitions.length}
          windowCount={windowed.inWindow.length}
          windowMinutes={windowMinutes}
        />
        <StateTimeline
          fsmType={subFsmType}
          lastTransition={windowed.lastTransition}
          onJumpToLast={handleJumpToLast}
          onSelect={tr => {
            setSelectedId(tr.id);
            setIsLive(false);
          }}
          onWidenWindow={handleWidenWindow}
          selectedId={selectedId}
          t={t}
          transitions={windowed.inWindow}
          widerPreset={widerPreset}
          windowMinutes={windowMinutes}
        />
        <SnapshotInspector
          fsmType={selectedTransition?.fsm_name || subFsmType}
          inWindowCount={windowed.inWindow.length}
          lastTransition={windowed.lastTransition}
          loading={snapshotFetching}
          onJumpToLast={handleJumpToLast}
          previousSnapshot={previousSnapshot ?? null}
          snapshot={selectedSnapshot ?? null}
          t={t}
          transition={selectedTransition}
        />
      </GlassPanel>

      {/* Section 5: State Diagram */}
      <FSMStateDiagram fsmType={subFsmType} t={t} transitions={transitions} />

      {/* Section 6: Distribution + Counts */}
      <View style={s.twoCol}>
        <GlassPanel style={s.panel}>
          <PanelHeading>{t('fsm.distributionByState', 'State Distribution')}</PanelHeading>
          {transLoading ? (
            <Skeleton height={120} />
          ) : pieData.length > 0 ? (
            <View style={s.legendWrap}>
              {pieData.map((entry, i) => (
                <View key={entry.name} style={s.legendItem}>
                  <View
                    style={[
                      s.legendDot,
                      { backgroundColor: CHART_COLORS[i % CHART_COLORS.length] },
                    ]}
                  />
                  <AppText tone="secondary" variant="caption">
                    {entry.name}
                  </AppText>
                  <AppText tone="muted" variant="caption">
                    {fmtInt(entry.value)}
                  </AppText>
                </View>
              ))}
            </View>
          ) : (
            <EmptyState message={emptyRangeMessage} />
          )}
        </GlassPanel>

        <GlassPanel style={s.panel}>
          <PanelHeading>{t('fsm.transitionCounts', 'Transition Counts')}</PanelHeading>
          {transLoading ? (
            <Skeleton height={120} />
          ) : summaryRows.length > 0 ? (
            <View style={s.tableBody}>
              <View style={s.tableHeaderRow}>
                <AppText style={s.tableHeadState} tone="muted" variant="caption">
                  {t('fsm.state', 'State')}
                </AppText>
                <AppText style={s.tableHeadRight} tone="muted" variant="caption">
                  {t('fsm.count', 'Transitions')}
                </AppText>
                <AppText style={s.tableHeadRight} tone="muted" variant="caption">
                  {t('fsm.avgInterval', 'Avg Interval')}
                </AppText>
              </View>
              {summaryRows.map(row => (
                <View key={row.to_state} style={s.tableRow}>
                  <View style={s.tableCellState}>
                    <StateBadge state={row.to_state} fsmType={subFsmType} />
                  </View>
                  <AppText style={s.tableCellRight} variant="caption">
                    {fmtInt(row.count)}
                  </AppText>
                  <AppText style={s.tableCellRightMuted} tone="secondary" variant="caption">
                    {row.avg_interval_sec > 0
                      ? formatDuration(row.avg_interval_sec)
                      : '—'}
                  </AppText>
                </View>
              ))}
            </View>
          ) : (
            <EmptyState message={emptyRangeMessage} />
          )}
        </GlassPanel>
      </View>

      {/* Section 7: Summary Cards */}
      <View style={s.statGrid}>
        <StatCard
          icon="activity"
          label={t('fsm.totalOnPage', 'Transitions (Page)')}
          value={`${fmtInt(totalTransitionsOnPage)} / ${fmtInt(totalRows)}`}
        />
        <StatCard
          icon="activity"
          label={t('fsm.totalTransitions', 'Total Transitions')}
          value={fmtInt(totalRows)}
        />
        <StatCard
          icon="warning"
          label={t('fsm.flapCount', 'Flap Warnings')}
          value={fmtInt(flapIds.size)}
        />
        <StatCard
          icon="bolt"
          label={t('fsm.currentState', 'Current State')}
          value={stateName ?? '—'}
        />
      </View>

      {/* Section 8: Transition Timeline Chart */}
      <FSMTimelineChart
        emptyMessage={emptyRangeMessage}
        hours={Number(hours)}
        t={t}
        transitions={timelineTransitions}
      />

      {/* Section 9: Transition Table */}
      <GlassPanel style={s.panel}>
        <View style={s.logHeader}>
          <PanelHeading>{t('fsm.timelineTitle', 'Transition Log')}</PanelHeading>
          {totalRows > 0 ? (
            <AppText tone="muted" variant="caption">
              {`${fmtInt(totalRows)} ${t('fsm.total', 'total')}`}
            </AppText>
          ) : null}
        </View>
        {transLoading ? (
          <View style={s.tableBody}>
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton height={44} key={i} />
            ))}
          </View>
        ) : transitions.length > 0 ? (
          <View style={s.tableBody}>
            {transitions.map((row, rowIdx) => {
              const globalIdx = (serverPage - 1) * perPage + rowIdx + 1;
              const expanded = selectedId === row.id;
              return (
                <Pressable
                  key={String(row.id)}
                  accessibilityRole="button"
                  onPress={() => setSelectedId(expanded ? null : row.id)}
                  style={s.logRow}
                >
                  <AppText style={s.logIndex} tone="muted" variant="caption">
                    {globalIdx}
                  </AppText>
                  <View style={s.logBody}>
                    <View style={s.logTopRow}>
                      <TimeStamp style={s.logTime} value={row.ts} />
                      <AppText style={s.logFsmName} tone="secondary" variant="caption">
                        {row.fsm_name?.replace('_', ' ') ?? 'vehicle'}
                      </AppText>
                    </View>
                    <View style={s.logStateRow}>
                      <StateBadge state={row.from_state} fsmType={row.fsm_name || 'vehicle'} />
                      <AppText tone="muted" variant="caption">
                        →
                      </AppText>
                      <StateBadge state={row.to_state} fsmType={row.fsm_name || 'vehicle'} />
                      <AppText style={s.logTrigger} tone="secondary" variant="caption">
                        {row.trigger}
                      </AppText>
                    </View>
                  </View>
                  <SemanticIcon
                    accessibilityLabel={t('fsm.viewDetail', 'View detail')}
                    name={expanded ? 'expand' : 'next'}
                    size="sm"
                  />
                </Pressable>
              );
            })}
            <Pagination
              onPageChange={setServerPage}
              onPageSizeChange={size => {
                setPerPage(size);
                setServerPage(1);
              }}
              page={serverPage}
              pageSize={perPage}
              total={totalRows}
            />
          </View>
        ) : (
          <EmptyState message={emptyRangeMessage} />
        )}
      </GlassPanel>

      {/* Section 10: Selected Transition Detail */}
      {selectedId != null
        ? (() => {
            const selected = transitions.find(tr => tr.id === selectedId);
            return selected ? (
              <GlassPanel style={s.panel}>
                <PanelHeading>{t('fsm.detailTitle', 'Transition Detail')}</PanelHeading>
                <TransitionDetail transition={selected} t={t} />
              </GlassPanel>
            ) : null;
          })()
        : null}
    </PageScaffold>
  );
}

const s = StyleSheet.create({
  actionSelect: {
    minWidth: 150,
  },
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  autoRefresh: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  barChart: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 2,
    height: 160,
    marginTop: spacing.sm,
  },
  barColumn: {
    flex: 1,
    height: '100%',
    justifyContent: 'flex-end',
  },
  barFill: {
    backgroundColor: colors.accent,
    borderRadius: 2,
    width: '100%',
  },
  barTrack: {
    height: '100%',
    justifyContent: 'flex-end',
  },
  button: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  buttonDisabled: {
    opacity: 0.45,
  },
  buttonGhost: {
    backgroundColor: 'transparent',
    borderColor: colors.border,
    borderWidth: 1,
  },
  buttonPressed: {
    opacity: 0.82,
  },
  buttonPrimary: {
    backgroundColor: colors.accent,
  },
  buttonPrimaryText: {
    color: colors.background,
  },
  buttonSecondary: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  buttonSecondaryText: {
    color: colors.textPrimary,
  },
  buttonSm: {
    minHeight: 30,
    paddingHorizontal: spacing.sm,
  },
  controls: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.sm,
  },
  controlsCounter: {
    marginLeft: 'auto',
  },
  controlsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  controlsWindow: {
    minWidth: 130,
  },
  detailChip: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  detailChipText: {
    fontSize: 11,
  },
  detailChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  detailField: {
    gap: spacing.xs,
    minWidth: 120,
  },
  detailFieldLabel: {
    fontSize: 11,
  },
  detailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  detailRelative: {
    color: colors.textMuted,
  },
  detailTimestamp: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  diagramArrow: {
    marginHorizontal: spacing.xs,
  },
  diagramCount: {
    marginTop: 2,
  },
  diagramDot: {
    borderRadius: 4,
    height: 8,
    marginBottom: 4,
    width: 8,
  },
  diagramNode: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    minWidth: 74,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  diagramNodeCurrent: {
    backgroundColor: colors.surfaceHover,
    borderColor: colors.borderAccent,
  },
  diagramNodeIdle: {
    opacity: 0.5,
  },
  diagramNodeWrap: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  diagramRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  edgeArrow: {
    marginHorizontal: 2,
  },
  edgeChip: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: 6,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  edgeCount: {
    marginLeft: 2,
  },
  edgeWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  emptyMessage: {
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  filterCell: {
    flexGrow: 1,
    flexBasis: 160,
    gap: spacing.xs,
  },
  filterGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  filterLabelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  headerActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  healthAlert: {
    alignItems: 'flex-start',
    backgroundColor: colors.surfaceRaised,
    borderRadius: 10,
    borderWidth: 1,
    flexBasis: 220,
    flexDirection: 'row',
    flexGrow: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  healthAlertBody: {
    flex: 1,
    gap: 2,
  },
  healthAlertCount: {
    fontSize: 18,
  },
  healthAlertMessage: {
    marginTop: 2,
  },
  healthClearRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  healthClearText: {
    color: PALETTE.green400,
    flex: 1,
  },
  healthDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  healthGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  heroDot: {
    borderRadius: 6,
    height: 12,
    marginRight: spacing.sm,
    width: 12,
  },
  heroMeta: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 180,
  },
  heroMetaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  heroPill: {
    alignItems: 'center',
    borderRadius: 18,
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  heroRelative: {
    color: colors.textMuted,
  },
  heroRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
    marginTop: spacing.sm,
  },
  heroState: {
    fontSize: 26,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  inspectorCell: {
    flexBasis: 120,
    flexGrow: 1,
    gap: spacing.xs,
  },
  inspectorEmptyText: {
    paddingVertical: spacing.lg,
    textAlign: 'center',
  },
  inspectorGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  inspectorHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  inspectorSignalsHeader: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between',
    marginTop: spacing.md,
    paddingTop: spacing.sm,
  },
  legendDot: {
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  legendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  legendWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  logBody: {
    flex: 1,
    gap: spacing.xs,
  },
  logFsmName: {
    textTransform: 'capitalize',
  },
  logHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  logIndex: {
    minWidth: 28,
    textAlign: 'right',
  },
  logRow: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  logStateRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  logTime: {
    color: colors.textSecondary,
  },
  logTopRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  logTrigger: {
    marginLeft: spacing.xs,
  },
  pageHeader: {
    gap: spacing.xs,
    marginBottom: spacing.lg,
  },
  pageSubtitle: {
    marginTop: spacing.xs,
  },
  pageTitle: {
    color: colors.textPrimary,
  },
  pagination: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
  },
  paginationSize: {
    minWidth: 80,
  },
  panel: {
    gap: spacing.sm,
    padding: spacing.md,
  },
  panelHeading: {
    color: colors.textPrimary,
    fontSize: 15,
  },
  scroll: {
    backgroundColor: colors.background,
    flex: 1,
  },
  scrollContent: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  sectionLabel: {
    color: colors.textSecondary,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  signalList: {
    gap: spacing.xs,
  },
  signalMain: {
    flex: 1,
    gap: 2,
  },
  signalName: {
    fontSize: 11,
  },
  signalPrev: {
    fontSize: 11,
    textDecorationLine: 'line-through',
  },
  signalRow: {
    alignItems: 'flex-start',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  signalRowDim: {
    opacity: 0.4,
  },
  signalRowHighlight: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
  },
  sourceBadge: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 6,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  sourceBadgeText: {
    fontSize: 10,
  },
  statCard: {
    flexBasis: 150,
    flexGrow: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  statCardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  statCardLabel: {
    flex: 1,
  },
  statCardValue: {
    color: colors.textPrimary,
    fontSize: 20,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  stateBadge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  stateBadgeDot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  stateBadgeText: {
    fontWeight: '600',
  },
  subCard: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    flexBasis: 220,
    flexDirection: 'row',
    flexGrow: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  subCardBody: {
    flex: 1,
    gap: spacing.xs,
  },
  subCardStateRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  subCardTime: {
    color: colors.textMuted,
    fontSize: 10,
  },
  subCardTitle: {
    color: colors.textPrimary,
  },
  subCardTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  subGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  tableBody: {
    gap: spacing.xs,
  },
  tableCellRight: {
    color: colors.textPrimary,
    flex: 1,
    textAlign: 'right',
  },
  tableCellRightMuted: {
    flex: 1,
    textAlign: 'right',
  },
  tableCellState: {
    flex: 1,
  },
  tableHeaderRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingBottom: spacing.xs,
  },
  tableHeadRight: {
    flex: 1,
    textAlign: 'right',
  },
  tableHeadState: {
    flex: 1,
  },
  tableRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  timeline: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    padding: spacing.md,
  },
  timelineAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  timelineAxisLabel: {
    fontSize: 10,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  timelineEmpty: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  timelineEmptyText: {
    flex: 1,
  },
  timelineLine: {
    backgroundColor: colors.border,
    height: 1,
    left: 0,
    position: 'absolute',
    right: 0,
    top: '50%',
  },
  timelineTick: {
    borderRadius: 6,
    height: 12,
    marginLeft: -6,
    position: 'absolute',
    top: 14,
    width: 12,
  },
  timelineTickSelected: {
    borderColor: colors.textPrimary,
    borderWidth: 2,
    height: 16,
    marginLeft: -8,
    top: 12,
    width: 16,
  },
  timelineTrack: {
    height: 40,
    justifyContent: 'center',
    position: 'relative',
  },
  toggleLabel: {
    marginLeft: 0,
  },
  toggleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  toggleThumb: {
    backgroundColor: colors.textPrimary,
    borderRadius: 7,
    height: 14,
    width: 14,
  },
  toggleThumbOn: {
    transform: [{ translateX: 16 }],
  },
  toggleTrack: {
    backgroundColor: colors.surfaceHover,
    borderRadius: 10,
    height: 20,
    justifyContent: 'center',
    paddingHorizontal: 2,
    width: 36,
  },
  toggleTrackOn: {
    backgroundColor: colors.accentSoft,
  },
  twoCol: {
    gap: spacing.md,
  },
});








