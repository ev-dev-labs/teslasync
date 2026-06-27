import {Glyph} from '../../../../components/icons/Glyph';
// Native parity port of web/src/features/dashboard/widgets/ChargingScheduleWidget.tsx.
//
// The web widget is a responsive dashboard tile that summarises the vehicle's
// scheduled-charging signals. It renders inside the shared <WidgetShell> and
// switches between a compact (1x1) charge-limit readout and a full view with a
// mode <Badge>, a visual <Timeline> of the start/departure/target-limit events,
// and (on tall tiles) a current-level / charging-status detail row. Data comes
// from useVehicles()/useVehicleState() plus a live `/signals/{id}/live` query;
// time strings are rendered via useDateFormat().formatTime.
//
// None of the web imports are native-safe, so — mirroring the sibling native
// ports (AutomationStatusWidget, BatteryRadialGaugeWidget) — each piece is
// rebuilt with React Native primitives, AppText, the repo SemanticIcon glyphs,
// the design tokens and the existing native api hooks/client. The deps that have
// no native port yet (WidgetShell, ./types, @/components/ui Badge,
// @/components/data-display Timeline, @/components/feedback EmptyState,
// @/hooks/useDateFormat, react-i18next, lucide-react) are inlined as
// self-contained native-safe parity within this file.
//
// Line-by-line coverage of the source:
//   L1-12  imports -> useMemo (plus useCallback/useEffect/useRef/useState for the
//          inlined WidgetShell + i18n/date fallbacks); react-i18next ->
//          useNativeTranslationFallback; @tanstack/react-query useQuery kept as-is
//          (it is a native dependency); lucide-react Calendar/Clock/BatteryFull/Zap
//          -> repo SemanticIcon glyphs (calendar/clock/batteryFull/bolt);
//          @/components/ui Badge -> inlined Badge; @/components/data-display
//          Timeline -> inlined native Timeline; @/components/feedback EmptyState ->
//          inlined EmptyState; useVehicles/useVehicleState -> native api hooks;
//          request -> native api client request; useDateFormat -> inlined native
//          useDateFormat (only formatTime is consumed); ./WidgetShell -> inlined
//          WidgetShell; ./types WidgetProps -> inlined WidgetSize/WidgetConfig/
//          WidgetProps mirror.
//   L14-20 ScheduleSignals interface -> ported verbatim.
//   L22-39 parseScheduleSignals(signals) -> ported verbatim: raw(key) value-or-null
//          reader; mode/startTime/departureTime kept only when typeof === 'string';
//          pending true when value === true || 'true'; chargeLimit kept only when
//          typeof === 'number'; otherwise null.
//   L41-52 modeLabel(mode, t) -> ported verbatim: StartAt/DepartBy/Off i18n labels,
//          else mode ?? Unknown. Same i18n keys.
//   L54-64 modeBadgeVariant(mode) -> ported verbatim: StartAt/DepartBy -> success,
//          Off -> neutral, default -> warning. Union 'success'|'warning'|'neutral'.
//   L66-72 default export ({vehicleId,size}) + useTranslation('dashboard') ->
//          useNativeTranslationFallback; useDateFormat().formatTime ->
//          formatScheduleTime; useVehicles(); id = vehicleId ?? vehicles?.[0]?.id ??
//          0; useVehicleState(id) destructure (data:stateData,isLoading:stateLoading).
//   L74-84 live signals useQuery -> ported verbatim (queryKey ['signals', id,
//          'live-schedule'], queryFn request<{signals?}>(`/signals/${id}/live`)
//          returning res.signals ?? {}, enabled id>0, staleTime 30_000); the full
//          destructure (data/isLoading/isFetching/isStale/isError/dataUpdatedAt/
//          refetch) is preserved.
//   L86-89 schedule = useMemo(parseScheduleSignals(liveSignals ?? {})) -> ported.
//   L91    state = stateData?.state -> narrowed to the VehicleState object (the
//          native hook types `state` as VehicleState|string|null|undefined; the
//          object payload matches the web `any` reads).
//   L92-94 isLoading/isCompact (cols<=1 && rows<=1)/isTall (rows>=2) -> ported.
//   L96-97 hasScheduleData (mode || startTime || chargeLimit not null) -> ported.
//   L99    chargeLimit = schedule.chargeLimit ?? (state?.battery_level != null ?
//          undefined : null) -> ported verbatim.
//   L101-135 timelineItems useMemo -> ported verbatim: Zap start-charging (#22c55e,
//          optional Pending subtitle), Clock departure (#3b82f6), BatteryFull
//          target-limit `${chargeLimit}%` (#f59e0b); same guards and i18n keys.
//   L137-165 compact branch -> WidgetShell (no title -> freshness overlay) with the
//          same freshness props; hasScheduleData ? big chargeLimit %/'—' + 'Charge
//          Limit' caption : EmptyState(calendar glyph, 'No schedule data').
//   L167-233 full branch -> WidgetShell (title 'Charging Schedule', cyan calendar
//          icon) + freshness props; hasScheduleData ? mode Badge(dot) + optional
//          Pending Badge, Timeline (or 'No scheduled times set'), and the tall
//          detail row (Current Level state.battery_level%, Status Charging/Not
//          Charging) when isTall && state : EmptyState. Same i18n keys.
//   L234   closing brace -> ported.
//
// No DOM, no react-i18next, no lucide-react, no Recharts/Leaflet, no
// framer-motion and no web UI components are imported.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { getSemanticIconDefinition } from '../../../../components/icons/SemanticIcon';
import { AppText } from '../../../../components/ui/AppText';
import { colors, spacing } from '../../../../theme/tokens';
import { request } from '../../../api/client';
import {
  useVehicles,
  useVehicleState,
  type VehicleState,
} from '../../../api/hooks/useVehicles';

/* ------------------------------------------------------------------ */
/*  i18n fallback (inlined react-i18next port)                         */
/* ------------------------------------------------------------------ */

// The web widget read `t` from useTranslation('dashboard'). Native parity has no
// i18n runtime wired, so this returns the English fallback for every (key,
// fallback) pair, preserving every i18n key. The 2-arg `(k, f) => string`
// signature matches the source's local `t` type exactly (no interpolation is
// used by this widget).
const I18N_NAMESPACE = 'dashboard';

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

/* ------------------------------------------------------------------ */
/*  @/hooks/useDateFormat mirror (only formatTime is consumed)         */
/* ------------------------------------------------------------------ */

// web useDateFormat().formatTime (web/src/lib/dateFormat.ts formatTime) returns
// '—' for null/invalid input and otherwise
// d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }). Native
// has no useSettings-backed locale/tz wired, so the runtime default locale/zone
// is used; the '—' fallback and the 2-digit hour/minute shape are preserved.
type NativeTimeFormatter = (value: string | Date | null | undefined) => string;

function formatTimeNative(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function useDateFormat(): { formatTime: NativeTimeFormatter } {
  const formatTime = useCallback<NativeTimeFormatter>(formatTimeNative, []);
  return useMemo(() => ({ formatTime }), [formatTime]);
}

/* ------------------------------------------------------------------ */
/*  ./types mirror (no native port yet)                                */
/* ------------------------------------------------------------------ */

// Mirrored field-for-field from web ./types so the port stays self-contained.
interface WidgetSize {
  cols: number;
  rows: number;
}

interface WidgetConfig {
  vehicleId?: number;
  refreshRate?: number;
  chartType?: string;
  showTitle?: boolean;
  timeRange?: string;
  [key: string]: unknown;
}

interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: WidgetConfig;
}

/* ------------------------------------------------------------------ */
/*  lucide -> repo SemanticIcon glyph stand-ins                        */
/* ------------------------------------------------------------------ */

// Repo-canonical native stand-ins for the lucide glyphs, resolved once. The
// per-icon colour intent (Calendar cyan in the header, Zap green, Clock blue,
// BatteryFull amber in the timeline) is applied at the call sites.
const CALENDAR_GLYPH = getSemanticIconDefinition('calendar').glyph;
const CLOCK_GLYPH = getSemanticIconDefinition('clock').glyph;
const BATTERY_FULL_GLYPH = getSemanticIconDefinition('batteryFull').glyph;
const ZAP_GLYPH = getSemanticIconDefinition('bolt').glyph;

// Per-event timeline colours, preserved verbatim from the source (dynamic,
// semantic per-item colours — applied as explicit style colours, not tokens).
const TIMELINE_START_COLOR = '#22c55e';
const TIMELINE_DEPARTURE_COLOR = '#3b82f6';
const TIMELINE_LIMIT_COLOR = '#f59e0b';

type GlyphTone = 'cyan' | 'green' | 'amber' | 'blue' | 'muted';

function GlyphLegacyUnused({
  glyph,
  tone,
  style,
}: {
  glyph: string;
  tone: GlyphTone;
  style?: TextStyle | TextStyle[];
}) {
  return (
    <AppText style={[styles.glyph, glyphToneStyles[tone], style]} weight="bold">
      {glyph}
    </AppText>
  );
}

/* ------------------------------------------------------------------ */
/*  Pure logic (ported verbatim)                                       */
/* ------------------------------------------------------------------ */

interface ScheduleSignals {
  mode: string | null;
  pending: boolean;
  startTime: string | null;
  departureTime: string | null;
  chargeLimit: number | null;
}

function parseScheduleSignals(
  signals: Record<string, { value: unknown; timestamp: string }>,
): ScheduleSignals {
  const raw = (key: string) => signals[key]?.value ?? null;
  const mode = raw('ScheduledChargingMode');
  const pending = raw('ScheduledChargingPending');
  const startTime = raw('ScheduledChargingStartTime');
  const departureTime = raw('ScheduledDepartureTime');
  const chargeLimit = raw('ChargeLimitSoc');

  return {
    mode: typeof mode === 'string' ? mode : null,
    pending: pending === true || pending === 'true',
    startTime: typeof startTime === 'string' ? startTime : null,
    departureTime: typeof departureTime === 'string' ? departureTime : null,
    chargeLimit: typeof chargeLimit === 'number' ? chargeLimit : null,
  };
}

function modeLabel(mode: string | null, t: NativeTFunction): string {
  switch (mode) {
    case 'StartAt':
      return t('widget.chargingSchedule.modeStartAt', 'Start At');
    case 'DepartBy':
      return t('widget.chargingSchedule.modeDepartBy', 'Depart By');
    case 'Off':
      return t('widget.chargingSchedule.modeOff', 'Off');
    default:
      return mode ?? t('widget.chargingSchedule.modeUnknown', 'Unknown');
  }
}

type BadgeVariant = 'success' | 'warning' | 'neutral';

function modeBadgeVariant(mode: string | null): BadgeVariant {
  switch (mode) {
    case 'StartAt':
    case 'DepartBy':
      return 'success';
    case 'Off':
      return 'neutral';
    default:
      return 'warning';
  }
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/ui <Badge>                                    */
/* ------------------------------------------------------------------ */

// web Badge (size="sm", optional dot). The dot is `bg-current` (text colour);
// the dark-mode variant palette maps to the matching token surface/border/text.
function Badge({
  variant,
  dot,
  children,
}: {
  variant: BadgeVariant;
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <View style={[styles.badge, badgeContainerStyles[variant]]}>
      {dot ? <View style={[styles.badgeDot, badgeDotStyles[variant]]} /> : null}
      <AppText
        style={[styles.badgeText, badgeTextStyles[variant]]}
        variant="caption"
        weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/data-display <Timeline>                        */
/* ------------------------------------------------------------------ */

interface TimelineItemData {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  time: string;
  color?: string;
}

// web Timeline: a vertical list with a connector line, a 22px dot/icon circle
// (border + colour = item.color) and a title/time baseline row above an optional
// subtitle. RN reproduces the same structure with positioned Views.
function Timeline({ items }: { items: TimelineItemData[] }) {
  return (
    <View style={styles.timeline}>
      {items.map((item, i) => (
        <View key={i} style={styles.timelineItem}>
          <View style={styles.timelineMarker}>
            {i < items.length - 1 ? (
              <View style={styles.timelineConnector} />
            ) : null}
            <View
              style={[
                styles.timelineDot,
                item.color
                  ? { borderColor: item.color }
                  : styles.timelineDotDefault,
              ]}>
              {item.icon ?? (
                <View
                  style={[
                    styles.timelineDotInner,
                    { backgroundColor: item.color ?? colors.textMuted },
                  ]}
                />
              )}
            </View>
          </View>
          <View style={styles.timelineContent}>
            <View style={styles.timelineTitleRow}>
              <AppText
                numberOfLines={1}
                style={styles.timelineTitle}
                weight="semibold">
                {item.title}
              </AppText>
              <AppText style={styles.timelineTime} tone="muted">
                {item.time}
              </AppText>
            </View>
            {item.subtitle ? (
              <AppText style={styles.timelineSubtitle} tone="muted">
                {item.subtitle}
              </AppText>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/feedback <EmptyState>                          */
/* ------------------------------------------------------------------ */

// web EmptyState(icon, message, className="py-4"): a centred icon glyph above a
// muted message line.
function EmptyState({ glyph, message }: { glyph: string; message: string }) {
  return (
    <View style={styles.emptyState}>
      <Glyph glyph={glyph} style={styles.emptyGlyph} tone="muted" />
      <AppText style={styles.emptyMessage} tone="muted" variant="caption">
        {message}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined ./WidgetShell                                              */
/* ------------------------------------------------------------------ */

// Native parity for the freshness pill the web WidgetShell renders in its header
// (web <DataFreshness>). A pressable refresh affordance with a status dot
// (error -> danger, fetching -> accent, stale -> warning, fresh -> success) and,
// when not compact, a short relative "updated" caption. Consumes every freshness
// prop so the refresh-on-press behaviour is preserved.
function DataFreshness({
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
  compact,
}: {
  updatedAt: number | null;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  onRefresh?: () => void;
  compact: boolean;
}) {
  const t = useNativeTranslationFallback();
  const dotStyle = isError
    ? freshnessDotStyles.error
    : isFetching
      ? freshnessDotStyles.fetching
      : isStale
        ? freshnessDotStyles.stale
        : freshnessDotStyles.fresh;

  return (
    <Pressable
      accessibilityLabel={t('widget.refresh', 'Refresh')}
      accessibilityRole="button"
      hitSlop={8}
      onPress={onRefresh}
      style={styles.freshness}>
      <View style={[styles.freshnessDot, dotStyle]} />
      {!compact && updatedAt ? (
        <AppText style={styles.freshnessLabel} tone="muted" variant="caption">
          {formatFreshness(updatedAt)}
        </AppText>
      ) : null}
    </Pressable>
  );
}

// Short relative "updated" caption used by the freshness pill (the web
// <DataFreshness> renders a relative timestamp). Mirrors the lib formatRelative
// minute/hour/day bucketing.
function formatFreshness(updatedAt: number): string {
  const diff = Date.now() - updatedAt;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

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
  // Pulse-on-data-change effect (web `justUpdated`): ported verbatim; the
  // transient flag drives a subtle border highlight in place of the web box
  // shadow.
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
      <View style={styles.shellState}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.shellState}>
        <AppText tone="danger" variant="caption">
          {error}
        </AppText>
      </View>
    );
  }

  const showFreshness = updatedAt !== undefined;
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
        <View style={styles.shellHeader}>
          <View style={styles.shellHeaderLeft}>
            {icon}
            <AppText
              style={styles.shellTitle}
              variant="caption"
              weight="semibold">
              {title}
            </AppText>
          </View>
          {freshnessEl}
        </View>
      ) : freshnessEl ? (
        <View style={styles.shellFreshnessOverlay}>{freshnessEl}</View>
      ) : null}
      <View style={styles.shellBody}>{children}</View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Widget                                                             */
/* ------------------------------------------------------------------ */

export default function ChargingScheduleWidget({ vehicleId, size }: WidgetProps) {
  const t = useNativeTranslationFallback();
  const { formatTime: formatScheduleTime } = useDateFormat();
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const { data: stateData, isLoading: stateLoading } = useVehicleState(id);

  const {
    data: liveSignals,
    isLoading: signalsLoading,
    isFetching: signalsFetching,
    isStale: signalsStale,
    isError: signalsError,
    dataUpdatedAt: signalsUpdatedAt,
    refetch: refetchSignals,
  } = useQuery({
    queryKey: ['signals', id, 'live-schedule'],
    queryFn: async () => {
      const res = await request<{
        signals?: Record<string, { value: unknown; timestamp: string }>;
      }>(`/signals/${id}/live`);
      return res.signals ?? {};
    },
    enabled: id > 0,
    staleTime: 30_000,
  });

  const schedule = useMemo(
    () => parseScheduleSignals(liveSignals ?? {}),
    [liveSignals],
  );

  const rawState = stateData?.state;
  const state: VehicleState | undefined =
    rawState && typeof rawState === 'object' ? rawState : undefined;
  const isLoading = stateLoading || signalsLoading;
  const isCompact = size.cols <= 1 && size.rows <= 1;
  const isTall = size.rows >= 2;

  const hasScheduleData =
    schedule.mode != null ||
    schedule.startTime != null ||
    schedule.chargeLimit != null;

  const chargeLimit =
    schedule.chargeLimit ??
    (state?.battery_level != null ? undefined : null);

  const timelineItems = useMemo<TimelineItemData[]>(() => {
    const items: TimelineItemData[] = [];

    if (schedule.startTime) {
      items.push({
        icon: (
          <Glyph
            glyph={ZAP_GLYPH}
            style={[styles.timelineIcon, { color: TIMELINE_START_COLOR }]}
            tone="green"
          />
        ),
        title: t('widget.chargingSchedule.startCharging', 'Start Charging'),
        subtitle: schedule.pending
          ? t('widget.chargingSchedule.pending', 'Pending')
          : undefined,
        time: formatScheduleTime(schedule.startTime),
        color: TIMELINE_START_COLOR,
      });
    }

    if (schedule.departureTime) {
      items.push({
        icon: (
          <Glyph
            glyph={CLOCK_GLYPH}
            style={[styles.timelineIcon, { color: TIMELINE_DEPARTURE_COLOR }]}
            tone="blue"
          />
        ),
        title: t('widget.chargingSchedule.departure', 'Departure'),
        time: formatScheduleTime(schedule.departureTime),
        color: TIMELINE_DEPARTURE_COLOR,
      });
    }

    if (chargeLimit != null) {
      items.push({
        icon: (
          <Glyph
            glyph={BATTERY_FULL_GLYPH}
            style={[styles.timelineIcon, { color: TIMELINE_LIMIT_COLOR }]}
            tone="amber"
          />
        ),
        title: t('widget.chargingSchedule.targetLimit', 'Target Limit'),
        time: `${chargeLimit}%`,
        color: TIMELINE_LIMIT_COLOR,
      });
    }

    return items;
  }, [schedule, chargeLimit, formatScheduleTime, t]);

  if (isCompact) {
    return (
      <WidgetShell
        isError={signalsError}
        isFetching={signalsFetching}
        isStale={signalsStale}
        loading={isLoading}
        onRefresh={() => refetchSignals()}
        updatedAt={signalsUpdatedAt}>
        {hasScheduleData ? (
          <View style={styles.compactRoot}>
            <AppText style={styles.compactValue} weight="bold">
              {schedule.chargeLimit != null
                ? `${schedule.chargeLimit}%`
                : '—'}
            </AppText>
            <AppText style={styles.compactLabel} tone="muted">
              {t('widget.chargingSchedule.limit', 'Charge Limit')}
            </AppText>
          </View>
        ) : (
          <EmptyState
            glyph={CALENDAR_GLYPH}
            message={t('widget.chargingSchedule.noData', 'No schedule data')}
          />
        )}
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      icon={
        <Glyph glyph={CALENDAR_GLYPH} style={styles.headerIcon} tone="cyan" />
      }
      isError={signalsError}
      isFetching={signalsFetching}
      isStale={signalsStale}
      loading={isLoading}
      onRefresh={() => refetchSignals()}
      title={t('widget.chargingSchedule.title', 'Charging Schedule')}
      updatedAt={signalsUpdatedAt}>
      {hasScheduleData ? (
        <View style={styles.fullRoot}>
          {/* Mode badge */}
          <View style={styles.modeRow}>
            <Badge dot variant={modeBadgeVariant(schedule.mode)}>
              {modeLabel(schedule.mode, t)}
            </Badge>
            {schedule.pending ? (
              <Badge variant="warning">
                {t('widget.chargingSchedule.pending', 'Pending')}
              </Badge>
            ) : null}
          </View>

          {/* Visual timeline */}
          {timelineItems.length > 0 ? (
            <Timeline items={timelineItems} />
          ) : (
            <AppText style={styles.noTimes} tone="muted" variant="caption">
              {t('widget.chargingSchedule.noTimes', 'No scheduled times set')}
            </AppText>
          )}

          {/* Extra detail row when tall */}
          {isTall && state ? (
            <View style={styles.detailRow}>
              <View style={styles.detailCol}>
                <AppText style={styles.detailLabel} tone="muted">
                  {t('widget.chargingSchedule.currentLevel', 'Current Level')}
                </AppText>
                <AppText style={styles.detailValue} weight="semibold">
                  {state.battery_level ?? 0}%
                </AppText>
              </View>
              <View style={styles.detailCol}>
                <AppText style={styles.detailLabel} tone="muted">
                  {t('widget.chargingSchedule.status', 'Status')}
                </AppText>
                <AppText style={styles.detailValue} weight="semibold">
                  {state.is_charging
                    ? t('widget.charging', 'Charging')
                    : t('widget.notCharging', 'Not Charging')}
                </AppText>
              </View>
            </View>
          ) : null}
        </View>
      ) : (
        <EmptyState
          glyph={CALENDAR_GLYPH}
          message={t('widget.chargingSchedule.noData', 'No schedule data')}
        />
      )}
    </WidgetShell>
  );
}

ChargingScheduleWidget.displayName = 'ChargingScheduleWidget';

// Surfaced so the i18n namespace the web widget used is retained and inspectable.
export const CHARGING_SCHEDULE_WIDGET_I18N_NAMESPACE = I18N_NAMESPACE;

const styles = StyleSheet.create({
  // --- Glyph base ---
  glyph: {
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.4,
  },

  // --- WidgetShell ---
  shell: {
    flex: 1,
  },
  shellPulse: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.successBorder,
  },
  shellState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
  },
  shellHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  shellHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  shellTitle: {
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  shellFreshnessOverlay: {
    position: 'absolute',
    top: 6,
    right: 6,
    zIndex: 5,
  },
  shellBody: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },

  // --- DataFreshness ---
  freshness: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
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

  // --- Compact view ---
  compactRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  compactValue: {
    fontSize: 24,
    lineHeight: 30,
    color: colors.textPrimary,
  },
  compactLabel: {
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },

  // --- Badge ---
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  badgeText: {
    fontSize: 11,
    lineHeight: 14,
  },

  // --- Full view ---
  fullRoot: {
    flex: 1,
    gap: spacing.md,
  },

  // --- Mode row ---
  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },

  // --- Timeline ---
  timeline: {
    gap: spacing.md,
  },
  timelineItem: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  timelineMarker: {
    width: 22,
    alignItems: 'center',
  },
  timelineConnector: {
    position: 'absolute',
    top: 22,
    width: 1,
    bottom: -spacing.md,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  timelineDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  timelineDotDefault: {
    borderColor: colors.border,
  },
  timelineDotInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  timelineIcon: {
    fontSize: 9,
    lineHeight: 12,
  },
  timelineContent: {
    flex: 1,
    minWidth: 0,
    paddingTop: 1,
  },
  timelineTitleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  timelineTitle: {
    flexShrink: 1,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textPrimary,
  },
  timelineTime: {
    fontSize: 11,
    lineHeight: 16,
  },
  timelineSubtitle: {
    marginTop: 2,
    fontSize: 11,
    lineHeight: 16,
  },

  // --- No-times fallback ---
  noTimes: {
    fontSize: 11,
    lineHeight: 16,
  },

  // --- Tall detail row ---
  detailRow: {
    marginTop: 'auto',
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  detailCol: {
    flex: 1,
  },
  detailLabel: {
    fontSize: 10,
    lineHeight: 14,
  },
  detailValue: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textPrimary,
  },

  // --- Empty state ---
  emptyState: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
  },
  emptyGlyph: {
    fontSize: 14,
    lineHeight: 18,
  },
  emptyMessage: {
    textAlign: 'center',
  },

  // --- Header icon ---
  headerIcon: {
    fontSize: 10,
    lineHeight: 14,
  },
});

const glyphToneStyles = StyleSheet.create<Record<GlyphTone, TextStyle>>({
  cyan: {
    color: colors.accent,
  },
  green: {
    color: colors.success,
  },
  amber: {
    color: colors.warning,
  },
  blue: {
    color: colors.glowCyan,
  },
  muted: {
    color: colors.textMuted,
  },
});

const badgeContainerStyles = StyleSheet.create<Record<BadgeVariant, ViewStyle>>({
  success: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  warning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
  neutral: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
});

const badgeTextStyles = StyleSheet.create<Record<BadgeVariant, TextStyle>>({
  success: {
    color: colors.success,
  },
  warning: {
    color: colors.warning,
  },
  neutral: {
    color: colors.textSecondary,
  },
});

const badgeDotStyles = StyleSheet.create<Record<BadgeVariant, ViewStyle>>({
  success: {
    backgroundColor: colors.success,
  },
  warning: {
    backgroundColor: colors.warning,
  },
  neutral: {
    backgroundColor: colors.textSecondary,
  },
});

const freshnessDotStyles = StyleSheet.create({
  error: {
    backgroundColor: colors.danger,
  },
  fetching: {
    backgroundColor: colors.accent,
  },
  stale: {
    backgroundColor: colors.warning,
  },
  fresh: {
    backgroundColor: colors.success,
  },
});
