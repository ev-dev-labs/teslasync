// Native parity port of web/src/features/maps/pages/LocationsPage.tsx.
//
// The web module is the "Visited Locations" page: a PageContainer (title +
// subtitle + a header actions row of a vehicle <Select>, a <RangePicker>, and a
// <DataFreshnessAuto> chip) that renders a 6-up summary-stats grid of
// <MetricCard>s, a "Top Locations by Visits" horizontal bar chart, a "Top
// Locations by Time Spent" horizontal bar chart, and an "All Locations" panel
// with a <SearchInput>/<FilterBar>/<ActiveFilterChips> filter row, a ranked,
// paginated list of locations (each row optionally followed by the propose-only
// <AIAutoNameUnnamedLocations> affordance), and a <Pagination> footer. Visited
// locations are read from GET /locations?vehicle_id=&limit=&offset= via the same
// useQuery + request() the web uses, with the query key
// ['visited-locations', vehicleId, page, pageSize] preserved verbatim.
// total_duration_s arrives as SI seconds; the page converts at the display
// boundary to the user's duration unit (hours) via useUnits().formatDuration.
//
// Native-safe substitutions (rules 4/5/7), documented in the parity sidecar:
//   • react-i18next useTranslation() -> a local useTranslation() whose
//     t(key, fallback?, params?) returns the English fallback (or key) and
//     interpolates {{name}} params, preserving every translation key verbatim.
//   • @/hooks/usePageTitle -> a native no-op (no document.title in RN).
//   • @/hooks/useUnits -> an inlined useUnits() exposing formatDuration, derived
//     from the ported useSettings() (duration pref 'h', locale + decimal_precision
//     from settings) exactly like the web lib formatDuration; SI seconds in,
//     "<hours> h" out.
//   • @/hooks/useSelectedVehicle -> an inlined native hook over the ported
//     useVehicles() that keeps the "first vehicle is the default" precedence in
//     local state (RN has no router path/query precedence or persisted store).
//   • @/hooks/useUrlState (useUrlNumber/useUrlString) + @/hooks/useRangeState ->
//     in-memory useState (RN has no browser URL / localStorage); the 'all'
//     default preset resolves to 2015-01-01..today, the range still drives the
//     client-side last_visited filter, and the page still calls setPage/setSearch.
//   • @/hooks/useFilteredList -> ported verbatim (substring match across fields).
//   • @/lib/numberFormat fmtNumber + @/lib/dateFormat formatDate -> inlined
//     faithfully (fmtNumber: locale-aware fixed-decimal, non-finite -> 0, bad
//     locale en-US fallback; formatDate: short "MMM D, YYYY" via toLocaleDateString,
//     "—" for nullish/invalid). RN ships no global number-format singleton, so
//     fmtNumber uses en-US (the web default before settings configure it).
//   • @/lib/cn -> dropped; Tailwind class composition becomes StyleSheet styles.
//   • lucide-react icons (MapPin/Clock/Hash/Trophy/Navigation/Building2) -> native
//     glyph tiles / the ported <SemanticIcon> (no SVG/DOM icon library imported).
//   • @/components/layout PageContainer + @/components/ui Select/Pagination +
//     @/components/data-display MetricCard/DataFreshnessAuto + @/components/forms
//     SearchInput/FilterBar/ActiveFilterChips + the Recharts BarChart stack ->
//     inlined native equivalents (no Recharts/ResponsiveContainer/Tooltip, no DOM
//     button/input/select). The SearchInput recent-search history dropdown and the
//     ActiveFilterChips overflow popover are localStorage/DOM-only affordances and
//     are dropped (historyScope is accepted but unused).
//   • @/components/feedback EmptyState/Skeleton + @/components/motion FadeIn +
//     @/components/forms RangePicker + @/components/ai AIAutoNameUnnamedLocations
//     -> the already-ported native components.
// Field access stays snake_case where the API uses it (the native request()
// camelCaseKeys keeps the original keys). No DOM elements, react-i18next,
// framer-motion, Recharts, Leaflet, react-dom, or web UI-kit modules are imported.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import {useQuery, type UseQueryResult} from '@tanstack/react-query';

import {request} from '../../../api/client';
import {useSettings} from '../../../api/hooks/useSettings';
import {useVehicles, type Vehicle} from '../../../api/hooks/useVehicles';
import {AIAutoNameUnnamedLocations} from '../../../components/ai/AIAutoNameUnnamedLocations';
import {EmptyState} from '../../../components/feedback/EmptyState';
import {Skeleton} from '../../../components/feedback/Skeleton';
import {RangePicker} from '../../../components/forms/RangePicker';
import {FadeIn} from '../../../components/motion/FadeIn';
import {SemanticIcon} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';

/* ─── shared chart fills (web Recharts <Bar fill>) ──────────────────────── */

const VISITS_FILL = '#10b981';
const HOURS_FILL = '#a855f7';
// web text-emerald-300 used for the per-row count chip + AI applied-name note.
const EMERALD_300 = '#6ee7b7';

/* ─── i18n fallback (web react-i18next useTranslation) ──────────────────── */

type TParams = Record<string, string | number>;
type TFunc = (key: string, fallback?: string, params?: TParams) => string;

// Native stand-in for react-i18next's useTranslation: the parity bundle ships no
// i18n runtime, so `t` returns the English fallback (or key) while preserving
// every key at the call site, plus `{{name}}` interpolation for the sub-component
// templates (pagination count, filter aria labels) that the web `t` interpolates.
function useTranslation(): {t: TFunc} {
  const t = useCallback<TFunc>((key, fallback, params) => {
    const template = fallback ?? key;
    if (!params) {
      return template;
    }
    return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
      const value = params[name];
      return value == null ? '' : String(value);
    });
  }, []);
  return {t};
}

// Web usePageTitle sets document.title; RN has no document, so this is a no-op
// that keeps the call site (and its translated title key) intact.
function usePageTitle(_title: string): void {
  // intentionally empty — no document.title equivalent in React Native.
}

/* ─── inlined @/lib/numberFormat fmtNumber ──────────────────────────────── */

const DEFAULT_LOCALE = 'en-US';
const DEFAULT_PRECISION = 2;

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function isFiniteNumber(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

// web fmtNumber(value, decimals?, locale?): locale-aware fixed-decimal formatting
// with non-finite inputs coerced to 0; the web global precision default is 2 and
// a bad locale tag falls back to en-US so a string is always produced.
function fmtNumber(
  v: unknown,
  decimals: number = DEFAULT_PRECISION,
  locale: string = DEFAULT_LOCALE,
): string {
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

/* ─── inlined @/lib/dateFormat formatDate ───────────────────────────────── */

// web formatDate: "MMM D, YYYY" via toLocaleDateString in the browser locale,
// "—" for nullish / unparseable input. RN uses the device locale (the web's
// browser-locale analog).
function formatDate(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/* ─── inlined @/hooks/useUnits (formatDuration only) ────────────────────── */

const SECONDS_PER_HOUR = 3600;
const DURATION_FALLBACK_PRECISION = 0;

type UnitFormatter = (
  value: number | null | undefined,
  options?: {precision?: number},
) => string;

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
  if (!Number.isFinite(decimalPrecision) || decimalPrecision < 0) {
    return undefined;
  }
  return Math.floor(decimalPrecision);
}

// web lib resolvePrecision: an explicit per-call override wins, then the settings
// precision, then the per-quantity fallback (duration = 0).
function resolvePrecision(
  prefPrecision: number | undefined,
  override: number | undefined,
  fallback: number,
): number {
  if (typeof override === 'number' && Number.isFinite(override) && override >= 0) {
    return Math.floor(override);
  }
  if (
    typeof prefPrecision === 'number' &&
    Number.isFinite(prefPrecision) &&
    prefPrecision >= 0
  ) {
    return Math.floor(prefPrecision);
  }
  return fallback;
}

// web useUnits().formatDuration -> lib formatDuration(seconds, pref, options):
// non-finite -> "—"; otherwise convert SI seconds to hours and format with the
// resolved precision + the 'h' unit suffix.
function useUnits(): {formatDuration: UnitFormatter} {
  const {data: settings} = useSettings();
  const locale = deriveLocale(settings?.locale);
  const precision = derivePrecision(settings?.decimal_precision);

  const formatDuration = useCallback<UnitFormatter>(
    (value, options) => {
      if (!isFiniteNumber(value)) {
        return '—';
      }
      const digits = resolvePrecision(
        precision,
        options?.precision,
        DURATION_FALLBACK_PRECISION,
      );
      const hours = value / SECONDS_PER_HOUR;
      return `${fmtNumber(hours, digits, locale)} h`;
    },
    [locale, precision],
  );

  return {formatDuration};
}

/* ─── inlined @/hooks/useUrlState (RN has no browser URL / localStorage) ──── */

function useUrlNumber(_key: string, initial: number): [number, (next: number) => void] {
  const [value, setValue] = useState<number>(initial);
  return [value, setValue];
}

function useUrlString(_key: string, initial: string): [string, (next: string) => void] {
  const [value, setValue] = useState<string>(initial);
  return [value, setValue];
}

/* ─── inlined @/hooks/useRangeState ─────────────────────────────────────── */

// web datePresets "All time" floor.
const ALL_TIME_FLOOR = '2015-01-01';

function todayIso(): string {
  return new Date().toISOString().split('T')[0];
}

interface RangeValue {
  start: string;
  end: string;
}

// web useRangeState with defaultPresetId 'all' resolves to [2015-01-01, today].
// RN has no URL/localStorage, so the range lives in local state; persistKey is
// accepted for API parity but unused.
function useRangeState(opts: {
  persistKey?: string;
  defaultPresetId?: string;
}): {start: string; end: string; setRange: (range: RangeValue) => void} {
  const {defaultPresetId = '30d'} = opts;
  const [range, setRangeState] = useState<RangeValue>(() => ({
    start: defaultPresetId === 'all' ? ALL_TIME_FLOOR : todayIso(),
    end: todayIso(),
  }));
  const setRange = useCallback((next: RangeValue) => {
    setRangeState(next);
  }, []);
  return {start: range.start, end: range.end, setRange};
}

/* ─── inlined @/hooks/useFilteredList (verbatim substring filter) ────────── */

type FilterField<T> = keyof T | ((item: T) => string | null | undefined);

function useFilteredList<T>(
  items: T[] | undefined | null,
  query: string,
  fields: ReadonlyArray<FilterField<T>>,
): T[] {
  return useMemo(() => {
    const list = items ?? [];
    const q = query.trim().toLowerCase();
    if (!q) {
      return list;
    }
    return list.filter(item =>
      fields.some(f => {
        const v = typeof f === 'function' ? f(item) : item[f];
        return String(v ?? '')
          .toLowerCase()
          .includes(q);
      }),
    );
  }, [items, query, fields]);
}

/* ─── inlined @/hooks/useSelectedVehicle ────────────────────────────────── */

interface SelectedVehicleResult {
  vehicleId: number | null;
  vehicles: Vehicle[];
  setVehicleId: (id: number | null) => void;
}

// Native useSelectedVehicle: RN has no router path/query precedence or persisted
// store, so the selection lives in local state, defaulting to the first vehicle
// the moment the fleet loads (the web hook's final precedence tier).
function useSelectedVehicle(): SelectedVehicleResult {
  const {data} = useVehicles();
  const vehicles = data ?? [];
  const [stored, setVehicleId] = useState<number | null>(null);

  const firstVehicleId = vehicles.length > 0 ? vehicles[0].id : null;
  useEffect(() => {
    if (stored == null && firstVehicleId != null) {
      setVehicleId(firstVehicleId);
    }
  }, [stored, firstVehicleId]);

  const effectiveId = stored ?? firstVehicleId;
  return {vehicleId: effectiveId, vehicles, setVehicleId};
}

/* ─── Types (web LocationsPage L37) ─────────────────────────────────────── */

interface VisitedLocation {
  id: number;
  address_name: string;
  visit_count: number;
  total_duration_s: number;
  last_visited: string | null;
}

// isUnnamedLocation reports whether a visited-location row should surface the AI
// auto-name affordance. Three buckets count as "unnamed": empty/whitespace, the
// literal "Unknown" sentinel the reverse-geocoder emits, and the coordinate-pair
// fallback shape the geocoder emits when reverse-geocode fails. (web L52, verbatim)
function isUnnamedLocation(addressName: string): boolean {
  const trimmed = (addressName ?? '').trim();
  if (trimmed === '') {
    return true;
  }
  if (trimmed.toLowerCase() === 'unknown') {
    return true;
  }
  if (/^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return true;
  }
  return false;
}

/* ─── inlined @/components/data-display MetricCard ──────────────────────── */

type MetricColor = 'green' | 'blue' | 'cyan' | 'purple' | 'amber';

// web MetricCard `color` (neon palette) -> native theme-token tints; the lucide
// icon is rendered as a recolored glyph tile so each card keeps its colour intent.
const METRIC_PALETTE: Record<MetricColor, {bg: string; border: string; fg: string}> = {
  green: {bg: colors.successSurface, border: colors.successBorder, fg: colors.success},
  blue: {bg: 'rgba(59, 130, 246, 0.14)', border: 'rgba(59, 130, 246, 0.32)', fg: '#60a5fa'},
  cyan: {bg: colors.surfaceSelected, border: colors.borderAccent, fg: colors.accent},
  purple: {bg: colors.violetSurface, border: colors.violetBorder, fg: colors.violet},
  amber: {bg: colors.warningSurface, border: colors.warningBorder, fg: colors.warning},
};

function MetricCard({
  label,
  value,
  glyph,
  color,
}: {
  label: string;
  value: string | number;
  glyph: string;
  color: MetricColor;
}) {
  const palette = METRIC_PALETTE[color];
  return (
    <View style={styles.metricCard}>
      <View style={styles.metricCardRow}>
        <View style={styles.metricCardText}>
          <AppText
            numberOfLines={1}
            style={styles.metricCardLabel}
            tone="muted"
            variant="caption">
            {label}
          </AppText>
          <AppText numberOfLines={1} style={styles.metricCardValue} weight="bold">
            {value}
          </AppText>
        </View>
        <View
          style={[styles.metricIcon, {backgroundColor: palette.bg, borderColor: palette.border}]}>
          <AppText style={[styles.metricIconGlyph, {color: palette.fg}]} weight="bold">
            {glyph}
          </AppText>
        </View>
      </View>
    </View>
  );
}

/* ─── inlined @/components/ui Select (vehicle picker) ───────────────────── */

interface SelectOption {
  value: string;
  label: string;
}

// web <Select> (a DOM <select>) -> a row of pressable option chips; onChange
// receives the chosen option value, mirroring the web `e.target.value` payload.
function Select({
  options,
  value,
  onChange,
}: {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View style={styles.optionRow}>
      {options.map(opt => {
        const active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            accessibilityRole="button"
            accessibilityState={{selected: active}}
            onPress={() => onChange(opt.value)}
            style={({pressed}) => [
              styles.option,
              active ? styles.optionActive : null,
              pressed ? styles.optionPressed : null,
            ]}>
            <AppText
              numberOfLines={1}
              style={active ? styles.optionTextActive : styles.optionText}
              weight={active ? 'semibold' : 'regular'}>
              {opt.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ─── native horizontal bar chart (web Recharts vertical BarChart) ──────── */

interface BarRow {
  name: string;
  value: number;
}

// web <BarChart layout="vertical"> with a YAxis category + XAxis number Bar ->
// per-row label + a track filled to value/max + the formatted value. No Recharts
// / ResponsiveContainer / Tooltip primitives are imported.
function HorizontalBarChart({
  rows,
  color,
  decimals,
}: {
  rows: BarRow[];
  color: string;
  decimals: number;
}) {
  const max = Math.max(1, ...rows.map(r => r.value));
  return (
    <View style={styles.chart}>
      {rows.map((row, i) => (
        <View key={`${row.name}-${i}`} style={styles.chartRow}>
          <AppText numberOfLines={1} style={styles.chartLabel} tone="muted" variant="caption">
            {row.name}
          </AppText>
          <View style={styles.chartTrack}>
            <View
              style={[
                styles.chartFill,
                {backgroundColor: color, width: `${Math.max((row.value / max) * 100, 2)}%`},
              ]}
            />
          </View>
          <AppText style={styles.chartValue} variant="caption">
            {fmtNumber(row.value, decimals)}
          </AppText>
        </View>
      ))}
    </View>
  );
}

/* ─── inlined @/components/forms SearchInput (debounced) ────────────────── */

const SEARCH_DEBOUNCE_MS = 250;

// web SearchInput: a debounced controlled field with a leading magnifier + a
// trailing clear button. The recent-search history dropdown is a localStorage/DOM
// affordance dropped natively (historyScope is accepted but unused).
function SearchInput({
  value,
  onChange,
  placeholder,
  historyScope: _historyScope,
  clearLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  historyScope?: string;
  clearLabel?: string;
}) {
  const {t} = useTranslation();
  const [local, setLocal] = useState(value);

  useEffect(() => {
    setLocal(value);
  }, [value]);

  useEffect(() => {
    if (local === value) {
      return;
    }
    const id = setTimeout(() => onChange(local), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [local, value, onChange]);

  const label = clearLabel ?? t('common.clear', 'Clear');

  return (
    <View style={styles.searchWrap}>
      <SemanticIcon decorative name="search" size="sm" />
      <TextInput
        accessibilityLabel={placeholder}
        onChangeText={setLocal}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        style={styles.searchInput}
        value={local}
      />
      {local ? (
        <Pressable
          accessibilityLabel={label}
          accessibilityRole="button"
          onPress={() => setLocal('')}
          style={styles.searchClear}>
          <AppText style={styles.searchClearText} tone="muted">
            ×
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

/* ─── inlined @/components/forms FilterBar ──────────────────────────────── */

function FilterBar({children}: {children: ReactNode}) {
  return <View style={styles.filterBar}>{children}</View>;
}

/* ─── inlined @/components/forms ActiveFilterChips ──────────────────────── */

export interface FilterChipDescriptor {
  key: string;
  label: string;
  value: string;
  onRemove: () => void;
}

// web ActiveFilterChips: one removable chip per active filter + an optional
// "Clear all". The overflow "+N more" popover is a DOM affordance dropped
// natively (this page never exceeds one chip).
function ActiveFilterChips({
  filters,
  onClearAll,
  hideWhenEmpty = true,
}: {
  filters: readonly FilterChipDescriptor[];
  onClearAll?: () => void;
  hideWhenEmpty?: boolean;
}) {
  const {t} = useTranslation();
  if (hideWhenEmpty && filters.length === 0) {
    return null;
  }
  return (
    <View
      accessibilityLabel={t('filters.activeLabel', 'Active filters')}
      style={styles.chipsRow}>
      {filters.map(descriptor => (
        <View key={descriptor.key} style={styles.chip}>
          <AppText numberOfLines={1} style={styles.chipText} variant="caption">
            <AppText style={styles.chipLabel} variant="caption">
              {`${descriptor.label}: `}
            </AppText>
            {descriptor.value}
          </AppText>
          <Pressable
            accessibilityLabel={t('filters.removeAria', 'Remove filter {{label}}', {
              label: descriptor.label,
            })}
            accessibilityRole="button"
            onPress={descriptor.onRemove}
            style={styles.chipClose}>
            <AppText style={styles.chipCloseText} tone="muted">
              ×
            </AppText>
          </Pressable>
        </View>
      ))}
      {onClearAll && filters.length > 0 ? (
        <Pressable accessibilityRole="button" onPress={onClearAll} style={styles.chipClearAll}>
          <AppText style={styles.chipClearAllText} tone="secondary" variant="caption">
            {t('filters.clearAll', 'Clear all')}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

/* ─── inlined @/components/ui Pagination ────────────────────────────────── */

function PagerButton({
  glyph,
  label,
  disabled,
  onPress,
}: {
  glyph: string;
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{disabled}}
      disabled={disabled}
      onPress={onPress}
      style={[styles.pagerButton, disabled ? {opacity: 0.3} : null]}>
      <AppText style={styles.pagerButtonText} tone="muted">
        {glyph}
      </AppText>
    </Pressable>
  );
}

function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const {t} = useTranslation();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <View style={styles.pagination}>
      <AppText style={styles.paginationInfo} tone="muted" variant="caption">
        {t('pagination.showing', 'Showing {{start}}–{{end}} of {{total}}', {
          start: total > 0 ? start : 0,
          end,
          total,
        })}
      </AppText>
      <View style={styles.paginationButtons}>
        <PagerButton
          disabled={page <= 1}
          glyph="«"
          label={t('pagination.first', 'First page')}
          onPress={() => onPageChange(1)}
        />
        <PagerButton
          disabled={page <= 1}
          glyph="‹"
          label={t('pagination.previous', 'Previous page')}
          onPress={() => onPageChange(page - 1)}
        />
        <AppText
          accessibilityLabel={t('pagination.currentPage', 'Page {{page}} of {{total}}', {
            page,
            total: totalPages,
          })}
          style={styles.paginationPage}
          tone="secondary"
          variant="caption">
          {`${page} / ${totalPages}`}
        </AppText>
        <PagerButton
          disabled={page >= totalPages}
          glyph="›"
          label={t('pagination.next', 'Next page')}
          onPress={() => onPageChange(page + 1)}
        />
        <PagerButton
          disabled={page >= totalPages}
          glyph="»"
          label={t('pagination.last', 'Last page')}
          onPress={() => onPageChange(totalPages)}
        />
      </View>
    </View>
  );
}

/* ─── inlined @/components/data-display DataFreshnessAuto ────────────────── */

type FreshnessStatus = 'fresh' | 'fetching' | 'stale' | 'error';

const FRESHNESS_DOT: Record<FreshnessStatus, string> = {
  fresh: colors.success,
  fetching: colors.accent,
  stale: colors.warning,
  error: colors.danger,
};

type FreshnessQuery = Pick<
  UseQueryResult<unknown, unknown>,
  'isFetching' | 'isStale' | 'isError' | 'dataUpdatedAt' | 'refetch'
>;

function formatRelativeTime(ms: number, t: TFunc): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) {
    return t('freshness.justNow', 'just now');
  }
  if (seconds < 3600) {
    return t('freshness.minutes', '{{m}}m ago', {m: Math.floor(seconds / 60)});
  }
  if (seconds < 86_400) {
    return t('freshness.hours', '{{h}}h ago', {h: Math.floor(seconds / 3600)});
  }
  if (seconds < 604_800) {
    return t('freshness.days', '{{d}}d ago', {d: Math.floor(seconds / 86_400)});
  }
  return t('freshness.weeks', '{{w}}w ago', {w: Math.floor(seconds / 604_800)});
}

// web DataFreshnessAuto: a query-driven freshness chip (status dot + relative
// time) that refetches on press. The animated spinner/ping collapse to a static
// coloured dot; a 30s tick keeps the relative label fresh (cleaned up on unmount).
function DataFreshnessAuto({query}: {query: FreshnessQuery}) {
  const {t} = useTranslation();
  const [, setTick] = useState(0);
  const updatedAt = query.dataUpdatedAt > 0 ? query.dataUpdatedAt : null;

  useEffect(() => {
    if (!updatedAt) {
      return;
    }
    const id = setInterval(() => setTick(n => n + 1), 30_000);
    return () => clearInterval(id);
  }, [updatedAt]);

  const status: FreshnessStatus = query.isError
    ? 'error'
    : query.isFetching
    ? 'fetching'
    : query.isStale
    ? 'stale'
    : 'fresh';

  const relativeTime =
    updatedAt && !query.isFetching
      ? formatRelativeTime(updatedAt, t)
      : query.isFetching
      ? t('freshness.updating', 'updating…')
      : query.isError
      ? t('freshness.error', 'error')
      : '';

  return (
    <Pressable
      accessibilityLabel={t('freshness.refresh', 'Refresh')}
      accessibilityRole="button"
      onPress={() => {
        if (!query.isFetching) {
          void query.refetch();
        }
      }}
      style={styles.freshness}>
      <View style={[styles.freshnessDot, {backgroundColor: FRESHNESS_DOT[status]}]} />
      <AppText style={[styles.freshnessText, {color: FRESHNESS_DOT[status]}]} variant="caption">
        {relativeTime}
      </AppText>
    </Pressable>
  );
}

/* ─── inlined @/components/layout PageContainer ──────────────────────────── */

function PageContainer({
  title,
  subtitle,
  actions,
  loading,
  error,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  loading?: boolean;
  error?: Error | null;
  children: ReactNode;
}) {
  return (
    <ScrollView contentContainerStyle={styles.pageContent} style={styles.page}>
      <View style={styles.pageHeader}>
        <View style={styles.pageHeaderText}>
          <AppText style={styles.pageTitle} weight="bold">
            {title}
          </AppText>
          {subtitle ? (
            <AppText style={styles.pageSubtitle} tone="muted">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {actions ? <View style={styles.pageActions}>{actions}</View> : null}
      </View>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : error ? (
        <View style={styles.pageErrorBox}>
          <AppText style={styles.pageErrorText}>{error.message}</AppText>
        </View>
      ) : (
        children
      )}
    </ScrollView>
  );
}

/* ─── ranked list row (web LocationsPage L279) ──────────────────────────── */

function rankPalette(index: number): {bg: string; fg: string} {
  if (index === 0) {
    return {bg: colors.warningSurface, fg: colors.warning};
  }
  if (index < 3) {
    return {bg: colors.surfaceSelected, fg: colors.accent};
  }
  return {bg: colors.surfaceRaised, fg: colors.textMuted};
}

function LocationRow({
  loc,
  index,
  appliedName,
  formatDuration,
  t,
}: {
  loc: VisitedLocation;
  index: number;
  appliedName: {id: number; name: string} | null;
  formatDuration: UnitFormatter;
  t: TFunc;
}) {
  const palette = rankPalette(index);
  const avgPerVisit = loc.visit_count > 0 ? loc.total_duration_s / loc.visit_count : 0;
  const lastVisitedSuffix = loc.last_visited
    ? ` · ${t('Last')}: ${formatDate(loc.last_visited)}`
    : '';

  return (
    <GlassPanel style={styles.locationCard}>
      <View style={[styles.rankBadge, {backgroundColor: palette.bg}]}>
        <AppText style={[styles.rankBadgeText, {color: palette.fg}]} weight="bold">
          {`#${index + 1}`}
        </AppText>
      </View>
      <View style={styles.locationInfo}>
        <AppText numberOfLines={1} style={styles.locationName} weight="semibold">
          {loc.address_name}
        </AppText>
        <AppText style={styles.locationMeta} tone="muted" variant="caption">
          {`${loc.visit_count} ${t('visits')} · ${formatDuration(loc.total_duration_s)} ${t(
            'total',
          )} · ~${formatDuration(avgPerVisit)} ${t('avg')}${lastVisitedSuffix}`}
        </AppText>
        {appliedName?.id === loc.id ? (
          <AppText style={styles.appliedName} variant="caption">
            {`${t('locations.aiAutoName.applied', 'Suggested name ready to save:')} `}
            <AppText style={styles.appliedNameValue} variant="caption">
              {appliedName.name}
            </AppText>
          </AppText>
        ) : null}
      </View>
      <View style={styles.locationCount}>
        <AppText style={styles.locationCountText}>#</AppText>
        <AppText style={styles.locationCountText} weight="semibold">
          {loc.visit_count}
        </AppText>
      </View>
    </GlassPanel>
  );
}

/* ─── LocationsPage (web LocationsPage L65) ─────────────────────────────── */

export default function LocationsPage(): React.ReactElement {
  const {t} = useTranslation();
  usePageTitle(t('Locations'));
  const {formatDuration} = useUnits();

  const [, setUrlVehicleId] = useUrlNumber('vehicle_id', 0);
  const {vehicleId, vehicles, setVehicleId} = useSelectedVehicle();
  const onPickVehicle = (id: number) => {
    setVehicleId(id);
    setUrlVehicleId(id);
  };
  const [page, setPage] = useUrlNumber('page', 1);
  const pageSize = 50;
  const [search, setSearch] = useUrlString('q', '');
  // AI applied-name pending hand-off — parked here keyed by location.id when the
  // user clicks Apply on an AI proposal; the AI panel never persists.
  const [appliedName, setAppliedName] = useState<{id: number; name: string} | null>(null);
  const {start, end, setRange} = useRangeState({
    persistKey: 'locations.range',
    defaultPresetId: 'all',
  });

  const locationsQuery = useQuery({
    queryKey: ['visited-locations', vehicleId, page, pageSize],
    queryFn: () =>
      request<VisitedLocation[]>(
        `/locations?vehicle_id=${vehicleId}&limit=${pageSize}&offset=${(page - 1) * pageSize}`,
      ),
    enabled: vehicleId !== null,
  });
  const {data: rawLocations, isLoading, error} = locationsQuery;

  // Client-side filter by `last_visited` within the picked range. Backend
  // /locations does not yet accept from/to so visit_count and total_duration_s
  // remain LIFETIME aggregates — we only narrow which places are listed.
  const locations = useMemo(() => {
    if (!rawLocations?.length) {
      return rawLocations;
    }
    const startMs = new Date(`${start}T00:00:00`).getTime();
    const endMs = new Date(`${end}T23:59:59.999`).getTime();
    return rawLocations.filter(l => {
      if (!l.last_visited) {
        return false;
      }
      const visitedMs = new Date(l.last_visited).getTime();
      return visitedMs >= startMs && visitedMs <= endMs;
    });
  }, [rawLocations, start, end]);

  const locationSearchFields = useMemo<ReadonlyArray<keyof VisitedLocation>>(
    () => ['address_name'],
    [],
  );
  const filteredLocations = useFilteredList(locations, search, locationSearchFields);

  const totalVisits = locations?.reduce((s, l) => s + l.visit_count, 0) ?? 0;
  const totalTime = locations?.reduce((s, l) => s + l.total_duration_s, 0) ?? 0;
  const uniquePlaces = locations?.length ?? 0;
  const topLocation = locations?.[0];
  const avgDurationS = totalVisits > 0 ? totalTime / totalVisits : 0;

  const uniqueCities = useMemo(() => {
    if (!locations?.length) {
      return 0;
    }
    const cities = new Set<string>();
    for (const loc of locations) {
      const parts = (loc.address_name ?? '').split(',').map(s => s.trim());
      const city = parts.length > 1 ? parts[parts.length - 1] : parts[0];
      if (city && city !== 'Unknown') {
        cities.add(city);
      }
    }
    return cities.size;
  }, [locations]);

  const visitsChartData = useMemo<BarRow[]>(
    () =>
      (locations ?? []).slice(0, 15).map(l => ({
        name:
          (l.address_name ?? '').length > 25
            ? (l.address_name ?? '').slice(0, 22) + '…'
            : l.address_name ?? '',
        value: l.visit_count,
      })),
    [locations],
  );

  const timeChartData = useMemo<BarRow[]>(
    () =>
      (locations ?? []).slice(0, 10).map(l => ({
        name:
          (l.address_name ?? '').length > 25
            ? (l.address_name ?? '').slice(0, 22) + '…'
            : l.address_name ?? '',
        value: +fmtNumber(l.total_duration_s / 3600, 1),
      })),
    [locations],
  );

  const vehicleOptions = vehicles.map(v => ({
    value: String(v.id),
    label: v.display_name || v.vin,
  }));

  return (
    <PageContainer
      title={t('Visited Locations')}
      subtitle={t("Places you've been — ranked by frequency")}
      loading={isLoading}
      error={error as Error | null}
      actions={
        <View style={styles.actions}>
          {vehicles.length > 0 ? (
            <Select
              onChange={v => onPickVehicle(Number(v))}
              options={vehicleOptions}
              value={String(vehicleId ?? '')}
            />
          ) : null}
          <RangePicker
            align="end"
            onChange={r => {
              setRange(r);
              setPage(1);
            }}
            triggerTestId="locations-range"
            value={{start, end}}
          />
          <DataFreshnessAuto query={locationsQuery} />
        </View>
      }>
      <View style={styles.sectionStack}>
        {/* ── Summary stats ────────────────────────────────────────── */}
        <FadeIn>
          <View style={styles.summaryGrid}>
            <MetricCard color="green" glyph="NV" label={t('Unique Places')} value={uniquePlaces} />
            <MetricCard color="blue" glyph="CT" label={t('Unique Cities')} value={uniqueCities} />
            <MetricCard color="cyan" glyph="#" label={t('Total Visits')} value={totalVisits} />
            <MetricCard
              color="purple"
              glyph="CK"
              label={t('Total Time')}
              value={formatDuration(totalTime)}
            />
            <MetricCard
              color="amber"
              glyph="TY"
              label={t('Most Visited')}
              value={topLocation?.address_name ?? '—'}
            />
            <MetricCard
              color="cyan"
              glyph="CK"
              label={t('Avg Visit')}
              value={formatDuration(avgDurationS)}
            />
          </View>
        </FadeIn>

        {/* ── Top Locations by Visits ───────────────────────────────── */}
        <FadeIn>
          <GlassPanel style={styles.panel}>
            <AppText style={styles.panelTitle} weight="semibold">
              {t('Top Locations by Visits')}
            </AppText>
            {isLoading ? (
              <Skeleton height={300} />
            ) : visitsChartData.length === 0 ? (
              <View style={styles.chartEmpty}>
                <AppText style={styles.chartEmptyText} tone="muted" variant="caption">
                  {t('No visited location data')}
                </AppText>
              </View>
            ) : (
              <HorizontalBarChart color={VISITS_FILL} decimals={0} rows={visitsChartData} />
            )}
          </GlassPanel>
        </FadeIn>

        {/* ── Top Locations by Time ────────────────────────────────── */}
        <FadeIn>
          <GlassPanel style={styles.panel}>
            <AppText style={styles.panelTitle} weight="semibold">
              {t('Top Locations by Time Spent (hours)')}
            </AppText>
            {isLoading ? (
              <Skeleton height={280} />
            ) : timeChartData.length === 0 ? (
              <View style={styles.chartEmpty}>
                <AppText style={styles.chartEmptyText} tone="muted" variant="caption">
                  {t('No time-spent data available')}
                </AppText>
              </View>
            ) : (
              <HorizontalBarChart color={HOURS_FILL} decimals={1} rows={timeChartData} />
            )}
          </GlassPanel>
        </FadeIn>

        {/* ── All Locations list ───────────────────────────────────── */}
        <FadeIn>
          <GlassPanel style={styles.panel}>
            <AppText style={styles.panelTitle} weight="semibold">
              {t('All Locations')}
            </AppText>
            <FilterBar>
              <SearchInput
                historyScope="locations"
                onChange={setSearch}
                placeholder={t('Search by address…')}
                value={search}
              />
            </FilterBar>
            <ActiveFilterChips
              filters={
                (search
                  ? [
                      {
                        key: 'q',
                        label: t('locations.filterLabel.search', 'Search'),
                        value: search,
                        onRemove: () => setSearch(''),
                      } satisfies FilterChipDescriptor,
                    ]
                  : []) as readonly FilterChipDescriptor[]
              }
              onClearAll={() => setSearch('')}
            />
            {isLoading ? (
              <View style={styles.listSkeletons}>
                {[1, 2, 3, 4, 5].map(i => (
                  <Skeleton height={64} key={i} rounded />
                ))}
              </View>
            ) : !locations?.length ? (
              <EmptyState
                icon={<SemanticIcon decorative name="mapPinned" size="lg" />}
                message={t('No visited locations recorded yet')}
                title={t('No locations')}
                actionTo={{label: t('locations.empty.cta', 'View drives'), to: '/drives'}}
              />
            ) : !filteredLocations.length ? (
              <EmptyState
                icon={<SemanticIcon decorative name="mapPinned" size="lg" />}
                message={t('No locations match your search')}
                title={t('No locations')}
                action={{label: t('Clear search'), onPress: () => setSearch('')}}
              />
            ) : (
              <>
                <View style={styles.list}>
                  {filteredLocations.map((loc, i) => (
                    <View key={loc.id} style={styles.locationItem}>
                      <LocationRow
                        appliedName={appliedName}
                        formatDuration={formatDuration}
                        index={i}
                        loc={loc}
                        t={t}
                      />
                      {isUnnamedLocation(loc.address_name) ? (
                        <AIAutoNameUnnamedLocations
                          currentName={loc.address_name}
                          locationId={loc.id}
                          onApplyName={name => setAppliedName({id: loc.id, name})}
                        />
                      ) : null}
                    </View>
                  ))}
                </View>
                <Pagination
                  onPageChange={setPage}
                  page={page}
                  pageSize={pageSize}
                  total={
                    locations.length < pageSize
                      ? (page - 1) * pageSize + locations.length
                      : page * pageSize + 1
                  }
                />
              </>
            )}
          </GlassPanel>
        </FadeIn>
      </View>
    </PageContainer>
  );
}

const styles = StyleSheet.create({
  actions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  appliedName: {
    color: EMERALD_300,
    marginTop: spacing.xs,
  },
  appliedNameValue: {
    color: colors.textPrimary,
  },
  chart: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  chartEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
    paddingVertical: 64,
  },
  chartEmptyText: {
    textAlign: 'center',
  },
  chartFill: {
    borderRadius: 999,
    height: '100%',
  },
  chartLabel: {
    fontSize: 11,
    width: 96,
  },
  chartRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  chartTrack: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    flex: 1,
    height: 12,
    overflow: 'hidden',
  },
  chartValue: {
    color: colors.textSecondary,
    minWidth: 36,
    textAlign: 'right',
  },
  chip: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  chipClearAll: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  chipClearAllText: {
    fontSize: 11,
  },
  chipClose: {
    alignItems: 'center',
    height: 16,
    justifyContent: 'center',
    width: 16,
  },
  chipCloseText: {
    fontSize: 14,
    lineHeight: 16,
  },
  chipLabel: {
    color: colors.textMuted,
    fontSize: 11,
  },
  chipText: {
    color: colors.textPrimary,
    fontSize: 11,
  },
  chipsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  filterBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  freshness: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  freshnessDot: {
    borderRadius: 999,
    height: 6,
    width: 6,
  },
  freshnessText: {
    fontSize: 10,
    minWidth: 64,
  },
  list: {
    gap: spacing.sm,
  },
  listSkeletons: {
    gap: spacing.md,
  },
  loadingBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
  },
  locationCard: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  locationCount: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  locationCountText: {
    color: EMERALD_300,
    fontSize: 12,
  },
  locationInfo: {
    flex: 1,
    minWidth: 0,
  },
  locationItem: {
    gap: spacing.sm,
  },
  locationMeta: {
    marginTop: 2,
  },
  locationName: {
    color: colors.textPrimary,
    fontSize: 13,
  },
  metricCard: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 150,
    padding: spacing.md,
  },
  metricCardLabel: {
    fontSize: 10,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  metricCardRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  metricCardText: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
  },
  metricCardValue: {
    color: colors.textPrimary,
    fontSize: 18,
    lineHeight: 24,
  },
  metricIcon: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  metricIconGlyph: {
    fontSize: 11,
    letterSpacing: 0.4,
  },
  option: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  optionActive: {
    backgroundColor: colors.surfaceSelected,
    borderColor: colors.borderAccent,
  },
  optionPressed: {
    opacity: 0.7,
  },
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  optionText: {
    color: colors.textSecondary,
  },
  optionTextActive: {
    color: colors.accent,
  },
  page: {
    backgroundColor: colors.background,
  },
  pageActions: {
    flexShrink: 1,
  },
  pageContent: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  pageErrorBox: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 16,
    borderWidth: 1,
    padding: spacing.lg,
  },
  pageErrorText: {
    color: colors.danger,
  },
  pageHeader: {
    flexDirection: 'column',
    gap: spacing.md,
  },
  pageHeaderText: {
    gap: spacing.xs,
  },
  pageSubtitle: {
    fontSize: 13,
  },
  pageTitle: {
    color: colors.textPrimary,
    fontSize: 24,
    lineHeight: 30,
  },
  pagerButton: {
    alignItems: 'center',
    borderRadius: 8,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  pagerButtonText: {
    fontSize: 16,
  },
  pagination: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between',
    marginTop: spacing.md,
    paddingTop: spacing.md,
  },
  paginationButtons: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  paginationInfo: {
    fontSize: 12,
  },
  paginationPage: {
    paddingHorizontal: spacing.sm,
  },
  panel: {
    padding: spacing.lg,
  },
  panelTitle: {
    color: colors.textPrimary,
    fontSize: 14,
    marginBottom: spacing.md,
  },
  rankBadge: {
    alignItems: 'center',
    borderRadius: 10,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  rankBadgeText: {
    fontSize: 12,
  },
  searchClear: {
    alignItems: 'center',
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  searchClearText: {
    fontSize: 16,
  },
  searchInput: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14,
    paddingVertical: 0,
  },
  searchWrap: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    flexGrow: 1,
    gap: spacing.sm,
    minWidth: 220,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  sectionStack: {
    gap: spacing.lg,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
