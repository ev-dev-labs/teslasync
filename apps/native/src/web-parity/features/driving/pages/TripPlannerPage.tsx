// Native parity port of web/src/features/driving/pages/TripPlannerPage.tsx.
//
// Trip Planner page for the selected vehicle. Plans a route with range
// estimation + charging stops via the driving mutation:
//   - POST /api/v1/trip-planner/plan (usePlanTrip -> TripPlan) computes the
//     route summary, per-leg breakdown, charge stops, weather impact and the
//     SOC-along-route curve from the origin/destination + SOC/speed inputs.
//   - GET  /api/v1/geocode/search?q= (useGeocodeSearch) backs the two address
//     autocomplete inputs.
//   - POST /api/v1/vehicles/{id}/command (request) fires the navigation_request
//     "Send to Car" command.
//
// Every web behavior, state name, API path, unit-handling rule and i18n key is
// preserved; the web DOM / Tailwind / Recharts / Leaflet / lucide stack is
// replaced with React Native primitives + the native parity component library,
// following the DriveScorePage precedent:
//
//   - `@/components/layout` PageContainer (title/subtitle/actions) has no native
//     parity component, so a local ScrollView screen scaffold reproduces the
//     header (title + subtitle), the `actions` row (VehicleSelect) and wraps the
//     body in the native ErrorBoundary (== PageContainer's PageErrorBoundary).
//     Grid -> native flex-wrap rows.
//   - `@/hooks/useSelectedVehicle` -> useVehicles() + a first-vehicle default +
//     a header NativeSelect (== the web VehicleSelect), exposing the same
//     `vehicleId` + `currentVehicle` the web hook returned.
//   - `@/components/ui` GlassPanel reuses the native parity GlassPanel; Button ->
//     native parity Button; Select / Slider have no native parity, so a local
//     NativeSelect (dropdown) + SocSlider (PanResponder single-thumb, the same
//     RangeSlider technique) reproduce them. The web Select `onChange(e)` ->
//     `onChange(value)` (no synthetic DOM event on native).
//   - `@/components/data-display` StatCard -> native parity StatCard.
//   - `@/components/feedback` AlertBanner -> a local tinted banner; EmptyState ->
//     native parity EmptyState.
//   - `@/components/motion` FadeIn -> a reduced-motion-aware FadeIn honouring the
//     per-section delay.
//   - `@/components/ai/AITripPlannerLLMAgent` reuses the native parity agent
//     (off mode renders nothing, exactly as the web ADR-015 contract).
//   - The four sibling sub-components (AddressInput, TripPlannerMap,
//     SOCRouteChart, TripLegList) have no native files yet, so native-safe
//     equivalents are inlined here (documented in the sidecar): AddressInput is a
//     TextInput + debounced useGeocodeSearch suggestion list; TripPlannerMap (web
//     react-leaflet, browser-only) degrades to a route summary panel listing the
//     origin/destination/charge-stop markers with an explicit "interactive map
//     unavailable on native" note; SOCRouteChart (web Recharts AreaChart) degrades
//     to a native proportional bar chart with the min-arrival reference + charge
//     stop markers; TripLegList is ported verbatim as native leg/charge cards.
//   - `@/hooks/usePageTitle` (document.title) -> native no-op shim.
//   - `@/hooks/useUnits` + `@/hooks/useFormatting` + `@/lib/unitConversion`
//     convertDistanceFromSI / formatEnergy + `@/lib/numberFormat` fmtNumber ->
//     native shims mirroring the web out-of-box defaults (distance 'km', energy
//     'kWh', currency '$', precision 2). The API returns SI; conversion happens
//     at the display boundary, exactly as the web hooks do.
//   - react-i18next useTranslation -> a local t(key, fallbackOrVars?, vars?) shim
//     mirroring i18next's flexible signature so every key + English copy +
//     `{{level}}/{{factor}}` interpolation are preserved verbatim.
//   - lucide-react icons (Navigation/Zap/Clock/Route/Battery/DollarSign/
//     Thermometer/Send/AlertTriangle/MapPin/ArrowRight) are decorative; rendered
//     as colour-coded glyph AppText (the visible labels carry the meaning).

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
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type AccessibilityActionEvent,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {request} from '../../../api/client';
import {
  useGeocodeSearch,
  usePlanTrip,
  type GeocodeResult,
  type TripChargeStop,
  type TripLeg,
  type TripLocation,
  type TripPlan,
  type TripPlanRequest,
  type TripSOCPoint,
  type TripWeatherImpact,
} from '../../../api/hooks/useDriving';
import {useVehicles, type Vehicle} from '../../../api/hooks/useVehicles';
import {AITripPlannerLLMAgent} from '../../../components/ai/AITripPlannerLLMAgent';
import {StatCard} from '../../../components/data-display/StatCard';
import {ErrorBoundary} from '../../../components/feedback/ErrorBoundary';
import {Button} from '../../../components/ui/Button';
import {GlassPanel} from '../../../components/ui/GlassPanel';

/* ─── web colour literals (preserved verbatim for visual intent) ───────────── */

const FALLBACK = '\u2014';
const EMERALD = '#34d399'; // emerald-400 (origin / navigation)
const ROSE = '#fb7185'; // rose-400 (destination / low SOC)
const AMBER = '#fbbf24'; // amber-400 (warnings / arrival SOC)
const BLUE = '#3b82f6'; // blue-500 (charge stops)
const SOC_GREEN = '#22c55e';
const SOC_YELLOW = '#eab308';
const SOC_RED = '#ef4444';
const SURFACE_2 = '#151621';

// Decorative lucide glyph stand-ins (labels carry the actual meaning).
const GLYPH = {
  navigation: '\uD83E\uDDED', // 🧭
  zap: '\u26A1', // ⚡
  clock: '\u23F1\uFE0F', // ⏱️
  route: '\uD83D\uDEE3\uFE0F', // 🛣️
  battery: '\uD83D\uDD0B', // 🔋
  dollar: '\uD83D\uDCB2', // 💲
  thermometer: '\uD83C\uDF21\uFE0F', // 🌡️
  send: '\uD83D\uDCE4', // 📤
  alert: '\u26A0\uFE0F', // ⚠️
  pin: '\uD83D\uDCCD', // 📍
  arrow: '\u2192', // →
} as const;

/* ─── i18n fallback shim (web `react-i18next` is unavailable in native) ────── */

type TranslationVars = Record<string, string | number> & {
  defaultValue?: string;
};
type NativeTFunction = (
  key: string,
  fallbackOrVars?: string | TranslationVars,
  vars?: TranslationVars,
) => string;

function interpolate(template: string, vars?: TranslationVars): string {
  if (vars == null) {
    return template;
  }
  return template.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name)
      ? String(vars[name])
      : match,
  );
}

function useNativeTranslation(): NativeTFunction {
  return useCallback((key, fallbackOrVars, vars) => {
    if (typeof fallbackOrVars === 'string') {
      return interpolate(fallbackOrVars, vars);
    }
    if (fallbackOrVars != null && typeof fallbackOrVars === 'object') {
      const fallback =
        typeof fallbackOrVars.defaultValue === 'string'
          ? fallbackOrVars.defaultValue
          : key;
      return interpolate(fallback, fallbackOrVars);
    }
    return key;
  }, []);
}

/* ─── usePageTitle (web sets document.title; native has no document) ────────── */

function usePageTitle(_title: string): void {
  // no-op: React Native has no document.title to drive.
}

/* ─── native unit / number shims (web `@/hooks/useUnits` + `useFormatting`) ─── */

const METERS_PER_KM = 1000;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function safeNumber(v: unknown): number {
  return isFiniteNumber(v) ? v : 0;
}

// Mirrors web `@/lib/numberFormat` fmtNumber (locale-aware fixed precision).
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

// Mirrors web `convertDistanceFromSI` for the out-of-box 'km' default.
function convertDistanceFromSI(meters: number): number {
  return meters / METERS_PER_KM;
}

// Mirrors web `useUnits().formatEnergy` with the default energy pref 'kWh'
// (SI watt-hours -> kWh) and DEFAULT_PRECISION.energy = 2.
function formatEnergyWh(
  wh: number | null | undefined,
  options?: {precision?: number},
): string {
  if (!isFiniteNumber(wh)) {
    return FALLBACK;
  }
  const digits = options?.precision ?? 2;
  return `${fmtNumber(wh / 1000, digits)} kWh`;
}

// Mirrors web `useFormatting().formatCurrency` (default symbol '$', precision 2).
function formatCurrencyUsd(amount: number, decimals = 2): string {
  return `$${fmtNumber(amount, decimals)}`;
}

interface UseUnitsResult {
  unitPrefs: {distance: 'km' | 'mi' | 'ft'};
  formatEnergy: (
    value: number | null | undefined,
    options?: {precision?: number},
  ) => string;
}

// The native parity layer has no settings store wired in, so the hook mirrors
// the web out-of-box defaults (distance 'km', energy 'kWh').
function useUnits(): UseUnitsResult {
  return useMemo<UseUnitsResult>(
    () => ({unitPrefs: {distance: 'km'}, formatEnergy: formatEnergyWh}),
    [],
  );
}

interface UseFormattingResult {
  formatCurrency: (amount: number, decimals?: number) => string;
}

function useFormatting(): UseFormattingResult {
  return useMemo<UseFormattingResult>(
    () => ({formatCurrency: formatCurrencyUsd}),
    [],
  );
}

/* ─── reduced-motion + FadeIn (web `@/components/motion`) ───────────────────── */

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

function FadeIn({
  children,
  delay = 0,
  style,
}: {
  children: ReactNode;
  delay?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduceMotion = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const animation = Animated.timing(progress, {
      delay: delay * 1000,
      duration: 320,
      easing: Easing.out(Easing.quad),
      toValue: 1,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [delay, progress, reduceMotion]);

  const animatedStyle = {
    opacity: progress,
    transform: [
      {
        translateY: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [8, 0],
        }),
      },
    ],
  };

  return (
    <Animated.View style={[animatedStyle, style]}>{children}</Animated.View>
  );
}

FadeIn.displayName = 'FadeIn';

/* ─── decorative glyph (web lucide icons) ──────────────────────────────────── */

function IconGlyph({
  char,
  color,
  size = 14,
}: {
  char: string;
  color?: string;
  size?: number;
}) {
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[styles.glyph, {fontSize: size}, color ? {color} : null]}>
      {char}
    </AppText>
  );
}

IconGlyph.displayName = 'IconGlyph';

/* ─── AlertBanner (web `@/components/feedback` AlertBanner variant="danger") ── */

function AlertBanner({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View accessibilityRole="alert" style={[styles.alertBanner, style]}>
      <IconGlyph char={GLYPH.alert} />
      <AppText style={styles.alertText}>{children}</AppText>
    </View>
  );
}

AlertBanner.displayName = 'AlertBanner';

/* ─── SocSlider (web `@/components/ui` Slider — single thumb) ───────────────── */

function SocSlider({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  formatValue,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  formatValue?: (n: number) => string;
}) {
  const range = max - min;
  const display = formatValue ? formatValue(value) : String(value);

  const clampToStep = useCallback(
    (raw: number) => {
      if (max <= min) {
        return min;
      }
      const stepped =
        step > 0 ? Math.round((raw - min) / step) * step + min : raw;
      return Math.max(min, Math.min(max, stepped));
    },
    [max, min, step],
  );

  const trackWidthRef = useRef(0);
  const dragStartRef = useRef(value);
  const stateRef = useRef({value, range, clampToStep, onChange});
  stateRef.current = {value, range, clampToStep, onChange};

  const onTrackLayout = useCallback((e: LayoutChangeEvent) => {
    trackWidthRef.current = e.nativeEvent.layout.width;
  }, []);

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        dragStartRef.current = stateRef.current.value;
      },
      onPanResponderMove: (_evt, gesture) => {
        const width = trackWidthRef.current;
        const span = stateRef.current.range;
        if (width <= 0 || span <= 0) {
          return;
        }
        const delta = (gesture.dx / width) * span;
        const next = stateRef.current.clampToStep(dragStartRef.current + delta);
        stateRef.current.onChange(next);
      },
    }),
  ).current;

  const onAction = useCallback(
    (event: AccessibilityActionEvent) => {
      const action = event.nativeEvent.actionName;
      if (action === 'increment') {
        onChange(clampToStep(value + step));
      } else if (action === 'decrement') {
        onChange(clampToStep(value - step));
      }
    },
    [clampToStep, onChange, step, value],
  );

  const pct =
    range > 0 ? Math.max(0, Math.min(100, ((value - min) / range) * 100)) : 0;

  return (
    <View style={styles.sliderRoot}>
      <View style={styles.sliderLabelRow}>
        <AppText style={styles.sliderLabel} tone="secondary">
          {label}
        </AppText>
        <AppText style={styles.sliderValue} tone="muted">
          {display}
        </AppText>
      </View>
      <View
        accessibilityActions={[{name: 'increment'}, {name: 'decrement'}]}
        accessibilityLabel={label}
        accessibilityRole="adjustable"
        accessibilityValue={{max, min, now: value, text: display}}
        collapsable={false}
        onAccessibilityAction={onAction}
        onLayout={onTrackLayout}
        style={styles.sliderTrack}
        {...responder.panHandlers}>
        <View style={[styles.sliderFill, {width: `${pct}%`}]} />
        <View style={[styles.sliderThumb, {left: `${pct}%`}]} />
      </View>
    </View>
  );
}

SocSlider.displayName = 'SocSlider';

/* ─── NativeSelect (web `@/components/ui` Select + `@/components/forms`
       VehicleSelect picker) ─────────────────────────────────────────────────── */

interface NativeSelectOption {
  value: string;
  label: string;
}

function NativeSelect({
  value,
  options,
  onChange,
  label,
  accessibilityLabel,
}: {
  value: string;
  options: NativeSelectOption[];
  onChange: (value: string) => void;
  label?: string;
  accessibilityLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => o.value === value);

  return (
    <View style={styles.select}>
      {label ? (
        <AppText style={styles.sliderLabel} tone="secondary">
          {label}
        </AppText>
      ) : null}
      <Pressable
        accessibilityHint="Opens the option list"
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{expanded: open}}
        onPress={() => setOpen(prev => !prev)}
        style={({pressed}) => [styles.selectTrigger, pressed && styles.pressed]}>
        <AppText numberOfLines={1} style={styles.selectValue}>
          {selected ? selected.label : FALLBACK}
        </AppText>
        <AppText style={styles.selectChevron} tone="muted">
          {open ? '\u25B4' : '\u25BE'}
        </AppText>
      </Pressable>
      {open ? (
        <View style={styles.selectList}>
          {options.map(option => {
            const isSelected = option.value === value;
            return (
              <Pressable
                accessibilityLabel={option.label}
                accessibilityRole="button"
                accessibilityState={{selected: isSelected}}
                key={option.value}
                onPress={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                style={({pressed}) => [
                  styles.selectOption,
                  isSelected && styles.selectOptionSelected,
                  pressed && styles.pressed,
                ]}>
                <AppText
                  numberOfLines={1}
                  tone={isSelected ? 'accent' : 'primary'}>
                  {option.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

NativeSelect.displayName = 'NativeSelect';

/* ─── AddressInput (web `../components/AddressInput` Combobox geocoder) ─────── */

function AddressInput({
  value,
  onChange,
  onSelect,
  placeholder,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  onSelect: (location: TripLocation) => void;
  placeholder?: string;
  label?: string;
}) {
  const t = useNativeTranslation();
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [focused, setFocused] = useState(false);

  // Debounce typed input -> geocode-search query (400ms), exactly as the web.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(value), 400);
    return () => clearTimeout(id);
  }, [value]);

  const {data: results, isLoading} = useGeocodeSearch(debouncedQuery);

  const handleSelect = useCallback(
    (result: GeocodeResult | null) => {
      if (!result) {
        return;
      }
      onChange(result.display_name);
      onSelect({lat: result.lat, lng: result.lng, name: result.display_name});
      setFocused(false);
    },
    [onChange, onSelect],
  );

  const options = results ?? [];
  const showList = focused && debouncedQuery.length >= 3;

  return (
    <View style={styles.addressRoot}>
      <AppText style={styles.sliderLabel} tone="secondary">
        {label ?? t('addressInput.label', 'Address')}
      </AppText>
      <View style={styles.addressInputRow}>
        <IconGlyph char={GLYPH.pin} color={colors.textMuted} />
        <TextInput
          accessibilityLabel={label ?? t('addressInput.label', 'Address')}
          onBlur={() => setFocused(false)}
          onChangeText={onChange}
          onFocus={() => setFocused(true)}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          style={styles.addressInput}
          value={value}
        />
      </View>
      {showList ? (
        <View style={styles.addressList}>
          {isLoading ? (
            <AppText style={styles.addressLoading} tone="muted">
              {t('common.loading', 'Loading...')}
            </AppText>
          ) : options.length === 0 ? (
            <AppText style={styles.addressLoading} tone="muted">
              {t('addressInput.noResults', 'No matches')}
            </AppText>
          ) : (
            options.slice(0, 5).map(result => (
              <Pressable
                accessibilityRole="button"
                key={`${result.lat}-${result.lng}-${result.display_name}`}
                onPress={() => handleSelect(result)}
                style={({pressed}) => [
                  styles.addressOption,
                  pressed && styles.pressed,
                ]}>
                <IconGlyph char={GLYPH.pin} color={colors.textMuted} />
                <AppText numberOfLines={2} style={styles.addressOptionText}>
                  {result.display_name}
                </AppText>
              </Pressable>
            ))
          )}
        </View>
      ) : null}
    </View>
  );
}

AddressInput.displayName = 'AddressInput';

/* ─── TripPlannerMap (web `../components/TripPlannerMap` react-leaflet) ─────── */
//
// react-leaflet / Leaflet are browser-only (DOM tiles + pan/zoom) and have no
// core-RN analog (no react-native-maps dependency here), so the interactive map
// degrades to a native-safe route summary: the origin/destination markers, the
// polyline point count, and the charge-stop markers are listed with the same
// colour semantics. The "interactive map unavailable on native" state is made
// explicit. All map data (origin/destination/legs/chargeStops) is still
// surfaced, mirroring the web markers/popups content.

function TripPlannerMap({
  origin,
  destination,
  legs,
  chargeStops,
}: {
  origin: TripLocation | null;
  destination: TripLocation | null;
  legs: TripLeg[];
  chargeStops: TripChargeStop[];
}) {
  const t = useNativeTranslation();

  const polylinePoints = useMemo(() => {
    if ((legs ?? []).length === 0 && origin && destination) {
      return [
        [origin.lat, origin.lng],
        [destination.lat, destination.lng],
      ] as Array<[number, number]>;
    }
    const points: Array<[number, number]> = [];
    for (const leg of legs ?? []) {
      if (points.length === 0) {
        points.push([leg.from.lat, leg.from.lng]);
      }
      points.push([leg.to.lat, leg.to.lng]);
    }
    return points;
  }, [legs, origin, destination]);

  const stops = chargeStops ?? [];
  const hasData = origin != null || destination != null;

  return (
    <GlassPanel style={styles.mapPanel}>
      {hasData ? (
        <View style={styles.mapBody}>
          <AppText style={styles.mapUnavailable} tone="muted">
            {t(
              'tripPlanner.map.nativeUnavailable',
              'Interactive map unavailable on native — route summary shown below.',
            )}
          </AppText>
          {origin ? (
            <View style={styles.mapMarkerRow}>
              <View style={[styles.mapDot, {backgroundColor: SOC_GREEN}]} />
              <AppText numberOfLines={1} style={styles.mapMarkerText}>
                {origin.name || t('tripPlanner.map.origin', 'Origin')}
              </AppText>
            </View>
          ) : null}
          {destination ? (
            <View style={styles.mapMarkerRow}>
              <View style={[styles.mapDot, {backgroundColor: SOC_RED}]} />
              <AppText numberOfLines={1} style={styles.mapMarkerText}>
                {destination.name ||
                  t('tripPlanner.map.destination', 'Destination')}
              </AppText>
            </View>
          ) : null}
          {polylinePoints.length >= 2 ? (
            <View style={styles.mapMarkerRow}>
              <View style={[styles.mapDot, {backgroundColor: BLUE}]} />
              <AppText numberOfLines={1} style={styles.mapMarkerText} tone="muted">
                {t('tripPlanner.map.route', 'Route')} ({polylinePoints.length})
              </AppText>
            </View>
          ) : null}
          {stops.map((stop, idx) => (
            <View key={`stop-${idx}`} style={styles.mapMarkerRow}>
              <View style={[styles.mapDot, {backgroundColor: BLUE}]} />
              <AppText numberOfLines={1} style={styles.mapMarkerText}>
                {stop.name}{' '}
                <AppText tone="muted">
                  {Math.round(stop.charge_from_soc)}% {GLYPH.arrow}{' '}
                  {Math.round(stop.charge_to_soc)}% (
                  {Math.round(stop.charge_duration_s / 60)} min)
                </AppText>
              </AppText>
            </View>
          ))}
        </View>
      ) : (
        <View style={styles.mapEmpty}>
          <EmptyState
            message={t(
              'tripPlanner.map.empty',
              'Enter origin and destination to see the route',
            )}
            title={t('tripPlanner.map.title', 'Route')}
          />
        </View>
      )}
    </GlassPanel>
  );
}

TripPlannerMap.displayName = 'TripPlannerMap';

/* ─── SOCRouteChart (web `../components/SOCRouteChart` Recharts AreaChart) ──── */
//
// The web Recharts AreaChart (SVG gradient area + axis + tooltip + reference
// lines) is browser/SVG-only, so it degrades to a native proportional bar chart:
// the SOC curve is sampled into bars whose height ∝ soc/100, colour-coded by SOC
// level (green/amber/red, mirroring the web gradient), with a dashed min-arrival
// reference line behind the bars and the charge-stop distances listed as marks.

const SOC_CHART_HEIGHT = 140;
const SOC_MAX_BARS = 36;

function socColor(soc: number): string {
  if (soc >= 50) {
    return SOC_GREEN;
  }
  if (soc >= 20) {
    return SOC_YELLOW;
  }
  return SOC_RED;
}

function SOCRouteChart({
  socCurve,
  chargeStops,
  minArrivalSOC,
}: {
  socCurve: TripSOCPoint[];
  chargeStops: TripChargeStop[];
  minArrivalSOC: number;
}) {
  const t = useNativeTranslation();

  const chartData = useMemo(
    () =>
      (socCurve ?? []).map(pt => ({
        distance: Math.round(pt.distance_m * 10) / 10,
        soc: Math.round(pt.soc * 10) / 10,
      })),
    [socCurve],
  );

  // Charge stop distances for reference markers — ported verbatim from the web.
  const stopDistances = useMemo(() => {
    const distances: number[] = [];
    let cumDist = 0;
    for (const stop of chargeStops ?? []) {
      const matchPt = (socCurve ?? []).find(
        pt =>
          pt.distance_m > cumDist &&
          Math.abs(pt.soc - stop.charge_from_soc) < 5,
      );
      if (matchPt) {
        distances.push(Math.round(matchPt.distance_m));
        cumDist = matchPt.distance_m;
      }
    }
    return distances;
  }, [socCurve, chargeStops]);

  // Downsample so a long curve still renders as a readable bar row.
  const bars = useMemo(() => {
    if (chartData.length <= SOC_MAX_BARS) {
      return chartData;
    }
    const stride = Math.ceil(chartData.length / SOC_MAX_BARS);
    return chartData.filter((_, i) => i % stride === 0);
  }, [chartData]);

  const minLineTop =
    SOC_CHART_HEIGHT * (1 - Math.max(0, Math.min(100, minArrivalSOC)) / 100);

  if (chartData.length === 0) {
    return (
      <GlassPanel style={styles.chartPanel}>
        <AppText style={styles.panelTitle} weight="semibold">
          {t('tripPlanner.socChart.title', 'Battery Along Route')}
        </AppText>
        <EmptyState
          message={t(
            'tripPlanner.socChart.empty',
            'Plan a trip to see the SOC curve',
          )}
          title={t('tripPlanner.socChart.title', 'Battery Along Route')}
        />
      </GlassPanel>
    );
  }

  return (
    <GlassPanel style={styles.chartPanel}>
      <AppText style={styles.panelTitle} weight="semibold">
        {t('tripPlanner.socChart.title', 'Battery Along Route')}
      </AppText>
      <View style={styles.socChartRow}>
        <View style={styles.socAxis}>
          <AppText style={styles.socAxisLabel} tone="muted">
            100
          </AppText>
          <AppText style={styles.socAxisLabel} tone="muted">
            {t('tripPlanner.socChart.col.soc', 'SOC %')}
          </AppText>
          <AppText style={styles.socAxisLabel} tone="muted">
            0
          </AppText>
        </View>
        <View style={[styles.socPlot, {height: SOC_CHART_HEIGHT}]}>
          {/* Min arrival SOC reference line. */}
          <View
            style={[styles.socRefLine, {top: minLineTop}]}
            pointerEvents="none">
            <AppText style={styles.socRefLabel}>
              {t('tripPlanner.socChart.min', 'Min {{n}}%', {n: minArrivalSOC})}
            </AppText>
          </View>
          <ScrollView
            horizontal
            contentContainerStyle={styles.socBars}
            showsHorizontalScrollIndicator={false}>
            {bars.map((bar, idx) => (
              <View
                accessibilityLabel={`${bar.distance} km, ${bar.soc}%`}
                key={`soc-${idx}`}
                style={[
                  styles.socBar,
                  {
                    backgroundColor: socColor(bar.soc),
                    height: Math.max(
                      2,
                      (Math.max(0, Math.min(100, bar.soc)) / 100) *
                        SOC_CHART_HEIGHT,
                    ),
                  },
                ]}
              />
            ))}
          </ScrollView>
        </View>
      </View>
      {stopDistances.length > 0 ? (
        <View style={styles.socStops}>
          {stopDistances.map((dist, i) => (
            <View key={`stopmark-${i}`} style={styles.socStopChip}>
              <IconGlyph char={GLYPH.zap} color={BLUE} size={11} />
              <AppText style={styles.socStopText} tone="muted">
                {t('tripPlanner.socChart.stop', 'Stop {{n}}', {n: i + 1})} ·{' '}
                {dist} km
              </AppText>
            </View>
          ))}
        </View>
      ) : null}
      <AppText style={styles.socFootnote} tone="muted">
        {t('tripPlanner.socChart.col.distance', 'Distance')} (km)
      </AppText>
    </GlassPanel>
  );
}

SOCRouteChart.displayName = 'SOCRouteChart';

/* ─── TripLegList (web `../components/TripLegList`) ─────────────────────────── */

function TripLegList({
  legs,
  chargeStops,
}: {
  legs: TripLeg[];
  chargeStops: TripChargeStop[];
}) {
  const t = useNativeTranslation();
  const {unitPrefs, formatEnergy} = useUnits();
  const {formatCurrency} = useFormatting();
  const toDistanceDisplay = (value: number) => convertDistanceFromSI(value);

  const distanceUnit = unitPrefs.distance;
  const legItems = legs ?? [];
  const stops = chargeStops ?? [];

  if (legItems.length === 0) {
    return (
      <GlassPanel style={styles.panel}>
        <AppText style={styles.panelTitle} weight="semibold">
          {t('tripPlanner.legs.title', 'Route Breakdown')}
        </AppText>
        <EmptyState
          message={t(
            'tripPlanner.legs.empty',
            'Plan a trip to see the route breakdown',
          )}
          title={t('tripPlanner.legs.title', 'Route Breakdown')}
        />
      </GlassPanel>
    );
  }

  return (
    <GlassPanel style={styles.panel}>
      <AppText style={styles.panelTitle} weight="semibold">
        {t('tripPlanner.legs.title', 'Route Breakdown')}
      </AppText>
      <View style={styles.legStack}>
        {legItems.map((leg, idx) => (
          <FadeIn delay={idx * 0.03} key={idx}>
            <View style={styles.legCard}>
              <View style={styles.legHeader}>
                <View style={styles.legBadge}>
                  <AppText style={styles.legBadgeText} weight="bold">
                    {idx + 1}
                  </AppText>
                </View>
                <View style={styles.legRouteRow}>
                  <IconGlyph char={GLYPH.pin} color={EMERALD} size={12} />
                  <AppText numberOfLines={1} style={styles.legRouteText} tone="secondary">
                    {leg.from.name ||
                      `${leg.from.lat.toFixed(2)}, ${leg.from.lng.toFixed(2)}`}
                  </AppText>
                  <IconGlyph char={GLYPH.arrow} color={colors.textMuted} size={12} />
                  <IconGlyph char={GLYPH.pin} color={ROSE} size={12} />
                  <AppText numberOfLines={1} style={styles.legRouteText} tone="secondary">
                    {leg.to.name ||
                      `${leg.to.lat.toFixed(2)}, ${leg.to.lng.toFixed(2)}`}
                  </AppText>
                </View>
              </View>
              <View style={styles.legMetrics}>
                <View style={styles.legMetric}>
                  <AppText style={styles.legMetricLabel} tone="muted">
                    {t('tripPlanner.legs.distance', 'Distance')}
                  </AppText>
                  <AppText style={styles.legMetricValue}>
                    {toDistanceDisplay(leg.distance_m).toFixed(1)} {distanceUnit}
                  </AppText>
                </View>
                <View style={styles.legMetric}>
                  <AppText style={styles.legMetricLabel} tone="muted">
                    {t('tripPlanner.legs.duration', 'Duration')}
                  </AppText>
                  <AppText style={styles.legMetricValue}>
                    {Math.round(leg.duration_s)} {t('common.min', 'min')}
                  </AppText>
                </View>
                <View style={styles.legMetric}>
                  <AppText style={styles.legMetricLabel} tone="muted">
                    {t('tripPlanner.legs.energy', 'Energy')}
                  </AppText>
                  <AppText style={styles.legMetricValue}>
                    {formatEnergy(leg.energy_wh, {precision: 1})}
                  </AppText>
                </View>
                <View style={styles.legMetric}>
                  <AppText style={styles.legMetricLabel} tone="muted">
                    {t('tripPlanner.legs.soc', 'Battery')}
                  </AppText>
                  <AppText style={styles.legMetricValue}>
                    <AppText style={{color: EMERALD}}>
                      {Math.round(leg.start_soc)}%
                    </AppText>
                    <AppText tone="muted">{` ${GLYPH.arrow} `}</AppText>
                    <AppText
                      style={{color: leg.arrival_soc < 20 ? ROSE : AMBER}}>
                      {Math.round(leg.arrival_soc)}%
                    </AppText>
                  </AppText>
                </View>
              </View>
            </View>

            {idx < stops.length ? (
              <View style={styles.stopCard}>
                <IconGlyph char={GLYPH.zap} color={BLUE} />
                <View style={styles.stopBody}>
                  <AppText style={styles.stopName} weight="semibold">
                    {stops[idx].name}
                  </AppText>
                  <View style={styles.stopMetaRow}>
                    <AppText style={styles.stopMeta} tone="secondary">
                      {GLYPH.clock}{' '}
                      {Math.round(stops[idx].charge_duration_s / 60)}{' '}
                      {t('common.min', 'min')}
                    </AppText>
                    <AppText style={styles.stopMeta} tone="secondary">
                      {Math.round(stops[idx].charge_from_soc)}% {GLYPH.arrow}{' '}
                      {Math.round(stops[idx].charge_to_soc)}%
                    </AppText>
                    <AppText style={styles.stopMeta} tone="secondary">
                      {formatEnergy(stops[idx].energy_wh, {precision: 1})}
                    </AppText>
                    <AppText style={[styles.stopMeta, {color: EMERALD}]}>
                      {formatCurrency(stops[idx].cost)}
                    </AppText>
                  </View>
                  {stops[idx].is_recommended ? (
                    <AppText style={styles.stopNote} tone="muted">
                      {t(
                        'tripPlanner.legs.recommended',
                        'Recommended stop point — actual charger locations may vary',
                      )}
                    </AppText>
                  ) : null}
                </View>
              </View>
            ) : null}
          </FadeIn>
        ))}
      </View>
    </GlassPanel>
  );
}

TripLegList.displayName = 'TripLegList';

/* ─── formatDuration (web module-scope helper, preserved verbatim) ─────────── */

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) {
    return `${m}m`;
  }
  return `${h}h ${m}m`;
}

/* ─── TripPlannerPage ──────────────────────────────────────────────────────── */

export default function TripPlannerPage() {
  const t = useNativeTranslation();
  usePageTitle(t('tripPlanner.title', 'Trip Planner'));
  const {unitPrefs, formatEnergy} = useUnits();
  const {formatCurrency} = useFormatting();
  const toDistanceDisplay = (value: number) => convertDistanceFromSI(value);

  const distanceUnit = unitPrefs.distance;

  // useSelectedVehicle parity: useVehicles() + first-vehicle default + header
  // NativeSelect (== VehicleSelect). Exposes the same vehicleId + currentVehicle.
  const vehiclesQuery = useVehicles();
  const vehicles: Vehicle[] = vehiclesQuery.data ?? [];
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(
    null,
  );
  const firstVehicleId = vehicles.length > 0 ? vehicles[0].id : null;
  useEffect(() => {
    if (selectedVehicleId == null && firstVehicleId != null) {
      setSelectedVehicleId(firstVehicleId);
    }
  }, [selectedVehicleId, firstVehicleId]);
  const vehicleId = selectedVehicleId ?? firstVehicleId;
  const currentVehicle = vehicles.find(v => v.id === vehicleId) ?? null;

  const planMutation = usePlanTrip();

  // Form state
  const [originText, setOriginText] = useState('');
  const [destText, setDestText] = useState('');
  const [origin, setOrigin] = useState<TripLocation | null>(null);
  const [destination, setDestination] = useState<TripLocation | null>(null);
  const [currentSOC, setCurrentSOC] = useState(80);
  const [minArrivalSOC, setMinArrivalSOC] = useState(20);
  const [speedFactor, setSpeedFactor] = useState(1.0);

  // Result state
  const [plan, setPlan] = useState<TripPlan | null>(null);

  const activeVehicle = vehicleId != null ? String(vehicleId) : '';

  const handlePlan = useCallback(() => {
    if (!origin || !destination || !activeVehicle) {
      return;
    }

    const req: TripPlanRequest = {
      vehicle_id: Number(activeVehicle),
      origin,
      destination,
      current_soc: currentSOC,
      charge_limit_soc: 90,
      min_arrival_soc: minArrivalSOC,
      preferences: {
        speed_factor: speedFactor,
        include_weather: true,
        prefer_superchargers: true,
      },
    };

    planMutation.mutate(req, {
      onSuccess: data => setPlan(data),
    });
  }, [
    origin,
    destination,
    activeVehicle,
    currentSOC,
    minArrivalSOC,
    speedFactor,
    planMutation,
  ]);

  const handleSendToCar = useCallback(async () => {
    if (!destination || !activeVehicle) {
      return;
    }
    try {
      await request(`/vehicles/${activeVehicle}/command`, {
        method: 'POST',
        body: JSON.stringify({
          command: 'navigation_request',
          params: {lat: destination.lat, lon: destination.lng},
        }),
      });
    } catch {
      // Error handled by mutation/toast
    }
  }, [destination, activeVehicle]);

  const canPlan = origin != null && destination != null && activeVehicle !== '';

  const speedOptions = useMemo(
    () => [
      {value: '0.8', label: t('tripPlanner.speed.relaxed', 'Relaxed (\u221220%)')},
      {value: '1.0', label: t('tripPlanner.speed.normal', 'Normal')},
      {value: '1.1', label: t('tripPlanner.speed.brisk', 'Brisk (+10%)')},
      {value: '1.2', label: t('tripPlanner.speed.fast', 'Fast (+20%)')},
    ],
    [t],
  );

  const vehicleOptions: NativeSelectOption[] = vehicles.map(v => ({
    value: String(v.id),
    label:
      v.display_name ??
      v.displayName ??
      `${t('common.vehicle', 'Vehicle')} ${v.id}`,
  }));

  const route = plan?.route;
  const legs = plan?.legs ?? [];
  const chargeStops = plan?.charge_stops ?? [];
  const weather: TripWeatherImpact | undefined = plan?.weather_impact;
  const socCurve = plan?.soc_curve ?? [];

  return (
    <ScrollView
      contentContainerStyle={styles.screenContent}
      style={styles.screen}
      testID="driving-trip-planner">
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <AppText style={styles.pageTitle} variant="title" weight="bold">
            {t('tripPlanner.title', 'Trip Planner')}
          </AppText>
          <AppText style={styles.pageSubtitle} tone="muted" variant="caption">
            {t(
              'tripPlanner.subtitle',
              'Plan your route with range estimation and charging stops',
            )}
          </AppText>
        </View>
        <View style={styles.actions}>
          <NativeSelect
            accessibilityLabel={t('common.vehicle.select', 'Select vehicle')}
            onChange={v => setSelectedVehicleId(v ? Number(v) : null)}
            options={vehicleOptions}
            value={vehicleId != null ? String(vehicleId) : ''}
          />
        </View>
      </View>

      <ErrorBoundary name="trip-planner-page">
        <View style={styles.stack}>
          {/* Opt-in AI trip-planner agent (renders only when ai_mode is
              local|cloud and the toggle is on; absent in off mode). */}
          <FadeIn>
            <AITripPlannerLLMAgent
              chargeLimitSoc={90}
              currentSoc={currentSOC}
              destination={destination}
              minArrivalSoc={minArrivalSOC}
              origin={origin}
              speedFactor={speedFactor}
              vehicleId={vehicleId ?? undefined}
            />
          </FadeIn>

          {/* Route Input Form */}
          <FadeIn>
            <GlassPanel style={styles.panel}>
              <View style={styles.panelTitleRow}>
                <IconGlyph char={GLYPH.navigation} color={EMERALD} size={16} />
                <AppText style={styles.panelTitle} weight="semibold">
                  {t('tripPlanner.form.title', 'Plan Your Trip')}
                </AppText>
              </View>

              <View style={styles.addressGrid}>
                <AddressInput
                  label={t('tripPlanner.form.from', 'From')}
                  onChange={setOriginText}
                  onSelect={setOrigin}
                  placeholder={t(
                    'tripPlanner.form.origin',
                    'Enter starting location...',
                  )}
                  value={originText}
                />
                <AddressInput
                  label={t('tripPlanner.form.to', 'To')}
                  onChange={setDestText}
                  onSelect={setDestination}
                  placeholder={t(
                    'tripPlanner.form.destination',
                    'Enter destination...',
                  )}
                  value={destText}
                />
              </View>

              <View style={styles.controlGrid}>
                <SocSlider
                  formatValue={n => `${n}%`}
                  label={t('tripPlanner.form.currentSOC', 'Current SOC')}
                  max={100}
                  min={10}
                  onChange={setCurrentSOC}
                  value={currentSOC}
                />
                <SocSlider
                  formatValue={n => `${n}%`}
                  label={t('tripPlanner.form.minArrival', 'Min Arrival SOC')}
                  max={50}
                  min={5}
                  onChange={setMinArrivalSOC}
                  value={minArrivalSOC}
                />
                <NativeSelect
                  accessibilityLabel={t(
                    'tripPlanner.form.drivingSpeed',
                    'Driving Speed',
                  )}
                  label={t('tripPlanner.form.drivingSpeed', 'Driving Speed')}
                  onChange={v => setSpeedFactor(Number(v))}
                  options={speedOptions}
                  value={String(speedFactor)}
                />
              </View>

              <View style={styles.buttonRow}>
                <Button
                  disabled={!canPlan || planMutation.isPending}
                  icon={<IconGlyph char={GLYPH.route} />}
                  onPress={handlePlan}>
                  {planMutation.isPending
                    ? t('tripPlanner.form.planning', 'Planning...')
                    : t('tripPlanner.form.planTrip', 'Plan Trip')}
                </Button>
                {plan && destination ? (
                  <Button
                    icon={<IconGlyph char={GLYPH.send} />}
                    onPress={handleSendToCar}
                    variant="secondary">
                    {t('tripPlanner.form.sendToCar', 'Send to Car')}
                  </Button>
                ) : null}
                {currentVehicle?.battery_level != null ? (
                  <View style={styles.batteryChip}>
                    <IconGlyph char={GLYPH.battery} color={colors.textMuted} size={12} />
                    <AppText style={styles.batteryText} tone="muted">
                      {t('tripPlanner.form.vehicleBattery', 'Vehicle at {{level}}%', {
                        level: currentVehicle.battery_level,
                      })}
                    </AppText>
                  </View>
                ) : null}
              </View>

              {planMutation.isError ? (
                <AlertBanner style={styles.formError}>
                  {t(
                    'tripPlanner.form.error',
                    'Failed to compute trip plan. Please try again.',
                  )}
                </AlertBanner>
              ) : null}
            </GlassPanel>
          </FadeIn>

          {/* Estimate disclaimer */}
          {route?.is_estimate ? (
            <FadeIn delay={0.02}>
              <View style={styles.disclaimer}>
                <IconGlyph char={GLYPH.alert} color={AMBER} />
                <AppText style={styles.disclaimerText}>
                  {t(
                    'tripPlanner.disclaimer',
                    "This is an estimate based on straight-line distance (\u00d71.3 driving factor) and your vehicle's historical efficiency. Actual results may vary due to route geometry, traffic, elevation, and conditions.",
                  )}
                </AppText>
              </View>
            </FadeIn>
          ) : null}

          {/* Map */}
          <FadeIn delay={0.03}>
            <TripPlannerMap
              chargeStops={chargeStops}
              destination={destination}
              legs={legs}
              origin={origin}
            />
          </FadeIn>

          {/* Trip Summary Stats */}
          {route ? (
            <FadeIn delay={0.04}>
              <View style={styles.statsRow}>
                <StatCard
                  icon={<IconGlyph char={GLYPH.route} />}
                  label={t('tripPlanner.stats.distance', 'Distance')}
                  style={styles.statItem}
                  value={`${toDistanceDisplay(route.total_distance_m).toFixed(
                    0,
                  )} ${distanceUnit}`}
                />
                <StatCard
                  icon={<IconGlyph char={GLYPH.clock} />}
                  label={t('tripPlanner.stats.totalTime', 'Total Time')}
                  style={styles.statItem}
                  value={formatDuration(route.total_duration_s / 60)}
                />
                <StatCard
                  icon={<IconGlyph char={GLYPH.navigation} />}
                  label={t('tripPlanner.stats.drivingTime', 'Driving')}
                  style={styles.statItem}
                  value={formatDuration(route.driving_duration_s / 60)}
                />
                <StatCard
                  icon={<IconGlyph char={GLYPH.zap} />}
                  label={t('tripPlanner.stats.chargingTime', 'Charging')}
                  style={styles.statItem}
                  value={
                    route.charging_duration_s > 0
                      ? formatDuration(route.charging_duration_s / 60)
                      : FALLBACK
                  }
                />
                <StatCard
                  icon={<IconGlyph char={GLYPH.battery} />}
                  label={t('tripPlanner.stats.energy', 'Energy')}
                  style={styles.statItem}
                  value={formatEnergy(route.total_energy_wh, {precision: 1})}
                />
                <StatCard
                  icon={<IconGlyph char={GLYPH.dollar} />}
                  label={t('tripPlanner.stats.cost', 'Est. Cost')}
                  style={styles.statItem}
                  value={
                    route.estimated_cost > 0
                      ? formatCurrency(route.estimated_cost)
                      : t('common.free', 'Free')
                  }
                />
              </View>
            </FadeIn>
          ) : null}

          {/* Feasibility warning */}
          {route && !route.feasible ? (
            <FadeIn delay={0.05}>
              <AlertBanner>
                {t(
                  'tripPlanner.notFeasible',
                  'This trip may not be feasible with the current battery level and available charging options. Consider starting with a higher SOC or adjusting your preferences.',
                )}
              </AlertBanner>
            </FadeIn>
          ) : null}

          {/* Weather impact */}
          {weather && weather.efficiency_factor !== 1.0 ? (
            <FadeIn delay={0.05}>
              <GlassPanel style={styles.weatherPanel}>
                <IconGlyph char={GLYPH.thermometer} color={AMBER} size={16} />
                <View style={styles.weatherBody}>
                  <AppText style={styles.weatherTitle} weight="semibold">
                    {t('tripPlanner.weather.title', 'Weather Impact')}
                  </AppText>
                  <AppText style={styles.weatherNote} tone="secondary">
                    {weather.note}
                  </AppText>
                  {weather.avg_temp_c != null ? (
                    <AppText style={styles.weatherFactor} tone="muted">
                      {t(
                        'tripPlanner.weather.factor',
                        'Efficiency factor: {{factor}}\u00d7',
                        {factor: fmtNumber(weather.efficiency_factor, 2)},
                      )}
                    </AppText>
                  ) : null}
                </View>
              </GlassPanel>
            </FadeIn>
          ) : null}

          {/* SOC Route Chart */}
          <FadeIn delay={0.06}>
            <SOCRouteChart
              chargeStops={chargeStops}
              minArrivalSOC={minArrivalSOC}
              socCurve={socCurve}
            />
          </FadeIn>

          {/* Leg-by-leg breakdown */}
          <FadeIn delay={0.07}>
            <TripLegList chargeStops={chargeStops} legs={legs} />
          </FadeIn>
        </View>
      </ErrorBoundary>
    </ScrollView>
  );
}

TripPlannerPage.displayName = 'TripPlannerPage';

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    flexShrink: 1,
    gap: spacing.sm,
  },
  addressGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  addressInput: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 15,
    padding: 0,
  },
  addressInputRow: {
    alignItems: 'center',
    backgroundColor: SURFACE_2,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  addressList: {
    backgroundColor: SURFACE_2,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: spacing.xs,
    overflow: 'hidden',
  },
  addressLoading: {
    padding: spacing.sm,
  },
  addressOption: {
    alignItems: 'flex-start',
    borderTopColor: colors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.sm,
  },
  addressOptionText: {
    flex: 1,
    fontSize: 13,
  },
  addressRoot: {
    flexBasis: '46%',
    flexGrow: 1,
    gap: spacing.xs,
    minWidth: 200,
  },
  alertBanner: {
    alignItems: 'flex-start',
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  alertText: {
    color: colors.danger,
    flex: 1,
    fontSize: 13,
  },
  batteryChip: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  batteryText: {
    fontSize: 13,
  },
  buttonRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chartPanel: {
    gap: spacing.sm,
    padding: spacing.md,
  },
  controlGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  disclaimer: {
    alignItems: 'flex-start',
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderColor: 'rgba(245, 158, 11, 0.2)',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  disclaimerText: {
    color: AMBER,
    flex: 1,
    fontSize: 13,
  },
  formError: {
    marginTop: spacing.sm,
  },
  glyph: {
    color: colors.textSecondary,
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  headerCopy: {
    flexGrow: 1,
    flexShrink: 1,
    gap: spacing.xs,
    minWidth: 200,
  },
  legBadge: {
    alignItems: 'center',
    backgroundColor: SURFACE_2,
    borderRadius: 12,
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  legBadgeText: {
    color: colors.textPrimary,
    fontSize: 12,
  },
  legCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 10,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  legHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  legMetric: {
    flexBasis: '46%',
    flexGrow: 1,
    gap: 2,
    minWidth: 120,
  },
  legMetricLabel: {
    fontSize: 11,
  },
  legMetricValue: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
  },
  legMetrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  legRouteRow: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 4,
  },
  legRouteText: {
    flexShrink: 1,
    fontSize: 13,
  },
  legStack: {
    gap: spacing.sm,
  },
  mapBody: {
    gap: spacing.sm,
    padding: spacing.md,
  },
  mapDot: {
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  mapEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 160,
    padding: spacing.lg,
  },
  mapMarkerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  mapMarkerText: {
    flex: 1,
    fontSize: 13,
  },
  mapPanel: {
    overflow: 'hidden',
  },
  mapUnavailable: {
    fontSize: 12,
    fontStyle: 'italic',
  },
  pageSubtitle: {
    lineHeight: 18,
  },
  pageTitle: {
    color: colors.textPrimary,
  },
  panel: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  panelTitle: {
    color: colors.textPrimary,
    fontSize: 16,
  },
  panelTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  pressed: {
    opacity: 0.6,
  },
  screen: {
    backgroundColor: colors.background,
    flex: 1,
  },
  screenContent: {
    padding: spacing.lg,
  },
  select: {
    gap: spacing.xs,
    minWidth: 160,
    position: 'relative',
    zIndex: 5,
  },
  selectChevron: {
    fontSize: 12,
  },
  selectList: {
    backgroundColor: SURFACE_2,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: spacing.xs,
    overflow: 'hidden',
  },
  selectOption: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  selectOptionSelected: {
    backgroundColor: colors.surfaceSelected,
  },
  selectTrigger: {
    alignItems: 'center',
    backgroundColor: SURFACE_2,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  selectValue: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14,
  },
  sliderFill: {
    backgroundColor: 'rgba(6, 182, 212, 0.6)',
    borderRadius: 3,
    height: 6,
    left: 0,
    position: 'absolute',
    top: 7,
  },
  sliderLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  sliderLabelRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  sliderRoot: {
    flexBasis: '30%',
    flexGrow: 1,
    gap: spacing.xs,
    minWidth: 140,
  },
  sliderThumb: {
    backgroundColor: '#06b6d4',
    borderRadius: 9,
    height: 18,
    marginLeft: -9,
    position: 'absolute',
    top: 1,
    width: 18,
  },
  sliderTrack: {
    backgroundColor: SURFACE_2,
    borderRadius: 3,
    height: 20,
    justifyContent: 'center',
    position: 'relative',
  },
  sliderValue: {
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  socAxis: {
    height: SOC_CHART_HEIGHT,
    justifyContent: 'space-between',
    width: 40,
  },
  socAxisLabel: {
    fontSize: 10,
  },
  socBar: {
    borderRadius: 2,
    width: 6,
  },
  socBars: {
    alignItems: 'flex-end',
    gap: 3,
    height: SOC_CHART_HEIGHT,
  },
  socChartRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  socFootnote: {
    fontSize: 11,
    textAlign: 'right',
  },
  socPlot: {
    flex: 1,
    justifyContent: 'flex-end',
    position: 'relative',
  },
  socRefLabel: {
    color: SOC_RED,
    fontSize: 10,
  },
  socRefLine: {
    borderTopColor: SOC_RED,
    borderTopWidth: 1,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  socStopChip: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  socStopText: {
    fontSize: 11,
  },
  socStops: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  stack: {
    gap: spacing.lg,
  },
  statItem: {
    flexBasis: '30%',
    flexGrow: 1,
    minWidth: 150,
  },
  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  stopBody: {
    flex: 1,
    gap: spacing.xs,
  },
  stopCard: {
    backgroundColor: 'rgba(59, 130, 246, 0.05)',
    borderColor: 'rgba(59, 130, 246, 0.2)',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    marginLeft: spacing.md,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  stopMeta: {
    fontSize: 13,
  },
  stopMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  stopName: {
    color: '#93c5fd',
    fontSize: 14,
  },
  stopNote: {
    fontSize: 11,
    fontStyle: 'italic',
  },
  weatherBody: {
    flex: 1,
    gap: spacing.xs,
  },
  weatherFactor: {
    fontSize: 11,
  },
  weatherNote: {
    fontSize: 13,
  },
  weatherPanel: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  weatherTitle: {
    color: colors.textPrimary,
    fontSize: 14,
  },
});
