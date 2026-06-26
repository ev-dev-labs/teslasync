// Native parity port of web/src/features/dashboard/widgets/VampireDrainWidget.tsx.
//
// Dashboard widget that surfaces a vehicle's idle "vampire" battery drain: an
// average %/day stat (compact size shows only the colour-coded number), an
// optional wide-size sparkline of the last 30 daily drain rates, and a feed of
// recent drain events — each row colour-coded green/amber/red by severity. When
// neither stats nor events are available it falls back to an icon+message empty
// state. The web file pulls in browser-only or web-UI dependencies that are
// absent from the native parity manifest (contract rules 4, 5 & 7); each is
// replaced with a React Native-safe equivalent and documented here + in the
// sidecar:
//
//   - react-i18next useTranslation('dashboard') (web L2, L26) -> inlined
//     useNativeTranslation(): a stable (key, fallback, params?) => string shim
//     that returns the English fallback and reproduces i18next's `{{var}}`
//     interpolation (used by the eventCount sublabel) so every t(...) call keeps
//     its English default + translation-key + interpolation intent (the
//     established AlertFeed/RegenEfficiency port pattern, extended for params).
//   - lucide-react BatteryWarning (web L3, L65, L97, L131, L162, L168) -> an
//     inlined DrainIcon: a colourable native variant of the shared SemanticIcon
//     `batteryWarning` (glyph 'BW'). SemanticIcon's tone-based API cannot express
//     the web's dynamic per-value `drainColor` inline style (the green/amber/red
//     severity colour is THE visual intent of this widget), so the 'BW' glyph +
//     tinted rounded box are reproduced with RN primitives and accept a `color`
//     prop. lucide SVG has no native renderer.
//   - `@/components/data-display` StatCard (web L4, L128-140) -> the ported
//     native StatCard (same label/value/icon/sublabel props).
//   - `@/components/feedback` EmptyState (web L5, L167-171) + the feed's empty
//     branch -> an inlined WidgetEmptyState (icon + centered muted message): the
//     ported native tree has no shared EmptyState component, and the web calls
//     pass an icon + message, so the icon+message+centered layout is reproduced
//     with RN primitives (the RegenEfficiency port's inline empty-state
//     precedent). The web className py-4 collapses to a paddingVertical prop.
//   - `@/components/charts` Sparkline (web L6, L148-153) -> the ported native
//     Sparkline (same data/color/width/height props; renders the same projected
//     trend with native line segments instead of an SVG polyline).
//   - `@/api/hooks/useVehicles` useVehicles (web L7) -> the ported native
//     useVehicles hook (same '/vehicles' query, same UseQueryResult fields).
//   - `@/api/hooks/useEnergy` useVampireDrainStats / useVampireDrainEvents
//     (web L8) -> the ported native useEnergy hooks (same
//     '/vampire-drain/stats?vehicle_id=' and '/vampire-drain?vehicle_id=&limit='
//     queries, same VampireDrainStats / VampireDrainEvent shapes + the full
//     TanStack query result the shell reads). The 30-event limit is preserved.
//   - `@/lib/numberFormat` fmtNumber (web L9, L21-22, L66-67, L118, L130,
//     L136) -> the settings-derived `fmt` formatter from the ported
//     useFormatPrefs() (locale-aware fixed-precision, mirroring web numberFormat's
//     global locale/precision). It is threaded into the module-level
//     formatDuration the same way the web threads `t`.
//   - `./WidgetShell` WidgetShell (web L10, L95-109) -> inlined native WidgetShell
//     (the same skeleton/error/header/overlay-freshness/pulse subset already
//     ported by the AlertFeed/RegenEfficiency widgets); the unused
//     query/noPadding/actions/widgetId/dashboardId props are omitted. The web
//     standard-size help tooltip (help.vampireDrain.body) has no native hover
//     surface and is dropped (web only shows a "?" tooltip on hover).
//   - `./WidgetEventFeed` + type EventFeedItem from `./shared` (web L11,
//     L59-74, L158-163) -> inlined native WidgetEventFeed rendering the ported
//     native TimelineItem rows (same sort + slice + relative-time + empty-state
//     contract). Separate source files, not yet ported, so inlined here (the
//     AlertFeed port precedent).
//   - `./types` WidgetProps (web L12) -> inlined native WidgetSize/WidgetProps
//     (the vehicleId/size subset this widget reads).
//
// No DOM-only modules, HTML elements, react-i18next, lucide-react, Recharts,
// Leaflet, or web @/ UI components are imported -- only react, react-native
// primitives, the shared native AppText / theme tokens, and the ported parity
// StatCard / Sparkline / TimelineItem / DataFreshness / QueryError / useVehicles
// / useEnergy / useFormatPrefs.

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {colors} from '../../../../theme/tokens';
import {
  useVampireDrainEvents,
  useVampireDrainStats,
} from '../../../api/hooks/useEnergy';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {Sparkline} from '../../../components/charts/Sparkline';
import {DataFreshness} from '../../../components/data-display/DataFreshness';
import {StatCard} from '../../../components/data-display/StatCard';
import {TimelineItem} from '../../../components/data-display/TimelineItem';
import {useFormatPrefs} from '../../../components/data-display/format/_formatPrimitives';
import {QueryError} from '../../../components/feedback/QueryError';

// ── react-i18next useTranslation('dashboard') replacement ──
type NativeTParams = Record<string, string | number>;
type NativeTFunction = (
  key: string,
  fallback: string,
  params?: NativeTParams,
) => string;

// Returns the English fallback (preserving the translation-key intent) and
// reproduces i18next's `{{var}}` interpolation when params are supplied.
const nativeTranslate: NativeTFunction = (_key, fallback, params) => {
  if (!params) {
    return fallback;
  }
  return fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name)
      ? String(params[name])
      : `{{${name}}}`,
  );
};

function useNativeTranslation(): NativeTFunction {
  return nativeTranslate;
}

// Locale-aware fixed-precision formatter (web @/lib/numberFormat fmtNumber).
type NumberFormatter = (value: unknown, decimals?: number) => string;

// Web drainColor L14-18: <1%/day green, <3%/day amber, else red.
function drainColor(pctPerDay: number): string {
  if (pctPerDay < 1) {
    return '#10b981';
  }
  if (pctPerDay < 3) {
    return '#f59e0b';
  }
  return '#ef4444';
}

// Web formatDuration L20-23: <1h -> "Nm", else "N.Nh". Threads the
// settings-derived fmtNumber the same way the web threads `t`.
function formatDuration(
  hours: number,
  t: NativeTFunction,
  fmtNumber: NumberFormatter,
): string {
  if (hours < 1) {
    return `${fmtNumber(hours * 60, 0)}${t('widget.vampireDrain.min', 'm')}`;
  }
  return `${fmtNumber(hours, 1)}${t('widget.vampireDrain.hr', 'h')}`;
}

// ── lucide-react BatteryWarning replacement (colourable native variant) ──
// Static amber for the standard-size title icon (web text-neon-amber).
const TITLE_ICON_HEX = '#f59e0b';
// Muted slate for the default (uncoloured) empty-state icons (web inherits the
// EmptyState muted text colour).
const MUTED_ICON_HEX = '#94a3b8';

type DrainIconSize = 'sm' | 'md' | 'lg';

interface DrainIconProps {
  color: string;
  size?: DrainIconSize;
}

// Append a 2-digit hex alpha only to a #rrggbb colour (the drain/title/muted
// hexes); leaves other formats untouched so the tint maths stays valid.
function withAlpha(hex: string, alpha: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? `${hex}${alpha}` : hex;
}

function DrainIcon({color, size = 'sm'}: DrainIconProps) {
  return (
    <View
      style={[
        styles.drainIcon,
        drainIconSizeStyles[size],
        {
          backgroundColor: withAlpha(color, '1f'),
          borderColor: withAlpha(color, '40'),
        },
      ]}>
      <AppText
        style={[styles.drainGlyph, drainGlyphSizeStyles[size], {color}]}
        weight="bold">
        BW
      </AppText>
    </View>
  );
}

// ── @/components/feedback EmptyState (ported inline as icon + message) ──
interface WidgetEmptyStateProps {
  icon: ReactNode;
  message: string;
  paddingVertical: number;
}

function WidgetEmptyState({icon, message, paddingVertical}: WidgetEmptyStateProps) {
  // Transient empty state — surfaces when source data is missing; no specific
  // recovery action available (matches the web EmptyState no-action comment).
  return (
    <View style={[styles.empty, {paddingVertical}]}>
      {icon ? <View style={styles.emptyIcon}>{icon}</View> : null}
      <AppText style={styles.emptyMessage} tone="muted" variant="caption">
        {message}
      </AppText>
    </View>
  );
}

// ── ./shared EventFeedItem + WidgetEventFeed (ported inline) ──
interface EventFeedItem {
  id: string | number;
  icon: ReactNode;
  title: string;
  subtitle?: string;
  timestamp: string;
  color: string;
  severity?: 'info' | 'warning' | 'critical';
  href?: string;
}

interface WidgetEventFeedProps {
  items: EventFeedItem[];
  maxItems?: number;
  compact?: boolean;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
}

// @/hooks/useDateFormat formatDateTime fallback (native-safe Intl).
function formatDateTime(isoStr: string): string {
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) {
    return isoStr;
  }
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
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
  return formatDateTime(isoStr);
}

function WidgetEventFeed({
  items,
  maxItems,
  compact = false,
  emptyMessage,
  emptyIcon,
}: WidgetEventFeedProps) {
  const limit = maxItems ?? (compact ? 3 : 10);

  const sorted = useMemo(
    () =>
      [...items]
        .sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
        )
        .slice(0, limit),
    [items, limit],
  );

  if (sorted.length === 0) {
    return (
      <WidgetEmptyState
        icon={emptyIcon ?? null}
        message={emptyMessage ?? 'No events yet'}
        paddingVertical={16}
      />
    );
  }

  return (
    <ScrollView nestedScrollEnabled style={styles.feed}>
      {sorted.map((item, i) => (
        <TimelineItem
          key={item.id}
          color={item.color}
          href={item.href}
          icon={item.icon}
          isLast={i === sorted.length - 1}
          subtitle={item.subtitle}
          time={formatRelativeTime(item.timestamp)}
          title={item.title}
        />
      ))}
    </ScrollView>
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

export default function VampireDrainWidget({size, vehicleId}: WidgetProps) {
  const t = useNativeTranslation();
  const {fmt: fmtNumber} = useFormatPrefs();
  const {data: vehicles} = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? null;
  const idStr = id != null ? String(id) : null;

  const {
    data: stats,
    isLoading: statsLoading,
    isFetching: statsFetching,
    isStale: statsStale,
    isError: statsError,
    dataUpdatedAt: statsUpdatedAt,
    refetch: refetchStats,
  } = useVampireDrainStats(idStr);

  const {
    data: rawEvents,
    isLoading: eventsLoading,
    isFetching: eventsFetching,
    isStale: eventsStale,
    isError: eventsError,
    dataUpdatedAt: eventsUpdatedAt,
    refetch: refetchEvents,
  } = useVampireDrainEvents(idStr, 30);

  // Memoized so the reference only changes with rawEvents (the web `rawEvents ??
  // []` is recreated each render; native useMemo deps require a stable array).
  const events = useMemo(() => rawEvents ?? [], [rawEvents]);
  const isLoading = statsLoading || eventsLoading;
  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  const avgDrainPctPerDay = (stats?.avg_drain_rate ?? 0) * 24;

  // Map drain events → EventFeedItem[] for the shared feed.
  const eventItems: EventFeedItem[] = useMemo(
    () =>
      events.map(ev => {
        const drainDay = (ev.drain_rate_pct_per_hour ?? 0) * 24;
        return {
          id: ev.id,
          icon: <DrainIcon color={drainColor(drainDay)} size="sm" />,
          title: `${fmtNumber(ev.battery_lost ?? 0, 1)}% · ${formatDuration(
            ev.duration_hours ?? 0,
            t,
            fmtNumber,
          )}${
            ev.sentry_mode ? ` · ${t('widget.vampireDrain.sentry', 'Sentry')}` : ''
          }`,
          subtitle: `${fmtNumber(drainDay, 1)}%/${t(
            'widget.vampireDrain.perDay',
            '/day',
          ).replace('/', '')}`,
          timestamp: ev.start_date,
          color: drainColor(drainDay),
          severity:
            drainDay >= 3
              ? ('critical' as const)
              : drainDay >= 1
              ? ('warning' as const)
              : ('info' as const),
        };
      }),
    [events, t, fmtNumber],
  );

  // Sparkline: daily drain rate from events (most recent 30).
  const sparklineData = useMemo(() => {
    if (events.length === 0) {
      return [];
    }
    return events
      .slice()
      .reverse()
      .map(e => (e.drain_rate_pct_per_hour ?? 0) * 24);
  }, [events]);

  const updatedAt = Math.max(statsUpdatedAt ?? 0, eventsUpdatedAt ?? 0);

  const handleRefresh = () => {
    refetchStats();
    refetchEvents();
  };

  const hasData = stats != null || events.length > 0;

  return (
    <WidgetShell
      icon={
        isCompact ? undefined : <DrainIcon color={TITLE_ICON_HEX} size="sm" />
      }
      isError={statsError || eventsError}
      isFetching={statsFetching || eventsFetching}
      isStale={statsStale || eventsStale}
      loading={isLoading}
      onRefresh={handleRefresh}
      title={
        isCompact ? undefined : t('widget.vampireDrain.title', 'Vampire Drain')
      }
      updatedAt={updatedAt}>
      {hasData ? (
        isCompact ? (
          // ── Compact (1×2): single stat ──
          <View style={styles.compactCenter}>
            <AppText
              style={[
                styles.compactValue,
                {color: drainColor(avgDrainPctPerDay)},
              ]}
              weight="bold">
              {`${fmtNumber(avgDrainPctPerDay, 1)}%`}
            </AppText>
            <AppText style={styles.compactLabel} tone="muted">
              {t('widget.vampireDrain.perDay', '/day')}
            </AppText>
          </View>
        ) : (
          // ── Standard / Wide ──
          <View style={styles.standardRoot}>
            <StatCard
              icon={
                <DrainIcon color={drainColor(avgDrainPctPerDay)} size="md" />
              }
              label={t('widget.vampireDrain.avgDrain', 'Avg Drain')}
              sublabel={
                stats
                  ? t(
                      'widget.vampireDrain.eventCount',
                      '{{count}} events · {{hours}}h total',
                      {
                        count: stats.event_count ?? 0,
                        hours: fmtNumber(stats.total_hours ?? 0, 0),
                      },
                    )
                  : undefined
              }
              value={`${fmtNumber(avgDrainPctPerDay, 1)}%/day`}
            />

            {isWide && sparklineData.length > 1 ? (
              <View style={styles.sparklineBlock}>
                <AppText style={styles.sparklineLabel} tone="muted">
                  {t(
                    'widget.vampireDrain.trend',
                    'Daily drain rate (last 30)',
                  )}
                </AppText>
                <Sparkline
                  color={drainColor(avgDrainPctPerDay)}
                  data={sparklineData}
                  height={36}
                  width={260}
                />
              </View>
            ) : null}

            <WidgetEventFeed
              emptyIcon={<DrainIcon color={MUTED_ICON_HEX} size="md" />}
              emptyMessage={t(
                'widget.vampireDrain.noEvents',
                'No recent drain events',
              )}
              items={eventItems}
              maxItems={5}
            />
          </View>
        )
      ) : (
        <WidgetEmptyState
          icon={<DrainIcon color={MUTED_ICON_HEX} size="lg" />}
          message={t('widget.vampireDrain.noData', 'No vampire drain data')}
          paddingVertical={16}
        />
      )}
    </WidgetShell>
  );
}

const styles = StyleSheet.create({
  compactCenter: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    minHeight: 44,
  },
  compactLabel: {
    fontSize: 10,
  },
  compactValue: {
    fontSize: 24,
  },
  content: {
    flex: 1,
    paddingBottom: 12,
    paddingHorizontal: 16,
  },
  drainGlyph: {
    letterSpacing: 0.4,
  },
  drainIcon: {
    alignItems: 'center',
    borderWidth: 1,
    justifyContent: 'center',
    overflow: 'hidden',
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
  feed: {
    flex: 1,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 4,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  overlayFreshness: {
    position: 'absolute',
    right: 6,
    top: 6,
    zIndex: 5,
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
  sparklineBlock: {
    flexShrink: 0,
  },
  sparklineLabel: {
    fontSize: 10,
    marginBottom: 4,
  },
  standardRoot: {
    flex: 1,
    gap: 12,
    minHeight: 0,
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
});

const drainIconSizeStyles = StyleSheet.create({
  lg: {
    borderRadius: 12,
    height: 34,
    width: 34,
  },
  md: {
    borderRadius: 10,
    height: 30,
    width: 30,
  },
  sm: {
    borderRadius: 8,
    height: 26,
    width: 26,
  },
});

const drainGlyphSizeStyles = StyleSheet.create({
  lg: {
    fontSize: 12,
    lineHeight: 16,
  },
  md: {
    fontSize: 10,
    lineHeight: 14,
  },
  sm: {
    fontSize: 9,
    lineHeight: 12,
  },
});
