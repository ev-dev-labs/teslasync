// Native parity port of web/src/features/battery/pages/EnergyPage.tsx.
//
// The web page is the Battery > Energy Intelligence dashboard: a hero strip of
// four RadialGauges, a six-card quick-metric strip, a lifetime-metrics panel,
// two cost-vs-gas comparison cards, two daily chart panels (energy+cost
// composed chart and an efficiency/distance area chart), two breakdown chart
// panels (charging-by-time bars and a charger-type pie + legend), and a recent
// charging-sessions table. This port reproduces every section, the same data
// reads, the same SI->display unit handling, and the same i18n key/fallback
// intent using React Native primitives instead of DOM / Recharts /
// framer-motion / lucide / react-router.
//
// Behaviour preserved verbatim:
//   * Data hooks `useEnergyStats(vehicleId, 30)`, `useChargingSessionsPaginated`
//     and `useChargingTelemetryLatest`, and their API paths (via the ported
//     web-parity hooks).
//   * State names: `vehicleId`, `startDate`/`endDate`, `setRangeBatch`,
//     `energyCostHidden`, `stats`/`isLoading`/`statsError`/`refetch`,
//     `sessions`, `liveCharging`, and every derived metric
//     (`totalEnergy`, `totalCost`, `avgEfficiency`, `totalDistance`,
//     `co2Saved`, `periodDays`, `costPerKm`, `costPerKwh`, `gasEquivalent`,
//     `monthlyProjectedCost`, `yearlyProjectedCost`, `dailyEnergy`,
//     `hasNoEnergyData`, `timeOfDayData`, `chargerBreakdown`).
//   * The SI display converters `convertDistanceFromSI`/`convertEnergyFromSI`/
//     `convertPowerFromSI` and the `toDistanceDisplay`/`toEnergyDisplay`/
//     `toEfficiencyDisplay` helpers (backend is SI: meters, watt-hours, watts).
//   * Every conditional render and empty-state branch.
//
// Platform dependency swaps (no DOM, lucide, Recharts, Leaflet, framer-motion,
// react-router, or web UI components in native output — contract rule 4):
//   * `useTranslation` (react-i18next) -> `useNativeT`, a `t(key, fallback,
//     vars?)` that returns the English fallback and interpolates `{{var}}`.
//   * `useUnits` + `useFormatting` -> `useNativeFormat`, deriving the SAME
//     distance/energy unit prefs + currency/locale/precision + value-identical
//     `formatEnergy`/`formatCurrency`/`fmtNumber`/`fmtInt`/`fmtPercent` directly
//     from the ported `useSettings()` query.
//   * `useSelectedVehicle` + `<VehicleSelect>` (global store + react-router URL
//     scope) -> `useNativeSelectedVehicle` (first-vehicle default + local
//     override) + a native pressable-chip VehicleSelect; the URL/store
//     precedence is browser-only (documented in the sidecar).
//   * `usePageTitle` (document.title) -> the page header renders the title; the
//     document-title side effect is browser-only (no-op).
//   * `useUrlString`/`useUrlBatch` date-range URL state -> local `useState`
//     seeding the same 30-day default range; `<RangePicker>` becomes native
//     preset chips that drive `setRangeBatch`. URL persistence is browser-only.
//   * `useHiddenSeries` (URL-persisted) -> `useChartLegendState`
//     (in-memory native persistence) — same `{isHidden,toggle}` surface, wired
//     to the native `<ChartLegend>` tap-to-hide UX.
//   * `useSavedViewUrl`/`<SavedViewMenu>` (URL share links) -> native no-op chip
//     (sharing/clipboard URLs are browser-only; documented).
//   * Recharts ComposedChart/AreaChart/BarChart/PieChart -> native data-visible
//     rendering (labelled bars + value rows + legend lists) of the SAME data;
//     the recharts cursor-sync (`ChartTimeRangeProvider`/`useSyncedCursor`/
//     `useSyncedReferenceLineX`/`Brush`) is a browser hover interaction with no
//     native plot to attach to and is documented as omitted.
//   * `RadialGauge`/`ChartContainer`/`ChartLegend`/`renderAnnotationLines` are
//     reused from the native-safe web-parity charts barrel.
//   * lucide icons -> emoji glyphs; react-router `<Link>` -> accent text (the
//     `/charging/:id` navigation is route-based and browser-only).
//   * `PageContainer`/`GlassPanel`/`DataTable`/`FadeIn`/`StaggerContainer`/
//     `StaggerItem`/`Skeleton`/`QueryError`/`EmptyState`/`Currency`/skeletons
//     -> native re-implementations below (GlassPanel + AppText + tokens are the
//     shared native primitives; the rest are local native-safe ports).

import React, {useMemo, useState, type ReactNode} from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {
  ChartContainer,
  ChartLegend,
  RadialGauge,
  renderAnnotationLines,
} from '../../../components/charts';
import {useEnergyStats, type DailyEnergy} from '../../../api/hooks/useEnergy';
import {useChargingSessionsPaginated} from '../../../api/hooks/useCharging';
import {useChargingTelemetryLatest} from '../../../api/hooks/useVehicles';
import {useChartLegendState} from '../../../components/charts/useChartLegendState';
import {useSettings} from '../../../api/hooks/useSettings';
import {useVehicles} from '../../../api/hooks/useVehicles';
import type {ChargingSession} from '../../../api/types';

/* ── Constants ──────────────────────────────────────────────────────────── */

const METERS_PER_KM = 1000;
const METERS_PER_MILE = 1609.344;
const MD_BREAKPOINT = 768;
const TW_UNIT = 4;

// Series / gauge colours mirror the web hex values.
const ENERGY_COLOR = '#00f0ff';
const EFFICIENCY_COLOR = '#10b981';
const CO2_COLOR = '#a855f7';
const COST_COLOR = '#f59e0b';
const CYAN_TEXT = '#67e8f9';
const EMERALD_TEXT = '#6ee7b7';

// Toned-down metric-strip colours (web text-neon-* / --text-primary).
const METRIC_CYAN = '#35d5ff';
const METRIC_GREEN = '#34d399';
const METRIC_PURPLE = '#a78bfa';
const METRIC_AMBER = '#fbbf24';
const METRIC_RED = '#fb7185';

// Emoji stand-ins for the web lucide icons (per-icon tint is not reproducible).
const ICON = {
  zap: '⚡',
  leaf: '🍃',
  fuel: '⛽',
  sun: '☀️',
  moon: '🌙',
  arrowRight: '→',
  activity: '📈',
} as const;

// @/lib/colors CHARGER_COLORS (display-name keys used by this page).
const CHARGER_COLORS: Record<string, string> = {
  supercharger: '#ef4444',
  dc: '#f59e0b',
  home: '#10b981',
  Home: '#10b981',
  Supercharger: '#ef4444',
  'Public DC': '#a855f7',
  'Work / L2': '#f59e0b',
  Other: '#6366f1',
};

/* ── Native-safe inlines for unported web dependencies ──────────────────── */

type TVars = Record<string, string | number>;
type NativeT = (key: string, fallback: string, vars?: TVars) => string;

// react-i18next swap: returns the English fallback and interpolates `{{var}}`.
function useNativeT(): NativeT {
  return useMemo<NativeT>(
    () => (_key, fallback, vars) =>
      vars
        ? fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
            vars[name] != null ? String(vars[name]) : `{{${name}}}`,
          )
        : fallback,
    [],
  );
}

type DistanceUnit = 'km' | 'mi';
type EnergyUnit = 'Wh' | 'kWh';
type PowerUnit = 'W' | 'kW';

interface UnitPrefs {
  distance: DistanceUnit;
  energy: EnergyUnit;
}

interface NativeFormat {
  unitPrefs: UnitPrefs;
  locale: string;
  precision: number;
  currencySymbol: string;
  formatCurrency: (amount: number, decimals?: number) => string;
  formatEnergy: (wh: number | null | undefined) => string;
  fmtNumber: (value: unknown, decimals?: number) => string;
  fmtInt: (value: unknown) => string;
  fmtPercent: (value: unknown, decimals?: number) => string;
}

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

// @/lib/unitConversion convertDistanceFromSI(meters, to).
function convertDistanceFromSI(meters: number, to: DistanceUnit): number {
  return to === 'mi' ? meters / METERS_PER_MILE : meters / METERS_PER_KM;
}

// @/lib/unitConversion convertEnergyFromSI(wh, to).
function convertEnergyFromSI(wh: number, to: EnergyUnit): number {
  return to === 'kWh' ? wh / 1000 : wh;
}

// @/lib/unitConversion convertPowerFromSI(watts, to).
function convertPowerFromSI(watts: number, to: PowerUnit): number {
  return to === 'kW' ? watts / 1000 : watts;
}

// Mirror of useUnits().unitPrefs + useFormatting() resolved from useSettings():
// 'km'/'kWh' defaults, '$'/'en-US' fallbacks, decimal precision defaulting to 2.
function useNativeFormat(): NativeFormat {
  const {data: settings} = useSettings();
  return useMemo<NativeFormat>(() => {
    const distance: DistanceUnit =
      settings?.unit_of_length === 'mi' ? 'mi' : 'km';
    const locale =
      typeof settings?.locale === 'string' && settings.locale.trim().length > 0
        ? settings.locale
        : 'en-US';
    const currencySymbol =
      settings?.currency_symbol && settings.currency_symbol.trim()
        ? settings.currency_symbol
        : '$';
    const dp = settings?.decimal_precision;
    const precision =
      typeof dp === 'number' && Number.isFinite(dp) && dp >= 0
        ? Math.min(20, Math.floor(dp))
        : 2;

    const fmtNumber = (value: unknown, decimals?: number): string => {
      const d = decimals ?? precision;
      try {
        return safeNumber(value).toLocaleString(locale, {
          minimumFractionDigits: d,
          maximumFractionDigits: d,
        });
      } catch {
        return safeNumber(value).toLocaleString('en-US', {
          minimumFractionDigits: d,
          maximumFractionDigits: d,
        });
      }
    };

    return {
      unitPrefs: {distance, energy: 'kWh'},
      locale,
      precision,
      currencySymbol,
      fmtNumber,
      fmtInt: value => fmtNumber(value, 0),
      fmtPercent: (value, decimals) => `${fmtNumber(value, decimals)}%`,
      formatCurrency: (amount, decimals) =>
        `${currencySymbol}${fmtNumber(amount, decimals)}`,
      formatEnergy: wh => {
        if (typeof wh !== 'number' || !Number.isFinite(wh)) {
          return '—';
        }
        return `${fmtNumber(convertEnergyFromSI(wh, 'kWh'), precision)} kWh`;
      },
    };
  }, [settings]);
}

interface VehicleOption {
  id: number;
  label: string;
}

// Parity for useSelectedVehicle: defaults to the first vehicle once the fleet
// loads and allows a local override (the store/URL precedence is browser-only).
function useNativeSelectedVehicle(): {
  vehicleId: number | null;
  options: VehicleOption[];
  setVehicleId: (id: number | null) => void;
} {
  const {data: vehicles} = useVehicles();
  const [override, setOverride] = useState<number | null>(null);
  const list = vehicles ?? [];
  const firstId = list.length > 0 ? list[0].id : null;
  const vehicleId = override ?? firstId;
  const options = list.map(v => ({
    id: v.id,
    label: v.display_name || v.vin || `Vehicle ${v.id}`,
  }));
  return {vehicleId, options, setVehicleId: setOverride};
}

// @/lib/dateFormat formatDateShort: "Mon D" or "—" for invalid input.
function useNativeDateShort(): (iso: string | null | undefined) => string {
  const {locale} = useNativeFormat();
  return useMemo(
    () => (iso: string | null | undefined): string => {
      if (!iso) {
        return '—';
      }
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) {
        return '—';
      }
      const opts: Intl.DateTimeFormatOptions = {month: 'short', day: 'numeric'};
      try {
        return d.toLocaleDateString(locale, opts);
      } catch {
        return d.toLocaleDateString('en-US', opts);
      }
    },
    [locale],
  );
}

/* ── Native shared-component re-implementations ─────────────────────────── */

// `<Grid cols={{ default, md }} gap>` — chunks children into aligned rows.
function Grid({
  cols,
  gap = 3,
  children,
}: {
  cols?: {default?: number; md?: number};
  gap?: number;
  children: ReactNode;
}) {
  const {width} = useWindowDimensions();
  const columns =
    width >= MD_BREAKPOINT
      ? cols?.md ?? cols?.default ?? 1
      : cols?.default ?? 1;
  const gapPx = gap * TW_UNIT;
  const items = React.Children.toArray(children);
  const rows: ReactNode[][] = [];
  for (let i = 0; i < items.length; i += columns) {
    rows.push(items.slice(i, i + columns));
  }
  return (
    <View style={{gap: gapPx}}>
      {rows.map((row, ri) => (
        <View key={ri} style={[styles.gridRow, {gap: gapPx}]}>
          {row.map((child, ci) => (
            <View key={ci} style={styles.gridCell}>
              {child}
            </View>
          ))}
          {row.length < columns
            ? Array.from({length: columns - row.length}).map((_pad, k) => (
                <View key={`pad-${k}`} style={styles.gridCell} />
              ))
            : null}
        </View>
      ))}
    </View>
  );
}

// framer-motion `<FadeIn>`/`<StaggerContainer>`/`<StaggerItem>` ->
// static final-state wrappers (equivalent to the web reduced-motion branch).
function FadeIn({children}: {children: ReactNode}) {
  return <View style={styles.section}>{children}</View>;
}

function StaggerContainer({children}: {children: ReactNode}) {
  return <View style={styles.section}>{children}</View>;
}

// Shared `<EmptyState message>` (message-only call sites): a centred muted line.
function EmptyState({icon, message}: {icon?: string; message: string}) {
  return (
    <View style={styles.empty}>
      {icon ? <AppText style={styles.emptyIcon}>{icon}</AppText> : null}
      <AppText tone="muted" style={styles.emptyText}>
        {message}
      </AppText>
    </View>
  );
}

// `<Currency>` — user currency symbol + locale-grouped value (no FX).
function Currency({
  value,
  precision,
  style,
}: {
  value?: number | null;
  precision?: number;
  style?: StyleProp<TextStyle>;
}) {
  const {formatCurrency} = useNativeFormat();
  return <AppText style={style}>{formatCurrency(value ?? 0, precision)}</AppText>;
}

// `<Skeleton />` — a dim placeholder block.
function Skeleton({height}: {height: number}) {
  return <View style={[styles.skeleton, {height}]} />;
}

function ChartBlockSkeleton({height}: {height: number}) {
  return (
    <GlassPanel style={styles.skeletonPanel}>
      <Skeleton height={height} />
    </GlassPanel>
  );
}

function StatGridSkeleton({cards}: {cards: number}) {
  return (
    <View style={[styles.gridRow, styles.statSkeletonRow]}>
      {Array.from({length: cards}).map((_card, i) => (
        <View key={i} style={styles.statSkeletonCell}>
          <Skeleton height={64} />
        </View>
      ))}
    </View>
  );
}

function PageHeaderSkeleton() {
  return (
    <View style={styles.section}>
      <Skeleton height={28} />
      <View style={styles.headerSkeletonGap} />
      <Skeleton height={16} />
    </View>
  );
}

// `<QueryError>` — error banner with a retry affordance.
function QueryError({
  error,
  onRetry,
}: {
  error: Error | null;
  onRetry?: () => void;
}) {
  if (!error) {
    return null;
  }
  return (
    <GlassPanel style={styles.errorPanel}>
      <AppText tone="danger" weight="semibold">
        {error.message || 'Something went wrong'}
      </AppText>
      {onRetry ? (
        <Pressable accessibilityRole="button" onPress={onRetry}>
          <AppText tone="accent" weight="semibold">
            Retry
          </AppText>
        </Pressable>
      ) : null}
    </GlassPanel>
  );
}

// `<PageContainer title subtitle error actions>` -> native scroll layout.
function PageContainer({
  title,
  subtitle,
  error,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  error?: Error | null;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.screenContent}>
      <View style={styles.pageHeader}>
        <View style={styles.pageHeaderText}>
          <AppText variant="display" weight="bold">
            {title}
          </AppText>
          {subtitle ? (
            <AppText tone="muted" style={styles.pageSubtitle}>
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {actions ? <View style={styles.pageActions}>{actions}</View> : null}
      </View>
      {error ? <QueryError error={error} /> : null}
      <View style={styles.pageBody}>{children}</View>
    </ScrollView>
  );
}

// `<VehicleSelect>` — native pressable chip cycling the fleet (URL scope is
// browser-only; this mirrors the picker behaviour with a local override).
function VehicleSelect({
  value,
  options,
  onChange,
}: {
  value: number | null;
  options: VehicleOption[];
  onChange: (id: number | null) => void;
}) {
  const current = options.find(o => o.id === value);
  const label = current?.label ?? 'Vehicle';
  const onPress = () => {
    if (options.length === 0) {
      return;
    }
    const idx = options.findIndex(o => o.id === value);
    const next = options[(idx + 1) % options.length];
    onChange(next.id);
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Selected vehicle ${label}`}
      disabled={options.length <= 1}
      onPress={onPress}
      style={styles.actionChip}>
      <AppText variant="caption" tone="secondary">{`${ICON.zap} ${label}`}</AppText>
    </Pressable>
  );
}

// `<RangePicker>` — native preset chips (7/30/90 days) driving setRangeBatch.
// The web calendar popover + URL persistence are browser-only.
function RangePicker({
  value,
  onChange,
}: {
  value: {start: string; end: string};
  onChange: (r: {start: string; end: string}) => void;
}) {
  const presets = [7, 30, 90];
  const applyPreset = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    onChange({
      start: start.toISOString().split('T')[0],
      end: end.toISOString().split('T')[0],
    });
  };
  return (
    <View style={styles.rangePicker}>
      <AppText variant="caption" tone="muted">{`${value.start} → ${value.end}`}</AppText>
      <View style={styles.rangePresets}>
        {presets.map(days => (
          <Pressable
            key={days}
            accessibilityRole="button"
            onPress={() => applyPreset(days)}
            style={styles.rangeChip}>
            <AppText variant="caption" tone="secondary">{`${days}d`}</AppText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// `<SavedViewMenu>` — share/clipboard URL views are browser-only; native shows
// a passive chip so the action slot stays visible.
function SavedViewMenu() {
  return (
    <View style={styles.actionChip}>
      <AppText variant="caption" tone="muted">
        Saved Views
      </AppText>
    </View>
  );
}

/* ── Local: Bar / metric primitives ────────────────────────────────────── */

function MeterBar({
  fraction,
  color,
}: {
  fraction: number;
  color: string;
}) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
  return (
    <View style={styles.barTrack}>
      <View
        style={[
          styles.barFill,
          {width: `${Math.max(pct * 100, 3)}%`, backgroundColor: color},
        ]}
      />
    </View>
  );
}

function SessionMetric({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <View style={styles.sessionMetric}>
      <AppText variant="caption" tone="muted" style={styles.sessionMetricLabel}>
        {label}
      </AppText>
      <AppText variant="caption" weight="semibold" style={color ? {color} : undefined}>
        {value}
      </AppText>
    </View>
  );
}

/* ── Local: Cost Comparison Card ────────────────────────────────────────── */

function CostComparisonCard({
  label,
  evCost,
  gasCost,
  icon,
}: {
  label: string;
  evCost: number;
  gasCost: number;
  icon: string;
}) {
  const t = useNativeT();
  const {fmtPercent} = useNativeFormat();
  const savings = (gasCost ?? 0) - (evCost ?? 0);
  const savingsPct = gasCost > 0 ? (savings / gasCost) * 100 : 0;
  return (
    <GlassPanel style={styles.costCard}>
      <View style={styles.costHead}>
        <View style={styles.costIcon}>
          <AppText>{icon}</AppText>
        </View>
        <AppText tone="secondary" weight="semibold">
          {label}
        </AppText>
      </View>
      <View style={styles.costRow}>
        <View>
          <AppText variant="caption" tone="muted" style={styles.upperLabel}>
            {t('energy.cost_decimal.evCost', 'EV Cost')}
          </AppText>
          <Currency value={evCost ?? 0} style={styles.costValueCyan} />
        </View>
        <AppText tone="muted">{ICON.arrowRight}</AppText>
        <View>
          <AppText variant="caption" tone="muted" style={styles.upperLabel}>
            {t('energy.cost_decimal.gasEquivalent', 'Gas Equivalent')}
          </AppText>
          <Currency value={gasCost ?? 0} style={styles.costValueMuted} />
        </View>
      </View>
      <View style={styles.costSavingRow}>
        <AppText weight="bold" style={styles.savingText}>
          {`${t('energy.cost_decimal.saving', 'Saving')} `}
          <Currency value={savings ?? 0} style={styles.savingText} />
        </AppText>
        <View style={styles.savingChip}>
          <AppText variant="caption" weight="semibold" style={styles.savingChipText}>
            {`${fmtPercent(savingsPct ?? 0)} ${t('energy.cost_decimal.less', 'less')}`}
          </AppText>
        </View>
      </View>
    </GlassPanel>
  );
}

/* ── Loading skeleton ───────────────────────────────────────────────────── */

// Mirrors the EnergyPage layout while data loads.
function EnergyPageSkeleton() {
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.screenContent}
      testID="energy-page-skeleton">
      <PageHeaderSkeleton />
      <Skeleton height={180} />
      <StatGridSkeleton cards={6} />
      <Skeleton height={160} />
      <View style={[styles.gridRow, styles.skeletonGap]}>
        <View style={styles.gridCell}>
          <Skeleton height={128} />
        </View>
        <View style={styles.gridCell}>
          <Skeleton height={128} />
        </View>
      </View>
      <ChartBlockSkeleton height={280} />
      <ChartBlockSkeleton height={280} />
      <ChartBlockSkeleton height={320} />
    </ScrollView>
  );
}

/* ── Page ───────────────────────────────────────────────────────────────── */

export default function EnergyPage() {
  const t = useNativeT();
  const fmt = useNativeFormat();
  const {unitPrefs, formatEnergy, formatCurrency, fmtNumber, fmtInt} = fmt;
  const formatDateShort = useNativeDateShort();

  const toDistanceDisplay = (value: number) =>
    convertDistanceFromSI(value, unitPrefs.distance);
  const toEnergyDisplay = (wh: number) =>
    convertEnergyFromSI(wh, unitPrefs.energy);

  const distanceUnit = unitPrefs.distance;
  const energyUnit = unitPrefs.energy;
  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';
  const toEfficiencyDisplay = (whPerM: number) =>
    unitPrefs.distance === 'mi' ? whPerM * 1609.344 : whPerM * 1000;

  /* ── Vehicle selector ─────────────────────────────────────────── */
  const {vehicleId, options: vehicleOptions, setVehicleId} =
    useNativeSelectedVehicle();

  /* ── Date range ───────────────────────────────────────────────── */
  const defaultStartDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  }, []);
  const defaultEndDate = useMemo(() => new Date().toISOString().split('T')[0], []);
  const [startDate, setStartDate] = useState(defaultStartDate);
  const [endDate, setEndDate] = useState(defaultEndDate);
  const setRangeBatch = (next: {from?: string; to?: string}) => {
    if (next.from != null) {
      setStartDate(next.from);
    }
    if (next.to != null) {
      setEndDate(next.to);
    }
  };

  /* URL-persisted hidden-series state for the two-series energy/efficiency
     composed chart (native: in-memory legend persistence). */
  const energyCostHidden = useChartLegendState('energy-cost-daily');

  /* ── Data fetching ────────────────────────────────────────────── */
  const {
    data: stats,
    isLoading,
    error: statsError,
    refetch,
  } = useEnergyStats(vehicleId != null ? String(vehicleId) : null, 30);

  const {data: sessions} = useChargingSessionsPaginated(vehicleId, {
    limit: 100,
    start: startDate,
    end: endDate,
  });

  const {data: liveCharging} = useChargingTelemetryLatest(vehicleId ?? 0);

  /* ── Derived metrics ──────────────────────────────────────────── */
  const totalEnergy =
    sessions?.reduce((s, c) => s + c.total_energy_added_wh, 0) ?? 0;
  const totalCost = sessions?.reduce((s, c) => s + (c.cost_decimal ?? 0), 0) ?? 0;
  const avgEfficiency = stats?.avg_efficiency_wh_per_m ?? 0;
  const totalDistance = stats?.total_distance_m ?? 0;
  const co2Saved = stats?.co2_saved_kg ?? totalEnergy * 0.42;

  const periodDays = Math.max(
    1,
    Math.ceil(
      (new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000,
    ),
  );
  const costPerKm = totalDistance > 0 ? totalCost / totalDistance : 0;
  const costPerKwh = totalEnergy > 0 ? totalCost / (totalEnergy / 1000) : 0;
  const gasEquivalent = totalDistance * 0.12;
  const monthlyProjectedCost =
    costPerKm > 0 ? costPerKm * (totalDistance / periodDays) * 30 : 0;
  const yearlyProjectedCost = monthlyProjectedCost * 12;

  const dailyEnergy: DailyEnergy[] = stats?.daily_breakdown ?? [];

  /* ── No-data banner gate ──────────────────────────────────────── */
  const hasNoEnergyData = useMemo(() => {
    const noSessions = !sessions || sessions.length === 0;
    const noStats =
      !stats ||
      ((stats.total_wh ?? 0) === 0 &&
        (stats.total_energy_used_wh ?? 0) === 0 &&
        (stats.total_distance_m ?? 0) === 0);
    return noSessions && noStats;
  }, [sessions, stats]);

  /* ── Time-of-day analysis ─────────────────────────────────────── */
  const timeOfDayData = useMemo(() => {
    if (!sessions || sessions.length === 0) {
      return [] as Array<{name: string; count: number; energy: number}>;
    }
    const labels = [
      t('energy.timeOfDay.night', 'Night (0-6)'),
      t('energy.timeOfDay.morning', 'Morning (6-12)'),
      t('energy.timeOfDay.afternoon', 'Afternoon (12-18)'),
      t('energy.timeOfDay.evening', 'Evening (18-24)'),
    ];
    const buckets: Record<string, {count: number; energy: number}> = {};
    labels.forEach(l => {
      buckets[l] = {count: 0, energy: 0};
    });
    sessions.forEach(s => {
      const hour = new Date(s.started_at).getHours();
      const idx = hour < 6 ? 0 : hour < 12 ? 1 : hour < 18 ? 2 : 3;
      buckets[labels[idx]].count++;
      buckets[labels[idx]].energy += s.total_energy_added_wh;
    });
    return labels.map(name => ({name, ...buckets[name]}));
  }, [sessions, t]);

  /* ── Charger-type breakdown ───────────────────────────────────── */
  const chargerBreakdown = useMemo(() => {
    if (!sessions || sessions.length === 0) {
      return [] as Array<{
        name: string;
        count: number;
        energy: number;
        cost: number;
        fill: string;
      }>;
    }
    const types: Record<string, {count: number; energy: number; cost: number}> =
      {};
    sessions.forEach(s => {
      const label = s.charger_type?.toLowerCase().includes('tesla')
        ? 'Supercharger'
        : s.charger_type
          ? 'DC Fast'
          : 'Home/AC';
      if (!types[label]) {
        types[label] = {count: 0, energy: 0, cost: 0};
      }
      types[label].count++;
      types[label].energy += s.total_energy_added_wh;
      types[label].cost += s.cost_decimal ?? 0;
    });
    return Object.entries(types).map(([name, data]) => ({
      name,
      ...data,
      fill: CHARGER_COLORS[name] ?? '#00f0ff',
    }));
  }, [sessions]);

  /* ── Recent sessions (table → native cards) ───────────────────── */
  const recentSessions: ChargingSession[] = (sessions ?? []).slice(0, 15);

  /* ── Loading short-circuit ────────────────────────────────────── */
  if (isLoading) {
    return <EnergyPageSkeleton />;
  }

  const maxDailyEnergy = Math.max(
    ...dailyEnergy.map(d => toEnergyDisplay(d.energy_wh ?? 0)),
    1,
  );
  const maxDailyEff = Math.max(
    ...dailyEnergy.map(d => toEfficiencyDisplay(d.efficiency_wh_per_m ?? 0)),
    1,
  );
  const maxTimeEnergy = Math.max(...timeOfDayData.map(b => b.energy), 1);

  /* ── Render ───────────────────────────────────────────────────── */
  return (
    <PageContainer
      title={t('energy.pageTitle', 'Energy Intelligence')}
      subtitle={t(
        'energy.pageSubtitle',
        'Deep cost analytics, efficiency trends, savings projections, and consumption patterns',
      )}
      error={statsError as Error | null}
      actions={
        <View style={styles.actions}>
          <VehicleSelect
            value={vehicleId}
            options={vehicleOptions}
            onChange={setVehicleId}
          />
          <RangePicker
            value={{start: startDate, end: endDate}}
            onChange={r => setRangeBatch({from: r.start, to: r.end})}
          />
          <SavedViewMenu />
        </View>
      }>
      {statsError ? (
        <QueryError error={statsError as Error} onRetry={refetch} />
      ) : null}

      {/* ── Hero Gauges ─────────────────────────────────────────── */}
      <FadeIn>
        <GlassPanel style={styles.heroPanel}>
          {hasNoEnergyData ? (
            <EmptyState
              icon={ICON.zap}
              message={t(
                'energy.empty.hero',
                'No energy data yet — connect your vehicle and complete a drive or charging session to see efficiency, cost, and CO₂ savings.',
              )}
            />
          ) : (
            <Grid cols={{default: 2, md: 4}} gap={4}>
              <RadialGauge
                value={toEnergyDisplay(totalEnergy)}
                max={Math.max(toEnergyDisplay(totalEnergy) * 1.3, 100)}
                label={t('energy.gauge.energyUsed', 'Energy Used')}
                unit={energyUnit}
                color={ENERGY_COLOR}
              />
              <RadialGauge
                value={toEfficiencyDisplay(
                  avgEfficiency ||
                    (totalDistance > 0
                      ? (totalEnergy * 1000) / totalDistance
                      : 0),
                )}
                max={toEfficiencyDisplay(300)}
                label={t('energy.gauge.efficiency', 'Efficiency')}
                unit={efficiencyUnit}
                color={EFFICIENCY_COLOR}
              />
              <RadialGauge
                value={co2Saved}
                max={Math.max(co2Saved * 1.5, 50)}
                label={t('energy.gauge.co2Saved', 'CO₂ Saved')}
                unit="kg"
                color={CO2_COLOR}
              />
              <RadialGauge
                value={totalCost}
                max={Math.max(totalCost * 1.5, 50)}
                label={t('energy.gauge.totalCost', 'Total Cost')}
                unit="$"
                color={COST_COLOR}
              />
            </Grid>
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── Quick Metrics Strip ─────────────────────────────────── */}
      <StaggerContainer>
        <Grid cols={{default: 2, md: 6}} gap={3}>
          {[
            {
              label: t('energy.metric.costPerDist', 'Cost per {{unit}}', {
                unit: distanceUnit,
              }),
              value: formatCurrency(
                totalDistance > 0
                  ? totalCost / toDistanceDisplay(totalDistance)
                  : 0,
              ),
              color: METRIC_CYAN,
            },
            {
              label: t('energy.metric.costPerKwh', 'Cost per kWh'),
              value: formatCurrency(costPerKwh ?? 0),
              color: METRIC_GREEN,
            },
            {
              label: t('energy.metric.totalDistance', 'Total Distance'),
              value: `${fmtInt(toDistanceDisplay(totalDistance ?? 0))} ${distanceUnit}`,
              color: colors.textPrimary,
            },
            {
              label: t('energy.metric.sessions', 'Sessions'),
              value: `${sessions?.length ?? 0}`,
              color: METRIC_PURPLE,
            },
            {
              label: t('energy.metric.monthlyEst', 'Monthly Est.'),
              value: formatCurrency(monthlyProjectedCost ?? 0),
              color: METRIC_AMBER,
            },
            {
              label: t('energy.metric.yearlyEst', 'Yearly Est.'),
              value: formatCurrency(yearlyProjectedCost ?? 0),
              color: METRIC_RED,
            },
          ].map(m => (
            <GlassPanel key={m.label} style={styles.metricCard}>
              <AppText variant="caption" tone="muted" style={styles.upperLabel}>
                {m.label}
              </AppText>
              <AppText weight="bold" style={[styles.metricValue, {color: m.color}]}>
                {m.value}
              </AppText>
            </GlassPanel>
          ))}
        </Grid>
      </StaggerContainer>

      {/* ── Lifetime Metrics ─────────────────────────────────────── */}
      <FadeIn>
        <GlassPanel style={styles.panel}>
          <AppText weight="bold" style={styles.sectionTitle}>
            {`${ICON.zap} ${t('energy.lifetime.title', 'Lifetime Metrics')}`}
          </AppText>
          <Grid cols={{default: 1, md: 2}} gap={3}>
            <View style={styles.tile}>
              <AppText variant="caption" tone="muted" style={styles.upperLabel}>
                {t('energy.lifetime.energyUsed', 'Lifetime Energy Used')}
              </AppText>
              {liveCharging?.lifetime_energy_used != null ? (
                <>
                  <AppText weight="bold" style={styles.tileValueCyan}>
                    {`${fmtNumber(liveCharging.lifetime_energy_used)} `}
                    <AppText tone="muted" variant="caption">
                      kWh
                    </AppText>
                  </AppText>
                  <AppText variant="caption" tone="muted" style={styles.tileDesc}>
                    {t(
                      'energy.lifetime.energyUsedDesc',
                      'Total energy consumed since vehicle delivery',
                    )}
                  </AppText>
                </>
              ) : (
                <AppText tone="muted" weight="semibold">
                  —
                </AppText>
              )}
            </View>
            <View style={styles.tile}>
              <AppText variant="caption" tone="muted" style={styles.upperLabel}>
                {t('energy.lifetime.periodEnergy', 'Last {{days}} Days', {
                  days: periodDays,
                })}
              </AppText>
              <AppText weight="bold" style={styles.tileValueEmerald}>
                {`${fmtNumber(toEnergyDisplay(totalEnergy))} `}
                <AppText tone="muted" variant="caption">
                  {energyUnit}
                </AppText>
              </AppText>
              <AppText variant="caption" tone="muted" style={styles.tileDesc}>
                {t(
                  'energy.lifetime.periodEnergyDesc',
                  'Energy added during selected date range',
                )}
              </AppText>
            </View>
          </Grid>
        </GlassPanel>
      </FadeIn>

      {/* ── Cost vs Gas Savings ─────────────────────────────────── */}
      <Grid cols={{default: 1, md: 2}} gap={4}>
        <FadeIn>
          <CostComparisonCard
            label={t('energy.cost_decimal.periodTotal', '{{days}}-Day Total', {
              days: periodDays,
            })}
            evCost={totalCost}
            gasCost={gasEquivalent}
            icon={ICON.fuel}
          />
        </FadeIn>
        <FadeIn>
          <CostComparisonCard
            label={t('energy.cost_decimal.projectedAnnual', 'Projected Annual')}
            evCost={yearlyProjectedCost}
            gasCost={(gasEquivalent / periodDays) * 365}
            icon={ICON.leaf}
          />
        </FadeIn>
      </Grid>

      {/* ── Charts Row 1: Energy & Cost Daily + Efficiency ──── */}
      <Grid cols={{default: 1, md: 2}} gap={6}>
        <FadeIn>
          <ChartContainer
            title={t('energy.chart.energyCostDaily', 'Energy & Cost Daily')}
            ariaLabel={t(
              'energy.chart.energyCostDaily.aria',
              'Daily energy and efficiency composed chart with bars and a line',
            )}
            exportable
            exportFilename="energy-cost-daily"
            chartKey="energy-cost-daily"
            annotations={{vehicleId, scope: 'energy', chartId: 'energy-cost-daily'}}>
            {({annotations: chartAnnotations}) => (
              <View style={styles.chartBody}>
                <ChartLegend
                  state={energyCostHidden}
                  payload={[
                    {
                      value: t('energy.chart.energy', 'Energy'),
                      dataKey: 'energy_wh',
                      color: ENERGY_COLOR,
                    },
                    {
                      value: efficiencyUnit,
                      dataKey: 'efficiency_wh_per_m',
                      color: EFFICIENCY_COLOR,
                    },
                  ]}
                />
                {dailyEnergy.length > 0 ? (
                  <View style={styles.annotatedArea}>
                    {renderAnnotationLines(chartAnnotations, ts => ts)}
                    <View style={styles.daysList}>
                      {dailyEnergy.map(d => {
                        const showEnergy =
                          !energyCostHidden.isHidden('energy_wh');
                        const showEff = !energyCostHidden.isHidden(
                          'efficiency_wh_per_m',
                        );
                        const energyDisp = toEnergyDisplay(d.energy_wh ?? 0);
                        const effDisp = toEfficiencyDisplay(
                          d.efficiency_wh_per_m ?? 0,
                        );
                        return (
                          <View key={d.date} style={styles.dayRow}>
                            <AppText
                              variant="caption"
                              tone="muted"
                              numberOfLines={1}
                              style={styles.dayDate}>
                              {d.date}
                            </AppText>
                            <View style={styles.dayBar}>
                              {showEnergy ? (
                                <MeterBar
                                  fraction={energyDisp / maxDailyEnergy}
                                  color={ENERGY_COLOR}
                                />
                              ) : null}
                            </View>
                            <View style={styles.dayMeta}>
                              {showEnergy ? (
                                <AppText variant="caption" style={styles.cyanText}>
                                  {`${fmtNumber(energyDisp)} ${energyUnit}`}
                                </AppText>
                              ) : null}
                              {showEff ? (
                                <AppText
                                  variant="caption"
                                  style={styles.emeraldText}>
                                  {`${fmtNumber(effDisp)} ${efficiencyUnit}`}
                                </AppText>
                              ) : null}
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                ) : (
                  <EmptyState
                    icon={ICON.zap}
                    message={t(
                      'energy.chart.noEnergyData',
                      'Connect vehicle to see energy data',
                    )}
                  />
                )}
              </View>
            )}
          </ChartContainer>
        </FadeIn>

        <FadeIn>
          <ChartContainer
            title={t('energy.chart.efficiencyTrend', 'Efficiency Trend')}
            ariaLabel={t(
              'energy.chart.efficiencyTrend.aria',
              'Daily efficiency and distance area chart',
            )}
            exportable
            exportFilename="efficiency-trend">
            <View style={styles.chartBody}>
              {dailyEnergy.length > 0 ? (
                <View style={styles.daysList}>
                  {dailyEnergy.map(d => {
                    const effDisp = toEfficiencyDisplay(
                      d.efficiency_wh_per_m ?? 0,
                    );
                    const distDisp = toDistanceDisplay(d.distance_m ?? 0);
                    return (
                      <View key={d.date} style={styles.dayRow}>
                        <AppText
                          variant="caption"
                          tone="muted"
                          numberOfLines={1}
                          style={styles.dayDate}>
                          {d.date}
                        </AppText>
                        <View style={styles.dayBar}>
                          <MeterBar
                            fraction={effDisp / maxDailyEff}
                            color={EFFICIENCY_COLOR}
                          />
                        </View>
                        <View style={styles.dayMeta}>
                          <AppText variant="caption" style={styles.emeraldText}>
                            {`${fmtNumber(effDisp)} ${efficiencyUnit}`}
                          </AppText>
                          <AppText variant="caption" style={styles.cyanText}>
                            {t('energy.chart.distance', 'Distance ({{unit}})', {
                              unit: distanceUnit,
                            })}
                            {`: ${fmtNumber(distDisp)}`}
                          </AppText>
                        </View>
                      </View>
                    );
                  })}
                </View>
              ) : (
                <EmptyState
                  icon={ICON.activity}
                  message={t(
                    'energy.chart.noEfficiencyData',
                    'No efficiency data yet',
                  )}
                />
              )}
            </View>
          </ChartContainer>
        </FadeIn>
      </Grid>

      {/* ── Charts Row 2: Time of Day + Charger Breakdown ──── */}
      <Grid cols={{default: 1, md: 2}} gap={6}>
        <FadeIn>
          <ChartContainer
            title={t('energy.chart.chargingByTime', 'Charging by Time of Day')}
            ariaLabel={t(
              'energy.chart.chargingByTime.aria',
              'Charging energy and session count by time of day bar chart',
            )}
            exportable
            exportFilename="charging-by-time">
            {timeOfDayData.length > 0 ? (
              <View style={styles.chartBody}>
                <View style={styles.daysList}>
                  {timeOfDayData.map(b => (
                    <View key={b.name} style={styles.dayRow}>
                      <AppText
                        variant="caption"
                        tone="muted"
                        numberOfLines={1}
                        style={styles.bucketName}>
                        {b.name}
                      </AppText>
                      <View style={styles.dayBar}>
                        <MeterBar
                          fraction={b.energy / maxTimeEnergy}
                          color={COST_COLOR}
                        />
                      </View>
                      <View style={styles.dayMeta}>
                        <AppText variant="caption" style={styles.amberText}>
                          {`${fmtNumber(toEnergyDisplay(b.energy))} ${energyUnit}`}
                        </AppText>
                        <AppText variant="caption" style={styles.purpleText}>
                          {`${b.count} ${t('energy.chart.sessions', 'Sessions')}`}
                        </AppText>
                      </View>
                    </View>
                  ))}
                </View>
                <View style={styles.tipsRow}>
                  <AppText variant="caption" tone="muted">
                    {`${ICON.moon} ${t('energy.tip.offPeak', 'Off-peak charging saves money')}`}
                  </AppText>
                  <AppText variant="caption" tone="muted">
                    {`${ICON.sun} ${t('energy.tip.solar', 'Solar-optimal: 10am–3pm')}`}
                  </AppText>
                </View>
              </View>
            ) : (
              <EmptyState
                icon={ICON.activity}
                message={t('common.noData', 'No data available')}
              />
            )}
          </ChartContainer>
        </FadeIn>

        <FadeIn>
          <ChartContainer
            title={t('energy.chart.chargerBreakdown', 'Charger Type Breakdown')}
            ariaLabel={t(
              'energy.chart.chargerBreakdown.aria',
              'Charger type share pie chart',
            )}
            exportable
            exportFilename="charger-breakdown">
            {chargerBreakdown.length > 0 ? (
              <View style={styles.breakdownList}>
                {chargerBreakdown.map(b => (
                  <View key={b.name} style={styles.breakdownItem}>
                    <View style={styles.breakdownHead}>
                      <View style={styles.breakdownName}>
                        <View
                          style={[styles.swatch, {backgroundColor: b.fill}]}
                        />
                        <AppText tone="secondary">{b.name}</AppText>
                      </View>
                      <AppText variant="caption" tone="muted">
                        {`${b.count} ${t('energy.breakdown.sessions', 'sessions')}`}
                      </AppText>
                    </View>
                    <View style={styles.breakdownStats}>
                      <AppText variant="caption" style={styles.cyanText}>
                        {`${fmtNumber(toEnergyDisplay(b.energy ?? 0))} ${energyUnit}`}
                      </AppText>
                      <Currency value={b.cost ?? 0} style={styles.emeraldText} />
                      <AppText variant="caption" tone="muted">
                        <Currency
                          value={b.energy > 0 ? b.cost / (b.energy / 1000) : 0}
                          precision={3}
                          style={styles.mutedText}
                        />
                        {'/kWh'}
                      </AppText>
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <EmptyState
                icon={ICON.activity}
                message={t('common.noData', 'No data available')}
              />
            )}
          </ChartContainer>
        </FadeIn>
      </Grid>

      {/* ── Recent Charging Sessions ─────────────────────────── */}
      <FadeIn>
        <GlassPanel style={styles.panel}>
          <AppText weight="bold" style={styles.sectionTitle}>
            {`${ICON.zap} ${t('energy.sessions.title', 'Recent Charging Sessions')}`}
          </AppText>
          {sessions && sessions.length > 0 ? (
            <View style={styles.sessionsList}>
              {recentSessions.map(s => {
                const isTesla = s.charger_type
                  ?.toLowerCase()
                  .includes('tesla');
                const isFast = !!s.charger_type;
                const typeColor = isTesla
                  ? METRIC_RED
                  : isFast
                    ? METRIC_AMBER
                    : METRIC_GREEN;
                const typeLabel = isTesla
                  ? 'Supercharger'
                  : s.charger_type || 'AC';
                const perKwh =
                  typeof s.cost_decimal === 'number' &&
                  s.total_energy_added_wh > 0
                    ? formatCurrency(
                        s.cost_decimal /
                          convertEnergyFromSI(s.total_energy_added_wh, 'kWh'),
                      )
                    : '—';
                return (
                  <View key={s.id} style={styles.sessionRow}>
                    <View style={styles.sessionTop}>
                      <AppText tone="accent" weight="semibold">
                        {formatDateShort(s.started_at)}
                      </AppText>
                      <View style={[styles.chip, {borderColor: typeColor}]}>
                        <AppText variant="caption" style={{color: typeColor}}>
                          {typeLabel}
                        </AppText>
                      </View>
                    </View>
                    <View style={styles.sessionMetrics}>
                      <SessionMetric
                        label={t('energy.table.energy', 'Energy')}
                        value={formatEnergy(s.total_energy_added_wh ?? 0)}
                        color={CYAN_TEXT}
                      />
                      <SessionMetric
                        label={t('energy.table.battery', 'Battery')}
                        value={`${s.start_soc_pct}% → ${s.end_soc_pct ?? '—'}%`}
                      />
                      <SessionMetric
                        label={t('energy.table.power', 'Power')}
                        value={
                          s.peak_power_w != null
                            ? `${fmtNumber(convertPowerFromSI(s.peak_power_w, 'kW'))} kW`
                            : '—'
                        }
                      />
                      <SessionMetric
                        label={t('energy.table.cost_decimal', 'Cost')}
                        value={
                          typeof s.cost_decimal === 'number'
                            ? formatCurrency(s.cost_decimal)
                            : '—'
                        }
                        color={EMERALD_TEXT}
                      />
                      <SessionMetric
                        label={t('energy.table.perKwh', '$/kWh')}
                        value={perKwh}
                      />
                    </View>
                  </View>
                );
              })}
            </View>
          ) : (
            <EmptyState
              icon={ICON.activity}
              message={t(
                'energy.sessions.empty',
                'No charging sessions recorded',
              )}
            />
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}

/* ── Styles ─────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  screenContent: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  pageHeader: {
    gap: spacing.md,
  },
  pageHeaderText: {
    gap: spacing.xs,
  },
  pageSubtitle: {
    maxWidth: 640,
  },
  pageActions: {
    gap: spacing.sm,
  },
  pageBody: {
    gap: spacing.lg,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  actionChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  rangePicker: {
    gap: spacing.xs,
  },
  rangePresets: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  rangeChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  section: {
    gap: spacing.md,
  },
  gridRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  gridCell: {
    flex: 1,
    minWidth: 0,
  },
  panel: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  heroPanel: {
    padding: spacing.lg,
  },
  sectionTitle: {
    fontSize: 15,
  },
  tile: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    padding: spacing.md,
    gap: spacing.xs,
  },
  tileValueCyan: {
    fontSize: 24,
    color: CYAN_TEXT,
  },
  tileValueEmerald: {
    fontSize: 24,
    color: EMERALD_TEXT,
  },
  tileDesc: {
    marginTop: spacing.xs,
  },
  upperLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  metricCard: {
    padding: spacing.md,
    alignItems: 'center',
    gap: spacing.xs,
  },
  metricValue: {
    fontSize: 17,
  },
  costCard: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  costHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  costIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
  },
  costRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
  },
  costValueCyan: {
    fontSize: 17,
    fontWeight: '700',
    color: CYAN_TEXT,
  },
  costValueMuted: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  costSavingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  savingText: {
    color: EMERALD_TEXT,
  },
  savingChip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
  },
  savingChipText: {
    color: METRIC_GREEN,
  },
  chartBody: {
    gap: spacing.md,
  },
  annotatedArea: {
    position: 'relative',
  },
  daysList: {
    gap: spacing.xs,
  },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dayDate: {
    width: 56,
  },
  bucketName: {
    width: 96,
  },
  dayBar: {
    flex: 1,
    minWidth: 0,
  },
  dayMeta: {
    width: 120,
    alignItems: 'flex-end',
  },
  barTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 999,
  },
  cyanText: {
    color: CYAN_TEXT,
  },
  emeraldText: {
    color: EMERALD_TEXT,
  },
  amberText: {
    color: METRIC_AMBER,
  },
  purpleText: {
    color: METRIC_PURPLE,
  },
  mutedText: {
    color: colors.textMuted,
  },
  tipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  breakdownList: {
    gap: spacing.md,
  },
  breakdownItem: {
    gap: spacing.xs,
  },
  breakdownHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  breakdownName: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  swatch: {
    width: 10,
    height: 10,
    borderRadius: 999,
  },
  breakdownStats: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  sessionsList: {
    gap: spacing.sm,
  },
  sessionRow: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    padding: spacing.md,
    gap: spacing.sm,
  },
  sessionTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  chip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  sessionMetrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  sessionMetric: {
    gap: 2,
  },
  sessionMetricLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  emptyIcon: {
    fontSize: 28,
  },
  emptyText: {
    textAlign: 'center',
    maxWidth: 420,
  },
  errorPanel: {
    padding: spacing.md,
    gap: spacing.sm,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerSurface,
  },
  skeleton: {
    borderRadius: 16,
    backgroundColor: colors.surfaceRaised,
  },
  skeletonPanel: {
    padding: spacing.md,
  },
  skeletonGap: {
    gap: spacing.md,
  },
  statSkeletonRow: {
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statSkeletonCell: {
    flexBasis: '47%',
    flexGrow: 1,
  },
  headerSkeletonGap: {
    height: spacing.sm,
  },
});
