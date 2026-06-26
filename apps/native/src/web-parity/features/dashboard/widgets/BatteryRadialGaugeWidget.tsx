// Native parity port of web/src/features/dashboard/widgets/BatteryRadialGaugeWidget.tsx.
//
// The web widget is a dashboard tile that renders the vehicle battery level as a
// radial gauge (via the shared <WidgetGaugeHero> -> <RadialGauge>) with an
// optional thin "charge limit" arc overlay, a stats row on large tiles, and a
// "Charging" pulse line. Data comes from useVehicles()/useVehicleState().
//
// The repo already ships a native parity <RadialGauge> in the charts barrel, so
// the gauge itself is reused from '@/components/charts'. The remaining web deps
// have no native port (WidgetShell, ./shared WidgetGaugeHero, ./types,
// @/components/feedback EmptyState, lucide-react, react-i18next), so — mirroring
// the sibling native port (AutomationStatusWidget) — each is rebuilt inline with
// React Native primitives, AppText, the repo SemanticIcon glyphs and the design
// tokens. React Native has no SVG stroke-dash rendering, so the SVG
// <ChargeLimitRing> is reproduced with positioned native Views.
//
// Line-by-line coverage of the source:
//   L1   `import { useMemo }` -> useMemo (plus useCallback/useEffect/useRef/
//        useState for the inlined WidgetShell + i18n fallback).
//   L2   useTranslation('dashboard') -> useNativeTranslationFallback (the
//        'dashboard' namespace is retained as I18N_NAMESPACE; every i18n key is
//        preserved, fallbacks returned verbatim).
//   L3   lucide Battery -> repo SemanticIcon 'battery' glyph (BATTERY_GLYPH).
//   L4   @/components/feedback EmptyState -> inlined EmptyState.
//   L5   useVehicles/useVehicleState -> native api hooks (same import names).
//   L6   ./WidgetShell -> inlined WidgetShell (freshness pill + pulse).
//   L7   ./shared WidgetGaugeHero + GaugeHeroStat -> inlined native WidgetGaugeHero
//        (reusing the barrel RadialGauge) + GaugeHeroStat type.
//   L8   ./types WidgetProps -> inlined WidgetSize/WidgetConfig/WidgetProps mirror.
//   L10  STROKE_WIDTH = 8 -> ported verbatim (gauge ring thickness, shared by the
//        ChargeLimitRing geometry).
//   L12-16 getBatteryColor(level) -> ported verbatim (>50 green #10b981, >20 amber
//        #f59e0b, else red #ef4444).
//   L18-47 ChargeLimitRing({value,max,gaugeSize}) -> same radius/center/clamp math;
//        the SVG arc (stroke rgba(255,255,255,0.25)) becomes a faint full-ring
//        View overlay plus a marker positioned at the charge-limit angle (the end
//        of the web arc) since RN cannot stroke-dash a partial arc.
//   L49-53 default export ({vehicleId,size}) + useVehicles + id fallback chain +
//        useVehicleState destructure (data/isLoading/isFetching/isStale/isError/
//        dataUpdatedAt/refetch) -> ported verbatim.
//   L54  state = stateData?.state -> narrowed to the VehicleState object (the
//        native hook types `state` as VehicleState|string|null; truthiness +
//        property reads match the web `any` behaviour for the realistic object
//        payload).
//   L56-57 isCompact (1x1) / isLarge (>=2x2) -> ported verbatim.
//   L59  batteryLevel = state?.battery_level ?? 0 -> ported.
//   L60-61 chargeLimitSoc via (state as Record<string,unknown>)?.charge_limit_soc
//        -> ported verbatim (extended-payload field not on VehicleState).
//   L63  color useMemo (state ? getBatteryColor(batteryLevel) : '#374151') -> ported.
//   L65  gaugeSize = isCompact ? 70 : 100 -> ported.
//   L67-75 stats useMemo (Level%, optional Limit%) -> ported verbatim with the same
//        i18n keys and the chargeLimitSoc != null guard.
//   L77-87 WidgetShell props (conditional title/icon when !isCompact, loading,
//        updatedAt, isFetching, isStale, isError, onRefresh=refetch) -> ported.
//   L88-122 body: centred column; state ? (gauge-relative wrapper -> WidgetGaugeHero
//        with the same gauge config / stats (isLarge ? stats) / compact and the
//        ChargeLimitRing child when chargeLimitSoc != null, plus the is_charging
//        "⚡ Charging" line) : EmptyState('No battery data') -> ported. animate-pulse
//        has no native runtime so the charging line renders statically.
//   L123-125 closing tags -> ported.
//
// No DOM, no react-i18next, no lucide-react, no Recharts/SVG, no Leaflet, no
// framer-motion and no web UI components are imported.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {ActivityIndicator, Pressable, StyleSheet, View} from 'react-native';

import {RadialGauge} from '../../../components/charts';
import {
  useVehicles,
  useVehicleState,
  type VehicleState,
} from '../../../api/hooks/useVehicles';
import {getSemanticIconDefinition} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';

/* ------------------------------------------------------------------ */
/*  i18n fallback (inlined react-i18next port)                         */
/* ------------------------------------------------------------------ */

// The web widget read `t` from useTranslation('dashboard'). Native parity has no
// i18n runtime wired, so this returns the English fallback for every (key,
// fallback) pair, preserving every i18n key. The 2-arg `(k, f) => string`
// signature matches the source's local `t` type exactly.
const I18N_NAMESPACE = 'dashboard';

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

/* ------------------------------------------------------------------ */
/*  ./types + ./shared mirrors (no native port yet)                    */
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

// Mirrored from web ./shared WidgetGaugeHero.
interface GaugeHeroConfig {
  value: number;
  max: number;
  label: string;
  unit: string;
  color: string;
}

interface GaugeHeroStat {
  label: string;
  value: string | number;
  unit?: string;
}

/* ------------------------------------------------------------------ */
/*  lucide Battery -> repo SemanticIcon glyph                          */
/* ------------------------------------------------------------------ */

const BATTERY_GLYPH = getSemanticIconDefinition('battery').glyph;

/* ------------------------------------------------------------------ */
/*  Pure logic (ported verbatim)                                       */
/* ------------------------------------------------------------------ */

const STROKE_WIDTH = 8;

function getBatteryColor(level: number): string {
  if (level > 50) return '#10b981'; // green
  if (level > 20) return '#f59e0b'; // amber
  return '#ef4444'; // red
}

// Freshness caption helper for the inlined WidgetShell (the web <DataFreshness>
// renders a relative "updated" time when not compact).
function formatFreshness(updatedAt: number, t: NativeTFunction): string {
  const diff = Date.now() - updatedAt;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return t('widget.justNow', 'Just now');
  if (minutes < 60) return `${minutes}m ${t('widget.ago', 'ago')}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${t('widget.ago', 'ago')}`;
  const days = Math.floor(hours / 24);
  return `${days}d ${t('widget.ago', 'ago')}`;
}

/* ------------------------------------------------------------------ */
/*  Thin arc overlay showing the charge limit position on the gauge    */
/* ------------------------------------------------------------------ */

// web <ChargeLimitRing> draws a thin SVG arc (stroke rgba(255,255,255,0.25))
// from the top of the gauge sweeping clockwise by value/max. React Native has
// no SVG stroke-dash, so the arc is approximated with a faint full-ring border
// (same colour/intent) plus a brighter marker placed at the charge-limit angle
// — i.e. where the web arc ends — to convey the limit position on the gauge.
function ChargeLimitRing({
  value,
  max,
  gaugeSize,
}: {
  value: number;
  max: number;
  gaugeSize: number;
}) {
  const radius = (gaugeSize - STROKE_WIDTH) / 2;
  const center = gaugeSize / 2;
  const clamped = Math.max(0, Math.min(value, max));
  const fraction = max > 0 ? clamped / max : 0;
  const angleDeg = -90 + fraction * 360;
  const radians = (angleDeg * Math.PI) / 180;
  const markerSize = 6;
  const markerLeft = center + radius * Math.cos(radians) - markerSize / 2;
  const markerTop = center + radius * Math.sin(radians) - markerSize / 2;

  return (
    <View
      pointerEvents="none"
      style={[
        styles.limitRingOverlay,
        {height: gaugeSize, marginLeft: -gaugeSize / 2, width: gaugeSize},
      ]}>
      <View
        style={[
          styles.limitRingTrack,
          {borderRadius: gaugeSize / 2, height: gaugeSize, width: gaugeSize},
        ]}
      />
      <View
        style={[
          styles.limitMarker,
          {
            borderRadius: markerSize / 2,
            height: markerSize,
            left: markerLeft,
            top: markerTop,
            width: markerSize,
          },
        ]}
      />
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/feedback <EmptyState>                          */
/* ------------------------------------------------------------------ */

// web EmptyState(icon Battery, message, className="py-4"): a centred icon glyph
// above a muted message line.
function EmptyState({glyph, message}: {glyph: string; message: string}) {
  return (
    <View style={styles.emptyState}>
      <AppText style={styles.emptyGlyph} tone="muted" weight="bold">
        {glyph}
      </AppText>
      <AppText style={styles.emptyMessage} tone="muted" variant="caption">
        {message}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined ./shared <WidgetGaugeHero>                                 */
/* ------------------------------------------------------------------ */

// web WidgetGaugeHero: a RadialGauge (size 70 compact / 100 standard) with an
// optional stats row and overlay children, both gated behind `!compact`. The
// gauge is the repo native parity <RadialGauge>; the overlay children (the
// ChargeLimitRing) are positioned over the gauge instead of after the stats.
function WidgetGaugeHero({
  gauge,
  stats,
  compact,
  children,
}: {
  gauge: GaugeHeroConfig;
  stats?: GaugeHeroStat[];
  compact?: boolean;
  children?: ReactNode;
}) {
  const size = compact ? 70 : 100;

  return (
    <View style={styles.gaugeHero}>
      <View style={styles.gaugeWrap}>
        <RadialGauge
          color={gauge.color}
          label={gauge.label}
          max={gauge.max}
          size={size}
          unit={gauge.unit}
          value={gauge.value}
        />
        {!compact && children}
      </View>

      {!compact && stats && stats.length > 0 ? (
        <View style={styles.statsRow}>
          {stats.map(stat => (
            <View key={stat.label} style={styles.statItem}>
              <AppText
                numberOfLines={1}
                style={styles.statLabel}
                tone="secondary"
                variant="caption">
                {stat.label}
              </AppText>
              <AppText
                numberOfLines={1}
                style={styles.statValue}
                weight="semibold">
                {stat.value}
                {stat.unit ? (
                  <AppText
                    style={styles.statUnit}
                    tone="secondary"
                    variant="caption">
                    {stat.unit}
                  </AppText>
                ) : null}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}
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
          {formatFreshness(updatedAt, t)}
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
            <AppText style={styles.shellTitle} variant="caption" weight="semibold">
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

export default function BatteryRadialGaugeWidget({vehicleId, size}: WidgetProps) {
  const t = useNativeTranslationFallback();
  const {data: vehicles} = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const {
    data: stateData,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useVehicleState(id);
  const rawState = stateData?.state;
  const state: VehicleState | undefined =
    rawState && typeof rawState === 'object' ? rawState : undefined;

  const isCompact = size.cols === 1 && size.rows === 1;
  const isLarge = size.cols >= 2 && size.rows >= 2;

  const batteryLevel = state?.battery_level ?? 0;
  // charge_limit_soc may be present on extended state payloads
  const chargeLimitSoc = (state as Record<string, unknown> | undefined)
    ?.charge_limit_soc as number | undefined;

  const color = useMemo(
    () => (state ? getBatteryColor(batteryLevel) : '#374151'),
    [state, batteryLevel],
  );

  const gaugeSize = isCompact ? 70 : 100;

  const stats = useMemo<GaugeHeroStat[]>(() => {
    const s: GaugeHeroStat[] = [
      {label: t('widget.level', 'Level'), value: batteryLevel, unit: '%'},
    ];
    if (chargeLimitSoc != null) {
      s.push({
        label: t('widget.chargeLimit', 'Limit'),
        value: chargeLimitSoc,
        unit: '%',
      });
    }
    return s;
  }, [t, batteryLevel, chargeLimitSoc]);

  return (
    <WidgetShell
      icon={
        isCompact ? undefined : (
          <AppText style={styles.headerIcon} tone="muted" weight="bold">
            {BATTERY_GLYPH}
          </AppText>
        )
      }
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={isLoading}
      onRefresh={() => refetch()}
      title={isCompact ? undefined : t('widget.batteryRadial', 'Battery')}
      updatedAt={dataUpdatedAt}>
      <View style={styles.body}>
        {state ? (
          <>
            <View style={styles.gaugeRelative}>
              <WidgetGaugeHero
                compact={isCompact}
                gauge={{
                  value: batteryLevel,
                  max: 100,
                  label: isCompact ? '' : t('widget.battery', 'Battery'),
                  unit: '%',
                  color,
                }}
                stats={isLarge ? stats : undefined}>
                {chargeLimitSoc != null ? (
                  <ChargeLimitRing
                    gaugeSize={gaugeSize}
                    max={100}
                    value={chargeLimitSoc}
                  />
                ) : null}
              </WidgetGaugeHero>
            </View>

            {state.is_charging ? (
              <AppText style={styles.chargingText}>
                ⚡ {t('widget.charging', 'Charging')}
              </AppText>
            ) : null}
          </>
        ) : (
          <EmptyState
            glyph={BATTERY_GLYPH}
            message={t('widget.noBattery', 'No battery data')}
          />
        )}
      </View>
    </WidgetShell>
  );
}

BatteryRadialGaugeWidget.displayName = 'BatteryRadialGaugeWidget';

// Surfaced so the i18n namespace the web widget used is retained and inspectable.
export const BATTERY_RADIAL_GAUGE_WIDGET_I18N_NAMESPACE = I18N_NAMESPACE;

const styles = StyleSheet.create({
  // --- Body ---
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  gaugeRelative: {
    alignItems: 'center',
  },
  chargingText: {
    fontSize: 10,
    lineHeight: 14,
    marginTop: spacing.xs,
    color: colors.success,
  },
  headerIcon: {
    fontSize: 12,
    lineHeight: 14,
    letterSpacing: 0.4,
  },

  // --- WidgetGaugeHero ---
  gaugeHero: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  gaugeWrap: {
    alignItems: 'center',
  },
  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: spacing.lg,
    rowGap: spacing.xs,
  },
  statItem: {
    flexShrink: 1,
    alignItems: 'center',
  },
  statLabel: {
    textAlign: 'center',
  },
  statValue: {
    fontSize: 14,
    lineHeight: 18,
    textAlign: 'center',
    color: colors.textPrimary,
  },
  statUnit: {
    marginLeft: 2,
    fontWeight: '400',
  },

  // --- ChargeLimitRing ---
  limitRingOverlay: {
    position: 'absolute',
    top: 0,
    left: '50%',
  },
  limitRingTrack: {
    position: 'absolute',
    top: 0,
    left: 0,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  limitMarker: {
    position: 'absolute',
    backgroundColor: 'rgba(255,255,255,0.85)',
  },

  // --- EmptyState ---
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    gap: spacing.xs,
  },
  emptyGlyph: {
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: 0.5,
  },
  emptyMessage: {
    textAlign: 'center',
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
