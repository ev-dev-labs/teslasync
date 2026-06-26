// Native parity port of web/src/features/charging/pages/ChargingHeatmapPage.tsx.
//
// Charging Patterns page: a "when + where do you charge" surface for the
// selected vehicle. Backed by GET /api/v1/charging?vehicle_id=&limit=2000&
// start=&end= (`useChargingSessionsPaginated(vehicleId, {limit, start, end})`).
// From those raw sessions the page derives, top to bottom:
//
//   - four hero stat cards (Total Sessions / Total Energy / Total Cost /
//     Avg Duration),
//   - a "favorite charging time" callout (the busiest day+hour bucket),
//   - a 7-day x 24-hour weekly heatmap grid (cells tinted by session count),
//   - a "top charging locations" horizontal bar chart (places with >= 2
//     sessions, top 10).
//
// Every web behavior, state name (`vehicleId`, `start`/`end`/`setRange`,
// `sessions`/`isLoading`/`error`, `stats`, `grid`/`maxCount`/`favDay`/`favHour`,
// `locationData`, `hovered`/`setHovered`), API path, unit-handling rule (read
// SI Wh, convert to kWh at the display boundary) and i18n key/copy is preserved.
// The web DOM/Tailwind/Recharts/lucide stack is replaced with React Native
// primitives + the native parity component library:
//
//   - `@/components/layout` PageContainer (title/subtitle/error/actions/loading)
//     has no native parity component, so a local ScrollView screen scaffold
//     reproduces the header (title + subtitle), the `actions` row (VehicleSelect
//     + RangePicker), the loading skeletons, and the error panel, with the body
//     wrapped in the native ErrorBoundary (== PageContainer's PageErrorBoundary).
//     Precedent: TrueCostPage / IngestXRayPage / DiskForecastPage.
//   - `@/components/ui` GlassPanel reuses the native parity GlassPanel
//     (`glow`/`hover`/`padding`); the per-card glow tints (cyan/green/purple/
//     none) are preserved.
//   - `@/components/data-display` Currency -> inlined currency text via a local
//     formatCurrency shim (symbol '$', precision 2, '—' fallback) mirroring the
//     web out-of-box defaults.
//   - `@/components/feedback` Skeleton -> a local pulsing Skeleton View;
//     EmptyState -> a centered muted message (the web variant is icon + single
//     message; the decorative lucide Activity icon is omitted on native).
//   - `@/components/motion` FadeIn / StaggerContainer / StaggerItem -> a
//     reduced-motion-aware FadeIn (honouring the web per-section `delay`); the
//     StaggerContainer grid becomes a native wrap grid and each StaggerItem a
//     staggered FadeIn.
//   - `@/components/forms` VehicleSelect (the global header picker backed by the
//     selected-vehicle store) -> a local NativeSelect bound to useVehicles() +
//     local state; combined with a `useSelectedVehicle` shim (first-vehicle
//     default) this reproduces the "default to the first vehicle, allow
//     switching" behaviour without the web router/store layer. RangePicker
//     (a calendar + preset popover) -> a local NativeSelect of date presets
//     (the free-form calendar is a browser-only affordance; the preset path —
//     the most-used one — is preserved and drives the same {start,end} ->
//     setRange contract).
//   - `@/components/charts` Recharts BarChart (layout='vertical', i.e.
//     horizontal bars) -> a real native horizontal bar list (proportional View
//     bars). The native recharts barrel only renders an "unavailable"
//     placeholder, so a true visual is built here (IngestXRayPage precedent).
//     The CSS-grid heatmap has no chart-library analog; it is rebuilt with
//     Views inside a horizontal ScrollView, and the hover tooltip (no pointer
//     hover on touch) becomes a tap-to-reveal detail row + selected-cell
//     highlight.
//   - `@/hooks/useSettings` (loads global precision/locale) -> native no-op
//     shim; `@/hooks/usePageTitle` (sets document.title) -> native no-op shim.
//   - `@/hooks/useRangeState` (URL + localStorage range memory) -> a native
//     in-memory shim defaulting to the 'all' preset (start '2015-01-01', end
//     today); URL/localStorage persistence is browser-only and unavailable.
//   - `../components/charging-curve/helpers#durationMinutes` + `@/lib/
//     unitConversion#convertEnergyFromSI` + `@/lib/numberFormat#fmtNumber/fmtInt`
//     + `@/lib/constants#DAYS` + `@/lib/datePresets` -> inlined native-safe
//     equivalents (ported verbatim).
//   - react-i18next useTranslation -> a local t(key, fallback) shim, so every
//     charging.heatmap.* / common.* key + English copy is preserved verbatim.

import React, {
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
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type DimensionValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {
  useChargingSessionsPaginated,
  type ApiChargingSession,
} from '../../../api/hooks/useCharging';
import {useVehicles, type Vehicle} from '../../../api/hooks/useVehicles';
import {ErrorBoundary} from '../../../components/feedback/ErrorBoundary';
import {GlassPanel} from '../../../components/ui/GlassPanel';

/* ─── i18n fallback shim (web `react-i18next` is unavailable in native) ────── */

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslation(): NativeTFunction {
  return (_key: string, fallback: string) => fallback;
}

/* ─── usePageTitle (web sets document.title; native has no document) ────────── */

function usePageTitle(_title: string): void {
  // no-op: React Native has no document.title to drive.
}

/* ─── useSettings (web loads global precision/locale; native uses defaults) ─── */

function useSettings(): void {
  // no-op: the native parity layer has no settings store wired in; formatters
  // below mirror the web out-of-box defaults (en-US, precision-aware per call).
}

/* ─── native-safe formatting (web `@/lib/numberFormat`) ─────────────────────── */

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
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

/* ─── currency shim (web `@/components/data-display` Currency) ───────────────── */

const CURRENCY_SYMBOL = '$';

// Mirrors the web <Currency> defaults: symbol '$', precision 2, '—' fallback,
// no FX conversion (value rendered verbatim with the symbol prefix).
function formatCurrency(value: number | null | undefined, precision = 2): string {
  if (value == null || !Number.isFinite(value)) {
    return '\u2014';
  }
  return `${CURRENCY_SYMBOL}${fmtNumber(value, precision)}`;
}

/* ─── unit + duration helpers (web `@/lib/unitConversion` + curve helpers) ──── */

type EnergyUnitPref = 'Wh' | 'kWh';

// Mirrors web `convertEnergyFromSI` (SI Wh -> display unit).
function convertEnergyFromSI(wh: number, to: EnergyUnitPref): number {
  switch (to) {
    case 'Wh':
      return wh;
    case 'kWh':
      return wh / 1000;
  }
}

// Ported verbatim from web charging-curve/helpers.ts.
function durationMinutes(startedAt: string, endedAt: string | null): number {
  if (!endedAt) {
    return 0;
  }
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return 0;
  }
  return Math.round((end - start) / 60000);
}

/* ─── constants (web `@/lib/constants` DAYS) ────────────────────────────────── */

// Day-of-week labels (Sunday-first), preserved verbatim.
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/* ─── date presets (web `@/lib/datePresets`, subset) ────────────────────────── */

interface DatePresetRange {
  start: string;
  end: string;
}

interface DatePreset {
  id: string;
  label: string;
  resolve: (now?: Date) => DatePresetRange;
}

// Format a Date as YYYY-MM-DD using LOCAL calendar fields (web `iso`).
function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Mirrors web `resolveAllTimeStart` (baseline 2015-01-01, no minDate here).
const ALL_TIME_START = '2015-01-01';

const DATE_PRESETS: DatePreset[] = [
  {
    id: 'today',
    label: 'Today',
    resolve: (now = new Date()) => ({start: isoDate(now), end: isoDate(now)}),
  },
  {
    id: '7d',
    label: 'Last 7 days',
    resolve: (now = new Date()) => {
      const s = new Date(now);
      s.setDate(s.getDate() - 6);
      return {start: isoDate(s), end: isoDate(now)};
    },
  },
  {
    id: '30d',
    label: 'Last 30 days',
    resolve: (now = new Date()) => {
      const s = new Date(now);
      s.setDate(s.getDate() - 29);
      return {start: isoDate(s), end: isoDate(now)};
    },
  },
  {
    id: '90d',
    label: 'Last 90 days',
    resolve: (now = new Date()) => {
      const s = new Date(now);
      s.setDate(s.getDate() - 89);
      return {start: isoDate(s), end: isoDate(now)};
    },
  },
  {
    id: '1y',
    label: 'Last year',
    resolve: (now = new Date()) => {
      const s = new Date(now);
      s.setFullYear(s.getFullYear() - 1);
      return {start: isoDate(s), end: isoDate(now)};
    },
  },
  {
    id: 'all',
    label: 'All time',
    resolve: (now = new Date()) => ({start: ALL_TIME_START, end: isoDate(now)}),
  },
];

function matchPresetId(start: string, end: string, now?: Date): string | undefined {
  for (const preset of DATE_PRESETS) {
    const r = preset.resolve(now);
    if (r.start === start && r.end === end) {
      return preset.id;
    }
  }
  return undefined;
}

/* ─── useRangeState shim (web `@/hooks/useRangeState`) ──────────────────────── */

interface RangeValue {
  start: string;
  end: string;
}

interface UseRangeStateOptions {
  persistKey?: string;
  defaultPresetId?: string;
}

interface UseRangeStateReturn {
  start: string;
  end: string;
  setRange: (range: RangeValue) => void;
}

// The web hook resolves URL > localStorage > defaultPresetId. Native has no
// router/localStorage, so this in-memory shim seeds from the default preset
// (here 'all' -> {2015-01-01, today}) and lets the RangePicker switch it.
// Persistence across launches is intentionally unavailable.
function useRangeState({
  defaultPresetId = '30d',
}: UseRangeStateOptions = {}): UseRangeStateReturn {
  const [range, setRangeState] = useState<RangeValue>(() => {
    const preset =
      DATE_PRESETS.find(p => p.id === defaultPresetId) ??
      DATE_PRESETS.find(p => p.id === '30d') ??
      DATE_PRESETS[DATE_PRESETS.length - 1];
    return preset.resolve();
  });

  return {
    start: range.start,
    end: range.end,
    setRange: setRangeState,
  };
}

/* ─── useSelectedVehicle shim (web `@/hooks/useSelectedVehicle`) ────────────── */

interface SelectedVehicleResult {
  vehicleId: number | null;
  vehicles: Vehicle[];
  setVehicleId: (id: number | null) => void;
}

// The web hook's precedence (URL > store > first-vehicle) has no native
// router/store, so this shim keeps the final fallback (first vehicle in the
// fleet) while letting the header VehicleSelect switch the active id.
function useSelectedVehicle(): SelectedVehicleResult {
  const {data} = useVehicles();
  const vehicles: Vehicle[] = data ?? [];
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(null);
  const firstVehicleId = vehicles.length > 0 ? vehicles[0].id : null;

  useEffect(() => {
    if (selectedVehicleId == null && firstVehicleId != null) {
      setSelectedVehicleId(firstVehicleId);
    }
  }, [selectedVehicleId, firstVehicleId]);

  return {
    vehicleId: selectedVehicleId ?? firstVehicleId,
    vehicles,
    setVehicleId: setSelectedVehicleId,
  };
}

/* ─── heatmap data model (ported verbatim from the web source) ──────────────── */

function heatColor(count: number, max: number): string {
  if (count === 0 || max === 0) {
    return 'rgba(0, 240, 255, 0.04)';
  }
  const ratio = count / max;
  if (ratio < 0.25) {
    return 'rgba(0, 240, 255, 0.15)';
  }
  if (ratio < 0.5) {
    return 'rgba(16, 185, 129, 0.4)';
  }
  if (ratio < 0.75) {
    return 'rgba(245, 158, 11, 0.55)';
  }
  return 'rgba(239, 68, 68, 0.75)';
}

interface HeatCell {
  count: number;
  totalEnergy: number;
}

function buildGrid(sessions: ApiChargingSession[]) {
  const grid: HeatCell[][] = Array.from({length: 7}, () =>
    Array.from({length: 24}, () => ({count: 0, totalEnergy: 0})),
  );
  let maxCount = 0;
  let favDay = 0;
  let favHour = 0;

  for (const s of sessions) {
    const d = new Date(s.started_at);
    const day = d.getDay();
    const hour = d.getHours();
    grid[day][hour].count += 1;
    grid[day][hour].totalEnergy += convertEnergyFromSI(s.total_energy_added_wh, 'kWh');
    if (grid[day][hour].count > maxCount) {
      maxCount = grid[day][hour].count;
      favDay = day;
      favHour = hour;
    }
  }

  return {grid, maxCount, favDay, favHour};
}

/* ─── FadeIn (web `@/components/motion` FadeIn / StaggerItem) ───────────────── */

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

  return <Animated.View style={[animatedStyle, style]}>{children}</Animated.View>;
}

FadeIn.displayName = 'FadeIn';

/* ─── Skeleton (web `@/components/feedback` Skeleton) ───────────────────────── */

function Skeleton({height, style}: {height: number; style?: StyleProp<ViewStyle>}) {
  const reduceMotion = useReduceMotion();
  const pulse = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(0.6);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          toValue: 0.8,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          duration: 700,
          easing: Easing.inOut(Easing.quad),
          toValue: 0.4,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion]);

  return (
    <Animated.View
      accessibilityLabel="Loading"
      accessibilityRole="progressbar"
      style={[styles.skeleton, {height, opacity: pulse}, style]}
    />
  );
}

Skeleton.displayName = 'Skeleton';

/* ─── NativeSelect (web `@/components/forms` VehicleSelect / RangePicker) ────── */

interface NativeSelectOption {
  value: string;
  label: string;
}

function NativeSelect({
  value,
  options,
  onChange,
  accessibilityLabel,
  testID,
}: {
  value: string;
  options: NativeSelectOption[];
  onChange: (value: string) => void;
  accessibilityLabel: string;
  testID?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => o.value === value);

  return (
    <View style={styles.select}>
      <Pressable
        accessibilityHint="Opens the option list"
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{expanded: open}}
        onPress={() => setOpen(prev => !prev)}
        style={({pressed}) => [styles.selectTrigger, pressed && styles.pressed]}
        testID={testID}>
        <AppText numberOfLines={1} style={styles.selectValue}>
          {selected ? selected.label : '\u2014'}
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
                <AppText numberOfLines={1} tone={isSelected ? 'accent' : 'primary'}>
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

/* ─── StatCard (web GlassPanel hero stat cards) ─────────────────────────────── */

type StatGlow = 'cyan' | 'green' | 'purple' | 'none';

function StatCard({
  glow,
  label,
  value,
}: {
  glow: StatGlow;
  label: string;
  value: ReactNode;
}) {
  return (
    <GlassPanel glow={glow} hover padding="md" style={styles.statCard}>
      <AppText numberOfLines={2} style={styles.statLabel} tone="secondary" variant="caption">
        {label}
      </AppText>
      <AppText numberOfLines={1} style={styles.statValue} weight="semibold">
        {value}
      </AppText>
    </GlassPanel>
  );
}

StatCard.displayName = 'StatCard';

/* ─── HeatmapGrid (web CSS-grid heatmap; rebuilt with Views) ────────────────── */

const CELL_W = 22;
const CELL_H = 28;
const CELL_GAP = 2;
const LABEL_W = 56;

function HeatmapGrid({
  grid,
  maxCount,
  hovered,
  onSelect,
}: {
  grid: HeatCell[][];
  maxCount: number;
  hovered: {day: number; hour: number} | null;
  onSelect: (cell: {day: number; hour: number} | null) => void;
}) {
  const hours = Array.from({length: 24}, (_, h) => h);

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View>
        {/* Hour header row */}
        <View style={styles.gridRow}>
          <View style={styles.gridLabelSpacer} />
          {hours.map(h => (
            <View key={h} style={styles.hourHeaderCell}>
              <AppText style={styles.hourHeaderText} tone="muted">
                {h}
              </AppText>
            </View>
          ))}
        </View>

        {/* Day rows */}
        {DAYS.map((dayLabel, day) => (
          <View key={`row-${day}`} style={styles.gridRow}>
            <View style={styles.gridLabelCell}>
              <AppText style={styles.gridLabelText} tone="secondary" variant="caption">
                {dayLabel}
              </AppText>
            </View>
            {hours.map(hour => {
              const cell = grid[day]?.[hour] ?? {count: 0, totalEnergy: 0};
              const isHovered = hovered?.day === day && hovered?.hour === hour;
              return (
                <Pressable
                  accessibilityLabel={`${DAYS[day]} ${hour}:00, ${cell.count} sessions`}
                  accessibilityRole="button"
                  key={`${day}-${hour}`}
                  onPress={() => onSelect(isHovered ? null : {day, hour})}
                  style={[
                    styles.heatCell,
                    {backgroundColor: heatColor(cell.count, maxCount)},
                    isHovered && styles.heatCellSelected,
                  ]}
                />
              );
            })}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

HeatmapGrid.displayName = 'HeatmapGrid';

/* ─── LocationBarChart (web Recharts horizontal BarChart) ───────────────────── */

const LOC_BAR_COLOR = 'rgba(0, 240, 255, 0.6)';

function LocationBarChart({data}: {data: Array<{name: string; count: number}>}) {
  const maxCount = data.reduce((m, d) => Math.max(m, d.count), 0);

  return (
    <View style={styles.locChart}>
      {data.map(({name, count}) => {
        const pct = maxCount > 0 ? Math.max((count / maxCount) * 100, 3) : 0;
        return (
          <View key={name} style={styles.locRow}>
            <AppText
              numberOfLines={1}
              style={styles.locName}
              tone="secondary"
              variant="caption">
              {name}
            </AppText>
            <View style={styles.locTrack}>
              <View style={[styles.locBar, {width: `${pct}%` as DimensionValue}]} />
            </View>
            <AppText style={styles.locCount} weight="semibold" variant="caption">
              {fmtInt(count)}
            </AppText>
          </View>
        );
      })}
    </View>
  );
}

LocationBarChart.displayName = 'LocationBarChart';

/* ─── ChargingHeatmapPage ───────────────────────────────────────────────────── */

export default function ChargingHeatmapPage() {
  const t = useNativeTranslation();
  usePageTitle(t('charging.heatmap.title', 'Charging Patterns'));
  useSettings();

  // header VehiclePicker is the source of truth.
  const {vehicleId, vehicles, setVehicleId} = useSelectedVehicle();

  const {start, end, setRange} = useRangeState({
    persistKey: 'charging-heatmap.range',
    defaultPresetId: 'all',
  });

  const {
    data: sessions,
    isLoading,
    error,
  } = useChargingSessionsPaginated(vehicleId, {
    limit: 2000,
    start,
    end,
  });

  const stats = useMemo(() => {
    if (!sessions?.length) {
      return null;
    }
    const totalEnergy = sessions.reduce(
      (s, c) => s + convertEnergyFromSI(c.total_energy_added_wh, 'kWh'),
      0,
    );
    const totalCost = sessions.reduce((s, c) => s + (c.cost_decimal ?? 0), 0);
    const totalDuration = sessions.reduce(
      (s, c) => s + durationMinutes(c.started_at, c.ended_at ?? null),
      0,
    );
    return {
      count: sessions.length,
      totalEnergy,
      totalCost,
      avgDuration: totalDuration / sessions.length,
    };
  }, [sessions]);

  const {grid, maxCount, favDay, favHour} = useMemo(
    () =>
      sessions?.length
        ? buildGrid(sessions)
        : {grid: [] as HeatCell[][], maxCount: 0, favDay: 0, favHour: 0},
    [sessions],
  );

  const locationData = useMemo(() => {
    if (!sessions?.length) {
      return [] as Array<{name: string; count: number}>;
    }
    const counts: Record<string, number> = {};
    for (const s of sessions) {
      const name = s.start_place ?? 'Unknown';
      counts[name] = (counts[name] ?? 0) + 1;
    }
    return Object.entries(counts)
      .filter(([, c]) => c >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({name, count}));
  }, [sessions]);

  const [hovered, setHovered] = useState<{day: number; hour: number} | null>(null);

  const vehicleOptions: NativeSelectOption[] = vehicles.map(v => ({
    value: String(v.id),
    label: v.display_name || v.vin || `Vehicle ${v.id}`,
  }));

  const rangeOptions: NativeSelectOption[] = DATE_PRESETS.map(p => ({
    value: p.id,
    label: p.label,
  }));
  const activePresetId = matchPresetId(start, end) ?? 'all';

  const actions = (
    <View style={styles.actions}>
      {vehicles.length > 0 ? (
        <NativeSelect
          accessibilityLabel="Select vehicle"
          onChange={v => setVehicleId(v ? Number(v) : null)}
          options={vehicleOptions}
          testID="charging-heatmap-vehicle"
          value={vehicleId != null ? String(vehicleId) : ''}
        />
      ) : null}
      <NativeSelect
        accessibilityLabel="Select date range"
        onChange={id => {
          const preset = DATE_PRESETS.find(p => p.id === id);
          if (preset) {
            setRange(preset.resolve());
          }
        }}
        options={rangeOptions}
        testID="charging-heatmap-range"
        value={activePresetId}
      />
    </View>
  );

  const header = (
    <View style={styles.header}>
      <View style={styles.headerCopy}>
        <AppText style={styles.pageTitle} variant="title" weight="bold">
          {t('charging.heatmap.title', 'Charging Patterns')}
        </AppText>
        <AppText style={styles.pageSubtitle} tone="muted" variant="caption">
          {t('charging.heatmap.subtitle', 'When and where you charge')}
        </AppText>
      </View>
      {actions}
    </View>
  );

  if (isLoading) {
    return (
      <ScrollView
        contentContainerStyle={styles.screenContent}
        style={styles.screen}
        testID="charging-heatmap">
        {header}
        <View style={styles.statGrid}>
          {Array.from({length: 4}).map((_, i) => (
            <View key={i} style={styles.statCardWrap}>
              <Skeleton height={80} />
            </View>
          ))}
        </View>
        <Skeleton height={320} style={styles.loadingChart} />
      </ScrollView>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.screenContent}
      style={styles.screen}
      testID="charging-heatmap">
      {header}

      {error ? (
        <View style={styles.errorPanel}>
          <AppText style={styles.errorText} variant="caption">
            {(error as Error)?.message}
          </AppText>
        </View>
      ) : (
        <ErrorBoundary name="charging-heatmap-page">
          <View style={styles.stack}>
            {/* ── Stat cards ── */}
            <View style={styles.statGrid}>
              <FadeIn style={styles.statCardWrap}>
                <StatCard
                  glow="cyan"
                  label={t('charging.heatmap.totalSessions', 'Total Sessions')}
                  value={fmtInt(stats?.count ?? 0)}
                />
              </FadeIn>
              <FadeIn delay={0.05} style={styles.statCardWrap}>
                <StatCard
                  glow="green"
                  label={t('charging.heatmap.totalEnergy', 'Total Energy')}
                  value={`${fmtNumber(stats?.totalEnergy ?? 0, 1)} kWh`}
                />
              </FadeIn>
              <FadeIn delay={0.1} style={styles.statCardWrap}>
                <StatCard
                  glow="purple"
                  label={t('charging.heatmap.totalCost', 'Total Cost')}
                  value={formatCurrency(stats?.totalCost ?? 0)}
                />
              </FadeIn>
              <FadeIn delay={0.15} style={styles.statCardWrap}>
                <StatCard
                  glow="none"
                  label={t('charging.heatmap.avgDuration', 'Avg Duration')}
                  value={`${fmtInt(stats?.avgDuration ?? 0)} min`}
                />
              </FadeIn>
            </View>

            {/* ── Favorite charging time ── */}
            {maxCount > 0 ? (
              <FadeIn delay={0.1}>
                <GlassPanel glow="cyan" padding="md" style={styles.favoritePanel}>
                  <AppText style={styles.favoriteLabel} tone="secondary" variant="caption">
                    {t('charging.heatmap.favorite', 'Favorite Charging Time')}
                  </AppText>
                  <AppText style={styles.favoriteValue} weight="semibold">
                    {`${DAYS[favDay]}s at ${favHour.toString().padStart(2, '0')}:00`}
                    <AppText style={styles.favoriteMeta} tone="secondary">
                      {`  (${maxCount} sessions)`}
                    </AppText>
                  </AppText>
                </GlassPanel>
              </FadeIn>
            ) : null}

            {/* ── Heatmap grid ── */}
            <FadeIn delay={0.2}>
              <GlassPanel padding="md">
                <AppText style={styles.sectionTitle} weight="semibold">
                  {t('charging.heatmap.gridTitle', 'Weekly Charging Heatmap')}
                </AppText>
                <HeatmapGrid
                  grid={grid}
                  hovered={hovered}
                  maxCount={maxCount}
                  onSelect={setHovered}
                />

                {/* Tap-to-reveal detail (web hover tooltip has no touch analog) */}
                {hovered &&
                (grid[hovered.day]?.[hovered.hour]?.count ?? 0) > 0 ? (
                  <View style={styles.tooltip}>
                    <AppText variant="caption" weight="semibold">
                      {`${DAYS[hovered.day]} ${hovered.hour}:00`}
                    </AppText>
                    <AppText tone="secondary" variant="caption">
                      {`${grid[hovered.day][hovered.hour].count} sessions \u00B7 ${fmtNumber(
                        grid[hovered.day][hovered.hour].totalEnergy,
                        1,
                      )} kWh avg`}
                    </AppText>
                  </View>
                ) : null}

                {/* Legend */}
                <View style={styles.legend}>
                  <AppText style={styles.legendText} tone="secondary">
                    {t('charging.heatmap.less', 'Less')}
                  </AppText>
                  {[
                    'rgba(0,240,255,0.04)',
                    'rgba(0,240,255,0.15)',
                    'rgba(16,185,129,0.4)',
                    'rgba(245,158,11,0.55)',
                    'rgba(239,68,68,0.75)',
                  ].map(c => (
                    <View
                      key={c}
                      pointerEvents="none"
                      style={[styles.legendSwatch, {backgroundColor: c}]}
                    />
                  ))}
                  <AppText style={styles.legendText} tone="secondary">
                    {t('charging.heatmap.more', 'More')}
                  </AppText>
                </View>
              </GlassPanel>
            </FadeIn>

            {/* ── Top charging locations ── */}
            <FadeIn delay={0.3}>
              <GlassPanel padding="md">
                <AppText style={styles.sectionTitle} weight="semibold">
                  {t('charging.heatmap.topLocations', 'Top Charging Locations')}
                </AppText>
                {locationData.length > 0 ? (
                  <LocationBarChart data={locationData} />
                ) : (
                  <View style={styles.emptyState}>
                    <AppText tone="muted">{t('common.noData', 'No data available')}</AppText>
                  </View>
                )}
              </GlassPanel>
            </FadeIn>
          </View>
        </ErrorBoundary>
      )}
    </ScrollView>
  );
}

ChargingHeatmapPage.displayName = 'ChargingHeatmapPage';

const styles = StyleSheet.create({
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  errorPanel: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 12,
    borderWidth: 1,
    padding: spacing.md,
  },
  errorText: {
    color: colors.danger,
  },
  favoriteLabel: {},
  favoriteMeta: {
    fontSize: 13,
  },
  favoritePanel: {
    borderColor: 'rgba(34, 211, 238, 0.3)',
    gap: spacing.xs,
  },
  favoriteValue: {
    color: colors.textPrimary,
    fontSize: 17,
    lineHeight: 24,
  },
  gridLabelCell: {
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingRight: spacing.xs,
    width: LABEL_W,
  },
  gridLabelSpacer: {
    width: LABEL_W,
  },
  gridLabelText: {},
  gridRow: {
    flexDirection: 'row',
    gap: CELL_GAP,
    marginBottom: CELL_GAP,
  },
  heatCell: {
    borderRadius: 3,
    height: CELL_H,
    width: CELL_W,
  },
  heatCellSelected: {
    borderColor: colors.accent,
    borderWidth: 1,
  },
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  headerCopy: {
    flexGrow: 1,
    flexShrink: 1,
    gap: spacing.xs,
    minWidth: 200,
  },
  hourHeaderCell: {
    alignItems: 'center',
    width: CELL_W,
  },
  hourHeaderText: {
    fontSize: 9,
  },
  legend: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  legendSwatch: {
    borderRadius: 3,
    height: 12,
    width: 24,
  },
  legendText: {
    fontSize: 10,
  },
  loadingChart: {
    marginTop: spacing.md,
  },
  locBar: {
    backgroundColor: LOC_BAR_COLOR,
    borderRadius: 4,
    height: 18,
  },
  locChart: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  locCount: {
    minWidth: 32,
    textAlign: 'right',
  },
  locName: {
    width: 110,
  },
  locRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  locTrack: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 4,
    flex: 1,
    height: 18,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  pageSubtitle: {},
  pageTitle: {
    color: colors.textPrimary,
  },
  pressed: {
    opacity: 0.7,
  },
  screen: {
    backgroundColor: colors.background,
    flex: 1,
  },
  screenContent: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  sectionTitle: {
    fontSize: 15,
    marginBottom: spacing.md,
  },
  select: {
    minWidth: 160,
    position: 'relative',
    zIndex: 1,
  },
  selectChevron: {
    marginLeft: spacing.sm,
  },
  selectList: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
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
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  selectValue: {
    flexShrink: 1,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    width: '100%',
  },
  stack: {
    gap: spacing.lg,
  },
  statCard: {
    gap: spacing.xs,
    height: '100%',
  },
  statCardWrap: {
    flexBasis: '47%',
    flexGrow: 1,
    minWidth: 150,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  statLabel: {},
  statValue: {
    color: colors.textPrimary,
    fontSize: 20,
    lineHeight: 26,
  },
  tooltip: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    gap: 2,
    marginTop: spacing.sm,
    padding: spacing.sm,
  },
});
