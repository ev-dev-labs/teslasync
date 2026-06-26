/**
 * MQTT Inspector Page — native parity port of
 * web/src/features/telemetry/pages/MQTTInspectorPage.tsx.
 *
 * Operator surface for the `/telemetry` MQTT broker status route: a connection
 * banner, four summary StatCards (streaming vehicles / total signals / total
 * batches / signals-per-second), the broker connection-info panel (broker host,
 * uptime, topic patterns), the opt-in Helix AI stream explainer, a rolling
 * signal-throughput chart (delta of total signals between 5s polls, last 60
 * points), and a per-vehicle breakdown.
 *
 * Behaviour, state names (throughputHistory + prevTotalRef), the
 * `useMQTTStatus()` data source (same `/telemetry` API + 5s poll), the
 * STALE_THRESHOLD=120s freshness rule, the throughput delta/clamp/slice(-60)
 * logic, the 30-minute AI window, and every i18n key + English fallback are
 * preserved.
 *
 * Native adaptations vs. the web source (DOM/Recharts/lucide have no RN form):
 *   - web `layout` `PageContainer` (title/subtitle header + actions slot) -> an
 *     inline RN PageScaffold: a ScrollView with the same title + subtitle and an
 *     actions row. The web loading/error/empty gating props are not passed by
 *     this page, so they are not reproduced (each section owns its own state).
 *   - web `motion` `FadeIn` (framer-motion, `delay` prop) -> an inline RN
 *     Animated FadeIn (fade + slide-up, same per-section delays, reduced-motion
 *     aware via AccessibilityInfo).
 *   - web `ui` `Badge` (success/neutral/warning/danger + `dot`) -> an inline RN
 *     Badge chip. The connection `<Wifi/>`/`<WifiOff/>` lucide glyphs collapse
 *     into the badge's status dot + colour (same connected/disconnected intent);
 *     the actions `<RefreshCw/>` hint becomes a "↻" caption; the AlertTriangle
 *     error/stale glyphs become "⚠" (matching the parity DLQ banner convention).
 *   - web `data-display` `StatCard` (lucide `Radio` icon) -> an inline native
 *     StatCard (GlassPanel + the canonical SemanticIcon "radio").
 *   - web `charts` Recharts `AreaChart`/`Area`/axes/`Tooltip`/`ChartGradient`
 *     (DOM/SVG) -> the `AreaChartWrapper` parity sibling: a single "signals"
 *     native series with a latest-value summary (hover tooltips + SVG gradients
 *     are unavailable in React Native).
 *   - web `ui` `DataTable` (virtualized, paginated, `Column` renderers) -> a
 *     native VehicleRow card list. Each card keeps every column the web table
 *     had: VIN (mono header) + State badge + Live/Stale status badge on top, then
 *     a KVList of Signals / Batches / Sig/sec / Last Received. The web
 *     virtualization/pagination/maxHeight are dropped — the page ScrollView
 *     scrolls the full list (same precedent as the parity DLQ EntriesTable).
 *   - web `feedback` `Skeleton`/`EmptyState` -> inline skeleton blocks + the
 *     canonical native EmptyState (which requires a title, so a generic
 *     `mqtt.empty` "No data" title is paired with the web message).
 *   - `@/components/ai` `AIMqttSseInspectorExplanations` -> the native parity
 *     component (same `fromUnix`/`toUnix` props, same redacted-envelope intent).
 *   - `@/hooks/useDateFormat` (`formatTime`/`formatRelative`) -> an inline native
 *     useDateFormat returning the same two stable formatters (hour:minute time
 *     label + relative "Xm ago" label).
 *   - `@/lib/numberFormat` `fmtInt`/`fmtNumber` + `formatUptime` -> ported inline
 *     (en-US, default precision 2 — the web global precision/locale wiring is not
 *     present in this parity tree).
 *   - `@/hooks/usePageTitle` -> a native-safe no-op (RN has no document.title).
 *   - react-i18next `useTranslation` -> a native-safe `t(key, fallback)` fallback
 *     preserving every key + English default.
 *   - `VehicleTelemetry` imported from the native useTelemetry hook (which
 *     re-exports it) rather than `@/types/telemetry`.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {
  SemanticIcon,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {
  useMQTTStatus,
  type VehicleTelemetry,
} from '../../../api/hooks/useTelemetry';
import {AIMqttSseInspectorExplanations} from '../../../components/ai/AIMqttSseInspectorExplanations';
import {AreaChartWrapper} from '../../../components/charts/AreaChartWrapper';
import {KVList, type KVItem} from '../../../components/data-display/KVList';

// ---- Native-safe i18n fallback (web react-i18next useTranslation) -----------

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback) => fallback, []);
}

// ---- Native-safe usePageTitle (web @/hooks/usePageTitle) --------------------

/**
 * Web `usePageTitle` writes `document.title`. React Native has no browser tab,
 * so this is a no-op that preserves the call site + argument (the `title`
 * dependency mirrors the web hook so it re-runs on title changes).
 */
function usePageTitle(title: string): void {
  useEffect(() => {
    // Intentional no-op on native — no document.title to write.
  }, [title]);
}

// ---- Ported number formatting (web @/lib/numberFormat) ----------------------

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Locale-aware fixed-precision number (web `fmtNumber`). The web global
 * precision/locale (set by useSettings) is not wired into this parity tree, so
 * the web defaults — precision 2, en-US — are used directly.
 */
function fmtNumber(value: unknown, decimals = 2): string {
  const n = safeNumber(value);
  try {
    return n.toLocaleString('en-US', {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  } catch {
    return n.toFixed(decimals);
  }
}

/** Locale-aware integer (web `fmtInt` = `fmtNumber(v, 0)`). */
function fmtInt(value: unknown): string {
  return fmtNumber(value, 0);
}

/** Uptime helper ported verbatim from the web source (L32-35). */
function formatUptime(seconds: number): string {
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m`;
  }
  return `${Math.floor(seconds / 3600)}h ${fmtInt((seconds % 3600) / 60)}m`;
}

// ---- Inline useDateFormat (web @/hooks/useDateFormat) ------------------------

/** Web `formatTime` — locale time label (hour:minute), "—" for null/unparseable. */
function formatTimeLabel(value: Date | string | null | undefined): string {
  if (!value) {
    return '—';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleTimeString(undefined, {hour: '2-digit', minute: '2-digit'});
}

/** Web `formatRelative` — "just now" / "Xm ago" / "Xh ago" / "Xd ago" / absolute. */
function formatRelativeLabel(value: string | Date | null | undefined): string {
  if (!value) {
    return '—';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
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
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

interface DateFormatters {
  formatRelative: (value: string | Date | null | undefined) => string;
  formatTime: (value: Date | string | null | undefined) => string;
}

function useDateFormat(): DateFormatters {
  const formatRelative = useCallback(formatRelativeLabel, []);
  const formatTime = useCallback(formatTimeLabel, []);
  return {formatRelative, formatTime};
}

// ---- Inline FadeIn (web motion FadeIn — framer-motion) ----------------------

function FadeIn({
  children,
  delay = 0,
  style,
}: {
  children: ReactNode;
  delay?: number;
  style?: StyleProp<ViewStyle>;
}): React.ReactElement {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then(reduce => {
        if (cancelled) {
          return;
        }
        if (reduce) {
          progress.setValue(1);
          return;
        }
        Animated.timing(progress, {
          delay: delay * 1000,
          duration: 400,
          easing: Easing.out(Easing.ease),
          toValue: 1,
          useNativeDriver: true,
        }).start();
      })
      .catch(() => progress.setValue(1));
    return () => {
      cancelled = true;
    };
  }, [delay, progress]);

  return (
    <Animated.View
      style={[
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [12, 0],
              }),
            },
          ],
        },
        style,
      ]}>
      {children}
    </Animated.View>
  );
}

// ---- Inline PageScaffold (web layout PageContainer) -------------------------

function PageScaffold({
  actions,
  children,
  subtitle,
  title,
}: {
  actions?: ReactNode;
  children: ReactNode;
  subtitle: string;
  title: string;
}): React.ReactElement {
  return (
    <ScrollView contentContainerStyle={styles.scrollContent} style={styles.scroll}>
      <View style={styles.pageHeader}>
        <AppText variant="display" weight="bold">
          {title}
        </AppText>
        <AppText tone="muted" variant="caption">
          {subtitle}
        </AppText>
        {actions ? <View style={styles.headerActions}>{actions}</View> : null}
      </View>
      {children}
    </ScrollView>
  );
}

// ---- Inline Badge (web ui Badge) -------------------------------------------

type BadgeVariant = 'success' | 'warning' | 'danger' | 'neutral';

const BADGE_THEME: Record<
  BadgeVariant,
  {bg: string; border: string; fg: string}
> = {
  danger: {bg: colors.dangerSurface, border: colors.dangerBorder, fg: colors.danger},
  neutral: {bg: colors.surfaceRaised, border: colors.border, fg: colors.textSecondary},
  success: {bg: colors.successSurface, border: colors.successBorder, fg: colors.success},
  warning: {bg: colors.warningSurface, border: colors.warningBorder, fg: colors.warning},
};

function Badge({
  dot,
  label,
  variant,
}: {
  dot?: boolean;
  label: string;
  variant: BadgeVariant;
}): React.ReactElement {
  const theme = BADGE_THEME[variant];
  return (
    <View
      style={[styles.badge, {backgroundColor: theme.bg, borderColor: theme.border}]}>
      {dot ? <View style={[styles.badgeDot, {backgroundColor: theme.fg}]} /> : null}
      <AppText
        style={[styles.badgeText, {color: theme.fg}]}
        variant="caption"
        weight="semibold">
        {label}
      </AppText>
    </View>
  );
}

// ---- Inline StatCard (web data-display StatCard) ----------------------------

function StatCard({
  icon,
  label,
  value,
}: {
  icon: SemanticIconName;
  label: string;
  value: string | number;
}): React.ReactElement {
  return (
    <GlassPanel style={styles.statCard}>
      <View style={styles.statCardHeader}>
        <SemanticIcon decorative name={icon} size="sm" />
        <AppText style={styles.statCardLabel} tone="muted" variant="caption">
          {label}
        </AppText>
      </View>
      <AppText style={styles.statCardValue} weight="bold">
        {value}
      </AppText>
    </GlassPanel>
  );
}

// ---- VehicleRow (web buildVehicleColumns DataTable row) ---------------------

function VehicleRow({
  formatRelative,
  t,
  vehicle,
}: {
  formatRelative: (value: string | Date | null | undefined) => string;
  t: NativeTFunction;
  vehicle: VehicleTelemetry;
}): React.ReactElement {
  const isStale =
    !vehicle.lastReceived ||
    (Date.now() - new Date(vehicle.lastReceived).getTime()) / 1000 >
      STALE_THRESHOLD;

  const items: KVItem[] = [
    {
      label: t('mqtt.signals', 'Signals'),
      value: <AppText style={styles.mono}>{fmtInt(vehicle.signalCount)}</AppText>,
    },
    {
      label: t('mqtt.batches', 'Batches'),
      value: <AppText style={styles.mono}>{fmtInt(vehicle.batchCount)}</AppText>,
    },
    {
      label: t('mqtt.sigPerSec', 'Sig/sec'),
      value: (
        <AppText style={styles.mono}>
          {vehicle.signalsPerSecond != null
            ? fmtNumber(vehicle.signalsPerSecond)
            : '—'}
        </AppText>
      ),
    },
    {
      label: t('mqtt.lastReceived', 'Last Received'),
      value: vehicle.lastReceived ? formatRelative(vehicle.lastReceived) : '—',
    },
  ];

  return (
    <View style={styles.vehicleCard}>
      <View style={styles.vehicleHeader}>
        <AppText style={styles.vin} weight="semibold">
          {vehicle.vin}
        </AppText>
        <View style={styles.vehicleBadges}>
          {vehicle.state ? (
            <Badge
              label={vehicle.state}
              variant={vehicle.state === 'online' ? 'success' : 'neutral'}
            />
          ) : (
            <AppText tone="muted">—</AppText>
          )}
          <Badge
            dot
            label={isStale ? t('mqtt.stale', 'Stale') : t('mqtt.live', 'Live')}
            variant={isStale ? 'warning' : 'success'}
          />
        </View>
      </View>
      <KVList items={items} />
    </View>
  );
}

// ---- Constants & types (web L25-30) ----------------------------------------

const STALE_THRESHOLD = 120;

// Web uses `interface ThroughputPoint`; native uses a type alias so it stays
// structurally assignable to AreaChartWrapper's `Record<string, unknown>[]`
// data prop (object type aliases gain an implicit index signature, interfaces
// do not). Shape ({time, signals}) is unchanged.
type ThroughputPoint = {
  signals: number;
  time: string;
};

// ---- Page (web MQTTInspectorPage) ------------------------------------------

export default function MQTTInspectorPage(): React.ReactElement {
  const t = useNativeTranslationFallback();
  const {formatRelative, formatTime} = useDateFormat();
  usePageTitle(t('mqtt.title', 'MQTT Inspector'));

  const {data: status, error, isLoading} = useMQTTStatus();

  // ---- throughput history ----
  const [throughputHistory, setThroughputHistory] = useState<ThroughputPoint[]>(
    [],
  );
  const prevTotalRef = useRef<number | null>(null);

  const vehicles = useMemo<VehicleTelemetry[]>(() => {
    const rawVehicles = status?.vehicles;
    return Array.isArray(rawVehicles) ? rawVehicles : [];
  }, [status]);
  const totalSignals = vehicles.reduce((sum, v) => sum + (v.signalCount ?? 0), 0);
  const totalBatches = vehicles.reduce((sum, v) => sum + (v.batchCount ?? 0), 0);
  const totalRate = vehicles.reduce(
    (sum, v) => sum + (v.signalsPerSecond ?? 0),
    0,
  );

  useEffect(() => {
    if (totalSignals === 0 && prevTotalRef.current === null) {
      return;
    }
    const delta =
      prevTotalRef.current !== null ? totalSignals - prevTotalRef.current : 0;
    prevTotalRef.current = totalSignals;
    if (delta >= 0) {
      const now = formatTime(new Date());
      setThroughputHistory(prev =>
        [...prev, {signals: Math.max(delta, 0), time: now}].slice(-60),
      );
    }
  }, [formatTime, totalSignals]);

  const staleVehicles = useMemo(
    () =>
      vehicles.filter(v => {
        if (!v.lastReceived) {
          return true;
        }
        return (
          (Date.now() - new Date(v.lastReceived).getTime()) / 1000 >
          STALE_THRESHOLD
        );
      }),
    [vehicles],
  );

  const throughputSeries = useMemo(
    () => [{color: '#00f0ff', key: 'signals', label: t('mqtt.signals', 'Signals')}],
    [t],
  );

  // AI explainer window: derive (fromUnix, toUnix) from the current time so the
  // in-scope window covers the most recent 30 minutes of broker activity.
  // Recomputed once per mount so the body reference stays stable between renders.
  const aiWindow = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    return {fromUnix: now - 30 * 60, toUnix: now};
  }, []);

  return (
    <PageScaffold
      actions={
        <View style={styles.actionsRow}>
          <AppText tone="muted" variant="caption">
            {`↻ ${t('mqtt.refreshInterval', 'Refreshes every 5s')}`}
          </AppText>
          <Badge
            dot
            label={
              status?.connected
                ? t('mqtt.connected', 'Connected')
                : t('mqtt.disconnected', 'Disconnected')
            }
            variant={status?.connected ? 'success' : 'danger'}
          />
        </View>
      }
      subtitle={t('mqtt.subtitle', 'MQTT connection status and streaming telemetry')}
      title={t('mqtt.title', 'MQTT Inspector')}>
      <View style={styles.body}>
        {error && !status ? (
          <FadeIn>
            <GlassPanel style={styles.errorPanel}>
              <AppText style={styles.errorGlyph}>⚠</AppText>
              <View style={styles.errorBody}>
                <AppText style={styles.errorTitle} weight="semibold">
                  {t('mqtt.fetchError', 'Unable to load MQTT status')}
                </AppText>
                <AppText style={styles.errorMessage} variant="caption">
                  {(error as Error)?.message ?? String(error)}
                </AppText>
              </View>
            </GlassPanel>
          </FadeIn>
        ) : null}

        {/* Summary Cards */}
        <FadeIn delay={0.1}>
          <View style={styles.statGrid}>
            <StatCard
              icon="radio"
              label={t('mqtt.streamingVehicles', 'Streaming Vehicles')}
              value={isLoading ? '—' : vehicles.length}
            />
            <StatCard
              icon="radio"
              label={t('mqtt.totalSignals', 'Total Signals')}
              value={isLoading ? '—' : fmtInt(totalSignals)}
            />
            <StatCard
              icon="radio"
              label={t('mqtt.totalBatches', 'Total Batches')}
              value={isLoading ? '—' : fmtInt(totalBatches)}
            />
            <StatCard
              icon="radio"
              label={t('mqtt.signalsPerSec', 'Signals / sec')}
              value={isLoading ? '—' : fmtNumber(totalRate)}
            />
          </View>
        </FadeIn>

        {/* Connection Info */}
        <FadeIn delay={0.15}>
          <GlassPanel style={styles.panel}>
            {status ? (
              <View style={styles.connectionInfo}>
                {status.broker ? (
                  <View style={styles.connectionItem}>
                    <AppText tone="muted" variant="caption">
                      {t('mqtt.broker', 'Broker')}
                    </AppText>
                    <AppText style={styles.connectionValue}>{status.broker}</AppText>
                  </View>
                ) : null}
                {status.uptimeSeconds != null ? (
                  <View style={styles.connectionItem}>
                    <AppText tone="muted" variant="caption">
                      {t('mqtt.uptime', 'Uptime')}
                    </AppText>
                    <AppText style={styles.connectionValue}>
                      {formatUptime(status.uptimeSeconds)}
                    </AppText>
                  </View>
                ) : null}
                {status.topics && status.topics.length > 0 ? (
                  <View style={styles.connectionItem}>
                    <AppText tone="muted" variant="caption">
                      {t('mqtt.topicPatterns', 'Topic Patterns')}
                    </AppText>
                    <View style={styles.topicWrap}>
                      {status.topics.map(topic => (
                        <Badge key={topic} label={topic} variant="neutral" />
                      ))}
                    </View>
                  </View>
                ) : (
                  <EmptyState
                    message={t('mqtt.noTopics', 'No MQTT topics detected')}
                    title={t('mqtt.empty', 'No data')}
                  />
                )}
              </View>
            ) : (
              <EmptyState
                message={t('mqtt.noStatus', 'MQTT broker status not available')}
                title={t('mqtt.empty', 'No data')}
              />
            )}
          </GlassPanel>
        </FadeIn>

        {/* Opt-in AI explainer. */}
        <FadeIn delay={0.18}>
          <AIMqttSseInspectorExplanations
            fromUnix={aiWindow.fromUnix}
            toUnix={aiWindow.toUnix}
          />
        </FadeIn>

        {/* Throughput Chart */}
        <FadeIn delay={0.2}>
          <GlassPanel style={styles.panel}>
            <AppText style={styles.sectionTitle} weight="semibold">
              {t('mqtt.signalThroughput', 'Signal Throughput')}
            </AppText>
            {throughputHistory.length > 2 ? (
              <AreaChartWrapper
                data={throughputHistory}
                height={200}
                series={throughputSeries}
                xKey="time"
                yFormatter={value => fmtInt(value)}
              />
            ) : (
              <View style={styles.chartPlaceholder}>
                <AppText
                  style={styles.chartPlaceholderText}
                  tone="muted"
                  variant="caption">
                  {t('mqtt.collectingData', 'Collecting throughput data…')}
                </AppText>
              </View>
            )}
          </GlassPanel>
        </FadeIn>

        {/* Vehicle Breakdown */}
        <FadeIn delay={0.3}>
          <GlassPanel style={styles.panel}>
            <View style={styles.vehicleSectionHeader}>
              <View style={styles.vehicleTitleRow}>
                <AppText style={styles.sectionTitle} weight="semibold">
                  {t('mqtt.vehicleBreakdown', 'Vehicle Breakdown')}
                </AppText>
                {vehicles.length > 0 ? (
                  <AppText style={styles.vehicleCount} variant="caption">
                    {`${vehicles.length} ${t('mqtt.vehicles', 'vehicles')}`}
                  </AppText>
                ) : null}
              </View>
              {staleVehicles.length > 0 ? (
                <View style={styles.staleIndicator}>
                  <AppText style={styles.staleText}>⚠</AppText>
                  <AppText style={styles.staleText} variant="caption">
                    {`${staleVehicles.length} ${t('mqtt.stale', 'stale')}`}
                  </AppText>
                </View>
              ) : null}
            </View>

            {isLoading ? (
              <View style={styles.skeletonGroup}>
                {[0, 1, 2].map(i => (
                  <View key={i} style={styles.skeleton} />
                ))}
              </View>
            ) : vehicles.length > 0 ? (
              <View style={styles.vehicleList}>
                {vehicles.map(vehicle => (
                  <VehicleRow
                    formatRelative={formatRelative}
                    key={vehicle.vin}
                    t={t}
                    vehicle={vehicle}
                  />
                ))}
              </View>
            ) : (
              <EmptyState
                message={t('mqtt.noVehicles', 'No vehicles currently streaming')}
                title={t('mqtt.empty', 'No data')}
              />
            )}
          </GlassPanel>
        </FadeIn>
      </View>
    </PageScaffold>
  );
}

const styles = StyleSheet.create({
  actionsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 9999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeDot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  badgeText: {
    lineHeight: 16,
  },
  body: {
    gap: spacing.lg,
  },
  chartPlaceholder: {
    alignItems: 'center',
    height: 192,
    justifyContent: 'center',
  },
  chartPlaceholderText: {
    textAlign: 'center',
  },
  connectionInfo: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
  },
  connectionItem: {
    gap: spacing.xs,
  },
  connectionValue: {
    color: colors.textPrimary,
    fontFamily: 'monospace',
    fontSize: 13,
  },
  errorBody: {
    flex: 1,
    gap: spacing.xs,
  },
  errorGlyph: {
    color: colors.danger,
  },
  errorMessage: {
    color: colors.textMuted,
  },
  errorPanel: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  errorTitle: {
    color: colors.danger,
  },
  headerActions: {
    marginTop: spacing.sm,
  },
  mono: {
    color: colors.textPrimary,
    fontFamily: 'monospace',
    fontSize: 13,
  },
  pageHeader: {
    gap: spacing.xs,
  },
  panel: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  scroll: {
    backgroundColor: colors.background,
    flex: 1,
  },
  scrollContent: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  sectionTitle: {
    fontSize: 14,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    height: 56,
  },
  skeletonGroup: {
    gap: spacing.sm,
  },
  staleIndicator: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  staleText: {
    color: colors.warning,
  },
  statCard: {
    flexBasis: '47%',
    flexGrow: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  statCardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  statCardLabel: {
    flexShrink: 1,
  },
  statCardValue: {
    fontSize: 20,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  topicWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  vehicleBadges: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  vehicleCard: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  vehicleCount: {
    color: colors.textMuted,
  },
  vehicleHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  vehicleList: {
    gap: spacing.sm,
  },
  vehicleSectionHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  vehicleTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  vin: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontFamily: 'monospace',
    fontSize: 13,
  },
});
