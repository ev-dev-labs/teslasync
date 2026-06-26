// Native parity port of
// web/src/features/vehicles/components/telemetry-panels/TelemetryGrid.tsx.
//
// The web component renders a responsive `StaggerContainer` grid
// (`grid-cols-2 sm:3 lg:4 xl:6 gap-3`) of six `InfoTile`s summarising the live
// `VehicleState`: Battery (% + colour band + rated-range sub), Speed
// (+ Driving/Parked sub), Inside temp (+ Outside sub), Odometer, Charger
// (charging kW / "Not charging" + "Full in Nh" sub) and Sentry. It is reproduced
// here with React Native primitives, preserving the `TelemetryGridProps`
// (`state: VehicleState`), every tile's value/colour/sub logic, the
// `battery_level > 50 / > 20` colour bands, and every `t()` key + English copy.
//
// Native-safe substitutions (documented in the parity sidecar):
//   - react-i18next `useTranslation` -> `useNativeTranslation()` shim returning
//     the fallback copy verbatim (common.battery/range/speed/inside/outside/
//     odometer/charger/sentry).
//   - lucide-react `Battery, Gauge, Thermometer, Navigation, BatteryCharging,
//     Eye` -> decorative Unicode `Glyph`s (importantForAccessibility="no"), the
//     dominant native-parity icon convention; the web h-3.5 (14px) muted icons
//     become 14px muted glyphs.
//   - `@/components/motion` `StaggerContainer`/`StaggerItem` (framer-motion,
//     browser-only) -> an inline responsive native `Grid` (onLayout width ->
//     Tailwind breakpoint column count, default 2 / sm 3 / lg 4 / xl 6, gap-3 ->
//     12px). The framer entrance stagger has no native-core analog; tiles render
//     statically (visual intent — the 6-up responsive grid — preserved).
//   - `@/hooks/useUnits` + `@/lib/unitConversion` -> inlined native `useUnits`
//     formatters mirroring the web out-of-box metric defaults (km / km/h / °C;
//     DEFAULT_PRECISION distance 1, speed 0, temperature 1; en-US; '—' empty).
//   - `@/lib/numberFormat` `fmtInt`/`fmtNumber` -> inlined native-safe
//     formatters (locale toLocaleString; precision-2 / en-US defaults).
//   - `./InfoTile` -> the native parity InfoTile sibling.

import React, {
  Children,
  isValidElement,
  useState,
  type ReactNode,
} from 'react';
import {
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {colors} from '../../../../../theme/tokens';
import type {VehicleState} from '../../../../api/types';
import {InfoTile} from './InfoTile';

/* ─── inline shims ─────────────────────────────────────────────────────────── */

// react-i18next useTranslation(): t(key, fallback) returns the fallback copy.
function useNativeTranslation(): (key: string, fallback: string) => string {
  return (_key, fallback) => fallback;
}

// Decorative lucide-react stand-ins (hidden from screen readers like the web
// SVGs, which carry no aria-label).
const ICON_BATTERY = '\u{1F50B}'; // lucide Battery
const ICON_GAUGE = '\u{1F4A8}'; // lucide Gauge (speed)
const ICON_THERMOMETER = '\u{1F321}'; // lucide Thermometer
const ICON_NAVIGATION = '\u{1F9ED}'; // lucide Navigation (compass)
const ICON_BATTERY_CHARGING = '\u26A1'; // lucide BatteryCharging
const ICON_EYE = '\u{1F441}'; // lucide Eye (Sentry)

// Tailwind colour bands used by the web battery/charger/sentry tiles.
const EMERALD_300 = '#6ee7b7';
const AMBER_300 = '#fcd34d';
const ROSE_300 = '#fda4af';

function Glyph({glyph, style}: {glyph: string; style?: StyleProp<TextStyle>}) {
  return (
    <AppText allowFontScaling={false} importantForAccessibility="no" style={style}>
      {glyph}
    </AppText>
  );
}

/* ─── native unit + number formatters (web useUnits + numberFormat) ──────────── */

const EM_DASH = '\u2014';

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function isFiniteNumber(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function fmtNumber(v: unknown, decimals = 2, locale = 'en-US'): string {
  try {
    return safeNumber(v).toLocaleString(locale, {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(v).toLocaleString('en-US', {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  }
}

function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

interface FormatOptions {
  precision?: number;
}

function resolvePrecision(override: number | undefined, fallback: number): number {
  return typeof override === 'number' && Number.isFinite(override) && override >= 0
    ? Math.floor(override)
    : fallback;
}

function formatDistance(
  meters: number | null | undefined,
  options?: FormatOptions,
): string {
  if (!isFiniteNumber(meters)) {
    return EM_DASH;
  }
  return `${fmtNumber(meters / 1000, resolvePrecision(options?.precision, 1))} km`;
}

function formatSpeed(mps: number | null | undefined, options?: FormatOptions): string {
  if (!isFiniteNumber(mps)) {
    return EM_DASH;
  }
  return `${fmtNumber((mps * 3600) / 1000, resolvePrecision(options?.precision, 0))} km/h`;
}

function formatTemperature(
  celsius: number | null | undefined,
  options?: FormatOptions,
): string {
  if (!isFiniteNumber(celsius)) {
    return EM_DASH;
  }
  return `${fmtNumber(celsius, resolvePrecision(options?.precision, 1))}\u00B0C`;
}

/* ─── native Grid (web `@/components/motion` StaggerContainer) ───────────────── */

interface GridCols {
  default?: number;
  sm?: number;
  lg?: number;
  xl?: number;
}

const SM_BREAKPOINT = 640;
const LG_BREAKPOINT = 1024;
const XL_BREAKPOINT = 1280;
const TAILWIND_GAP_PX = 4;

function resolveColumns(cols: GridCols, width: number): number {
  let columns = cols.default ?? 1;
  if (cols.sm != null && width >= SM_BREAKPOINT) {
    columns = cols.sm;
  }
  if (cols.lg != null && width >= LG_BREAKPOINT) {
    columns = cols.lg;
  }
  if (cols.xl != null && width >= XL_BREAKPOINT) {
    columns = cols.xl;
  }
  return Math.max(1, columns);
}

function Grid({
  cols,
  gap,
  children,
}: {
  cols: GridCols;
  gap: number;
  children: ReactNode;
}) {
  const [containerWidth, setContainerWidth] = useState(0);
  const gapPx = gap * TAILWIND_GAP_PX;
  const columns = resolveColumns(cols, containerWidth);
  const cells = Children.toArray(children);
  const cellWidth =
    containerWidth > 0
      ? Math.floor((containerWidth - gapPx * (columns - 1)) / columns)
      : null;

  const onLayout = (event: LayoutChangeEvent) => {
    const next = event.nativeEvent.layout.width;
    setContainerWidth(prev => (Math.abs(prev - next) > 0.5 ? next : prev));
  };

  return (
    <View onLayout={onLayout} style={[styles.grid, {gap: gapPx}]}>
      {cells.map((child, index) => {
        const key =
          isValidElement(child) && child.key != null ? child.key : `cell-${index}`;
        return (
          <View key={key} style={cellWidth != null ? {width: cellWidth} : styles.cellFull}>
            {child}
          </View>
        );
      })}
    </View>
  );
}

/* ─── component ─────────────────────────────────────────────────────────────── */

interface TelemetryGridProps {
  state: VehicleState;
}

export function TelemetryGrid({state}: TelemetryGridProps) {
  const t = useNativeTranslation();

  const batteryColor =
    state.battery_level > 50 ? EMERALD_300 : state.battery_level > 20 ? AMBER_300 : ROSE_300;

  const chargerSub =
    state.is_charging && state.time_to_full_charge != null
      ? `Full in ${fmtNumber(state.time_to_full_charge)}h`
      : undefined;

  return (
    <Grid cols={{default: 2, sm: 3, lg: 4, xl: 6}} gap={3}>
      <InfoTile
        color={batteryColor}
        icon={<Glyph glyph={ICON_BATTERY} style={styles.icon} />}
        label={t('common.battery', 'Battery')}
        sub={`${formatDistance(state.rated_range)} ${t('common.range', 'range')}`}
        value={`${fmtInt(state.battery_level)}%`}
      />
      <InfoTile
        icon={<Glyph glyph={ICON_GAUGE} style={styles.icon} />}
        label={t('common.speed', 'Speed')}
        sub={state.speed > 0 ? 'Driving' : 'Parked'}
        value={formatSpeed(state.speed)}
      />
      <InfoTile
        icon={<Glyph glyph={ICON_THERMOMETER} style={styles.icon} />}
        label={t('common.inside', 'Inside')}
        sub={`${t('common.outside', 'Outside')}: ${formatTemperature(state.outside_temp)}`}
        value={formatTemperature(state.inside_temp)}
      />
      <InfoTile
        icon={<Glyph glyph={ICON_NAVIGATION} style={styles.icon} />}
        label={t('common.odometer', 'Odometer')}
        value={formatDistance(state.odometer, {precision: 0})}
      />
      <InfoTile
        color={state.is_charging ? EMERALD_300 : colors.textMuted}
        icon={<Glyph glyph={ICON_BATTERY_CHARGING} style={styles.icon} />}
        label={t('common.charger', 'Charger')}
        sub={chargerSub}
        value={state.is_charging ? `${fmtInt(state.charger_power)} kW` : 'Not charging'}
      />
      <InfoTile
        color={state.sentry_mode ? ROSE_300 : colors.textMuted}
        icon={<Glyph glyph={ICON_EYE} style={styles.icon} />}
        label={t('common.sentry', 'Sentry')}
        value={state.sentry_mode ? 'Active' : 'Off'}
      />
    </Grid>
  );
}

TelemetryGrid.displayName = 'TelemetryGrid';

const styles = StyleSheet.create({
  cellFull: {
    width: '100%',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  icon: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 18,
  },
});
