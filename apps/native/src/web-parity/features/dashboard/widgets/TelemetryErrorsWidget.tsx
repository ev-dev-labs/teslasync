// Native parity port of web/src/features/dashboard/widgets/TelemetryErrorsWidget.tsx.
//
// `TelemetryErrorsWidget` is a dashboard widget that surfaces Fleet Telemetry
// error VINs + the aggregated per-VIN error feed. It has two layouts driven by
// `size.cols`:
//   - compact (cols <= 1): the active-error-VIN count + an "error VINs" caption
//     + a Healthy/Errors status Badge.
//   - standard: a header stat line ("{{count}} VINs with errors") + a status
//     Badge, then a scrollable feed of aggregated {vin, error_code, count,
//     last_seen} cards (each with a "recent" badge when last seen < 1h ago, the
//     ×count, and a relative TimeStamp).
//   - When neither query returned rows, the whole body is a single EmptyState.
//
// Behaviour preserved 1:1 with the web source (conversion rule 3): the two
// destructured queries `useFleetTelemetryErrorVINs()` (L17-25) +
// `useFleetTelemetryErrors()` (L27-34), `isCompact = size.cols <= 1` (L36),
// `vinList = errorVINs ?? []` / `errorList = errors ?? []` (L38-39),
// `activeVINCount = vinList.filter(v => v.active).length` (L41), the memoized
// `aggregated` map (L44-68) keyed by `${vin}::${error_code ?? 'unknown'}` with
// the `ts = reported_at ?? fetched_at` last-seen pick, count increment, the
// `widget.telemetryErrors.unknown 'Unknown'` fallback, and the
// empty-last_seen-aware descending sort, `loading = vinsLoading || errorsLoading`
// (L70), `hasData = vinList.length > 0 || errorList.length > 0` (L71), the
// `statusBadge`/`statusLabel` derivations (L73-79), the `ONE_HOUR_MS` constant
// (L12) + per-entry `isRecent` (L132-134), and the `WidgetShell` prop wiring —
// `updatedAt = Math.max(vinsUpdatedAt ?? 0, errorsUpdatedAt ?? 0)`,
// `isFetching = vinsFetching || errorsFetching`,
// `isStale = vinsStale || errorsStale`,
// `isError = vinsError || errorsIsError`, `onRefresh = () => refetchVINs()`
// (L82-91). Every i18n key + English default and every API field name (vin,
// active, error_code, reported_at, fetched_at) is kept verbatim. The API paths
// live in the reused `useTelemetry` parity hook.
//
// Web/DOM-only dependencies with no native parity surface are mapped to
// native-safe equivalents and documented (conversion rules 4/5/7):
//   - react-i18next `useTranslation('dashboard')` (L2) -> a local fallback
//     resolver returning the inline English string; it interpolates
//     `{{count}}`-style placeholders from the options arg so the
//     "{{count}} VINs with errors" line still shows the real number (the same
//     shim shape used by the sibling AnomalyDetector / FleetStats widget ports).
//     The namespace arg is accepted + ignored.
//   - lucide-react `AlertCircle` (L3) -> there is no `react-native-svg`
//     dependency in the native app, so it renders a decorative glyph stand-in
//     via `<GlyphIcon>` (the AnomalyDetector / FleetTelemetryHealth glyph
//     precedent): AlertCircle -> "⚠️" (the universal alert glyph). The header
//     instance keeps the Tailwind icon colour as hex (text-red-400 #f87171,
//     h-3.5 -> 14); the colourless empty-state instance (h-5 -> 20) inherits the
//     muted token, matching the web `EmptyState` icon styling.
//   - `@/components/ui` `Badge` (L4) -> the converted web-parity `Badge` port
//     (variant danger/success, the `dot` flag + `size="sm"` for the recent chip).
//     The web `className` text-size/min-height tweaks (text-xs / text-[10px] /
//     min-h-[28px]) are ignored by the native Badge (className is a no-op); the
//     nearest size prop is used and the min-h-[28px] is reproduced via `style`.
//   - `@/components/data-display` `TimeStamp` (L5) -> the already-ported
//     web-parity `TimeStamp` (settings-aware relative/absolute renderer); the
//     web `className` becomes the native `style` override.
//   - `@/components/feedback` `EmptyState` (L6) -> not yet ported, so its
//     icon+message rendering is reproduced locally as `<LocalEmptyState>`
//     (centred glyph + muted message, py-4). The web "no-action transient empty
//     state" intent is preserved.
//   - `@/lib/numberFormat` `fmtInt` (L8) -> inlined native-safe equivalent
//     (+ its `safeNumber` dep + the `fmtNumber(v, 0)` it delegates to):
//     nullish/non-finite -> 0, en-US locale, 0 fraction digits with separators.
//   - `./WidgetShell` `WidgetShell` (L9) -> reproduced locally as a native
//     `<WidgetShell>` (sibling module not yet ported, same self-contained
//     approach as the AnomalyDetector port): loading -> skeleton block, error ->
//     centred danger text (surfaced, never hidden), title+icon header, the
//     freshness chip via the converted web-parity `DataFreshness` port, and the
//     children body. The web pulse-on-data-change box-shadow glow (L59-80,
//     L116-118) is a CSS affordance with no native analog and is intentionally
//     omitted (documented in the sidecar); the help-tooltip / pin-button /
//     actions header slots are unused by this widget and are not modeled.
//   - `./types` `WidgetProps` (L10) -> the `WidgetProps` / `WidgetSize` /
//     `WidgetConfig` subset is reproduced + exported locally so this widget and
//     any future native consumer agree on the shape.
//
// Tailwind spacing -> px (1 unit = 4px); `font-mono` -> `fontVariant:
// ['tabular-nums']` (the sibling SoftwareUpdateStatusWidget precedent — RN has
// no className/monospace cascade); var(--text-*) -> the theme tokens so the
// light/dark cascade is preserved at the token boundary; the Tailwind
// `bg-white/[0.03]` is kept as its rgba literal.

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
import { TimeStamp } from '../../../components/data-display/TimeStamp';
import {
  useFleetTelemetryErrorVINs,
  useFleetTelemetryErrors,
} from '../../../api/hooks/useTelemetry';

// ── i18n shim ───────────────────────────────────────────────────────────────
// react-i18next has no native parity module; translations resolve to their
// inline English fallback. `{{name}}` placeholders are interpolated from the
// options arg so the "{{count}} VINs with errors" line keeps the real number.
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
// Locale-aware formatting matching the web helper: nullish/non-finite input
// coerces to 0, en-US locale; `fmtInt` is `fmtNumber(v, 0)` (integer with
// locale separators).
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

// ── lucide glyph stand-in ────────────────────────────────────────────────────
const RED_400 = '#f87171'; // text-red-400

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

const ONE_HOUR_MS = 60 * 60 * 1000;

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

interface AggregatedEntry {
  vin: string;
  error_code: string;
  count: number;
  last_seen: string;
}

export default function TelemetryErrorsWidget({ size }: WidgetProps) {
  const { t } = useTranslation('dashboard');

  const {
    data: errorVINs,
    isLoading: vinsLoading,
    isFetching: vinsFetching,
    isStale: vinsStale,
    isError: vinsError,
    dataUpdatedAt: vinsUpdatedAt,
    refetch: refetchVINs,
  } = useFleetTelemetryErrorVINs();

  const {
    data: errors,
    isLoading: errorsLoading,
    isFetching: errorsFetching,
    isStale: errorsStale,
    isError: errorsIsError,
    dataUpdatedAt: errorsUpdatedAt,
  } = useFleetTelemetryErrors();

  const isCompact = size.cols <= 1;

  const vinList = errorVINs ?? [];
  // Source: `const errorList = errors ?? []`. Wrapped in useMemo so the
  // reference is stable for the `aggregated` useMemo deps (native react-hooks/
  // exhaustive-deps treats the bare `?? []` logical expression as a per-render
  // value); behaviour is identical.
  const errorList = useMemo(() => errors ?? [], [errors]);

  const activeVINCount = vinList.filter((v) => v.active).length;

  // Aggregate errors by VIN + error_code for feed display
  const aggregated = useMemo(() => {
    const map = new Map<string, AggregatedEntry>();
    for (const e of errorList) {
      const key = `${e.vin}::${e.error_code ?? 'unknown'}`;
      const existing = map.get(key);
      const ts = e.reported_at ?? e.fetched_at;
      if (existing) {
        existing.count += 1;
        if (ts && ts > existing.last_seen) existing.last_seen = ts;
      } else {
        map.set(key, {
          vin: e.vin,
          error_code: e.error_code ?? t('widget.telemetryErrors.unknown', 'Unknown'),
          count: 1,
          last_seen: ts ?? '',
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      if (!a.last_seen && !b.last_seen) return 0;
      if (!a.last_seen) return 1;
      if (!b.last_seen) return -1;
      return new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime();
    });
  }, [errorList, t]);

  const loading = vinsLoading || errorsLoading;
  const hasData = vinList.length > 0 || errorList.length > 0;

  const statusBadge: BadgeVariant = activeVINCount > 0 ? 'danger' : 'success';

  const statusLabel = activeVINCount > 0
    ? t('widget.telemetryErrors.errors', 'Errors')
    : t('widget.telemetryErrors.healthy', 'Healthy');

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.telemetryErrors.title', 'Telemetry Errors')}
      icon={<GlyphIcon glyph="⚠️" color={RED_400} size={14} />}
      loading={loading}
      updatedAt={Math.max(vinsUpdatedAt ?? 0, errorsUpdatedAt ?? 0)}
      isFetching={vinsFetching || errorsFetching}
      isStale={vinsStale || errorsStale}
      isError={vinsError || errorsIsError}
      onRefresh={() => refetchVINs()}
    >
      {!hasData ? (
        <LocalEmptyState
          icon={<GlyphIcon glyph="⚠️" color={colors.textMuted} size={20} />}
          message={t('widget.telemetryErrors.noData', 'No telemetry error data')}
        />
      ) : isCompact ? (
        /* ── Compact layout (1×2) ── */
        <View style={styles.compactBody}>
          <AppText style={styles.compactCount}>{fmtInt(activeVINCount)}</AppText>
          <AppText style={styles.compactLabel}>
            {t('widget.telemetryErrors.errorVINs', 'error VINs')}
          </AppText>
          <Badge variant={statusBadge} style={styles.compactBadge}>
            {statusLabel}
          </Badge>
        </View>
      ) : (
        /* ── Standard layout (2×4) ── */
        <View style={styles.standardBody}>
          {/* Header stats */}
          <View style={styles.headerStatsRow}>
            <AppText style={styles.headerStatsText}>
              {t('widget.telemetryErrors.activeVINs', '{{count}} VINs with errors', {
                count: activeVINCount,
              })}
            </AppText>
            <Badge variant={statusBadge} size="sm">
              {statusLabel}
            </Badge>
          </View>

          {/* Error feed */}
          <ScrollView style={styles.feed} contentContainerStyle={styles.feedContent}>
            {aggregated.length === 0 ? (
              <AppText style={styles.feedEmpty}>
                {t('widget.telemetryErrors.noErrors', 'No errors recorded')}
              </AppText>
            ) : (
              aggregated.map((entry, idx) => {
                const isRecent = entry.last_seen
                  ? Date.now() - new Date(entry.last_seen).getTime() < ONE_HOUR_MS
                  : false;
                return (
                  <View key={`${entry.vin}-${entry.error_code}-${idx}`} style={styles.errorRow}>
                    <View style={styles.errorRowLeft}>
                      <View style={styles.errorVinRow}>
                        <AppText numberOfLines={1} style={styles.errorVin}>
                          {entry.vin}
                        </AppText>
                        {isRecent && (
                          <Badge variant="danger" size="sm" dot>
                            {t('widget.telemetryErrors.recent', 'recent')}
                          </Badge>
                        )}
                      </View>
                      <AppText numberOfLines={1} style={styles.errorCode}>
                        {entry.error_code}
                      </AppText>
                    </View>
                    <View style={styles.errorRowRight}>
                      <AppText style={styles.errorCount}>×{fmtInt(entry.count)}</AppText>
                      <TimeStamp value={entry.last_seen || null} style={styles.errorTime} />
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
        </View>
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
  compactBadge: {
    minHeight: 28, // min-h-[28px]
    justifyContent: 'center',
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
    fontSize: 18, // text-lg
    fontWeight: '700', // font-bold
    lineHeight: 24,
  },
  compactLabel: {
    color: colors.textSecondary,
    fontSize: 10, // text-[10px]
    lineHeight: 14,
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
  errorCode: {
    color: colors.textMuted,
    fontSize: 10, // text-[10px]
    lineHeight: 14,
  },
  errorCount: {
    color: colors.textSecondary,
    fontSize: 12, // text-xs
    fontWeight: '500', // font-medium
    lineHeight: 16,
  },
  errorRow: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.03)', // bg-white/[0.03]
    borderRadius: 8, // rounded-lg
    flexDirection: 'row',
    gap: spacing.sm, // gap-2
    minHeight: 44, // min-h-[44px]
    paddingHorizontal: 8, // px-2
    paddingVertical: 6, // py-1.5
  },
  errorRowLeft: {
    flex: 1,
    minWidth: 0,
  },
  errorRowRight: {
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  errorTime: {
    color: colors.textMuted,
    fontSize: 10, // text-[10px]
    lineHeight: 14,
  },
  errorVin: {
    color: colors.textSecondary,
    fontSize: 12, // text-xs
    fontVariant: ['tabular-nums'], // font-mono
    lineHeight: 16,
    maxWidth: 120, // max-w-[120px]
  },
  errorVinRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6, // gap-1.5
  },
  feed: {
    flex: 1,
  },
  feedContent: {
    rowGap: spacing.xs, // space-y-1
  },
  feedEmpty: {
    color: colors.textMuted,
    fontSize: 12, // text-xs
    paddingVertical: spacing.md, // py-4
    textAlign: 'center',
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
  headerStatsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  headerStatsText: {
    color: colors.textSecondary,
    fontSize: 12, // text-xs
    lineHeight: 16,
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
  standardBody: {
    flex: 1,
    gap: spacing.sm, // gap-2
  },
});
