// Native parity port of web/src/features/dashboard/widgets/DestinationETAWidget.tsx.
//
// The web widget is a dashboard tile that shows a vehicle's live navigation /
// destination state. It reads the latest /location-snapshots/latest snapshot via
// useLocationSnapshotLatest (falling back to the first vehicle's id when no
// explicit vehicleId prop is given) and renders three layouts:
//   * compact (size.cols <= 1): a <WidgetBigNumber> ETA when navigating, an
//     emoji + location <Badge> when parked, or an <EmptyState> when no snapshot.
//   * standard non-navigating: title header + emoji + location <Badge> + a
//     "No active navigation" caption.
//   * standard navigating: destination name + an animated ETA countdown +
//     remaining distance (converted from SI via convertDistanceFromSI) + a
//     proportional progress bar.
//
// None of the web imports are native-safe, so — mirroring the sibling native
// ports (CostBreakdownWidget, SecurityStatusWidget) — every piece is rebuilt with
// React Native primitives, AppText, the repo SemanticIcon glyphs, the design
// tokens, and the existing native vehicle hooks. The deps with no native port yet
// (WidgetShell, ./shared WidgetBigNumber, ./types WidgetProps,
// @/components/data-display AnimatedNumber, @/components/ui Badge,
// @/components/feedback EmptyState, @/hooks/useUnits, @/lib/numberFormat
// fmtNumber/fmtInt, @/lib/unitConversion convertDistanceFromSI, lucide-react
// Navigation2, react-i18next) are inlined as self-contained native-safe parity.
//
// Line-by-line coverage of the source:
//   L1     useTranslation -> useNativeTranslationFallback (namespace retained as
//          I18N_NAMESPACE; the 2-arg (key, fallback) signature is preserved).
//   L2     lucide Navigation2 -> repo SemanticIcon 'navigationAlt' glyph (N2).
//   L3     AnimatedNumber -> inlined native AnimatedNumber (renders fmtNumber with
//          0 decimals; the web count-up has no native runtime).
//   L4     @/components/ui Badge -> inlined native Badge.
//   L5     @/components/feedback EmptyState -> inlined native EmptyState.
//   L6     useLocationSnapshotLatest + useVehicles -> native api hooks (same names,
//          same /location-snapshots/latest?vehicle_id= and /vehicles paths).
//   L7     useUnits -> inlined unitPrefs.distance (native 'km' default).
//   L8     fmtNumber/fmtInt -> inlined (en-US toLocaleString, safeNumber-guarded).
//   L9     ./WidgetShell -> inlined native parity.
//   L10    ./shared WidgetBigNumber -> inlined native parity.
//   L11    ./types WidgetProps -> mirrored field-for-field.
//   L12    convertDistanceFromSI -> inlined verbatim (km/mi/ft, METERS_PER_* consts).
//   L14-22 locationBadge(snapshot, t): home->success 🏠, work->neutral 🏢,
//          favorite->neutral ⭐, else other->warning 📍 -> ported verbatim; every
//          i18n key (home/work/favorite/other) preserved.
//   L24-29 default export ({vehicleId, size}); t; useVehicles; vid = vehicleId ??
//          vehicles?.[0]?.id; unitPrefs; toDistanceDisplay closure -> ported.
//   L31    distanceUnit = unitPrefs.distance -> ported.
//   L33-42 useLocationSnapshotLatest(vid ?? 0) destructure (snapshot/isLoading/
//          error/isFetching/isStale/isError/dataUpdatedAt/refetch) -> ported.
//   L44    isCompact = size.cols <= 1 -> ported.
//   L46-48 isNavigating = snapshot != null && destination_name != null && != ''.
//   L50-52 milesToArrival/minutesToArrival/destinationName (?? fallbacks) -> ported.
//   L54-57 displayDistance + progressPercent (100 - m/(m+1)*100, clamped) -> ported.
//   L59    locBadge = locationBadge(snapshot, t) -> ported.
//   L61-69 shellProps (loading/error/updatedAt ?? 0/isFetching/isStale/isError/
//          onRefresh) -> ported verbatim, including the per-branch overrides.
//   L71-127 compact layouts: empty -> EmptyState(Nav,noData); navigating ->
//          WidgetBigNumber(round(min), 'min', 'ETA'); parked -> emoji(2xl)+Badge.
//   L129-166 standard empty + non-navigating layouts (title header + Nav icon).
//   L168-227 navigating full layout: destination row (Nav icon + name), ETA col
//          (AnimatedNumber round(min) + etaDisplay) + distance col (fmtNumber 1dp +
//          unit), progress track/fill + Remaining labels -> ported verbatim.
//   L228   component close.
//
// No DOM, no react-i18next, no lucide-react, no Recharts/SVG, no Leaflet, no
// framer-motion and no web UI components are imported — only RN primitives plus
// existing apps/native components/tokens/hooks.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import {getSemanticIconDefinition} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {
  useLocationSnapshotLatest,
  useVehicles,
} from '../../../api/hooks/useVehicles';

/* ------------------------------------------------------------------ */
/*  i18n fallback (inlined react-i18next port)                         */
/* ------------------------------------------------------------------ */

// The web widget read `t` from useTranslation('dashboard'). Native parity has no
// i18n runtime wired, so this returns the English fallback for every (key,
// fallback) pair. The 2-arg `(key, fallback) => string` signature matches the
// source's `t` usage exactly (no interpolation is used in this widget).
const I18N_NAMESPACE = 'dashboard';

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
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
/*  Inlined @/lib/numberFormat fmtNumber / fmtInt                       */
/* ------------------------------------------------------------------ */

// Web fmtNumber/fmtInt format with the user's locale + global precision; native
// has no settings store wired here, so the faithful en-US default is used and
// callers pass explicit decimals where they differ (1 for distance, 0 for ints).
function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function fmtNumber(value: unknown, decimals = 0): string {
  try {
    return safeNumber(value).toLocaleString('en-US', {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  } catch {
    return String(safeNumber(value));
  }
}

function fmtInt(value: unknown): string {
  return fmtNumber(value, 0);
}

/* ------------------------------------------------------------------ */
/*  Inlined @/lib/unitConversion convertDistanceFromSI + useUnits       */
/* ------------------------------------------------------------------ */

// Ported verbatim from web/src/lib/unitConversion.ts: SI meters in, display unit
// out. Web useUnits().unitPrefs.distance derives from settings.unit_of_length,
// defaulting to 'km'; native has no settings store wired here, so the distance
// preference resolves to its 'km' default. The union type is preserved so the
// 'mi'/'ft' branches stay valid comparisons.
type DistanceUnitPref = 'km' | 'mi' | 'ft';

const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;
const METERS_PER_FOOT = 0.3048;

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

const DEFAULT_DISTANCE_PREF: DistanceUnitPref = 'km';
const unitPrefs: {distance: DistanceUnitPref} = {distance: DEFAULT_DISTANCE_PREF};

/* ------------------------------------------------------------------ */
/*  lucide Navigation2 -> repo SemanticIcon glyph                       */
/* ------------------------------------------------------------------ */

// Repo-canonical native stand-in for the lucide Navigation2 glyph, resolved once.
// The web header / destination icons are text-cyan-400 (accent); the EmptyState
// icon inherits the muted empty-state colour.
const NAV_GLYPH = getSemanticIconDefinition('navigationAlt').glyph;

type GlyphTone = 'accent' | 'muted';

function NavGlyph({
  tone = 'accent',
  style,
}: {
  tone?: GlyphTone;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <AppText style={[styles.navGlyph, style]} tone={tone} weight="bold">
      {NAV_GLYPH}
    </AppText>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/data-display AnimatedNumber                    */
/* ------------------------------------------------------------------ */

// web AnimatedNumber count-up renders fmtNumber(value, decimals) with decimals
// defaulting to 0. There is no native count-up runtime here, so the final
// formatted value renders directly (visual end-state parity).
function AnimatedNumber({
  value,
  style,
}: {
  value: number;
  style?: StyleProp<TextStyle>;
}) {
  return <AppText style={style}>{fmtNumber(value, 0)}</AppText>;
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/ui Badge                                       */
/* ------------------------------------------------------------------ */

// Native Badge variants (the location ternary only ever produces success /
// warning / neutral; danger is supported so WidgetBigNumber's error badge maps
// cleanly, matching the sibling ports).
type BadgeVariant = 'success' | 'warning' | 'danger' | 'neutral';

function Badge({
  variant,
  children,
}: {
  variant: BadgeVariant;
  children: ReactNode;
}) {
  return (
    <View style={[styles.badge, badgeSurfaceStyles[variant]]}>
      <AppText style={[styles.badgeText, badgeTextStyles[variant]]}>
        {children}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/feedback EmptyState                            */
/* ------------------------------------------------------------------ */

// web EmptyState(icon, message): a centred icon above a muted message line.
function EmptyState({icon, message}: {icon?: ReactNode; message: string}) {
  return (
    <View style={styles.emptyState}>
      {icon}
      <AppText style={styles.emptyMessage} tone="muted" variant="caption">
        {message}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined ./shared WidgetBigNumber                                   */
/* ------------------------------------------------------------------ */

type WidgetBadgeVariant = 'success' | 'warning' | 'error' | 'neutral';

const badgeVariantMap: Record<WidgetBadgeVariant, BadgeVariant> = {
  success: 'success',
  warning: 'warning',
  error: 'danger',
  neutral: 'neutral',
};

// web WidgetBigNumber: a large value (AnimatedNumber when animated) + optional
// unit / label / subtitle / badge. The native parity keeps the same layout.
function WidgetBigNumber({
  value,
  unit,
  label,
  subtitle,
  badge,
  valueColor,
  nullDisplay = '—',
  animated = true,
}: {
  value: number | null;
  unit?: string;
  label?: string;
  subtitle?: string;
  badge?: {text: string; variant: WidgetBadgeVariant};
  valueColor?: string;
  nullDisplay?: string;
  animated?: boolean;
}) {
  const valueColorStyle = valueColor ? {color: valueColor} : null;
  return (
    <View style={styles.bigNumber}>
      <View style={styles.bigNumberValueRow}>
        {value !== null ? (
          animated ? (
            <AnimatedNumber
              style={[styles.bigNumberValue, valueColorStyle]}
              value={value}
            />
          ) : (
            <AppText
              style={[styles.bigNumberValue, styles.tabularNums, valueColorStyle]}>
              {String(value)}
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
        <AppText style={styles.bigNumberLabel} tone="muted">
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

      {badge ? (
        <Badge variant={badgeVariantMap[badge.variant]}>{badge.text}</Badge>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined ./WidgetShell                                              */
/* ------------------------------------------------------------------ */

// Relative "updated X ago" formatter for the freshness caption. The web
// <DataFreshness> renders this internally; it has no native port yet, so it is
// reproduced here as part of the shell parity.
function formatUpdatedAgo(updatedAt: number, t: NativeTFunction): string {
  const diff = Date.now() - updatedAt;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) {
    return t('widget.justNow', 'Just now');
  }
  if (minutes < 60) {
    return `${minutes}m ${t('widget.ago', 'ago')}`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ${t('widget.ago', 'ago')}`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ${t('widget.ago', 'ago')}`;
}

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
          {formatUpdatedAgo(updatedAt, t)}
        </AppText>
      ) : null}
    </Pressable>
  );
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
  // Pulse-on-data-change effect (web `justUpdated`): the transient flag drives a
  // subtle border highlight in place of the web box shadow.
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
/*  locationBadge (ported verbatim)                                    */
/* ------------------------------------------------------------------ */

function locationBadge(
  snapshot:
    | {
        located_at_home?: boolean;
        located_at_work?: boolean;
        located_at_favorite?: boolean;
      }
    | null
    | undefined,
  t: NativeTFunction,
): {emoji: string; label: string; variant: 'success' | 'warning' | 'neutral'} {
  if (snapshot?.located_at_home) {
    return {
      emoji: '🏠',
      label: t('widget.destinationETA.home', 'Home'),
      variant: 'success',
    };
  }
  if (snapshot?.located_at_work) {
    return {
      emoji: '🏢',
      label: t('widget.destinationETA.work', 'Work'),
      variant: 'neutral',
    };
  }
  if (snapshot?.located_at_favorite) {
    return {
      emoji: '⭐',
      label: t('widget.destinationETA.favorite', 'Favorite'),
      variant: 'neutral',
    };
  }
  return {
    emoji: '📍',
    label: t('widget.destinationETA.other', 'Other'),
    variant: 'warning',
  };
}

/* ------------------------------------------------------------------ */
/*  Widget                                                             */
/* ------------------------------------------------------------------ */

export default function DestinationETAWidget({vehicleId, size}: WidgetProps) {
  const t = useNativeTranslationFallback();
  const {data: vehicles} = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const toDistanceDisplay = (value: number) =>
    convertDistanceFromSI(value, unitPrefs.distance);

  const distanceUnit = unitPrefs.distance;

  const {
    data: snapshot,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useLocationSnapshotLatest(vid ?? 0);

  const isCompact = size.cols <= 1;

  const isNavigating =
    snapshot != null &&
    snapshot.destination_name != null &&
    snapshot.destination_name !== '';

  const milesToArrival = snapshot?.miles_to_arrival ?? 0;
  const minutesToArrival = snapshot?.minutes_to_arrival ?? 0;
  const destinationName = snapshot?.destination_name ?? '—';

  const displayDistance = toDistanceDisplay(milesToArrival);
  const progressPercent =
    isNavigating && milesToArrival > 0
      ? Math.max(
          0,
          Math.min(100, 100 - (milesToArrival / (milesToArrival + 1)) * 100),
        )
      : 0;

  const locBadge = locationBadge(snapshot, t);

  const shellProps = {
    loading: isLoading,
    error: error ? String(error) : null,
    updatedAt: dataUpdatedAt ?? 0,
    isFetching,
    isStale,
    isError,
    onRefresh: () => {
      refetch();
    },
  };

  // ── Compact (1×2) ──
  if (isCompact) {
    if (!snapshot) {
      return (
        <WidgetShell
          {...shellProps}
          isError={isError}
          isFetching={isFetching}
          isStale={isStale}
          onRefresh={() => refetch()}
          updatedAt={dataUpdatedAt}>
          {/* no-action: transient empty state — surfaces when source data is
              missing; no specific recovery action available */}
          <EmptyState
            icon={<NavGlyph style={styles.emptyGlyph} tone="muted" />}
            message={t('widget.destinationETA.noData', 'No location data')}
          />
        </WidgetShell>
      );
    }

    if (isNavigating) {
      return (
        <WidgetShell
          {...shellProps}
          isError={isError}
          isFetching={isFetching}
          isStale={isStale}
          onRefresh={() => refetch()}
          updatedAt={dataUpdatedAt}>
          <WidgetBigNumber
            label={t('widget.destinationETA.eta', 'ETA')}
            unit={t('widget.destinationETA.min', 'min')}
            value={Math.round(minutesToArrival)}
          />
        </WidgetShell>
      );
    }

    return (
      <WidgetShell
        {...shellProps}
        isError={isError}
        isFetching={isFetching}
        isStale={isStale}
        onRefresh={() => refetch()}
        updatedAt={dataUpdatedAt}>
        <View style={styles.compactCenter}>
          <AppText
            accessibilityLabel={locBadge.label}
            accessibilityRole="image"
            style={styles.compactEmoji}>
            {locBadge.emoji}
          </AppText>
          <Badge
            variant={
              locBadge.variant === 'success'
                ? 'success'
                : locBadge.variant === 'warning'
                  ? 'warning'
                  : 'neutral'
            }>
            {locBadge.label}
          </Badge>
        </View>
      </WidgetShell>
    );
  }

  // ── Standard (2×2) ──
  if (!snapshot) {
    return (
      <WidgetShell
        icon={<NavGlyph style={styles.headerGlyph} />}
        title={t('widget.destinationETA.title', 'Destination ETA')}
        {...shellProps}>
        {/* no-action: transient empty state — surfaces when source data is
            missing; no specific recovery action available */}
        <EmptyState
          icon={<NavGlyph style={styles.emptyGlyph} tone="muted" />}
          message={t('widget.destinationETA.noData', 'No location data')}
        />
      </WidgetShell>
    );
  }

  if (!isNavigating) {
    return (
      <WidgetShell
        icon={<NavGlyph style={styles.headerGlyph} />}
        title={t('widget.destinationETA.title', 'Destination ETA')}
        {...shellProps}>
        <View style={styles.standardCenter}>
          <AppText
            accessibilityLabel={locBadge.label}
            accessibilityRole="image"
            style={styles.standardEmoji}>
            {locBadge.emoji}
          </AppText>
          <Badge
            variant={
              locBadge.variant === 'success'
                ? 'success'
                : locBadge.variant === 'warning'
                  ? 'warning'
                  : 'neutral'
            }>
            {locBadge.label}
          </Badge>
          <AppText style={styles.noNav} tone="muted" variant="caption">
            {t('widget.destinationETA.noNav', 'No active navigation')}
          </AppText>
        </View>
      </WidgetShell>
    );
  }

  // Navigating — full layout
  const etaHours = Math.floor(minutesToArrival / 60);
  const etaMins = Math.round(minutesToArrival % 60);
  const etaDisplay =
    etaHours > 0
      ? `${fmtInt(etaHours)}h ${fmtInt(etaMins)}m`
      : `${fmtInt(etaMins)}m`;

  return (
    <WidgetShell
      icon={<NavGlyph style={styles.headerGlyph} />}
      title={t('widget.destinationETA.title', 'Destination ETA')}
      {...shellProps}>
      <View style={styles.navContainer}>
        {/* Destination name */}
        <View style={styles.destRow}>
          <NavGlyph style={styles.destGlyph} />
          <AppText numberOfLines={1} style={styles.destName} weight="semibold">
            {destinationName}
          </AppText>
        </View>

        {/* ETA countdown + distance */}
        <View style={styles.metricsRow}>
          <View style={styles.metricCol}>
            <AnimatedNumber
              style={styles.etaValue}
              value={Math.round(minutesToArrival)}
            />
            <AppText style={styles.metricUnit} tone="muted">
              {etaDisplay}
            </AppText>
          </View>

          <View style={styles.metricCol}>
            <AppText style={styles.distanceValue}>
              {fmtNumber(displayDistance, 1)}
            </AppText>
            <AppText style={styles.metricUnit} tone="muted">
              {distanceUnit}
            </AppText>
          </View>
        </View>

        {/* Progress bar */}
        <View style={styles.progressWrap}>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, {width: `${progressPercent}%`}]} />
          </View>
          <View style={styles.progressLabels}>
            <AppText style={styles.progressLabel} tone="muted">
              {t('widget.destinationETA.remaining', 'Remaining')}
            </AppText>
            <AppText style={styles.progressLabel} tone="muted">
              {fmtNumber(displayDistance, 1)} {distanceUnit}
            </AppText>
          </View>
        </View>
      </View>
    </WidgetShell>
  );
}

// Namespace retained as a discoverable export (the web widget read it via
// useTranslation('dashboard')), mirroring the sibling native widget ports.
export const DESTINATION_ETA_WIDGET_I18N_NAMESPACE = I18N_NAMESPACE;

const styles = StyleSheet.create({
  // --- glyphs ---
  navGlyph: {
    fontSize: 14,
    letterSpacing: 0.4,
    lineHeight: 16,
  },
  headerGlyph: {
    fontSize: 12,
    lineHeight: 14,
  },
  destGlyph: {
    fontSize: 16,
    lineHeight: 18,
  },

  // --- compact / standard parked layouts ---
  compactCenter: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 44,
  },
  compactEmoji: {
    fontSize: 24,
    lineHeight: 28,
  },
  standardCenter: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
    justifyContent: 'center',
  },
  standardEmoji: {
    fontSize: 30,
    lineHeight: 34,
  },
  noNav: {
    textAlign: 'center',
  },

  // --- navigating full layout ---
  navContainer: {
    flex: 1,
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  destRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 44,
  },
  destName: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 18,
  },
  metricsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  metricCol: {
    alignItems: 'center',
    gap: 2,
  },
  etaValue: {
    color: colors.accent,
    fontSize: 30,
    fontWeight: '800',
    lineHeight: 36,
  },
  distanceValue: {
    color: colors.textPrimary,
    fontSize: 20,
    fontVariant: ['tabular-nums'],
    fontWeight: '600',
    lineHeight: 26,
  },
  metricUnit: {
    fontSize: 10,
    letterSpacing: 0.8,
    lineHeight: 14,
    textTransform: 'uppercase',
  },
  progressWrap: {
    flexDirection: 'column',
    gap: spacing.xs,
  },
  progressTrack: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    height: 8,
    overflow: 'hidden',
    width: '100%',
  },
  progressFill: {
    backgroundColor: colors.accent,
    borderRadius: 999,
    height: '100%',
  },
  progressLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  progressLabel: {
    fontSize: 10,
    lineHeight: 14,
  },

  // --- WidgetBigNumber ---
  bigNumber: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.xs,
    justifyContent: 'center',
  },
  bigNumberValueRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  bigNumberValue: {
    color: colors.textPrimary,
    fontSize: 30,
    fontWeight: '800',
    lineHeight: 36,
  },
  tabularNums: {
    fontVariant: ['tabular-nums'],
  },
  bigNumberUnit: {
    fontSize: 18,
    lineHeight: 22,
  },
  bigNumberLabel: {
    fontSize: 10,
    letterSpacing: 0.8,
    lineHeight: 14,
    textTransform: 'uppercase',
  },
  bigNumberSubtitle: {
    textAlign: 'center',
  },

  // --- Badge ---
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 14,
  },

  // --- EmptyState ---
  emptyState: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.xs,
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  emptyGlyph: {
    fontSize: 20,
    lineHeight: 24,
  },
  emptyMessage: {
    textAlign: 'center',
  },

  // --- WidgetShell ---
  shell: {
    flex: 1,
  },
  shellPulse: {
    borderColor: colors.successBorder,
    borderRadius: 12,
    borderWidth: 1,
  },
  shellState: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.md,
  },
  shellHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  shellHeaderLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: 6,
  },
  shellTitle: {
    fontSize: 11,
    letterSpacing: 0.8,
    lineHeight: 14,
    textTransform: 'uppercase',
  },
  shellFreshnessOverlay: {
    alignItems: 'flex-end',
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
  },
  shellBody: {
    flex: 1,
    paddingBottom: spacing.sm,
    paddingHorizontal: spacing.md,
  },

  // --- DataFreshness ---
  freshness: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  freshnessDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  freshnessLabel: {
    fontSize: 10,
    lineHeight: 12,
  },
});

const badgeSurfaceStyles = StyleSheet.create({
  success: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  warning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
  danger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  neutral: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
});

const badgeTextStyles = StyleSheet.create({
  success: {
    color: colors.success,
  },
  warning: {
    color: colors.warning,
  },
  danger: {
    color: colors.danger,
  },
  neutral: {
    color: colors.textSecondary,
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
