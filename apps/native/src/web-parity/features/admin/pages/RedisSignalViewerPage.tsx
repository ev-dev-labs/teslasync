/**
 * Native parity port of
 * web/src/features/admin/pages/RedisSignalViewerPage.tsx.
 *
 * The web file is the Redis Signal Viewer admin page. It (1) lets an operator
 * pick a vehicle, filter by free-text search + signal category, and toggle a
 * 5-second auto-refresh; (2) reads the vehicle's cached Redis L2 signals via
 * `getRedisSignals(vehicleId)` (TanStack `useQuery`, key ['redis-signals', id],
 * enabled when a vehicle is selected, refetchInterval = INTERVALS.REALTIME when
 * auto-refresh is on); (3) categorises every signal (Battery/Charging/Driving/
 * Climate/Other), renders four stat cards (total / numbers / strings / booleans)
 * and a sortable, paginated DataTable whose Value column masks lat/lng location
 * signals through a click-to-reveal MaskedValue; (4) surfaces a structured,
 * branch-aware diagnostic empty-state (RedisDiagnosticEmptyState) when the cache
 * is empty or the request failed; and (5) drives two destructive purge paths —
 * per-vehicle `purgeRedisSignals` and cluster-wide `purgeAllRedisSignals` (the
 * latter gated behind a typed "PURGE ALL" confirmation) — through a single
 * ConfirmDialog with toast feedback + query invalidation.
 *
 * This native port preserves that contract 1:1 — the same state names
 * (selectedVehicleId / search / autoRefresh / categoryFilter / purgeMode /
 * purgeTargetId / purgeTargetLabel / isPurging), the same `useQuery` keys + API
 * paths, the same `categorizeSignal` / `isLocationSignal` rules, the verbatim
 * `rows` / `filteredRows` / `categoryCounts` / `selectedVehicleLabel`
 * derivations, the verbatim `handlePurgeConfirm` / `openPurgeOne` / `openPurgeAll`
 * callbacks (incl. every toast key + invalidateQueries call), and the verbatim
 * RedisDiagnosticEmptyState branch ladder — using React Native primitives + the
 * existing native AppText / GlassPanel + design tokens and the already-ported
 * native ConfirmDialog / devtools client / useVehicles hook.
 *
 * Browser-only / unconverted dependencies are reduced explicitly and documented
 * in the `.parity.json` sidecar:
 *   - react-i18next `useTranslation` (web L2): native-safe `t(key, fallback?,
 *     vars?)` fallback returning the English default (else the key) and
 *     interpolating i18next-style `{{token}}` placeholders, so every parameterised
 *     key (vehicle / mode / date / count / limit / status / message) keeps its
 *     i18n intent. Every web key is preserved verbatim.
 *   - `@tanstack/react-query` `useQuery` / `useQueryClient` (web L3): kept verbatim
 *     — react-query is a native dependency mounted under the native QueryClient.
 *   - lucide-react Database/Search/RefreshCw/Trash2 + the diagnostic banner's
 *     AlertTriangle/Database/ServerCrash/Radio/Zap + MaskedValue Eye/EyeOff
 *     (web L4 + RedisDiagnosticEmptyState L4 + MaskedValue): decorative AppText
 *     glyph stand-ins, the established native inline-icon precedent; standalone
 *     glyphs are importantForAccessibility="no-hide-descendants" (the aria-hidden
 *     analog). The RefreshCw animate-spin is reduced to a static glyph.
 *   - `@/components/layout` `PageContainer` (web L6): local native-safe PageScaffold
 *     (title/subtitle/children — the only props used; the ApiPlaygroundPage
 *     "reproduce locally when no native parity port exists" precedent).
 *   - `@/components/ui` GlassPanel (web L7): the existing native GlassPanel. The
 *     ConfirmDialog import resolves to the already-ported native ConfirmDialog
 *     (../../../components/ui/ConfirmDialog); Badge / Button / DataTable /
 *     useSortToggle / Toggle / Input / Select / MaskedValue have no native parity
 *     port yet so each is reproduced locally as a native-safe equivalent.
 *   - `@/components/data-display` StatCard (web L8): a local native-safe StatCard
 *     (label / value / icon — the props the page uses).
 *   - `@/components/feedback` Skeleton / EmptyState + `useToast` (web L9-10):
 *     local native-safe Skeleton + EmptyState, and a `useToast()` bridging to
 *     React Native `Alert.alert(title, message?)` (the _toastHelpers precedent)
 *     preserving success / info / warning / error (title, message?) calls.
 *   - `@/components/motion` FadeIn (web L11): a static passthrough View.
 *   - `@/api/hooks/useVehicles` (web L12): the already-ported native hook.
 *   - `@/api/devtools` getRedisSignals / purgeRedisSignals / purgeAllRedisSignals
 *     / getRedisSignalKeys + RedisSignalEntry / RedisSignalsMeta /
 *     RedisSignalKeyEntry (web L13 + RedisDiagnosticEmptyState L10-14): the
 *     already-ported native devtools client (../../../api/devtools), same
 *     /dev-tools/redis-signals[/keys] paths + response shapes.
 *   - `@/hooks/usePageTitle` (web L14): document.title is browser-only -> a
 *     documented no-op (the native navigator owns the title).
 *   - `@/hooks/useDateFormat` (web L15): a local native-safe useDateFormat()
 *     exposing formatTime + formatDateTime via Intl.DateTimeFormat (the lib/format
 *     precedent), preserving the L1-last-seen chip + diagnostic meta timestamps.
 *   - `@/lib/numberFormat` fmtInt (web L16): a local native fmtInt (safeNumber
 *     guard + toLocaleString, 0 fraction digits) keeping thousands grouping.
 *   - `@/lib/constants` INTERVALS (web L17): the single consumed value inlined
 *     (INTERVALS.REALTIME = 5000).
 *   - `@/lib/resilience` isApiError / ApiError (web L18): re-exported by the
 *     native api/client; imported from there.
 *   - `../components/RedisDiagnosticEmptyState` RedisDiagnosticEmptyState +
 *     DiagnosticErrorProps (web L19): no native parity port exists yet, so the
 *     whole branch ladder (cache-not-wired / unreachable / generic-error /
 *     network-error / no-meta / mode-local / mirror-broken / no-telemetry
 *     stale|absent / fallthrough) + DiagnosticMetaList + the other-vehicles chip
 *     row + its internal ['redis-signal-keys'] useQuery is reproduced locally,
 *     preserving every i18n key and the error-wins-over-meta precedence. The web
 *     docs CTA <a href> (internal SPA route) is reduced to an accessible,
 *     no-navigation Button (no native router/docs target).
 *   - MaskedValue audit-on-reveal POST /audit/reveal + clipboard copy: browser
 *     fetch + Clipboard are unavailable here, so auditOnReveal is a no-op and the
 *     copy affordance is omitted (no Clipboard dependency); the mask + 30s
 *     auto-hide reveal toggle are preserved.
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import {useQuery, useQueryClient} from '@tanstack/react-query';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {ApiError, isApiError} from '../../../api/client';
import {
  getRedisSignalKeys,
  getRedisSignals,
  purgeAllRedisSignals,
  purgeRedisSignals,
  type RedisSignalEntry,
  type RedisSignalKeyEntry,
  type RedisSignalsMeta,
} from '../../../api/devtools';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {ConfirmDialog} from '../../../components/ui/ConfirmDialog';

/* ─── decorative glyph stand-ins for the lucide-react icons ───────────────── */

const DATABASE_GLYPH = '\uD83D\uDDC4'; // 🗄 (lucide Database)
const SEARCH_GLYPH = '\uD83D\uDD0D'; // 🔍 (lucide Search)
const REFRESH_GLYPH = '\u21BB'; // ↻ (lucide RefreshCw)
const TRASH_GLYPH = '\uD83D\uDDD1'; // 🗑 (lucide Trash2)
const ALERT_GLYPH = '\u26A0'; // ⚠ (lucide AlertTriangle)
const SERVER_CRASH_GLYPH = '\uD83D\uDDA5'; // 🖥 (lucide ServerCrash)
const RADIO_GLYPH = '\uD83D\uDCE1'; // 📡 (lucide Radio)
const ZAP_GLYPH = '\u26A1'; // ⚡ (lucide Zap)
const EYE_GLYPH = '\uD83D\uDC41'; // 👁 (lucide Eye)
const EYE_OFF_GLYPH = '\uD83D\uDEAB'; // 🚫 (lucide EyeOff)

/* ─── Tailwind palette literals that cannot apply on native ───────────────── */

const CYAN_300 = '#67e8f9'; // web text-cyan-300 (number value)
const AMBER_300 = '#fcd34d'; // web text-amber-300 (string value)
const PURPLE_300 = '#d8b4fe'; // web text-purple-300 (boolean value)
const BLUE_300 = '#93c5fd'; // web info badge (blue dark-mode shade)
const EMERALD_300 = '#6ee7b7'; // web success badge
const ROSE_300 = '#fda4af'; // web danger badge
const MONO = 'monospace';

/* ─── INTERVALS.REALTIME (web @/lib/constants) ────────────────────────────── */

const INTERVALS = {REALTIME: 5_000} as const;

/* ─── native translation fallback (native-safe port of react-i18next) ─────── */

type TVars = Record<string, string | number>;
type NativeTFunction = (key: string, fallback?: string, vars?: TVars) => string;

/** Interpolates i18next-style `{{token}}` placeholders against `vars`. */
function interpolate(template: string, vars?: TVars): string {
  if (!vars) {
    return template;
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_, token: string) =>
    token in vars ? String(vars[token]) : `{{${token}}}`,
  );
}

/** Mirrors `t(key, default?, vars?)`: the English default else the key. */
function useNativeTranslationFallback(): NativeTFunction {
  return useMemo<NativeTFunction>(
    () => (key, fallback, vars) => interpolate(fallback ?? key, vars),
    [],
  );
}

/* ─── native-safe usePageTitle (web document.title is browser-only) ───────── */

function usePageTitle(title: string): void {
  useEffect(() => {
    // The web hook writes document.title; on native the navigator owns the
    // header title, so the resolved title is intentionally not applied here.
    void title;
  }, [title]);
}

/* ─── native-safe useToast (web in-house Toast provider) ──────────────────── */

interface NativeToast {
  success: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
}

/**
 * The web `useToast()` enqueues a transient in-app toast. The native parity
 * layer has no Toast provider yet, so feedback bridges to React Native
 * `Alert.alert(title, message?)` (the `_toastHelpers` precedent), preserving the
 * page's success / info / warning / error (title, message?) call sites.
 */
function useToast(): NativeToast {
  return useMemo<NativeToast>(
    () => ({
      success: (title, message) => Alert.alert(title, message),
      info: (title, message) => Alert.alert(title, message),
      warning: (title, message) => Alert.alert(title, message),
      error: (title, message) => Alert.alert(title, message),
    }),
    [],
  );
}

/* ─── native-safe fmtInt (web @/lib/numberFormat) ─────────────────────────── */

/** Mirrors `fmtInt(v) = fmtNumber(v, 0)`: safeNumber guard + thousands grouping. */
function fmtInt(value: number): string {
  const n = Number.isFinite(value) ? value : 0;
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

/* ─── native-safe useDateFormat (web @/hooks/useDateFormat) ───────────────── */

function formatTimeValue(value: string | Date | null | undefined): string {
  if (!value) {
    return '\u2014';
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    return '\u2014';
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

function formatDateTimeValue(value: string | Date | null | undefined): string {
  if (!value) {
    return '\u2014';
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    return '\u2014';
  }
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

function useDateFormat(): {
  formatTime: typeof formatTimeValue;
  formatDateTime: typeof formatDateTimeValue;
} {
  return useMemo(
    () => ({formatTime: formatTimeValue, formatDateTime: formatDateTimeValue}),
    [],
  );
}

/* ─── native FadeIn stand-in (`@/components/motion` FadeIn) ────────────────── */

function FadeIn({children}: {children: ReactNode}) {
  return <View>{children}</View>;
}

/* ─── native-safe page scaffold (web PageContainer) ───────────────────────── */

function PageScaffold({
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
      contentContainerStyle={styles.scaffold}
      testID="redis-signal-viewer-page">
      <View style={styles.scaffoldHeader}>
        <AppText style={styles.scaffoldTitle} variant="title" weight="bold">
          {title}
        </AppText>
        {subtitle ? (
          <AppText style={styles.scaffoldSubtitle} tone="muted">
            {subtitle}
          </AppText>
        ) : null}
      </View>
      <View style={styles.scaffoldBody}>{children}</View>
    </ScrollView>
  );
}

/* ─── native Badge stand-in (`@/components/ui` Badge) ─────────────────────── */

type BadgeVariant = 'success' | 'info' | 'warning' | 'danger' | 'neutral';

const BADGE_VARIANTS: Record<BadgeVariant, {bg: string; fg: string}> = {
  success: {bg: colors.successSurface, fg: EMERALD_300},
  info: {bg: 'rgba(59, 130, 246, 0.12)', fg: BLUE_300},
  warning: {bg: colors.warningSurface, fg: AMBER_300},
  danger: {bg: colors.dangerSurface, fg: ROSE_300},
  neutral: {bg: colors.surfaceRaised, fg: colors.textSecondary},
};

function Badge({
  variant,
  children,
  mono,
  testID,
}: {
  variant: BadgeVariant;
  children: ReactNode;
  mono?: boolean;
  testID?: string;
}) {
  const tone = BADGE_VARIANTS[variant];
  return (
    <View style={[styles.badge, {backgroundColor: tone.bg}]} testID={testID}>
      <AppText
        style={[styles.badgeText, {color: tone.fg}, mono ? styles.monoText : null]}
        weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

/* ─── native Button stand-in (`@/components/ui` Button) ───────────────────── */

function Button({
  variant,
  onPress,
  disabled,
  children,
  testID,
  accessibilityLabel,
}: {
  variant: 'secondary' | 'danger';
  onPress: () => void;
  disabled?: boolean;
  children: ReactNode;
  testID?: string;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{disabled: !!disabled}}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        variant === 'danger' ? styles.buttonDanger : styles.buttonSecondary,
        disabled ? styles.buttonDisabled : null,
      ]}
      testID={testID}>
      {children}
    </Pressable>
  );
}

/* ─── native Toggle stand-in (`@/components/ui` Toggle) ───────────────────── */

const TOGGLE_ON = '#06b6d4'; // web bg-cyan-500
const TOGGLE_OFF = '#4b5563'; // web dark bg-gray-600

function Toggle({
  checked,
  onChange,
  testID,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{checked}}
      hitSlop={8}
      onPress={() => onChange(!checked)}
      style={[
        styles.toggleTrack,
        {backgroundColor: checked ? TOGGLE_ON : TOGGLE_OFF},
      ]}
      testID={testID}>
      <View
        style={[
          styles.toggleThumb,
          {transform: [{translateX: checked ? 18 : 0}]},
        ]}
      />
    </Pressable>
  );
}

/* ─── native Input stand-in (`@/components/ui` Input) ─────────────────────── */

function Input({
  value,
  onChangeText,
  placeholder,
  testID,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  testID?: string;
}) {
  return (
    <TextInput
      autoCapitalize="none"
      autoCorrect={false}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.textMuted}
      style={styles.input}
      testID={testID}
      value={value}
    />
  );
}

/* ─── native Select stand-in (`@/components/ui` Select) ───────────────────── */

interface SelectOption {
  value: string;
  label: string;
}

function Select({
  value,
  onValueChange,
  options,
  testIDPrefix,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  testIDPrefix?: string;
}) {
  return (
    <View style={styles.select}>
      {options.map(opt => {
        const active = opt.value === value;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{selected: active}}
            key={opt.value}
            onPress={() => onValueChange(opt.value)}
            style={[styles.selectOption, active && styles.selectOptionActive]}
            testID={testIDPrefix ? `${testIDPrefix}-${opt.value}` : undefined}>
            <AppText
              style={active ? styles.selectOptionTextActive : styles.selectOptionText}
              variant="caption"
              weight={active ? 'semibold' : 'regular'}>
              {opt.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ─── native StatCard stand-in (`@/components/data-display` StatCard) ──────── */

function StatCard({
  label,
  value,
  icon,
  testID,
}: {
  label: string;
  value: string;
  icon?: ReactNode;
  testID?: string;
}) {
  return (
    <View style={styles.statCard} testID={testID}>
      <View style={styles.statCardHeader}>
        <AppText style={styles.statCardLabel}>{label}</AppText>
        {icon ? <View style={styles.statCardIcon}>{icon}</View> : null}
      </View>
      <AppText style={styles.statCardValue}>{value}</AppText>
    </View>
  );
}

/* ─── native Skeleton stand-in (`@/components/feedback` Skeleton) ─────────── */

function Skeleton() {
  return <View style={styles.skeleton} />;
}

/* ─── native EmptyState stand-in (`@/components/feedback` EmptyState) ──────── */

function EmptyState({
  icon,
  message,
  testID,
}: {
  icon?: ReactNode;
  message: string;
  testID?: string;
}) {
  return (
    <View style={styles.emptyState} testID={testID}>
      {icon ? <View style={styles.emptyStateIcon}>{icon}</View> : null}
      <AppText style={styles.emptyStateMessage} tone="muted" variant="caption">
        {message}
      </AppText>
    </View>
  );
}

/* ─── native MaskedValue stand-in (`@/components/ui` MaskedValue) ─────────── */

const BULLET = '\u2022';
const DEFAULT_AUTO_HIDE_MS = 30_000;

/**
 * coords masking — `<lat>,<lng>` -> `••.•••, ••.•••`, a lone number -> `••.•••`,
 * non-numeric -> a length-preserving bullet run. Ported from web `maskFor`.
 */
function maskCoords(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return '';
  }
  const parts = trimmed
    .split(',')
    .map(p => p.trim())
    .filter(p => p.length > 0);
  if (parts.length === 0) {
    return '';
  }
  const numeric = parts.every(p => Number.isFinite(Number(p)));
  if (!numeric) {
    return BULLET.repeat(trimmed.length);
  }
  return parts
    .map(() => `${BULLET}${BULLET}.${BULLET}${BULLET}${BULLET}`)
    .join(', ');
}

function MaskedValue({
  value,
  ariaLabel,
  autoHideMs = DEFAULT_AUTO_HIDE_MS,
}: {
  value: string | null | undefined;
  /** Always 'coords' at the page's call site; kept for source parity. */
  variant: 'coords';
  ariaLabel: string;
  copyable?: boolean;
  auditOnReveal?: boolean;
  autoHideMs?: number;
}) {
  const [revealed, setRevealed] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const raw = value ?? '';
  const masked = useMemo(() => maskCoords(raw), [raw]);

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearTimer(), [clearTimer]);

  const reveal = useCallback(() => {
    if (raw.length === 0) {
      return;
    }
    setRevealed(true);
    clearTimer();
    // auditOnReveal POSTs /audit/reveal on web; reduced to a no-op on native.
    if (autoHideMs > 0) {
      timerRef.current = setTimeout(() => {
        setRevealed(false);
        timerRef.current = null;
      }, autoHideMs);
    }
  }, [autoHideMs, clearTimer, raw]);

  const hide = useCallback(() => {
    setRevealed(false);
    clearTimer();
  }, [clearTimer]);

  if (raw.length === 0) {
    return (
      <View accessibilityLabel={ariaLabel} style={styles.maskedRow}>
        <AppText tone="muted">{'\u2014'}</AppText>
      </View>
    );
  }

  return (
    <View accessibilityLabel={ariaLabel} style={styles.maskedRow} testID="masked-value">
      <AppText
        style={[styles.maskedText, {color: revealed ? CYAN_300 : colors.textSecondary}]}>
        {revealed ? raw : masked}
      </AppText>
      <Pressable
        accessibilityLabel={revealed ? 'Hide value' : 'Reveal value'}
        accessibilityRole="button"
        accessibilityState={{expanded: revealed}}
        hitSlop={8}
        onPress={revealed ? hide : reveal}
        style={styles.maskedToggle}>
        <AppText
          importantForAccessibility="no-hide-descendants"
          style={styles.maskedToggleGlyph}>
          {revealed ? EYE_OFF_GLYPH : EYE_GLYPH}
        </AppText>
      </Pressable>
    </View>
  );
}

/* ─── DataTable stand-in (`@/components/ui` DataTable) ─────────────────────── */

interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortable?: boolean;
}

/**
 * useSortToggle — controlled sort state (web @/components/ui DataTable). The web
 * DataTable slices `data` as-given (it does NOT internally re-sort by sortKey),
 * so the header toggle only flips the indicator; the displayed order stays the
 * caller-provided order. This native port reproduces that exact behaviour.
 */
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

  return {sortKey, sortDir, onSort};
}

function DataTable<T>({
  tableId,
  data,
  columns,
  keyExtractor,
  sortKey,
  sortDir,
  onSort,
  pagination,
}: {
  tableId?: string;
  data: T[];
  columns: Column<T>[];
  keyExtractor: (row: T) => string;
  sortKey?: string;
  sortDir?: 'asc' | 'desc';
  onSort?: (key: string) => void;
  pagination?: {defaultPageSize?: number};
}) {
  const pageSize = pagination?.defaultPageSize ?? 25;
  const [page, setPage] = useState(1);

  // Reset to page 1 when data length changes (e.g. filters applied).
  useEffect(() => {
    setPage(1);
  }, [data.length]);

  const totalPages = Math.max(1, Math.ceil(data.length / pageSize));
  const paginatedData = data.slice((page - 1) * pageSize, page * pageSize);

  return (
    <View style={styles.table} testID={tableId}>
      <View style={styles.tableHeaderRow}>
        {columns.map(col => {
          const indicator =
            sortKey === col.key ? (sortDir === 'asc' ? ' \u2191' : ' \u2193') : '';
          const header = (
            <AppText style={styles.tableHeaderText} weight="semibold">
              {col.header}
              {indicator}
            </AppText>
          );
          return (
            <View key={col.key} style={styles.tableCell}>
              {col.sortable && onSort ? (
                <Pressable
                  accessibilityRole="button"
                  hitSlop={6}
                  onPress={() => onSort(col.key)}
                  testID={tableId ? `${tableId}-sort-${col.key}` : undefined}>
                  {header}
                </Pressable>
              ) : (
                header
              )}
            </View>
          );
        })}
      </View>

      {paginatedData.map(row => {
        const rowKey = keyExtractor(row);
        return (
          <View
            key={rowKey}
            style={styles.tableRow}
            testID={tableId ? `${tableId}-row-${rowKey}` : undefined}>
            {columns.map(col => (
              <View key={col.key} style={styles.tableCell}>
                {col.render(row)}
              </View>
            ))}
          </View>
        );
      })}

      {data.length > pageSize ? (
        <View style={styles.paginationRow}>
          <Pressable
            accessibilityRole="button"
            disabled={page <= 1}
            onPress={() => setPage(p => Math.max(1, p - 1))}
            style={[styles.paginationButton, page <= 1 && styles.buttonDisabled]}
            testID={tableId ? `${tableId}-prev` : undefined}>
            <AppText style={styles.paginationButtonText}>{'\u2039'}</AppText>
          </Pressable>
          <AppText style={styles.paginationText} tone="muted" variant="caption">
            {`${page} / ${totalPages}`}
          </AppText>
          <Pressable
            accessibilityRole="button"
            disabled={page >= totalPages}
            onPress={() => setPage(p => Math.min(totalPages, p + 1))}
            style={[
              styles.paginationButton,
              page >= totalPages && styles.buttonDisabled,
            ]}
            testID={tableId ? `${tableId}-next` : undefined}>
            <AppText style={styles.paginationButtonText}>{'\u203A'}</AppText>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/* ─── signal categorization ─────────────────────────────────────────────── */

type SignalCategory = 'Battery' | 'Charging' | 'Driving' | 'Climate' | 'Other';

const CATEGORY_COLORS: Record<SignalCategory, BadgeVariant> = {
  Battery: 'success',
  Charging: 'info',
  Driving: 'warning',
  Climate: 'danger',
  Other: 'neutral',
};

function categorizeSignal(name: string): SignalCategory {
  const n = name.toLowerCase();
  if (/^(battery|bms|pack|brick|module)/.test(n)) {
    return 'Battery';
  }
  if (/^(ac|dc|charge|charger)/.test(n)) {
    return 'Charging';
  }
  if (/^(vehicle|odometer|latitude|longitude|gps)/.test(n)) {
    return 'Driving';
  }
  if (/(temp|hvac|inside|outside|climate)/.test(n)) {
    return 'Climate';
  }
  return 'Other';
}

/* ─── table row type ────────────────────────────────────────────────────── */

interface SignalRow {
  name: string;
  value: number | string | boolean;
  type: string;
  category: SignalCategory;
}

/**
 * isLocationSignal — true for lat/lng/gps signal names that should be masked by
 * default so a casual screen-share or screenshot does not leak the parking spot.
 */
function isLocationSignal(name: string): boolean {
  const n = name.toLowerCase();
  return /^(latitude|longitude|gps_lat|gps_lng|gps_latitude|gps_longitude|location_lat|location_lng)$/.test(
    n,
  );
}

/* ─── table columns ─────────────────────────────────────────────────────── */

function buildColumns(t: NativeTFunction): Column<SignalRow>[] {
  return [
    {
      key: 'name',
      header: t('redis.signalName', 'Signal Name'),
      sortable: true,
      render: row => (
        <AppText style={styles.cellName}>{row.name}</AppText>
      ),
    },
    {
      key: 'value',
      header: t('redis.value', 'Value'),
      render: row => {
        // Location signals route through MaskedValue so the raw coordinate
        // never sits on screen by default.
        if (
          isLocationSignal(row.name) &&
          (typeof row.value === 'number' || typeof row.value === 'string')
        ) {
          return (
            <MaskedValue
              ariaLabel={t('redis.maskedCoord', 'Coordinate, click to reveal')}
              auditOnReveal
              copyable
              value={String(row.value)}
              variant="coords"
            />
          );
        }
        // Per-type toned-down syntax-highlight colours: number -> cyan-300,
        // boolean -> purple-300, string -> amber-300.
        const color =
          typeof row.value === 'number'
            ? CYAN_300
            : typeof row.value === 'boolean'
              ? PURPLE_300
              : AMBER_300;
        return (
          <AppText style={[styles.cellValue, {color}]}>{String(row.value)}</AppText>
        );
      },
    },
    {
      key: 'type',
      header: t('redis.type', 'Type'),
      sortable: true,
      render: row => (
        <Badge
          variant={
            row.type === 'number' ? 'info' : row.type === 'boolean' ? 'warning' : 'neutral'
          }>
          {row.type}
        </Badge>
      ),
    },
    {
      key: 'category',
      header: t('redis.category', 'Category'),
      sortable: true,
      render: row => (
        <Badge variant={CATEGORY_COLORS[row.category]}>{row.category}</Badge>
      ),
    },
  ];
}

/* ─── diagnostic empty-state (web ../components/RedisDiagnosticEmptyState) ─── */

export type DiagnosticErrorProps =
  | {serverError?: undefined; networkError?: false}
  | {serverError: ApiError; networkError?: false}
  | {serverError: null; networkError: true};

type RedisDiagnosticEmptyStateProps = {
  vehicleId: number;
  meta: RedisSignalsMeta | undefined;
  onSelectVehicle: (vehicleId: number) => void;
} & DiagnosticErrorProps;

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

type BannerTone = 'danger' | 'warning' | 'info' | 'neutral';

const DIAGNOSTIC_TONES: Record<BannerTone, {border: string; bg: string}> = {
  danger: {border: 'rgba(244, 63, 94, 0.3)', bg: 'rgba(244, 63, 94, 0.05)'},
  warning: {border: 'rgba(245, 158, 11, 0.3)', bg: 'rgba(245, 158, 11, 0.05)'},
  info: {border: 'rgba(6, 182, 212, 0.3)', bg: 'rgba(6, 182, 212, 0.05)'},
  neutral: {border: colors.border, bg: colors.surfaceRaised},
};

function RedisDiagnosticEmptyState({
  vehicleId,
  meta,
  serverError,
  networkError,
  onSelectVehicle,
}: RedisDiagnosticEmptyStateProps) {
  const t = useNativeTranslationFallback();
  const {formatDateTime} = useDateFormat();

  const {data: keysData, isError: keysQueryError} = useQuery({
    queryKey: ['redis-signal-keys'],
    queryFn: () => getRedisSignalKeys(50),
    staleTime: 30_000,
  });

  // Branch 0.A — Redis cache wiring missing on the API server.
  if (
    serverError &&
    serverError.status === 503 &&
    /not available/i.test(serverError.message)
  ) {
    return (
      <DiagnosticBanner
        body={t(
          'redis.diagnostic.cacheNotWired.body',
          'The TeslaSync API server started without a Redis connection. Set REDIS_ADDR (or REDIS_HOST + REDIS_PORT) in your environment, ensure the Redis service is reachable, and restart the API. This page reads exclusively from Redis and cannot function without it.',
        )}
        cta={t('redis.diagnostic.cacheNotWired.cta', 'See cache configuration docs')}
        ctaHref="/docs/caching#configuration"
        glyph={SERVER_CRASH_GLYPH}
        meta={meta}
        title={t('redis.diagnostic.cacheNotWired.title', 'Redis cache is not configured')}
        tone="danger"
      />
    );
  }

  // Branch 0.B — Redis configured but unreachable.
  if (
    serverError &&
    (serverError.status === 503 ||
      serverError.status === 502 ||
      serverError.status === 504) &&
    /unreachable|upstream/i.test(serverError.message)
  ) {
    return (
      <DiagnosticBanner
        body={t(
          'redis.diagnostic.unreachable.body',
          'The API server is configured to use Redis, but the connection failed. Check that the Redis pod is running, that network policies allow the API to reach it, and review API server logs for "redis signal cache: GetAll failed".',
        )}
        glyph={SERVER_CRASH_GLYPH}
        meta={meta}
        title={t('redis.diagnostic.unreachable.title', 'Redis is unreachable')}
        tone="danger"
      />
    );
  }

  // Branch 0.C — Any other typed API error.
  if (serverError) {
    return (
      <DiagnosticBanner
        body={t(
          'redis.diagnostic.requestFailed.body',
          'The server returned an error: {{status}} {{message}}. The Redis Signal Viewer cannot recover automatically — try refreshing, and if the error persists check the API server logs.',
          {status: serverError.status, message: serverError.message},
        )}
        glyph={ALERT_GLYPH}
        meta={meta}
        title={t('redis.diagnostic.requestFailed.title', 'Could not load Redis signals')}
        tone="warning"
      />
    );
  }

  // Branch 0.D — Network-layer failure.
  if (networkError) {
    return (
      <DiagnosticBanner
        body={t(
          'redis.diagnostic.networkError.body',
          'The browser failed to fetch /api/v1/dev-tools/redis-signals. Check that the API server is running, the proxy/ingress is healthy, and there are no CORS or network errors in DevTools.',
        )}
        glyph={ALERT_GLYPH}
        meta={meta}
        title={t('redis.diagnostic.networkError.title', 'Cannot reach the API server')}
        tone="warning"
      />
    );
  }

  if (!meta) {
    // Backend doesn't expose meta yet — fall back to the legacy generic message.
    return (
      <EmptyState
        icon={<DiagnosticGlyph glyph={DATABASE_GLYPH} large />}
        message={t('redis.noSignals', 'No signals cached for this vehicle')}
        testID="redis-diagnostic-no-meta"
      />
    );
  }

  // When the keys query itself failed we hide the "other vehicles" sub-section.
  const otherKeys: RedisSignalKeyEntry[] = keysQueryError
    ? []
    : keysData?.keys.filter(k => k.vehicle_id !== vehicleId && k.field_count > 0) ?? [];

  // Branch 1 — mode=local: structural cause.
  if (meta.live_signal_store_mode === 'local') {
    return (
      <DiagnosticBanner
        body={t(
          'redis.diagnostic.modeLocal.body',
          'LIVE_SIGNAL_STORE_MODE=local means the telemetry pipeline writes only to the in-process L1 store and never mirrors to Redis. This page reads exclusively from Redis, so it cannot show data while local mode is active.',
        )}
        cta={t('redis.diagnostic.modeLocal.cta', 'See live-state contract docs')}
        ctaHref="/docs/caching"
        glyph={SERVER_CRASH_GLYPH}
        meta={meta}
        title={t('redis.diagnostic.modeLocal.title', 'Redis L2 writes are disabled')}
        tone="danger"
      />
    );
  }

  // Branch 2 — hybrid mode, L1 has data but L2 doesn't: mirror is broken.
  if (meta.l1_signal_count > 0 && meta.redis_field_count === 0) {
    return (
      <DiagnosticBanner
        body={t(
          'redis.diagnostic.mirrorBroken.body',
          'The in-process L1 store has {{count}} signals for this vehicle but Redis is empty. The async mirror goroutine in HybridLiveSignalStore.UpdateNonBlocking may be timing out or the Redis connection may be saturated. Check pod logs for "live signal store: Redis mirror failed".',
          {count: meta.l1_signal_count},
        )}
        glyph={ALERT_GLYPH}
        meta={meta}
        onSelectVehicle={onSelectVehicle}
        otherKeys={otherKeys}
        title={t('redis.diagnostic.mirrorBroken.title', 'L2 mirror is failing')}
        tone="warning"
      />
    );
  }

  // Branch 3 — hybrid mode, both L1 and L2 empty AND no recent L1 telemetry.
  const lastSeenL1 = meta.l1_last_seen_at ? new Date(meta.l1_last_seen_at) : null;
  const ttlSuspected =
    !lastSeenL1 || Date.now() - lastSeenL1.getTime() > SEVEN_DAYS_MS;
  if (meta.l1_signal_count === 0 && ttlSuspected) {
    return (
      <DiagnosticBanner
        body={
          lastSeenL1
            ? t(
                'redis.diagnostic.noTelemetry.bodyStale',
                'Last L1 entry was {{date}}. The 7-day Redis TTL has likely expired. Wait for the next telemetry push or warm the cache from the cold-path reader.',
                {date: formatDateTime(lastSeenL1)},
              )
            : t(
                'redis.diagnostic.noTelemetry.bodyAbsent',
                'This vehicle has no L1 entries on this pod. Either telemetry has never streamed for it, or this pod restarted before any telemetry arrived.',
              )
        }
        glyph={ZAP_GLYPH}
        meta={meta}
        onSelectVehicle={onSelectVehicle}
        otherKeys={otherKeys}
        title={t('redis.diagnostic.noTelemetry.title', 'No recent telemetry for this vehicle')}
        tone="info"
      />
    );
  }

  // Branch 4 — fallthrough: hybrid + both empty + recent L1 absence (rare).
  return (
    <DiagnosticBanner
      body={t(
        'redis.diagnostic.empty.body',
        'Both L1 and L2 are empty. If this vehicle is currently streaming, give the next batch a few seconds to arrive. Otherwise check the telemetry pipeline.',
      )}
      glyph={RADIO_GLYPH}
      meta={meta}
      onSelectVehicle={onSelectVehicle}
      otherKeys={otherKeys}
      title={t('redis.diagnostic.empty.title', 'No signals cached for this vehicle')}
      tone="neutral"
    />
  );
}

function DiagnosticGlyph({glyph, large}: {glyph: string; large?: boolean}) {
  return (
    <AppText
      importantForAccessibility="no-hide-descendants"
      style={large ? styles.diagnosticGlyphLarge : styles.diagnosticGlyph}>
      {glyph}
    </AppText>
  );
}

function DiagnosticBanner({
  tone,
  glyph,
  title,
  body,
  cta,
  ctaHref,
  otherKeys,
  onSelectVehicle,
  meta,
}: {
  tone: BannerTone;
  glyph: string;
  title: string;
  body: string;
  cta?: string;
  ctaHref?: string;
  otherKeys?: RedisSignalKeyEntry[];
  onSelectVehicle?: (id: number) => void;
  meta: RedisSignalsMeta | undefined;
}) {
  const t = useNativeTranslationFallback();
  const toneTokens = DIAGNOSTIC_TONES[tone];
  return (
    <GlassPanel
      style={[
        styles.bannerPanel,
        {borderColor: toneTokens.border, backgroundColor: toneTokens.bg},
      ]}
      testID="redis-diagnostic-banner">
      <View style={styles.bannerRow}>
        <DiagnosticGlyph glyph={glyph} />
        <View style={styles.bannerBody}>
          <AppText style={styles.bannerTitle} weight="semibold">
            {title}
          </AppText>
          <AppText style={styles.bannerText} tone="secondary">
            {body}
          </AppText>
          {meta ? <DiagnosticMetaList meta={meta} /> : null}
          {cta && ctaHref ? (
            <Button
              accessibilityLabel={`${cta} (${ctaHref})`}
              onPress={() => undefined}
              testID="redis-diagnostic-cta"
              variant="secondary">
              <AppText style={styles.bannerCtaText} weight="semibold">
                {cta}
              </AppText>
            </Button>
          ) : null}
          {otherKeys && otherKeys.length > 0 ? (
            <View style={styles.otherWrap} testID="redis-diagnostic-other-vehicles">
              <AppText style={styles.otherLabel} tone="muted" variant="caption">
                {t('redis.diagnostic.otherVehicles', 'Other vehicles with cached signals')}
              </AppText>
              <View style={styles.otherChips}>
                {otherKeys.slice(0, 6).map(k => (
                  <Pressable
                    accessibilityRole="button"
                    key={k.vehicle_id}
                    onPress={() => onSelectVehicle?.(k.vehicle_id)}
                    style={styles.otherChip}
                    testID={`redis-diagnostic-other-${k.vehicle_id}`}>
                    <AppText style={styles.otherChipText} variant="caption">
                      {k.display_name || k.vehicle_vin || `Vehicle ${k.vehicle_id}`}
                      <AppText style={styles.otherChipCount}>{` \u00B7 ${k.field_count}`}</AppText>
                    </AppText>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
        </View>
      </View>
    </GlassPanel>
  );
}

function DiagnosticMetaList({meta}: {meta: RedisSignalsMeta}) {
  const t = useNativeTranslationFallback();
  const {formatDateTime} = useDateFormat();
  return (
    <View style={styles.metaList}>
      <MetaRow label={t('redis.diagnostic.meta.mode', 'Live store mode')}>
        <Badge variant={meta.live_signal_store_mode === 'hybrid' ? 'success' : 'danger'}>
          {meta.live_signal_store_mode}
        </Badge>
      </MetaRow>
      <MetaRow label={t('redis.diagnostic.meta.key', 'Redis key')}>
        <AppText style={styles.metaMono}>{meta.redis_key}</AppText>
      </MetaRow>
      <MetaRow label={t('redis.diagnostic.meta.l1Count', 'L1 signals')}>
        <AppText style={styles.metaValueText}>{String(meta.l1_signal_count)}</AppText>
      </MetaRow>
      <MetaRow label={t('redis.diagnostic.meta.l2Count', 'L2 fields (raw)')}>
        <AppText style={styles.metaValueText}>{String(meta.redis_field_count)}</AppText>
      </MetaRow>
      <MetaRow label={t('redis.diagnostic.meta.l1LastSeen', 'L1 last seen')}>
        <AppText style={styles.metaValueText}>
          {meta.l1_last_seen_at ? formatDateTime(meta.l1_last_seen_at) : '\u2014'}
        </AppText>
      </MetaRow>
      <MetaRow label={t('redis.diagnostic.meta.l2LastSeen', 'L2 last seen')}>
        <AppText style={styles.metaValueText}>
          {meta.l2_last_seen_at ? formatDateTime(meta.l2_last_seen_at) : '\u2014'}
        </AppText>
      </MetaRow>
      {meta.vehicle_vin ? (
        <MetaRow label={t('redis.diagnostic.meta.vin', 'VIN')}>
          <AppText style={styles.metaMono}>{meta.vehicle_vin}</AppText>
        </MetaRow>
      ) : null}
    </View>
  );
}

function MetaRow({label, children}: {label: string; children: ReactNode}) {
  return (
    <View style={styles.metaRow}>
      <AppText style={styles.metaLabel} tone="muted" variant="caption">
        {label}
      </AppText>
      <View style={styles.metaValue}>{children}</View>
    </View>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
   Redis Signal Viewer Page
   ═══════════════════════════════════════════════════════════════════════════ */

export default function RedisSignalViewerPage() {
  const t = useNativeTranslationFallback();
  usePageTitle(t('redis.title', 'Redis Signal Viewer'));
  const {formatTime} = useDateFormat();

  const {data: vehicles} = useVehicles();
  const vehicleList = useMemo(() => vehicles ?? [], [vehicles]);

  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  // Purge UI state — `purgeMode` distinguishes the two destructive paths so a
  // single ConfirmDialog can serve both. `purgeTargetId` pins the per-vehicle
  // target at dialog-open time so a mid-confirmation vehicle change can't
  // retarget the destructive call. `isPurging` keeps the dialog open with a
  // spinner while the DELETE is in flight.
  const [purgeMode, setPurgeMode] = useState<'one' | 'all' | null>(null);
  const [purgeTargetId, setPurgeTargetId] = useState<number | null>(null);
  const [purgeTargetLabel, setPurgeTargetLabel] = useState<string>('');
  const [isPurging, setIsPurging] = useState(false);
  const queryClient = useQueryClient();
  const toast = useToast();

  const {
    data: signalData,
    isLoading,
    isFetching,
    error,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['redis-signals', selectedVehicleId],
    queryFn: () => getRedisSignals(selectedVehicleId!),
    enabled: selectedVehicleId !== null,
    refetchInterval: autoRefresh ? INTERVALS.REALTIME : false,
  });

  const selectedVehicle = useMemo(
    () => vehicleList.find(v => v.id === selectedVehicleId),
    [vehicleList, selectedVehicleId],
  );
  const selectedVehicleLabel =
    selectedVehicle?.display_name ||
    selectedVehicle?.vin ||
    (selectedVehicleId !== null ? `Vehicle ${selectedVehicleId}` : '');

  const handlePurgeConfirm = async () => {
    if (purgeMode === null) {
      return;
    }
    setIsPurging(true);
    try {
      if (purgeMode === 'one' && purgeTargetId !== null) {
        const res = await purgeRedisSignals(purgeTargetId);
        if (res.purged) {
          toast.success(
            t('redis.purgeSuccess', 'Redis L2 cache purged'),
            t(
              'redis.purgeSuccessDetail',
              '{{vehicle}}: Redis HSET removed. L1 in-memory caches on each pod will refill from new telemetry.',
              {vehicle: purgeTargetLabel},
            ),
          );
        } else {
          toast.info(
            t('redis.purgeNoOpTitle', 'Nothing to purge'),
            t('redis.purgeNoOpDetail', '{{vehicle}} had no cached signals in Redis.', {
              vehicle: purgeTargetLabel,
            }),
          );
        }
        await queryClient.invalidateQueries({
          queryKey: ['redis-signals', purgeTargetId],
        });
        await queryClient.invalidateQueries({queryKey: ['redis-signal-keys']});
      } else if (purgeMode === 'all') {
        const res = await purgeAllRedisSignals();
        if (res.has_more) {
          toast.warning(
            t('redis.purgeAllPartial', 'Redis L2 cache partially purged'),
            t(
              'redis.purgeAllPartialDetail',
              'Removed {{count}} of up to {{limit}} vehicle HSET(s) from Redis. More keys remain — click Purge All Redis again to drain.',
              {count: res.purged, limit: res.limit},
            ),
          );
        } else {
          toast.success(
            t('redis.purgeAllSuccess', 'Redis L2 cache purged'),
            t(
              'redis.purgeAllSuccessDetail',
              'Removed {{count}} vehicle HSET(s) from Redis. L1 in-memory caches on each pod will refill from new telemetry.',
              {count: res.purged},
            ),
          );
        }
        await queryClient.invalidateQueries({queryKey: ['redis-signals']});
        await queryClient.invalidateQueries({queryKey: ['redis-signal-keys']});
      }
      setPurgeMode(null);
      setPurgeTargetId(null);
      setPurgeTargetLabel('');
    } catch (err2) {
      const msg = err2 instanceof Error ? err2.message : String(err2);
      toast.error(t('redis.purgeError', 'Purge failed'), msg);
    } finally {
      setIsPurging(false);
    }
  };

  const openPurgeOne = () => {
    if (selectedVehicleId === null) {
      return;
    }
    setPurgeTargetId(selectedVehicleId);
    setPurgeTargetLabel(selectedVehicleLabel);
    setPurgeMode('one');
  };

  const openPurgeAll = () => {
    setPurgeTargetId(null);
    setPurgeTargetLabel('');
    setPurgeMode('all');
  };

  const rows = useMemo<SignalRow[]>(() => {
    if (!signalData?.signals) {
      return [];
    }
    return Object.entries(signalData.signals)
      .map(([name, entry]: [string, RedisSignalEntry]) => ({
        name,
        value: entry.value,
        type: entry.type,
        category: categorizeSignal(name),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [signalData]);

  const filteredRows = useMemo(() => {
    let result = rows;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(r => r.name.toLowerCase().includes(q));
    }
    if (categoryFilter !== 'all') {
      result = result.filter(r => r.category === categoryFilter);
    }
    return result;
  }, [rows, search, categoryFilter]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {
      Battery: 0,
      Charging: 0,
      Driving: 0,
      Climate: 0,
      Other: 0,
    };
    for (const row of rows) {
      counts[row.category] = (counts[row.category] ?? 0) + 1;
    }
    return counts;
  }, [rows]);

  const columns = useMemo(() => buildColumns(t), [t]);
  const {sortKey, sortDir, onSort} = useSortToggle('name', 'asc');

  const meta = signalData?.meta;

  // When the upstream query failed the diagnostic banner takes over so the
  // operator sees the real failure mode; stat cards also show a placeholder so
  // the top-of-page numbers don't lie about a 0 count.
  const errorBannerProps: DiagnosticErrorProps = !isError
    ? {}
    : isApiError(error)
      ? {serverError: error as ApiError}
      : {serverError: null, networkError: true};
  const showStatPlaceholder = isLoading || isError;

  const vehicleOptions: SelectOption[] = vehicleList.map(v => ({
    value: String(v.id),
    label: v.display_name || v.vin || `Vehicle ${v.id}`,
  }));

  return (
    <PageScaffold
      subtitle={t('redis.subtitle', 'Inspect cached signal values in Redis')}
      title={t('redis.title', 'Redis Signal Viewer')}>
      {/* Controls */}
      <FadeIn>
        <GlassPanel style={styles.panel}>
          <View style={styles.controlsRow}>
            <Select
              onValueChange={val => setSelectedVehicleId(val ? Number(val) : null)}
              options={[
                {value: '', label: t('redis.selectVehicle', 'Select vehicle\u2026')},
                ...vehicleOptions,
              ]}
              testIDPrefix="redis-vehicle-option"
              value={selectedVehicleId !== null ? String(selectedVehicleId) : ''}
            />

            <View style={styles.searchWrap}>
              <AppText
                importantForAccessibility="no-hide-descendants"
                style={styles.searchGlyph}
                tone="muted">
                {SEARCH_GLYPH}
              </AppText>
              <Input
                onChangeText={setSearch}
                placeholder={t('redis.searchPlaceholder', 'Filter signals\u2026')}
                testID="redis-search-input"
                value={search}
              />
            </View>

            <Select
              onValueChange={setCategoryFilter}
              options={[
                {value: 'all', label: t('redis.allCategories', 'All Categories')},
                {value: 'Battery', label: `Battery (${categoryCounts.Battery})`},
                {value: 'Charging', label: `Charging (${categoryCounts.Charging})`},
                {value: 'Driving', label: `Driving (${categoryCounts.Driving})`},
                {value: 'Climate', label: `Climate (${categoryCounts.Climate})`},
                {value: 'Other', label: `Other (${categoryCounts.Other})`},
              ]}
              testIDPrefix="redis-category-option"
              value={categoryFilter}
            />

            <View style={styles.toggleRow}>
              <Toggle
                checked={autoRefresh}
                onChange={setAutoRefresh}
                testID="redis-autorefresh-toggle"
              />
              <AppText style={styles.toggleLabel} tone="secondary">
                {t('redis.autoRefresh', 'Auto-refresh')}
              </AppText>
            </View>

            <Button
              disabled={selectedVehicleId === null || isFetching}
              onPress={() => refetch()}
              testID="redis-refresh-button"
              variant="secondary">
              <AppText
                importantForAccessibility="no-hide-descendants"
                style={styles.buttonGlyph}>
                {REFRESH_GLYPH}
              </AppText>
              <AppText style={styles.buttonLabelSecondary}>
                {t('redis.refresh', 'Refresh')}
              </AppText>
            </Button>

            {/* Per-vehicle uses a standard danger-confirm; cluster-wide PurgeAll
                requires the operator to type "PURGE ALL". */}
            <Button
              accessibilityLabel={t(
                'redis.purgeButtonTitle',
                'Delete this vehicle\u2019s cached signals from Redis (L2). The in-process L1 cache on each pod stays put and refills from new telemetry.',
              )}
              disabled={selectedVehicleId === null || isPurging}
              onPress={openPurgeOne}
              testID="redis-purge-button"
              variant="danger">
              <AppText
                importantForAccessibility="no-hide-descendants"
                style={styles.buttonGlyph}>
                {TRASH_GLYPH}
              </AppText>
              <AppText style={styles.buttonLabelDanger}>
                {t('redis.purgeButton', 'Purge Redis (L2)')}
              </AppText>
            </Button>

            <Button
              accessibilityLabel={t(
                'redis.purgeAllButtonTitle',
                'Delete every vehicle:*:signals HSET in Redis (L2). Requires typed confirmation.',
              )}
              disabled={isPurging}
              onPress={openPurgeAll}
              testID="redis-purge-all-button"
              variant="danger">
              <AppText
                importantForAccessibility="no-hide-descendants"
                style={styles.buttonGlyph}>
                {TRASH_GLYPH}
              </AppText>
              <AppText style={styles.buttonLabelDanger}>
                {t('redis.purgeAllButton', 'Purge All Redis')}
              </AppText>
            </Button>
          </View>
        </GlassPanel>
      </FadeIn>

      {/* Persistent diagnostic chips */}
      {selectedVehicleId !== null && meta ? (
        <FadeIn>
          <View style={styles.metaChipsRow}>
            <Badge variant={meta.live_signal_store_mode === 'hybrid' ? 'success' : 'danger'}>
              {t('redis.headerChip.mode', 'Mode: {{mode}}', {
                mode: meta.live_signal_store_mode,
              })}
            </Badge>
            {meta.vehicle_vin ? (
              <Badge mono variant="neutral">
                {meta.vehicle_vin}
              </Badge>
            ) : null}
            {meta.l1_last_seen_at ? (
              <Badge variant="info">
                {t('redis.headerChip.l1Seen', 'L1 last: {{date}}', {
                  date: formatTime(meta.l1_last_seen_at),
                })}
              </Badge>
            ) : null}
          </View>
        </FadeIn>
      ) : null}

      {/* Stats */}
      {selectedVehicleId !== null ? (
        <FadeIn>
          <View style={styles.statGrid}>
            <StatCard
              icon={<DiagnosticGlyph glyph={DATABASE_GLYPH} />}
              label={t('redis.totalSignals', 'Total Signals')}
              testID="redis-stat-total"
              value={showStatPlaceholder ? '\u2014' : fmtInt(signalData?.signal_count ?? 0)}
            />
            <StatCard
              label={t('redis.numbers', 'Numbers')}
              testID="redis-stat-numbers"
              value={
                showStatPlaceholder
                  ? '\u2014'
                  : fmtInt(rows.filter(r => r.type === 'number').length)
              }
            />
            <StatCard
              label={t('redis.strings', 'Strings')}
              testID="redis-stat-strings"
              value={
                showStatPlaceholder
                  ? '\u2014'
                  : fmtInt(rows.filter(r => r.type === 'string').length)
              }
            />
            <StatCard
              label={t('redis.booleans', 'Booleans')}
              testID="redis-stat-booleans"
              value={
                showStatPlaceholder
                  ? '\u2014'
                  : fmtInt(rows.filter(r => r.type === 'boolean').length)
              }
            />
          </View>
        </FadeIn>
      ) : null}

      {/* Table */}
      <FadeIn>
        <GlassPanel style={styles.panel}>
          {selectedVehicleId === null ? (
            <EmptyState
              icon={<DiagnosticGlyph glyph={DATABASE_GLYPH} large />}
              message={t(
                'redis.selectPrompt',
                'Select a vehicle to view its cached Redis signals',
              )}
              testID="redis-select-prompt"
            />
          ) : isLoading ? (
            <View style={styles.skeletonStack}>
              <Skeleton />
              <Skeleton />
              <Skeleton />
              <Skeleton />
              <Skeleton />
            </View>
          ) : filteredRows.length === 0 ? (
            rows.length === 0 || isError ? (
              <RedisDiagnosticEmptyState
                meta={meta}
                onSelectVehicle={setSelectedVehicleId}
                vehicleId={selectedVehicleId}
                {...errorBannerProps}
              />
            ) : (
              <EmptyState
                icon={<DiagnosticGlyph glyph={SEARCH_GLYPH} large />}
                message={t('redis.noMatch', 'No signals match the current filter')}
                testID="redis-no-match"
              />
            )
          ) : (
            <DataTable
              columns={columns}
              data={filteredRows}
              keyExtractor={row => row.name}
              onSort={onSort}
              pagination={{defaultPageSize: 50}}
              sortDir={sortDir}
              sortKey={sortKey}
              tableId="admin:redis-signals"
            />
          )}
        </GlassPanel>
      </FadeIn>

      <ConfirmDialog
        cancelLabel={t('common.cancel', 'Cancel')}
        confirmLabel={
          purgeMode === 'all'
            ? t('redis.purgeAllConfirm', 'Purge All Vehicles')
            : t('redis.purgeConfirm', 'Purge Redis (L2)')
        }
        loading={isPurging}
        message={
          purgeMode === 'all'
            ? t(
                'redis.purgeAllMessage',
                'This deletes every vehicle:*:signals HSET in Redis (the L2 cache). The L1 in-memory cache on each pod is NOT touched and will refill as new telemetry arrives. Read-paths on other pods may briefly read stale L1 values until the next signal arrives. If more than 1000 keys exist, you may need to click Purge All Redis again to drain.',
              )
            : t(
                'redis.purgeMessage',
                'This deletes the Redis HSET for this vehicle (L2 cache only). The L1 in-memory cache on this pod is NOT touched and will refill as new telemetry arrives. Read-paths on other pods may briefly read stale L1 values until the next signal arrives.',
              )
        }
        onCancel={() => {
          if (isPurging) {
            return;
          }
          setPurgeMode(null);
          setPurgeTargetId(null);
          setPurgeTargetLabel('');
        }}
        onConfirm={handlePurgeConfirm}
        open={purgeMode !== null}
        requireTypedConfirmation={purgeMode === 'all' ? 'PURGE ALL' : undefined}
        title={
          purgeMode === 'all'
            ? t('redis.purgeAllTitle', 'Purge ALL Redis (L2) caches?')
            : t('redis.purgeTitle', 'Purge Redis (L2) cache for {{vehicle}}?', {
                vehicle: purgeTargetLabel,
              })
        }
        typedConfirmationLabel={
          purgeMode === 'all'
            ? t('redis.purgeAllTypedLabel', 'Type PURGE ALL to confirm')
            : undefined
        }
        variant="danger"
      />
    </PageScaffold>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 11,
  },
  bannerBody: {
    flex: 1,
    rowGap: spacing.sm,
  },
  bannerCtaText: {
    color: colors.textPrimary,
    fontSize: 13,
  },
  bannerPanel: {
    borderRadius: 16,
    padding: spacing.md,
  },
  bannerRow: {
    columnGap: spacing.md,
    flexDirection: 'row',
  },
  bannerText: {
    fontSize: 13,
    lineHeight: 19,
  },
  bannerTitle: {
    color: colors.textPrimary,
    fontSize: 15,
  },
  button: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    columnGap: spacing.xs,
    flexDirection: 'row',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  buttonDanger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonGlyph: {
    fontSize: 14,
  },
  buttonLabelDanger: {
    color: ROSE_300,
    fontSize: 13,
  },
  buttonLabelSecondary: {
    color: colors.textPrimary,
    fontSize: 13,
  },
  buttonSecondary: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
  cellName: {
    color: colors.textPrimary,
    fontFamily: MONO,
    fontSize: 13,
  },
  cellValue: {
    fontFamily: MONO,
    fontSize: 13,
  },
  controlsRow: {
    columnGap: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.md,
  },
  diagnosticGlyph: {
    fontSize: 22,
  },
  diagnosticGlyphLarge: {
    fontSize: 40,
    opacity: 0.7,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    rowGap: spacing.sm,
  },
  emptyStateIcon: {
    opacity: 0.8,
  },
  emptyStateMessage: {
    textAlign: 'center',
  },
  input: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  maskedRow: {
    alignItems: 'center',
    columnGap: spacing.xs,
    flexDirection: 'row',
  },
  maskedText: {
    fontFamily: MONO,
    fontSize: 13,
  },
  maskedToggle: {
    paddingHorizontal: 2,
  },
  maskedToggleGlyph: {
    fontSize: 13,
  },
  metaChipsRow: {
    alignItems: 'center',
    columnGap: spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.xs,
  },
  metaLabel: {
    flex: 1,
  },
  metaList: {
    rowGap: spacing.xs,
  },
  metaMono: {
    color: colors.textPrimary,
    fontFamily: MONO,
    fontSize: 12,
  },
  metaRow: {
    alignItems: 'center',
    columnGap: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  metaValue: {
    alignItems: 'flex-end',
  },
  metaValueText: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  monoText: {
    fontFamily: MONO,
  },
  otherChip: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  otherChipCount: {
    color: colors.textMuted,
  },
  otherChipText: {
    color: colors.textSecondary,
  },
  otherChips: {
    columnGap: spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.sm,
  },
  otherLabel: {
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  otherWrap: {
    rowGap: spacing.sm,
  },
  paginationButton: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
    height: 32,
    justifyContent: 'center',
    width: 40,
  },
  paginationButtonText: {
    color: colors.textPrimary,
    fontSize: 16,
  },
  paginationRow: {
    alignItems: 'center',
    columnGap: spacing.md,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingTop: spacing.sm,
  },
  paginationText: {
    minWidth: 48,
    textAlign: 'center',
  },
  panel: {
    padding: spacing.md,
  },
  scaffold: {
    padding: spacing.lg,
    rowGap: spacing.lg,
  },
  scaffoldBody: {
    rowGap: spacing.lg,
  },
  scaffoldHeader: {
    rowGap: spacing.xs,
  },
  scaffoldSubtitle: {
    fontSize: 14,
  },
  scaffoldTitle: {
    color: colors.textPrimary,
  },
  searchGlyph: {
    fontSize: 14,
  },
  searchWrap: {
    alignItems: 'center',
    columnGap: spacing.xs,
    flexDirection: 'row',
    flexGrow: 1,
    minWidth: 200,
  },
  select: {
    columnGap: spacing.xs,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.xs,
  },
  selectOption: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  selectOptionActive: {
    backgroundColor: colors.surfaceSelected,
    borderColor: colors.borderAccent,
  },
  selectOptionText: {
    color: colors.textSecondary,
  },
  selectOptionTextActive: {
    color: colors.textPrimary,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 6,
    height: 32,
  },
  skeletonStack: {
    rowGap: spacing.sm,
  },
  statCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: 12,
    borderWidth: 1,
    flexGrow: 1,
    flexBasis: '46%',
    padding: spacing.md,
    rowGap: spacing.xs,
  },
  statCardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statCardIcon: {
    opacity: 0.7,
  },
  statCardLabel: {
    color: colors.textMuted,
    fontSize: 13,
  },
  statCardValue: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '700',
  },
  statGrid: {
    columnGap: spacing.md,
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.md,
  },
  table: {
    rowGap: spacing.xs,
  },
  tableCell: {
    flex: 1,
    justifyContent: 'center',
    paddingRight: spacing.sm,
  },
  tableHeaderRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: 'row',
    paddingBottom: spacing.sm,
  },
  tableHeaderText: {
    color: colors.textMuted,
    fontSize: 12,
  },
  tableRow: {
    alignItems: 'center',
    borderBottomColor: 'rgba(255, 255, 255, 0.04)',
    borderBottomWidth: 1,
    flexDirection: 'row',
    minHeight: 48,
    paddingVertical: spacing.xs,
  },
  toggleLabel: {
    fontSize: 13,
  },
  toggleRow: {
    alignItems: 'center',
    columnGap: spacing.xs,
    flexDirection: 'row',
  },
  toggleThumb: {
    backgroundColor: '#ffffff',
    borderRadius: 9,
    height: 18,
    width: 18,
  },
  toggleTrack: {
    borderRadius: 11,
    height: 22,
    justifyContent: 'center',
    paddingHorizontal: 2,
    width: 40,
  },
});
