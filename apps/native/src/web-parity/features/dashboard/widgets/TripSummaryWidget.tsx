// Native parity port of
// web/src/features/dashboard/widgets/TripSummaryWidget.tsx.
//
// A dashboard widget that summarises a fleet's trips. When at least one trip
// exists it renders a "Last Trip" card (a "Last Trip" badge + the trip's short
// start date, the trip name, and a 2x2 / 1x4 stat grid of Distance, Duration,
// Drives, and Charge Stops) followed by a "Recent Trips" list (the 2nd and 3rd
// of the latest three trips, each showing the trip name + date on the left and
// — only outside the compact 1-col layout — distance, duration, and a "N drv"
// badge on the right; in the compact layout only the distance shows). When
// there are no trips the body never hides — it falls back to an EmptyState
// ("No trips recorded yet"). The shell renders the "Trip Summary" title, a
// navigation icon, and a query-freshness chip wired to refetch.
//
// Following the established conversion idiom for this directory
// (RecentDrivesListWidget / MediaHistoryWidget / DriveEfficiencyChartWidget),
// every web-only / not-yet-ported dependency is reproduced native-safe with
// React Native primitives + the shared native building blocks and documented
// in the sidecar:
//
//   - @/api/hooks/useTrips (web source L7) -> the native useTrips hook
//     (../../../api/hooks/useTrips), imported unchanged. It preserves the
//     exact query: queryKey [...tripKeys.all, params], queryFn calling
//     request<Trip[]>('/trips?limit=5'), select=safeArray. The widget's
//     `useTrips({ limit: 5 })` call and the destructured state names (data,
//     isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch) are
//     preserved verbatim.
//   - @/hooks/useUnits (web L8) -> inline `useUnits`, deriving
//     `unitPrefs.distance` from the native useSettings
//     (../../../api/hooks/useSettings) exactly as web useUnits' deriveDistance
//     does (unit_of_length === 'mi' -> 'mi' else 'km'). This widget only reads
//     `unitPrefs.distance`.
//   - @/lib/unitConversion convertDistanceFromSI (web L14) -> inlined verbatim
//     (km = m/1000, mi = m/1609.344, ft = m/0.3048) with the NIST metre
//     constants; no native unitConversion module exists yet.
//   - @/lib/dateFormat formatDurationRange (web L9) -> imported from the native
//     lib/dateFormat port (../../../lib/dateFormat), which is the byte-for-byte
//     native parity of the same web module.
//   - @/hooks/useDateFormat formatDateShort (web L11, L22) -> the native
//     useDateFormat hook (../../../hooks/useDateFormat), the faithful parity
//     port that binds locale + timezone from settings; `formatDateShort` is
//     destructured as `formatDate` exactly as the web source does.
//   - @/lib/numberFormat fmtNumber/fmtInt (web L10) -> inlined verbatim
//     (safeNumber guard, en-US grouping; fmtNumber default precision 2, the
//     web unconfigured default; fmtInt = fmtNumber(v, 0)); no native
//     numberFormat module exists yet.
//   - @/components/feedback EmptyState (web L6) -> shared native EmptyState
//     (web single `message` -> native EmptyState `title`, empty `message`); the
//     web `icon` (Navigation) has no native EmptyState slot and is dropped (the
//     navigation signal is preserved by the shell header glyph).
//   - @/components/ui Badge (web L4) -> inline `Badge`: a neutral rounded-full
//     pill (the web default `neutral` variant) carrying the web `text-[10px]`
//     override.
//   - @/components/data-display StatCard (web L5) -> inline `StatCard`: the web
//     card's label row (muted label + muted icon glyph) over a bold value. The
//     web `text-2xl` value is scaled down to fit the dense widget grid cell
//     (numberOfLines=1); label/value/icon roles are preserved.
//   - ./WidgetShell (web L12) -> inline `WidgetShell` (skeleton on loading;
//     else an icon + uppercase muted title header with the freshness chip, over
//     the body). Only the props this widget passes are honoured (title, icon,
//     loading, updatedAt, isFetching, isStale, isError, onRefresh, children);
//     the shell's error/noPadding/actions/help/PinButton extras are out of
//     scope (this widget never passes them).
//   - @/components/data-display DataFreshness (rendered by the shell) ->
//     inline `WidgetFreshness`: same isError>fetching>stale>fresh precedence,
//     the same dot colour tiers (#34d399/#38bdf8/#fbbf24/#f87171), the
//     "just now / Nm/Nh/Nd/Nw ago" relative ladder, "updating…"/"error"
//     labels, a 30s re-render tick, and onRefresh wired to a role=button
//     Pressable.
//   - lucide-react Navigation/MapPin/Clock/Zap/Route (web L3) have no native
//     icon font; they become small tintable glyphs: Navigation -> a cyan
//     "\u27A4" header/identity glyph; MapPin -> "\u25C9"; Clock -> "\u25F7";
//     Route -> "\u21DD"; Zap -> "\u26A1". The empty-state Navigation icon is
//     dropped (no native EmptyState icon slot).
//   - react-i18next useTranslation('dashboard') (web L2, L17) -> a native
//     English-default `t` that keeps every widget.*/freshness.*/a11y.* key +
//     {{var}} interpolation intact.
//   - ./types WidgetProps (web L13) -> a local WidgetSize/WidgetProps subset
//     (only `size` is read; size.cols drives the compact layout).
//
// State names (unitPrefs, distanceUnit, formatDate, data, isLoading,
// isFetching, isStale, isError, dataUpdatedAt, refetch, trips, lastTrip,
// recentTrips, isCompact) and the pure helpers (toDistanceDisplay, displayDist)
// are preserved verbatim. No DOM, react-router, framer-motion, lucide-react,
// Recharts, Leaflet, or old web UI components are imported into the native
// output.

import React, {useEffect, useMemo, useState} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {useTrips, type Trip} from '../../../api/hooks/useTrips';
import {useSettings} from '../../../api/hooks/useSettings';
import {useDateFormat} from '../../../hooks/useDateFormat';
import {formatDurationRange} from '../../../lib/dateFormat';

/* ─── i18n fallback (mirrors i18next default-value + {{var}} interpolation) ─── */

type TVars = Record<string, string | number>;

// react-i18next is not wired in native; i18next returns the supplied English
// default when a translation is missing, so this fallback returns that default
// while keeping every widget.*/freshness.*/a11y.* key verbatim and applying the
// same {{var}} interpolation as the web `t` (useTranslation('dashboard')).
function t(key: string, fallback: string, vars?: TVars): string {
  let out = fallback ?? key;
  if (vars) {
    for (const varKey of Object.keys(vars)) {
      out = out.split(`{{${varKey}}}`).join(String(vars[varKey]));
    }
  }
  return out;
}

/* ─── Glyph substitutes for lucide-react icons ────────────────────────────── */

// lucide Navigation -> "\u27A4" (black rightwards arrowhead) tinted cyan, the
// widget identity. lucide MapPin -> "\u25C9" (fisheye). lucide Clock ->
// "\u25F7" (upper-right quadrant circle). lucide Route -> "\u21DD" (rightwards
// squiggle arrow). lucide Zap -> "\u26A1" (high voltage).
const NAVIGATION_GLYPH = '\u27A4';
const MAP_PIN_GLYPH = '\u25C9';
const CLOCK_GLYPH = '\u25F7';
const ROUTE_GLYPH = '\u21DD';
const ZAP_GLYPH = '\u26A1';

/* ─── Inlined number formatters (web @/lib/numberFormat) ───────────────────── */

// Mirrors web lib/numberFormat.safeNumber: nullish / non-finite -> 0.
function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// web fmtNumber — locale-grouped, fixed precision. The web global precision
// defaults to 2 (set by useSettings, which this widget does not wire), so 2 is
// the faithful unconfigured default; this widget always passes an explicit
// precision (1) for distances.
function fmtNumber(v: unknown, decimals = 2): string {
  return safeNumber(v).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// web fmtInt — fmtNumber at zero precision.
function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

/* ─── Inlined unit handling (mirror web useUnits + lib/unitConversion) ─────── */

type DistanceUnitPref = 'km' | 'mi' | 'ft';

interface UnitPrefs {
  distance: DistanceUnitPref;
}

// NIST metre constants (web lib/unitConversion).
const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;
const METERS_PER_FOOT = 0.3048;

// Pure SI -> display converter, verbatim from web lib/unitConversion.
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

// Mirrors web useUnits: derive the distance preference from useSettings exactly
// as web's deriveDistance does (unit_of_length === 'mi' -> 'mi' else 'km').
// This widget only reads `unitPrefs.distance`, so the mirror exposes just it.
function useUnits(): {unitPrefs: UnitPrefs} {
  const {data: settings} = useSettings();
  const distance: DistanceUnitPref =
    settings?.unit_of_length === 'mi' ? 'mi' : 'km';
  return useMemo(() => ({unitPrefs: {distance}}), [distance]);
}

/* ─── Widget contract types (web ./types.ts subset) ───────────────────────── */

interface WidgetSize {
  cols: number;
  rows: number;
}

export interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: Record<string, unknown>;
}

/* ─── WidgetFreshness (web data-display DataFreshness 4-state chip) ────────── */

type FreshnessStatus = 'fresh' | 'fetching' | 'stale' | 'error';

// web FRESHNESS_COLORS dot tiers (emerald-400 / sky-400 / amber-400 / red-400).
const FRESHNESS_DOT: Record<FreshnessStatus, string> = {
  fresh: '#34d399',
  fetching: '#38bdf8',
  stale: '#fbbf24',
  error: '#f87171',
};

// web DataFreshness.formatRelativeTime — minute/hour/day/week relative ladder.
function formatFreshnessRelative(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) {
    return t('freshness.justNow', 'just now');
  }
  if (seconds < 3600) {
    return t('freshness.minutes', '{{m}}m ago', {m: Math.floor(seconds / 60)});
  }
  if (seconds < 86_400) {
    return t('freshness.hours', '{{h}}h ago', {h: Math.floor(seconds / 3600)});
  }
  if (seconds < 604_800) {
    return t('freshness.days', '{{d}}d ago', {d: Math.floor(seconds / 86_400)});
  }
  return t('freshness.weeks', '{{w}}w ago', {w: Math.floor(seconds / 604_800)});
}

// web DataFreshness re-renders on a 30s cadence so the relative label stays
// accurate; the interval only runs while there is a timestamp to age.
function useThirtySecondTick(active: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) {
      return;
    }
    const id = setInterval(() => setTick(n => n + 1), 30_000);
    return () => clearInterval(id);
  }, [active]);
}

function WidgetFreshness({
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
}: {
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
}) {
  useThirtySecondTick(!!updatedAt && updatedAt > 0);

  const status: FreshnessStatus = isError
    ? 'error'
    : isFetching
      ? 'fetching'
      : isStale
        ? 'stale'
        : 'fresh';

  const relativeTime =
    updatedAt && updatedAt > 0 && !isFetching
      ? formatFreshnessRelative(updatedAt)
      : isFetching
        ? t('freshness.updating', 'updating\u2026')
        : isError
          ? t('freshness.error', 'error')
          : '';

  const refreshable = !!onRefresh && !isFetching;

  return (
    <Pressable
      accessibilityRole={onRefresh ? 'button' : 'text'}
      accessibilityLabel={
        onRefresh
          ? t('freshness.refresh', 'Refresh')
          : t('a11y.dataFreshness', 'Data freshness: {{state}}', {
              state: status,
            })
      }
      accessibilityState={{disabled: !refreshable}}
      disabled={!refreshable}
      onPress={() => {
        if (refreshable) {
          onRefresh?.();
        }
      }}
      testID="trip-summary-freshness"
      style={styles.freshness}>
      <View
        style={[styles.freshnessDot, {backgroundColor: FRESHNESS_DOT[status]}]}
        testID="trip-summary-freshness-dot"
      />
      {relativeTime ? (
        <AppText
          variant="caption"
          tone="muted"
          numberOfLines={1}
          style={styles.freshnessLabel}>
          {relativeTime}
        </AppText>
      ) : null}
    </Pressable>
  );
}

/* ─── NavigationGlyph (web header lucide Navigation, text-neon-cyan) ───────── */

function NavigationGlyph() {
  return (
    <View style={styles.headerGlyph} accessibilityElementsHidden>
      <AppText variant="caption" weight="bold" tone="accent">
        {NAVIGATION_GLYPH}
      </AppText>
    </View>
  );
}

/* ─── Badge (web @/components/ui Badge, default neutral, text-[10px]) ──────── */

function Badge({children}: {children: React.ReactNode}) {
  return (
    <View style={styles.badge}>
      <AppText numberOfLines={1} style={styles.badgeText}>
        {children}
      </AppText>
    </View>
  );
}

/* ─── StatCard (web @/components/data-display StatCard) ────────────────────── */

function StatCard({
  label,
  value,
  icon,
  compact,
}: {
  label: string;
  value: string;
  icon: string;
  compact: boolean;
}) {
  return (
    <View style={[styles.statCard, compact ? styles.statCardCompact : styles.statCardWide]}>
      <View style={styles.statHeader}>
        <AppText
          variant="caption"
          tone="muted"
          numberOfLines={1}
          style={styles.statLabel}>
          {label}
        </AppText>
        <AppText
          variant="caption"
          tone="muted"
          accessibilityElementsHidden
          style={styles.statIcon}>
          {icon}
        </AppText>
      </View>
      <AppText weight="bold" numberOfLines={1} style={styles.statValue}>
        {value}
      </AppText>
    </View>
  );
}

/* ─── WidgetShell (web ./WidgetShell.tsx subset) ──────────────────────────── */

function WidgetShell({
  title,
  icon,
  loading,
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
  children,
  testID,
}: {
  title: string;
  icon: React.ReactNode;
  loading?: boolean;
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
  children: React.ReactNode;
  testID?: string;
}) {
  if (loading) {
    return <View style={styles.skeleton} testID="trip-summary-loading" />;
  }

  return (
    <View style={styles.shell} testID={testID}>
      <View style={styles.shellHeader}>
        <View style={styles.shellTitleRow}>
          {icon}
          <AppText
            accessibilityRole="header"
            numberOfLines={1}
            style={styles.shellTitle}>
            {title}
          </AppText>
        </View>
        <View style={styles.shellHeaderRight}>
          <WidgetFreshness
            updatedAt={updatedAt}
            isFetching={isFetching}
            isStale={isStale}
            isError={isError}
            onRefresh={onRefresh}
          />
        </View>
      </View>
      <View style={styles.shellBody}>{children}</View>
    </View>
  );
}

/* ─── TripSummaryWidget ───────────────────────────────────────────────────── */

export default function TripSummaryWidget({size}: WidgetProps) {
  const {unitPrefs} = useUnits();
  const toDistanceDisplay = (value: number) =>
    convertDistanceFromSI(value, unitPrefs.distance);

  const distanceUnit = unitPrefs.distance;
  const {formatDateShort: formatDate} = useDateFormat();

  const {data, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch} =
    useTrips({
      limit: 5,
    });

  const trips = useMemo(() => data ?? [], [data]);
  const lastTrip = trips[0] ?? null;
  const recentTrips = trips.slice(0, 3);

  const isCompact = size.cols <= 1;

  const displayDist = (meters: number) => toDistanceDisplay(meters ?? 0);

  return (
    <WidgetShell
      title={t('widget.tripSummary', 'Trip Summary')}
      icon={<NavigationGlyph />}
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
      testID="trip-summary-widget">
      {trips.length === 0 ? (
        // no-action: transient empty state — surfaces when source data is
        // missing; no specific recovery action available.
        <View testID="trip-summary-empty">
          <EmptyState
            title={t('widget.noTrips', 'No trips recorded yet')}
            message=""
          />
        </View>
      ) : (
        <View style={styles.body}>
          {/* Last trip summary */}
          {lastTrip ? (
            <View style={styles.lastTrip} testID="trip-summary-last-trip">
              <View style={styles.lastTripHeader}>
                <Badge>{t('widget.lastTrip', 'Last Trip')}</Badge>
                <AppText
                  variant="caption"
                  tone="muted"
                  numberOfLines={1}
                  style={styles.lastTripDate}>
                  {formatDate(lastTrip.start_date)}
                </AppText>
              </View>

              {/* Start → End */}
              <AppText
                variant="caption"
                tone="secondary"
                numberOfLines={1}
                style={styles.lastTripName}>
                {lastTrip.name ?? t('widget.tripUnnamed', 'Unnamed trip')}
              </AppText>

              {/* Stats grid */}
              <View style={styles.statsGrid}>
                <StatCard
                  label={t('widget.distance', 'Distance')}
                  value={`${fmtNumber(
                    displayDist(lastTrip.total_distance_m ?? 0),
                    1,
                  )} ${distanceUnit}`}
                  icon={MAP_PIN_GLYPH}
                  compact={isCompact}
                />
                <StatCard
                  label={t('widget.duration', 'Duration')}
                  value={formatDurationRange(
                    lastTrip.start_date,
                    lastTrip.end_date,
                  )}
                  icon={CLOCK_GLYPH}
                  compact={isCompact}
                />
                <StatCard
                  label={t('widget.drives', 'Drives')}
                  value={fmtInt(lastTrip.drive_count ?? 0)}
                  icon={ROUTE_GLYPH}
                  compact={isCompact}
                />
                <StatCard
                  label={t('widget.chargeStops', 'Charge Stops')}
                  value={fmtInt(lastTrip.charge_count ?? 0)}
                  icon={ZAP_GLYPH}
                  compact={isCompact}
                />
              </View>
            </View>
          ) : null}

          {/* Recent trips list */}
          {recentTrips.length > 1 ? (
            <View style={styles.recentList}>
              <AppText
                variant="caption"
                tone="muted"
                style={styles.recentHeading}>
                {t('widget.recentTrips', 'Recent Trips')}
              </AppText>
              {recentTrips.slice(1).map((trip: Trip) => (
                <View
                  key={trip.id}
                  testID={`trip-summary-recent-${trip.id}`}
                  style={styles.recentRow}>
                  <View style={styles.recentLeft}>
                    <AppText
                      variant="caption"
                      tone="secondary"
                      numberOfLines={1}
                      style={styles.recentName}>
                      {trip.name ?? t('widget.tripUnnamed', 'Unnamed trip')}
                    </AppText>
                    <AppText
                      variant="caption"
                      tone="muted"
                      style={styles.recentDate}>
                      {formatDate(trip.start_date)}
                    </AppText>
                  </View>
                  {!isCompact ? (
                    <View style={styles.recentRight}>
                      <AppText
                        variant="caption"
                        tone="secondary"
                        style={styles.recentDist}>
                        {`${fmtNumber(
                          displayDist(trip.total_distance_m ?? 0),
                          1,
                        )} ${distanceUnit}`}
                      </AppText>
                      <AppText
                        variant="caption"
                        tone="muted"
                        style={styles.recentDuration}>
                        {formatDurationRange(trip.start_date, trip.end_date)}
                      </AppText>
                      <Badge>
                        {`${fmtInt(trip.drive_count ?? 0)} ${t(
                          'widget.drivesShort',
                          'drv',
                        )}`}
                      </Badge>
                    </View>
                  ) : (
                    <AppText
                      variant="caption"
                      tone="secondary"
                      style={styles.recentDistCompact}>
                      {`${fmtNumber(
                        displayDist(trip.total_distance_m ?? 0),
                        1,
                      )} ${distanceUnit}`}
                    </AppText>
                  )}
                </View>
              ))}
            </View>
          ) : null}
        </View>
      )}
    </WidgetShell>
  );
}

TripSummaryWidget.displayName = 'TripSummaryWidget';

const styles = StyleSheet.create({
  shell: {
    flex: 1,
  },
  shellHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  shellTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 6,
    flexShrink: 1,
  },
  shellTitle: {
    flexShrink: 1,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '500',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  shellHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: spacing.sm,
    flexShrink: 0,
  },
  shellBody: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  skeleton: {
    flex: 1,
    minHeight: 96,
    borderRadius: 12,
    backgroundColor: colors.surfaceRaised,
  },
  headerGlyph: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  freshness: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 4,
    flexShrink: 0,
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
  body: {
    flex: 1,
    rowGap: spacing.md,
  },
  lastTrip: {
    borderRadius: 12,
    padding: spacing.md,
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  lastTripHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 6,
    marginBottom: spacing.sm,
  },
  lastTripDate: {
    flexShrink: 1,
    fontSize: 10,
    lineHeight: 14,
  },
  lastTripName: {
    fontSize: 12,
    lineHeight: 16,
    marginBottom: spacing.sm,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing.sm,
  },
  statCard: {
    borderRadius: 10,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  statCardWide: {
    width: '23%',
  },
  statCardCompact: {
    width: '48%',
  },
  statHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: 4,
    marginBottom: 2,
  },
  statLabel: {
    flexShrink: 1,
    fontSize: 10,
    lineHeight: 14,
  },
  statIcon: {
    fontSize: 11,
    lineHeight: 14,
    flexShrink: 0,
  },
  statValue: {
    fontSize: 16,
    lineHeight: 20,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
  },
  recentList: {
    flexShrink: 1,
    rowGap: 6,
  },
  recentHeading: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '500',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: spacing.sm,
    minHeight: 44,
    padding: spacing.sm,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
  },
  recentLeft: {
    flex: 1,
    minWidth: 0,
  },
  recentName: {
    fontSize: 12,
    lineHeight: 16,
  },
  recentDate: {
    fontSize: 10,
    lineHeight: 14,
  },
  recentRight: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: spacing.md,
    flexShrink: 0,
  },
  recentDist: {
    fontSize: 12,
    lineHeight: 16,
    fontVariant: ['tabular-nums'],
  },
  recentDuration: {
    fontSize: 10,
    lineHeight: 14,
    fontVariant: ['tabular-nums'],
  },
  recentDistCompact: {
    fontSize: 12,
    lineHeight: 16,
    flexShrink: 0,
    fontVariant: ['tabular-nums'],
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  badgeText: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '500',
    color: colors.textSecondary,
  },
});
