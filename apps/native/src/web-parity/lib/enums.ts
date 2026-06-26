// Native parity port of web/src/lib/enums.ts.
//
// Centralized TypeScript enum types and display config.
// Vehicle state types/helpers re-exported from FSM single source.
//
// ## Native conversion (contract rules 6 + 7)
//
// enums.ts is non-visual utility/type code: state-string -> badge-color /
// text-class / label helpers, plus gear/charge/window string-literal unions and
// two charge-state predicates. It touches no DOM, no browser globals, no
// Recharts/Leaflet, and no web UI components, so the logic ports 1:1 to
// React Native-compatible TypeScript (contract rule 6).
//
// On the web this module pulls `VehicleState`, `VEHICLE_STATE_ENTRIES`, and
// `resolveStyle` from the `@/types/fsm` single source. That FSM module is not
// yet part of the native parity layer, so — following the sibling
// closestRoute.ts port (which inlined `RouteEntry` from the not-yet-ported
// routeRegistry) — the minimal pieces enums.ts actually consumes are inlined
// here verbatim from web/src/types/fsm (theme.ts: BadgeVariant / StateStyle /
// StateEntry / ResolvedStateStyle / VARIANT_THEME / resolveStyle; vehicle.ts:
// VEHICLE_STATES / VehicleState / VEHICLE_STATE_ENTRIES). They stay
// module-private so enums.ts's public surface stays identical to the web
// (`VehicleState` plus the helpers/types exported below). When the FSM module
// is ported to native these inlines collapse to a relative import.
//
// `getStateColor` returns the web Tailwind text-color class string verbatim
// (e.g. 'text-green-400', 'text-[var(--text-muted)]') for behavioral parity —
// the native display boundary maps it exactly as `getStateBadgeColor` returns a
// semantic color name. No CSS or DOM is introduced here.

/* ── Inlined FSM single-source pieces (web/src/types/fsm) ──
 * Module-private; see the native-conversion header above. */

/** Semantic badge variants used across the entire app (fsm/types.ts) */
type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

/** Visual style derived from a BadgeVariant (fsm/types.ts) */
interface StateStyle {
  badgeDot: string; // Tailwind class for the badge dot color
  bg: string; // Tailwind class for background (panel/card tint)
  text: string; // Tailwind class for text color
  dot: string; // Tailwind class for status dot in diagrams
}

/** A single state in an FSM: just a variant. Theme resolves the rest. */
interface StateEntry {
  variant: BadgeVariant;
  /** Optional override: only use when a state MUST differ from theme defaults. */
  overrides?: Partial<StateStyle>;
}

/** Resolved state style = theme defaults merged with optional overrides */
type ResolvedStateStyle = StateStyle & {variant: BadgeVariant};

/**
 * Single source of truth: BadgeVariant -> Tailwind classes (fsm/theme.ts).
 * Class strings preserved verbatim for behavioral parity (see header).
 */
const VARIANT_THEME: Record<BadgeVariant, StateStyle> = {
  success: {
    badgeDot: 'bg-green-400',
    bg: 'bg-green-500/10',
    text: 'text-green-400',
    dot: 'bg-green-400',
  },
  warning: {
    badgeDot: 'bg-amber-400',
    bg: 'bg-amber-500/10',
    text: 'text-amber-400',
    dot: 'bg-amber-400',
  },
  danger: {
    badgeDot: 'bg-red-400',
    bg: 'bg-red-500/10',
    text: 'text-red-400',
    dot: 'bg-red-400',
  },
  info: {
    badgeDot: 'bg-blue-400',
    bg: 'bg-blue-500/10',
    text: 'text-blue-400',
    dot: 'bg-blue-400',
  },
  neutral: {
    badgeDot: 'bg-gray-400',
    bg: 'bg-gray-500/10',
    text: 'text-[var(--text-muted)]',
    dot: 'bg-gray-400',
  },
};

/** Resolve a StateEntry to its full visual style (theme + overrides) */
function resolveStyle(entry: StateEntry): ResolvedStateStyle {
  const base = VARIANT_THEME[entry.variant];
  return {
    variant: entry.variant,
    ...base,
    ...entry.overrides,
  };
}

/**
 * Vehicle operational states — MUST match Go `internal/enums/constants.go`
 * plus frontend-only 'updating' (from Tesla API, not our FSM). (fsm/vehicle.ts)
 */
const VEHICLE_STATES = [
  'online',
  'driving',
  'charging',
  'parked',
  'updating',
  'asleep',
  'offline',
] as const;

/**
 * Each state maps to a BadgeVariant. Theme resolves all Tailwind classes.
 * Overrides used only when a state needs a non-standard color. (fsm/vehicle.ts)
 */
const VEHICLE_STATE_ENTRIES: Record<VehicleState, StateEntry> = {
  online: {variant: 'success'},
  driving: {
    variant: 'success',
    overrides: {
      badgeDot: 'bg-blue-500',
      bg: 'bg-green-500/10',
      text: 'text-green-400',
      dot: 'bg-green-400',
    },
  },
  charging: {
    variant: 'warning',
    overrides: {
      badgeDot: 'bg-yellow-400',
      bg: 'bg-cyan-500/10',
      text: 'text-cyan-400',
      dot: 'bg-cyan-400',
    },
  },
  parked: {
    variant: 'info',
    overrides: {
      badgeDot: 'bg-cyan-500',
      bg: 'bg-purple-500/10',
      text: 'text-purple-400',
      dot: 'bg-purple-400',
    },
  },
  updating: {
    variant: 'info',
    overrides: {
      badgeDot: 'bg-indigo-500',
      bg: 'bg-indigo-500/10',
      text: 'text-indigo-400',
      dot: 'bg-indigo-400',
    },
  },
  asleep: {variant: 'neutral', overrides: {badgeDot: 'bg-purple-500'}},
  offline: {
    variant: 'danger',
    overrides: {
      bg: 'bg-gray-600/10',
      text: 'text-[var(--text-muted)]',
      dot: 'bg-gray-500',
    },
  },
};

/* ── Vehicle States — re-export from FSM single source (inlined above) ── */

export type VehicleState = (typeof VEHICLE_STATES)[number];

/** Badge color name for the shared Badge component, given a vehicle state string */
export function getStateBadgeColor(
  state: string | undefined | null,
): 'green' | 'amber' | 'cyan' | 'purple' | 'red' | 'neutral' {
  const s = (state ?? '').toLowerCase() as VehicleState;
  const entry = VEHICLE_STATE_ENTRIES[s];
  if (!entry) return 'neutral';
  const variantMap: Record<
    string,
    'green' | 'amber' | 'cyan' | 'purple' | 'red' | 'neutral'
  > = {
    success: 'green',
    warning: 'amber',
    info: 'cyan',
    neutral: 'neutral',
    danger: 'red',
  };
  return variantMap[entry.variant] ?? 'neutral';
}

/** CSS text color class for a vehicle state */
export function getStateColor(state: string | undefined | null): string {
  const s = (state ?? '').toLowerCase() as VehicleState;
  const entry = VEHICLE_STATE_ENTRIES[s];
  return entry ? resolveStyle(entry).text : 'text-[var(--text-muted)]';
}

/** Display label for a vehicle state */
export function getStateLabel(state: string | undefined | null): string {
  const labels: Record<string, string> = {
    driving: 'Driving',
    charging: 'Charging',
    parked: 'Parked',
    asleep: 'Asleep',
    online: 'Online',
    offline: 'Offline',
    updating: 'Updating',
  };
  return labels[(state ?? '').toLowerCase()] ?? 'Unknown';
}

/* ── Gear States ── */

export type GearState = 'D' | 'R' | 'P' | 'N';

/* ── Charge States ── */

export type DetailedChargeState =
  | 'Charging'
  | 'Complete'
  | 'Disconnected'
  | 'NoPower'
  | 'Starting'
  | 'Stopped'
  | 'Error';

export function isChargingState(state: string | undefined | null): boolean {
  if (!state) return false;
  return (
    state.includes('Charging') ||
    state.includes('Starting') ||
    state === 'Enable'
  );
}

export function isChargeCompleteState(
  state: string | undefined | null,
): boolean {
  if (!state) return false;
  return state.includes('Complete');
}

/* ── Window States ── */

export type WindowState = 'Closed' | 'Partial' | 'Open';

export type ChargePortLatchState = 'Engaged' | 'Disengaged';
