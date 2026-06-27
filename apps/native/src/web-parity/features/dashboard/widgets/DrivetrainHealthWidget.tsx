// Native parity port of
// web/src/features/dashboard/widgets/DrivetrainHealthWidget.tsx.
//
// The web widget is a dashboard "Drivetrain Health" tile. It resolves a vehicle
// (the explicit vehicleId prop, else the first vehicle from useVehicles()),
// fetches useDrivetrainHealth(vehicleIdStr) (/drivetrain/health) + the latest
// motor snapshot useMotorLatest(vid ?? 0) (/motor/latest), derives a 0-100
// health score from health.overallHealth (good=95 / warning=60 / critical=25 /
// else 0), a traffic-light colour (>=80 emerald / >=50 amber / else red), and
// renders — inside a <WidgetShell> — a <WidgetGaugeHero> radial gauge plus four
// stats (Motor Temp / Stator Temp / Inverter / Drive State). The first three
// temperatures fall back across the health + motor sources and are displayed in
// the user's temperature unit via convertTempFromSI; Drive State is the raw
// motor.state_front / health.motorStatus string. A 1×1 (isCompact, size.cols<=1)
// tile renders the gauge alone (compact, no stats, no title) and pipes only the
// health query's freshness into the shell header; the wider tile adds the title
// + Cog icon and the combined health||motor freshness. When neither source has
// data (hasData false) a Cog EmptyState ("No drivetrain data") is shown.
//
// This native port preserves that contract 1:1 — the same useVehicles() +
// useDrivetrainHealth(vehicleIdStr) (/drivetrain/health) + useMotorLatest(vid ??
// 0) (/motor/latest) calls and destructures, the same vid/vehicleIdStr/isLoading/
// isCompact/hasData/score/color/gaugeConfig/motorTemp/statorTemp/inverterTemp/
// driveState/stats/updatedAt/shellProps derivations (incl. every null-coalescing
// fallback, the healthScore/healthColor thresholds, and the Math.max combined
// updatedAt), the same i18n keys + English defaults, and the same compact /
// full / empty branches — using React Native primitives, the existing native
// AppText + design tokens, and the already-ported native RadialGauge parity
// component.
//
// Browser-only / not-yet-ported web dependencies are reduced explicitly and
// documented in the .parity.json sidecar:
//   - react-i18next useTranslation('dashboard') (web L2): no native i18next
//     runtime -> inline useNativeTranslation() returns t(key, fallback?) =
//     (fallback ?? key), preserving every key + English default. None of this
//     widget's t() calls interpolate.
//   - lucide-react Cog (web L3): DOM SVG icon -> emoji/glyph stand-in (⚙),
//     tinted emerald for the title icon and muted for the EmptyState icon.
//   - @/components/feedback EmptyState (web L4): reproduced as a native-safe
//     <EmptyState> (centered icon glyph + muted message); the web py-2 (compact)
//     vs py-4 (full) spacing is preserved via a `dense` prop (8 vs 16 px).
//   - @/api/hooks/useDriving useDrivetrainHealth (web L5): the already-ported
//     web-parity hook (same signature + /drivetrain/health path + DrivetrainHealthData).
//   - @/api/hooks/useVehicles useMotorLatest + useVehicles (web L6/L7): the
//     already-ported web-parity hooks (same /motor/latest + /vehicles paths).
//   - @/hooks/useUnits useUnits (web L8): not yet ported -> reproduced as a
//     scoped native useUnits() returning unitPrefs.temperature derived from the
//     same web-parity useSettings().unit_of_temp ('F' -> '°F', else '°C').
//   - @/lib/numberFormat fmtNumber + fmtInt (web L9): inline native fmtNumber
//     (locale fixed-fraction-digits) + fmtInt = fmtNumber(v, 0) — the established
//     native numberFormat port.
//   - ./WidgetShell (web L10): reproduced as a native-safe <WidgetShell> — the
//     loading skeleton, error body, the pulse-on-update effect, and the inline
//     DataFreshness chip (its web Skeleton / QueryError / DataFreshness internals
//     reduced to native equivalents; dot-only `compact` when title-less).
//   - ./shared WidgetGaugeHero + GaugeHeroStat (web L11): reproduced as a
//     native-safe <WidgetGaugeHero> wrapping the already-ported native
//     RadialGauge; the compact size (70 vs 100), the hidden-when-compact stat
//     row, and the optional children slot are preserved.
//   - ./types WidgetProps (web L12): the dashboard widget types module is not yet
//     ported, so the consumed subset (WidgetSize { cols, rows } + WidgetProps) is
//     mirrored as local interfaces.
//   - @/lib/unitConversion convertTempFromSI (web L13): inline native port —
//     '°F' -> (c*9/5)+32, else celsius.
//
// Behaviour-neutral, lint-driven adaptations (native react-hooks/exhaustive-deps
// + react/jsx-sort-props are ERROR-level, where the web config has them as
// warnings):
//   - toTemperatureDisplay (web L31, a per-render arrow) is wrapped in
//     useCallback([unitPrefs.temperature]) so its identity is stable inside the
//     stats useMemo deps — identical body + behaviour.
//   - the stats useMemo deps drop the web's `health` / `motor` entries: the memo
//     body never reads them directly (only the already-derived motorTemp /
//     statorTemp / inverterTemp / driveState primitives, which change whenever
//     health/motor change), so they are unnecessary deps that the error-level
//     rule rejects — the computed output is identical.
//   - all JSX props are alphabetically ordered.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {RadialGauge} from '../../../components/charts/RadialGauge';
import {useDrivetrainHealth} from '../../../api/hooks/useDriving';
import {useMotorLatest, useVehicles} from '../../../api/hooks/useVehicles';
import {useSettings} from '../../../api/hooks/useSettings';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';

/* ------------------------------------------------------------------ */
/*  lucide-react glyph stand-in (web L3)                              */
/* ------------------------------------------------------------------ */

const ICON_COG = '\u2699'; // ⚙ (Cog)

const PULSE_GLOW = '#22c55e';
const EM_DASH = '\u2014'; // —

/* ------------------------------------------------------------------ */
/*  native-safe i18n (react-i18next has no native runtime, web L2)     */
/* ------------------------------------------------------------------ */

type NativeTFunction = (key: string, fallback?: string) => string;

function useNativeTranslation(): NativeTFunction {
  return useMemo<NativeTFunction>(() => (key, fallback) => fallback ?? key, []);
}

/* ------------------------------------------------------------------ */
/*  ported: ./types WidgetProps (consumed subset of the web types)     */
/* ------------------------------------------------------------------ */

export interface WidgetSize {
  cols: number; // 1-4
  rows: number; // 1-8
}

export interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/*  native-safe formatters (web @/lib/numberFormat fmtNumber/fmtInt)   */
/* ------------------------------------------------------------------ */

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Port of web fmtNumber — locale number with fixed fraction digits. */
function fmtNumber(v: unknown, decimals?: number, locale = 'en-US'): string {
  const d = decimals ?? 2;
  try {
    return safeNumber(v).toLocaleString(locale, {
      maximumFractionDigits: d,
      minimumFractionDigits: d,
    });
  } catch {
    return safeNumber(v).toLocaleString('en-US', {
      maximumFractionDigits: d,
      minimumFractionDigits: d,
    });
  }
}

/** Port of web fmtInt — integer with locale separators (fmtNumber(v, 0)). */
function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

/* ------------------------------------------------------------------ */
/*  native-safe unit conversion (web @/lib/unitConversion)             */
/* ------------------------------------------------------------------ */

type TemperatureUnitPref = '\u00B0C' | '\u00B0F';

/** convertTempFromSI — SI °C -> display unit (web L161-171). */
function convertTempFromSI(celsius: number, to: TemperatureUnitPref): number {
  return to === '\u00B0F' ? (celsius * 9) / 5 + 32 : celsius;
}

/* ------------------------------------------------------------------ */
/*  scoped native useUnits (web @/hooks/useUnits, consumed subset)     */
/* ------------------------------------------------------------------ */

interface UseUnitsResult {
  unitPrefs: {temperature: TemperatureUnitPref};
}

function useUnits(): UseUnitsResult {
  const {data: settings} = useSettings();
  const unitOfTemp = settings?.unit_of_temp;
  return useMemo<UseUnitsResult>(
    () => ({
      unitPrefs: {temperature: unitOfTemp === 'F' ? '\u00B0F' : '\u00B0C'},
    }),
    [unitOfTemp],
  );
}

/* ------------------------------------------------------------------ */
/*  native DataFreshness (web @/components/data-display, WidgetShell)   */
/* ------------------------------------------------------------------ */

type FreshnessStatus = 'fresh' | 'fetching' | 'stale' | 'error';

const FRESHNESS_COLOR: Record<FreshnessStatus, string> = {
  fresh: colors.success,
  fetching: colors.accent,
  stale: colors.warning,
  error: colors.danger,
};

const FRESHNESS_GLYPH: Record<FreshnessStatus, string> = {
  fresh: '\u25CF', // ● Wifi
  fetching: '\u21BB', // ↻ RefreshCw
  stale: '\u25CF', // ● Wifi
  error: '\u2715', // ✕ WifiOff
};

function relativeFreshness(ms: number, t: NativeTFunction): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) {
    return t('freshness.justNow', 'just now');
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ago`;
  }
  if (seconds < 86_400) {
    return `${Math.floor(seconds / 3600)}h ago`;
  }
  if (seconds < 604_800) {
    return `${Math.floor(seconds / 86_400)}d ago`;
  }
  return `${Math.floor(seconds / 604_800)}w ago`;
}

interface DataFreshnessProps {
  updatedAt: number | null;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  onRefresh?: () => void;
  compact?: boolean;
}

function DataFreshness({
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
  compact,
}: DataFreshnessProps) {
  const t = useNativeTranslation();
  const status: FreshnessStatus = isError
    ? 'error'
    : isFetching
      ? 'fetching'
      : isStale
        ? 'stale'
        : 'fresh';
  const color = FRESHNESS_COLOR[status];
  const relativeTime =
    updatedAt && !isFetching
      ? relativeFreshness(updatedAt, t)
      : isFetching
        ? t('freshness.updating', 'updating…')
        : isError
          ? t('freshness.error', 'error')
          : '';

  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={6}
      onPress={() => {
        if (!isFetching) {
          onRefresh?.();
        }
      }}
      style={styles.freshness}
      testID="data-freshness">
      <AppText
        importantForAccessibility="no-hide-descendants"
        style={[styles.freshnessGlyph, {color}]}>
        {FRESHNESS_GLYPH[status]}
      </AppText>
      {!compact && relativeTime ? (
        <AppText style={[styles.freshnessText, {color}]}>{relativeTime}</AppText>
      ) : null}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/*  native WidgetShell (web ./WidgetShell)                             */
/* ------------------------------------------------------------------ */

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
  // Pulse on data change (web L59-80).
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
    return <View style={styles.skeleton} testID="widget-skeleton" />;
  }
  if (error) {
    return (
      <View style={styles.errorWrap}>
        <AppText style={styles.errorText} tone="danger">
          {error}
        </AppText>
      </View>
    );
  }

  const showFreshness = updatedAt !== undefined;
  // Compact (dot-only) when widget has no title (web L91).
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
    <View style={[styles.shell, justUpdated ? styles.shellPulse : null]}>
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
      <View style={[styles.body, !title ? styles.bodyTopPad : null]}>
        {children}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native WidgetGaugeHero (web ./shared/WidgetGaugeHero)              */
/* ------------------------------------------------------------------ */

export interface GaugeHeroConfig {
  value: number;
  max: number;
  label: string;
  unit: string;
  color: string;
}

export interface GaugeHeroStat {
  label: string;
  value: string | number;
  unit?: string;
}

interface WidgetGaugeHeroProps {
  gauge: GaugeHeroConfig;
  stats?: GaugeHeroStat[];
  compact?: boolean;
  children?: ReactNode;
}

function WidgetGaugeHero({
  gauge,
  stats,
  compact,
  children,
}: WidgetGaugeHeroProps) {
  // Compact size never grows; standard renders at 100 (web L28).
  const size = compact ? 70 : 100;

  return (
    <View style={styles.gaugeHero}>
      <RadialGauge
        color={gauge.color}
        label={gauge.label}
        max={gauge.max}
        size={size}
        unit={gauge.unit}
        value={gauge.value}
      />

      {!compact && stats && stats.length > 0 ? (
        <View style={styles.gaugeStatsRow}>
          {stats.map(stat => (
            <View key={stat.label} style={styles.gaugeStat}>
              <AppText
                numberOfLines={1}
                style={styles.gaugeStatLabel}
                tone="secondary"
                variant="caption">
                {stat.label}
              </AppText>
              <AppText
                numberOfLines={1}
                style={styles.gaugeStatValue}
                weight="semibold">
                {stat.value}
                {stat.unit ? (
                  <AppText
                    style={styles.gaugeStatUnit}
                    tone="secondary"
                    variant="caption">
                    {` ${stat.unit}`}
                  </AppText>
                ) : null}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}

      {!compact ? children : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native EmptyState (web @/components/feedback EmptyState)            */
/* ------------------------------------------------------------------ */

interface EmptyStateProps {
  icon?: ReactNode;
  message: string;
  dense?: boolean;
}

function EmptyState({icon, message, dense}: EmptyStateProps) {
  return (
    <View style={[styles.emptyState, dense ? styles.emptyStateDense : null]}>
      {icon}
      <AppText style={styles.emptyStateMessage}>{message}</AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  health score helpers (web L15-26)                                  */
/* ------------------------------------------------------------------ */

function healthScore(overall: string | undefined): number {
  if (overall === 'good') return 95;
  if (overall === 'warning') return 60;
  if (overall === 'critical') return 25;
  return 0;
}

function healthColor(score: number): string {
  if (score >= 80) return '#10b981';
  if (score >= 50) return '#f59e0b';
  return '#ef4444';
}

/* ------------------------------------------------------------------ */
/*  DrivetrainHealthWidget (web L28-145)                               */
/* ------------------------------------------------------------------ */

export default function DrivetrainHealthWidget({
  vehicleId,
  size,
}: WidgetProps) {
  const t = useNativeTranslation();
  const {unitPrefs} = useUnits();
  // web L31 defines toTemperatureDisplay as a plain per-render arrow; native
  // react-hooks/exhaustive-deps (error-level) requires it be stable since it is
  // listed in the stats useMemo deps — wrapped in useCallback with identical
  // body + behaviour (the only deviation from the verbatim web expression).
  const toTemperatureDisplay = useCallback(
    (value: number) => convertTempFromSI(value, unitPrefs.temperature),
    [unitPrefs.temperature],
  );

  const tempUnit = unitPrefs.temperature;
  const {data: vehicles} = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const vehicleIdStr = vid != null ? String(vid) : undefined;

  const {
    data: health,
    isLoading: healthLoading,
    error: healthError,
    isFetching: healthFetching,
    isStale: healthStale,
    isError: healthIsError,
    dataUpdatedAt: healthUpdatedAt,
    refetch: healthRefetch,
  } = useDrivetrainHealth(vehicleIdStr);

  const {
    data: motor,
    isLoading: motorLoading,
    dataUpdatedAt: motorUpdatedAt,
    isFetching: motorFetching,
  } = useMotorLatest(vid ?? 0);

  const isLoading = healthLoading || motorLoading;
  const isCompact = size.cols <= 1;
  const hasData = !!health || !!motor;

  const score = useMemo(
    () => healthScore(health?.overallHealth),
    [health?.overallHealth],
  );
  const color = useMemo(() => healthColor(score), [score]);

  const gaugeConfig = useMemo<GaugeHeroConfig>(
    () => ({
      value: score,
      max: 100,
      label: `${fmtInt(score)}`,
      unit: t('widget.drivetrainHealth.score', 'health'),
      color,
    }),
    [score, color, t],
  );

  const motorTemp = health?.frontMotorTempC ?? motor?.motor_temp_c_front ?? null;
  const statorTemp = motor?.di_stator_temp ?? health?.rearMotorTempC ?? null;
  const inverterTemp = health?.inverterTempC ?? motor?.inverter_temp_c ?? null;
  const driveState = motor?.state_front ?? health?.motorStatus ?? EM_DASH;

  const stats = useMemo<GaugeHeroStat[]>(
    () => [
      {
        label: t('widget.drivetrainHealth.motorTemp', 'Motor Temp'),
        value:
          motorTemp != null
            ? fmtNumber(toTemperatureDisplay(motorTemp), 0)
            : EM_DASH,
        unit: tempUnit,
      },
      {
        label: t('widget.drivetrainHealth.statorTemp', 'Stator Temp'),
        value:
          statorTemp != null
            ? fmtNumber(toTemperatureDisplay(statorTemp), 0)
            : EM_DASH,
        unit: tempUnit,
      },
      {
        label: t('widget.drivetrainHealth.inverterHealth', 'Inverter'),
        value:
          inverterTemp != null
            ? fmtNumber(toTemperatureDisplay(inverterTemp), 0)
            : EM_DASH,
        unit: tempUnit,
      },
      {
        label: t('widget.drivetrainHealth.driveState', 'Drive State'),
        value: driveState ?? EM_DASH,
      },
    ],
    [t, motorTemp, statorTemp, inverterTemp, driveState, toTemperatureDisplay, tempUnit],
  );

  const updatedAt = Math.max(healthUpdatedAt ?? 0, motorUpdatedAt ?? 0);

  const shellProps = {
    loading: isLoading,
    error: healthError ? String(healthError) : null,
    updatedAt,
    isFetching: healthFetching || motorFetching,
    isStale: healthStale,
    isError: healthIsError,
    onRefresh: () => healthRefetch(),
  };

  if (isCompact) {
    return (
      <WidgetShell
        {...shellProps}
        isError={healthIsError}
        isFetching={healthFetching}
        isStale={healthStale}
        onRefresh={() => healthRefetch()}
        updatedAt={healthUpdatedAt}>
        <View style={styles.compactWrap}>
          {hasData ? (
            <WidgetGaugeHero compact gauge={gaugeConfig} />
          ) : (
            <EmptyState
              dense
              icon={<AppText style={styles.emptyGlyph}>{ICON_COG}</AppText>}
              message={t('widget.drivetrainHealth.noData', 'No drivetrain data')}
            />
          )}
        </View>
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      {...shellProps}
      icon={<AppText style={styles.titleGlyph}>{ICON_COG}</AppText>}
      title={t('widget.drivetrainHealth.title', 'Drivetrain Health')}>
      {hasData ? (
        <WidgetGaugeHero gauge={gaugeConfig} stats={stats} />
      ) : (
        <EmptyState
          icon={<AppText style={styles.emptyGlyph}>{ICON_COG}</AppText>}
          message={t('widget.drivetrainHealth.noData', 'No drivetrain data')}
        />
      )}
    </WidgetShell>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md + 4,
  },
  bodyTopPad: {
    paddingTop: spacing.md,
  },
  compactWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  emptyGlyph: {
    color: colors.textMuted,
    fontSize: 20,
    lineHeight: 24,
  },
  emptyState: {
    alignItems: 'center',
    gap: spacing.sm,
    justifyContent: 'center',
    paddingVertical: 16,
  },
  emptyStateDense: {
    paddingVertical: 8,
  },
  emptyStateMessage: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
  },
  errorText: {
    fontSize: 12,
  },
  errorWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 120,
    padding: spacing.md + 4,
  },
  freshness: {
    alignItems: 'center',
    columnGap: spacing.xs,
    flexDirection: 'row',
  },
  freshnessGlyph: {
    fontSize: 10,
    lineHeight: 14,
  },
  freshnessOverlay: {
    position: 'absolute',
    right: spacing.xs + 2,
    top: spacing.xs + 2,
    zIndex: 5,
  },
  freshnessText: {
    fontSize: 10,
    lineHeight: 14,
  },
  gaugeHero: {
    alignItems: 'center',
    gap: spacing.sm,
    justifyContent: 'center',
  },
  gaugeStat: {
    alignItems: 'center',
    minWidth: 0,
  },
  gaugeStatLabel: {
    textAlign: 'center',
  },
  gaugeStatUnit: {
    fontWeight: '400',
  },
  gaugeStatValue: {
    color: colors.textPrimary,
    textAlign: 'center',
  },
  gaugeStatsRow: {
    alignItems: 'center',
    columnGap: spacing.lg,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    rowGap: spacing.xs,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.md + 4,
    paddingTop: spacing.md,
  },
  headerTitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  headerTitleRow: {
    alignItems: 'center',
    columnGap: spacing.xs + 2,
    flexDirection: 'row',
  },
  shell: {
    position: 'relative',
  },
  shellPulse: {
    elevation: 4,
    shadowColor: PULSE_GLOW,
    shadowOffset: {width: 0, height: 0},
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 16,
    minHeight: 120,
  },
  titleGlyph: {
    color: colors.success,
    fontSize: 13,
    lineHeight: 16,
  },
});
