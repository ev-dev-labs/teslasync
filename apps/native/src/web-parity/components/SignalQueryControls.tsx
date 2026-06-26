/**
 * Shared components for Signal Log Viewer and Signal Explorer screens.
 * Provides reusable signal search, datetime range, and data table controls.
 *
 * React Native parity port of web/src/components/SignalQueryControls.tsx.
 *
 * The web file is a Tailwind/DOM module exporting a set of shared signal-query
 * primitives. This native port preserves every export (types, BE->FE adapters,
 * pure helpers, the colour/page-size constants, and the four components
 * SignalMultiSelect / DateTimeRangeControls / QueryControls / SignalDataTable)
 * and reproduces the same behaviour, state names, API path, and visual intent
 * using React Native primitives + the existing native tokens.
 *
 * Browser-only dependencies are reduced explicitly and documented in the
 * `.parity.json` sidecar:
 *   - react-i18next `useTranslation`: replaced by a native-safe
 *     `t(key, fallback?, params?)` that interpolates i18next-style `{{label}}`
 *     placeholders, keeping every translation key + i18n intent.
 *   - lucide-react icons (Search / X / Play / Chevron(s)Left/Right): rendered as
 *     decorative `AppText` glyphs (the same approach the VehicleMultiSelect /
 *     Timeline ports use for inline lucide icons).
 *   - `@/components/ui` Badge / Button / Input / DataTable + `type Column`: no
 *     native parity port yet, so minimal native-safe equivalents are reproduced
 *     locally (mirrors the VehicleMultiSelect "reproduce the dependency
 *     locally" precedent). The `Column.className` web slot becomes a native
 *     `cellStyle` analog.
 *   - `../lib/numberFormat` `fmtInt`, `../lib/constants` TIME_RANGE_PRESETS /
 *     matchTimeRangePreset: pure logic ported verbatim (fmtInt collapses to the
 *     0-decimal locale format; the global precision/locale singletons are not
 *     needed because fmtInt is always integer + uses the device locale).
 *   - `../lib/cn`: dropped — native styling uses StyleSheet + tokens.
 *   - The web `<input type="datetime-local">` has no native control and no
 *     date-picker dependency is installed, so the From/To fields become
 *     native-safe `TextInput`s accepting the same `YYYY-MM-DDTHH:mm:ss` string
 *     the web input emitted (preserving fromStr/toStr + step=1s second precision
 *     intent). The web `<select>` row-size control becomes a segmented row of
 *     pressable chips. The SignalMultiSelect `document` mousedown click-outside
 *     listener + its container ref are dropped (no DOM on native); the dropdown
 *     instead closes on item select, matching the web primary close path.
 */
import React, {useCallback, useMemo, useState, type ReactNode} from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import {useQuery} from '@tanstack/react-query';

import {AppText} from '../../components/ui/AppText';
import {GlassPanel} from '../../components/ui/GlassPanel';
import {colors, spacing} from '../../theme/tokens';
import {request} from '../api/client';
import type {SignalHistoryPoint, SignalHistoryResp} from '../api/types';

/* ── native translation fallback (native-safe port of react-i18next) ── */

type NativeTParams = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallback?: string,
  params?: NativeTParams,
) => string;

/** Interpolates i18next-style `{{label}}` placeholders, mirroring t(key, def, opts). */
function interpolate(template: string, params?: NativeTParams): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const value = params[name];
    return value === undefined ? '' : String(value);
  });
}

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback(
    (key: string, fallback?: string, params?: NativeTParams) =>
      interpolate(fallback ?? key, params),
    [],
  );
}

/* ── monospace font (web `font-mono`) ── */

const MONO_FONT = Platform.select({
  ios: 'Menlo',
  android: 'monospace',
  default: 'monospace',
});

/* ── Shared Types ── */

export interface SignalLogEntry {
  created_at: string;
  signal: string;
  value_num?: number | null;
  value_str?: string | null;
  value_bool?: boolean | null;
}

/* ── BE → FE adapter ── */
//
// The `/api/v1/signals/{vid}/{name}/history` endpoint returns the
// Typed shape `{ts, kind, value}` — a single `value` whose
// type is dictated by the row's `value_kind` discriminator. The rest
// of the telemetry UI (chart, stats, table) was built for the older
// `{created_at, value_num/str/bool}` rows. Without this adapter the
// chart axis renders "Invalid Date" and every cell shows "—" with a
// "string" type badge — the symptom that motivated this helper.

export function adaptSignalHistoryPoint(
  point: SignalHistoryPoint,
  signal: string,
): SignalLogEntry {
  const entry: SignalLogEntry = {
    created_at: point.ts,
    signal,
    value_num: null,
    value_str: null,
    value_bool: null,
  };
  switch (typeof point.value) {
    case 'number':
      entry.value_num = Number.isFinite(point.value) ? point.value : null;
      break;
    case 'boolean':
      entry.value_bool = point.value;
      break;
    case 'string':
      // The typed BE returns ValueKindTime / ValueKindString as strings;
      // surface both via value_str so the table renders them and the
      // chart's numeric guard correctly skips non-numeric series.
      entry.value_str = point.value;
      break;
    default:
      // null / undefined → leave all three nulled out
      break;
  }
  return entry;
}

export function adaptSignalHistoryResp(
  resp: SignalHistoryResp | null | undefined,
): SignalLogEntry[] {
  if (!resp || !Array.isArray(resp.data)) {
    return [];
  }
  const signal = resp.signal ?? '';
  return resp.data.map(p => adaptSignalHistoryPoint(p, signal));
}

export interface SignalHistoryPagination {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
}

export interface SignalHistoryResponse {
  data: SignalLogEntry[];
  pagination: SignalHistoryPagination;
}

/* ── Shared Helpers ── */

export function toLocalDatetimeStr(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function formatTimestampMs(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const pad3 = (n: number) => String(n).padStart(3, '0');
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(
    d.getDate(),
  )} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(
    d.getSeconds(),
  )}.${pad3(d.getMilliseconds())}`;
}

export function getValueType(
  entry: SignalLogEntry,
): 'num' | 'str' | 'bool' | 'null' {
  if (entry.value_num != null) {
    return 'num';
  }
  if (entry.value_str != null) {
    return 'str';
  }
  if (entry.value_bool != null) {
    return 'bool';
  }
  return 'null';
}

export function formatValue(entry: SignalLogEntry): string {
  if (entry.value_num != null) {
    return String(entry.value_num);
  }
  if (entry.value_str != null) {
    return entry.value_str;
  }
  if (entry.value_bool != null) {
    return entry.value_bool ? 'true' : 'false';
  }
  return '—';
}

export const TYPE_BADGE_COLOR: Record<
  string,
  'cyan' | 'green' | 'amber' | 'neutral'
> = {
  num: 'cyan',
  str: 'green',
  bool: 'amber',
  null: 'neutral',
};

// Body cells in a 100s-of-rows table — readability wins over saturation.
// Web used toned-down Tailwind 300-shades; native maps them to the literal
// hexes (cyan-300 / emerald-300 / amber-300) and the muted token so the value
// colour intent is preserved without Tailwind classes.
export const TYPE_VALUE_COLOR: Record<string, string> = {
  num: '#67e8f9',
  str: '#6ee7b7',
  bool: '#fcd34d',
  null: colors.textMuted,
};

export const PAGE_SIZES = [25, 50, 100];

/* ── Local time-range presets (native-safe port of ../lib/constants) ── */

export const TIME_RANGE_PRESETS = [
  {label: '1h', hours: 1},
  {label: '6h', hours: 6},
  {label: '24h', hours: 24},
  {label: '7d', hours: 168},
  {label: '30d', hours: 720},
] as const;

/**
 * Match a (from, to) datetime-local string pair to a TIME_RANGE_PRESETS entry.
 * Returns the matched preset's `hours` value, or `null` if the range doesn't
 * match any preset within the tolerance (±60s by default).
 */
export function matchTimeRangePreset(
  fromStr: string,
  toStr: string,
  toleranceMs: number = 60_000,
): number | null {
  if (!fromStr || !toStr) {
    return null;
  }
  const fromMs = new Date(fromStr).getTime();
  const toMs = new Date(toStr).getTime();
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
    return null;
  }
  const spanMs = toMs - fromMs;
  for (const p of TIME_RANGE_PRESETS) {
    const presetMs = p.hours * 3600_000;
    if (Math.abs(spanMs - presetMs) <= toleranceMs) {
      return p.hours;
    }
  }
  return null;
}

/* ── Local fmtInt (native-safe port of ../lib/numberFormat fmtInt) ── */

function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

/** Format as integer with locale separators: fmtInt(12345.6) → "12,346". */
function fmtInt(v: unknown): string {
  const n = safeNumber(v);
  try {
    return n.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  } catch {
    return n.toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  }
}

/* ── Local native-safe UI primitives (reproduce `@/components/ui`) ── */

function isTextNode(node: ReactNode): node is string | number {
  return typeof node === 'string' || typeof node === 'number';
}

type BadgeColor = 'cyan' | 'green' | 'amber' | 'neutral';

interface BadgeProps {
  color: BadgeColor;
  children: string;
}

/** Minimal native-safe Badge — the four colours the web Badge is used with here. */
function Badge({color, children}: BadgeProps) {
  return (
    <View style={[styles.badge, badgeColorStyles[color]]}>
      <AppText
        style={[styles.badgeText, badgeTextColorStyles[color]]}
        variant="caption"
        weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

interface ButtonProps {
  label: string;
  onPress: () => void;
  icon?: ReactNode;
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
}

/** Minimal native-safe primary Button (size `sm`) with loading + leading icon. */
function Button({label, onPress, icon, disabled, loading, testID}: ButtonProps) {
  const isDisabled = Boolean(disabled) || Boolean(loading);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{disabled: isDisabled, busy: Boolean(loading)}}
      disabled={isDisabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        isDisabled && styles.buttonDisabled,
        pressed && !isDisabled && styles.buttonPressed,
      ]}
      testID={testID}>
      {loading ? (
        <ActivityIndicator color={colors.background} size="small" />
      ) : (
        icon
      )}
      <AppText style={styles.buttonText} weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

interface InputFieldProps {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  icon?: ReactNode;
  onFocus?: () => void;
  testID?: string;
}

/** Minimal native-safe Input (leading icon + field) over a RN TextInput. */
function InputField({
  value,
  onChangeText,
  placeholder,
  icon,
  onFocus,
  testID,
}: InputFieldProps) {
  return (
    <View style={styles.inputRow}>
      {icon ? <View style={styles.inputIcon}>{icon}</View> : null}
      <TextInput
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={onChangeText}
        onFocus={onFocus}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        style={[styles.inputField, icon ? styles.inputFieldWithIcon : null]}
        testID={testID}
        value={value}
      />
    </View>
  );
}

/* ── Local native-safe DataTable (reproduce `@/components/ui` DataTable) ── */

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** Native analog of the web `className` cell-styling slot. */
  cellStyle?: StyleProp<TextStyle>;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T) => string | number;
  emptyMessage?: string;
  compact?: boolean;
}

function DataTable<T>({
  columns,
  data,
  keyExtractor,
  emptyMessage,
  compact,
}: DataTableProps<T>) {
  return (
    <View testID="signal-data-table">
      <View style={[styles.tableRow, styles.tableHeaderRow]}>
        {columns.map(col => (
          <View key={col.key} style={styles.tableCell}>
            <AppText numberOfLines={1} style={styles.tableHeaderText}>
              {col.header}
            </AppText>
          </View>
        ))}
      </View>
      {data.length === 0 ? (
        <View style={styles.tableEmpty} testID="signal-data-table-empty">
          <AppText style={styles.tableEmptyText}>
            {emptyMessage ?? 'No data'}
          </AppText>
        </View>
      ) : (
        data.map(row => (
          <View
            key={String(keyExtractor(row))}
            style={[
              styles.tableRow,
              styles.tableBodyRow,
              compact ? styles.tableRowCompact : null,
            ]}>
            {columns.map(col => {
              const content = col.render(row);
              return (
                <View key={col.key} style={styles.tableCell}>
                  {isTextNode(content) ? (
                    <AppText
                      numberOfLines={1}
                      style={[styles.tableCellText, col.cellStyle]}>
                      {content}
                    </AppText>
                  ) : (
                    content
                  )}
                </View>
              );
            })}
          </View>
        ))
      )}
    </View>
  );
}

/* ── Inline icon glyphs (native-safe stand-ins for lucide-react) ── */

const ICON = {
  search: '\u2315',
  close: '\u00D7',
  play: '\u25B6',
  chevronLeft: '\u2039',
  chevronRight: '\u203A',
  chevronsLeft: '\u00AB',
  chevronsRight: '\u00BB',
} as const;

/* ── Signal Multi-Select ── */

interface SignalMultiSelectProps {
  vehicleId: number;
  selected: string[];
  onChange: (signals: string[]) => void;
  maxSignals?: number;
}

export function SignalMultiSelect({
  vehicleId,
  selected,
  onChange,
  maxSignals,
}: SignalMultiSelectProps) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);

  const {data: availableSignals} = useQuery({
    queryKey: ['signal-available', vehicleId],
    queryFn: () =>
      request<string[]>(`/signals/available?vehicle_id=${vehicleId}`),
    staleTime: 60_000,
  });

  const filtered = useMemo(() => {
    const all = availableSignals ?? [];
    if (!search) {
      return all.filter(s => !selected.includes(s));
    }
    const q = search.toLowerCase();
    return all.filter(s => !selected.includes(s) && s.toLowerCase().includes(q));
  }, [availableSignals, search, selected]);

  const addSignal = useCallback(
    (sig: string) => {
      if (maxSignals && selected.length >= maxSignals) {
        return;
      }
      onChange([...selected, sig]);
      setSearch('');
    },
    [selected, onChange, maxSignals],
  );

  const removeSignal = useCallback(
    (sig: string) => {
      onChange(selected.filter(s => s !== sig));
    },
    [selected, onChange],
  );

  // The web `document` mousedown click-outside listener + its container ref are
  // DOM-only; on native the dropdown closes when an option is selected (the web
  // primary close path).

  return (
    <View>
      <AppText style={styles.metricLabel}>
        {`Signals${maxSignals ? ` (max ${maxSignals})` : ''}`}
      </AppText>

      {selected.length > 0 ? (
        <View style={styles.chipRow}>
          {selected.map(sig => (
            <View key={sig} style={styles.chip} testID={`signal-chip-${sig}`}>
              <AppText style={styles.chipText}>{sig}</AppText>
              <Pressable
                accessibilityLabel={`Remove ${sig}`}
                accessibilityRole="button"
                hitSlop={6}
                onPress={() => removeSignal(sig)}
                style={styles.chipRemove}
                testID={`signal-chip-remove-${sig}`}>
                <AppText style={styles.chipRemoveGlyph}>{ICON.close}</AppText>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <View>
        <InputField
          icon={<AppText style={styles.searchGlyph}>{ICON.search}</AppText>}
          onChangeText={v => {
            setSearch(v);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={
            selected.length ? 'Add more signals…' : 'Search signals…'
          }
          testID="signal-search-input"
          value={search}
        />
        {open && filtered.length > 0 ? (
          <View style={styles.dropdown} testID="signal-dropdown">
            <ScrollView
              keyboardShouldPersistTaps="handled"
              style={styles.dropdownScroll}>
              {filtered.slice(0, 50).map(sig => (
                <Pressable
                  key={sig}
                  accessibilityRole="button"
                  onPress={() => {
                    addSignal(sig);
                    setOpen(false);
                  }}
                  style={({pressed}) => [
                    styles.dropdownItem,
                    pressed && styles.dropdownItemPressed,
                  ]}
                  testID={`signal-option-${sig}`}>
                  <AppText style={styles.dropdownItemText}>{sig}</AppText>
                </Pressable>
              ))}
              {filtered.length > 50 ? (
                <AppText style={styles.dropdownMore}>
                  {`${filtered.length - 50} more — refine search`}
                </AppText>
              ) : null}
            </ScrollView>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/* ── DateTime Range Controls ── */

interface DateTimeRangeProps {
  fromStr: string;
  toStr: string;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
  onPreset: (hours: number) => void;
}

export function DateTimeRangeControls({
  fromStr,
  toStr,
  onFromChange,
  onToChange,
  onPreset,
}: DateTimeRangeProps) {
  const t = useNativeTranslationFallback();
  const activePresetHours = matchTimeRangePreset(fromStr, toStr);

  return (
    <View style={styles.rangeGrid}>
      <View style={styles.rangeField}>
        <AppText style={styles.metricLabel}>
          {t('signalQuery.from', 'From')}
        </AppText>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={onFromChange}
          placeholder="YYYY-MM-DDTHH:mm:ss"
          placeholderTextColor={colors.textMuted}
          style={styles.dateInput}
          testID="signal-range-from"
          value={fromStr}
        />
      </View>
      <View style={styles.rangeField}>
        <AppText style={styles.metricLabel}>
          {t('signalQuery.to', 'To')}
        </AppText>
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={onToChange}
          placeholder="YYYY-MM-DDTHH:mm:ss"
          placeholderTextColor={colors.textMuted}
          style={styles.dateInput}
          testID="signal-range-to"
          value={toStr}
        />
      </View>
      <View style={styles.rangeField}>
        <AppText style={styles.metricLabel}>
          {t('signalQuery.quickRange', 'Quick Range')}
        </AppText>
        <View style={styles.presetRow}>
          {TIME_RANGE_PRESETS.map(tp => {
            const active = activePresetHours === tp.hours;
            return (
              <Pressable
                key={tp.label}
                accessibilityLabel={t(
                  'signalQuery.preset.aria',
                  '{{label}} time range',
                  {label: tp.label},
                )}
                accessibilityRole="button"
                accessibilityState={{selected: active}}
                onPress={() => onPreset(tp.hours)}
                style={[styles.presetChip, active && styles.presetChipActive]}
                testID={`signal-preset-${tp.label}`}>
                <AppText
                  style={[
                    styles.presetChipText,
                    active && styles.presetChipTextActive,
                  ]}>
                  {tp.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

/* ── Query Controls (Rows + Button) ── */

interface QueryControlsProps {
  perPage: number;
  onPerPageChange: (v: number) => void;
  onQuery: () => void;
  disabled?: boolean;
  loading?: boolean;
  label?: string;
}

export function QueryControls({
  perPage,
  onPerPageChange,
  onQuery,
  disabled,
  loading,
  label,
}: QueryControlsProps) {
  const t = useNativeTranslationFallback();
  const buttonLabel = label ?? t('signalQuery.query', 'Query');
  return (
    <View style={styles.queryRow}>
      <View style={styles.rangeField}>
        <AppText style={styles.metricLabel}>
          {t('signalQuery.rows', 'Rows')}
        </AppText>
        <View style={styles.presetRow}>
          {PAGE_SIZES.map(s => {
            const active = perPage === s;
            return (
              <Pressable
                key={s}
                accessibilityRole="button"
                accessibilityState={{selected: active}}
                onPress={() => onPerPageChange(Number(s))}
                style={[styles.presetChip, active && styles.presetChipActive]}
                testID={`signal-perpage-${s}`}>
                <AppText
                  style={[
                    styles.presetChipText,
                    active && styles.presetChipTextActive,
                  ]}>
                  {String(s)}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </View>
      <Button
        disabled={disabled}
        icon={
          loading ? undefined : (
            <AppText style={styles.buttonGlyph}>{ICON.play}</AppText>
          )
        }
        label={buttonLabel}
        loading={loading}
        onPress={onQuery}
        testID="signal-query-button"
      />
    </View>
  );
}

/* ── Signal Data Table ── */

interface SignalDataTableProps {
  rows: SignalLogEntry[];
  page: number;
  totalPages: number;
  total: number;
  perPage: number;
  onPageChange: (p: number) => void;
  loading?: boolean;
}

type IndexedEntry = SignalLogEntry & {_rowNum: number};

export function SignalDataTable({
  rows,
  page,
  totalPages,
  total,
  perPage,
  onPageChange,
  loading,
}: SignalDataTableProps) {
  if (loading) {
    return (
      <GlassPanel style={styles.skeletonPanel} testID="signal-data-table-loading">
        <View style={styles.skeletonStack}>
          {Array.from({length: 5}).map((_unused, i) => (
            <View key={i} style={styles.skeletonRow} />
          ))}
        </View>
      </GlassPanel>
    );
  }

  const indexedRows: IndexedEntry[] = rows.map((entry, i) => ({
    ...entry,
    _rowNum: (page - 1) * perPage + i + 1,
  }));

  const columns: Column<IndexedEntry>[] = [
    {
      key: 'index',
      header: '#',
      render: row => row._rowNum,
      cellStyle: styles.cellIndex,
    },
    {
      key: 'created_at',
      header: 'Timestamp',
      render: row => formatTimestampMs(row.created_at),
      cellStyle: styles.cellTimestamp,
    },
    {
      key: 'signal',
      header: 'Signal',
      render: row => row.signal,
      cellStyle: styles.cellSignal,
    },
    {
      key: 'value',
      header: 'Value',
      render: row => {
        const vt = getValueType(row);
        return (
          <AppText
            numberOfLines={1}
            style={[styles.cellMono, {color: TYPE_VALUE_COLOR[vt]}]}>
            {formatValue(row)}
          </AppText>
        );
      },
    },
    {
      key: 'type',
      header: 'Type',
      render: row => {
        const vt = getValueType(row);
        return <Badge color={TYPE_BADGE_COLOR[vt]}>{vt}</Badge>;
      },
    },
  ];

  return (
    <GlassPanel style={styles.tablePanel}>
      <DataTable
        columns={columns}
        compact
        data={indexedRows}
        emptyMessage="No results"
        keyExtractor={row => row._rowNum}
      />

      {/* Server-side pagination */}
      {totalPages > 1 ? (
        <View style={styles.pagination}>
          <AppText style={styles.paginationCount}>
            {`${fmtInt(total)} records`}
          </AppText>
          <View style={styles.paginationButtons}>
            <Pressable
              accessibilityRole="button"
              disabled={page <= 1}
              hitSlop={6}
              onPress={() => onPageChange(1)}
              style={[styles.pageButton, page <= 1 && styles.pageButtonDisabled]}
              testID="signal-page-first">
              <AppText style={styles.pageGlyph}>{ICON.chevronsLeft}</AppText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={page <= 1}
              hitSlop={6}
              onPress={() => onPageChange(page - 1)}
              style={[styles.pageButton, page <= 1 && styles.pageButtonDisabled]}
              testID="signal-page-prev">
              <AppText style={styles.pageGlyph}>{ICON.chevronLeft}</AppText>
            </Pressable>
            <AppText style={styles.pageLabel}>
              {`Page ${page} of ${totalPages}`}
            </AppText>
            <Pressable
              accessibilityRole="button"
              disabled={page >= totalPages}
              hitSlop={6}
              onPress={() => onPageChange(page + 1)}
              style={[
                styles.pageButton,
                page >= totalPages && styles.pageButtonDisabled,
              ]}
              testID="signal-page-next">
              <AppText style={styles.pageGlyph}>{ICON.chevronRight}</AppText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={page >= totalPages}
              hitSlop={6}
              onPress={() => onPageChange(totalPages)}
              style={[
                styles.pageButton,
                page >= totalPages && styles.pageButtonDisabled,
              ]}
              testID="signal-page-last">
              <AppText style={styles.pageGlyph}>{ICON.chevronsRight}</AppText>
            </Pressable>
          </View>
        </View>
      ) : null}
    </GlassPanel>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 11,
    lineHeight: 14,
  },
  button: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 6,
    height: 34,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  buttonDisabled: {
    opacity: 0.48,
  },
  buttonGlyph: {
    color: colors.background,
    fontSize: 12,
    lineHeight: 16,
  },
  buttonPressed: {
    opacity: 0.82,
  },
  buttonText: {
    color: colors.background,
    fontSize: 13,
  },
  cellIndex: {
    color: colors.textMuted,
    fontFamily: MONO_FONT,
  },
  cellMono: {
    fontFamily: MONO_FONT,
    fontSize: 12,
    lineHeight: 16,
  },
  cellSignal: {
    color: colors.textPrimary,
    fontFamily: MONO_FONT,
  },
  cellTimestamp: {
    color: colors.textSecondary,
    fontFamily: MONO_FONT,
  },
  chip: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  chipRemove: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipRemoveGlyph: {
    color: colors.accent,
    fontSize: 14,
    lineHeight: 16,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: spacing.sm,
  },
  chipText: {
    color: colors.accent,
    fontFamily: MONO_FONT,
    fontSize: 12,
    lineHeight: 16,
  },
  dateInput: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    color: colors.textPrimary,
    fontFamily: MONO_FONT,
    fontSize: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  dropdown: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 4,
    overflow: 'hidden',
  },
  dropdownItem: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  dropdownItemPressed: {
    backgroundColor: colors.surfaceHover,
  },
  dropdownItemText: {
    color: colors.textSecondary,
    fontFamily: MONO_FONT,
    fontSize: 12,
    lineHeight: 16,
  },
  dropdownMore: {
    color: colors.textMuted,
    fontSize: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  dropdownScroll: {
    maxHeight: 240,
  },
  inputField: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    color: colors.textPrimary,
    fontSize: 13,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  inputFieldWithIcon: {
    paddingLeft: 34,
  },
  inputIcon: {
    bottom: 0,
    justifyContent: 'center',
    left: spacing.md,
    position: 'absolute',
    top: 0,
    zIndex: 1,
  },
  inputRow: {
    justifyContent: 'center',
    position: 'relative',
  },
  metricLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  pageButton: {
    alignItems: 'center',
    borderRadius: 6,
    justifyContent: 'center',
    minHeight: 28,
    minWidth: 28,
  },
  pageButtonDisabled: {
    opacity: 0.3,
  },
  pageGlyph: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 16,
  },
  pageLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    paddingHorizontal: spacing.sm,
  },
  pagination: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  paginationButtons: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  paginationCount: {
    color: colors.textMuted,
    fontSize: 10,
  },
  presetChip: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  presetChipActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  presetChipText: {
    color: colors.textMuted,
    fontSize: 12,
  },
  presetChipTextActive: {
    color: colors.textPrimary,
  },
  presetRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  queryRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  rangeField: {
    flex: 1,
  },
  rangeGrid: {
    gap: spacing.md,
  },
  searchGlyph: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 16,
  },
  skeletonPanel: {
    padding: spacing.md,
  },
  skeletonRow: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 6,
    height: 32,
  },
  skeletonStack: {
    gap: spacing.sm,
  },
  tableBodyRow: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  tableCell: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  tableCellText: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
  },
  tableEmpty: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
  },
  tableEmptyText: {
    color: colors.textMuted,
    fontSize: 12,
  },
  tableHeaderRow: {
    paddingBottom: spacing.sm,
  },
  tableHeaderText: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  tablePanel: {
    overflow: 'hidden',
  },
  tableRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
  },
  tableRowCompact: {
    paddingVertical: 6,
  },
});

const badgeColorStyles = StyleSheet.create<Record<BadgeColor, ViewStyle>>({
  amber: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
  cyan: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  green: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  neutral: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
});

const badgeTextColorStyles = StyleSheet.create<Record<BadgeColor, TextStyle>>({
  amber: {
    color: colors.warning,
  },
  cyan: {
    color: colors.accent,
  },
  green: {
    color: colors.success,
  },
  neutral: {
    color: colors.textSecondary,
  },
});
