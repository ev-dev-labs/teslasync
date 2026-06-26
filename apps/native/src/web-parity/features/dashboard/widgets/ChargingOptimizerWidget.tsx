// Native parity port of
// web/src/features/dashboard/widgets/ChargingOptimizerWidget.tsx.
//
// A dashboard widget that summarises the charging-optimizer analysis for a
// vehicle. In the compact (1 col) layout it collapses to the optimal start hour
// + target-SOC line + an optional monthly-savings badge (or an EmptyState when
// the API returns nothing). In the standard (2x2) layout it shows a 3-metric row
// (optimal start / target SOC / savings), a peak-usage + optimised/can-improve
// badge row, and the recommendations as tip cards; the wide (>=4 col) layout
// additionally renders a 24-hour rate timeline bar (peak / off-peak / standard
// segments with a current-start marker). When the API returns no data both
// layouts fall back to an EmptyState inside the shell (the section is never
// hidden). The shell renders the title + sparkles icon (standard/wide) and a
// query-freshness chip wired to refetch, and surfaces the loading/error states.
//
// The web original leans on browser-only / not-yet-ported infrastructure, so —
// following the established conversion idiom (BatteryHealthAnalyticsWidget /
// AutomationHistoryWidget) — every such dependency is reproduced inline with
// React Native primitives + the shared native building blocks and documented in
// the sidecar:
//
//   - WidgetShell (web .../WidgetShell.tsx) has no native port yet, so its
//     structure is inlined as `WidgetShell`: loading -> a skeleton block;
//     error -> a centred error box with a retry Pressable (mirrors the web
//     <QueryError>); otherwise either a titled header (icon + uppercase muted
//     title + freshness chip) over the children, or — when title-less (the
//     compact branch) — the children with the freshness chip overlaid top-right,
//     exactly like the web shell. Only the props this widget passes (title, icon,
//     loading, error, updatedAt, isFetching, isStale, isError, onRefresh) are
//     honoured; help/widgetId/PinButton/HelpTooltip extras are out of scope.
//   - DataFreshness (web data-display) — the 4-state (fresh/fetching/stale/error)
//     chip the shell renders — is reproduced inline as `WidgetFreshness`: same
//     isError>fetching>stale>fresh precedence, the same dot colour tiers, the
//     "just now / Nm/Nh/Nd/Nw ago" relative ladder, "updating…"/"error" labels,
//     a 30s re-render tick, and onRefresh wired to a Pressable (role=button).
//   - WidgetTipCards + TipItem (web .../shared) -> inline `WidgetTipCards` +
//     local `TipItem`: same maxTips default (compact ? 1 : 3), the same slice,
//     the same EmptyState fallback, and the per-tip card (glyph + title + impact
//     Badge + description, description line-clamped to 2 only when compact). The
//     web `icon?: ReactNode` slot becomes a native `glyph?: string`.
//   - @/components/ui Badge -> local `StatusBadge` reproducing the success /
//     warning / neutral variant tints used here (impact map + schedule-match +
//     savings badges).
//   - feedback EmptyState -> shared native EmptyState (web's single `message`
//     becomes the native `title`; the web Sparkles `icon` + `className` have no
//     native EmptyState slot and are dropped — the sparkle signal is preserved by
//     the shell header glyph).
//   - lucide-react Sparkles/Clock/BatteryCharging/DollarSign/Zap have no native
//     icon font; each is reduced to a representative glyph while the meaningful
//     signal — the exact web hex colour — is preserved verbatim: Sparkles ->
//     '\u2726' (emerald-400 header / secondary tip), Clock -> '\u23F1'
//     (emerald-400), BatteryCharging -> '\u26A1' (blue-400 #60a5fa), DollarSign
//     -> '$' (amber-400 #fbbf24), Zap -> '\u26A1' (emerald-300 #6ee7b7 timeline
//     marker).
//   - @/lib/numberFormat fmtNumber/fmtInt are inlined verbatim (safeNumber
//     guard, default precision 2, en-US grouping) without useSettings-driven
//     global precision/locale wiring.
//   - @/lib/cn is dropped — RN uses StyleSheet, so the timeline segment colour is
//     selected imperatively (off-peak wins over peak when both, matching
//     Tailwind's emerald-after-red cascade) instead of via cn() class merging.
//   - WidgetProps (web .../types.ts) -> local `WidgetProps`/`WidgetSize` (only
//     `vehicleId` + `size.cols` are read here).
//   - react-i18next useTranslation('dashboard') -> a native English-default `t`
//     that keeps every widget.chargingOptimizer.* / freshness.* key + the
//     {{var}} interpolation intact.
//
// The data hooks are called unchanged: useChargingOptimizer(vehicleIdStr) and
// useVehicles() via the native web-parity hooks, so the API paths
// (/analytics/charging-optimizer?vehicle_id=…, /vehicles), the snake_case fields
// (current_schedule.most_common_start_hour/avg_charge_to_pct,
// cost_analysis.potential_monthly_savings/sessions_during_peak_pct/offpeak_hours/
// peak_hours, recommendations[].title/detail/priority), and refetch semantics are
// preserved. State names (data, isLoading, error, isFetching, isStale, isError,
// dataUpdatedAt, refetch, vid, vehicleIdStr, isCompact, isWide, schedule,
// costAnalysis, recommendations, optimalStartHour, targetSoc, monthlySavings,
// peakPct, offpeakHours, peakHours, scheduleMatchesOptimal, tips, shellProps) are
// preserved. No DOM, react-router, framer-motion, lucide-react, Recharts,
// Leaflet, or old web UI components are imported.

import React, {useEffect, useMemo, useState} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {useChargingOptimizer} from '../../../api/hooks/useCharging';
import {useVehicles} from '../../../api/hooks/useVehicles';

/* ─── i18n fallback (mirrors i18next default-value + {{var}} interpolation) ─── */

type TVars = Record<string, string | number>;

// react-i18next is not wired in native; i18next returns the supplied English
// default when a translation is missing, so this fallback returns that default
// while keeping every widget.chargingOptimizer.* / freshness.* key verbatim and
// applying the same {{var}} interpolation as the web `t`.
function t(key: string, fallback: string, vars?: TVars): string {
  let out = fallback ?? key;
  if (vars) {
    for (const varKey of Object.keys(vars)) {
      out = out.split(`{{${varKey}}}`).join(String(vars[varKey]));
    }
  }
  return out;
}

/* ─── Inlined formatters (web @/lib/numberFormat) ─────────────────────────── */

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// web fmtNumber — locale-grouped, fixed precision. The web global precision
// defaults to 2 (set by useSettings, which native does not wire), so 2 is the
// faithful unconfigured default.
function fmtNumber(v: unknown, decimals = 2): string {
  return safeNumber(v).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// web fmtInt — integer with locale separators.
function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

/* ─── formatHour (web .../ChargingOptimizerWidget formatHour) ─────────────── */

// web parity: 0/24 -> "12 AM", 12 -> "12 PM", <12 -> "{h} AM", else "{h-12} PM".
function formatHour(hour: number): string {
  if (hour === 0 || hour === 24) {
    return '12 AM';
  }
  if (hour === 12) {
    return '12 PM';
  }
  return hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
}

/* ─── Widget contract types (web .../types.ts subset) ─────────────────────── */

interface WidgetSize {
  cols: number;
  rows: number;
}

export interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: Record<string, unknown>;
}

/* ─── TipItem (web .../shared WidgetTipCards TipItem) ─────────────────────── */

interface TipItem {
  id: string | number;
  glyph?: string;
  title: string;
  description: string;
  impact?: 'high' | 'medium' | 'low';
  impactLabel?: string;
}

// web PRIORITY_IMPACT — identity map high/medium/low.
const PRIORITY_IMPACT: Record<string, 'high' | 'medium' | 'low'> = {
  high: 'high',
  medium: 'medium',
  low: 'low',
};

// web WidgetTipCards.impactBadgeMap — high->success, medium->warning, low->neutral.
const IMPACT_BADGE_MAP = {
  high: 'success',
  medium: 'warning',
  low: 'neutral',
} as const;

/* ─── StatusBadge (web @/components/ui Badge: success/warning/neutral) ─────── */

type BadgeVariant = 'success' | 'warning' | 'neutral';

const BADGE_TINTS: Record<BadgeVariant, {bg: string; color: string}> = {
  success: {bg: colors.successSurface, color: colors.success},
  warning: {bg: colors.warningSurface, color: colors.warning},
  neutral: {bg: colors.surfaceRaised, color: colors.textSecondary},
};

function StatusBadge({
  variant,
  children,
  testID,
}: {
  variant: BadgeVariant;
  children: string;
  testID?: string;
}) {
  const tint = BADGE_TINTS[variant];
  return (
    <View style={[styles.badge, {backgroundColor: tint.bg}]} testID={testID}>
      <AppText
        variant="caption"
        weight="semibold"
        numberOfLines={1}
        style={[styles.badgeText, {color: tint.color}]}>
        {children}
      </AppText>
    </View>
  );
}

/* ─── WidgetFreshness (web data-display DataFreshness 4-state chip) ────────── */

type FreshnessStatus = 'fresh' | 'fetching' | 'stale' | 'error';

// web FRESHNESS_COLORS dot tiers (emerald-400 / sky-400 / amber-400 / red-400).
const FRESHNESS_DOT: Record<FreshnessStatus, string> = {
  fresh: '#34d399',
  fetching: '#38bdf8',
  stale: '#fbbf24',
  error: '#f87171',
};

// web DataFreshness.formatRelativeTime — minute/hour/day/week relative ladder.
function formatFreshnessRelative(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) {
    return t('freshness.justNow', 'just now');
  }
  if (seconds < 3600) {
    return t('freshness.minutes', '{{m}}m ago', {m: Math.floor(seconds / 60)});
  }
  if (seconds < 86_400) {
    return t('freshness.hours', '{{h}}h ago', {h: Math.floor(seconds / 3600)});
  }
  if (seconds < 604_800) {
    return t('freshness.days', '{{d}}d ago', {d: Math.floor(seconds / 86_400)});
  }
  return t('freshness.weeks', '{{w}}w ago', {w: Math.floor(seconds / 604_800)});
}

function useThirtySecondTick(active: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) {
      return;
    }
    const id = setInterval(() => setTick(n => n + 1), 30_000);
    return () => clearInterval(id);
  }, [active]);
}

function WidgetFreshness({
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
}: {
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
}) {
  useThirtySecondTick(!!updatedAt && updatedAt > 0);

  const status: FreshnessStatus = isError
    ? 'error'
    : isFetching
      ? 'fetching'
      : isStale
        ? 'stale'
        : 'fresh';

  const relativeTime =
    updatedAt && updatedAt > 0 && !isFetching
      ? formatFreshnessRelative(updatedAt)
      : isFetching
        ? t('freshness.updating', 'updating\u2026')
        : isError
          ? t('freshness.error', 'error')
          : '';

  const refreshable = !!onRefresh && !isFetching;

  return (
    <Pressable
      accessibilityRole={onRefresh ? 'button' : 'text'}
      accessibilityLabel={
        onRefresh
          ? t('freshness.refresh', 'Refresh')
          : t('a11y.dataFreshness', 'Data freshness: {{state}}', {state: status})
      }
      accessibilityState={{disabled: !refreshable}}
      disabled={!refreshable}
      onPress={() => {
        if (refreshable) {
          onRefresh?.();
        }
      }}
      testID="charging-optimizer-freshness"
      style={styles.freshness}>
      <View
        style={[styles.freshnessDot, {backgroundColor: FRESHNESS_DOT[status]}]}
        testID="charging-optimizer-freshness-dot"
      />
      {relativeTime ? (
        <AppText
          variant="caption"
          tone="muted"
          numberOfLines={1}
          style={styles.freshnessLabel}>
          {relativeTime}
        </AppText>
      ) : null}
    </Pressable>
  );
}

/* ─── WidgetShell (web .../WidgetShell.tsx subset) ────────────────────────── */

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
}: {
  title?: string;
  icon?: React.ReactNode;
  loading?: boolean;
  error?: string | null;
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
  children: React.ReactNode;
}) {
  if (loading) {
    return <View style={styles.skeleton} testID="charging-optimizer-loading" />;
  }

  if (error) {
    return (
      <View style={styles.errorBox} testID="charging-optimizer-error">
        <AppText tone="danger" weight="semibold" numberOfLines={3}>
          {error}
        </AppText>
        {onRefresh ? (
          <Pressable
            accessibilityRole="button"
            onPress={onRefresh}
            testID="charging-optimizer-error-retry">
            <AppText variant="caption" tone="accent">
              {t('common.retry', 'Retry')}
            </AppText>
          </Pressable>
        ) : null}
      </View>
    );
  }

  const freshness = (
    <WidgetFreshness
      updatedAt={updatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={onRefresh}
    />
  );

  // Title-less widgets (the compact branch) overlay the freshness chip in the
  // top-right corner, exactly like the web shell.
  if (!title) {
    return (
      <View style={styles.shell} testID="charging-optimizer-widget">
        <View style={styles.freshnessOverlay}>{freshness}</View>
        <View style={styles.shellBody}>{children}</View>
      </View>
    );
  }

  return (
    <View style={styles.shell} testID="charging-optimizer-widget">
      <View style={styles.shellHeader}>
        <View style={styles.shellTitleRow}>
          {icon}
          <AppText
            accessibilityRole="header"
            numberOfLines={1}
            style={styles.shellTitle}>
            {title}
          </AppText>
        </View>
        {freshness}
      </View>
      <View style={styles.shellBody}>{children}</View>
    </View>
  );
}

/* ─── SparklesGlyph (web header lucide Sparkles, text-emerald-400) ─────────── */

function SparklesGlyph({style}: {style?: StyleProp<ViewStyle>}) {
  return (
    <View style={[styles.sparkleGlyph, style]} accessibilityElementsHidden>
      <AppText variant="caption" weight="bold" style={styles.sparkleGlyphText}>
        {'\u2726'}
      </AppText>
    </View>
  );
}

/* ─── MetricTile (web .../ChargingOptimizerWidget key-metric tile) ────────── */

function MetricTile({
  glyph,
  glyphColor,
  value,
  label,
  testID,
}: {
  glyph: string;
  glyphColor: string;
  value: string;
  label: string;
  testID?: string;
}) {
  return (
    <View style={styles.metricTile} testID={testID}>
      <AppText
        variant="caption"
        weight="bold"
        accessibilityElementsHidden
        style={[styles.metricGlyph, {color: glyphColor}]}>
        {glyph}
      </AppText>
      <AppText weight="semibold" numberOfLines={1} style={styles.metricValue}>
        {value}
      </AppText>
      <AppText
        variant="caption"
        tone="muted"
        numberOfLines={1}
        style={styles.metricLabel}>
        {label}
      </AppText>
    </View>
  );
}

/* ─── WidgetTipCards (web .../shared WidgetTipCards) ──────────────────────── */

function WidgetTipCards({
  tips,
  maxTips,
  compact = false,
  emptyMessage,
}: {
  tips: TipItem[];
  maxTips?: number;
  compact?: boolean;
  emptyMessage?: string;
}) {
  const limit = maxTips ?? (compact ? 1 : 3);
  const visible = useMemo(() => tips.slice(0, limit), [tips, limit]);

  if (visible.length === 0) {
    return (
      <View testID="charging-optimizer-tips-empty">
        <EmptyState
          title={emptyMessage ?? t('widget.chargingOptimizer.noRecommendations', 'No recommendations')}
          message=""
        />
      </View>
    );
  }

  return (
    <View style={styles.tips} testID="charging-optimizer-tips">
      {visible.map(tip => (
        <View key={tip.id} style={styles.tipCard} testID={`charging-optimizer-tip-${tip.id}`}>
          {tip.glyph ? (
            <AppText
              variant="caption"
              weight="bold"
              accessibilityElementsHidden
              style={styles.tipGlyph}>
              {tip.glyph}
            </AppText>
          ) : null}
          <View style={styles.tipBody}>
            <View style={styles.tipHeader}>
              <AppText numberOfLines={2} style={styles.tipTitle}>
                {tip.title}
              </AppText>
              {tip.impact ? (
                <StatusBadge variant={IMPACT_BADGE_MAP[tip.impact]}>
                  {tip.impactLabel ?? tip.impact}
                </StatusBadge>
              ) : null}
            </View>
            <AppText
              variant="caption"
              tone="secondary"
              numberOfLines={compact ? 2 : undefined}
              style={styles.tipDesc}>
              {tip.description}
            </AppText>
          </View>
        </View>
      ))}
    </View>
  );
}

/* ─── RateTimeline (web .../ChargingOptimizerWidget 24h rate bar, wide only) ─ */

function RateTimeline({
  optimalStartHour,
  peakHours,
  offpeakHours,
}: {
  optimalStartHour: number;
  peakHours: number[];
  offpeakHours: number[];
}) {
  return (
    <View style={styles.timeline} testID="charging-optimizer-timeline">
      <AppText
        variant="caption"
        tone="muted"
        numberOfLines={1}
        style={styles.timelineHeading}>
        {t('widget.chargingOptimizer.rateTimeline', '24h Rate Timeline')}
      </AppText>
      <View style={styles.timelineBar}>
        {Array.from({length: 24}, (_, h) => {
          const isPeak = peakHours.includes(h);
          const isOffpeak = offpeakHours.includes(h);
          const isCurrentStart = h === optimalStartHour;
          // Off-peak wins over peak when both (Tailwind emerald-after-red cascade).
          const segColor = isOffpeak
            ? styles.timelineSegOffpeak
            : isPeak
              ? styles.timelineSegPeak
              : styles.timelineSegStandard;
          const tierLabel = isPeak
            ? t('widget.chargingOptimizer.peak', 'Peak')
            : isOffpeak
              ? t('widget.chargingOptimizer.offpeak', 'Off-peak')
              : t('widget.chargingOptimizer.standard', 'Standard');
          return (
            <View
              key={h}
              style={[styles.timelineSeg, segColor]}
              accessibilityLabel={`${formatHour(h)} \u2014 ${tierLabel}`}>
              {isCurrentStart ? (
                <View style={styles.timelineMarker}>
                  <AppText
                    variant="caption"
                    weight="bold"
                    accessibilityElementsHidden
                    style={styles.timelineMarkerGlyph}>
                    {'\u26A1'}
                  </AppText>
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
      <View style={styles.timelineLabels}>
        <AppText variant="caption" tone="muted" style={styles.timelineTick}>
          12 AM
        </AppText>
        <AppText variant="caption" tone="muted" style={styles.timelineTick}>
          6 AM
        </AppText>
        <AppText variant="caption" tone="muted" style={styles.timelineTick}>
          12 PM
        </AppText>
        <AppText variant="caption" tone="muted" style={styles.timelineTick}>
          6 PM
        </AppText>
        <AppText variant="caption" tone="muted" style={styles.timelineTick}>
          12 AM
        </AppText>
      </View>
    </View>
  );
}

/* ─── ChargingOptimizerWidget ─────────────────────────────────────────────── */

export default function ChargingOptimizerWidget({vehicleId, size}: WidgetProps) {
  const {data: vehicles} = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const vehicleIdStr = vid != null ? String(vid) : null;

  const {
    data,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useChargingOptimizer(vehicleIdStr);

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 4;

  const schedule = data?.current_schedule;
  const costAnalysis = data?.cost_analysis;
  // web: `const recommendations = data?.recommendations ?? []` — wrapped in
  // useMemo so the `??` array literal keeps a stable reference for the `tips`
  // useMemo deps (native react-hooks/exhaustive-deps), behaviour unchanged.
  const recommendations = useMemo(
    () => data?.recommendations ?? [],
    [data?.recommendations],
  );

  const optimalStartHour = schedule?.most_common_start_hour ?? 0;
  const targetSoc = schedule?.avg_charge_to_pct ?? 0;
  const monthlySavings = costAnalysis?.potential_monthly_savings ?? 0;
  const peakPct = costAnalysis?.sessions_during_peak_pct ?? 0;
  const offpeakHours = costAnalysis?.offpeak_hours ?? [];
  const peakHours = costAnalysis?.peak_hours ?? [];

  const scheduleMatchesOptimal = peakPct < 30;

  const tips: TipItem[] = useMemo(
    () =>
      recommendations.map((rec, i) => ({
        id: i,
        glyph: '\u2726',
        title: rec.title ?? '\u2014',
        description: rec.detail ?? '\u2014',
        impact: PRIORITY_IMPACT[rec.priority] ?? undefined,
        impactLabel: rec.priority
          ? t(`widget.chargingOptimizer.priority.${rec.priority}`, rec.priority)
          : undefined,
      })),
    [recommendations],
  );

  const shellProps = {
    loading: isLoading,
    error: error ? String(error) : null,
    updatedAt: dataUpdatedAt,
    isFetching,
    isStale,
    isError,
    onRefresh: () => refetch(),
  };

  // ── Compact (1 col) ──
  if (isCompact) {
    return (
      <WidgetShell
        {...shellProps}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={() => refetch()}>
        {!data ? (
          <View style={styles.compactInner} testID="charging-optimizer-empty">
            <EmptyState
              title={t('widget.chargingOptimizer.noData', 'No optimizer data')}
              message=""
            />
          </View>
        ) : (
          <View style={styles.compactContent} testID="charging-optimizer-compact">
            <View style={styles.compactStartRow}>
              <AppText
                variant="caption"
                weight="bold"
                accessibilityElementsHidden
                style={styles.compactClock}>
                {'\u23F1'}
              </AppText>
              <AppText weight="bold" style={styles.compactStart}>
                {formatHour(optimalStartHour)}
              </AppText>
            </View>
            <AppText variant="caption" tone="secondary" style={styles.compactSoc}>
              {t('widget.chargingOptimizer.targetSocShort', 'SOC {{pct}}%', {
                pct: fmtInt(targetSoc),
              })}
            </AppText>
            {monthlySavings > 0 ? (
              <StatusBadge variant="success" testID="charging-optimizer-compact-savings">
                {t('widget.chargingOptimizer.savingsShort', '${{amount}}/mo', {
                  amount: fmtNumber(monthlySavings, 0),
                })}
              </StatusBadge>
            ) : null}
          </View>
        )}
      </WidgetShell>
    );
  }

  // ── Standard (2×2) and Wide (2×4+) ──
  return (
    <WidgetShell
      title={t('widget.chargingOptimizer.title', 'Charging Optimizer')}
      icon={<SparklesGlyph />}
      {...shellProps}>
      {!data ? (
        <View style={styles.compactInner} testID="charging-optimizer-empty">
          <EmptyState
            title={t('widget.chargingOptimizer.noData', 'No optimizer data')}
            message=""
          />
        </View>
      ) : (
        <View style={styles.content}>
          {/* Key metrics row */}
          <View style={styles.metricsRow}>
            <MetricTile
              glyph={'\u23F1'}
              glyphColor="#34d399"
              value={formatHour(optimalStartHour)}
              label={t('widget.chargingOptimizer.optimalStart', 'Optimal start')}
              testID="charging-optimizer-metric-start"
            />
            <MetricTile
              glyph={'\u26A1'}
              glyphColor="#60a5fa"
              value={`${fmtInt(targetSoc)}%`}
              label={t('widget.chargingOptimizer.targetSoc', 'Target SOC')}
              testID="charging-optimizer-metric-soc"
            />
            <MetricTile
              glyph={'$'}
              glyphColor="#fbbf24"
              value={`$${fmtNumber(monthlySavings, 0)}`}
              label={t('widget.chargingOptimizer.savingsLabel', 'Savings/mo')}
              testID="charging-optimizer-metric-savings"
            />
          </View>

          {/* Schedule match badge */}
          <View style={styles.scheduleRow}>
            <AppText
              variant="caption"
              tone="secondary"
              numberOfLines={1}
              style={styles.scheduleLabel}>
              {t('widget.chargingOptimizer.peakUsage', 'Peak charging: {{pct}}%', {
                pct: fmtInt(peakPct),
              })}
            </AppText>
            <StatusBadge
              variant={scheduleMatchesOptimal ? 'success' : 'warning'}
              testID="charging-optimizer-schedule-badge">
              {scheduleMatchesOptimal
                ? t('widget.chargingOptimizer.optimized', 'Optimized')
                : t('widget.chargingOptimizer.canImprove', 'Can improve')}
            </StatusBadge>
          </View>

          {/* Wide mode: 24h timeline bar */}
          {isWide ? (
            <RateTimeline
              optimalStartHour={optimalStartHour}
              peakHours={peakHours}
              offpeakHours={offpeakHours}
            />
          ) : null}

          {/* Recommendations as tip cards */}
          <View style={styles.tipsWrap}>
            <WidgetTipCards
              tips={tips}
              maxTips={isWide ? 5 : 3}
              compact={false}
              emptyMessage={t(
                'widget.chargingOptimizer.noRecommendations',
                'No recommendations',
              )}
            />
          </View>
        </View>
      )}
    </WidgetShell>
  );
}

ChargingOptimizerWidget.displayName = 'ChargingOptimizerWidget';

const styles = StyleSheet.create({
  shell: {
    flex: 1,
  },
  shellHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  shellTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 6,
    flexShrink: 1,
  },
  shellTitle: {
    flexShrink: 1,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '500',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  shellBody: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  freshnessOverlay: {
    position: 'absolute',
    top: 6,
    right: 6,
    zIndex: 5,
  },
  skeleton: {
    flex: 1,
    minHeight: 96,
    borderRadius: 12,
    backgroundColor: colors.surfaceRaised,
  },
  errorBox: {
    flex: 1,
    minHeight: 96,
    alignItems: 'center',
    justifyContent: 'center',
    rowGap: spacing.sm,
    padding: spacing.md,
  },
  freshness: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 4,
    flexShrink: 0,
  },
  freshnessDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  freshnessLabel: {
    fontSize: 10,
    lineHeight: 14,
  },
  sparkleGlyph: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  sparkleGlyphText: {
    color: colors.success,
  },
  badge: {
    flexShrink: 1,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 999,
  },
  badgeText: {
    fontSize: 11,
    lineHeight: 15,
  },
  content: {
    flex: 1,
    minHeight: 0,
    rowGap: spacing.md,
  },
  compactInner: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactContent: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    rowGap: spacing.sm,
  },
  compactStartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 6,
  },
  compactClock: {
    color: '#34d399',
  },
  compactStart: {
    fontSize: 18,
    lineHeight: 24,
    color: colors.textPrimary,
  },
  compactSoc: {
    fontSize: 12,
    lineHeight: 16,
  },
  metricsRow: {
    flexDirection: 'row',
    columnGap: spacing.sm,
  },
  metricTile: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    rowGap: 4,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  metricGlyph: {
    fontSize: 14,
    lineHeight: 18,
  },
  metricValue: {
    fontSize: 14,
    lineHeight: 18,
    color: colors.textPrimary,
  },
  metricLabel: {
    fontSize: 10,
    lineHeight: 14,
    maxWidth: '100%',
  },
  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: spacing.sm,
  },
  scheduleLabel: {
    flexShrink: 1,
    fontSize: 12,
    lineHeight: 16,
  },
  timeline: {
    rowGap: 4,
  },
  timelineHeading: {
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  timelineBar: {
    flexDirection: 'row',
    height: 24,
    borderRadius: 6,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  timelineSeg: {
    flex: 1,
    position: 'relative',
  },
  timelineSegPeak: {
    backgroundColor: 'rgba(239, 68, 68, 0.3)',
  },
  timelineSegOffpeak: {
    backgroundColor: 'rgba(16, 185, 129, 0.3)',
  },
  timelineSegStandard: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  timelineMarker: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineMarkerGlyph: {
    fontSize: 11,
    lineHeight: 13,
    color: '#6ee7b7',
  },
  timelineLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  timelineTick: {
    fontSize: 10,
    lineHeight: 14,
  },
  tipsWrap: {
    flex: 1,
    minHeight: 0,
  },
  tips: {
    flex: 1,
    rowGap: spacing.sm,
  },
  tipCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    columnGap: spacing.md,
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    padding: spacing.md,
  },
  tipGlyph: {
    marginTop: 2,
    color: colors.textSecondary,
  },
  tipBody: {
    flex: 1,
    minWidth: 0,
    rowGap: 2,
  },
  tipHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    columnGap: spacing.sm,
  },
  tipTitle: {
    flex: 1,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  tipDesc: {
    fontSize: 12,
    lineHeight: 17,
  },
});
