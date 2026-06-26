// Native parity port of web/src/features/dashboard/widgets/AnomalyDetectorWidget.tsx.
//
// `AnomalyDetectorWidget` is a dashboard widget that surfaces ML-detected signal
// anomalies for the active vehicle. It has two layouts driven by `size.cols`:
//   - compact (cols <= 1): a big count + an "{{count}} active" severity Badge,
//     or an empty state when there are no anomalies.
//   - full: a titled shell whose body is a list of tip cards (one per anomaly),
//     sorted by severity, or an empty state.
//
// Behaviour preserved 1:1 with the web source (conversion rule 3): the
// `vid`/`vehicleIdStr` vehicle resolution (vehicleId prop, else first vehicle),
// the destructured `useAnomalies` query result, `isCompact = size.cols <= 1`,
// `anomalies = data?.anomalies ?? []`, the memoized `tips` (sorted ascending by
// SEVERITY_ORDER, mapped to TipItem with the exact id/icon/title/description/
// impact/impactLabel shape), the `shellProps` bag, and the compact branch's
// `count`/`maxSeverity`/`badgeVariant` derivation. Every i18n key + English
// default and every API field name (signal, z_score, detected_at, message,
// severity, anomalies) is kept verbatim.
//
// Web/DOM-only dependencies with no native parity surface are mapped to
// native-safe equivalents and documented (conversion rules 4/5/7):
//   - react-i18next `useTranslation('dashboard')` (L2) -> a local fallback
//     resolver returning the inline English string; it interpolates
//     `{{count}}`-style placeholders from the options arg so the
//     "{{count}} active" line still shows the real number (the same shim shape
//     used by the TemplateGallery / KioskSettingsModal ports). The namespace
//     arg is accepted + ignored.
//   - lucide-react `AlertTriangle` / `AlertOctagon` / `Info` (L3) -> there is no
//     `react-native-svg` dependency in the native app, so each renders a
//     decorative glyph stand-in via `<GlyphIcon>` (the AutomationCard / InlineCallout
//     glyph precedent): AlertOctagon -> "⛔", AlertTriangle -> "⚠️", Info -> "ℹ️".
//     The Tailwind icon colours are preserved as hex (text-red-400 #f87171,
//     text-amber-400 #fbbf24, text-blue-400 #60a5fa); the colourless empty-state
//     icons inherit the muted token, matching the web `EmptyState` icon styling.
//   - `@/components/ui` `Badge` (L4) -> the converted web-parity `Badge` port
//     (variant danger/warning/neutral/success, size="sm").
//   - `@/components/feedback` `EmptyState` (L5) -> not yet ported, so its
//     icon+message rendering is reproduced locally as `<LocalEmptyState>`
//     (centred glyph + muted message). The web "no-action transient empty state"
//     intent is preserved.
//   - `@/lib/numberFormat` `fmtNumber` (L8) -> inlined native-safe equivalent
//     (+ its `safeNumber` dep): nullish/non-finite -> 0, en-US locale, the
//     per-call precision arg honoured (z-score formats at 1 decimal).
//   - `./WidgetShell` `WidgetShell` (L9) -> reproduced locally as a native
//     `<WidgetShell>` (sibling module not yet ported, same self-contained
//     approach as the TemplateGallery port): loading -> skeleton block, error ->
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
import { Badge, type BadgeVariant } from '../../../components/ui/Badge';
import { DataFreshness } from '../../../components/data-display/DataFreshness';
import {
  useAnomalies,
  type AnomalyEntry,
} from '../../../api/hooks/useAnomalies';
import { useVehicles } from '../../../api/hooks/useVehicles';

// ── i18n shim ───────────────────────────────────────────────────────────────
// react-i18next has no native parity module; translations resolve to their
// inline English fallback. `{{name}}` placeholders are interpolated from the
// options arg so the "{{count}} active" line keeps the real number. The hook
// shape mirrors the web `const { t } = useTranslation('dashboard')` so the
// component body is unchanged.
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
const RED_400 = '#f87171'; // text-red-400
const AMBER_400 = '#fbbf24'; // text-amber-400
const BLUE_400 = '#60a5fa'; // text-blue-400

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

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

const SEVERITY_IMPACT: Record<string, 'high' | 'medium' | 'low'> = {
  critical: 'high',
  warning: 'medium',
  info: 'low',
};

const SEVERITY_BADGE: Record<string, 'danger' | 'warning' | 'neutral'> = {
  critical: 'danger',
  warning: 'warning',
  info: 'neutral',
};

function severityIcon(severity: string): ReactNode {
  switch (severity) {
    case 'critical':
      return <GlyphIcon glyph="⛔" color={RED_400} size={16} />;
    case 'warning':
      return <GlyphIcon glyph="⚠️" color={AMBER_400} size={16} />;
    default:
      return <GlyphIcon glyph="ℹ️" color={BLUE_400} size={16} />;
  }
}

function formatRelativeTime(isoStr: string): string {
  const d = new Date(isoStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) {
    return 'Just now';
  }
  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) {
    return `${diffHrs}h ago`;
  }
  const diffDays = Math.floor(diffHrs / 24);
  return `${diffDays}d ago`;
}

function maxSeverity(anomalies: { severity: string }[]): string {
  let best = 'info';
  for (const a of anomalies) {
    if ((SEVERITY_ORDER[a.severity] ?? 2) < (SEVERITY_ORDER[best] ?? 2)) {
      best = a.severity;
    }
  }
  return best;
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

export default function AnomalyDetectorWidget({
  vehicleId,
  size,
}: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
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
  } = useAnomalies(vehicleIdStr);

  const isCompact = size.cols <= 1;
  // Source: `const anomalies = data?.anomalies ?? []`. Wrapped in useMemo so the
  // reference is stable for the `tips` useMemo deps (native react-hooks/
  // exhaustive-deps treats the bare `?? []` logical expression as a per-render
  // value); behaviour is identical.
  const anomalies = useMemo(() => data?.anomalies ?? [], [data]);

  const tips: TipItem[] = useMemo(
    () =>
      [...anomalies]
        .sort(
          (a, b) =>
            (SEVERITY_ORDER[a.severity] ?? 2) -
            (SEVERITY_ORDER[b.severity] ?? 2),
        )
        .map((entry: AnomalyEntry) => ({
          id: `${entry.signal}-${entry.detected_at}`,
          icon: severityIcon(entry.severity),
          title: `${entry.signal ?? '—'} · z=${fmtNumber(
            entry.z_score ?? 0,
            1,
          )} · ${formatRelativeTime(entry.detected_at ?? '')}`,
          description: entry.message ?? '—',
          impact: SEVERITY_IMPACT[entry.severity] ?? ('low' as const),
          impactLabel: t(
            `widget.anomalyDetector.severity.${entry.severity}`,
            entry.severity ?? '—',
          ),
        })),
    [anomalies, t],
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
    const count = anomalies.length;
    const sev = maxSeverity(anomalies);
    const badgeVariant: BadgeVariant = SEVERITY_BADGE[sev] ?? 'neutral';

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
          {count > 0 ? (
            <>
              <AppText style={styles.compactCount}>{count}</AppText>
              <Badge variant={badgeVariant} size="sm">
                {t('widget.anomalyDetector.activeCount', '{{count}} active', {
                  count,
                })}
              </Badge>
            </>
          ) : (
            <LocalEmptyState
              icon={<GlyphIcon glyph="⚠️" color={colors.textMuted} size={20} />}
              message={t('widget.anomalyDetector.noAnomalies', 'No anomalies')}
            />
          )}
        </View>
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      title={t('widget.anomalyDetector.title', 'Anomaly Detector')}
      icon={<GlyphIcon glyph="⚠️" color={AMBER_400} size={14} />}
      {...shellProps}
    >
      <View style={styles.fullBody}>
        <View style={styles.fullBodyInner}>
          <WidgetTipCards
            tips={tips}
            compact={false}
            emptyMessage={t(
              'widget.anomalyDetector.noAnomalies',
              'No anomalies',
            )}
            emptyIcon={
              <GlyphIcon glyph="⚠️" color={colors.textMuted} size={20} />
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
  compactCount: {
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
  },
  fullBodyInner: {
    flex: 1,
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
});
