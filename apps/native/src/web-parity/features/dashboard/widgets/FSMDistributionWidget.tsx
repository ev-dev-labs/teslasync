// Native parity port of web/src/features/dashboard/widgets/FSMDistributionWidget.tsx.
//
// The web widget is the dashboard "State Distribution" tile. It resolves a
// vehicle id (`vehicleId` prop, else the first vehicle from `useVehicles()`),
// reads the FSM state-time breakdown from `useFSMStats(idStr)` (GET
// /api/v1/fsm/stats?vehicle_id=…) plus the recent transition log from
// `useFSMTransitions(idStr, 'vehicle', 24, 1, 5)` (GET
// /api/v1/fsm/transitions?vehicle_id=…&hours=24&page=1&per_page=5&fsm_name=vehicle
// — both preserved verbatim by the already-ported native useFSM hook) and
// renders, inside a `WidgetShell`, one of two layouts driven by `size.cols`:
//   - Compact (cols <= 1): a coloured dot for the dominant state + the
//     capitalised state name + the time spent in it, else a GitBranch-iconed
//     empty state ("No state data").
//   - Standard (cols >= 2): a state-time distribution donut, a wrapped legend
//     (per-state dot + name + integer %), and — when there are transitions — a
//     "Recent Transitions" feed of from -> to rows with a relative timestamp,
//     else the same empty state ("No state data available").
//
// Every state name (`vehicles`, `id`, `idStr`, `statsQuery`,
// `transitionsQuery`, `isCompact`, `segments`, `transitions`, `hasData`,
// `updatedAt`, `isFetching`, `isStale`, `isError`, `isLoading`,
// `currentState`, `currentMs`), the `id = vehicleId ?? vehicles?.[0]?.id ??
// null` resolution, the `idStr = id != null ? String(id) : ''` coercion, the
// `useFSMStats(idStr)` / `useFSMTransitions(idStr, 'vehicle', 24, 1, 5)` calls,
// the `size.cols <= 1` compact threshold, both `useMemo`s with their exact
// dependency arrays (`buildDonutData(statsQuery.data?.stats ?? {})` over
// `[statsQuery.data]`; `(transitionsQuery.data?.data ?? []).slice(0, isCompact
// ? 3 : 5)` over `[transitionsQuery.data, isCompact]`), the
// `Math.max(statsQuery.dataUpdatedAt ?? 0, transitionsQuery.dataUpdatedAt ?? 0)`
// freshness merge, the `||`-ed isFetching/isStale/isError/isLoading flags, the
// dual `refetch()` onRefresh, the `STATE_COLORS` map + `stateColor()` `??
// '#6b7280'` fallback, `fmtDuration` (ms -> `Xm` / `Xh Ym`), `buildDonutData`
// (filter v>0, total, pct, sort desc), the `segments[0]?.state ?? '—'` /
// `segments[0]?.value ?? 0` compact derivations, the `tr.from_state ?? '—'` /
// `tr.to_state ?? '—'` / `tr.ts ?? ''` null-safety, and every
// `widget.fsmDistribution.*` i18n key with its English fallback (min 'm', hr
// 'h', the dynamic `state.${state}`, noData, title 'State Distribution',
// recentTransitions 'Recent Transitions') are preserved. Browser-only pieces
// are mapped to native-safe equivalents (documented in the parity sidecar):
//
//   - react-i18next `useTranslation('dashboard')` is not a native-parity
//     dependency; a local `useNativeTranslationFallback()` t() shim returns the
//     English fallback verbatim (same pattern as the APIUsageWidget /
//     BatteryDegradationTrendWidget ports), so every key + copy is preserved.
//   - lucide-react `GitBranch` has no native icon dependency; per the
//     APIUsageWidget glyph precedent it becomes a decorative Unicode branch
//     glyph (⎇ U+2387) in an `AppText` with `importantForAccessibility="no"`
//     (the shell title / empty message carries the accessible meaning). `h-3.5
//     w-3.5` (14px) -> fontSize 14 in the title accent (web `text-cyan-400` ->
//     the accent token so the cyan tint actually applies); `h-5 w-5` (20px) ->
//     fontSize 20 muted in the empty state.
//   - The recharts donut (`PieChart`, `Pie`, `Cell`, `Tooltip`,
//     `ResponsiveContainer` with innerRadius 55% / outerRadius 80% /
//     paddingAngle 2) is DOM/SVG-only (no react-native-svg in this app, per the
//     Spinner port). It is reimplemented as a native `DistributionBar`: a
//     horizontal segmented proportion bar whose per-state segments carry
//     `flex: seg.value` (preserving the donut's proportional encoding + the
//     value-desc segment order) coloured by `stateColor`, with the paddingAngle
//     gap as a 2px row gap and rounded ends standing in for the ring. The
//     `<Tooltip content={<DonutTooltip/>}>` hover affordance has no native
//     pointer analogue, so its state · duration · pct body is preserved as the
//     bar's accessible summary label instead.
//   - `@/components/ui` `Badge variant="neutral"` (the transition from/to chips)
//     -> a native pill View (surfaceRaised bg, secondary text, `capitalize` ->
//     a single-line label, `max-w-[72px]` retained) since there is no native
//     Badge dependency.
//   - `@/components/data-display` `TimeStamp` (the transition time) -> an inline
//     native-safe relative formatter mirroring web @/lib/dateFormat
//     `formatRelative` ('just now' / `Xm ago` / `Xh ago` / `Xd ago` / absolute
//     date fallback), since the default `<TimeStamp>` mode is 'relative' per
//     useTimeFormatPreference's out-of-box fallback; the hover-to-flip Tooltip
//     has no native analogue and is dropped.
//   - `@/components/feedback` `EmptyState` -> a small centered View with the
//     glyph icon + muted message (`WidgetEmptyState`).
//   - `@/lib/numberFormat` `fmtNumber` / `fmtInt` are inlined as native-safe
//     formatters mirroring the web module (locale-aware `toLocaleString`, the
//     out-of-box precision-2 / en-US defaults; `fmtInt` = `fmtNumber(v, 0)`).
//   - `WidgetShell` (web: a transparent flex container with `Skeleton` loading
//     + `QueryError` error + a `DataFreshness` header affordance) is inlined on
//     a `GlassPanel`: loading -> a centered `Spinner`, error -> centered danger
//     text, otherwise an optional uppercase title row + a compact freshness
//     control (status dot coloured by isError/isStale/isFetching + a refresh
//     Pressable wired to `refetch`) over the children — identical to the
//     APIUsageWidget / BatteryDegradationTrendWidget ports. `WidgetProps`
//     (./types) -> a local interface mirroring it (WidgetSize {cols, rows}).

import React, {useCallback, useMemo, type ReactNode} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {useFSMStats, useFSMTransitions} from '../../../api/hooks/useFSM';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {Spinner} from '../../../components/feedback/Spinner';

/* ─── i18n fallback shim ───────────────────────────────────────────────────── */

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback) => fallback, []);
}

/* ─── native-safe number formatters (mirror web @/lib/numberFormat) ─────────── */

// The web `fmtNumber` reads a module-level global precision (default 2) + locale
// (default en-US) set by useSettings; the native parity layer has no settings
// store wired in here, so we mirror the web module's out-of-box defaults.
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

function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

/* ─── native-safe relative timestamp (mirror web @/lib/dateFormat) ──────────── */

const EM_DASH = '\u2014'; // — universal placeholder

function formatDate(d: Date): string {
  try {
    return d.toLocaleDateString('en-US', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return EM_DASH;
  }
}

// Mirrors web @/lib/dateFormat formatRelative — the default <TimeStamp> mode is
// 'relative' per useTimeFormatPreference's out-of-box fallback.
function formatRelative(value: string): string {
  if (!value) {
    return EM_DASH;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return EM_DASH;
  }
  const diff = Date.now() - d.getTime();
  const seconds = Math.floor(diff / 1000);
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
  if (days < 7) {
    return `${days}d ago`;
  }
  return formatDate(d);
}

/* ─── decorative glyphs (lucide-react stand-ins) ───────────────────────────── */

const ICON_GIT_BRANCH = '\u2387'; // ⎇ branch glyph for lucide GitBranch
const GLYPH_REFRESH = '\u21BB';
const ARROW_RIGHT = '\u2192'; // → transition arrow

/* ─── state colours for the donut (verbatim from web) ──────────────────────── */

const STATE_COLORS: Record<string, string> = {
  driving: '#22d3ee', // cyan-400
  charging: '#22c55e', // green-500
  asleep: '#a855f7', // purple-500
  idle: '#f59e0b', // amber-500
  offline: '#6b7280', // gray-500
};

function stateColor(state: string): string {
  return STATE_COLORS[state.toLowerCase()] ?? '#6b7280';
}

/* ─── duration formatter (ms -> human readable) ────────────────────────────── */

function fmtDuration(ms: number, t: NativeTFunction): string {
  const totalMin = ms / 60_000;
  const hrs = Math.floor(totalMin / 60);
  const mins = Math.round(totalMin % 60);
  if (hrs === 0) {
    return `${mins}${t('widget.fsmDistribution.min', 'm')}`;
  }
  return `${hrs}${t('widget.fsmDistribution.hr', 'h')} ${mins}${t(
    'widget.fsmDistribution.min',
    'm',
  )}`;
}

/* ─── donut segment data ───────────────────────────────────────────────────── */

interface DonutSegment {
  state: string;
  value: number;
  pct: number;
}

function buildDonutData(stats: Record<string, number>): DonutSegment[] {
  const entries = Object.entries(stats).filter(([, v]) => (v ?? 0) > 0);
  const total = entries.reduce((sum, [, v]) => sum + (v ?? 0), 0);
  if (total === 0) {
    return [];
  }
  return entries
    .map(([state, value]) => ({
      state,
      value: value ?? 0,
      pct: ((value ?? 0) / total) * 100,
    }))
    .sort((a, b) => b.value - a.value);
}

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

/* ─── inlined WidgetShell (web WidgetShell.tsx) ─────────────────────────────── */

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

/* ─── inlined distribution donut (web recharts PieChart) ────────────────────── */

function DistributionBar({
  segments,
  t,
}: {
  segments: DonutSegment[];
  t: NativeTFunction;
}) {
  // web DonutTooltip surfaced `state · duration · pct` on hover; native has no
  // pointer, so the same per-segment detail becomes the bar's a11y summary.
  const summary = segments
    .map(
      seg =>
        `${t(`widget.fsmDistribution.state.${seg.state}`, seg.state)} ${fmtDuration(
          seg.value,
          t,
        )} ${fmtNumber(seg.pct, 1)}%`,
    )
    .join(', ');

  return (
    <View
      accessibilityLabel={summary}
      accessibilityRole="image"
      accessible
      style={styles.distributionBar}>
      {segments.map(seg => (
        <View
          key={seg.state}
          style={[
            styles.distributionSegment,
            {backgroundColor: stateColor(seg.state), flex: seg.value},
          ]}
        />
      ))}
    </View>
  );
}

/* ─── transition feed row (web Badge + TimeStamp) ──────────────────────────── */

function TransitionRow({
  from,
  to,
  timestamp,
  t,
}: {
  from: string;
  to: string;
  timestamp: string;
  t: NativeTFunction;
}) {
  return (
    <View style={styles.transitionRow}>
      <View style={styles.transitionLeft}>
        <View style={styles.transitionBadge}>
          <AppText
            numberOfLines={1}
            style={styles.transitionBadgeText}
            tone="secondary">
            {t(`widget.fsmDistribution.state.${from}`, from)}
          </AppText>
        </View>
        <AppText style={styles.transitionArrow} tone="muted">
          {ARROW_RIGHT}
        </AppText>
        <View style={styles.transitionBadge}>
          <AppText
            numberOfLines={1}
            style={styles.transitionBadgeText}
            tone="secondary">
            {t(`widget.fsmDistribution.state.${to}`, to)}
          </AppText>
        </View>
      </View>
      <AppText style={styles.transitionTime} tone="muted">
        {formatRelative(timestamp)}
      </AppText>
    </View>
  );
}

/* ─── the widget ───────────────────────────────────────────────────────────── */

export default function FSMDistributionWidget({vehicleId, size}: WidgetProps) {
  const t = useNativeTranslationFallback();
  const {data: vehicles} = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? null;
  const idStr = id != null ? String(id) : '';

  const statsQuery = useFSMStats(idStr);
  const transitionsQuery = useFSMTransitions(idStr, 'vehicle', 24, 1, 5);

  const isCompact = size.cols <= 1;

  const segments = useMemo(
    () => buildDonutData(statsQuery.data?.stats ?? {}),
    [statsQuery.data],
  );

  const transitions = useMemo(
    () => (transitionsQuery.data?.data ?? []).slice(0, isCompact ? 3 : 5),
    [transitionsQuery.data, isCompact],
  );

  const hasData = segments.length > 0;

  /* Freshness: merge from both queries */
  const updatedAt = Math.max(
    statsQuery.dataUpdatedAt ?? 0,
    transitionsQuery.dataUpdatedAt ?? 0,
  );
  const isFetching = statsQuery.isFetching || transitionsQuery.isFetching;
  const isStale = statsQuery.isStale || transitionsQuery.isStale;
  const isError = statsQuery.isError || transitionsQuery.isError;
  const isLoading = statsQuery.isLoading || transitionsQuery.isLoading;

  const handleRefresh = () => {
    statsQuery.refetch();
    transitionsQuery.refetch();
  };

  /* Compact view: current state badge + time in current state */
  if (isCompact) {
    const currentState = segments[0]?.state ?? EM_DASH;
    const currentMs = segments[0]?.value ?? 0;

    return (
      <WidgetShell
        isError={isError}
        isFetching={isFetching}
        isStale={isStale}
        loading={isLoading}
        onRefresh={handleRefresh}
        updatedAt={updatedAt}>
        {hasData ? (
          <View style={styles.compactBody}>
            <View
              style={[
                styles.compactDot,
                {backgroundColor: stateColor(currentState)},
              ]}
            />
            <AppText numberOfLines={1} style={styles.compactState}>
              {t(`widget.fsmDistribution.state.${currentState}`, currentState)}
            </AppText>
            <AppText style={styles.compactDuration} tone="secondary">
              {fmtDuration(currentMs, t)}
            </AppText>
          </View>
        ) : (
          <WidgetEmptyState
            icon={
              <AppText
                importantForAccessibility="no"
                style={styles.emptyIconGlyph}>
                {ICON_GIT_BRANCH}
              </AppText>
            }
            message={t('widget.fsmDistribution.noData', 'No state data')}
          />
        )}
      </WidgetShell>
    );
  }

  /* Standard (2×4) view: donut chart + transitions feed */
  return (
    <WidgetShell
      icon={
        <AppText importantForAccessibility="no" style={styles.titleIcon}>
          {ICON_GIT_BRANCH}
        </AppText>
      }
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={isLoading}
      onRefresh={handleRefresh}
      title={t('widget.fsmDistribution.title', 'State Distribution')}
      updatedAt={updatedAt}>
      {hasData ? (
        <View style={styles.standardBody}>
          {/* Donut chart -> native segmented proportion bar */}
          <DistributionBar segments={segments} t={t} />

          {/* Legend */}
          <View style={styles.legend}>
            {segments.map(seg => (
              <View key={seg.state} style={styles.legendItem}>
                <View
                  style={[
                    styles.legendDot,
                    {backgroundColor: stateColor(seg.state)},
                  ]}
                />
                <AppText style={styles.legendLabel} tone="secondary">
                  {t(`widget.fsmDistribution.state.${seg.state}`, seg.state)}
                </AppText>
                <AppText style={styles.legendPct} tone="muted">
                  {`${fmtInt(seg.pct)}%`}
                </AppText>
              </View>
            ))}
          </View>

          {/* Transitions feed */}
          {transitions.length > 0 ? (
            <View style={styles.transitionFeed}>
              <AppText style={styles.transitionHeader} tone="muted">
                {t(
                  'widget.fsmDistribution.recentTransitions',
                  'Recent Transitions',
                )}
              </AppText>
              {transitions.map(tr => (
                <TransitionRow
                  key={tr.id}
                  from={tr.from_state ?? EM_DASH}
                  t={t}
                  timestamp={tr.ts ?? ''}
                  to={tr.to_state ?? EM_DASH}
                />
              ))}
            </View>
          ) : null}
        </View>
      ) : (
        <WidgetEmptyState
          icon={
            <AppText
              importantForAccessibility="no"
              style={styles.emptyIconGlyph}>
              {ICON_GIT_BRANCH}
            </AppText>
          }
          message={t(
            'widget.fsmDistribution.noData',
            'No state data available',
          )}
        />
      )}
    </WidgetShell>
  );
}

FSMDistributionWidget.displayName = 'FSMDistributionWidget';

const styles = StyleSheet.create({
  centerFill: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    padding: spacing.md,
  },
  compactBody: {
    alignItems: 'center',
    gap: spacing.sm,
    justifyContent: 'center',
    paddingVertical: spacing.sm,
  },
  compactDot: {
    borderRadius: 6,
    height: 12,
    width: 12,
  },
  compactDuration: {
    fontSize: 12,
  },
  compactState: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  distributionBar: {
    borderRadius: 6,
    flexDirection: 'row',
    gap: 2,
    height: 16,
    overflow: 'hidden',
  },
  distributionSegment: {
    borderRadius: 3,
    height: '100%',
  },
  emptyIconGlyph: {
    color: colors.textMuted,
    fontSize: 20,
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
  legend: {
    columnGap: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    rowGap: spacing.xs,
  },
  legendDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  legendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  legendLabel: {
    fontSize: 10,
    textTransform: 'capitalize',
  },
  legendPct: {
    fontSize: 10,
    fontVariant: ['tabular-nums'],
  },
  shell: {
    borderRadius: 16,
    gap: spacing.md,
    padding: spacing.md,
  },
  standardBody: {
    gap: spacing.md,
  },
  titleIcon: {
    color: colors.accent,
    fontSize: 14,
    lineHeight: 16,
  },
  titleText: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  transitionArrow: {
    fontSize: 10,
  },
  transitionBadge: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    maxWidth: 72,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  transitionBadgeText: {
    fontSize: 10,
    textTransform: 'capitalize',
  },
  transitionFeed: {
    gap: 2,
  },
  transitionHeader: {
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  transitionLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: spacing.xs,
    minWidth: 0,
  },
  transitionRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'space-between',
    minHeight: 44,
  },
  transitionTime: {
    fontSize: 10,
    fontVariant: ['tabular-nums'],
  },
});
