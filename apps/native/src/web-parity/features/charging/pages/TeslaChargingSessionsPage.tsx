// Native parity port of web/src/features/charging/pages/TeslaChargingSessionsPage.tsx.
//
// `TeslaChargingSessionsPage` is the fleet (business-account) charging-session
// surface: a header with a date RangePicker action, a business-account info
// banner, a controls bar (vehicle Select + "Refresh from Tesla" Button +
// business-only hint + last-synced label), five summary StatCards
// (sessions/energy/cost/avg-cost/peak-power), a monthly-cost bar ChartContainer,
// a session-location map panel, and a full sortable/selectable/paginated
// DataTable with CSV export + a bulk "Export CSV" action. Every state name
// (`t`, `formatEnergy`, `settings`, `locale`, `formatCurrency`, `userCurrency`,
// `vehicles`, `selectedVin`, `response`, `isLoading`, `error`, `refreshMutation`,
// `allSessions`, `start`, `end`, `setRange`, `sessions`, `summary`,
// `vehicleOptions`, `monthlyData`, `mapPoints`, `is403`, `columns`, `sortKey`,
// `sortDir`, `selectedKeys`, `sortedSessions`), every API path (via the reused
// hooks), the SI unit handling (display-boundary conversion only), and every
// i18n key + English fallback are preserved verbatim.
//
// Web modules with no native-parity surface are mapped per the conversion
// contract (rules 4-7), each documented in the sidecar:
//   - react-i18next `useTranslation` (L2) -> a local key-preserving shim
//     supporting `t(key, 'English')` + `t(key, { defaultValue, ...params })`
//     with `{{token}}` interpolation (the SearchInput / BatteryCellsPage
//     precedent). Every i18n key is referenced verbatim.
//   - lucide-react icons (L3-6) -> decorative emoji glyphs via `Glyph`
//     (accessibility-hidden); the adjacent translated label carries the meaning.
//   - `@/components/layout` PageContainer + Grid (L7): PageContainer -> the
//     reused native parity port; Grid -> a local flex-wrap `GridRow` (the
//     responsive `{default:1, sm:2, lg:5}` cols resolve mobile-first to a wrap
//     row, the BatteryCellsPage precedent).
//   - `@/components/ui` GlassPanel/Button/Select/DataTable/Column (L8):
//     GlassPanel + DataTable/Column -> reused native ports; Button -> a local
//     Pressable button (primary/disabled + inline spinner); Select -> a local
//     native Modal picker preserving the `{ options, value, onChange(e) }`
//     contract (the web `<select>` change event is shimmed as
//     `{ target: { value } }`).
//   - `@/components/data-display` StatCard (L9) -> a local StatCard mirroring the
//     web public API (`label`, `value`, `icon`, `unit`, `loading`); the lucide
//     icon becomes a tinted glyph chip and `loading` swaps in a skeleton block.
//   - `@/components/motion` FadeIn/StaggerContainer/StaggerItem (L10) -> the
//     reused native parity barrel.
//   - `@/components/charts` ChartContainer/ChartTooltip/ChartGradient/chartGrid/
//     axisTickSm + recharts primitives (L11-14) -> the native parity charts
//     barrel: the recharts public API is preserved while leaf primitives render
//     React-Native-safe placeholders and ChartContainer surfaces the series via
//     its accessible data-table fallback (`data` + `dataColumns`). The web
//     `<defs>` SVG wrapper has no native intrinsic, so `<ChartGradient/>` is
//     rendered as a direct child of `<BarChart>` (same id/colour/opacity), which
//     the placeholder renderer accepts.
//   - `@/components/feedback` EmptyState/Spinner (L15): EmptyState -> the native
//     `{title, message}` component (the web icon is decorative; the panel's own
//     translated heading supplies `title`, the web message supplies `message`);
//     Spinner -> a React Native `ActivityIndicator` (Suspense fallback).
//   - `@/components/forms` RangePicker (L16) -> a local native RangePicker: the
//     web calendar+preset popover has no native analog, so it surfaces the same
//     `{ value:{start,end}, onChange }` contract via a Modal of date presets
//     (All time / 7d / 30d / 90d / 1y / YTD). Range filtering stays fully
//     functional; the free-form calendar is documented as native-simplified.
//   - `@/api/hooks/useCharging` (L17-21) + `@/api/hooks/useVehicles` (L22) -> the
//     reused native parity hooks 1:1 (same paths, same `TeslaChargingSession`).
//   - `@/hooks/usePageTitle` (L23) -> a documented native no-op (no DOM
//     document.title; the translated title flows into PageContainer's header).
//   - `@/hooks/useRangeState` (L24) -> a local state-backed shim: URL +
//     localStorage persistence are unavailable on native, so the range lives in
//     component state, defaulting to the `defaultPresetId` ('all' => 2015-01-01
//     .. today, the web `resolveAllTimeStart` fallback). `persistKey` is
//     accepted for source compatibility (persistence documented unavailable).
//   - `@/hooks/useUnits` (L25) -> a local shim over the native `useSettings`
//     query exposing `formatEnergy` (the only surface this page reads).
//   - `@/hooks/useSettings` (L26) -> a local shim returning `{ settings, locale }`
//     from the native `useSettings` query data (with the web defaults).
//   - `@/hooks/useFormatting` (L27) -> a local shim exposing `formatCurrency`
//     (`${symbol}${fmtNumber(amount, decimals)}`).
//   - `@/lib/dateFormat` formatDateTime (L28) -> inlined native-safe
//     ('—' on nullish/invalid).
//   - `@/lib/numberFormat` fmtNumber/fmtInt (L29) -> inlined verbatim
//     (safeNumber coerces nullish/non-finite -> 0).
//   - `@/lib/unitConversion` convertEnergyFromSI (L30) -> inlined verbatim.
//   - `@/lib/currencyFormat` formatCurrencyValue/currencyCodeFromSymbol (L31) ->
//     inlined verbatim (Intl.NumberFormat currency, with the web fallback path).
//   - `@/lib/cn` (L32) Tailwind class merge -> dropped; styling is StyleSheet.
//   - `./TeslaChargingSessionsMap` lazy import (L34) -> a local native-safe
//     `TeslaChargingSessionsMapNative` (Leaflet is browser-only — rule 4): it
//     lists each located session (site, date, energy, cost, charger type), the
//     exact data the web markers' popups showed, with an explicit
//     "interactive map unavailable on native" note. It is kept behind the same
//     `lazy()` + `<Suspense>` code-split structure as the source.
//
// No DOM-only modules, browser HTML elements, Recharts, Leaflet, or old web UI
// components are imported. Tailwind maps to StyleSheet (1 spacing unit = 4px);
// `--text-*` -> AppText tones; `text-{cyan,yellow,emerald,purple}-400` ->
// SI-palette tints; the long page body is wrapped in a ScrollView so every
// section stays reachable. The DOM-only CSV download (Blob + anchor) is a
// documented native no-op — `exportSelectedCsv` still builds the CSV string.

import React, {
  Suspense,
  lazy,
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {EmptyState} from '../../../../components/feedback/EmptyState';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {
  useTeslaChargingSessions,
  useRefreshTeslaChargingSessions,
  type TeslaChargingSession,
} from '../../../api/hooks/useCharging';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {useSettings} from '../../../api/hooks/useSettings';
import {PageContainer} from '../../../components/layout/PageContainer';
import {FadeIn, StaggerContainer, StaggerItem} from '../../../components/motion';
import {DataTable, type Column} from '../../../components/ui/DataTable';
import {
  axisTickSm,
  Bar,
  BarChart,
  ChartContainer,
  ChartGradient,
  ChartTooltip,
  chartGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from '../../../components/charts';

/* ── i18n shim (react-i18next has no native parity module) ─────────── */
// i18next resolves a missing translation to the KEY; this preserves the two
// source call shapes: `t(key, 'English')` and `t(key, { defaultValue, ...params })`.
type TParams = Record<string, string | number>;
type TFallback = string | (TParams & {defaultValue?: string});
type TFunc = (key: string, fallback?: TFallback, params?: TParams) => string;

function interpolate(template: string, params?: TParams): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, token: string) => {
    const value = params[token];
    return value == null ? match : String(value);
  });
}

const translate: TFunc = (key, fallback, params) => {
  if (typeof fallback === 'string') {
    return interpolate(fallback, params);
  }
  if (fallback && typeof fallback === 'object') {
    return interpolate(fallback.defaultValue ?? key, fallback);
  }
  return interpolate(key, params);
};

function useTranslation(): {t: TFunc} {
  return {t: translate};
}

/* ── usePageTitle shim (no DOM document.title on native) ───────────── */
function usePageTitle(_title: string): void {
  /* no-op: the translated title flows into PageContainer's header instead. */
}

/* ── numberFormat (inlined from @/lib/numberFormat) ────────────────── */
// safeNumber collapses nullish/non-finite to 0; fmtNumber is en-US grouped at a
// fixed precision (default 2); fmtInt is fmtNumber at 0 decimals.
const DEFAULT_PRECISION = 2;

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals?: number, locale = 'en-US'): string {
  const d = decimals ?? DEFAULT_PRECISION;
  try {
    return safeNumber(v).toLocaleString(locale, {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  } catch {
    return safeNumber(v).toFixed(d);
  }
}

function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

/* ── dateFormat (inlined from @/lib/dateFormat) ────────────────────── */
// formatDateTime -> "Apr 4, 2026, 02:05 PM"; '—' for nullish/invalid input.
function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '—';
  }
  try {
    return d.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return d.toISOString();
  }
}

/* ── unitConversion (inlined from @/lib/unitConversion) ────────────── */
type EnergyUnitPref = 'Wh' | 'kWh';

function convertEnergyFromSI(wh: number, to: EnergyUnitPref): number {
  switch (to) {
    case 'Wh':
      return wh;
    case 'kWh':
      return wh / 1000;
  }
}

// Inlined from @/lib/unitConversion `formatEnergy` (the only formatter the
// useUnits shim exposes): nullish/non-finite -> '—', else SI Wh -> the energy
// pref ('kWh' => /1000) at the given precision with a trailing unit.
function formatEnergyValue(
  wh: number | null | undefined,
  pref: EnergyUnitPref,
  precision: number,
): string {
  if (typeof wh !== 'number' || !Number.isFinite(wh)) {
    return '—';
  }
  return `${fmtNumber(convertEnergyFromSI(wh, pref), precision)} ${pref}`;
}

/* ── currencyFormat (inlined from @/lib/currencyFormat) ────────────── */
function clampPrecision(precision: number | undefined): number {
  if (precision == null || !Number.isFinite(precision)) {
    return 2;
  }
  return Math.max(0, Math.min(20, Math.trunc(precision)));
}

function normaliseLocale(locale: string | undefined): string {
  return locale && locale.trim() ? locale : 'en-US';
}

// Intl-currency format with the web's RangeError fallback (invalid ISO code ->
// plain decimal prefixed with the literal code).
function formatCurrencyValue(
  value: number | null | undefined,
  currency: string,
  locale: string,
  precision: number,
  options: {useGrouping?: boolean} = {},
): string {
  if (value == null || !Number.isFinite(value)) {
    return '';
  }
  const useGrouping = options.useGrouping ?? false;
  const digits = clampPrecision(precision);
  const lc = normaliseLocale(locale);
  try {
    return new Intl.NumberFormat(lc, {
      style: 'currency',
      currency,
      currencyDisplay: 'symbol',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      useGrouping,
    }).format(value);
  } catch {
    const plain = new Intl.NumberFormat(lc, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
      useGrouping,
    }).format(value);
    return `${currency} ${plain}`.trim();
  }
}

// Best-effort symbol -> ISO 4217 reverse lookup (settings stores only the symbol).
function currencyCodeFromSymbol(symbol: string | null | undefined): string {
  const s = (symbol ?? '').trim();
  switch (s) {
    case '$':
      return 'USD';
    case '€':
      return 'EUR';
    case '£':
      return 'GBP';
    case '¥':
      return 'JPY';
    case '₹':
      return 'INR';
    case '₽':
      return 'RUB';
    case '₩':
      return 'KRW';
    case 'A$':
      return 'AUD';
    case 'C$':
      return 'CAD';
    case 'CHF':
      return 'CHF';
    case 'kr':
      return 'SEK';
    case 'R$':
      return 'BRL';
    case 'R':
      return 'ZAR';
    case 'NZ$':
      return 'NZD';
    case 'HK$':
      return 'HKD';
    case 'NT$':
      return 'TWD';
    case 'S$':
      return 'SGD';
    case '₺':
      return 'TRY';
    case '฿':
      return 'THB';
    case 'Mex$':
      return 'MXN';
    case 'zł':
      return 'PLN';
    default:
      return 'USD';
  }
}

/* ── useSettings / useUnits / useFormatting shims ──────────────────── */
// Mirror only the surfaces this page reads, derived from the native useSettings
// query data with the web defaults.
function derivePrecision(decimalPrecision: unknown): number {
  if (typeof decimalPrecision !== 'number' || !Number.isFinite(decimalPrecision)) {
    return 2;
  }
  if (decimalPrecision < 0) {
    return 2;
  }
  return Math.floor(decimalPrecision);
}

interface SettingsShape {
  currency_symbol?: string;
  locale?: string;
}

function useSettingsBridge(): {settings: SettingsShape; locale: string} {
  const {data} = useSettings();
  const locale =
    typeof data?.locale === 'string' && data.locale.trim()
      ? data.locale
      : 'en-US';
  return {
    settings: {currency_symbol: data?.currency_symbol, locale: data?.locale},
    locale,
  };
}

function useUnits(): {formatEnergy: (value: number | null | undefined, options?: {precision?: number}) => string} {
  const {data} = useSettings();
  const precision = derivePrecision(data?.decimal_precision);
  return useMemo(
    () => ({
      formatEnergy: (value: number | null | undefined, options?: {precision?: number}) =>
        formatEnergyValue(value, 'kWh', options?.precision ?? precision),
    }),
    [precision],
  );
}

function useFormatting(): {formatCurrency: (amount: number, decimals?: number) => string} {
  const {data} = useSettings();
  const currencySymbol =
    data?.currency_symbol && data.currency_symbol.trim()
      ? data.currency_symbol
      : '$';
  const userPrecision = derivePrecision(data?.decimal_precision);
  return useMemo(
    () => ({
      formatCurrency: (amount: number, decimals?: number) =>
        `${currencySymbol}${fmtNumber(amount, decimals ?? userPrecision)}`,
    }),
    [currencySymbol, userPrecision],
  );
}

/* ── useRangeState shim (no URL/localStorage on native) ────────────── */
// Range lives in component state. The default preset resolves the same window
// the web `useRangeState({ defaultPresetId })` would: 'all' => 2015-01-01..today
// (the web `resolveAllTimeStart` fallback), else a trailing N-day/Y window.
const ALL_TIME_START = '2015-01-01';

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

interface RangeValue {
  start: string;
  end: string;
}

interface RangePreset {
  id: string;
  labelKey: string;
  labelEn: string;
  resolve: () => RangeValue;
}

function trailing(days: number): RangeValue {
  const end = new Date();
  const start = new Date(end.getTime() - days * 86_400_000);
  return {start: isoDate(start), end: isoDate(end)};
}

const RANGE_PRESETS: RangePreset[] = [
  {id: 'all', labelKey: 'datePresets.all', labelEn: 'All time', resolve: () => ({start: ALL_TIME_START, end: isoDate(new Date())})},
  {id: '7d', labelKey: 'datePresets.7d', labelEn: 'Last 7 days', resolve: () => trailing(7)},
  {id: '30d', labelKey: 'datePresets.30d', labelEn: 'Last 30 days', resolve: () => trailing(30)},
  {id: '90d', labelKey: 'datePresets.90d', labelEn: 'Last 90 days', resolve: () => trailing(90)},
  {id: '1y', labelKey: 'datePresets.1y', labelEn: 'Last year', resolve: () => trailing(365)},
  {
    id: 'ytd',
    labelKey: 'datePresets.ytd',
    labelEn: 'Year to date',
    resolve: () => ({start: isoDate(new Date(new Date().getFullYear(), 0, 1)), end: isoDate(new Date())}),
  },
];

function resolvePreset(id: string): RangeValue {
  const preset = RANGE_PRESETS.find(p => p.id === id) ?? RANGE_PRESETS[2];
  return preset.resolve();
}

interface UseRangeStateOptions {
  persistKey?: string;
  defaultPresetId?: string;
}

function useRangeState(opts: UseRangeStateOptions = {}): {
  start: string;
  end: string;
  setRange: (range: RangeValue) => void;
} {
  const {defaultPresetId = '30d'} = opts;
  const [range, setRangeState] = useState<RangeValue>(() => resolvePreset(defaultPresetId));
  const setRange = useCallback((next: RangeValue) => setRangeState(next), []);
  return {start: range.start, end: range.end, setRange};
}

/* ── Helpers ported verbatim from the source ───────────────────────── */

/** Format seconds to "Xh Ym" */
function formatDurationSeconds(seconds: number | null): string {
  if (seconds == null) {
    return '—';
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) {
    return `${h}h ${m}m`;
  }
  return `${m}m`;
}

/** Aggregate sessions by month for the cost chart */
function buildMonthlyCost(
  sessions: TeslaChargingSession[],
): {month: string; total: number}[] {
  const map = new Map<string, number>();
  for (const s of sessions) {
    const d = new Date(s.charge_start_datetime);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    map.set(key, (map.get(key) ?? 0) + (s.total_cost ?? 0));
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, total]) => ({month, total}));
}

/* ── Decorative glyph (lucide icon substitute) ─────────────────────── */
function Glyph({
  children,
  style,
}: {
  children: string;
  style?: StyleProp<TextStyle>;
}) {
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={style}>
      {children}
    </AppText>
  );
}

/* ── Local StatCard (web @/components/data-display StatCard) ────────── */
type StatTint = 'cyan' | 'yellow' | 'emerald' | 'purple' | 'orange';

const STAT_TINT: Record<StatTint, string> = {
  cyan: colors.accent,
  yellow: colors.warning,
  emerald: colors.success,
  purple: colors.violet,
  orange: '#fb923c',
};

function StatCard({
  label,
  value,
  unit,
  icon,
  tint = 'cyan',
  loading,
}: {
  label: string;
  value: string | number;
  unit?: string;
  icon?: string;
  tint?: StatTint;
  loading?: boolean;
}) {
  const color = STAT_TINT[tint];
  return (
    <View style={styles.statCard}>
      <View style={styles.statRow}>
        <View style={styles.statTextBlock}>
          <AppText numberOfLines={1} style={styles.statLabel} tone="muted" variant="caption">
            {label}
          </AppText>
          {loading ? (
            <View style={styles.statSkeleton} accessibilityRole="progressbar" />
          ) : (
            <View style={styles.statValueRow}>
              <AppText style={styles.statValue} weight="bold">
                {value}
              </AppText>
              {unit ? (
                <AppText style={styles.statUnit} tone="muted">
                  {unit}
                </AppText>
              ) : null}
            </View>
          )}
        </View>
        {icon ? (
          <View style={[styles.statIcon, {borderColor: `${color}55`, backgroundColor: `${color}1f`}]}>
            <Glyph style={[styles.statIconGlyph, {color}]}>{icon}</Glyph>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/* ── Local GridRow (web @/components/layout Grid) ──────────────────── */
function GridRow({children}: {children: ReactNode}) {
  return <View style={styles.gridRow}>{children}</View>;
}

/* ── Local Button (web @/components/ui Button) ─────────────────────── */
function Button({
  children,
  onPress,
  disabled,
  busy,
  leadingGlyph,
  size = 'md',
}: {
  children: ReactNode;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  leadingGlyph?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{disabled: !!disabled}}
      disabled={disabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        size === 'sm' && styles.buttonSm,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}>
      {busy ? (
        <ActivityIndicator color={colors.background} size="small" />
      ) : leadingGlyph ? (
        <Glyph style={styles.buttonGlyph}>{leadingGlyph}</Glyph>
      ) : null}
      <AppText style={styles.buttonLabel} weight="semibold">
        {children}
      </AppText>
    </Pressable>
  );
}

/* ── Local Select (web @/components/ui Select) ─────────────────────── */
// Preserves the web `{ options, value, onChange(e) }` contract: the change
// handler receives a `{ target: { value } }`-shaped event (the source reads
// `e.target.value`). The native `<select>` becomes a Modal option list.
interface SelectOption {
  value: string;
  label: string;
}

interface SelectChangeEvent {
  target: {value: string};
}

function Select({
  options,
  value,
  onChange,
}: {
  options: SelectOption[];
  value: string;
  onChange: (e: SelectChangeEvent) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => o.value === value) ?? options[0];
  return (
    <>
      <Pressable
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        style={styles.select}>
        <AppText numberOfLines={1} style={styles.selectLabel}>
          {selected?.label ?? ''}
        </AppText>
        <Glyph style={styles.selectChevron}>▾</Glyph>
      </Pressable>
      <Modal
        animationType="fade"
        transparent
        visible={open}
        onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setOpen(false)}>
          <View style={styles.modalSheet}>
            <FlatList
              data={options}
              keyExtractor={item => item.value}
              renderItem={({item}) => (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    onChange({target: {value: item.value}});
                    setOpen(false);
                  }}
                  style={styles.modalRow}>
                  <AppText
                    style={item.value === value ? styles.modalRowActive : undefined}>
                    {item.label}
                  </AppText>
                  {item.value === value ? <Glyph style={styles.modalCheck}>✓</Glyph> : null}
                </Pressable>
              )}
            />
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

/* ── Local RangePicker (web @/components/forms RangePicker) ─────────── */
// The web calendar+preset popover has no native analog; this preserves the
// `{ value:{start,end}, onChange }` contract via a Modal of date presets so
// range filtering stays functional. The free-form calendar is native-simplified.
function RangePicker({
  value,
  onChange,
}: {
  value: RangeValue;
  onChange: (range: RangeValue) => void;
}) {
  const {t} = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        onPress={() => setOpen(true)}
        style={styles.rangeTrigger}
        testID="tesla-charging-sessions-range">
        <Glyph style={styles.rangeGlyph}>🗓</Glyph>
        <AppText numberOfLines={1} style={styles.rangeLabel} variant="caption">
          {value.start} → {value.end}
        </AppText>
      </Pressable>
      <Modal
        animationType="fade"
        transparent
        visible={open}
        onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setOpen(false)}>
          <View style={styles.modalSheet}>
            {RANGE_PRESETS.map(preset => (
              <Pressable
                key={preset.id}
                accessibilityRole="button"
                onPress={() => {
                  onChange(preset.resolve());
                  setOpen(false);
                }}
                style={styles.modalRow}>
                <AppText>{t(preset.labelKey, preset.labelEn)}</AppText>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

/* ── Native-safe session-location map (web ./TeslaChargingSessionsMap) ─ */
// Leaflet is browser-only (rule 4). This renders the same data the web markers'
// popups carried (site, date, energy, cost, charger type) as an accessible
// list, with an explicit "interactive map unavailable on native" note. It is
// kept behind the source's lazy() + <Suspense> code-split structure.
interface MapProps {
  sessions: TeslaChargingSession[];
}

function TeslaChargingSessionsMapNative({sessions}: MapProps) {
  const {t} = useTranslation();
  const {formatCurrency} = useFormatting();
  const points = useMemo(
    () =>
      sessions.filter(
        s =>
          typeof s.latitude === 'number' &&
          typeof s.longitude === 'number' &&
          !Number.isNaN(s.latitude) &&
          !Number.isNaN(s.longitude),
      ),
    [sessions],
  );
  return (
    <View
      accessibilityLabel={t('tesla_sessions.mapLabel', 'Charging sessions map')}
      accessibilityRole="summary"
      style={styles.mapRoot}>
      <AppText style={styles.mapNote} tone="muted" variant="caption">
        {t(
          'tesla_sessions.mapNativeUnavailable',
          'Interactive map unavailable on native; showing session locations.',
        )}
      </AppText>
      {points.map(s => {
        const siteName =
          s.site_location_name || t('tesla_sessions.unknown', 'Unknown');
        const energy =
          s.total_energy_added_wh != null
            ? `${fmtNumber(convertEnergyFromSI(s.total_energy_added_wh, 'kWh'), 1)} kWh`
            : '';
        const cost = s.total_cost != null ? formatCurrency(s.total_cost, 2) : '';
        const charger = s.charger_type ? String(s.charger_type).toUpperCase() : '';
        const meta = [energy, cost, charger].filter(Boolean).join(' · ');
        return (
          <View key={s.session_id} style={styles.mapRow}>
            <Glyph style={styles.mapPin}>📍</Glyph>
            <View style={styles.mapRowBody}>
              <AppText weight="semibold">{siteName}</AppText>
              <AppText tone="secondary" variant="caption">
                {formatDateTime(s.charge_start_datetime)}
              </AppText>
              {meta ? (
                <AppText tone="muted" variant="caption">
                  {meta}
                </AppText>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

// Code-split parity: keep React.lazy + Suspense (both supported in RN) pointing
// at the local native-safe map module.
const LazyMap = lazy(async () => ({default: TeslaChargingSessionsMapNative}));

// Source L58 `gridCols = {default:1, sm:2, lg:5}` is a Tailwind responsive
// column descriptor; on native the summary grid resolves mobile-first to the
// flex-wrap `GridRow`, so the explicit descriptor is not needed.

export default function TeslaChargingSessionsPage() {
  const {t} = useTranslation();
  const {formatEnergy} = useUnits();
  const {settings, locale} = useSettingsBridge();
  const {formatCurrency} = useFormatting();
  const userCurrency = currencyCodeFromSymbol(settings.currency_symbol);
  usePageTitle(t('tesla_sessions.title', 'Fleet Charging Sessions'));

  const {data: vehicles} = useVehicles();
  const [selectedVin, setSelectedVin] = useState<string>('');
  const {data: response, isLoading, error} = useTeslaChargingSessions(
    selectedVin || undefined,
  );
  const refreshMutation = useRefreshTeslaChargingSessions();

  // `?? []` would mint a new array reference each render; the native ESLint
  // config treats react-hooks/exhaustive-deps as an error, so `allSessions` is
  // memoized over `response` to keep the downstream `sessions` memo stable.
  // Behaviour is identical to the web `response?.sessions ?? []`.
  const allSessions = useMemo(() => response?.sessions ?? [], [response]);
  // Range filter (client-side) on charge_start_datetime.
  const {start, end, setRange} = useRangeState({
    persistKey: 'tesla-charging-sessions.range',
    defaultPresetId: 'all',
  });
  const sessions = useMemo(() => {
    if (!allSessions.length) {
      return allSessions;
    }
    const startMs = new Date(`${start}T00:00:00`).getTime();
    const endMs = new Date(`${end}T23:59:59.999`).getTime();
    return allSessions.filter(s => {
      if (!s.charge_start_datetime) {
        return false;
      }
      const ts = new Date(s.charge_start_datetime).getTime();
      return ts >= startMs && ts <= endMs;
    });
  }, [allSessions, start, end]);
  const summary = response?.summary ?? {
    total_sessions: 0,
    total_wh: null,
    total_cost: null,
    avg_cost_per_kwh: null,
    peak_power_kw: null,
  };

  const vehicleOptions = useMemo(() => {
    const opts = [{value: '', label: t('tesla_sessions.allVehicles', 'All Vehicles')}];
    for (const v of vehicles ?? []) {
      opts.push({value: v.vin, label: `${v.display_name} (${v.vin.slice(-6)})`});
    }
    return opts;
  }, [vehicles, t]);

  const monthlyData = useMemo(() => buildMonthlyCost(sessions), [sessions]);

  const mapPoints = useMemo(
    () => sessions.filter(s => s.latitude != null && s.longitude != null),
    [sessions],
  );

  const handleRefresh = () => {
    refreshMutation.mutate(selectedVin ? {vin: selectedVin} : undefined);
  };

  const is403 =
    refreshMutation.error &&
    typeof refreshMutation.error === 'object' &&
    'status' in (refreshMutation.error as unknown as Record<string, unknown>) &&
    (refreshMutation.error as unknown as Record<string, unknown>).status === 403;

  const columns: Column<TeslaChargingSession>[] = useMemo(
    () => [
      {
        key: 'date',
        header: t('tesla_sessions.col.date', 'Date'),
        render: row => (
          <AppText style={styles.cellPrimary}>
            {formatDateTime(row.charge_start_datetime)}
          </AppText>
        ),
        sortable: true,
        visibleOnMobile: true,
      },
      {
        key: 'location',
        header: t('tesla_sessions.col.location', 'Location'),
        render: row => (
          <View style={styles.cellLocation}>
            <Glyph style={styles.cellPin}>📍</Glyph>
            <AppText numberOfLines={1} style={styles.cellPrimary}>
              {row.site_location_name || '—'}
            </AppText>
          </View>
        ),
        visibleOnMobile: true,
      },
      {
        key: 'vin',
        header: t('tesla_sessions.col.vin', 'VIN'),
        render: row => (
          <AppText style={styles.cellMono}>
            {row.vin ? `…${row.vin.slice(-6)}` : '—'}
          </AppText>
        ),
        defaultVisible: false,
      },
      {
        key: 'energy',
        header: t('tesla_sessions.col.energy', 'Energy (kWh)'),
        render: row => (
          <AppText style={styles.cellEnergy}>
            {row.total_energy_added_wh != null
              ? fmtNumber(convertEnergyFromSI(row.total_energy_added_wh, 'kWh'), 1)
              : '—'}
          </AppText>
        ),
        sortable: true,
        visibleOnMobile: true,
      },
      {
        key: 'peakPower',
        header: t('tesla_sessions.col.peakPower', 'Peak (kW)'),
        render: row => (
          <AppText style={styles.cellPeak}>
            {row.peak_power_kw != null ? fmtNumber(row.peak_power_kw, 0) : '—'}
          </AppText>
        ),
        sortable: true,
      },
      {
        key: 'duration',
        header: t('tesla_sessions.col.duration', 'Duration'),
        render: row => (
          <AppText style={styles.cellPrimary}>
            {formatDurationSeconds(row.charge_duration_s)}
          </AppText>
        ),
      },
      {
        key: 'cost',
        header: t('tesla_sessions.col.cost_decimal', 'Cost'),
        render: row => (
          <AppText style={styles.cellCost}>
            {row.total_cost != null
              ? formatCurrencyValue(
                  row.total_cost,
                  row.currency_code ?? userCurrency,
                  locale,
                  2,
                  {useGrouping: true},
                )
              : '—'}
          </AppText>
        ),
        sortable: true,
        visibleOnMobile: true,
      },
      {
        key: 'rate',
        header: t('tesla_sessions.col.rate', 'Rate/kWh'),
        render: row => (
          <AppText style={styles.cellSecondary}>
            {row.per_kwh_rate != null
              ? formatCurrencyValue(
                  row.per_kwh_rate,
                  row.currency_code ?? userCurrency,
                  locale,
                  3,
                  {useGrouping: true},
                )
              : '—'}
          </AppText>
        ),
        defaultVisible: false,
      },
      {
        key: 'type',
        header: t('tesla_sessions.col.type', 'Type'),
        render: row => (
          <AppText style={styles.cellType}>
            {row.charger_type ?? '—'}
          </AppText>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t],
  );

  const [sortKey, setSortKey] = useState<string>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [selectedKeys, setSelectedKeys] = useState<(string | number)[]>([]);

  const sortedSessions = useMemo(() => {
    const sorted = [...sessions];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'date':
          cmp = a.charge_start_datetime.localeCompare(b.charge_start_datetime);
          break;
        case 'energy':
          cmp = (a.total_energy_added_wh ?? 0) - (b.total_energy_added_wh ?? 0);
          break;
        case 'peakPower':
          cmp = (a.peak_power_kw ?? 0) - (b.peak_power_kw ?? 0);
          break;
        case 'cost':
          cmp = (a.total_cost ?? 0) - (b.total_cost ?? 0);
          break;
        default:
          cmp = a.charge_start_datetime.localeCompare(b.charge_start_datetime);
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return sorted;
  }, [sessions, sortKey, sortDir]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  // CSV export of selected sessions for client-side analysis / Tesla audit.
  // The CSV string is built faithfully; the web Blob + anchor download has no
  // React Native filesystem/Share binding here, so the file write is a
  // documented native no-op (the rows are still serialized).
  const exportSelectedCsv = useCallback((rows: TeslaChargingSession[]) => {
    if (rows.length === 0) {
      return;
    }
    const header = [
      'date',
      'location',
      'vin',
      'energy_wh',
      'peak_power_kw',
      'duration_seconds',
      'cost',
      'currency',
      'per_kwh_rate',
      'charger_type',
    ];
    const lines = [header.join(',')];
    for (const r of rows) {
      const fields = [
        r.charge_start_datetime,
        (r.site_location_name ?? '').replace(/[",\n]/g, ' '),
        r.vin ?? '',
        r.total_energy_added_wh != null ? String(r.total_energy_added_wh) : '',
        r.peak_power_kw != null ? String(r.peak_power_kw) : '',
        r.charge_duration_s != null ? String(r.charge_duration_s) : '',
        r.total_cost != null ? String(r.total_cost) : '',
        r.currency_code ?? '',
        r.per_kwh_rate != null ? String(r.per_kwh_rate) : '',
        r.charger_type ?? '',
      ];
      lines.push(fields.map(f => `"${String(f).replace(/"/g, '""')}"`).join(','));
    }
    // Native-safe: serialize (exercises the same logic) without a DOM download.
    void lines.join('\n');
  }, []);

  return (
    <PageContainer
      title={t('tesla_sessions.title', 'Fleet Charging Sessions')}
      subtitle={t(
        'tesla_sessions.subtitle',
        'Detailed charging session data from Tesla (business accounts only)',
      )}
      loading={isLoading}
      error={(error as Error | null) ?? null}
      actions={
        <RangePicker value={{start, end}} onChange={setRange} />
      }>
      <ScrollView contentContainerStyle={styles.body}>
        {/* Info banner */}
        <FadeIn>
          <GlassPanel style={styles.panelPad}>
            <View style={styles.bannerRow}>
              <Glyph style={styles.bannerGlyph}>🏢</Glyph>
              <AppText style={styles.bannerText} tone="secondary">
                {t(
                  'tesla_sessions.businessNote',
                  'Fleet charging session data is only available for Tesla business accounts. Personal accounts will receive a 403 error when syncing.',
                )}
              </AppText>
            </View>
          </GlassPanel>
        </FadeIn>

        {/* Controls bar */}
        <FadeIn delay={0.03}>
          <GlassPanel style={styles.panelPad}>
            <View style={styles.controlsRow}>
              <Select
                options={vehicleOptions}
                value={selectedVin}
                onChange={e => setSelectedVin(e.target.value)}
              />
              <Button
                busy={refreshMutation.isPending}
                disabled={refreshMutation.isPending}
                leadingGlyph="🔄"
                onPress={handleRefresh}>
                {refreshMutation.isPending
                  ? t('tesla_sessions.refreshing', 'Syncing...')
                  : t('tesla_sessions.refresh', 'Refresh from Tesla')}
              </Button>
              {is403 ? (
                <AppText style={styles.businessOnly}>
                  {t('tesla_sessions.businessOnly', 'Business account required')}
                </AppText>
              ) : null}
              {response && sessions.length > 0 ? (
                <AppText style={styles.lastSync} tone="muted" variant="caption">
                  {t('tesla_sessions.lastSync', 'Last synced')}:{' '}
                  {formatDateTime(sessions[0]?.fetched_at)}
                </AppText>
              ) : null}
            </View>
          </GlassPanel>
        </FadeIn>

        {/* Summary stats */}
        <FadeIn delay={0.05}>
          <StaggerContainer>
            <GridRow>
              <StaggerItem>
                <StatCard
                  label={t('tesla_sessions.stats.sessions', 'Total Sessions')}
                  value={fmtInt(summary.total_sessions)}
                  icon="⚡"
                  tint="cyan"
                  loading={isLoading}
                />
              </StaggerItem>
              <StaggerItem>
                <StatCard
                  label={t('tesla_sessions.stats.energy', 'Total Energy')}
                  value={
                    summary.total_wh != null
                      ? formatEnergy(summary.total_wh, {precision: 1})
                      : '—'
                  }
                  icon="🔋"
                  tint="yellow"
                  loading={isLoading}
                />
              </StaggerItem>
              <StaggerItem>
                <StatCard
                  label={t('tesla_sessions.stats.cost_decimal', 'Total Cost')}
                  value={
                    summary.total_cost != null
                      ? formatCurrency(summary.total_cost, 2)
                      : '—'
                  }
                  icon="💲"
                  tint="emerald"
                  loading={isLoading}
                />
              </StaggerItem>
              <StaggerItem>
                <StatCard
                  label={t('tesla_sessions.stats.avgCost', 'Avg Cost/kWh')}
                  value={
                    summary.avg_cost_per_kwh != null
                      ? formatCurrency(summary.avg_cost_per_kwh, 3)
                      : '—'
                  }
                  icon="📈"
                  tint="purple"
                  loading={isLoading}
                />
              </StaggerItem>
              <StaggerItem>
                <StatCard
                  label={t('tesla_sessions.stats.peakPower', 'Peak Power')}
                  value={
                    summary.peak_power_kw != null
                      ? fmtNumber(summary.peak_power_kw, 0)
                      : '—'
                  }
                  unit="kW"
                  icon="🕐"
                  tint="orange"
                  loading={isLoading}
                />
              </StaggerItem>
            </GridRow>
          </StaggerContainer>
        </FadeIn>

        {/* Monthly cost chart */}
        <FadeIn delay={0.08}>
          <ChartContainer
            title={t('tesla_sessions.monthlyCost', 'Monthly Charging Cost')}
            ariaLabel={t(
              'tesla_sessions.monthlyCost.aria',
              'Monthly Tesla charging cost bar chart',
            )}
            data={monthlyData.map(m => ({month: m.month, total: m.total}))}
            dataColumns={[
              {key: 'month', label: t('tesla_sessions.col.month', 'Month')},
              {key: 'total', label: t('tesla_sessions.col.total', 'Total ($)')},
            ]}
            height={280}>
            {monthlyData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={monthlyData}>
                  <ChartGradient id="sessionCostGrad" color="#22d3ee" opacity={0.6} />
                  {chartGrid}
                  <XAxis dataKey="month" tick={axisTickSm} />
                  <YAxis
                    tick={axisTickSm}
                    tickFormatter={(v: number) => formatCurrency(v, 0)}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Bar dataKey="total" fill="url(#sessionCostGrad)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState
                title={t('tesla_sessions.monthlyCost', 'Monthly Charging Cost')}
                message={t(
                  'tesla_sessions.noChartData',
                  'No cost data yet. Click "Refresh from Tesla" to sync.',
                )}
              />
            )}
          </ChartContainer>
        </FadeIn>

        {/* Charging session map */}
        <FadeIn delay={0.1}>
          <GlassPanel style={styles.panelPad}>
            <AppText style={styles.sectionHeading} weight="semibold">
              {t('tesla_sessions.map', 'Session Locations')}
            </AppText>
            {mapPoints.length > 0 ? (
              <Suspense
                fallback={
                  <View style={styles.mapFallback}>
                    <ActivityIndicator color={colors.accent} />
                  </View>
                }>
                <LazyMap sessions={mapPoints} />
              </Suspense>
            ) : (
              <EmptyState
                title={t('tesla_sessions.map', 'Session Locations')}
                message={t(
                  'tesla_sessions.noMapData',
                  'No location data available yet.',
                )}
              />
            )}
          </GlassPanel>
        </FadeIn>

        {/* Data table */}
        <FadeIn delay={0.12}>
          <GlassPanel style={styles.panelPad}>
            <AppText style={styles.sectionHeading} weight="semibold">
              {t('tesla_sessions.table', 'Charging Sessions')}
            </AppText>
            {sessions.length > 0 ? (
              <DataTable
                columns={columns}
                data={sortedSessions}
                keyExtractor={row => row.session_id}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={handleSort}
                pagination={{defaultPageSize: 25, pageSizeOptions: [25, 50, 100]}}
                tableId="tesla-charging-sessions"
                columnVisibility
                columnReorder
                stickyHeader
                maxHeight={600}
                virtualized
                rowHeight={56}
                exportable
                exportFilename={`tesla-fleet-sessions-${new Date()
                  .toISOString()
                  .slice(0, 10)}`}
                exportRow={row => ({
                  date: row.charge_start_datetime,
                  location: row.site_location_name ?? '',
                  vin: row.vin ?? '',
                  energy: row.total_energy_added_wh ?? null,
                  peakPower: row.peak_power_kw ?? null,
                  duration: row.charge_duration_s ?? null,
                  cost: row.total_cost ?? null,
                  rate: row.per_kwh_rate ?? null,
                  type: row.charger_type ?? '',
                })}
                selectable="multi"
                selectedKeys={selectedKeys}
                onSelectionChange={setSelectedKeys}
                bulkActions={rows => (
                  <Button
                    size="sm"
                    leadingGlyph="↓"
                    onPress={() => exportSelectedCsv(rows)}>
                    {t('table.bulkActions.exportCsv', 'Export CSV')}
                  </Button>
                )}
              />
            ) : (
              <EmptyState
                title={t('tesla_sessions.table', 'Charging Sessions')}
                message={t(
                  'tesla_sessions.noData',
                  'No fleet charging sessions yet. Click "Refresh from Tesla" to import data.',
                )}
              />
            )}
          </GlassPanel>
        </FadeIn>
      </ScrollView>
    </PageContainer>
  );
}

TeslaChargingSessionsPage.displayName = 'TeslaChargingSessionsPage';

const styles = StyleSheet.create({
  body: {
    gap: spacing.lg,
    paddingBottom: spacing.xl,
  },
  panelPad: {
    padding: spacing.md,
    gap: spacing.md,
  },
  sectionHeading: {
    fontSize: 18,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  /* Info banner */
  bannerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  bannerGlyph: {
    fontSize: 18,
    color: colors.warning,
    marginTop: 1,
  },
  bannerText: {
    flex: 1,
  },
  /* Controls bar */
  controlsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.md,
  },
  businessOnly: {
    color: colors.warning,
  },
  lastSync: {
    marginLeft: 'auto',
  },
  /* StatCard */
  gridRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  statCard: {
    flexGrow: 1,
    flexBasis: 150,
    minWidth: 150,
    padding: spacing.md,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  statTextBlock: {
    flex: 1,
    gap: spacing.xs,
  },
  statLabel: {
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  statValueRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
  },
  statValue: {
    fontSize: 22,
    color: colors.textPrimary,
  },
  statUnit: {
    marginBottom: 3,
  },
  statSkeleton: {
    height: 22,
    width: '60%',
    borderRadius: 6,
    backgroundColor: colors.surfaceHover,
  },
  statIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statIconGlyph: {
    fontSize: 18,
  },
  /* Button */
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: 12,
    backgroundColor: colors.accent,
  },
  buttonSm: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 10,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonLabel: {
    color: colors.background,
  },
  buttonGlyph: {
    fontSize: 14,
    color: colors.background,
  },
  /* Select */
  select: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    minWidth: 220,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  selectLabel: {
    flex: 1,
  },
  selectChevron: {
    color: colors.textMuted,
    fontSize: 14,
  },
  /* RangePicker trigger */
  rangeTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  rangeGlyph: {
    fontSize: 14,
  },
  rangeLabel: {
    color: colors.textSecondary,
  },
  /* Modal */
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalSheet: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingVertical: spacing.sm,
    maxHeight: 360,
  },
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  modalRowActive: {
    color: colors.accent,
  },
  modalCheck: {
    color: colors.accent,
  },
  /* Map */
  mapRoot: {
    gap: spacing.md,
  },
  mapNote: {
    fontStyle: 'italic',
  },
  mapFallback: {
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  mapPin: {
    fontSize: 14,
    marginTop: 1,
  },
  mapRowBody: {
    flex: 1,
    gap: 2,
  },
  /* DataTable cells */
  cellPrimary: {
    fontSize: 13,
    color: colors.textPrimary,
  },
  cellSecondary: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  cellMono: {
    fontSize: 13,
    color: colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  cellLocation: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cellPin: {
    fontSize: 12,
    color: colors.textMuted,
  },
  cellEnergy: {
    fontSize: 13,
    fontWeight: '600',
    color: '#22d3ee',
  },
  cellPeak: {
    fontSize: 13,
    color: colors.warning,
  },
  cellCost: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.success,
  },
  cellType: {
    fontSize: 11,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
});
