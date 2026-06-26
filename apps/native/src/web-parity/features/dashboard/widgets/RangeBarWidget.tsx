// Native parity port of web/src/features/dashboard/widgets/RangeBarWidget.tsx.
//
// The web widget is the dashboard "Range" tile. It resolves a vehicle id
// (`vehicleId` prop, else the first vehicle from `useVehicles()`), reads live
// state via `useVehicleState(id)` (GET /api/v1/vehicles/{id}/state — preserved
// verbatim by the already-ported native useVehicles hook), and renders, inside a
// `WidgetShell`, one of three layouts:
//   - Compact (cols === 1 && rows === 1): a single big cyan-300 rated-range
//     number (0 decimals) over a muted "{unit} rated" caption; the shell title +
//     icon are suppressed.
//   - Standard: two animated `MetricBar`s — Rated Range (#22d3ee) and Ideal
//     Range (#a78bfa) — each scaled against the shared max, with a
//     "{value} {unit}" sublabel; when both rated and ideal are > 0 a right
//     aligned "EPA variance ±X.X%" line is appended.
//   - No data (`state == null || (rated <= 0 && ideal <= 0)`): a Gauge-iconed
//     empty state ("No range data").
//
// Every state name (`vehicles`, `id`, `stateData`, `isLoading`, `isFetching`,
// `isStale`, `isError`, `dataUpdatedAt`, `refetch`, `unitPrefs`,
// `toDistanceDisplay`, `distanceUnit`, `state`, `isCompact`, `rated`, `ideal`,
// `hasData`, `maxRange`, `ratedConverted`, `idealConverted`, `maxConverted`), the
// `vehicleId ?? vehicles?.[0]?.id ?? 0` resolution, the
// `size.cols === 1 && size.rows === 1` compact threshold, the `?? 0` null-safe
// derivations, the `Math.max(rated, ideal, 1)` floor, the SI->display distance
// conversion at the render boundary, the `((ideal - rated) / rated) * 100`
// variance math + its `ideal >= rated ? '+' : ''` sign, and the `widget.*` i18n
// keys with their English fallbacks are preserved. Browser-only pieces are mapped
// to native-safe equivalents (documented in the parity sidecar):
//
//   - react-i18next `useTranslation('dashboard')` is not a native-parity
//     dependency; a local `useNativeTranslationFallback()` t() shim returns the
//     English fallback verbatim (same pattern as APIUsageWidget /
//     ChargeStatusLiveWidget), so every key + copy is preserved.
//   - lucide-react `Gauge` has no native icon dependency; per the
//     ChargeStatusLiveWidget glyph precedent it becomes a decorative Unicode
//     gauge glyph ('\u25F4') in an `AppText` with importantForAccessibility='no'
//     (the shell title / empty-state message carries the accessible meaning).
//     The title icon's `h-3 w-3` (12px) text-muted maps to fontSize 12 + muted
//     tone; the empty-state `h-6 w-6` (24px) maps to fontSize 24.
//   - `@/components/data-display` `MetricBar` (a framer-motion animated fill bar)
//     is inlined as a native `MetricBar`: the label/value header row + a rounded
//     track with a percentage-width solid fill (the web's animated
//     `linear-gradient`+glow fill collapses to a solid `color` fill — no
//     framer-motion / CSS gradient in native). The `Math.min(value/max*100, 100)`
//     percentage + the `sublabel ?? fmtNumber(value)` policy are preserved.
//   - `@/components/feedback` `EmptyState` (icon + message, web role="status") is
//     inlined as `WidgetEmptyState` (centered View + glyph icon + muted message,
//     accessibilityLiveRegion='polite'); the `className="py-4"` padding intent is
//     mapped to vertical spacing.
//   - `@/hooks/useUnits` + `@/lib/unitConversion` `convertDistanceFromSI` ->
//     inlined native equivalents: a `useUnits()` shim returning the out-of-box
//     `{distance: 'km'}` preference (the API already returns SI; conversion
//     happens at display) and the pure SI->display distance converter mirroring
//     the web module.
//   - `@/lib/numberFormat` `fmtNumber` is inlined as a native-safe formatter
//     mirroring the web module (locale-aware toLocaleString, precision-2 / en-US
//     out-of-box defaults).
//   - `./WidgetShell` (web: a transparent flex container whose card chrome comes
//     from the dashboard grid cell, with Skeleton loading + QueryError error + a
//     DataFreshness header affordance) is inlined on a `GlassPanel` (so the tile
//     is styled standalone): loading -> centered Spinner, optional title row +
//     compact freshness control (status dot + refresh Pressable) over children.
//   - `./types` `WidgetProps` -> a local interface mirroring it
//     (WidgetSize {cols, rows}); `./types` is not yet ported.

import React, {useCallback, useMemo, type ReactNode} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type DimensionValue,
} from 'react-native';

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

/* ─── inlined MetricBar (web @/components/data-display MetricBar) ────────────── */

function MetricBar({
  color,
  label,
  max,
  sublabel,
  value,
}: {
  color: string;
  label: string;
  max: number;
  sublabel?: string;
  value: number;
}) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <View style={styles.metricBar}>
      <View style={styles.metricBarHeaderRow}>
        <AppText style={styles.metricBarLabel} tone="secondary">
          {label}
        </AppText>
        <AppText style={[styles.metricBarValue, {color}]}>
          {sublabel ?? fmtNumber(value)}
        </AppText>
      </View>
      <View style={styles.metricBarTrack}>
        <View
          style={[
            styles.metricBarFill,
            {backgroundColor: color, width: `${pct}%` as DimensionValue},
          ]}
        />
      </View>
    </View>
  );
}

/* ─── the widget ───────────────────────────────────────────────────────────── */

export default function RangeBarWidget({size, vehicleId}: WidgetProps) {
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
  const {unitPrefs} = useUnits();
  const toDistanceDisplay = (value: number) =>
    convertDistanceFromSI(value, unitPrefs.distance);

  const distanceUnit = unitPrefs.distance;

  // The web reads `stateData?.state` as `any`; the native hook strictly types it
  // as `VehicleState | string | null`. Narrow to the object form for field
  // access — a string state has no range fields, so it falls through to the empty
  // state exactly like the web (rated/ideal default to 0 -> hasData false).
  const rawState = stateData?.state;
  const state: VehicleState | undefined =
    rawState != null && typeof rawState === 'object' ? rawState : undefined;

  const isCompact = size.cols === 1 && size.rows === 1;

  const rated = state?.rated_range ?? 0;
  const ideal = state?.ideal_range ?? 0;
  const hasData = state != null && (rated > 0 || ideal > 0);
  const maxRange = Math.max(rated, ideal, 1);

  const ratedConverted = toDistanceDisplay(rated);
  const idealConverted = toDistanceDisplay(ideal);
  const maxConverted = toDistanceDisplay(maxRange);

  return (
    <WidgetShell
      icon={
        isCompact ? undefined : (
          <AppText importantForAccessibility="no" style={styles.titleIconGlyph}>
            {ICON_GAUGE}
          </AppText>
        )
      }
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={isLoading}
      onRefresh={() => refetch()}
      title={isCompact ? undefined : t('widget.rangeBar', 'Range')}
      updatedAt={dataUpdatedAt}>
      {hasData ? (
        isCompact ? (
          <View style={styles.compact}>
            <AppText style={styles.compactValue}>
              {fmtNumber(ratedConverted, 0)}
            </AppText>
            <AppText style={styles.compactCaption} tone="muted">
              {`${distanceUnit} ${t('widget.rated', 'rated')}`}
            </AppText>
          </View>
        ) : (
          <View style={styles.barSection}>
            <MetricBar
              color="#22d3ee"
              label={t('widget.ratedRange', 'Rated Range')}
              max={maxConverted}
              sublabel={`${fmtNumber(ratedConverted, 0)} ${distanceUnit}`}
              value={ratedConverted}
            />
            <MetricBar
              color="#a78bfa"
              label={t('widget.idealRange', 'Ideal Range')}
              max={maxConverted}
              sublabel={`${fmtNumber(idealConverted, 0)} ${distanceUnit}`}
              value={idealConverted}
            />
            {rated > 0 && ideal > 0 ? (
              <AppText style={styles.epaLine} tone="muted">
                {`${t('widget.epaComparison', 'EPA variance')} `}
                <AppText style={styles.epaValue} tone="secondary">
                  {`${ideal >= rated ? '+' : ''}${fmtNumber(
                    ((ideal - rated) / rated) * 100,
                    1,
                  )}%`}
                </AppText>
              </AppText>
            ) : null}
          </View>
        )
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
    </WidgetShell>
  );
}

RangeBarWidget.displayName = 'RangeBarWidget';

const styles = StyleSheet.create({
  barSection: {
    gap: spacing.md,
    justifyContent: 'center',
  },
  centerFill: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    padding: spacing.md,
  },
  compact: {
    alignItems: 'center',
    gap: 2,
    justifyContent: 'center',
    minHeight: 44,
  },
  compactCaption: {
    fontSize: 10,
  },
  compactValue: {
    color: '#67e8f9',
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 30,
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
  epaLine: {
    fontSize: 10,
    textAlign: 'right',
  },
  epaValue: {
    fontVariant: ['tabular-nums'],
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
  metricBar: {
    gap: 6,
  },
  metricBarFill: {
    borderRadius: 9999,
    height: '100%',
  },
  metricBarHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  metricBarLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  metricBarTrack: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 9999,
    height: 8,
    overflow: 'hidden',
  },
  metricBarValue: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  shell: {
    borderRadius: 16,
    gap: spacing.sm,
    padding: spacing.md,
  },
  titleIconGlyph: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 14,
  },
  titleText: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
});
