// Native parity port of
// web/src/features/driving/components/drive-detail/DriveStatCards.tsx.
//
// The web component renders the drive-detail KPI strip: a `StaggerContainer`
// CSS grid (grid-cols-2 / sm:grid-cols-4 / lg:grid-cols-8, gap-3) of `StaggerItem`
// cells, each an `IconStatCard` (a centered GlassPanel with a coloured lucide
// glyph, a bold value, and a tiny muted label). Eight always-on cards (Distance,
// Duration, Max Speed, Avg Speed, SOC, Max Power, Elev. Gain, Elev. Loss) plus
// two conditional cost cards (Trip Cost when stats.energyWh > 0, Cost / unit when
// energy AND distance are present). Distance is converted from SI metres to the
// user unit; speeds carry the user speed-unit suffix; several values animate up
// via `AnimatedNumber`. A trailing comment marks the removed Battery-Heater field.
//
// Native substitutions (no DOM, lucide-react, framer-motion, Recharts, Leaflet,
// or web UI components are imported):
//   * `GlassPanel` (web @/components/ui, used by IconStatCard) -> the native
//     `components/ui/GlassPanel` (style instead of className; p-4 -> padding 16,
//     text-center -> alignItems/textAlign center).
//   * `IconStatCard` (web ./IconStatCard) -> inlined native parity component: it
//     has no native port yet, so the GlassPanel + icon + value + label layout is
//     reproduced here. The lucide `LucideIcon` prop becomes a repo `SemanticIcon`
//     name whose glyph is read via getSemanticIconDefinition and tinted with the
//     same explicit hex `color` the web passes (#00f0ff/#f59e0b/#a855f7/#10b981/
//     #ef4444/#06b6d4). lucide -> semantic glyph map: Route->drive, Clock->clock,
//     Gauge->speed, TrendingUp->trendUp, Battery->battery, Zap->bolt,
//     Navigation->navigation, DollarSign->dollarSign, TrendingDown->trendDown.
//   * `AnimatedNumber` (web @/components/data-display) -> inlined native parity
//     component: same ease-out-quad count-up over `duration` seconds (rAF-driven,
//     Date.now() timebase so it is platform-safe on RN Windows/macOS where
//     performance.now may be absent), same prefix/suffix/decimals contract. It
//     renders a bare RN `Text` carrying only `fontVariant: ['tabular-nums']` so it
//     inherits the IconStatCard value font size/weight/colour from the wrapping
//     AppText — mirroring the web `<span class="tabular-nums">` inheriting from the
//     IconStatCard `<p class="text-lg font-bold">`.
//   * `StaggerContainer`/`StaggerItem` (web @/components/motion) -> inlined static
//     wrappers (the framer-motion stagger entrance collapses to its final layout,
//     matching the reduced-motion branch used by the sibling native ports). The CSS
//     grid is reproduced with a flex-wrap container (gap-3 via a negative-margin
//     gutter) and per-cell widths from a responsive column count (2 / 4 / 8 at the
//     Tailwind base / sm 640 / lg 1024 breakpoints).
//   * `useUnits().unitPrefs` (web @/hooks/useUnits) -> inlined `deriveDistance`
//     (mi else km) + `deriveSpeed` (mph else km/h) reading the ported
//     `useSettings()` query, matching the web derive helpers exactly.
//   * `useFormatting()` (web @/hooks/useFormatting) -> inlined `formatEnergyCost`,
//     `formatCurrency`, and `costPerDistanceUnit` reproducing the hook verbatim
//     (base_cost_per_kwh ?? 0.12, currency_symbol trimmed else '$', user precision
//     floor>=0 else 2, SI-metre -> user-unit cost division).
//   * `convertDistanceFromSI` (web @/lib/unitConversion) -> inlined value-identical
//     metre->km/mi/ft converter with the same METERS_PER_KM/MILE/FOOT constants.
//   * `fmtInt`/`fmtWithUnit`/`fmtNumber` (web @/lib/numberFormat) -> value-identical
//     inlines (safeNumber non-finite->0, locale-grouped toLocaleString with a
//     bad-locale en-US fallback; fmtInt at 0 digits; fmtWithUnit defaulting to the
//     web global precision = clamped settings.decimal_precision).
//   * `formatDuration` (web ./helpers) -> imported logic inlined verbatim
//     (h>0 ? `${h}h ${m}m` : `${m}m`).
//   * `DriveStats` (web ./types) -> imported from the already-ported native sibling
//     ./types. `DriveDetail` (web @/types/driving) has no native port yet, so the
//     consumed SI subset (distanceM/durationS/startBatteryPct/endBatteryPct) is
//     inlined; the parent passes a structurally-compatible richer object.
//   * react-i18next `useTranslation().t` -> a self-contained fallback returning the
//     English fallback string; the interpolated Cost / {{unit}} label is rebuilt by
//     replacing {{unit}} with the active distance unit, preserving the i18n intent.

import React, {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type DimensionValue,
} from 'react-native';

import {
  getSemanticIconDefinition,
  type SemanticIconName,
} from '../../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../../components/ui/AppText';
import {GlassPanel} from '../../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../../theme/tokens';
import {useSettings} from '../../../../api/hooks/useSettings';
import type {DriveStats} from './types';

type NativeTFunction = (key: string, fallback: string) => string;

// The web component read `t` from react-i18next. Native parity has no i18n runtime
// wired yet, so this returns the English fallback string, preserving every i18n
// key + default (the ten card labels and the interpolated Cost / {{unit}} label).
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

// Local mirror of the consumed subset of web `@/types/driving` `DriveDetail`
// (extends `Drive`). The native types/driving port does not exist yet; only these
// SI-canonical fields are read here (metres, seconds, battery %). The parent
// supplies a structurally-compatible richer object.
interface DriveDetail {
  /** Distance travelled in meters (SI canonical). */
  distanceM: number;
  /** Drive duration in seconds (SI canonical). */
  durationS: number;
  startBatteryPct: number | null;
  endBatteryPct: number | null;
}

// --- Inlined `@/lib/unitConversion` distance parity -----------------------
const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;
const METERS_PER_FOOT = 0.3048;

type DistanceUnitPref = 'km' | 'mi' | 'ft';
type SpeedUnitPref = 'km/h' | 'mph';

function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  switch (to) {
    case 'km':
      return meters / METERS_PER_KM;
    case 'mi':
      return meters / METERS_PER_MILE;
    case 'ft':
      return meters / METERS_PER_FOOT;
  }
}

// --- Inlined `@/lib/numberFormat` parity ----------------------------------
const DEFAULT_LOCALE = 'en-US';
const DEFAULT_PRECISION = 2;

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals: number, locale: string): string {
  try {
    return safeNumber(v).toLocaleString(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(v).toLocaleString(DEFAULT_LOCALE, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
}

function fmtInt(v: unknown, locale: string): string {
  return fmtNumber(v, 0, locale);
}

function fmtWithUnit(
  v: unknown,
  unit: string,
  decimals: number,
  locale: string,
): string {
  return `${fmtNumber(v, decimals, locale)} ${unit}`;
}

// --- Inlined `./helpers` formatDuration parity ----------------------------
function formatDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// --- Inlined `@/hooks/useUnits` derive helpers ----------------------------
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

// Web global precision (numberFormat.setGlobalPrecision): clamp 0..20, else 2.
// Used as the default digit count for `fmtWithUnit`.
function deriveGlobalPrecision(decimalPrecision: unknown): number {
  if (typeof decimalPrecision === 'number' && Number.isFinite(decimalPrecision)) {
    return Math.max(0, Math.min(20, decimalPrecision));
  }
  return DEFAULT_PRECISION;
}

// useFormatting userPrecision: floor when finite and >= 0, else 2.
function deriveUserPrecision(decimalPrecision: unknown): number {
  if (
    typeof decimalPrecision === 'number' &&
    Number.isFinite(decimalPrecision) &&
    decimalPrecision >= 0
  ) {
    return Math.floor(decimalPrecision);
  }
  return DEFAULT_PRECISION;
}

// Tailwind grid-cols-2 / sm:grid-cols-4 / lg:grid-cols-8 column counts.
const SM_BREAKPOINT = 640;
const LG_BREAKPOINT = 1024;
const GRID_GAP = spacing.md; // gap-3 == 0.75rem == 12.
const HALF_GAP = GRID_GAP / 2;

function useStatColumns(): number {
  const {width} = useWindowDimensions();
  if (width >= LG_BREAKPOINT) {
    return 8;
  }
  if (width >= SM_BREAKPOINT) {
    return 4;
  }
  return 2;
}

// framer-motion `<StaggerContainer>` -> static flex-wrap grid container (the
// reduced-motion final state). The stagger entrance carries no behavioural
// contract, so it is intentionally not animated.
function StaggerContainer({children}: {children: ReactNode}) {
  return <View style={styles.grid}>{children}</View>;
}

// framer-motion `<StaggerItem>` -> static grid cell. `width` reproduces the CSS
// grid column count the parent computes from the viewport.
function StaggerItem({
  children,
  width,
}: {
  children: ReactNode;
  width: DimensionValue;
}) {
  return <View style={[styles.cell, {width}]}>{children}</View>;
}

interface AnimatedNumberProps {
  value: number;
  duration?: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  locale: string;
}

// Native parity for `@/components/data-display/AnimatedNumber`: ease-out-quad
// count-up from 0 to `value` over `duration` seconds. The bare RN Text only sets
// tabular-nums so it inherits the value font size/weight/colour from the wrapping
// IconStatCard AppText (mirroring the web `<span class="tabular-nums">`).
function AnimatedNumber({
  value,
  duration = 1,
  decimals = 0,
  prefix,
  suffix,
  locale,
}: AnimatedNumberProps) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const startTime = Date.now();
    const from = 0;
    const to = value;
    const durationMs = duration * 1000;
    let frame = 0;

    const tick = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / durationMs, 1);
      // ease-out quad
      const eased = 1 - (1 - progress) * (1 - progress);
      setDisplay(from + (to - from) * eased);

      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      }
    };

    frame = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(frame);
  }, [value, duration]);

  return (
    <Text style={styles.tabularNums}>
      {prefix}
      {fmtNumber(display, decimals, locale)}
      {suffix}
    </Text>
  );
}

interface IconStatCardProps {
  iconName: SemanticIconName;
  color: string;
  value: ReactNode;
  label: string;
}

// Native parity for the web `./IconStatCard`: a centered GlassPanel (p-4) with a
// coloured glyph (h-4 w-4 mb-1), a bold value (text-lg), and a tiny muted label
// (text-[10px]).
function IconStatCard({iconName, color, value, label}: IconStatCardProps) {
  const glyph = getSemanticIconDefinition(iconName).glyph;
  return (
    <GlassPanel style={styles.card}>
      <AppText weight="bold" style={[styles.cardIcon, {color}]}>
        {glyph}
      </AppText>
      <AppText weight="bold" numberOfLines={1} style={styles.cardValue}>
        {value}
      </AppText>
      <AppText tone="muted" numberOfLines={1} style={styles.cardLabel}>
        {label}
      </AppText>
    </GlassPanel>
  );
}

export interface DriveStatCardsProps {
  drive: DriveDetail;
  stats: DriveStats;
}

export function DriveStatCards({drive, stats}: DriveStatCardsProps) {
  const t = useNativeTranslationFallback();
  const {data: settings} = useSettings();

  const locale = deriveLocale(settings?.locale);
  const distanceUnit = deriveDistance(settings?.unit_of_length);
  const speedUnit = deriveSpeed(settings?.unit_of_length);
  const globalPrecision = deriveGlobalPrecision(settings?.decimal_precision);
  const userPrecision = deriveUserPrecision(settings?.decimal_precision);
  const costPerKwh = settings?.base_cost_per_kwh ?? 0.12;
  const currencySymbol =
    settings?.currency_symbol && settings.currency_symbol.trim()
      ? settings.currency_symbol
      : '$';

  const toDistanceDisplay = (value: number) =>
    convertDistanceFromSI(value, distanceUnit);

  const formatEnergyCost = (kwh: number): string =>
    `${currencySymbol}${fmtNumber(kwh * costPerKwh, userPrecision, locale)}`;

  const formatCurrency = (amount: number, decimals?: number): string =>
    `${currencySymbol}${fmtNumber(amount, decimals ?? userPrecision, locale)}`;

  const costPerDistanceUnit = (
    kwh: number,
    distanceM: number,
  ): number | null => {
    if (distanceM <= 0) {
      return null;
    }
    const cost = kwh * costPerKwh;
    const distance = convertDistanceFromSI(distanceM, distanceUnit);
    return distance > 0 ? cost / distance : null;
  };

  const columns = useStatColumns();
  const cellWidth: DimensionValue = `${100 / columns}%`;

  const costPerUnitLabel = t('driveDetail.costPerUnit', 'Cost / {{unit}}').replace(
    '{{unit}}',
    distanceUnit,
  );

  return (
    <>
      <StaggerContainer>
        <StaggerItem width={cellWidth}>
          <IconStatCard
            iconName="drive"
            color="#00f0ff"
            value={
              <AnimatedNumber
                value={toDistanceDisplay(drive.distanceM)}
                decimals={1}
                suffix={` ${distanceUnit}`}
                locale={locale}
              />
            }
            label={t('driveDetail.distance', 'Distance')}
          />
        </StaggerItem>
        <StaggerItem width={cellWidth}>
          <IconStatCard
            iconName="clock"
            color="#f59e0b"
            value={formatDuration(drive.durationS / 60)}
            label={t('driveDetail.duration', 'Duration')}
          />
        </StaggerItem>
        <StaggerItem width={cellWidth}>
          <IconStatCard
            iconName="speed"
            color="#a855f7"
            value={
              <AnimatedNumber
                value={stats.maxSpd}
                suffix={` ${speedUnit}`}
                locale={locale}
              />
            }
            label={t('driveDetail.maxSpeed', 'Max Speed')}
          />
        </StaggerItem>
        <StaggerItem width={cellWidth}>
          <IconStatCard
            iconName="trendUp"
            color="#10b981"
            value={
              <AnimatedNumber
                value={stats.avgSpd}
                suffix={` ${speedUnit}`}
                locale={locale}
              />
            }
            label={t('driveDetail.avgSpeed', 'Avg Speed')}
          />
        </StaggerItem>
        <StaggerItem width={cellWidth}>
          <IconStatCard
            iconName="battery"
            color="#10b981"
            value={`${fmtInt(drive.startBatteryPct, locale)}% \u2192 ${fmtInt(
              drive.endBatteryPct,
              locale,
            )}%`}
            label={t('driveDetail.soc', 'SOC')}
          />
        </StaggerItem>
        <StaggerItem width={cellWidth}>
          <IconStatCard
            iconName="bolt"
            color="#f59e0b"
            value={fmtWithUnit(stats.powerMax, 'kW', globalPrecision, locale)}
            label={t('driveDetail.maxPower', 'Max Power')}
          />
        </StaggerItem>
        <StaggerItem width={cellWidth}>
          <IconStatCard
            iconName="navigation"
            color="#10b981"
            value={
              <AnimatedNumber
                value={Math.round(stats.elevGain)}
                suffix={' m \u2191'}
                locale={locale}
              />
            }
            label={t('driveDetail.elevGain', 'Elev. Gain')}
          />
        </StaggerItem>
        <StaggerItem width={cellWidth}>
          <IconStatCard
            iconName="navigation"
            color="#ef4444"
            value={
              <AnimatedNumber
                value={Math.round(stats.elevLoss)}
                suffix={' m \u2193'}
                locale={locale}
              />
            }
            label={t('driveDetail.elevLoss', 'Elev. Loss')}
          />
        </StaggerItem>
        {stats.energyWh > 0 && (
          <StaggerItem width={cellWidth}>
            <IconStatCard
              iconName="dollarSign"
              color="#10b981"
              value={formatEnergyCost(stats.energyWh / 1000)}
              label={t('driveDetail.tripCost', 'Trip Cost')}
            />
          </StaggerItem>
        )}
        {stats.energyWh > 0 && drive.distanceM > 0 && (
          <StaggerItem width={cellWidth}>
            <IconStatCard
              iconName="trendDown"
              color="#06b6d4"
              value={formatCurrency(
                costPerDistanceUnit(stats.energyWh / 1000, drive.distanceM) ?? 0,
                3,
              )}
              label={costPerUnitLabel}
            />
          </StaggerItem>
        )}
      </StaggerContainer>

      {/* Battery Heater Status — field removed from new API */}
    </>
  );
}

DriveStatCards.displayName = 'DriveStatCards';

const styles = StyleSheet.create({
  // grid grid-cols-2 ... gap-3: flex-wrap row with a negative-margin gutter.
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -HALF_GAP,
  },
  cell: {
    padding: HALF_GAP,
  },
  // GlassPanel p-4 text-center.
  card: {
    padding: 16,
    alignItems: 'center',
  },
  // lucide h-4 w-4 mx-auto mb-1 + the inline style={{ color }} tint.
  cardIcon: {
    fontSize: 13,
    lineHeight: 16,
    letterSpacing: 0.4,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  // p text-lg font-bold text-[var(--text-primary)].
  cardValue: {
    fontSize: 18,
    lineHeight: 24,
    textAlign: 'center',
    color: colors.textPrimary,
  },
  // p text-[10px] text-[var(--text-muted)].
  cardLabel: {
    fontSize: 10,
    lineHeight: 14,
    textAlign: 'center',
  },
  // span tabular-nums (size/weight/colour inherited from the value AppText).
  tabularNums: {
    fontVariant: ['tabular-nums'],
  },
});
