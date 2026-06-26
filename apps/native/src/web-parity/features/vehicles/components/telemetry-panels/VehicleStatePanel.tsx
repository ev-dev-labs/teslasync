// Native parity port of
// web/src/features/vehicles/components/telemetry-panels/VehicleStatePanel.tsx.
//
// The web component renders the live "Vehicle State" panel from a loose
// `live: Record<string, unknown>` SSE bag: a heading with an optional pulsing
// "Live" badge (when `sseConnected`), a Lights group (High Beams / Turn Signal /
// Hazards), a Driver & Keys group (Driver Seat / Paired Keys) and an Access Modes
// group (Valet / Service / Speed Limit / Center Display / HomeLink) separated by
// hairline dividers. It always renders (no empty state). It is reproduced here
// with React Native primitives, preserving the `VehicleStatePanelProps`
// (`live`/`sseConnected`), every `live.*` key read + `as string`/`as number`
// cast, every truthiness colour toggle, and the `formatSpeed(currentSpeedLimit)`
// / `|| '—'` / `|| 'Off'` fallbacks.
//
// Native-safe substitutions (documented in the parity sidecar):
//   - react-i18next `useTranslation` -> `useNativeTranslation()` shim (only the
//     web `t('common.off')` call is keyed; the rest of the copy is hardcoded
//     English in the web source and kept verbatim).
//   - lucide-react `Activity`/`Lightbulb`/`Car`/`ShieldAlert`/`User`/`Key`/
//     `Settings`/`Gauge`/`Monitor`/`MapPin` -> decorative Unicode `Glyph`s.
//   - `@/components/ui` `GlassPanel` -> native parity GlassPanel (p-6 -> 24).
//   - `@/hooks/useUnits` `formatSpeed` -> inlined native-safe formatter (km/h
//     metric default, precision 0, '—' empty).
//   - The `animate-pulse` neon "Live" dot becomes a static success dot (no
//     native-core CSS keyframe analog).

import React from 'react';
import {StyleSheet, View} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../../theme/tokens';

/* ─── inline shims ─────────────────────────────────────────────────────────── */

function useNativeTranslation(): (key: string, fallback: string) => string {
  return (_key, fallback) => fallback;
}

const ICON_ACTIVITY = '\u{1F4C8}'; // lucide Activity
const ICON_LIGHTBULB = '\u{1F4A1}'; // lucide Lightbulb
const ICON_CAR = '\u{1F697}'; // lucide Car
const ICON_SHIELD_ALERT = '\u{1F6E1}'; // lucide ShieldAlert
const ICON_USER = '\u{1F464}'; // lucide User
const ICON_KEY = '\u{1F511}'; // lucide Key
const ICON_SETTINGS = '\u2699'; // lucide Settings
const ICON_GAUGE = '\u{1F4A8}'; // lucide Gauge
const ICON_MONITOR = '\u{1F5A5}'; // lucide Monitor
const ICON_MAP_PIN = '\u{1F4CD}'; // lucide MapPin
const EM_DASH = '\u2014';

const CYAN_300 = '#67e8f9';
const AMBER_300 = '#fcd34d';
const ROSE_300 = '#fda4af';
const GREEN_400 = '#4ade80';
const PURPLE_400 = '#c084fc';
const AMBER_400 = '#fbbf24';

function formatSpeed(mps: number | null | undefined): string {
  if (typeof mps !== 'number' || !Number.isFinite(mps)) {
    return EM_DASH;
  }
  const value = (mps * 3600) / 1000;
  try {
    return `${value.toLocaleString('en-US', {maximumFractionDigits: 0, minimumFractionDigits: 0})} km/h`;
  } catch {
    return `${Math.round(value)} km/h`;
  }
}

/* ─── inline status row ─────────────────────────────────────────────────────── */

function StateRow({
  icon,
  label,
  value,
  color,
}: {
  icon: string;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <View style={styles.rowBetween}>
      <View style={styles.labelWithIcon}>
        <AppText importantForAccessibility="no" style={styles.smallIcon}>
          {icon}
        </AppText>
        <AppText style={styles.muted}>{label}</AppText>
      </View>
      <AppText style={[styles.value, {color}]}>{value}</AppText>
    </View>
  );
}

/* ─── component ─────────────────────────────────────────────────────────────── */

interface VehicleStatePanelProps {
  live: Record<string, unknown>;
  sseConnected: boolean;
}

export function VehicleStatePanel({live, sseConnected}: VehicleStatePanelProps) {
  const t = useNativeTranslation();

  const turnSignal = (live.lightsTurnSignal as string) || 'Off';

  return (
    <GlassPanel style={styles.panel}>
      <View style={styles.headingRow}>
        <AppText importantForAccessibility="no" style={styles.headingIcon}>
          {ICON_ACTIVITY}
        </AppText>
        <AppText accessibilityRole="header" style={styles.heading}>
          Vehicle State
        </AppText>
        {sseConnected ? (
          <View style={styles.liveBadge}>
            <View style={styles.liveDot} />
            <AppText style={styles.liveText}>Live</AppText>
          </View>
        ) : null}
      </View>

      <View style={styles.body}>
        {/* Lights */}
        <StateRow
          color={live.lightsHighBeams ? CYAN_300 : colors.textMuted}
          icon={ICON_LIGHTBULB}
          label="High Beams"
          value={live.lightsHighBeams ? 'On' : 'Off'}
        />
        <StateRow
          color={
            live.lightsTurnSignal && live.lightsTurnSignal !== 'Off'
              ? AMBER_300
              : colors.textMuted
          }
          icon={ICON_CAR}
          label="Turn Signal"
          value={turnSignal}
        />
        <StateRow
          color={live.lightsHazards ? ROSE_300 : colors.textMuted}
          icon={ICON_SHIELD_ALERT}
          label="Hazards"
          value={live.lightsHazards ? 'Active' : 'Off'}
        />

        <View style={styles.divider} />

        {/* Driver & Keys */}
        <StateRow
          color={live.driverSeatOccupied ? GREEN_400 : colors.textMuted}
          icon={ICON_USER}
          label="Driver Seat"
          value={live.driverSeatOccupied ? 'Occupied' : 'Empty'}
        />
        <StateRow
          color={colors.textPrimary}
          icon={ICON_KEY}
          label="Paired Keys"
          value={(live.pairedKeyCount as string) || EM_DASH}
        />

        <View style={styles.divider} />

        {/* Access Modes */}
        <StateRow
          color={live.valetMode ? PURPLE_400 : colors.textMuted}
          icon={ICON_CAR}
          label="Valet Mode"
          value={live.valetMode ? 'Enabled' : 'Off'}
        />
        <StateRow
          color={live.serviceMode ? AMBER_400 : colors.textMuted}
          icon={ICON_SETTINGS}
          label="Service Mode"
          value={live.serviceMode ? 'Active' : 'Off'}
        />
        <StateRow
          color={live.speedLimitMode ? CYAN_300 : colors.textMuted}
          icon={ICON_GAUGE}
          label="Speed Limit"
          value={
            live.speedLimitMode
              ? formatSpeed(live.currentSpeedLimit as number)
              : t('common.off', 'Off')
          }
        />
        <StateRow
          color={colors.textPrimary}
          icon={ICON_MONITOR}
          label="Center Display"
          value={(live.centerDisplay as string) || EM_DASH}
        />
        <StateRow
          color={colors.textPrimary}
          icon={ICON_MAP_PIN}
          label="HomeLink Devices"
          value={(live.homelinkDeviceCount as string) || EM_DASH}
        />
      </View>
    </GlassPanel>
  );
}

VehicleStatePanel.displayName = 'VehicleStatePanel';

const styles = StyleSheet.create({
  body: {
    gap: spacing.md,
  },
  divider: {
    backgroundColor: colors.border,
    height: StyleSheet.hairlineWidth,
  },
  heading: {
    fontSize: 16,
    fontWeight: '700',
  },
  headingIcon: {
    color: colors.accent,
    fontSize: 15,
    lineHeight: 18,
  },
  headingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  labelWithIcon: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  liveBadge: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    marginLeft: 'auto',
  },
  liveDot: {
    backgroundColor: colors.success,
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  liveText: {
    color: '#6ee7b7',
    fontSize: 10,
    lineHeight: 14,
  },
  muted: {
    color: colors.textMuted,
    fontSize: 12,
  },
  panel: {
    padding: spacing.lg,
  },
  rowBetween: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  smallIcon: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 14,
  },
  value: {
    fontSize: 12,
    fontWeight: '500',
  },
});
