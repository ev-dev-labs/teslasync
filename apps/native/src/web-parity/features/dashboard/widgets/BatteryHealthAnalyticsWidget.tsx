// Native parity port of
// web/src/features/dashboard/widgets/BatteryHealthAnalyticsWidget.tsx.
//
// A dashboard widget that summarises a vehicle's battery-health analytics as a
// score gauge. In the wide (>1 col) layout it shows a RadialGauge hero (state of
// health) plus a 6-stat grid (cycles / charge depth / discharge / DC-fast ratio
// / temp score / charge-habits score); in the compact (1 col) layout it
// collapses to just the centred gauge. When the API returns no data both layouts
// fall back to an EmptyState inside the shell (the section is never hidden). The
// shell renders the title + heart icon (wide) and a query-freshness chip wired
// to refetch, and surfaces the query loading/error states.
//
// The web original leans on browser-only / not-yet-ported infrastructure, so —
// following the established conversion idiom (GlancePage / AutomationHistoryWidget)
// — every such dependency is reproduced inline with React Native primitives +
// the shared native building blocks and documented in the sidecar:
//
//   - WidgetShell (web .../WidgetShell.tsx) has no native port yet, so its
//     structure is inlined as `WidgetShell` here: loading -> a skeleton block;
//     error -> a centred error box with a retry Pressable (mirrors the web
//     <QueryError>); otherwise either a titled header (icon + uppercase muted
//     title + freshness chip) over the children, or — when title-less (the
//     compact branch) — the children with the freshness chip overlaid top-right,
//     exactly like the web shell. Only the props this widget passes (title, icon,
//     loading, error, updatedAt, isFetching, isStale, isError, onRefresh) are
//     honoured; help/widgetId/PinButton/HelpTooltip extras are out of scope.
//   - DataFreshness (web data-display) — the 4-state (fresh/fetching/stale/error)
//     chip the shell renders — is reproduced inline as `WidgetFreshness`: same
//     isError>fetching>stale>fresh precedence, the same dot colour tiers, the
//     "just now / Nm/Nh/Nd/Nw ago" relative ladder, "updating…"/"error" labels,
//     a 30s re-render tick, and onRefresh wired to a Pressable (role=button).
//   - WidgetGaugeHero + GaugeHeroStat (web .../shared) -> inline `WidgetGaugeHero`
//     + local `GaugeHeroConfig`/`GaugeHeroStat`: same compact/standard gauge size
//     (70/100), the same `RadialGauge` (the native charts port) for the ring, and
//     the same flex-wrap stat grid (label + value + optional unit) shown only in
//     the standard, stats-bearing layout. The web component's unused `children`
//     slot is omitted (this widget never passes it).
//   - WidgetProps (web .../types.ts) -> local `WidgetProps`/`WidgetSize` (only
//     `vehicleId` + `size.cols` are read here).
//   - feedback EmptyState -> shared native EmptyState (web's single `message`
//     becomes the native `title`; the web HeartPulse `icon` + `className` have no
//     native EmptyState slot and are dropped — the heart signal is preserved by
//     the shell header glyph).
//   - @/hooks/useUnits + @/lib/unitConversion convertTempFromSI -> inline
//     `useUnits` (derives `unitPrefs.temperature` from the native useSettings,
//     exactly as web useUnits' deriveTemperature does) + verbatim
//     `convertTempFromSI`. This widget only reads `unitPrefs.temperature` /
//     `toTemperatureDisplay` (both live solely in the `stats` useMemo dependency
//     list in the web source), so the mirror exposes just that pref; the math is
//     preserved verbatim for faithful structure even though no rendered stat
//     converts a temperature.
//   - @/lib/numberFormat fmtNumber/fmtInt are inlined verbatim (safeNumber
//     guard, default precision 2, en-US grouping) without useSettings-driven
//     global precision/locale wiring.
//   - lucide-react HeartPulse has no native icon font; the wide-header icon
//     becomes a small emerald "\u2665" glyph (the meaningful battery-health
//     signal), and the EmptyState heart icon is dropped as noted above.
//   - react-i18next useTranslation('dashboard') -> a native English-default `t`
//     that keeps every widget.batteryHealthAnalytics.* / freshness.* key + the
//     {{var}} interpolation intact.
//
// The data hooks are called unchanged: useBatteryHealthAnalytics(vehicleIdStr)
// and useVehicles() via the native web-parity hooks, so the API paths
// (/analytics/battery-health?vehicle_id=…, /vehicles), the snake_case fields
// (current_soh, total_cycles, full_charge_pct, avg_depth_of_discharge,
// fast_charge_pct, temp_exposure_score, charge_habits_score), and refetch
// semantics are preserved. State names (data, isLoading, error, isFetching,
// isStale, isError, dataUpdatedAt, refetch, unitPrefs, toTemperatureDisplay,
// tempUnit, vid, vehicleIdStr, isCompact, hasData, healthScore, color,
// gaugeConfig, stats, shellProps) are preserved. No DOM, react-router,
// framer-motion, lucide-react, Recharts, Leaflet, or old web UI components are
// imported.

import React, {useEffect, useMemo, useState} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {RadialGauge} from '../../../components/charts/RadialGauge';
import {useBatteryHealthAnalytics} from '../../../api/hooks/useEnergy';
import {useSettings} from '../../../api/hooks/useSettings';
import {useVehicles} from '../../../api/hooks/useVehicles';

/* ─── i18n fallback (mirrors i18next default-value + {{var}} interpolation) ─── */

type TVars = Record<string, string | number>;

// react-i18next is not wired in native; i18next returns the supplied English
// default when a translation is missing, so this fallback returns that default
// while keeping every widget.*/freshness.* key verbatim and applying the same
// {{var}} interpolation as the web `t` (useTranslation('dashboard')).
function t(key: string, fallback: string, vars?: TVars): string {
  let out = fallback ?? key;
  if (vars) {
    for (const varKey of Object.keys(vars)) {
      out = out.split(`{{${varKey}}}`).join(String(vars[varKey]));
    }
  }
  return out;
}

/* ─── Inlined formatters (web @/lib/numberFormat) ─────────────────────────── */

// Mirrors web lib/numberFormat.safeNumber: nullish / non-finite -> 0.
function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// web fmtNumber — locale-grouped, fixed precision. The web global precision
// defaults to 2 (set by useSettings, which this widget does not wire), so 2 is
// the faithful unconfigured default.
function fmtNumber(v: unknown, decimals = 2): string {
  return safeNumber(v).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// web fmtInt — integer with locale separators.
function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

/* ─── Inlined unit handling (mirror web useUnits + lib/unitConversion) ─────── */

type TemperatureUnitPref = '°C' | '°F';

interface UnitPrefs {
  temperature: TemperatureUnitPref;
}

// Pure SI -> display converter, verbatim from web lib/unitConversion.
function convertTempFromSI(celsius: number, to: TemperatureUnitPref): number {
  switch (to) {
    case '°C':
      return celsius;
    case '°F':
      return (celsius * 9) / 5 + 32;
  }
}

// Mirrors web useUnits: derive the temperature preference from useSettings
// exactly as web's deriveTemperature does (unit_of_temp === 'F' -> °F else °C).
// This widget only reads `unitPrefs.temperature`, so the mirror exposes just it.
function useUnits(): {unitPrefs: UnitPrefs} {
  const {data: settings} = useSettings();
  const temperature: TemperatureUnitPref =
    settings?.unit_of_temp === 'F' ? '°F' : '°C';
  return useMemo(() => ({unitPrefs: {temperature}}), [temperature]);
}

/* ─── Widget contract types (web .../types.ts subset) ─────────────────────── */

interface WidgetSize {
  cols: number;
  rows: number;
}

export interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: Record<string, unknown>;
}

/* ─── Gauge hero types (web .../shared WidgetGaugeHero) ───────────────────── */

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

/* ─── scoreColor (web .../BatteryHealthAnalyticsWidget) ───────────────────── */

function scoreColor(score: number): string {
  if (score >= 80) {
    return '#10b981';
  }
  if (score >= 50) {
    return '#f59e0b';
  }
  return '#ef4444';
}

/* ─── WidgetGaugeHero (web .../shared WidgetGaugeHero) ────────────────────── */

function WidgetGaugeHero({
  gauge,
  stats,
  compact,
}: {
  gauge: GaugeHeroConfig;
  stats?: GaugeHeroStat[];
  compact?: boolean;
}) {
  // Compact size never grows; the standard size renders the larger ring.
  const size = compact ? 70 : 100;

  return (
    <View style={styles.gaugeHero} testID="battery-health-analytics-gauge">
      <RadialGauge
        value={gauge.value}
        max={gauge.max}
        label={gauge.label}
        unit={gauge.unit}
        color={gauge.color}
        size={size}
      />

      {!compact && stats && stats.length > 0 ? (
        <View style={styles.statsWrap}>
          {stats.map(stat => (
            <View key={stat.label} style={styles.statItem}>
              <AppText
                variant="caption"
                tone="secondary"
                numberOfLines={1}
                style={styles.statLabel}>
                {stat.label}
              </AppText>
              <AppText weight="semibold" numberOfLines={1} style={styles.statValue}>
                {stat.value}
                {stat.unit ? (
                  <AppText
                    variant="caption"
                    tone="secondary"
                    style={styles.statUnit}>
                    {' '}
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
          : t('a11y.dataFreshness', 'Data freshness: {{state}}', {state: status})
      }
      accessibilityState={{disabled: !refreshable}}
      disabled={!refreshable}
      onPress={() => {
        if (refreshable) {
          onRefresh?.();
        }
      }}
      testID="battery-health-analytics-freshness"
      style={styles.freshness}>
      <View
        style={[styles.freshnessDot, {backgroundColor: FRESHNESS_DOT[status]}]}
        testID="battery-health-analytics-freshness-dot"
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

/* ─── WidgetShell (web .../WidgetShell.tsx subset) ────────────────────────── */

function WidgetShell({
  title,
  icon,
  loading,
  error,
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
  children,
}: {
  title?: string;
  icon?: React.ReactNode;
  loading?: boolean;
  error?: string | null;
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
  children: React.ReactNode;
}) {
  if (loading) {
    return (
      <View style={styles.skeleton} testID="battery-health-analytics-loading" />
    );
  }

  if (error) {
    return (
      <View style={styles.errorBox} testID="battery-health-analytics-error">
        <AppText tone="danger" weight="semibold" numberOfLines={3}>
          {error}
        </AppText>
        {onRefresh ? (
          <Pressable
            accessibilityRole="button"
            onPress={onRefresh}
            testID="battery-health-analytics-error-retry">
            <AppText variant="caption" tone="accent">
              {t('common.retry', 'Retry')}
            </AppText>
          </Pressable>
        ) : null}
      </View>
    );
  }

  const freshness = (
    <WidgetFreshness
      updatedAt={updatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={onRefresh}
    />
  );

  // Title-less widgets (the compact branch) overlay the freshness chip in the
  // top-right corner, exactly like the web shell.
  if (!title) {
    return (
      <View style={styles.shell} testID="battery-health-analytics-widget">
        <View style={styles.freshnessOverlay}>{freshness}</View>
        <View style={styles.shellBody}>{children}</View>
      </View>
    );
  }

  return (
    <View style={styles.shell} testID="battery-health-analytics-widget">
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
        {freshness}
      </View>
      <View style={styles.shellBody}>{children}</View>
    </View>
  );
}

/* ─── HeartGlyph (web header lucide HeartPulse, text-emerald-400) ──────────── */

function HeartGlyph({style}: {style?: StyleProp<ViewStyle>}) {
  return (
    <View style={[styles.heartGlyph, style]} accessibilityElementsHidden>
      <AppText variant="caption" weight="bold" style={styles.heartGlyphText}>
        {'\u2665'}
      </AppText>
    </View>
  );
}

/* ─── BatteryHealthAnalyticsWidget ────────────────────────────────────────── */

export default function BatteryHealthAnalyticsWidget({
  vehicleId,
  size,
}: WidgetProps) {
  const {unitPrefs} = useUnits();
  const toTemperatureDisplay = (value: number) =>
    convertTempFromSI(value, unitPrefs.temperature);

  const tempUnit = unitPrefs.temperature;
  const {data: vehicles} = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const vehicleIdStr = vid != null ? String(vid) : null;

  const {
    data,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useBatteryHealthAnalytics(vehicleIdStr);

  const isCompact = size.cols <= 1;
  const hasData = !!data;

  const healthScore = data?.current_soh ?? 0;
  const color = useMemo(() => scoreColor(healthScore), [healthScore]);

  const gaugeConfig = useMemo(
    () => ({
      value: healthScore,
      max: 100,
      label: `${fmtInt(healthScore)}`,
      unit: t('widget.batteryHealthAnalytics.score', 'health'),
      color,
    }),
    [healthScore, color],
  );

  const stats: GaugeHeroStat[] = useMemo(
    () => [
      {
        label: t('widget.batteryHealthAnalytics.totalCycles', 'Cycles'),
        value: fmtInt(data?.total_cycles ?? 0),
      },
      {
        label: t('widget.batteryHealthAnalytics.avgChargeDepth', 'Charge Depth'),
        value: fmtNumber(data?.full_charge_pct ?? 0, 0),
        unit: '%',
      },
      {
        label: t('widget.batteryHealthAnalytics.avgDischargeDepth', 'Discharge'),
        value: fmtNumber(data?.avg_depth_of_discharge ?? 0, 0),
        unit: '%',
      },
      {
        label: t('widget.batteryHealthAnalytics.dcFastRatio', 'DC Fast'),
        value: fmtNumber(data?.fast_charge_pct ?? 0, 0),
        unit: '%',
      },
      {
        label: t('widget.batteryHealthAnalytics.tempExposure', 'Temp Score'),
        value: fmtInt(data?.temp_exposure_score ?? 0),
        unit: '/ 100',
      },
      {
        label: t('widget.batteryHealthAnalytics.chargeHabits', 'Habits'),
        value: fmtInt(data?.charge_habits_score ?? 0),
        unit: '/ 100',
      },
    ],
    // Web parity: toTemperatureDisplay + tempUnit are listed in the source's
    // dependency array though no rendered stat converts a temperature; kept
    // verbatim for faithful structure (mirrors the web useMemo deps).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, toTemperatureDisplay, tempUnit],
  );

  const shellProps = {
    loading: isLoading,
    error: error ? String(error) : null,
    updatedAt: dataUpdatedAt ?? 0,
    isFetching,
    isStale,
    isError,
    onRefresh: () => refetch(),
  };

  if (isCompact) {
    return (
      <WidgetShell
        {...shellProps}
        updatedAt={dataUpdatedAt}
        isFetching={isFetching}
        isStale={isStale}
        isError={isError}
        onRefresh={() => refetch()}>
        <View style={styles.compactInner}>
          {hasData ? (
            <WidgetGaugeHero gauge={gaugeConfig} compact />
          ) : (
            <View testID="battery-health-analytics-empty">
              <EmptyState
                title={t(
                  'widget.batteryHealthAnalytics.noData',
                  'No battery health data',
                )}
                message=""
              />
            </View>
          )}
        </View>
      </WidgetShell>
    );
  }

  return (
    <WidgetShell
      title={t('widget.batteryHealthAnalytics.title', 'Battery Analytics')}
      icon={<HeartGlyph />}
      {...shellProps}>
      {hasData ? (
        <WidgetGaugeHero gauge={gaugeConfig} stats={stats} />
      ) : (
        <View testID="battery-health-analytics-empty">
          <EmptyState
            title={t(
              'widget.batteryHealthAnalytics.noData',
              'No battery health data',
            )}
            message=""
          />
        </View>
      )}
    </WidgetShell>
  );
}

BatteryHealthAnalyticsWidget.displayName = 'BatteryHealthAnalyticsWidget';

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    position: 'relative',
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
  shellBody: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  freshnessOverlay: {
    position: 'absolute',
    top: 6,
    right: 6,
    zIndex: 5,
  },
  skeleton: {
    flex: 1,
    minHeight: 96,
    borderRadius: 12,
    backgroundColor: colors.surfaceRaised,
  },
  errorBox: {
    flex: 1,
    minHeight: 96,
    alignItems: 'center',
    justifyContent: 'center',
    rowGap: spacing.sm,
    padding: spacing.md,
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
  heartGlyph: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  heartGlyphText: {
    color: colors.success,
  },
  compactInner: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gaugeHero: {
    alignItems: 'center',
    justifyContent: 'center',
    rowGap: spacing.sm,
  },
  statsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    columnGap: spacing.md,
    rowGap: spacing.xs,
  },
  statItem: {
    minWidth: 0,
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 12,
    lineHeight: 16,
  },
  statValue: {
    fontSize: 14,
    lineHeight: 18,
    color: colors.textPrimary,
  },
  statUnit: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '400',
  },
});
