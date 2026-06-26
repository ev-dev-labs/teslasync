// Native parity port of web/src/features/admin/pages/AuditLogPage.tsx.
//
// Audit-log browser + SHA-256 hash-chain verification surface. Every piece of
// behaviour from the web page is preserved one-for-one:
//   - All filter state names (since, until, category, action, actor, entityType,
//     limit, offset, expanded) and their empty-string-is-unset contract.
//   - The `queryParams` useMemo (Number(limit)/offset, ISO conversion of
//     since/until, single-element categories/actions/actors arrays, entity_type).
//   - The four TanStack queries (useAuditLog / useAuditCategories /
//     useAuditActions / useAuditChainVerify(null, 1000, false)) imported from the
//     ported native operator-confidence hook.
//   - subsystemMissing = isApiError(error) && status === 503.
//   - categoryOptions / actionOptions useMemos, handleReset, handleVerify,
//     toggleExpanded, the columns useMemo, and verifyData.
//   - The three GlassPanel sections (hash-chain integrity, filters, entries) plus
//     the expandable per-row ExpandedDetail drawer and CSV export.
//   - Every i18n key keeps its English default string (intent preserved).
//
// Web dependencies absent from the native parity manifest are remapped to
// native-safe equivalents (contract rules 4, 5 & 7) and documented in the
// sidecar:
//   - react-i18next useTranslation -> inlined useNativeTranslation(): a stable
//     (key, fallback, options?) => fallback shim that reproduces i18next
//     `{{name}}` interpolation against the English fallback copy (rowsChecked,
//     firstBadId, pageInfo).
//   - lucide-react History/ShieldCheck/ShieldAlert/Search/X -> shared
//     SemanticIcon glyphs (history / securityCheck / securityAlert / search /
//     close).
//   - @/components/layout PageContainer -> inline native PageContainer (title +
//     subtitle + query-driven freshness chip + error boundary wrapper).
//   - @/components/ui GlassPanel -> the existing native GlassPanel.
//   - @/components/ui Badge/Button/Input/Select/DataTable/CopyButton -> inline
//     native equivalents (label/icon prop APIs, TextInput-backed inputs, a
//     chip-row Select, and a horizontally scrolling expandable table).
//   - @/components/ui Typography PanelTitle/Caption -> AppText-based helpers.
//   - @/components/motion FadeIn -> Animated.View opacity 0->1 mount fade.
//   - @/components/feedback EmptyState/AlertBanner/SectionErrorBoundary -> inline
//     native EmptyState (icon+title+message), AlertBanner, and a class error
//     boundary.
//   - @/hooks/usePageTitle -> native-safe usePageTitle(): feature-detects
//     document.title (present on react-native-web, absent on bare native) and
//     writes "{title} — TeslaSync", mirroring the web titleStore format.
//   - @/lib/dateFormat formatDateTime/formatRelative -> inlined byte-for-byte.
//   - @/lib/resilience isApiError -> imported from the ported web-parity client.
//
// Browser-only behaviour is made native-safe with an explicit unavailable state:
//   - CSV export (web Blob + <a download>) -> feature-detected browser download;
//     when absent (bare native) it falls back to copying the CSV to the
//     clipboard, and when neither exists it surfaces an explicit "Unavailable"
//     export state instead of failing silently.
//   - <input type="datetime-local"> -> a TextInput whose placeholder documents
//     the expected `YYYY-MM-DDTHH:mm` shape; the value/onChange contract and the
//     downstream `new Date(value).toISOString()` parsing are preserved.
//
// CSS vars / Tailwind map to tokens: --text-primary/secondary/muted ->
// textPrimary/textSecondary/textMuted, --surface-overlay -> surfaceGlass,
// neon-* alert tints -> the matching token surfaces/borders, font-mono -> a
// Platform-selected monospace family. No DOM-only modules, HTML elements,
// Recharts, Leaflet, or web UI components are imported — only react, react-native
// primitives, and existing apps/native SemanticIcon / AppText / GlassPanel /
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

import {isApiError} from '../../../api/client';
import {
  useAuditActions,
  useAuditCategories,
  useAuditChainVerify,
  useAuditLog,
  type AuditLogQueryParams,
  type AuditLogRow,
} from '../../../api/hooks/useOperatorConfidence';

/* ─── shared types ────────────────────────────────────────────────────── */

type NativeTOptions = Record<string, string | number>;

type NativeTFunction = (
  key: string,
  fallback: string,
  options?: NativeTOptions,
) => string;

type BadgeVariant = 'info' | 'success' | 'warning' | 'danger' | 'neutral';
type BadgeSize = 'sm' | 'md' | 'lg';
type ButtonVariant = 'primary' | 'secondary' | 'ghost';
type ButtonSize = 'sm' | 'md';
type AlertVariant = 'info' | 'success' | 'warning' | 'danger';
type CopyStatus = 'idle' | 'copied' | 'unavailable';
type ExportStatus = 'idle' | 'exported' | 'copied' | 'unavailable';
type ClipboardWriter = (value: string) => Promise<boolean>;
type CsvDownloader = (filename: string, csv: string) => void;

type RowKey = string | number;

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: 'left' | 'center' | 'right';
  width?: number;
}

type CsvCellValue = string | number | boolean | null | undefined | object;

interface CsvColumn<T> {
  key: string;
  header?: string;
  accessor?: (row: T) => CsvCellValue;
}

interface FreshnessQueryLike {
  isFetching?: boolean;
  isError?: boolean;
  isStale?: boolean;
}

const LIMIT_OPTIONS = [
  {value: '50', label: '50'},
  {value: '100', label: '100'},
  {value: '250', label: '250'},
  {value: '500', label: '500'},
];

const DEFAULT_COL_WIDTH = 140;
const CHEVRON_COL_WIDTH = 44;

const MONO_FONT = Platform.select({
  ios: 'Menlo',
  macos: 'Menlo',
  android: 'monospace',
  windows: 'Consolas',
  default: 'monospace',
});

/* ─── i18n shim ───────────────────────────────────────────────────────── */

// react-i18next useTranslation replacement: returns the English fallback that
// the source passes as the second argument, with i18next `{{name}}`
// interpolation applied against that fallback when an options bag is supplied.
function useNativeTranslation(): NativeTFunction {
  return useCallback(
    (_key: string, fallback: string, options?: NativeTOptions) => {
      if (!options) {
        return fallback;
      }
      return Object.keys(options).reduce(
        (text, name) => text.split(`{{${name}}}`).join(String(options[name])),
        fallback,
      );
    },
    [],
  );
}

/* ─── usePageTitle shim ───────────────────────────────────────────────── */

// Native-safe port of @/hooks/usePageTitle. document.title exists on
// react-native-web but not on bare native, so the write is feature-detected.
// Mirrors the web titleStore "{title} — TeslaSync" format and restores the
// previous title on unmount.
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

function formatDate(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

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

function formatRelative(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const now = Date.now();
  const diff = now - d.getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(iso);
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

/* ─── native-safe clipboard + download ────────────────────────────────── */

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

/* ─── typography helpers (Typography PanelTitle / Caption) ────────────── */

function PanelTitle({children}: {children: ReactNode}) {
  return (
    <AppText style={styles.panelTitle} weight="bold">
      {children}
    </AppText>
  );
}

function Caption({children}: {children: ReactNode}) {
  return (
    <AppText tone="muted" variant="caption">
      {children}
    </AppText>
  );
}

/* ─── Badge (web @/components/ui Badge) ───────────────────────────────── */

function Badge({
  label,
  variant = 'neutral',
  size = 'md',
  icon,
}: {
  label: string;
  variant?: BadgeVariant;
  size?: BadgeSize;
  icon?: SemanticIconName;
}) {
  return (
    <View style={[styles.badge, badgeSurfaceStyles[variant], badgeSizeStyles[size]]}>
      {icon ? (
        <SemanticIcon decorative name={icon} size="sm" style={styles.badgeIcon} />
      ) : null}
      <AppText
        style={[badgeTextStyles[variant], size === 'lg' ? styles.badgeTextLg : styles.badgeTextSm]}
        weight="semibold">
        {label}
      </AppText>
    </View>
  );
}

/* ─── Button (web @/components/ui Button) ─────────────────────────────── */

function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  icon,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
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
        size === 'sm' ? styles.buttonSm : styles.buttonMd,
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

/* ─── Input (web @/components/ui Input) ───────────────────────────────── */

function Input({
  label,
  value,
  onChangeText,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
}) {
  return (
    <View style={styles.field}>
      <AppText style={styles.fieldLabel} tone="secondary" variant="caption" weight="semibold">
        {label}
      </AppText>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        value={value}
      />
    </View>
  );
}

/* ─── Select (web @/components/ui Select) ─────────────────────────────── */

// Native-safe replacement for the web <select> dropdown: a label plus a
// horizontally scrollable row of option chips. The selected option is
// highlighted; tapping a chip invokes onValueChange(value), preserving the web
// onChange(e => e.target.value) contract.
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
    <View style={styles.field}>
      <AppText style={styles.fieldLabel} tone="secondary" variant="caption" weight="semibold">
        {label}
      </AppText>
      <ScrollView
        horizontal
        keyboardShouldPersistTaps="handled"
        showsHorizontalScrollIndicator={false}
        style={styles.selectRow}>
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
                style={active ? styles.selectChipTextActive : styles.selectChipText}
                variant="caption"
                weight="semibold">
                {option.label}
              </AppText>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/* ─── CopyButton (web @/components/ui CopyButton) ─────────────────────── */

function CopyButton({text, iconOnly = false}: {text: string; iconOnly?: boolean}) {
  const t = useNativeTranslation();
  const [status, setStatus] = useState<CopyStatus>('idle');
  const resetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetRef.current) {
        clearTimeout(resetRef.current);
      }
    };
  }, []);

  const scheduleReset = useCallback(() => {
    if (resetRef.current) {
      clearTimeout(resetRef.current);
    }
    resetRef.current = setTimeout(() => setStatus('idle'), 2000);
  }, []);

  const handleCopy = useCallback(() => {
    const writer = getClipboardWriter();
    if (!writer) {
      setStatus('unavailable');
      scheduleReset();
      return;
    }
    void writer(text).then(ok => {
      setStatus(ok ? 'copied' : 'unavailable');
      scheduleReset();
    });
  }, [scheduleReset, text]);

  const label =
    status === 'copied'
      ? t('common.copied', 'Copied')
      : status === 'unavailable'
        ? t('common.copyUnavailable', 'Unavailable')
        : t('common.copy', 'Copy');

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      hitSlop={4}
      onPress={handleCopy}
      style={({pressed}) => [styles.copyButton, pressed && styles.pressed]}>
      <SemanticIcon
        decorative
        name={status === 'copied' ? 'confirm' : status === 'unavailable' ? 'error' : 'copy'}
        size="sm"
        style={styles.copyIcon}
      />
      {iconOnly ? null : (
        <AppText style={styles.copyLabel} tone="accent" variant="caption" weight="semibold">
          {label}
        </AppText>
      )}
    </Pressable>
  );
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

/* ─── EmptyState (web @/components/feedback EmptyState) ───────────────── */

function EmptyState({
  icon,
  title,
  message,
}: {
  icon?: SemanticIconName;
  title: string;
  message: string;
}) {
  return (
    <View accessibilityRole="summary" style={styles.emptyState}>
      {icon ? (
        <SemanticIcon decorative name={icon} size="lg" style={styles.emptyIcon} />
      ) : null}
      <AppText style={styles.emptyTitle} weight="bold">
        {title}
      </AppText>
      <AppText style={styles.emptyMessage} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

/* ─── AlertBanner (web @/components/feedback AlertBanner) ─────────────── */

function AlertBanner({
  variant,
  title,
  children,
}: {
  variant: AlertVariant;
  title?: string;
  children: ReactNode;
}) {
  return (
    <View style={[styles.alert, alertSurfaceStyles[variant]]}>
      {title ? (
        <AppText style={[styles.alertTitle, alertTitleStyles[variant]]} weight="semibold">
          {title}
        </AppText>
      ) : null}
      <AppText style={styles.alertBody} tone="secondary" variant="caption">
        {children}
      </AppText>
    </View>
  );
}

/* ─── SectionErrorBoundary (web @/components/feedback) ────────────────── */

class SectionErrorBoundary extends React.Component<
  {name?: string; fallback?: string; children: ReactNode},
  {hasError: boolean}
> {
  state = {hasError: false};

  static getDerivedStateFromError(): {hasError: boolean} {
    return {hasError: true};
  }

  componentDidCatch(): void {
    // Render-time crashes are contained to the wrapped section; the fallback
    // message replaces the subtree, mirroring the web SectionErrorBoundary.
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <AppText style={styles.boundaryFallback} tone="danger" variant="caption">
          {this.props.fallback ?? 'Something went wrong.'}
        </AppText>
      );
    }
    return this.props.children;
  }
}

/* ─── PageContainer (web @/components/layout PageContainer) ───────────── */

function FreshnessChip({query}: {query: FreshnessQueryLike}) {
  const t = useNativeTranslation();
  if (query.isError) {
    return <Badge label={t('common.freshness.error', 'Error')} variant="danger" size="sm" />;
  }
  if (query.isFetching) {
    return <Badge label={t('common.freshness.updating', 'Updating…')} variant="info" size="sm" />;
  }
  if (query.isStale) {
    return <Badge label={t('common.freshness.stale', 'Stale')} variant="warning" size="sm" />;
  }
  return <Badge label={t('common.freshness.live', 'Live')} variant="success" size="sm" />;
}

function PageContainer({
  title,
  subtitle,
  query,
  children,
}: {
  title: string;
  subtitle?: string;
  query?: FreshnessQueryLike | null;
  children: ReactNode;
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.pageContent}
      style={styles.page}
      keyboardShouldPersistTaps="handled">
      <View style={styles.pageHeader}>
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
        {query ? <FreshnessChip query={query} /> : null}
      </View>
      <SectionErrorBoundary name={title}>{children}</SectionErrorBoundary>
    </ScrollView>
  );
}

/* ─── DataTable (web @/components/ui DataTable, used subset) ──────────── */

function DataTable<T>({
  columns,
  data,
  keyExtractor,
  emptyMessage,
  expandable = false,
  expandedKeys = [],
  onExpandedChange,
  renderExpanded,
  exportable = false,
  exportFilename,
  exportRow,
}: {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T) => RowKey;
  emptyMessage?: string;
  expandable?: boolean;
  expandedKeys?: RowKey[];
  onExpandedChange?: (keys: RowKey[]) => void;
  renderExpanded?: (row: T) => ReactNode;
  exportable?: boolean;
  exportFilename?: string;
  exportRow?: (row: T) => Record<string, CsvCellValue>;
}) {
  const t = useNativeTranslation();
  const [exportStatus, setExportStatus] = useState<ExportStatus>('idle');
  const resetRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetRef.current) {
        clearTimeout(resetRef.current);
      }
    };
  }, []);

  const totalWidth =
    (expandable ? CHEVRON_COL_WIDTH : 0) +
    columns.reduce((sum, col) => sum + (col.width ?? DEFAULT_COL_WIDTH), 0);

  const toggleRow = useCallback(
    (key: RowKey) => {
      if (!onExpandedChange) return;
      onExpandedChange(
        expandedKeys.includes(key)
          ? expandedKeys.filter(k => k !== key)
          : [...expandedKeys, key],
      );
    },
    [expandedKeys, onExpandedChange],
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
          : t('table.export.csv', 'Export CSV');

  return (
    <View style={styles.table}>
      {exportable ? (
        <View style={styles.tableToolbar}>
          <Button
            disabled={data.length === 0}
            icon="download"
            label={exportLabel}
            onPress={handleExport}
            size="sm"
            variant="ghost"
          />
        </View>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View style={{width: totalWidth}}>
          <View style={styles.tableHeaderRow}>
            {expandable ? <View style={styles.chevronCell} /> : null}
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

          {data.length === 0 ? (
            <View style={styles.tableEmptyRow}>
              <AppText tone="muted" variant="caption">
                {emptyMessage ?? t('common.noEntries', 'No entries')}
              </AppText>
            </View>
          ) : (
            data.map(row => {
              const key = keyExtractor(row);
              const isOpen = expandedKeys.includes(key);
              return (
                <View key={String(key)} style={styles.tableRowGroup}>
                  <View style={styles.tableBodyRow}>
                    {expandable ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityState={{expanded: isOpen}}
                        hitSlop={4}
                        onPress={() => toggleRow(key)}
                        style={({pressed}) => [styles.chevronCell, pressed && styles.pressed]}>
                        <SemanticIcon
                          decorative
                          name={isOpen ? 'collapse' : 'next'}
                          size="sm"
                          style={styles.chevronIcon}
                        />
                      </Pressable>
                    ) : null}
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
                  {isOpen && renderExpanded ? (
                    <View style={[styles.expandedRow, {width: totalWidth}]}>
                      {renderExpanded(row)}
                    </View>
                  ) : null}
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
    </View>
  );
}

/* ─── page ────────────────────────────────────────────────────────────── */

export default function AuditLogPage() {
  const t = useNativeTranslation();
  usePageTitle(t('admin.auditLog.pageTitle', 'Audit Log'));

  // Filter state — string fields are empty=unset, never undefined,
  // so the controlled inputs stay controlled.
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');
  const [category, setCategory] = useState('');
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [entityType, setEntityType] = useState('');
  const [limit, setLimit] = useState('100');
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState<(string | number)[]>([]);

  const queryParams = useMemo<AuditLogQueryParams>(() => {
    const p: AuditLogQueryParams = {limit: Number(limit), offset};
    if (since) p.since = new Date(since).toISOString();
    if (until) p.until = new Date(until).toISOString();
    if (category) p.categories = [category];
    if (action) p.actions = [action];
    if (actor) p.actors = [actor];
    if (entityType) p.entity_type = entityType;
    return p;
  }, [since, until, category, action, actor, entityType, limit, offset]);

  const logQuery = useAuditLog(queryParams);
  const categoriesQuery = useAuditCategories();
  const actionsQuery = useAuditActions();
  const verifyQuery = useAuditChainVerify(null, 1000, false);

  const subsystemMissing = isApiError(logQuery.error) && logQuery.error.status === 503;

  const rows = logQuery.data?.rows ?? [];

  const categoryOptions = useMemo<{value: string; label: string}[]>(() => {
    const list = categoriesQuery.data?.categories ?? [];
    return [
      {value: '', label: t('admin.auditLog.allCategories', 'All categories')},
      ...list.map(c => ({value: c, label: c})),
    ];
  }, [categoriesQuery.data, t]);

  const actionOptions = useMemo<{value: string; label: string}[]>(() => {
    const list = actionsQuery.data?.actions ?? [];
    return [
      {value: '', label: t('admin.auditLog.allActions', 'All actions')},
      ...list.map(a => ({value: a, label: a})),
    ];
  }, [actionsQuery.data, t]);

  const handleReset = () => {
    setSince('');
    setUntil('');
    setCategory('');
    setAction('');
    setActor('');
    setEntityType('');
    setOffset(0);
  };

  const handleVerify = () => {
    verifyQuery.refetch();
  };

  const toggleExpanded = (id: number) => {
    setExpanded(prev => (prev.includes(id) ? prev.filter(k => k !== id) : [...prev, id]));
  };

  const columns = useMemo<Column<AuditLogRow>[]>(
    () => [
      {
        key: 'ts',
        header: t('admin.auditLog.colTs', 'Timestamp'),
        width: 170,
        render: r => (
          <View>
            <AppText style={styles.cellPrimary} variant="caption">
              {formatDateTime(r.ts)}
            </AppText>
            <Caption>{formatRelative(r.ts)}</Caption>
          </View>
        ),
      },
      {
        key: 'actor',
        header: t('admin.auditLog.colActor', 'Actor'),
        width: 150,
        render: r => (
          <AppText style={styles.cellPrimary} variant="caption">
            {r.actor || '—'}
          </AppText>
        ),
      },
      {
        key: 'category',
        header: t('admin.auditLog.colCategory', 'Category'),
        width: 130,
        render: r =>
          r.category ? (
            <Badge label={r.category} variant="neutral" />
          ) : (
            <AppText style={styles.cellMuted} variant="caption">
              —
            </AppText>
          ),
      },
      {
        key: 'action',
        header: t('admin.auditLog.colAction', 'Action'),
        width: 160,
        render: r => (
          <AppText style={styles.cellPrimary} variant="caption" weight="semibold">
            {r.action}
          </AppText>
        ),
      },
      {
        key: 'entity',
        header: t('admin.auditLog.colEntity', 'Entity'),
        width: 140,
        render: r => (
          <View>
            <AppText style={styles.cellPrimary} variant="caption">
              {r.entity_type}
            </AppText>
            {r.entity_id !== null && r.entity_id !== undefined ? (
              <Caption>{`#${r.entity_id}`}</Caption>
            ) : null}
          </View>
        ),
      },
      {
        key: 'detail',
        header: t('admin.auditLog.colDetail', 'Detail'),
        width: 240,
        render: r => (
          <AppText numberOfLines={2} style={styles.cellSecondary} variant="caption">
            {r.detail ?? '—'}
          </AppText>
        ),
      },
      {
        key: 'trace',
        header: t('admin.auditLog.colTrace', 'Trace'),
        width: 150,
        render: r =>
          r.trace_id ? (
            <View style={styles.traceCell}>
              <AppText style={styles.monoSecondary} variant="caption">
                {`${r.trace_id.slice(0, 8)}…`}
              </AppText>
              <CopyButton iconOnly text={r.trace_id} />
            </View>
          ) : (
            <AppText style={styles.cellMuted} variant="caption">
              —
            </AppText>
          ),
      },
      {
        key: 'success',
        header: t('admin.auditLog.colSuccess', 'Status'),
        align: 'right',
        width: 90,
        render: r => {
          if (r.success === false) return <Badge label="Fail" variant="danger" />;
          if (r.success === true) return <Badge label="OK" variant="success" />;
          return <Badge label="—" variant="neutral" />;
        },
      },
      {
        key: 'expand',
        header: '',
        align: 'right',
        width: 110,
        render: r => (
          <Button
            label={
              expanded.includes(r.id)
                ? t('admin.auditLog.hideDetails', 'Hide')
                : t('admin.auditLog.showDetails', 'Details')
            }
            onPress={() => toggleExpanded(r.id)}
            size="sm"
            variant="ghost"
          />
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, expanded],
  );

  const verifyData = verifyQuery.data;

  return (
    <PageContainer
      title={t('admin.auditLog.pageTitle', 'Audit Log')}
      subtitle={t(
        'admin.auditLog.subtitle',
        'Append-only audit ledger with SHA-256 hash chaining. Use the filter row to narrow scope and Verify Chain to re-derive integrity on demand.',
      )}
      query={logQuery}>
      <FadeIn>
        <View style={styles.stack}>
          {subsystemMissing ? (
            <AlertBanner
              title={t('admin.subsystem.unavailableTitle', 'Subsystem unavailable')}
              variant="warning">
              {t(
                'admin.auditLog.notConfigured',
                'The audit log subsystem is not configured on this deployment.',
              )}
            </AlertBanner>
          ) : null}

          <GlassPanel style={styles.panel}>
            <View style={styles.panelHeaderRow}>
              <PanelTitle>
                {t('admin.auditLog.integrityTitle', 'Hash chain integrity')}
              </PanelTitle>
              <Button
                disabled={verifyQuery.isFetching}
                label={
                  verifyQuery.isFetching
                    ? t('admin.auditLog.verifying', 'Verifying…')
                    : t('admin.auditLog.verifyButton', 'Verify chain')
                }
                onPress={handleVerify}
                size="sm"
                variant="secondary"
              />
            </View>
            {!verifyData && !verifyQuery.isFetching ? (
              <Caption>
                {t(
                  'admin.auditLog.verifyHint',
                  'Triggers a server-side re-derivation of every row_hash. No data is sent or written; this is read-only.',
                )}
              </Caption>
            ) : null}
            {verifyQuery.error ? (
              <AlertBanner
                title={t('admin.auditLog.verifyErrorTitle', 'Verification failed')}
                variant="danger">
                {verifyQuery.error.message}
              </AlertBanner>
            ) : null}
            {verifyData ? (
              <View style={styles.verifyResultRow}>
                {verifyData.intact ? (
                  <Badge
                    icon="securityCheck"
                    label={t('admin.auditLog.chainIntact', 'Chain intact')}
                    size="lg"
                    variant="success"
                  />
                ) : (
                  <Badge
                    icon="securityAlert"
                    label={t('admin.auditLog.chainBroken', 'Chain broken')}
                    size="lg"
                    variant="danger"
                  />
                )}
                <Caption>
                  {t('admin.auditLog.rowsChecked', '{{count}} rows checked', {
                    count: verifyData.rows_checked,
                  })}
                </Caption>
                {!verifyData.intact && verifyData.first_bad_id > 0 ? (
                  <Caption>
                    {t('admin.auditLog.firstBadId', 'First bad row: #{{id}}', {
                      id: verifyData.first_bad_id,
                    })}
                  </Caption>
                ) : null}
              </View>
            ) : null}
          </GlassPanel>

          <GlassPanel style={styles.panel}>
            <View style={styles.filtersTitle}>
              <PanelTitle>{t('admin.auditLog.filtersTitle', 'Filters')}</PanelTitle>
            </View>
            <View style={styles.filtersGrid}>
              <Input
                label={t('admin.auditLog.sinceLabel', 'Since')}
                onChangeText={text => {
                  setSince(text);
                  setOffset(0);
                }}
                placeholder="YYYY-MM-DDTHH:mm"
                value={since}
              />
              <Input
                label={t('admin.auditLog.untilLabel', 'Until')}
                onChangeText={text => {
                  setUntil(text);
                  setOffset(0);
                }}
                placeholder="YYYY-MM-DDTHH:mm"
                value={until}
              />
              <Select
                label={t('admin.auditLog.categoryLabel', 'Category')}
                onValueChange={next => {
                  setCategory(next);
                  setOffset(0);
                }}
                options={categoryOptions}
                value={category}
              />
              <Select
                label={t('admin.auditLog.actionLabel', 'Action')}
                onValueChange={next => {
                  setAction(next);
                  setOffset(0);
                }}
                options={actionOptions}
                value={action}
              />
              <Input
                label={t('admin.auditLog.actorLabel', 'Actor')}
                onChangeText={text => {
                  setActor(text);
                  setOffset(0);
                }}
                placeholder={t('admin.auditLog.actorPlaceholder', 'e.g. admin@local')}
                value={actor}
              />
              <Input
                label={t('admin.auditLog.entityTypeLabel', 'Entity type')}
                onChangeText={text => {
                  setEntityType(text);
                  setOffset(0);
                }}
                placeholder={t('admin.auditLog.entityTypePlaceholder', 'e.g. vehicle, alert_rule')}
                value={entityType}
              />
              <Select
                label={t('admin.auditLog.limitLabel', 'Rows per page')}
                onValueChange={next => {
                  setLimit(next);
                  setOffset(0);
                }}
                options={LIMIT_OPTIONS}
                value={limit}
              />
              <View style={styles.filterActions}>
                <Button
                  icon="close"
                  label={t('admin.auditLog.resetFilters', 'Reset')}
                  onPress={handleReset}
                  size="md"
                  variant="ghost"
                />
                <Button
                  icon="search"
                  label={t('admin.auditLog.applyFilters', 'Search')}
                  onPress={() => logQuery.refetch()}
                  size="md"
                  variant="primary"
                />
              </View>
            </View>
          </GlassPanel>

          <GlassPanel style={styles.panel}>
            <View style={styles.panelHeaderRow}>
              <PanelTitle>{t('admin.auditLog.tableTitle', 'Entries')}</PanelTitle>
              <View style={styles.pager}>
                <Button
                  disabled={offset === 0}
                  label={t('admin.auditLog.prevPage', 'Previous')}
                  onPress={() => setOffset(Math.max(0, offset - Number(limit)))}
                  size="sm"
                  variant="ghost"
                />
                <Caption>
                  {t('admin.auditLog.pageInfo', 'Showing {{from}}–{{to}}', {
                    from: rows.length === 0 ? 0 : offset + 1,
                    to: offset + rows.length,
                  })}
                </Caption>
                <Button
                  disabled={rows.length < Number(limit)}
                  label={t('admin.auditLog.nextPage', 'Next')}
                  onPress={() => setOffset(offset + Number(limit))}
                  size="sm"
                  variant="ghost"
                />
              </View>
            </View>
            <SectionErrorBoundary name="audit-log-table">
              {rows.length === 0 && !logQuery.isLoading && !subsystemMissing ? (
                // no-action: filter controls live at the top of the page; the message guides users to widen or clear them
                <EmptyState
                  icon="history"
                  message={t(
                    'admin.auditLog.emptyMessage',
                    'No rows match the current filter. Try widening the time range or clearing the filters.',
                  )}
                  title={t('admin.auditLog.emptyTitle', 'No audit entries')}
                />
              ) : (
                <DataTable
                  columns={columns}
                  data={rows}
                  emptyMessage={t('admin.auditLog.emptyTable', 'No entries')}
                  expandable
                  expandedKeys={expanded}
                  exportFilename={`audit-log-${new Date().toISOString().slice(0, 10)}`}
                  exportRow={row => ({
                    id: row.id,
                    ts: row.ts,
                    actor: row.actor,
                    category: row.category ?? '',
                    action: row.action,
                    entity_type: row.entity_type,
                    entity_id: row.entity_id ?? '',
                    detail: row.detail ?? '',
                    ip: row.ip ?? '',
                    user_agent: row.user_agent ?? '',
                    trace_id: row.trace_id ?? '',
                    success:
                      row.success === null || row.success === undefined
                        ? ''
                        : String(row.success),
                    prev_row_hash: row.prev_row_hash ?? '',
                    row_hash: row.row_hash ?? '',
                  })}
                  exportable
                  keyExtractor={r => r.id}
                  onExpandedChange={next => setExpanded(next)}
                  renderExpanded={r => <ExpandedDetail row={r} />}
                />
              )}
            </SectionErrorBoundary>
          </GlassPanel>
        </View>
      </FadeIn>
    </PageContainer>
  );
}

function ExpandedDetail({row}: {row: AuditLogRow}) {
  const t = useNativeTranslation();
  return (
    <View style={styles.detailGrid}>
      <View style={styles.detailItem}>
        <Caption>{t('admin.auditLog.detailIp', 'IP')}</Caption>
        <AppText style={styles.monoPrimary} variant="caption">
          {row.ip ?? '—'}
        </AppText>
      </View>
      <View style={styles.detailItem}>
        <Caption>{t('admin.auditLog.detailUa', 'User-agent')}</Caption>
        <AppText style={styles.cellPrimary} variant="caption">
          {row.user_agent ?? '—'}
        </AppText>
      </View>
      {row.trace_id ? (
        <View style={styles.detailItemFull}>
          <Caption>{t('admin.auditLog.detailTrace', 'Trace ID')}</Caption>
          <View style={styles.traceCell}>
            <AppText style={styles.monoPrimary} variant="caption">
              {row.trace_id}
            </AppText>
            <CopyButton iconOnly text={row.trace_id} />
          </View>
        </View>
      ) : null}
      {row.before ? (
        <View style={styles.detailItem}>
          <Caption>{t('admin.auditLog.detailBefore', 'Before')}</Caption>
          <ScrollView style={styles.jsonBlock}>
            <AppText style={styles.monoPrimary} variant="caption">
              {formatJSON(row.before)}
            </AppText>
          </ScrollView>
        </View>
      ) : null}
      {row.after ? (
        <View style={styles.detailItem}>
          <Caption>{t('admin.auditLog.detailAfter', 'After')}</Caption>
          <ScrollView style={styles.jsonBlock}>
            <AppText style={styles.monoPrimary} variant="caption">
              {formatJSON(row.after)}
            </AppText>
          </ScrollView>
        </View>
      ) : null}
      {row.row_hash ? (
        <View style={styles.detailItemFull}>
          <Caption>{t('admin.auditLog.detailHash', 'Row hash')}</Caption>
          <View style={styles.traceCell}>
            <AppText style={styles.monoSecondary} variant="caption">
              {row.row_hash}
            </AppText>
            <CopyButton iconOnly text={row.row_hash} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function formatJSON(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/* ─── style helpers ───────────────────────────────────────────────────── */

function cellAlignStyles(align?: 'left' | 'center' | 'right'): ViewStyle {
  if (align === 'right') return styles.cellAlignRight;
  if (align === 'center') return styles.cellAlignCenter;
  return styles.cellAlignLeft;
}

/* ─── styles ──────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.background,
  },
  pageContent: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  pageHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  pageTitle: {
    color: colors.textPrimary,
  },
  pageSubtitle: {
    marginTop: spacing.xs,
  },
  stack: {
    gap: spacing.lg,
  },
  panel: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  panelHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  panelTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
  },
  filtersTitle: {
    marginBottom: spacing.xs,
  },
  filtersGrid: {
    gap: spacing.md,
  },
  filterActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  field: {
    gap: spacing.xs,
  },
  fieldLabel: {
    marginBottom: 2,
  },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    color: colors.textPrimary,
    backgroundColor: colors.surfaceRaised,
    fontSize: 14,
  },
  selectRow: {
    flexGrow: 0,
  },
  selectChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    marginRight: spacing.sm,
    backgroundColor: colors.surfaceRaised,
  },
  selectChipActive: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.surfaceSelected,
  },
  selectChipText: {
    color: colors.textSecondary,
  },
  selectChipTextActive: {
    color: colors.accent,
  },
  verifyResultRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.md,
  },
  pager: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: 999,
  },
  badgeIcon: {
    width: 18,
    height: 18,
    borderRadius: 6,
  },
  badgeTextSm: {
    fontSize: 11,
    lineHeight: 16,
  },
  badgeTextLg: {
    fontSize: 13,
    lineHeight: 18,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    borderRadius: 12,
    borderWidth: 1,
  },
  buttonSm: {
    minHeight: 32,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  buttonMd: {
    minHeight: 40,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
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
  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  copyIcon: {
    width: 22,
    height: 22,
    borderRadius: 8,
  },
  copyLabel: {
    color: colors.accent,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  emptyIcon: {
    marginBottom: spacing.xs,
  },
  emptyTitle: {
    color: colors.textPrimary,
  },
  emptyMessage: {
    textAlign: 'center',
    maxWidth: 360,
  },
  alert: {
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: 16,
    padding: spacing.md,
  },
  alertTitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  alertBody: {
    color: colors.textSecondary,
  },
  boundaryFallback: {
    paddingVertical: spacing.md,
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
  chevronCell: {
    width: CHEVRON_COL_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevronIcon: {
    width: 22,
    height: 22,
    borderRadius: 8,
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
  expandedRow: {
    paddingVertical: spacing.md,
    backgroundColor: colors.surfaceGlass,
  },
  cellPrimary: {
    color: colors.textPrimary,
  },
  cellSecondary: {
    color: colors.textSecondary,
  },
  cellMuted: {
    color: colors.textMuted,
  },
  traceCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  monoPrimary: {
    color: colors.textPrimary,
    fontFamily: MONO_FONT,
  },
  monoSecondary: {
    color: colors.textSecondary,
    fontFamily: MONO_FONT,
  },
  detailGrid: {
    gap: spacing.md,
    paddingHorizontal: spacing.md,
  },
  detailItem: {
    gap: spacing.xs,
  },
  detailItemFull: {
    gap: spacing.xs,
  },
  jsonBlock: {
    maxHeight: 256,
    borderRadius: 10,
    padding: spacing.md,
    backgroundColor: colors.surfaceGlass,
  },
});

const badgeSurfaceStyles = StyleSheet.create<Record<BadgeVariant, ViewStyle>>({
  info: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.accentSoft,
  },
  success: {
    borderColor: colors.successBorder,
    backgroundColor: colors.successSurface,
  },
  warning: {
    borderColor: colors.warningBorder,
    backgroundColor: colors.warningSurface,
  },
  danger: {
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerSurface,
  },
  neutral: {
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
});

const badgeSizeStyles = StyleSheet.create<Record<BadgeSize, ViewStyle>>({
  sm: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  md: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  lg: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
});

const badgeTextStyles = StyleSheet.create<Record<BadgeVariant, TextStyle>>({
  info: {color: colors.accent},
  success: {color: colors.success},
  warning: {color: colors.warning},
  danger: {color: colors.danger},
  neutral: {color: colors.textSecondary},
});

const buttonSurfaceStyles = StyleSheet.create<Record<ButtonVariant, ViewStyle>>({
  primary: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.accentSoft,
  },
  secondary: {
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  ghost: {
    borderColor: 'transparent',
    backgroundColor: 'transparent',
  },
});

const buttonTextStyles = StyleSheet.create<Record<ButtonVariant, TextStyle>>({
  primary: {color: colors.accent},
  secondary: {color: colors.textPrimary},
  ghost: {color: colors.textSecondary},
});

const alertSurfaceStyles = StyleSheet.create<Record<AlertVariant, ViewStyle>>({
  info: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.accentSoft,
  },
  success: {
    borderColor: colors.successBorder,
    backgroundColor: colors.successSurface,
  },
  warning: {
    borderColor: colors.warningBorder,
    backgroundColor: colors.warningSurface,
  },
  danger: {
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerSurface,
  },
});

const alertTitleStyles = StyleSheet.create<Record<AlertVariant, TextStyle>>({
  info: {color: colors.accent},
  success: {color: colors.success},
  warning: {color: colors.warning},
  danger: {color: colors.danger},
});
