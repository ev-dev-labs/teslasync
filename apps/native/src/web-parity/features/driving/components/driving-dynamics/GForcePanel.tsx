// GForcePanel — native parity port of
// web/src/features/driving/components/driving-dynamics/GForcePanel.tsx.
//
// The web component reads the latest projected drive-dynamics snapshot via
// `useDriveDynamicsLatest(vehicleId ?? 0, INTERVALS.REALTIME)` and renders an
// "Acceleration G-Force" GlassPanel. When at least one acceleration signal is
// present it shows a 3-up StatCard grid (Lateral / Longitudinal / Combined
// magnitude, each formatted to 2 decimals with a "g" unit); otherwise it shows
// an EmptyState ("No G-force telemetry received yet"). The whole panel is
// wrapped in `FadeIn delay={0.05}`. `magnitude` is the Euclidean combination of
// the lateral + longitudinal accelerations (null unless both are present).
//
// Web -> native mapping (conversion-contract rules 3-7):
//   - react-i18next useTranslation (web L1) -> native-safe t(key, fallback)
//     keeping every dynamics.* key + English fallback verbatim.
//   - lucide-react Gauge (web L2): lucide is browser-only SVG and forbidden in
//     native output (rule 4). The StatCard's small muted `<Gauge className="h-5
//     w-5" />` decoration is rendered as the native SemanticIcon glyph
//     vocabulary — Gauge (a speedometer dial) -> 'speedCircle' ('SC') — drawn in
//     a muted AppText (the TemperatureMetricCards glyph precedent) so it stays a
//     light muted mark, not a heavy boxed chip.
//   - `@/components/layout` Grid (web L4): the web Grid `cols={{ default: 1, sm:
//     3 }} gap={4}` collapses to its mobile base (1 column) on this phone-first
//     surface — a single stacked column with gap-4 (16) — exactly the web
//     narrow-viewport rendering; the sm:3 column count is web-only responsive
//     intent (the SummaryStatsGrid mobile-base precedent).
//   - `@/components/ui` GlassPanel (web L5) -> the native GlassPanel.
//   - `@/components/data-display` StatCard (web L6): no native StatCard parity
//     port exists yet, so a local StatCard is built from RN primitives
//     reproducing the web Card (rounded-lg border surface, p-4) with the
//     header row (muted label + muted icon) and the baseline-aligned bold value
//     + muted unit. Only the slots this file uses are ported
//     (icon/label/value/unit).
//   - `@/components/feedback` EmptyState (web L7): the web call passes only
//     `message` (no icon/title/action), so a local message-only EmptyState is
//     built from RN primitives reproducing the centred `py-16` muted body copy.
//   - `@/components/motion` FadeIn delay={0.05} (web L8) -> a local
//     reduced-motion-aware FadeIn (Animated.View) reproducing the web initial
//     {opacity:0, y:12} -> animate {opacity:1, y:0} easeOut entrance with a 50ms
//     delay / 400ms duration (useMotionPreference(400) default), collapsing to
//     the final state under reduced motion (the SummaryStatsGrid precedent).
//   - `@/api/hooks/useVehicles` useDriveDynamicsLatest (web L9) -> the native
//     useVehicles parity hook (same name, GET /drive-dynamics/latest?vehicle_id=).
//   - `@/lib/constants` INTERVALS.REALTIME (web L10) -> the 5_000ms literal it
//     resolves to, passed as the hook's refetchInterval.
//   - `@/lib/numberFormat` fmtNumber (web L11) -> ported inline with the web
//     global defaults (precision 2 / locale en-US); the parity tree has no
//     useSettings overrides.
// No DOM / lucide-react / Recharts / Leaflet / old web-UI imports — RN
// primitives only. See the .parity.json sidecar for the line-by-line map.

import React, {useEffect, useRef, useState} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
} from 'react-native';

import {getSemanticIconDefinition} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors} from '../../../../../theme/tokens';
import {useDriveDynamicsLatest} from '../../../../api/hooks/useVehicles';

// ---- Native-safe i18n fallback (web react-i18next useTranslation) -----------

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return (_key, fallback) => fallback;
}

// ---- INTERVALS.REALTIME (web @/lib/constants) -------------------------------
// The web hook polls at INTERVALS.REALTIME (5_000ms — "real-time data: SSE,
// live state, live signals"); the literal is inlined as the refetchInterval.

const INTERVAL_REALTIME_MS = 5_000;

// ---- Native-safe number formatting (web @/lib/numberFormat fmtNumber) --------
// fmtNumber ported with the web global defaults: precision 2, locale en-US.
// The parity tree has no useSettings overrides.

const DEFAULT_LOCALE = 'en-US';
const DEFAULT_PRECISION = 2;

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function fmtNumber(value: unknown, decimals = DEFAULT_PRECISION): string {
  try {
    return safeNumber(value).toLocaleString(DEFAULT_LOCALE, {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(value).toLocaleString('en-US', {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  }
}

// ---- Gauge glyph (web lucide-react Gauge) -----------------------------------
// Gauge (a speedometer dial) -> the native SemanticIcon 'speedCircle' glyph.

const GAUGE_GLYPH = getSemanticIconDefinition('speedCircle').glyph;

// ---- Reduced-motion awareness (web prefers-reduced-motion) ------------------

function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;

    AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (!cancelled) {
        setReduceMotion(enabled);
      }
    });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

// ---- Reduced-motion-aware FadeIn (web @/components/motion FadeIn) ------------
// web FadeIn delay prop (0.05s) + useMotionPreference(400) duration + initial
// {opacity:0, y:12}. Reduced motion collapses to the final state (the web no-op).

const FADE_IN_DELAY_MS = 50;
const FADE_IN_DURATION_MS = 400;
const FADE_IN_TRANSLATE_Y = 12;

function FadeIn({
  children,
  reduceMotion,
}: {
  children: React.ReactNode;
  reduceMotion: boolean;
}): React.ReactElement {
  const progress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }

    progress.setValue(0);
    const animation = Animated.timing(progress, {
      delay: FADE_IN_DELAY_MS,
      duration: FADE_IN_DURATION_MS,
      easing: Easing.out(Easing.ease),
      toValue: 1,
      useNativeDriver: true,
    });

    animation.start();
    return () => {
      animation.stop();
    };
  }, [progress, reduceMotion]);

  return (
    <Animated.View
      style={{
        opacity: progress,
        transform: [
          {
            translateY: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [FADE_IN_TRANSLATE_Y, 0],
            }),
          },
        ],
      }}>
      {children}
    </Animated.View>
  );
}

// ---- Local StatCard (web @/components/data-display StatCard) -----------------
// Reproduces the web Card (rounded-lg border surface, p-4): a header row with a
// muted medium label + muted icon glyph, then a baseline-aligned bold value
// with an optional muted unit. Only the icon/label/value/unit slots are ported.

function StatCard({
  icon,
  label,
  unit,
  value,
}: {
  icon?: string;
  label: string;
  unit?: string;
  value: string;
}): React.ReactElement {
  return (
    <View style={styles.statCard}>
      <View style={styles.statHeader}>
        <AppText numberOfLines={1} style={styles.statLabel} tone="muted">
          {label}
        </AppText>
        {icon ? (
          <AppText style={styles.statIcon} tone="muted">
            {icon}
          </AppText>
        ) : null}
      </View>
      <View style={styles.statValueRow}>
        <AppText style={styles.statValue}>{value}</AppText>
        {unit ? (
          <AppText style={styles.statUnit} tone="muted">
            {unit}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

// ---- Local EmptyState (web @/components/feedback EmptyState, message-only) ----
// The web call passes only `message`, so this reproduces the centred `py-16`
// muted body copy with no icon/title/action.

function EmptyState({message}: {message: string}): React.ReactElement {
  return (
    <View style={styles.emptyState}>
      <AppText style={styles.emptyText} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

// ---- Component (web L31-80) -------------------------------------------------

interface GForcePanelProps {
  vehicleId: number | null | undefined;
}

export default function GForcePanel({vehicleId}: GForcePanelProps) {
  const t = useNativeTranslationFallback();
  const reduceMotion = useReduceMotion();

  const {data} = useDriveDynamicsLatest(vehicleId ?? 0, INTERVAL_REALTIME_MS);

  const lateral =
    typeof data?.lateral_acceleration === 'number'
      ? data.lateral_acceleration
      : null;
  const longitudinal =
    typeof data?.longitudinal_acceleration === 'number'
      ? data.longitudinal_acceleration
      : null;
  const hasAny = lateral != null || longitudinal != null;

  const magnitude =
    lateral != null && longitudinal != null
      ? Math.sqrt(lateral * lateral + longitudinal * longitudinal)
      : null;

  return (
    <FadeIn reduceMotion={reduceMotion}>
      <GlassPanel style={styles.panel}>
        <AppText style={styles.heading} weight="semibold">
          {t('dynamics.gForce', 'Acceleration G-Force')}
        </AppText>
        {hasAny ? (
          <View style={styles.grid}>
            <StatCard
              icon={GAUGE_GLYPH}
              label={t('dynamics.lateral', 'Lateral')}
              unit="g"
              value={lateral != null ? fmtNumber(lateral, 2) : '—'}
            />
            <StatCard
              icon={GAUGE_GLYPH}
              label={t('dynamics.longitudinal', 'Longitudinal')}
              unit="g"
              value={longitudinal != null ? fmtNumber(longitudinal, 2) : '—'}
            />
            <StatCard
              icon={GAUGE_GLYPH}
              label={t('dynamics.combined', 'Combined')}
              unit="g"
              value={magnitude != null ? fmtNumber(magnitude, 2) : '—'}
            />
          </View>
        ) : (
          <EmptyState
            message={t(
              'dynamics.gForceNoData',
              'No G-force telemetry received yet',
            )}
          />
        )}
      </GlassPanel>
    </FadeIn>
  );
}

const GRID_GAP = 16; // web Grid gap={4}
const PANEL_PADDING = 24; // web GlassPanel p-6
const STAT_CARD_PADDING = 16; // web Card p-4
const EMPTY_STATE_PADDING_Y = 64; // web EmptyState py-16

const styles = StyleSheet.create({
  // web EmptyState `flex flex-col items-center justify-center py-16 text-center`.
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: EMPTY_STATE_PADDING_Y,
  },
  // web EmptyState message `Text variant="bodySm" max-w-md text-center`.
  emptyText: {
    fontSize: 14,
    lineHeight: 20,
    maxWidth: 448,
    textAlign: 'center',
  },
  // web Grid `cols={{ default: 1 }} gap={4}` -> stacked column, 16px gap.
  grid: {
    flexDirection: 'column',
    gap: GRID_GAP,
  },
  // web h2 `mb-4 text-lg font-semibold text-[var(--text-primary)]`.
  heading: {
    fontSize: 18,
    lineHeight: 28,
    marginBottom: 16,
  },
  // web GlassPanel `p-6`.
  panel: {
    padding: PANEL_PADDING,
  },
  // web Card (StatCard root) `rounded-lg border bg-[var(--surface-1)] p-4`.
  statCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
    padding: STAT_CARD_PADDING,
  },
  // web header row `flex items-center justify-between`.
  statHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  // web icon `text-[var(--text-muted)]` (Gauge glyph stand-in).
  statIcon: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    lineHeight: 16,
  },
  // web label `text-sm font-medium text-[var(--text-muted)]`.
  statLabel: {
    flexShrink: 1,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  // web unit `text-sm text-[var(--text-muted)]`.
  statUnit: {
    fontSize: 14,
    lineHeight: 20,
  },
  // web value `text-2xl font-bold`.
  statValue: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 32,
  },
  // web value row `flex items-baseline gap-1`.
  statValueRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: 4,
  },
});
