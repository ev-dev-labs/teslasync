// SpeedHeatmapWidget — native parity port of
// web/src/features/dashboard/widgets/SpeedHeatmapWidget.tsx.
//
// The dashboard "Speed Heatmap" widget. It resolves a vehicle from the explicit
// `vehicleId` prop, falling back to the first vehicle (`useVehicles`), then
// fetches up to 200 drives (`GET /drives?vehicle_id={id}&limit=200`) and folds
// their start timestamps into a 7-row (Mon..Sun) x 24-col (0h..23h) grid of
// average speeds. Three derived values — the per-cell grid, the global maxSpeed,
// and the totalDrives count — are memoised exactly like the web source, and the
// body has three layouts preserved verbatim:
//   1. compact (size.cols <= 1) -> a single "peak speed" metric (max value or
//      "—") over a "Peak {unit}" caption.
//   2. standard/wide (totalDrives > 0) -> a titled shell with a summary line
//      ({count} drives · Peak avg {speed} {unit}), the heatmap grid, and a
//      Slow..Fast colour legend.
//   3. no drives -> an EmptyState ("No drive data yet").
// Every state name (vehicles, id, drives, grid, maxSpeed, totalDrives,
// isCompact, isWide, dayLabels), the query key/path/staleTime/enabled gate, the
// SI->display speed conversion, the 4-stop teal->cyan->amber->red colour ramp,
// the day/hour label sets, the i18n key + English fallback for every string, and
// each render branch are preserved; all 288 source lines are mapped in the
// .parity.json sidecar.
//
// SI-floor (web L35/L52): drive.avg_speed_mps / max_speed_mps arrive in
// METRES·SECOND⁻¹; convertSpeedFromSI handles the m/s->user-unit (km/h or mph)
// conversion at the display boundary, exactly like the web source.
//
// Native adaptations vs. the web source (behaviour / state / keys preserved):
//   - react-i18next useTranslation('dashboard') (web L2/L88) -> the native
//     t(key, fallback, options?) shim used across the parity tree (the namespace
//     is accepted-and-ignored — there is no i18n runtime in RN). The web
//     `{{count}}`/`{{speed}}`/`{{unit}}` interpolation is reproduced by the same
//     `interpolate(fallback, options)` helper the page conversions use.
//   - lucide-react Grid3X3 (web L4) -> the native SemanticIcon 'layoutGrid'
//     glyph (lucide is browser-only); rendered as a decorative glyph tinted with
//     the accent token (web text-neon-cyan) in the title and muted in the empty
//     state.
//   - @/components/feedback EmptyState (web L5) -> an inline native EmptyState
//     (centered icon chip + muted message) — the feedback barrel is not in the
//     native parity manifest, so it is reproduced self-contained per the
//     BatteryGaugeWidget / ChargeStatusWidget precedent.
//   - @/api/hooks useVehicles (web L6) -> imported from its canonical converted
//     native hook (../../../api/hooks/useVehicles) — same /vehicles path, same
//     fields.
//   - @/hooks/useUnits useUnits (web L7) -> an inline native useUnits that reads
//     the native useSettings (unit_of_length 'mi' -> 'mph', else 'km/h',
//     matching the web deriveSpeed). Only unitPrefs.speed is consumed, exactly
//     like the web source.
//   - @/api/client request (web L8) + @tanstack/react-query useQuery (web L3) ->
//     used directly: request from the converted native client (../../../api/
//     client), useQuery from @tanstack/react-query (a native dependency). The
//     queryKey ['drives', id, 'speed-heatmap'], the /drives?vehicle_id={id}&
//     limit=200 path, enabled: id > 0, and staleTime 120_000 are preserved.
//   - @/lib/numberFormat fmtNumber (web L9) -> ported inline (en-US
//     toLocaleString, default 2 fraction digits = the web global-precision
//     default; safeNumber guard) — always called with 0 here, as in the source.
//   - @/lib/unitConversion convertSpeedFromSI / SpeedUnitPref (web L10) ->
//     ported inline verbatim (km/h: mps*3600/1000, mph: mps*3600/1609.344;
//     SpeedUnitPref = 'km/h' | 'mph').
//   - ./WidgetShell (web L11) + ./types WidgetProps (web L12) -> reproduced
//     self-contained here: these sibling widget primitives have their own
//     manifest entries and are not yet in the native tree, so the shell chrome
//     and the WidgetProps/WidgetSize types are ported inline (the
//     BatteryGaugeWidget conversion established this inline-reproduction
//     pattern). WidgetShell's browser-only Skeleton/QueryError/PinButton/
//     HelpTooltip/DataFreshness chrome becomes a native-safe freshness pill
//     (relative "updated" time + a refresh Pressable wired to onRefresh, with
//     stale/error/fetching markers), a dimmed skeleton box, and a centered
//     error block; the title/noPadding props are honoured.
//   - @/api/types Drive (web L13) -> imported from the converted native types
//     (../../../api/types) — identical SI-canonical shape.
//   - the SVG <svg>/<rect>/<text>/<title> heatmap (web HeatmapGrid L214-288) ->
//     a flexbox View grid (RN has no SVG primitive; the canonical RadialGauge
//     and the sibling CostHeatmap establish View-based heat grids): a top hour-
//     label row + 7 day rows of 24 flex cells, each cell a View whose dynamic
//     backgroundColor is speedToColor(avgSpeed, maxSpeed) (the only RN-allowed
//     inline-style case) and whose web `<title>` tooltip becomes an
//     accessibilityLabel carrying the same "Day H:00 – N {unit} (M drives)" /
//     "No data" text.
//
// No DOM / lucide / react-i18next / Recharts / Leaflet / old web-UI imports
// reach the native output — only react, react-native primitives, TanStack
// Query, the canonical AppText + GlassPanel + SemanticIcon, the converted parity
// hooks/client/types, and theme tokens.

import React, {type ReactNode} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import {useQuery} from '@tanstack/react-query';

import {getSemanticIconDefinition} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors} from '../../../../theme/tokens';
import {request} from '../../../api/client';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {useSettings} from '../../../api/hooks/useSettings';
import type {Drive} from '../../../api/types';

/** 7 rows (Mon–Sun) × 24 cols (0h–23h) */
const ROWS = 7;
const COLS = 24;

interface HeatCell {
  day: number; // 0=Mon … 6=Sun
  hour: number; // 0–23
  avgSpeed: number;
  count: number;
}

// ── Ported widget types (web ./types WidgetProps / WidgetSize) ────────────────

/** Grid footprint in cols/rows (web `./types` WidgetSize). */
interface WidgetSize {
  cols: number; // 1-4
  rows: number; // 1-8
}

/** Widget render props (web `./types` WidgetProps). `config` is accepted for
 *  source parity but, like the web source, this widget reads only vehicleId +
 *  size. */
interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: Record<string, unknown>;
}

// ── Native-safe i18n fallback (web react-i18next useTranslation) ─────────────

type InterpolationValues = Record<string, string | number>;
type NativeTFunction = (
  key: string,
  fallback: string,
  options?: InterpolationValues,
) => string;

function interpolate(template: string, values: InterpolationValues): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = values[key];
    return value === undefined ? '' : String(value);
  });
}

function useNativeTranslationFallback(): NativeTFunction {
  return React.useCallback(
    (_key, fallback, options) =>
      options ? interpolate(fallback, options) : fallback,
    [],
  );
}

// ── Ported number format (web @/lib/numberFormat fmtNumber) ───────────────────

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals = 2): string {
  return safeNumber(v).toLocaleString('en-US', {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  });
}

// ── Ported unit conversion (web @/lib/unitConversion convertSpeedFromSI) ──────

type SpeedUnitPref = 'km/h' | 'mph';

const SECONDS_PER_HOUR = 3600;
const METERS_PER_KM = 1000;
const METERS_PER_MILE = 1609.344;

function convertSpeedFromSI(mps: number, to: SpeedUnitPref): number {
  switch (to) {
    case 'km/h':
      return (mps * SECONDS_PER_HOUR) / METERS_PER_KM;
    case 'mph':
      return (mps * SECONDS_PER_HOUR) / METERS_PER_MILE;
  }
}

// ── Inline native useUnits (web @/hooks/useUnits) — reads native useSettings ──

interface UnitPrefsLite {
  speed: SpeedUnitPref;
}

function useUnits(): {unitPrefs: UnitPrefsLite} {
  const {data} = useSettings();
  const speed: SpeedUnitPref = data?.unit_of_length === 'mi' ? 'mph' : 'km/h';
  const unitPrefs = React.useMemo<UnitPrefsLite>(() => ({speed}), [speed]);
  return {unitPrefs};
}

/** Build a 7×24 grid of average speeds from drive start times. */
function buildHeatmap(drives: Drive[], speedUnit: SpeedUnitPref): HeatCell[][] {
  // Accumulator: [day][hour] → { total, count }
  const acc: {total: number; count: number}[][] = Array.from(
    {length: ROWS},
    () => Array.from({length: COLS}, () => ({total: 0, count: 0})),
  );

  for (const d of drives) {
    if (!d.start_ts) continue;
    const speed = d.avg_speed_mps ?? d.max_speed_mps;
    if (speed == null || speed <= 0) continue;

    const dt = new Date(d.start_ts);
    // JS getDay: 0=Sun … 6=Sat → remap to 0=Mon … 6=Sun
    const jsDay = dt.getDay();
    const day = jsDay === 0 ? 6 : jsDay - 1;
    const hour = dt.getHours();

    acc[day][hour].total += speed;
    acc[day][hour].count += 1;
  }

  return acc.map((row, day) =>
    row.map((cell, hour) => ({
      day,
      hour,
      avgSpeed:
        cell.count > 0
          ? convertSpeedFromSI(cell.total / cell.count, speedUnit)
          : 0,
      count: cell.count,
    })),
  );
}

/** Interpolate between two hex colours. t ∈ [0, 1] */
function lerpColor(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): string {
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r},${g},${bl})`;
}

// 4-stop gradient: empty → cool teal → warm amber → hot red
const COLOR_STOPS: [number, number, number][] = [
  [20, 184, 166], // teal-500
  [6, 182, 212], // cyan-500
  [245, 158, 11], // amber-500
  [239, 68, 68], // red-500
];

function speedToColor(speed: number, maxSpeed: number): string {
  if (speed <= 0 || maxSpeed <= 0) return 'rgba(255,255,255,0.03)';
  const t = Math.min(speed / maxSpeed, 1);
  // Map t to a position across 3 segments (4 stops)
  const segCount = COLOR_STOPS.length - 1;
  const seg = Math.min(Math.floor(t * segCount), segCount - 1);
  const localT = t * segCount - seg;
  return lerpColor(COLOR_STOPS[seg], COLOR_STOPS[seg + 1], localT);
}

const DAY_LABELS_SHORT = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const DAY_LABELS_FULL = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Legend stops (web L190) + the 24 hour columns + the hour-label thinning sets.
const LEGEND_STOPS = [0, 0.25, 0.5, 0.75, 1];
const HOURS = Array.from({length: COLS}, (_unused, i) => i);
const WIDE_HOUR_LABELS = [0, 3, 6, 9, 12, 15, 18, 21];
const NARROW_HOUR_LABELS = [0, 6, 12, 18];

// ── SemanticIcon glyph node (web lucide Grid3X3 nodes) ───────────────────────

const GRID_GLYPH = getSemanticIconDefinition('layoutGrid').glyph;

/**
 * Renders the decorative grid glyph in the given color, replacing the web lucide
 * `<Grid3X3 className="…" />` nodes (title icon + empty-state icon).
 */
function gridGlyph(color: string, glyphStyle: StyleProp<TextStyle>): ReactNode {
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[glyphStyle, {color}]}
      weight="bold">
      {GRID_GLYPH}
    </AppText>
  );
}

// ── Inline native EmptyState (web @/components/feedback EmptyState) ───────────

function EmptyState({icon, message}: {icon?: ReactNode; message: string}) {
  return (
    <View accessible accessibilityLabel={message} style={styles.empty}>
      {icon ? <View style={styles.emptyIcon}>{icon}</View> : null}
      <AppText style={styles.emptyMessage} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

// ── Inline native WidgetShell (web ./WidgetShell) ─────────────────────────────

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Relative "updated" time: <1m "Just now", <60m "Xm ago", <24h "Xh ago",
 *  else the absolute date-time. */
function formatRelativeTime(isoStr: string): string {
  const d = new Date(isoStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  return formatDateTime(isoStr);
}

/** Native-safe freshness pill: relative "updated" time + refresh affordance,
 *  reflecting the query's fetching/stale/error flags. Replaces the web
 *  DataFreshness chrome (which depends on browser-only timers/icons). */
function DataFreshness({
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
}: {
  updatedAt: number;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  onRefresh?: () => void;
}) {
  let label: string;
  if (isError) label = 'Error';
  else if (isFetching) label = 'Updating…';
  else if (updatedAt > 0)
    label = formatRelativeTime(new Date(updatedAt).toISOString());
  else label = 'Never';

  return (
    <Pressable
      accessibilityLabel="Refresh"
      accessibilityRole="button"
      hitSlop={6}
      onPress={onRefresh}
      style={styles.freshness}>
      <AppText
        style={[
          styles.freshnessText,
          isError ? styles.freshnessError : isStale ? styles.freshnessStale : null,
        ]}>
        {label}
      </AppText>
      <AppText style={styles.refreshGlyph} weight="bold">
        {getSemanticIconDefinition('refresh').glyph}
      </AppText>
    </Pressable>
  );
}

function WidgetShell({
  title,
  icon,
  loading,
  error,
  noPadding,
  children,
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
}: {
  title?: string;
  icon?: ReactNode;
  loading?: boolean;
  error?: string | null;
  noPadding?: boolean;
  children: ReactNode;
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
}) {
  if (loading) {
    return <View accessibilityLabel="Loading" style={styles.skeleton} />;
  }

  if (error) {
    return (
      <View accessibilityLabel={error} style={styles.errorShell}>
        <AppText style={styles.errorText} tone="danger">
          {error}
        </AppText>
      </View>
    );
  }

  return (
    <GlassPanel style={styles.shell}>
      <View style={styles.shellHeader}>
        <View style={styles.shellTitleGroup}>
          {icon}
          {title ? <AppText style={styles.shellTitle}>{title}</AppText> : null}
        </View>
        <DataFreshness
          isError={isError ?? false}
          isFetching={isFetching ?? false}
          isStale={isStale ?? false}
          onRefresh={onRefresh}
          updatedAt={updatedAt ?? 0}
        />
      </View>
      <View style={noPadding ? styles.shellBodyFlush : styles.shellBodyPadded}>
        {children}
      </View>
    </GlassPanel>
  );
}

// ── Main widget ────────────────────────────────────────────────────────────────

export default function SpeedHeatmapWidget({vehicleId, size}: WidgetProps) {
  const t = useNativeTranslationFallback();
  const {data: vehicles} = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const {unitPrefs} = useUnits();

  const {
    data: drives,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useQuery({
    queryKey: ['drives', id, 'speed-heatmap'],
    queryFn: () => request<Drive[]>(`/drives?vehicle_id=${id}&limit=200`),
    enabled: id > 0,
    staleTime: 120_000,
  });

  const grid = React.useMemo(
    () => buildHeatmap(drives ?? [], unitPrefs.speed),
    [drives, unitPrefs.speed],
  );

  const maxSpeed = React.useMemo(() => {
    let max = 0;
    for (const row of grid) {
      for (const cell of row) {
        if (cell.avgSpeed > max) max = cell.avgSpeed;
      }
    }
    return max;
  }, [grid]);

  const totalDrives = React.useMemo(() => {
    let total = 0;
    for (const row of grid) {
      for (const cell of row) {
        total += cell.count;
      }
    }
    return total;
  }, [grid]);

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  // Compact: show peak speed metric
  if (isCompact) {
    return (
      <WidgetShell
        loading={isLoading}
        error={error ? String(error) : null}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={() => refetch()}>
        <View style={styles.compactMetric}>
          <AppText style={styles.compactValue}>
            {maxSpeed > 0 ? fmtNumber(maxSpeed, 0) : '—'}
          </AppText>
          <AppText style={styles.compactLabel} tone="muted">
            {`${t('widget.speedHeatmap.peak', 'Peak')} ${unitPrefs.speed}`}
          </AppText>
        </View>
      </WidgetShell>
    );
  }

  const dayLabels = isWide ? DAY_LABELS_FULL : DAY_LABELS_SHORT;

  return (
    <WidgetShell
      error={error ? String(error) : null}
      icon={gridGlyph(colors.accent, styles.titleIcon)}
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={isLoading}
      noPadding
      onRefresh={() => refetch()}
      title={t('widget.speedHeatmap.title', 'Speed Heatmap')}
      updatedAt={dataUpdatedAt}>
      {totalDrives > 0 ? (
        <View style={styles.body}>
          {/* Summary */}
          <View style={styles.summaryRow}>
            <AppText style={styles.summaryText} tone="secondary">
              {t('widget.speedHeatmap.drives', '{{count}} drives', {
                count: totalDrives,
              })}
            </AppText>
            <AppText style={styles.summaryDot} tone="muted">
              {'\u00B7'}
            </AppText>
            <AppText style={styles.summaryText} tone="secondary">
              {t('widget.speedHeatmap.peakSpeed', 'Peak avg {{speed}} {{unit}}', {
                speed: fmtNumber(maxSpeed, 0),
                unit: unitPrefs.speed,
              })}
            </AppText>
          </View>

          {/* Heatmap */}
          <View style={styles.gridWrap}>
            <HeatmapGrid
              dayLabels={dayLabels}
              grid={grid}
              isWide={isWide}
              maxSpeed={maxSpeed}
              speedUnit={unitPrefs.speed}
              t={t}
            />
          </View>

          {/* Legend */}
          <View style={styles.legendRow}>
            <AppText style={styles.legendText} tone="muted">
              {t('widget.speedHeatmap.slow', 'Slow')}
            </AppText>
            <View style={styles.legendSwatches}>
              {LEGEND_STOPS.map(stop => (
                <View
                  key={stop}
                  style={[
                    styles.legendSwatch,
                    {
                      backgroundColor: speedToColor(
                        stop * (maxSpeed || 1),
                        maxSpeed || 1,
                      ),
                    },
                  ]}
                />
              ))}
            </View>
            <AppText style={styles.legendText} tone="muted">
              {t('widget.speedHeatmap.fast', 'Fast')}
            </AppText>
          </View>
        </View>
      ) : (
        // no-action: transient empty state — surfaces when source data is
        // missing; no specific recovery action available.
        <EmptyState
          icon={gridGlyph(colors.textMuted, styles.emptyGlyph)}
          message={t('widget.speedHeatmap.empty', 'No drive data yet')}
        />
      )}
    </WidgetShell>
  );
}

/* ── Heatmap Grid (web SVG ./ HeatmapGrid) ── */

interface HeatmapGridProps {
  grid: HeatCell[][];
  maxSpeed: number;
  dayLabels: string[];
  isWide: boolean;
  speedUnit: string;
  t: (key: string, fallback: string) => string;
}

function HeatmapGrid({
  grid,
  maxSpeed,
  dayLabels,
  isWide,
  speedUnit,
  t,
}: HeatmapGridProps) {
  // web leftMargin (day-label gutter) 30 wide / 14 narrow.
  const dayLabelWidth = isWide ? 30 : 14;
  // web hourLabels: every 3h when wide, every 6h otherwise.
  const hourLabelSet = isWide ? WIDE_HOUR_LABELS : NARROW_HOUR_LABELS;

  return (
    <View style={styles.heatmap}>
      {/* Hour labels along top */}
      <View style={styles.hourRow}>
        <View style={{width: dayLabelWidth}} />
        {HOURS.map(h => (
          <AppText
            key={`h-${h}`}
            numberOfLines={1}
            style={styles.hourLabel}
            tone="muted">
            {hourLabelSet.includes(h) ? `${h}` : ''}
          </AppText>
        ))}
      </View>

      {/* Day rows */}
      {grid.map((row, day) => (
        <View key={`d-${day}`} style={styles.dayRow}>
          <AppText
            numberOfLines={1}
            style={[styles.dayLabel, {width: dayLabelWidth}]}
            tone="muted">
            {dayLabels[day]}
          </AppText>
          {row.map(cell => {
            const detail =
              cell.count > 0
                ? `${fmtNumber(cell.avgSpeed, 0)} ${speedUnit} (${cell.count} ${t(
                    'widget.speedHeatmap.drivesSuffix',
                    'drives',
                  )})`
                : t('widget.speedHeatmap.noData', 'No data');
            const label = `${dayLabels[day]} ${cell.hour}:00 \u2013 ${detail}`;
            return (
              <View
                key={`${day}-${cell.hour}`}
                accessibilityLabel={label}
                style={[
                  styles.cell,
                  {backgroundColor: speedToColor(cell.avgSpeed, maxSpeed)},
                ]}
              />
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    minHeight: 0,
    paddingBottom: 8,
    paddingHorizontal: 12,
  },
  cell: {
    borderRadius: 2,
    flex: 1,
    height: 14,
  },
  compactLabel: {
    fontSize: 10,
    letterSpacing: 0.6,
    marginTop: 2,
    textTransform: 'uppercase',
  },
  compactMetric: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  compactValue: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '700',
  },
  dayLabel: {
    fontSize: 9,
    lineHeight: 12,
    textAlign: 'right',
  },
  dayRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 1,
    marginBottom: 2,
  },
  empty: {
    alignItems: 'center',
    flex: 1,
    gap: 8,
    justifyContent: 'center',
    paddingVertical: 16,
  },
  emptyGlyph: {
    fontSize: 14,
    lineHeight: 18,
    textAlign: 'center',
  },
  emptyIcon: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  emptyMessage: {
    textAlign: 'center',
  },
  errorShell: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 16,
  },
  errorText: {
    fontSize: 13,
    textAlign: 'center',
  },
  freshness: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  freshnessError: {
    color: colors.danger,
  },
  freshnessStale: {
    color: colors.warning,
  },
  freshnessText: {
    color: colors.textMuted,
    fontSize: 11,
  },
  gridWrap: {
    flex: 1,
    justifyContent: 'center',
    minHeight: 0,
  },
  heatmap: {
    width: '100%',
  },
  hourLabel: {
    flex: 1,
    fontSize: 8,
    lineHeight: 10,
    textAlign: 'center',
  },
  hourRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 1,
    marginBottom: 2,
  },
  legendRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 4,
  },
  legendSwatch: {
    borderRadius: 2,
    height: 8,
    width: 16,
  },
  legendSwatches: {
    flexDirection: 'row',
    gap: 1,
  },
  legendText: {
    fontSize: 10,
    lineHeight: 14,
  },
  refreshGlyph: {
    color: colors.accent,
    fontSize: 10,
  },
  shell: {
    flex: 1,
  },
  shellBodyFlush: {
    flex: 1,
    minHeight: 0,
  },
  shellBodyPadded: {
    flex: 1,
    minHeight: 0,
    paddingBottom: 12,
    paddingHorizontal: 16,
  },
  shellHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 4,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  shellTitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  shellTitleGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 24,
    flex: 1,
    minHeight: 120,
  },
  summaryDot: {
    fontSize: 12,
  },
  summaryRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    paddingBottom: 4,
  },
  summaryText: {
    fontSize: 12,
  },
  titleIcon: {
    fontSize: 13,
    lineHeight: 16,
  },
});
