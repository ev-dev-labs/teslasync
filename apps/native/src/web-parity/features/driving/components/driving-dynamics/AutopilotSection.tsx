// Native parity port of
// web/src/features/driving/components/driving-dynamics/AutopilotSection.tsx.
//
// Driving Dynamics — the "Autopilot & Cruise" panel. Current vehicle speed comes
// from the SignalStore via /vehicles/{id}/state (useVehicleState, polled every
// 5s); cruise set-speed and follow distance are read from /signals/observations
// against the most recent signal_log row for each field (useSignalObservations,
// limit 1 — ADR-005 cold-signal pattern). The panel renders a three-tile summary
// (current speed / cruise set speed / follow distance) or, when no telemetry has
// arrived, a transient no-action empty state.
//
// Unit policy (ported verbatim from the web component doc): both VehicleSpeed and
// CruiseSetSpeed are normalized to SI m/s on ingestion, so values fetched here go
// DIRECTLY through the SI -> display converter (convertSpeedFromSI) with NO km/h
// intermediate. CruiseFollowDistance is a proto enum (ValueKindEnum) read via the
// text channel and stripped of its "FollowDistance" prefix.
//
// Web -> native mapping (contract rules 4, 5 & 7); each browser-only dependency
// is replaced with a React Native-safe equivalent and documented in the sidecar:
//   - react-i18next `useTranslation` (web L1) -> inline useNativeTranslation():
//     a stable (key, fallback) => fallback shim so every t('key','English') call
//     keeps its English default + translation-key intent. All five dynamics.*
//     keys are preserved verbatim (the AddressInput / LiveMotorStatus pattern).
//   - lucide-react Navigation/Gauge (web L2) -> the shared native SemanticIcon:
//     Gauge (Current Speed) maps to name="speed" and Navigation (Cruise Set Speed
//     / Follow Distance) maps to name="navigation"; both decorative because the
//     adjacent StatCard label already names the metric (the DriveTelemetryWidget
//     lucide -> SemanticIcon precedent).
//   - `@/components/layout` Grid (cols={{default:1,sm:3}} gap={4}) (web L4) -> a
//     vertical View stack (styles.grid: flexDirection column, gap spacing.md):
//     the mobile `default: 1` column is what native targets, so the three cards
//     stack, matching the LiveMotorStatus "render the mobile default" approach.
//   - `@/components/ui` GlassPanel (web L5) -> the existing native GlassPanel,
//     <GlassPanel style={styles.panel}> with padding spacing.lg (web p-6).
//   - `@/components/data-display` StatCard (web L6) -> the ported native parity
//     StatCard (icon + label + value + optional unit), one per metric, fed the
//     same label/value/unit strings.
//   - `@/components/feedback` EmptyState (message only) (web L7) -> the web
//     EmptyState renders just the centred message when no title/icon/action is
//     passed, so native renders the same single centred muted AppText rather than
//     the shared native EmptyState (which mandates a title). The web "no-action"
//     comment is preserved.
//   - `@/components/motion` FadeIn (delay={0.17}) (web L8) -> a local FadeIn =
//     Animated.View mount fade reproducing the web framer-motion entry (opacity
//     0->1, translateY 12->0, 400ms easeOut, delay 0.17s). Web's
//     prefers-reduced-motion opt-out has no native analogue and is dropped
//     (PowerProfileChart / LiveMotorStatus FadeIn precedent).
//   - `@/api/hooks/useVehicles` useVehicleState (web L9) + `@/api/hooks/useTelemetry`
//     useSignalObservations (web L10) -> the ported native hooks (same
//     /vehicles/{id}/state and /signals/observations queries). Native's
//     useVehicleState returns `state` as a VehicleState|string|null union, so the
//     web's `stateData?.state?.speed` access is guarded with an object check that
//     yields the identical number|null result.
//   - `@/hooks/useUnits` useUnits (web L11) -> useFormatPrefs() from the shared
//     native format primitives: unitPrefs.speed -> speedUnit (same 'km/h'|'mph'
//     values); the `speedUnit` variable name is preserved.
//   - `@/lib/numberFormat` fmtNumber (web L12) -> useFormatPrefs().fmt: fmt(v, 0)
//     mirrors fmtNumber(v, 0) (locale-aware, 0 decimals).
//   - `@/lib/signalObservation` latestNumeric/latestText (web L14) -> inlined
//     faithful local helpers (data?.[0]?.value_numeric|value_text ?? null) over
//     the native SignalObservation rows — same shape as the web type.
//   - `@/lib/unitConversion` convertSpeedFromSI (web L15) -> the ported
//     _formatPrimitives convertSpeedFromSI (identical SI->display maths).
//
// No DOM-only modules, HTML elements, Recharts, Leaflet, lucide-react or
// react-i18next are imported — only react, react-native primitives, the existing
// apps/native SemanticIcon / AppText / GlassPanel / theme tokens, and the ported
// web-parity StatCard / useVehicleState / useSignalObservations / format
// primitives + the native SignalObservation type.

import React, {useEffect, useRef, type ReactNode} from 'react';
import {Animated, Easing, StyleSheet, View} from 'react-native';

import {SemanticIcon} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../../theme/tokens';
import {useVehicleState} from '../../../../api/hooks/useVehicles';
import {
  useSignalObservations,
  type SignalObservation,
} from '../../../../api/hooks/useTelemetry';
import {StatCard} from '../../../../components/data-display/StatCard';
import {
  convertSpeedFromSI,
  useFormatPrefs,
} from '../../../../components/data-display/format/_formatPrimitives';

interface AutopilotSectionProps {
  vehicleId: number | null | undefined;
}

/** Em-dash placeholder for unrenderable values (web `'—'`, U+2014). */
const DASH = '\u2014';

/** FadeIn entry timing — mirrors web framer-motion FadeIn duration + delay. */
const FADE_DURATION_MS = 400;
const FADE_DELAY_S = 0.17;

/**
 * Inlined react-i18next fallback: returns the web English fallback copy verbatim,
 * matching the other native parity ports (AddressInput / LiveMotorStatus).
 */
function useNativeTranslation(): (key: string, fallback: string) => string {
  return React.useCallback((_key: string, fallback: string) => fallback, []);
}

/**
 * `@/components/motion` FadeIn -> Animated.View mount fade reproducing the web
 * framer-motion entry: opacity 0->1, translateY 12->0, 400ms easeOut, after the
 * caller-supplied `delay` (seconds, like the web prop).
 */
function FadeIn({children, delay = 0}: {children: ReactNode; delay?: number}) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: FADE_DURATION_MS,
      delay: delay * 1000,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [progress, delay]);

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [12, 0],
  });

  return (
    <Animated.View style={{opacity: progress, transform: [{translateY}]}}>
      {children}
    </Animated.View>
  );
}

/** Latest numeric value from a signal-observations result. Ported from web. */
function latestNumeric(data: SignalObservation[] | undefined): number | null {
  return data?.[0]?.value_numeric ?? null;
}

/** Latest text value from a signal-observations result. Ported from web. */
function latestText(data: SignalObservation[] | undefined): string | null {
  return data?.[0]?.value_text ?? null;
}

// Tesla emits CruiseFollowDistance as a proto enum, e.g.
// "FollowDistance7" / "FollowDistance3" — meaning 7-bar / 3-bar follow
// gap. The signal_log encoder preserves that string verbatim. The
// number suffix is the only useful bit for display, so peel it off
// rather than rendering "FollowDistance7" raw. Falls back to whatever
// the backend gave us if the enum schema ever changes.
function parseFollowDistance(raw: string | null): string | null {
  if (raw == null) {
    return null;
  }
  const m = /(\d+)\s*$/.exec(raw);
  return m ? m[1] : raw;
}

/**
 * Cruise / autopilot panel. Current vehicle speed comes from the SignalStore via
 * /vehicles/{id}/state. Cruise set-speed and follow distance are read from
 * /signals/observations against the most recent signal_log row for each field
 * (ADR-005 cold-signal pattern).
 *
 * Unit policy: both VehicleSpeed and CruiseSetSpeed are normalized to SI m/s on
 * ingestion, so values fetched here go DIRECTLY through the SI -> display
 * converter; there is NO km/h intermediate. CruiseFollowDistance is a proto enum
 * (ValueKindEnum), read via latestText and stripped of its "FollowDistance"
 * prefix.
 */
export default function AutopilotSection({vehicleId}: AutopilotSectionProps) {
  const t = useNativeTranslation();
  const {speedUnit, fmt} = useFormatPrefs();
  const toSpeedDisplay = (value: number) =>
    convertSpeedFromSI(value, speedUnit);

  const {data: stateData} = useVehicleState(vehicleId ?? 0, {
    refetchInterval: 5_000,
  });
  const {data: cruiseSetObs} = useSignalObservations(vehicleId ?? undefined, {
    signal_name: 'CruiseSetSpeed',
    limit: 1,
  });
  const {data: followObs} = useSignalObservations(vehicleId ?? undefined, {
    signal_name: 'CruiseFollowDistance',
    limit: 1,
  });

  const vehicleState = stateData?.state;
  const speedMps =
    vehicleState != null && typeof vehicleState === 'object'
      ? vehicleState.speed ?? null
      : null;
  const cruiseSetMps = latestNumeric(cruiseSetObs);
  // ValueKindEnum lands in value_text; numeric fallback covers a future
  // backend that re-encodes the bar-count as ValueKindInt32.
  const followDistanceRaw =
    latestText(followObs) ??
    (latestNumeric(followObs) != null
      ? String(latestNumeric(followObs))
      : null);
  const followDistance = parseFollowDistance(followDistanceRaw);

  const hasAny =
    speedMps != null || cruiseSetMps != null || followDistance != null;

  const currentSpeedDisplay = speedMps != null ? toSpeedDisplay(speedMps) : null;
  const cruiseSetDisplay =
    cruiseSetMps != null ? toSpeedDisplay(cruiseSetMps) : null;

  return (
    <FadeIn delay={FADE_DELAY_S}>
      <GlassPanel style={styles.panel}>
        <AppText style={styles.title} weight="semibold">
          {t('dynamics.autopilot', 'Autopilot & Cruise')}
        </AppText>
        {hasAny ? (
          <View style={styles.grid}>
            <StatCard
              icon={<SemanticIcon decorative name="speed" size="sm" />}
              label={t('dynamics.currentSpeed', 'Current Speed')}
              value={
                currentSpeedDisplay != null
                  ? fmt(currentSpeedDisplay, 0)
                  : DASH
              }
              unit={speedUnit}
            />
            <StatCard
              icon={<SemanticIcon decorative name="navigation" size="sm" />}
              label={t('dynamics.cruiseSetSpeed', 'Cruise Set Speed')}
              value={
                cruiseSetDisplay != null ? fmt(cruiseSetDisplay, 0) : DASH
              }
              unit={speedUnit}
            />
            <StatCard
              icon={<SemanticIcon decorative name="navigation" size="sm" />}
              label={t('dynamics.followDistance', 'Follow Distance')}
              value={followDistance ?? DASH}
            />
          </View>
        ) : (
          // no-action: transient empty state — surfaces when source data is
          // missing; no specific recovery action available.
          <View style={styles.emptyState}>
            <AppText style={styles.emptyText} tone="muted">
              {t(
                'dynamics.autopilotNoData',
                'No cruise / autopilot telemetry received yet',
              )}
            </AppText>
          </View>
        )}
      </GlassPanel>
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  panel: {
    padding: spacing.lg,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 18,
    lineHeight: 24,
    marginBottom: spacing.md,
  },
  grid: {
    flexDirection: 'column',
    gap: spacing.md,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
  emptyText: {
    maxWidth: 360,
    textAlign: 'center',
  },
});
