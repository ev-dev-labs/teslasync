/**
 * Native parity port of web/src/features/charging/pages/SmartChargePage.tsx.
 *
 * The web page is the "Smart Charge" planner: an opt-in AI schedule-suggestion
 * card, a charge-settings form (rate plan, target SOC, depart-by, max amps,
 * battery capacity) with a "Find Cheapest Window" optimize action, a 24-hour
 * TOU rate timeline, a three-up cost comparison (charge-now / optimized /
 * savings), a recommended-schedule detail panel with an "Apply Schedule"
 * mutation + alternative windows, and a plan-history table. It reads/writes the
 * restored `/charge-planner/*` endpoints through the canonical
 * useOptimizeCharge / useApplySchedule / useChargePlans / useRatePlans TanStack
 * Query hooks, and reads the globally-selected vehicle via useSelectedVehicle.
 *
 * This native port preserves that contract 1:1 — the same four hooks + exact
 * API paths, the verbatim `defaultDepartBy()` initializer, every state name
 * (targetSoc / departBy / ratePlanId / maxAmps / batteryCapacity / result /
 * applied / vehicleIdNum / selectedId), the `ratePlanOptions` / `chargeWindow`
 * memos, the `handleOptimize` / `handleApply` mutation flows (same request
 * bodies: vehicle_id / target_soc / depart_by ISO / rate_plan_id / max_amps /
 * battery_capacity_kwh, and plan_id apply), the `historyItems` list, all six
 * sections, and every i18n key + English fallback — using React Native
 * primitives, the existing native AppText / GlassPanel + design tokens, and the
 * already-ported web-parity AISmartChargeScheduleSuggestion.
 *
 * Browser-only / not-yet-ported dependencies are reduced explicitly and
 * documented in the `.parity.json` sidecar:
 *   - react-i18next `useTranslation` (web L2): no native i18next runtime, so an
 *     inline native-safe `t(key, fallback?, vars?)` returns the English
 *     fallback (else the key) and interpolates i18next-style `{{token}}`
 *     placeholders (the `chargePlanner.windowInfo` start/end case). Every key +
 *     intent is preserved verbatim.
 *   - lucide-react Zap/Clock/DollarSign/TrendingDown/BatteryCharging/
 *     CalendarClock/CheckCircle2/History (web L3-12): DOM SVG icons → semantic
 *     emoji glyph constants (the MileagePage icon→glyph precedent), tinted with
 *     the same cyan/red/emerald accents.
 *   - `@/components/layout` PageContainer + Grid (web L14): reproduced locally as
 *     native-safe shims (PageContainer = ScrollView scaffold with title /
 *     subtitle / actions / children; Grid = a mobile-first single-column stack
 *     honouring `gap`, matching the web grid's `default:1` phone breakpoint —
 *     `cols` is accepted for API parity).
 *   - `@/components/ui` GlassPanel/Button/Select/Input/Slider (web L15-17):
 *     native GlassPanel is the existing port; Button/Select/Input/Slider are
 *     reproduced locally as native-safe controls (Pressable button with a
 *     pending spinner slot; a Pressable option-chip Select; a TextInput field;
 *     a stepper Slider — no `@react-native-community/slider` dependency, so the
 *     range drag becomes −/＋ steppers over a filled track, preserving min/max/
 *     step/value/onChange/formatValue).
 *   - `@/components/forms` UnitInput/VehicleSelect (web L18): UnitInput → a
 *     native-safe kWh number field (energy is canonical-kWh with no per-user
 *     conversion, so display == stored value); VehicleSelect → a Pressable chip
 *     selector wired to the same selected-vehicle store.
 *   - `@/components/data-display` StatCard (web L19): reproduced locally as a
 *     native-safe card (label / value / icon / trend / sublabel) matching the
 *     web StatCard slots; the loading branch is unused by this page.
 *   - `@/components/motion` FadeIn (web L20): framer-motion entrance → a static
 *     passthrough View; the `delay` prop is accepted but inert.
 *   - `@/components/feedback` EmptyState/Spinner (web L21): native-safe locals
 *     (message-only empty state with an icon slot; an ActivityIndicator
 *     spinner).
 *   - `@/hooks/usePageTitle` (web L22): `document.title` is browser-only → a
 *     documented no-op (the native navigator owns the title).
 *   - `@/hooks/useSelectedVehicle` (web L23): the web hook layers react-router
 *     params over a zustand store; native has neither, so a native-safe hook
 *     derives the selection from the ported useVehicles() list (shared
 *     module-level store → first vehicle), preserving the `vehicleId` contract.
 *   - `@/hooks/useDateFormat` (web L24): reproduced as a native-safe hook
 *     returning `formatTime` / `formatDateTime` (ported web/src/lib/dateFormat —
 *     nullish/invalid → "—", locale-aware Intl; the web tz layering is dropped,
 *     no native timezone lib).
 *   - `@/hooks/useFormatting` (web L25): reproduced returning `formatCurrency`
 *     (currency symbol + decimal precision from useSettings, ported verbatim).
 *   - `@/lib/numberFormat` fmtNumber/fmtPercent (web L26): ported native-safe
 *     (safeNumber guard + toLocaleString; fmtPercent = `${fmtNumber}%`).
 *   - `../components/RateTimeline` (web L33): not yet ported as its own native
 *     file (owned by a separate conversion), so a native-safe RateTimeline is
 *     reproduced locally — a View-based 24-hour bar chart (tier colours,
 *     charge-window highlight, legend, 3-hour labels, empty state). The web
 *     hover tooltip is dropped (no hover on native).
 *   - `@/components/ai/AISmartChargeScheduleSuggestion` (web L34): imported from
 *     the already-ported web-parity component (same opt-in draft flow).
 *   - `@/types/charging` OptimizeChargeResponse + HourlyRate (web L35): imported
 *     from the ported native useCharging hook (identical shapes).
 *
 * No DOM/Recharts/Leaflet/lucide/react-router/old-web-UI imports remain.
 */
import React, {useCallback, useMemo, useState, useSyncExternalStore, type ReactNode} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import {AISmartChargeScheduleSuggestion} from '../../../components/ai/AISmartChargeScheduleSuggestion';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing, typography} from '../../../../theme/tokens';
import {
  useApplySchedule,
  useChargePlans,
  useOptimizeCharge,
  useRatePlans,
  type HourlyRate,
  type OptimizeChargeResponse,
} from '../../../api/hooks/useCharging';
import {useSettings} from '../../../api/hooks/useSettings';
import {useVehicles, type Vehicle} from '../../../api/hooks/useVehicles';

/* ------------------------------------------------------------------ */
/*  lucide-react icon stand-ins (web L3-12)                            */
/* ------------------------------------------------------------------ */

const ICON_ZAP = '\u26A1'; // ⚡ (Zap)
const ICON_CLOCK = '\uD83D\uDD50'; // 🕐 (Clock)
const ICON_DOLLAR = '\uD83D\uDCB2'; // 💲 (DollarSign)
const ICON_TRENDING_DOWN = '\uD83D\uDCC9'; // 📉 (TrendingDown)
const ICON_BATTERY_CHARGING = '\uD83D\uDD0B'; // 🔋 (BatteryCharging)
const ICON_CALENDAR_CLOCK = '\uD83D\uDCC5'; // 📅 (CalendarClock)
const ICON_CHECK = '\u2705'; // ✅ (CheckCircle2)
const ICON_HISTORY = '\uD83D\uDD58'; // 🕘 (History)

// Tailwind tints used by the web StatCard / section icons.
const CYAN_400 = '#22d3ee';
const RED_400 = '#f87171';
const EMERALD_400 = '#34d399';
const GREEN_600 = '#16a34a';
const RED_600 = '#dc2626';

// RateTimeline tier swatches (web tierColors, *_500/40 → rgba).
const TIER_OFF_PEAK = 'rgba(16, 185, 129, 0.4)';
const TIER_SUPER_OFF_PEAK = 'rgba(16, 185, 129, 0.5)';
const TIER_MID_PEAK = 'rgba(245, 158, 11, 0.4)';
const TIER_ON_PEAK = 'rgba(239, 68, 68, 0.4)';
const TIER_UNKNOWN = colors.surfaceRaised;
const WINDOW_FILL = 'rgba(34, 211, 238, 0.7)'; // cyan-400/70

/* ------------------------------------------------------------------ */
/*  native-safe i18n (react-i18next has no native runtime, web L2)     */
/* ------------------------------------------------------------------ */

type TVars = Record<string, string | number>;
type NativeTFunction = (key: string, fallback?: string, vars?: TVars) => string;

/** Interpolates i18next-style `{{token}}` placeholders against `vars`. */
function interpolate(template: string, vars?: TVars): string {
  if (!vars) {
    return template;
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_match, token: string) =>
    token in vars ? String(vars[token]) : `{{${token}}}`,
  );
}

/** Mirrors `t(key, default?, vars?)`: the English default else the key. */
function useNativeTranslation(): NativeTFunction {
  return useMemo<NativeTFunction>(
    () => (key, fallback, vars) => interpolate(fallback ?? key, vars),
    [],
  );
}

/* ------------------------------------------------------------------ */
/*  native-safe usePageTitle (web document.title is browser-only)      */
/* ------------------------------------------------------------------ */

function usePageTitle(_title: string): void {
  // The web hook writes document.title; on native the navigator owns the header
  // title, so the resolved title is intentionally not applied here.
}

/* ------------------------------------------------------------------ */
/*  ported number formatters (web @/lib/numberFormat)                  */
/* ------------------------------------------------------------------ */

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** fmtNumber — locale-aware, default precision 2 (web/src/lib/numberFormat.ts). */
function fmtNumber(v: unknown, decimals = 2): string {
  try {
    return safeNumber(v).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(v).toFixed(decimals);
  }
}

/** fmtPercent — `${fmtNumber}%` (web L73). */
function fmtPercent(v: unknown, decimals?: number): string {
  return `${fmtNumber(v, decimals)}%`;
}

/* ------------------------------------------------------------------ */
/*  ported date formatters (web @/lib/dateFormat via useDateFormat)    */
/* ------------------------------------------------------------------ */

/** formatTime — "2:30 AM" else "—" (web/src/lib/dateFormat formatTime). */
function formatTimeNative(value: string | Date | null | undefined, locale: string): string {
  if (!value) {
    return '\u2014';
  }
  const d = new Date(value);
  if (isNaN(d.getTime())) {
    return '\u2014';
  }
  try {
    return d.toLocaleTimeString(locale || [], {hour: '2-digit', minute: '2-digit'});
  } catch {
    return d.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
  }
}

/** formatDateTime — "Apr 4, 2026, 2:30 AM" else "—" (web formatDateTime). */
function formatDateTimeNative(value: string | Date | null | undefined, locale: string): string {
  if (!value) {
    return '\u2014';
  }
  const d = new Date(value);
  if (isNaN(d.getTime())) {
    return '\u2014';
  }
  try {
    return d.toLocaleString(locale || undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}

interface UseDateFormatResult {
  formatTime: (value: string | Date | null | undefined) => string;
  formatDateTime: (value: string | Date | null | undefined) => string;
}

/** Native-safe useDateFormat — locale-bound formatTime / formatDateTime. */
function useDateFormat(): UseDateFormatResult {
  const {data: settings} = useSettings();
  const locale = settings?.locale ?? settings?.language ?? '';
  return useMemo<UseDateFormatResult>(
    () => ({
      formatTime: value => formatTimeNative(value, locale),
      formatDateTime: value => formatDateTimeNative(value, locale),
    }),
    [locale],
  );
}

/* ------------------------------------------------------------------ */
/*  native-safe useFormatting (web @/hooks/useFormatting)              */
/* ------------------------------------------------------------------ */

interface UseFormattingResult {
  formatCurrency: (amount: number, decimals?: number) => string;
}

function useFormatting(): UseFormattingResult {
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

  const formatCurrency = useCallback(
    (amount: number, decimals?: number): string => {
      const d = decimals ?? userPrecision;
      return `${currencySymbol}${fmtNumber(amount, d)}`;
    },
    [currencySymbol, userPrecision],
  );

  return useMemo(() => ({formatCurrency}), [formatCurrency]);
}

/* ------------------------------------------------------------------ */
/*  native-safe useSelectedVehicle (web @/hooks/useSelectedVehicle)    */
/* ------------------------------------------------------------------ */

interface SelectedVehicleResult {
  vehicleId: number | null;
  vehicles: Vehicle[];
  setVehicleId: (id: number | null) => void;
}

// Module-level shared selection store (the MileagePage precedent). The web hook
// persists the picker choice in a zustand store so the header VehicleSelect and
// the page body stay in sync; native reproduces that single source of truth with
// a tiny external store. Router path/query precedence is dropped (no router).
let selectedVehicleOverride: number | null = null;
const selectedVehicleListeners = new Set<() => void>();

function getSelectedVehicleOverride(): number | null {
  return selectedVehicleOverride;
}

function subscribeSelectedVehicle(listener: () => void): () => void {
  selectedVehicleListeners.add(listener);
  return () => {
    selectedVehicleListeners.delete(listener);
  };
}

function setSelectedVehicleOverride(id: number | null): void {
  if (selectedVehicleOverride === id) {
    return;
  }
  selectedVehicleOverride = id;
  selectedVehicleListeners.forEach(listener => listener());
}

function useSelectedVehicle(): SelectedVehicleResult {
  const {data} = useVehicles();
  const vehicles = data ?? [];
  const override = useSyncExternalStore(
    subscribeSelectedVehicle,
    getSelectedVehicleOverride,
    getSelectedVehicleOverride,
  );
  const firstVehicleId = vehicles.length > 0 ? vehicles[0].id : null;
  const vehicleId = override ?? firstVehicleId;
  const setVehicleId = useCallback(
    (id: number | null) => setSelectedVehicleOverride(id),
    [],
  );
  return {vehicleId, vehicles, setVehicleId};
}

/* ------------------------------------------------------------------ */
/*  native FadeIn (web @/components/motion FadeIn)                      */
/* ------------------------------------------------------------------ */

function FadeIn({children}: {children: ReactNode; delay?: number}) {
  return <View>{children}</View>;
}

/* ------------------------------------------------------------------ */
/*  native Spinner (web @/components/feedback Spinner)                  */
/* ------------------------------------------------------------------ */

function Spinner({color = colors.background}: {color?: string}) {
  return <ActivityIndicator color={color} size="small" />;
}

/* ------------------------------------------------------------------ */
/*  native EmptyState (web @/components/feedback EmptyState)            */
/* ------------------------------------------------------------------ */

interface EmptyStateProps {
  icon?: ReactNode;
  message: string;
  testID?: string;
}

function EmptyState({icon, message, testID}: EmptyStateProps) {
  return (
    <View style={styles.emptyState} testID={testID}>
      {icon ? <View style={styles.emptyStateIcon}>{icon}</View> : null}
      <AppText style={styles.emptyStateMessage} tone="muted" variant="caption">
        {message}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native Button (web @/components/ui Button)                          */
/* ------------------------------------------------------------------ */

interface ControlButtonProps {
  onPress: () => void;
  disabled?: boolean;
  children: ReactNode;
  testID?: string;
}

function ControlButton({onPress, disabled, children, testID}: ControlButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{disabled: !!disabled}}
      disabled={disabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}
      testID={testID}>
      <View style={styles.buttonContent}>{children}</View>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/*  native Select (web @/components/ui Select)                          */
/* ------------------------------------------------------------------ */

interface SelectOption {
  value: string;
  label: string;
}

interface ControlSelectProps {
  label: string;
  options: SelectOption[];
  value: string;
  onValueChange: (value: string) => void;
}

function ControlSelect({label, options, value, onValueChange}: ControlSelectProps) {
  return (
    <View style={styles.field}>
      <AppText style={styles.fieldLabel} tone="secondary" variant="caption">
        {label}
      </AppText>
      <View style={styles.optionRow}>
        {options.map(opt => {
          const active = opt.value === value;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{selected: active}}
              hitSlop={4}
              key={opt.value}
              onPress={() => onValueChange(opt.value)}
              style={[styles.optionChip, active && styles.optionChipActive]}>
              <AppText
                numberOfLines={1}
                style={[styles.optionChipText, active && styles.optionChipTextActive]}
                variant="caption">
                {opt.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native Input (web @/components/ui Input)                            */
/* ------------------------------------------------------------------ */

interface ControlInputProps {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  keyboardType?: 'numeric' | 'default';
  placeholder?: string;
  suffix?: string;
  testID?: string;
}

function ControlInput({
  label,
  value,
  onChangeText,
  keyboardType = 'default',
  placeholder,
  suffix,
  testID,
}: ControlInputProps) {
  return (
    <View style={styles.field}>
      <AppText style={styles.fieldLabel} tone="secondary" variant="caption">
        {label}
      </AppText>
      <View style={styles.inputWrap}>
        <TextInput
          keyboardType={keyboardType}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          testID={testID}
          value={value}
        />
        {suffix ? (
          <AppText style={styles.inputSuffix} tone="muted" variant="caption">
            {suffix}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native UnitInput (web @/components/forms UnitInput, energy unit)    */
/* ------------------------------------------------------------------ */

interface UnitInputProps {
  label: string;
  value: number;
  onChange: (next: number | null) => void;
}

// Energy is canonical-kWh with no per-user conversion (web/src/lib/unitInput.ts),
// so display == stored value; a numeric field with a "kWh" suffix is the faithful
// native reduction of the web text-buffer UnitInput.
function UnitInput({label, value, onChange}: UnitInputProps) {
  const handleChange = useCallback(
    (text: string) => {
      const trimmed = text.replace(/kwh/gi, '').trim();
      if (trimmed === '') {
        onChange(null);
        return;
      }
      const parsed = Number(trimmed);
      onChange(Number.isFinite(parsed) ? parsed : null);
    },
    [onChange],
  );

  return (
    <ControlInput
      keyboardType="numeric"
      label={label}
      onChangeText={handleChange}
      suffix="kWh"
      testID="smart-charge-battery-capacity"
      value={String(value)}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  native Slider (web @/components/ui Slider — stepper reduction)      */
/* ------------------------------------------------------------------ */

interface SliderProps {
  id?: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  formatValue?: (n: number) => string;
}

function clampStep(value: number, min: number, max: number, step: number): number {
  const clamped = Math.min(max, Math.max(min, value));
  const stepped = Math.round((clamped - min) / step) * step + min;
  return Math.min(max, Math.max(min, stepped));
}

// No `@react-native-community/slider` dependency is available, so the range
// control becomes −/＋ steppers over a filled track. min/max/step/value/onChange/
// formatValue are preserved; the displayed value + aria-valuetext intent is kept.
function Slider({id, label, value, min, max, step = 1, onChange, formatValue}: SliderProps) {
  const display = formatValue ? formatValue(value) : String(value);
  const fillPct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  const atMin = value <= min;
  const atMax = value >= max;

  return (
    <View accessibilityRole="adjustable" accessibilityValue={{text: display}} style={styles.field}>
      <View style={styles.sliderLabelRow}>
        <AppText style={styles.fieldLabel} tone="secondary" variant="caption">
          {label}
        </AppText>
        <AppText style={styles.sliderValue} tone="muted" variant="caption">
          {display}
        </AppText>
      </View>
      <View style={styles.sliderRow}>
        <Pressable
          accessibilityLabel={`Decrease ${label}`}
          accessibilityRole="button"
          disabled={atMin}
          hitSlop={6}
          onPress={() => onChange(clampStep(value - step, min, max, step))}
          style={[styles.stepButton, atMin && styles.stepButtonDisabled]}
          testID={id ? `${id}-dec` : undefined}>
          <AppText style={styles.stepButtonText}>{'\u2212'}</AppText>
        </Pressable>
        <View style={styles.sliderTrack}>
          <View style={[styles.sliderFill, {width: `${fillPct}%`}]} />
        </View>
        <Pressable
          accessibilityLabel={`Increase ${label}`}
          accessibilityRole="button"
          disabled={atMax}
          hitSlop={6}
          onPress={() => onChange(clampStep(value + step, min, max, step))}
          style={[styles.stepButton, atMax && styles.stepButtonDisabled]}
          testID={id ? `${id}-inc` : undefined}>
          <AppText style={styles.stepButtonText}>{'+'}</AppText>
        </Pressable>
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native StatCard (web @/components/data-display StatCard)            */
/* ------------------------------------------------------------------ */

interface StatCardTrend {
  direction: 'up' | 'down' | 'flat';
  value: string;
  positive?: boolean;
}

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: ReactNode;
  trend?: StatCardTrend;
  sublabel?: string;
}

function StatCard({label, value, icon, trend, sublabel}: StatCardProps) {
  const trendColor = trend
    ? trend.positive
      ? GREEN_600
      : trend.direction === 'flat'
        ? colors.textMuted
        : RED_600
    : colors.textMuted;
  const trendArrow =
    trend?.direction === 'up' ? '\u2191' : trend?.direction === 'down' ? '\u2193' : '\u2014';

  return (
    <View style={styles.statCard}>
      <View style={styles.statHeader}>
        <AppText numberOfLines={1} style={styles.statLabel} tone="muted" variant="caption">
          {label}
        </AppText>
        {icon ? <View style={styles.statIcon}>{icon}</View> : null}
      </View>
      <AppText numberOfLines={1} style={styles.statValue}>
        {value}
      </AppText>
      {trend ? (
        <View style={styles.statTrendRow}>
          <AppText style={[styles.statTrendText, {color: trendColor}]} variant="caption">
            {trendArrow}
          </AppText>
          <AppText style={[styles.statTrendText, {color: trendColor}]} variant="caption">
            {trend.value}
          </AppText>
        </View>
      ) : null}
      {sublabel ? (
        <AppText style={styles.statSublabel} tone="muted" variant="caption">
          {sublabel}
        </AppText>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native Grid (web @/components/layout Grid — mobile-first stack)     */
/* ------------------------------------------------------------------ */

interface GridProps {
  // Accepted for web API parity; native collapses the responsive grid to the
  // `default:1` phone-breakpoint single column, so the column counts are inert.
  cols?: {default?: number; sm?: number; md?: number; lg?: number};
  gap?: number;
  children: ReactNode;
}

function Grid({gap = 4, children}: GridProps) {
  return <View style={[styles.grid, {gap: gap * 4}]}>{children}</View>;
}

/* ------------------------------------------------------------------ */
/*  native PageContainer (web @/components/layout PageContainer)        */
/* ------------------------------------------------------------------ */

interface PageContainerProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  testID?: string;
}

function PageContainer({title, subtitle, actions, children, testID}: PageContainerProps) {
  return (
    <ScrollView contentContainerStyle={styles.scaffold} testID={testID ?? 'smart-charge-page'}>
      <View style={styles.scaffoldHeader}>
        <View style={styles.scaffoldHeaderText}>
          <AppText style={styles.scaffoldTitle} variant="title" weight="bold">
            {title}
          </AppText>
          {subtitle ? (
            <AppText style={styles.scaffoldSubtitle} tone="muted">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {actions ? <View style={styles.scaffoldActions}>{actions}</View> : null}
      </View>
      <View style={styles.scaffoldBody}>{children}</View>
    </ScrollView>
  );
}

/* ------------------------------------------------------------------ */
/*  native VehicleSelect (web @/components/forms VehicleSelect)         */
/* ------------------------------------------------------------------ */

function VehicleSelect() {
  const {vehicleId, vehicles, setVehicleId} = useSelectedVehicle();

  if (vehicles.length === 0) {
    return null;
  }

  return (
    <View style={styles.vehicleSelect} testID="vehicle-select">
      {vehicles.map(v => {
        const active = v.id === vehicleId;
        const label = v.display_name || v.vin || `Vehicle ${v.id}`;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{selected: active}}
            hitSlop={4}
            key={v.id}
            onPress={() => setVehicleId(v.id)}
            style={[styles.vehicleChip, active && styles.vehicleChipActive]}>
            <AppText
              numberOfLines={1}
              style={[styles.vehicleChipText, active && styles.vehicleChipTextActive]}
              variant="caption">
              {label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native RateTimeline (web ../components/RateTimeline)                */
/* ------------------------------------------------------------------ */

interface RateTimelineProps {
  rates: HourlyRate[];
  chargeWindow?: {startHour: number; endHour: number};
}

const TIER_COLORS: Record<string, string> = {
  OFF_PEAK: TIER_OFF_PEAK,
  SUPER_OFF_PEAK: TIER_SUPER_OFF_PEAK,
  MID_PEAK: TIER_MID_PEAK,
  ON_PEAK: TIER_ON_PEAK,
  unknown: TIER_UNKNOWN,
};

function formatHour(h: number): string {
  if (h === 0 || h === 24) {
    return '12a';
  }
  if (h === 12) {
    return '12p';
  }
  return h < 12 ? `${h}a` : `${h - 12}p`;
}

function RateTimeline({rates, chargeWindow}: RateTimelineProps) {
  const t = useNativeTranslation();

  const maxRate = useMemo(() => {
    if (rates.length === 0) {
      return 1;
    }
    return Math.max(...rates.map(r => r.rate_cents));
  }, [rates]);

  const isInWindow = useCallback(
    (hour: number) => {
      if (!chargeWindow) {
        return false;
      }
      const {startHour, endHour} = chargeWindow;
      if (startHour <= endHour) {
        return hour >= startHour && hour < endHour;
      }
      // Cross-midnight window.
      return hour >= startHour || hour < endHour;
    },
    [chargeWindow],
  );

  if (rates.length === 0) {
    return (
      <View style={styles.rateTimelineEmpty} testID="rate-timeline-empty">
        <AppText tone="muted" variant="caption">
          {t('chargePlanner.noRateData', 'No rate data available')}
        </AppText>
      </View>
    );
  }

  return (
    <View style={styles.rateTimeline}>
      {/* Legend */}
      <View style={styles.rateLegend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, {backgroundColor: TIER_OFF_PEAK}]} />
          <AppText style={styles.legendText} tone="secondary" variant="caption">
            {t('chargePlanner.offPeak', 'Off-Peak')}
          </AppText>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, {backgroundColor: TIER_MID_PEAK}]} />
          <AppText style={styles.legendText} tone="secondary" variant="caption">
            {t('chargePlanner.midPeak', 'Mid-Peak')}
          </AppText>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, {backgroundColor: TIER_ON_PEAK}]} />
          <AppText style={styles.legendText} tone="secondary" variant="caption">
            {t('chargePlanner.onPeak', 'On-Peak')}
          </AppText>
        </View>
        {chargeWindow ? (
          <View style={styles.legendItem}>
            <View style={[styles.legendSwatch, {backgroundColor: WINDOW_FILL}]} />
            <AppText style={styles.legendText} tone="secondary" variant="caption">
              {t('chargePlanner.chargeWindow', 'Charge Window')}
            </AppText>
          </View>
        ) : null}
      </View>

      {/* 24-hour bar chart */}
      <View style={styles.barRow}>
        {rates.map(rate => {
          const heightPct = maxRate > 0 ? (rate.rate_cents / maxRate) * 100 : 10;
          const inWindow = isInWindow(rate.hour);
          const baseColor = TIER_COLORS[rate.tier] ?? TIER_COLORS.unknown;
          return (
            <View key={rate.hour} style={styles.barColumn}>
              <View
                style={[
                  styles.bar,
                  {
                    height: `${Math.max(heightPct, 5)}%`,
                    backgroundColor: inWindow ? WINDOW_FILL : baseColor,
                  },
                  inWindow && styles.barInWindow,
                ]}
              />
            </View>
          );
        })}
      </View>

      {/* Hour labels */}
      <View style={styles.hourRow}>
        {rates.map(rate => (
          <View key={rate.hour} style={styles.hourLabelCell}>
            <AppText style={styles.hourLabel} tone="muted">
              {rate.hour % 3 === 0 ? formatHour(rate.hour) : ''}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  defaultDepartBy (web L37-42)                                        */
/* ------------------------------------------------------------------ */

const defaultDepartBy = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(7, 30, 0, 0);
  return d.toISOString().slice(0, 16); // yyyy-MM-ddTHH:mm for datetime-local input
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function SmartChargePage() {
  const t = useNativeTranslation();
  usePageTitle(t('chargePlanner.title', 'Smart Charge'));
  const {formatTime, formatDateTime: formatDate} = useDateFormat();
  const {formatCurrency} = useFormatting();

  // Data hooks
  const {vehicleId: selectedId} = useSelectedVehicle();
  const {data: ratePlans} = useRatePlans();
  const optimizeMutation = useOptimizeCharge();
  const applyMutation = useApplySchedule();

  // Form state — vehicleId comes from the global selection.
  const vehicleIdNum = selectedId ?? undefined;
  const [targetSoc, setTargetSoc] = useState(80);
  const [departBy, setDepartBy] = useState(defaultDepartBy);
  const [ratePlanId, setRatePlanId] = useState('pge-ev2a');
  const [maxAmps, setMaxAmps] = useState(32);
  const [batteryCapacity, setBatteryCapacity] = useState(75);

  // Result state
  const [result, setResult] = useState<OptimizeChargeResponse | null>(null);
  const [applied, setApplied] = useState(false);

  const {data: plans} = useChargePlans(vehicleIdNum);

  const ratePlanOptions = useMemo(
    () =>
      (ratePlans ?? []).map(p => ({
        value: p.id,
        label: `${p.name} (${p.utility})`,
      })),
    [ratePlans],
  );

  const chargeWindow = useMemo(() => {
    if (!result) {
      return undefined;
    }
    const start = new Date(result.schedule.start_time);
    const end = new Date(result.schedule.end_time);
    return {startHour: start.getHours(), endHour: end.getHours() || 24};
  }, [result]);

  const handleOptimize = () => {
    if (!vehicleIdNum) {
      return;
    }
    setApplied(false);
    setResult(null);
    optimizeMutation.mutate(
      {
        vehicle_id: vehicleIdNum,
        target_soc: targetSoc,
        depart_by: new Date(departBy).toISOString(),
        rate_plan_id: ratePlanId,
        max_amps: maxAmps,
        battery_capacity_kwh: batteryCapacity,
      },
      {
        onSuccess: data => setResult(data),
      },
    );
  };

  const handleApply = () => {
    if (!result) {
      return;
    }
    applyMutation.mutate(
      {plan_id: result.plan_id},
      {
        onSuccess: () => setApplied(true),
      },
    );
  };

  const historyItems = plans ?? [];

  return (
    <PageContainer
      actions={<VehicleSelect />}
      subtitle={t(
        'chargePlanner.subtitle',
        'Optimize charging schedule for the cheapest TOU rates',
      )}
      testID="smart-charge-page"
      title={t('chargePlanner.title', 'Smart Charge')}>
      {/* ── AI Smart-Charge Schedule Suggestion (opt-in, hidden when ai_mode='off') ── */}
      <FadeIn>
        <AISmartChargeScheduleSuggestion
          batteryCapacityKwh={batteryCapacity}
          departBy={departBy}
          maxAmps={maxAmps}
          ratePlanId={ratePlanId}
          targetSoc={targetSoc}
          vehicleId={vehicleIdNum}
        />
      </FadeIn>

      {/* ── Settings Section ── */}
      <FadeIn>
        <GlassPanel style={styles.panel}>
          <View style={styles.panelTitleRow}>
            <AppText style={styles.iconCyan}>{ICON_ZAP}</AppText>
            <AppText style={styles.panelTitle} weight="semibold">
              {t('chargePlanner.settings', 'Charge Settings')}
            </AppText>
          </View>

          <Grid cols={{default: 1, sm: 2, lg: 4}} gap={4}>
            <ControlSelect
              label={t('chargePlanner.ratePlan', 'Rate Plan')}
              onValueChange={setRatePlanId}
              options={
                ratePlanOptions.length > 0
                  ? ratePlanOptions
                  : [
                      {value: 'pge-ev2a', label: 'PG&E EV2-A'},
                      {value: 'sce-tou-d', label: 'SCE TOU-D'},
                      {value: 'sdge-tou-dr1', label: 'SDG&E TOU-DR1'},
                    ]
              }
              value={ratePlanId}
            />

            <Slider
              formatValue={n => `${n}%`}
              id="smart-charge-target-soc"
              label={t('chargePlanner.targetSoc', 'Target SOC')}
              max={100}
              min={20}
              onChange={setTargetSoc}
              step={5}
              value={targetSoc}
            />

            <ControlInput
              label={t('chargePlanner.departBy', 'Depart By')}
              onChangeText={setDepartBy}
              placeholder="yyyy-MM-ddTHH:mm"
              testID="smart-charge-depart-by"
              value={departBy}
            />

            <ControlInput
              keyboardType="numeric"
              label={t('chargePlanner.maxAmps', 'Max Amps')}
              onChangeText={text => setMaxAmps(Number(text))}
              testID="smart-charge-max-amps"
              value={String(maxAmps)}
            />

            <UnitInput
              label={t('chargePlanner.batteryCapacity', 'Battery Capacity')}
              onChange={v => setBatteryCapacity(v ?? 0)}
              value={batteryCapacity}
            />
          </Grid>

          <View style={styles.optimizeRow}>
            <ControlButton
              disabled={!vehicleIdNum || optimizeMutation.isPending}
              onPress={handleOptimize}
              testID="smart-charge-optimize">
              {optimizeMutation.isPending ? (
                <Spinner />
              ) : (
                <AppText style={styles.buttonGlyph}>{ICON_CALENDAR_CLOCK}</AppText>
              )}
              <AppText style={styles.buttonLabel} weight="semibold">
                {t('chargePlanner.optimize', 'Find Cheapest Window')}
              </AppText>
            </ControlButton>
          </View>

          {optimizeMutation.isError ? (
            <AppText style={styles.errorText} variant="caption">
              {(optimizeMutation.error as Error)?.message ||
                t('chargePlanner.optimizeError', 'Optimization failed')}
            </AppText>
          ) : null}
        </GlassPanel>
      </FadeIn>

      {/* ── Rate Timeline ── */}
      {result ? (
        <FadeIn delay={0.05}>
          <GlassPanel style={styles.panel}>
            <View style={styles.panelTitleRow}>
              <AppText style={styles.iconCyan}>{ICON_CLOCK}</AppText>
              <AppText style={styles.panelTitle} weight="semibold">
                {t('chargePlanner.rateTimeline', '24-Hour Rate Timeline')}
              </AppText>
            </View>
            <RateTimeline chargeWindow={chargeWindow} rates={result.hourly_rates} />
            <AppText style={styles.windowInfo} tone="muted" variant="caption">
              {t('chargePlanner.windowInfo', 'Optimal window: {{start}} — {{end}}', {
                start: formatTime(result.schedule.start_time),
                end: formatTime(result.schedule.end_time),
              })}
            </AppText>
          </GlassPanel>
        </FadeIn>
      ) : null}

      {/* ── Cost Comparison ── */}
      {result ? (
        <FadeIn delay={0.1}>
          <Grid cols={{default: 1, md: 3}} gap={4}>
            <StatCard
              icon={<AppText style={[styles.statGlyph, {color: RED_400}]}>{ICON_DOLLAR}</AppText>}
              label={t('chargePlanner.chargeNowCost', 'Charge Now')}
              sublabel={t('chargePlanner.currentRate', 'At current rates')}
              value={formatCurrency(result.comparison.charge_now_cost)}
            />
            <StatCard
              icon={
                <AppText style={[styles.statGlyph, {color: EMERALD_400}]}>
                  {ICON_TRENDING_DOWN}
                </AppText>
              }
              label={t('chargePlanner.optimizedCost', 'Optimized Cost')}
              sublabel={`${result.schedule.rate_tier} · ${fmtNumber(
                result.schedule.rate_cents_kwh,
                1,
              )}¢/kWh`}
              value={formatCurrency(result.comparison.optimized_cost)}
            />
            <StatCard
              icon={
                <AppText style={[styles.statGlyph, {color: CYAN_400}]}>
                  {ICON_BATTERY_CHARGING}
                </AppText>
              }
              label={t('chargePlanner.savings', 'Savings')}
              sublabel={`${fmtNumber(result.kwh_needed, 1)} kWh · ~${fmtNumber(
                result.estimated_duration_hours,
                1,
              )}h`}
              trend={{
                direction: result.comparison.savings > 0 ? 'down' : 'flat',
                value: fmtPercent(result.comparison.savings_percent, 0),
                positive: result.comparison.savings > 0,
              }}
              value={formatCurrency(result.comparison.savings)}
            />
          </Grid>
        </FadeIn>
      ) : null}

      {/* ── Schedule Details & Apply ── */}
      {result ? (
        <FadeIn delay={0.15}>
          <GlassPanel style={styles.panel}>
            <View style={styles.scheduleHeader}>
              <View style={styles.panelTitleRow}>
                <AppText style={styles.iconCyan}>{ICON_CALENDAR_CLOCK}</AppText>
                <AppText style={styles.panelTitle} weight="semibold">
                  {t('chargePlanner.schedule', 'Recommended Schedule')}
                </AppText>
              </View>
              {!applied ? (
                <ControlButton
                  disabled={applyMutation.isPending}
                  onPress={handleApply}
                  testID="smart-charge-apply">
                  {applyMutation.isPending ? (
                    <Spinner />
                  ) : (
                    <AppText style={styles.buttonGlyph}>{ICON_ZAP}</AppText>
                  )}
                  <AppText style={styles.buttonLabel} weight="semibold">
                    {t('chargePlanner.applySchedule', 'Apply Schedule')}
                  </AppText>
                </ControlButton>
              ) : (
                <View style={styles.appliedRow} testID="smart-charge-applied">
                  <AppText style={styles.appliedGlyph}>{ICON_CHECK}</AppText>
                  <AppText style={styles.appliedText} weight="semibold" variant="caption">
                    {t('chargePlanner.applied', 'Schedule Applied!')}
                  </AppText>
                </View>
              )}
            </View>

            {applyMutation.isError ? (
              <AppText style={styles.errorText} variant="caption">
                {(applyMutation.error as Error)?.message ||
                  t('chargePlanner.applyError', 'Failed to apply schedule')}
              </AppText>
            ) : null}

            <View style={styles.scheduleGrid}>
              <View style={styles.scheduleCell}>
                <AppText style={styles.scheduleCellLabel} tone="muted" variant="caption">
                  {t('chargePlanner.currentSoc', 'Current SOC')}
                </AppText>
                <AppText style={styles.scheduleCellValue} weight="semibold">
                  {`${result.current_soc}%`}
                </AppText>
              </View>
              <View style={styles.scheduleCell}>
                <AppText style={styles.scheduleCellLabel} tone="muted" variant="caption">
                  {t('chargePlanner.targetSocLabel', 'Target SOC')}
                </AppText>
                <AppText style={styles.scheduleCellValue} weight="semibold">
                  {`${result.target_soc}%`}
                </AppText>
              </View>
              <View style={styles.scheduleCell}>
                <AppText style={styles.scheduleCellLabel} tone="muted" variant="caption">
                  {t('chargePlanner.startTime', 'Start Time')}
                </AppText>
                <AppText style={styles.scheduleCellValue} weight="semibold">
                  {formatTime(result.schedule.start_time)}
                </AppText>
              </View>
              <View style={styles.scheduleCell}>
                <AppText style={styles.scheduleCellLabel} tone="muted" variant="caption">
                  {t('chargePlanner.endTime', 'End Time')}
                </AppText>
                <AppText style={styles.scheduleCellValue} weight="semibold">
                  {formatTime(result.schedule.end_time)}
                </AppText>
              </View>
            </View>

            {/* Alternative windows */}
            {(result.alternative_windows ?? []).length > 0 ? (
              <View style={styles.altSection}>
                <AppText style={styles.altTitle} tone="secondary" variant="caption" weight="semibold">
                  {t('chargePlanner.alternatives', 'Alternative Windows')}
                </AppText>
                <View style={styles.altList}>
                  {result.alternative_windows.map((alt, i) => (
                    <View key={i} style={styles.altRow}>
                      <AppText style={styles.altTime} tone="secondary" variant="caption">
                        {`${formatTime(alt.start_time)} — ${formatTime(alt.end_time)}`}
                      </AppText>
                      <AppText style={styles.altTier} tone="muted" variant="caption">
                        {alt.rate_tier}
                      </AppText>
                      <AppText style={styles.altCost} variant="caption" weight="semibold">
                        {formatCurrency(alt.estimated_cost)}
                      </AppText>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
          </GlassPanel>
        </FadeIn>
      ) : null}

      {/* ── History ── */}
      <FadeIn delay={result ? 0.2 : 0.05}>
        <GlassPanel style={styles.panel}>
          <View style={styles.panelTitleRow}>
            <AppText style={styles.iconCyan}>{ICON_HISTORY}</AppText>
            <AppText style={styles.panelTitle} weight="semibold">
              {t('chargePlanner.history', 'Plan History')}
            </AppText>
          </View>

          {historyItems.length > 0 ? (
            <View testID="smart-charge-history">
              <View style={[styles.historyRow, styles.historyHeaderRow]}>
                <AppText style={[styles.historyCell, styles.historyHead]} tone="muted" variant="caption">
                  {t('chargePlanner.date', 'Date')}
                </AppText>
                <AppText style={[styles.historyCell, styles.historyHead]} tone="muted" variant="caption">
                  {t('chargePlanner.window', 'Window')}
                </AppText>
                <AppText style={[styles.historyCell, styles.historyHead]} tone="muted" variant="caption">
                  {t('chargePlanner.plan', 'Plan')}
                </AppText>
                <AppText
                  style={[styles.historyCell, styles.historyHead, styles.historyRight]}
                  tone="muted"
                  variant="caption">
                  {t('chargePlanner.cost_decimal', 'Cost')}
                </AppText>
                <AppText
                  style={[styles.historyCell, styles.historyHead, styles.historyRight]}
                  tone="muted"
                  variant="caption">
                  {t('chargePlanner.savedAmount', 'Saved')}
                </AppText>
                <AppText style={[styles.historyCell, styles.historyHead]} tone="muted" variant="caption">
                  {t('chargePlanner.status', 'Status')}
                </AppText>
              </View>
              {historyItems.map(p => {
                const statusColor =
                  p.status === 'scheduled'
                    ? CYAN_400
                    : p.status === 'completed'
                      ? EMERALD_400
                      : p.status === 'cancelled'
                        ? RED_400
                        : colors.textMuted;
                return (
                  <View key={p.id} style={styles.historyRow}>
                    <AppText style={styles.historyCell} tone="secondary" variant="caption">
                      {formatDate(p.created_at)}
                    </AppText>
                    <AppText style={styles.historyCell} tone="secondary" variant="caption">
                      {`${formatTime(p.scheduled_start)} — ${formatTime(p.scheduled_end)}`}
                    </AppText>
                    <AppText style={styles.historyCell} tone="secondary" variant="caption">
                      {p.rate_plan}
                    </AppText>
                    <AppText
                      style={[styles.historyCell, styles.historyRight]}
                      tone="secondary"
                      variant="caption">
                      {p.estimated_cost != null ? formatCurrency(p.estimated_cost) : '\u2014'}
                    </AppText>
                    <AppText
                      style={[styles.historyCell, styles.historyRight, styles.historySaved]}
                      variant="caption">
                      {p.savings != null && p.savings > 0 ? formatCurrency(p.savings) : '\u2014'}
                    </AppText>
                    <AppText style={[styles.historyCell, {color: statusColor}]} variant="caption">
                      {p.status}
                    </AppText>
                  </View>
                );
              })}
            </View>
          ) : (
            // no-action: transient empty state — surfaces when source data is
            // missing; no specific recovery action available.
            <EmptyState
              icon={<AppText style={styles.historyEmptyGlyph} tone="muted">{ICON_HISTORY}</AppText>}
              message={t(
                'chargePlanner.noHistory',
                'No charge plans yet. Optimize a schedule above to get started.',
              )}
              testID="smart-charge-history-empty"
            />
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  scaffold: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  scaffoldHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
    flexWrap: 'wrap',
  },
  scaffoldHeaderText: {
    flexShrink: 1,
    minWidth: 0,
  },
  scaffoldTitle: {
    letterSpacing: -0.5,
  },
  scaffoldSubtitle: {
    fontSize: typography.caption,
    marginTop: spacing.xs,
  },
  scaffoldActions: {
    flexShrink: 0,
  },
  scaffoldBody: {
    gap: spacing.lg,
  },
  panel: {
    padding: spacing.md,
    gap: spacing.md,
  },
  panelTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  panelTitle: {
    fontSize: typography.body,
  },
  iconCyan: {
    color: CYAN_400,
    fontSize: 16,
  },
  grid: {
    width: '100%',
  },
  field: {
    gap: spacing.xs,
    width: '100%',
  },
  fieldLabel: {
    fontWeight: '500',
  },
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  optionChip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  optionChipActive: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.surfaceSelected,
  },
  optionChipText: {
    color: colors.textSecondary,
  },
  optionChipTextActive: {
    color: colors.textPrimary,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
  },
  input: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: typography.body,
    paddingVertical: spacing.sm,
  },
  inputSuffix: {
    marginLeft: spacing.xs,
  },
  sliderLabelRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  sliderValue: {
    fontVariant: ['tabular-nums'],
  },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sliderTrack: {
    flex: 1,
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  sliderFill: {
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.accent,
  },
  stepButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepButtonDisabled: {
    opacity: 0.4,
  },
  stepButtonText: {
    color: colors.textPrimary,
    fontSize: 18,
    lineHeight: 20,
  },
  optimizeRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  button: {
    minHeight: 40,
    borderRadius: 12,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  buttonDisabled: {
    opacity: 0.48,
  },
  buttonPressed: {
    opacity: 0.82,
  },
  buttonGlyph: {
    color: colors.background,
    fontSize: 14,
  },
  buttonLabel: {
    color: colors.background,
  },
  errorText: {
    color: colors.danger,
  },
  windowInfo: {
    marginTop: spacing.xs,
  },
  statCard: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceGlass,
    borderRadius: 16,
    padding: spacing.md,
    gap: spacing.xs,
  },
  statHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  statLabel: {
    flexShrink: 1,
    fontWeight: '500',
  },
  statIcon: {
    flexShrink: 0,
  },
  statGlyph: {
    fontSize: 18,
  },
  statValue: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '800',
  },
  statTrendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  statTrendText: {
    fontWeight: '500',
  },
  statSublabel: {},
  scheduleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  appliedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  appliedGlyph: {
    color: EMERALD_400,
    fontSize: 14,
  },
  appliedText: {
    color: EMERALD_400,
  },
  scheduleGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.md,
  },
  scheduleCell: {
    width: '50%',
    gap: 2,
  },
  scheduleCellLabel: {},
  scheduleCellValue: {
    color: colors.textPrimary,
  },
  altSection: {
    marginTop: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: spacing.sm,
  },
  altTitle: {},
  altList: {
    gap: spacing.sm,
  },
  altRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    backgroundColor: colors.surfaceRaised,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  altTime: {
    flexShrink: 1,
  },
  altTier: {
    flexShrink: 1,
    textAlign: 'center',
  },
  altCost: {
    color: colors.textPrimary,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  historyHeaderRow: {
    borderBottomWidth: 1,
  },
  historyCell: {
    flex: 1,
    minWidth: 0,
  },
  historyHead: {
    fontWeight: '500',
  },
  historyRight: {
    textAlign: 'right',
  },
  historySaved: {
    color: EMERALD_400,
  },
  historyEmptyGlyph: {
    fontSize: 36,
    lineHeight: 42,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  emptyStateIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyStateMessage: {
    textAlign: 'center',
  },
  vehicleSelect: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  vehicleChip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  vehicleChipActive: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.surfaceSelected,
  },
  vehicleChipText: {
    color: colors.textSecondary,
    maxWidth: 160,
  },
  vehicleChipTextActive: {
    color: colors.textPrimary,
  },
  rateTimeline: {
    gap: spacing.md,
  },
  rateTimelineEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl,
  },
  rateLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  legendSwatch: {
    width: 12,
    height: 12,
    borderRadius: 3,
  },
  legendText: {},
  barRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 96,
    gap: 1,
  },
  hourRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 1,
  },
  barColumn: {
    flex: 1,
    height: '100%',
    justifyContent: 'flex-end',
  },
  bar: {
    width: '100%',
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
  },
  barInWindow: {
    borderWidth: 1,
    borderColor: 'rgba(34, 211, 238, 0.5)',
  },
  hourLabelCell: {
    flex: 1,
    alignItems: 'center',
  },
  hourLabel: {
    fontSize: 10,
  },
});
