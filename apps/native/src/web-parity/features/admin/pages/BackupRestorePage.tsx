// Native parity port of web/src/features/admin/pages/BackupRestorePage.tsx.
//
// The web module is the admin "Backup & Restore" page: a PageContainer with a
// Quick-Backup + New-Config action row, a four-up MetricCard stats grid (Total
// Configs / Total Backups / Last Backup / Total Size), a "Backup Configurations"
// GlassPanel (DataTable of BackupConfig with trigger/edit/delete row actions or
// an EmptyState), a "Backup History" GlassPanel (DataTable of BackupRun with
// download/verify/preview row actions, a refresh button, and a "Recent Errors"
// list for failed runs), the portable Settings JSON bundle export/import surface
// (SettingsExportImport), a create/edit-config Modal (name/enabled/type/provider/
// frequency/retention + dynamic provider-credential fields + compress/encrypt
// toggles), a delete ConfirmDialog, and a restore-preview Modal (checksum status,
// metadata, per-table row counts). It is built from the shared web UI kit
// (PageContainer, GlassPanel, Badge, Button, Input, Select, Modal, Toggle,
// ConfirmDialog, DataTable, Textarea, MetricCard, TimeStamp, Skeleton, EmptyState,
// AlertBanner, FadeIn), react-i18next, TanStack Query, the lucide `Icons` set, the
// @/lib date/number/error formatters, and the @/api/client request()/getApiBase().
//
// Native-safe substitutions (rule 7), documented in the parity sidecar:
//   • react-i18next useTranslation() -> a local useTranslation() whose
//     t(key, fallbackOrOptions?, values?) returns the English fallback (or the
//     `defaultValue`) and interpolates {{token}} placeholders, so every key +
//     copy string is preserved verbatim at the call site (incl. the count/days/
//     name interpolations and the dynamic `backup.status.${status}` key).
//   • usePageTitle(...) -> a native no-op hook (no document.title in RN); the
//     call site and its key are preserved.
//   • useToast() -> a native Alert.alert bridge (success/error/warning), matching
//     the _toastHelpers parity precedent; only fired on user interaction.
//   • The shared web <PageContainer> -> an inlined native PageContainer that keeps
//     the exact branch semantics: header (title/subtitle/actions) always; then
//     loading -> spinner ONLY (children hidden), error -> error box, empty ->
//     empty copy, else children — wrapped in a ScrollView.
//   • The lucide-react `Icons.*` glyphs -> native glyph components built from the
//     SemanticIcon registry (the DOM `className`/`cn()` size+colour utilities are
//     accepted and ignored; the glyph renders in its semantic tone, and the
//     `animate-spin`/conditional colour overrides on placeholder glyphs are not
//     applied). `cn()` is inlined so icon class call sites stay verbatim.
//   • The shared web <Button>/<Badge>/<Select>/<Toggle>/<Modal>/<ConfirmDialog>/
//     <DataTable>/<MetricCard>/<TimeStamp> -> inlined native equivalents covering
//     exactly the props these call sites use (variants, sizes, icon, loading,
//     pagination, compact, sortable headers as no-op affordances, etc.).
//   • The shared web <Input>/<Textarea> -> the already-ported native <Input>
//     (web onChange={e=>set(e.target.value)} becomes onChangeText={set};
//     type="number" -> keyboardType="numeric"; type="password" -> secureTextEntry;
//     type="textarea" -> multiline). Select's onChange likewise receives the value.
//   • window.open(`${getApiBase()}/api/v1/backup/runs/${id}/download`) ->
//     Linking.openURL(apiUrl(`/backup/runs/${id}/download`)) — the identical URL,
//     opened in the device browser (RN has no in-page download), with a toast on
//     failure.
//   • SettingsExportImport (its own web file, not yet ported) -> a native-safe
//     local SettingsExportImport: the export endpoint is wired through the ported
//     useExportSettings hook, but the browser File-API import (file picker /
//     drag-drop) and the Blob/anchor save-as download are surfaced as an explicit
//     unavailable state (nativeSettingsBackupCapabilities.unavailableReason).
//   • @/lib formatters (fmtInt/formatBytes/formatRelative/formatDurationMsCompact/
//     getErrorMessage) -> inlined verbatim (en-US locale, the same "—" fallbacks).
//   • All Tailwind className styling -> StyleSheet styles + theme tokens; the
//     `--text-*`/`neon-*` colour intents map to the native token palette.
// Field access stays snake_case (the native request() camelCaseKeys keeps the
// original keys), and every API path / query key / mutation body is preserved.
// No DOM elements, react-i18next, lucide-react, Recharts, Leaflet, react-dom, or
// web UI-kit modules are imported into the native output.

import React, {
  useCallback,
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
import {AlertBanner} from '../../../components/feedback/AlertBanner';
import {FadeIn} from '../../../components/motion/FadeIn';
import {Input} from '../../../components/ui/Input';
import {request, apiUrl} from '../../../api/client';
import {
  useExportSettings,
  createSettingsBundleExportPayload,
  nativeSettingsBackupCapabilities,
  type SettingsBundle,
} from '../../../api/hooks/useSettingsBackup';
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
  warning: (message: string, detail?: string) => void;
}

// Web toast queue -> native Alert.alert (same _toastHelpers precedent). Fired
// only from mutation onSuccess/onError + interaction handlers, never at render.
function useToast(): Toast {
  return useMemo<Toast>(
    () => ({
      success: (message, detail) => Alert.alert(message, detail),
      error: (message, detail) => Alert.alert(message, detail),
      warning: (message, detail) => Alert.alert(message, detail),
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
function fmtInt(v: unknown): string {
  return safeNumber(v).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

// web @/lib/numberFormat formatBytes (binary units, "—" fallback).
function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) {
    return '—';
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
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDateFallback(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleDateString(undefined, {
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
  return formatDateFallback(d);
}

// web @/lib/dateFormat formatDurationMsCompact ("250ms" / "1.5s" / "2.5m").
function formatDurationMsCompact(ms: number | null | undefined): string {
  if (!isFiniteNumber(ms)) {
    return '—';
  }
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  return `${(ms / 60_000).toFixed(1)}m`;
}

// web @/lib/errorMessage getErrorMessage.
function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  return 'An unexpected error occurred';
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
// tone, mirroring the SummaryStatsRow / FleetApiSection icon-port precedent.
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
  folderOpen: makeIcon('folderOpen'),
  cloud: makeIcon('cloud'),
  successFilled: makeIcon('successFilled'),
  error: makeIcon('error'),
  loading: makeIcon('loading'),
  timer: makeIcon('timer'),
  play: makeIcon('play'),
  pencil: makeIcon('pencil'),
  delete: makeIcon('delete'),
  download: makeIcon('download'),
  securityCheck: makeIcon('securityCheck'),
  show: makeIcon('show'),
  charging: makeIcon('charging'),
  add: makeIcon('add'),
  database: makeIcon('database'),
  archive: makeIcon('archive'),
  clock: makeIcon('clock'),
  hardDrive: makeIcon('hardDrive'),
  alertCircle: makeIcon('alertCircle'),
  upload: makeIcon('upload'),
  fileJson: makeIcon('fileJson'),
};

/* ------------------------------------------------------------------ */
/*  Inlined @/components/ui Badge                                      */
/* ------------------------------------------------------------------ */

type BadgeVariant = 'neutral' | 'warning' | 'info' | 'success' | 'danger';

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
  danger: {bg: colors.dangerSurface, border: colors.dangerBorder, text: colors.danger},
};

interface BadgeProps {
  variant?: BadgeVariant;
  size?: 'sm';
  children: ReactNode;
}

function Badge({variant = 'neutral', children}: BadgeProps) {
  const tone = BADGE_TONES[variant];
  return (
    <View style={[styles.badge, {backgroundColor: tone.bg, borderColor: tone.border}]}>
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

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost';

interface ButtonProps {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  icon?: ReactNode;
  loading?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  accessibilityLabel?: string;
  children?: ReactNode;
}

const BUTTON_TONES: Record<ButtonVariant, {bg: string; border: string; text: string}> = {
  primary: {bg: colors.accent, border: colors.accent, text: colors.background},
  secondary: {
    bg: colors.surfaceRaised,
    border: colors.border,
    text: colors.textPrimary,
  },
  outline: {bg: 'transparent', border: colors.border, text: colors.textPrimary},
  ghost: {bg: 'transparent', border: 'transparent', text: colors.textSecondary},
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
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{disabled: isDisabled, busy: !!loading}}
      disabled={isDisabled}
      onPress={onClick}
      style={({pressed}) => [
        styles.btn,
        size === 'sm' ? styles.btnSm : styles.btnMd,
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
  label?: string;
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
}

// Web <select> -> a labelled row of pressable option chips (the selected chip is
// accent-tinted). onChange receives the chosen option value, mirroring the web
// `e.target.value` payload.
function Select({label, options, value, onChange}: SelectProps) {
  return (
    <View style={styles.field}>
      {label ? (
        <AppText style={styles.fieldLabel} tone="secondary">
          {label}
        </AppText>
      ) : null}
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
                style={active ? styles.optionTextActive : styles.optionText}
                weight={active ? 'semibold' : 'regular'}>
                {opt.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/ui Toggle                                     */
/* ------------------------------------------------------------------ */

interface ToggleProps {
  label?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function Toggle({label, checked, onChange}: ToggleProps) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{checked}}
      onPress={() => onChange(!checked)}
      style={styles.toggleRow}>
      <View style={[styles.toggleTrack, checked ? styles.toggleTrackOn : null]}>
        <View style={[styles.toggleThumb, checked ? styles.toggleThumbOn : null]} />
      </View>
      {label ? (
        <AppText style={styles.toggleLabel} tone="secondary">
          {label}
        </AppText>
      ) : null}
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/ui Modal                                      */
/* ------------------------------------------------------------------ */

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
}

function Modal({open, onClose, title, children}: ModalProps) {
  return (
    <RNModal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={open}>
      <Pressable accessibilityLabel="Close" onPress={onClose} style={styles.modalOverlay}>
        <Pressable style={styles.modalPanel} onPress={() => undefined}>
          <View style={styles.modalHeader}>
            <AppText style={styles.modalTitle} weight="bold">
              {title}
            </AppText>
            <Button accessibilityLabel="Close" icon={<AppText style={styles.iconGlyph}>X</AppText>} onClick={onClose} variant="ghost" />
          </View>
          <ScrollView style={styles.modalScroll}>{children}</ScrollView>
        </Pressable>
      </Pressable>
    </RNModal>
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
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({
  open,
  title,
  message,
  variant = 'default',
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <RNModal animationType="fade" onRequestClose={onCancel} transparent visible={open}>
      <Pressable accessibilityLabel={cancelLabel} onPress={onCancel} style={styles.modalOverlay}>
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
            <Button onClick={onConfirm} variant={variant === 'danger' ? 'primary' : 'primary'}>
              {confirmLabel}
            </Button>
          </View>
        </Pressable>
      </Pressable>
    </RNModal>
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
            <AppText numberOfLines={1} style={styles.headerText} tone="muted" weight="semibold">
              {col.header}
            </AppText>
          </View>
        ))}
      </View>

      {pagedData.map(row => (
        <View key={String(keyExtractor(row))} style={[styles.tableRow, styles.bodyRow, rowPad]}>
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
}

function MetricCard({label, value, icon, color = 'cyan'}: MetricCardProps) {
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
        </View>
        {icon ? (
          <View style={[styles.metricIconBox, {backgroundColor: tint.bg, borderColor: tint.border}]}>
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
/*  Inlined @/components/layout PageContainer                          */
/* ------------------------------------------------------------------ */

interface PageContainerProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  loading?: boolean;
  error?: Error | null;
  empty?: boolean;
  emptyMessage?: string;
  children: ReactNode;
}

function PageContainer({
  title,
  subtitle,
  actions,
  loading,
  error,
  empty,
  emptyMessage,
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
      ) : empty ? (
        <View style={styles.pageEmpty}>
          <AppText tone="muted" variant="caption">
            {emptyMessage ?? `No ${title.toLowerCase()} found.`}
          </AppText>
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

interface BackupConfig {
  id: number;
  name: string;
  enabled: boolean;
  backup_type: string;
  frequency_days: number;
  max_retention: number;
  provider: string;
  provider_config: Record<string, string>;
  include_tables?: string[];
  compress: boolean;
  encrypt: boolean;
  last_run_at?: string | null;
  next_run_at?: string | null;
  created_at: string;
  updated_at: string;
}

interface BackupRun {
  id: number;
  config_id: number | null;
  run_type: string;
  backup_type: string;
  status: string;
  provider: string;
  file_name?: string | null;
  file_path?: string | null;
  file_size: number;
  record_count: number;
  table_count: number;
  checksum?: string | null;
  duration_ms: number;
  error_message?: string | null;
  metadata?: Record<string, unknown>;
  started_at?: string | null;
  completed_at?: string | null;
  created_at: string;
}

interface RestorePreview {
  tables: {name: string; rows: number}[];
  metadata: Record<string, unknown> | null;
  checksum_verified: boolean;
}

type ConfigFormData = Omit<
  BackupConfig,
  'id' | 'last_run_at' | 'next_run_at' | 'created_at' | 'updated_at'
>;

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const PROVIDERS: {value: string; label: string}[] = [
  {value: 'local', label: 'Local'},
  {value: 's3', label: 'Amazon S3'},
  {value: 'azure', label: 'Azure Blob'},
  {value: 'gcs', label: 'Google Cloud'},
];

const PROVIDER_BADGE_VARIANT: Record<string, BadgeVariant> = {
  local: 'neutral',
  s3: 'warning',
  azure: 'info',
  gcs: 'success',
};

const PROVIDER_ICON: Record<string, IconComponent> = {
  local: Icons.folderOpen,
  s3: Icons.cloud,
  azure: Icons.cloud,
  gcs: Icons.cloud,
};

// Web STATUS_CONFIG carries Tailwind text/bg colour classes for the status icon;
// natively those collapse into the Badge `variant` + the glyph's semantic tone.
const STATUS_CONFIG: Record<
  string,
  {icon: IconComponent; variant: BadgeVariant}
> = {
  completed: {icon: Icons.successFilled, variant: 'success'},
  failed: {icon: Icons.error, variant: 'danger'},
  running: {icon: Icons.loading, variant: 'info'},
  queued: {icon: Icons.timer, variant: 'neutral'},
};

const EMPTY_FORM: ConfigFormData = {
  name: '',
  enabled: true,
  backup_type: 'full',
  frequency_days: 1,
  max_retention: 7,
  provider: 'local',
  provider_config: {path: '/backups'},
  compress: true,
  encrypt: false,
};

const BACKUP_TYPE_OPTIONS = [
  {value: 'full', label: 'Full'},
  {value: 'incremental', label: 'Incremental'},
];

const PROVIDER_OPTIONS = PROVIDERS.map(p => ({value: p.value, label: p.label}));

const PROVIDER_FIELDS: Record<
  string,
  {key: string; label: string; type?: string; required?: boolean; placeholder?: string}[]
> = {
  local: [{key: 'path', label: 'Path', required: true, placeholder: '/backups'}],
  s3: [
    {key: 'bucket', label: 'Bucket', required: true, placeholder: 'my-backup-bucket'},
    {key: 'region', label: 'Region', required: true, placeholder: 'us-east-1'},
    {key: 'access_key', label: 'Access Key', required: true},
    {key: 'secret_key', label: 'Secret Key', required: true, type: 'password'},
    {key: 'endpoint', label: 'Endpoint (optional)', placeholder: 'https://s3.amazonaws.com'},
    {key: 'prefix', label: 'Prefix (optional)', placeholder: 'backups/'},
  ],
  azure: [
    {key: 'account_name', label: 'Account Name', required: true},
    {key: 'account_key', label: 'Account Key', required: true, type: 'password'},
    {key: 'container_name', label: 'Container Name', required: true},
    {key: 'prefix', label: 'Prefix (optional)', placeholder: 'backups/'},
  ],
  gcs: [
    {key: 'bucket', label: 'Bucket', required: true, placeholder: 'my-backup-bucket'},
    {key: 'credentials_json', label: 'Credentials JSON', required: true, type: 'textarea'},
    {key: 'prefix', label: 'Prefix (optional)', placeholder: 'backups/'},
  ],
};

/* ------------------------------------------------------------------ */
/*  SettingsExportImport (native-safe local port)                     */
/* ------------------------------------------------------------------ */

// The web SettingsExportImport is its own (not-yet-ported) module. Its export
// endpoint is wired here through the ported useExportSettings hook; the browser
// File-API import (file picker / drag-drop) and Blob/anchor save-as download have
// no React Native analog, so they are surfaced as an explicit unavailable state.
function SettingsExportImport() {
  const {t} = useTranslation();
  const toast = useToast();
  const exportMut = useExportSettings();

  const handleExport = useCallback(async () => {
    try {
      const bundle: SettingsBundle = await exportMut.mutateAsync();
      const payload = createSettingsBundleExportPayload(bundle);
      const bytes = payload.json.length;
      toast.success(
        t('backup.export.successTitle', 'Settings exported'),
        t(
          'backup.export.nativeUnavailable',
          'Fetched {{bytes}} bytes. Save-as download is unavailable on native.',
          {bytes: fmtInt(bytes)},
        ),
      );
    } catch {
      // useExportSettings already surfaces a toast via useMutationToast.
    }
  }, [exportMut, t, toast]);

  return (
    <GlassPanel style={styles.panel}>
      <View style={styles.exportHeader}>
        <View style={styles.metricIconBox}>
          <Icons.database />
        </View>
        <View style={styles.flex1}>
          <AppText style={styles.h2} weight="semibold">
            {t('backup.title', 'Backup & Restore')}
          </AppText>
          <AppText tone="secondary" variant="caption">
            {t(
              'backup.subtitle',
              'Export your TeslaSync configuration as a JSON file you can stash in a backup folder or git repo, and import it on a fresh install.',
            )}
          </AppText>
        </View>
      </View>

      <View style={styles.exportRow}>
        <View style={styles.flex1}>
          <AppText style={styles.panelHeading} weight="semibold">
            {t('backup.export.title', 'Export settings')}
          </AppText>
          <AppText tone="muted" variant="caption">
            {t(
              'backup.export.help',
              'Includes general settings, alert rules, geofences, and your quiet-hours windows. Tesla credentials and notification-channel secrets are NEVER exported.',
            )}
          </AppText>
        </View>
        <Button
          icon={<Icons.download />}
          loading={exportMut.isPending}
          onClick={handleExport}>
          {exportMut.isPending
            ? t('backup.export.busy', 'Exporting…')
            : t('backup.export.cta', 'Export JSON')}
        </Button>
      </View>

      <View style={styles.importRow}>
        <AppText style={styles.panelHeading} weight="semibold">
          {t('backup.import.title', 'Import settings')}
        </AppText>
        <View style={styles.unavailableBox}>
          <Icons.alertCircle />
          <AppText style={styles.flex1} tone="secondary" variant="caption">
            {t('backup.import.nativeUnavailable', nativeSettingsBackupCapabilities.unavailableReason)}
          </AppText>
        </View>
      </View>
    </GlassPanel>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function BackupRestorePage() {
  const {t} = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  usePageTitle(t('backup.title', 'Backup & Restore'));

  /* ---- state ---- */
  const [modalOpen, setModalOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<BackupConfig | null>(null);
  const [form, setForm] = useState<ConfigFormData>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<BackupConfig | null>(null);
  const [previewData, setPreviewData] = useState<RestorePreview | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  /* ---- queries ---- */
  const {
    data: configs = [],
    isLoading: loadingConfigs,
    error: configsError,
  } = useQuery<BackupConfig[]>({
    queryKey: ['backup-configs'],
    queryFn: () => request<BackupConfig[]>('/backup/configs'),
  });

  const {data: runs = [], isLoading: loadingRuns, error: runsError} = useQuery<BackupRun[]>({
    queryKey: ['backup-runs'],
    queryFn: () => request<BackupRun[]>('/backup/runs'),
    refetchInterval: query => {
      const data = query.state.data;
      if (data?.some(r => r.status === 'queued' || r.status === 'running')) {
        return 5000;
      }
      return 30000;
    },
  });

  const anyError = [configsError, runsError].find(Boolean);
  const loading = loadingConfigs || loadingRuns;

  /* ---- derived stats ---- */
  const stats = useMemo(() => {
    const totalBackups = runs.length;
    const lastBackup = runs.find(r => r.status === 'completed');
    const totalSize = runs.reduce((sum, r) => sum + (r.file_size || 0), 0);
    return {totalBackups, lastBackup, totalSize};
  }, [runs]);

  const failedRuns = useMemo(
    () => runs.filter(r => r.status === 'failed' && r.error_message).slice(0, 5),
    [runs],
  );

  /* ---- mutations ---- */
  const invalidateAll = () => {
    qc.invalidateQueries({queryKey: ['backup-configs']});
    qc.invalidateQueries({queryKey: ['backup-runs']});
  };

  const createMutation = useMutation({
    mutationFn: (body: ConfigFormData) =>
      request<BackupConfig>('/backup/configs', {method: 'POST', body: JSON.stringify(body)}),
    onSuccess: () => {
      invalidateAll();
      toast.success(t('backup.configCreated', 'Config created'));
      closeModal();
    },
    onError: () => toast.error(t('backup.configCreateFailed', 'Failed to create config')),
  });

  const updateMutation = useMutation({
    mutationFn: ({id, body}: {id: number; body: ConfigFormData}) =>
      request<BackupConfig>(`/backup/configs/${id}`, {method: 'PUT', body: JSON.stringify(body)}),
    onSuccess: () => {
      invalidateAll();
      toast.success(t('backup.configUpdated', 'Config updated'));
      closeModal();
    },
    onError: () => toast.error(t('backup.configUpdateFailed', 'Failed to update config')),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => request<void>(`/backup/configs/${id}`, {method: 'DELETE'}),
    onSuccess: () => {
      invalidateAll();
      toast.success(t('backup.configDeleted', 'Config deleted'));
      setDeleteTarget(null);
    },
    onError: () => toast.error(t('backup.configDeleteFailed', 'Failed to delete config')),
  });

  const triggerMutation = useMutation({
    mutationFn: (configId: number) =>
      request<void>(`/backup/configs/${configId}/trigger`, {method: 'POST'}),
    onSuccess: () => {
      invalidateAll();
      toast.success(t('backup.triggered', 'Backup triggered'));
    },
    onError: () => toast.error(t('backup.triggerFailed', 'Failed to trigger backup')),
  });

  const quickBackupMutation = useMutation({
    mutationFn: () => request<void>('/backup/quick', {method: 'POST'}),
    onSuccess: () => {
      invalidateAll();
      toast.success(t('backup.quickStarted', 'Quick backup started'));
    },
    onError: () => toast.error(t('backup.quickFailed', 'Quick backup failed')),
  });

  const verifyMutation = useMutation({
    mutationFn: (runId: number) =>
      request<{verified: boolean}>(`/backup/runs/${runId}/verify`, {method: 'POST'}),
    onSuccess: data => {
      if (data.verified) {
        toast.success(t('backup.checksumVerified', 'Checksum verified'));
      } else {
        toast.warning(t('backup.checksumMismatch', 'Checksum mismatch'));
      }
    },
    onError: () => toast.error(t('backup.verifyFailed', 'Verification failed')),
  });

  /* ---- callbacks ---- */
  const closeModal = useCallback(() => {
    setModalOpen(false);
    setEditingConfig(null);
    setForm(EMPTY_FORM);
  }, []);

  const openCreate = useCallback(() => {
    setEditingConfig(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }, []);

  const openEdit = useCallback((cfg: BackupConfig) => {
    setEditingConfig(cfg);
    setForm({
      name: cfg.name,
      enabled: cfg.enabled,
      backup_type: cfg.backup_type,
      frequency_days: cfg.frequency_days,
      max_retention: cfg.max_retention,
      provider: cfg.provider,
      provider_config: {...cfg.provider_config},
      compress: cfg.compress,
      encrypt: cfg.encrypt,
    });
    setModalOpen(true);
  }, []);

  const handleSave = useCallback(() => {
    if (editingConfig) {
      updateMutation.mutate({id: editingConfig.id, body: form});
    } else {
      createMutation.mutate(form);
    }
  }, [editingConfig, form, updateMutation, createMutation]);

  const handleDownload = useCallback(
    (runId: number) => {
      // Web opens a new tab; RN opens the same download URL in the device browser.
      Linking.openURL(apiUrl(`/backup/runs/${runId}/download`)).catch(() =>
        toast.error(t('backup.downloadFailed', 'Failed to open download')),
      );
    },
    [t, toast],
  );

  const handlePreview = useCallback(
    async (runId: number) => {
      try {
        const data = await request<RestorePreview>(`/backup/runs/${runId}/preview`);
        setPreviewData(data);
        setPreviewOpen(true);
      } catch {
        toast.error(t('backup.previewFailed', 'Failed to load preview'));
      }
    },
    [t, toast],
  );

  const setField = useCallback(
    <K extends keyof ConfigFormData>(key: K, value: ConfigFormData[K]) => {
      setForm(prev => ({...prev, [key]: value}));
    },
    [],
  );

  const setProviderField = useCallback((key: string, value: string) => {
    setForm(prev => ({
      ...prev,
      provider_config: {...prev.provider_config, [key]: value},
    }));
  }, []);

  /* ---- columns: configs ---- */
  const configColumns: Column<BackupConfig>[] = [
    {
      key: 'name',
      header: t('backup.name', 'Name'),
      render: row => (
        <View style={styles.nameCell}>
          <AppText weight="semibold">{row.name}</AppText>
          {!row.enabled ? (
            <Badge size="sm" variant="neutral">
              {t('backup.disabled', 'Disabled')}
            </Badge>
          ) : null}
        </View>
      ),
    },
    {
      key: 'backup_type',
      header: t('backup.type', 'Type'),
      render: row => (
        <Badge size="sm" variant={row.backup_type === 'full' ? 'info' : 'warning'}>
          {row.backup_type === 'full'
            ? t('backup.full', 'Full')
            : t('backup.incremental', 'Incremental')}
        </Badge>
      ),
    },
    {
      key: 'provider',
      header: t('backup.provider', 'Provider'),
      render: row => {
        const p = PROVIDERS.find(pr => pr.value === row.provider);
        const ProvIcon = PROVIDER_ICON[row.provider] ?? Icons.cloud;
        return (
          <Badge size="sm" variant={PROVIDER_BADGE_VARIANT[row.provider] ?? 'neutral'}>
            <ProvIcon className="h-3 w-3 mr-1" />
            {p?.label ?? row.provider}
          </Badge>
        );
      },
    },
    {
      key: 'frequency',
      header: t('backup.frequency', 'Frequency'),
      render: row => (
        <AppText style={styles.bodySm} tone="secondary">
          {row.frequency_days === 1
            ? t('backup.daily', 'Daily')
            : t('backup.everyNDays', {days: row.frequency_days, defaultValue: 'Every {{days}}d'})}
        </AppText>
      ),
    },
    {
      key: 'schedule',
      header: t('backup.schedule', 'Schedule'),
      render: row => (
        <View style={styles.scheduleCell}>
          <AppText style={styles.bodyXs} tone="muted">
            {t('backup.lastRun', 'Last')}:{' '}
            <AppText style={styles.bodyXs} tone="secondary">
              {row.last_run_at ? formatRelative(row.last_run_at) : '—'}
            </AppText>
          </AppText>
          <AppText style={styles.bodyXs} tone="muted">
            {t('backup.nextRun', 'Next')}:{' '}
            <AppText style={styles.bodyXs} tone="secondary">
              {row.next_run_at ? formatRelative(row.next_run_at) : '—'}
            </AppText>
          </AppText>
        </View>
      ),
    },
    {
      key: 'options',
      header: t('backup.options', 'Options'),
      render: row => (
        <View style={styles.optionsCell}>
          {row.compress ? (
            <Badge size="sm" variant="neutral">
              {t('backup.compress', 'Compress')}
            </Badge>
          ) : null}
          {row.encrypt ? (
            <Badge size="sm" variant="warning">
              {t('backup.encrypt', 'Encrypt')}
            </Badge>
          ) : null}
        </View>
      ),
    },
    {
      key: 'actions',
      header: '',
      className: 'w-32 text-right',
      render: row => (
        <View style={styles.actionsCell}>
          <Button
            accessibilityLabel={t('backup.triggerNow', 'Trigger now')}
            icon={<Icons.play className="h-3.5 w-3.5" />}
            loading={triggerMutation.isPending}
            onClick={() => triggerMutation.mutate(row.id)}
            size="sm"
            variant="ghost"
          />
          <Button
            accessibilityLabel={t('backup.edit', 'Edit')}
            icon={<Icons.pencil className="h-3.5 w-3.5" />}
            onClick={() => openEdit(row)}
            size="sm"
            variant="ghost"
          />
          <Button
            accessibilityLabel={t('backup.delete', 'Delete')}
            icon={<Icons.delete className="h-3.5 w-3.5 text-neon-red" />}
            onClick={() => setDeleteTarget(row)}
            size="sm"
            variant="ghost"
          />
        </View>
      ),
    },
  ];

  /* ---- columns: runs ---- */
  const runColumns: Column<BackupRun>[] = [
    {
      key: 'created_at',
      header: t('backup.time', 'Time'),
      sortable: true,
      render: row => <TimeStamp style={styles.bodySmSecondary} value={row.created_at} />,
    },
    {
      key: 'run_type',
      header: t('backup.runType', 'Run Type'),
      render: row => (
        <Badge
          size="sm"
          variant={
            (
              {backup: 'info', restore: 'success', quick: 'warning'} as Record<
                string,
                BadgeVariant
              >
            )[row.run_type] ?? 'neutral'
          }>
          {row.run_type}
        </Badge>
      ),
    },
    {
      key: 'status',
      header: t('backup.status', 'Status'),
      sortable: true,
      render: row => {
        const s = STATUS_CONFIG[row.status] ?? STATUS_CONFIG.queued;
        const Icon = s.icon;
        return (
          <View style={styles.statusCell}>
            <Icon className={cn('h-4 w-4', row.status === 'running' && 'animate-spin')} />
            <Badge size="sm" variant={s.variant}>
              {t(`backup.status.${row.status}`, row.status)}
            </Badge>
          </View>
        );
      },
    },
    {
      key: 'provider',
      header: t('backup.provider', 'Provider'),
      render: row => {
        const p = PROVIDERS.find(pr => pr.value === row.provider);
        return (
          <Badge size="sm" variant={PROVIDER_BADGE_VARIANT[row.provider] ?? 'neutral'}>
            {p?.label ?? row.provider}
          </Badge>
        );
      },
    },
    {
      key: 'file_name',
      header: t('backup.file', 'File'),
      render: row => (
        <AppText numberOfLines={1} style={styles.fileText} tone="secondary">
          {row.file_name ?? '—'}
        </AppText>
      ),
    },
    {
      key: 'file_size',
      header: t('backup.size', 'Size'),
      sortable: true,
      render: row => (
        <AppText style={styles.bodySm}>{row.file_size ? formatBytes(row.file_size) : '—'}</AppText>
      ),
    },
    {
      key: 'record_count',
      header: t('backup.records', 'Records'),
      render: row => (
        <AppText style={styles.monoSecondary} tone="secondary">
          {row.record_count > 0 ? fmtInt(row.record_count) : '—'}
        </AppText>
      ),
    },
    {
      key: 'duration',
      header: t('backup.duration', 'Duration'),
      render: row => (
        <AppText style={styles.bodySm} tone="muted">
          {row.duration_ms > 0 ? formatDurationMsCompact(row.duration_ms) : '—'}
        </AppText>
      ),
    },
    {
      key: 'run_actions',
      header: '',
      className: 'w-28 text-right',
      render: row =>
        row.status === 'completed' ? (
          <View style={styles.actionsCell}>
            <Button
              accessibilityLabel={t('backup.download', 'Download')}
              icon={<Icons.download className="h-3.5 w-3.5" />}
              onClick={() => handleDownload(row.id)}
              size="sm"
              variant="ghost"
            />
            <Button
              accessibilityLabel={t('backup.verify', 'Verify')}
              icon={<Icons.securityCheck className="h-3.5 w-3.5" />}
              loading={verifyMutation.isPending}
              onClick={() => verifyMutation.mutate(row.id)}
              size="sm"
              variant="ghost"
            />
            <Button
              accessibilityLabel={t('backup.preview', 'Preview')}
              icon={<Icons.show className="h-3.5 w-3.5" />}
              onClick={() => handlePreview(row.id)}
              size="sm"
              variant="ghost"
            />
          </View>
        ) : null,
    },
  ];

  /* ---- preview table columns ---- */
  const previewColumns: Column<{name: string; rows: number}>[] = [
    {
      key: 'name',
      header: t('backup.table', 'Table'),
      render: row => (
        <AppText style={styles.mono} weight="semibold">
          {row.name}
        </AppText>
      ),
    },
    {
      key: 'rows',
      header: t('backup.rows', 'Rows'),
      render: row => <AppText>{fmtInt(row.rows)}</AppText>,
    },
  ];

  /* ---- render ---- */
  return (
    <PageContainer
      actions={
        <View style={styles.actionRow}>
          <Button
            icon={<Icons.charging className="h-4 w-4" />}
            loading={quickBackupMutation.isPending}
            onClick={() => quickBackupMutation.mutate()}
            size="sm"
            variant="secondary">
            {t('backup.quickBackup', 'Quick Backup')}
          </Button>
          <Button
            icon={<Icons.add className="h-4 w-4" />}
            onClick={openCreate}
            size="sm"
            variant="primary">
            {t('backup.newConfig', 'New Config')}
          </Button>
        </View>
      }
      error={configsError as Error | null}
      loading={loading}
      subtitle={t('backup.subtitle', 'Manage automated backups and restore points')}
      title={t('backup.title', 'Backup & Restore')}>
      {anyError ? (
        <AlertBanner icon={<Icons.alertCircle className="h-5 w-5" />} variant="danger">
          {`${t('error.loadFailed', 'Failed to load data')}: ${getErrorMessage(anyError)}`}
        </AlertBanner>
      ) : null}

      {/* ---- stats row ---- */}
      <FadeIn>
        <View style={styles.statsGrid}>
          {loading ? (
            Array.from({length: 4}).map((_, i) => (
              <View key={i} style={styles.statCell}>
                <Skeleton height={88} rounded />
              </View>
            ))
          ) : (
            <>
              <View style={styles.statCell}>
                <MetricCard
                  color="cyan"
                  icon={<Icons.database className="h-5 w-5" />}
                  label={t('backup.totalConfigs', 'Total Configs')}
                  value={fmtInt(configs.length)}
                />
              </View>
              <View style={styles.statCell}>
                <MetricCard
                  color="green"
                  icon={<Icons.archive className="h-5 w-5" />}
                  label={t('backup.totalBackups', 'Total Backups')}
                  value={fmtInt(stats.totalBackups)}
                />
              </View>
              <View style={styles.statCell}>
                <MetricCard
                  color="purple"
                  icon={<Icons.clock className="h-5 w-5" />}
                  label={t('backup.lastBackup', 'Last Backup')}
                  value={
                    stats.lastBackup
                      ? formatRelative(stats.lastBackup.completed_at ?? stats.lastBackup.created_at)
                      : '—'
                  }
                />
              </View>
              <View style={styles.statCell}>
                <MetricCard
                  icon={<Icons.hardDrive className="h-5 w-5" />}
                  label={t('backup.totalSize', 'Total Size')}
                  value={formatBytes(stats.totalSize)}
                />
              </View>
            </>
          )}
        </View>
      </FadeIn>

      {/* ---- backup configurations ---- */}
      <FadeIn delay={0.1}>
        <GlassPanel style={[styles.panel, styles.panelGap]}>
          <AppText style={styles.h2} weight="semibold">
            {t('backup.configurations', 'Backup Configurations')}
          </AppText>
          {configs.length === 0 && !loadingConfigs ? (
            <EmptyState
              action={{label: t('backup.newConfig', 'New Config'), onPress: openCreate}}
              icon={<Icons.database className="h-10 w-10 text-[var(--text-muted)]" />}
              message={t(
                'backup.noConfigsMessage',
                'Create a backup configuration to start protecting your data.',
              )}
              title={t('backup.noConfigs', 'No backup configurations')}
            />
          ) : (
            <DataTable<BackupConfig>
              columns={configColumns}
              compact
              data={configs}
              emptyMessage={t('backup.noConfigs', 'No backup configurations')}
              keyExtractor={r => r.id}
              pagination
              tableId="admin:backup-configs"
            />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ---- backup runs history ---- */}
      <FadeIn delay={0.2}>
        <GlassPanel style={[styles.panel, styles.panelGap]}>
          <View style={styles.panelHeaderRow}>
            <AppText style={styles.h2} weight="semibold">
              {t('backup.history', 'Backup History')}
            </AppText>
            <Button
              accessibilityLabel={t('backup.refresh', 'Refresh')}
              onClick={() => qc.invalidateQueries({queryKey: ['backup-runs']})}
              size="sm"
              variant="ghost">
              {t('backup.refresh', 'Refresh')}
            </Button>
          </View>
          {runs.length === 0 && !loadingRuns ? (
            <EmptyState
              icon={<Icons.clock className="h-10 w-10 text-[var(--text-muted)]" />}
              message={t('backup.noRunsMessage', 'Trigger a backup or wait for the scheduled run.')}
              title={t('backup.noRuns', 'No backup runs yet')}
            />
          ) : (
            <>
              <DataTable<BackupRun>
                columns={runColumns}
                compact
                data={runs}
                emptyMessage={t('backup.noRuns', 'No backup runs yet')}
                keyExtractor={r => r.id}
                pagination
                tableId="admin:backup-runs"
              />

              {/* Recent Errors for failed runs */}
              {failedRuns.length > 0 ? (
                <View style={styles.recentErrors}>
                  <AppText style={styles.recentErrorsTitle} weight="semibold">
                    {t('backup.recentErrors', 'Recent Errors')}
                  </AppText>
                  {failedRuns.map(run => (
                    <View key={`err-${run.id}`} style={styles.errorItem}>
                      <Icons.alertCircle className="h-4 w-4 text-neon-red shrink-0 mt-0.5" />
                      <View style={styles.flex1}>
                        <AppText style={styles.errorItemTitle} weight="semibold">
                          {run.file_name ?? `Run #${run.id}`}
                        </AppText>
                        <AppText style={styles.errorItemMsg}>{run.error_message}</AppText>
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}
            </>
          )}
        </GlassPanel>
      </FadeIn>

      {/* ---- portable settings JSON bundle ---- */}
      <FadeIn delay={0.3}>
        <View style={styles.panelGap}>
          <SettingsExportImport />
        </View>
      </FadeIn>

      {/* ---- create / edit config modal ---- */}
      <Modal
        onClose={closeModal}
        open={modalOpen}
        size="lg"
        title={
          editingConfig
            ? t('backup.editConfig', 'Edit Configuration')
            : t('backup.newConfig', 'New Configuration')
        }>
        <View style={styles.formCol}>
          <Input
            label={t('backup.configName', 'Name')}
            onChangeText={text => setField('name', text)}
            placeholder={t('backup.configNamePlaceholder', 'Daily full backup')}
            value={form.name}
          />

          <Toggle
            checked={form.enabled}
            label={t('backup.enabled', 'Enabled')}
            onChange={v => setField('enabled', v)}
          />

          <View style={styles.twoCol}>
            <View style={styles.flex1}>
              <Select
                label={t('backup.backupType', 'Backup Type')}
                onChange={value => setField('backup_type', value)}
                options={BACKUP_TYPE_OPTIONS}
                value={form.backup_type}
              />
            </View>
            <View style={styles.flex1}>
              <Select
                label={t('backup.provider', 'Provider')}
                onChange={value => {
                  setField('provider', value);
                  setField('provider_config', {});
                }}
                options={PROVIDER_OPTIONS}
                value={form.provider}
              />
            </View>
          </View>

          <View style={styles.twoCol}>
            <View style={styles.flex1}>
              <Input
                keyboardType="numeric"
                label={t('backup.frequencyDays', 'Frequency (days)')}
                onChangeText={text => setField('frequency_days', Math.max(1, Number(text)))}
                value={String(form.frequency_days)}
              />
            </View>
            <View style={styles.flex1}>
              <Input
                keyboardType="numeric"
                label={t('backup.maxRetention', 'Max Retention')}
                onChangeText={text => setField('max_retention', Math.max(1, Number(text)))}
                value={String(form.max_retention)}
              />
            </View>
          </View>

          {/* dynamic provider fields */}
          <View style={styles.providerBox}>
            <AppText style={styles.providerBoxTitle} tone="secondary" weight="semibold">
              {t('backup.providerSettings', 'Provider Settings')}
            </AppText>
            <View style={styles.providerFields}>
              {(PROVIDER_FIELDS[form.provider] ?? []).map(field => (
                <View key={field.key}>
                  {field.type === 'textarea' ? (
                    <Input
                      label={field.required ? `${field.label} *` : field.label}
                      multiline
                      numberOfLines={3}
                      onChangeText={text => setProviderField(field.key, text)}
                      placeholder={field.placeholder}
                      style={styles.textareaInput}
                      value={form.provider_config[field.key] ?? ''}
                    />
                  ) : (
                    <Input
                      label={field.required ? `${field.label} *` : field.label}
                      onChangeText={text => setProviderField(field.key, text)}
                      placeholder={field.placeholder}
                      secureTextEntry={field.type === 'password'}
                      value={form.provider_config[field.key] ?? ''}
                    />
                  )}
                </View>
              ))}
            </View>
          </View>

          <View style={styles.togglesRow}>
            <Toggle
              checked={form.compress}
              label={t('backup.compress', 'Compress')}
              onChange={v => setField('compress', v)}
            />
            <Toggle
              checked={form.encrypt}
              label={t('backup.encrypt', 'Encrypt')}
              onChange={v => setField('encrypt', v)}
            />
          </View>

          <View style={styles.modalFooter}>
            <Button onClick={closeModal} variant="outline">
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              disabled={!form.name.trim()}
              loading={createMutation.isPending || updateMutation.isPending}
              onClick={handleSave}
              variant="primary">
              {editingConfig
                ? t('backup.saveChanges', 'Save Changes')
                : t('backup.create', 'Create')}
            </Button>
          </View>
        </View>
      </Modal>

      {/* ---- delete confirm dialog ---- */}
      <ConfirmDialog
        cancelLabel={t('common.cancel', 'Cancel')}
        confirmLabel={t('backup.delete', 'Delete')}
        message={t(
          'backup.deleteConfigMessage',
          'Are you sure you want to delete "{{name}}"? This cannot be undone.',
          {name: deleteTarget?.name},
        )}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        open={!!deleteTarget}
        title={t('backup.deleteConfig', 'Delete Configuration')}
        variant="danger"
      />

      {/* ---- restore preview modal ---- */}
      <Modal
        onClose={() => {
          setPreviewOpen(false);
          setPreviewData(null);
        }}
        open={previewOpen}
        size="md"
        title={t('backup.restorePreview', 'Restore Preview')}>
        {previewData ? (
          <View style={styles.formCol}>
            <View style={styles.checksumRow}>
              <Icons.securityCheck
                className={cn(
                  'h-4 w-4',
                  previewData.checksum_verified ? 'text-emerald-300' : 'text-rose-300',
                )}
              />
              <AppText
                style={previewData.checksum_verified ? styles.textSuccess : styles.textDanger}>
                {previewData.checksum_verified
                  ? t('backup.checksumVerified', 'Checksum verified')
                  : t('backup.checksumFailed', 'Checksum verification failed')}
              </AppText>
            </View>

            {/* Metadata */}
            {previewData.metadata && Object.keys(previewData.metadata).length > 0 ? (
              <View style={styles.metadataBox}>
                <AppText style={styles.metadataTitle} tone="muted" weight="semibold">
                  {t('backup.metadata', 'Backup Metadata')}
                </AppText>
                <View style={styles.metadataList}>
                  {Object.entries(previewData.metadata).map(([k, v]) => (
                    <View key={k} style={styles.metadataItem}>
                      <AppText style={styles.bodyXs} tone="muted">
                        {k}
                      </AppText>
                      <AppText style={styles.metadataValue} tone="secondary">
                        {String(v)}
                      </AppText>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}

            {/* Tables */}
            {previewData.tables.length > 0 ? (
              <View>
                <AppText style={styles.metadataTitle} tone="muted" weight="semibold">
                  {`${t('backup.tables', 'Tables')} (${previewData.tables.length})`}
                </AppText>
                <DataTable<{name: string; rows: number}>
                  columns={previewColumns}
                  compact
                  data={previewData.tables}
                  keyExtractor={r => r.name}
                  pagination
                  tableId="admin:backup-preview-tables"
                />
              </View>
            ) : (
              <EmptyState message={t('backup.noTables', 'No tables found in backup')} />
            )}

            <View style={styles.modalFooterEnd}>
              <Button
                onClick={() => {
                  setPreviewOpen(false);
                  setPreviewData(null);
                }}
                variant="outline">
                {t('common.close', 'Close')}
              </Button>
            </View>
          </View>
        ) : (
          <View style={styles.previewLoading}>
            <Icons.loading className="h-6 w-6 animate-spin text-neon-purple mx-auto mb-2" />
            <AppText style={styles.previewLoadingText} tone="muted">
              {t('backup.loadingPreview', 'Loading preview…')}
            </AppText>
          </View>
        )}
      </Modal>
    </PageContainer>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  flex1: {flex: 1, minWidth: 0},
  page: {backgroundColor: colors.background, flex: 1},
  pageContent: {gap: spacing.lg, padding: spacing.lg},
  pageHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  pageHeaderText: {flex: 1, minWidth: 180},
  pageTitle: {color: colors.textPrimary, fontSize: 24, lineHeight: 30},
  pageSubtitle: {fontSize: 13, lineHeight: 18, marginTop: spacing.xs},
  pageActions: {alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm},
  pageLoading: {alignItems: 'center', justifyContent: 'center', paddingVertical: 80},
  pageErrorBox: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 12,
    borderWidth: 1,
    padding: spacing.md,
  },
  pageErrorText: {color: colors.danger, fontSize: 13, lineHeight: 18},
  pageEmpty: {alignItems: 'center', justifyContent: 'center', paddingVertical: 64},

  actionRow: {alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm},

  /* stats grid */
  statsGrid: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md},
  statCell: {flexGrow: 1, flexBasis: '46%', minWidth: 150},

  /* metric card */
  metricCard: {
    flex: 1,
    padding: spacing.md,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  metricBody: {flex: 1, minWidth: 0},
  metricLabel: {fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: spacing.xs},
  metricValue: {color: colors.textPrimary, fontSize: 20, lineHeight: 26},
  metricIconBox: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderAccent,
    backgroundColor: colors.accentSoft,
  },

  /* panels */
  panel: {padding: spacing.md},
  panelGap: {marginTop: spacing.lg},
  panelHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  h2: {color: colors.textPrimary, fontSize: 18, lineHeight: 24, marginBottom: spacing.md},
  panelHeading: {color: colors.textPrimary, fontSize: 14, lineHeight: 20, marginBottom: spacing.xs},

  /* icon glyph */
  iconGlyph: {fontSize: 12, lineHeight: 16, letterSpacing: 0.4, color: colors.textSecondary},

  /* badge */
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
  badgeText: {fontSize: 12, lineHeight: 16},

  /* button */
  btn: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: 8,
  },
  btnSm: {paddingHorizontal: spacing.sm, paddingVertical: 6, minHeight: 30},
  btnMd: {paddingHorizontal: spacing.md, paddingVertical: 8, minHeight: 38},
  btnIconOnly: {paddingHorizontal: 8, minWidth: 30},
  btnIconWrap: {marginRight: 2},
  btnText: {fontSize: 13, lineHeight: 18},
  btnDisabled: {opacity: 0.5},
  btnPressed: {opacity: 0.8},

  /* form fields */
  field: {gap: spacing.xs},
  fieldLabel: {color: colors.textSecondary, fontSize: 14, fontWeight: '500', lineHeight: 18},
  optionRow: {flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm},
  option: {
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  optionActive: {backgroundColor: colors.accentSoft, borderColor: colors.borderAccent},
  optionPressed: {opacity: 0.7},
  optionText: {color: colors.textSecondary, fontSize: 13},
  optionTextActive: {color: colors.accent, fontSize: 13},

  /* toggle */
  toggleRow: {alignItems: 'center', flexDirection: 'row', gap: spacing.sm},
  toggleTrack: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 24,
    justifyContent: 'center',
    paddingHorizontal: 2,
    width: 44,
  },
  toggleTrackOn: {backgroundColor: colors.accentSoft, borderColor: colors.borderAccent},
  toggleThumb: {
    backgroundColor: colors.textMuted,
    borderRadius: 999,
    height: 18,
    width: 18,
  },
  toggleThumbOn: {alignSelf: 'flex-end', backgroundColor: colors.accent},
  toggleLabel: {fontSize: 14},

  /* modal */
  modalOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalPanel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    maxHeight: '88%',
    maxWidth: 560,
    width: '100%',
  },
  modalHeader: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  modalTitle: {color: colors.textPrimary, fontSize: 18, lineHeight: 24},
  modalScroll: {padding: spacing.md},
  modalFooter: {
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'flex-end',
    paddingTop: spacing.sm,
  },
  modalFooterEnd: {flexDirection: 'row', justifyContent: 'flex-end', paddingTop: spacing.sm},

  /* confirm dialog */
  confirmPanel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    gap: spacing.md,
    maxWidth: 460,
    padding: spacing.lg,
    width: '100%',
  },
  confirmMessage: {fontSize: 14, lineHeight: 20},
  confirmButtons: {flexDirection: 'row', gap: spacing.md, justifyContent: 'flex-end'},

  /* form layout */
  formCol: {gap: spacing.lg, padding: 2},
  twoCol: {flexDirection: 'row', gap: spacing.md},
  togglesRow: {flexDirection: 'row', gap: spacing.xl},
  providerBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    padding: spacing.md,
  },
  providerBoxTitle: {fontSize: 14, lineHeight: 20, marginBottom: spacing.sm},
  providerFields: {gap: spacing.sm},
  textareaInput: {minHeight: 72, textAlignVertical: 'top'},

  /* table */
  table: {borderColor: colors.border, borderRadius: 16, borderWidth: 1, overflow: 'hidden'},
  tableRow: {flexDirection: 'row', paddingHorizontal: spacing.md},
  rowComfortable: {paddingVertical: spacing.sm},
  rowCompact: {paddingVertical: spacing.xs},
  headerRow: {backgroundColor: colors.surfaceSelected},
  bodyRow: {
    backgroundColor: colors.surfaceRaised,
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  cell: {
    alignItems: 'flex-start',
    flex: 1,
    justifyContent: 'center',
    minWidth: 0,
    paddingRight: spacing.xs,
  },
  headerText: {fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase'},
  tableEmpty: {alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.xl},
  tableEmptyText: {textAlign: 'center'},
  pager: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  pagerBtn: {
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  pagerBtnDisabled: {opacity: 0.4},
  pagerBtnPressed: {opacity: 0.7},
  pagerLabel: {minWidth: 96, textAlign: 'center'},

  /* cell content */
  nameCell: {alignItems: 'center', flexDirection: 'row', gap: spacing.sm},
  scheduleCell: {gap: 2},
  optionsCell: {flexDirection: 'row', flexWrap: 'wrap', gap: 6},
  actionsCell: {alignItems: 'center', flexDirection: 'row', gap: 2, justifyContent: 'flex-end'},
  statusCell: {alignItems: 'center', flexDirection: 'row', gap: 6},
  bodySm: {fontSize: 13},
  bodySmSecondary: {color: colors.textSecondary, fontSize: 13},
  bodyXs: {fontSize: 11, lineHeight: 15},
  fileText: {fontSize: 11, maxWidth: 200},
  mono: {fontSize: 13},
  monoSecondary: {fontSize: 13},

  /* recent errors */
  recentErrors: {
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
    borderTopWidth: 1,
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingTop: spacing.md,
  },
  recentErrorsTitle: {
    color: colors.danger,
    fontSize: 10,
    letterSpacing: 0.8,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
  },
  errorItem: {
    backgroundColor: colors.dangerSurface,
    borderRadius: 10,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  errorItemTitle: {color: colors.danger, fontSize: 12, lineHeight: 16},
  errorItemMsg: {color: colors.danger, fontSize: 11, lineHeight: 15, marginTop: 2, opacity: 0.85},

  /* settings export/import */
  exportHeader: {flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md},
  exportRow: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    paddingTop: spacing.md,
  },
  importRow: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.md,
  },
  unavailableBox: {
    alignItems: 'flex-start',
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },

  /* preview */
  checksumRow: {alignItems: 'center', flexDirection: 'row', gap: spacing.sm},
  textSuccess: {color: colors.success, fontSize: 14},
  textDanger: {color: colors.danger, fontSize: 14},
  metadataBox: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    padding: spacing.md,
  },
  metadataTitle: {fontSize: 10, letterSpacing: 0.8, marginBottom: spacing.sm, textTransform: 'uppercase'},
  metadataList: {gap: spacing.xs},
  metadataItem: {flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm},
  metadataValue: {fontSize: 12},
  previewLoading: {alignItems: 'center', paddingVertical: 48},
  previewLoadingText: {fontSize: 14, marginTop: spacing.sm},
});
