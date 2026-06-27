// Native parity port of web/src/features/dashboard/widgets/RangeEstimateWidget.tsx.
//
// The web widget is the dashboard "Range Estimate" tile. It resolves a vehicle
// id (`vehicleId` prop, else the first vehicle from `useVehicles()`), reads live
// state via `useVehicleState(id)` (GET /api/v1/vehicles/{id}/state — preserved
// verbatim by the already-ported native useVehicles hook), and renders, inside a
// title-less `WidgetShell`, either:
//   - a two-row readout when `state` is truthy: a muted uppercase "Rated Range"
//     label over a text-xl bold cyan-300 `{rated_range} {unit}` value, then a
//     muted uppercase "Ideal Range" label over a text-lg semibold text-primary
//     `{ideal_range} {unit}` value (both SI meters -> display unit, 0 decimals,
//     null-safe `?? 0`); or
//   - a Gauge-iconed empty state ("No range data") when `state` is falsy.
//
// Every state name (`vehicles`, `id`, `stateData`, `isLoading`, `isFetching`,
// `isStale`, `isError`, `dataUpdatedAt`, `refetch`, `unitPrefs`, `distanceUnit`,
// `state`), the `vehicleId ?? vehicles?.[0]?.id ?? 0` resolution, the
// `state.rated_range ?? 0` / `state.ideal_range ?? 0` null-safe field access, the
// SI->display distance conversion at the render boundary, the 0-decimal
// `fmtNumber` formatting, the `{value} {unit}` composition, and the `widget.*`
// i18n keys with their English fallbacks are preserved. Browser-only pieces are
// mapped to native-safe equivalents (documented in the parity sidecar):
//
//   - react-i18next `useTranslation('dashboard')` is not a native-parity
//     dependency; a local `useNativeTranslationFallback()` t() shim returns the
//     English fallback verbatim (same pattern as the RangeBarWidget /
//     ClimateStatusWidget ports), so every key + copy is preserved.
//   - lucide-react `Gauge` has no native icon dependency; per the RangeBarWidget
//     glyph precedent the empty-state icon becomes a decorative Unicode gauge
//     glyph ('\u25F4') in an `AppText` with importantForAccessibility='no' (the
//     empty-state message carries the accessible meaning). The `h-6 w-6` (24px)
//     icon maps to fontSize 24.
//   - `@/components/feedback` `EmptyState` (icon + message, web role="status") is
//     inlined as `WidgetEmptyState` (centered View + glyph icon + muted message,
//     accessibilityLiveRegion='polite'); the `className="py-4"` padding intent is
//     mapped to vertical spacing.
//   - `@/hooks/useUnits` + `@/lib/unitConversion` `convertDistanceFromSI` ->
//     inlined native equivalents: a `useUnits()` shim returning the out-of-box
//     `{distance: 'km'}` preference (the API already returns SI; conversion
//     happens at the display boundary) and the pure SI->display distance
//     converter mirroring the web module.
//   - `@/lib/numberFormat` `fmtNumber` is inlined as a native-safe formatter
//     mirroring the web module (locale-aware toLocaleString, precision-2 / en-US
//     out-of-box defaults).
//   - `./WidgetShell` (web: a transparent flex container whose card chrome comes
//     from the dashboard grid cell, with Skeleton loading + QueryError error + a
//     DataFreshness header affordance) is inlined on a `GlassPanel` (so the tile
//     is styled standalone): loading -> centered Spinner, error -> centered
//     danger text, and — since this widget passes no title — a compact freshness
//     overlay (status dot + refresh Pressable) over children.
//   - `./types` `WidgetProps` -> a local interface mirroring it
//     (WidgetSize {cols, rows}); `./types` is not yet ported.

import React, {useCallback, useMemo, type ReactNode} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {
  useVehicles,
  useVehicleState,
  type VehicleState,
} from '../../../api/hooks/useVehicles';
import {Spinner} from '../../../components/feedback/Spinner';

/* ─── local widget types (mirror ./types — not yet ported) ─────────────────── */

interface WidgetSize {
  cols: number;
  rows: number;
}

export interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: Record<string, unknown>;
}

/* ─── i18n fallback shim (web react-i18next is unavailable in native) ───────── */

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback) => fallback, []);
}

/* ─── native unit shim (web `@/hooks/useUnits` + `@/lib/unitConversion`) ────── */

type DistanceUnitPref = 'km' | 'mi' | 'ft';

const METERS_PER_KM = 1000;
const METERS_PER_MILE = 1609.344;
const METERS_PER_FOOT = 0.3048;

// Mirrors web `convertDistanceFromSI` (SI meters -> display unit).
function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  switch (to) {
    case 'mi':
      return meters / METERS_PER_MILE;
    case 'ft':
      return meters / METERS_PER_FOOT;
    case 'km':
    default:
      return meters / METERS_PER_KM;
  }
}

interface UseUnitsResult {
  unitPrefs: {distance: DistanceUnitPref};
}

// The native parity layer has no settings store wired in here, so the hook
// mirrors the web out-of-box default: distance 'km'. The API already returns SI;
// conversion happens at the display boundary.
function useUnits(): UseUnitsResult {
  return useMemo<UseUnitsResult>(() => ({unitPrefs: {distance: 'km'}}), []);
}

/* ─── native-safe number formatting (web `@/lib/numberFormat`) ──────────────── */

const DEFAULT_GLOBAL_PRECISION = 2;

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals?: number, locale = 'en-US'): string {
  const d = decimals ?? DEFAULT_GLOBAL_PRECISION;
  try {
    return safeNumber(v).toLocaleString(locale, {
      maximumFractionDigits: d,
      minimumFractionDigits: d,
    });
  } catch {
    return safeNumber(v).toLocaleString('en-US', {
      maximumFractionDigits: d,
      minimumFractionDigits: d,
    });
  }
}

/* ─── decorative glyphs (lucide-react stand-ins) ───────────────────────────── */

const ICON_GAUGE = '\u25F4'; // lucide Gauge
const GLYPH_REFRESH = '\u21BB';

/* ─── inlined WidgetShell freshness control (web DataFreshness) ─────────────── */

interface WidgetFreshnessProps {
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
}

function WidgetFreshness({
  isFetching,
  isStale,
  isError,
  onRefresh,
}: WidgetFreshnessProps) {
  let dotColor: string = colors.success;
  if (isError) {
    dotColor = colors.danger;
  } else if (isStale) {
    dotColor = colors.warning;
  } else if (isFetching) {
    dotColor = colors.accent;
  }

  const dot = (
    <View style={[styles.freshnessDot, {backgroundColor: dotColor}]} />
  );

  if (!onRefresh) {
    return <View style={styles.freshnessRow}>{dot}</View>;
  }

  return (
    <Pressable
      accessibilityLabel="Refresh"
      accessibilityRole="button"
      hitSlop={8}
      onPress={onRefresh}
      style={styles.freshnessRow}>
      {dot}
      <AppText importantForAccessibility="no" style={styles.freshnessGlyph}>
        {GLYPH_REFRESH}
      </AppText>
    </Pressable>
  );
}

/* ─── inlined WidgetShell (web ./WidgetShell.tsx) ───────────────────────────── */

interface WidgetShellProps {
  title?: string;
  icon?: ReactNode;
  loading?: boolean;
  error?: string | null;
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
  children: ReactNode;
}

function WidgetShell({
  title,
  icon,
  loading,
  error,
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
  children,
}: WidgetShellProps) {
  if (loading) {
    return (
      <GlassPanel style={styles.shell}>
        <View style={styles.centerFill}>
          <Spinner size="sm" />
        </View>
      </GlassPanel>
    );
  }

  if (error) {
    return (
      <GlassPanel style={styles.shell}>
        <View style={styles.centerFill}>
          <AppText style={styles.errorText} tone="danger">
            {error}
          </AppText>
        </View>
      </GlassPanel>
    );
  }

  const showFreshness = updatedAt !== undefined;
  const freshness = showFreshness ? (
    <WidgetFreshness
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      onRefresh={onRefresh}
    />
  ) : null;

  return (
    <GlassPanel style={styles.shell}>
      {title ? (
        <View style={styles.headerRow}>
          <View style={styles.headerTitleGroup}>
            {icon}
            <AppText style={styles.titleText} tone="muted">
              {title}
            </AppText>
          </View>
          {freshness}
        </View>
      ) : freshness ? (
        <View style={styles.freshnessOverlay}>{freshness}</View>
      ) : null}
      {children}
    </GlassPanel>
  );
}

/* ─── inlined WidgetEmptyState (web @/components/feedback EmptyState) ────────── */

function WidgetEmptyState({icon, message}: {icon?: ReactNode; message: string}) {
  return (
    <View accessibilityLiveRegion="polite" style={styles.emptyState}>
      {icon}
      <AppText style={styles.emptyMessage} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

/* ─── the widget ───────────────────────────────────────────────────────────── */

export default function RangeEstimateWidget({vehicleId}: WidgetProps) {
  const t = useNativeTranslationFallback();
  const {data: vehicles} = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const {
    data: stateData,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useVehicleState(id);
  /* SI-floor: state.rated_range / state.ideal_range arrive in METERS. */
  const {unitPrefs} = useUnits();
  const distanceUnit = unitPrefs.distance;
  const state = stateData?.state;

  // The web reads `stateData?.state` as `any`; the native hook strictly types it
  // as `VehicleState | string | null`. Narrow to the object form for field
  // access — a truthy string state still renders the readout (with 0 values via
  // `?? 0`) exactly like the web any-typed access, while null/undefined/'' falls
  // through to the empty state.
  const stateFields: VehicleState | undefined =
    state != null && typeof state === 'object' ? state : undefined;

  const rated = stateFields?.rated_range ?? 0;
  const ideal = stateFields?.ideal_range ?? 0;
  const ratedDisplay = fmtNumber(convertDistanceFromSI(rated, distanceUnit), 0);
  const idealDisplay = fmtNumber(convertDistanceFromSI(ideal, distanceUnit), 0);

  return (
    <WidgetShell
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={isLoading}
      onRefresh={() => refetch()}
      updatedAt={dataUpdatedAt}>
      <View style={styles.body}>
        {state ? (
          <View style={styles.stack}>
            <View style={styles.metric}>
              <AppText style={styles.metricLabel} tone="muted">
                {t('widget.ratedRange', 'Rated Range')}
              </AppText>
              <AppText style={styles.ratedValue}>
                {`${ratedDisplay} ${distanceUnit}`}
              </AppText>
            </View>
            <View style={styles.metric}>
              <AppText style={styles.metricLabel} tone="muted">
                {t('widget.idealRange', 'Ideal Range')}
              </AppText>
              <AppText style={styles.idealValue}>
                {`${idealDisplay} ${distanceUnit}`}
              </AppText>
            </View>
          </View>
        ) : (
          <WidgetEmptyState
            icon={
              <AppText
                importantForAccessibility="no"
                style={styles.emptyIconGlyph}>
                {ICON_GAUGE}
              </AppText>
            }
            message={t('widget.noRange', 'No range data')}
          />
        )}
      </View>
    </WidgetShell>
  );
}

RangeEstimateWidget.displayName = 'RangeEstimateWidget';

const styles = StyleSheet.create({
  body: {
    justifyContent: 'center',
  },
  centerFill: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    padding: spacing.md,
  },
  emptyIconGlyph: {
    color: colors.textMuted,
    fontSize: 24,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  emptyMessage: {
    fontSize: 14,
    maxWidth: 320,
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  errorText: {
    fontSize: 13,
    textAlign: 'center',
  },
  freshnessDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  freshnessGlyph: {
    color: colors.textMuted,
    fontSize: 13,
  },
  freshnessOverlay: {
    position: 'absolute',
    right: spacing.sm,
    top: spacing.sm,
    zIndex: 5,
  },
  freshnessRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  headerTitleGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  idealValue: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '600',
    lineHeight: 24,
  },
  metric: {
    gap: 2,
  },
  metricLabel: {
    fontSize: 10,
    letterSpacing: 0.6,
    lineHeight: 14,
    textTransform: 'uppercase',
  },
  ratedValue: {
    color: '#67e8f9',
    fontSize: 20,
    fontWeight: '700',
    lineHeight: 26,
  },
  shell: {
    borderRadius: 16,
    gap: spacing.sm,
    padding: spacing.md,
  },
  stack: {
    gap: spacing.md,
  },
  titleText: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
});
