// Native parity port of
// web/src/features/driving/components/drivetrain-health/DetailCards.tsx.
//
// `DetailCards` is the lower detail row of the Drivetrain Health page. It renders
// two side-by-side cards inside a responsive grid:
//   1. "Temperature Details" — a key/value list of the four drivetrain
//      temperatures (front motor, rear motor, inverter, battery), each formatted
//      through the unit display boundary or shown as "—" when null.
//   2. "Power Summary" — a key/value list of peak power, average peak power, max
//      regen, total regen energy, and CO₂ saved. Each value mirrors the web
//      guards verbatim (`peakPower > 0`, `avgPowerMax > 0`, `minRegenPower < 0`,
//      `stats ? … : '—'`).
// Every prop name (`health`, `peakPower`, `avgPowerMax`, `minRegenPower`,
// `stats`), the i18n keys + English fallbacks, the unit strings ("kW", "kg"), and
// the value-formatting logic are preserved exactly.
//
// Web module -> native-safe mappings (contract rules 4-7):
//   - `@/components/ui` `Card`/`CardHeader` (L3) -> local View-based `Card`
//     (var(--surface-1) bg + var(--glass-border) border + rounded-lg + p-4 +
//     shadow-sm) and `CardHeader` (mb-4 row, text-base semibold title with the
//     optional subtitle/action surface kept for source-API fidelity). The shared
//     ui primitives are not standalone native ports yet, so they are reproduced
//     locally (same precedent as the ChargingDetailPage KVList / BatteryCellsPage
//     GridRow ports).
//   - `@/components/layout` `Grid` (L4) -> local `GridRow`. The native shell has
//     no CSS grid; the web `cols={{ default: 1, md: 2 }} gap={4}` resolves
//     mobile-first to a flex-wrap row (gap 16) whose items grow with a min width,
//     so the two cards sit 1-up on a phone (default: 1) and 2-up once the width
//     allows (md: 2).
//   - `@/components/data-display` `KVList` (L5) -> local `KVList` (a `divide-y`
//     stack: each row is a space-between flex row, py-2, muted text-sm label +
//     semibold text-sm value, with a top border between rows).
//   - `@/components/motion` `FadeIn` (L6) -> the ported web-parity `components/
//     motion` FadeIn (Animated entrance; the `delay={0.4}` seconds is preserved).
//   - `@/hooks/useUnits` `useUnits` (L7) -> a local SI-floor shim exposing
//     `formatTemperature` + `formatEnergy`. There is no native settings/locale
//     port yet, so the display floor is °C / kWh (the web defaults: temperature
//     derives to °C, `DEFAULT_ENERGY_PREF = 'kWh'`). The display-boundary
//     conversion contract (read SI, convert at render) and the per-call
//     `{ precision }` override surface are preserved; the lib formatters are
//     reproduced faithfully (°C: no space before the unit + default precision 1;
//     kWh: wh/1000 + default precision 2). User-preference unit switching is
//     UNAVAILABLE until a native settings port lands (documented in the sidecar).
//   - `@/lib/numberFormat` `fmtNumber`/`fmtInt` (L8) -> inlined native-safe
//     equivalents (+ their `safeNumber` dep): nullish/non-finite -> 0, en-US
//     locale, the per-call precision arg honoured (fmtInt = 0 dp).
//   - `@/types/driving` `DrivetrainHealthData`/`DrivingStats` (L10) -> imported
//     from the native `api/hooks/useDriving` port, whose interfaces match the web
//     shapes field-for-field.
//   - `./helpers` `displayTemp` (L11) -> inlined verbatim (the sibling
//     drivetrain-health helpers module is not a standalone native port yet, so
//     this component stays self-contained).
//   - react-i18next `useTranslation` -> the standard local fallback shim
//     returning the inline English copy while keeping every i18n key, so
//     translation intent is preserved (no react-i18next in the native deps).
//
// DOM -> native element mapping: every web `<div>` becomes a `View`; the card
// title/labels/values become `AppText`. Tailwind classes map to StyleSheet/token
// styles (1 spacing unit = 4px: p-4 -> 16, mb-4 -> 16, py-2 -> 8, gap-4 -> 16);
// `var(--surface-1)`/`var(--glass-border)` -> the `surface`/`border` tokens;
// `--text-muted` -> the AppText muted tone; `text-gray-900 dark:text-gray-100` ->
// the primary tone. No DOM-only modules, browser HTML elements, Recharts,
// Leaflet, or old web UI components are imported.

import React, {type ReactNode} from 'react';
import {StyleSheet, View, type StyleProp, type ViewStyle} from 'react-native';

import {FadeIn} from '../../../../components/motion';
import {AppText} from '../../../../../components/ui/AppText';
import {colors} from '../../../../../theme/tokens';
import type {DrivetrainHealthData, DrivingStats} from '../../../../api/hooks/useDriving';

// ─── i18n fallback ────────────────────────────────────────────
// react-i18next is absent from the native deps; this returns the inline English
// copy while every call site still references the i18n key, so intent survives.
type TFunc = (key: string, fallback: string) => string;

function useTranslation(): {t: TFunc} {
  return {t: (_key, fallback) => fallback};
}

// ─── Inlined `@/lib/numberFormat` (safeNumber / fmtNumber / fmtInt) ──
// Locale-aware formatting matching the web helpers: nullish/non-finite input
// coerces to 0, a bad locale falls back to en-US. The web default precision is 2;
// every surviving call site passes an explicit precision (1) or uses fmtInt (0).
function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals = 2): string {
  try {
    return safeNumber(v).toLocaleString('en-US', {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(v).toFixed(decimals);
  }
}

function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

// ─── `useUnits` SI-floor shim (web @/hooks/useUnits) ──────────
// No native settings/locale port yet, so the display floor is the web default
// derivation: temperature -> °C, energy -> kWh (`DEFAULT_ENERGY_PREF`). The
// display-boundary contract (read SI, convert at render) and the per-call
// `{ precision }` override are preserved; the `@/lib/unitConversion` formatters
// are reproduced faithfully. User-preference switching is UNAVAILABLE.
interface FormatOptions {
  precision?: number;
}

type UnitFormatter = (
  value: number | null | undefined,
  options?: FormatOptions,
) => string;

const DEFAULT_LOCALE = 'en-US';
const EMPTY_DISPLAY = '—';

function isFiniteNumber(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function formatSiNumber(value: number, fractionDigits: number): string {
  try {
    return value.toLocaleString(DEFAULT_LOCALE, {
      maximumFractionDigits: fractionDigits,
      minimumFractionDigits: fractionDigits,
    });
  } catch {
    return value.toFixed(fractionDigits);
  }
}

function resolvePrecision(override: number | undefined, fallback: number): number {
  if (typeof override === 'number' && Number.isFinite(override) && override >= 0) {
    return Math.floor(override);
  }
  return fallback;
}

const formatTemperatureSI: UnitFormatter = (value, options) => {
  if (!isFiniteNumber(value)) {
    return EMPTY_DISPLAY;
  }
  const digits = resolvePrecision(options?.precision, 1);
  // SI floor is °C; no space between the number and the degree unit.
  return `${formatSiNumber(value, digits)}°C`;
};

const formatEnergySI: UnitFormatter = (value, options) => {
  if (!isFiniteNumber(value)) {
    return EMPTY_DISPLAY;
  }
  const digits = resolvePrecision(options?.precision, 2);
  // DEFAULT_ENERGY_PREF = 'kWh'; convertEnergyFromSI(wh, 'kWh') = wh / 1000.
  return `${formatSiNumber(value / 1000, digits)} kWh`;
};

function useUnits(): {
  formatTemperature: UnitFormatter;
  formatEnergy: UnitFormatter;
} {
  return {formatTemperature: formatTemperatureSI, formatEnergy: formatEnergySI};
}

// ─── Inlined `./helpers` (displayTemp) ────────────────────────
// Verbatim port: null -> the universal "—" placeholder, otherwise format the
// Celsius value through the supplied formatter (callers do not pre-guard).
function displayTemp(
  celsius: number | null,
  formatTemperature: (c: number) => string,
): string {
  if (celsius === null) {
    return '—';
  }
  return formatTemperature(celsius);
}

// ─── Card (web @/components/ui Card, md padding) ──────────────
function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

// ─── CardHeader (web @/components/ui CardHeader) ──────────────
function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.cardHeader}>
      <View style={styles.cardHeaderText}>
        <AppText style={styles.cardHeaderTitle} weight="semibold">
          {title}
        </AppText>
        {subtitle ? (
          <AppText style={styles.cardHeaderSubtitle} tone="muted">
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {action}
    </View>
  );
}

// ─── KVList (web @/components/data-display KVList) ─────────────
function KVList({items}: {items: {label: string; value: ReactNode}[]}) {
  return (
    <View>
      {items.map((item, index) => (
        <View
          key={item.label}
          style={[styles.kvRow, index > 0 ? styles.kvRowDivided : null]}>
          <AppText style={styles.kvLabel} tone="muted">
            {item.label}
          </AppText>
          <AppText style={styles.kvValue} weight="semibold">
            {item.value}
          </AppText>
        </View>
      ))}
    </View>
  );
}

// ─── GridRow (web @/components/layout Grid) ───────────────────
// cols={{ default: 1, md: 2 }} gap={4}: a flex-wrap row (gap 16) whose items grow
// with a min width, so the cards sit 1-up on a phone and 2-up once wide enough.
function GridRow({children}: {children: ReactNode}) {
  return <View style={styles.grid}>{children}</View>;
}

interface DetailCardsProps {
  health: DrivetrainHealthData;
  peakPower: number;
  avgPowerMax: number;
  minRegenPower: number;
  stats: DrivingStats | undefined;
}

export function DetailCards({
  health,
  peakPower,
  avgPowerMax,
  minRegenPower,
  stats,
}: DetailCardsProps) {
  const {t} = useTranslation();
  const {formatTemperature: formatTemperatureUnit, formatEnergy} = useUnits();
  const formatTemperature = (
    value: number | null | undefined,
    precision?: number,
  ) => formatTemperatureUnit(value, {precision});

  return (
    <FadeIn delay={0.4}>
      <GridRow>
        <Card style={styles.gridItem}>
          <CardHeader
            title={t('drivetrain.temperatures', 'Temperature Details')}
          />
          <KVList
            items={[
              {
                label: t('drivetrain.frontMotorTemp', 'Front Motor Temp'),
                value: displayTemp(health.frontMotorTempC, formatTemperature),
              },
              {
                label: t('drivetrain.rearMotorTemp', 'Rear Motor Temp'),
                value: displayTemp(health.rearMotorTempC, formatTemperature),
              },
              {
                label: t('drivetrain.inverterTemp', 'Inverter Temp'),
                value: displayTemp(health.inverterTempC, formatTemperature),
              },
              {
                label: t('drivetrain.batteryTemp', 'Battery Temp'),
                value: displayTemp(health.batteryTempC, formatTemperature),
              },
            ]}
          />
        </Card>

        <Card style={styles.gridItem}>
          <CardHeader title={t('drivetrain.powerSummary', 'Power Summary')} />
          <KVList
            items={[
              {
                label: t('drivetrain.peakPowerLabel', 'Peak Power'),
                value: peakPower > 0 ? `${fmtInt(peakPower)} kW` : '—',
              },
              {
                label: t('drivetrain.avgPowerLabel', 'Avg Peak Power'),
                value: avgPowerMax > 0 ? `${fmtNumber(avgPowerMax, 1)} kW` : '—',
              },
              {
                label: t('drivetrain.maxRegenLabel', 'Max Regen'),
                value:
                  minRegenPower < 0
                    ? `${fmtNumber(Math.abs(minRegenPower), 1)} kW`
                    : '—',
              },
              {
                label: t('drivetrain.regenLabel', 'Total Regen'),
                value: stats
                  ? formatEnergy(stats.regenEnergyWh, {precision: 1})
                  : '—',
              },
              {
                label: t('drivetrain.co2Label', 'CO₂ Saved'),
                value: stats ? `${fmtNumber(stats.co2SavedKg, 1)} kg` : '—',
              },
            ]}
          />
        </Card>
      </GridRow>
    </FadeIn>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface, // var(--surface-1)
    borderColor: colors.border, // var(--glass-border)
    borderRadius: 12, // rounded-lg
    borderWidth: 1,
    elevation: 3, // shadow-sm
    padding: 16, // p-4 (md)
    shadowColor: '#000',
    shadowOffset: {height: 4, width: 0},
    shadowOpacity: 0.18,
    shadowRadius: 8,
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16, // mb-4
  },
  cardHeaderSubtitle: {
    fontSize: 14, // text-sm
    marginTop: 2,
  },
  cardHeaderText: {
    flexShrink: 1,
  },
  cardHeaderTitle: {
    fontSize: 16, // text-base
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16, // gap-4
  },
  gridItem: {
    flexBasis: '47%',
    flexGrow: 1,
    minWidth: 260, // default: 1 (phone) -> md: 2 (wide)
  },
  kvLabel: {
    flexShrink: 1,
    fontSize: 14, // text-sm
  },
  kvRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'space-between',
    paddingVertical: 8, // py-2
  },
  kvRowDivided: {
    borderTopColor: colors.border, // divide-y
    borderTopWidth: 1,
  },
  kvValue: {
    fontSize: 14, // text-sm
    textAlign: 'right',
  },
});
