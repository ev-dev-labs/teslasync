// Native parity port of
// web/src/features/driving/components/TripLegList.tsx.
//
// The web component is the Trip Planner "Route Breakdown" panel: a GlassPanel
// (p-6) with an h3 title and, when there are legs, a vertically-spaced
// (space-y-3) list of FadeIn-wrapped blocks. Each block is a rounded card
// (border-white/[0.06] / bg-white/[0.02], p-4) with a header row — a numbered
// circle badge + a truncating "from MapPin -> to MapPin" location line — above a
// 2-up (sm:4-up) metric grid: Distance in the user's unit, Duration as
// Math.round(duration_s) "min", Energy via formatEnergy, and a Battery
// start -> arrival SoC pair (arrival coloured rose-400 when < 20% else amber-400,
// start always emerald-400). After each leg whose index is < chargeStops.length a
// blue charging-stop card (Zap icon + name + a wrapping Clock/duration, SoC
// range, energy, and emerald cost detail row, plus an italic "recommended" note
// when is_recommended). When there are no legs the panel shows an EmptyState
// message instead. This native port preserves that contract 1:1 with React
// Native primitives + the existing native GlassPanel / AppText / theme tokens.
//
// Unit handling is preserved exactly: distance is converted SI-meters -> the
// user's km/mi via convertDistanceFromSI (ported verbatim) and energy via
// formatEnergy (SI watt-hours -> kWh, the web useUnits default), both informed by
// the user's settings; no new unit math is introduced. The web's odd
// Math.round(leg.duration_s) value labelled "min" (a seconds value shown as
// minutes) is preserved byte-for-byte rather than "fixed", per the faithful-port
// rule.
//
// Browser-only / not-yet-ported web dependencies are reduced explicitly and
// documented in the .parity.json sidecar:
//   - `@/components/ui` GlassPanel (web L1) -> native GlassPanel.
//   - `@/components/feedback` EmptyState (web L2) -> a local native-safe
//     message-only EmptyState (the sibling LiveMotorStatus convention; the web
//     call passes only `message`).
//   - `@/components/motion` FadeIn (web L3) -> a native Animated fade/translate
//     entry honouring AccessibilityInfo reduce-motion (the established
//     DriveTimeline / LiveMotorStatus convention); the web `delay={idx * 0.03}`
//     seconds is preserved.
//   - react-i18next `useTranslation` (web L4) -> inline native-safe
//     `useNativeTranslation()` returning t(key, fallback) = fallback ?? key (no
//     native i18next runtime); every i18n key + English default is preserved.
//   - `@/hooks/useUnits` (web L5) -> inline native-safe `useUnits()` deriving the
//     consumed {distance, energy, locale, precision} pref from the web-parity
//     `useSettings()` query exactly as the web hook does (unit_of_length 'mi' ->
//     'mi' else 'km'; energy default 'kWh'; locale settings.locale || 'en-US';
//     precision floor(settings.decimal_precision) when valid) and exposing the
//     consumed `formatEnergy` (ports lib/unitConversion formatEnergy +
//     convertEnergyFromSI + formatNumber + resolvePrecision verbatim, Intl with a
//     toFixed fallback for native safety).
//   - `@/hooks/useFormatting` (web L6) -> inline native-safe `useFormatting()`
//     exposing the consumed `formatCurrency` (currency_symbol || '$' +
//     fmtNumber(amount, decimals ?? floor(decimal_precision) || 2), the web
//     hook's logic verbatim; fmtNumber ported from lib/numberFormat with the
//     established en-US native default).
//   - lucide-react `MapPin` / `Zap` / `Clock` / `ArrowRight` (web L7) ->
//     text/emoji glyphs: MapPin -> GLYPH_MAP_PIN 📍 (the SummaryHeroCards
//     precedent), coloured emerald-400 (from) / rose-400 (to) like the web
//     markup; Zap -> GLYPH_ZAP ⚡ (the ChargingSection precedent) coloured
//     blue-400; Clock -> GLYPH_CLOCK 🕒 (the EnergyProductsPage precedent);
//     ArrowRight -> the colour-inheriting ARROW_RIGHT '\u2192' (->) glyph,
//     coloured text-muted like the web icon. The two literal '->' SoC separators
//     (web L81 / L102) use the same ARROW_RIGHT.
//   - `@/types/driving` `TripLeg` / `TripChargeStop` (web L8) -> the consumed
//     subset (incl. their `TripLocation`) mirrored as local interfaces (the
//     driving types module is not yet ported), field names + SI semantics
//     byte-for-byte.
//   - `@/lib/unitConversion` `convertDistanceFromSI` (web L9) -> ported verbatim
//     for the consumed 'km' | 'mi' prefs (NIST METERS_PER_KM / METERS_PER_MILE).
//
// No DOM module, browser HTML element, Recharts, Leaflet, lucide DOM SVG,
// framer-motion, or old web @/components import appears in the native output.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
} from 'react-native';

import {useSettings} from '../../../api/hooks/useSettings';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';

/* ── ported: @/types/driving TripLocation / TripLeg / TripChargeStop ───────── */

interface TripLocation {
  lat: number;
  lng: number;
  name: string;
}

interface TripLeg {
  from: TripLocation;
  to: TripLocation;
  distance_m: number;
  duration_s: number;
  energy_wh: number;
  start_soc: number;
  arrival_soc: number;
}

interface TripChargeStop {
  name: string;
  location: TripLocation;
  charge_from_soc: number;
  charge_to_soc: number;
  charge_duration_s: number;
  energy_wh: number;
  cost: number;
  is_recommended: boolean;
}

interface TripLegListProps {
  legs: TripLeg[];
  chargeStops: TripChargeStop[];
}

/* ── native-safe useTranslation (react-i18next has no native runtime) ──────── */

type NativeTFunction = (key: string, fallback?: string) => string;

function useNativeTranslation(): NativeTFunction {
  return useMemo<NativeTFunction>(() => (key, fallback) => fallback ?? key, []);
}

/* ── ported: @/lib/unitConversion convertDistanceFromSI (consumed prefs) ───── */

type DistanceUnitPref = 'km' | 'mi';
type EnergyUnitPref = 'Wh' | 'kWh';

/** 1 km = 1000 m exactly. */
const METERS_PER_KM = 1000;
/** 1 mile = 1609.344 m exactly (international yard, NIST). */
const METERS_PER_MILE = 1609.344;

function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  switch (to) {
    case 'km':
      return meters / METERS_PER_KM;
    case 'mi':
      return meters / METERS_PER_MILE;
  }
}

/** Convert SI watt-hours to the user's energy unit (web convertEnergyFromSI). */
function convertEnergyFromSI(wh: number, to: EnergyUnitPref): number {
  switch (to) {
    case 'Wh':
      return wh;
    case 'kWh':
      return wh / 1000;
  }
}

/* ── native-safe useUnits (web @/hooks/useUnits, consumed subset) ──────────── */

interface ConsumedUnitPref {
  distance: DistanceUnitPref;
  energy: EnergyUnitPref;
  locale: string;
  precision: number | undefined;
}

interface FormatOptions {
  precision?: number;
}

type EnergyFormatter = (
  value: number | null | undefined,
  options?: FormatOptions,
) => string;

/** Web useUnits DEFAULT_ENERGY_PREF — vehicle energy reads naturally in kWh. */
const DEFAULT_ENERGY_PREF: EnergyUnitPref = 'kWh';
/** Web useUnits DEFAULT_LOCALE fallback when settings.locale is absent. */
const DEFAULT_LOCALE = 'en-US';
/** Web DEFAULT_PRECISION.energy. */
const DEFAULT_ENERGY_PRECISION = 2;
/** Web DEFAULT_EMPTY_DISPLAY for nullish / NaN formatX inputs. */
const EMPTY_DISPLAY = '\u2014'; // —

function isFiniteNumber(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Web unitConversion resolvePrecision (per-call override > pref > fallback). */
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

/** Web unitConversion formatNumber (Intl) + a native-safe toFixed fallback. */
function formatNumber(
  value: number,
  locale: string | undefined,
  fractionDigits: number,
): string {
  try {
    return new Intl.NumberFormat(locale, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(value);
  } catch {
    return value.toFixed(fractionDigits);
  }
}

function useUnits(): {unitPrefs: ConsumedUnitPref; formatEnergy: EnergyFormatter} {
  const {data: settings} = useSettings();
  const unitOfLength = settings?.unit_of_length;
  const localeSetting = settings?.locale;
  const precisionSetting = settings?.decimal_precision;

  const unitPrefs = useMemo<ConsumedUnitPref>(
    () => ({
      distance: unitOfLength === 'mi' ? 'mi' : 'km',
      energy: DEFAULT_ENERGY_PREF,
      locale:
        typeof localeSetting === 'string' && localeSetting.trim().length > 0
          ? localeSetting
          : DEFAULT_LOCALE,
      precision:
        typeof precisionSetting === 'number' &&
        Number.isFinite(precisionSetting) &&
        precisionSetting >= 0
          ? Math.floor(precisionSetting)
          : undefined,
    }),
    [unitOfLength, localeSetting, precisionSetting],
  );

  const formatEnergy = useCallback<EnergyFormatter>(
    (value, options) => {
      if (!isFiniteNumber(value)) {
        return EMPTY_DISPLAY;
      }
      const digits = resolvePrecision(
        unitPrefs.precision,
        options?.precision,
        DEFAULT_ENERGY_PRECISION,
      );
      const converted = convertEnergyFromSI(value, unitPrefs.energy);
      return `${formatNumber(converted, unitPrefs.locale, digits)} ${unitPrefs.energy}`;
    },
    [unitPrefs],
  );

  return {unitPrefs, formatEnergy};
}

/* ── native-safe useFormatting (web @/hooks/useFormatting, formatCurrency) ─── */

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Web @/lib/numberFormat fmtNumber (en-US native default, toFixed fallback). */
function fmtNumber(value: unknown, decimals = 2): string {
  const n = safeNumber(value);
  try {
    return n.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return n.toFixed(decimals);
  }
}

type CurrencyFormatter = (amount: number, decimals?: number) => string;

function useFormatting(): {formatCurrency: CurrencyFormatter} {
  const {data: settings} = useSettings();
  const currencySymbol =
    settings?.currency_symbol && settings.currency_symbol.trim()
      ? settings.currency_symbol
      : '$';
  const userPrecision =
    typeof settings?.decimal_precision === 'number' &&
    Number.isFinite(settings.decimal_precision) &&
    settings.decimal_precision >= 0
      ? Math.floor(settings.decimal_precision)
      : 2;

  const formatCurrency = useCallback<CurrencyFormatter>(
    (amount, decimals) =>
      `${currencySymbol}${fmtNumber(amount, decimals ?? userPrecision)}`,
    [currencySymbol, userPrecision],
  );

  return {formatCurrency};
}

/* ── reduce-motion preference (drives the FadeIn entry animation) ──────────── */

function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;

    AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (!cancelled) {
        setReduceMotion(enabled);
      }
    });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

/* ── FadeIn (native-safe port of @/components/motion framer-motion entry) ──── */

function FadeIn({children, delay = 0}: {children: ReactNode; delay?: number}) {
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }

    progress.setValue(0);
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 400,
      delay: delay * 1000,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    });

    animation.start();
    return () => {
      animation.stop();
    };
  }, [progress, reduceMotion, delay]);

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [12, 0],
  });

  return (
    <Animated.View style={{opacity: progress, transform: [{translateY}]}}>
      {children}
    </Animated.View>
  );
}

/* ── EmptyState (native-safe port of @/components/feedback EmptyState) ──────── */

function EmptyState({message}: {message: string}) {
  return (
    <View style={styles.emptyState}>
      <AppText style={styles.emptyMessage}>{message}</AppText>
    </View>
  );
}

/* ── glyph constants (lucide-react DOM SVG icons -> text/emoji glyphs) ──────── */

// lucide-react `MapPin` -> 📍 (the SummaryHeroCards GLYPH_MAP_PIN precedent),
// coloured emerald-400 / rose-400 like the web from/to markers.
const GLYPH_MAP_PIN = '📍';
// lucide-react `Zap` -> ⚡ (the ChargingSection GLYPH_ZAP precedent).
const GLYPH_ZAP = '⚡';
// lucide-react `Clock` -> 🕒 (the EnergyProductsPage ICON_CLOCK precedent).
const GLYPH_CLOCK = '🕒';
// lucide-react `ArrowRight` + the literal SoC '→' separators -> the colour-
// inheriting rightwards-arrow glyph.
const ARROW_RIGHT = '\u2192'; // →

// Tailwind blue-400 / blue-300 + blue-500/20 border + blue-500/5 fill swatches.
const BLUE_400 = '#60a5fa';
const BLUE_300 = '#93c5fd';
const BLUE_BORDER = 'rgba(59, 130, 246, 0.2)';
const BLUE_FILL = 'rgba(59, 130, 246, 0.05)';
// bg-[var(--surface-2)] dark-theme value (the established native mapping).
const SURFACE_2 = '#151621';
// border-white/[0.06] + bg-white/[0.02] leg-card surfaces.
const CARD_BORDER = 'rgba(255, 255, 255, 0.06)';
const CARD_FILL = 'rgba(255, 255, 255, 0.02)';

/* ── ported: TripLegList (web L16-120) ─────────────────────────────────────── */

export function TripLegList({legs, chargeStops}: TripLegListProps) {
  const t = useNativeTranslation();
  const {unitPrefs, formatEnergy} = useUnits();
  const {formatCurrency} = useFormatting();
  const toDistanceDisplay = (value: number) =>
    convertDistanceFromSI(value, unitPrefs.distance);

  const distanceUnit = unitPrefs.distance;
  const legItems = legs ?? [];
  const stops = chargeStops ?? [];

  if (legItems.length === 0) {
    return (
      <GlassPanel style={styles.panel}>
        <AppText style={styles.title}>
          {t('tripPlanner.legs.title', 'Route Breakdown')}
        </AppText>
        <EmptyState
          message={t(
            'tripPlanner.legs.empty',
            'Plan a trip to see the route breakdown',
          )}
        />
      </GlassPanel>
    );
  }

  return (
    <GlassPanel style={styles.panel}>
      <AppText style={styles.title}>
        {t('tripPlanner.legs.title', 'Route Breakdown')}
      </AppText>
      <View style={styles.list}>
        {legItems.map((leg, idx) => (
          <FadeIn key={idx} delay={idx * 0.03}>
            <View style={styles.legCard}>
              {/* Leg header */}
              <View style={styles.legHeader}>
                <View style={styles.numberBadge}>
                  <AppText style={styles.numberBadgeText}>{`${idx + 1}`}</AppText>
                </View>
                <View style={styles.locationRow}>
                  <AppText style={styles.pinFrom}>{GLYPH_MAP_PIN}</AppText>
                  <AppText style={styles.locationName} numberOfLines={1}>
                    {leg.from.name ||
                      `${leg.from.lat.toFixed(2)}, ${leg.from.lng.toFixed(2)}`}
                  </AppText>
                  <AppText style={styles.arrowMuted}>{ARROW_RIGHT}</AppText>
                  <AppText style={styles.pinTo}>{GLYPH_MAP_PIN}</AppText>
                  <AppText style={styles.locationName} numberOfLines={1}>
                    {leg.to.name ||
                      `${leg.to.lat.toFixed(2)}, ${leg.to.lng.toFixed(2)}`}
                  </AppText>
                </View>
              </View>
              {/* Leg metrics */}
              <View style={styles.metricsGrid}>
                <View style={styles.metricCell}>
                  <AppText style={styles.metricLabel}>
                    {t('tripPlanner.legs.distance', 'Distance')}
                  </AppText>
                  <AppText style={styles.metricValue}>
                    {`${toDistanceDisplay(leg.distance_m).toFixed(
                      1,
                    )} ${distanceUnit}`}
                  </AppText>
                </View>
                <View style={styles.metricCell}>
                  <AppText style={styles.metricLabel}>
                    {t('tripPlanner.legs.duration', 'Duration')}
                  </AppText>
                  <AppText style={styles.metricValue}>
                    {`${Math.round(leg.duration_s)} ${t('common.min', 'min')}`}
                  </AppText>
                </View>
                <View style={styles.metricCell}>
                  <AppText style={styles.metricLabel}>
                    {t('tripPlanner.legs.energy', 'Energy')}
                  </AppText>
                  <AppText style={styles.metricValue}>
                    {formatEnergy(leg.energy_wh, {precision: 1})}
                  </AppText>
                </View>
                <View style={styles.metricCell}>
                  <AppText style={styles.metricLabel}>
                    {t('tripPlanner.legs.soc', 'Battery')}
                  </AppText>
                  <AppText style={styles.metricValue}>
                    <AppText style={styles.socStart}>
                      {`${Math.round(leg.start_soc)}%`}
                    </AppText>
                    <AppText style={styles.socArrow}>
                      {` ${ARROW_RIGHT} `}
                    </AppText>
                    <AppText
                      style={leg.arrival_soc < 20 ? styles.socLow : styles.socOk}>
                      {`${Math.round(leg.arrival_soc)}%`}
                    </AppText>
                  </AppText>
                </View>
              </View>
            </View>

            {/* Charging stop after this leg */}
            {idx < stops.length && (
              <View style={styles.chargeStop}>
                <AppText style={styles.zapGlyph}>{GLYPH_ZAP}</AppText>
                <View style={styles.chargeContent}>
                  <AppText style={styles.chargeName}>{stops[idx].name}</AppText>
                  <View style={styles.detailsRow}>
                    <View style={styles.detailDuration}>
                      <AppText style={styles.clockGlyph}>{GLYPH_CLOCK}</AppText>
                      <AppText style={styles.detailText}>
                        {`${Math.round(stops[idx].charge_duration_s / 60)} ${t(
                          'common.min',
                          'min',
                        )}`}
                      </AppText>
                    </View>
                    <AppText style={styles.detailText}>
                      {`${Math.round(stops[idx].charge_from_soc)}% ${ARROW_RIGHT} ${Math.round(
                        stops[idx].charge_to_soc,
                      )}%`}
                    </AppText>
                    <AppText style={styles.detailText}>
                      {formatEnergy(stops[idx].energy_wh, {precision: 1})}
                    </AppText>
                    <AppText style={[styles.detailText, styles.costText]}>
                      {formatCurrency(stops[idx].cost)}
                    </AppText>
                  </View>
                  {stops[idx].is_recommended && (
                    <AppText style={styles.recommended}>
                      {t(
                        'tripPlanner.legs.recommended',
                        'Recommended stop point \u2014 actual charger locations may vary',
                      )}
                    </AppText>
                  )}
                </View>
              </View>
            )}
          </FadeIn>
        ))}
      </View>
    </GlassPanel>
  );
}

TripLegList.displayName = 'TripLegList';

const styles = StyleSheet.create({
  panel: {
    padding: spacing.lg + 4, // p-6 (24)
  },
  title: {
    fontSize: 18, // text-lg
    fontWeight: '600', // font-semibold
    lineHeight: 24,
    marginBottom: spacing.md + 4, // mb-4 (16)
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xl, // py-16 (centered transient empty state)
  },
  emptyMessage: {
    color: colors.textMuted,
    fontSize: 14, // text Text variant="bodySm"
    lineHeight: 20,
    textAlign: 'center',
  },
  list: {
    rowGap: spacing.md, // space-y-3 (12)
  },
  legCard: {
    backgroundColor: CARD_FILL, // bg-white/[0.02]
    borderColor: CARD_BORDER, // border-white/[0.06]
    borderRadius: 8, // rounded-lg
    borderWidth: 1,
    padding: spacing.md + 4, // p-4 (16)
  },
  legHeader: {
    alignItems: 'center',
    columnGap: spacing.sm, // gap-2 (8)
    flexDirection: 'row',
    marginBottom: spacing.md, // mb-3 (12)
  },
  numberBadge: {
    alignItems: 'center',
    backgroundColor: SURFACE_2, // bg-[var(--surface-2)]
    borderRadius: 12, // rounded-full
    height: 24, // h-6
    justifyContent: 'center',
    width: 24, // w-6
  },
  numberBadgeText: {
    color: colors.textPrimary,
    fontSize: 12, // text-xs
    fontWeight: '700', // font-bold
    lineHeight: 16,
  },
  locationRow: {
    alignItems: 'center',
    columnGap: spacing.xs, // gap-1 (4)
    flex: 1, // min-w-0 / take the remaining row width
    flexDirection: 'row',
  },
  pinFrom: {
    color: colors.success, // text-emerald-400
    fontSize: 14, // h-3.5 w-3.5
  },
  pinTo: {
    color: colors.danger, // text-rose-400
    fontSize: 14, // h-3.5 w-3.5
  },
  arrowMuted: {
    color: colors.textMuted, // ArrowRight text-[var(--text-muted)]
    fontSize: 14, // h-3.5 w-3.5
  },
  locationName: {
    color: colors.textSecondary, // text-[var(--text-secondary)]
    flexShrink: 1, // truncate
    fontSize: 14, // text-sm
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing.md, // gap-3 (12)
  },
  metricCell: {
    rowGap: 2,
    width: '48%', // grid-cols-2 mobile breakpoint
  },
  metricLabel: {
    color: colors.textMuted, // text-[var(--text-muted)]
    fontSize: 12, // text-xs
    lineHeight: 16,
  },
  metricValue: {
    color: colors.textPrimary, // text-[var(--text-primary)]
    fontSize: 14, // text-sm
    fontWeight: '500', // font-medium
    lineHeight: 20,
  },
  socStart: {
    color: colors.success, // text-emerald-400
  },
  socArrow: {
    color: colors.textMuted, // mx-1 → (margin approximated with surrounding spaces)
  },
  socLow: {
    color: colors.danger, // text-rose-400 (arrival_soc < 20)
  },
  socOk: {
    color: colors.warning, // text-amber-400
  },
  chargeStop: {
    alignItems: 'flex-start', // items-start
    backgroundColor: BLUE_FILL, // bg-blue-500/5
    borderColor: BLUE_BORDER, // border-blue-500/20
    borderRadius: 8, // rounded-lg
    borderWidth: 1,
    columnGap: spacing.sm, // gap-2 (8)
    flexDirection: 'row',
    marginBottom: spacing.xs, // mb-1 (4)
    marginLeft: spacing.md, // ml-3 (12)
    marginTop: spacing.sm, // mt-2 (8)
    padding: spacing.md, // p-3 (12)
  },
  zapGlyph: {
    color: BLUE_400, // text-blue-400
    fontSize: 16, // h-4 w-4
    marginTop: 2, // mt-0.5
  },
  chargeContent: {
    flex: 1,
  },
  chargeName: {
    color: BLUE_300, // text-blue-300
    fontSize: 14, // text-sm
    fontWeight: '500', // font-medium
    lineHeight: 20,
  },
  detailsRow: {
    columnGap: spacing.md + 4, // gap-x-4 (16)
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.xs, // mt-1 (4)
    rowGap: spacing.xs, // gap-y-1 (4)
  },
  detailDuration: {
    alignItems: 'center',
    columnGap: spacing.xs, // gap-1 (4)
    flexDirection: 'row',
  },
  clockGlyph: {
    color: colors.textSecondary,
    fontSize: 12, // h-3 w-3
  },
  detailText: {
    color: colors.textSecondary, // text-[var(--text-secondary)]
    fontSize: 14, // text-sm
    lineHeight: 20,
  },
  costText: {
    color: colors.success, // text-emerald-400
  },
  recommended: {
    color: colors.textMuted, // text-[var(--text-muted)]
    fontSize: 12, // text-xs
    fontStyle: 'italic',
    lineHeight: 16,
    marginTop: spacing.xs, // mt-1 (4)
  },
});
