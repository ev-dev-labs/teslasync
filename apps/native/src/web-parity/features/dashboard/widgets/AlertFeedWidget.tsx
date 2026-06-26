// Native parity port of web/src/features/dashboard/widgets/AlertFeedWidget.tsx.
//
// Dashboard widget that renders the most recent fleet alerts as a severity-iconed
// event feed inside a widget shell (title + freshness chip + loading/error states).
// The web file pulls in browser-only dependencies that are absent from the native
// parity manifest (contract rules 4, 5 & 7); each is replaced with a React
// Native-safe equivalent and documented here + in the sidecar:
//
//   - react-i18next `useTranslation('dashboard')` (web L2, L33) -> inlined
//     useNativeTranslation(): a stable (key, fallback) => fallback shim so every
//     t('widget.alertFeed', 'Alert Feed') / t('widget.noAlerts', 'No alerts yet')
//     call keeps its English default + translation-key intent (the established
//     RecentActivity port pattern).
//   - lucide-react Bell / AlertTriangle / Info / AlertOctagon / CheckCircle
//     (web L3, L25-30, L58, L70) -> the shared native SemanticIcon. The four
//     severity glyphs map to the purpose-built severity names
//     (info->severityInfo, warn->severityWarn, critical->severityCritical,
//     success->success); the title + empty Bell map to `notifications`. lucide
//     SVG has no native renderer. The per-severity SEVERITY_HEX still drives each
//     feed row's colour (TimelineItem box tint) so the wire-severity colour
//     intent survives; the web title Bell's text-neon-cyan collapses to the
//     SemanticIcon notifications badge (semantic alert intent preserved).
//   - `@/api/hooks/useNotifications` useAlerts (web L4) -> the ported native
//     useAlerts hook (same '/alerts' query, same UseQueryResult fields).
//   - `./WidgetShell` WidgetShell (web L5) -> inlined native WidgetShell: the web
//     shell is a transparent flex container (the grid cell supplies chrome), so
//     it maps to a plain View with the same loading (Skeleton placeholder),
//     error (QueryError), header (icon + uppercase title + DataFreshness), and
//     pulse-on-update glow behaviour. WidgetShell is a separate source file with
//     no native port yet, so the subset this widget exercises is inlined; the
//     unused query/help/widgetId/dashboardId/actions/noPadding props are omitted.
//   - `./shared` WidgetEventFeed + type EventFeedItem (web L6) -> inlined native
//     WidgetEventFeed rendering the ported native TimelineItem rows (same sort +
//     slice + relative-time + empty-state contract). Separate source files, not
//     yet ported, so inlined here.
//   - `./types` WidgetProps (web L7) -> inlined native WidgetSize/WidgetProps
//     (the size.cols/size.rows subset this widget reads); the full registry types
//     live in the separate types.ts source.
//   - `@/lib/tokens` normalizeSeverity + type Severity (web L8) -> imported from
//     the ported native data-display _tokens module.
//   - `@/lib/alertDrillthrough` getAlertDrillthroughHref (web L9, L49) -> inlined
//     native-safe port (full SIGNAL_TO_PAGE map ported verbatim) that builds the
//     href string with manual percent-encoding instead of the browser-only
//     URLSearchParams global. The native web-parity tree has no in-app router, so
//     the href is preserved on the TimelineItem `href` prop for drill-through
//     parity + accessibility; programmatic navigation is structurally
//     unavailable and delegated to the platform (handled inside TimelineItem).
//   - `@/hooks/useDateFormat` formatDateTime (web shared dep, used by the feed's
//     >24h fallback) -> inlined native-safe Intl toLocaleString, mirroring the
//     RecentActivity/DateTime port precedent.
//
// No DOM-only modules, HTML elements, react-i18next, lucide-react, Recharts,
// Leaflet, or web UI components are imported -- only react, react-native
// primitives, and the shared native SemanticIcon / AppText / theme tokens plus
// the ported parity TimelineItem / DataFreshness / QueryError / _tokens / useAlerts.

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';

import {SemanticIcon, type SemanticIconName} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {colors} from '../../../../theme/tokens';
import {useAlerts, type Alert} from '../../../api/hooks/useNotifications';
import {DataFreshness} from '../../../components/data-display/DataFreshness';
import {TimelineItem} from '../../../components/data-display/TimelineItem';
import {normalizeSeverity, type Severity} from '../../../components/data-display/_tokens';
import {QueryError} from '../../../components/feedback/QueryError';

// ── react-i18next useTranslation('dashboard') replacement ──
type NativeTFunction = (key: string, fallback: string) => string;

// Returns the English fallback so the translation-key intent is preserved.
const nativeTranslate: NativeTFunction = (_key, fallback) => fallback;

function useNativeTranslation(): NativeTFunction {
  return nativeTranslate;
}

// ── @/lib/alertDrillthrough (ported inline; no native lib port yet) ──
// Map an alert to a navigable href on the relevant context page. The native
// web-parity tree has no in-app router, so the href is preserved on the feed row
// for parity/accessibility and navigation is delegated to TimelineItem.

interface DrillthroughTarget {
  path: string;
  query: Record<string, string>;
}

// Telemetry signal name -> destination page route. Ported verbatim from web so
// the computed href matches the web output exactly.
const SIGNAL_TO_PAGE: Record<string, string> = {
  // Battery
  BatteryLevel: '/battery',
  RatedRange: '/battery',
  ChargeLimitSoc: '/battery',
  EstBatteryRange: '/battery',
  IdealBatteryRange: '/battery',

  // Charging
  ChargeState: '/charging',
  DetailedChargeState: '/charging',
  DCChargingPower: '/charging',
  ACChargingPower: '/charging',
  ChargeAmps: '/charging',
  ChargerVoltage: '/charging',
  ChargerActualCurrent: '/charging',
  ChargingCableType: '/charging',

  // Driving
  Gear: '/drives',
  VehicleSpeed: '/drives',
  Power: '/drives',
  Odometer: '/drives',

  // Climate
  InsideTemp: '/climate-control',
  OutsideTemp: '/climate-control',
  HvacPower: '/climate-control',
  ClimateKeeperMode: '/climate-control',

  // Tire pressure
  TpmsPressureFl: '/tire-pressure',
  TpmsPressureFr: '/tire-pressure',
  TpmsPressureRl: '/tire-pressure',
  TpmsPressureRr: '/tire-pressure',
  TpmsHardWarnings: '/tire-pressure',
  TpmsSoftWarnings: '/tire-pressure',
  TpmsLastSeenPressureTimeFl: '/tire-pressure',
  TpmsLastSeenPressureTimeFr: '/tire-pressure',
  TpmsLastSeenPressureTimeRl: '/tire-pressure',
  TpmsLastSeenPressureTimeRr: '/tire-pressure',

  // Security / access
  Locked: '/security-access',
  SentryMode: '/security-access',
  DoorState: '/security-access',
  WindowState: '/security-access',
  SunroofInstalled: '/security-access',

  // Software
  SoftwareUpdateVersion: '/software-updates',
  SoftwareUpdateDownloadPercentComplete: '/software-updates',
  SoftwareUpdateInstallationPercentComplete: '/software-updates',
  SoftwareUpdateExpectedDurationMinutes: '/software-updates',

  // Location / navigation
  LocatedAtHome: '/navigation',
  LocatedAtWork: '/navigation',
  LocatedAtFavorite: '/navigation',
  DestinationName: '/navigation',
  DestinationLocation: '/navigation',
};

const SIGNAL_EXPLORER_FALLBACK = '/signal-explorer';

function getAlertDrillthrough(alert: Alert): DrillthroughTarget {
  const signal = alert.rule_signal ?? null;
  // vehicle_id may be 0 when the rule was un-scoped; treat 0 as "no vehicle".
  const vehicleId =
    alert.vehicle_id && alert.vehicle_id > 0 ? alert.vehicle_id : null;
  const ts = alert.created_at;

  const query: Record<string, string> = {};
  if (vehicleId != null) {
    query.vehicle_id = String(vehicleId);
  }
  if (ts) {
    query.t = ts;
  }
  if (signal) {
    query.signal = signal;
  }

  if (signal && SIGNAL_TO_PAGE[signal]) {
    return {path: SIGNAL_TO_PAGE[signal], query};
  }
  return {path: SIGNAL_EXPLORER_FALLBACK, query};
}

// Build the href string. The web uses `new URLSearchParams(query).toString()`;
// React Native (Hermes) has no guaranteed URLSearchParams global, so the query
// is encoded manually to the same `key=value&…` shape.
function getAlertDrillthroughHref(alert: Alert): string {
  const {path, query} = getAlertDrillthrough(alert);
  const search = Object.keys(query)
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(query[key])}`)
    .join('&');
  return search ? `${path}?${search}` : path;
}

// ── @/hooks/useDateFormat formatDateTime (ported inline, native-safe Intl) ──
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

// ── ./shared WidgetEventFeed + EventFeedItem (ported inline) ──
interface EventFeedItem {
  id: string | number;
  icon: ReactNode;
  title: string;
  subtitle?: string;
  timestamp: string;
  color: string;
  severity?: 'info' | 'warning' | 'critical';
  /** Optional drill-through target; preserved on the row for parity. */
  href?: string;
}

interface WidgetEventFeedProps {
  items: EventFeedItem[];
  maxItems?: number;
  compact?: boolean;
  emptyMessage?: string;
  emptyIcon?: ReactNode;
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
      <View style={styles.empty}>
        {emptyIcon ? <View style={styles.emptyIcon}>{emptyIcon}</View> : null}
        <AppText style={styles.emptyMessage} tone="muted" variant="caption">
          {emptyMessage ?? 'No events yet'}
        </AppText>
      </View>
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
  // Pulse-on-data-change glow (web L59-80).
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

const SEVERITY_LABELS: Record<Severity, string> = {
  info: 'Info',
  warn: 'Warning',
  critical: 'Critical',
  success: 'Success',
};

const SEVERITY_HEX: Record<Severity, string> = {
  info: '#0ea5e9',
  warn: '#f59e0b',
  critical: '#ef4444',
  success: '#10b981',
};

// lucide Info / AlertTriangle / AlertOctagon / CheckCircle -> SemanticIcon names.
const SEVERITY_ICON_NAMES: Record<Severity, SemanticIconName> = {
  info: 'severityInfo',
  warn: 'severityWarn',
  critical: 'severityCritical',
  success: 'success',
};

export default function AlertFeedWidget({size}: WidgetProps) {
  const t = useNativeTranslation();
  const {
    data: alerts,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useAlerts();

  const isWide = size.cols >= 3;
  const isTall = size.rows >= 2;

  const items: EventFeedItem[] = useMemo(
    () =>
      (alerts ?? []).map(a => {
        const sev = normalizeSeverity(a.severity);
        return {
          id: a.id,
          icon: (
            <SemanticIcon
              decorative
              name={SEVERITY_ICON_NAMES[sev]}
              size="sm"
            />
          ),
          title: a.title ?? '—',
          subtitle: isWide ? a.message : SEVERITY_LABELS[sev],
          timestamp: a.created_at,
          color: SEVERITY_HEX[sev],
          href: getAlertDrillthroughHref(a),
        };
      }),
    [alerts, isWide],
  );

  return (
    <WidgetShell
      error={error ? String(error) : null}
      icon={<SemanticIcon decorative name="notifications" size="sm" />}
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={isLoading}
      onRefresh={() => refetch()}
      title={t('widget.alertFeed', 'Alert Feed')}
      updatedAt={dataUpdatedAt}>
      <WidgetEventFeed
        emptyIcon={<SemanticIcon decorative name="notifications" size="md" />}
        emptyMessage={t('widget.noAlerts', 'No alerts yet')}
        items={items}
        maxItems={isWide ? 12 : isTall ? 8 : 5}
      />
    </WidgetShell>
  );
}

const styles = StyleSheet.create({
  content: {
    flex: 1,
    paddingBottom: 12,
    paddingHorizontal: 16,
  },
  empty: {
    alignItems: 'center',
    gap: 8,
    justifyContent: 'center',
    paddingVertical: 16,
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
