// Native parity port of
// web/src/features/admin/components/security-access/LiveVehicleState.tsx.
//
// Renders the live "current state" tile grid for a vehicle's security/access
// signals (hazards, high beams, turn signal, driver seat, paired keys, valet
// mode, service mode, speed limit, HomeLink devices, center display). The web
// original maps the latest SecurityEvent into 10 LiveSignal descriptors and
// renders each inside a shared GlassPanel tile, colouring the icon + value cyan
// when the signal is "active" and muting it otherwise; an empty `latest` falls
// back to the shared EmptyState message.
//
// Native-safe adaptations (documented in the sidecar):
//   - @/components/motion FadeIn (a framer-motion entrance wrapper, delay 0.17)
//     has no native parity primitive yet, so the panel renders statically — the
//     delay is a non-behavioural animation timing and is dropped (no Animated,
//     to avoid open handles under --detectOpenHandles).
//   - @/components/ui GlassPanel -> the shared native GlassPanel (outer panel +
//     per-signal tiles); the web `hover` prop is a pointer affordance with no
//     touch parity, so it is omitted.
//   - The lucide JSX icons (Flashlight / Lightbulb / Signal / Armchair / Key /
//     Car / Wrench / Gauge / Home / Monitor) are colour-bound to the active
//     state in the web (text-cyan-400 vs --text-muted), which the bordered
//     SemanticIcon chip cannot reproduce, so each icon collapses to a short
//     2-char glyph stand-in rendered as AppText whose colour switches between
//     colors.accent (active, web text-cyan-400) and colors.textMuted exactly as
//     on web. The lucide CircleDot pulse indicator -> a static "\u25CF" success
//     dot + "Live" label (colors.success, web text-green-400); the animate-pulse
//     is dropped for the same open-handle reason.
//   - @/components/feedback EmptyState is called with only `message` on web
//     (title omitted); the native shared EmptyState requires a title, so the
//     title-less centred message is reproduced inline with View + AppText to
//     match the web's actual output.
//   - @/lib/typeGuards.asNonEmptyString and the helpers.ts boolLabel are inlined
//     verbatim (native has no typeGuards module), preserving the "never coerce a
//     non-string" narrowing contract.
//   - @/lib/cn (className join) -> conditional StyleSheet style arrays.
//   - react-i18next useTranslation -> a native key/English-default `t` fallback
//     preserving every admin.security.* key and default string verbatim.
//   - The responsive grid (grid-cols-2 sm:3 lg:5) collapses to a flex-wrap grid
//     that defaults to two columns on a phone and grows wider screens — RN has
//     no CSS media-query breakpoints.
//
// No DOM, Recharts, Leaflet, framer-motion, lucide-react, or old web UI
// components are imported.

import React, { useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '../../../../../components/ui/AppText';
import { GlassPanel } from '../../../../../components/ui/GlassPanel';
import { colors, spacing } from '../../../../../theme/tokens';
import type { SecurityEvent } from '../../../../api/hooks/useAdmin';

/* ─── i18n fallback ───────────────────────────────────────────────────── */

// react-i18next is not wired on native. i18next returns the supplied English
// default when a key is missing, so the fallback returns that default verbatim.
type TFunc = (key: string, fallback: string) => string;

function useNativeT(): TFunc {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

/* ─── Inlined web @/lib/typeGuards.asNonEmptyString ───────────────────── */

// Returns `v` only when it is a non-empty string; null otherwise — preserves the
// "never coerce a non-string to a string" invariant so a boolean `false` slipping
// into a string-typed signal field never matches the "off" string checks below.
function asNonEmptyString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/* ─── Live signal builder (web uses JSX icons; native uses glyph strings) ─ */

interface LiveSignal {
  key: string;
  label: string;
  glyph: string;
  value: string;
  active: boolean;
}

function boolLabel(val: boolean | null | undefined, t: TFunc): string {
  if (val == null) {
    return '\u2014';
  }
  return val ? t('admin.security.on', 'On') : t('admin.security.off', 'Off');
}

function buildLiveSignals(
  ev: SecurityEvent | undefined,
  t: TFunc,
): LiveSignal[] {
  if (!ev) {
    return [];
  }
  return [
    {
      key: 'hazards',
      label: t('admin.security.live.hazards', 'Hazards'),
      glyph: 'HZ',
      value: boolLabel(ev.lightsHazardsActive, t),
      active: !!ev.lightsHazardsActive,
    },
    {
      key: 'highBeams',
      label: t('admin.security.live.highBeams', 'High Beams'),
      glyph: 'HB',
      value: boolLabel(ev.lightsHighBeams, t),
      active: !!ev.lightsHighBeams,
    },
    {
      key: 'turnSignal',
      label: t('admin.security.live.turnSignal', 'Turn Signal'),
      glyph: 'TS',
      value: asNonEmptyString(ev.lightsTurnSignal) ?? '\u2014',
      active: (() => {
        const s = asNonEmptyString(ev.lightsTurnSignal);
        return !!s && !s.toLowerCase().includes('off');
      })(),
    },
    {
      key: 'driverSeat',
      label: t('admin.security.live.driverSeat', 'Driver Seat'),
      glyph: 'DS',
      value:
        ev.driverSeatOccupied == null
          ? '\u2014'
          : ev.driverSeatOccupied
          ? t('admin.security.live.occupied', 'Occupied')
          : t('admin.security.live.empty', 'Empty'),
      active: !!ev.driverSeatOccupied,
    },
    {
      key: 'pairedKeys',
      label: t('admin.security.live.pairedKeys', 'Paired Keys'),
      glyph: 'KY',
      value:
        ev.pairedPhoneKeyCount != null
          ? String(ev.pairedPhoneKeyCount)
          : '\u2014',
      active: (ev.pairedPhoneKeyCount ?? 0) > 0,
    },
    {
      key: 'valetMode',
      label: t('admin.security.live.valetMode', 'Valet Mode'),
      glyph: 'VM',
      value: boolLabel(ev.valetModeEnabled, t),
      active: !!ev.valetModeEnabled,
    },
    {
      key: 'serviceMode',
      label: t('admin.security.live.serviceMode', 'Service Mode'),
      glyph: 'SM',
      value: boolLabel(ev.serviceMode, t),
      active: !!ev.serviceMode,
    },
    {
      key: 'speedLimit',
      label: t('admin.security.live.speedLimit', 'Speed Limit'),
      glyph: 'SL',
      value:
        typeof ev.speedLimitMode === 'boolean'
          ? ev.speedLimitMode
            ? t('admin.security.on', 'On')
            : t('admin.security.off', 'Off')
          : asNonEmptyString(ev.speedLimitMode) ?? '\u2014',
      active:
        typeof ev.speedLimitMode === 'boolean'
          ? ev.speedLimitMode
          : (() => {
              const s = asNonEmptyString(ev.speedLimitMode);
              return !!s && !s.toLowerCase().includes('off');
            })(),
    },
    {
      key: 'homelinkDevices',
      label: t('admin.security.live.homelinkDevices', 'HomeLink Devices'),
      glyph: 'HL',
      value:
        ev.homelinkDeviceCount != null
          ? String(ev.homelinkDeviceCount)
          : '\u2014',
      active: (ev.homelinkDeviceCount ?? 0) > 0,
    },
    {
      key: 'centerDisplay',
      label: t('admin.security.live.centerDisplay', 'Center Display'),
      glyph: 'CD',
      value: asNonEmptyString(ev.centerDisplay) ?? '\u2014',
      active: (() => {
        const s = asNonEmptyString(ev.centerDisplay);
        return !!s && !s.toLowerCase().includes('off');
      })(),
    },
  ];
}

/* ─── Component ───────────────────────────────────────────────────────── */

interface LiveVehicleStateProps {
  latest: SecurityEvent | undefined;
}

export function LiveVehicleState({ latest }: LiveVehicleStateProps) {
  const t = useNativeT();
  const liveSignals = useMemo(() => buildLiveSignals(latest, t), [latest, t]);

  return (
    <GlassPanel style={styles.panel} testID="live-vehicle-state">
      <View style={styles.header}>
        <AppText accessibilityRole="header" style={styles.title}>
          {t('admin.security.liveState', 'Live Vehicle State')}
        </AppText>
        {latest ? (
          <View
            style={styles.liveIndicator}
            testID="live-vehicle-state-indicator"
          >
            <AppText style={styles.liveDot}>{'\u25CF'}</AppText>
            <AppText style={styles.liveLabel}>
              {t('admin.security.live.indicator', 'Live')}
            </AppText>
          </View>
        ) : null}
      </View>
      {liveSignals.length > 0 ? (
        <View style={styles.grid} testID="live-vehicle-state-grid">
          {liveSignals.map(sig => (
            <GlassPanel
              key={sig.key}
              style={styles.tile}
              testID={`live-signal-${sig.key}`}
            >
              <View style={styles.tileHeader}>
                <AppText
                  style={[
                    styles.tileGlyph,
                    sig.active ? styles.glyphActive : styles.glyphInactive,
                  ]}
                >
                  {sig.glyph}
                </AppText>
                <AppText numberOfLines={1} style={styles.tileLabel}>
                  {sig.label}
                </AppText>
              </View>
              <AppText
                numberOfLines={1}
                style={[
                  styles.tileValue,
                  sig.active ? styles.valueActive : styles.valueInactive,
                ]}
              >
                {sig.value}
              </AppText>
            </GlassPanel>
          ))}
        </View>
      ) : (
        // no-action: transient empty state — surfaces when source data is
        // missing; no specific recovery action available.
        <View style={styles.empty} testID="live-vehicle-state-empty">
          <AppText tone="muted" style={styles.emptyText}>
            {t('admin.security.live.noData', 'No live state data available')}
          </AppText>
        </View>
      )}
    </GlassPanel>
  );
}

LiveVehicleState.displayName = 'LiveVehicleState';

const styles = StyleSheet.create({
  panel: {
    padding: 16,
    marginBottom: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    lineHeight: 24,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 6,
  },
  liveDot: {
    fontSize: 8,
    lineHeight: 16,
    color: colors.success,
  },
  liveLabel: {
    fontSize: 12,
    lineHeight: 16,
    color: colors.success,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  tile: {
    flexGrow: 1,
    flexBasis: '42%',
    minWidth: 130,
    padding: spacing.md,
  },
  tileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: spacing.sm,
    marginBottom: 6,
  },
  tileGlyph: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  glyphActive: {
    color: colors.accent,
  },
  glyphInactive: {
    color: colors.textMuted,
  },
  tileLabel: {
    flexShrink: 1,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '500',
    color: colors.textMuted,
  },
  tileValue: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '600',
  },
  valueActive: {
    color: colors.textPrimary,
  },
  valueInactive: {
    color: colors.textMuted,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
  },
  emptyText: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
});

export default LiveVehicleState;
