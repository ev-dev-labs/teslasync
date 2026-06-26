// Native parity port of
// web/src/features/dashboard/widgets/BatteryDegradationForecastWidget.tsx.
//
// `BatteryDegradationForecastWidget` is a dashboard widget that forecasts
// battery degradation for the active vehicle. It has two layouts driven by
// `size.cols`:
//   - compact (cols <= 1): the big current-health % + a health-tier Badge.
//   - standard: a scrollable column with (1) a "Projected 80% Capacity" hero
//     (projected date + tier Badge + −rate/mo), (2) a Current Health StatCard,
//     (3) a Risk Factors list (≤5 rows, each an icon + label/detail + score
//     Badge), and (4) a Recommendations section rendered as tip cards.
//   - When neither current health nor a projected date exists, an EmptyState
//     replaces the body for BOTH layouts.
//
// Behaviour preserved 1:1 with the web source (conversion rule 3): the
// `id`/`idStr` vehicle resolution (`vehicleId ?? vehicles?.[0]?.id ?? null`,
// then `id != null ? String(id) : null`), the destructured `useBatteryDegradation`
// query result, `isCompact = size.cols <= 1`, `rate = data?.degradation_rate_pct_per_month
// ?? 0`, the memoized `tier = healthTier(rate)`, `currentHealthPct =
// data?.current_health_pct ?? data?.current_health ?? null`, the `projectedDate`
// derivation (Intl month/year format of `data.projected_80pct_date` else '—'),
// `riskFactors = data?.risk_factors ?? []`, the memoized `tipItems`
// (recommendations mapped to TipItem with the exact id/icon/title/description/
// impact:'medium'/impactLabel shape), `hasData`, and every render branch incl.
// the `riskFactors.slice(0, 5)` cap, the score→Badge ternary, and the
// `WidgetTipCards maxTips={3}`. Every i18n key + English default and every API
// field name (degradation_rate_pct_per_month, current_health_pct,
// current_health, projected_80pct_date, risk_factors[name/label/detail/score],
// recommendations) is kept verbatim. The module-level helpers `riskIcon`,
// `healthTier`, and `scoreToImpact` are ported with identical logic.
//
// Web/DOM-only dependencies with no native parity surface are mapped to
// native-safe equivalents and documented (conversion rules 4/5/7):
//   - react-i18next `useTranslation('dashboard')` (L2) -> a local fallback
//     resolver returning the inline English string (it also interpolates
//     `{{name}}`-style placeholders from the options arg, mirroring the
//     AnomalyDetectorWidget shim shape); none of this widget's keys use
//     placeholders. The namespace arg is accepted + ignored.
//   - lucide-react `TrendingDown` / `AlertTriangle` / `Lightbulb` / `Zap` /
//     `Thermometer` / `Battery` (L3) -> there is no `react-native-svg`
//     dependency in the native app, so each renders a decorative glyph stand-in
//     via `<GlyphIcon>` (the AnomalyDetectorWidget / AutomationCard glyph
//     precedent): TrendingDown -> "📉", AlertTriangle -> "⚠️", Lightbulb ->
//     "💡", Zap -> "⚡", Thermometer -> "🌡️", Battery -> "🔋". The widget header
//     icon keeps `text-neon-amber` (#f59e0b); the risk/tip icons inherit the
//     web parent span colour `var(--text-secondary)` (textSecondary token); the
//     colourless empty-state icon takes the muted token to match the web
//     `EmptyState` icon styling.
//   - `@/components/ui` `Badge` (L4) -> the converted web-parity `Badge` port
//     (variant success/warning/danger, size="sm").
//   - `@/components/data-display` `StatCard` (L5) -> not yet ported, so the
//     label+value subset this widget consumes is reproduced locally as
//     `<LocalStatCard>` (a `var(--surface-1)`/`--glass-border` card with a
//     text-sm muted label over a text-2xl bold value; the unused icon/trend/
//     sublabel/unit/loading StatCard affordances are documented + omitted).
//   - `@/components/feedback` `EmptyState` (L6) -> not yet ported, so its
//     icon+message rendering is reproduced locally as `<LocalEmptyState>`
//     (centred glyph + muted message). The web "no-action transient empty state"
//     intent is preserved.
//   - `@/api/hooks/useEnergy` `useBatteryDegradation` (L7) + `@/api/hooks/
//     useVehicles` `useVehicles` (L8) -> the converted web-parity parity hooks
//     of the same names (real TanStack Query, same /analytics/battery-degradation
//     + /vehicles paths).
//   - `@/lib/numberFormat` `fmtNumber` (L9) -> inlined native-safe equivalent
//     (+ its `safeNumber` dep): nullish/non-finite -> 0, en-US locale, the
//     per-call precision arg honoured (1 dp for health, 2 dp for rate, 0 for
//     score).
//   - `@/hooks/useDateFormat` `useDateFormat` (L10) -> a local shim exposing the
//     `{ locale }` used for the projected-date format. The web locale comes from
//     `useSettings()`; there is no native settings/locale port yet, so it
//     resolves to the 'en-US' default (matching the English i18n fallback
//     shim's philosophy). The actual `Intl.DateTimeFormat(locale, { year, month })`
//     call is preserved (with a manual `MMM YYYY` fallback if Intl is
//     unavailable on the engine). Documented in the sidecar.
//   - `./WidgetShell` `WidgetShell` (L11) -> reproduced locally as a native
//     `<WidgetShell>` (sibling module not yet ported, same self-contained
//     approach as the AnomalyDetectorWidget port): loading -> skeleton block,
//     error -> centred danger text (surfaced, never hidden), title+icon header,
//     the freshness chip via the converted web-parity `DataFreshness` port, and
//     the children body. The web pulse-on-data-change box-shadow glow is a CSS
//     affordance with no native analog and is intentionally omitted (documented
//     in the sidecar); the help-tooltip / pin-button header slots are unused by
//     this widget and are not modeled.
//   - `./shared` `WidgetTipCards` + `TipItem` (L12) -> reproduced locally as a
//     native `<WidgetTipCards>` (sibling not yet ported): the maxTips/compact
//     slice, the impact->Badge variant map, and the icon + title + impact Badge +
//     (optionally clamped) description card layout, falling back to
//     `<LocalEmptyState>`. Its list root is a `View` (not a ScrollView) because
//     it is nested inside the standard layout's single outer ScrollView —
//     avoiding a same-axis nested scroll (RN best practice). The web
//     `overflow-y-auto` and the risk list's `max-h-40 overflow-y-auto` are
//     likewise subsumed by that single outer ScrollView. Documented in the
//     sidecar.
//   - `./types` `WidgetProps` (L13) -> the `WidgetProps` / `WidgetSize` /
//     `WidgetConfig` subset is reproduced + exported locally so this widget and
//     any future native consumer agree on the shape.
//
// Tailwind spacing -> px (1 unit = 4px); `tabular-nums` -> `fontVariant:
// ['tabular-nums']`; var(--text-*) -> the theme tokens so the light/dark cascade
// is preserved at the token boundary.

import React, { useMemo, type ReactNode } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import { AppText } from '../../../../components/ui/AppText';
import { colors, spacing } from '../../../../theme/tokens';
import { Badge, type BadgeVariant } from '../../../components/ui/Badge';
import { DataFreshness } from '../../../components/data-display/DataFreshness';
import { useBatteryDegradation } from '../../../api/hooks/useEnergy';
import { useVehicles } from '../../../api/hooks/useVehicles';

// ── i18n shim ───────────────────────────────────────────────────────────────
// react-i18next has no native parity module; translations resolve to their
// inline English fallback. `{{name}}` placeholders are interpolated from the
// options arg for parity with the other widget ports (none of this widget's
// keys use placeholders). The hook shape mirrors the web
// `const { t } = useTranslation('dashboard')` so the component body is unchanged.
type TOptions = Record<string, string | number>;
type TFunc = (key: string, fallback: string, options?: TOptions) => string;

function useTranslation(_namespace?: string): { t: TFunc } {
  return {
    t: (_key, fallback, options) => {
      if (!options) {
        return fallback;
      }
      return fallback.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
        options[name] != null ? String(options[name]) : match,
      );
    },
  };
}

// ── useDateFormat shim (web @/hooks/useDateFormat) ───────────────────────────
// The web hook derives `locale` from `useSettings()`. There is no native
// settings/locale port yet, so it resolves to the 'en-US' default — matching
// the English i18n fallback shim. Only `locale` is consumed by this widget.
function useDateFormat(): { locale: string } {
  return { locale: 'en-US' };
}

// ── Inlined `@/lib/numberFormat` (safeNumber / fmtNumber) ────────────────────
// Locale-aware formatting matching the web helper: nullish/non-finite input
// coerces to 0, en-US locale, the per-call precision arg is honoured.
function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals = 2): string {
  return safeNumber(v).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// ── Type reproductions (web ./types) ─────────────────────────────────────────
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

// ── Type reproduction (web ./shared `TipItem`) ───────────────────────────────
export interface TipItem {
  id: string | number;
  icon?: ReactNode;
  title: string;
  description: string;
  impact?: 'high' | 'medium' | 'low';
  impactLabel?: string;
}

// ── lucide glyph stand-ins ───────────────────────────────────────────────────
const NEON_AMBER = '#f59e0b'; // text-neon-amber
const TRENDING_DOWN = '📉';
const ALERT_TRIANGLE = '⚠️';
const LIGHTBULB = '💡';
const ZAP = '⚡';
const THERMOMETER = '🌡️';
const BATTERY = '🔋';

function GlyphIcon({
  glyph,
  color,
  size,
}: {
  glyph: string;
  color: string;
  size: number;
}) {
  const glyphStyle: StyleProp<TextStyle> = {
    color,
    fontSize: size,
    lineHeight: size,
  };
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={glyphStyle}
    >
      {glyph}
    </AppText>
  );
}

// ── Module-level helpers (ported verbatim) ───────────────────────────────────
/** Map risk factor name to an icon for display. */
function riskIcon(name: string): ReactNode {
  const lower = name.toLowerCase();
  if (
    lower.includes('temp') ||
    lower.includes('heat') ||
    lower.includes('thermal')
  ) {
    return <GlyphIcon glyph={THERMOMETER} color={colors.textSecondary} size={14} />;
  }
  if (
    lower.includes('charge') ||
    lower.includes('fast') ||
    lower.includes('dc')
  ) {
    return <GlyphIcon glyph={ZAP} color={colors.textSecondary} size={14} />;
  }
  if (
    lower.includes('battery') ||
    lower.includes('soc') ||
    lower.includes('depth')
  ) {
    return <GlyphIcon glyph={BATTERY} color={colors.textSecondary} size={14} />;
  }
  return <GlyphIcon glyph={ALERT_TRIANGLE} color={colors.textSecondary} size={14} />;
}

/** Classify degradation rate into a health tier. */
function healthTier(ratePctPerMonth: number): {
  label: string;
  variant: BadgeVariant;
  key: string;
} {
  if (ratePctPerMonth <= 0.05) {
    return { label: 'Healthy', variant: 'success', key: 'healthy' };
  }
  if (ratePctPerMonth <= 0.12) {
    return { label: 'Normal', variant: 'warning', key: 'normal' };
  }
  return { label: 'Accelerated', variant: 'danger', key: 'accelerated' };
}

/** Risk score → impact level for WidgetTipCards. */
function scoreToImpact(score: number): 'high' | 'medium' | 'low' {
  if (score >= 7) {
    return 'high';
  }
  if (score >= 4) {
    return 'medium';
  }
  return 'low';
}

// Short month names for the Intl-unavailable fallback path.
const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * Mirrors the web `new Intl.DateTimeFormat(locale, { year: 'numeric', month:
 * 'short' }).format(new Date(iso))`. Falls back to a manual `MMM YYYY` if the
 * engine lacks full Intl (native-safe, rule 7).
 */
function formatMonthYear(iso: string, locale: string): string {
  const d = new Date(iso);
  try {
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
    }).format(d);
  } catch {
    const m = SHORT_MONTHS[d.getMonth()] ?? '';
    return `${m} ${d.getFullYear()}`;
  }
}

// ── Local `EmptyState` (web @/components/feedback, icon+message) ──────────────
function LocalEmptyState({
  icon,
  message,
}: {
  icon?: ReactNode;
  message: string;
}) {
  // no-action: transient empty state — surfaces when source data is missing;
  // no specific recovery action available.
  return (
    <View style={styles.emptyState}>
      {icon ? <View style={styles.emptyIcon}>{icon}</View> : null}
      <AppText tone="muted" style={styles.emptyMessage}>
        {message}
      </AppText>
    </View>
  );
}

// ── Local `StatCard` (web @/components/data-display, label+value subset) ──────
interface LocalStatCardProps {
  label: string;
  value: string | number;
  unit?: string;
  sublabel?: string;
}

function LocalStatCard({ label, value, unit, sublabel }: LocalStatCardProps) {
  return (
    <View style={styles.statCard}>
      <View style={styles.statLabelRow}>
        <AppText style={styles.statLabel}>{label}</AppText>
      </View>
      <View style={styles.statValueRow}>
        <AppText style={styles.statValue}>{value}</AppText>
        {unit ? <AppText style={styles.statUnit}>{unit}</AppText> : null}
      </View>
      {sublabel ? <AppText style={styles.statSublabel}>{sublabel}</AppText> : null}
    </View>
  );
}

// ── Local `WidgetTipCards` (web ./shared) ────────────────────────────────────
const impactBadgeMap = {
  high: 'success',
  medium: 'warning',
  low: 'neutral',
} as const;

interface WidgetTipCardsProps {
  tips: TipItem[];
  maxTips?: number;
  compact?: boolean;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
}

function WidgetTipCards({
  tips,
  maxTips,
  compact = false,
  emptyMessage,
  emptyIcon,
}: WidgetTipCardsProps) {
  const limit = maxTips ?? (compact ? 1 : 3);

  const visible = useMemo(() => tips.slice(0, limit), [tips, limit]);

  if (visible.length === 0) {
    return (
      <LocalEmptyState
        icon={emptyIcon}
        message={emptyMessage ?? 'No recommendations'}
      />
    );
  }

  // Plain View (not a ScrollView): this list is nested inside the standard
  // layout's single outer ScrollView, so the parent owns scrolling (avoids a
  // same-axis nested scroll). Mirrors the web `space-y-2`.
  return (
    <View style={styles.tipList}>
      {visible.map(tip => (
        <View key={tip.id} style={styles.tipCard}>
          {tip.icon ? <View style={styles.tipIcon}>{tip.icon}</View> : null}

          <View style={styles.tipBody}>
            <View style={styles.tipTitleRow}>
              <AppText style={styles.tipTitle}>{tip.title}</AppText>
              {tip.impact ? (
                <Badge variant={impactBadgeMap[tip.impact]} size="sm">
                  {tip.impactLabel ?? tip.impact}
                </Badge>
              ) : null}
            </View>
            <AppText
              style={styles.tipDesc}
              numberOfLines={compact ? 2 : undefined}
            >
              {tip.description}
            </AppText>
          </View>
        </View>
      ))}
    </View>
  );
}

// ── Local `WidgetShell` (web ./WidgetShell) ──────────────────────────────────
interface WidgetShellProps {
  title?: string;
  icon?: ReactNode;
  loading?: boolean;
  error?: string | null;
  children: ReactNode;
  /** Freshness: ms timestamp from dataUpdatedAt (0 = never). */
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
}

function WidgetShell({
  title,
  icon,
  loading,
  error,
  children,
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
}: WidgetShellProps) {
  if (loading) {
    return <View accessibilityRole="progressbar" style={styles.skeleton} />;
  }
  if (error) {
    return (
      <View style={styles.errorBox}>
        <AppText tone="danger">{error}</AppText>
      </View>
    );
  }

  const showFreshness = updatedAt !== undefined;
  // Compact (dot-only) when widget has no title (typically 1×1 widgets).
  const freshnessCompact = !title;

  const freshnessEl: ReactNode = showFreshness ? (
    <DataFreshness
      updatedAt={updatedAt > 0 ? updatedAt : null}
      isFetching={isFetching ?? false}
      isStale={isStale ?? false}
      isError={isError ?? false}
      onRefresh={onRefresh}
      compact={freshnessCompact}
    />
  ) : null;

  return (
    <View style={styles.shell}>
      {title ? (
        <View style={styles.header}>
          <View style={styles.headerTitleRow}>
            {icon}
            <AppText style={styles.headerTitle}>{title}</AppText>
          </View>
          {freshnessEl}
        </View>
      ) : freshnessEl ? (
        <View style={styles.freshnessOverlay}>{freshnessEl}</View>
      ) : null}
      <View style={styles.body}>{children}</View>
    </View>
  );
}

export default function BatteryDegradationForecastWidget({
  vehicleId,
  size,
}: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? null;
  const idStr = id != null ? String(id) : null;
  const { locale } = useDateFormat();

  const {
    data,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useBatteryDegradation(idStr);

  const isCompact = size.cols <= 1;

  const rate = data?.degradation_rate_pct_per_month ?? 0;
  const tier = useMemo(() => healthTier(rate), [rate]);
  const currentHealthPct =
    data?.current_health_pct ?? data?.current_health ?? null;
  const projectedDate = data?.projected_80pct_date
    ? formatMonthYear(data.projected_80pct_date, locale)
    : '—';

  const riskFactors = data?.risk_factors ?? [];
  // Source: `const recommendations = data?.recommendations ?? []`. Wrapped in
  // useMemo so the reference is stable for the `tipItems` useMemo deps (native
  // react-hooks/exhaustive-deps treats the bare `?? []` as a per-render value);
  // behaviour is identical.
  const recommendations = useMemo(() => data?.recommendations ?? [], [data]);

  const tipItems: TipItem[] = useMemo(
    () =>
      recommendations.map((rec, idx) => ({
        id: idx,
        icon: <GlyphIcon glyph={LIGHTBULB} color={colors.textSecondary} size={14} />,
        title: t('widget.forecast.tip', 'Tip'),
        description: rec,
        impact: 'medium' as const,
        impactLabel: t('widget.forecast.recommendation', 'Recommendation'),
      })),
    [recommendations, t],
  );

  const hasData =
    currentHealthPct != null || data?.projected_80pct_date != null;

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.forecast.title', 'Battery Forecast')}
      icon={
        isCompact ? undefined : (
          <GlyphIcon glyph={TRENDING_DOWN} color={NEON_AMBER} size={14} />
        )
      }
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {hasData ? (
        isCompact ? (
          // ── Compact layout (1×2) ──
          <View style={styles.compactBody}>
            <AppText style={styles.heroValue}>
              {currentHealthPct != null
                ? `${fmtNumber(currentHealthPct, 1)}%`
                : '—'}
            </AppText>
            <Badge variant={tier.variant} size="sm">
              {t(`widget.forecast.${tier.key}`, tier.label)}
            </Badge>
          </View>
        ) : (
          // ── Standard layout (2×4) ──
          <ScrollView
            style={styles.standardScroll}
            contentContainerStyle={styles.standardContent}
          >
            {/* Projected 80% date — hero section */}
            <View style={styles.hero}>
              <AppText style={styles.heroLabel}>
                {t('widget.forecast.projected80', 'Projected 80% Capacity')}
              </AppText>
              <AppText style={styles.heroValue}>{projectedDate}</AppText>
              <View style={styles.heroBadgeRow}>
                <Badge variant={tier.variant} size="sm">
                  {t(`widget.forecast.${tier.key}`, tier.label)}
                </Badge>
                {rate > 0 ? (
                  <AppText style={styles.heroRate}>
                    {`−${fmtNumber(rate, 2)}%/${t('widget.mo', 'mo')}`}
                  </AppText>
                ) : null}
              </View>
            </View>

            {/* Current health stat */}
            {currentHealthPct != null ? (
              <LocalStatCard
                label={t('widget.forecast.currentHealth', 'Current Health')}
                value={`${fmtNumber(currentHealthPct, 1)}%`}
              />
            ) : null}

            {/* Risk factors list */}
            {riskFactors.length > 0 ? (
              <View style={styles.section}>
                <AppText style={styles.sectionLabel}>
                  {t('widget.forecast.riskFactors', 'Risk Factors')}
                </AppText>
                <View style={styles.riskList}>
                  {riskFactors.slice(0, 5).map(rf => (
                    <View key={rf.name} style={styles.riskRow}>
                      <View style={styles.riskIcon}>{riskIcon(rf.name)}</View>
                      <View style={styles.riskTextWrap}>
                        <AppText style={styles.riskName} numberOfLines={1}>
                          {rf.label ?? rf.name}
                        </AppText>
                        <AppText style={styles.riskDetail} numberOfLines={1}>
                          {rf.detail ?? '—'}
                        </AppText>
                      </View>
                      <Badge
                        variant={
                          scoreToImpact(rf.score) === 'high'
                            ? 'danger'
                            : scoreToImpact(rf.score) === 'medium'
                              ? 'warning'
                              : 'success'
                        }
                        size="sm"
                      >
                        {fmtNumber(rf.score, 0)}
                      </Badge>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {/* Recommendations as tip cards */}
            {tipItems.length > 0 ? (
              <View style={styles.section}>
                <AppText style={styles.sectionLabel}>
                  {t('widget.forecast.recommendations', 'Recommendations')}
                </AppText>
                <WidgetTipCards tips={tipItems} maxTips={3} />
              </View>
            ) : null}
          </ScrollView>
        )
      ) : (
        <LocalEmptyState
          icon={<GlyphIcon glyph={TRENDING_DOWN} color={colors.textMuted} size={20} />}
          message={t('widget.forecast.noData', 'No degradation forecast data')}
        />
      )}
    </WidgetShell>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    paddingBottom: 12, // pb-3
    paddingHorizontal: 16, // px-4
  },
  compactBody: {
    alignItems: 'center',
    flex: 1,
    gap: 4, // gap-1
    justifyContent: 'center',
  },
  emptyIcon: {
    marginBottom: spacing.xs,
  },
  emptyMessage: {
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md, // py-4
  },
  errorBox: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 16, // p-4
  },
  freshnessOverlay: {
    position: 'absolute',
    right: 6, // right-1.5
    top: 6, // top-1.5
    zIndex: 5,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 4, // pb-1
    paddingHorizontal: 16, // px-4
    paddingTop: 12, // pt-3
  },
  headerTitle: {
    color: colors.textMuted,
    fontSize: 11, // text-[11px]
    fontWeight: '500', // font-medium
    letterSpacing: 0.6, // tracking-wider
    textTransform: 'uppercase',
  },
  headerTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6, // gap-1.5
  },
  hero: {
    alignItems: 'center',
    paddingVertical: 8, // py-2
  },
  heroBadgeRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8, // gap-2
    justifyContent: 'center',
    marginTop: 6, // mt-1.5
  },
  heroLabel: {
    color: colors.textMuted,
    fontSize: 10, // text-[10px]
    letterSpacing: 0.6, // tracking-wider
    marginBottom: 4, // mb-1
    textTransform: 'uppercase',
  },
  heroRate: {
    color: colors.textMuted,
    fontSize: 12, // text-xs
  },
  heroValue: {
    color: colors.textPrimary,
    fontSize: 24, // text-2xl
    fontVariant: ['tabular-nums'], // tabular-nums
    fontWeight: '700', // font-bold
    lineHeight: 32,
  },
  riskDetail: {
    color: colors.textMuted,
    fontSize: 10, // text-[10px]
  },
  riskIcon: {
    flexShrink: 0,
  },
  riskList: {
    rowGap: 4, // gap-1
  },
  riskName: {
    color: colors.textPrimary,
    fontSize: 14, // text-sm
  },
  riskRow: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.03)', // bg-white/[0.03]
    borderColor: 'rgba(255, 255, 255, 0.06)', // border-white/[0.06]
    borderRadius: 8, // rounded-lg
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8, // gap-2
    minHeight: 44, // min-h-[44px]
    paddingHorizontal: 12, // px-3
    paddingVertical: 8, // py-2
  },
  riskTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  section: {
    rowGap: 6, // gap-1.5
  },
  sectionLabel: {
    color: colors.textMuted,
    fontSize: 10, // text-[10px]
    letterSpacing: 0.6, // tracking-wider
    textTransform: 'uppercase',
  },
  shell: {
    flex: 1,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12, // rounded-xl
    flex: 1,
  },
  standardContent: {
    rowGap: 12, // gap-3
  },
  standardScroll: {
    flex: 1,
  },
  statCard: {
    backgroundColor: colors.surface, // bg-[var(--surface-1)]
    borderColor: colors.border, // border-[var(--glass-border)]
    borderRadius: 8, // rounded-lg
    borderWidth: 1,
    padding: 16, // p-4
    rowGap: 4, // gap-1
  },
  statLabel: {
    color: colors.textMuted,
    fontSize: 14, // text-sm
    fontWeight: '500', // font-medium
  },
  statLabelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statSublabel: {
    color: colors.textMuted,
    fontSize: 12, // text-xs
  },
  statUnit: {
    color: colors.textMuted,
    fontSize: 14, // text-sm
  },
  statValue: {
    color: colors.textPrimary,
    fontSize: 24, // text-2xl
    fontWeight: '700', // font-bold
  },
  statValueRow: {
    alignItems: 'flex-end', // items-baseline
    flexDirection: 'row',
    gap: 4, // gap-1
  },
  tipBody: {
    flex: 1,
    minWidth: 0,
  },
  tipCard: {
    alignItems: 'flex-start',
    backgroundColor: 'rgba(255, 255, 255, 0.03)', // bg-white/[0.03]
    borderColor: 'rgba(255, 255, 255, 0.06)', // border-white/[0.06]
    borderRadius: 8, // rounded-lg
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12, // gap-3
    minHeight: 44, // min-h-[44px]
    padding: 12, // p-3
  },
  tipDesc: {
    color: colors.textSecondary,
    fontSize: 12, // text-xs
    lineHeight: 18, // leading-relaxed
    marginTop: 2, // mt-0.5
  },
  tipIcon: {
    flexShrink: 0,
    marginTop: 2, // mt-0.5
  },
  tipList: {
    rowGap: spacing.sm, // space-y-2
  },
  tipTitle: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14, // text-sm
    fontWeight: '500', // font-medium
  },
  tipTitleRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
});
