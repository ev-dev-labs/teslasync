// Native parity port of web/src/features/dashboard/widgets/SuperchargerHistoryWidget.tsx.
//
// Dashboard widget that reads the Tesla Supercharger/DC charging-history feed
// (entries + 30-day summary) and renders, depending on widget width, either a
// compact "30-day Supercharger spend" big number (1-col) or a ranked list of
// the 10 most-recent sessions plus a 30-day energy/spend totals row inside a
// widget shell. The web file pulls in browser-only or web-UI dependencies that
// are absent from the native parity manifest (contract rules 4, 5 & 7); each is
// replaced with a React Native-safe equivalent and documented here + in the
// sidecar:
//
//   - react-i18next `useTranslation('dashboard')` (web L2, L14) -> inlined
//     useNativeTranslation(): a stable (key, fallback) => fallback shim so every
//     t('widget.superchargerHistory.*', '<English>') call keeps its English
//     default + translation-key intent (the established AlertFeed/ChargeHistory
//     port pattern).
//   - lucide-react Zap (web L3, L77, L90, L107, L124) -> the shared native
//     SemanticIcon 'bolt' (its lightning/zap glyph 'ZP', warning tone). lucide
//     SVG has no native renderer; SemanticIcon tone is fixed per name, so the
//     title icon's text-yellow-400 tint collapses to the bolt icon's intrinsic
//     warning tone (≈ amber-400) — the same color-tint -> semantic-icon collapse
//     used by the ChargeHistory (neon-green->analytics) and AlertFeed
//     (neon-cyan->notifications) ports; the energy/supercharger intent is kept.
//   - `@/components/feedback` EmptyState (web L4, L76, L123) -> inlined native
//     WidgetEmptyState: a centred icon + muted-caption view (the shared native
//     EmptyState requires a title and takes no icon, so inlined like the
//     ChargeHistory port), preserving the web no-action transient-empty intent
//     and the py-4 / py-8 paddings.
//   - `@/api/hooks/useCharging` useTeslaChargingHistory (web L5) -> the ported
//     native useTeslaChargingHistory hook (same '/tesla/charging/history' query,
//     same TeslaChargingHistoryResponse shape, same UseQueryResult fields).
//   - `@/hooks/useFormatting` useFormatting().formatCurrency (web L6, L15, L47,
//     L118) -> the ported native useFormatPrefs() (settings-derived currency
//     symbol + locale-aware fmt) plus a tiny local formatCurrency closure
//     reproducing the web `${symbol}${fmtNumber(amount, d)}` output.
//   - `@/hooks/useUnits` useUnits().formatEnergy (web L7, L16, L45, L117) -> a
//     local formatEnergy closure reproducing web formatEnergy: SI Wh -> kWh
//     (wh / 1000) formatted with the same locale-aware fmt at the requested
//     precision and the ' kWh' suffix (energy pref is the fixed 'kWh' default).
//   - `./WidgetShell` WidgetShell (web L8) -> inlined native WidgetShell (same
//     skeleton/error/header/overlay-freshness/pulse subset already ported by the
//     ChargeHistory/AlertFeed widgets); the unused
//     query/help/widgetId/dashboardId/actions/noPadding props are omitted.
//   - `./shared` WidgetRankedList + type RankedItem (web L9) -> inlined native
//     WidgetRankedList: the sort-by-value + slice-to-limit + background-bar +
//     rank/label/badge/value row contract reproduced with RN primitives.
//   - `./shared` WidgetBigNumber (web L10) -> inlined native WidgetBigNumber:
//     the animated value + unit + label/subtitle/badge contract reproduced with
//     RN primitives and the ported native AnimatedNumber.
//   - `./types` WidgetProps (web L11) -> inlined native WidgetSize/WidgetProps
//     (the size subset this widget reads).
//
// No DOM-only modules, HTML elements, react-i18next, lucide-react, Recharts,
// Leaflet, or web @/ UI components are imported -- only react, react-native
// primitives, the shared native SemanticIcon / AppText / theme tokens, and the
// ported parity AnimatedNumber / useTeslaChargingHistory / useFormatPrefs /
// DataFreshness / QueryError.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {StyleSheet, View, type DimensionValue} from 'react-native';

import {SemanticIcon} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {colors} from '../../../../theme/tokens';
import {useTeslaChargingHistory} from '../../../api/hooks/useCharging';
import {AnimatedNumber} from '../../../components/data-display/AnimatedNumber';
import {DataFreshness} from '../../../components/data-display/DataFreshness';
import {
  FALLBACK,
  isFiniteNumber,
  useFormatPrefs,
} from '../../../components/data-display/format/_formatPrimitives';
import {QueryError} from '../../../components/feedback/QueryError';

// ── react-i18next useTranslation('dashboard') replacement ──
type NativeTFunction = (key: string, fallback: string) => string;

// Returns the English fallback so the translation-key intent is preserved.
const nativeTranslate: NativeTFunction = (_key, fallback) => fallback;

function useNativeTranslation(): NativeTFunction {
  return nativeTranslate;
}

// ── ./types WidgetSize / WidgetProps (ported inline subset) ──
interface WidgetSize {
  cols: number;
  rows: number;
}

interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: Record<string, unknown>;
}

// ── ./shared RankedItem (ported verbatim from WidgetRankedList) ──
type BadgeVariant = 'success' | 'warning' | 'error' | 'neutral';

interface RankedItem {
  id: string | number;
  label: string;
  value: number;
  formattedValue: string;
  badge?: {text: string; variant: BadgeVariant};
  barColor?: string;
}

// web Tailwind bar classes -> native hex. 'bg-yellow-400' is what this widget
// passes; 'bg-blue-400' is the WidgetRankedList default. opacity-15 is applied
// via the rankedBar style so only the colour is resolved here.
const BAR_COLORS: Record<string, string> = {
  'bg-blue-400': '#60a5fa',
  'bg-yellow-400': '#facc15',
};

function resolveBarColor(barColor?: string): string {
  return (barColor && BAR_COLORS[barColor]) ?? BAR_COLORS['bg-blue-400'];
}

// ── shared inline badge (web @/components/ui Badge, variant subset) ──
function WidgetBadge({text, variant}: {text: string; variant: BadgeVariant}) {
  return (
    <View style={[styles.badge, badgeVariantStyles[variant]]}>
      <AppText
        style={badgeTextStyles[variant]}
        variant="caption"
        weight="semibold">
        {text}
      </AppText>
    </View>
  );
}

// ── shared inline transient empty state (web @/components/feedback EmptyState) ──
function WidgetEmptyState({
  icon,
  message,
  paddingVertical,
}: {
  icon?: ReactNode;
  message: string;
  paddingVertical: number;
}) {
  return (
    <View style={[styles.empty, {paddingVertical}]}>
      {icon ? <View style={styles.emptyIcon}>{icon}</View> : null}
      <AppText style={styles.emptyMessage} tone="muted" variant="caption">
        {message}
      </AppText>
    </View>
  );
}

// ── ./shared WidgetRankedList (ported inline) ──
interface WidgetRankedListProps {
  items: RankedItem[];
  maxItems?: number;
  compact?: boolean;
  showBars?: boolean;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
}

function WidgetRankedList({
  items,
  maxItems,
  compact = false,
  showBars = true,
  emptyMessage = 'No data available',
  emptyIcon,
}: WidgetRankedListProps) {
  const limit = maxItems ?? (compact ? 3 : 5);
  const hideBars = compact || !showBars;

  const visible = useMemo(() => {
    const sorted = [...items].sort((a, b) => b.value - a.value);
    return sorted.slice(0, limit);
  }, [items, limit]);

  const maxValue = useMemo(
    () => visible.reduce((max, item) => Math.max(max, item.value), 0),
    [visible],
  );

  if (visible.length === 0) {
    return (
      <WidgetEmptyState
        icon={emptyIcon}
        message={emptyMessage}
        paddingVertical={32}
      />
    );
  }

  return (
    <View style={styles.rankedList}>
      {visible.map((item, index) => {
        const barPct = maxValue > 0 ? (item.value / maxValue) * 100 : 0;

        return (
          <View key={item.id} style={styles.rankedRow}>
            {!hideBars ? (
              <View
                style={[
                  styles.rankedBar,
                  {
                    backgroundColor: resolveBarColor(item.barColor),
                    width: `${barPct}%` as DimensionValue,
                  },
                ]}
              />
            ) : null}

            <View style={styles.rankedContent}>
              <AppText
                style={styles.rankNumber}
                tone="muted"
                variant="caption"
                weight="semibold">
                {index + 1}
              </AppText>

              <AppText numberOfLines={1} style={styles.rankLabel}>
                {item.label}
              </AppText>

              {item.badge ? (
                <WidgetBadge text={item.badge.text} variant={item.badge.variant} />
              ) : null}

              <AppText style={styles.rankValue} weight="semibold">
                {item.formattedValue}
              </AppText>
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ── ./shared WidgetBigNumber (ported inline) ──
interface WidgetBigNumberProps {
  value: number | null;
  unit?: string;
  label?: string;
  subtitle?: string;
  badge?: {text: string; variant: BadgeVariant};
  valueColor?: string;
  nullDisplay?: string;
  animated?: boolean;
}

function WidgetBigNumber({
  value,
  unit,
  label,
  subtitle,
  badge,
  valueColor = colors.textPrimary,
  nullDisplay = '—',
  animated = true,
}: WidgetBigNumberProps) {
  return (
    <View style={styles.bigNumberRoot}>
      <View style={styles.bigNumberValueRow}>
        {value !== null ? (
          animated ? (
            <AnimatedNumber
              style={[styles.bigNumberValue, {color: valueColor}]}
              value={value}
            />
          ) : (
            <AppText style={[styles.bigNumberValue, {color: valueColor}]}>
              {value}
            </AppText>
          )
        ) : (
          <AppText style={styles.bigNumberValue} tone="muted">
            {nullDisplay}
          </AppText>
        )}
        {unit ? (
          <AppText style={styles.bigNumberUnit} tone="secondary">
            {unit}
          </AppText>
        ) : null}
      </View>

      {label ? (
        <AppText style={styles.bigNumberLabel} tone="muted" variant="caption">
          {label}
        </AppText>
      ) : null}

      {subtitle ? (
        <AppText
          style={styles.bigNumberSubtitle}
          tone="secondary"
          variant="caption">
          {subtitle}
        </AppText>
      ) : null}

      {badge ? <WidgetBadge text={badge.text} variant={badge.variant} /> : null}
    </View>
  );
}

// ── ./WidgetShell (ported inline, native-safe subset) ──
interface WidgetShellProps {
  title?: string;
  icon?: ReactNode;
  loading?: boolean;
  error?: string | null;
  children: ReactNode;
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
  // Pulse-on-data-change glow (web WidgetShell L59-80).
  const [justUpdated, setJustUpdated] = useState(false);
  const prevUpdatedAt = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (
      updatedAt &&
      updatedAt > 0 &&
      prevUpdatedAt.current !== undefined &&
      prevUpdatedAt.current !== updatedAt
    ) {
      setJustUpdated(true);
      const timer = setTimeout(() => setJustUpdated(false), 1500);
      prevUpdatedAt.current = updatedAt;
      return () => clearTimeout(timer);
    }
    prevUpdatedAt.current = updatedAt;
  }, [updatedAt]);

  if (loading) {
    return (
      <View
        accessibilityLabel="Loading"
        accessibilityRole="progressbar"
        style={styles.skeleton}
      />
    );
  }

  if (error) {
    return (
      <View style={styles.errorWrap}>
        <QueryError error={new Error(error)} />
      </View>
    );
  }

  const showFreshness = updatedAt !== undefined;
  // Compact (dot-only) when the widget has no title (typically 1×1 widgets).
  const freshnessCompact = !title;

  const freshnessEl = showFreshness ? (
    <DataFreshness
      compact={freshnessCompact}
      isError={isError ?? false}
      isFetching={isFetching ?? false}
      isStale={isStale ?? false}
      onRefresh={onRefresh}
      updatedAt={updatedAt && updatedAt > 0 ? updatedAt : null}
    />
  ) : null;

  return (
    <View style={[styles.shell, justUpdated && styles.shellPulse]}>
      {title ? (
        <View style={styles.header}>
          <View style={styles.titleGroup}>
            {icon}
            <AppText numberOfLines={1} style={styles.title}>
              {title}
            </AppText>
          </View>
          {freshnessEl}
        </View>
      ) : freshnessEl ? (
        <View style={styles.overlayFreshness}>{freshnessEl}</View>
      ) : null}
      <View style={styles.content}>{children}</View>
    </View>
  );
}

export default function SuperchargerHistoryWidget({size}: WidgetProps) {
  const t = useNativeTranslation();
  const {currencySymbol, fmt, precision} = useFormatPrefs();

  // useFormatting().formatCurrency: `${symbol}${fmtNumber(amount, d)}` (web L32-35).
  const formatCurrency = useCallback(
    (amount: number, decimals?: number) =>
      `${currencySymbol}${fmt(amount, decimals ?? precision)}`,
    [currencySymbol, fmt, precision],
  );

  // useUnits().formatEnergy: SI Wh -> kWh (wh / 1000) + ' kWh', locale-aware,
  // at the requested precision (web lib formatEnergy; energy pref fixed to kWh).
  const formatEnergy = useCallback(
    (wh: number | null | undefined, options?: {precision?: number}) =>
      isFiniteNumber(wh)
        ? `${fmt(wh / 1000, options?.precision ?? 1)} kWh`
        : FALLBACK,
    [fmt],
  );

  const {
    data,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useTeslaChargingHistory();

  // web L29 `data?.entries ?? []` is memoized so the fresh-array reference does
  // not destabilize the rankedItems useMemo dep (native react-hooks lint).
  const entries = useMemo(() => data?.entries ?? [], [data?.entries]);
  const summary = data?.summary;
  const isCompact = size.cols <= 1;

  const rankedItems: RankedItem[] = useMemo(() => {
    const sorted = [...entries]
      .sort(
        (a, b) =>
          new Date(b.charge_start_datetime).getTime() -
          new Date(a.charge_start_datetime).getTime(),
      )
      .slice(0, 10);

    return sorted.map(entry => {
      const wh = entry.usage_wh ?? 0;
      const cost = entry.total_due ?? 0;
      return {
        id: entry.id,
        label: entry.site_location_name ?? '—',
        value: wh,
        formattedValue: formatEnergy(wh, {precision: 1}),
        badge:
          cost > 0
            ? {text: formatCurrency(cost), variant: 'neutral' as const}
            : undefined,
        barColor: 'bg-yellow-400',
      };
    });
  }, [entries, formatCurrency, formatEnergy]);

  const totalWh = summary?.total_wh ?? 0;
  const totalSpend = summary?.total_spend ?? 0;

  // Compact: show 30-day Supercharger spend as big number
  if (isCompact) {
    return (
      <WidgetShell
        error={error ? String(error) : null}
        isError={isError}
        isFetching={isFetching}
        isStale={isStale}
        loading={isLoading}
        onRefresh={() => refetch()}
        updatedAt={dataUpdatedAt}>
        {entries.length > 0 ? (
          <WidgetBigNumber
            label={t(
              'widget.superchargerHistory.compactLabel',
              '30-day Supercharger',
            )}
            unit={t('widget.superchargerHistory.currencyUnit', '$')}
            value={totalSpend}
          />
        ) : (
          <WidgetEmptyState
            icon={<SemanticIcon decorative name="bolt" size="md" />}
            message={t(
              'widget.superchargerHistory.noData',
              'No Supercharger sessions',
            )}
            paddingVertical={16}
          />
        )}
      </WidgetShell>
    );
  }

  // Standard: list of sessions + totals
  return (
    <WidgetShell
      error={error ? String(error) : null}
      icon={<SemanticIcon decorative name="bolt" size="sm" />}
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={isLoading}
      onRefresh={() => refetch()}
      title={t('widget.superchargerHistory.title', 'Supercharger History')}
      updatedAt={dataUpdatedAt}>
      {entries.length > 0 ? (
        <View style={styles.standardRoot}>
          <View style={styles.listArea}>
            <WidgetRankedList
              emptyIcon={<SemanticIcon decorative name="bolt" size="md" />}
              emptyMessage={t(
                'widget.superchargerHistory.noData',
                'No Supercharger sessions',
              )}
              items={rankedItems}
              maxItems={10}
              showBars
            />
          </View>

          {/* Totals row */}
          <View style={styles.totalsRow}>
            <AppText
              style={styles.totalsLabel}
              tone="secondary"
              variant="caption">
              {t('widget.superchargerHistory.totals', '30-day totals')}
            </AppText>
            <View style={styles.totalsValues}>
              <AppText style={styles.totalsValue} weight="semibold">
                {formatEnergy(totalWh, {precision: 1})}
              </AppText>
              <AppText style={styles.totalsValue} weight="semibold">
                {formatCurrency(totalSpend)}
              </AppText>
            </View>
          </View>
        </View>
      ) : (
        <WidgetEmptyState
          icon={<SemanticIcon decorative name="bolt" size="md" />}
          message={t(
            'widget.superchargerHistory.noData',
            'No Supercharger sessions',
          )}
          paddingVertical={32}
        />
      )}
    </WidgetShell>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  bigNumberLabel: {
    fontSize: 10,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  bigNumberRoot: {
    alignItems: 'center',
    flex: 1,
    gap: 4,
    justifyContent: 'center',
  },
  bigNumberSubtitle: {
    fontSize: 12,
  },
  bigNumberUnit: {
    fontSize: 18,
  },
  bigNumberValue: {
    color: colors.textPrimary,
    fontSize: 30,
    fontWeight: '700',
  },
  bigNumberValueRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: 4,
  },
  content: {
    flex: 1,
    paddingBottom: 12,
    paddingHorizontal: 16,
  },
  empty: {
    alignItems: 'center',
    flex: 1,
    gap: 8,
    justifyContent: 'center',
  },
  emptyIcon: {
    marginBottom: 4,
  },
  emptyMessage: {
    textAlign: 'center',
  },
  errorWrap: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 16,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 4,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  listArea: {
    flex: 1,
    minHeight: 0,
  },
  overlayFreshness: {
    position: 'absolute',
    right: 6,
    top: 6,
    zIndex: 5,
  },
  rankLabel: {
    flex: 1,
    fontSize: 14,
  },
  rankNumber: {
    fontSize: 12,
    textAlign: 'right',
    width: 20,
  },
  rankValue: {
    color: colors.textPrimary,
    fontSize: 14,
    fontVariant: ['tabular-nums'],
  },
  rankedBar: {
    borderRadius: 8,
    bottom: 0,
    left: 0,
    opacity: 0.15,
    position: 'absolute',
    top: 0,
  },
  rankedContent: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  rankedList: {
    gap: 4,
  },
  rankedRow: {
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 44,
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingVertical: 8,
    position: 'relative',
  },
  shell: {
    flex: 1,
  },
  shellPulse: {
    elevation: 6,
    shadowColor: '#22c55e',
    shadowOffset: {width: 0, height: 0},
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    flex: 1,
    minHeight: 120,
  },
  standardRoot: {
    flex: 1,
    gap: 8,
  },
  title: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  titleGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  totalsLabel: {
    fontSize: 12,
  },
  totalsRow: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingTop: 8,
  },
  totalsValue: {
    color: colors.textPrimary,
    fontSize: 14,
    fontVariant: ['tabular-nums'],
  },
  totalsValues: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
});

const badgeVariantStyles = StyleSheet.create({
  error: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  neutral: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
  success: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  warning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
});

const badgeTextStyles = StyleSheet.create({
  error: {
    color: colors.danger,
  },
  neutral: {
    color: colors.textSecondary,
  },
  success: {
    color: colors.success,
  },
  warning: {
    color: colors.warning,
  },
});
