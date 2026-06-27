// Native parity port of
// web/src/features/telemetry/components/SignalCatalogPanel.tsx.
//
// The web module is the staleness-aware "signal catalog" browser: a FadeIn ->
// 4-up StatCard summary grid (Total / Active / Stale / Never Received) plus a
// GlassPanel containing a search Input, an "All / Stale Only / Active Only"
// filter button group, a "Most Stale / A-Z / Category" sort button group, and a
// scrollable DataTable<SignalRow> of Status (Badge) / Signal (mono) / Last Value
// (mono) / Last Updated (formatDateTime) / Time Since (formatStaleness) columns.
// When a `selection` prop is supplied it prepends a checkbox column so callers
// (the SignalsWorkspace left rail) can drive a chip-selection workflow with an
// optional `max`. A trailing "Last refreshed" TimeStamp closes the panel.
//
// Built from the shared web UI kit (GlassPanel, Badge, Button, Input, DataTable +
// Column, StatCard, TimeStamp, Skeleton, FadeIn), the lucide AlertTriangle /
// ArrowUpDown / Filter / Plus / RefreshCw / X icons, react-i18next, the
// useSignalGaps telemetry hook, @/lib/numberFormat fmtInt, @/lib/dateFormat
// formatDateTime, @/lib/cn, and the @/types/telemetry SignalRow type.
//
// Native-safe substitutions (rule 7), documented in the parity sidecar:
//   • react-i18next useTranslation() -> a local English-fallback useTranslation()
//     whose t(key, fallback?) accepts BOTH the string-fallback form
//     (t('signalGap.status', 'Status')) and the options form with interpolation
//     (t('signalCatalog.removeSignal', {defaultValue: 'Remove {{name}} …', name}))
//     so every key + interpolation token is preserved verbatim at the call site.
//   • lucide-react glyphs -> SemanticIcon glyphs (arrowUpDown / refresh / warning
//     for the StatCards; filter / arrowUpDown for the control adornments; add /
//     close for the selection checkbox), mirroring the SummaryStatsRow port.
//   • The shared web <StatCard> (DOM div + neon Tailwind classes) -> an inlined
//     native StatCard: a rounded card with a label, a bold value, and a boxed
//     SemanticIcon — exactly the label/value/icon props this caller passes.
//   • The shared web <Badge size="sm" dot> (DOM <span> pill) -> an inlined native
//     Badge: a rounded-full View with a tinted surface/border, an optional status
//     dot, and a caption AppText in the variant colour (the four variants this
//     panel uses: neutral / success / warning / danger).
//   • The shared web <Button variant="ghost" size="sm"> filter/sort toggles -> an
//     inlined native ToggleChip: a bordered Pressable that tints cyan (filter) or
//     violet (sort) when active and is muted otherwise, matching the web
//     bg-cyan-500/10 / bg-purple-500/10 active classes.
//   • The shared web <Input> (search box) -> the already-ported native parity
//     Input; web onChange(e.target.value) -> RN onChangeText, value/placeholder/
//     aria-label preserved.
//   • The shared web <TimeStamp> (hover Tooltip + Settings relative/absolute
//     preference) -> an inlined native TimeStamp: the same value union parsing,
//     the "—" placeholder, an absolute local format, and an honoured 'relative'
//     override (the footer passes format="relative"). RN has no hover, so the
//     alternate-format Tooltip is dropped.
//   • The shared web <DataTable> (47 KB resize/reorder/visibility/CSV/selection/
//     persistence) -> an inlined native DataTable covering exactly the props this
//     caller uses: Column<T>{key, header, className?, render, visibleOnMobile?},
//     data, keyExtractor, compact, pagination{defaultPageSize}, emptyMessage,
//     tableId. className 'w-8' -> a fixed narrow checkbox cell; 'text-right' ->
//     a right-aligned cell; visibleOnMobile is accepted for parity but every
//     column renders (RN shows the full catalog, matching the EventHistoryTable
//     port). Pagination slices at the page size (50) with a Prev/Next pager.
//   • @/lib/numberFormat fmtInt + @/lib/dateFormat formatDateTime -> inlined
//     verbatim (en-US locale; the parity bundle ships no Settings/locale runtime,
//     so the web navigator-locale default resolves to en-US like the sibling
//     ports). @/lib/cn -> RN style arrays. @/types/telemetry SignalRow inlined.
//   • The web `tableMaxHeight: string` ('60vh' default) -> resolved to a numeric
//     RN maxHeight via Dimensions ('Nvh' -> N% of window height, 'Npx'/number ->
//     that many px) on a vertical ScrollView wrapping the table.
//   • DOM-only `className` (outer div) -> a `style` composition hook.
// No DOM elements, react-i18next, lucide-react, Recharts, Leaflet, react-dom, or
// web UI-kit modules are imported into the native output.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  Dimensions,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {Skeleton} from '../../../components/feedback/Skeleton';
import {FadeIn} from '../../../components/motion/FadeIn';
import {Input} from '../../../components/ui/Input';
import {useSignalGaps} from '../../../api/hooks/useTelemetry';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {
  getSemanticIconDefinition,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import {colors, spacing} from '../../../../theme/tokens';

/* ─── i18n fallback (web react-i18next useTranslation) ─────────────────── */

type TranslationValues = Record<string, string | number | undefined>;
type TranslationOptions = {defaultValue?: string} & TranslationValues;
type TFunc = (key: string, fallback?: string | TranslationOptions) => string;

// Native stand-in for react-i18next's useTranslation: the parity bundle ships no
// i18n runtime, so `t` returns the English fallback (or the key) while preserving
// every key at the call site. It accepts both the string-fallback form and the
// options form (`{defaultValue, ...values}`), interpolating `{{token}}`
// placeholders so the "Remove {{name}} from selection" labels resolve exactly
// like the web copy. A stable useCallback identity keeps the columns [t]
// dependency honest, matching the source.
function useTranslation(): {t: TFunc} {
  const t = useCallback<TFunc>((key, fallback) => {
    if (typeof fallback === 'string') {
      return fallback;
    }
    if (fallback && typeof fallback === 'object') {
      const {defaultValue, ...values} = fallback;
      const base = defaultValue ?? key;
      return base.replace(/\{\{(\w+)\}\}/g, (match, token: string) => {
        const value = values[token];
        return value === undefined ? match : String(value);
      });
    }
    return key;
  }, []);
  return {t};
}

/* ─── inlined @/lib/numberFormat fmtInt ────────────────────────────────── */

/** Safe number extraction from unknown values; returns 0 for nullish/NaN. */
function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// web fmtInt = fmtNumber(v, 0): locale integer formatting (en-US default) with
// non-finite inputs coerced to 0 via safeNumber.
function fmtInt(v: unknown): string {
  return safeNumber(v).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

/* ─── inlined @/lib/dateFormat formatDateTime ──────────────────────────── */

// web formatDateTime: "—" for null/invalid, otherwise a localised
// year/month/day/hour/minute string. The web `intlLocale(opts)` default resolves
// to the navigator locale; with no Settings/locale runtime in the parity bundle
// it folds to en-US (matching the sibling TimeStamp port's absolute format).
function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/* ─── inlined @/types/telemetry SignalRow ──────────────────────────────── */

export interface SignalRow {
  name: string;
  value: string;
  timestamp: string | null;
  staleness: number;
  category: 'active' | 'stale' | 'never';
}

/* ─── public catalog types (web exports, preserved verbatim) ───────────── */

export type CatalogFilterMode = 'all' | 'stale' | 'active';
export type CatalogSortMode = 'staleness' | 'alpha' | 'category';

export interface SignalCatalogSelectionProps {
  selectedSignals: string[];
  onToggle: (signal: string) => void;
  /** Maximum signals that can be selected. Disables further toggles when reached. */
  max?: number;
}

export interface SignalCatalogPanelProps {
  vehicleId: number;
  /** Optional override title. */
  title?: string;
  /** Show the 4 summary StatCards at the top. Default true. */
  showSummary?: boolean;
  /** Optional selection state. Adds a checkbox column when provided. */
  selection?: SignalCatalogSelectionProps;
  /** Native composition hook replacing the DOM-only `className` on the wrapper. */
  style?: StyleProp<ViewStyle>;
  /** Slot rendered next to the title (e.g. extra actions). */
  headerExtra?: ReactNode;
  /** Override max-height of the table viewport. Default '60vh'. */
  tableMaxHeight?: string;
}

/* ─── staleness style + formatter (web exports) ────────────────────────── */

type StalenessVariant = 'neutral' | 'success' | 'warning' | 'danger';

interface StalenessStyle {
  label: string;
  /** Native colour value (web returned a Tailwind text-* class here). */
  text: string;
  variant: StalenessVariant;
}

// Web returned a Tailwind text-* class for `text`; the native port returns the
// resolved colour token so the value can drive a RN text style directly. The
// labels and variants are preserved verbatim.
export function getCatalogStalenessStyle(
  seconds: number,
  hasTimestamp: boolean,
): StalenessStyle {
  if (!hasTimestamp) {
    return {label: 'Never received', text: colors.textMuted, variant: 'neutral'};
  }
  if (seconds < 30) {
    return {label: 'Active', text: colors.success, variant: 'success'};
  }
  if (seconds < 300) {
    return {label: 'Aging', text: colors.warning, variant: 'warning'};
  }
  return {label: 'Stale', text: colors.danger, variant: 'danger'};
}

export function formatStaleness(seconds: number): string {
  if (!Number.isFinite(seconds)) {
    return '—';
  }
  if (seconds < 60) {
    return `${fmtInt(seconds)}s ago`;
  }
  if (seconds < 3600) {
    return `${fmtInt(seconds / 60)}m ago`;
  }
  const h = Math.floor(seconds / 3600);
  const m = (seconds % 3600) / 60;
  return `${h}h ${fmtInt(m)}m ago`;
}

/* ─── inlined @/components/ui Badge (subset used here) ──────────────────── */

interface BadgeTint {
  bg: string;
  border: string;
  text: string;
}

const BADGE_VARIANT_STYLES: Record<StalenessVariant, BadgeTint> = {
  neutral: {
    bg: colors.surfaceRaised,
    border: colors.border,
    text: colors.textSecondary,
  },
  success: {
    bg: colors.successSurface,
    border: colors.successBorder,
    text: colors.success,
  },
  warning: {
    bg: colors.warningSurface,
    border: colors.warningBorder,
    text: colors.warning,
  },
  danger: {
    bg: colors.dangerSurface,
    border: colors.dangerBorder,
    text: colors.danger,
  },
};

interface BadgeProps {
  variant?: StalenessVariant;
  dot?: boolean;
  children: ReactNode;
}

function Badge({variant = 'neutral', dot = false, children}: BadgeProps) {
  const tone = BADGE_VARIANT_STYLES[variant];
  return (
    <View
      style={[styles.badge, {backgroundColor: tone.bg, borderColor: tone.border}]}>
      {dot ? (
        <View style={[styles.badgeDot, {backgroundColor: tone.text}]} />
      ) : null}
      <AppText style={[styles.badgeText, {color: tone.text}]} weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

/* ─── inlined @/components/data-display TimeStamp ───────────────────────── */

type TimeStampFormat = 'relative' | 'absolute' | 'auto';

interface TimeStampProps {
  value: string | number | Date | null | undefined;
  format?: TimeStampFormat;
  style?: StyleProp<TextStyle>;
}

function formatAbsolute(date: Date): string {
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelative(date: Date): string {
  const diff = Date.now() - date.getTime();
  if (diff < 0) {
    return formatAbsolute(date);
  }
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// Shared timestamp renderer. Web shows a hover Tooltip with the alternate format
// and defaults 'auto' to the user's Settings preference; RN has no hover and the
// parity bundle has no Settings runtime, so 'auto' resolves to the absolute
// format while an explicit 'relative' override is still honoured. The "—"
// placeholder for null/unparseable values is preserved.
function TimeStamp({value, format = 'auto', style}: TimeStampProps) {
  if (value == null) {
    return <AppText style={style}>—</AppText>;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return <AppText style={style}>—</AppText>;
  }
  const effective = format === 'auto' ? 'absolute' : format;
  const primary =
    effective === 'relative' ? formatRelative(date) : formatAbsolute(date);
  return (
    <AppText numberOfLines={1} style={style}>
      {primary}
    </AppText>
  );
}

/* ─── inlined @/components/data-display StatCard (subset used here) ─────── */

interface StatCardProps {
  label: string;
  value: string | number;
  icon: SemanticIconName;
}

/** Compact summary card with a label, a bold value, and a boxed SemanticIcon. */
function StatCard({label, value, icon}: StatCardProps) {
  const definition = getSemanticIconDefinition(icon);
  const tint = ICON_TONE_TINT[definition.tone] ?? ICON_TONE_TINT.neutral;
  return (
    <View style={styles.statCard}>
      <View style={styles.statBody}>
        <AppText numberOfLines={1} style={styles.statLabel} tone="muted">
          {label}
        </AppText>
        <AppText style={styles.statValue} weight="bold">
          {value}
        </AppText>
      </View>
      <View
        style={[
          styles.statIconBox,
          {backgroundColor: tint.bg, borderColor: tint.border},
        ]}>
        <AppText style={[styles.statIconGlyph, {color: tint.fg}]} weight="bold">
          {definition.glyph}
        </AppText>
      </View>
    </View>
  );
}

/* ─── inlined @/components/ui Button -> filter/sort ToggleChip ──────────── */

type ChipAccent = 'cyan' | 'violet';

const CHIP_TINT: Record<ChipAccent, BadgeTint> = {
  cyan: {bg: colors.accentSoft, border: colors.borderAccent, text: colors.accent},
  violet: {
    bg: colors.violetSurface,
    border: colors.violetBorder,
    text: colors.violet,
  },
};

interface ToggleChipProps {
  label: string;
  active: boolean;
  accent: ChipAccent;
  onPress: () => void;
}

// Web <Button variant="ghost" size="sm"> with the active bg-cyan-500/10 (filter)
// or bg-purple-500/10 (sort) tint vs the muted inactive border.
function ToggleChip({label, active, accent, onPress}: ToggleChipProps) {
  const tint = CHIP_TINT[accent];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{selected: active}}
      onPress={onPress}
      style={({pressed}) => [
        styles.chip,
        active
          ? {backgroundColor: tint.bg, borderColor: tint.border}
          : styles.chipInactive,
        pressed ? styles.chipPressed : null,
      ]}>
      <AppText
        style={[styles.chipText, {color: active ? tint.text : colors.textMuted}]}
        weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

/* ─── inlined @/components/ui DataTable (subset used here) ──────────────── */

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  /** Web Tailwind class; the native table reads 'w-8' (narrow) + 'text-right'. */
  className?: string;
  /** Accepted for web parity; the native table renders every column. */
  visibleOnMobile?: boolean;
}

interface PaginationConfig {
  defaultPageSize?: number;
}

interface DataTableProps<T> {
  tableId?: string;
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T) => string | number;
  emptyMessage?: string;
  compact?: boolean;
  pagination?: PaginationConfig;
}

interface ColumnLayout {
  width?: number;
  alignRight: boolean;
}

// Map the web Column.className tokens this caller uses to a native cell layout:
// 'w-8' -> a fixed 32pt checkbox cell, 'text-right' -> a right-aligned cell.
function columnLayout(className?: string): ColumnLayout {
  if (!className) {
    return {alignRight: false};
  }
  return {
    width: /\bw-8\b/.test(className) ? 32 : undefined,
    alignRight: /\btext-right\b/.test(className),
  };
}

function DataTable<T>({
  tableId,
  columns,
  data,
  keyExtractor,
  emptyMessage,
  compact = false,
  pagination,
}: DataTableProps<T>) {
  const paginationEnabled = !!pagination;
  const pageSize = pagination?.defaultPageSize ?? 25;
  const [page, setPage] = useState(1);

  // Mirror the web table: jump back to page 1 whenever the row count changes so
  // a shrinking dataset never strands the viewer on an empty trailing page.
  useEffect(() => {
    setPage(1);
  }, [data.length]);

  if (data.length === 0) {
    return (
      <View accessibilityRole="text" style={styles.tableEmpty}>
        <AppText style={styles.tableEmptyText} tone="muted">
          {emptyMessage ?? 'No data'}
        </AppText>
      </View>
    );
  }

  const totalPages = paginationEnabled
    ? Math.max(1, Math.ceil(data.length / pageSize))
    : 1;
  const safePage = Math.min(page, totalPages);
  const pagedData = paginationEnabled
    ? data.slice((safePage - 1) * pageSize, safePage * pageSize)
    : data;

  const rowPadStyle = compact ? styles.rowCompact : styles.rowComfortable;

  return (
    <View style={styles.table} testID={tableId}>
      <View style={[styles.row, styles.headerRowTable, rowPadStyle]}>
        {columns.map(col => {
          const layout = columnLayout(col.className);
          return (
            <View
              key={col.key}
              style={[
                styles.cell,
                layout.width != null
                  ? {flexGrow: 0, flexBasis: layout.width, width: layout.width}
                  : styles.cellFlex,
                layout.alignRight ? styles.cellRight : null,
              ]}>
              <AppText
                numberOfLines={1}
                style={styles.headerText}
                tone="muted"
                weight="semibold">
                {col.header}
              </AppText>
            </View>
          );
        })}
      </View>

      {pagedData.map(row => (
        <View
          key={String(keyExtractor(row))}
          style={[styles.row, styles.bodyRow, rowPadStyle]}>
          {columns.map(col => {
            const layout = columnLayout(col.className);
            return (
              <View
                key={col.key}
                style={[
                  styles.cell,
                  layout.width != null
                    ? {flexGrow: 0, flexBasis: layout.width, width: layout.width}
                    : styles.cellFlex,
                  layout.alignRight ? styles.cellRight : null,
                ]}>
                {col.render(row)}
              </View>
            );
          })}
        </View>
      ))}

      {paginationEnabled && totalPages > 1 ? (
        <View style={styles.pager}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{disabled: safePage <= 1}}
            disabled={safePage <= 1}
            onPress={() => setPage(p => Math.max(1, p - 1))}
            style={({pressed}) => [
              styles.pagerBtn,
              safePage <= 1 ? styles.pagerBtnDisabled : null,
              pressed && safePage > 1 ? styles.pagerBtnPressed : null,
            ]}>
            <AppText variant="caption" weight="semibold">
              Prev
            </AppText>
          </Pressable>
          <AppText style={styles.pagerLabel} tone="muted" variant="caption">
            {`Page ${safePage} of ${totalPages}`}
          </AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{disabled: safePage >= totalPages}}
            disabled={safePage >= totalPages}
            onPress={() => setPage(p => Math.min(totalPages, p + 1))}
            style={({pressed}) => [
              styles.pagerBtn,
              safePage >= totalPages ? styles.pagerBtnDisabled : null,
              pressed && safePage < totalPages ? styles.pagerBtnPressed : null,
            ]}>
            <AppText variant="caption" weight="semibold">
              Next
            </AppText>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/* ─── tableMaxHeight resolver (web '60vh' default) ─────────────────────── */

// Web `maxHeight: tableMaxHeight` ('60vh') -> a numeric RN maxHeight: 'Nvh' is
// N% of the window height, 'Npx'/a bare number is that many px, anything else
// falls back to ~60% of the window height.
function resolveMaxHeight(value: string): number {
  const trimmed = value.trim();
  const vh = /^(\d+(?:\.\d+)?)vh$/.exec(trimmed);
  if (vh) {
    return (Dimensions.get('window').height * parseFloat(vh[1])) / 100;
  }
  const px = /^(\d+(?:\.\d+)?)px$/.exec(trimmed);
  if (px) {
    return parseFloat(px[1]);
  }
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && trimmed !== '') {
    return numeric;
  }
  return Dimensions.get('window').height * 0.6;
}

/* ─── SignalCatalogPanel ───────────────────────────────────────────────── */

export function SignalCatalogPanel({
  vehicleId,
  title,
  showSummary = true,
  selection,
  style,
  headerExtra,
  tableMaxHeight = '60vh',
}: SignalCatalogPanelProps) {
  const {t} = useTranslation();
  const {data: liveData, isLoading, dataUpdatedAt} = useSignalGaps(vehicleId);

  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState<CatalogFilterMode>('all');
  const [sortMode, setSortMode] = useState<CatalogSortMode>('staleness');

  const now = Date.now();
  const signals: SignalRow[] = useMemo(() => {
    if (!liveData) {
      return [];
    }
    return Object.entries(liveData as Record<string, unknown>).map(
      ([name, entry]) => {
        const raw =
          entry && typeof entry === 'object'
            ? entry
            : {value: entry, timestamp: null};
        const ts = (raw as {timestamp?: string | null}).timestamp ?? null;
        const staleness = ts ? (now - new Date(ts).getTime()) / 1000 : Infinity;
        const category: SignalRow['category'] = !ts
          ? 'never'
          : staleness > 300
          ? 'stale'
          : 'active';
        const value = (raw as {value?: unknown}).value;
        return {
          name,
          value: value != null ? String(value) : '—',
          timestamp: ts,
          staleness,
          category,
        };
      },
    );
  }, [liveData, now]);

  const filtered = useMemo(() => {
    let list = signals;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(s => s.name.toLowerCase().includes(q));
    }
    if (filterMode === 'stale') {
      list = list.filter(s => s.category === 'stale' || s.category === 'never');
    }
    if (filterMode === 'active') {
      list = list.filter(s => s.category === 'active');
    }
    list = [...list].sort((a, b) => {
      if (sortMode === 'staleness') {
        return b.staleness - a.staleness;
      }
      if (sortMode === 'alpha') {
        return a.name.localeCompare(b.name);
      }
      const order = {never: 0, stale: 1, active: 2} as const;
      return order[a.category] - order[b.category];
    });
    return list;
  }, [signals, search, filterMode, sortMode]);

  const activeCount = signals.filter(s => s.category === 'active').length;
  const staleCount = signals.filter(s => s.category === 'stale').length;
  const neverCount = signals.filter(s => s.category === 'never').length;

  const selectedSet = useMemo(
    () => new Set(selection?.selectedSignals ?? []),
    [selection?.selectedSignals],
  );
  const selectionMax = selection?.max;

  const columns: Column<SignalRow>[] = useMemo(() => {
    const cols: Column<SignalRow>[] = [];
    if (selection) {
      cols.push({
        key: 'select',
        header: '',
        className: 'w-8',
        render: s => {
          const checked = selectedSet.has(s.name);
          const disabled =
            !checked &&
            selectionMax != null &&
            selection.selectedSignals.length >= selectionMax;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{disabled: !!disabled, checked}}
              accessibilityLabel={
                checked
                  ? t('signalCatalog.removeSignal', {
                      defaultValue: 'Remove {{name}} from selection',
                      name: s.name,
                    })
                  : t('signalCatalog.addSignal', {
                      defaultValue: 'Add {{name}} to selection',
                      name: s.name,
                    })
              }
              disabled={disabled}
              onPress={() => selection.onToggle(s.name)}
              style={[
                styles.checkbox,
                checked
                  ? styles.checkboxChecked
                  : disabled
                  ? styles.checkboxDisabled
                  : styles.checkboxDefault,
              ]}>
              <AppText
                style={[
                  styles.checkboxGlyph,
                  {color: checked ? colors.accent : colors.textMuted},
                ]}
                weight="bold">
                {checked
                  ? getSemanticIconDefinition('close').glyph
                  : getSemanticIconDefinition('add').glyph}
              </AppText>
            </Pressable>
          );
        },
      });
    }
    cols.push(
      {
        key: 'status',
        header: t('signalGap.status', 'Status'),
        className: 'w-24',
        render: signal => {
          const style2 = getCatalogStalenessStyle(
            signal.staleness,
            !!signal.timestamp,
          );
          return (
            <Badge variant={style2.variant} dot>
              {style2.label}
            </Badge>
          );
        },
      },
      {
        key: 'signal',
        header: t('signalGap.signal', 'Signal'),
        visibleOnMobile: true,
        render: signal => (
          <AppText numberOfLines={1} style={styles.signalText}>
            {signal.name}
          </AppText>
        ),
      },
      {
        key: 'value',
        header: t('signalGap.lastValue', 'Last Value'),
        render: signal => (
          <AppText numberOfLines={1} style={styles.valueText}>
            {signal.value}
          </AppText>
        ),
      },
      {
        key: 'lastUpdated',
        header: t('signalGap.lastUpdated', 'Last Updated'),
        render: signal => (
          <AppText numberOfLines={1} style={styles.updatedText}>
            {signal.timestamp ? formatDateTime(signal.timestamp) : '—'}
          </AppText>
        ),
      },
      {
        key: 'timeSince',
        header: t('signalGap.timeSince', 'Time Since'),
        className: 'text-right',
        render: signal => {
          const style2 = getCatalogStalenessStyle(
            signal.staleness,
            !!signal.timestamp,
          );
          return (
            <AppText
              numberOfLines={1}
              style={[styles.sinceText, {color: style2.text}]}>
              {signal.timestamp ? formatStaleness(signal.staleness) : '—'}
            </AppText>
          );
        },
      },
    );
    return cols;
  }, [selection, selectedSet, selectionMax, t]);

  return (
    <View style={[styles.root, style]}>
      {showSummary ? (
        <FadeIn delay={0.05}>
          <View style={styles.summaryGrid}>
            <View style={styles.summaryCell}>
              <StatCard
                icon="arrowUpDown"
                label={t('signalGap.totalSignals', 'Total Signals')}
                value={signals.length}
              />
            </View>
            <View style={styles.summaryCell}>
              <StatCard
                icon="refresh"
                label={t('signalGap.active', 'Active (<30s)')}
                value={activeCount}
              />
            </View>
            <View style={styles.summaryCell}>
              <StatCard
                icon="warning"
                label={t('signalGap.stale', 'Stale (>5min)')}
                value={staleCount}
              />
            </View>
            <View style={styles.summaryCell}>
              <StatCard
                icon="warning"
                label={t('signalGap.neverReceived', 'Never Received')}
                value={neverCount}
              />
            </View>
          </View>
        </FadeIn>
      ) : null}

      <GlassPanel style={styles.panel}>
        <View style={styles.panelHeader}>
          {title ? (
            <AppText style={styles.sectionTitle} weight="semibold">
              {title}
            </AppText>
          ) : null}
          <View style={styles.panelHeaderRight}>
            {headerExtra}
            <AppText style={styles.refreshGlyph} tone="muted">
              {getSemanticIconDefinition('refresh').glyph}
            </AppText>
            <AppText style={styles.refreshText} tone="muted">
              {t('signalGap.refreshInterval', 'Refreshes every 5s')}
            </AppText>
          </View>
        </View>

        <View style={styles.controls}>
          <Input
            accessibilityLabel={t('signalGap.filterLabel', 'Filter signals')}
            containerStyle={styles.searchInput}
            onChangeText={setSearch}
            placeholder={t(
              'signalGap.filterPlaceholder',
              'Filter by signal name...',
            )}
            value={search}
          />
          <View style={styles.controlGroup}>
            <AppText style={styles.controlGlyph} tone="muted">
              {getSemanticIconDefinition('filter').glyph}
            </AppText>
            {(['all', 'stale', 'active'] as CatalogFilterMode[]).map(mode => (
              <ToggleChip
                key={mode}
                accent="cyan"
                active={filterMode === mode}
                label={
                  mode === 'all'
                    ? t('signalGap.all', 'All')
                    : mode === 'stale'
                    ? t('signalGap.staleOnly', 'Stale Only')
                    : t('signalGap.activeOnly', 'Active Only')
                }
                onPress={() => setFilterMode(mode)}
              />
            ))}
          </View>
          <View style={styles.controlGroup}>
            <AppText style={styles.controlGlyph} tone="muted">
              {getSemanticIconDefinition('arrowUpDown').glyph}
            </AppText>
            {(['staleness', 'alpha', 'category'] as CatalogSortMode[]).map(
              mode => (
                <ToggleChip
                  key={mode}
                  accent="violet"
                  active={sortMode === mode}
                  label={
                    mode === 'staleness'
                      ? t('signalGap.mostStale', 'Most Stale')
                      : mode === 'alpha'
                      ? t('signalGap.az', 'A-Z')
                      : t('signalGap.category', 'Category')
                  }
                  onPress={() => setSortMode(mode)}
                />
              ),
            )}
          </View>
        </View>

        <View style={styles.tableArea}>
          {isLoading ? (
            <View style={styles.skeletonStack}>
              {Array.from({length: 8}).map((_, i) => (
                <Skeleton key={i} height={48} />
              ))}
            </View>
          ) : filtered.length > 0 ? (
            <ScrollView
              style={[
                styles.tableViewport,
                {maxHeight: resolveMaxHeight(tableMaxHeight)},
              ]}>
              <DataTable<SignalRow>
                columns={columns}
                compact
                data={filtered}
                emptyMessage={t(
                  'signalGap.noMatch',
                  'No signals match current filters',
                )}
                keyExtractor={signal => signal.name}
                pagination={{defaultPageSize: 50}}
                tableId="telemetry:signal-catalog"
              />
            </ScrollView>
          ) : (
            <AppText style={styles.emptyMessage} tone="muted">
              {signals.length === 0
                ? t('signalGap.noData', 'No signal data available')
                : t('signalGap.noMatch', 'No signals match current filters')}
            </AppText>
          )}

          {dataUpdatedAt > 0 ? (
            <View style={styles.refreshedRow}>
              <AppText style={styles.refreshedText} tone="muted">
                {`${t('signalGap.lastRefreshed', 'Last refreshed')}: `}
              </AppText>
              <TimeStamp
                format="relative"
                style={styles.refreshedText}
                value={new Date(dataUpdatedAt)}
              />
            </View>
          ) : null}
        </View>
      </GlassPanel>
    </View>
  );
}

/* ─── icon tone tints (StatCard boxed glyph) ───────────────────────────── */

interface IconTint {
  fg: string;
  bg: string;
  border: string;
}

const ICON_TONE_TINT: Record<string, IconTint> = {
  accent: {fg: colors.accent, bg: colors.accentSoft, border: colors.borderAccent},
  success: {
    fg: colors.success,
    bg: colors.successSurface,
    border: colors.successBorder,
  },
  warning: {
    fg: colors.warning,
    bg: colors.warningSurface,
    border: colors.warningBorder,
  },
  danger: {fg: colors.danger, bg: colors.dangerSurface, border: colors.dangerBorder},
  violet: {fg: colors.violet, bg: colors.violetSurface, border: colors.violetBorder},
  neutral: {fg: colors.textSecondary, bg: colors.surfaceRaised, border: colors.border},
};

const MONO_FONT = Platform.select({
  ios: 'Courier New',
  android: 'monospace',
  default: 'monospace',
});

const styles = StyleSheet.create({
  root: {
    gap: spacing.md,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  summaryCell: {
    flexGrow: 1,
    flexBasis: '46%',
    minWidth: 140,
  },
  statCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
  },
  statBody: {
    flex: 1,
    minWidth: 0,
  },
  statLabel: {
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: spacing.xs,
  },
  statValue: {
    color: colors.textPrimary,
    fontSize: 20,
    lineHeight: 26,
  },
  statIconBox: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
  },
  statIconGlyph: {
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.4,
  },
  panel: {
    padding: spacing.md,
  },
  panelHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  panelHeaderRight: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
  },
  refreshGlyph: {
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.4,
  },
  refreshText: {
    fontSize: 10,
    lineHeight: 14,
  },
  controls: {
    gap: spacing.sm,
  },
  searchInput: {
    width: '100%',
  },
  controlGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
  },
  controlGlyph: {
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0.4,
    marginRight: spacing.xs,
  },
  chip: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    minHeight: 32,
    justifyContent: 'center',
  },
  chipInactive: {
    backgroundColor: 'transparent',
    borderColor: colors.border,
  },
  chipPressed: {
    opacity: 0.72,
  },
  chipText: {
    fontSize: 12,
    lineHeight: 16,
  },
  tableArea: {
    marginTop: spacing.md,
  },
  skeletonStack: {
    gap: spacing.sm,
  },
  tableViewport: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
  },
  table: {
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    paddingHorizontal: spacing.sm,
  },
  rowComfortable: {
    paddingVertical: spacing.sm,
  },
  rowCompact: {
    paddingVertical: spacing.xs,
  },
  headerRowTable: {
    backgroundColor: colors.surfaceSelected,
  },
  bodyRow: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  cell: {
    minWidth: 0,
    justifyContent: 'center',
    paddingRight: spacing.xs,
  },
  cellFlex: {
    flex: 1,
  },
  cellRight: {
    alignItems: 'flex-end',
  },
  headerText: {
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    fontSize: 11,
  },
  signalText: {
    fontFamily: MONO_FONT,
    fontSize: 12,
    color: colors.textPrimary,
  },
  valueText: {
    fontFamily: MONO_FONT,
    fontSize: 12,
    color: colors.textSecondary,
  },
  updatedText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  sinceText: {
    fontFamily: MONO_FONT,
    fontSize: 12,
  },
  tableEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  tableEmptyText: {
    textAlign: 'center',
  },
  emptyMessage: {
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  badgeText: {
    fontSize: 12,
    lineHeight: 16,
  },
  checkbox: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 6,
  },
  checkboxDefault: {
    borderColor: 'rgba(255, 255, 255, 0.06)',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
  },
  checkboxChecked: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.accentSoft,
  },
  checkboxDisabled: {
    borderColor: 'rgba(255, 255, 255, 0.04)',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    opacity: 0.4,
  },
  checkboxGlyph: {
    fontSize: 12,
    lineHeight: 16,
  },
  pager: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
  },
  pagerBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  pagerBtnDisabled: {
    opacity: 0.4,
  },
  pagerBtnPressed: {
    opacity: 0.7,
  },
  pagerLabel: {
    minWidth: 96,
    textAlign: 'center',
  },
  refreshedRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    alignItems: 'center',
    marginTop: spacing.md,
  },
  refreshedText: {
    fontSize: 10,
    lineHeight: 14,
  },
});
