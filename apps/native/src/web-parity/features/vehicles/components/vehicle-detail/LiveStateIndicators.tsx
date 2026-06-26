// Native parity port of
// web/src/features/vehicles/components/vehicle-detail/LiveStateIndicators.tsx.
//
// The web component renders a `flex flex-wrap gap-2` row of five live-state
// `Badge`s driven by a `VehicleState`:
//   - Speed   — success when `state.speed > 0` else neutral; value is
//               `formatSpeed(state.speed, { precision: 0 })`.
//   - Lock    — success `Locked` when `state.is_locked` else danger `Unlocked`.
//   - Sentry  — warning `Active` when `state.sentry_mode` else neutral `Off`.
//   - Climate — info `On` when `state.is_climate_on` else neutral `Off`.
//   - Charging— warning `Charging` when `state.is_charging` else neutral
//               `Not Charging`.
// Every badge is `dot size="lg"`. It is reproduced here with React Native
// primitives, preserving the `LiveStateIndicatorsProps` (`state: VehicleState`),
// every `state.*` read (speed / is_locked / sentry_mode / is_climate_on /
// is_charging), each variant toggle and each i18n key + fallback string.
//
// Native-safe substitutions (documented in the parity sidecar):
//   - react-i18next `useTranslation` -> `useNativeTranslation()` shim that
//     returns the web fallback copy verbatim (i18n intent preserved via keys).
//   - `@/hooks/useUnits` `formatSpeed` -> inlined native-safe formatter (km/h
//     metric default, precision 0, '—' for non-finite), matching the sibling
//     telemetry panels' inlined formatter.
//   - `@/components/ui` `Badge` (variant / dot / size="lg") -> inline
//     `StateBadge` pill: rounded-full, a `bg-current` dot, a tinted surface +
//     border, px-2.5 / py-1 / text-sm. Variant -> token map: info -> accent
//     (cyan; no blue token exists), success -> success, warning -> warning,
//     danger -> danger, neutral -> raised surface + muted text.

import React from 'react';
import {StyleSheet, View} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {colors, spacing} from '../../../../../theme/tokens';
import type {VehicleState} from '../../../../api/types';

/* ─── inline shims ─────────────────────────────────────────────────────────── */

function useNativeTranslation(): (key: string, fallback: string) => string {
  return (_key, fallback) => fallback;
}

const EM_DASH = '\u2014';

// Mirrors `useUnits().formatSpeed(value, { precision: 0 })`: the API surfaces
// speed in SI (m/s); display defaults to metric km/h with no fractional digits.
function formatSpeed(mps: number | null | undefined): string {
  if (typeof mps !== 'number' || !Number.isFinite(mps)) {
    return EM_DASH;
  }
  const value = (mps * 3600) / 1000;
  try {
    return `${value.toLocaleString('en-US', {
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    })} km/h`;
  } catch {
    return `${Math.round(value)} km/h`;
  }
}

/* ─── inline Badge parity ───────────────────────────────────────────────────── */

type BadgeVariant = 'info' | 'success' | 'warning' | 'danger' | 'neutral';

const VARIANT_COLORS: Record<
  BadgeVariant,
  {fg: string; bg: string; border: string}
> = {
  info: {fg: colors.accent, bg: colors.accentSoft, border: colors.borderAccent},
  success: {
    fg: colors.success,
    bg: colors.successSurface,
    border: colors.successBorder,
  },
  warning: {
    fg: colors.warning,
    bg: colors.warningSurface,
    border: colors.warningBorder,
  },
  danger: {
    fg: colors.danger,
    bg: colors.dangerSurface,
    border: colors.dangerBorder,
  },
  neutral: {
    fg: colors.textMuted,
    bg: colors.surfaceRaised,
    border: colors.border,
  },
};

function StateBadge({
  variant,
  children,
}: {
  variant: BadgeVariant;
  children: string;
}) {
  const palette = VARIANT_COLORS[variant];
  return (
    <View
      style={[
        styles.badge,
        {backgroundColor: palette.bg, borderColor: palette.border},
      ]}>
      <View style={[styles.dot, {backgroundColor: palette.fg}]} />
      <AppText style={[styles.badgeText, {color: palette.fg}]}>
        {children}
      </AppText>
    </View>
  );
}

/* ─── component ─────────────────────────────────────────────────────────────── */

interface LiveStateIndicatorsProps {
  state: VehicleState;
}

export function LiveStateIndicators({state}: LiveStateIndicatorsProps) {
  const t = useNativeTranslation();

  return (
    <View style={styles.row}>
      <StateBadge variant={state.speed > 0 ? 'success' : 'neutral'}>
        {`${t('common.speed', 'Speed')}: ${formatSpeed(state.speed)}`}
      </StateBadge>
      <StateBadge variant={state.is_locked ? 'success' : 'danger'}>
        {state.is_locked
          ? t('common.locked', 'Locked')
          : t('common.unlocked', 'Unlocked')}
      </StateBadge>
      <StateBadge variant={state.sentry_mode ? 'warning' : 'neutral'}>
        {`${t('common.sentry', 'Sentry')}: ${
          state.sentry_mode ? t('common.active', 'Active') : t('common.off', 'Off')
        }`}
      </StateBadge>
      <StateBadge variant={state.is_climate_on ? 'info' : 'neutral'}>
        {`${t('common.climate', 'Climate')}: ${
          state.is_climate_on ? t('common.on', 'On') : t('common.off', 'Off')
        }`}
      </StateBadge>
      <StateBadge variant={state.is_charging ? 'warning' : 'neutral'}>
        {state.is_charging
          ? t('common.charging', 'Charging')
          : t('common.notCharging', 'Not Charging')}
      </StateBadge>
    </View>
  );
}

LiveStateIndicators.displayName = 'LiveStateIndicators';

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 18,
  },
  dot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
