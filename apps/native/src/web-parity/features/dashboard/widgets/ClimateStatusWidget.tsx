import {Glyph} from '../../../../components/icons/Glyph';
// Native parity port of web/src/features/dashboard/widgets/ClimateStatusWidget.tsx.
//
// The web widget is the dashboard "Climate" live tile. It resolves a vehicle id
// (`vehicleId` prop, else the first vehicle from `useVehicles()`), polls
// `useClimateLatest(id, 5_000)` (GET /api/v1/climate/latest?vehicle_id= —
// preserved verbatim by the already-ported native useVehicles hook), and renders
// inside a `WidgetShell` either a three-`Row` body (Cabin / Outside / HVAC) plus
// a wrapping chip row (Defrost, Heater) or — when `climateData` is missing — an
// `EmptyState` ("No climate data").
//
// Every state name (`vehicles`, `id`, `climateData`, `isLoading`, `isFetching`,
// `isStale`, `isError`, `dataUpdatedAt`, `refetch`, `unitPrefs`,
// `toTemperatureDisplay`, `tempUnit`), the `vehicleId ?? vehicles?.[0]?.id ?? 0`
// resolution, the `5_000` refetch interval, the SI->display temperature
// conversion at the render boundary (`convertTempFromSI(value, temperature)`),
// the `inside_temp`/`outside_temp` `!= null` guards with the em-dash fallback,
// the `hvac_power != null ? fmtNumber(,1)+' kW' : '—'` formatting, the
// `defrost_mode && defrost_mode !== 'Off'` + `battery_heater_on` chip gates, and
// every `widget.*` i18n key with its English fallback are preserved. Browser-only
// pieces are mapped to native-safe equivalents (documented in the parity
// sidecar):
//
//   - react-i18next `useTranslation('dashboard')` is not a native-parity
//     dependency; a local `useNativeTranslationFallback()` t() shim returns the
//     English fallback verbatim (same pattern as the APIUsageWidget /
//     ChargeStatusLiveWidget ports), so every key + copy is preserved.
//   - lucide-react `Thermometer, Snowflake, Zap` have no native icon dependency;
//     per the ChargeStatusLiveWidget glyph precedent each becomes a decorative
//     Unicode glyph in an `AppText` with `importantForAccessibility="no"`
//     (Thermometer '\u{1F321}', Snowflake '\u2744', Zap '\u26A1'). h-3.5 (14px)
//     -> title icon fontSize 14; h-5 (20px) -> empty icon fontSize 20; h-2.5
//     (10px) chip glyphs share the chip text size. `text-neon-cyan` maps to the
//     accent token; the blue/orange chip colours map to their literal rgba/hex.
//   - `@/components/feedback` `EmptyState` -> an inlined `WidgetEmptyState`
//     (centered glyph icon + muted message; the Thermometer h-5 icon, message
//     key, and py-4 padding intent preserved), and the web `WidgetShell` (a
//     transparent flex container with Skeleton loading + QueryError + a
//     DataFreshness header) -> an inlined native `WidgetShell` on a GlassPanel
//     (Spinner loading, danger-text error, uppercase title row + a compact
//     freshness dot/refresh control) — identical to the ChargeStatusLiveWidget
//     port.
//   - `@/hooks/useUnits` + `@/lib/unitConversion` (`convertTempFromSI`) ->
//     inlined native equivalents: a `useUnits()` shim returning the out-of-box
//     `{temperature: '°C'}` preference (the API already returns SI Celsius;
//     conversion happens at display) and the pure SI->display temperature
//     converter mirroring the web module. `@/lib/numberFormat` `fmtInt` /
//     `fmtNumber` are inlined as native-safe formatters (locale toLocaleString,
//     precision-2 / en-US defaults; fmtInt = fmtNumber(v, 0)).
//   - `./WidgetShell` `WidgetShell` -> the inlined native WidgetShell above.
//     `./types` `WidgetProps` -> a local interface mirroring it (WidgetSize
//     {cols, rows}).

import React, {useCallback, useMemo, type ReactNode} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {useClimateLatest, useVehicles} from '../../../api/hooks/useVehicles';
import {Spinner} from '../../../components/feedback/Spinner';

/* ─── local widget types (mirror ./types — not yet ported) ─────────────────── */

interface WidgetSize {
  cols: number;
  rows: number;
}

export interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: Record<string, unknown>;
}

/* ─── i18n fallback shim (web react-i18next is unavailable in native) ───────── */

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key, fallback) => fallback, []);
}

/* ─── native unit shim (web `@/hooks/useUnits` + `@/lib/unitConversion`) ────── */

type TemperatureUnitPref = '°C' | '°F';

// Mirrors web `convertTempFromSI` (SI Celsius -> display unit).
function convertTempFromSI(celsius: number, to: TemperatureUnitPref): number {
  switch (to) {
    case '°F':
      return (celsius * 9) / 5 + 32;
    case '°C':
    default:
      return celsius;
  }
}

interface UseUnitsResult {
  unitPrefs: {temperature: TemperatureUnitPref};
}

// The native parity layer has no settings store wired in here, so the hook
// mirrors the web out-of-box default: temperature '°C'. The API already returns
// SI Celsius; conversion happens at the display boundary.
function useUnits(): UseUnitsResult {
  return useMemo<UseUnitsResult>(() => ({unitPrefs: {temperature: '°C'}}), []);
}

/* ─── native-safe number formatting (web `@/lib/numberFormat`) ──────────────── */

const DEFAULT_GLOBAL_PRECISION = 2;

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals?: number, locale = 'en-US'): string {
  const d = decimals ?? DEFAULT_GLOBAL_PRECISION;
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

// Mirrors web `fmtInt` (fmtNumber at precision 0 with locale separators).
function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

/* ─── decorative glyphs (lucide-react stand-ins) ───────────────────────────── */

const ICON_THERMOMETER = '\u{1F321}'; // lucide Thermometer
const ICON_SNOWFLAKE = '\u2744'; // lucide Snowflake
const ICON_ZAP = '\u26A1'; // lucide Zap
const GLYPH_REFRESH = '\u21BB';
const EM_DASH = '\u2014';

function GlyphLegacyUnused({glyph, style}: {glyph: string; style?: StyleProp<TextStyle>}) {
  return (
    <AppText allowFontScaling={false} importantForAccessibility="no" style={style}>
      {glyph}
    </AppText>
  );
}

/* ─── inlined EmptyState (web @/components/feedback EmptyState) ─────────────── */

function WidgetEmptyState({icon, message}: {icon?: ReactNode; message: string}) {
  return (
    <View accessibilityLiveRegion="polite" style={styles.emptyState}>
      {icon}
      <AppText style={styles.emptyMessage} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

/* ─── inlined WidgetShell freshness control (web DataFreshness) ─────────────── */

interface WidgetFreshnessProps {
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
}

function WidgetFreshness({
  isFetching,
  isStale,
  isError,
  onRefresh,
}: WidgetFreshnessProps) {
  let dotColor: string = colors.success;
  if (isError) {
    dotColor = colors.danger;
  } else if (isStale) {
    dotColor = colors.warning;
  } else if (isFetching) {
    dotColor = colors.accent;
  }

  const dot = <View style={[styles.freshnessDot, {backgroundColor: dotColor}]} />;

  if (!onRefresh) {
    return <View style={styles.freshnessRow}>{dot}</View>;
  }

  return (
    <Pressable
      accessibilityLabel="Refresh"
      accessibilityRole="button"
      hitSlop={8}
      onPress={onRefresh}
      style={styles.freshnessRow}>
      {dot}
      <AppText importantForAccessibility="no" style={styles.freshnessGlyph}>
        {GLYPH_REFRESH}
      </AppText>
    </Pressable>
  );
}

/* ─── inlined WidgetShell (web WidgetShell.tsx) ─────────────────────────────── */

interface WidgetShellProps {
  title?: string;
  icon?: ReactNode;
  loading?: boolean;
  error?: string | null;
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
  children: ReactNode;
}

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
}: WidgetShellProps) {
  if (loading) {
    return (
      <GlassPanel style={styles.shell}>
        <View style={styles.centerFill}>
          <Spinner size="sm" />
        </View>
      </GlassPanel>
    );
  }

  if (error) {
    return (
      <GlassPanel style={styles.shell}>
        <View style={styles.centerFill}>
          <AppText style={styles.errorText} tone="danger">
            {error}
          </AppText>
        </View>
      </GlassPanel>
    );
  }

  const showFreshness = updatedAt !== undefined;
  const freshness = showFreshness ? (
    <WidgetFreshness
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      onRefresh={onRefresh}
    />
  ) : null;

  return (
    <GlassPanel style={styles.shell}>
      {title ? (
        <View style={styles.headerRow}>
          <View style={styles.headerTitleGroup}>
            {icon}
            <AppText style={styles.titleText} tone="muted">
              {title}
            </AppText>
          </View>
          {freshness}
        </View>
      ) : freshness ? (
        <View style={styles.freshnessOverlay}>{freshness}</View>
      ) : null}
      {children}
    </GlassPanel>
  );
}

/* ─── inlined Row (web local Row) ──────────────────────────────────────────── */

function Row({label, value}: {label: string; value: string}) {
  return (
    <View style={styles.row}>
      <AppText style={styles.rowLabel}>{label}</AppText>
      <AppText style={styles.rowValue}>{value}</AppText>
    </View>
  );
}

/* ─── the widget ───────────────────────────────────────────────────────────── */

export default function ClimateStatusWidget({vehicleId}: WidgetProps) {
  const t = useNativeTranslationFallback();
  const {data: vehicles} = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const {
    data: climateData,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useClimateLatest(id, 5_000);
  const {unitPrefs} = useUnits();
  const toTemperatureDisplay = (value: number) =>
    convertTempFromSI(value, unitPrefs.temperature);

  const tempUnit = unitPrefs.temperature;

  // Mirrors the web truthiness gates (`defrost_mode && defrost_mode !== 'Off'`
  // and `battery_heater_on`) as explicit booleans so a falsy value renders
  // nothing in JSX rather than leaking an empty string into a native View.
  const showDefrost =
    Boolean(climateData?.defrost_mode) && climateData?.defrost_mode !== 'Off';
  const showBatteryHeater = Boolean(climateData?.battery_heater_on);

  return (
    <WidgetShell
      icon={<Glyph glyph={ICON_THERMOMETER} style={styles.titleIcon} />}
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={isLoading}
      onRefresh={() => refetch()}
      title={t('widget.climate', 'Climate')}
      updatedAt={dataUpdatedAt}>
      {climateData ? (
        <View style={styles.rowStack}>
          <Row
            label={t('widget.cabin', 'Cabin')}
            value={
              climateData.inside_temp != null
                ? `${fmtInt(toTemperatureDisplay(climateData.inside_temp))}${tempUnit}`
                : EM_DASH
            }
          />
          <Row
            label={t('widget.outside', 'Outside')}
            value={
              climateData.outside_temp != null
                ? `${fmtInt(toTemperatureDisplay(climateData.outside_temp))}${tempUnit}`
                : EM_DASH
            }
          />
          <Row
            label={t('widget.hvac', 'HVAC')}
            value={
              climateData.hvac_power != null
                ? `${fmtNumber(climateData.hvac_power, 1)} kW`
                : EM_DASH
            }
          />
          <View style={styles.chipsRow}>
            {showDefrost && (
              <View style={[styles.chip, styles.defrostChip]}>
                <Glyph glyph={ICON_SNOWFLAKE} style={styles.defrostChipText} />
                <AppText style={styles.defrostChipText}>
                  {t('widget.defrost', 'Defrost')}
                </AppText>
              </View>
            )}
            {showBatteryHeater && (
              <View style={[styles.chip, styles.heaterChip]}>
                <Glyph glyph={ICON_ZAP} style={styles.heaterChipText} />
                <AppText style={styles.heaterChipText}>
                  {t('widget.batHeater', 'Heater')}
                </AppText>
              </View>
            )}
          </View>
        </View>
      ) : (
        <WidgetEmptyState
          icon={<Glyph glyph={ICON_THERMOMETER} style={styles.emptyIcon} />}
          message={t('widget.noClimate', 'No climate data')}
        />
      )}
    </WidgetShell>
  );
}

ClimateStatusWidget.displayName = 'ClimateStatusWidget';

const styles = StyleSheet.create({
  centerFill: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    padding: spacing.md,
  },
  chip: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  chipsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  defrostChip: {
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
  },
  defrostChipText: {
    color: '#60a5fa',
    fontSize: 10,
    lineHeight: 14,
  },
  emptyIcon: {
    color: colors.textMuted,
    fontSize: 20,
    lineHeight: 24,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  emptyMessage: {
    fontSize: 14,
    textAlign: 'center',
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  errorText: {
    fontSize: 13,
    textAlign: 'center',
  },
  freshnessDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  freshnessGlyph: {
    color: colors.textMuted,
    fontSize: 13,
  },
  freshnessOverlay: {
    position: 'absolute',
    right: spacing.sm,
    top: spacing.sm,
    zIndex: 5,
  },
  freshnessRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  headerTitleGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  heaterChip: {
    backgroundColor: 'rgba(249, 115, 22, 0.1)',
  },
  heaterChipText: {
    color: '#fb923c',
    fontSize: 10,
    lineHeight: 14,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  rowLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
  rowStack: {
    gap: 10,
  },
  rowValue: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
  },
  shell: {
    borderRadius: 16,
    gap: spacing.sm,
    padding: spacing.md,
  },
  titleIcon: {
    color: colors.accent,
    fontSize: 14,
    lineHeight: 16,
  },
  titleText: {
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
});
