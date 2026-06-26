// Native parity port of web/src/features/dashboard/widgets/BatteryCellsWidget.tsx.
//
// The web module is the dashboard "Battery Cells" widget. It reads the per-cell
// battery summary (GET /api/v1/vehicles/{id}/battery/cells) for the selected
// (or first) vehicle and renders, when data is present:
//   • a scrollable voltage "heatmap" grid (WidgetStatusGrid) whose per-cell
//     status (ok / warning / error / unknown) is derived from how far each
//     cell's voltage deviates from the pack average (cellStatus: <=5mV ok,
//     <=15mV warning, >15mV error, null -> unknown);
//   • a 2-column Min/Max/Avg/Spread voltage StatCard grid; and
//   • on wide layouts, a 3-column Min/Avg/Max temperature StatCard row.
// When the query has no data it shows an EmptyState. The grid density and the
// per-cell label/value verbosity scale with the widget's `size.cols`
// (compact <= 1, wide >= 3), exactly as in the source.
//
// Native-safe substitutions (rules 4/5/7), documented in the parity sidecar:
//   • react-i18next useTranslation('dashboard') -> a local English-fallback
//     useTranslation(ns?) whose t(key, fallback?) returns the fallback (or key),
//     preserving every translation key verbatim.
//   • lucide-react Cpu -> the app SemanticIcon 'cpu' glyph rendered as a
//     colour-tinted AppText (GlyphIcon): cyan (text-neon-cyan) in the header,
//     muted in the empty slots (the web `h-5 w-5` icons carry no colour class).
//   • @/components/data-display StatCard -> a local native StatCard (muted
//     caption label + bold primary value), laid out by a small StatGrid whose
//     flex-wrap column target (2 / 3) mirrors the web `grid-cols-2`/`grid-cols-3`;
//     the web `!p-2` tight padding is preserved.
//   • ./shared WidgetStatusGrid + StatusCell -> a local native WidgetStatusGrid
//     (status-tinted cell with a corner dot, truncated label, optional value)
//     and the StatusCell type ported verbatim; the web container-query column
//     collapse (2/3/4) maps to flexBasis targets.
//   • ./WidgetShell WidgetShell -> a local native WidgetShell covering exactly
//     the props this call site uses (title/icon/loading/error/updatedAt/
//     isFetching/isStale/isError/onRefresh/children): Skeleton while loading, an
//     inline error block on error, a header row (icon + uppercase title +
//     freshness/refresh affordance) when titled, else an overlay freshness chip.
//   • ./types WidgetProps/WidgetSize/WidgetConfig -> ported verbatim as local
//     types (the shared registry types module is not yet in the parity tree).
//   • @/lib/numberFormat fmtNumber -> inlined locale-aware fixed-decimal helper.
//     The source widget reads no settings, so it relies on the web lib's global
//     locale, whose default is 'en-US'; the native port uses that same default.
//   • @/api/hooks/useEnergy useBatteryCells + @/api/hooks/useVehicles useVehicles
//     -> the already-ported native parity hooks (same names / return shapes).
//   • DOM <div>/<span>/<p> + Tailwind classes + overflow-y-auto -> React Native
//     View/ScrollView/AppText with StyleSheet tokens. The DataFreshness header
//     indicator is computed once at render (no 30s interval) to avoid a dangling
//     timer under --detectOpenHandles.
//
// No DOM elements, react-i18next, lucide-react, Recharts, Leaflet, react-dom, or
// web UI-kit modules are imported into the native output.

import React, {useCallback, useMemo, type ReactNode} from 'react';
import {Pressable, ScrollView, StyleSheet, View} from 'react-native';

import {
  getSemanticIconDefinition,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {EmptyState} from '../../../components/feedback/EmptyState';
import {Skeleton} from '../../../components/feedback/Skeleton';
import {useBatteryCells} from '../../../api/hooks/useEnergy';
import {useVehicles} from '../../../api/hooks/useVehicles';

const DEFAULT_LOCALE = 'en-US';

/* ─── ./types (dashboard widget registry types, ported verbatim) ─────────── */

export interface WidgetSize {
  cols: number; // 1-4
  rows: number; // 1-8
}

export interface WidgetConfig {
  vehicleId?: number;
  refreshRate?: number;
  chartType?: string;
  showTitle?: boolean;
  timeRange?: string;
  [key: string]: unknown;
}

export interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: WidgetConfig;
}

/* ─── ./shared StatusCell (ported verbatim) ──────────────────────────────── */

export interface StatusCell {
  id: string;
  label: string;
  status: 'ok' | 'warning' | 'error' | 'inactive' | 'unknown';
  value?: string;
  icon?: ReactNode;
}

/* ─── i18n fallback (web react-i18next useTranslation/TFunction) ─────────── */

type TFunc = (key: string, fallback?: string) => string;

// Native stand-in for react-i18next's useTranslation('dashboard'): the parity
// bundle ships no i18n runtime, so `t` returns the English fallback (or the key)
// while preserving every key at the call site.
function useTranslation(_namespace?: string): {t: TFunc} {
  const t = useCallback<TFunc>((key, fallback) => fallback ?? key, []);
  return {t};
}

/* ─── inlined @/lib/numberFormat fmtNumber ───────────────────────────────── */

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

// web @/lib/numberFormat fmtNumber: locale-aware separators with a fixed
// fraction-digit count (min === max). The source widget never sets the lib's
// global locale, so it stays at the lib default 'en-US'.
function fmtNumber(value: unknown, decimals: number): string {
  const digits = Math.max(0, Math.min(20, Math.floor(decimals)));
  return safeNumber(value).toLocaleString(DEFAULT_LOCALE, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/* ─── cellStatus (ported verbatim from the source) ───────────────────────── */

/**
 * Derive a status from how far a cell's voltage deviates from the average.
 * ≤5 mV → ok, ≤15 mV → warning, >15 mV → error, null → unknown.
 */
function cellStatus(voltage: number | null, avg: number): StatusCell['status'] {
  if (voltage == null) return 'unknown';
  const deviationMv = Math.abs(voltage - avg) * 1000;
  if (deviationMv <= 5) return 'ok';
  if (deviationMv <= 15) return 'warning';
  return 'error';
}

/* ─── tinted glyph icon (web lucide-react Cpu) ───────────────────────────── */

function GlyphIcon({
  name,
  color,
  size,
}: {
  name: SemanticIconName;
  color: string;
  size: number;
}) {
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.glyph, {color, fontSize: size, lineHeight: size + 2}]}>
      {getSemanticIconDefinition(name).glyph}
    </AppText>
  );
}

/* ─── DataFreshness chip (web @/components/data-display) ──────────────────── */

// Computed once at render (no interval) to avoid a dangling timer under
// --detectOpenHandles.
function relativeTime(updatedAt: number): string {
  if (!updatedAt || updatedAt <= 0) {
    return 'never';
  }
  const diffMs = Math.max(0, Date.now() - updatedAt);
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function DataFreshness({
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
  compact,
}: {
  updatedAt: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
  compact?: boolean;
}) {
  let label: string;
  let dotColor: string;
  if (isError) {
    label = 'Error';
    dotColor = colors.danger;
  } else if (isFetching) {
    label = 'Updating…';
    dotColor = colors.accent;
  } else if (isStale) {
    label = 'Stale';
    dotColor = colors.warning;
  } else {
    label = relativeTime(updatedAt);
    dotColor = colors.success;
  }

  return (
    <Pressable
      accessibilityLabel={`Data ${label}. Refresh.`}
      accessibilityRole="button"
      disabled={!onRefresh}
      onPress={onRefresh}
      style={styles.freshness}
      testID="widget-freshness">
      <View style={[styles.freshnessDot, {backgroundColor: dotColor}]} />
      {compact ? null : (
        <AppText style={styles.freshnessLabel} tone="muted" variant="caption">
          {label}
        </AppText>
      )}
    </Pressable>
  );
}

/* ─── WidgetShell (web ./WidgetShell, subset used by this widget) ─────────── */

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
    return <Skeleton height={120} rounded style={styles.shellSkeleton} />;
  }

  if (error) {
    return (
      <View style={styles.shellError} testID="widget-error">
        <AppText style={styles.shellErrorText} tone="danger" variant="caption">
          {error}
        </AppText>
      </View>
    );
  }

  const showFreshness = updatedAt !== undefined;
  // Compact (dot-only) when the widget has no title (typically 1-col widgets).
  const freshnessCompact = !title;
  const freshnessEl = showFreshness ? (
    <DataFreshness
      compact={freshnessCompact}
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      onRefresh={onRefresh}
      updatedAt={updatedAt ?? 0}
    />
  ) : null;

  return (
    <View style={styles.shell}>
      {title ? (
        <View style={styles.shellHeader}>
          <View style={styles.shellTitleRow}>
            {icon}
            <AppText
              numberOfLines={1}
              style={styles.shellTitle}
              tone="muted"
              variant="caption">
              {title.toUpperCase()}
            </AppText>
          </View>
          {freshnessEl}
        </View>
      ) : (
        freshnessEl && (
          <View pointerEvents="box-none" style={styles.shellFreshnessOverlay}>
            {freshnessEl}
          </View>
        )
      )}
      <View style={styles.shellBody}>{children}</View>
    </View>
  );
}

/* ─── WidgetStatusGrid (web ./shared/WidgetStatusGrid) ───────────────────── */

const statusVisuals: Record<
  StatusCell['status'],
  {bg: string; border: string; dot: string}
> = {
  ok: {bg: colors.successSurface, border: colors.successBorder, dot: colors.success},
  warning: {
    bg: colors.warningSurface,
    border: colors.warningBorder,
    dot: colors.warning,
  },
  error: {bg: colors.dangerSurface, border: colors.dangerBorder, dot: colors.danger},
  inactive: {bg: colors.surfaceRaised, border: colors.border, dot: colors.textMuted},
  unknown: {bg: colors.surfaceRaised, border: colors.border, dot: colors.textMuted},
};

function WidgetStatusGrid({
  cells,
  cols = 2,
  compact = false,
  emptyMessage = 'No status data available',
  emptyIcon,
}: {
  cells: StatusCell[];
  cols?: 2 | 3 | 4;
  compact?: boolean;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
}) {
  if (cells.length === 0) {
    return (
      <EmptyState
        icon={emptyIcon}
        message={emptyMessage}
        style={styles.statusEmpty}
      />
    );
  }

  const resolvedCols = compact ? 2 : cols;
  const basis =
    resolvedCols === 4 ? '23%' : resolvedCols === 3 ? '31%' : '48%';

  return (
    <View style={styles.statusGrid} testID="widget-status-grid">
      {cells.map(cell => {
        const visual = statusVisuals[cell.status];
        return (
          <View
            key={cell.id}
            style={[
              styles.statusCell,
              compact && styles.statusCellCompact,
              {flexBasis: basis, backgroundColor: visual.bg, borderColor: visual.border},
            ]}>
            <View style={[styles.statusDot, {backgroundColor: visual.dot}]} />
            {cell.icon ? <View style={styles.statusIcon}>{cell.icon}</View> : null}
            <View style={styles.statusBody}>
              <AppText
                numberOfLines={1}
                style={styles.statusLabel}
                tone="secondary"
                variant="caption">
                {cell.label}
              </AppText>
              {!compact && cell.value ? (
                <AppText
                  numberOfLines={1}
                  style={styles.statusValue}
                  weight="semibold">
                  {cell.value}
                </AppText>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/* ─── StatCard + StatGrid (web @/components/data-display StatCard) ────────── */

function StatCard({label, value}: {label: string; value: string}) {
  return (
    <View style={styles.statCard}>
      <AppText
        numberOfLines={1}
        style={styles.statLabel}
        tone="muted"
        variant="caption">
        {label}
      </AppText>
      <AppText numberOfLines={1} style={styles.statValue} weight="bold">
        {value}
      </AppText>
    </View>
  );
}

function StatGrid({
  items,
  cols,
  testID,
}: {
  items: {label: string; value: string}[];
  cols: 2 | 3;
  testID?: string;
}) {
  const basis = cols === 3 ? '31%' : '48%';
  return (
    <View style={styles.statGrid} testID={testID}>
      {items.map(item => (
        <View key={item.label} style={[styles.statCell, {flexBasis: basis}]}>
          <StatCard label={item.label} value={item.value} />
        </View>
      ))}
    </View>
  );
}

/* ─── BatteryCellsWidget ─────────────────────────────────────────────────── */

export default function BatteryCellsWidget({vehicleId, size}: WidgetProps) {
  const {t} = useTranslation('dashboard');
  const {data: vehicles} = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id ?? null;
  const vidStr = vid != null ? String(vid) : null;

  const {
    data,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useBatteryCells(vidStr);

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  // Wrapped in useMemo so the `?? []` fallback keeps a stable reference and does
  // not invalidate the statusCells memo below on every render (the web source
  // reads `data?.cells ?? []` inline; behaviour is identical).
  const cells = useMemo(() => data?.cells ?? [], [data?.cells]);
  const avgV = data?.avg_voltage ?? 0;

  // Map cells → StatusCell items for the shared grid
  const statusCells = useMemo<StatusCell[]>(() => {
    return cells.map(c => {
      const status = cellStatus(c.voltage, avgV);
      const label = isWide
        ? `${t('widget.batteryCells.cell', 'Cell')} ${c.cell_id} · M${c.module}`
        : `C${c.cell_id}`;
      const value = isWide
        ? `${fmtNumber(c.voltage, 3)} V / ${fmtNumber(c.temperature, 1)}°`
        : `${fmtNumber(c.voltage, 3)} V`;

      return {id: String(c.cell_id), label, status, value};
    });
  }, [cells, avgV, isWide, t]);

  // Summary stats
  const minV = data?.min_voltage ?? 0;
  const maxV = data?.max_voltage ?? 0;
  const spread = data?.voltage_spread ?? 0;

  return (
    <WidgetShell
      title={
        isCompact ? undefined : t('widget.batteryCells.title', 'Battery Cells')
      }
      icon={<GlyphIcon color={colors.accent} name="cpu" size={13} />}
      loading={isLoading}
      error={error ? String(error) : null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}>
      {data ? (
        <View style={styles.column}>
          {/* Voltage heatmap grid */}
          <ScrollView
            style={styles.gridScroll}
            contentContainerStyle={styles.gridScrollContent}>
            <WidgetStatusGrid
              cells={statusCells}
              cols={isWide ? 4 : isCompact ? 2 : 3}
              compact={isCompact}
              emptyMessage={t('widget.batteryCells.noCells', 'No cell data')}
              emptyIcon={
                <GlyphIcon color={colors.textSecondary} name="cpu" size={18} />
              }
            />
          </ScrollView>

          {/* Min / Max / Avg / Spread stats */}
          <StatGrid
            cols={2}
            testID="battery-cells-voltage-stats"
            items={[
              {
                label: t('widget.batteryCells.minV', 'Min V'),
                value: `${fmtNumber(minV, 3)} V`,
              },
              {
                label: t('widget.batteryCells.maxV', 'Max V'),
                value: `${fmtNumber(maxV, 3)} V`,
              },
              {
                label: t('widget.batteryCells.avgV', 'Avg V'),
                value: `${fmtNumber(avgV, 3)} V`,
              },
              {
                label: t('widget.batteryCells.spread', 'Spread'),
                value: `${fmtNumber(spread * 1000, 1)} mV`,
              },
            ]}
          />

          {/* Wide layout: temperature summary row */}
          {isWide && (
            <StatGrid
              cols={3}
              testID="battery-cells-temp-stats"
              items={[
                {
                  label: t('widget.batteryCells.minTemp', 'Min Temp'),
                  value: `${fmtNumber(data.min_temperature, 1)}°`,
                },
                {
                  label: t('widget.batteryCells.avgTemp', 'Avg Temp'),
                  value: `${fmtNumber(data.avg_temperature, 1)}°`,
                },
                {
                  label: t('widget.batteryCells.maxTemp', 'Max Temp'),
                  value: `${fmtNumber(data.max_temperature, 1)}°`,
                },
              ]}
            />
          )}
        </View>
      ) : (
        <EmptyState
          icon={<GlyphIcon color={colors.textSecondary} name="cpu" size={18} />}
          message={t('widget.batteryCells.noData', 'No battery cell data')}
          style={styles.emptyState}
        />
      )}
    </WidgetShell>
  );
}

const styles = StyleSheet.create({
  glyph: {
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  // WidgetShell
  shell: {
    flex: 1,
    position: 'relative',
  },
  shellSkeleton: {
    height: '100%',
    minHeight: 120,
  },
  shellError: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.md,
  },
  shellErrorText: {
    textAlign: 'center',
  },
  shellHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  shellTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: 6,
  },
  shellTitle: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.6,
  },
  shellFreshnessOverlay: {
    position: 'absolute',
    right: 6,
    top: 6,
    zIndex: 5,
  },
  shellBody: {
    flex: 1,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md,
  },
  // DataFreshness
  freshness: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  freshnessDot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  freshnessLabel: {
    fontSize: 10,
  },
  // Layout
  column: {
    flex: 1,
    flexDirection: 'column',
    gap: spacing.sm,
  },
  gridScroll: {
    flex: 1,
  },
  gridScrollContent: {
    paddingBottom: 2,
  },
  emptyState: {
    paddingVertical: spacing.md,
  },
  // WidgetStatusGrid
  statusEmpty: {
    paddingVertical: spacing.md,
  },
  statusGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statusCell: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    flexGrow: 1,
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    position: 'relative',
  },
  statusCellCompact: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  statusDot: {
    borderRadius: 4,
    height: 8,
    position: 'absolute',
    right: spacing.sm,
    top: spacing.sm,
    width: 8,
  },
  statusIcon: {
    flexShrink: 0,
  },
  statusBody: {
    flex: 1,
    minWidth: 0,
  },
  statusLabel: {
    fontSize: 12,
  },
  statusValue: {
    color: colors.textPrimary,
    fontSize: 13,
  },
  // StatCard / StatGrid
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statCell: {
    flexGrow: 1,
  },
  statCard: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'column',
    gap: spacing.xs,
    padding: spacing.sm,
  },
  statLabel: {
    fontSize: 12,
    fontWeight: '500',
  },
  statValue: {
    color: colors.textPrimary,
    fontSize: 18,
    lineHeight: 22,
  },
});
