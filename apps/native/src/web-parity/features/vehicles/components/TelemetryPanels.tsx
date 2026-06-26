// Native parity port of web/src/features/vehicles/components/TelemetryPanels.tsx.
//
// The web file is a 3-line backward-compatibility barrel that re-exports the two
// public symbols of the decomposed `./telemetry-panels` module (web L1 comment,
// L2/L3 re-exports):
//   export { TelemetryGrid } from './telemetry-panels'
//   export { LiveTelemetryPanels } from './telemetry-panels'
//
// In the native parity tree only `./telemetry-panels/InfoTile` has been ported so
// far; `TelemetryGrid` and `LiveTelemetryPanels` — and their full dependency
// chain (the motion `StaggerItem`/`FadeIn`, `useUnits`, `numberFormat`, the seven
// live panel sub-components, and the lucide icon set) — are NOT yet converted.
// Re-exporting from `./telemetry-panels` is therefore impossible (the native
// symbols do not exist), and creating native `telemetry-panels/TelemetryGrid.tsx`
// / `LiveTelemetryPanels.tsx` / `index.ts` files here would shadow those real web
// files' own future conversion iterations. Per conversion-contract rule 7 this
// shim instead provides both symbols self-contained as native-safe
// implementations with an explicit "pending native conversion" state, preserving
// the exact public export surface AND prop contracts so any consumer keeps
// type-checking. The placeholders surface the unit-agnostic data already carried
// in their props (battery level / live-stream availability) rather than rendering
// a blank box. No DOM / lucide-react / Recharts / Leaflet / old web-UI imports —
// React Native primitives only. See the .parity.json sidecar for the line map.

import React, {useCallback} from 'react';
import {StyleSheet, View} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import type {
  ChargingTelemetry,
  ClimateSnapshot,
  LocationSnapshot,
  MediaSnapshot,
  MotorSnapshot,
  SecurityEvent,
  TirePressureSnapshot,
  VehicleState,
} from '../../../api/types';

// ---- Native-safe i18n fallback (web react-i18next useTranslation) -----------
// Mirrors the shared parity-tree fallback (Delta/ErrorDisplay): returns the
// English fallback, so the source `t(key, fallback)` calls keep their keys + copy
// until a native i18n provider is wired.
type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback) => fallback, []);
}

// Defensive integer read (Delta's `safeNumber` precedent); guards NaN/Infinity
// from live data even though the typed field is non-nullable.
function safeInt(value: number): number {
  return Number.isFinite(value) ? Math.round(value) : 0;
}

// Shared "pending native conversion" card used by both placeholders.
function PendingPanel({
  title,
  detail,
}: {
  title: string;
  detail: string;
}): React.ReactElement {
  return (
    <GlassPanel style={styles.panel}>
      <AppText style={styles.title} weight="semibold">
        {title}
      </AppText>
      <AppText style={styles.detail} tone="muted">
        {detail}
      </AppText>
    </GlassPanel>
  );
}

PendingPanel.displayName = 'PendingPanel';

// web telemetry-panels/TelemetryGrid.tsx `TelemetryGridProps` (preserved).
interface TelemetryGridProps {
  state: VehicleState;
}

/**
 * Native-safe stand-in for the web `TelemetryGrid` (the compact six-tile
 * at-a-glance grid). The full grid renders through the not-yet-ported
 * `./telemetry-panels`; this surfaces the unit-agnostic battery level from
 * `state` plus an explicit pending notice so the symbol stays usable + type-safe.
 */
export function TelemetryGrid({
  state,
}: TelemetryGridProps): React.ReactElement {
  const t = useNativeTranslationFallback();
  const batteryLabel = t('common.battery', 'Battery');
  const batteryLevel = safeInt(state.battery_level);
  const pending = t(
    'telemetryPanels.gridPending',
    'Detailed telemetry grid is pending native conversion.',
  );
  return (
    <PendingPanel
      detail={`${batteryLabel} ${batteryLevel}% · ${pending}`}
      title={t('common.telemetry', 'Telemetry')}
    />
  );
}

TelemetryGrid.displayName = 'TelemetryGrid';

// web telemetry-panels/LiveTelemetryPanels.tsx `LiveTelemetryProps` (preserved
// field-for-field, including the null|undefined snapshot unions and the live /
// sseConnected / remoteStartEnabled triplet).
interface LiveTelemetryProps {
  motorData: MotorSnapshot | null | undefined;
  climateData: ClimateSnapshot | null | undefined;
  securityData: SecurityEvent | null | undefined;
  tireData: TirePressureSnapshot | null | undefined;
  chargingTelemetry: ChargingTelemetry | null | undefined;
  mediaData: MediaSnapshot | null | undefined;
  locationData: LocationSnapshot | null | undefined;
  live: Record<string, unknown>;
  sseConnected: boolean;
  remoteStartEnabled?: boolean | null;
}

/**
 * Native-safe stand-in for the web `LiveTelemetryPanels` (the seven-panel live
 * telemetry section). Those panels render through the not-yet-ported
 * `./telemetry-panels`; this keeps the source "Live Telemetry" header + live
 * indicator intent and summarises how many of the seven data streams are
 * currently present, with an explicit pending notice.
 */
export function LiveTelemetryPanels(
  props: LiveTelemetryProps,
): React.ReactElement {
  const t = useNativeTranslationFallback();
  const streams = [
    props.motorData,
    props.climateData,
    props.securityData,
    props.tireData,
    props.chargingTelemetry,
    props.mediaData,
    props.locationData,
  ];
  const availableCount = streams.filter(stream => stream != null).length;
  const liveLabel = props.sseConnected
    ? t('common.live', 'Live')
    : t('common.offline', 'Offline');
  const streamsLabel = t(
    'telemetryPanels.streamsAvailable',
    'data streams available',
  );
  const pending = t(
    'telemetryPanels.panelsPending',
    'Live panels are pending native conversion.',
  );
  const liveTelemetry = t('common.liveTelemetry', 'Live Telemetry');
  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <View
          style={[
            styles.liveDot,
            {
              backgroundColor: props.sseConnected
                ? colors.success
                : colors.textMuted,
            },
          ]}
        />
        <AppText style={styles.heading} weight="bold">
          {liveTelemetry}
        </AppText>
      </View>
      <PendingPanel
        detail={`${liveLabel} · ${availableCount}/${streams.length} ${streamsLabel} · ${pending}`}
        title={liveTelemetry}
      />
    </View>
  );
}

LiveTelemetryPanels.displayName = 'LiveTelemetryPanels';

const styles = StyleSheet.create({
  detail: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: spacing.xs,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  heading: {
    color: colors.textPrimary,
    fontSize: 20,
    lineHeight: 28,
  },
  liveDot: {
    borderRadius: 6,
    height: 12,
    width: 12,
  },
  panel: {
    gap: spacing.xs,
    padding: spacing.lg,
  },
  section: {
    gap: spacing.md,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
  },
});
