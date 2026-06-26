// Native parity port of
// web/src/features/vehicles/components/vehicle-detail/ChargingTelemetrySection.tsx.
//
// The web component is the vehicle-detail "Charging Telemetry" section: a
// GlassPanel (p-6) with a title row (Zap icon, --neon-green + "Charging
// Telemetry" bold heading) and, when `chargingTelemetry` is present, a
// responsive grid (2 cols base → 3 at sm → 4 at lg) of eight MetricCards —
//   1. Charger Power  — `${fmtNumber(charger_power_w)} kW`        (Zap, green)
//   2. Voltage        — `${fmtNumber(charger_voltage)} V`         (Activity, cyan)
//   3. Current        — `${fmtNumber(charger_actual_current)} A`  (Activity, purple)
//   4. Energy Added   — `${fmtNumber(charge_energy_added_wh)} kWh`(BatteryCharging, green)
//   5. Charging State — charging_state ?? '—'                     (Battery, cyan)
//   6. Battery Level  — `${fmtNumber(battery_level)}%`            (Battery, green)
//   7. Charge Rate    — formatSpeed(range_added_meters_per_hour / 3600) (Activity, cyan)
//   8. Range Added    — formatDistance(range_added_meters)        (Zap, purple)
// Every numeric slot renders '—' when its source field is null. When
// `chargingTelemetry` itself is null/undefined the section shows an EmptyState
// (Zap icon + "No charging telemetry available").
//
// This native port preserves that contract 1:1 — the same `chargingTelemetry`
// prop, the same per-field `!= null` null-safety, the same fmtNumber suffix
// strings (including the web's display-only "kW"/"kWh" labels applied to the SI
// watt/watt-hour values — preserved verbatim, not silently rescaled), the same
// `range_added_meters_per_hour / 3600` → m/s convert-before-formatSpeed and the
// SI-metres → formatDistance convert-at-display unit handling, every i18n key +
// English default, and the same eight MetricCard slots / colours / icons — using
// React Native primitives, the existing native web-parity MetricCard and the
// native GlassPanel + AppText + design tokens.
//
// Browser-only / not-yet-ported web dependencies are reduced explicitly and
// documented in the .parity.json sidecar:
//   - react-i18next useTranslation (web L1): no native i18next runtime → inline
//     useNativeTranslation() returns t(key, fallback) = fallback, preserving
//     every key + English default verbatim.
//   - lucide-react Zap / Activity / BatteryCharging / Battery (web L2): DOM SVG
//     icons → semantic emoji glyph stand-ins (⚡ / 📈 / 🔋 / 🔋), the sibling
//     FleetSummary / ChargingSessionDetailWidget precedent; passed to MetricCard's
//     `icon` slot (string → tinted neon chip) and the title/empty glyphs.
//   - @/components/ui GlassPanel (web L4): → native GlassPanel.
//   - @/components/data-display MetricCard (web L5): → the already-ported native
//     web-parity MetricCard (identical label / value / icon / color slots; value
//     accepts string|number so every formatted string + '—' passes through).
//   - @/components/feedback EmptyState (web L6): → a local native-safe icon +
//     message EmptyState mirroring the web layout (centred column, muted icon
//     above a centred message); the web `<EmptyState icon message />` renders only
//     those two slots here.
//   - @/lib/numberFormat fmtNumber (web L7): inlined port — safeNumber guard +
//     toLocaleString('en-US', min/maxFractionDigits) with a toFixed fallback;
//     default precision 2 (the web global default), matching the sibling ports.
//   - @/hooks/useUnits useUnits (web L8): not yet ported → reproduced as a scoped
//     native useUnits() exposing the consumed formatDistance + formatSpeed,
//     derived from the web-parity useSettings() (unit_of_length → 'km'/'mi' &
//     'km/h'/'mph', locale, decimal_precision) and mirroring
//     web/src/lib/unitConversion.ts exactly (SI metres → distance unit at
//     precision 1; SI m/s → speed unit at precision 0; null/NaN → '—').
//   - @/api/types ChargingTelemetry (web L9): imported from the already-ported
//     native web-parity api/types so the prop contract is identical.
//   - the Tailwind responsive grid (grid-cols-2 sm:grid-cols-3 lg:grid-cols-4,
//     web L28) collapses to the native phone base (2 columns) via a flex-wrap
//     row of 48%-basis cells with a gap-3 (12px) gutter — the EnergyProductsPage
//     grid precedent.
//
// No DOM module, browser HTML element, Recharts, Leaflet, lucide DOM SVG,
// framer-motion, or old web @/components import appears in the native output.

import React, {useCallback, useMemo, type ReactNode} from 'react';
import {StyleSheet, View} from 'react-native';

import {useSettings} from '../../../../api/hooks/useSettings';
import type {ChargingTelemetry} from '../../../../api/types';
import {MetricCard} from '../../../../components/data-display/MetricCard';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../../theme/tokens';

/* ── i18n: react-i18next useTranslation -> native-safe fallback shim ───────── */

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslation(): NativeTFunction {
  return useMemo<NativeTFunction>(() => (_key, fallback) => fallback, []);
}

/* ── native-safe useUnits (web @/hooks/useUnits) ───────────────────────────── */
// Mirrors web/src/lib/unitConversion.ts formatDistance/formatSpeed + the useUnits
// settings derivation so the SI → display contract matches exactly. deriveDistance
// only ever yields 'km' | 'mi' (the 'ft' arm of the web union is unreachable from
// unit_of_length), so the native unions narrow to the produced values.

type DistanceUnitPref = 'km' | 'mi';
type SpeedUnitPref = 'km/h' | 'mph';
type FormatOptions = {precision?: number};
type UnitFormatter = (value: number | null | undefined, options?: FormatOptions) => string;

const DEFAULT_EMPTY_DISPLAY = '\u2014'; // '—'
const DEFAULT_LOCALE = 'en-US';
const DEFAULT_DISTANCE_PRECISION = 1; // web DEFAULT_PRECISION.distance
const DEFAULT_SPEED_PRECISION = 0; // web DEFAULT_PRECISION.speed

const METERS_PER_MILE = 1609.344; // NIST international yard
const METERS_PER_KM = 1000;
const SECONDS_PER_HOUR = 3600;

function deriveDistance(unitOfLength: string | undefined): DistanceUnitPref {
  return unitOfLength === 'mi' ? 'mi' : 'km';
}

function deriveSpeed(unitOfLength: string | undefined): SpeedUnitPref {
  return unitOfLength === 'mi' ? 'mph' : 'km/h';
}

function deriveLocale(locale: string | undefined): string {
  if (typeof locale === 'string' && locale.trim().length > 0) {
    return locale;
  }
  return DEFAULT_LOCALE;
}

function derivePrecision(decimalPrecision: unknown): number | undefined {
  if (typeof decimalPrecision !== 'number') {
    return undefined;
  }
  if (!Number.isFinite(decimalPrecision)) {
    return undefined;
  }
  if (decimalPrecision < 0) {
    return undefined;
  }
  return Math.floor(decimalPrecision);
}

function resolvePrecision(
  pref: number | undefined,
  override: number | undefined,
  fallback: number,
): number {
  if (typeof override === 'number' && Number.isFinite(override) && override >= 0) {
    return Math.floor(override);
  }
  if (typeof pref === 'number' && Number.isFinite(pref) && pref >= 0) {
    return Math.floor(pref);
  }
  return fallback;
}

function isFiniteNumber(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  return to === 'mi' ? meters / METERS_PER_MILE : meters / METERS_PER_KM;
}

function convertSpeedFromSI(mps: number, to: SpeedUnitPref): number {
  return to === 'mph'
    ? (mps * SECONDS_PER_HOUR) / METERS_PER_MILE
    : (mps * SECONDS_PER_HOUR) / METERS_PER_KM;
}

function formatLocaleNumber(value: number, locale: string, digits: number): string {
  try {
    return value.toLocaleString(locale, {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits,
    });
  } catch {
    return value.toFixed(digits);
  }
}

function useUnits(): {formatDistance: UnitFormatter; formatSpeed: UnitFormatter} {
  const {data: settings} = useSettings();
  const distance = deriveDistance(settings?.unit_of_length);
  const speed = deriveSpeed(settings?.unit_of_length);
  const locale = deriveLocale(settings?.locale);
  const precision = derivePrecision(settings?.decimal_precision);

  const formatDistance = useCallback<UnitFormatter>(
    (value, options) => {
      if (!isFiniteNumber(value)) {
        return DEFAULT_EMPTY_DISPLAY;
      }
      const digits = resolvePrecision(precision, options?.precision, DEFAULT_DISTANCE_PRECISION);
      return `${formatLocaleNumber(convertDistanceFromSI(value, distance), locale, digits)} ${distance}`;
    },
    [distance, locale, precision],
  );

  const formatSpeed = useCallback<UnitFormatter>(
    (value, options) => {
      if (!isFiniteNumber(value)) {
        return DEFAULT_EMPTY_DISPLAY;
      }
      const digits = resolvePrecision(precision, options?.precision, DEFAULT_SPEED_PRECISION);
      return `${formatLocaleNumber(convertSpeedFromSI(value, speed), locale, digits)} ${speed}`;
    },
    [speed, locale, precision],
  );

  return useMemo(() => ({formatDistance, formatSpeed}), [formatDistance, formatSpeed]);
}

/* ── numberFormat: fmtNumber (web @/lib/numberFormat) ──────────────────────── */

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** fmtNumber — locale-aware, web global default precision 2. */
function fmtNumber(v: unknown, decimals = 2): string {
  try {
    return safeNumber(v).toLocaleString(DEFAULT_LOCALE, {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(v).toFixed(decimals);
  }
}

/* ── lucide-react glyph stand-ins (web L2) ─────────────────────────────────── */

const ICON_ZAP = '\u26A1'; // ⚡ (Zap)
const ICON_ACTIVITY = '\uD83D\uDCC8'; // 📈 (Activity)
const ICON_BATTERY_CHARGING = '\uD83D\uDD0B'; // 🔋 (BatteryCharging)
const ICON_BATTERY = '\uD83D\uDD0B'; // 🔋 (Battery)

const NEON_GREEN = '#10b981'; // --neon-green (tailwind neon green base)

/* ── EmptyState (native-safe port of @/components/feedback EmptyState) ─────── */

function EmptyState({icon, message}: {icon?: ReactNode; message: string}) {
  return (
    <View accessibilityRole="text" accessible style={styles.emptyState} testID="charging-telemetry-empty">
      {icon ? <View style={styles.emptyIcon}>{icon}</View> : null}
      <AppText style={styles.emptyMessage} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

/* ── ported: ChargingTelemetrySection (web L11-114) ────────────────────────── */

interface ChargingTelemetrySectionProps {
  chargingTelemetry: ChargingTelemetry | null | undefined;
}

export function ChargingTelemetrySection({chargingTelemetry}: ChargingTelemetrySectionProps) {
  const t = useNativeTranslation();
  const {formatDistance, formatSpeed} = useUnits();

  return (
    <GlassPanel style={styles.panel}>
      <View style={styles.titleRow}>
        <AppText style={styles.titleIcon}>{ICON_ZAP}</AppText>
        <AppText style={styles.title} weight="bold">
          {t('vehicles.detail.chargingTelemetry', 'Charging Telemetry')}
        </AppText>
      </View>

      {chargingTelemetry ? (
        <View style={styles.grid}>
          <View style={styles.gridCell}>
            <MetricCard
              color="green"
              icon={ICON_ZAP}
              label={t('vehicles.detail.chargerPower', 'Charger Power')}
              value={
                chargingTelemetry.charger_power_w != null
                  ? `${fmtNumber(chargingTelemetry.charger_power_w)} kW`
                  : DEFAULT_EMPTY_DISPLAY
              }
            />
          </View>
          <View style={styles.gridCell}>
            <MetricCard
              color="cyan"
              icon={ICON_ACTIVITY}
              label={t('vehicles.detail.voltage', 'Voltage')}
              value={
                chargingTelemetry.charger_voltage != null
                  ? `${fmtNumber(chargingTelemetry.charger_voltage)} V`
                  : DEFAULT_EMPTY_DISPLAY
              }
            />
          </View>
          <View style={styles.gridCell}>
            <MetricCard
              color="purple"
              icon={ICON_ACTIVITY}
              label={t('vehicles.detail.current', 'Current')}
              value={
                chargingTelemetry.charger_actual_current != null
                  ? `${fmtNumber(chargingTelemetry.charger_actual_current)} A`
                  : DEFAULT_EMPTY_DISPLAY
              }
            />
          </View>
          <View style={styles.gridCell}>
            <MetricCard
              color="green"
              icon={ICON_BATTERY_CHARGING}
              label={t('vehicles.detail.energyAdded', 'Energy Added')}
              value={
                chargingTelemetry.charge_energy_added_wh != null
                  ? `${fmtNumber(chargingTelemetry.charge_energy_added_wh)} kWh`
                  : DEFAULT_EMPTY_DISPLAY
              }
            />
          </View>
          <View style={styles.gridCell}>
            <MetricCard
              color="cyan"
              icon={ICON_BATTERY}
              label={t('vehicles.detail.chargingState', 'Charging State')}
              value={chargingTelemetry.charging_state ?? DEFAULT_EMPTY_DISPLAY}
            />
          </View>
          <View style={styles.gridCell}>
            <MetricCard
              color="green"
              icon={ICON_BATTERY}
              label={t('vehicles.detail.batteryLevel', 'Battery Level')}
              value={
                chargingTelemetry.battery_level != null
                  ? `${fmtNumber(chargingTelemetry.battery_level)}%`
                  : DEFAULT_EMPTY_DISPLAY
              }
            />
          </View>
          <View style={styles.gridCell}>
            <MetricCard
              color="cyan"
              icon={ICON_ACTIVITY}
              label={t('vehicles.detail.chargeRate', 'Charge Rate')}
              value={
                chargingTelemetry.range_added_meters_per_hour != null
                  ? formatSpeed(chargingTelemetry.range_added_meters_per_hour / 3600)
                  : DEFAULT_EMPTY_DISPLAY
              }
            />
          </View>
          <View style={styles.gridCell}>
            <MetricCard
              color="purple"
              icon={ICON_ZAP}
              label={t('vehicles.detail.rangeAdded', 'Range Added')}
              value={
                chargingTelemetry.range_added_meters != null
                  ? formatDistance(chargingTelemetry.range_added_meters)
                  : DEFAULT_EMPTY_DISPLAY
              }
            />
          </View>
        </View>
      ) : (
        <EmptyState
          // no-action: transient empty state — surfaces when source data is
          // missing; no specific recovery action available (web L107).
          icon={<AppText style={styles.emptyGlyph}>{ICON_ZAP}</AppText>}
          message={t('vehicles.detail.noChargingTelemetry', 'No charging telemetry available')}
        />
      )}
    </GlassPanel>
  );
}

ChargingTelemetrySection.displayName = 'ChargingTelemetrySection';

const styles = StyleSheet.create({
  emptyGlyph: {
    color: colors.textMuted, // text-[var(--text-muted)]
    fontSize: 32, // h-8 w-8
  },
  emptyIcon: {
    marginBottom: 16, // mb-4
  },
  emptyMessage: {
    maxWidth: 448, // max-w-md
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64, // py-16
  },
  grid: {
    columnGap: spacing.md, // gap-3 (12px)
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.md,
  },
  gridCell: {
    flexBasis: '48%', // grid-cols-2 base (EnergyProductsPage precedent)
    flexGrow: 1,
  },
  panel: {
    padding: spacing.lg + 4, // p-6 (24px)
  },
  title: {
    color: colors.textPrimary, // --text-primary
    fontSize: 18, // text-lg
  },
  titleIcon: {
    color: NEON_GREEN, // text-[var(--neon-green)]
    fontSize: 16, // h-4 w-4
  },
  titleRow: {
    alignItems: 'center',
    columnGap: spacing.sm, // gap-2
    flexDirection: 'row',
    marginBottom: 16, // mb-4
  },
});
