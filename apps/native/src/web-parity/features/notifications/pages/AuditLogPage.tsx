// Native parity port of web/src/features/notifications/pages/AuditLogPage.tsx.
//
// AuditLogPage — searchable view of system-level audit entries. Reads from the
// same useAuditLogs() hook (GET /api/v1/system/audit) and renders the same
// search + active-filter-chip + DataTable combo at the dedicated
// /notifications/audit URL. Every web behaviour is preserved one-for-one:
//   - State names: `search` (useState('')) and the derived `searchFields`
//     (['action','resource','details'] keyof AuditLogEntry) + `filtered`
//     (useFilteredList) memo are kept verbatim, including the loading / error /
//     has-rows / empty render branches.
//   - The four columns (time / action / resource / details) keep their keys,
//     headers (t-wrapped), and the exact field each renders (createdAt via
//     formatDateTime, action, resource, details) plus their visual intent
//     (mono+muted time, primary action, mono+cyan resource, muted+truncated
//     detail).
//   - DataTable props are preserved: tableId 'audit-logs', keyExtractor
//     String(log.id), compact, exportable, exportFilename 'audit-logs', and
//     pagination {defaultPageSize: 50}.
//   - Audit rows carry no physical units, so there is no unit conversion.
//   - Every i18n key keeps its English default string (intent preserved).
//
// Web dependencies absent from the native parity manifest are remapped to
// native-safe equivalents (contract rules 4, 5 & 7) and documented here:
//   - react-i18next useTranslation -> inlined useNativeTranslation(): a stable
//     (key, fallback?, options?) => fallback ?? key shim that also reproduces
//     i18next `{{name}}` interpolation. Single-arg t('Audit Log') calls return
//     the English key, two-arg calls return the English fallback.
//   - lucide-react Clock / AlertTriangle -> SemanticIcon glyphs `clock` and
//     `warning`.
//   - @/components/layout PageContainer -> inline native PageContainer
//     (ScrollView page with title + subtitle and a max-width 1024 centred
//     content column, mirroring the web max-w-5xl mx-auto wrapper).
//   - @/components/ui GlassPanel -> the existing native GlassPanel.
//   - @/components/ui DataTable(+Column) -> an inline native DataTable that
//     supports the subset this page uses: column render fns, a horizontal
//     scroll over fixed-width columns, client pagination (data sliced to
//     defaultPageSize per page, matching the web data.slice((page-1)*size...)),
//     and CSV export. The web's per-tableId localStorage column layout /
//     widths / visibility have no native analogue and are accepted-but-noop.
//   - @/components/feedback Skeleton -> inline native Skeleton (token bar).
//   - @/components/motion FadeIn -> Animated.View opacity 0->1 mount fade.
//   - @/components/forms SearchInput / FilterBar / ActiveFilterChips
//     (+FilterChipDescriptor) -> inline native SearchInput (TextInput + search
//     glyph; the web search-history `historyScope` is web-only and dropped),
//     FilterBar (row View), and a removable ActiveFilterChips row.
//   - @/hooks/useFilteredList -> ported verbatim.
//   - @/hooks/usePageTitle -> native-safe usePageTitle (feature-detects
//     document.title; writes "{title} — TeslaSync").
//   - @/lib/dateFormat formatDateTime -> ported faithfully (host-default
//     locale, same Intl options, '—' for empty/invalid).
//   - @/lib/csvExport escapeCell/toCSV/defaultExportFilename/downloadCSV ->
//     ported; the browser Blob+anchor download is feature-detected and falls
//     back to clipboard, then to an explicit 'Unavailable' export state on
//     bare native (contract rules 4 & 7). Like the web page (which passes no
//     exportRow), the default export accessor is a shallow row[col.key] lookup,
//     so the synthetic 'time' column exports empty exactly as on web.
//   - @/api/hooks/useAdmin useAuditLogs (+AuditLogEntry) -> imported from the
//     already-ported native web-parity hook; API path '/system/audit', query
//     key and AuditLogEntry shape are unchanged.
//
// No DOM-only modules, HTML elements, react-i18next, lucide-react, Recharts,
// Leaflet, or web UI components are imported.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Animated,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {SemanticIcon, type SemanticIconName} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';

import {useAuditLogs, type AuditLogEntry} from '../../../api/hooks/useAdmin';

/* ─── shared types ────────────────────────────────────────────────────── */

type NativeTOptions = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallback?: string,
  options?: NativeTOptions,
) => string;

type RowKey = string | number;
type ButtonVariant = 'primary' | 'secondary' | 'ghost';
type ExportStatus = 'idle' | 'exported' | 'copied' | 'unavailable';
type ClipboardWriter = (value: string) => Promise<boolean>;
type CsvDownloader = (filename: string, csv: string) => void;
type CsvCellValue = string | number | boolean | null | undefined | object;

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: 'left' | 'center' | 'right';
  width?: number;
}

interface CsvColumn<T> {
  key: string;
  header?: string;
  accessor?: (row: T) => CsvCellValue;
}

/** Mirrors the web @/components/forms FilterChipDescriptor used by the page. */
interface FilterChipDescriptor {
  key: string;
  label: string;
  value: string;
  onRemove: () => void;
}

/** Web @/components/ui DataTable PaginationConfig (subset used here). */
interface PaginationConfig {
  defaultPageSize?: number;
}

const DEFAULT_COL_WIDTH = 160;

const MONO_FONT = Platform.select({
  ios: 'Menlo',
  macos: 'Menlo',
  android: 'monospace',
  windows: 'Consolas',
  default: 'monospace',
});

/* ─── i18n shim (react-i18next useTranslation) ────────────────────────── */

// Returns the English fallback the source passes (or the key itself for the
// single-argument t('Audit Log') calls), with i18next `{{name}}` interpolation
// applied against that text when an options bag is supplied.
function useNativeTranslation(): NativeTFunction {
  return useCallback(
    (key: string, fallback?: string, options?: NativeTOptions) => {
      const base = fallback ?? key;
      if (!options) {
        return base;
      }
      return Object.keys(options).reduce(
        (text, name) => text.split(`{{${name}}}`).join(String(options[name])),
        base,
      );
    },
    [],
  );
}

/* ─── usePageTitle shim (web @/hooks/usePageTitle) ────────────────────── */

// document.title exists on react-native-web but not on bare native, so the
// write is feature-detected. Mirrors the web "{title} — TeslaSync" format and
// restores the previous title on unmount.
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

/* ─── date formatting (ported from @/lib/dateFormat) ──────────────────── */

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

/* ─── CSV helpers (ported from @/lib/csvExport) ───────────────────────── */

function escapeCell(value: CsvCellValue): string {
  if (value === null || value === undefined) return '';

  let str: string;
  if (typeof value === 'string') {
    str = value;
  } else if (typeof value === 'number' || typeof value === 'boolean') {
    str = String(value);
  } else {
    try {
      str = JSON.stringify(value);
    } catch {
      str = String(value);
    }
  }

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
            : (row as unknown as Record<string, unknown>)[c.key];
          return escapeCell(v as CsvCellValue);
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
// on bare native). Returns null when unavailable so callers can surface an
// explicit unavailable state instead of a silent failure.
function getClipboardWriter(): ClipboardWriter | null {
  const nav = (
    globalThis as {
      navigator?: {clipboard?: {writeText?: (value: string) => Promise<void>}};
    }
  ).navigator;
  const clipboard = nav?.clipboard;
  const writeText = clipboard?.writeText;
  if (typeof writeText !== 'function') {
    return null;
  }
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
// Mirrors @/lib/csvExport downloadCSV including the UTF-8 BOM. Returns null on
// bare native where document/Blob/URL are unavailable.
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

/* ─── FadeIn (web @/components/motion FadeIn) ─────────────────────────── */

function FadeIn({children}: {children: ReactNode}) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(opacity, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [opacity]);

  return <Animated.View style={{opacity}}>{children}</Animated.View>;
}

/* ─── Button (web @/components/ui Button, used subset) ────────────────── */

function Button({
  label,
  onPress,
  variant = 'ghost',
  disabled = false,
  icon,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  icon?: SemanticIconName;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{disabled}}
      disabled={disabled}
      hitSlop={4}
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        buttonSurfaceStyles[variant],
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.pressed,
      ]}>
      {icon ? <SemanticIcon decorative name={icon} size="sm" style={styles.buttonIcon} /> : null}
      <AppText style={buttonTextStyles[variant]} variant="caption" weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

/* ─── Skeleton (web @/components/feedback Skeleton) ───────────────────── */

function Skeleton({height = 32}: {height?: number}) {
  return <View style={[styles.skeleton, {height}]} />;
}

/* ─── SearchInput (web @/components/forms SearchInput) ────────────────── */

// The web search-history dropdown (historyScope) has no native analogue and is
// dropped; the value/onChange/placeholder contract is preserved.
function SearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
}) {
  return (
    <View style={styles.searchField}>
      <SemanticIcon decorative name="search" size="sm" style={styles.searchIcon} />
      <TextInput
        accessibilityLabel={placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        style={styles.searchInput}
        value={value}
      />
    </View>
  );
}

/* ─── FilterBar (web @/components/forms FilterBar) ────────────────────── */

function FilterBar({children}: {children: ReactNode}) {
  return <View style={styles.filterBar}>{children}</View>;
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

/* ─── PageContainer (web @/components/layout PageContainer) ───────────── */

function PageContainer({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.pageContent}
      style={styles.page}
      keyboardShouldPersistTaps="handled">
      <View style={styles.contentMax}>
        <View style={styles.pageHeader}>
          <AppText style={styles.pageTitle} variant="title" weight="bold">
            {title}
          </AppText>
          {subtitle ? (
            <AppText style={styles.pageSubtitle} tone="muted" variant="caption">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {children}
      </View>
    </ScrollView>
  );
}

/* ─── DataTable (web @/components/ui DataTable, used subset) ──────────── */

function cellAlignStyles(align?: 'left' | 'center' | 'right'): ViewStyle {
  if (align === 'right') return styles.cellAlignRight;
  if (align === 'center') return styles.cellAlignCenter;
  return styles.cellAlignLeft;
}

function DataTable<T>({
  columns,
  data,
  keyExtractor,
  emptyMessage,
  compact = false,
  exportable = false,
  exportFilename,
  exportRow,
  pagination,
}: {
  tableId?: string;
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T) => RowKey;
  emptyMessage?: string;
  compact?: boolean;
  exportable?: boolean;
  exportFilename?: string;
  exportRow?: (row: T) => Record<string, CsvCellValue>;
  pagination?: boolean | PaginationConfig;
}) {
  const t = useNativeTranslation();
  const [exportStatus, setExportStatus] = useState<ExportStatus>('idle');
  const [page, setPage] = useState(1);
  const resetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetRef.current) {
        clearTimeout(resetRef.current);
      }
    };
  }, []);

  const paginationEnabled = !!pagination;
  const pageSize =
    (typeof pagination === 'object' ? pagination.defaultPageSize : undefined) ?? 25;
  const totalPages = paginationEnabled ? Math.max(1, Math.ceil(data.length / pageSize)) : 1;

  // Keep the active page in range when the underlying (filtered) data shrinks.
  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const pageData = paginationEnabled
    ? data.slice((page - 1) * pageSize, page * pageSize)
    : data;

  const totalWidth = columns.reduce(
    (sum, col) => sum + (col.width ?? DEFAULT_COL_WIDTH),
    0,
  );

  const scheduleReset = useCallback(() => {
    if (resetRef.current) {
      clearTimeout(resetRef.current);
    }
    resetRef.current = setTimeout(() => setExportStatus('idle'), 2000);
  }, []);

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

    const download = getCsvDownloader();
    if (download) {
      download(filenameBase, csv);
      setExportStatus('exported');
      scheduleReset();
      return;
    }
    const writer = getClipboardWriter();
    if (writer) {
      void writer(csv).then(ok => {
        setExportStatus(ok ? 'copied' : 'unavailable');
        scheduleReset();
      });
      return;
    }
    setExportStatus('unavailable');
    scheduleReset();
  }, [columns, data, exportFilename, exportRow, scheduleReset]);

  const exportLabel =
    exportStatus === 'exported'
      ? t('table.export.done', 'Exported')
      : exportStatus === 'copied'
        ? t('table.export.copied', 'Copied CSV')
        : exportStatus === 'unavailable'
          ? t('table.export.unavailable', 'Unavailable')
          : t('table.export.csvButton', 'Download CSV');

  const from = data.length === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, data.length);

  return (
    <View style={styles.table}>
      {exportable ? (
        <View style={styles.tableToolbar}>
          <Button
            disabled={data.length === 0}
            icon="download"
            label={exportLabel}
            onPress={handleExport}
            variant="ghost"
          />
        </View>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View style={{width: totalWidth}}>
          <View style={styles.tableHeaderRow}>
            {columns.map(col => (
              <View
                key={col.key}
                style={[
                  styles.headerCell,
                  {width: col.width ?? DEFAULT_COL_WIDTH},
                  cellAlignStyles(col.align),
                ]}>
                <AppText tone="muted" variant="caption" weight="semibold">
                  {col.header}
                </AppText>
              </View>
            ))}
          </View>

          {pageData.length === 0 ? (
            <View style={styles.tableEmptyRow}>
              <AppText tone="muted" variant="caption">
                {emptyMessage ?? t('common.noEntries', 'No entries')}
              </AppText>
            </View>
          ) : (
            pageData.map(row => (
              <View key={String(keyExtractor(row))} style={styles.tableRowGroup}>
                <View style={[styles.tableBodyRow, compact && styles.tableBodyRowCompact]}>
                  {columns.map(col => (
                    <View
                      key={col.key}
                      style={[
                        styles.bodyCell,
                        {width: col.width ?? DEFAULT_COL_WIDTH},
                        cellAlignStyles(col.align),
                      ]}>
                      {col.render(row)}
                    </View>
                  ))}
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      {paginationEnabled && totalPages > 1 ? (
        <View style={styles.pager}>
          <Button
            disabled={page <= 1}
            label={t('pagination.previous', 'Previous')}
            onPress={() => setPage(p => Math.max(1, p - 1))}
            variant="ghost"
          />
          <AppText style={styles.pagerInfo} tone="muted" variant="caption">
            {t('pagination.showing', 'Showing {{from}}–{{to}} of {{total}}', {
              from,
              to,
              total: data.length,
            })}
          </AppText>
          <Button
            disabled={page >= totalPages}
            label={t('pagination.next', 'Next')}
            onPress={() => setPage(p => Math.min(totalPages, p + 1))}
            variant="ghost"
          />
        </View>
      ) : null}
    </View>
  );
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

/* ─── page ────────────────────────────────────────────────────────────── */

export default function AuditLogPage() {
  const t = useNativeTranslation();
  usePageTitle(t('Audit Log'));
  const {data: auditLogs, isLoading, error} = useAuditLogs();

  const [search, setSearch] = useState('');
  const searchFields = useMemo(
    () =>
      ['action', 'resource', 'details'] as const satisfies ReadonlyArray<keyof AuditLogEntry>,
    [],
  );
  const filtered = useFilteredList(auditLogs, search, searchFields);

  const errorMessage = error instanceof Error ? error.message : error ? String(error) : '';

  const columns: Column<AuditLogEntry>[] = [
    {
      key: 'time',
      header: t('Time'),
      width: 170,
      render: log => (
        <AppText numberOfLines={1} style={styles.cellTime} variant="caption">
          {formatDateTime(log.createdAt)}
        </AppText>
      ),
    },
    {
      key: 'action',
      header: t('Action'),
      width: 160,
      render: log => <AppText style={styles.cellPrimary}>{log.action}</AppText>,
    },
    {
      key: 'resource',
      header: t('Resource'),
      width: 170,
      render: log => <AppText style={styles.cellResource}>{log.resource}</AppText>,
    },
    {
      key: 'details',
      header: t('Details'),
      width: 240,
      render: log => (
        <AppText numberOfLines={1} style={styles.cellMuted} variant="caption">
          {log.details}
        </AppText>
      ),
    },
  ];

  return (
    <PageContainer
      title={t('Audit Log')}
      subtitle={t('Recent system-level changes recorded by the audit subsystem')}>
      <FadeIn>
        <GlassPanel style={styles.panel}>
          <View style={styles.panelHeaderRow}>
            <SemanticIcon decorative name="clock" size="sm" style={styles.panelHeaderIcon} />
            <AppText style={styles.panelTitle} weight="semibold">
              {t('Recent Activity')}
            </AppText>
          </View>

          {isLoading ? (
            <View style={styles.loadingStack}>
              {[1, 2, 3, 4, 5].map(i => (
                <Skeleton key={i} height={32} />
              ))}
            </View>
          ) : error ? (
            <View style={styles.errorRow}>
              <SemanticIcon decorative name="warning" size="sm" style={styles.errorIcon} />
              <AppText style={styles.errorText} tone="danger" variant="caption">
                {t('Failed to load audit logs')}: {errorMessage}
              </AppText>
            </View>
          ) : auditLogs?.length ? (
            <View style={styles.filterSection}>
              <FilterBar>
                <SearchInput
                  onChange={setSearch}
                  placeholder={t(
                    'audit.searchPlaceholder',
                    'Search by action, resource, or details…',
                  )}
                  value={search}
                />
              </FilterBar>
              <ActiveFilterChips
                filters={
                  search
                    ? [
                        {
                          key: 'q',
                          label: t('audit.filterLabel.search', 'Search'),
                          value: search,
                          onRemove: () => setSearch(''),
                        },
                      ]
                    : []
                }
                onClearAll={() => setSearch('')}
              />
              {filtered.length > 0 ? (
                <DataTable
                  columns={columns}
                  compact
                  data={filtered}
                  exportFilename="audit-logs"
                  exportable
                  keyExtractor={log => String(log.id)}
                  pagination={{defaultPageSize: 50}}
                  tableId="audit-logs"
                />
              ) : (
                <AppText style={styles.noticeText} tone="muted" variant="caption">
                  {t('audit.noMatches', 'No audit entries match your search.')}
                </AppText>
              )}
            </View>
          ) : (
            <AppText style={styles.noticeText} tone="muted" variant="caption">
              {t('No audit entries found')}
            </AppText>
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}

/* ─── styles ──────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.background,
  },
  pageContent: {
    padding: spacing.lg,
  },
  contentMax: {
    width: '100%',
    maxWidth: 1024,
    alignSelf: 'center',
    gap: spacing.lg,
  },
  pageHeader: {
    gap: spacing.xs,
  },
  pageTitle: {
    color: colors.textPrimary,
  },
  pageSubtitle: {
    marginTop: spacing.xs,
  },
  panel: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  panelHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  panelHeaderIcon: {
    marginRight: 2,
  },
  panelTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
  },
  loadingStack: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 10,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  errorIcon: {
    marginRight: 2,
  },
  errorText: {
    flex: 1,
  },
  filterSection: {
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  filterBar: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  searchField: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
  },
  searchIcon: {
    marginRight: 2,
  },
  searchInput: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 14,
    paddingVertical: spacing.sm,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surfaceSelected,
    borderColor: colors.borderAccent,
    borderWidth: 1,
    borderRadius: 999,
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
  noticeText: {
    marginTop: spacing.xs,
  },
  table: {
    gap: spacing.sm,
  },
  tableToolbar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  tableHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: spacing.sm,
  },
  tableRowGroup: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tableBodyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  tableBodyRowCompact: {
    paddingVertical: spacing.xs,
  },
  tableEmptyRow: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  headerCell: {
    paddingHorizontal: spacing.sm,
  },
  bodyCell: {
    paddingHorizontal: spacing.sm,
  },
  cellAlignLeft: {
    alignItems: 'flex-start',
  },
  cellAlignCenter: {
    alignItems: 'center',
  },
  cellAlignRight: {
    alignItems: 'flex-end',
  },
  cellTime: {
    color: colors.textMuted,
    fontFamily: MONO_FONT,
  },
  cellPrimary: {
    color: colors.textPrimary,
  },
  cellResource: {
    color: colors.accent,
    fontFamily: MONO_FONT,
  },
  cellMuted: {
    color: colors.textMuted,
  },
  pager: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  pagerInfo: {
    flex: 1,
    textAlign: 'center',
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 32,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  buttonIcon: {
    width: 18,
    height: 18,
    borderRadius: 6,
  },
  buttonDisabled: {
    opacity: 0.48,
  },
  pressed: {
    opacity: 0.82,
  },
});

const buttonSurfaceStyles = StyleSheet.create<Record<ButtonVariant, ViewStyle>>({
  primary: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
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
  primary: {
    color: colors.background,
  },
  secondary: {
    color: colors.textPrimary,
  },
  ghost: {
    color: colors.accent,
  },
});
