// Native parity port of web/src/features/system/pages/DataExportPage.tsx.
//
// The web module is the "/data-export" page: a PageContainer (title/subtitle +
// Refresh action) that stacks a four-up MetricCard stats row (Total Exports /
// Total Size / Most Exported / Last Export), a GDPR-style "Download my data"
// account-export panel, the New-Export wizard (data-type cards, CSV/JSON format
// buttons, an optional per-type column picker, an optional vehicle Select, and a
// date-range preset/custom selector), a CSV/JSON format-preview + Data-Overview
// row, the Export History DataTable (type/format/status/vehicle/records/size/
// duration/time + a Download action), the auth-gated recurring ScheduledExports
// panel, and a floating JobProgressDrawer. It is built from the shared web UI
// kit (PageContainer, GlassPanel, Badge, Button, Input, Select, DataTable,
// MetricCard, TimeStamp, Skeleton, EmptyState, FadeIn, ConfirmDialog),
// react-i18next, TanStack Query, the lucide `Icons` set, the @/lib date/number
// formatters, the @/api/client request(), and the @/api/hooks/useExports +
// useAuthMode hooks.
//
// Native-safe substitutions (rule 7), documented in the parity sidecar:
//   • react-i18next useTranslation() -> a local useTranslation() whose
//     t(key, fallbackOrOptions?, values?) returns the English fallback (or the
//     `defaultValue`) and interpolates {{token}} placeholders, so every key +
//     copy string is preserved verbatim at the call site.
//   • usePageTitle(...) -> a native no-op hook (no document.title in RN); the
//     call site + its translated title key are preserved.
//   • useToast() -> a native Alert.alert bridge (success/error), only fired from
//     mutation onSuccess/onError, never at render.
//   • The shared web <PageContainer> -> an inlined native PageContainer that
//     keeps the exact branch semantics: header always; then loading -> spinner
//     ONLY (children hidden), error -> error box, empty -> empty copy, else
//     children — wrapped in a ScrollView.
//   • The lucide-react `Icons.*` glyphs -> native glyph components built from the
//     SemanticIcon registry (the DOM `className`/`cn()` size+colour utilities are
//     accepted and ignored; `animate-spin` is not applied to placeholder glyphs).
//     `cn()` is inlined so icon class call sites stay verbatim.
//   • The shared web <Button>/<Badge>/<Select>/<DataTable>/<MetricCard>/
//     <TimeStamp>/<ConfirmDialog> -> inlined native equivalents covering exactly
//     the props these call sites use (variants, sizes, icon, loading, dot,
//     subtitle, pagination, compact, sortable headers as no-op affordances).
//   • The shared web <Input> -> the already-ported native <Input>; the web
//     onChange={e=>set(e.target.value)} becomes onChangeText={set}. There is no
//     native <input type="date">, so the date fields fold to text inputs with a
//     "YYYY-MM-DD" placeholder (documented) while preserving the exact ISO date
//     string state + downstream new Date(...) handling.
//   • window.open(`/api/v1/export/jobs/${id}/download`) and the JobProgressDrawer
//     download <a href> -> Linking.openURL(apiUrl(`/export/jobs/${id}/download`))
//     / Linking.openURL(exportDownloadUrl(id)) — the identical API path, opened
//     in the device browser (RN has no in-page download), with a toast on failure.
//   • ./ScheduledExportsPanel (its own web file, not yet ported) -> a native-safe
//     local ScheduledExportsPanel: a faithful port wired through the real
//     useScheduledExports / create / update / delete / runNow hooks; the web
//     <table> becomes native stacked rows and the inline <form> a card.
//   • @/components/feedback/RequiresAuth -> a native-safe local RequiresAuth that
//     reads the real useAuthMode() contract and renders the children only in
//     forward-auth mode with the capability flag set, else the vendor-neutral
//     placeholder (identical loading/open-mode policy + copy).
//   • @/components/feedback/JobProgressDrawer -> a native-safe local
//     JobProgressDrawer wired through the real useExportJobs hook; the
//     localStorage-persisted open/minimized/dismissed state folds to in-memory
//     useState and the fixed bottom-right overlay renders inline at the foot of
//     the page (both documented).
//   • @/lib formatters (fmtInt/formatBytes/formatRelative/formatDurationMsLong)
//     -> inlined verbatim (en-US locale, the same "—" fallbacks + options).
//   • All Tailwind className styling -> StyleSheet styles + theme tokens; the
//     `--text-*`/`--neon-*` colour intents map to the native token palette.
// Field access stays snake_case (the native request() camelCaseKeys keeps the
// original keys), and every API path / query key / mutation body is preserved.
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
  ActivityIndicator,
  Alert,
  Linking,
  Modal as RNModal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query';

import {Skeleton} from '../../../components/feedback/Skeleton';
import {EmptyState} from '../../../components/feedback/EmptyState';
import {FadeIn} from '../../../components/motion/FadeIn';
import {Input} from '../../../components/ui/Input';
import {apiUrl, request} from '../../../api/client';
import {
  exportDownloadUrl,
  useCreateAccountExport,
  useCreateScheduledExport,
  useDeleteScheduledExport,
  useExportColumns,
  useExportJobs,
  useRunScheduledExportNow,
  useScheduledExports,
  useUpdateScheduledExport,
  type ExportJobSummary as HookExportJobSummary,
  type ScheduledExport,
  type ScheduledExportInput,
} from '../../../api/hooks/useExports';
import {useAuthMode} from '../../../api/hooks/useAuthMode';
import type {AuthModeCapabilities, Vehicle} from '../../../api/types';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {
  getSemanticIconDefinition,
  type SemanticIconName,
  type SemanticIconTone,
} from '../../../../components/icons/SemanticIcon';
import {colors, spacing} from '../../../../theme/tokens';

/* ------------------------------------------------------------------ */
/*  i18n fallback (web react-i18next useTranslation)                   */
/* ------------------------------------------------------------------ */

type TVars = Record<string, string | number | null | undefined>;
type TOptions = TVars & {defaultValue?: string};
type TFunc = (key: string, arg2?: string | TOptions, arg3?: TVars) => string;

function interpolate(template: string, vars?: TVars): string {
  if (!vars) {
    return template;
  }
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => {
    const value = vars[name];
    return value === undefined || value === null ? match : String(value);
  });
}

// Native stand-in for react-i18next's useTranslation: the parity bundle ships no
// i18n runtime, so `t` returns the English fallback (or the `defaultValue`) while
// preserving every key at the call site and interpolating {{token}} placeholders.
function useTranslation(): {t: TFunc} {
  const t = useCallback<TFunc>((key, arg2, arg3) => {
    let fallback = key;
    let vars: TVars | undefined;
    if (typeof arg2 === 'string') {
      fallback = arg2;
      vars = arg3;
    } else if (arg2 && typeof arg2 === 'object') {
      const {defaultValue, ...rest} = arg2;
      fallback = defaultValue ?? key;
      vars = rest as TVars;
    }
    return interpolate(fallback, vars);
  }, []);
  return {t};
}

// Web usePageTitle sets document.title; RN has no document, so this is a no-op
// that keeps the call site (and its translated title key) intact.
function usePageTitle(_title: string): void {
  // intentionally empty — no document.title equivalent in React Native.
}

/* ------------------------------------------------------------------ */
/*  useToast (web @/components/feedback/Toast)                         */
/* ------------------------------------------------------------------ */

interface Toast {
  success: (message: string, detail?: string) => void;
  error: (message: string, detail?: string) => void;
}

// Web toast queue -> native Alert.alert. Fired only from mutation onSuccess/
// onError + interaction handlers, never at render.
function useToast(): Toast {
  return useMemo<Toast>(
    () => ({
      success: (message, detail) => Alert.alert(message, detail),
      error: (message, detail) => Alert.alert(message, detail),
    }),
    [],
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/lib formatters                                           */
/* ------------------------------------------------------------------ */

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

// web fmtInt = fmtNumber(v, 0) at the en-US default locale.
function fmtIntLib(v: unknown): string {
  return safeNumber(v).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

interface FormatBytesOptions {
  empty?: string;
  zeroAsEmpty?: boolean;
  gbDecimals?: number;
}

// web @/lib/numberFormat formatBytes (binary units, "—" fallback + options).
function formatBytes(
  bytes: number | null | undefined,
  options: FormatBytesOptions = {},
): string {
  const empty = options.empty ?? '—';
  if (bytes == null || !Number.isFinite(bytes)) {
    return empty;
  }
  if (options.zeroAsEmpty && bytes === 0) {
    return empty;
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(options.gbDecimals ?? 1)} GB`;
}

function formatRoundedInt(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function formatDate(value: string | Date | null | undefined): string {
  if (!value) {
    return '—';
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

// web @/lib/dateFormat formatRelative ("just now" / Nm / Nh / Nd / absolute >7d).
function formatRelative(value: string | Date | null | undefined): string {
  if (!value) {
    return '—';
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    return '—';
  }
  const diff = Date.now() - d.getTime();
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
  if (days < 7) {
    return `${days}d ago`;
  }
  return formatDate(d);
}

// web @/lib/dateFormat formatDurationMsLong ("250ms" / "1.5s" / "2m 30s").
function formatDurationMsLong(ms: number | null | undefined): string {
  if (!isFiniteNumber(ms) || ms <= 0) {
    return '—';
  }
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const sec = ms / 1000;
  if (sec < 60) {
    return `${sec.toFixed(1)}s`;
  }
  const min = Math.floor(sec / 60);
  return `${min}m ${formatRoundedInt(sec % 60)}s`;
}

// web @/lib/cn — joins truthy class fragments. Kept so the icon `className`/cn()
// call sites stay verbatim; the resulting string is accepted and ignored natively.
function cn(...args: unknown[]): string {
  return args.filter(Boolean).join(' ');
}

/* ------------------------------------------------------------------ */
/*  Icons (lucide-react -> SemanticIcon glyph components)              */
/* ------------------------------------------------------------------ */

interface IconProps {
  className?: string;
  style?: StyleProp<TextStyle>;
}
type IconComponent = (props: IconProps) => React.ReactElement;

const ICON_TONE_COLOR: Record<SemanticIconTone, string> = {
  accent: colors.accent,
  danger: colors.danger,
  neutral: colors.textSecondary,
  success: colors.success,
  violet: colors.glowViolet,
  warning: colors.warning,
};

// Build a glyph component for a SemanticIcon name. The DOM className (sizing +
// colour utilities) is accepted and ignored; the glyph renders in its semantic
// tone unless a caller-supplied `style` overrides the colour.
function makeIcon(name: SemanticIconName): IconComponent {
  const def = getSemanticIconDefinition(name);
  const color = ICON_TONE_COLOR[def.tone];
  function IconGlyph({style}: IconProps) {
    return (
      <AppText style={[styles.iconGlyph, {color}, style]} weight="bold">
        {def.glyph}
      </AppText>
    );
  }
  IconGlyph.displayName = `Icon(${name})`;
  return IconGlyph;
}

const Icons = {
  vehicle: makeIcon('vehicle'),
  charging: makeIcon('charging'),
  trip: makeIcon('trip'),
  analytics: makeIcon('analytics'),
  database: makeIcon('database'),
  maintenance: makeIcon('maintenance'),
  battery: makeIcon('battery'),
  fileSpreadsheet: makeIcon('fileSpreadsheet'),
  fileJson: makeIcon('fileJson'),
  clock: makeIcon('clock'),
  loading: makeIcon('loading'),
  successFilled: makeIcon('successFilled'),
  error: makeIcon('error'),
  alertCircle: makeIcon('alertCircle'),
  package: makeIcon('package'),
  hardDrive: makeIcon('hardDrive'),
  fileDown: makeIcon('fileDown'),
  download: makeIcon('download'),
  refresh: makeIcon('refresh'),
  calendar: makeIcon('calendar'),
  add: makeIcon('add'),
};

/* ------------------------------------------------------------------ */
/*  Inlined @/components/ui Badge                                      */
/* ------------------------------------------------------------------ */

type BadgeVariant = 'neutral' | 'info' | 'success' | 'danger' | 'warning';

const BADGE_TONES: Record<
  BadgeVariant,
  {bg: string; border: string; text: string}
> = {
  neutral: {
    bg: colors.surfaceRaised,
    border: colors.border,
    text: colors.textSecondary,
  },
  info: {bg: colors.accentSoft, border: colors.borderAccent, text: colors.accent},
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
  variant?: BadgeVariant;
  size?: 'sm';
  /** Web `dot` — a small status dot rendered before the label. */
  dot?: boolean;
  children: ReactNode;
}

function Badge({variant = 'neutral', dot, children}: BadgeProps) {
  const tone = BADGE_TONES[variant];
  return (
    <View
      style={[styles.badge, {backgroundColor: tone.bg, borderColor: tone.border}]}>
      {dot ? (
        <View style={[styles.badgeDot, {backgroundColor: tone.text}]} />
      ) : null}
      {React.Children.map(children, child =>
        typeof child === 'string' || typeof child === 'number' ? (
          <AppText style={[styles.badgeText, {color: tone.text}]} weight="semibold">
            {child}
          </AppText>
        ) : (
          child
        ),
      )}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/ui Button                                     */
/* ------------------------------------------------------------------ */

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';

interface ButtonProps {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
  loading?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  accessibilityLabel?: string;
  children?: ReactNode;
}

const BUTTON_TONES: Record<
  ButtonVariant,
  {bg: string; border: string; text: string}
> = {
  primary: {bg: colors.accent, border: colors.accent, text: colors.background},
  secondary: {
    bg: colors.surfaceRaised,
    border: colors.border,
    text: colors.textPrimary,
  },
  outline: {bg: 'transparent', border: colors.border, text: colors.textPrimary},
  ghost: {bg: 'transparent', border: 'transparent', text: colors.textSecondary},
  danger: {bg: colors.dangerSurface, border: colors.dangerBorder, text: colors.danger},
};

function Button({
  variant = 'primary',
  size = 'md',
  icon,
  loading,
  disabled,
  onClick,
  accessibilityLabel,
  children,
}: ButtonProps) {
  const isDisabled = !!disabled || !!loading;
  const tone = BUTTON_TONES[variant];
  const hasLabel = children != null && children !== false;
  const sizeStyle =
    size === 'sm' ? styles.btnSm : size === 'lg' ? styles.btnLg : styles.btnMd;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{disabled: isDisabled, busy: !!loading}}
      disabled={isDisabled}
      onPress={onClick}
      style={({pressed}) => [
        styles.btn,
        sizeStyle,
        !hasLabel && (icon || loading) ? styles.btnIconOnly : null,
        {backgroundColor: tone.bg, borderColor: tone.border},
        isDisabled ? styles.btnDisabled : null,
        pressed && !isDisabled ? styles.btnPressed : null,
      ]}>
      {loading ? (
        <ActivityIndicator color={tone.text} size="small" />
      ) : icon ? (
        <View style={hasLabel ? styles.btnIconWrap : null}>{icon}</View>
      ) : null}
      {hasLabel ? (
        <AppText style={[styles.btnText, {color: tone.text}]} weight="semibold">
          {children}
        </AppText>
      ) : null}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/ui Select                                     */
/* ------------------------------------------------------------------ */

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  id?: string;
}

// Web <select> -> a wrapped row of pressable option chips (the selected chip is
// accent-tinted). onChange receives the chosen option value, mirroring the web
// `e.target.value` payload.
function Select({options, value, onChange, id}: SelectProps) {
  return (
    <View style={styles.optionRow} testID={id}>
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

/* ------------------------------------------------------------------ */
/*  Inlined @/components/ui DataTable                                  */
/* ------------------------------------------------------------------ */

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortable?: boolean;
  className?: string;
}

interface DataTableProps<T> {
  tableId?: string;
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T) => string | number;
  emptyMessage?: string;
  compact?: boolean;
  pagination?: boolean | {defaultPageSize?: number};
}

const DEFAULT_PAGE_SIZE = 10;

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
  const pageSize =
    typeof pagination === 'object' && pagination.defaultPageSize
      ? pagination.defaultPageSize
      : DEFAULT_PAGE_SIZE;
  const [page, setPage] = useState(1);

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
  const rowPad = compact ? styles.rowCompact : styles.rowComfortable;

  return (
    <View style={styles.table} testID={tableId}>
      <View style={[styles.tableRow, styles.headerRow, rowPad]}>
        {columns.map(col => (
          <View key={col.key} style={styles.cell}>
            <AppText
              numberOfLines={1}
              style={styles.headerText}
              tone="muted"
              weight="semibold">
              {col.header}
            </AppText>
          </View>
        ))}
      </View>

      {pagedData.map(row => (
        <View
          key={String(keyExtractor(row))}
          style={[styles.tableRow, styles.bodyRow, rowPad]}>
          {columns.map(col => (
            <View key={col.key} style={styles.cell}>
              {col.render(row)}
            </View>
          ))}
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

/* ------------------------------------------------------------------ */
/*  Inlined @/components/data-display MetricCard + TimeStamp           */
/* ------------------------------------------------------------------ */

type MetricColor = 'cyan' | 'green' | 'purple' | 'amber' | 'red' | 'blue';

const METRIC_TINT: Record<MetricColor, {bg: string; border: string}> = {
  cyan: {bg: colors.accentSoft, border: colors.borderAccent},
  green: {bg: colors.successSurface, border: colors.successBorder},
  purple: {bg: colors.violetSurface, border: colors.violetBorder},
  amber: {bg: colors.warningSurface, border: colors.warningBorder},
  red: {bg: colors.dangerSurface, border: colors.dangerBorder},
  blue: {bg: 'rgba(99, 102, 241, 0.12)', border: 'rgba(99, 102, 241, 0.32)'},
};

interface MetricCardProps {
  label: string;
  value: string | number;
  icon?: ReactNode;
  color?: MetricColor;
  subtitle?: string;
}

function MetricCard({label, value, icon, color = 'cyan', subtitle}: MetricCardProps) {
  const tint = METRIC_TINT[color];
  return (
    <View style={styles.metricCard}>
      <View style={styles.metricRow}>
        <View style={styles.metricBody}>
          <AppText numberOfLines={1} style={styles.metricLabel} tone="muted">
            {label}
          </AppText>
          <AppText numberOfLines={1} style={styles.metricValue} weight="bold">
            {value}
          </AppText>
          {subtitle ? (
            <AppText numberOfLines={1} style={styles.metricSubtitle} tone="muted">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {icon ? (
          <View
            style={[
              styles.metricIconBox,
              {backgroundColor: tint.bg, borderColor: tint.border},
            ]}>
            {icon}
          </View>
        ) : null}
      </View>
    </View>
  );
}

interface TimeStampProps {
  value: string | number | Date | null | undefined;
  className?: string;
  style?: StyleProp<TextStyle>;
}

// Web TimeStamp has a hover Tooltip + Settings-driven format; RN has neither, so
// it renders the absolute local format with a "—" placeholder for null/invalid.
function TimeStamp({value, style}: TimeStampProps) {
  if (value == null) {
    return <AppText style={style}>—</AppText>;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return <AppText style={style}>—</AppText>;
  }
  return (
    <AppText numberOfLines={1} style={style}>
      {date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })}
    </AppText>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/ui ConfirmDialog                              */
/* ------------------------------------------------------------------ */

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  variant?: 'danger' | 'default';
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({
  open,
  title,
  message,
  variant = 'default',
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <RNModal animationType="fade" onRequestClose={onCancel} transparent visible={open}>
      <Pressable
        accessibilityLabel={cancelLabel}
        onPress={onCancel}
        style={styles.modalOverlay}>
        <Pressable style={styles.confirmPanel} onPress={() => undefined}>
          <AppText style={styles.modalTitle} weight="bold">
            {title}
          </AppText>
          <AppText style={styles.confirmMessage} tone="secondary">
            {message}
          </AppText>
          <View style={styles.confirmButtons}>
            <Button onClick={onCancel} variant="outline">
              {cancelLabel}
            </Button>
            <Button onClick={onConfirm} variant={variant === 'danger' ? 'danger' : 'primary'}>
              {confirmLabel}
            </Button>
          </View>
        </Pressable>
      </Pressable>
    </RNModal>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/layout PageContainer                          */
/* ------------------------------------------------------------------ */

interface PageContainerProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  loading?: boolean;
  error?: Error | null;
  children: ReactNode;
}

function PageContainer({
  title,
  subtitle,
  actions,
  loading,
  error,
  children,
}: PageContainerProps) {
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
        <View style={styles.pageLoading}>
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

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ExportType =
  | 'drives'
  | 'charging'
  | 'trips'
  | 'analytics'
  | 'full_backup'
  | 'maintenance'
  | 'energy';
type ExportFormat = 'csv' | 'json';
type ExportStatus = 'queued' | 'processing' | 'ready' | 'failed' | 'expired';

interface ExportJobSummary {
  id: string;
  type: ExportType;
  format: ExportFormat;
  status: ExportStatus;
  vehicle_id?: number;
  record_count?: number;
  file_size?: number;
  created_at: string;
  completed_at?: string;
  duration_ms?: number;
  error_message?: string;
  download_url?: string;
}

interface ExportSubmitPayload {
  type: ExportType;
  format: ExportFormat;
  vehicle_id?: number;
  start?: string;
  end?: string;
  /** Caller-supplied column allowlist. Omitted when the user kept the
   *  default selection (every column) so the backend preserves
   *  byte-for-byte legacy behaviour. */
  columns?: string[];
}

interface DataOverview {
  drives: number;
  charging_sessions: number;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const EXPORT_TYPES: {
  value: ExportType;
  labelKey: string;
  label: string;
  icon: IconComponent;
  descKey: string;
  desc: string;
  color: MetricColor;
}[] = [
  {value: 'drives', labelKey: 'dataExport.types.drives', label: 'Drives', icon: Icons.vehicle, descKey: 'dataExport.types.drivesDesc', desc: 'Export drive sessions, routes, and efficiency data', color: 'cyan'},
  {value: 'charging', labelKey: 'dataExport.types.charging', label: 'Charging', icon: Icons.charging, descKey: 'dataExport.types.chargingDesc', desc: 'Export charging sessions and energy data', color: 'green'},
  {value: 'trips', labelKey: 'dataExport.types.trips', label: 'Trips', icon: Icons.trip, descKey: 'dataExport.types.tripsDesc', desc: 'Export trip summaries with SI aggregate columns', color: 'cyan'},
  {value: 'analytics', labelKey: 'dataExport.types.analytics', label: 'Analytics', icon: Icons.analytics, descKey: 'dataExport.types.analyticsDesc', desc: 'Export analytics and aggregated statistics', color: 'purple'},
  {value: 'full_backup', labelKey: 'dataExport.types.fullBackup', label: 'Full Backup', icon: Icons.database, descKey: 'dataExport.types.fullBackupDesc', desc: 'Complete database backup of all vehicle data', color: 'amber'},
  {value: 'maintenance', labelKey: 'dataExport.types.maintenance', label: 'Maintenance', icon: Icons.maintenance, descKey: 'dataExport.types.maintenanceDesc', desc: 'Export maintenance and service records', color: 'red'},
  {value: 'energy', labelKey: 'dataExport.types.energy', label: 'Energy', icon: Icons.battery, descKey: 'dataExport.types.energyDesc', desc: 'Export energy consumption and efficiency data', color: 'green'},
];

const EXPORT_FORMATS: {
  value: ExportFormat;
  labelKey: string;
  label: string;
  icon: IconComponent;
  descKey: string;
  desc: string;
}[] = [
  {value: 'csv', labelKey: 'dataExport.formats.csv', label: 'CSV', icon: Icons.fileSpreadsheet, descKey: 'dataExport.formats.csvDesc', desc: 'Comma-separated values, compatible with Excel and Google Sheets'},
  {value: 'json', labelKey: 'dataExport.formats.json', label: 'JSON', icon: Icons.fileJson, descKey: 'dataExport.formats.jsonDesc', desc: 'Structured JSON format for programmatic access'},
];

const DATE_PRESETS: {labelKey: string; label: string; days: number}[] = [
  {labelKey: 'dataExport.presets.last7', label: 'Last 7 Days', days: 7},
  {labelKey: 'dataExport.presets.last30', label: 'Last 30 Days', days: 30},
  {labelKey: 'dataExport.presets.last90', label: 'Last 90 Days', days: 90},
  {labelKey: 'dataExport.presets.lastYear', label: 'Last Year', days: 365},
  {labelKey: 'dataExport.presets.allTime', label: 'All Time', days: 0},
];

const STATUS_CONFIG: Record<
  ExportStatus,
  {
    icon: IconComponent;
    badgeVariant: BadgeVariant;
    labelKey: string;
    label: string;
    spinning?: boolean;
  }
> = {
  queued: {icon: Icons.clock, badgeVariant: 'neutral', labelKey: 'dataExport.status.queued', label: 'Queued'},
  processing: {icon: Icons.loading, badgeVariant: 'info', labelKey: 'dataExport.status.processing', label: 'Processing', spinning: true},
  ready: {icon: Icons.successFilled, badgeVariant: 'success', labelKey: 'dataExport.status.ready', label: 'Ready'},
  failed: {icon: Icons.error, badgeVariant: 'danger', labelKey: 'dataExport.status.failed', label: 'Failed'},
  expired: {icon: Icons.alertCircle, badgeVariant: 'warning', labelKey: 'dataExport.status.expired', label: 'Expired'},
};

const TYPE_BADGE_VARIANT: Record<ExportType, BadgeVariant> = {
  drives: 'info',
  charging: 'success',
  trips: 'info',
  analytics: 'neutral',
  full_backup: 'warning',
  maintenance: 'danger',
  energy: 'success',
};

// Per-type accent palette mirroring the web `var(--neon-${color})` border/icon
// tints applied to the export-type cards.
const NEON_TINT: Record<MetricColor, {border: string; icon: string; soft: string}> = {
  cyan: {border: colors.borderAccent, icon: colors.accent, soft: colors.accentSoft},
  green: {border: colors.successBorder, icon: colors.success, soft: colors.successSurface},
  purple: {border: colors.violetBorder, icon: colors.violet, soft: colors.violetSurface},
  amber: {border: colors.warningBorder, icon: colors.warning, soft: colors.warningSurface},
  red: {border: colors.dangerBorder, icon: colors.danger, soft: colors.dangerSurface},
  blue: {border: 'rgba(99, 102, 241, 0.32)', icon: colors.accent, soft: 'rgba(99, 102, 241, 0.12)'},
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

function fmtInt(n: number | undefined): string {
  if (n == null) {
    return '—';
  }
  return fmtIntLib(n);
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function ExportTypeSelector({
  selected,
  onChange,
}: {
  selected: ExportType;
  onChange: (v: ExportType) => void;
}) {
  const {t} = useTranslation();
  return (
    <View style={styles.typeGrid}>
      {EXPORT_TYPES.map(et => {
        const Icon = et.icon;
        const active = selected === et.value;
        const tint = NEON_TINT[et.color];
        return (
          <Pressable
            key={et.value}
            accessibilityRole="button"
            accessibilityState={{selected: active}}
            onPress={() => onChange(et.value)}
            style={({pressed}) => [
              styles.typeCard,
              {borderColor: active ? tint.border : 'transparent'},
              pressed ? styles.typeCardPressed : null,
            ]}>
            <View style={styles.typeCardHeader}>
              <View
                style={[
                  styles.typeIconBox,
                  {backgroundColor: active ? tint.soft : colors.surfaceRaised},
                ]}>
                <Icon style={{color: active ? tint.icon : colors.textMuted}} />
              </View>
              <AppText
                style={active ? styles.typeLabelActive : styles.typeLabel}
                weight="semibold">
                {t(et.labelKey, et.label)}
              </AppText>
            </View>
            <AppText style={styles.typeDesc} tone="muted" variant="caption">
              {t(et.descKey, et.desc)}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

function FormatSelector({
  selected,
  onChange,
}: {
  selected: ExportFormat;
  onChange: (f: ExportFormat) => void;
}) {
  const {t} = useTranslation();
  return (
    <View style={styles.row}>
      {EXPORT_FORMATS.map(f => {
        const Icon = f.icon;
        const active = selected === f.value;
        return (
          <Button
            key={f.value}
            variant={active ? 'primary' : 'outline'}
            size="md"
            icon={<Icon className="h-4 w-4" />}
            onClick={() => onChange(f.value)}>
            {t(f.labelKey, f.label)}
          </Button>
        );
      })}
    </View>
  );
}

function DatePresetSelector({
  selected,
  onChange,
}: {
  selected: number;
  onChange: (days: number) => void;
}) {
  const {t} = useTranslation();
  return (
    <View style={styles.wrapRow}>
      {DATE_PRESETS.map(p => {
        const active = selected === p.days;
        return (
          <Button
            key={p.days}
            size="sm"
            variant={active ? 'primary' : 'ghost'}
            onClick={() => onChange(p.days)}>
            {t(p.labelKey, p.label)}
          </Button>
        );
      })}
    </View>
  );
}

function StatusBadge({status}: {status: ExportStatus}) {
  const {t} = useTranslation();
  const cfg = STATUS_CONFIG[status];
  const Icon = cfg.icon;
  return (
    <Badge variant={cfg.badgeVariant} size="sm">
      <Icon className={cn('h-3 w-3', cfg.spinning && 'animate-spin')} />
      {t(cfg.labelKey, cfg.label)}
    </Badge>
  );
}

function TypeBadge({type}: {type: ExportType}) {
  const {t} = useTranslation();
  const variant = TYPE_BADGE_VARIANT[type] ?? 'neutral';
  const cfg = EXPORT_TYPES.find(et => et.value === type);
  return (
    <Badge variant={variant} size="sm">
      {cfg ? t(cfg.labelKey, cfg.label) : type}
    </Badge>
  );
}

function FormatBadge({format}: {format: ExportFormat}) {
  return (
    <Badge variant={format === 'csv' ? 'info' : 'warning'} size="sm">
      {format === 'csv' && <Icons.fileSpreadsheet className="h-3 w-3" />}
      {format === 'json' && <Icons.fileJson className="h-3 w-3" />}
      {format.toUpperCase()}
    </Badge>
  );
}

function FormatInfoCards() {
  const {t} = useTranslation();
  return (
    <View style={styles.infoGrid}>
      <GlassPanel style={styles.panelP4}>
        <View style={styles.infoHeader}>
          <Icons.fileSpreadsheet className="h-5 w-5 text-neon-cyan" />
          <AppText style={styles.infoTitle} weight="semibold">
            {t('dataExport.csvPreview', 'CSV Preview')}
          </AppText>
        </View>
        <AppText style={styles.infoDesc} tone="muted" variant="caption">
          {t(
            'dataExport.csvDesc',
            'Comma-separated values, compatible with Excel and Google Sheets',
          )}
        </AppText>
        <View style={styles.codeBlock}>
          <AppText style={styles.codeLine}>date,distance_m,efficiency_wh_per_m</AppText>
          <AppText style={styles.codeLine}>2025-01-15,45200,0.152</AppText>
          <AppText style={styles.codeLine}>2025-01-16,32800,0.148</AppText>
        </View>
      </GlassPanel>

      <GlassPanel style={styles.panelP4}>
        <View style={styles.infoHeader}>
          <Icons.fileJson className="h-5 w-5 text-neon-purple" />
          <AppText style={styles.infoTitle} weight="semibold">
            {t('dataExport.jsonPreview', 'JSON Preview')}
          </AppText>
        </View>
        <AppText style={styles.infoDesc} tone="muted" variant="caption">
          {t('dataExport.jsonDesc', 'Structured JSON format for programmatic access')}
        </AppText>
        <View style={styles.codeBlock}>
          <AppText style={styles.codeLine}>{'[{ "date": "2025-01-15",'}</AppText>
          <AppText style={styles.codeLine}>{'   "distance_m": 45200,'}</AppText>
          <AppText style={styles.codeLine}>{'   "efficiency": 152 }]'}</AppText>
        </View>
      </GlassPanel>
    </View>
  );
}

function DataOverviewCard({
  overview,
  isLoading,
}: {
  overview: DataOverview | undefined;
  isLoading: boolean;
}) {
  const {t} = useTranslation();
  return (
    <GlassPanel style={styles.panelP4}>
      <View style={styles.infoHeader}>
        <Icons.database className="h-4 w-4 text-neon-cyan" />
        <AppText style={styles.infoTitle} weight="semibold">
          {t('dataExport.dataOverview', 'Data Overview')}
        </AppText>
      </View>
      {isLoading ? (
        <View style={styles.overviewLoading}>
          <Skeleton height={16} />
          <Skeleton height={16} />
        </View>
      ) : overview ? (
        <View style={styles.overviewGrid}>
          <View style={styles.overviewItem}>
            <Icons.vehicle className="h-3.5 w-3.5 text-neon-cyan" />
            <AppText style={styles.overviewText} tone="secondary" variant="caption">
              {fmtInt(overview.drives)} {t('dataExport.drives', 'Drives')}
            </AppText>
          </View>
          <View style={styles.overviewItem}>
            <Icons.charging className="h-3.5 w-3.5 text-neon-green" />
            <AppText style={styles.overviewText} tone="secondary" variant="caption">
              {fmtInt(overview.charging_sessions)}{' '}
              {t('dataExport.chargingSessions', 'Charging Sessions')}
            </AppText>
          </View>
        </View>
      ) : (
        <AppText style={styles.infoDesc} tone="muted" variant="caption">
          {t('dataExport.unavailable', 'Unavailable')}
        </AppText>
      )}
    </GlassPanel>
  );
}

/* ------------------------------------------------------------------ */
/*  Custom date range inputs                                           */
/* ------------------------------------------------------------------ */

// Web uses <Input type="date">; RN has no native date input, so these fold to
// text fields with a "YYYY-MM-DD" placeholder while preserving the exact ISO
// date-string state the wizard threads into the submit payload.
function CustomDateRange({
  startDate,
  endDate,
  onStartChange,
  onEndChange,
}: {
  startDate: string;
  endDate: string;
  onStartChange: (v: string) => void;
  onEndChange: (v: string) => void;
}) {
  const {t} = useTranslation();
  return (
    <View style={styles.row}>
      <View style={styles.flex1}>
        <Input
          label={t('Start')}
          value={startDate}
          onChangeText={onStartChange}
          placeholder="YYYY-MM-DD"
          autoCapitalize="none"
        />
      </View>
      <View style={styles.flex1}>
        <Input
          label={t('End')}
          value={endDate}
          onChangeText={onEndChange}
          placeholder="YYYY-MM-DD"
          autoCapitalize="none"
        />
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Stats row                                                          */
/* ------------------------------------------------------------------ */

function StatsRow({
  jobs,
  isLoading,
}: {
  jobs: ExportJobSummary[] | undefined;
  isLoading: boolean;
}) {
  const {t} = useTranslation();
  const totalExports = jobs?.length ?? 0;

  const totalSize = useMemo(() => {
    if (!jobs) {
      return 0;
    }
    return jobs.reduce((sum, j) => sum + (j.file_size ?? 0), 0);
  }, [jobs]);

  const mostExportedType = useMemo(() => {
    if (!jobs || jobs.length === 0) {
      return '—';
    }
    const counts: Record<string, number> = {};
    for (const j of jobs) {
      counts[j.type] = (counts[j.type] ?? 0) + 1;
    }
    const max = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return max ? max[0].replace(/_/g, ' ') : '—';
  }, [jobs]);

  const lastExport = useMemo(() => {
    if (!jobs || jobs.length === 0) {
      return '—';
    }
    const sorted = [...jobs].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
    return formatRelative(sorted[0].created_at);
  }, [jobs]);

  if (isLoading) {
    return (
      <View style={styles.statsGrid}>
        {Array.from({length: 4}).map((_, i) => (
          <View key={i} style={styles.statCell}>
            <Skeleton height={80} rounded />
          </View>
        ))}
      </View>
    );
  }

  return (
    <View style={styles.statsGrid}>
      <View style={styles.statCell}>
        <MetricCard
          label={t('Total Exports')}
          value={totalExports}
          icon={<Icons.package className="h-4 w-4" />}
          color="cyan"
        />
      </View>
      <View style={styles.statCell}>
        <MetricCard
          label={t('Total Size')}
          value={formatBytes(totalSize, {zeroAsEmpty: true, gbDecimals: 2})}
          icon={<Icons.hardDrive className="h-4 w-4" />}
          color="blue"
        />
      </View>
      <View style={styles.statCell}>
        <MetricCard
          label={t('Most Exported')}
          value={mostExportedType}
          icon={<Icons.analytics className="h-4 w-4" />}
          color="purple"
          subtitle={t('By Count')}
        />
      </View>
      <View style={styles.statCell}>
        <MetricCard
          label={t('Last Export')}
          value={lastExport}
          icon={<Icons.clock className="h-4 w-4" />}
          color="green"
        />
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Export Wizard                                                       */
/* ------------------------------------------------------------------ */

function ExportWizard({
  vehicles,
  onSubmit,
  isPending,
}: {
  vehicles: Vehicle[] | undefined;
  onSubmit: (payload: ExportSubmitPayload) => void;
  isPending: boolean;
}) {
  const {t} = useTranslation();
  const [exportType, setExportType] = useState<ExportType>('drives');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('csv');
  const [vehicleId, setVehicleId] = useState('');
  const [presetDays, setPresetDays] = useState(30);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [useCustomRange, setUseCustomRange] = useState(false);
  // Column allowlist state. `null` means "user has not touched the picker;
  // submit without `columns` so backend preserves legacy byte-for-byte
  // behaviour". A non-null value is the explicit ordered allowlist.
  const [selectedColumns, setSelectedColumns] = useState<string[] | null>(null);

  // Reset the column selection whenever the export type changes — a catalog
  // from the previous type is meaningless against the new one.
  const handleExportTypeChange = useCallback((next: ExportType) => {
    setExportType(next);
    setSelectedColumns(null);
  }, []);

  const handlePresetChange = useCallback((days: number) => {
    setPresetDays(days);
    setUseCustomRange(false);
  }, []);

  const handleSubmit = useCallback(() => {
    const payload: ExportSubmitPayload = {
      type: exportType,
      format: exportFormat,
    };
    if (vehicleId) {
      payload.vehicle_id = Number(vehicleId);
    }
    if (useCustomRange && customStart) {
      payload.start = customStart;
      payload.end = customEnd || new Date().toISOString().split('T')[0];
    } else if (presetDays > 0) {
      payload.start = daysAgo(presetDays);
      payload.end = new Date().toISOString().split('T')[0];
    }
    if (selectedColumns !== null && selectedColumns.length > 0) {
      payload.columns = selectedColumns;
    }
    onSubmit(payload);
  }, [
    exportType,
    exportFormat,
    vehicleId,
    presetDays,
    customStart,
    customEnd,
    useCustomRange,
    selectedColumns,
    onSubmit,
  ]);

  const vehicleOptions = useMemo(() => {
    const opts = [{value: '', label: t('All Vehicles')}];
    if (vehicles) {
      for (const v of vehicles) {
        opts.push({value: String(v.id), label: v.display_name || v.vin});
      }
    }
    return opts;
  }, [vehicles, t]);

  return (
    <GlassPanel style={styles.panelP6}>
      <View style={styles.wizardHeader}>
        <Icons.fileDown className="h-5 w-5 text-neon-cyan" />
        <AppText style={styles.wizardTitle} weight="bold">
          {t('dataExport.wizardTitle', 'New Export')}
        </AppText>
      </View>

      {/* Step 1: Export Type */}
      <View style={styles.step}>
        <AppText style={styles.stepLabel} tone="secondary">
          {t('dataExport.wizard.step1', 'STEP 1 — Select Data Type')}
        </AppText>
        <ExportTypeSelector selected={exportType} onChange={handleExportTypeChange} />
      </View>

      {/* Step 2: Format */}
      <View style={styles.step}>
        <AppText style={styles.stepLabel} tone="secondary">
          {t('dataExport.wizard.step2', 'STEP 2 — Choose Format')}
        </AppText>
        <FormatSelector selected={exportFormat} onChange={setExportFormat} />
      </View>

      {/* Step 2.5: Columns — only when the catalog supports it */}
      <ColumnPickerSection
        exportType={exportType}
        selectedColumns={selectedColumns}
        onChange={setSelectedColumns}
      />

      {/* Step 3: Vehicle */}
      {vehicles && vehicles.length > 0 ? (
        <View style={styles.step}>
          <AppText style={styles.stepLabel} tone="secondary">
            {t('dataExport.wizard.step3', 'STEP 3 — Select Vehicle')}
          </AppText>
          <Select
            id="export-vehicle"
            options={vehicleOptions}
            value={vehicleId}
            onChange={setVehicleId}
            placeholder={t('dataExport.allVehicles', 'All Vehicles')}
          />
        </View>
      ) : null}

      {/* Step 4: Date Range */}
      <View style={styles.step}>
        <AppText style={styles.stepLabel} tone="secondary">
          {t('dataExport.wizard.step4', 'STEP 4 — Date Range')}
        </AppText>
        <DatePresetSelector
          selected={useCustomRange ? -1 : presetDays}
          onChange={handlePresetChange}
        />
        <View style={styles.customRangeToggle}>
          <Button
            variant={useCustomRange ? 'primary' : 'ghost'}
            size="sm"
            icon={<Icons.calendar className="h-3.5 w-3.5" />}
            onClick={() => setUseCustomRange(!useCustomRange)}>
            {t('dataExport.customRange', 'Custom Range')}
          </Button>
        </View>
        {useCustomRange ? (
          <View style={styles.customRangeFields}>
            <CustomDateRange
              startDate={customStart}
              endDate={customEnd}
              onStartChange={setCustomStart}
              onEndChange={setCustomEnd}
            />
          </View>
        ) : null}
      </View>

      {/* Submit */}
      <View style={styles.submitRow}>
        <Button
          variant="primary"
          size="lg"
          loading={isPending}
          icon={<Icons.download className="h-4 w-4" />}
          onClick={handleSubmit}>
          {t('Start Export')}
        </Button>
      </View>
    </GlassPanel>
  );
}

/* ------------------------------------------------------------------ */
/*  Column Picker                                                     */
/* ------------------------------------------------------------------ */

// Maps the page's export-type identifiers to the backend catalog identifiers.
// Types without a fixed column catalog return '' so the hook short-circuits and
// the picker hides itself.
function catalogTypeFor(type: ExportType): string {
  switch (type) {
    case 'drives':
      return 'drives';
    case 'charging':
      return 'charging';
    default:
      return '';
  }
}

function ColumnPickerSection({
  exportType,
  selectedColumns,
  onChange,
}: {
  exportType: ExportType;
  selectedColumns: string[] | null;
  onChange: (next: string[] | null) => void;
}) {
  const {t} = useTranslation();
  const catalogType = catalogTypeFor(exportType);
  const {data, isLoading, isError} = useExportColumns(catalogType || undefined);

  // Hide the picker entirely when the export type doesn't publish a catalog.
  if (!catalogType) {
    return null;
  }
  if (isLoading) {
    return (
      <View style={styles.step}>
        <AppText style={styles.stepLabel} tone="secondary">
          {t('dataExport.columns.title', 'STEP 2½ — Columns')}
        </AppText>
        <Skeleton height={96} />
      </View>
    );
  }
  if (isError || !data || !data.supports_selection || data.columns.length === 0) {
    return null;
  }

  // The "selected" set drives the checkbox UI. Default = every column.
  const allColumnNames = data.columns.map(c => c.name);
  const effectiveSelected = selectedColumns ?? allColumnNames;
  const selectedSet = new Set(effectiveSelected);
  const allSelected =
    effectiveSelected.length === allColumnNames.length &&
    allColumnNames.every(n => selectedSet.has(n));

  const requiredSet = new Set(
    data.columns.filter(c => c.always_included).map(c => c.name),
  );

  const toggleColumn = (name: string) => {
    if (requiredSet.has(name)) {
      return;
    }
    const next = new Set(effectiveSelected);
    if (next.has(name)) {
      next.delete(name);
    } else {
      next.add(name);
    }
    // Preserve catalog order when emitting the new selection so the backend
    // writes columns in a stable order.
    const ordered = allColumnNames.filter(n => next.has(n));
    // If the user re-selected every column, collapse to the legacy "all
    // selected" state by passing null — the wizard then omits `columns`.
    if (ordered.length === allColumnNames.length) {
      onChange(null);
    } else {
      onChange(ordered);
    }
  };

  const handleSelectAll = () => onChange(null);
  const handleClear = () => {
    // "Clear" leaves the always-included columns selected — the backend would
    // silently re-add them anyway.
    const required = allColumnNames.filter(n => requiredSet.has(n));
    if (required.length === allColumnNames.length) {
      onChange(null);
    } else {
      onChange(required);
    }
  };

  return (
    <View style={styles.step} testID="export-column-picker">
      <AppText style={styles.stepLabel} tone="secondary">
        {t('dataExport.columns.title', 'STEP 2½ — Columns')}
      </AppText>
      <View style={styles.columnPanel}>
        <View style={styles.columnHeader}>
          <AppText style={styles.columnHelper} tone="secondary" variant="caption">
            {t(
              'dataExport.columns.helperText',
              'Select which columns to include in the export. Required columns cannot be removed.',
            )}
          </AppText>
          <View style={styles.row}>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSelectAll}
              disabled={allSelected}>
              {t('dataExport.columns.selectAll', 'Select all')}
            </Button>
            <Button variant="ghost" size="sm" onClick={handleClear}>
              {t('dataExport.columns.clear', 'Clear')}
            </Button>
          </View>
        </View>
        <View style={styles.columnGrid}>
          {data.columns.map(col => {
            const checked = selectedSet.has(col.name);
            const required = requiredSet.has(col.name);
            return (
              <Pressable
                key={col.name}
                accessibilityRole="checkbox"
                accessibilityState={{checked, disabled: required}}
                accessibilityLabel={col.label}
                disabled={required}
                onPress={() => toggleColumn(col.name)}
                testID={`export-column-row-${col.name}`}
                style={({pressed}) => [
                  styles.columnRow,
                  required ? styles.columnRowRequired : null,
                  pressed && !required ? styles.columnRowPressed : null,
                ]}>
                <View
                  style={[
                    styles.checkbox,
                    checked ? styles.checkboxChecked : null,
                  ]}>
                  {checked ? (
                    <AppText style={styles.checkboxMark} weight="bold">
                      ✓
                    </AppText>
                  ) : null}
                </View>
                <AppText style={styles.columnLabel}>{col.label}</AppText>
                {required ? (
                  <View style={styles.requiredChip}>
                    <AppText style={styles.requiredChipText} weight="semibold">
                      {t('dataExport.columns.alwaysIncluded', 'Required')}
                    </AppText>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Export History Table                                                */
/* ------------------------------------------------------------------ */

function ExportHistoryTable({
  jobs,
  isLoading,
  vehicles,
  onDownload,
  onRefresh,
}: {
  jobs: ExportJobSummary[] | undefined;
  isLoading: boolean;
  vehicles: Vehicle[] | undefined;
  onDownload: (job: ExportJobSummary) => void;
  onRefresh: () => void;
}) {
  const {t} = useTranslation();
  const vehicleMap = useMemo(() => {
    const map = new Map<number, string>();
    if (vehicles) {
      for (const v of vehicles) {
        map.set(v.id, v.display_name || v.vin);
      }
    }
    return map;
  }, [vehicles]);

  const activeJobs = useMemo(
    () =>
      (jobs ?? []).filter(j => j.status === 'queued' || j.status === 'processing')
        .length,
    [jobs],
  );

  const columns: Column<ExportJobSummary>[] = useMemo(
    () => [
      {
        key: 'type',
        header: t('Type'),
        sortable: true,
        render: row => <TypeBadge type={row.type} />,
      },
      {
        key: 'format',
        header: t('Format'),
        render: row => <FormatBadge format={row.format} />,
      },
      {
        key: 'status',
        header: t('Status'),
        sortable: true,
        render: row => <StatusBadge status={row.status} />,
      },
      {
        key: 'vehicle',
        header: t('Vehicle'),
        render: row => (
          <AppText style={styles.cellText} tone="secondary" variant="caption">
            {row.vehicle_id
              ? vehicleMap.get(row.vehicle_id) ?? `#${row.vehicle_id}`
              : '—'}
          </AppText>
        ),
      },
      {
        key: 'records',
        header: t('Records'),
        sortable: true,
        render: row => (
          <AppText style={styles.cellText} tone="secondary" variant="caption">
            {row.record_count != null ? fmtInt(row.record_count) : '—'}
          </AppText>
        ),
      },
      {
        key: 'size',
        header: t('Size'),
        sortable: true,
        render: row => (
          <AppText style={styles.cellText} tone="secondary" variant="caption">
            {formatBytes(row.file_size, {zeroAsEmpty: true, gbDecimals: 2})}
          </AppText>
        ),
      },
      {
        key: 'duration',
        header: t('Duration'),
        render: row => (
          <AppText style={styles.cellText} tone="muted" variant="caption">
            {formatDurationMsLong(row.duration_ms)}
          </AppText>
        ),
      },
      {
        key: 'time',
        header: t('Time'),
        sortable: true,
        render: row => (
          <TimeStamp value={row.created_at} style={styles.cellTextMuted} />
        ),
      },
      {
        key: 'actions',
        header: '',
        className: 'w-24 text-right',
        render: row =>
          row.status === 'ready' ? (
            <Button
              variant="ghost"
              size="sm"
              icon={<Icons.download className="h-3.5 w-3.5" />}
              onClick={() => onDownload(row)}>
              {t('Download')}
            </Button>
          ) : row.status === 'failed' && row.error_message ? (
            <AppText
              numberOfLines={1}
              style={styles.errorCell}
              variant="caption">
              {row.error_message}
            </AppText>
          ) : null,
      },
    ],
    [t, vehicleMap, onDownload],
  );

  if (isLoading) {
    return (
      <GlassPanel style={styles.panelP6}>
        <View style={styles.skeletonStack}>
          {Array.from({length: 5}).map((_, i) => (
            <Skeleton key={i} height={40} />
          ))}
        </View>
      </GlassPanel>
    );
  }

  return (
    <GlassPanel style={styles.panelP0}>
      <View style={styles.tableHeaderRow}>
        <View style={styles.tableHeaderLeft}>
          <AppText style={styles.tableHeaderTitle} weight="semibold">
            {t('dataExport.exportHistory', 'Export History')}
          </AppText>
          {activeJobs > 0 ? (
            <Badge variant="info" size="sm" dot>
              {`${activeJobs} ${t('dataExport.active', 'Active')}`}
            </Badge>
          ) : null}
        </View>
        <Button
          variant="ghost"
          size="sm"
          icon={<Icons.refresh className="h-3.5 w-3.5" />}
          onClick={onRefresh}>
          {t('dataExport.refresh', 'Refresh')}
        </Button>
      </View>

      {!jobs || jobs.length === 0 ? (
        <EmptyState
          icon={<Icons.fileDown className="h-10 w-10" />}
          title={t('dataExport.noExports', 'No Exports Yet')}
          message={t(
            'dataExport.noExportsMessage',
            'Create your first export above to get started.',
          )}
        />
      ) : (
        <View style={styles.historyTableWrap}>
          <DataTable
            tableId="system:data-export-jobs"
            columns={columns}
            data={jobs}
            keyExtractor={row => row.id}
            emptyMessage={t('dataExport.noJobs', 'No export jobs')}
            compact
            pagination
          />
        </View>
      )}
    </GlassPanel>
  );
}

/* ------------------------------------------------------------------ */
/*  Account Export Panel                                             */
/* ------------------------------------------------------------------ */

interface AccountExportPanelProps {
  vehicles: Vehicle[] | undefined;
}

function AccountExportPanel({vehicles}: AccountExportPanelProps) {
  const {t} = useTranslation();
  const [vehicleId, setVehicleId] = useState<string>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  const createAccount = useCreateAccountExport();

  const handleStart = useCallback(() => {
    const payload: {vehicle_id?: number; start?: string; end?: string} = {};
    if (vehicleId !== 'all') {
      const id = Number(vehicleId);
      if (!Number.isNaN(id)) {
        payload.vehicle_id = id;
      }
    }
    if (startDate) {
      payload.start = new Date(startDate).toISOString();
    }
    if (endDate) {
      payload.end = new Date(endDate).toISOString();
    }
    createAccount.mutate(payload);
  }, [vehicleId, startDate, endDate, createAccount]);

  const vehicleOptions = useMemo(
    () => [
      {value: 'all', label: t('dataExport.account.allVehicles', 'All vehicles')},
      ...(vehicles ?? []).map(v => ({
        value: String(v.id),
        label: v.display_name || v.vin || `Vehicle ${v.id}`,
      })),
    ],
    [vehicles, t],
  );

  return (
    <GlassPanel style={styles.panelP6}>
      <View style={styles.accountHeader}>
        <View style={styles.accountIconBox}>
          <Icons.package className="h-5 w-5 text-cyan-300" />
        </View>
        <View style={styles.flex1}>
          <AppText style={styles.accountTitle} weight="bold">
            {t('dataExport.account.title', 'Download my data')}
          </AppText>
          <AppText style={styles.accountSubtitle} tone="secondary">
            {t(
              'dataExport.account.subtitle',
              'Get a single ZIP containing every table we store for you — drives, charging, signal history, alerts, settings, and a manifest. Use this for backup, migration, or your personal records.',
            )}
          </AppText>
        </View>
      </View>

      <View style={styles.accountFields}>
        <View style={styles.accountField}>
          <AppText style={styles.fieldCaption} tone="muted" variant="caption">
            {t('dataExport.account.vehicle', 'Vehicle')}
          </AppText>
          <Select
            id="account-export-vehicle"
            value={vehicleId}
            onChange={setVehicleId}
            options={vehicleOptions}
          />
        </View>
        <View style={styles.accountField}>
          <AppText style={styles.fieldCaption} tone="muted" variant="caption">
            {t('dataExport.account.startDate', 'Start date (optional)')}
          </AppText>
          <Input
            id="account-export-start"
            value={startDate}
            onChangeText={setStartDate}
            placeholder="YYYY-MM-DD"
            autoCapitalize="none"
          />
        </View>
        <View style={styles.accountField}>
          <AppText style={styles.fieldCaption} tone="muted" variant="caption">
            {t('dataExport.account.endDate', 'End date (optional)')}
          </AppText>
          <Input
            id="account-export-end"
            value={endDate}
            onChangeText={setEndDate}
            placeholder="YYYY-MM-DD"
            autoCapitalize="none"
          />
        </View>
      </View>

      <View style={styles.accountFooter}>
        <View style={styles.accountWarning}>
          <Icons.alertCircle className="h-3.5 w-3.5" />
          <AppText style={styles.accountWarningText} tone="muted" variant="caption">
            {t(
              'dataExport.account.warning',
              'Large signal histories are capped per table to keep the ZIP under control. Track progress in the floating widget that appears once your export starts.',
            )}
          </AppText>
        </View>
        <Button
          variant="primary"
          size="md"
          onClick={handleStart}
          loading={createAccount.isPending}
          icon={<Icons.download className="h-4 w-4" />}>
          {t('dataExport.account.start', 'Start full export')}
        </Button>
      </View>
    </GlassPanel>
  );
}

/* ------------------------------------------------------------------ */
/*  ScheduledExportsPanel (native-safe port of ./ScheduledExportsPanel) */
/* ------------------------------------------------------------------ */

const SCHEDULE_EXPORT_TYPES: ScheduledExport['export_type'][] = [
  'drives',
  'charging',
  'trips',
  'positions',
  'signals',
];

const SCHEDULE_FORMATS: ScheduledExport['format'][] = ['csv', 'json'];

const DELIVERY_KINDS: ScheduledExport['delivery']['kind'][] = [
  'download',
  'email',
  'webhook',
];

function emptyScheduleInput(): ScheduledExportInput {
  return {
    name: '',
    export_type: 'drives',
    format: 'csv',
    schedule_cron: '0 9 * * 0',
    delivery: {kind: 'download'},
    range_window: '7d',
    enabled: true,
  };
}

function scheduleInputFromRow(row: ScheduledExport): ScheduledExportInput {
  return {
    name: row.name,
    export_type: row.export_type,
    format: row.format,
    vehicle_id: row.vehicle_id ?? undefined,
    columns: row.columns ?? undefined,
    schedule_cron: row.schedule_cron,
    delivery: {...row.delivery},
    range_window: row.range_window,
    enabled: row.enabled,
  };
}

function ScheduledExportsPanel() {
  const {t} = useTranslation();
  const {data, isLoading} = useScheduledExports();
  const create = useCreateScheduledExport();
  const update = useUpdateScheduledExport();
  const remove = useDeleteScheduledExport();
  const runNow = useRunScheduledExportNow();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<ScheduledExportInput>(emptyScheduleInput);
  const [pendingDelete, setPendingDelete] = useState<ScheduledExport | null>(null);

  const rows = data ?? [];

  const startCreate = () => {
    setForm(emptyScheduleInput());
    setEditingId(null);
    setShowForm(true);
  };

  const startEdit = (row: ScheduledExport) => {
    setForm(scheduleInputFromRow(row));
    setEditingId(row.id);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyScheduleInput());
  };

  const submit = async () => {
    const payload: ScheduledExportInput = {
      ...form,
      // Drop the optional target field for download deliveries so we don't
      // round-trip an unused string.
      delivery:
        form.delivery.kind === 'download'
          ? {kind: 'download'}
          : {kind: form.delivery.kind, target: (form.delivery.target ?? '').trim()},
    };
    try {
      if (editingId == null) {
        await create.mutateAsync(payload);
      } else {
        await update.mutateAsync({id: editingId, payload});
      }
      closeForm();
    } catch {
      /* toast surfaced by mutation hook */
    }
  };

  const toggleEnabled = async (row: ScheduledExport) => {
    try {
      await update.mutateAsync({
        id: row.id,
        payload: {...scheduleInputFromRow(row), enabled: !row.enabled},
      });
    } catch {
      /* toast surfaced by mutation hook */
    }
  };

  return (
    <GlassPanel style={styles.panelP6} testID="scheduled-exports-panel">
      <View style={styles.scheduleHeader}>
        <View style={styles.flex1}>
          <AppText style={styles.scheduleTitle} weight="bold">
            {t('dataExport.scheduled.title', 'Scheduled exports')}
          </AppText>
          <AppText style={styles.scheduleSubtitle} tone="secondary">
            {t('dataExport.scheduled.subtitle', 'Cron-driven recurring exports.')}
          </AppText>
        </View>
        <Button
          variant="primary"
          size="sm"
          onClick={startCreate}
          icon={<Icons.add className="h-4 w-4" />}>
          {t('dataExport.scheduled.newSchedule', 'New schedule')}
        </Button>
      </View>

      {showForm ? (
        <View style={styles.scheduleForm} testID="scheduled-exports-form">
          <View style={styles.scheduleField}>
            <AppText style={styles.scheduleFieldLabel} tone="secondary" variant="caption">
              {t('dataExport.scheduled.form.name', 'Name')}
            </AppText>
            <Input
              value={form.name}
              onChangeText={text => setForm({...form, name: text})}
              placeholder={t('dataExport.scheduled.form.namePlaceholder', 'Drives weekly')}
              required
            />
          </View>
          <View style={styles.scheduleField}>
            <AppText style={styles.scheduleFieldLabel} tone="secondary" variant="caption">
              {t('dataExport.scheduled.form.scheduleCron', 'Cron expression')}
            </AppText>
            <Input
              value={form.schedule_cron}
              onChangeText={text => setForm({...form, schedule_cron: text})}
              placeholder="0 9 * * 0"
              autoCapitalize="none"
              required
            />
            <AppText style={styles.scheduleHelp} tone="muted" variant="caption">
              {t(
                'dataExport.scheduled.form.scheduleCronHelp',
                "Standard 5-field cron, e.g. '0 9 * * 0'.",
              )}
            </AppText>
          </View>
          <View style={styles.scheduleField}>
            <AppText style={styles.scheduleFieldLabel} tone="secondary" variant="caption">
              {t('dataExport.scheduled.form.exportType', 'Export type')}
            </AppText>
            <Select
              value={form.export_type}
              onChange={value =>
                setForm({
                  ...form,
                  export_type: value as ScheduledExport['export_type'],
                })
              }
              options={SCHEDULE_EXPORT_TYPES.map(opt => ({value: opt, label: opt}))}
            />
          </View>
          <View style={styles.scheduleField}>
            <AppText style={styles.scheduleFieldLabel} tone="secondary" variant="caption">
              {t('dataExport.scheduled.form.format', 'Format')}
            </AppText>
            <Select
              value={form.format}
              onChange={value =>
                setForm({...form, format: value as ScheduledExport['format']})
              }
              options={SCHEDULE_FORMATS.map(opt => ({value: opt, label: opt}))}
            />
          </View>
          <View style={styles.scheduleField}>
            <AppText style={styles.scheduleFieldLabel} tone="secondary" variant="caption">
              {t('dataExport.scheduled.form.rangeWindow', 'Range window')}
            </AppText>
            <Input
              value={form.range_window ?? ''}
              onChangeText={text => setForm({...form, range_window: text})}
              placeholder="7d"
              autoCapitalize="none"
            />
            <AppText style={styles.scheduleHelp} tone="muted" variant="caption">
              {t('dataExport.scheduled.form.rangeWindowHelp', 'Format: number + m/h/d.')}
            </AppText>
          </View>
          <View style={styles.scheduleField}>
            <AppText style={styles.scheduleFieldLabel} tone="secondary" variant="caption">
              {t('dataExport.scheduled.form.deliveryKind', 'Delivery kind')}
            </AppText>
            <Select
              value={form.delivery.kind}
              onChange={value =>
                setForm({
                  ...form,
                  delivery: {
                    ...form.delivery,
                    kind: value as ScheduledExport['delivery']['kind'],
                  },
                })
              }
              options={DELIVERY_KINDS.map(opt => ({value: opt, label: opt}))}
            />
          </View>
          {form.delivery.kind !== 'download' ? (
            <View style={styles.scheduleField}>
              <AppText style={styles.scheduleFieldLabel} tone="secondary" variant="caption">
                {t('dataExport.scheduled.form.deliveryTarget', 'Delivery target')}
              </AppText>
              <Input
                value={form.delivery.target ?? ''}
                onChangeText={text =>
                  setForm({...form, delivery: {...form.delivery, target: text}})
                }
                placeholder={
                  form.delivery.kind === 'email'
                    ? 'you@example.com'
                    : 'https://example.com/hook'
                }
                autoCapitalize="none"
                required
              />
              <AppText style={styles.scheduleHelp} tone="muted" variant="caption">
                {t(
                  'dataExport.scheduled.form.deliveryTargetHelp',
                  'Email address or HTTPS URL.',
                )}
              </AppText>
            </View>
          ) : null}
          <View style={styles.scheduleFormButtons}>
            <Button variant="ghost" size="sm" onClick={closeForm}>
              {t('dataExport.scheduled.form.cancel', 'Cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={create.isPending || update.isPending}
              onClick={submit}>
              {t('dataExport.scheduled.form.submit', 'Save schedule')}
            </Button>
          </View>
        </View>
      ) : null}

      <View style={styles.scheduleBody}>
        {isLoading ? (
          <View style={styles.skeletonStack}>
            <Skeleton height={48} />
            <Skeleton height={48} />
            <Skeleton height={48} />
          </View>
        ) : rows.length === 0 ? (
          <EmptyState
            title={t('dataExport.scheduled.empty', 'No schedules yet')}
            message={t(
              'dataExport.scheduled.emptyMessage',
              'Create a schedule to receive recurring exports automatically.',
            )}
          />
        ) : (
          <View style={styles.scheduleList} testID="scheduled-exports-table">
            {rows.map(row => (
              <View
                key={row.id}
                testID={`scheduled-exports-row-${row.id}`}
                style={[styles.scheduleRow, row.enabled ? null : styles.scheduleRowDisabled]}>
                <View style={styles.scheduleRowMain}>
                  <AppText style={styles.scheduleRowName} weight="semibold">
                    {row.name}
                  </AppText>
                  <AppText style={styles.scheduleRowMeta} tone="secondary" variant="caption">
                    {row.export_type} ({row.format})
                  </AppText>
                  <AppText style={styles.scheduleRowCron} tone="muted" variant="caption">
                    {row.schedule_cron}
                  </AppText>
                  <AppText style={styles.scheduleRowMeta} tone="secondary" variant="caption">
                    {row.delivery.kind}
                    {row.delivery.target ? ` → ${row.delivery.target}` : ''}
                  </AppText>
                  <View style={styles.scheduleRunRow}>
                    <AppText style={styles.scheduleRowMeta} tone="muted" variant="caption">
                      {t('dataExport.scheduled.table.nextRun', 'Next run')}:{' '}
                    </AppText>
                    {row.next_run_at ? (
                      <TimeStamp value={row.next_run_at} style={styles.scheduleRowMeta} />
                    ) : (
                      <AppText style={styles.scheduleRowMeta} tone="muted" variant="caption">
                        —
                      </AppText>
                    )}
                  </View>
                  <View style={styles.scheduleRunRow}>
                    <AppText style={styles.scheduleRowMeta} tone="muted" variant="caption">
                      {t('dataExport.scheduled.table.lastRun', 'Last run')}:{' '}
                    </AppText>
                    {row.last_run_at ? (
                      <TimeStamp value={row.last_run_at} style={styles.scheduleRowMeta} />
                    ) : (
                      <AppText style={styles.scheduleRowMeta} tone="muted" variant="caption">
                        {t('dataExport.scheduled.status.never', 'Never')}
                      </AppText>
                    )}
                  </View>
                  <View style={styles.scheduleStatusRow}>
                    {row.last_status === 'ok' ? (
                      <Badge variant="success">
                        {t('dataExport.scheduled.status.ok', 'OK')}
                      </Badge>
                    ) : row.last_status === 'failed' ? (
                      <Badge variant="danger">
                        {t('dataExport.scheduled.status.failed', 'Failed')}
                      </Badge>
                    ) : (
                      <AppText style={styles.scheduleRowMeta} tone="muted" variant="caption">
                        —
                      </AppText>
                    )}
                  </View>
                </View>
                <View style={styles.scheduleActions}>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => runNow.mutate(row.id)}
                    loading={runNow.isPending && runNow.variables === row.id}>
                    {t('dataExport.scheduled.actions.runNow', 'Run now')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => toggleEnabled(row)}>
                    {row.enabled
                      ? t('dataExport.scheduled.actions.disable', 'Disable')
                      : t('dataExport.scheduled.actions.enable', 'Enable')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => startEdit(row)}>
                    {t('dataExport.scheduled.actions.edit', 'Edit')}
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => setPendingDelete(row)}>
                    {t('dataExport.scheduled.actions.delete', 'Delete')}
                  </Button>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('dataExport.scheduled.deleteConfirmTitle', 'Delete schedule?')}
        message={t(
          'dataExport.scheduled.deleteConfirmBody',
          'This will stop future runs of {{name}}.',
          {name: pendingDelete?.name ?? ''},
        )}
        variant="danger"
        confirmLabel={t('dataExport.scheduled.actions.delete', 'Delete')}
        onConfirm={() => {
          if (pendingDelete) {
            remove.mutate(pendingDelete.id);
          }
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </GlassPanel>
  );
}

/* ------------------------------------------------------------------ */
/*  RequiresAuth (native-safe port of @/components/feedback/RequiresAuth) */
/* ------------------------------------------------------------------ */

type RequiresAuthCapability = keyof AuthModeCapabilities;

function RequiresAuthPlaceholder({
  feature,
  providerHint,
  capability,
}: {
  feature: string;
  providerHint: string | undefined;
  capability: RequiresAuthCapability;
}) {
  const {t} = useTranslation();
  // Body copy: when the operator set a provider hint we surface it verbatim;
  // otherwise we fall back to the generic vendor-neutral string.
  const body = providerHint
    ? t(
        'requiresAuth.bodyWithHint',
        '{{feature}} is only available when TeslaSync is configured behind an authentication provider ({{provider}}). Set FORWARD_AUTH_HEADER on the API service to enable it.',
        {feature, provider: providerHint},
      )
    : t(
        'requiresAuth.body',
        '{{feature}} is only available when TeslaSync is configured behind an authentication provider (Authentik, Authelia, oauth2-proxy, Keycloak, or similar). Set FORWARD_AUTH_HEADER on the API service to enable it.',
        {feature},
      );
  const title = t(
    'requiresAuth.title',
    '{{feature}} requires authentication mode',
    {feature},
  );
  return (
    <View
      accessibilityRole="text"
      style={styles.requiresAuthBox}
      testID={`requires-auth-empty-${capability}`}>
      <AppText style={styles.requiresAuthGlyph} tone="muted">
        🔒
      </AppText>
      <AppText style={styles.requiresAuthTitle} weight="semibold">
        {title}
      </AppText>
      <AppText style={styles.requiresAuthBody} tone="secondary" variant="caption">
        {body}
      </AppText>
    </View>
  );
}

function RequiresAuth({
  capability,
  feature,
  children,
}: {
  capability: RequiresAuthCapability;
  feature: string;
  children: ReactNode;
}) {
  const {data, isLoading} = useAuthMode();

  // While the contract resolves, render the placeholder rather than the
  // children — flashing a fully-mounted section and then hiding it would tear
  // down any in-progress queries the children kicked off.
  if (isLoading || !data) {
    return (
      <RequiresAuthPlaceholder
        capability={capability}
        feature={feature}
        providerHint={undefined}
      />
    );
  }

  // forward-auth mode + capability enabled → mount the section.
  if (data.mode === 'forward_auth' && data.capabilities[capability]) {
    return <>{children}</>;
  }

  return (
    <RequiresAuthPlaceholder
      capability={capability}
      feature={feature}
      providerHint={data.provider_hint}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  JobProgressDrawer (native-safe port of the floating widget)        */
/* ------------------------------------------------------------------ */

type DrawerState = 'open' | 'minimized' | 'dismissed';
type JobBucket = 'active' | 'recent';

function isActiveJob(job: HookExportJobSummary): boolean {
  return job.status === 'queued' || job.status === 'processing';
}

function bucketFor(job: HookExportJobSummary): JobBucket {
  return isActiveJob(job) ? 'active' : 'recent';
}

function statusIconFor(status: HookExportJobSummary['status']): React.ReactElement {
  switch (status) {
    case 'queued':
      return <Icons.clock className="h-3.5 w-3.5" />;
    case 'processing':
      return <Icons.loading className="h-3.5 w-3.5 animate-spin" />;
    case 'ready':
      return <Icons.successFilled className="h-3.5 w-3.5" />;
    case 'failed':
      return <Icons.error className="h-3.5 w-3.5" />;
    case 'expired':
      return <Icons.alertCircle className="h-3.5 w-3.5" />;
    default:
      return <Icons.clock className="h-3.5 w-3.5" />;
  }
}

function prettyJobType(type: string, t: TFunc): string {
  switch (type) {
    case 'account':
      return t('export.types.account', 'Account export');
    case 'drives':
      return t('export.types.drives', 'Drives');
    case 'charging':
      return t('export.types.charging', 'Charging');
    case 'analytics':
      return t('export.types.analytics', 'Analytics');
    case 'backup':
      return t('export.types.backup', 'Backup');
    case 'import_drives':
      return t('export.types.importDrives', 'Import drives');
    case 'import_charging':
      return t('export.types.importCharging', 'Import charging');
    default:
      return type;
  }
}

function prettyJobStatus(status: HookExportJobSummary['status'], t: TFunc): string {
  switch (status) {
    case 'queued':
      return t('export.status.queued', 'Queued');
    case 'processing':
      return t('export.status.processing', 'Processing');
    case 'ready':
      return t('export.status.ready', 'Ready');
    case 'failed':
      return t('export.status.failed', 'Failed');
    case 'expired':
      return t('export.status.expired', 'Expired');
    default:
      return status;
  }
}

function JobRow({job}: {job: HookExportJobSummary}) {
  const {t} = useTranslation();
  const bucket = bucketFor(job);
  return (
    <View style={[styles.jobRow, bucket === 'active' ? styles.jobRowActive : null]}>
      <View style={styles.jobRowIcon}>{statusIconFor(job.status)}</View>
      <View style={styles.flex1}>
        <View style={styles.jobRowTitle}>
          <AppText numberOfLines={1} style={styles.jobRowType} weight="semibold">
            {prettyJobType(job.type, t)}
          </AppText>
          <AppText style={styles.jobRowFormat} tone="muted" variant="caption">
            {job.format}
          </AppText>
        </View>
        <AppText numberOfLines={1} style={styles.jobRowMeta} tone="muted" variant="caption">
          {bucket === 'active'
            ? t('export.jobDrawer.statusLine', '{{status}} · started {{relative}}', {
                status: prettyJobStatus(job.status, t),
                relative: formatRelative(job.created_at),
              })
            : t('export.jobDrawer.completedLine', '{{size}} · {{relative}}', {
                size:
                  formatBytes(job.file_size, {zeroAsEmpty: true, gbDecimals: 2}) || '—',
                relative: formatRelative(job.completed_at ?? job.created_at),
              })}
        </AppText>
        {job.error_message ? (
          <AppText numberOfLines={1} style={styles.jobRowError} variant="caption">
            {job.error_message}
          </AppText>
        ) : null}
      </View>
      {job.status === 'ready' ? (
        <Button
          variant="ghost"
          size="sm"
          icon={<Icons.download className="h-3 w-3" />}
          onClick={() => {
            void Linking.openURL(exportDownloadUrl(job.id)).catch(() => undefined);
          }}>
          {t('export.jobDrawer.download', 'Download')}
        </Button>
      ) : null}
    </View>
  );
}

function DrawerSection({
  label,
  emptyLabel,
  jobs,
}: {
  label: string;
  emptyLabel: string;
  jobs: HookExportJobSummary[];
}) {
  return (
    <View style={styles.drawerSection}>
      <AppText style={styles.drawerSectionLabel} tone="muted" variant="caption">
        {label}
      </AppText>
      {jobs.length === 0 ? (
        <AppText style={styles.drawerEmpty} tone="muted" variant="caption">
          {emptyLabel}
        </AppText>
      ) : (
        jobs.map(job => <JobRow key={job.id} job={job} />)
      )}
    </View>
  );
}

// Native-safe JobProgressDrawer: the web widget persists open/minimized/
// dismissed in localStorage and floats fixed bottom-right; RN has neither, so
// the state is in-memory and the drawer renders inline at the foot of the page.
function JobProgressDrawer({maxRecent = 5}: {maxRecent?: number}) {
  const {t} = useTranslation();
  const {data: jobs, isLoading} = useExportJobs();
  const allJobs = useMemo(() => jobs ?? [], [jobs]);

  const [state, setState] = useState<DrawerState>('minimized');

  const activeJobs = useMemo(() => allJobs.filter(isActiveJob), [allJobs]);
  const recentJobs = useMemo(
    () => allJobs.filter(j => !isActiveJob(j)).slice(0, maxRecent),
    [allJobs, maxRecent],
  );

  // Auto-promote dismissed → minimized when a NEW job appears so the user
  // notices it.
  useEffect(() => {
    if (activeJobs.length > 0 && state === 'dismissed') {
      setState('minimized');
    }
  }, [activeJobs.length, state]);

  if (state === 'dismissed' && activeJobs.length === 0) {
    return null;
  }
  if (allJobs.length === 0 && !isLoading) {
    return null;
  }

  if (state === 'minimized') {
    const activeCount = activeJobs.length;
    return (
      <View style={styles.drawerChipWrap}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t(
            'export.jobDrawer.expand',
            'Show export jobs ({{count}} active)',
            {count: activeCount},
          )}
          onPress={() => setState('open')}
          style={({pressed}) => [
            styles.drawerChip,
            pressed ? styles.drawerChipPressed : null,
          ]}>
          {activeCount > 0 ? (
            <Icons.loading className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Icons.package className="h-3.5 w-3.5" />
          )}
          <AppText style={styles.drawerChipText} tone="secondary" variant="caption">
            {activeCount > 0
              ? t('export.jobDrawer.activeCount', '{{count}} export running', {
                  count: activeCount,
                })
              : t('export.jobDrawer.recentLabel', 'Exports')}
          </AppText>
        </Pressable>
      </View>
    );
  }

  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={t('export.jobDrawer.label', 'Export job progress')}
      style={styles.drawer}>
      <View style={styles.drawerHeader}>
        <View style={styles.drawerHeaderLeft}>
          <Icons.package className="h-4 w-4 text-cyan-300" />
          <AppText numberOfLines={1} style={styles.drawerTitle} weight="semibold">
            {t('export.jobDrawer.title', 'Export jobs')}
          </AppText>
          {activeJobs.length > 0 ? (
            <Badge variant="info" size="sm">
              {t('export.jobDrawer.activePill', '{{count}} active', {
                count: activeJobs.length,
              })}
            </Badge>
          ) : null}
        </View>
        <View style={styles.drawerHeaderActions}>
          <Button
            variant="ghost"
            size="sm"
            accessibilityLabel={t('export.jobDrawer.minimize', 'Minimize')}
            icon={<AppText style={styles.iconGlyph}>—</AppText>}
            onClick={() => setState('minimized')}
          />
          <Button
            variant="ghost"
            size="sm"
            accessibilityLabel={t('export.jobDrawer.close', 'Dismiss')}
            icon={<Icons.error className="h-3.5 w-3.5" />}
            onClick={() => setState('dismissed')}
          />
        </View>
      </View>

      <View style={styles.drawerBody}>
        {isLoading && allJobs.length === 0 ? (
          <AppText style={styles.drawerEmpty} tone="muted" variant="caption">
            {t('export.jobDrawer.loading', 'Loading export jobs…')}
          </AppText>
        ) : (
          <>
            <DrawerSection
              label={t('export.jobDrawer.activeHeading', 'In progress')}
              emptyLabel={t('export.jobDrawer.activeEmpty', 'No active exports')}
              jobs={activeJobs}
            />
            <DrawerSection
              label={t('export.jobDrawer.recentHeading', 'Recent')}
              emptyLabel={t('export.jobDrawer.recentEmpty', 'No recent exports')}
              jobs={recentJobs}
            />
          </>
        )}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export default function DataExportPage() {
  const {t} = useTranslation();
  const queryClient = useQueryClient();
  const toast = useToast();

  usePageTitle(t('dataExport.title', 'Data Export'));

  /* --- Queries --- */

  const {
    data: jobs,
    isLoading: jobsLoading,
    error: jobsError,
  } = useQuery<ExportJobSummary[]>({
    queryKey: ['export-jobs'],
    queryFn: () => request<ExportJobSummary[]>('/export/jobs'),
    refetchInterval: 10_000,
  });

  const {data: vehicles, isLoading: vehiclesLoading} = useQuery<Vehicle[]>({
    queryKey: ['vehicles'],
    queryFn: () => request<Vehicle[]>('/vehicles'),
  });

  /* --- Mutations --- */

  const submitExport = useMutation({
    mutationFn: (payload: ExportSubmitPayload) =>
      request<ExportJobSummary>('/export/jobs', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      toast.success(t('Export Started'), t('Export Started Msg'));
      queryClient.invalidateQueries({queryKey: ['export-jobs']});
    },
    onError: () => {
      toast.error(t('Export Failed'), t('Export Failed Msg'));
    },
  });

  /* --- Handlers --- */

  // Web window.open(`/api/v1/export/jobs/${id}/download`) -> Linking.openURL of
  // the identical API path resolved against the configured native host.
  const handleDownload = useCallback((job: ExportJobSummary) => {
    void Linking.openURL(apiUrl(`/export/jobs/${job.id}/download`)).catch(
      () => undefined,
    );
  }, []);

  const handleRefresh = useCallback(() => {
    queryClient.invalidateQueries({queryKey: ['export-jobs']});
  }, [queryClient]);

  const handleSubmit = useCallback(
    (payload: ExportSubmitPayload) => {
      submitExport.mutate(payload);
    },
    [submitExport],
  );

  /* --- Derived data for overview --- */
  const dataOverview = useMemo<DataOverview | undefined>(() => {
    if (!jobs) {
      return undefined;
    }
    const drives = jobs
      .filter(j => j.type === 'drives')
      .reduce((s, j) => s + (j.record_count ?? 0), 0);
    const charging = jobs
      .filter(j => j.type === 'charging')
      .reduce((s, j) => s + (j.record_count ?? 0), 0);
    return {drives, charging_sessions: charging};
  }, [jobs]);

  const isLoading = jobsLoading || vehiclesLoading;

  /* --- Render --- */

  return (
    <PageContainer
      title={t('dataExport.title', 'Data Export')}
      subtitle={t('dataExport.subtitle', 'Export vehicle data in CSV or JSON format')}
      loading={isLoading}
      error={(jobsError as Error | null) ?? null}
      actions={
        <Button
          variant="ghost"
          size="sm"
          icon={<Icons.refresh className="h-4 w-4" />}
          onClick={handleRefresh}>
          {t('dataExport.refresh', 'Refresh')}
        </Button>
      }>
      {/* Stats */}
      <FadeIn style={styles.section}>
        <StatsRow jobs={jobs} isLoading={jobsLoading} />
      </FadeIn>

      {/* GDPR-style "Download my data" */}
      <FadeIn delay={0.025} style={styles.section}>
        <AccountExportPanel vehicles={vehicles} />
      </FadeIn>

      {/* Export Wizard */}
      <FadeIn delay={0.05} style={styles.section}>
        <ExportWizard
          vehicles={vehicles}
          onSubmit={handleSubmit}
          isPending={submitExport.isPending}
        />
      </FadeIn>

      {/* Format Info + Data Overview row */}
      <FadeIn delay={0.1} style={styles.section}>
        <View style={styles.infoColumn}>
          <FormatInfoCards />
          <DataOverviewCard overview={dataOverview} isLoading={jobsLoading} />
        </View>
      </FadeIn>

      {/* Export History */}
      <FadeIn delay={0.15} style={styles.section}>
        <ExportHistoryTable
          jobs={jobs}
          isLoading={jobsLoading}
          vehicles={vehicles}
          onDownload={handleDownload}
          onRefresh={handleRefresh}
        />
      </FadeIn>

      {/* Recurring scheduled exports panel, gated by <RequiresAuth>. */}
      <FadeIn delay={0.2} style={styles.section}>
        <RequiresAuth
          capability="session_list"
          feature={t('dataExport.scheduled.feature', 'Scheduled exports')}>
          <ScheduledExportsPanel />
        </RequiresAuth>
      </FadeIn>

      {/* Floating job progress drawer — rendered inline at the foot natively. */}
      <JobProgressDrawer />
    </PageContainer>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  iconGlyph: {
    fontSize: 12,
    letterSpacing: 0.3,
    lineHeight: 16,
  },

  // PageContainer
  page: {
    backgroundColor: colors.background,
    flex: 1,
  },
  pageContent: {
    padding: spacing.lg,
  },
  pageHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  pageHeaderText: {
    flex: 1,
    paddingRight: spacing.md,
  },
  pageTitle: {
    color: colors.textPrimary,
    fontSize: 24,
    lineHeight: 30,
  },
  pageSubtitle: {
    marginTop: spacing.xs,
  },
  pageActions: {
    alignItems: 'flex-end',
  },
  pageLoading: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
  pageErrorBox: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 12,
    borderWidth: 1,
    padding: spacing.lg,
  },
  pageErrorText: {
    color: colors.danger,
  },

  // Badge
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeDot: {
    borderRadius: 4,
    height: 6,
    width: 6,
  },
  badgeText: {
    fontSize: 11,
    lineHeight: 15,
  },

  // Button
  btn: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  btnSm: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  btnMd: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  btnLg: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  btnIconOnly: {
    paddingHorizontal: spacing.sm,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  btnPressed: {
    opacity: 0.85,
  },
  btnIconWrap: {
    marginRight: spacing.xs,
  },
  btnText: {
    fontSize: 13,
    lineHeight: 18,
  },

  // Select option chips
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  option: {
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  optionActive: {
    backgroundColor: colors.surfaceSelected,
    borderColor: colors.borderAccent,
  },
  optionPressed: {
    opacity: 0.85,
  },
  optionText: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  optionTextActive: {
    color: colors.accent,
    fontSize: 13,
  },

  // DataTable
  table: {
    width: '100%',
  },
  tableRow: {
    flexDirection: 'row',
  },
  headerRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
  },
  bodyRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowCompact: {
    paddingVertical: spacing.sm,
  },
  rowComfortable: {
    paddingVertical: spacing.md,
  },
  cell: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  headerText: {
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  tableEmpty: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
  },
  tableEmptyText: {
    fontSize: 13,
  },
  pager: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  pagerBtn: {
    borderColor: colors.border,
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  pagerBtnDisabled: {
    opacity: 0.4,
  },
  pagerBtnPressed: {
    backgroundColor: colors.surfaceHover,
  },
  pagerLabel: {
    fontSize: 12,
  },

  // MetricCard
  metricCard: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    padding: spacing.md,
  },
  metricRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
  },
  metricBody: {
    flex: 1,
  },
  metricLabel: {
    fontSize: 12,
  },
  metricValue: {
    color: colors.textPrimary,
    fontSize: 20,
    lineHeight: 26,
    marginTop: 2,
  },
  metricSubtitle: {
    fontSize: 11,
    marginTop: 2,
  },
  metricIconBox: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },

  // ConfirmDialog / Modal
  modalOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  confirmPanel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    maxWidth: 420,
    padding: spacing.lg,
    width: '100%',
  },
  modalTitle: {
    color: colors.textPrimary,
    fontSize: 17,
    lineHeight: 22,
  },
  confirmMessage: {
    marginTop: spacing.sm,
  },
  confirmButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
    marginTop: spacing.lg,
  },

  // Layout helpers
  section: {
    marginBottom: spacing.lg,
  },
  panelP6: {
    padding: spacing.lg,
  },
  panelP4: {
    padding: spacing.md,
  },
  panelP0: {
    overflow: 'hidden',
    padding: 0,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  wrapRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  flex1: {
    flex: 1,
  },

  // Stats grid
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  statCell: {
    flexBasis: '47%',
    flexGrow: 1,
    minWidth: 150,
  },

  // Export-type cards
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  typeCard: {
    backgroundColor: colors.surfaceGlass,
    borderRadius: 14,
    borderWidth: 2,
    flexBasis: '47%',
    flexGrow: 1,
    minWidth: 150,
    padding: spacing.md,
  },
  typeCardPressed: {
    opacity: 0.85,
  },
  typeCardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  typeIconBox: {
    alignItems: 'center',
    borderRadius: 10,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  typeLabel: {
    color: colors.textSecondary,
    flex: 1,
    fontSize: 13,
  },
  typeLabelActive: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 13,
  },
  typeDesc: {
    fontSize: 11,
    lineHeight: 15,
  },

  // Format info + overview
  infoColumn: {
    gap: spacing.md,
  },
  infoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  infoHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  infoTitle: {
    color: colors.textPrimary,
    fontSize: 13,
  },
  infoDesc: {
    marginBottom: spacing.sm,
  },
  codeBlock: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: spacing.md,
  },
  codeLine: {
    color: colors.textMuted,
    fontFamily: 'monospace',
    fontSize: 11,
    lineHeight: 16,
  },
  overviewLoading: {
    gap: spacing.sm,
  },
  overviewGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  overviewItem: {
    alignItems: 'center',
    flexBasis: '45%',
    flexDirection: 'row',
    flexGrow: 1,
    gap: spacing.sm,
  },
  overviewText: {
    fontSize: 12,
  },

  // Wizard
  wizardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  wizardTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
  },
  step: {
    marginBottom: spacing.lg,
  },
  stepLabel: {
    fontSize: 11,
    letterSpacing: 0.6,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
  },
  customRangeToggle: {
    alignItems: 'flex-start',
    marginTop: spacing.md,
  },
  customRangeFields: {
    marginTop: spacing.md,
  },
  submitRow: {
    alignItems: 'flex-start',
  },

  // Column picker
  columnPanel: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    padding: spacing.md,
  },
  columnHeader: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  columnHelper: {
    fontSize: 12,
  },
  columnGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  columnRow: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexBasis: '47%',
    flexDirection: 'row',
    flexGrow: 1,
    gap: spacing.sm,
    minWidth: 150,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  columnRowRequired: {
    opacity: 0.7,
  },
  columnRowPressed: {
    backgroundColor: colors.surfaceHover,
  },
  checkbox: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 4,
    borderWidth: 1,
    height: 18,
    justifyContent: 'center',
    width: 18,
  },
  checkboxChecked: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  checkboxMark: {
    color: colors.accent,
    fontSize: 12,
    lineHeight: 14,
  },
  columnLabel: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 12,
  },
  requiredChip: {
    backgroundColor: colors.warningSurface,
    borderRadius: 4,
    marginLeft: 'auto',
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
  },
  requiredChipText: {
    color: colors.warning,
    fontSize: 10,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },

  // History table
  cellText: {
    fontSize: 12,
  },
  cellTextMuted: {
    color: colors.textMuted,
    fontSize: 12,
  },
  errorCell: {
    color: colors.danger,
    fontSize: 11,
  },
  skeletonStack: {
    gap: spacing.sm,
  },
  tableHeaderRow: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  tableHeaderLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  tableHeaderTitle: {
    color: colors.textPrimary,
    fontSize: 13,
  },
  historyTableWrap: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },

  // Account export panel
  accountHeader: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  accountIconBox: {
    backgroundColor: colors.accentSoft,
    borderRadius: 10,
    padding: spacing.sm,
  },
  accountTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    lineHeight: 22,
  },
  accountSubtitle: {
    marginTop: spacing.xs,
  },
  accountFields: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  accountField: {
    flexBasis: '30%',
    flexGrow: 1,
    gap: spacing.xs,
    minWidth: 160,
  },
  fieldCaption: {
    fontSize: 12,
  },
  accountFooter: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: spacing.md,
    paddingTop: spacing.md,
  },
  accountWarning: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  accountWarningText: {
    flex: 1,
    fontSize: 12,
  },

  // Scheduled exports panel
  scheduleHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  scheduleTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    lineHeight: 24,
  },
  scheduleSubtitle: {
    marginTop: spacing.xs,
  },
  scheduleForm: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    gap: spacing.md,
    marginTop: spacing.lg,
    padding: spacing.md,
  },
  scheduleField: {
    gap: spacing.xs,
  },
  scheduleFieldLabel: {
    fontSize: 11,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  scheduleHelp: {
    fontSize: 11,
  },
  scheduleFormButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  scheduleBody: {
    marginTop: spacing.lg,
  },
  scheduleList: {
    gap: spacing.sm,
  },
  scheduleRow: {
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  scheduleRowDisabled: {
    opacity: 0.5,
  },
  scheduleRowMain: {
    gap: 2,
  },
  scheduleRowName: {
    color: colors.textPrimary,
    fontSize: 14,
  },
  scheduleRowMeta: {
    fontSize: 12,
  },
  scheduleRowCron: {
    fontFamily: 'monospace',
    fontSize: 11,
  },
  scheduleRunRow: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  scheduleStatusRow: {
    flexDirection: 'row',
    marginTop: spacing.xs,
  },
  scheduleActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },

  // RequiresAuth placeholder
  requiresAuthBox: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  requiresAuthGlyph: {
    fontSize: 28,
    lineHeight: 34,
  },
  requiresAuthTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    textAlign: 'center',
  },
  requiresAuthBody: {
    maxWidth: 420,
    textAlign: 'center',
  },

  // Job progress drawer
  jobRow: {
    alignItems: 'center',
    borderColor: 'transparent',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  jobRowActive: {
    backgroundColor: colors.surfaceRaised,
  },
  jobRowIcon: {
    width: 18,
  },
  jobRowTitle: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  jobRowType: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 12,
  },
  jobRowFormat: {
    fontSize: 10,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  jobRowMeta: {
    fontSize: 11,
  },
  jobRowError: {
    color: colors.danger,
    fontSize: 11,
    marginTop: 2,
  },
  drawerSection: {
    gap: spacing.xs,
  },
  drawerSectionLabel: {
    fontSize: 10,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  drawerEmpty: {
    fontSize: 12,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  drawerChipWrap: {
    alignItems: 'flex-end',
    marginTop: spacing.md,
  },
  drawerChip: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  drawerChipPressed: {
    backgroundColor: colors.surfaceHover,
  },
  drawerChipText: {
    fontSize: 12,
  },
  drawer: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    marginTop: spacing.md,
    overflow: 'hidden',
  },
  drawerHeader: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  drawerHeaderLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: spacing.sm,
  },
  drawerHeaderActions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  drawerTitle: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 12,
  },
  drawerBody: {
    gap: spacing.sm,
    padding: spacing.sm,
  },
});
