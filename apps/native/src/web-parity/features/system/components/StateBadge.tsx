// Native parity port of web/src/features/system/components/StateBadge.tsx.
//
// Renders a single FSM "state" pill used throughout the State-Machine Debugger
// (and the FSM sub-FSM / snapshot inspectors): a rounded-full badge tinted by
// the state's semantic color, with a leading status dot and the lowercase state
// name. The pill's background, text color, and dot color all come from the
// per-FSM color resolver for the given (fsmType, state) pair.
//
// Native-safe substitutions (rules 4-7), documented in the parity sidecar:
//   • `@/lib/cn` (clsx + tailwind-merge) is a Tailwind/DOM-only class composer ->
//     dropped in favour of a React Native StyleSheet + theme tokens (the
//     FSMStateDiagram / EmptyState parity precedent).
//   • `@/types/fsm` `getStateColor` is NOT yet ported into the parity tree (it
//     has its own conversion slots), so — following the sibling FSMStateDiagram
//     port — the resolver is inlined here. The web getStateColor returns Tailwind
//     class strings (`.bg`/`.text`/`.dot`); the native resolver returns the
//     literal hex/rgba each class maps to (the LocationsPage exact-hex
//     precedent), with every per-state `overrides` from the source pre-applied.
//     StateBadge consumes all three channels (.bg + .text + .dot), so all three
//     are resolved here (FSMStateDiagram needed only .dot + .text).
//   • The DOM `<span>` pill + inner `<span>` dot -> RN `<View>` + `<AppText>`
//     primitives; the web `inline-flex` shrink-to-content pill -> a row View with
//     `alignSelf: 'flex-start'`; `color.text` (a className inherited by the span
//     text in HTML) is applied to the RN `<AppText>` label, since RN text color
//     must live on the Text node.
// No DOM elements, Tailwind/cn, Recharts, Leaflet, or web UI-kit modules are
// imported into the native output.

import React from 'react';
import {StyleSheet, View} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {colors} from '../../../../theme/tokens';

/* ─── inlined `@/types/fsm` getStateColor (bg + text + dot) ─────────────── */

interface StateColor {
  // Pill background (web `.bg` Tailwind class, e.g. `bg-green-500/10`).
  bg: string;
  // State-name label color (web `.text` Tailwind class).
  text: string;
  // Leading status-dot color (web `.dot` Tailwind class).
  dot: string;
}

// Exact Tailwind v3 palette values used by the source variants + overrides. The
// `/10` and `/5` background tints are the matching 10% / 5%-alpha rgba forms.
const TW = {
  green400: '#4ade80',
  amber400: '#fbbf24',
  red400: '#f87171',
  red500: '#ef4444',
  blue400: '#60a5fa',
  cyan400: '#22d3ee',
  purple400: '#c084fc',
  indigo400: '#818cf8',
  orange400: '#fb923c',
  gray400: '#9ca3af',
  gray500: '#6b7280',
  // automation.disabled uses text/dot red-400/50 + bg red-500/5 (alpha tints).
  red400Alpha50: 'rgba(248,113,113,0.5)',
  // `.bg` tints (Tailwind `{color}-500/10`, `-600/10`, `-500/5`).
  bgGreen: 'rgba(34,197,94,0.1)',
  bgAmber: 'rgba(245,158,11,0.1)',
  bgRed: 'rgba(239,68,68,0.1)',
  bgRedAlpha05: 'rgba(239,68,68,0.05)',
  bgRed600: 'rgba(220,38,38,0.1)',
  bgBlue: 'rgba(59,130,246,0.1)',
  bgCyan: 'rgba(6,182,212,0.1)',
  bgPurple: 'rgba(168,85,247,0.1)',
  bgIndigo: 'rgba(99,102,241,0.1)',
  bgOrange: 'rgba(249,115,22,0.1)',
  bgGray: 'rgba(107,114,128,0.1)',
  bgGray600: 'rgba(75,85,99,0.1)',
} as const;

// Neutral default, matching the web DEFAULT_STATE (variant 'neutral': gray-500/10
// bg, muted text, gray-400 dot) returned by getStateColor for unknown states.
const DEFAULT_STATE_COLOR: StateColor = {
  bg: TW.bgGray,
  text: colors.textMuted,
  dot: TW.gray400,
};

// Per-FSM, per-state resolved colors (variant theme + source `overrides`
// already applied). Keys are the lowercase state names getStateColor looks up.
const STATE_COLORS: Record<string, Record<string, StateColor>> = {
  vehicle: {
    online: {bg: TW.bgGreen, text: TW.green400, dot: TW.green400},
    driving: {bg: TW.bgGreen, text: TW.green400, dot: TW.green400},
    charging: {bg: TW.bgCyan, text: TW.cyan400, dot: TW.cyan400},
    parked: {bg: TW.bgPurple, text: TW.purple400, dot: TW.purple400},
    updating: {bg: TW.bgIndigo, text: TW.indigo400, dot: TW.indigo400},
    asleep: {bg: TW.bgGray, text: colors.textMuted, dot: TW.gray400},
    offline: {bg: TW.bgGray600, text: colors.textMuted, dot: TW.gray500},
  },
  drive_session: {
    pending: {bg: TW.bgAmber, text: TW.amber400, dot: TW.amber400},
    active: {bg: TW.bgGreen, text: TW.green400, dot: TW.green400},
    ending: {bg: TW.bgOrange, text: TW.orange400, dot: TW.orange400},
    completed: {bg: TW.bgIndigo, text: TW.indigo400, dot: TW.indigo400},
    recovered: {bg: TW.bgPurple, text: TW.purple400, dot: TW.purple400},
  },
  charge_session: {
    pending: {bg: TW.bgAmber, text: TW.amber400, dot: TW.amber400},
    active: {bg: TW.bgCyan, text: TW.cyan400, dot: TW.cyan400},
    completing: {bg: TW.bgBlue, text: TW.blue400, dot: TW.blue400},
    done: {bg: TW.bgGreen, text: TW.green400, dot: TW.green400},
    recovered: {bg: TW.bgPurple, text: TW.purple400, dot: TW.purple400},
  },
  command: {
    queued: {bg: TW.bgGray, text: colors.textMuted, dot: TW.gray400},
    waking: {bg: TW.bgAmber, text: TW.amber400, dot: TW.amber400},
    wake_confirmed: {bg: TW.bgBlue, text: TW.blue400, dot: TW.blue400},
    wake_timeout: {bg: TW.bgOrange, text: TW.orange400, dot: TW.orange400},
    sending: {bg: TW.bgBlue, text: TW.blue400, dot: TW.blue400},
    succeeded: {bg: TW.bgGreen, text: TW.green400, dot: TW.green400},
    failed: {bg: TW.bgRed, text: TW.red400, dot: TW.red400},
    timed_out: {bg: TW.bgOrange, text: TW.orange400, dot: TW.orange400},
    retrying: {bg: TW.bgPurple, text: TW.purple400, dot: TW.purple400},
    gave_up: {bg: TW.bgRed600, text: TW.red500, dot: TW.red500},
  },
  notification: {
    created: {bg: TW.bgGray, text: colors.textMuted, dot: TW.gray400},
    sending: {bg: TW.bgBlue, text: TW.blue400, dot: TW.blue400},
    delivered: {bg: TW.bgGreen, text: TW.green400, dot: TW.green400},
    partial: {bg: TW.bgAmber, text: TW.amber400, dot: TW.amber400},
    failed: {bg: TW.bgRed, text: TW.red400, dot: TW.red400},
    retrying: {bg: TW.bgPurple, text: TW.purple400, dot: TW.purple400},
    dead: {bg: TW.bgRed600, text: TW.red500, dot: TW.red500},
  },
  alert_cooldown: {
    armed: {bg: TW.bgGreen, text: TW.green400, dot: TW.green400},
    fired: {bg: TW.bgRed, text: TW.red400, dot: TW.red400},
    suppressed: {bg: TW.bgAmber, text: TW.amber400, dot: TW.amber400},
  },
  automation: {
    idle: {bg: TW.bgGray, text: colors.textSecondary, dot: TW.gray400},
    evaluating: {bg: TW.bgCyan, text: TW.cyan400, dot: TW.cyan400},
    executing: {bg: TW.bgAmber, text: TW.amber400, dot: TW.amber400},
    succeeded: {bg: TW.bgGreen, text: TW.green400, dot: TW.green400},
    partial: {bg: TW.bgAmber, text: TW.amber400, dot: TW.amber400},
    failed: {bg: TW.bgRed, text: TW.red400, dot: TW.red400},
    retrying: {bg: TW.bgAmber, text: TW.amber400, dot: TW.amber400},
    gave_up: {bg: TW.bgRed600, text: TW.red500, dot: TW.red500},
    skipped: {bg: TW.bgGray600, text: colors.textMuted, dot: TW.gray500},
    cooldown: {bg: TW.bgPurple, text: TW.purple400, dot: TW.purple400},
    disabled: {bg: TW.bgRedAlpha05, text: TW.red400Alpha50, dot: TW.red400Alpha50},
  },
  telemetry_connection: {
    unknown: {bg: TW.bgGray, text: colors.textMuted, dot: TW.gray400},
    connecting: {bg: TW.bgAmber, text: TW.amber400, dot: TW.amber400},
    streaming: {bg: TW.bgGreen, text: TW.green400, dot: TW.green400},
    stale: {bg: TW.bgAmber, text: TW.amber400, dot: TW.amber400},
    disconnected: {bg: TW.bgRed, text: TW.red400, dot: TW.red400},
    polling_only: {bg: TW.bgBlue, text: TW.blue400, dot: TW.blue400},
  },
};

// Resolve a state's badge colors for a given FSM type. Mirrors the web
// getStateColor: unknown FSM type falls back to the vehicle table, unknown state
// falls back to the neutral DEFAULT_STATE, and the state name is matched
// case-insensitively.
function getStateColor(fsmType: string, state: string): StateColor {
  const table = STATE_COLORS[fsmType] ?? STATE_COLORS.vehicle;
  return table[state.toLowerCase()] ?? DEFAULT_STATE_COLOR;
}

/* ─── component ───────────────────────────────────────────────────────── */

interface StateBadgeProps {
  state: string;
  fsmType: string;
}

export function StateBadge({state, fsmType}: StateBadgeProps) {
  const color = getStateColor(fsmType, state);
  return (
    <View style={[styles.badge, {backgroundColor: color.bg}]}>
      <View style={[styles.dot, {backgroundColor: color.dot}]} />
      <AppText style={[styles.label, {color: color.text}]}>{state}</AppText>
    </View>
  );
}

StateBadge.displayName = 'StateBadge';

const styles = StyleSheet.create({
  // inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 9999,
  },
  // h-1.5 w-1.5 rounded-full
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  // text-xs font-medium
  label: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
  },
});
