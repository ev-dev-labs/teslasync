import {Glyph} from '../../../../components/icons/Glyph';
// Native parity port of web/src/features/dashboard/widgets/RecentDrivesWidget.tsx.
//
// The web widget is a dashboard tile listing the vehicle's five most recent
// drives inside the shared <WidgetShell>. Each drive row links to the drive
// detail route and shows distance (converted from SI meters to the user's unit),
// duration in minutes, the start->end SoC delta and the start date; a "View all"
// header action links to /drives. Data comes from useVehicles() + a `/drives`
// useQuery; units come from useUnits() and dates from useDateFormat().
//
// None of the web imports are native-safe, so — mirroring the sibling native
// ports (ChargingScheduleWidget, LifetimeStatsWidget, MediaNowPlayingWidget) —
// every web-only piece is rebuilt with React Native primitives, AppText, the
// repo SemanticIcon glyphs, the design tokens and the existing native api
// hooks/client. The deps with no native port yet (WidgetShell, ./types,
// ../types Drive, @/components/feedback EmptyState, @/hooks/useUnits,
// @/hooks/useDateFormat, @/lib/numberFormat, @/lib/unitConversion, react-router-dom
// Link, react-i18next, lucide-react) are inlined as self-contained native-safe
// parity within this file.
//
// Line-by-line coverage of the source:
//   L1-14  imports -> react hooks (useCallback/useEffect/useMemo/useRef/useState
//          for the inlined WidgetShell + i18n/format fallbacks) + RN primitives
//          (View/Pressable/ScrollView/ActivityIndicator/StyleSheet) +
//          @tanstack/react-query useQuery (kept; it is a native dependency).
//          react-router-dom Link -> Pressable + module-level navigation sink
//          (recentDrivesNavigate / setRecentDrivesNavigator); react-i18next
//          useTranslation -> useNativeTranslationFallback (namespace preserved as
//          RECENT_DRIVES_WIDGET_I18N_NAMESPACE); lucide-react Route -> repo
//          'navigation' glyph, ArrowUpRight -> repo 'forward' glyph (nearest
//          navigation affordance); @/components/feedback EmptyState -> inlined
//          EmptyState; @/api/hooks/useVehicles -> native useVehicles; @/hooks/useUnits
//          + @/hooks/useDateFormat -> inlined useNativeFormat (reads native
//          useSettings); @/api/client request -> native request; @/lib/numberFormat
//          fmtNumber/fmtInt -> inlined value-identical; @/lib/unitConversion
//          convertDistanceFromSI -> inlined value-identical; ./WidgetShell ->
//          inlined WidgetShell; ./types WidgetProps + ../types Drive -> inlined
//          mirrors.
//   L16    default export RecentDrivesWidget({ vehicleId }: WidgetProps) -> ported
//          (only vehicleId is destructured, exactly as the source).
//   L17    useTranslation('dashboard') -> useNativeTranslationFallback().
//   L18-19 useVehicles(); id = vehicleId ?? vehicles?.[0]?.id ?? 0 -> ported verbatim.
//   L20    useUnits().unitPrefs -> useNativeFormat().distance (+ locale for fmt*).
//   L21    useDateFormat().formatDateShort -> useNativeFormat().formatDateShort.
//   L23-27 useQuery({ queryKey ['drives', id, 'recent-5'], queryFn request<Drive[]>
//          (`/drives?vehicle_id=${id}&limit=5`), enabled id>0 }) destructured as
//          drives/isLoading/isFetching/isStale/isError/dataUpdatedAt/refetch ->
//          ported verbatim.
//   L29    items = drives ?? [] -> ported verbatim.
//   L31-49 WidgetShell props: title t('widget.recentDrives','Recent Drives');
//          icon Route glyph (cyan/accent); loading=isLoading; updatedAt=dataUpdatedAt;
//          isFetching; isStale; isError; onRefresh=()=>refetch(); actions = the
//          "View all" Link -> Pressable (recentDrivesNavigate('/drives')) with the
//          t('widget.viewAll','View all') label + ArrowUpRight ('forward') glyph.
//          The inlined WidgetShell mirrors the consumed web behaviour: loading ->
//          ActivityIndicator (web <Skeleton>), error -> danger caption (web
//          <QueryError>; prop kept though this widget never passes it), 11px
//          uppercase muted title header with icon + header-right freshness/actions
//          cluster, title-less freshness overlay + actions row, justUpdated pulse
//          (prevUpdatedAt ref + 1500ms timeout) ported verbatim, and a
//          DataFreshness pressable (refresh + status dot error/fetching/stale/fresh
//          + relative "updated" caption).
//   L50    <div space-y-2 overflow-y-auto h-full> -> ScrollView (flex:1) with a
//          gap:spacing.sm contentContainer.
//   L51-69 items.length>0 ? map drives -> each Link to `/drives/${d.id}` -> Pressable
//          (recentDrivesNavigate) with a rounded bg-white/[0.02] (pressed ->
//          bg-white/[0.05]) row: left min-w-0 column with the truncated distance
//          line `${fmtNumber(convertDistanceFromSI(d.distance_m ?? 0, distance),1)} ${distance}`
//          (text-sm font-medium primary) and the meta line `${fmtInt((d.duration_s ?? 0)/60)} min · ${d.start_soc_pct ?? '?'}% → ${d.end_soc_pct ?? '?'}%`
//          (10px muted), and the right-aligned shrink-0 formatDateShort(d.start_ts)
//          (10px muted). All ported verbatim.
//   L70-76 : EmptyState(icon Route glyph, message t('widget.noDrives','No recent
//          drives'), className py-4) -> inlined native EmptyState (centred glyph +
//          muted caption).
//   L77-80 closing </div>/</WidgetShell>/JSX/braces -> ported.
//
// No DOM, no react-router-dom, no react-i18next, no lucide-react, no Recharts,
// no Leaflet, no framer-motion and no web UI components are imported — only RN
// primitives plus existing apps/native components (AppText, SemanticIcon), theme
// tokens and native web-parity hooks/client.

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
  ScrollView,
  StyleSheet,
  View,
  type TextStyle,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { getSemanticIconDefinition } from '../../../../components/icons/SemanticIcon';
import { AppText } from '../../../../components/ui/AppText';
import { colors, spacing } from '../../../../theme/tokens';
import { request } from '../../../api/client';
import { useSettings } from '../../../api/hooks/useSettings';
import { useVehicles } from '../../../api/hooks/useVehicles';

/* ------------------------------------------------------------------ */
/*  i18n fallback (inlined react-i18next port)                         */
/* ------------------------------------------------------------------ */

// The web widget read `t` from useTranslation('dashboard'). Native parity has no
// i18n runtime wired, so this returns the English fallback for every (key,
// fallback) pair, preserving every i18n key. The 2-arg `(k, f) => string`
// signature matches the source's local `t` usage exactly (no interpolation is
// used by this widget).
const I18N_NAMESPACE = 'dashboard';

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

/* ------------------------------------------------------------------ */
/*  ./types mirror (no native port yet)                                */
/* ------------------------------------------------------------------ */

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
/*  ../types Drive mirror (no native port yet)                         */
/* ------------------------------------------------------------------ */

// Mirrored field-for-field from web ../types so the port stays self-contained.
interface Drive {
  id: number;
  vehicle_id: number;
  started_at: string;
  ended_at: string | null;
  start_ts: string;
  distance_m: number;
  duration_s: number;
  max_speed_mps: number | null;
  avg_speed_mps: number | null;
  avg_power_w: number | null;
  start_soc_pct: number;
  end_soc_pct: number | null;
  energy_used_wh: number | null;
  regen_energy_wh: number | null;
  start_address?: string;
  end_address?: string;
}

/* ------------------------------------------------------------------ */
/*  Native navigation sink (react-router-dom Link port)                */
/* ------------------------------------------------------------------ */

// The web used react-router's <Link to=...>. The native parity tree mounts no
// router here, so route taps default to a no-op a host can override. Both the
// "View all" header action and each drive row call this with the same `to`
// strings the web Link used (`/drives`, `/drives/${id}`).
type RecentDrivesNavigate = (to: string) => void;
let recentDrivesNavigate: RecentDrivesNavigate = () => {};

export function setRecentDrivesNavigator(fn: RecentDrivesNavigate): void {
  recentDrivesNavigate = fn;
}

/* ------------------------------------------------------------------ */
/*  @/lib/numberFormat fmtNumber / fmtInt (value-identical)            */
/* ------------------------------------------------------------------ */

// web safeNumber: non-finite / non-number -> 0.
function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

// web fmtNumber(v, decimals, locale): locale-grouped fixed-precision string,
// falling back to en-US when the locale tag is rejected by Intl. The web default
// decimals is the global precision (2) and the web default locale is the global
// locale (set by useSettings); this widget always passes explicit decimals and
// the resolved settings locale, so the displayed number matches the web bit-for-bit.
function fmtNumber(value: unknown, decimals = 2, locale = 'en-US'): string {
  try {
    return safeNumber(value).toLocaleString(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(value).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
}

// web fmtInt(v): fmtNumber(v, 0).
function fmtInt(value: unknown, locale = 'en-US'): string {
  return fmtNumber(value, 0, locale);
}

/* ------------------------------------------------------------------ */
/*  @/lib/unitConversion convertDistanceFromSI (value-identical)       */
/* ------------------------------------------------------------------ */

// web unitConversion SI denominators.
const METERS_PER_KM = 1000;
const METERS_PER_MILE = 1609.344;
const METERS_PER_FOOT = 0.3048;

type DistanceUnitPref = 'km' | 'mi' | 'ft';

// Parity for @/lib/unitConversion convertDistanceFromSI(meters, to): divides SI
// meters by the unit denominator.
function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  switch (to) {
    case 'km':
      return meters / METERS_PER_KM;
    case 'mi':
      return meters / METERS_PER_MILE;
    case 'ft':
      return meters / METERS_PER_FOOT;
  }
}

/* ------------------------------------------------------------------ */
/*  useUnits().unitPrefs + useDateFormat() -> useNativeFormat          */
/* ------------------------------------------------------------------ */

const DEFAULT_LOCALE = 'en-US';

// web useUnits deriveDistance: 'mi' only when the user prefers miles, else 'km'.
function deriveDistance(unitOfLength: string | undefined): DistanceUnitPref {
  return unitOfLength === 'mi' ? 'mi' : 'km';
}

// web deriveLocale / numberFormat setGlobalLocale: non-empty string else 'en-US'.
function deriveLocale(locale: string | undefined): string {
  return typeof locale === 'string' && locale.trim().length > 0
    ? locale
    : DEFAULT_LOCALE;
}

type NativeDateFormatter = (value: string | Date | null | undefined) => string;

interface NativeFormat {
  distance: DistanceUnitPref;
  locale: string;
  formatDateShort: NativeDateFormatter;
}

// Mirror of useUnits().unitPrefs.distance + the numberFormat global locale +
// useDateFormat().formatDateShort, all resolved from the native useSettings()
// query (which both web hooks read). web formatDateShort returns '—' for
// null/invalid input and otherwise d.toLocaleDateString(locale, { month: 'short',
// day: 'numeric' }); the user's tz preference has no native wiring yet, so the
// runtime zone is used (the '—' fallback and month/day shape are preserved).
function useNativeFormat(): NativeFormat {
  const { data: settings } = useSettings();
  return useMemo<NativeFormat>(() => {
    const distance = deriveDistance(settings?.unit_of_length);
    const locale = deriveLocale(settings?.locale);
    const formatDateShort: NativeDateFormatter = value => {
      if (!value) return '—';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '—';
      return date.toLocaleDateString(locale, {
        month: 'short',
        day: 'numeric',
      });
    };
    return { distance, locale, formatDateShort };
  }, [settings]);
}

/* ------------------------------------------------------------------ */
/*  lucide -> repo SemanticIcon glyph stand-ins                        */
/* ------------------------------------------------------------------ */

// Route -> repo 'navigation' glyph (title icon + EmptyState glyph). ArrowUpRight
// (the web "go to" affordance next to "View all") has no exact diagonal glyph, so
// the repo 'forward' chevron is used as the nearest navigation affordance.
const ROUTE_GLYPH = getSemanticIconDefinition('navigation').glyph;
const ARROW_UP_RIGHT_GLYPH = getSemanticIconDefinition('forward').glyph;

type GlyphTone = 'cyan' | 'muted';

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
  actions?: ReactNode;
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
  actions,
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
          <View style={styles.shellHeaderRight}>
            {freshnessEl}
            {actions}
          </View>
        </View>
      ) : (
        <>
          {freshnessEl ? (
            <View style={styles.shellFreshnessOverlay}>{freshnessEl}</View>
          ) : null}
          {actions ? (
            <View style={styles.shellActionsRow}>{actions}</View>
          ) : null}
        </>
      )}
      <View style={styles.shellBody}>{children}</View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Widget                                                             */
/* ------------------------------------------------------------------ */

export default function RecentDrivesWidget({ vehicleId }: WidgetProps) {
  const t = useNativeTranslationFallback();
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { distance, locale, formatDateShort } = useNativeFormat();

  const {
    data: drives,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useQuery({
    queryKey: ['drives', id, 'recent-5'],
    queryFn: () => request<Drive[]>(`/drives?vehicle_id=${id}&limit=5`),
    enabled: id > 0,
  });

  const items = drives ?? [];

  return (
    <WidgetShell
      actions={
        <Pressable
          accessibilityLabel={t('widget.viewAll', 'View all')}
          accessibilityRole="button"
          hitSlop={6}
          onPress={() => recentDrivesNavigate('/drives')}
          style={styles.viewAll}>
          <AppText style={styles.viewAllText} tone="muted" variant="caption">
            {t('widget.viewAll', 'View all')}
          </AppText>
          <Glyph
            glyph={ARROW_UP_RIGHT_GLYPH}
            style={styles.viewAllIcon}
            tone="muted"
          />
        </Pressable>
      }
      icon={<Glyph glyph={ROUTE_GLYPH} style={styles.titleIcon} tone="cyan" />}
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={isLoading}
      onRefresh={() => refetch()}
      title={t('widget.recentDrives', 'Recent Drives')}
      updatedAt={dataUpdatedAt}>
      <ScrollView
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        style={styles.list}>
        {items.length > 0 ? (
          items.map(d => (
            <Pressable
              accessibilityRole="button"
              key={d.id}
              onPress={() => recentDrivesNavigate(`/drives/${d.id}`)}
              style={({ pressed }) => [
                styles.driveRow,
                pressed && styles.driveRowPressed,
              ]}>
              <View style={styles.driveInfo}>
                <AppText numberOfLines={1} style={styles.driveDistance}>
                  {fmtNumber(
                    convertDistanceFromSI(d.distance_m ?? 0, distance),
                    1,
                    locale,
                  )}{' '}
                  {distance}
                </AppText>
                <AppText style={styles.driveMeta} tone="muted">
                  {fmtInt((d.duration_s ?? 0) / 60, locale)} min ·{' '}
                  {d.start_soc_pct ?? '?'}% → {d.end_soc_pct ?? '?'}%
                </AppText>
              </View>
              <AppText style={styles.driveDate} tone="muted">
                {formatDateShort(d.start_ts)}
              </AppText>
            </Pressable>
          ))
        ) : (
          <EmptyState
            glyph={ROUTE_GLYPH}
            message={t('widget.noDrives', 'No recent drives')}
          />
        )}
      </ScrollView>
    </WidgetShell>
  );
}

RecentDrivesWidget.displayName = 'RecentDrivesWidget';

// Surfaced so the i18n namespace the web widget used is retained and inspectable.
export const RECENT_DRIVES_WIDGET_I18N_NAMESPACE = I18N_NAMESPACE;

const styles = StyleSheet.create({
  // --- Glyph base ---
  glyph: {
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.4,
  },
  titleIcon: {
    fontSize: 13,
    lineHeight: 16,
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
  shellHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
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
  shellActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
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

  // --- View all action ---
  viewAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  viewAllText: {
    fontSize: 10,
    lineHeight: 14,
  },
  viewAllIcon: {
    fontSize: 10,
    lineHeight: 14,
  },

  // --- Drive list ---
  list: {
    flex: 1,
  },
  listContent: {
    gap: spacing.sm,
  },
  driveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
  },
  driveRowPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  driveInfo: {
    flexShrink: 1,
    minWidth: 0,
  },
  driveDistance: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  driveMeta: {
    fontSize: 10,
    lineHeight: 14,
  },
  driveDate: {
    fontSize: 10,
    lineHeight: 14,
    flexShrink: 0,
  },

  // --- EmptyState ---
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
  },
  emptyGlyph: {
    fontSize: 18,
    lineHeight: 22,
  },
  emptyMessage: {
    textAlign: 'center',
  },
});

const glyphToneStyles = StyleSheet.create({
  cyan: {
    color: colors.accent,
  },
  muted: {
    color: colors.textMuted,
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
