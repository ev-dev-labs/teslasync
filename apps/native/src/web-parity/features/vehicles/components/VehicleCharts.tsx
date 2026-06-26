// Native parity port of
// web/src/features/vehicles/components/VehicleCharts.tsx.
//
// The web source renders a 2-column responsive grid of up to four cards:
//   1. Live Map (only when state.latitude && state.longitude) — a Leaflet
//      MapContainer centred on the current position with a MapLayerSwitcher, a
//      MapTileLayer, the vehicle Marker, and a cyan trail Polyline built from the
//      recent positions, plus the formatted lat/long below it.
//   2. Vehicle Configuration (only when vehicleConfigData) — a Car-headed grid of
//      18 MetricCards (model, trim, colours, firmware, software-update progress,
//      Europe/RHD/remote-start/offroad-lightbar booleans, …).
//   3. Car Display Preferences (only when userPrefData) — a Settings-headed grid
//      of 5 MetricCards derived through parseSettingEnum + a 24h-time boolean.
//   4. Speed History — an Activity-headed Recharts AreaChart of the per-position
//      speed (SI m/s -> the user's km/h or mph) over time, or a placeholder.
//
// Platform dependency swaps (no DOM, lucide, Recharts, Leaflet, framer-motion, or
// web UI per the conversion contract; each documented in the parity sidecar):
//   * react-i18next `useTranslation()` -> `useNativeTranslationFallback()` which
//     returns the English fallback while preserving every i18n key intent.
//   * `@/hooks/useUnits` `useUnits().unitPrefs.speed` + `@/lib/unitConversion`
//     `convertSpeedFromSI` + `@/lib/numberFormat` `fmtNumber` -> `useNativeUnits()`
//     over the ported `useSettings()`: it derives `speedUnit` ('mph' when
//     `unit_of_length === 'mi'`, else 'km/h'), an inline value-identical
//     `convertSpeedFromSI` (mps*3600/1000 for km/h, mps*3600/1609.344 for mph,
//     and `speed_mph` is read as SI m/s exactly as the web does), and `fmtNumber`
//     over the settings locale + global precision (default 2, clamped 0..20).
//   * `@/lib/dateFormat` `formatTime` -> an inline value-identical formatter
//     (browser-locale `toLocaleTimeString` with 2-digit hour/minute, '—' guard).
//   * `@/lib/cleanNil` `cleanNil` + `@/lib/parseSettingEnum` `parseSettingEnum`
//     -> inline value-identical ports (same Go-nil filter, same 4-category map).
//   * lucide `Navigation`/`Car`/`Settings`/`Activity` -> the repo SemanticIcon
//     glyphs ('navigation'/'vehicle'/'settings'/'activity') rendered as tinted
//     AppText (cyan-300 / neon-purple / neon-amber / neon-cyan); the native app
//     ships no lucide/SVG renderer.
//   * `@/components/charts` Recharts `AreaChart`/`Area`/`XAxis`/`YAxis`/
//     `CartesianGrid`/`Tooltip`/`ResponsiveContainer`/`ChartTooltip` +
//     `AREA_DEFAULTS`/`areaGradient` -> the already-ported native-safe
//     `AreaChartWrapper` (web-parity/components/charts), which renders the same
//     time/speed series as a React Native area plot with a latest-value legend
//     (hover tooltips are a browser pointer interaction and are unavailable).
//   * `@/components/maps` Leaflet `MapContainer`/`MapTileLayer`/`MapInvalidator`/
//     `Marker`/`Polyline`/`vehicleIcon`/`MapLayerSwitcher` (none of which render
//     in React Native) -> a self-contained native LocationMap: a bordered map
//     canvas tinted per the selected MapStyle, gridlines, a native chip
//     MapStyle switcher (preserving the `mapStyle`/`setMapStyle` state), the trail
//     projected through the repo's tested `getRouteBounds`/`projectRoutePoints`/
//     `getRouteSegments` geometry (cyan dashed segments == the Polyline) and a
//     cyan current-position marker (== the vehicleIcon Marker), with the same
//     formatted lat/long footer.
//   * `@/components/ui` `GlassPanel` -> native GlassPanel (style, not className).
//   * `@/components/data-display` `MetricCard` (label/value only at these call
//     sites) -> an inline value-identical MetricCard (rounded card, truncating
//     metric-label eyebrow, text-xl bold value).
//   * framer-motion `<FadeIn delay>` -> a static final-state wrapper (matching the
//     web reduced-motion branch); RN has no shared framer-motion runtime.
//   * DOM div/grid + Tailwind/CSS-vars -> RN View/AppText/tokens; the web
//     `grid-cols-2 sm:grid-cols-3 (lg:grid-cols-5)` responsive grids collapse to a
//     mobile-first two-column wrapping row (RN has no CSS grid / media queries).

import React, {
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  View,
  type DimensionValue,
  type LayoutChangeEvent,
} from 'react-native';

import {getSemanticIconDefinition} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {
  getRouteBounds,
  getRouteSegments,
  projectRoutePoints,
  sampleRoutePoints,
  type ProjectedRoutePoint,
  type RoutePoint,
} from '../../../../components/maps/MapRouteSummary';
import {colors} from '../../../../theme/tokens';
import {AreaChartWrapper} from '../../../components/charts';
import {useSettings} from '../../../api/hooks/useSettings';
import type {
  Position,
  UserPreferenceSnapshot,
  VehicleConfigSnapshot,
  VehicleState,
} from '../../../api/types';

// lucide heading-icon tints (web Tailwind / neon CSS vars).
const CYAN_300 = '#67e8f9'; // text-cyan-300 (Navigation heading)
const NEON_PURPLE = '#a855f7'; // --neon-purple (Car heading)
const NEON_AMBER = '#f59e0b'; // --neon-amber (Settings heading)
const NEON_CYAN = '#00f0ff'; // --neon-cyan (Activity heading + map marker/trail)

// NIST factors mirrored from web @/lib/unitConversion (SI -> display unit).
const METERS_PER_KM = 1000;
const METERS_PER_MILE = 1609.344;
const SECONDS_PER_HOUR = 3600;

// numberFormat module defaults: global precision starts at 2 (clamped 0..20) and
// the global locale falls back to en-US.
const DEFAULT_GLOBAL_PRECISION = 2;
const DEFAULT_LOCALE = 'en-US';

// Universal placeholder shared by the web formatters / metric fallbacks.
const EM_DASH = '—';

// lucide -> repo SemanticIcon glyphs (resolved once; no SVG renderer on native).
const NAVIGATION_GLYPH = getSemanticIconDefinition('navigation').glyph;
const VEHICLE_GLYPH = getSemanticIconDefinition('vehicle').glyph;
const SETTINGS_GLYPH = getSemanticIconDefinition('settings').glyph;
const ACTIVITY_GLYPH = getSemanticIconDefinition('activity').glyph;

// Tile style options offered by the web MapTileLayer / MapLayerSwitcher.
type MapStyle = 'dark' | 'satellite' | 'streets' | 'terrain';

const MAP_STYLE_OPTIONS: ReadonlyArray<{value: MapStyle; label: string}> = [
  {value: 'dark', label: 'Dark'},
  {value: 'satellite', label: 'Satellite'},
  {value: 'streets', label: 'Streets'},
  {value: 'terrain', label: 'Terrain'},
];

// Per-style canvas backdrop tints — the only native feedback the switcher can
// produce since there are no real map tiles to swap.
const MAP_STYLE_BACKDROP: Record<MapStyle, string> = {
  dark: 'rgba(8, 14, 26, 0.92)',
  satellite: 'rgba(10, 22, 20, 0.92)',
  streets: 'rgba(18, 20, 28, 0.92)',
  terrain: 'rgba(12, 24, 16, 0.92)',
};

// CartesianGrid-style backdrop gridline positions (percent) for the map canvas.
const MAP_GRID_LINES = [25, 50, 75];

const MONO_FONT = Platform.select({ios: 'Courier', default: 'monospace'});

type NativeTFunction = (key: string, fallback: string) => string;

// react-i18next swap: no i18n runtime is wired on native, so this returns the
// English fallback while preserving the i18n key intent.
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

// Value-identical inline of web @/lib/cleanNil: strips Go's literal nil strings.
function cleanNil(v?: string | null): string | undefined {
  if (!v || v === '<nil>' || v === 'nil' || v === 'null') {
    return undefined;
  }
  return v;
}

// Value-identical inline of web @/lib/unitConversion `convertSpeedFromSI`.
function convertSpeedFromSI(mps: number, to: 'km/h' | 'mph'): number {
  switch (to) {
    case 'km/h':
      return (mps * SECONDS_PER_HOUR) / METERS_PER_KM;
    case 'mph':
      return (mps * SECONDS_PER_HOUR) / METERS_PER_MILE;
  }
}

// Value-identical inline of web @/lib/dateFormat `formatTime`: 2-digit hour/minute
// in the host locale + timezone (the web call passes no options), '—' for
// nullish / unparseable input.
function formatTime(iso: string | null | undefined): string {
  if (!iso) {
    return EM_DASH;
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return EM_DASH;
  }
  return d.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
}

// Enum-display maps mirrored verbatim from web @/lib/parseSettingEnum.
const ENUM_MAPPINGS: Record<string, Record<string, string>> = {
  distance: {
    distanceunitmiles: 'Miles',
    distanceunitkilometers: 'Kilometers',
    distanceunitkm: 'Kilometers',
    miles: 'Miles',
    mi: 'Miles',
    km: 'Kilometers',
    kilometers: 'Kilometers',
  },
  temperature: {
    temperatureunitcelsius: 'Celsius',
    temperatureunitfahrenheit: 'Fahrenheit',
    celsius: 'Celsius',
    fahrenheit: 'Fahrenheit',
    c: 'Celsius',
    f: 'Fahrenheit',
  },
  charge: {
    chargeunitpercent: 'Percent',
    chargeunitmiles: 'Miles',
    chargeunitkilometers: 'Kilometers',
    percent: 'Percent',
    mi: 'Miles',
    km: 'Kilometers',
  },
  pressure: {
    pressureunitpsi: 'PSI',
    pressureunitbar: 'Bar',
    pressureunitkpa: 'kPa',
    psi: 'PSI',
    bar: 'Bar',
    kpa: 'kPa',
  },
};

// Value-identical inline of web @/lib/parseSettingEnum `parseSettingEnum`.
function parseSettingEnum(
  value: string | undefined | null,
  category: keyof typeof ENUM_MAPPINGS,
): string {
  if (!value) {
    return EM_DASH;
  }
  const lower = value.toLowerCase().replace(/[^a-z]/g, '');
  return ENUM_MAPPINGS[category]?.[lower] ?? value;
}

// Mirror of web @/lib/numberFormat `safeNumber`.
function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function formatWithDigits(value: number, locale: string, digits: number): string {
  const opts: Intl.NumberFormatOptions = {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  };
  try {
    return value.toLocaleString(locale, opts);
  } catch {
    return value.toLocaleString(DEFAULT_LOCALE, opts);
  }
}

function deriveLocale(locale: string | undefined): string {
  return typeof locale === 'string' && locale.trim().length > 0
    ? locale
    : DEFAULT_LOCALE;
}

// Mirror of numberFormat.setGlobalPrecision: Math.max(0, Math.min(20, decimals)),
// with the module default of 2 when settings carry no usable decimal_precision.
function deriveGlobalPrecision(decimalPrecision: number | undefined): number {
  const decimals =
    typeof decimalPrecision === 'number' && Number.isFinite(decimalPrecision)
      ? decimalPrecision
      : DEFAULT_GLOBAL_PRECISION;
  return Math.max(0, Math.min(20, decimals));
}

// Native mirror of the web's `useUnits().unitPrefs.speed` + lib
// `convertSpeedFromSI` + numberFormat `fmtNumber`, all derived from the ported
// `useSettings()`.
function useNativeUnits(): {
  speedUnit: 'km/h' | 'mph';
  toSpeedDisplay: (value: number) => number;
  fmtNumber: (value: unknown) => string;
} {
  const {data: settings} = useSettings();
  return useMemo(() => {
    const speedUnit: 'km/h' | 'mph' =
      settings?.unit_of_length === 'mi' ? 'mph' : 'km/h';
    const locale = deriveLocale(settings?.locale);
    const precision = deriveGlobalPrecision(settings?.decimal_precision);

    const toSpeedDisplay = (value: number): number =>
      convertSpeedFromSI(value, speedUnit);

    const fmtNumber = (value: unknown): string =>
      formatWithDigits(safeNumber(value), locale, precision);

    return {speedUnit, toSpeedDisplay, fmtNumber};
  }, [settings]);
}

// framer-motion `<FadeIn delay>` -> a static final-state wrapper (equivalent to
// the web prefers-reduced-motion branch). `delay` is accepted for prop parity but
// has no native animation runtime to drive.
function FadeIn({children}: {children: ReactNode; delay?: number}) {
  return <View style={styles.section}>{children}</View>;
}

// Inlined @/components/data-display <MetricCard> for the label/value-only call
// sites used here: a rounded card with a truncating metric-label eyebrow and a
// wrapping text-xl bold value.
function MetricCard({label, value}: {label: string; value: string}) {
  return (
    <View style={styles.metricCard}>
      <AppText numberOfLines={1} style={styles.metricLabel} tone="muted">
        {label}
      </AppText>
      <AppText style={styles.metricValue} weight="bold">
        {value}
      </AppText>
    </View>
  );
}

// Native MapStyle switcher (replaces the web MapLayerSwitcher overlay). Preserves
// the `current`/`onChange` contract; selecting a style updates the canvas tint.
function MapStyleSwitcher({
  current,
  onChange,
}: {
  current: MapStyle;
  onChange: (style: MapStyle) => void;
}) {
  return (
    <View style={styles.switcher}>
      {MAP_STYLE_OPTIONS.map(option => {
        const active = option.value === current;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{selected: active}}
            onPress={() => onChange(option.value)}
            style={[styles.switcherChip, active && styles.switcherChipActive]}>
            <AppText
              style={[
                styles.switcherChipText,
                active && styles.switcherChipTextActive,
              ]}>
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

interface LocationMapProps {
  state: VehicleState;
  positions: Position[] | undefined;
  fmtNumber: (value: unknown) => string;
  t: NativeTFunction;
}

// The web "Live Map" GlassPanel. Renders a native map canvas (tinted per the
// selected MapStyle) with the trail polyline + current-position marker projected
// through the repo's tested route geometry helpers, plus the lat/long footer.
function LocationMap({state, positions, fmtNumber, t}: LocationMapProps) {
  const [mapStyle, setMapStyle] = useState<MapStyle>('dark');
  const [canvasSize, setCanvasSize] = useState({width: 0, height: 0});

  // Web: positions?.filter(p => p.latitude && p.longitude).map(p => [lat, lng]).
  const trail = useMemo<RoutePoint[]>(
    () =>
      (positions ?? [])
        .filter(p => p.latitude && p.longitude)
        .map(p => ({latitude: p.latitude, longitude: p.longitude})),
    [positions],
  );

  const bounds = useMemo(
    () =>
      getRouteBounds([
        {latitude: state.latitude, longitude: state.longitude},
        ...trail,
      ]),
    [state.latitude, state.longitude, trail],
  );

  const sampledTrail = useMemo(() => sampleRoutePoints(trail, 48), [trail]);
  const projectedTrail = useMemo<ProjectedRoutePoint[]>(
    () => (bounds ? projectRoutePoints(sampledTrail, bounds) : []),
    [bounds, sampledTrail],
  );
  const currentMarker = useMemo<ProjectedRoutePoint | undefined>(
    () =>
      bounds
        ? projectRoutePoints(
            [{latitude: state.latitude, longitude: state.longitude}],
            bounds,
          )[0]
        : undefined,
    [bounds, state.latitude, state.longitude],
  );
  const segments = useMemo(
    () => getRouteSegments(projectedTrail, canvasSize.width, canvasSize.height),
    [projectedTrail, canvasSize.width, canvasSize.height],
  );

  const handlePlotLayout = useCallback((event: LayoutChangeEvent) => {
    const {width, height} = event.nativeEvent.layout;
    setCanvasSize(previous =>
      previous.width === width && previous.height === height
        ? previous
        : {width, height},
    );
  }, []);

  return (
    <FadeIn delay={0.15}>
      <GlassPanel style={styles.mapPanel}>
        <View style={styles.mapHeader}>
          <View style={styles.titleRow}>
            <AppText style={[styles.titleIcon, {color: CYAN_300}]} weight="bold">
              {NAVIGATION_GLYPH}
            </AppText>
            <AppText style={styles.title} weight="semibold">
              {t('common.location', 'Location')}
            </AppText>
          </View>
        </View>
        <View
          style={[
            styles.mapCanvas,
            {backgroundColor: MAP_STYLE_BACKDROP[mapStyle]},
          ]}>
          <View pointerEvents="none" style={styles.mapGridLayer}>
            {MAP_GRID_LINES.map(line => (
              <React.Fragment key={line}>
                <View
                  style={[
                    styles.mapGridLineVertical,
                    {left: `${line}%` as DimensionValue},
                  ]}
                />
                <View
                  style={[
                    styles.mapGridLineHorizontal,
                    {top: `${line}%` as DimensionValue},
                  ]}
                />
              </React.Fragment>
            ))}
          </View>
          <MapStyleSwitcher current={mapStyle} onChange={setMapStyle} />
          <View
            accessible
            accessibilityRole="image"
            accessibilityLabel={`${t('common.location', 'Location')} ${fmtNumber(
              state.latitude,
            )}, ${fmtNumber(state.longitude)}`}
            onLayout={handlePlotLayout}
            pointerEvents="none"
            style={styles.mapPlot}>
            {trail.length > 1
              ? segments.map(segment => (
                  <View
                    key={segment.id}
                    style={[
                      styles.trailSegment,
                      {
                        left: segment.left,
                        top: segment.top,
                        width: segment.width,
                        transform: [{rotate: `${segment.angleRad}rad`}],
                      },
                    ]}
                  />
                ))
              : null}
            {currentMarker ? (
              <View
                style={[
                  styles.marker,
                  {
                    left: `${currentMarker.x * 100}%` as DimensionValue,
                    top: `${currentMarker.y * 100}%` as DimensionValue,
                  },
                ]}>
                <View style={styles.markerDot} />
              </View>
            ) : null}
          </View>
        </View>
        <View style={styles.mapFooter}>
          <AppText style={styles.coordinates} tone="muted">
            {`${fmtNumber(state.latitude)}, ${fmtNumber(state.longitude)}`}
          </AppText>
        </View>
      </GlassPanel>
    </FadeIn>
  );
}

interface VehicleChartsProps {
  state: VehicleState;
  positions: Position[] | undefined;
  vehicleConfigData: VehicleConfigSnapshot | null | undefined;
  userPrefData: UserPreferenceSnapshot | null | undefined;
}

export function VehicleCharts({
  state,
  positions,
  vehicleConfigData,
  userPrefData,
}: VehicleChartsProps) {
  const t = useNativeTranslationFallback();
  const {speedUnit, toSpeedDisplay, fmtNumber} = useNativeUnits();

  // Web batteryData: positions.map(p => ({ time, speed })).reverse().
  const batteryData = useMemo<Array<{time: string; speed: number | null}>>(
    () =>
      (positions ?? [])
        .map(p => ({
          time: formatTime(p.ts),
          speed: p.speed_mph != null ? toSpeedDisplay(p.speed_mph) : null,
        }))
        .reverse(),
    [positions, toSpeedDisplay],
  );

  const configItems: Array<{label: string; value: string | undefined}> =
    vehicleConfigData
      ? [
          {label: 'Model', value: cleanNil(vehicleConfigData.car_type)},
          {label: 'Trim', value: cleanNil(vehicleConfigData.trim)},
          {label: 'Color', value: cleanNil(vehicleConfigData.exterior_color)},
          {label: 'Roof', value: cleanNil(vehicleConfigData.roof_color)},
          {label: 'Wheels', value: cleanNil(vehicleConfigData.wheel_type)},
          {label: 'Firmware', value: cleanNil(vehicleConfigData.version)},
          {label: 'Name', value: cleanNil(vehicleConfigData.vehicle_name)},
          {label: 'Charge Port', value: cleanNil(vehicleConfigData.charge_port)},
          {
            label: 'Rear Heaters',
            value: cleanNil(vehicleConfigData.rear_seat_heaters),
          },
          {
            label: 'Efficiency',
            value: cleanNil(vehicleConfigData.efficiency_package),
          },
          {
            label: 'Sunroof',
            value: cleanNil(vehicleConfigData.sunroof_installed) || 'Not Installed',
          },
          {
            label: t('vehicles.detail.europeVehicle', 'Europe Vehicle'),
            value:
              vehicleConfigData.europe_vehicle != null
                ? vehicleConfigData.europe_vehicle
                  ? t('common.yes', 'Yes')
                  : t('common.no', 'No')
                : EM_DASH,
          },
          {
            label: t('vehicles.detail.rhd', 'Right-Hand Drive'),
            value:
              vehicleConfigData.right_hand_drive != null
                ? vehicleConfigData.right_hand_drive
                  ? t('common.yes', 'Yes')
                  : t('common.no', 'No')
                : EM_DASH,
          },
          {
            label: 'Remote Start',
            value:
              vehicleConfigData.remote_start_enabled != null
                ? vehicleConfigData.remote_start_enabled
                  ? 'Active'
                  : 'Off'
                : EM_DASH,
          },
          {
            label: 'Offroad Lightbar',
            value:
              vehicleConfigData.offroad_lightbar_present != null
                ? vehicleConfigData.offroad_lightbar_present
                  ? 'Present'
                  : 'No'
                : EM_DASH,
          },
          {
            label: 'SW Update',
            value: cleanNil(vehicleConfigData.software_update_version) || 'None',
          },
          {
            label: 'SW Download',
            value:
              vehicleConfigData.software_update_download_pct != null
                ? `${vehicleConfigData.software_update_download_pct}%`
                : EM_DASH,
          },
          {
            label: 'SW Install',
            value:
              vehicleConfigData.software_update_install_pct != null
                ? `${vehicleConfigData.software_update_install_pct}%`
                : EM_DASH,
          },
        ]
      : [];

  const prefItems: Array<{label: string; value: string}> = userPrefData
    ? [
        {
          label: 'Distance',
          value: parseSettingEnum(userPrefData.setting_distance_unit, 'distance'),
        },
        {
          label: 'Temperature',
          value: parseSettingEnum(
            userPrefData.setting_temperature_unit,
            'temperature',
          ),
        },
        {
          label: 'Charge Unit',
          value: parseSettingEnum(userPrefData.setting_charge_unit, 'charge'),
        },
        {
          label: 'Tire Pressure',
          value: parseSettingEnum(
            userPrefData.setting_tire_pressure_unit,
            'pressure',
          ),
        },
        {
          label: '24h Time',
          value:
            userPrefData.setting_24hr_time != null
              ? userPrefData.setting_24hr_time
                ? 'Yes'
                : 'No'
              : EM_DASH,
        },
      ]
    : [];

  return (
    <View style={styles.grid}>
      {/* Live Map */}
      {state.latitude && state.longitude ? (
        <LocationMap
          state={state}
          positions={positions}
          fmtNumber={fmtNumber}
          t={t}
        />
      ) : null}

      {/* Vehicle Configuration */}
      {vehicleConfigData ? (
        <FadeIn delay={0.18}>
          <GlassPanel style={styles.panel}>
            <View style={styles.titleRow}>
              <AppText
                style={[styles.titleIcon, {color: NEON_PURPLE}]}
                weight="bold">
                {VEHICLE_GLYPH}
              </AppText>
              <AppText style={styles.title} weight="semibold">
                {t('common.vehicleConfig', 'Vehicle Configuration')}
              </AppText>
            </View>
            <View style={styles.metricGrid}>
              {configItems.map(item => (
                <MetricCard
                  key={item.label}
                  label={item.label}
                  value={item.value || EM_DASH}
                />
              ))}
            </View>
          </GlassPanel>
        </FadeIn>
      ) : null}

      {/* User Preferences */}
      {userPrefData ? (
        <FadeIn delay={0.19}>
          <GlassPanel style={styles.panel}>
            <View style={styles.titleRow}>
              <AppText
                style={[styles.titleIcon, {color: NEON_AMBER}]}
                weight="bold">
                {SETTINGS_GLYPH}
              </AppText>
              <AppText style={styles.title} weight="semibold">
                {t('common.carPreferences', 'Car Display Preferences')}
              </AppText>
            </View>
            <AppText style={styles.prefHelp} tone="muted">
              These are your vehicle's display settings — you can sync your app to
              match them from the Settings page.
            </AppText>
            <View style={styles.metricGrid}>
              {prefItems.map(item => (
                <MetricCard
                  key={item.label}
                  label={item.label}
                  value={item.value || EM_DASH}
                />
              ))}
            </View>
          </GlassPanel>
        </FadeIn>
      ) : null}

      {/* Battery & Speed chart */}
      <FadeIn delay={0.2}>
        <GlassPanel style={styles.panel}>
          <View style={styles.titleRow}>
            <AppText style={[styles.titleIcon, {color: NEON_CYAN}]} weight="bold">
              {ACTIVITY_GLYPH}
            </AppText>
            <AppText style={styles.title} weight="semibold">
              {t('common.speedHistory', 'Speed History')}
            </AppText>
          </View>
          {batteryData.length > 0 ? (
            <View style={styles.chartWrap}>
              <AreaChartWrapper
                data={batteryData}
                xKey="time"
                series={[
                  {key: 'speed', label: `Speed ${speedUnit}`, color: NEON_CYAN},
                ]}
                height={256}
              />
            </View>
          ) : (
            <View style={styles.chartEmpty}>
              <AppText style={styles.chartEmptyText} tone="muted">
                {t('common.positionDataWillAppear', 'Position data will appear here')}
              </AppText>
            </View>
          )}
        </GlassPanel>
      </FadeIn>
    </View>
  );
}

VehicleCharts.displayName = 'VehicleCharts';

const styles = StyleSheet.create({
  // grid grid-cols-1 gap-6 lg:grid-cols-2 -> mobile-first single column stack.
  grid: {
    gap: 24,
  },
  // FadeIn wrapper — fills the column.
  section: {
    alignSelf: 'stretch',
  },
  // GlassPanel p-5 / p-6 (config, prefs, chart cards).
  panel: {
    padding: 20,
  },
  // GlassPanel overflow-hidden h-full (map card; header/canvas/footer manage pad).
  mapPanel: {
    overflow: 'hidden',
  },
  // h3 .section-title flex items-center gap-2 (+ mb-3/mb-4 via section spacing).
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  // lucide h-4 w-4 heading glyph (colour applied inline per section).
  titleIcon: {
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0.4,
  },
  // .section-title == text-lg font-semibold tracking-tight, text-primary.
  title: {
    fontSize: 18,
    lineHeight: 28,
    letterSpacing: -0.4,
  },
  // p-4 pb-0 map header wrapper.
  mapHeader: {
    padding: 16,
    paddingBottom: 0,
  },
  // h-72 relative map viewport.
  mapCanvas: {
    height: 288,
    position: 'relative',
    overflow: 'hidden',
  },
  // CartesianGrid-style backdrop gridlines.
  mapGridLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  mapGridLineVertical: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: colors.border,
    opacity: 0.6,
  },
  mapGridLineHorizontal: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: colors.border,
    opacity: 0.6,
  },
  // MapLayerSwitcher overlay (web absolute control) — top-right chip row.
  switcher: {
    position: 'absolute',
    top: 8,
    right: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 4,
    maxWidth: 220,
  },
  switcherChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  switcherChipActive: {
    borderColor: 'rgba(0, 240, 255, 0.45)',
    backgroundColor: 'rgba(0, 240, 255, 0.14)',
  },
  switcherChipText: {
    fontSize: 10,
    lineHeight: 14,
    color: colors.textSecondary,
  },
  switcherChipTextActive: {
    color: NEON_CYAN,
  },
  // The inset projection plane shared by the trail segments + current marker.
  mapPlot: {
    position: 'absolute',
    top: 28,
    right: 28,
    bottom: 28,
    left: 28,
  },
  // Polyline { color: '#00f0ff', weight: 3, opacity: 0.6 } -> cyan segment.
  trailSegment: {
    position: 'absolute',
    height: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(0, 240, 255, 0.6)',
  },
  // vehicleIcon() Marker — positioned by percentage within the plot.
  marker: {
    position: 'absolute',
    width: 18,
    height: 18,
    marginLeft: -9,
    marginTop: -9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: colors.background,
    backgroundColor: NEON_CYAN,
  },
  // p-3 text-center coordinates footer.
  mapFooter: {
    padding: 12,
    alignItems: 'center',
  },
  // text-[10px] text-[var(--text-muted)] font-mono.
  coordinates: {
    fontSize: 10,
    lineHeight: 14,
    fontFamily: MONO_FONT,
  },
  // grid grid-cols-2 sm:grid-cols-3 (lg:grid-cols-5) gap-3 -> wrapping 2-col row.
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  // p-3 rounded-xl bg-white/[0.02] border border-white/[0.04].
  metricCard: {
    flexGrow: 1,
    flexBasis: '46%',
    minWidth: 120,
    padding: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
  },
  // metric-label (text-2xs font-medium uppercase tracking-wider) mb-1 + truncate.
  metricLabel: {
    marginBottom: 4,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  // text-xl font-bold tracking-tight text-[var(--text-primary)].
  metricValue: {
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.4,
  },
  // Prefs helper copy: text-[10px] text-[var(--text-muted)] mb-3.
  prefHelp: {
    fontSize: 10,
    lineHeight: 15,
    marginBottom: 12,
  },
  // h-64 chart container.
  chartWrap: {
    minHeight: 256,
  },
  // h-64 flex items-center justify-center empty state.
  chartEmpty: {
    height: 256,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // text-xs text-[var(--text-muted)] empty copy.
  chartEmptyText: {
    fontSize: 12,
    lineHeight: 16,
  },
});
