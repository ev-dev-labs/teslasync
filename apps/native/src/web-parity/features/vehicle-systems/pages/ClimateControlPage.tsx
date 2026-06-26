/**
 * Native parity port of web/src/features/vehicle-systems/pages/ClimateControlPage.tsx.
 *
 * The web page is the per-vehicle "Climate Control" surface: a header
 * (VehicleSelect + Refresh button), an opt-in AI preheat/precool recommender,
 * a deterministic HVAC status banner, three temperature RadialGauges
 * (inside / outside / driver set), a 13-card climate-status grid, a 4-card
 * protection-and-safety row, a thermal-comfort indicator (comfort score / temp
 * delta / status), a 4-card climate-efficiency panel, a seat-heater grid
 * (front + rear heaters, auto-seat-climate chips, seat-cooling cards, legend),
 * a temperature-history LineChart, an AC-state/fan-speed AreaChart, and a
 * sortable climate-history DataTable. It reads the canonical `useClimate` /
 * `useClimateHistory` (`/climate/latest` + `/climate`) and
 * `useChargingTelemetryLatest` hooks, converts the backend's °C SI temperatures
 * to the user's display unit at the render boundary, and derives every chart
 * series + roll-up from the climate history.
 *
 * This native port preserves that contract 1:1 — the same three queries + exact
 * API paths (via the already-ported native useVehicleSystems / useVehicles
 * hooks), the verbatim `heatStyle` / `heatBadgeVariant` / `keeperVariant` /
 * `keeperLabel` / `comfortBadge` / `coolStyle` / `coolBadgeVariant` /
 * `climateAccessor` helpers + `HEAT_LEVELS` / `COOL_LEVELS` / `SEATS`
 * constants, the `SeatHeaterCard` / `SeatCoolingCard` sub-components, the
 * `toTemperatureDisplay` closure, the `tempGaugeMax` / `isFahrenheit`
 * derivations, every derived memo (`comfort` / `sortedHistory` / `columns` /
 * `frontSeats` / `rearSeats` / `chronoHistory` / `convertedChartData` /
 * `comfortScore` / `tempDelta` / `efficiencyStats` / `defaultDepartBy`), and
 * every section + empty state — using React Native primitives, the existing
 * native AppText / GlassPanel + design tokens, the already-ported web-parity
 * MetricCard + AIPreheatPrecoolRecommender + native-safe charts barrel, and
 * locally-reproduced native-safe shims for the remaining web-only deps.
 *
 * Browser-only / not-yet-ported dependencies are reduced explicitly and
 * documented in the `.parity.json` sidecar:
 *   - react-i18next `useTranslation` (web L2): no native i18next runtime, so an
 *     inline native-safe `t(key, fallback?)` shim returns the English fallback
 *     (else the key). The web's keys here are the English strings themselves, so
 *     every i18n key + intent is preserved verbatim.
 *   - `@/lib/cn` cn (web L3): the Tailwind class composer is unused on native —
 *     class strings become StyleSheet styles.
 *   - lucide-react icons (web L4-21): DOM SVG icons → semantic emoji glyph
 *     constants (the DrivingPerformanceCards / MileagePage icon→glyph precedent),
 *     rendered as the MetricCard string `icon`, the Button/Badge/EmptyState/section
 *     glyphs. Per-state dynamic icon colours collapse to the card's neon chip tint.
 *   - `@/components/layout` PageContainer (web L23): no native parity port yet, so
 *     a minimal native-safe PageContainer is reproduced locally (title / subtitle /
 *     loading / error / actions / children — the props this page uses), gating
 *     children behind the loading spinner exactly as the web does.
 *   - `@/components/forms` VehicleSelect (web L24): the web `<Select>` → a native
 *     Pressable chip selector wired to the shared selected-vehicle store (renders
 *     null for an empty fleet; label = display_name || vin || `Vehicle {id}`).
 *   - `@/components/ui` GlassPanel / Badge / Button / DataTable + useSortToggle +
 *     Column (web L25-28): native GlassPanel is the existing port; Badge / Button /
 *     DataTable + the controlled `useSortToggle` (sortKey/sortDir/onSort/sortFn)
 *     and `Column<T>` are reproduced locally as native-safe components preserving
 *     the public prop shapes (the web table's localStorage sort/resize/visibility
 *     is reduced to controlled sort + internal pagination).
 *   - `@/components/data-display` MetricCard (web L29): the already-ported
 *     web-parity component.
 *   - `@/components/charts` RadialGauge / Skeleton-less chart primitives
 *     (web L30-51): RadialGauge + LineChart/Line/AreaChart/Area/XAxis/YAxis/
 *     CartesianGrid/Tooltip/ResponsiveContainer/Legend/ChartTooltip +
 *     AREA_DEFAULTS/areaGradient/axisTick/chartAnimation/chartMarginLabeled/
 *     CHART_COLORS are imported from the native-safe web-parity charts barrel.
 *     Recharts has no React Native SVG backend, so the chart primitives render
 *     explicit "native chart unavailable" placeholders; the JSX structure, data
 *     wiring, axis/series props, gradient and legend flow are preserved 1:1.
 *   - `@/components/feedback` Skeleton / EmptyState (web L31-32): native-safe
 *     local equivalents (a static placeholder block supporting height|lines; a
 *     message-only / icon+message empty state). The web animate-pulse is static.
 *   - `@/components/motion` FadeIn (web L33): framer-motion entrance → a static
 *     passthrough View (the Layout precedent); the `delay` prop is inert.
 *   - `@/hooks/usePageTitle` (web L52): `document.title` is browser-only → a
 *     documented no-op (the native navigator owns the title).
 *   - `@/hooks/useSelectedVehicle` (web L53): the web hook layers react-router
 *     params over a zustand store; native derives the selection from the ported
 *     `useVehicles()` list via a shared external store → first vehicle.
 *   - `@/hooks/useUnits` (web L54): native-safe `useUnits` deriving
 *     `unitPrefs.temperature` ('°F' when settings.unit_of_temp === 'F', else '°C').
 *   - `@/lib/unitConversion` convertTempFromSI (web L55), `@/lib/dateFormat`
 *     formatDateTime / formatTime (web L56), `@/lib/numberFormat` fmtNumber /
 *     fmtInt (web L57), `@/lib/colors` CHART_COLORS (web L58): ported verbatim
 *     into native-safe helpers; CHART_COLORS reuses the charts-barrel CB-safe
 *     palette (identical Okabe-Ito hues).
 *   - `@/api/hooks/useVehicles` useChargingTelemetryLatest (web L60),
 *     `@/api/hooks/useVehicleSystems` useClimate / useClimateHistory (web L62) +
 *     `@/types/vehicle-systems` ClimateState (web L63): the already-ported native
 *     hooks + type (same `/climate/latest` + `/climate` + charging-telemetry
 *     paths and response shapes).
 *   - `@/components/ai/AIPreheatPrecoolRecommender` (web L61): the already-ported
 *     native component (withAiFeature-gated propose-only section).
 */
import React, {
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type TextStyle,
} from 'react-native';

import {
  useClimate,
  useClimateHistory,
  type ClimateState,
} from '../../../api/hooks/useVehicleSystems';
import {
  useChargingTelemetryLatest,
  useVehicles,
  type Vehicle,
} from '../../../api/hooks/useVehicles';
import {useSettings} from '../../../api/hooks/useSettings';
import {
  AREA_DEFAULTS,
  Area,
  AreaChart,
  CHART_COLORS,
  CartesianGrid,
  ChartTooltip,
  Legend,
  Line,
  LineChart,
  RadialGauge,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  areaGradient,
  axisTick,
  chartAnimation,
  chartMarginLabeled,
} from '../../../components/charts';
import {MetricCard} from '../../../components/data-display/MetricCard';
import {AIPreheatPrecoolRecommender} from '../../../components/ai/AIPreheatPrecoolRecommender';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing, typography} from '../../../../theme/tokens';

/* ─── Types ─── */

interface HeatLevelStyle {
  color: string;
  bg: string;
  label: string;
}

interface SeatDef {
  key: keyof Pick<
    ClimateState,
    | 'seatHeaterLeft'
    | 'seatHeaterRight'
    | 'seatHeaterRearLeft'
    | 'seatHeaterRearCenter'
    | 'seatHeaterRearRight'
  >;
  label: string;
  row: 'front' | 'rear';
}

/** Native-safe port of web/src/components/ui DataTable `Column<T>`. */
export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortable?: boolean;
  align?: 'left' | 'center' | 'right';
}

type TemperatureUnitPref = '\u00B0C' | '\u00B0F';

/* ─── lucide-react icon stand-ins (web L4-21) ─── */

const ICON_THERMOMETER = '\uD83C\uDF21'; // 🌡 (Thermometer)
const ICON_WIND = '\uD83D\uDCA8'; // 💨 (Wind)
const ICON_SNOWFLAKE = '\u2744'; // ❄ (Snowflake)
const ICON_SUN = '\u2600'; // ☀ (Sun)
const ICON_POWER = '\u23FB'; // ⏻ (Power)
const ICON_FLAME = '\uD83D\uDD25'; // 🔥 (Flame)
const ICON_CIRCLE_GAUGE = '\uD83C\uDF9B'; // 🎛 (CircleGauge)
const ICON_SETTINGS = '\u2699'; // ⚙ (Settings)
const ICON_THERMOMETER_SUN = '\uD83C\uDF24'; // 🌤 (ThermometerSun)
const ICON_REFRESH = '\u21BB'; // ↻ (RefreshCw)
const ICON_SHIELD_CHECK = '\uD83D\uDEE1'; // 🛡 (ShieldCheck)
const ICON_BATTERY_CHARGING = '\uD83D\uDD0B'; // 🔋 (BatteryCharging)
const ICON_ZAP = '\u26A1'; // ⚡ (Zap)
const ICON_ACTIVITY = '\uD83D\uDCC8'; // 📈 (Activity)
const ICON_ALERT_TRIANGLE = '\u26A0'; // ⚠ (AlertTriangle)
const ICON_MONITOR = '\uD83D\uDDA5'; // 🖥 (Monitor)

/* ─── toned-down tailwind hues used for icon glyphs ─── */

const TW = {
  cyan400: '#22d3ee',
  cyan300: '#67e8f9',
  amber400: '#fbbf24',
  red400: '#f87171',
  sky400: '#38bdf8',
  blue400: '#60a5fa',
  teal400: '#2dd4bf',
  purple400: '#c084fc',
  green400: '#4ade80',
  orange400: '#fb923c',
} as const;

/* ─── native-safe i18n (react-i18next has no native runtime, web L2) ─── */

type NativeTFunction = (key: string, fallback?: string) => string;

function useNativeTranslation(): NativeTFunction {
  return useMemo<NativeTFunction>(() => (key, fallback) => fallback ?? key, []);
}

/* ─── native-safe usePageTitle (web document.title is browser-only) ─── */

function usePageTitle(_title: string): void {
  // The web hook writes document.title; on native the navigator owns the header
  // title, so the resolved title is intentionally not applied.
}

/* ─── ported lib helpers (web L55/L56/L57) ─── */

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** convertTempFromSI — SI °C → display unit (web L55). */
function convertTempFromSI(celsius: number, to: TemperatureUnitPref): number {
  return to === '\u00B0F' ? (celsius * 9) / 5 + 32 : celsius;
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

/** fmtInt — integer with locale separators (web L57). */
function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

/** formatDateTime — "Apr 4, 2026, 09:31 AM" else "—" (web/src/lib/dateFormat.ts). */
function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) {
    return '\u2014';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '\u2014';
  }
  try {
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '\u2014';
  }
}

/** formatTime — "09:31 AM" else "—" (web/src/lib/dateFormat.ts). */
function formatTime(iso: string | Date | null | undefined): string {
  if (!iso) {
    return '\u2014';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '\u2014';
  }
  try {
    return d.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
  } catch {
    return '\u2014';
  }
}

/* ─── native-safe useUnits (web L54 → useSettings derivation) ─── */

interface UnitPrefs {
  temperature: TemperatureUnitPref;
}

function useUnits(): {unitPrefs: UnitPrefs} {
  const {data: settings} = useSettings();
  const unitOfTemp = settings?.unit_of_temp;
  return useMemo<{unitPrefs: UnitPrefs}>(
    () => ({
      unitPrefs: {temperature: unitOfTemp === 'F' ? '\u00B0F' : '\u00B0C'},
    }),
    [unitOfTemp],
  );
}

/* ─── native-safe useSelectedVehicle (web L53) ─── */

interface SelectedVehicleResult {
  vehicleId: number | null;
  vehicles: Vehicle[];
  setVehicleId: (id: number | null) => void;
}

// Module-level shared selection store. The web hook persists the picker choice
// in a zustand store so the header VehicleSelect and the page body stay in sync;
// native reproduces that single source of truth with a tiny external store
// (router path/query-param precedence is dropped — there is no native router).
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

/* ─── native FadeIn (web @/components/motion FadeIn) ─── */

function FadeIn({children}: {children: ReactNode; delay?: number}) {
  return <View>{children}</View>;
}

/* ─── native Skeleton (web @/components/feedback Skeleton) ─── */

function Skeleton({height = 16, lines}: {height?: number; lines?: number}) {
  if (lines && lines > 0) {
    return (
      <View style={styles.skeletonStack}>
        {Array.from({length: lines}).map((_, i) => (
          <View key={i} style={[styles.skeleton, styles.skeletonLine]} />
        ))}
      </View>
    );
  }
  return <View style={[styles.skeleton, {height}]} />;
}

/* ─── native EmptyState (web @/components/feedback EmptyState) ─── */

interface EmptyStateProps {
  icon?: ReactNode;
  message: string;
  testID?: string;
}

function EmptyState({icon, message, testID}: EmptyStateProps) {
  return (
    <View style={styles.emptyState} testID={testID}>
      {icon != null
        ? typeof icon === 'string'
          ? (
            <AppText style={styles.emptyStateGlyph} tone="muted">
              {icon}
            </AppText>
          )
          : <View style={styles.emptyStateIcon}>{icon}</View>
        : null}
      <AppText style={styles.emptyStateMessage} tone="muted" variant="caption">
        {message}
      </AppText>
    </View>
  );
}

/* ─── native Badge (web @/components/ui Badge) ─── */

type BadgeVariant = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const BADGE_VARIANT: Record<
  BadgeVariant,
  {bg: string; text: string; border: string}
> = {
  neutral: {
    bg: 'rgba(148, 163, 184, 0.14)',
    text: colors.textSecondary,
    border: colors.border,
  },
  info: {
    bg: 'rgba(59, 130, 246, 0.16)',
    text: '#93c5fd',
    border: 'rgba(59, 130, 246, 0.32)',
  },
  success: {
    bg: colors.successSurface,
    text: colors.success,
    border: colors.successBorder,
  },
  warning: {
    bg: colors.warningSurface,
    text: colors.warning,
    border: colors.warningBorder,
  },
  danger: {
    bg: colors.dangerSurface,
    text: colors.danger,
    border: colors.dangerBorder,
  },
};

interface BadgeProps {
  variant?: BadgeVariant;
  size?: 'sm' | 'md' | 'lg';
  dot?: boolean;
  children: ReactNode;
}

function Badge({variant = 'neutral', size = 'md', dot, children}: BadgeProps) {
  const v = BADGE_VARIANT[variant];
  return (
    <View
      style={[
        styles.badge,
        size === 'sm' && styles.badgeSm,
        {backgroundColor: v.bg, borderColor: v.border},
      ]}>
      {dot ? (
        <View style={[styles.badgeDot, {backgroundColor: v.text}]} />
      ) : null}
      {React.isValidElement(children) ? (
        children
      ) : (
        <AppText
          numberOfLines={1}
          style={[styles.badgeText, size === 'sm' && styles.badgeTextSm, {color: v.text}]}>
          {children}
        </AppText>
      )}
    </View>
  );
}

/* ─── native Button (web @/components/ui Button) ─── */

interface ButtonProps {
  variant?: 'ghost' | 'primary' | 'secondary';
  size?: 'sm' | 'md' | 'lg';
  icon?: string;
  onPress?: () => void;
  children: ReactNode;
}

function Button({icon, onPress, children}: ButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={6}
      onPress={onPress}
      style={({pressed}) => [styles.button, pressed && styles.buttonPressed]}>
      {icon ? (
        <AppText style={styles.buttonIcon} tone="secondary">
          {icon}
        </AppText>
      ) : null}
      <AppText style={styles.buttonText} variant="caption" weight="semibold">
        {children}
      </AppText>
    </Pressable>
  );
}

/* ─── native VehicleSelect (web @/components/forms VehicleSelect) ─── */

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
              style={[
                styles.vehicleChipText,
                active && styles.vehicleChipTextActive,
              ]}
              variant="caption">
              {label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ─── native PageContainer (web @/components/layout PageContainer) ─── */

interface PageContainerProps {
  title: string;
  subtitle?: string;
  loading?: boolean;
  error?: Error | null;
  actions?: ReactNode;
  children: ReactNode;
  testID?: string;
}

function PageContainer({
  title,
  subtitle,
  loading,
  error,
  actions,
  children,
  testID,
}: PageContainerProps) {
  return (
    <ScrollView
      contentContainerStyle={styles.scaffold}
      testID={testID ?? 'climate-control-page'}>
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

      {loading ? (
        <View style={styles.loading} testID="climate-loading">
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : error ? (
        <View style={styles.errorBox} testID="climate-error">
          <AppText style={styles.errorText} variant="caption">
            {error.message}
          </AppText>
        </View>
      ) : (
        <View style={styles.scaffoldBody}>{children}</View>
      )}
    </ScrollView>
  );
}

/* ─── controlled sort hook + DataTable (web @/components/ui) ─── */

function useSortToggle(defaultKey?: string, defaultDir: 'asc' | 'desc' = 'desc') {
  const [sortKey, setSortKey] = useState(defaultKey ?? '');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(defaultDir);

  const onSort = useCallback(
    (key: string) => {
      if (key === sortKey) {
        setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortKey(key);
        setSortDir('desc');
      }
    },
    [sortKey],
  );

  const sortFn = useCallback(
    <T,>(data: T[], accessor: (row: T, key: string) => number | string) => {
      if (!sortKey) {
        return data;
      }
      return [...data].sort((a, b) => {
        const av = accessor(a, sortKey);
        const bv = accessor(b, sortKey);
        const cmp = av < bv ? -1 : av > bv ? 1 : 0;
        return sortDir === 'asc' ? cmp : -cmp;
      });
    },
    [sortKey, sortDir],
  );

  return {sortKey, sortDir, onSort, sortFn};
}

interface DataTableProps<T> {
  tableId?: string;
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T) => string | number;
  sortKey?: string;
  sortDir?: 'asc' | 'desc';
  onSort?: (key: string) => void;
  compact?: boolean;
  pagination?: boolean;
}

const PAGE_SIZE = 10;

function alignStyle(align: Column<unknown>['align']): TextStyle {
  if (align === 'right') {
    return {textAlign: 'right'};
  }
  if (align === 'center') {
    return {textAlign: 'center'};
  }
  return {textAlign: 'left'};
}

function DataTable<T>({
  tableId,
  columns,
  data,
  keyExtractor,
  sortKey,
  sortDir,
  onSort,
  compact,
  pagination,
}: DataTableProps<T>) {
  const [page, setPage] = useState(0);

  const pageCount = pagination
    ? Math.max(1, Math.ceil(data.length / PAGE_SIZE))
    : 1;
  const safePage = Math.min(page, pageCount - 1);
  const visible = pagination
    ? data.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)
    : data;

  return (
    <View testID={tableId ?? 'datatable'}>
      <View style={[styles.tableRow, styles.tableHeaderRow]}>
        {columns.map(col => {
          const isSorted = sortKey === col.key;
          const indicator = isSorted
            ? sortDir === 'asc'
              ? ' \u25B2'
              : ' \u25BC'
            : '';
          return (
            <Pressable
              accessibilityRole={col.sortable ? 'button' : 'text'}
              disabled={!col.sortable}
              key={col.key}
              onPress={() => {
                if (col.sortable) {
                  onSort?.(col.key);
                  setPage(0);
                }
              }}
              style={styles.tableCell}>
              <AppText
                numberOfLines={1}
                style={[styles.tableHeaderText, alignStyle(col.align)]}
                tone="muted"
                variant="caption"
                weight="semibold">
                {col.header}
                {indicator}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      {visible.map(row => (
        <View
          key={String(keyExtractor(row))}
          style={[styles.tableRow, compact && styles.tableRowCompact]}>
          {columns.map(col => {
            const content = col.render(row);
            return (
              <View key={col.key} style={styles.tableCell}>
                {typeof content === 'string' || typeof content === 'number' ? (
                  <AppText
                    numberOfLines={1}
                    style={[styles.tableCellText, alignStyle(col.align)]}
                    variant="caption">
                    {content}
                  </AppText>
                ) : (
                  content
                )}
              </View>
            );
          })}
        </View>
      ))}

      {pagination && pageCount > 1 ? (
        <View style={styles.pagination}>
          <Pressable
            accessibilityRole="button"
            disabled={safePage === 0}
            hitSlop={6}
            onPress={() => setPage(p => Math.max(0, p - 1))}
            style={[styles.pageButton, safePage === 0 && styles.pageButtonDisabled]}>
            <AppText style={styles.pageButtonText} variant="caption">
              {'\u2039'}
            </AppText>
          </Pressable>
          <AppText style={styles.pageLabel} tone="muted" variant="caption">
            {`${safePage + 1} / ${pageCount}`}
          </AppText>
          <Pressable
            accessibilityRole="button"
            disabled={safePage >= pageCount - 1}
            hitSlop={6}
            onPress={() => setPage(p => Math.min(pageCount - 1, p + 1))}
            style={[
              styles.pageButton,
              safePage >= pageCount - 1 && styles.pageButtonDisabled,
            ]}>
            <AppText style={styles.pageButtonText} variant="caption">
              {'\u203A'}
            </AppText>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/* ─── Constants ─── */

const HEAT_LEVELS: HeatLevelStyle[] = [
  {color: colors.textMuted, bg: 'rgba(107, 114, 128, 0.1)', label: 'Off'},
  {color: TW.cyan400, bg: 'rgba(34, 211, 238, 0.1)', label: 'Low'},
  {color: TW.amber400, bg: 'rgba(251, 191, 36, 0.1)', label: 'Medium'},
  {color: TW.red400, bg: 'rgba(248, 113, 113, 0.1)', label: 'High'},
];

const SEATS: SeatDef[] = [
  {key: 'seatHeaterLeft', label: 'Front Left', row: 'front'},
  {key: 'seatHeaterRight', label: 'Front Right', row: 'front'},
  {key: 'seatHeaterRearLeft', label: 'Rear Left', row: 'rear'},
  {key: 'seatHeaterRearCenter', label: 'Rear Center', row: 'rear'},
  {key: 'seatHeaterRearRight', label: 'Rear Right', row: 'rear'},
];

const COOL_LEVELS: HeatLevelStyle[] = [
  {color: colors.textMuted, bg: 'rgba(107, 114, 128, 0.1)', label: 'Off'},
  {color: TW.sky400, bg: 'rgba(56, 189, 248, 0.1)', label: 'Low'},
  {color: TW.cyan300, bg: 'rgba(103, 232, 249, 0.1)', label: 'Medium'},
  {color: TW.blue400, bg: 'rgba(96, 165, 250, 0.1)', label: 'High'},
];

/* ─── Helpers ─── */

function heatStyle(level: number): HeatLevelStyle {
  return HEAT_LEVELS[Math.min(Math.max(level, 0), 3)];
}

function heatBadgeVariant(level: number): BadgeVariant {
  if (level <= 0) {
    return 'neutral';
  }
  if (level === 1) {
    return 'info';
  }
  if (level === 2) {
    return 'warning';
  }
  return 'danger';
}

function keeperVariant(mode: string): BadgeVariant {
  switch (mode) {
    case 'On':
      return 'info';
    case 'Dog Mode':
      return 'warning';
    case 'Camp Mode':
      return 'info';
    default:
      return 'neutral';
  }
}

function keeperLabel(mode: string): string {
  switch (mode) {
    case 'On':
      return 'On';
    case 'Dog Mode':
      return 'Dog Mode';
    case 'Camp Mode':
      return 'Camp Mode';
    default:
      return 'Off';
  }
}

function comfortBadge(
  inside: number,
  target: number,
): {variant: 'success' | 'warning' | 'danger'; label: string} {
  const delta = Math.abs(inside - target);
  if (delta <= 1) {
    return {variant: 'success', label: 'Comfortable'};
  }
  if (delta <= 3) {
    return {variant: 'warning', label: 'Adjusting'};
  }
  return {variant: 'danger', label: 'Far from target'};
}

function coolStyle(level: number): HeatLevelStyle {
  return COOL_LEVELS[Math.min(Math.max(Math.round(level), 0), 3)];
}

function coolBadgeVariant(level: number): BadgeVariant {
  if (level <= 0) {
    return 'neutral';
  }
  if (level === 1) {
    return 'info';
  }
  if (level === 2) {
    return 'info';
  }
  return 'info';
}

function climateAccessor(row: ClimateState, key: string): number | string {
  switch (key) {
    case 'timestamp':
      return row.timestamp ? new Date(row.timestamp).getTime() : 0;
    case 'insideTemp':
      return row.insideTemp ?? 0;
    case 'outsideTemp':
      return row.outsideTemp ?? 0;
    case 'driverTempSetting':
      return row.driverTempSetting ?? 0;
    case 'fanSpeed':
      return row.fanSpeed ?? 0;
    default:
      return 0;
  }
}

/* ─── Seat Heater Card (extracted for readability) ─── */

function SeatHeaterCard({
  label,
  level,
  t,
}: {
  label: string;
  level: number;
  t: NativeTFunction;
}) {
  const style = heatStyle(level);
  return (
    <GlassPanel style={[styles.seatCard, {backgroundColor: style.bg}]}>
      <AppText style={[styles.seatGlyph, {color: style.color}]}>
        {ICON_FLAME}
      </AppText>
      <AppText style={styles.seatLabel} tone="secondary" variant="caption" weight="semibold">
        {t(label)}
      </AppText>
      <Badge variant={heatBadgeVariant(level)} size="sm">
        {`${t(style.label)} (${level}/3)`}
      </Badge>
    </GlassPanel>
  );
}

/* ─── Seat Cooling Card ─── */

function SeatCoolingCard({
  label,
  level,
  t,
}: {
  label: string;
  level: number | null | undefined;
  t: NativeTFunction;
}) {
  const lvl = level ?? 0;
  const style = coolStyle(lvl);
  return (
    <GlassPanel style={[styles.seatCard, {backgroundColor: style.bg}]}>
      <AppText style={[styles.seatGlyph, {color: style.color}]}>
        {ICON_SNOWFLAKE}
      </AppText>
      <AppText style={styles.seatLabel} tone="secondary" variant="caption" weight="semibold">
        {t(label)}
      </AppText>
      {level != null ? (
        <Badge variant={coolBadgeVariant(lvl)} size="sm">
          {`${t(style.label)} (${Math.round(lvl)}/3)`}
        </Badge>
      ) : (
        <AppText style={styles.dash} tone="muted" variant="caption">
          {'\u2014'}
        </AppText>
      )}
    </GlassPanel>
  );
}

/* ═══════════════════════════════════════════════════════
   Climate Control Page
   ═══════════════════════════════════════════════════════ */

export default function ClimateControlPage() {
  const t = useNativeTranslation();
  usePageTitle(t('Climate Control'));
  const {unitPrefs} = useUnits();
  const tempUnit = unitPrefs.temperature;
  const isFahrenheit = tempUnit === '\u00B0F';
  const tempGaugeMax = isFahrenheit ? 131 : 55;
  // Backend ClimateState fields (insideTemp, outsideTemp, driverTempSetting,
  // passengerTempSetting) arrive in °C SI. `convertTempFromSI` accepts the
  // °C scalar directly and returns the user-pref display value.
  const toTemperatureDisplay = (celsius: number) =>
    convertTempFromSI(celsius, tempUnit);

  /* ─── Vehicle selector: header VehiclePicker is the source of truth ─── */
  const {vehicleId} = useSelectedVehicle();
  const activeId = vehicleId != null ? String(vehicleId) : '';

  /* ─── Climate data ─── */
  const {data: latest, isLoading, error, refetch} = useClimate(activeId);

  const {data: history, isLoading: historyLoading} = useClimateHistory(activeId);

  /* ─── Charging telemetry (for NotEnoughPowerToHeat alert) ─── */
  const activeIdNum = Number(activeId) || 0;
  const {data: chargingLatest} = useChargingTelemetryLatest(activeIdNum);

  /* ─── AI preheat/precool default departure (8 hours from now, RFC3339) ─── */
  const defaultDepartBy = useMemo(
    () => new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
    [],
  );

  /* ─── Comfort indicator ─── */
  const comfort = useMemo(
    () => comfortBadge(latest?.insideTemp ?? 0, latest?.driverTempSetting ?? 0),
    [latest?.insideTemp, latest?.driverTempSetting],
  );

  /* ─── Table sort ─── */
  const {sortKey, sortDir, onSort, sortFn} = useSortToggle('timestamp', 'desc');

  const sortedHistory = useMemo(() => {
    if (!history) {
      return [];
    }
    return sortFn(history, climateAccessor);
  }, [history, sortFn]);

  /* ─── Table columns ─── */
  const columns = useMemo<Column<ClimateState>[]>(
    () => [
      {
        key: 'timestamp',
        header: t('Time'),
        sortable: true,
        render: row => (row.timestamp ? formatDateTime(row.timestamp) : '\u2014'),
      },
      {
        key: 'insideTemp',
        header: `${t('Inside')} ${tempUnit}`,
        sortable: true,
        render: row =>
          row.insideTemp != null
            ? fmtNumber(toTemperatureDisplay(row.insideTemp), 1)
            : '\u2014',
      },
      {
        key: 'outsideTemp',
        header: `${t('Outside')} ${tempUnit}`,
        sortable: true,
        render: row =>
          row.outsideTemp != null
            ? fmtNumber(toTemperatureDisplay(row.outsideTemp), 1)
            : '\u2014',
      },
      {
        key: 'driverTempSetting',
        header: `${t('Set Temp')} ${tempUnit}`,
        sortable: true,
        render: row =>
          row.driverTempSetting != null
            ? fmtNumber(toTemperatureDisplay(row.driverTempSetting), 1)
            : '\u2014',
      },
      {
        key: 'fanSpeed',
        header: t('Fan'),
        sortable: true,
        render: row => (row.fanSpeed != null ? String(row.fanSpeed) : '\u2014'),
      },
      {
        key: 'isAcOn',
        header: t('HVAC'),
        render: row => (
          <Badge variant={row.isAcOn ? 'success' : 'neutral'} size="sm">
            {row.isAcOn ? t('On') : t('Off')}
          </Badge>
        ),
      },
      {
        key: 'climateKeeperMode',
        header: t('Climate Keeper'),
        render: row => (
          <Badge variant={keeperVariant(row.climateKeeperMode ?? '')} size="sm">
            {t(keeperLabel(row.climateKeeperMode ?? ''))}
          </Badge>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t],
  );

  /* ─── Front / rear seat lists ─── */
  const frontSeats = SEATS.filter(s => s.row === 'front');
  const rearSeats = SEATS.filter(s => s.row === 'rear');

  /* ─── Chronological history (backend returns newest-first) ─── */
  const chronoHistory = useMemo(() => {
    if (!history || history.length === 0) {
      return [];
    }
    return [...history].sort(
      (a, b) =>
        new Date(a.timestamp ?? a.created_at ?? '').getTime() -
        new Date(b.timestamp ?? b.created_at ?? '').getTime(),
    );
  }, [history]);

  const convertedChartData = useMemo(
    () =>
      chronoHistory.map(h => ({
        ...h,
        insideTemp: h.insideTemp != null ? toTemperatureDisplay(h.insideTemp) : null,
        outsideTemp:
          h.outsideTemp != null ? toTemperatureDisplay(h.outsideTemp) : null,
        driverTempSetting:
          h.driverTempSetting != null
            ? toTemperatureDisplay(h.driverTempSetting)
            : null,
        acActive: h.isAcOn ? 1 : 0,
      })),
    // Track the primitive `tempUnit` instead of the closure `toTemperatureDisplay`
    // so non-temperature settings churn doesn't invalidate the memo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chronoHistory, tempUnit],
  );

  /* ─── Comfort score & temp delta ─── */
  const comfortScore = useMemo(() => {
    if (latest?.insideTemp == null || latest?.driverTempSetting == null) {
      return null;
    }
    const delta = Math.abs(latest.insideTemp - latest.driverTempSetting);
    return Math.max(0, 100 - delta * 10);
  }, [latest?.insideTemp, latest?.driverTempSetting]);

  const tempDelta = useMemo(() => {
    if (latest?.insideTemp == null || latest?.driverTempSetting == null) {
      return null;
    }
    return +fmtNumber(latest.insideTemp - latest.driverTempSetting, 1);
  }, [latest?.insideTemp, latest?.driverTempSetting]);

  /* ─── Climate efficiency stats ─── */
  // HvacPower is an enum signal (not kW), so numeric power stats are unavailable.
  // Fan speed stats are derived from the available HvacFanSpeed float signal.
  const efficiencyStats = useMemo(() => {
    if (chronoHistory.length === 0) {
      return null;
    }
    const withFan = chronoHistory.filter(h => h.fanSpeed != null && h.fanSpeed > 0);
    if (withFan.length === 0) {
      return null;
    }
    const speeds = withFan.map(h => h.fanSpeed ?? 0);
    const avgFan = speeds.reduce((s, v) => s + v, 0) / speeds.length;
    const peakFan = Math.max(...speeds);
    const acOnCount = chronoHistory.filter(h => h.isAcOn).length;
    const acOnPct = (acOnCount / chronoHistory.length) * 100;
    return {avgFan, peakFan, acOnPct};
  }, [chronoHistory]);

  /* ═══════════════════════════════════════════════════════
     Render
     ═══════════════════════════════════════════════════════ */

  return (
    <PageContainer
      title={t('Climate Control')}
      subtitle={t('HVAC status, temperatures, and seat heaters')}
      loading={isLoading}
      error={error as Error | null}
      actions={
        <View style={styles.headerActions}>
          <VehicleSelect />
          <Button
            variant="ghost"
            size="sm"
            icon={ICON_REFRESH}
            onPress={() => void refetch()}>
            {t('Refresh')}
          </Button>
        </View>
      }>
      {/* ─── AI: Preheat / Precool recommender ─── */}
      <FadeIn>
        <AIPreheatPrecoolRecommender
          vehicleId={activeIdNum > 0 ? activeIdNum : undefined}
          currentCabinTempC={latest?.insideTemp ?? null}
          outsideTempC={latest?.outsideTemp ?? null}
          targetCabinTempC={latest?.driverTempSetting ?? 21}
          departBy={defaultDepartBy}
        />
      </FadeIn>

      {/* ─── HVAC Status Banner ─── */}
      <FadeIn>
        <GlassPanel
          style={[
            styles.banner,
            latest?.isAcOn ? styles.bannerActive : styles.bannerInactive,
          ]}>
          <View style={styles.bannerLeft}>
            <AppText
              style={[
                styles.bannerGlyph,
                {color: latest?.isAcOn ? TW.cyan400 : colors.textMuted},
              ]}>
              {ICON_POWER}
            </AppText>
            <AppText style={styles.bannerLabel} weight="semibold">
              {t('HVAC System')}
            </AppText>
            <Badge variant={latest?.isAcOn ? 'success' : 'neutral'}>
              {latest?.isAcOn ? t('Active') : t('Off')}
            </Badge>
            <Badge variant={comfort.variant} size="sm">
              {t(comfort.label)}
            </Badge>
          </View>
          <View style={styles.bannerRight}>
            {latest?.climateKeeperMode &&
            latest.climateKeeperMode !== 'Off' ? (
              <Badge variant={keeperVariant(latest.climateKeeperMode)} dot>
                {t(keeperLabel(latest.climateKeeperMode))}
              </Badge>
            ) : null}
            {latest?.defrostMode && latest.defrostMode !== 'Off' ? (
              <Badge variant="info" dot>
                {`${ICON_SNOWFLAKE} ${t('Defrost')}${
                  latest.defrostMode !== 'Normal'
                    ? ` (${latest.defrostMode})`
                    : ''
                }`}
              </Badge>
            ) : null}
            {latest?.batteryHeater ? (
              <Badge variant="warning" dot>
                {`${ICON_BATTERY_CHARGING} ${t('Battery Heater')}`}
              </Badge>
            ) : null}
            {chargingLatest?.not_enough_power_to_heat ? (
              <Badge variant="danger" dot>
                {`${ICON_ALERT_TRIANGLE} ${t('Insufficient Power to Heat')}`}
              </Badge>
            ) : null}
          </View>
        </GlassPanel>
      </FadeIn>

      {/* ─── Temperature Gauges ─── */}
      <FadeIn delay={0.1}>
        <View style={styles.stackGrid}>
          <GlassPanel style={styles.gaugePanel}>
            {latest?.insideTemp != null ? (
              <>
                <RadialGauge
                  value={toTemperatureDisplay(latest.insideTemp)}
                  max={tempGaugeMax}
                  label={t('Inside Temp')}
                  unit={tempUnit}
                  color={CHART_COLORS[0]}
                />
                <AppText style={styles.gaugeValue} weight="bold">
                  {`${fmtNumber(toTemperatureDisplay(latest.insideTemp), 1)}${tempUnit}`}
                </AppText>
              </>
            ) : (
              <EmptyState icon={ICON_THERMOMETER} message={t('Inside Temp')} />
            )}
          </GlassPanel>

          <GlassPanel style={styles.gaugePanel}>
            {latest?.outsideTemp != null ? (
              <>
                <RadialGauge
                  value={toTemperatureDisplay(latest.outsideTemp)}
                  max={tempGaugeMax}
                  label={t('Outside Temp')}
                  unit={tempUnit}
                  color={CHART_COLORS[1]}
                />
                <AppText style={styles.gaugeValue} weight="bold">
                  {`${fmtNumber(toTemperatureDisplay(latest.outsideTemp), 1)}${tempUnit}`}
                </AppText>
              </>
            ) : (
              <EmptyState icon={ICON_THERMOMETER} message={t('Outside Temp')} />
            )}
          </GlassPanel>

          <GlassPanel style={styles.gaugePanel}>
            {latest?.driverTempSetting != null ? (
              <>
                <RadialGauge
                  value={toTemperatureDisplay(latest.driverTempSetting)}
                  max={tempGaugeMax}
                  label={t('Driver Set Temp')}
                  unit={tempUnit}
                  color={CHART_COLORS[2]}
                />
                <AppText style={styles.gaugeValue} weight="bold">
                  {`${fmtNumber(toTemperatureDisplay(latest.driverTempSetting), 1)}${tempUnit}`}
                </AppText>
              </>
            ) : (
              <EmptyState
                icon={ICON_THERMOMETER_SUN}
                message={t('Driver Set Temp')}
              />
            )}
          </GlassPanel>
        </View>
      </FadeIn>

      {/* ─── Climate Status Cards (multi-card grid) ─── */}
      <FadeIn delay={0.2}>
        <View style={styles.metricGrid}>
          <View style={styles.metricCell}>
            <MetricCard
              label={t('HVAC Power')}
              value={latest?.isAcOn ? t('On') : t('Off')}
              icon={ICON_POWER}
              subtitle={
                latest?.hvacPower != null
                  ? `${t('State')}: ${latest.hvacPower}`
                  : undefined
              }
            />
          </View>

          <View style={styles.metricCell}>
            <MetricCard
              label={t('Auto Conditioning')}
              value={
                latest?.hvacAutoMode != null && latest.hvacAutoMode !== 'Off'
                  ? t('On')
                  : t('Off')
              }
              color="blue"
              icon={ICON_SETTINGS}
            />
          </View>

          <View style={styles.metricCell}>
            <MetricCard
              label={t('Climate Keeper')}
              value={t(keeperLabel(latest?.climateKeeperMode ?? 'off'))}
              color="amber"
              icon={ICON_THERMOMETER_SUN}
              subtitle={
                latest?.climateKeeperMode && latest.climateKeeperMode !== 'Off'
                  ? t('Active')
                  : undefined
              }
            />
          </View>

          <View style={styles.metricCell}>
            <MetricCard
              label={t('Fan Speed')}
              value={String(latest?.fanSpeed ?? 0)}
              icon={ICON_WIND}
              subtitle={`${t('Level')} 0\u201310`}
            />
          </View>

          <View style={styles.metricCell}>
            <MetricCard
              label={t('Fan Status')}
              value={
                latest?.hvacFanStatus != null
                  ? latest.hvacFanStatus > 0
                    ? t('Running')
                    : t('Idle')
                  : '\u2014'
              }
              icon={ICON_WIND}
              subtitle={
                latest?.hvacFanStatus != null
                  ? `${t('Code')} ${latest.hvacFanStatus}`
                  : undefined
              }
            />
          </View>

          <View style={styles.metricCell}>
            <MetricCard
              label={t('Steering Wheel Heater')}
              value={
                latest?.hvacSteeringWheelHeatLevel != null &&
                latest.hvacSteeringWheelHeatLevel > 0
                  ? t('On')
                  : t('Off')
              }
              color="amber"
              icon={ICON_CIRCLE_GAUGE}
            />
          </View>

          <View style={styles.metricCell}>
            <MetricCard
              label={t('Steering Wheel Heat Level')}
              value={
                latest?.hvacSteeringWheelHeatLevel == null
                  ? '\u2014'
                  : t(heatStyle(latest.hvacSteeringWheelHeatLevel).label)
              }
              color="amber"
              icon={ICON_FLAME}
              subtitle={
                latest?.hvacSteeringWheelHeatLevel != null
                  ? `${t('Level')} ${fmtInt(latest.hvacSteeringWheelHeatLevel)}`
                  : undefined
              }
            />
          </View>

          <View style={styles.metricCell}>
            <MetricCard
              label={t('Steering Wheel Heat Auto')}
              value={
                latest?.hvacSteeringWheelHeatAuto == null
                  ? '\u2014'
                  : latest.hvacSteeringWheelHeatAuto
                    ? t('Auto')
                    : t('Manual')
              }
              color="amber"
              icon={ICON_ACTIVITY}
            />
          </View>

          <View style={styles.metricCell}>
            <MetricCard
              label={t('Defrost Mode')}
              value={
                latest?.defrostMode && latest.defrostMode !== 'Off'
                  ? latest.defrostMode
                  : t('Off')
              }
              color="blue"
              icon={ICON_SNOWFLAKE}
            />
          </View>

          <View style={styles.metricCell}>
            <MetricCard
              label={t('Defrost for Preconditioning')}
              value={
                latest?.defrostForPreconditioning == null
                  ? '\u2014'
                  : latest.defrostForPreconditioning
                    ? t('Active')
                    : t('Inactive')
              }
              icon={ICON_SNOWFLAKE}
              subtitle={
                latest?.defrostForPreconditioning
                  ? t('Clearing windshield before drive')
                  : undefined
              }
            />
          </View>

          <View style={styles.metricCell}>
            <MetricCard
              label={t('Rear Defrost')}
              value={
                latest?.rearDefrostEnabled == null
                  ? '\u2014'
                  : latest.rearDefrostEnabled
                    ? t('On')
                    : t('Off')
              }
              color="blue"
              icon={ICON_SNOWFLAKE}
              subtitle={
                latest?.rearDefrostEnabled ? t('Clearing rear window') : undefined
              }
            />
          </View>

          <View style={styles.metricCell}>
            <MetricCard
              label={t('Wiper Heater', 'Wiper Heater')}
              value={
                latest?.wiperHeatEnabled == null
                  ? '\u2014'
                  : latest.wiperHeatEnabled
                    ? t('On')
                    : t('Off')
              }
              color="amber"
              icon={ICON_FLAME}
              subtitle={
                latest?.wiperHeatEnabled
                  ? t('Heating windshield wipers', 'Heating windshield wipers')
                  : undefined
              }
            />
          </View>

          <View style={styles.metricCell}>
            <MetricCard
              label={t('Rear Display HVAC', 'Rear Display HVAC')}
              value={
                latest?.rearDisplayHvacEnabled == null
                  ? '\u2014'
                  : latest.rearDisplayHvacEnabled
                    ? t('Enabled')
                    : t('Disabled')
              }
              icon={ICON_MONITOR}
              subtitle={
                latest?.rearDisplayHvacEnabled
                  ? t(
                      'Rear passengers can control HVAC',
                      'Rear passengers can control HVAC',
                    )
                  : undefined
              }
            />
          </View>
        </View>
      </FadeIn>

      {/* ─── Protection & Safety Row ─── */}
      <FadeIn delay={0.25}>
        <View style={styles.metricGrid}>
          <View style={styles.metricCell}>
            <MetricCard
              label={t('Overheat Protection')}
              value={latest?.overheatProtection ?? t('Unknown')}
              color="green"
              icon={ICON_SHIELD_CHECK}
            />
          </View>
          <View style={styles.metricCell}>
            <MetricCard
              label={t('Overheat Temp Limit', 'Overheat Temp Limit')}
              value={latest?.cabinOverheatProtectionTempLimit ?? '\u2014'}
              color="amber"
              icon={ICON_THERMOMETER_SUN}
            />
          </View>
          <View style={styles.metricCell}>
            <MetricCard
              label={t('Battery Heater')}
              value={latest?.batteryHeater ? t('On') : t('Off')}
              color="amber"
              icon={ICON_BATTERY_CHARGING}
            />
          </View>
          <View style={styles.metricCell}>
            <MetricCard
              label={t('Passenger Setting')}
              value={
                latest?.passengerTempSetting != null
                  ? `${fmtNumber(toTemperatureDisplay(latest.passengerTempSetting), 1)}${tempUnit}`
                  : '\u2014'
              }
              color="purple"
              icon={ICON_THERMOMETER}
            />
          </View>
        </View>
      </FadeIn>

      {/* ─── Thermal Comfort Indicator ─── */}
      <FadeIn delay={0.27}>
        <GlassPanel style={styles.panel}>
          <View style={styles.sectionHeader}>
            <AppText style={[styles.sectionGlyph, {color: TW.cyan400}]}>
              {ICON_THERMOMETER}
            </AppText>
            <AppText style={styles.sectionTitle} weight="semibold">
              {t('Thermal Comfort')}
            </AppText>
          </View>
          <View style={styles.comfortGrid}>
            {/* Comfort Score */}
            <GlassPanel style={styles.comfortCell}>
              <AppText style={styles.comfortLabel} tone="muted" variant="caption">
                {t('Comfort Score')}
              </AppText>
              <View
                style={[
                  styles.comfortCircle,
                  {
                    backgroundColor:
                      comfortScore != null && comfortScore >= 80
                        ? 'rgba(34, 197, 94, 0.2)'
                        : comfortScore != null && comfortScore >= 50
                          ? 'rgba(245, 158, 11, 0.2)'
                          : 'rgba(239, 68, 68, 0.2)',
                  },
                ]}>
                <AppText
                  style={[
                    styles.comfortValue,
                    {
                      color:
                        comfortScore != null && comfortScore >= 80
                          ? TW.green400
                          : comfortScore != null && comfortScore >= 50
                            ? TW.amber400
                            : TW.red400,
                    },
                  ]}
                  weight="bold">
                  {comfortScore != null ? fmtInt(comfortScore) : '\u2014'}
                </AppText>
              </View>
              <Badge
                variant={
                  comfortScore != null && comfortScore >= 80
                    ? 'success'
                    : comfortScore != null && comfortScore >= 50
                      ? 'warning'
                      : 'danger'
                }
                size="sm">
                {comfortScore != null && comfortScore >= 80
                  ? t('Excellent')
                  : comfortScore != null && comfortScore >= 50
                    ? t('Moderate')
                    : t('Poor')}
              </Badge>
            </GlassPanel>

            {/* Temp Delta */}
            <GlassPanel style={styles.comfortCell}>
              <AppText style={styles.comfortLabel} tone="muted" variant="caption">
                {t('Temp Delta')}
              </AppText>
              <View
                style={[
                  styles.comfortCircle,
                  {
                    backgroundColor:
                      tempDelta == null
                        ? colors.surfaceRaised
                        : Math.abs(tempDelta) <= 1
                          ? 'rgba(34, 197, 94, 0.2)'
                          : Math.abs(tempDelta) <= 3
                            ? 'rgba(245, 158, 11, 0.2)'
                            : 'rgba(239, 68, 68, 0.2)',
                  },
                ]}>
                <AppText
                  style={[
                    styles.comfortValue,
                    {
                      color:
                        tempDelta == null
                          ? colors.textMuted
                          : Math.abs(tempDelta) <= 1
                            ? TW.green400
                            : Math.abs(tempDelta) <= 3
                              ? TW.amber400
                              : TW.red400,
                    },
                  ]}
                  weight="bold">
                  {tempDelta != null
                    ? `${tempDelta > 0 ? '+' : ''}${tempDelta}`
                    : '\u2014'}
                </AppText>
              </View>
              <AppText style={styles.comfortChip} tone="muted">
                {tempDelta != null
                  ? Math.abs(tempDelta) <= 1
                    ? t('Near Target')
                    : tempDelta > 0
                      ? t('Above Target')
                      : t('Below Target')
                  : t('N/A')}
              </AppText>
            </GlassPanel>

            {/* Comfort Status */}
            <GlassPanel style={styles.comfortCell}>
              <AppText style={styles.comfortLabel} tone="muted" variant="caption">
                {t('Status')}
              </AppText>
              <View
                style={[
                  styles.comfortCircle,
                  {
                    backgroundColor:
                      comfortScore != null && comfortScore >= 80
                        ? 'rgba(34, 197, 94, 0.2)'
                        : comfortScore != null && comfortScore >= 50
                          ? 'rgba(245, 158, 11, 0.2)'
                          : 'rgba(239, 68, 68, 0.2)',
                  },
                ]}>
                <AppText
                  style={[
                    styles.comfortStatusGlyph,
                    {
                      color:
                        tempDelta != null && tempDelta > 2
                          ? TW.amber400
                          : tempDelta != null && tempDelta < -2
                            ? TW.cyan400
                            : TW.green400,
                    },
                  ]}>
                  {tempDelta != null && tempDelta > 2
                    ? ICON_SUN
                    : tempDelta != null && tempDelta < -2
                      ? ICON_SNOWFLAKE
                      : ICON_WIND}
                </AppText>
              </View>
              <Badge variant={comfort.variant} size="sm">
                {tempDelta != null && tempDelta > 2
                  ? t('Too Warm')
                  : tempDelta != null && tempDelta < -2
                    ? t('Too Cold')
                    : t('Comfortable')}
              </Badge>
            </GlassPanel>
          </View>
        </GlassPanel>
      </FadeIn>

      {/* ─── Climate Efficiency Panel ─── */}
      <FadeIn delay={0.28}>
        <GlassPanel style={styles.panel}>
          <View style={styles.sectionHeader}>
            <AppText style={[styles.sectionGlyph, {color: TW.cyan400}]}>
              {ICON_ACTIVITY}
            </AppText>
            <AppText style={styles.sectionTitle} weight="semibold">
              {t('Climate Efficiency')}
            </AppText>
          </View>
          <View style={styles.metricGrid}>
            <View style={styles.metricCell}>
              <MetricCard
                label={t('Avg Fan Speed')}
                value={efficiencyStats ? fmtNumber(efficiencyStats.avgFan, 1) : '\u2014'}
                subtitle={t('Level 0\u201310')}
                icon={ICON_WIND}
                color="cyan"
              />
            </View>
            <View style={styles.metricCell}>
              <MetricCard
                label={t('Peak Fan Speed')}
                value={efficiencyStats ? fmtNumber(efficiencyStats.peakFan, 1) : '\u2014'}
                subtitle={t('Level 0\u201310')}
                icon={ICON_WIND}
                color="purple"
              />
            </View>
            <View style={styles.metricCell}>
              <MetricCard
                label={t('AC On Time')}
                value={efficiencyStats ? `${fmtInt(efficiencyStats.acOnPct)}%` : '\u2014'}
                subtitle={t('of samples')}
                icon={ICON_ZAP}
                color="amber"
              />
            </View>
            <View style={styles.metricCell}>
              <MetricCard
                label={t('Comfort Score')}
                value={comfortScore != null ? `${fmtInt(comfortScore)}%` : '\u2014'}
                icon={ICON_THERMOMETER}
                color={comfortScore != null && comfortScore >= 80 ? 'green' : 'amber'}
              />
            </View>
          </View>
        </GlassPanel>
      </FadeIn>

      {/* ─── Seat Heater Grid ─── */}
      <FadeIn delay={0.3}>
        <GlassPanel style={styles.panel}>
          <View style={styles.sectionHeader}>
            <AppText style={[styles.sectionGlyph, {color: TW.amber400}]}>
              {ICON_FLAME}
            </AppText>
            <AppText style={styles.sectionTitle} weight="semibold">
              {t('Seat Heaters')}
            </AppText>
          </View>

          {/* Front row — 2 seats */}
          <View style={styles.seatGridFront}>
            {frontSeats.map(seat => (
              <View key={seat.key} style={styles.seatCellHalf}>
                <SeatHeaterCard
                  label={seat.label}
                  level={latest?.[seat.key] ?? 0}
                  t={t}
                />
              </View>
            ))}
          </View>

          {/* Auto Seat Climate (front row) */}
          <View style={styles.seatGridFront}>
            <View style={[styles.seatCellHalf, styles.autoClimateChip]}>
              <AppText style={styles.autoClimateLabel} tone="secondary" variant="caption">
                {t('Auto Climate (Left)')}
              </AppText>
              {latest?.autoSeatClimateLeft != null ? (
                <Badge
                  variant={latest.autoSeatClimateLeft ? 'success' : 'neutral'}
                  size="sm">
                  {latest.autoSeatClimateLeft ? t('Auto') : t('Manual')}
                </Badge>
              ) : (
                <AppText style={styles.dash} tone="muted" variant="caption">
                  {'\u2014'}
                </AppText>
              )}
            </View>
            <View style={[styles.seatCellHalf, styles.autoClimateChip]}>
              <AppText style={styles.autoClimateLabel} tone="secondary" variant="caption">
                {t('Auto Climate (Right)')}
              </AppText>
              {latest?.autoSeatClimateRight != null ? (
                <Badge
                  variant={latest.autoSeatClimateRight ? 'success' : 'neutral'}
                  size="sm">
                  {latest.autoSeatClimateRight ? t('Auto') : t('Manual')}
                </Badge>
              ) : (
                <AppText style={styles.dash} tone="muted" variant="caption">
                  {'\u2014'}
                </AppText>
              )}
            </View>
          </View>

          {/* Rear row — 3 seats */}
          <View style={styles.seatGridRear}>
            {rearSeats.map(seat => (
              <View key={seat.key} style={styles.seatCellThird}>
                <SeatHeaterCard
                  label={seat.label}
                  level={latest?.[seat.key] ?? 0}
                  t={t}
                />
              </View>
            ))}
          </View>

          {/* Front row — seat cooling */}
          <View style={styles.coolingHeader}>
            <View style={styles.coolingHeaderLeft}>
              <AppText style={[styles.coolingGlyph, {color: TW.sky400}]}>
                {ICON_SNOWFLAKE}
              </AppText>
              <AppText style={styles.coolingTitle} weight="semibold">
                {t('Seat Cooling')}
              </AppText>
            </View>
            {latest?.seatVentEnabled != null ? (
              <Badge
                variant={latest.seatVentEnabled ? 'success' : 'neutral'}
                size="sm">
                {`${t('Ventilation')}: ${latest.seatVentEnabled ? t('On') : t('Off')}`}
              </Badge>
            ) : (
              <Badge variant="neutral" size="sm">
                {`${t('Ventilation')}: \u2014`}
              </Badge>
            )}
          </View>
          <View style={styles.seatGridFront}>
            <View style={styles.seatCellHalf}>
              <SeatCoolingCard
                label="Front Left"
                level={latest?.climateSeatCoolingFrontLeft}
                t={t}
              />
            </View>
            <View style={styles.seatCellHalf}>
              <SeatCoolingCard
                label="Front Right"
                level={latest?.climateSeatCoolingFrontRight}
                t={t}
              />
            </View>
          </View>

          {/* Legend */}
          <View style={styles.legend}>
            {HEAT_LEVELS.map((lvl, idx) => (
              <View key={lvl.label} style={styles.legendItem}>
                <AppText style={[styles.legendGlyph, {color: lvl.color}]}>
                  {ICON_FLAME}
                </AppText>
                <AppText style={styles.legendText} tone="muted" variant="caption">
                  {`${idx} \u2014 ${t(lvl.label)}`}
                </AppText>
              </View>
            ))}
          </View>
        </GlassPanel>
      </FadeIn>

      {/* ─── Temperature History Chart ─── */}
      <FadeIn delay={0.4}>
        <GlassPanel style={styles.panel}>
          <View style={styles.sectionHeader}>
            <AppText style={[styles.sectionGlyph, {color: TW.cyan400}]}>
              {ICON_THERMOMETER}
            </AppText>
            <AppText style={styles.sectionTitle} weight="semibold">
              {t('Temperature History')}
            </AppText>
          </View>

          {historyLoading ? (
            <Skeleton height={300} />
          ) : !history || history.length === 0 ? (
            <EmptyState
              icon={ICON_THERMOMETER}
              message={t('No temperature history available.')}
            />
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={convertedChartData} margin={chartMarginLabeled}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={colors.border}
                  strokeOpacity={0.4}
                />
                <XAxis
                  dataKey="timestamp"
                  tick={axisTick}
                  tickFormatter={(v: string) => formatTime(v)}
                />
                <YAxis tick={axisTick} unit={tempUnit} />
                <Tooltip content={<ChartTooltip />} />
                <Legend />
                <Line
                  {...AREA_DEFAULTS}
                  dataKey="insideTemp"
                  name={t('Inside Temp')}
                  stroke={CHART_COLORS[0]}
                  {...chartAnimation}
                />
                <Line
                  {...AREA_DEFAULTS}
                  dataKey="outsideTemp"
                  name={t('Outside Temp')}
                  stroke={CHART_COLORS[1]}
                  {...chartAnimation}
                />
                <Line
                  {...AREA_DEFAULTS}
                  dataKey="driverTempSetting"
                  name={t('Driver Set Temp')}
                  stroke={CHART_COLORS[2]}
                  strokeDasharray="5 5"
                  {...chartAnimation}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </GlassPanel>
      </FadeIn>

      {/* ─── AC State & Fan Speed History ─── */}
      <FadeIn delay={0.45}>
        <GlassPanel style={styles.panel}>
          <View style={styles.sectionHeader}>
            <AppText style={[styles.sectionGlyph, {color: TW.purple400}]}>
              {ICON_WIND}
            </AppText>
            <AppText style={styles.sectionTitle} weight="semibold">
              {t('AC State & Fan Speed')}
            </AppText>
          </View>

          {historyLoading ? (
            <Skeleton height={300} />
          ) : chronoHistory.length === 0 ? (
            <EmptyState
              icon={ICON_WIND}
              message={t('No HVAC history available.')}
            />
          ) : (
            <ResponsiveContainer width="100%" height={320}>
              <AreaChart data={convertedChartData} margin={chartMarginLabeled}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke={colors.border}
                  strokeOpacity={0.4}
                />
                <XAxis
                  dataKey="timestamp"
                  tick={axisTick}
                  tickFormatter={(v: string) => formatTime(v)}
                />
                <YAxis
                  yAxisId="ac"
                  domain={[0, 1]}
                  tick={axisTick}
                  label={{
                    value: t('AC'),
                    angle: -90,
                    position: 'insideLeft',
                    style: {fontSize: 10, fill: colors.textMuted},
                  }}
                />
                <YAxis
                  yAxisId="fan"
                  orientation="right"
                  domain={[0, 10]}
                  tick={axisTick}
                  label={{
                    value: t('Fan Level'),
                    angle: 90,
                    position: 'insideRight',
                    style: {fontSize: 10, fill: colors.textMuted},
                  }}
                />
                <Tooltip content={<ChartTooltip />} />
                <Legend />
                {areaGradient('climateAcGrad', CHART_COLORS[0])}
                <Area
                  {...AREA_DEFAULTS}
                  yAxisId="ac"
                  type="stepAfter"
                  dataKey="acActive"
                  name={t('AC On/Off')}
                  stroke={CHART_COLORS[0]}
                  fill="url(#climateAcGrad)"
                  {...chartAnimation}
                />
                <Line
                  {...AREA_DEFAULTS}
                  yAxisId="fan"
                  type="stepAfter"
                  dataKey="fanSpeed"
                  name={t('Fan Speed')}
                  stroke={CHART_COLORS[3]}
                  {...chartAnimation}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </GlassPanel>
      </FadeIn>

      {/* ─── Climate History DataTable ─── */}
      <FadeIn delay={0.5}>
        <GlassPanel style={styles.panel}>
          <View style={styles.sectionHeader}>
            <AppText style={[styles.sectionGlyph, {color: TW.purple400}]}>
              {ICON_CIRCLE_GAUGE}
            </AppText>
            <AppText style={styles.sectionTitle} weight="semibold">
              {t('Climate History')}
            </AppText>
          </View>

          {historyLoading ? (
            <Skeleton lines={8} />
          ) : sortedHistory.length === 0 ? (
            <EmptyState message={t('No history records found.')} />
          ) : (
            <DataTable
              tableId="vehicle-systems:climate-history"
              columns={columns}
              data={sortedHistory}
              keyExtractor={row => String(row.id ?? 0)}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
              compact
              pagination
            />
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}

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
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  loading: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
  errorBox: {
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerSurface,
    borderRadius: 12,
    padding: spacing.md,
  },
  errorText: {
    color: colors.danger,
  },
  panel: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sectionGlyph: {
    fontSize: 18,
    lineHeight: 22,
  },
  sectionTitle: {
    fontSize: typography.body,
    color: colors.textPrimary,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    width: '100%',
  },
  skeletonStack: {
    gap: spacing.sm,
  },
  skeletonLine: {
    height: 14,
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
  emptyStateGlyph: {
    fontSize: 28,
    lineHeight: 34,
  },
  emptyStateMessage: {
    textAlign: 'center',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeSm: {
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  badgeText: {
    fontSize: typography.caption,
    fontWeight: '500',
  },
  badgeTextSm: {
    fontSize: 11,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  buttonPressed: {
    backgroundColor: colors.surfaceHover,
  },
  buttonIcon: {
    fontSize: 14,
  },
  buttonText: {
    color: colors.textSecondary,
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
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.md,
    padding: spacing.md,
  },
  bannerActive: {
    borderColor: 'rgba(6, 182, 212, 0.3)',
  },
  bannerInactive: {
    borderColor: 'rgba(75, 85, 99, 0.3)',
  },
  bannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  bannerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  bannerGlyph: {
    fontSize: 20,
    lineHeight: 24,
  },
  bannerLabel: {
    fontSize: typography.body,
    color: colors.textPrimary,
  },
  stackGrid: {
    gap: spacing.md,
  },
  gaugePanel: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.lg,
  },
  gaugeValue: {
    fontSize: 18,
    color: colors.textPrimary,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: spacing.md,
  },
  metricCell: {
    width: '48%',
  },
  comfortGrid: {
    gap: spacing.md,
  },
  comfortCell: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.md,
  },
  comfortLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  comfortCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  comfortValue: {
    fontSize: 24,
  },
  comfortStatusGlyph: {
    fontSize: 28,
    lineHeight: 34,
  },
  comfortChip: {
    fontSize: 10,
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  seatGridFront: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  seatGridRear: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  seatCellHalf: {
    width: '47%',
  },
  seatCellThird: {
    width: '30%',
  },
  seatCard: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    padding: spacing.md,
  },
  seatGlyph: {
    fontSize: 22,
    lineHeight: 26,
  },
  seatLabel: {
    textAlign: 'center',
  },
  autoClimateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  autoClimateLabel: {
    flexShrink: 1,
  },
  coolingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  coolingHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  coolingGlyph: {
    fontSize: 16,
    lineHeight: 20,
  },
  coolingTitle: {
    fontSize: typography.body,
    color: colors.textPrimary,
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  legendGlyph: {
    fontSize: 13,
    lineHeight: 16,
  },
  legendText: {},
  dash: {},
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  tableRowCompact: {
    paddingVertical: spacing.xs,
  },
  tableHeaderRow: {
    borderBottomWidth: 1,
  },
  tableCell: {
    flex: 1,
    minWidth: 0,
  },
  tableHeaderText: {
    letterSpacing: 0.4,
  },
  tableCellText: {
    color: colors.textPrimary,
  },
  pagination: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingTop: spacing.md,
  },
  pageButton: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  pageButtonDisabled: {
    opacity: 0.4,
  },
  pageButtonText: {
    color: colors.textPrimary,
  },
  pageLabel: {
    minWidth: 48,
    textAlign: 'center',
  },
});
