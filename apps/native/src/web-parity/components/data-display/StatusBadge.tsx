// Native parity port of web/src/components/data-display/StatusBadge.tsx.
//
// Renders the vehicle-status pill: a state-colored dot plus the capitalized
// status label inside a rounded, bordered chip. The web component resolves the
// dot color from the shared FSM registry via
// `getStateDefinition('vehicle', status).badgeDot`, which yields a Tailwind
// class with no meaning in React Native. The vehicle FSM's state -> badge-dot
// resolution is therefore ported inline here and each Tailwind dot color is
// translated to its literal hex value, preserving the exact visual intent
// (online=green, driving=blue, charging=yellow, parked=cyan, updating=indigo,
// asleep=purple, offline=red, unknown=neutral gray). The `cn` class-merge
// helper (web Tailwind/clsx) is dropped; the chip's class intent (rounded-full
// border + dark surface, capitalized secondary text, size-scaled
// dot/gap/padding/text) is reproduced with StyleSheet + theme tokens. See the
// .parity.json sidecar for the line-by-line source map.

import React from 'react';
import {StyleSheet, View, type StyleProp, type ViewStyle} from 'react-native';

import {AppText} from '../../../components/ui/AppText';
import {colors} from '../../../theme/tokens';

// ---- Ported FSM badge-dot resolution (web/src/types/fsm) --------------------

/** Semantic badge variants (web `@/types/fsm` BadgeVariant). */
export type BadgeVariant =
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'neutral';

/**
 * Vehicle operational states (web `@/types/fsm` VehicleState, re-exported as
 * `@/api/types` VehicleStatus). Mirrors Go `internal/enums/constants.go` plus
 * the frontend-only `updating` state.
 */
export type VehicleStatus =
  | 'online'
  | 'driving'
  | 'charging'
  | 'parked'
  | 'updating'
  | 'asleep'
  | 'offline';

/**
 * Variant -> badge-dot color. Native hex translation of the web
 * `VARIANT_THEME[variant].badgeDot` Tailwind classes: success -> bg-green-400,
 * warning -> bg-amber-400, danger -> bg-red-400, info -> bg-blue-400,
 * neutral -> bg-gray-400.
 */
const VARIANT_BADGE_DOT: Record<BadgeVariant, string> = {
  success: '#4ade80', // green-400
  warning: '#fbbf24', // amber-400
  danger: '#f87171', // red-400
  info: '#60a5fa', // blue-400
  neutral: '#9ca3af', // gray-400
};

/**
 * Per-state variant + optional badge-dot override, ported from web
 * `VEHICLE_STATE_ENTRIES`. Override hex values translate that file's Tailwind
 * `overrides.badgeDot` classes.
 */
const VEHICLE_STATE_ENTRIES: Record<
  VehicleStatus,
  {variant: BadgeVariant; badgeDot?: string}
> = {
  online: {variant: 'success'},
  driving: {variant: 'success', badgeDot: '#3b82f6'}, // bg-blue-500
  charging: {variant: 'warning', badgeDot: '#facc15'}, // bg-yellow-400
  parked: {variant: 'info', badgeDot: '#06b6d4'}, // bg-cyan-500
  updating: {variant: 'info', badgeDot: '#6366f1'}, // bg-indigo-500
  asleep: {variant: 'neutral', badgeDot: '#a855f7'}, // bg-purple-500
  offline: {variant: 'danger'},
};

/** Default dot for unknown states (web `DEFAULT_STATE`, neutral variant). */
const DEFAULT_BADGE_DOT = VARIANT_BADGE_DOT.neutral;

/**
 * Native equivalent of `getStateDefinition('vehicle', status).badgeDot`:
 * lower-cases the lookup key, applies the per-state override over the variant
 * base, and falls back to the neutral dot for unrecognized states.
 */
export function vehicleBadgeDotColor(status: string): string {
  const entry = VEHICLE_STATE_ENTRIES[status.toLowerCase() as VehicleStatus];
  if (!entry) {
    return DEFAULT_BADGE_DOT;
  }
  return entry.badgeDot ?? VARIANT_BADGE_DOT[entry.variant];
}

// ---- Size scale (web `sizes` map) ------------------------------------------

type StatusBadgeSize = 'sm' | 'md';

interface SizeScale {
  dot: number;
  fontSize: number;
  lineHeight: number;
  gap: number;
  paddingHorizontal: number;
  paddingVertical: number;
}

/**
 * Native numeric translation of the web Tailwind `sizes` tokens
 * (1 Tailwind unit = 4px):
 *   sm: dot h-1.5/w-1.5=6, text-xs=12/16, gap-1=4, px-1.5=6, py-0.5=2
 *   md: dot h-2/w-2=8,     text-sm=14/20, gap-1.5=6, px-2=8,  py-1=4
 */
const SIZES: Record<StatusBadgeSize, SizeScale> = {
  sm: {
    dot: 6,
    fontSize: 12,
    lineHeight: 16,
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  md: {
    dot: 8,
    fontSize: 14,
    lineHeight: 20,
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
};

// ---- Component --------------------------------------------------------------

export interface StatusBadgeProps {
  status: VehicleStatus | (string & {});
  size?: StatusBadgeSize;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  'data-testid'?: string;
  accessibilityLabel?: string;
}

/**
 * `<StatusBadge>` — vehicle status pill with a state-colored dot and the
 * capitalized status label. Mirrors the web chip (rounded-full border + dark
 * surface, capitalized secondary text) at the `sm`/`md` size scale.
 */
export function StatusBadge({
  status,
  size = 'md',
  className: _className,
  style,
  testID,
  'data-testid': dataTestID,
  accessibilityLabel,
}: StatusBadgeProps) {
  const s = SIZES[size];
  const dotColor = vehicleBadgeDotColor(status);

  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel ?? status}
      accessibilityRole="text"
      style={[
        styles.root,
        {
          gap: s.gap,
          paddingHorizontal: s.paddingHorizontal,
          paddingVertical: s.paddingVertical,
        },
        style,
      ]}
      testID={testID ?? dataTestID ?? 'status-badge'}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.dot,
          {backgroundColor: dotColor, height: s.dot, width: s.dot},
        ]}
        testID="status-badge-dot"
      />
      <AppText style={[styles.label, {fontSize: s.fontSize, lineHeight: s.lineHeight}]}>
        {status}
      </AppText>
    </View>
  );
}

StatusBadge.displayName = 'StatusBadge';

const styles = StyleSheet.create({
  dot: {
    borderRadius: 9999,
  },
  label: {
    color: colors.textSecondary,
    fontWeight: '500',
    textTransform: 'capitalize',
  },
  root: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#1f2937', // gray-800 (web dark:bg-gray-800)
    borderColor: '#374151', // gray-700 (web dark:border-gray-700)
    borderRadius: 9999,
    borderWidth: 1,
    flexDirection: 'row',
  },
});
