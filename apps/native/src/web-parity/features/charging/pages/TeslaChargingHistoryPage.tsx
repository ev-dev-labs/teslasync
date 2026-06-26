// Native parity port of web/src/features/charging/pages/TeslaChargingHistoryPage.tsx.
//
// Tesla Supercharger / DC-fast-charging billing surface. Every behaviour from
// the web page is preserved one-for-one:
//   - All state names (selectedVin, start/end via useRangeState, sortKey,
//     sortDir, search, selectedKeys) and their defaults ('' / preset 'all' /
//     'date' / 'desc' / '' / []).
//   - The allEntries / entries (range-filtered on charge_start_datetime) /
//     summary / vehicleOptions / monthlyData / columns / filteredEntries /
//     sortedEntries useMemos, plus handleRefresh / handleSort / exportSelectedCsv.
//   - The page-local helpers durationMinutes, formatDurationMinutes,
//     buildMonthlySpending and the gridCols constant are ported verbatim.
//   - The data hooks (useTeslaChargingHistory(selectedVin || undefined),
//     useRefreshTeslaChargingHistory, getTeslaChargingInvoiceURL, useVehicles)
//     are imported from the already-ported native web-parity hooks; API paths,
//     query keys and the snake_case ?vin param are unchanged.
//   - Unit handling matches web: usage_wh -> formatEnergy(wh,{precision:1}) at
//     the kWh display boundary; total_due -> formatCurrencyValue(.., currency,
//     locale, 2, {useGrouping:true}); total_spend/avg_cost_per_kwh ->
//     formatCurrency(amount, 2|3); rate_base -> fmtNumber(.,3); sessions ->
//     fmtInt. SI lives on the wire; conversion happens only at render.
//   - Every i18n key keeps its English default string (intent preserved).
//
// Web dependencies absent from the native parity manifest are remapped to
// native-safe equivalents (contract rules 4, 5 & 7) and documented here:
//   - react-i18next useTranslation -> inlined useNativeTranslation(): a stable
//     (key, fallback) => fallback shim (this page uses no interpolation).
//   - lucide-react Zap/DollarSign/RefreshCw/MapPin/Receipt/TrendingUp/Gauge/
//     Download -> SemanticIcon glyphs (bolt / dollarSign / refresh / location /
//     receipt / trendUp / speed / download).
//   - @/components/layout PageContainer/Grid -> inline native PageContainer
//     (title + subtitle + copy-link + loading + error + actions) and a
//     flex-wrap stat grid (StaggerContainer/Grid/StaggerItem collapse to a
//     grid of fade-in cells).
//   - @/components/ui GlassPanel/Button/Select/DataTable(+Column) -> the
//     existing native GlassPanel plus inline native Button, chip-row Select,
//     and a horizontally scrolling DataTable that supports the subset this page
//     uses: column render fns, tap-to-sort headers, multi-row selection +
//     bulkActions, CSV export, and client pagination. Web-only table affordances
//     (virtualized/stickyHeader/columnVisibility/columnReorder/maxHeight,
//     visibleOnMobile/defaultVisible) have no mobile analogue; all columns are
//     shown in a single horizontal scroll and the props are accepted-but-noop.
//   - @/components/data-display StatCard -> the existing native StatCard.
//   - @/components/motion FadeIn/StaggerContainer/StaggerItem -> Animated.View
//     opacity 0->1 mount fades (per-item delay reproduces the stagger).
//   - @/components/charts Recharts BarChart (ChartContainer/ChartTooltip/
//     ChartGradient/chartGrid/axisTickSm/BarChart/Bar/XAxis/YAxis/Tooltip/
//     ResponsiveContainer) -> an inline native horizontal bar chart
//     (MonthlySpendingChart): one bar per month scaled to the series max with
//     the month label and the formatted currency total printed beside it, so the
//     spending data stays exact on a phone and no SVG/Recharts is imported.
//   - @/components/feedback EmptyState -> inline native EmptyState (icon + msg).
//   - @/components/forms SearchInput/FilterBar/ActiveFilterChips/RangePicker
//     (+FilterChipDescriptor) -> inline native SearchInput (TextInput + search
//     glyph; the web search-history `historyScope` is web-only and dropped),
//     FilterBar (View), ActiveFilterChips (removable chip row), and the existing
//     native DatePresetChips driving the range (the web calendar RangePicker has
//     no native analogue; preset chips preserve the {start,end}->setRange path).
//   - @/hooks/useFilteredList -> ported verbatim.
//   - @/hooks/useRangeState -> native-safe shim (localStorage memory
//     feature-detected; URL sync dropped on bare native), matching the
//     PowerFlowDashboardPage port.
//   - @/hooks/useUrlState useUrlString/useUrlEnum -> native-safe in-memory
//     useState hooks with the same value/updater + enum-guard contract (no URL).
//   - @/hooks/usePageTitle -> native-safe usePageTitle (feature-detects
//     document.title; writes "{title} — TeslaSync").
//   - @/hooks/useUnits formatEnergy / @/hooks/useFormatting formatCurrency /
//     @/hooks/useSettings settings+locale -> inlined useChargingFormatters()
//     reading the ported useSettings query (energy pref kWh, currencySymbol,
//     decimal_precision, locale), mirroring deriveLocale/DEFAULT_ENERGY_PREF.
//   - @/lib/dateFormat formatDateTime, @/lib/numberFormat fmtNumber/fmtInt,
//     @/lib/currencyFormat formatCurrencyValue/currencyCodeFromSymbol ->
//     ported faithfully (fmtNumber/fmtInt keep the web module defaults
//     precision 2 / en-US; locale-aware currency+energy take the user locale).
//   - @/lib/cn cn -> the single `cn('h-4 w-4', isPending && 'animate-spin')`
//     usage maps to swapping the refresh glyph for an ActivityIndicator.
//
// Browser-only behaviour is made native-safe with explicit unavailable states:
//   - CSV export (web Blob + <a download>) -> feature-detected browser download;
//     when absent (bare native) it falls back to copying the CSV to the
//     clipboard, and when neither exists it surfaces an explicit "Unavailable"
//     state instead of failing silently. Applies to both the DataTable's
//     built-in export and the page's bulk exportSelectedCsv.
//   - Invoice <a href target=_blank> -> Linking.openURL(invoiceUrl).
//   - copyLink (web copies window.location.href) -> feature-detected
//     location+clipboard copy; "Unavailable" on bare native.
//
// No DOM-only modules, HTML elements, react-i18next, lucide-react, Recharts,
// Leaflet, or web UI components are imported — only react, react-native
// primitives, @tanstack/react-query (via the ported hooks), the ported
// web-parity charging/vehicles/settings hooks + datePresets lib + DatePresetChips
// + StatCard, and the existing apps/native SemanticIcon / AppText / GlassPanel /
// theme tokens.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Animated,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type DimensionValue,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {SemanticIcon, type SemanticIconName} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';

import {StatCard} from '../../../components/data-display/StatCard';
import {
  DatePresetChips,
  type DatePresetSelection,
} from '../../../components/forms/DatePresetChips';
import {
  DATE_PRESETS,
  DEFAULT_PRESET_IDS,
  getDatePreset,
  matchPresetId,
  resolveAllTimeStart,
} from '../../../lib/datePresets';
import {
  getTeslaChargingInvoiceURL,
  useRefreshTeslaChargingHistory,
  useTeslaChargingHistory,
  type TeslaChargingHistoryEntry,
} from '../../../api/hooks/useCharging';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {useSettings} from '../../../api/hooks/useSettings';

/* ─── shared types ────────────────────────────────────────────────────── */

type NativeTFunction = (key: string, fallback: string) => string;

type RowKey = string | number;
type SortDir = 'asc' | 'desc';
type ButtonVariant = 'primary' | 'secondary' | 'ghost';
type ButtonSize = 'sm' | 'md';
type ExportStatus = 'idle' | 'exported' | 'copied' | 'unavailable';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortable?: boolean;
  align?: 'left' | 'center' | 'right';
  width?: number;
  /** Web column-visibility flags — accepted for parity, no-op on native. */
  visibleOnMobile?: boolean;
  defaultVisible?: boolean;
}

/** Mirrors the web @/components/forms FilterChipDescriptor used by the page. */
interface FilterChipDescriptor {
  key: string;
  label: string;
  value: string;
  onRemove: () => void;
}

type CsvCellValue = string | number | boolean | null | undefined;

interface CsvColumn<T> {
  key: string;
  header?: string;
  accessor?: (row: T) => CsvCellValue;
}

const DEFAULT_COL_WIDTH = 150;
const CHECKBOX_COL_WIDTH = 44;

const SPEND_BAR_COLOR = '#22d3ee';

/* ─── i18n shim (react-i18next useTranslation) ────────────────────────── */

// This page passes only (key, English fallback) with no interpolation, so the
// shim simply returns the English fallback — preserving i18n intent at each
// call site without pulling react-i18next into native.
function useNativeTranslation(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

/* ─── usePageTitle shim (web @/hooks/usePageTitle) ────────────────────── */

// document.title exists on react-native-web but not on bare native, so the
// write is feature-detected. Mirrors the web "{title} — TeslaSync" format.
function usePageTitle(title: string): void {
  useEffect(() => {
    const doc = (globalThis as {document?: {title?: string}}).document;
    if (doc && typeof doc.title === 'string') {
      const prev = doc.title;
      doc.title = `${title} — TeslaSync`;
      return () => {
        doc.title = prev;
      };
    }
    return undefined;
  }, [title]);
}

/* ─── number/date formatting (ported from @/lib) ──────────────────────── */

// fmtNumber/fmtInt mirror @/lib/numberFormat. The web module reads a global
// precision/locale set on settings load; this port keeps the web module
// defaults (precision 2, en-US) since the page only overrides precision.
const FMT_DEFAULT_PRECISION = 2;
const FMT_DEFAULT_LOCALE = 'en-US';

function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals?: number, locale?: string): string {
  const d = decimals ?? FMT_DEFAULT_PRECISION;
  const lc = locale ?? FMT_DEFAULT_LOCALE;
  try {
    return safeNumber(v).toLocaleString(lc, {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  } catch {
    return safeNumber(v).toLocaleString('en-US', {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  }
}

function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

// Ported from @/lib/dateFormat formatDateTime ("Apr 4, 2026, 02:15 PM").
function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/* ─── energy formatting (ported from @/lib/unitConversion + useUnits) ─── */

// DEFAULT_ENERGY_PREF = 'kWh' from useUnits; convertEnergyFromSI(wh,'kWh') = wh/1000.
function formatEnergy(
  wh: number | null | undefined,
  locale: string | undefined,
  precision = 1,
): string {
  if (typeof wh !== 'number' || !Number.isFinite(wh)) return '—';
  const value = wh / 1000;
  try {
    return `${new Intl.NumberFormat(locale, {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    }).format(value)} kWh`;
  } catch {
    return `${new Intl.NumberFormat('en-US', {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    }).format(value)} kWh`;
  }
}

/* ─── currency formatting (ported from @/lib/currencyFormat) ──────────── */

function clampPrecision(precision: number | undefined): number {
  if (precision == null || !Number.isFinite(precision)) return 2;
  return Math.max(0, Math.min(20, Math.trunc(precision)));
}

function normaliseLocale(locale: string | undefined): string {
  return locale && locale.trim() ? locale : 'en-US';
}

function formatCurrencyValue(
  value: number | null | undefined,
  currency: string,
  locale: string,
  precision: number,
  options: {useGrouping?: boolean} = {},
): string {
  if (value == null || !Number.isFinite(value)) return '';
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

// Best-effort reverse lookup of an ISO 4217 code from the settings symbol.
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

/* ─── page-local helpers (ported verbatim from the web page) ──────────── */

/** Compute duration in minutes between two ISO timestamps. */
function durationMinutes(start: string, stop: string | null): number | null {
  if (!stop) return null;
  const ms = new Date(stop).getTime() - new Date(start).getTime();
  return ms > 0 ? Math.round(ms / 60_000) : null;
}

/** Format duration in minutes to "Xh Ym". */
function formatDurationMinutes(minutes: number | null): string {
  if (minutes == null) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Aggregate entries by month for the spending chart. */
function buildMonthlySpending(
  entries: TeslaChargingHistoryEntry[],
): {month: string; total: number}[] {
  const map = new Map<string, number>();
  for (const e of entries) {
    const d = new Date(e.charge_start_datetime);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    map.set(key, (map.get(key) ?? 0) + (e.total_due ?? 0));
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, total]) => ({month, total}));
}

/* ─── CSV helpers (native-safe download / clipboard) ──────────────────── */

type ClipboardWriter = (value: string) => Promise<boolean>;
type CsvDownloader = (filename: string, csv: string) => void;

function escapeCell(value: CsvCellValue): string {
  if (value === null || value === undefined) return '';
  const str =
    typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : String(value);
  if (/[",\r\n]/.test(str) || str !== str.trim()) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCSV<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const header = columns.map(c => escapeCell(c.header ?? c.key)).join(',');
  const body = rows
    .map(row =>
      columns
        .map(c => {
          const v = c.accessor
            ? c.accessor(row)
            : ((row as unknown as Record<string, unknown>)[c.key] as CsvCellValue);
          return escapeCell(v);
        })
        .join(','),
    )
    .join('\r\n');
  return body.length > 0 ? `${header}\r\n${body}` : header;
}

function defaultExportFilename(prefix: string, date: Date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${prefix}-${yyyy}-${mm}-${dd}`;
}

// Feature-detects the browser clipboard (present under react-native-web, absent
// on bare native). Returns null when unavailable so callers surface an explicit
// unavailable state instead of failing silently.
function getClipboardWriter(): ClipboardWriter | null {
  const nav = (
    globalThis as {
      navigator?: {clipboard?: {writeText?: (value: string) => Promise<void>}};
    }
  ).navigator;
  const clipboard = nav?.clipboard;
  const writeText = clipboard?.writeText;
  if (typeof writeText !== 'function') return null;
  return async (value: string) => {
    try {
      await writeText.call(clipboard, value);
      return true;
    } catch {
      return false;
    }
  };
}

// Feature-detects the browser file-download path (Blob + object URL + anchor).
// Mirrors the web Blob + <a download> with a UTF-8 BOM. Returns null on bare
// native where document/Blob/URL are unavailable.
function getCsvDownloader(): CsvDownloader | null {
  const g = globalThis as {
    document?: {
      createElement?: (tag: string) => unknown;
      body?: {appendChild?: (n: unknown) => void; removeChild?: (n: unknown) => void};
    };
    URL?: {createObjectURL?: (b: unknown) => string; revokeObjectURL?: (u: string) => void};
    Blob?: new (parts: unknown[], opts?: {type?: string}) => unknown;
  };
  const doc = g.document;
  const url = g.URL;
  const BlobCtor = g.Blob;
  if (
    !doc ||
    typeof doc.createElement !== 'function' ||
    !doc.body ||
    typeof doc.body.appendChild !== 'function' ||
    typeof doc.body.removeChild !== 'function' ||
    !url ||
    typeof url.createObjectURL !== 'function' ||
    typeof BlobCtor !== 'function'
  ) {
    return null;
  }
  return (filename: string, csv: string) => {
    const name = filename.toLowerCase().endsWith('.csv') ? filename : `${filename}.csv`;
    const bom = '\ufeff';
    const blob = new BlobCtor([bom, csv], {type: 'text/csv;charset=utf-8;'});
    const objectUrl = url.createObjectURL!(blob);
    const link = doc.createElement!('a') as {
      href: string;
      download: string;
      style: {display: string};
      click: () => void;
    };
    link.href = objectUrl;
    link.download = name;
    link.style.display = 'none';
    doc.body!.appendChild!(link);
    link.click();
    doc.body!.removeChild!(link);
    setTimeout(() => url.revokeObjectURL?.(objectUrl), 0);
  };
}

// Routes a finished CSV string to download -> clipboard -> unavailable, the
// shared fallback ladder for both export paths on this page.
function deliverCsv(filename: string, csv: string): Promise<ExportStatus> {
  const download = getCsvDownloader();
  if (download) {
    download(filename, csv);
    return Promise.resolve('exported');
  }
  const writer = getClipboardWriter();
  if (writer) {
    return writer(csv).then(ok => (ok ? 'copied' : 'unavailable'));
  }
  return Promise.resolve('unavailable');
}

/* ─── useFilteredList (ported verbatim from @/hooks/useFilteredList) ───── */

type FilterField<T> = keyof T | ((item: T) => string | null | undefined);

function useFilteredList<T>(
  items: T[] | undefined | null,
  query: string,
  fields: ReadonlyArray<FilterField<T>>,
): T[] {
  return useMemo(() => {
    const list = items ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(item =>
      fields.some(f => {
        const v = typeof f === 'function' ? f(item) : item[f];
        return String(v ?? '').toLowerCase().includes(q);
      }),
    );
  }, [items, query, fields]);
}

/* ─── URL-state shims (web @/hooks/useUrlState) ───────────────────────── */

type StringSetter = (value: string | ((prev: string) => string)) => void;
type EnumSetter<E extends string> = (value: E | ((prev: E) => E)) => void;

// In-memory equivalent of the URL-synced string param. Value/updater contract
// preserved; there is no query string on bare native.
function useUrlString(_key: string, defaultValue = ''): [string, StringSetter] {
  const [value, setValue] = useState<string>(defaultValue);
  const set = useCallback<StringSetter>(next => {
    setValue(prev =>
      typeof next === 'function' ? (next as (p: string) => string)(prev) : next,
    );
  }, []);
  return [value, set];
}

// In-memory equivalent of the URL-synced enum param. Values not in `allowed`
// fall back to `defaultValue`, matching the web parse guard.
function useUrlEnum<E extends string>(
  _key: string,
  allowed: readonly E[],
  defaultValue: E,
): [E, EnumSetter<E>] {
  const [value, setValue] = useState<E>(defaultValue);
  const set = useCallback<EnumSetter<E>>(
    next => {
      setValue(prev => {
        const resolved =
          typeof next === 'function' ? (next as (p: E) => E)(prev) : next;
        return allowed.includes(resolved) ? resolved : defaultValue;
      });
    },
    [allowed, defaultValue],
  );
  return [value, set];
}

/* ─── useRangeState shim (web @/hooks/useRangeState) ──────────────────── */

interface RangeValue {
  start: string;
  end: string;
}

interface UseRangeStateOptions {
  defaultPresetId?: string;
  persistKey?: string;
  minDate?: string;
}

interface UseRangeStateReturn {
  start: string;
  end: string;
  presetId: string | undefined;
  setRange: (range: RangeValue) => void;
}

interface LocalStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

// Feature-detects Web Storage (present on react-native-web, absent on bare
// native). When unavailable the remembered range lives only in memory.
function getLocalStorage(): LocalStorageLike | null {
  const ls = (globalThis as {localStorage?: LocalStorageLike}).localStorage;
  if (ls && typeof ls.getItem === 'function' && typeof ls.setItem === 'function') {
    return ls;
  }
  return null;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(s: string | null | undefined): s is string {
  if (!s || !ISO_DATE_RE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00`);
  return !Number.isNaN(t);
}

function clampToMin(date: string, minDate: string | undefined): string {
  if (!minDate) return date;
  return date < minDate ? minDate : date;
}

function loadRangeFromStorage(persistKey: string | undefined): RangeValue | null {
  if (!persistKey) return null;
  const ls = getLocalStorage();
  if (!ls) return null;
  try {
    const raw = ls.getItem(persistKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RangeValue> | null;
    if (!parsed || !isValidIsoDate(parsed.start) || !isValidIsoDate(parsed.end)) {
      return null;
    }
    if (parsed.start > parsed.end) return null;
    return {start: parsed.start, end: parsed.end};
  } catch {
    return null;
  }
}

function saveRangeToStorage(persistKey: string | undefined, value: RangeValue) {
  if (!persistKey) return;
  const ls = getLocalStorage();
  if (!ls) return;
  try {
    ls.setItem(persistKey, JSON.stringify(value));
  } catch {
    /* storage full / disabled — silently ignore */
  }
}

// Native-safe equivalent of the web hook. Precedence on bare native is
// localStorage > defaultPresetId > today (the web URL layer has no native
// analogue). setRange clamps to minDate and persists, matching the web setter.
function useRangeState(opts: UseRangeStateOptions = {}): UseRangeStateReturn {
  const {defaultPresetId = '30d', persistKey, minDate} = opts;

  const fallback = useMemo<RangeValue>(() => {
    const preset = getDatePreset(defaultPresetId) ?? getDatePreset('30d');
    if (preset?.id === 'all') {
      const r = preset.resolve();
      return {start: resolveAllTimeStart(minDate), end: r.end};
    }
    return preset?.resolve() ?? DATE_PRESETS[3].resolve();
  }, [defaultPresetId, minDate]);

  const [range, setRangeState] = useState<RangeValue>(() => {
    const stored = loadRangeFromStorage(persistKey);
    if (!stored) return fallback;
    return {
      start: clampToMin(stored.start, minDate),
      end: clampToMin(stored.end, minDate),
    };
  });

  useEffect(() => {
    saveRangeToStorage(persistKey, range);
  }, [persistKey, range]);

  const setRange = useCallback(
    (next: RangeValue) => {
      setRangeState({
        start: clampToMin(next.start, minDate),
        end: clampToMin(next.end, minDate),
      });
    },
    [minDate],
  );

  const presetId = useMemo(
    () => matchPresetId(range.start, range.end),
    [range.start, range.end],
  );

  return {start: range.start, end: range.end, presetId, setRange};
}

/* ─── settings-derived formatters (useUnits/useFormatting/useSettings) ── */

interface ChargingFormatters {
  locale: string;
  userCurrency: string;
  formatEnergy: (wh: number | null | undefined, precision?: number) => string;
  formatCurrency: (amount: number, decimals?: number) => string;
  formatCurrencyEntry: (
    value: number | null | undefined,
    currency: string,
  ) => string;
}

function useChargingFormatters(): ChargingFormatters {
  const {data: settings} = useSettings();

  return useMemo(() => {
    const locale =
      settings?.locale && settings.locale.trim() ? settings.locale : 'en-US';
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
    const userCurrency = currencyCodeFromSymbol(settings?.currency_symbol);

    return {
      locale,
      userCurrency,
      formatEnergy: (wh, precision = 1) => formatEnergy(wh, locale, precision),
      formatCurrency: (amount, decimals) =>
        `${currencySymbol}${fmtNumber(amount, decimals ?? userPrecision)}`,
      formatCurrencyEntry: (value, currency) =>
        formatCurrencyValue(value, currency, locale, 2, {useGrouping: true}),
    };
  }, [settings?.locale, settings?.currency_symbol, settings?.decimal_precision]);
}

/* ─── motion (web @/components/motion FadeIn) ─────────────────────────── */

function FadeIn({children, delay = 0}: {children: ReactNode; delay?: number}) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.timing(opacity, {
      toValue: 1,
      duration: 220,
      delay: Math.round(delay * 1000),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [opacity, delay]);
  return <Animated.View style={{opacity}}>{children}</Animated.View>;
}

/* ─── Button (web @/components/ui Button) ─────────────────────────────── */

function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  icon,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  icon?: SemanticIconName;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{disabled: disabled || loading}}
      disabled={disabled || loading}
      hitSlop={4}
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        size === 'sm' ? styles.buttonSm : styles.buttonMd,
        buttonSurfaceStyles[variant],
        (disabled || loading) && styles.buttonDisabled,
        pressed && !(disabled || loading) && styles.pressed,
      ]}>
      {loading ? (
        <ActivityIndicator color={buttonTextStyles[variant].color} size="small" />
      ) : icon ? (
        <SemanticIcon decorative name={icon} size="sm" style={styles.buttonIcon} />
      ) : null}
      <AppText style={buttonTextStyles[variant]} variant="caption" weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

/* ─── Select (web @/components/ui Select) ─────────────────────────────── */

// Native-safe replacement for the web <select>: a label plus a horizontally
// scrollable row of option chips. Tapping a chip invokes onValueChange(value),
// preserving the web onChange(e => e.target.value) contract.
function Select({
  label,
  options,
  value,
  onValueChange,
}: {
  label: string;
  options: {value: string; label: string}[];
  value: string;
  onValueChange: (value: string) => void;
}) {
  return (
    <View accessibilityLabel={label} style={styles.field}>
      <ScrollView
        horizontal
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}>
        <View style={styles.selectRow}>
          {options.map(option => {
            const active = option.value === value;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{selected: active}}
                hitSlop={4}
                key={option.value === '' ? '__all__' : option.value}
                onPress={() => onValueChange(option.value)}
                style={({pressed}) => [
                  styles.selectChip,
                  active && styles.selectChipActive,
                  pressed && styles.pressed,
                ]}>
                <AppText
                  numberOfLines={1}
                  style={active ? styles.selectChipTextActive : styles.selectChipText}
                  variant="caption"
                  weight="semibold">
                  {option.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

/* ─── SearchInput (web @/components/forms SearchInput) ────────────────── */

// The web search-history dropdown (historyScope) has no native analogue and is
// dropped; the value/onChange/placeholder contract is preserved.
function SearchInput({
  value,
  onChangeText,
  placeholder,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
}) {
  return (
    <View style={styles.searchField}>
      <SemanticIcon decorative name="search" size="sm" style={styles.searchIcon} />
      <TextInput
        accessibilityLabel={placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        style={styles.searchInput}
        value={value}
      />
    </View>
  );
}

/* ─── ActiveFilterChips (web @/components/forms ActiveFilterChips) ────── */

function ActiveFilterChips({
  filters,
  onClearAll,
}: {
  filters: readonly FilterChipDescriptor[];
  onClearAll: () => void;
}) {
  const t = useNativeTranslation();
  if (filters.length === 0) return null;
  return (
    <View style={styles.chipsRow}>
      {filters.map(f => (
        <Pressable
          accessibilityLabel={`${f.label}: ${f.value}`}
          accessibilityRole="button"
          hitSlop={4}
          key={f.key}
          onPress={f.onRemove}
          style={({pressed}) => [styles.filterChip, pressed && styles.pressed]}>
          <AppText style={styles.filterChipText} variant="caption" weight="semibold">
            {f.label}: {f.value}
          </AppText>
          <SemanticIcon decorative name="close" size="sm" style={styles.filterChipIcon} />
        </Pressable>
      ))}
      <Pressable
        accessibilityLabel={t('filters.clearAll', 'Clear all')}
        accessibilityRole="button"
        hitSlop={4}
        onPress={onClearAll}
        style={({pressed}) => [styles.clearAll, pressed && styles.pressed]}>
        <AppText style={styles.clearAllText} variant="caption" weight="semibold">
          {t('filters.clearAll', 'Clear all')}
        </AppText>
      </Pressable>
    </View>
  );
}

/* ─── EmptyState (web @/components/feedback EmptyState) ────────────────── */

function EmptyState({icon, message}: {icon: SemanticIconName; message: string}) {
  return (
    <View accessibilityRole="summary" style={styles.emptyState}>
      <SemanticIcon decorative name={icon} size="lg" style={styles.emptyIcon} />
      <AppText style={styles.emptyMessage} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

/* ─── MonthlySpendingChart (web @/components/charts BarChart) ──────────── */

// Recharts BarChart (one bar per month over a shared linear axis) -> native
// horizontal bars scaled to the series max, each labelled with the month and
// the formatted currency total so no value is lost on a small screen.
function MonthlySpendingChart({
  data,
  formatValue,
}: {
  data: {month: string; total: number}[];
  formatValue: (n: number) => string;
}) {
  const max = Math.max(...data.map(d => d.total), 1);
  return (
    <View accessibilityRole="image" style={styles.chart}>
      {data.map(d => {
        const width = Math.max((d.total / max) * 100, d.total > 0 ? 4 : 0);
        return (
          <View key={d.month} style={styles.chartGroup}>
            <View style={styles.chartLabelRow}>
              <AppText variant="caption" weight="semibold">
                {d.month}
              </AppText>
              <AppText tone="secondary" variant="caption">
                {formatValue(d.total)}
              </AppText>
            </View>
            <View style={styles.chartTrack}>
              <View
                style={[
                  styles.chartFill,
                  {width: `${width}%` as DimensionValue, backgroundColor: SPEND_BAR_COLOR},
                ]}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
}

/* ─── DataTable (web @/components/ui DataTable, used subset) ───────────── */

function cellAlign(align: Column<unknown>['align']): ViewStyle {
  if (align === 'right') return styles.cellRight;
  if (align === 'center') return styles.cellCenter;
  return styles.cellLeft;
}

function DataTable<T>({
  columns,
  data,
  keyExtractor,
  sortKey,
  sortDir,
  onSort,
  pagination,
  exportable = false,
  exportFilename,
  exportRow,
  selectable,
  selectedKeys = [],
  onSelectionChange,
  bulkActions,
}: {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T) => RowKey;
  sortKey?: string;
  sortDir?: SortDir;
  onSort?: (key: string) => void;
  pagination?: {defaultPageSize: number; pageSizeOptions: number[]};
  exportable?: boolean;
  exportFilename?: string;
  exportRow?: (row: T) => Record<string, CsvCellValue>;
  selectable?: 'multi';
  selectedKeys?: RowKey[];
  onSelectionChange?: (keys: RowKey[]) => void;
  bulkActions?: (rows: T[]) => ReactNode;
}) {
  const t = useNativeTranslation();
  const [exportStatus, setExportStatus] = useState<ExportStatus>('idle');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(
    pagination?.defaultPageSize ?? (data.length || 1),
  );
  const resetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetRef.current) clearTimeout(resetRef.current);
    };
  }, []);

  const scheduleReset = useCallback(() => {
    if (resetRef.current) clearTimeout(resetRef.current);
    resetRef.current = setTimeout(() => setExportStatus('idle'), 2000);
  }, []);

  const selectable_ = selectable === 'multi';
  const selectColWidth = selectable_ ? CHECKBOX_COL_WIDTH : 0;
  const totalWidth =
    selectColWidth +
    columns.reduce((sum, col) => sum + (col.width ?? DEFAULT_COL_WIDTH), 0);

  const pageCount = pagination ? Math.max(1, Math.ceil(data.length / pageSize)) : 1;
  const clampedPage = Math.min(page, pageCount - 1);
  const pageRows = pagination
    ? data.slice(clampedPage * pageSize, clampedPage * pageSize + pageSize)
    : data;

  const selectedSet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const allSelected = data.length > 0 && selectedKeys.length === data.length;

  const toggleRow = useCallback(
    (key: RowKey) => {
      if (!onSelectionChange) return;
      onSelectionChange(
        selectedSet.has(key)
          ? selectedKeys.filter(k => k !== key)
          : [...selectedKeys, key],
      );
    },
    [onSelectionChange, selectedKeys, selectedSet],
  );

  const toggleAll = useCallback(() => {
    if (!onSelectionChange) return;
    onSelectionChange(allSelected ? [] : data.map(keyExtractor));
  }, [allSelected, data, keyExtractor, onSelectionChange]);

  const handleExport = useCallback(() => {
    if (data.length === 0) return;
    const filenameBase = exportFilename ?? defaultExportFilename('table');
    const csvCols: CsvColumn<T>[] = columns.map(col => ({
      key: col.key,
      header: col.header || col.key,
      accessor: exportRow
        ? (row: T) => {
            const obj = exportRow(row);
            const v = obj[col.key];
            return v === undefined ? null : v;
          }
        : (row: T) => {
            const v = (row as unknown as Record<string, unknown>)[col.key];
            return (v == null ? null : v) as CsvCellValue;
          },
    }));
    const csv = toCSV(data, csvCols);
    void deliverCsv(filenameBase, csv).then(status => {
      setExportStatus(status);
      scheduleReset();
    });
  }, [columns, data, exportFilename, exportRow, scheduleReset]);

  const exportLabel =
    exportStatus === 'exported'
      ? t('table.export.done', 'Exported')
      : exportStatus === 'copied'
        ? t('table.export.copied', 'Copied CSV')
        : exportStatus === 'unavailable'
          ? t('table.export.unavailable', 'Unavailable')
          : t('table.export.csv', 'Export CSV');

  const selectedRows = useMemo(
    () => data.filter(r => selectedSet.has(keyExtractor(r))),
    [data, keyExtractor, selectedSet],
  );

  const rangeStart = data.length === 0 ? 0 : clampedPage * pageSize + 1;
  const rangeEnd = pagination
    ? Math.min(clampedPage * pageSize + pageSize, data.length)
    : data.length;

  return (
    <View style={styles.table}>
      {(exportable || (selectable_ && selectedKeys.length > 0)) && (
        <View style={styles.tableToolbar}>
          {selectable_ && selectedKeys.length > 0 ? (
            <View style={styles.bulkBar}>
              <AppText tone="secondary" variant="caption" weight="semibold">
                {t('table.selected', 'Selected')}: {selectedKeys.length}
              </AppText>
              {bulkActions ? bulkActions(selectedRows) : null}
            </View>
          ) : (
            <View />
          )}
          {exportable ? (
            <Button
              disabled={data.length === 0}
              icon="download"
              label={exportLabel}
              onPress={handleExport}
              size="sm"
              variant="ghost"
            />
          ) : null}
        </View>
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View style={{width: totalWidth}}>
          <View style={styles.tableHeaderRow}>
            {selectable_ ? (
              <Pressable
                accessibilityLabel={t('table.selectAll', 'Select all')}
                accessibilityRole="checkbox"
                accessibilityState={{checked: allSelected}}
                hitSlop={4}
                onPress={toggleAll}
                style={styles.checkboxCell}>
                <View style={[styles.checkbox, allSelected && styles.checkboxOn]}>
                  {allSelected ? (
                    <SemanticIcon decorative name="confirm" size="sm" />
                  ) : null}
                </View>
              </Pressable>
            ) : null}
            {columns.map(col => {
              const active = sortKey === col.key;
              const head = (
                <View style={styles.headerInner}>
                  <AppText tone="muted" variant="caption" weight="semibold">
                    {col.header}
                  </AppText>
                  {col.sortable && active ? (
                    <SemanticIcon
                      decorative
                      name={sortDir === 'asc' ? 'arrowUp' : 'arrowDown'}
                      size="sm"
                      style={styles.sortIcon}
                    />
                  ) : null}
                </View>
              );
              return col.sortable && onSort ? (
                <Pressable
                  accessibilityRole="button"
                  hitSlop={2}
                  key={col.key}
                  onPress={() => onSort(col.key)}
                  style={({pressed}) => [
                    styles.headerCell,
                    {width: col.width ?? DEFAULT_COL_WIDTH},
                    cellAlign(col.align),
                    pressed && styles.pressed,
                  ]}>
                  {head}
                </Pressable>
              ) : (
                <View
                  key={col.key}
                  style={[
                    styles.headerCell,
                    {width: col.width ?? DEFAULT_COL_WIDTH},
                    cellAlign(col.align),
                  ]}>
                  {head}
                </View>
              );
            })}
          </View>

          {pageRows.length === 0 ? (
            <View style={styles.tableEmptyRow}>
              <AppText tone="muted" variant="caption">
                {t('common.noEntries', 'No entries')}
              </AppText>
            </View>
          ) : (
            pageRows.map(row => {
              const key = keyExtractor(row);
              const checked = selectedSet.has(key);
              return (
                <View key={String(key)} style={styles.tableBodyRow}>
                  {selectable_ ? (
                    <Pressable
                      accessibilityLabel={t('table.selectRow', 'Select row')}
                      accessibilityRole="checkbox"
                      accessibilityState={{checked}}
                      hitSlop={4}
                      onPress={() => toggleRow(key)}
                      style={styles.checkboxCell}>
                      <View style={[styles.checkbox, checked && styles.checkboxOn]}>
                        {checked ? (
                          <SemanticIcon decorative name="confirm" size="sm" />
                        ) : null}
                      </View>
                    </Pressable>
                  ) : null}
                  {columns.map(col => (
                    <View
                      key={col.key}
                      style={[
                        styles.bodyCell,
                        {width: col.width ?? DEFAULT_COL_WIDTH},
                        cellAlign(col.align),
                      ]}>
                      {col.render(row)}
                    </View>
                  ))}
                </View>
              );
            })
          )}
        </View>
      </ScrollView>

      {pagination ? (
        <View style={styles.paginationRow}>
          <AppText tone="muted" variant="caption">
            {rangeStart}–{rangeEnd} {t('table.of', 'of')} {data.length}
          </AppText>
          <View style={styles.pageSizeRow}>
            {pagination.pageSizeOptions.map(size => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{selected: size === pageSize}}
                hitSlop={4}
                key={size}
                onPress={() => {
                  setPageSize(size);
                  setPage(0);
                }}
                style={({pressed}) => [
                  styles.pageSizeChip,
                  size === pageSize && styles.pageSizeChipActive,
                  pressed && styles.pressed,
                ]}>
                <AppText
                  style={size === pageSize ? styles.selectChipTextActive : styles.selectChipText}
                  variant="caption"
                  weight="semibold">
                  {size}
                </AppText>
              </Pressable>
            ))}
          </View>
          <View style={styles.pageNavRow}>
            <Pressable
              accessibilityLabel={t('table.prev', 'Previous')}
              accessibilityRole="button"
              accessibilityState={{disabled: clampedPage <= 0}}
              disabled={clampedPage <= 0}
              hitSlop={4}
              onPress={() => setPage(p => Math.max(0, p - 1))}
              style={({pressed}) => [
                styles.pageNavBtn,
                clampedPage <= 0 && styles.buttonDisabled,
                pressed && clampedPage > 0 && styles.pressed,
              ]}>
              <SemanticIcon decorative name="previous" size="sm" />
            </Pressable>
            <AppText tone="secondary" variant="caption">
              {clampedPage + 1}/{pageCount}
            </AppText>
            <Pressable
              accessibilityLabel={t('table.next', 'Next')}
              accessibilityRole="button"
              accessibilityState={{disabled: clampedPage >= pageCount - 1}}
              disabled={clampedPage >= pageCount - 1}
              hitSlop={4}
              onPress={() => setPage(p => Math.min(pageCount - 1, p + 1))}
              style={({pressed}) => [
                styles.pageNavBtn,
                clampedPage >= pageCount - 1 && styles.buttonDisabled,
                pressed && clampedPage < pageCount - 1 && styles.pressed,
              ]}>
              <SemanticIcon decorative name="next" size="sm" />
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

/* ─── CopyLinkButton (web PageContainer copyLink) ─────────────────────── */

// Web copies the current deep link (window.location.href). Feature-detected:
// copies the URL on react-native-web; surfaces "Unavailable" on bare native
// where there is no browser URL.
function CopyLinkButton() {
  const t = useNativeTranslation();
  const [status, setStatus] = useState<'idle' | 'copied' | 'unavailable'>('idle');
  const resetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetRef.current) clearTimeout(resetRef.current);
    };
  }, []);

  const onPress = useCallback(() => {
    const href = (globalThis as {location?: {href?: string}}).location?.href;
    const writer = getClipboardWriter();
    if (!href || !writer) {
      setStatus('unavailable');
    } else {
      void writer(href).then(ok => setStatus(ok ? 'copied' : 'unavailable'));
    }
    if (resetRef.current) clearTimeout(resetRef.current);
    resetRef.current = setTimeout(() => setStatus('idle'), 2000);
  }, []);

  const label =
    status === 'copied'
      ? t('common.linkCopied', 'Link copied')
      : status === 'unavailable'
        ? t('common.copyUnavailable', 'Unavailable')
        : t('common.copyLink', 'Copy link');

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={6}
      onPress={onPress}
      style={({pressed}) => [styles.copyLinkBtn, pressed && styles.pressed]}>
      <SemanticIcon
        decorative
        name={status === 'copied' ? 'confirm' : status === 'unavailable' ? 'error' : 'link'}
        size="sm"
        style={styles.copyLinkIcon}
      />
      <AppText style={styles.copyLinkLabel} tone="accent" variant="caption" weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

/* ─── PageContainer (web @/components/layout PageContainer) ────────────── */

function PageContainer({
  title,
  subtitle,
  loading,
  error,
  copyLink,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  loading?: boolean;
  error?: Error | null;
  copyLink?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.pageContent}
      keyboardShouldPersistTaps="handled"
      style={styles.page}>
      <View style={styles.pageHeader}>
        <View style={styles.pageHeaderTop}>
          <View style={styles.pageHeaderText}>
            <AppText style={styles.pageTitle} variant="title" weight="bold">
              {title}
            </AppText>
            {subtitle ? (
              <AppText style={styles.pageSubtitle} tone="muted" variant="caption">
                {subtitle}
              </AppText>
            ) : null}
          </View>
          {copyLink ? <CopyLinkButton /> : null}
        </View>
        {actions ? <View style={styles.pageActions}>{actions}</View> : null}
      </View>

      {error ? (
        <View style={styles.errorBox}>
          <AppText style={styles.errorText} variant="caption" weight="semibold">
            {error.message}
          </AppText>
        </View>
      ) : loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : (
        children
      )}
    </ScrollView>
  );
}

/* ─── page ────────────────────────────────────────────────────────────── */

const SORT_KEYS = ['date', 'energy', 'cost'] as const;
const SORT_DIRS = ['asc', 'desc'] as const;
const ENTRY_SEARCH_FIELDS = ['site_location_name'] as const satisfies ReadonlyArray<
  keyof TeslaChargingHistoryEntry
>;

export default function TeslaChargingHistoryPage() {
  const t = useNativeTranslation();
  const {formatEnergy: fmtEnergy, formatCurrency, formatCurrencyEntry, userCurrency} =
    useChargingFormatters();
  usePageTitle(t('tesla_charging.title', 'Tesla Charging History'));

  const {data: vehicles} = useVehicles();
  // VIN filter, sort, and search persist in the URL on web; in-memory on native.
  const [selectedVin, setSelectedVin] = useUrlString('vin', '');
  const {data: response, isLoading, error} = useTeslaChargingHistory(
    selectedVin || undefined,
  );
  const refreshMutation = useRefreshTeslaChargingHistory();

  const allEntries = useMemo(() => response?.entries ?? [], [response]);
  // Range filter (client-side) on charge_start_datetime.
  const {start, end, presetId, setRange} = useRangeState({
    persistKey: 'tesla-charging-history.range',
    defaultPresetId: 'all',
  });
  const entries = useMemo(() => {
    if (!allEntries.length) return allEntries;
    const startMs = new Date(`${start}T00:00:00`).getTime();
    const endMs = new Date(`${end}T23:59:59.999`).getTime();
    return allEntries.filter(e => {
      if (!e.charge_start_datetime) return false;
      const ts = new Date(e.charge_start_datetime).getTime();
      return ts >= startMs && ts <= endMs;
    });
  }, [allEntries, start, end]);
  const summary = response?.summary ?? {
    total_sessions: 0,
    total_wh: null,
    total_spend: null,
    avg_cost_per_kwh: null,
  };

  const vehicleOptions = useMemo(() => {
    const opts = [{value: '', label: t('tesla_charging.allVehicles', 'All Vehicles')}];
    for (const v of vehicles ?? []) {
      opts.push({value: v.vin, label: `${v.display_name} (${v.vin.slice(-6)})`});
    }
    return opts;
  }, [vehicles, t]);

  const monthlyData = useMemo(() => buildMonthlySpending(entries), [entries]);

  const handleRefresh = () => {
    refreshMutation.mutate(selectedVin ? {vin: selectedVin} : undefined);
  };

  const columns: Column<TeslaChargingHistoryEntry>[] = useMemo(
    () => [
      {
        key: 'date',
        header: t('tesla_charging.col.date', 'Date'),
        render: row => (
          <AppText style={styles.cellPrimary} variant="caption">
            {formatDateTime(row.charge_start_datetime)}
          </AppText>
        ),
        sortable: true,
        visibleOnMobile: true,
        width: 170,
      },
      {
        key: 'location',
        header: t('tesla_charging.col.location', 'Location'),
        render: row => (
          <View style={styles.locationCell}>
            <SemanticIcon decorative name="location" size="sm" style={styles.locationIcon} />
            <AppText numberOfLines={1} style={styles.cellPrimary} variant="caption">
              {row.site_location_name || '—'}
            </AppText>
          </View>
        ),
        visibleOnMobile: true,
        width: 200,
      },
      {
        key: 'duration',
        header: t('tesla_charging.col.duration', 'Duration'),
        render: row => (
          <AppText style={styles.cellPrimary} variant="caption">
            {formatDurationMinutes(
              durationMinutes(row.charge_start_datetime, row.charge_stop_datetime),
            )}
          </AppText>
        ),
        width: 110,
      },
      {
        key: 'energy',
        header: t('tesla_charging.col.energy', 'Energy'),
        render: row => (
          <AppText style={styles.cellEnergy} variant="caption" weight="semibold">
            {row.usage_wh != null ? fmtEnergy(row.usage_wh, 1) : '—'}
          </AppText>
        ),
        sortable: true,
        visibleOnMobile: true,
        align: 'right',
        width: 120,
      },
      {
        key: 'cost',
        header: t('tesla_charging.col.cost_decimal', 'Cost'),
        render: row => (
          <AppText style={styles.cellCost} variant="caption" weight="semibold">
            {row.total_due != null
              ? formatCurrencyEntry(row.total_due, row.currency_code ?? userCurrency)
              : '—'}
          </AppText>
        ),
        sortable: true,
        visibleOnMobile: true,
        align: 'right',
        width: 120,
      },
      {
        key: 'rate',
        header: t('tesla_charging.col.rate', 'Rate'),
        render: row => (
          <AppText style={styles.cellSecondary} variant="caption">
            {row.rate_base != null
              ? `${fmtNumber(row.rate_base, 3)}/${row.pricing_type ?? 'kWh'}`
              : '—'}
          </AppText>
        ),
        defaultVisible: false,
        width: 130,
      },
      {
        key: 'invoice',
        header: t('tesla_charging.col.invoice', 'Invoice'),
        render: row =>
          row.has_invoice && row.invoice_content_id ? (
            <Pressable
              accessibilityLabel={t('tesla_charging.downloadInvoice', 'Download invoice')}
              accessibilityRole="link"
              hitSlop={4}
              onPress={() =>
                Linking.openURL(getTeslaChargingInvoiceURL(row.invoice_content_id as string))
              }
              style={({pressed}) => [styles.invoiceLink, pressed && styles.pressed]}>
              <SemanticIcon decorative name="download" size="sm" style={styles.invoiceIcon} />
              <AppText style={styles.invoiceText} variant="caption" weight="semibold">
                {t('charging.invoice', 'Invoice')}
              </AppText>
            </Pressable>
          ) : (
            <AppText tone="muted" variant="caption">
              —
            </AppText>
          ),
        width: 120,
      },
    ],
    [t, fmtEnergy, formatCurrencyEntry, userCurrency],
  );

  const [sortKey, setSortKey] = useUrlEnum<'date' | 'energy' | 'cost'>(
    'sort',
    SORT_KEYS,
    'date',
  );
  const [sortDir, setSortDir] = useUrlEnum<'asc' | 'desc'>('dir', SORT_DIRS, 'desc');
  const [search, setSearch] = useUrlString('q', '');
  const [selectedKeys, setSelectedKeys] = useState<RowKey[]>([]);

  const filteredEntries = useFilteredList(entries, search, ENTRY_SEARCH_FIELDS);

  const sortedEntries = useMemo(() => {
    const sorted = [...filteredEntries];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'date':
          cmp = a.charge_start_datetime.localeCompare(b.charge_start_datetime);
          break;
        case 'energy':
          cmp = (a.usage_wh ?? 0) - (b.usage_wh ?? 0);
          break;
        case 'cost':
          cmp = (a.total_due ?? 0) - (b.total_due ?? 0);
          break;
        default:
          cmp = a.charge_start_datetime.localeCompare(b.charge_start_datetime);
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return sorted;
  }, [filteredEntries, sortKey, sortDir]);

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      // Cast safely — DataTable column keys map 1:1 to our allowed sort keys.
      setSortKey(key as 'date' | 'energy' | 'cost');
      setSortDir('desc');
    }
  };

  const [bulkNotice, setBulkNotice] = useState<string | null>(null);
  const bulkResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (bulkResetRef.current) clearTimeout(bulkResetRef.current);
    };
  }, []);

  // CSV export of selected charging sessions. We pick the same fields the
  // DataTable shows so users get a self-explanatory file. The web Blob +
  // <a download> path is feature-detected; bare native falls back to clipboard
  // and then to an explicit unavailable notice.
  const exportSelectedCsv = useCallback(
    (rows: TeslaChargingHistoryEntry[]) => {
      if (rows.length === 0) return;
      const header = [
        'date',
        'location',
        'duration_minutes',
        'energy_wh',
        'cost',
        'currency',
        'rate_base',
        'pricing_type',
        'invoice_id',
      ];
      const csvLines = [header.join(',')];
      for (const r of rows) {
        const dur = durationMinutes(r.charge_start_datetime, r.charge_stop_datetime);
        const fields = [
          r.charge_start_datetime,
          (r.site_location_name ?? '').replace(/[",\n]/g, ' '),
          dur != null ? String(dur) : '',
          r.usage_wh != null ? String(r.usage_wh) : '',
          r.total_due != null ? String(r.total_due) : '',
          r.currency_code ?? '',
          r.rate_base != null ? String(r.rate_base) : '',
          r.pricing_type ?? '',
          r.invoice_content_id ?? '',
        ];
        csvLines.push(fields.map(f => `"${String(f).replace(/"/g, '""')}"`).join(','));
      }
      const csv = csvLines.join('\n');
      const filename = `tesla-charging-${new Date().toISOString().slice(0, 10)}`;
      void deliverCsv(filename, csv).then(status => {
        setBulkNotice(
          status === 'exported'
            ? t('table.export.done', 'Exported')
            : status === 'copied'
              ? t('table.export.copied', 'Copied CSV')
              : t('table.export.unavailable', 'Unavailable'),
        );
        if (bulkResetRef.current) clearTimeout(bulkResetRef.current);
        bulkResetRef.current = setTimeout(() => setBulkNotice(null), 2000);
      });
    },
    [t],
  );

  const lastSyncEntry = entries[0];

  return (
    <PageContainer
      title={t('tesla_charging.title', 'Tesla Charging History')}
      subtitle={t(
        'tesla_charging.subtitle',
        'Supercharger & DC fast charging billing records from Tesla',
      )}
      loading={isLoading}
      error={error as Error | null}
      copyLink
      actions={
        <View style={styles.actionsCol}>
          <Select
            label={t('tesla_charging.selectVehicle', 'Select vehicle')}
            options={vehicleOptions}
            value={selectedVin}
            onValueChange={setSelectedVin}
          />
          <DatePresetChips
            activeId={presetId}
            ariaLabel={t('tesla_charging.range', 'Date range')}
            onSelect={(sel: DatePresetSelection) =>
              setRange({start: sel.start, end: sel.end})
            }
            presetIds={DEFAULT_PRESET_IDS}
            testID="tesla-charging-history-range"
          />
          <Button
            disabled={refreshMutation.isPending}
            icon="refresh"
            label={
              refreshMutation.isPending
                ? t('tesla_charging.refreshing', 'Syncing...')
                : t('tesla_charging.refresh', 'Refresh from Tesla')
            }
            loading={refreshMutation.isPending}
            onPress={handleRefresh}
            variant="primary"
          />
        </View>
      }>
      {/* Last-sync line — shows when data is present so users know freshness */}
      {response && entries.length > 0 && lastSyncEntry?.fetched_at ? (
        <FadeIn>
          <AppText style={styles.lastSync} tone="muted" variant="caption">
            {t('tesla_charging.lastSync', 'Last synced')}: {formatDateTime(lastSyncEntry.fetched_at)}
          </AppText>
        </FadeIn>
      ) : null}

      {/* Summary stats */}
      <FadeIn delay={0.05}>
        <View style={styles.statGrid}>
          <View style={styles.statCell}>
            <StatCard
              icon={<SemanticIcon decorative name="bolt" size="sm" />}
              label={t('tesla_charging.stats.sessions', 'Total Sessions')}
              loading={isLoading}
              value={fmtInt(summary.total_sessions)}
            />
          </View>
          <View style={styles.statCell}>
            <StatCard
              icon={<SemanticIcon decorative name="speed" size="sm" />}
              label={t('tesla_charging.stats.energy', 'Total Energy')}
              loading={isLoading}
              value={summary.total_wh != null ? fmtEnergy(summary.total_wh, 1) : '—'}
            />
          </View>
          <View style={styles.statCell}>
            <StatCard
              icon={<SemanticIcon decorative name="dollarSign" size="sm" />}
              label={t('tesla_charging.stats.spend', 'Total Spend')}
              loading={isLoading}
              value={summary.total_spend != null ? formatCurrency(summary.total_spend, 2) : '—'}
            />
          </View>
          <View style={styles.statCell}>
            <StatCard
              icon={<SemanticIcon decorative name="trendUp" size="sm" />}
              label={t('tesla_charging.stats.avgCost', 'Avg Cost/kWh')}
              loading={isLoading}
              value={
                summary.avg_cost_per_kwh != null
                  ? formatCurrency(summary.avg_cost_per_kwh, 3)
                  : '—'
              }
            />
          </View>
        </View>
      </FadeIn>

      {/* Monthly spending chart */}
      <FadeIn delay={0.1}>
        <GlassPanel
          accessibilityLabel={t(
            'tesla_charging.monthlySpending.aria',
            'Monthly Tesla charging spending bar chart',
          )}
          style={styles.panel}>
          <AppText style={styles.panelTitle} weight="bold">
            {t('tesla_charging.monthlySpending', 'Monthly Spending')}
          </AppText>
          {monthlyData.length > 0 ? (
            <MonthlySpendingChart
              data={monthlyData}
              formatValue={n => formatCurrency(n, 0)}
            />
          ) : (
            <EmptyState
              icon="receipt"
              message={t(
                'tesla_charging.noChartData',
                'No spending data yet. Click "Refresh from Tesla" to sync.',
              )}
            />
          )}
        </GlassPanel>
      </FadeIn>

      {/* Data table */}
      <FadeIn delay={0.15}>
        <GlassPanel style={styles.panel}>
          <AppText style={styles.panelTitle} weight="bold">
            {t('tesla_charging.sessions', 'Charging Sessions')}
          </AppText>
          {entries.length > 0 ? (
            <>
              <View style={styles.filterBar}>
                <SearchInput
                  onChangeText={setSearch}
                  placeholder={t('tesla_charging.searchPlaceholder', 'Search by location…')}
                  value={search}
                />
              </View>
              <ActiveFilterChips
                filters={
                  search
                    ? [
                        {
                          key: 'q',
                          label: t('tesla_charging.filterLabel.search', 'Search'),
                          value: search,
                          onRemove: () => setSearch(''),
                        },
                      ]
                    : []
                }
                onClearAll={() => setSearch('')}
              />
              {bulkNotice ? (
                <AppText style={styles.bulkNotice} tone="accent" variant="caption" weight="semibold">
                  {bulkNotice}
                </AppText>
              ) : null}
              {sortedEntries.length > 0 ? (
                <DataTable
                  bulkActions={rows => (
                    <Button
                      icon="download"
                      label={t('table.bulkActions.exportCsv', 'Export CSV')}
                      onPress={() => exportSelectedCsv(rows)}
                      size="sm"
                      variant="primary"
                    />
                  )}
                  columns={columns}
                  data={sortedEntries}
                  exportable
                  exportFilename={`tesla-charging-history-${new Date()
                    .toISOString()
                    .slice(0, 10)}`}
                  exportRow={row => ({
                    date: row.charge_start_datetime,
                    location: row.site_location_name ?? '',
                    duration:
                      durationMinutes(row.charge_start_datetime, row.charge_stop_datetime) ??
                      null,
                    energy: row.usage_wh ?? null,
                    cost: row.total_due ?? null,
                    currency: row.currency_code ?? '',
                    rate: row.rate_base ?? null,
                    pricing_type: row.pricing_type ?? '',
                    invoice: row.invoice_content_id ?? '',
                  })}
                  keyExtractor={row => row.session_id}
                  onSelectionChange={setSelectedKeys}
                  onSort={handleSort}
                  pagination={{defaultPageSize: 25, pageSizeOptions: [25, 50, 100]}}
                  selectable="multi"
                  selectedKeys={selectedKeys}
                  sortDir={sortDir}
                  sortKey={sortKey}
                />
              ) : (
                <EmptyState
                  icon="bolt"
                  message={t('tesla_charging.noMatches', 'No sessions match your search.')}
                />
              )}
            </>
          ) : (
            <EmptyState
              icon="bolt"
              message={t(
                'tesla_charging.noData',
                'No Tesla charging history yet. Click "Refresh from Tesla" to import your Supercharger sessions.',
              )}
            />
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}

/* ─── styles ──────────────────────────────────────────────────────────── */

const buttonSurfaceStyles = StyleSheet.create<Record<ButtonVariant, ViewStyle>>({
  primary: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  secondary: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
  ghost: {
    backgroundColor: 'transparent',
    borderColor: colors.border,
  },
});

const buttonTextStyles = StyleSheet.create<Record<ButtonVariant, TextStyle>>({
  primary: {color: colors.accent},
  secondary: {color: colors.textPrimary},
  ghost: {color: colors.textSecondary},
});

const styles = StyleSheet.create({
  page: {
    backgroundColor: colors.background,
    flex: 1,
  },
  pageContent: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  pageHeader: {
    gap: spacing.md,
  },
  pageHeaderTop: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  pageHeaderText: {
    flex: 1,
    gap: 2,
  },
  pageTitle: {
    color: colors.textPrimary,
  },
  pageSubtitle: {
    marginTop: 2,
  },
  pageActions: {
    gap: spacing.sm,
  },
  actionsCol: {
    gap: spacing.sm,
  },
  copyLinkBtn: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  copyLinkIcon: {
    marginRight: 2,
  },
  copyLinkLabel: {
    color: colors.accent,
  },
  loadingBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
  errorBox: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 16,
    borderWidth: 1,
    padding: spacing.md,
  },
  errorText: {
    color: colors.danger,
  },
  lastSync: {
    marginTop: -spacing.xs,
  },
  field: {
    gap: 4,
  },
  selectRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  selectChip: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: 220,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  selectChipActive: {
    backgroundColor: colors.surfaceSelected,
    borderColor: colors.borderAccent,
  },
  selectChipText: {
    color: colors.textSecondary,
  },
  selectChipTextActive: {
    color: colors.accent,
  },
  button: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
  },
  buttonSm: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  buttonMd: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonIcon: {
    marginRight: 2,
  },
  pressed: {
    opacity: 0.7,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  statCell: {
    flexBasis: '46%',
    flexGrow: 1,
    minWidth: 150,
  },
  panel: {
    gap: spacing.md,
    padding: spacing.md,
  },
  panelTitle: {
    color: colors.textPrimary,
    fontSize: 17,
    lineHeight: 24,
  },
  chart: {
    gap: spacing.md,
  },
  chartGroup: {
    gap: spacing.xs,
  },
  chartLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  chartTrack: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 999,
    height: 12,
    overflow: 'hidden',
  },
  chartFill: {
    borderRadius: 999,
    height: '100%',
  },
  emptyState: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  emptyIcon: {
    marginBottom: spacing.xs,
  },
  emptyMessage: {
    textAlign: 'center',
  },
  filterBar: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  searchField: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: spacing.md,
  },
  searchIcon: {
    marginRight: 2,
  },
  searchInput: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14,
    paddingVertical: spacing.sm,
  },
  chipsRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  filterChip: {
    alignItems: 'center',
    backgroundColor: colors.surfaceSelected,
    borderColor: colors.borderAccent,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  filterChipText: {
    color: colors.accent,
  },
  filterChipIcon: {
    marginLeft: 2,
  },
  clearAll: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  clearAllText: {
    color: colors.textSecondary,
  },
  bulkNotice: {
    color: colors.accent,
  },
  table: {
    gap: spacing.sm,
  },
  tableToolbar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  bulkBar: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  tableHeaderRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    paddingBottom: spacing.sm,
  },
  headerCell: {
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  headerInner: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  sortIcon: {
    marginLeft: 2,
  },
  tableEmptyRow: {
    paddingVertical: spacing.lg,
  },
  tableBodyRow: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    minHeight: 48,
    paddingVertical: spacing.sm,
  },
  bodyCell: {
    paddingHorizontal: spacing.xs,
  },
  checkboxCell: {
    alignItems: 'center',
    justifyContent: 'center',
    width: CHECKBOX_COL_WIDTH,
  },
  checkbox: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    height: 20,
    justifyContent: 'center',
    width: 20,
  },
  checkboxOn: {
    backgroundColor: colors.surfaceSelected,
    borderColor: colors.borderAccent,
  },
  cellPrimary: {
    color: colors.textPrimary,
  },
  cellSecondary: {
    color: colors.textSecondary,
  },
  cellEnergy: {
    color: colors.accent,
  },
  cellCost: {
    color: colors.success,
  },
  cellLeft: {
    alignItems: 'flex-start',
  },
  cellRight: {
    alignItems: 'flex-end',
  },
  cellCenter: {
    alignItems: 'center',
  },
  locationCell: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  locationIcon: {
    marginRight: 2,
  },
  invoiceLink: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  invoiceIcon: {
    marginRight: 2,
  },
  invoiceText: {
    color: colors.accent,
  },
  paginationRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'space-between',
    paddingTop: spacing.xs,
  },
  pageSizeRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  pageSizeChip: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  pageSizeChipActive: {
    backgroundColor: colors.surfaceSelected,
    borderColor: colors.borderAccent,
  },
  pageNavRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  pageNavBtn: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
});
