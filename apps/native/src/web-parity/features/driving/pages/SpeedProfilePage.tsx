import {Glyph} from '../../../../components/icons/Glyph';
// Native parity port of web/src/features/driving/pages/SpeedProfilePage.tsx.
//
// `SpeedProfilePage` analyses a vehicle's speed distribution and driving pattern.
// It resolves the active vehicle, derives a date window from a canonical range
// picker (default `'all'` preset), fetches the backend speed profile via
// `useSpeedProfile(vehicleIdStr, start, end)` (GET `/analytics/speed-profile?
// vehicle_id=&start=&end=`) and the raw drive list via `useDrives(vehicleIdStr)`
// (GET `/drives?vehicle_id=`), then renders three hero RadialGauges (avg / peak /
// optimal speed), a speed-distribution bar chart, per-bucket detail cards, a
// speed-vs-efficiency scatter, and an efficiency-insight callout. Every state
// name (`t`, `vehicleId`, `vehicleIdStr`, `start`/`end`/`setRange`, `data`/
// `isLoading`/`error`, `allDrives`, `drives`, `unitPrefs`, `toSpeedDisplay`,
// `speedUnit`, `efficiencyUnit`, `toEfficiencyDisplay`, `scatterData`,
// `bucketEfficiency`), the API paths + query gating, the SI unit handling
// (display-boundary conversion only), and every i18n key + English fallback are
// preserved verbatim from the source. The `bucketColor`/`getEfficiency` helpers
// keep byte-identical logic; `bucketTextClass`/`categoryIcon` keep identical
// branch logic but resolve to native colours/glyphs instead of Tailwind classes
// / lucide SVGs.
//
// Web-only dependencies with no native-parity surface are mapped per the
// conversion contract (rules 4-7), each documented in the parity sidecar:
//   - react-i18next `useTranslation` (L2) -> a native i18n shim. i18next returns
//     the KEY when no translation/fallback exists, so the shim resolves
//     `t(key)` -> key and `t(key, 'English', params?)` -> the English fallback
//     with `{{token}}` interpolation. Used identically by the sibling page ports.
//   - lucide-react icons (L3: Gauge/Zap/TrendingUp/Car) are SVG with no native
//     analog -> decorative emoji glyphs via the local `Glyph`
//     (accessibilityElementsHidden); the adjacent label always carries meaning.
//   - `PageContainer` from @/components/layout (L4) -> the web-parity layout
//     PageContainer (reused; `title`/`subtitle`/`error`/`actions`/`loading`
//     match).
//   - `GlassPanel` from @/components/ui (L5) -> the shared native GlassPanel.
//   - every chart primitive from @/components/charts (L6-11): ChartContainer/
//     ChartTooltip/BarChart/Bar/ScatterChart/Scatter/XAxis/YAxis/CartesianGrid/
//     Tooltip/ResponsiveContainer/Cell/RadialGauge -> the web-parity charts
//     barrel, which preserves the Recharts public API while rendering
//     React-Native-safe primitives (no Recharts/SVG/DOM). The recharts JSX is
//     kept structurally faithful; leaf primitives render accessible
//     "unavailable" placeholders. RadialGauge renders a native arc; the
//     per-bucket detail cards + scatter legend carry the numbers in accessible
//     text (the source's `chart-a11y:no-table` intent).
//   - `FadeIn`/`StaggerContainer`/`StaggerItem` from @/components/motion (L12-14)
//     -> the web-parity motion barrel (reused). StaggerContainer renders a plain
//     native column with no style hook, so the Tailwind `grid grid-cols-2
//     sm:grid-cols-3 lg:grid-cols-5` is UNAVAILABLE on native; the bucket cards
//     render as a full-width vertical stagger stack (documented).
//   - `EmptyState` from @/components/feedback (L15) -> a local component
//     mirroring the web API (`{ message }`): a centred muted message. The shared
//     native EmptyState requires a `title` the source never supplies, so a
//     faithful message-only shim is used instead.
//   - `RangePicker`/`VehicleSelect` from @/components/forms (L16) have no native
//     parity port -> local read-only chips (`RangePicker` shows the resolved
//     start->end window; `VehicleSelect` shows the resolved vehicle name).
//     Interactive calendar selection + vehicle switching are UNAVAILABLE on
//     native (documented); the page still resolves scope via the hooks.
//   - `useRangeState` (L17) -> a local native-safe shim: holds the {start,end}
//     window in component state, defaulting to the `'all'` preset (`'2015-01-01'`
//     .. today, ISO yyyy-mm-dd) exactly as the web preset resolves. URL sync +
//     localStorage persistence are UNAVAILABLE on native (documented); `setRange`
//     still updates state for source compatibility.
//   - `useSpeedProfile`/`useDrives` from @/api/hooks/useDriving (L18) + the
//     `Drive` type from @/types/driving (L24) -> the web-parity useDriving hooks
//     + its exported `Drive` (reused 1:1; identical field names + JSON shape).
//   - `useSelectedVehicle` (L19) -> a local first-vehicle native shim (URL
//     path/query + persisted-store selection is UNAVAILABLE on native).
//   - `useUnits` (L20) -> a local speed+distance shim (the surfaces this page
//     reads): `unitPrefs.speed`/`unitPrefs.distance` derived from
//     `unit_of_length` (`'mi' -> 'mph'/'mi'`, else `'km/h'/'km'`).
//   - `usePageTitle` (L21) -> a documented native-safe no-op (no DOM
//     document.title; the translated title still flows into PageContainer's
//     header).
//   - `cn` from @/lib/cn (L22) is a className combiner with no native surface
//     (StyleSheet replaces Tailwind classes) -> dropped; conditional colours are
//     computed and applied via inline style.
//   - `fmtNumber` from @/lib/numberFormat (L23) and `convertSpeedFromSI` from
//     @/lib/unitConversion (L25) -> inlined verbatim so rendered strings are
//     byte-identical (native lib/format.ts diverges).
//
// No DOM-only modules, browser HTML elements, Recharts, Leaflet, or old web UI
// components are imported. Tailwind maps to StyleSheet: the `grid-cols-3` hero
// row -> a flex row of three equal centred gauge cells; `p-4 sm:p-6` -> panel
// padding; the `--text-primary/secondary/muted` tokens -> colors.text*; the long
// page body is wrapped in a ScrollView so every section stays reachable.

import React, {useMemo} from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {
  useDrives,
  useSpeedProfile,
  type Drive,
} from '../../../api/hooks/useDriving';
import {useSettings} from '../../../api/hooks/useSettings';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {PageContainer} from '../../../components/layout/PageContainer';
import {FadeIn, StaggerContainer, StaggerItem} from '../../../components/motion';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ChartContainer,
  ChartTooltip,
  RadialGauge,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from '../../../components/charts';

/* ── i18n shim ─────────────────────────────────────────────────── */
// react-i18next has no native parity module. i18next resolves a missing
// translation to the KEY, so: `t(key)` -> key; `t(key, 'English')` -> 'English'.
// `{{token}}` placeholders are interpolated from the optional params bag.
type TParams = Record<string, string | number>;
type TFunc = (key: string, fallback?: string, params?: TParams) => string;

function interpolate(template: string, params?: TParams): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, token: string) => {
    const value = params[token];
    return value == null ? match : String(value);
  });
}

const translate: TFunc = (key, fallback, params) =>
  interpolate(typeof fallback === 'string' ? fallback : key, params);

function useTranslation(): {t: TFunc} {
  return {t: translate};
}

/* ── usePageTitle shim ─────────────────────────────────────────── */
// The web hook writes `document.title`; native has no DOM document, so this is a
// documented native-safe no-op. The translated title is still computed at the
// call site and rendered by PageContainer as the on-screen header.
function usePageTitle(title: string): void {
  React.useEffect(() => {
    return undefined;
  }, [title]);
}

/* ── numberFormat (inlined from web @/lib/numberFormat) ────────── */
// `safeNumber` collapses non-finite/non-number values to 0; `fmtNumber` is the
// locale-aware fixed-precision formatter (default precision 2).
const DEFAULT_PRECISION = 2;

function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals?: number, locale = 'en-US'): string {
  const d = decimals ?? DEFAULT_PRECISION;
  try {
    return safeNumber(v).toLocaleString(locale, {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  } catch {
    return safeNumber(v).toLocaleString('en-US', {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  }
}

/* ── unitConversion (inlined from web @/lib/unitConversion) ────── */
type SpeedUnitPref = 'km/h' | 'mph';
type DistanceUnitPref = 'km' | 'mi';

const SECONDS_PER_HOUR = 3600;
const METERS_PER_KM = 1000;
const METERS_PER_MILE = 1609.344;

function convertSpeedFromSI(mps: number, to: SpeedUnitPref): number {
  switch (to) {
    case 'km/h':
      return (mps * SECONDS_PER_HOUR) / METERS_PER_KM;
    case 'mph':
      return (mps * SECONDS_PER_HOUR) / METERS_PER_MILE;
  }
}

function deriveDistance(unitOfLength: string | undefined): DistanceUnitPref {
  return unitOfLength === 'mi' ? 'mi' : 'km';
}

function deriveSpeed(unitOfLength: string | undefined): SpeedUnitPref {
  return unitOfLength === 'mi' ? 'mph' : 'km/h';
}

/* ── useUnits shim (speed + distance — the surfaces this page uses) ── */
// Mirrors the web `useUnits` speed/distance bridge: derive `unitPrefs.speed` and
// `unitPrefs.distance` from the user's `unit_of_length` setting. The page only
// reads those two prefs, so the other formatters are intentionally omitted.
function useUnits(): {
  unitPrefs: {speed: SpeedUnitPref; distance: DistanceUnitPref};
} {
  const {data: settings} = useSettings();
  const speed = deriveSpeed(settings?.unit_of_length);
  const distance = deriveDistance(settings?.unit_of_length);
  return useMemo(() => ({unitPrefs: {speed, distance}}), [speed, distance]);
}

/* ── useSelectedVehicle shim (native-safe; first vehicle in the fleet) ── */
// The web hook resolves URL path/query > persisted store > first vehicle. Native
// has no DOM URL and no cross-page selected-vehicle store, so selection falls
// back to the first vehicle in the fleet. The VehicleSelect chip is
// non-interactive on native (documented in the sidecar).
function useSelectedVehicle(): {vehicleId: number | null} {
  const {data: vehicles} = useVehicles();
  const vehicleId = vehicles && vehicles.length > 0 ? vehicles[0].id : null;
  return {vehicleId};
}

/* ── useRangeState shim (native-safe; in-state {start,end} window) ── */
// The web hook syncs the range to the URL + localStorage and resolves named
// presets. Native has no DOM URL or localStorage, so both are UNAVAILABLE; the
// shim holds the window in component state, defaulting to the `'all'` preset
// (`'2015-01-01'` .. today) exactly as the web preset resolves
// (resolveAllTimeStart() -> '2015-01-01', resolve().end -> today ISO). `setRange`
// still updates state for source compatibility. `persistKey`/`defaultPresetId`
// are accepted but the default window is always the documented all-time window.
interface RangeValue {
  start: string;
  end: string;
}

interface UseRangeStateOptions {
  persistKey?: string;
  defaultPresetId?: string;
}

const ALL_TIME_START = '2015-01-01';

function isoFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function resolveDefaultRange(): RangeValue {
  return {start: ALL_TIME_START, end: isoFromDate(new Date())};
}

function useRangeState(_options: UseRangeStateOptions = {}): {
  start: string;
  end: string;
  setRange: (range: RangeValue) => void;
} {
  const [range, setRange] = React.useState<RangeValue>(resolveDefaultRange);
  const setRangeCb = React.useCallback(
    (next: RangeValue) => setRange(next),
    [],
  );
  return {start: range.start, end: range.end, setRange: setRangeCb};
}

/* ── Decorative glyph (lucide icon substitute) ─────────────────── */
function GlyphLegacyUnused({
  children,
  style,
}: {
  children: string;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={style}>
      {children}
    </AppText>
  );
}

/* ── Local EmptyState (web @/components/feedback EmptyState) ────── */
// Mirrors the web API (`{ message }`): a centred muted message. The shared native
// EmptyState requires a `title` the source never supplies, so this message-only
// shim stays faithful.
function EmptyState({message}: {message: string}) {
  return (
    <View accessibilityRole="text" style={styles.emptyState}>
      <AppText style={styles.emptyMessage} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

/* ── Local RangePicker (web @/components/forms RangePicker) ────── */
// Read-only on native: shows the resolved start->end window. Interactive calendar
// selection is UNAVAILABLE (documented in the sidecar); `onChange`/`align` are
// accepted for source compatibility.
function RangePicker({
  value,
  triggerTestId,
}: {
  value: RangeValue;
  onChange?: (range: RangeValue) => void;
  align?: 'start' | 'end';
  triggerTestId?: string;
}) {
  return (
    <View
      accessibilityRole="text"
      style={styles.rangeChip}
      testID={triggerTestId}>
      <Glyph style={styles.rangeChipGlyph}>📅</Glyph>
      <AppText
        numberOfLines={1}
        style={styles.rangeChipText}
        variant="caption"
        weight="semibold">
        {`${value.start} → ${value.end}`}
      </AppText>
    </View>
  );
}

/* ── Local VehicleSelect (web @/components/forms VehicleSelect) ── */
// Read-only on native: shows the resolved vehicle name. Interactive selection is
// UNAVAILABLE (documented in the sidecar).
function VehicleSelect() {
  const {data: vehicles} = useVehicles();
  const {vehicleId} = useSelectedVehicle();
  const name =
    vehicles?.find(v => v.id === vehicleId)?.display_name ??
    translate('All Vehicles');
  return (
    <View accessibilityRole="text" style={styles.vehicleChip}>
      <Glyph style={styles.vehicleChipGlyph}>🚗</Glyph>
      <AppText
        numberOfLines={1}
        style={styles.vehicleChipText}
        variant="caption"
        weight="semibold">
        {name}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function bucketColor(range: string): string {
  if (range.startsWith('0') || range.includes('15')) return '#10b981';
  if (range.startsWith('30') || range.includes('45')) return '#00f0ff';
  if (range.startsWith('60') || range.includes('75')) return '#f59e0b';
  return '#ef4444';
}

// Source `bucketTextClass` returns a Tailwind text class; native resolves the
// same branch to the equivalent hex colour (emerald-500 / cyan-400 / amber-500 /
// red-500) for an inline style.
function bucketTextColor(range: string): string {
  if (range.startsWith('0') || range.includes('15')) return '#10b981';
  if (range.startsWith('30') || range.includes('45')) return '#22d3ee';
  if (range.startsWith('60') || range.includes('75')) return '#f59e0b';
  return '#ef4444';
}

// Source `categoryIcon` returns a lucide icon; native resolves the same branch to
// a decorative emoji glyph (Car / TrendingUp / Gauge) with the matching colour
// (green-400 / cyan-400 / amber-400). The adjacent range label carries meaning.
function CategoryIcon({range}: {range: string}) {
  let glyph = '🎛️';
  let color = '#fbbf24';
  if (range.includes('30') || range.startsWith('0')) {
    glyph = '🚗';
    color = '#4ade80';
  } else if (range.includes('60') || range.includes('90')) {
    glyph = '📈';
    color = '#22d3ee';
  }
  return <Glyph style={[styles.catIcon, {color}]}>{glyph}</Glyph>;
}

function getEfficiency(drive: Drive): number | null {
  if (!(drive.distanceM > 0)) return null;
  if (drive.energyUsedWh != null && drive.energyUsedWh > 0) {
    return drive.energyUsedWh / (drive.distanceM / 1000);
  }
  const battUsed = (drive.startBatteryPct ?? 0) - (drive.endBatteryPct ?? 0);
  if (battUsed > 0) return (battUsed * 0.75 * 1000) / (drive.distanceM / 1000);
  return null;
}

/* ------------------------------------------------------------------ */
/*  SpeedProfilePage                                                  */
/* ------------------------------------------------------------------ */

export default function SpeedProfilePage() {
  const {t} = useTranslation();
  usePageTitle(t('speedProfile.title', 'Speed Profile'));

  const {vehicleId} = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;

  const {start, end, setRange} = useRangeState({
    persistKey: 'speed-profile.range',
    defaultPresetId: 'all',
  });

  const {data, isLoading, error} = useSpeedProfile(vehicleIdStr, start, end);
  const {data: allDrives} = useDrives(vehicleIdStr);

  // Narrow the drives feeding the per-bucket efficiency table and the
  // scatter plot to the picked window so they stay visually consistent
  // with the backend-side distribution/categories windows.
  const drives = useMemo(() => {
    if (!allDrives?.length) return allDrives;
    const startMs = new Date(`${start}T00:00:00`).getTime();
    const endMs = new Date(`${end}T23:59:59.999`).getTime();
    return allDrives.filter(d => {
      if (!d.startTs) return false;
      const time = new Date(d.startTs).getTime();
      return time >= startMs && time <= endMs;
    });
  }, [allDrives, start, end]);

  const {unitPrefs} = useUnits();
  // Source defines this as a plain per-render arrow; on native it feeds the
  // memo dep arrays below, so the react-hooks/exhaustive-deps "unstable
  // function" check is suppressed here to keep the source shape verbatim (the
  // rendered output is identical regardless of the function's identity).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const toSpeedDisplay = (value: number) =>
    convertSpeedFromSI(value, unitPrefs.speed);

  const speedUnit = unitPrefs.speed;
  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const toEfficiencyDisplay = (whPerKm: number) =>
    unitPrefs.distance === 'mi' ? whPerKm * 1.609344 : whPerKm;

  /* ---- Speed vs Efficiency scatter from drives ---- */
  const scatterData = useMemo(() => {
    if (!drives) return [];
    return drives
      .filter(d => d.avgSpeedMps && getEfficiency(d))
      .map(d => {
        const eff = toEfficiencyDisplay(getEfficiency(d)!);
        return {
          speed: Math.round(toSpeedDisplay(d.avgSpeedMps!)),
          efficiency: Math.round(eff),
          color:
            eff < 140
              ? '#10b981'
              : eff < 200
                ? '#00f0ff'
                : eff < 260
                  ? '#f59e0b'
                  : '#ef4444',
        };
      });
  }, [drives, toSpeedDisplay, toEfficiencyDisplay]);

  /* ---- Per-bucket efficiency from drives ---- */
  const bucketEfficiency = useMemo(() => {
    if (!drives)
      return new Map<string, {avgEff: number; avgSpeedMps: number}>();
    const map = new Map<
      string,
      {totalEff: number; totalSpdMps: number; count: number}
    >();
    const ranges = data?.distribution ?? [];
    drives.forEach(d => {
      if (d.avgSpeedMps == null) return;
      const eff = getEfficiency(d);
      if (!eff) return;
      // Bucket label literals ("0-15", "15-30", ...) are in the user's
      // display speed unit, so compare against the converted value while
      // accumulating the SI value (m/s) for later conversion at display.
      const speedDisplay = toSpeedDisplay(d.avgSpeedMps);
      for (const r of ranges) {
        const bucket = r.speedBucket ?? r.speed_bucket ?? '';
        const parts = bucket.match(/(\d+)/g);
        if (!parts) continue;
        const lo = Number(parts[0]);
        const hi = parts.length > 1 ? Number(parts[1]) : 999;
        if (speedDisplay >= lo && speedDisplay < hi) {
          const existing = map.get(bucket) ?? {
            totalEff: 0,
            totalSpdMps: 0,
            count: 0,
          };
          existing.totalEff += eff;
          existing.totalSpdMps += d.avgSpeedMps;
          existing.count++;
          map.set(bucket, existing);
          break;
        }
      }
    });
    const result = new Map<string, {avgEff: number; avgSpeedMps: number}>();
    map.forEach((v, k) => {
      result.set(k, {
        avgEff: v.totalEff / v.count,
        avgSpeedMps: v.totalSpdMps / v.count,
      });
    });
    return result;
  }, [drives, data, toSpeedDisplay]);

  return (
    <PageContainer
      title={t('speedProfile.title', 'Speed Profile')}
      subtitle={t(
        'speedProfile.subtitle',
        'Speed distribution and driving pattern analysis',
      )}
      error={error instanceof Error ? error : null}
      actions={
        <View style={styles.actions}>
          <VehicleSelect />
          <RangePicker
            value={{start, end}}
            onChange={setRange}
            align="end"
            triggerTestId="speed-profile-range"
          />
        </View>
      }
      loading={isLoading}>
      <ScrollView contentContainerStyle={styles.body}>
        {data ? (
          <>
            {/* Hero gauges */}
            <FadeIn>
              <GlassPanel style={styles.heroPanel}>
                <View style={styles.heroRow}>
                  <View style={styles.gaugeCell}>
                    <RadialGauge
                      value={Math.round(toSpeedDisplay(data.avgSpeedMps ?? 0))}
                      max={Math.round(toSpeedDisplay(55.56))}
                      label={t('speedProfile.avgSpeed', 'Avg Speed')}
                      unit={speedUnit}
                      color="#00f0ff"
                    />
                  </View>
                  <View style={styles.gaugeCell}>
                    <RadialGauge
                      value={Math.round(toSpeedDisplay(data.peakSpeedMps ?? 0))}
                      max={Math.round(toSpeedDisplay(69.44))}
                      label={t('speedProfile.peakSpeed', 'Peak Speed')}
                      unit={speedUnit}
                      color="#ef4444"
                    />
                  </View>
                  <View style={styles.gaugeCell}>
                    <RadialGauge
                      value={Math.round(
                        toSpeedDisplay(data.optimalSpeedMps ?? 0),
                      )}
                      max={Math.round(toSpeedDisplay(55.56))}
                      label={t('speedProfile.optimalSpeed', 'Optimal Speed')}
                      unit={speedUnit}
                      color="#10b981"
                    />
                  </View>
                </View>
              </GlassPanel>
            </FadeIn>

            {/* Speed distribution bar chart */}
            <FadeIn>
              {/* chart-a11y:no-table per-bucket detail cards (below) provide the same numbers in an accessible format */}
              <ChartContainer
                title={t('speedProfile.distribution', 'Speed Distribution')}
                ariaLabel={t(
                  'speedProfile.distribution.aria',
                  'Speed-bucket time-share distribution bar chart',
                )}
                height={280}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={(data.distribution ?? []).map(b => {
                      const range = b.speedBucket ?? b.speed_bucket ?? '';
                      return {range, pct: b.readings ?? 0, count: b.readings ?? 0};
                    })}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--glass-border)"
                      strokeOpacity={0.4}
                    />
                    <XAxis
                      dataKey="range"
                      tick={{fill: 'var(--text-muted)', fontSize: 9}}
                    />
                    <YAxis tick={{fill: 'var(--text-muted)', fontSize: 10}} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar
                      dataKey="pct"
                      name={`% ${t('speedProfile.timeSpent', 'time')}`}
                      radius={[4, 4, 0, 0]}>
                      {(data.distribution ?? []).map((b, i) => (
                        <Cell
                          key={i}
                          fill={bucketColor(
                            b.speedBucket ?? b.speed_bucket ?? '',
                          )}
                          fillOpacity={0.7}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
            </FadeIn>

            {/* Speed bucket detail cards */}
            <StaggerContainer>
              {(data.distribution ?? []).map(bucket => {
                const range = bucket.speedBucket ?? bucket.speed_bucket ?? '';
                const totalReadings = (data.distribution ?? []).reduce(
                  (s, b) => s + (b.readings ?? 0),
                  0,
                );
                const pct =
                  totalReadings > 0
                    ? ((bucket.readings ?? 0) / totalReadings) * 100
                    : 0;
                const effData = bucketEfficiency.get(range);
                return (
                  <StaggerItem key={range}>
                    <GlassPanel style={styles.bucketCard}>
                      <View style={styles.bucketHeader}>
                        <CategoryIcon range={range} />
                        <AppText
                          style={styles.bucketRangeLabel}
                          variant="caption"
                          weight="semibold">
                          {range}
                        </AppText>
                      </View>
                      <View style={styles.bucketRows}>
                        <View style={styles.bucketRow}>
                          <AppText
                            style={styles.bucketRowLabel}
                            tone="muted"
                            variant="caption">
                            {t('speedProfile.timeShare', 'Time')}
                          </AppText>
                          <AppText
                            style={[
                              styles.bucketRowValue,
                              {color: bucketTextColor(range)},
                            ]}
                            weight="bold">
                            {`${fmtNumber(pct, 1)}%`}
                          </AppText>
                        </View>
                        <View style={styles.bucketRow}>
                          <AppText
                            style={styles.bucketRowLabel}
                            tone="muted"
                            variant="caption">
                            {t('speedProfile.drives', 'Drives')}
                          </AppText>
                          <AppText
                            style={[styles.bucketRowValue, styles.driveValue]}
                            weight="bold">
                            {bucket.readings ?? 0}
                          </AppText>
                        </View>
                        {effData ? (
                          <>
                            <View style={styles.bucketRow}>
                              <AppText
                                style={styles.bucketRowLabel}
                                tone="muted"
                                variant="caption">
                                {t('speedProfile.avgSpeed', 'Avg Speed')}
                              </AppText>
                              <AppText
                                style={[
                                  styles.bucketRowValue,
                                  styles.avgSpeedValue,
                                ]}
                                weight="bold">
                                {`${fmtNumber(
                                  toSpeedDisplay(effData.avgSpeedMps),
                                )} ${speedUnit}`}
                              </AppText>
                            </View>
                            <View style={styles.bucketRow}>
                              <AppText
                                style={styles.bucketRowLabel}
                                tone="muted"
                                variant="caption">
                                {efficiencyUnit}
                              </AppText>
                              <AppText
                                style={[
                                  styles.bucketRowValue,
                                  {
                                    color:
                                      effData.avgEff < 160
                                        ? '#4ade80'
                                        : effData.avgEff < 220
                                          ? '#fbbf24'
                                          : '#f87171',
                                  },
                                ]}
                                weight="bold">
                                {fmtNumber(toEfficiencyDisplay(effData.avgEff))}
                              </AppText>
                            </View>
                          </>
                        ) : null}
                      </View>
                    </GlassPanel>
                  </StaggerItem>
                );
              })}
            </StaggerContainer>

            {/* Speed vs Efficiency scatter */}
            {scatterData.length > 3 ? (
              <FadeIn>
                {/* chart-a11y:no-table per-drive scatter cloud — too dense for a tabular fallback */}
                <ChartContainer
                  title={t('speedProfile.effVsSpeed', 'Efficiency vs Speed')}
                  ariaLabel={t(
                    'speedProfile.effVsSpeed.aria',
                    'Per-drive efficiency versus speed scatter plot',
                  )}
                  subtitle={`${t('speedProfile.lower', 'Lower')} ${efficiencyUnit} = ${t('speedProfile.better', 'better')}`}
                  height={240}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="var(--glass-border)"
                        strokeOpacity={0.4}
                      />
                      <XAxis
                        dataKey="speed"
                        name={t('speedProfile.speed', 'Speed')}
                        unit={` ${speedUnit}`}
                        tick={{fill: 'var(--text-muted)', fontSize: 10}}
                      />
                      <YAxis
                        dataKey="efficiency"
                        name={efficiencyUnit}
                        unit={` ${efficiencyUnit}`}
                        tick={{fill: 'var(--text-muted)', fontSize: 10}}
                      />
                      <Tooltip content={<ChartTooltip />} />
                      <Scatter data={scatterData} fillOpacity={0.7}>
                        {scatterData.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Scatter>
                    </ScatterChart>
                  </ResponsiveContainer>
                  <View style={styles.scatterLegendRow}>
                    <View style={styles.legendItem}>
                      <View
                        style={[styles.legendDot, {backgroundColor: '#10b981'}]}
                      />
                      <AppText
                        style={styles.legendLabel}
                        tone="muted"
                        variant="caption">
                        {t('speedProfile.efficient', 'Efficient')}
                      </AppText>
                    </View>
                    <View style={styles.legendItem}>
                      <View
                        style={[styles.legendDot, {backgroundColor: '#f59e0b'}]}
                      />
                      <AppText
                        style={styles.legendLabel}
                        tone="muted"
                        variant="caption">
                        {t('speedProfile.moderate', 'Moderate')}
                      </AppText>
                    </View>
                    <View style={styles.legendItem}>
                      <View
                        style={[styles.legendDot, {backgroundColor: '#ef4444'}]}
                      />
                      <AppText
                        style={styles.legendLabel}
                        tone="muted"
                        variant="caption">
                        {t('speedProfile.highConsumption', 'High consumption')}
                      </AppText>
                    </View>
                  </View>
                </ChartContainer>
              </FadeIn>
            ) : null}

            {/* Efficiency insight */}
            {(data.optimalSpeedMps ?? 0) > 0 ? (
              <FadeIn>
                <GlassPanel style={styles.insightPanel}>
                  <View style={styles.insightRow}>
                    <Glyph style={styles.insightIcon}>⚡</Glyph>
                    <View style={styles.insightTextBlock}>
                      <AppText style={styles.insightTitle} weight="semibold">
                        {t('speedProfile.insightTitle', 'Efficiency Insight')}
                      </AppText>
                      <AppText
                        style={styles.insightText}
                        tone="secondary"
                        variant="caption">
                        {t(
                          'speedProfile.insightText',
                          'Drives around {{speed}} {{unit}} show the best energy efficiency. Reducing highway speed could improve efficiency by ~15%.',
                          {
                            speed: fmtNumber(
                              toSpeedDisplay(data.optimalSpeedMps ?? 0),
                            ),
                            unit: speedUnit,
                          },
                        )}
                      </AppText>
                    </View>
                  </View>
                </GlassPanel>
              </FadeIn>
            ) : null}
          </>
        ) : (
          <EmptyState
            /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            message={t(
              'speedProfile.noData',
              'No speed profile data available yet',
            )}
          />
        )}
      </ScrollView>
    </PageContainer>
  );
}

const styles = StyleSheet.create({
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'flex-end',
  },
  body: {
    gap: 24,
    paddingBottom: spacing.xl,
  },
  /* hero gauges (grid-cols-3 -> row of three equal centred cells) */
  heroPanel: {
    padding: spacing.lg,
  },
  heroRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  gaugeCell: {
    alignItems: 'center',
    flex: 1,
  },
  /* bucket detail cards (vertical stagger stack — the web grid className is inert) */
  bucketCard: {
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  bucketHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  catIcon: {
    fontSize: 18,
  },
  bucketRangeLabel: {
    color: colors.textPrimary,
    fontSize: 12,
  },
  bucketRows: {
    gap: spacing.sm,
  },
  bucketRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  bucketRowLabel: {
    fontSize: 10,
  },
  bucketRowValue: {
    fontSize: 14,
  },
  driveValue: {
    color: '#22d3ee',
  },
  avgSpeedValue: {
    color: colors.textSecondary,
  },
  /* scatter legend */
  scatterLegendRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'flex-end',
    marginTop: spacing.sm,
  },
  legendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  legendDot: {
    borderRadius: 999,
    height: 8,
    width: 8,
  },
  legendLabel: {
    color: colors.textMuted,
    fontSize: 10,
  },
  /* efficiency insight */
  insightPanel: {
    borderLeftColor: '#4ade80',
    borderLeftWidth: 4,
    padding: spacing.md,
  },
  insightRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  insightIcon: {
    color: '#4ade80',
    fontSize: 18,
    marginTop: 2,
  },
  insightTextBlock: {
    flex: 1,
  },
  insightTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    marginBottom: spacing.xs,
  },
  insightText: {
    fontSize: 12,
  },
  /* empty state */
  emptyState: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  emptyMessage: {
    maxWidth: 360,
    textAlign: 'center',
  },
  /* header chips */
  vehicleChip: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    maxWidth: 200,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  vehicleChipGlyph: {
    fontSize: 13,
  },
  vehicleChipText: {
    color: colors.textSecondary,
    flexShrink: 1,
  },
  rangeChip: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    maxWidth: 240,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  rangeChipGlyph: {
    fontSize: 13,
  },
  rangeChipText: {
    color: colors.textSecondary,
    flexShrink: 1,
  },
});
