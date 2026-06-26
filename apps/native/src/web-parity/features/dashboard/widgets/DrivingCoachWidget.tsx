// Native parity port of web/src/features/dashboard/widgets/DrivingCoachWidget.tsx.
//
// `DrivingCoachWidget` is a dashboard widget that surfaces eco-driving coaching
// for the active vehicle. It has two layouts driven by `size.cols`:
//   - compact (cols <= 1): a big eco-score number, a "Potential savings: {{pct}}%"
//     success Badge when there is headroom, or an empty state when there are no
//     savings AND no recommendations.
//   - full: a titled shell with a score header (score + "/ 100" + optional savings
//     Badge) above a list of recommendation tip cards.
//
// Behaviour preserved 1:1 with the web source (conversion rule 3): the
// `vid`/`vehicleIdStr` vehicle resolution (vehicleId prop, else first vehicle,
// `String(vid)` else `undefined` matching the optional hook param), the
// destructured `useDrivingCoach` query result, `isCompact = size.cols <= 1`, the
// `score`/`recommendations`/`bestEff`/`currentEff` nullish-coalesced reads, the
// `savingsPct = currentEff > 0 ? Math.round(((currentEff - bestEff) / currentEff)
// * 100) : 0` derivation, the memoized `tips` (mapped to TipItem with the exact
// id `i` / Lightbulb icon / `category ?? '—'` title / `tip ?? '—'` description /
// `impact ?? undefined` / `widget.drivingCoach.impact.${impact}` impactLabel
// shape), and the `shellProps` bag. Every i18n key + English default and every
// API field name (overall_score, recommendations, best_efficiency_wh_km,
// efficiency_wh_km, category, tip, impact) is kept verbatim.
//
// Web/DOM-only dependencies with no native parity surface are mapped to
// native-safe equivalents and documented (conversion rules 4/5/7):
//   - react-i18next `useTranslation('dashboard')` (L2) -> a local fallback
//     resolver returning the inline English string; it interpolates
//     `{{pct}}`-style placeholders from the options arg so the "Potential
//     savings: {{pct}}%" line still shows the real percentage (the same shim
//     shape used by the AnomalyDetector / TemplateGallery ports). The namespace
//     arg is accepted + ignored.
//   - lucide-react `Lightbulb` (L3) -> there is no `react-native-svg` dependency
//     in the native app, so it renders a decorative glyph stand-in via
//     `<GlyphIcon>` (the AnomalyDetector / AutomationCard glyph precedent): "💡".
//     The tip-card lightbulbs inherit the web `text-[var(--text-secondary)]` of
//     the WidgetTipCards icon slot (-> colors.textSecondary); the title icon keeps
//     the web `text-amber-400` (#fbbf24); the empty-state icons take the muted
//     token, matching the web `EmptyState` icon styling.
//   - `@/components/ui` `Badge` (L4) -> the converted web-parity `Badge` port
//     (variant="success", size="sm").
//   - `@/components/feedback` `EmptyState` (L5) -> not yet ported, so its
//     icon+message rendering is reproduced locally as `<LocalEmptyState>`
//     (centred glyph + muted message). The web "no-action transient empty state"
//     intent is preserved.
//   - `@/lib/numberFormat` `fmtInt` (L8) -> inlined native-safe equivalent
//     (+ its `safeNumber` dep): nullish/non-finite -> 0, en-US locale, 0 decimals
//     (the web `fmtInt` === `fmtNumber(v, 0)`).
//   - `./WidgetShell` `WidgetShell` (L9) -> reproduced locally as a native
//     `<WidgetShell>` (sibling module not yet ported, same self-contained
//     approach as the AnomalyDetector port): loading -> skeleton block, error ->
//     centred danger text (surfaced, never hidden), title+icon header, the
//     freshness chip via the converted web-parity `DataFreshness` port, and the
//     children body. The web pulse-on-data-change box-shadow glow is a CSS
//     affordance with no native analog and is intentionally omitted (documented
//     in the sidecar); the help-tooltip / pin-button header slots are unused by
//     this widget and are not modeled.
//   - `./shared` `WidgetTipCards` + `TipItem` (L10) -> reproduced locally as a
//     native `<WidgetTipCards>` (sibling not yet ported): the maxTips/compact
//     slice, the impact->Badge variant map, and the icon + title + impact Badge +
//     (optionally clamped) description card layout, falling back to
//     `<LocalEmptyState>`.
//   - `./types` `WidgetProps` (L11) -> the `WidgetProps` / `WidgetSize` /
//     `WidgetConfig` subset is reproduced + exported locally so this widget and
//     any future native consumer agree on the shape.
//
// Tailwind spacing -> px (1 unit = 4px); var(--text-*) -> the theme tokens so the
// light/dark cascade is preserved at the token boundary.

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
import { Badge } from '../../../components/ui/Badge';
import { DataFreshness } from '../../../components/data-display/DataFreshness';
import { useDrivingCoach } from '../../../api/hooks/useDriving';
import { useVehicles } from '../../../api/hooks/useVehicles';

// ── i18n shim ───────────────────────────────────────────────────────────────
// react-i18next has no native parity module; translations resolve to their
// inline English fallback. `{{name}}` placeholders are interpolated from the
// options arg so the "Potential savings: {{pct}}%" line keeps the real number.
// The hook shape mirrors the web `const { t } = useTranslation('dashboard')` so
// the component body is unchanged.
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

// ── Inlined `@/lib/numberFormat` (safeNumber / fmtInt) ───────────────────────
// `fmtInt` === the web `fmtNumber(v, 0)`: nullish/non-finite input coerces to 0,
// en-US locale, zero decimals with locale grouping separators.
function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

function fmtInt(v: unknown): string {
  return safeNumber(v).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
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

// ── lucide glyph stand-in ────────────────────────────────────────────────────
const AMBER_400 = '#fbbf24'; // text-amber-400

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

  return (
    <ScrollView
      style={styles.tipList}
      contentContainerStyle={styles.tipListContent}
    >
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
    </ScrollView>
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

export default function DrivingCoachWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const vehicleIdStr = vid != null ? String(vid) : undefined;

  const {
    data,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useDrivingCoach(vehicleIdStr);

  const isCompact = size.cols <= 1;

  const score = data?.overall_score ?? 0;
  // Source: `const recommendations = data?.recommendations ?? []`. Wrapped in
  // useMemo so the reference is stable for the `tips` useMemo deps (the bare
  // `?? []` logical expression is otherwise a per-render value); behaviour is
  // identical.
  const recommendations = useMemo(() => data?.recommendations ?? [], [data]);
  const bestEff = data?.best_efficiency_wh_km ?? 0;
  const currentEff = data?.efficiency_wh_km ?? 0;
  const savingsPct =
    currentEff > 0
      ? Math.round(((currentEff - bestEff) / currentEff) * 100)
      : 0;

  const tips: TipItem[] = useMemo(
    () =>
      recommendations.map((rec, i) => ({
        id: i,
        icon: <GlyphIcon glyph="💡" color={colors.textSecondary} size={16} />,
        title: rec.category ?? '—',
        description: rec.tip ?? '—',
        impact: rec.impact ?? undefined,
        impactLabel: rec.impact
          ? t(`widget.drivingCoach.impact.${rec.impact}`, rec.impact)
          : undefined,
      })),
    [recommendations, t],
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

  if (isCompact) {
    return (
      <WidgetShell
        {...shellProps}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={() => refetch()}
      >
        <View style={styles.compactBody}>
          <AppText style={styles.compactScore}>{fmtInt(score)}</AppText>
          {savingsPct > 0 ? (
            <Badge variant="success" size="sm">
              {t(
                'widget.drivingCoach.potentialSavings',
                'Potential savings: {{pct}}%',
                { pct: savingsPct },
              )}
            </Badge>
          ) : null}
          {savingsPct <= 0 && recommendations.length === 0 ? (
            <LocalEmptyState
              icon={<GlyphIcon glyph="💡" color={colors.textMuted} size={20} />}
              message={t('widget.drivingCoach.noTips', 'No tips available')}
            />
          ) : null}
        </View>
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      title={t('widget.drivingCoach.title', 'Driving Coach')}
      icon={<GlyphIcon glyph="💡" color={AMBER_400} size={14} />}
      {...shellProps}
    >
      <View style={styles.fullBody}>
        {/* Score header */}
        <View style={styles.scoreHeader}>
          <View style={styles.scoreRow}>
            <AppText style={styles.scoreValue}>{fmtInt(score)}</AppText>
            <AppText style={styles.scoreLabel}>
              {t('widget.drivingCoach.scoreLabel', '/ 100')}
            </AppText>
          </View>
          {savingsPct > 0 ? (
            <Badge variant="success" size="sm">
              {t(
                'widget.drivingCoach.potentialSavings',
                'Potential savings: {{pct}}%',
                { pct: savingsPct },
              )}
            </Badge>
          ) : null}
        </View>

        {/* Tips list */}
        <View style={styles.tipsContainer}>
          <WidgetTipCards
            tips={tips}
            maxTips={3}
            compact={false}
            emptyMessage={t('widget.drivingCoach.noTips', 'No tips available')}
            emptyIcon={
              <GlyphIcon glyph="💡" color={colors.textMuted} size={20} />
            }
          />
        </View>
      </View>
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
    gap: spacing.sm, // gap-2
    justifyContent: 'center',
    minHeight: 44, // min-h-[44px]
  },
  compactScore: {
    color: colors.textPrimary,
    fontSize: 24, // text-2xl
    fontWeight: '700', // font-bold
    lineHeight: 32,
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
    paddingVertical: spacing.sm,
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
  fullBody: {
    flex: 1,
    gap: 12, // gap-3
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
  scoreHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  scoreLabel: {
    color: colors.textMuted,
    fontSize: 12, // text-xs
    lineHeight: 16,
  },
  scoreRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: spacing.sm, // gap-2
  },
  scoreValue: {
    color: colors.textPrimary,
    fontSize: 30, // text-3xl
    fontWeight: '700', // font-bold
    lineHeight: 36,
  },
  shell: {
    flex: 1,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12, // rounded-xl
    flex: 1,
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
    flex: 1,
  },
  tipListContent: {
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
  tipsContainer: {
    flex: 1,
    minHeight: 0, // min-h-0
  },
});
