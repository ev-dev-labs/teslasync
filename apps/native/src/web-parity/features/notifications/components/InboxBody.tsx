import {Glyph} from '../../../../components/icons/Glyph';
// Native parity port of
// web/src/features/notifications/components/InboxBody.tsx.
//
// `InboxBody` is the shared notification-log inbox surface. It owns:
//   - URL-backed filter + view state (severity, vehicle, rule, search, read
//     state, from/to, view mode)
//   - bulk selection + bulk actions (mark read, archive/restore, delete)
//   - auto-mark-read on open (opt-out via a stored preference)
//   - per-row context menu (view context, mark read/unread, archive/restore,
//     delete)
//   - a day-grouped flat list AND a threaded grouped list
//
// Used by InboxPage (`archived=false`) and ArchivedPage (`archived=true`). Every
// state name (`severity`/`vehicleIds`/`ruleIds`/`search`/`readState`/`from`/`to`/
// `view`/`isGrouped`/`filters`/`rows`/`groups`/`ruleMap`/`vehicleMap`/`selected`/
// `grouped`/`unreadCount`/`bulkActions`/`autoMarkedRef` …), every API path (via
// the reused hooks), the read/archive/delete behaviour, the day-grouping logic,
// and every `t('key','English'[,opts])` i18n intent are preserved verbatim.
//
// Web modules with no native-parity surface are mapped per the conversion
// contract (rules 4-7), each documented in the sidecar:
//   - react-i18next `useTranslation` -> a local key-preserving shim supporting
//     `t(key,'English')` and `t(key,'English',{count})` with `{{token}}`
//     interpolation (apps/native deps lack react-i18next).
//   - react-router-dom `useNavigate` -> a native shim whose `navigate(href)`
//     calls `Linking.openURL` (internal SPA routes resolve only when a deep-link
//     handler is registered; same seam the other page ports use for `<Link>`).
//   - lucide-react icons -> decorative AppText glyphs (accessibility-hidden); the
//     adjacent visible label / accessibilityLabel always carries the meaning.
//   - `@/lib/cn` -> dropped; RN has no className, conditional styling uses
//     StyleSheet arrays.
//   - `@/components/ui` GlassPanel -> the shared native GlassPanel; `Button` ->
//     a local Pressable button; `useContextMenu`/`ContextMenuItem` -> a local
//     long-press-driven native action-sheet Modal (web right-click is
//     unavailable; long-press is the native idiom).
//   - `@/components/data-display` BulkActionsToolbar/BulkAction -> the reused
//     web-parity data-display port (props match 1:1; lucide icons become glyphs).
//   - `@/components/feedback` EmptyState/Skeleton/useToast -> local components:
//     EmptyState (glyph + title + message + optional action), Skeleton (static
//     muted block), useToast (a lightweight bottom banner host preserving the
//     undo `action` affordance).
//   - `@/components/motion` FadeIn -> the reused web-parity motion FadeIn.
//   - `@/components/ai/AIInboxAutoCategorization` -> the reused web-parity ai
//     port (props vehicleId/severities/ruleIds/onApplyCategories match 1:1).
//   - `@/components/mobile` PullToRefresh -> a native ScrollView + RefreshControl
//     (the idiomatic native equivalent); SwipeRow -> a native-safe passthrough
//     (swipe-to-archive needs react-native-gesture-handler, absent from the
//     native deps; the per-row buttons + long-press context menu provide the
//     same archive/restore actions).
//   - `@/hooks/useBulkSelection` -> a local Set<number> implementation with the
//     same surface (selectedIds/clear/setSelected/selectAll/masterState).
//   - `@/hooks/useAnnouncer` -> a local hook backed by
//     AccessibilityInfo.announceForAccessibility.
//   - `@/hooks/useUrlState` (useUrlString/useUrlEnum/useUrlArray/useUrlBatch) ->
//     a local React-Context-backed in-memory param store with the identical
//     hook surface (native has no URL; the inbox keeps shareable filter state in
//     component state for the session).
//   - `@/lib/alertDrillthrough` `getAlertDrillthroughHref` -> inlined verbatim
//     (manual query-string build; RN has no guaranteed URLSearchParams).
//   - localStorage preference reads (`readPref`) -> a native-safe default of
//     `true` (matches the web unset-default; AsyncStorage is not wired here).
//   - the sibling NotificationFilterBar / NotificationRow / NotificationGroupRow
//     components are rebuilt as local native components mirroring the exact
//     public API InboxBody consumes (their richer internals get their own
//     conversion passes).
//
// No DOM-only modules, browser HTML elements, Recharts, Leaflet, or old web UI
// components are imported. Tailwind maps to StyleSheet (`space-y-*` -> gap; the
// glass panels / chips / rows resolve to View+StyleSheet; `--text-muted/primary/
// secondary` -> the AppText tones). The page body is wrapped in the
// pull-to-refresh ScrollView so every section stays reachable.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';
import {
  BulkActionsToolbar,
  type BulkAction,
} from '../../../components/data-display/BulkActionsToolbar';
import {FadeIn} from '../../../components/motion';
import {AIInboxAutoCategorization} from '../../../components/ai/AIInboxAutoCategorization';
import {
  useNotificationLogs,
  useNotificationGroups,
  useGroupMembers,
  useArchiveNotifications,
  useUnarchiveNotifications,
  useMarkNotificationsRead,
  useMarkNotificationsUnread,
  useBulkMarkRead,
  useDeleteNotifications,
  type NotificationFilters,
  type NotificationLog,
  type NotificationLogGroup,
  type AlertRule,
  type Alert,
} from '../../../api/hooks/useNotifications';
import type {Vehicle} from '../../../api/types';

// ─── i18n shim ──────────────────────────────────────────────────────────────
// react-i18next is absent from the native deps; i18next returns the inline
// English fallback when no translation exists. Two source call shapes are
// supported: `t(key,'English')` and `t(key,'English',{count})` with `{{token}}`
// interpolation.
type TOptions = Record<string, string | number>;
type TFunc = (key: string, fallback: string, opts?: TOptions) => string;

function interpolate(template: string, opts: TOptions): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = opts[key];
    return value === undefined ? '' : String(value);
  });
}

function useTranslation(): {t: TFunc} {
  const t = useCallback<TFunc>((_key, fallback, opts) => {
    return opts ? interpolate(fallback, opts) : fallback;
  }, []);
  return {t};
}

// ─── navigation shim ────────────────────────────────────────────────────────
// react-router-dom `useNavigate` -> a native shim that opens the drill-through
// href via Linking. Internal SPA routes resolve only when a deep-link handler is
// registered; the call site (`navigate(href)`) is otherwise unchanged.
function useNavigate(): (href: string) => void {
  return useCallback((href: string) => {
    void Linking.openURL(href).catch(() => {
      // No deep-link handler registered for this internal route; native-safe no-op.
    });
  }, []);
}

// ─── lucide -> glyph map ──────────────────────────────────────────────────────
// Decorative stand-ins for the lucide SVG icons. Always paired with a visible
// label / accessibilityLabel so meaning never depends on the glyph.
const GLYPH = {
  archive: '\u{1F5C4}',
  restore: '\u21A9',
  bell: '\u{1F514}',
  mailOpen: '\u2709',
  mail: '\u2709',
  trash: '\u{1F5D1}',
  checkCheck: '\u2713\u2713',
  layers: '\u29C9',
  list: '\u2630',
  externalLink: '\u2197',
  chevronRight: '\u203A',
  chevronDown: '\u2304',
  info: '\u24D8',
  warn: '\u26A0',
  critical: '\u26D4',
} as const;

// ─── alertDrillthrough (inlined from web/src/lib/alertDrillthrough.ts) ────────
// Maps an Alert to a navigable href on the relevant context page. RN has no
// guaranteed URLSearchParams, so the query string is built manually.
const SIGNAL_TO_PAGE: Record<string, string> = {
  BatteryLevel: '/battery',
  RatedRange: '/battery',
  ChargeLimitSoc: '/battery',
  EstBatteryRange: '/battery',
  IdealBatteryRange: '/battery',
  ChargeState: '/charging',
  DetailedChargeState: '/charging',
  DCChargingPower: '/charging',
  ACChargingPower: '/charging',
  ChargeAmps: '/charging',
  ChargerVoltage: '/charging',
  ChargerActualCurrent: '/charging',
  ChargingCableType: '/charging',
  Gear: '/drives',
  VehicleSpeed: '/drives',
  Power: '/drives',
  Odometer: '/drives',
  InsideTemp: '/climate-control',
  OutsideTemp: '/climate-control',
  HvacPower: '/climate-control',
  ClimateKeeperMode: '/climate-control',
  TpmsPressureFl: '/tire-pressure',
  TpmsPressureFr: '/tire-pressure',
  TpmsPressureRl: '/tire-pressure',
  TpmsPressureRr: '/tire-pressure',
  TpmsHardWarnings: '/tire-pressure',
  TpmsSoftWarnings: '/tire-pressure',
  TpmsLastSeenPressureTimeFl: '/tire-pressure',
  TpmsLastSeenPressureTimeFr: '/tire-pressure',
  TpmsLastSeenPressureTimeRl: '/tire-pressure',
  TpmsLastSeenPressureTimeRr: '/tire-pressure',
  Locked: '/security-access',
  SentryMode: '/security-access',
  DoorState: '/security-access',
  WindowState: '/security-access',
  SunroofInstalled: '/security-access',
  SoftwareUpdateVersion: '/software-updates',
  SoftwareUpdateDownloadPercentComplete: '/software-updates',
  SoftwareUpdateInstallationPercentComplete: '/software-updates',
  SoftwareUpdateExpectedDurationMinutes: '/software-updates',
  LocatedAtHome: '/navigation',
  LocatedAtWork: '/navigation',
  LocatedAtFavorite: '/navigation',
  DestinationName: '/navigation',
  DestinationLocation: '/navigation',
};
const SIGNAL_EXPLORER_FALLBACK = '/signal-explorer';

function getAlertDrillthroughHref(alert: Alert): string {
  const signal = alert.rule_signal ?? null;
  const vehicleId = alert.vehicle_id && alert.vehicle_id > 0 ? alert.vehicle_id : null;
  const ts = alert.created_at;

  const params: string[] = [];
  if (vehicleId != null) params.push(`vehicle_id=${encodeURIComponent(String(vehicleId))}`);
  if (ts) params.push(`t=${encodeURIComponent(ts)}`);
  if (signal) params.push(`signal=${encodeURIComponent(signal)}`);

  const path = signal && SIGNAL_TO_PAGE[signal] ? SIGNAL_TO_PAGE[signal] : SIGNAL_EXPLORER_FALLBACK;
  const search = params.join('&');
  return search ? `${path}?${search}` : path;
}

// ─── filter / view enums (ported verbatim) ────────────────────────────────────
const SEVERITY_VALUES = ['info', 'warn', 'critical'] as const;
type SeverityValue = (typeof SEVERITY_VALUES)[number];

const READ_VALUES = ['all', 'read', 'unread'] as const;
type ReadValue = (typeof READ_VALUES)[number];

const VIEW_VALUES = ['grouped', 'flat'] as const;
type ViewValue = (typeof VIEW_VALUES)[number];

const PREF_MARK_ON_OPEN = 'teslasync.notifications.markOnOpen';
const PREF_MARK_ON_CLICK = 'teslasync.notifications.markOnClick';

// localStorage is unavailable on native; AsyncStorage is not wired here. The web
// default for an unset preference is `true`, so both PREF_* reads resolve `true`
// (auto-mark on open + mark on click stay enabled by default).
function readPref(_key: string): boolean {
  return true;
}

/**
 * Group ISO timestamps into "Today" / "Yesterday" / dated buckets keyed by the
 * user's local day. Rows keep their incoming order (newest first); the day
 * grouping just adds headers. Ported verbatim.
 */
function groupByDay<T extends {created_at: string}>(rows: T[]): {day: string; rows: T[]}[] {
  if (rows.length === 0) return [];
  const fmt = new Intl.DateTimeFormat(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const labelFor = (d: Date): string => {
    const day = new Date(d);
    day.setHours(0, 0, 0, 0);
    if (day.getTime() === today.getTime()) return 'Today';
    if (day.getTime() === yesterday.getTime()) return 'Yesterday';
    return fmt.format(d);
  };

  const out: {day: string; rows: T[]}[] = [];
  let current: {day: string; rows: T[]} | null = null;
  for (const row of rows) {
    const d = new Date(row.created_at);
    if (Number.isNaN(d.getTime())) continue;
    const label = labelFor(d);
    if (!current || current.day !== label) {
      current = {day: label, rows: []};
      out.push(current);
    }
    current.rows.push(row);
  }
  return out;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '\u2014';
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  try {
    return sameDay
      ? new Intl.DateTimeFormat(undefined, {hour: 'numeric', minute: '2-digit'}).format(d)
      : new Intl.DateTimeFormat(undefined, {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        }).format(d);
  } catch {
    return iso;
  }
}

// ─── URL-state shim (native in-memory store) ──────────────────────────────────
// Native has no URL. The four web hooks (useUrlString/useUrlEnum/useUrlArray/
// useUrlBatch) share a single React-Context param store so a filtered view stays
// internally consistent for the session. The hook surface mirrors the web API so
// the InboxBody body is unchanged.
interface UrlState {
  params: Record<string, string | null>;
  setMany: (patch: Record<string, string | null>) => void;
}
const UrlStateContext = createContext<UrlState | null>(null);

function UrlStateProvider({children}: {children: ReactNode}) {
  const [params, setParams] = useState<Record<string, string | null>>({});
  const setMany = useCallback((patch: Record<string, string | null>) => {
    setParams(prev => {
      const next = {...prev};
      for (const key of Object.keys(patch)) {
        const value = patch[key];
        if (value == null) delete next[key];
        else next[key] = value;
      }
      return next;
    });
  }, []);
  const value = useMemo<UrlState>(() => ({params, setMany}), [params, setMany]);
  return <UrlStateContext.Provider value={value}>{children}</UrlStateContext.Provider>;
}

function useUrlCtx(): UrlState {
  const ctx = useContext(UrlStateContext);
  if (!ctx) throw new Error('UrlStateProvider is missing');
  return ctx;
}

function useUrlString(key: string, def = ''): [string, (value: string | null) => void] {
  const {params, setMany} = useUrlCtx();
  const value = params[key] ?? def;
  const set = useCallback(
    (next: string | null) => setMany({[key]: next && next.length ? next : null}),
    [key, setMany],
  );
  return [value, set];
}

function useUrlEnum<T extends string>(
  key: string,
  values: readonly T[],
  def: T,
): [T, (value: T) => void] {
  const {params, setMany} = useUrlCtx();
  const raw = params[key];
  const value = raw && (values as readonly string[]).includes(raw) ? (raw as T) : def;
  const set = useCallback((next: T) => setMany({[key]: next}), [key, setMany]);
  return [value, set];
}

function useUrlArray(key: string): [string[], (value: string[]) => void] {
  const {params, setMany} = useUrlCtx();
  const raw = params[key] ?? '';
  const arr = useMemo(() => (raw ? raw.split(',').filter(Boolean) : []), [raw]);
  const set = useCallback(
    (next: string[]) => setMany({[key]: next.length ? next.join(',') : null}),
    [key, setMany],
  );
  return [arr, set];
}

function useUrlBatch(): (patch: Record<string, string | null>) => void {
  const {setMany} = useUrlCtx();
  return setMany;
}

// ─── bulk selection shim ──────────────────────────────────────────────────────
type MasterState = 'all' | 'some' | 'none';

function useBulkSelection<T>() {
  const [selectedIds, setSelectedIds] = useState<Set<T>>(() => new Set<T>());
  const clear = useCallback(() => setSelectedIds(new Set<T>()), []);
  const setSelected = useCallback((id: T, on: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const selectAll = useCallback((ids: T[]) => {
    setSelectedIds(prev => {
      const allSelected = ids.length > 0 && ids.every(id => prev.has(id));
      return allSelected ? new Set<T>() : new Set(ids);
    });
  }, []);
  const masterState = useCallback(
    (ids: T[]): MasterState => {
      if (ids.length === 0) return 'none';
      const count = ids.filter(id => selectedIds.has(id)).length;
      if (count === 0) return 'none';
      if (count === ids.length) return 'all';
      return 'some';
    },
    [selectedIds],
  );
  return {selectedIds, clear, setSelected, selectAll, masterState};
}

// ─── announcer shim ───────────────────────────────────────────────────────────
function useAnnouncer(): {announce: (message: string) => void} {
  const announce = useCallback((message: string) => {
    AccessibilityInfo.announceForAccessibility(message);
  }, []);
  return {announce};
}

// ─── toast shim ───────────────────────────────────────────────────────────────
interface ToastAction {
  label: string;
  onClick: () => void;
}
interface ToastInput {
  type: 'success' | 'error' | 'info';
  title: string;
  duration?: number;
  action?: ToastAction;
}
interface ActiveToast extends ToastInput {
  id: number;
  detail?: string;
}

function useToast() {
  const [active, setActive] = useState<ActiveToast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  const dismiss = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setActive(null);
  }, []);

  const show = useCallback((next: ActiveToast) => {
    if (timer.current) clearTimeout(timer.current);
    setActive(next);
    timer.current = setTimeout(() => setActive(null), next.duration ?? 5000);
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const toast = useCallback(
    (input: ToastInput) => {
      seq.current += 1;
      show({...input, id: seq.current});
    },
    [show],
  );

  const error = useCallback(
    (title: string, detail?: string) => {
      seq.current += 1;
      show({id: seq.current, type: 'error', title, detail, duration: 6000});
    },
    [show],
  );

  const node = active ? (
    <View pointerEvents="box-none" style={styles.toastWrap}>
      <GlassPanel style={styles.toast}>
        <View style={styles.toastBody}>
          <AppText style={styles.toastTitle} weight="semibold">
            {active.title}
          </AppText>
          {active.detail ? (
            <AppText style={styles.toastDetail} tone="secondary" variant="caption">
              {active.detail}
            </AppText>
          ) : null}
        </View>
        {active.action ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={active.action.label}
            hitSlop={8}
            onPress={() => {
              active.action?.onClick();
              dismiss();
            }}
            style={({pressed}) => [styles.toastAction, pressed && styles.pressed]}>
            <AppText style={styles.toastActionText} weight="semibold">
              {active.action.label}
            </AppText>
          </Pressable>
        ) : null}
      </GlassPanel>
    </View>
  ) : null;

  return {toast, error, node};
}

// ─── context menu shim (long-press action sheet) ──────────────────────────────
export interface ContextMenuItem {
  id: string;
  label: string;
  icon?: ReactNode;
  destructive?: boolean;
  onClick: () => void;
}

function useContextMenu() {
  const [items, setItems] = useState<ContextMenuItem[] | null>(null);
  const openMenu = useCallback((next: ContextMenuItem[], _x?: number, _y?: number) => {
    setItems(next);
  }, []);
  const close = useCallback(() => setItems(null), []);

  const node = items ? (
    <Modal animationType="fade" onRequestClose={close} transparent visible>
      <Pressable accessibilityRole="button" onPress={close} style={styles.menuBackdrop} />
      <View pointerEvents="box-none" style={styles.menuSheetWrap}>
        <GlassPanel style={styles.menuSheet}>
          {items.map(item => (
            <Pressable
              key={item.id}
              accessibilityRole="menuitem"
              accessibilityLabel={item.label}
              onPress={() => {
                close();
                item.onClick();
              }}
              style={({pressed}) => [styles.menuItem, pressed && styles.pressed]}>
              {item.icon ? <View style={styles.menuItemIcon}>{item.icon}</View> : null}
              <AppText
                style={[styles.menuItemLabel, item.destructive && styles.menuItemDestructive]}>
                {item.label}
              </AppText>
            </Pressable>
          ))}
        </GlassPanel>
      </View>
    </Modal>
  ) : null;

  return {openMenu, node};
}

// ─── small native primitives ──────────────────────────────────────────────────
function GlyphLegacyUnused({glyph, style}: {glyph: string; style?: object}) {
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.glyph, style]}>
      {glyph}
    </AppText>
  );
}

function Checkbox({
  checked,
  onToggle,
  label,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{checked}}
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onToggle}
      style={[styles.checkbox, checked && styles.checkboxOn]}>
      {checked ? <AppText style={styles.checkboxTick}>{'\u2713'}</AppText> : null}
    </Pressable>
  );
}

function IconButton({
  glyph,
  label,
  onPress,
  disabled = false,
}: {
  glyph: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({pressed}) => [
        styles.iconButton,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}>
      <Glyph glyph={glyph} />
    </Pressable>
  );
}

function GhostButton({
  glyph,
  label,
  onPress,
  disabled = false,
}: {
  glyph?: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({pressed}) => [
        styles.ghostButton,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}>
      {glyph ? <Glyph glyph={glyph} style={styles.ghostButtonGlyph} /> : null}
      <AppText style={styles.ghostButtonText} variant="caption" weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

const SEVERITY_COLOR: Record<string, string> = {
  info: colors.accent,
  warn: colors.warning,
  warning: colors.warning,
  critical: colors.danger,
};

function SeverityBadge({severity}: {severity: string}) {
  const dot = SEVERITY_COLOR[severity] ?? colors.accent;
  return (
    <View style={styles.severityBadge}>
      <View style={[styles.severityDot, {backgroundColor: dot}]} />
      <AppText style={styles.severityText} variant="caption" weight="semibold">
        {severity}
      </AppText>
    </View>
  );
}

function EmptyState({
  glyph,
  title,
  message,
  actionLabel,
  onAction,
}: {
  glyph: string;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.emptyState}>
      <Glyph glyph={glyph} style={styles.emptyGlyph} />
      <AppText style={styles.emptyTitle} weight="semibold">
        {title}
      </AppText>
      <AppText style={styles.emptyMessage} tone="secondary" variant="caption">
        {message}
      </AppText>
      {actionLabel && onAction ? (
        <View style={styles.emptyAction}>
          <GhostButton label={actionLabel} onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}

function Skeleton() {
  return <View style={styles.skeleton} />;
}

// ─── PullToRefresh (native ScrollView + RefreshControl) ───────────────────────
function PullToRefresh({
  onRefresh,
  children,
}: {
  onRefresh: () => Promise<void>;
  children: ReactNode;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    Promise.resolve(onRefresh()).finally(() => setRefreshing(false));
  }, [onRefresh]);
  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      refreshControl={
        <RefreshControl
          onRefresh={handleRefresh}
          refreshing={refreshing}
          tintColor={colors.accent}
        />
      }
      style={styles.scroll}>
      {children}
    </ScrollView>
  );
}

// ─── SwipeRow (native-safe passthrough) ───────────────────────────────────────
// Swipe-to-archive needs react-native-gesture-handler (absent from the native
// deps). The per-row action buttons and the long-press context menu provide the
// same archive/restore actions, so this renders its children straight through.
interface SwipeActionConfig {
  label: string;
  onAction: () => void;
  tone?: 'danger' | 'default';
}
function SwipeRow({
  children,
}: {
  children: ReactNode;
  rightAction?: SwipeActionConfig;
  leftAction?: SwipeActionConfig;
}) {
  return <View>{children}</View>;
}

// ─── NotificationRow (local native mirror of the web sibling) ─────────────────
interface NotificationRowProps {
  log: NotificationLog;
  rule?: AlertRule;
  vehicle?: Vehicle;
  selected: boolean;
  onSelectionChange: (id: number, selected: boolean) => void;
  onActivate?: (log: NotificationLog) => void;
  onArchive?: (id: number) => void;
  onUnarchive?: (id: number) => void;
  onMarkRead?: (id: number) => void;
  onMarkUnread?: (id: number) => void;
  onLongPress?: () => void;
}

function NotificationRow({
  log,
  rule,
  vehicle,
  selected,
  onSelectionChange,
  onActivate,
  onArchive,
  onUnarchive,
  onMarkRead,
  onMarkUnread,
  onLongPress,
}: NotificationRowProps) {
  const {t} = useTranslation();
  const navigate = useNavigate();
  const isRead = !!log.read_at;
  const isArchived = !!log.archived_at;
  const severity = rule?.severity ?? 'info';

  const synthetic: Alert = {
    id: log.id,
    vehicle_id: vehicle?.id ?? rule?.vehicle_id ?? 0,
    type: rule?.name ?? log.title,
    severity: severity as Alert['severity'],
    title: log.title,
    message: log.message,
    is_read: isRead,
    created_at: log.created_at,
    rule_id: rule?.id,
    rule_signal: rule?.signal_name,
    rule_severity: rule?.severity,
  };
  const drillHref = rule ? getAlertDrillthroughHref(synthetic) : null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{selected}}
      onPress={() => onActivate?.(log)}
      onLongPress={onLongPress}
      style={({pressed}) => [
        styles.row,
        !isRead && styles.rowUnread,
        isRead && styles.rowRead,
        pressed && styles.rowPressed,
      ]}>
      <Checkbox
        checked={selected}
        onToggle={() => onSelectionChange(log.id, !selected)}
        label={t('notifications.inbox.row.select', 'Select notification')}
      />

      <View style={styles.rowMain}>
        <View style={styles.rowMeta}>
          <SeverityBadge severity={severity} />
          <AppText style={styles.metaMuted} variant="caption">
            {formatTimestamp(log.created_at)}
          </AppText>
          {vehicle ? (
            <AppText numberOfLines={1} style={styles.metaMuted} variant="caption">
              {`\u00B7 ${vehicle.display_name || `#${vehicle.id}`}`}
            </AppText>
          ) : null}
          {rule?.name ? (
            <AppText numberOfLines={1} style={styles.metaMuted} variant="caption">
              {`\u00B7 ${rule.name}`}
            </AppText>
          ) : null}
        </View>
        <AppText
          numberOfLines={1}
          style={[styles.rowTitle, isRead ? styles.rowTitleRead : styles.rowTitleUnread]}>
          {log.title}
        </AppText>
        {log.message ? (
          <AppText numberOfLines={1} style={styles.rowMessage} tone="muted" variant="caption">
            {log.message}
          </AppText>
        ) : null}
      </View>

      <View style={styles.rowActions}>
        {!isRead && onMarkRead ? (
          <IconButton
            glyph={GLYPH.mailOpen}
            label={t('notifications.inbox.row.markRead', 'Mark as read')}
            onPress={() => onMarkRead(log.id)}
          />
        ) : null}
        {isRead && onMarkUnread ? (
          <IconButton
            glyph={GLYPH.mail}
            label={t('notifications.inbox.row.markUnread', 'Mark as unread')}
            onPress={() => onMarkUnread(log.id)}
          />
        ) : null}
        {!isArchived && onArchive ? (
          <IconButton
            glyph={GLYPH.archive}
            label={t('notifications.inbox.row.archive', 'Archive')}
            onPress={() => onArchive(log.id)}
          />
        ) : null}
        {isArchived && onUnarchive ? (
          <IconButton
            glyph={GLYPH.restore}
            label={t('notifications.inbox.row.unarchive', 'Restore')}
            onPress={() => onUnarchive(log.id)}
          />
        ) : null}
        {drillHref ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={t('alerts.viewContext', 'View context')}
            hitSlop={6}
            onPress={() => navigate(drillHref)}
            style={({pressed}) => [styles.drillLink, pressed && styles.pressed]}>
            <AppText style={styles.drillLinkText} variant="caption" weight="semibold">
              {t('alerts.viewContext', 'View context')}
            </AppText>
            <Glyph glyph={GLYPH.chevronRight} style={styles.drillLinkGlyph} />
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

// ─── NotificationGroupRow (local native mirror of the web sibling) ────────────
interface NotificationGroupRowProps {
  group: NotificationLogGroup;
  ruleMap: Record<number, AlertRule>;
  vehicleMap: Record<number, Vehicle>;
  filters: NotificationFilters;
  selectedIds?: Set<number>;
  onSelectionChange?: (id: number, selected: boolean) => void;
  onActivate?: (log: NotificationLog) => void;
  onArchive?: (id: number) => void;
  onUnarchive?: (id: number) => void;
  onMarkRead?: (id: number) => void;
  onMarkUnread?: (id: number) => void;
  archived: boolean;
  onLongPress?: () => void;
}

function NotificationGroupRow({
  group,
  ruleMap,
  vehicleMap,
  filters,
  selectedIds,
  onSelectionChange,
  onActivate,
  onArchive,
  onUnarchive,
  onMarkRead,
  onMarkUnread,
  archived,
  onLongPress,
}: NotificationGroupRowProps) {
  const {t} = useTranslation();
  const toast = useToast();
  const bulkMarkRead = useBulkMarkRead();
  const [expanded, setExpanded] = useState(false);

  const isSingleton = group.group_key == null;
  const extraCount = Math.max(0, group.count - 1);

  const {
    data: members = [],
    isLoading: membersLoading,
    error: membersError,
  } = useGroupMembers(group.group_key ?? null, filters, {enabled: expanded && !isSingleton});

  const latest = group.latest;
  const latestRule = latest.alert_id != null ? ruleMap[latest.alert_id] : undefined;
  const latestVehicleId = latestRule?.vehicle_id ?? undefined;
  const latestVehicle = latestVehicleId != null ? vehicleMap[latestVehicleId] : undefined;

  const otherMembers = members.filter(m => m.id !== latest.id);

  const handleMarkGroupRead = useCallback(async () => {
    const gk = group.group_key;
    if (!gk) return;
    try {
      const res = await bulkMarkRead.mutateAsync({group_key: gk});
      toast.toast({
        type: 'success',
        title: t('notifications.group.markReadSuccess', 'Marked {{count}} thread members as read', {
          count: res.updated,
        }),
        duration: 4000,
      });
    } catch (e) {
      toast.error(
        t('notifications.group.markReadError', 'Could not mark group as read'),
        e instanceof Error ? e.message : undefined,
      );
    }
  }, [bulkMarkRead, group.group_key, toast, t]);

  const noopSelection = useCallback((_id: number, _on: boolean) => {
    // intentional fallback when the parent doesn't wire selection
  }, []);
  const rowSelectionHandler = onSelectionChange ?? noopSelection;
  const isMemberSelected = useCallback(
    (id: number) => (selectedIds ? selectedIds.has(id) : false),
    [selectedIds],
  );

  return (
    <View style={styles.group}>
      <NotificationRow
        log={latest}
        rule={latestRule}
        vehicle={latestVehicle}
        selected={isMemberSelected(latest.id)}
        onSelectionChange={rowSelectionHandler}
        onActivate={onActivate}
        onArchive={onArchive}
        onUnarchive={onUnarchive}
        onMarkRead={onMarkRead}
        onMarkUnread={onMarkUnread}
        onLongPress={onLongPress}
      />
      {!isSingleton && (extraCount > 0 || group.unread_count > 1) ? (
        <View style={styles.groupChips}>
          {extraCount > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{expanded}}
              accessibilityLabel={
                expanded
                  ? t('notifications.group.collapse', 'Hide similar')
                  : t('notifications.group.expand', 'Show {{count}} similar', {count: extraCount})
              }
              onPress={() => setExpanded(v => !v)}
              style={({pressed}) => [styles.expandChip, pressed && styles.pressed]}>
              <Glyph
                glyph={expanded ? GLYPH.chevronDown : GLYPH.chevronRight}
                style={styles.expandChipGlyph}
              />
              <AppText style={styles.expandChipText} variant="caption" weight="semibold">
                {t('notifications.group.similar', '+{{count}} similar', {count: extraCount})}
              </AppText>
            </Pressable>
          ) : null}
          {group.unread_count > 0 ? (
            <View style={styles.unreadChip}>
              <AppText style={styles.unreadChipText} variant="caption" weight="semibold">
                {String(group.unread_count)}
              </AppText>
            </View>
          ) : null}
          {group.vehicle_ids.length > 0 ? (
            <AppText style={styles.metaMuted} variant="caption">
              {t('notifications.group.vehicleAffected', '{{count}} vehicles affected', {
                count: group.vehicle_ids.length,
              })}
            </AppText>
          ) : null}
          {group.unread_count > 0 && !archived ? (
            <View style={styles.groupMarkRead}>
              <GhostButton
                glyph={GLYPH.mailOpen}
                label={t('notifications.group.markRead', 'Mark group read')}
                onPress={handleMarkGroupRead}
                disabled={bulkMarkRead.isPending}
              />
            </View>
          ) : null}
        </View>
      ) : null}

      {expanded && !isSingleton ? (
        <View style={styles.groupMembers}>
          {membersLoading ? (
            <AppText style={styles.metaMuted} variant="caption">
              {t('notifications.group.loadingMembers', 'Loading thread members\u2026')}
            </AppText>
          ) : null}
          {!membersLoading && membersError ? (
            <AppText style={styles.errorText} variant="caption">
              {t('notifications.group.membersError', 'Could not load thread members')}
            </AppText>
          ) : null}
          {!membersLoading && !membersError && otherMembers.length === 0 ? (
            <AppText style={styles.metaMuted} variant="caption">
              {t('notifications.group.noMembers', 'No thread members found')}
            </AppText>
          ) : null}
          {!membersLoading && !membersError
            ? otherMembers.map(m => {
                const rule = m.alert_id != null ? ruleMap[m.alert_id] : undefined;
                const vehicle = rule?.vehicle_id != null ? vehicleMap[rule.vehicle_id] : undefined;
                return (
                  <NotificationRow
                    key={m.id}
                    log={m}
                    rule={rule}
                    vehicle={vehicle}
                    selected={isMemberSelected(m.id)}
                    onSelectionChange={rowSelectionHandler}
                    onActivate={onActivate}
                    onArchive={onArchive}
                    onUnarchive={onUnarchive}
                    onMarkRead={!m.read_at ? onMarkRead : undefined}
                    onMarkUnread={m.read_at ? onMarkUnread : undefined}
                  />
                );
              })
            : null}
        </View>
      ) : null}
      {toast.node}
    </View>
  );
}

// ─── NotificationFilterBar (local native mirror of the web sibling) ───────────
interface NotificationFilterBarProps {
  filters: NotificationFilters;
  onChange: (next: NotificationFilters) => void;
  vehicles: Vehicle[];
  rules: AlertRule[];
}

const FILTER_SEVERITIES: {value: SeverityValue; glyph: string}[] = [
  {value: 'info', glyph: GLYPH.info},
  {value: 'warn', glyph: GLYPH.warn},
  {value: 'critical', glyph: GLYPH.critical},
];

function NotificationFilterBar({filters, onChange, vehicles, rules}: NotificationFilterBarProps) {
  const {t} = useTranslation();

  const selectedSeverities = new Set<SeverityValue>(
    (filters.severity ?? []) as SeverityValue[],
  );
  const selectedVehicle = filters.vehicle_id?.[0];
  const selectedRule = filters.rule_id?.[0];

  const toggleSeverity = (sev: SeverityValue) => {
    const current = (filters.severity ?? []) as SeverityValue[];
    const next = current.includes(sev) ? current.filter(s => s !== sev) : [...current, sev];
    onChange({...filters, severity: next.length ? next : undefined});
  };
  const setVehicle = (id?: number) => onChange({...filters, vehicle_id: id ? [id] : undefined});
  const setRule = (id?: number) => onChange({...filters, rule_id: id ? [id] : undefined});
  const setQuery = (q: string) => onChange({...filters, q: q.trim() ? q : undefined});

  const severityLabels: Record<SeverityValue, string> = {
    info: t('notifications.inbox.filter.severity.info', 'Info'),
    warn: t('notifications.inbox.filter.severity.warn', 'Warn'),
    critical: t('notifications.inbox.filter.severity.critical', 'Critical'),
  };

  const handleClearAll = () => {
    onChange({
      ...filters,
      severity: undefined,
      vehicle_id: undefined,
      rule_id: undefined,
      q: undefined,
      from: undefined,
      to: undefined,
    });
  };

  const hasActive =
    !!filters.severity?.length ||
    !!filters.vehicle_id?.length ||
    !!filters.rule_id?.length ||
    !!filters.q ||
    !!filters.from ||
    !!filters.to;

  return (
    <GlassPanel style={styles.filterBar}>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t('notifications.inbox.filter.severity', 'Severity')}
        style={styles.chipRow}>
        {FILTER_SEVERITIES.map(opt => {
          const active = selectedSeverities.has(opt.value);
          return (
            <Pressable
              key={opt.value}
              accessibilityRole="button"
              accessibilityState={{selected: active}}
              accessibilityLabel={severityLabels[opt.value]}
              onPress={() => toggleSeverity(opt.value)}
              style={({pressed}) => [
                styles.filterChip,
                active && styles.filterChipActive,
                pressed && styles.pressed,
              ]}>
              <Glyph glyph={opt.glyph} style={styles.filterChipGlyph} />
              <AppText
                style={[styles.filterChipText, active && styles.filterChipTextActive]}
                variant="caption"
                weight="semibold">
                {severityLabels[opt.value]}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      <ScrollView
        contentContainerStyle={styles.chipScrollContent}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipScroll}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{selected: !selectedVehicle}}
          onPress={() => setVehicle(undefined)}
          style={({pressed}) => [
            styles.pickerChip,
            !selectedVehicle && styles.pickerChipActive,
            pressed && styles.pressed,
          ]}>
          <AppText style={styles.pickerChipText} variant="caption">
            {t('notifications.inbox.filter.allVehicles', 'All vehicles')}
          </AppText>
        </Pressable>
        {vehicles.map(v => {
          const active = selectedVehicle === v.id;
          return (
            <Pressable
              key={v.id}
              accessibilityRole="button"
              accessibilityState={{selected: active}}
              onPress={() => setVehicle(v.id)}
              style={({pressed}) => [
                styles.pickerChip,
                active && styles.pickerChipActive,
                pressed && styles.pressed,
              ]}>
              <AppText style={styles.pickerChipText} variant="caption">
                {v.display_name || `#${v.id}`}
              </AppText>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView
        contentContainerStyle={styles.chipScrollContent}
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipScroll}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{selected: !selectedRule}}
          onPress={() => setRule(undefined)}
          style={({pressed}) => [
            styles.pickerChip,
            !selectedRule && styles.pickerChipActive,
            pressed && styles.pressed,
          ]}>
          <AppText style={styles.pickerChipText} variant="caption">
            {t('notifications.inbox.filter.allRules', 'All rules')}
          </AppText>
        </Pressable>
        {rules.map(r => {
          const active = selectedRule === r.id;
          return (
            <Pressable
              key={r.id}
              accessibilityRole="button"
              accessibilityState={{selected: active}}
              onPress={() => setRule(r.id)}
              style={({pressed}) => [
                styles.pickerChip,
                active && styles.pickerChipActive,
                pressed && styles.pressed,
              ]}>
              <AppText style={styles.pickerChipText} variant="caption">
                {r.name}
              </AppText>
            </Pressable>
          );
        })}
      </ScrollView>

      <TextInput
        accessibilityLabel={t('notifications.inbox.filter.searchLabel', 'Search')}
        defaultValue={filters.q ?? ''}
        onChangeText={setQuery}
        placeholder={t('notifications.inbox.filter.searchPlaceholder', 'Search messages\u2026')}
        placeholderTextColor={colors.textMuted}
        style={styles.searchInput}
      />

      {hasActive ? (
        <View style={styles.clearAllRow}>
          <GhostButton label={t('filters.clearAll', 'Clear all')} onPress={handleClearAll} />
        </View>
      ) : null}
    </GlassPanel>
  );
}

// ─── ViewToggle (grouped / flat) ──────────────────────────────────────────────
function ViewToggle({view, onChange}: {view: ViewValue; onChange: (v: ViewValue) => void}) {
  const {t} = useTranslation();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={t('notifications.view.label', 'View')}
      style={styles.viewToggle}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{selected: view === 'grouped'}}
        onPress={() => onChange('grouped')}
        style={({pressed}) => [
          styles.viewToggleBtn,
          view === 'grouped' && styles.viewToggleBtnActive,
          pressed && styles.pressed,
        ]}>
        <Glyph glyph={GLYPH.layers} style={styles.viewToggleGlyph} />
        <AppText
          style={[styles.viewToggleText, view === 'grouped' && styles.viewToggleTextActive]}
          variant="caption"
          weight="semibold">
          {t('notifications.view.grouped', 'Grouped')}
        </AppText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{selected: view === 'flat'}}
        onPress={() => onChange('flat')}
        style={({pressed}) => [
          styles.viewToggleBtn,
          view === 'flat' && styles.viewToggleBtnActive,
          pressed && styles.pressed,
        ]}>
        <Glyph glyph={GLYPH.list} style={styles.viewToggleGlyph} />
        <AppText
          style={[styles.viewToggleText, view === 'flat' && styles.viewToggleTextActive]}
          variant="caption"
          weight="semibold">
          {t('notifications.view.flat', 'Flat')}
        </AppText>
      </Pressable>
    </View>
  );
}

// ─── InboxBody ────────────────────────────────────────────────────────────────
export interface InboxBodyProps {
  archived: boolean;
  vehicles: Vehicle[];
  rules: AlertRule[];
}

function InboxBodyInner({archived, vehicles, rules}: InboxBodyProps) {
  const {t} = useTranslation();

  // ── URL-backed filter state ─────────────────────
  const [severityRaw] = useUrlArray('severity');
  const [vehicleIdsRaw] = useUrlArray('vehicle_id');
  const [ruleIdsRaw] = useUrlArray('rule_id');
  const [search] = useUrlString('q', '');
  const [readState] = useUrlEnum<ReadValue>('read', READ_VALUES, 'all');
  const [from] = useUrlString('from', '');
  const [to] = useUrlString('to', '');
  const [view, setView] = useUrlEnum<ViewValue>('view', VIEW_VALUES, 'grouped');
  const setFiltersBatch = useUrlBatch();
  const isGrouped = view === 'grouped' && !archived;

  const severity = useMemo<SeverityValue[]>(
    () =>
      severityRaw.filter((s): s is SeverityValue =>
        SEVERITY_VALUES.includes(s as SeverityValue),
      ),
    [severityRaw],
  );
  const vehicleIds = useMemo<number[]>(() => {
    return vehicleIdsRaw.map(v => Number(v)).filter(n => Number.isFinite(n) && n > 0);
  }, [vehicleIdsRaw]);
  const ruleIds = useMemo<number[]>(() => {
    return ruleIdsRaw.map(v => Number(v)).filter(n => Number.isFinite(n) && n > 0);
  }, [ruleIdsRaw]);

  const filters = useMemo<NotificationFilters>(
    () => ({
      archived,
      severity: severity.length ? severity : undefined,
      vehicle_id: vehicleIds.length ? vehicleIds : undefined,
      rule_id: ruleIds.length ? ruleIds : undefined,
      q: search || undefined,
      from: from || undefined,
      to: to || undefined,
      read: readState === 'all' ? undefined : readState === 'read',
    }),
    [archived, severity, vehicleIds, ruleIds, search, from, to, readState],
  );

  const handleFiltersChange = useCallback(
    (next: NotificationFilters) => {
      const readValue = next.read === undefined ? null : next.read ? 'read' : 'unread';
      setFiltersBatch({
        severity: (next.severity ?? []).join(',') || null,
        vehicle_id: (next.vehicle_id ?? []).map(String).join(',') || null,
        rule_id: (next.rule_id ?? []).map(String).join(',') || null,
        q: next.q ?? null,
        from: next.from ?? null,
        to: next.to ?? null,
        read: readValue,
      });
    },
    [setFiltersBatch],
  );

  const handleApplyAICategories = useCallback(
    (newRuleIds: number[]) => {
      setFiltersBatch({
        rule_id: newRuleIds.map(String).join(',') || null,
      });
    },
    [setFiltersBatch],
  );

  const {data: rawRows, isLoading, error, refetch} = useNotificationLogs(filters, {
    enabled: !isGrouped,
  });
  const rows = useMemo<NotificationLog[]>(() => rawRows ?? [], [rawRows]);

  const {
    data: rawGroups,
    isLoading: groupsLoading,
    error: groupsError,
    refetch: groupsRefetch,
  } = useNotificationGroups(filters, {enabled: isGrouped});
  const groups = useMemo(() => rawGroups ?? [], [rawGroups]);

  const ruleMap = useMemo<Record<number, AlertRule>>(() => {
    const m: Record<number, AlertRule> = {};
    rules.forEach(r => {
      m[r.id] = r;
    });
    return m;
  }, [rules]);
  const vehicleMap = useMemo<Record<number, Vehicle>>(() => {
    const m: Record<number, Vehicle> = {};
    vehicles.forEach(v => {
      m[v.id] = v;
    });
    return m;
  }, [vehicles]);

  const markReadMut = useMarkNotificationsRead();
  const markUnreadMut = useMarkNotificationsUnread();
  const bulkMarkReadMut = useBulkMarkRead();
  const archiveMut = useArchiveNotifications();
  const unarchiveMut = useUnarchiveNotifications();
  const deleteMut = useDeleteNotifications();
  const toast = useToast();
  const {announce} = useAnnouncer();

  const autoMarkedRef = useRef(false);
  useEffect(() => {
    if (archived) return;
    if (isGrouped) return;
    if (autoMarkedRef.current) return;
    if (isLoading) return;
    if (!readPref(PREF_MARK_ON_OPEN)) return;
    const unread = rows.filter(r => !r.read_at).map(r => r.id);
    if (unread.length === 0) return;
    autoMarkedRef.current = true;
    markReadMut.mutate(unread);
  }, [archived, isLoading, rows, markReadMut, isGrouped]);

  const bulkSelection = useBulkSelection<number>();
  const selected = bulkSelection.selectedIds;
  const clearSelection = bulkSelection.clear;
  const toggleSelected = useCallback(
    (id: number, on: boolean) => bulkSelection.setSelected(id, on),
    [bulkSelection],
  );
  const visibleIds = useMemo(() => rows.map(r => r.id), [rows]);
  const selectAllVisible = useCallback(
    () => bulkSelection.selectAll(visibleIds),
    [bulkSelection, visibleIds],
  );
  const allVisibleSelected = bulkSelection.masterState(visibleIds) === 'all';
  useEffect(() => {
    clearSelection();
  }, [filters, clearSelection]);

  const grouped = useMemo(() => groupByDay(rows), [rows]);

  const unreadCount = useMemo(
    () => rows.reduce((acc, r) => (r.read_at ? acc : acc + 1), 0),
    [rows],
  );

  const handleBulkArchive = useCallback(
    async (ids: Array<string | number>) => {
      await archiveMut.mutateAsync(ids.map(Number));
      clearSelection();
      announce(
        t('notifications.bulk.announceArchived', '{{count}} items archived', {
          count: ids.length,
        }),
      );
    },
    [archiveMut, announce, clearSelection, t],
  );
  const handleBulkUnarchive = useCallback(
    async (ids: Array<string | number>) => {
      await unarchiveMut.mutateAsync(ids.map(Number));
      clearSelection();
      announce(
        t('notifications.bulk.announceRestored', '{{count}} items restored', {
          count: ids.length,
        }),
      );
    },
    [unarchiveMut, announce, clearSelection, t],
  );
  const handleBulkMarkRead = useCallback(
    async (ids: Array<string | number>) => {
      const numericIds = ids.map(Number);
      try {
        await bulkMarkReadMut.mutateAsync({ids: numericIds});
      } catch (e) {
        toast.error(
          t('toast.notifications.markRead.error', 'Failed to mark as read'),
          e instanceof Error ? e.message : undefined,
        );
        return;
      }
      clearSelection();
      toast.toast({
        type: 'success',
        title: t('notifications.bulkRead.success', '{{count}} marked as read', {
          count: numericIds.length,
        }),
        duration: 5000,
        action: {
          label: t('common.undo', 'Undo'),
          onClick: () => {
            markUnreadMut.mutate(numericIds);
          },
        },
      });
    },
    [bulkMarkReadMut, markUnreadMut, toast, t, clearSelection],
  );
  const handleMarkAllRead = useCallback(async () => {
    if (unreadCount === 0) return;
    const visibleUnreadIds = rows.filter(r => !r.read_at).map(r => r.id);
    try {
      await bulkMarkReadMut.mutateAsync({all: true});
    } catch (e) {
      toast.error(
        t('toast.notifications.markRead.error', 'Failed to mark as read'),
        e instanceof Error ? e.message : undefined,
      );
      return;
    }
    clearSelection();
    toast.toast({
      type: 'success',
      title: t('notifications.markAllRead.success', 'All notifications marked as read'),
      duration: 5000,
      action:
        visibleUnreadIds.length > 0
          ? {
              label: t('common.undo', 'Undo'),
              onClick: () => {
                markUnreadMut.mutate(visibleUnreadIds);
              },
            }
          : undefined,
    });
  }, [bulkMarkReadMut, markUnreadMut, toast, t, rows, unreadCount, clearSelection]);
  const handleBulkDelete = useCallback(
    async (ids: Array<string | number>) => {
      await deleteMut.mutateAsync(ids.map(Number));
      clearSelection();
    },
    [deleteMut, clearSelection],
  );

  const bulkActions = useMemo<BulkAction[]>(() => {
    const list: BulkAction[] = [];
    if (!archived) {
      list.push({
        id: 'mark-read',
        label: t('notifications.inbox.bulk.markRead', 'Mark read'),
        icon: GLYPH.mailOpen,
        onClick: handleBulkMarkRead,
      });
      list.push({
        id: 'archive',
        label: t('notifications.inbox.bulk.archive', 'Archive'),
        icon: GLYPH.archive,
        onClick: handleBulkArchive,
      });
    }
    if (archived) {
      list.push({
        id: 'restore',
        label: t('notifications.inbox.bulk.restore', 'Restore'),
        icon: GLYPH.restore,
        onClick: handleBulkUnarchive,
      });
    }
    list.push({
      id: 'delete',
      label: t('bulk.actions.delete', 'Delete'),
      icon: GLYPH.trash,
      variant: 'danger',
      confirm: {
        title: t('notifications.inbox.bulk.deleteConfirmTitle', 'Delete notifications?'),
        description: t(
          'notifications.inbox.bulk.deleteConfirmBody',
          'These notifications will be permanently removed. Archive is usually the safer choice.',
        ),
        confirmLabel: t('common.delete', 'Delete'),
      },
      onClick: handleBulkDelete,
    });
    return list;
  }, [archived, t, handleBulkArchive, handleBulkUnarchive, handleBulkMarkRead, handleBulkDelete]);

  const handleRowActivate = (log: NotificationLog) => {
    if (log.read_at) return;
    if (!readPref(PREF_MARK_ON_CLICK)) return;
    markReadMut.mutate([log.id]);
  };

  const navigate = useNavigate();
  const {openMenu: openRowContextMenu, node: contextMenuNode} = useContextMenu();
  const buildRowContextMenu = useCallback(
    (log: NotificationLog): ContextMenuItem[] => {
      const items: ContextMenuItem[] = [];
      const rule = log.alert_id != null ? ruleMap[log.alert_id] : undefined;
      const vehicle =
        log.alert_id != null && rule?.vehicle_id != null ? vehicleMap[rule.vehicle_id] : undefined;
      const isRead = !!log.read_at;
      const isArchived = !!log.archived_at;
      if (!isRead) {
        items.push({
          id: 'mark-read',
          label: t('notifications.inbox.row.markRead', 'Mark as read'),
          icon: <Glyph glyph={GLYPH.mailOpen} />,
          onClick: () => markReadMut.mutate([log.id]),
        });
      } else {
        items.push({
          id: 'mark-unread',
          label: t('notifications.inbox.row.markUnread', 'Mark as unread'),
          icon: <Glyph glyph={GLYPH.mail} />,
          onClick: () => markUnreadMut.mutate([log.id]),
        });
      }
      if (!isArchived) {
        items.push({
          id: 'archive',
          label: t('notifications.inbox.row.archive', 'Archive'),
          icon: <Glyph glyph={GLYPH.archive} />,
          onClick: () => archiveMut.mutate([log.id]),
        });
      } else {
        items.push({
          id: 'restore',
          label: t('notifications.inbox.row.unarchive', 'Restore'),
          icon: <Glyph glyph={GLYPH.restore} />,
          onClick: () => unarchiveMut.mutate([log.id]),
        });
      }
      if (rule) {
        const synthetic: Alert = {
          id: log.id,
          vehicle_id: vehicle?.id ?? rule.vehicle_id ?? 0,
          type: rule.name ?? log.title,
          severity: (rule.severity ?? 'info') as Alert['severity'],
          title: log.title,
          message: log.message,
          is_read: isRead,
          created_at: log.created_at,
          rule_id: rule.id,
          rule_signal: rule.signal_name,
          rule_severity: rule.severity,
        };
        const href = getAlertDrillthroughHref(synthetic);
        if (href) {
          items.push({
            id: 'view-context',
            label: t('alerts.viewContext', 'View context'),
            icon: <Glyph glyph={GLYPH.externalLink} />,
            onClick: () => navigate(href),
          });
        }
      }
      items.push({
        id: 'delete',
        label: t('common.delete', 'Delete'),
        icon: <Glyph glyph={GLYPH.trash} />,
        destructive: true,
        onClick: () => deleteMut.mutate([log.id]),
      });
      return items;
    },
    [ruleMap, vehicleMap, t, archiveMut, unarchiveMut, markReadMut, markUnreadMut, deleteMut, navigate],
  );
  const handleRowContextMenu = useCallback(
    (log: NotificationLog) => () => {
      const items = buildRowContextMenu(log);
      if (items.length === 0) return;
      openRowContextMenu(items);
    },
    [buildRowContextMenu, openRowContextMenu],
  );

  const countLabel = isGrouped
    ? t('notifications.inbox.countLabel', '{{count}} notifications', {count: groups.length})
    : t('notifications.inbox.countLabel', '{{count}} notifications', {count: rows.length});

  const showLoading = (isGrouped && groupsLoading) || (!isGrouped && isLoading);

  return (
    <View style={styles.root}>
      <PullToRefresh
        onRefresh={async () => {
          await (isGrouped ? groupsRefetch() : refetch());
        }}>
        <View style={styles.bodyStack}>
          <FadeIn>
            <NotificationFilterBar
              filters={filters}
              onChange={handleFiltersChange}
              vehicles={vehicles}
              rules={rules}
            />
          </FadeIn>

          <AIInboxAutoCategorization
            vehicleId={vehicleIds.length === 1 ? vehicleIds[0] : null}
            severities={severity}
            ruleIds={ruleIds}
            onApplyCategories={handleApplyAICategories}
          />

          <BulkActionsToolbar
            selectedIds={Array.from(selected)}
            total={rows.length}
            onClear={clearSelection}
            actions={bulkActions}
            itemNoun={{
              one: t('bulk.noun.notification_one', 'notification'),
              other: t('bulk.noun.notification_other', 'notifications'),
            }}
          />

          <GlassPanel style={styles.panel}>
            <View style={styles.panelHeader}>
              {!isGrouped ? (
                <Checkbox
                  checked={allVisibleSelected}
                  onToggle={() =>
                    allVisibleSelected ? clearSelection() : selectAllVisible()
                  }
                  label={t('notifications.inbox.selectAll', 'Select all visible')}
                />
              ) : null}
              <AppText style={styles.countLabel} tone="muted" variant="caption">
                {countLabel}
              </AppText>
              {!archived ? <ViewToggle view={view} onChange={setView} /> : null}
              {!archived && !isGrouped && unreadCount > 0 ? (
                <View style={styles.markAllWrap}>
                  <GhostButton
                    glyph={GLYPH.checkCheck}
                    label={t('notifications.markAllRead.action', 'Mark all read')}
                    onPress={handleMarkAllRead}
                    disabled={bulkMarkReadMut.isPending}
                  />
                </View>
              ) : null}
            </View>

            {showLoading ? (
              <View style={styles.skeletonStack}>
                {[1, 2, 3, 4, 5].map(i => (
                  <Skeleton key={i} />
                ))}
              </View>
            ) : null}

            {!isGrouped && !isLoading && error ? (
              <EmptyState
                glyph={GLYPH.bell}
                title={t('notifications.inbox.error.title', 'Could not load notifications')}
                message={String(error)}
                actionLabel={t('common.retry', 'Retry')}
                onAction={() => {
                  void refetch();
                }}
              />
            ) : null}

            {isGrouped && !groupsLoading && groupsError ? (
              <EmptyState
                glyph={GLYPH.bell}
                title={t('notifications.inbox.error.title', 'Could not load notifications')}
                message={String(groupsError)}
                actionLabel={t('common.retry', 'Retry')}
                onAction={() => {
                  void groupsRefetch();
                }}
              />
            ) : null}

            {!isGrouped && !isLoading && !error && grouped.length === 0 ? (
              <EmptyState
                glyph={GLYPH.bell}
                title={
                  archived
                    ? t('notifications.inbox.empty.archivedTitle', 'No archived notifications')
                    : t('notifications.inbox.empty.title', 'No notifications')
                }
                message={
                  archived
                    ? t(
                        'notifications.inbox.empty.archivedMessage',
                        'Archived notifications will appear here.',
                      )
                    : t(
                        'notifications.inbox.empty.message',
                        'When alert rules fire, the resulting notifications appear here.',
                      )
                }
                actionLabel={
                  archived ? undefined : t('notifications.inbox.empty.cta', 'Configure alert rules')
                }
                onAction={archived ? undefined : () => navigate('/notifications/studio')}
              />
            ) : null}

            {isGrouped && !groupsLoading && !groupsError && groups.length === 0 ? (
              <EmptyState
                glyph={GLYPH.bell}
                title={t('notifications.group.emptyTitle', 'No notification threads')}
                message={t(
                  'notifications.group.emptyMessage',
                  'When alert rules fire repeatedly, related notifications will be grouped here.',
                )}
                actionLabel={t('notifications.inbox.empty.cta', 'Configure alert rules')}
                onAction={() => navigate('/notifications/studio')}
              />
            ) : null}

            {!isGrouped && !isLoading && !error && grouped.length > 0 ? (
              <View style={styles.dayStack}>
                {grouped.map(group => (
                  <View key={group.day}>
                    <AppText style={styles.dayHeader} tone="muted" variant="caption" weight="semibold">
                      {group.day === 'Today'
                        ? t('common.today', 'Today')
                        : group.day === 'Yesterday'
                        ? t('common.yesterday', 'Yesterday')
                        : group.day}
                    </AppText>
                    <View style={styles.rowStack}>
                      {group.rows.map(log => (
                        <SwipeRow
                          key={log.id}
                          rightAction={
                            !archived
                              ? {
                                  label: t('mobile.swipe.archive', 'Archive'),
                                  onAction: () => archiveMut.mutate([log.id]),
                                  tone: 'default',
                                }
                              : {
                                  label: t('mobile.swipe.restore', 'Restore'),
                                  onAction: () => unarchiveMut.mutate([log.id]),
                                  tone: 'default',
                                }
                          }>
                          <NotificationRow
                            log={log}
                            rule={log.alert_id != null ? ruleMap[log.alert_id] : undefined}
                            vehicle={
                              log.alert_id != null && ruleMap[log.alert_id]?.vehicle_id != null
                                ? vehicleMap[ruleMap[log.alert_id]!.vehicle_id!]
                                : undefined
                            }
                            selected={selected.has(log.id)}
                            onSelectionChange={toggleSelected}
                            onActivate={handleRowActivate}
                            onArchive={!archived ? id => archiveMut.mutate([id]) : undefined}
                            onUnarchive={archived ? id => unarchiveMut.mutate([id]) : undefined}
                            onMarkRead={!log.read_at ? id => markReadMut.mutate([id]) : undefined}
                            onMarkUnread={log.read_at ? id => markUnreadMut.mutate([id]) : undefined}
                            onLongPress={handleRowContextMenu(log)}
                          />
                        </SwipeRow>
                      ))}
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            {isGrouped && !groupsLoading && !groupsError && groups.length > 0 ? (
              <View style={styles.groupStack}>
                {groups.map((g, idx) => (
                  <NotificationGroupRow
                    key={g.group_key ?? `singleton:${g.latest.id}:${idx}`}
                    group={g}
                    ruleMap={ruleMap}
                    vehicleMap={vehicleMap}
                    filters={filters}
                    archived={archived}
                    selectedIds={selected}
                    onSelectionChange={toggleSelected}
                    onActivate={handleRowActivate}
                    onArchive={id => archiveMut.mutate([id])}
                    onUnarchive={archived ? id => unarchiveMut.mutate([id]) : undefined}
                    onMarkRead={id => markReadMut.mutate([id])}
                    onMarkUnread={id => markUnreadMut.mutate([id])}
                    onLongPress={handleRowContextMenu(g.latest)}
                  />
                ))}
              </View>
            ) : null}
          </GlassPanel>
        </View>
      </PullToRefresh>
      {contextMenuNode}
      {toast.node}
    </View>
  );
}

export function InboxBody(props: InboxBodyProps) {
  return (
    <UrlStateProvider>
      <InboxBodyInner {...props} />
    </UrlStateProvider>
  );
}

export default InboxBody;

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.md,
  },
  bodyStack: {
    gap: spacing.md,
  },
  pressed: {
    opacity: 0.82,
  },
  disabled: {
    opacity: 0.48,
  },
  glyph: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 18,
  },

  // panel
  panel: {
    gap: spacing.sm,
    padding: spacing.md,
  },
  panelHeader: {
    alignItems: 'center',
    borderBottomColor: colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  countLabel: {
    color: colors.textMuted,
  },
  markAllWrap: {
    marginLeft: 'auto',
  },

  // checkbox
  checkbox: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 4,
    borderWidth: 1,
    height: 20,
    justifyContent: 'center',
    width: 20,
  },
  checkboxOn: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  checkboxTick: {
    color: colors.accent,
    fontSize: 13,
    lineHeight: 16,
  },

  // icon button
  iconButton: {
    alignItems: 'center',
    borderRadius: 8,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },

  // ghost button
  ghostButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 32,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  ghostButtonGlyph: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  ghostButtonText: {
    color: colors.textPrimary,
  },

  // severity badge
  severityBadge: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  severityDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  severityText: {
    color: colors.textSecondary,
    textTransform: 'capitalize',
  },

  // row
  row: {
    alignItems: 'flex-start',
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
  },
  rowUnread: {
    backgroundColor: colors.surfaceRaised,
    borderLeftColor: colors.borderAccent,
    borderLeftWidth: 2,
  },
  rowRead: {
    opacity: 0.92,
  },
  rowPressed: {
    backgroundColor: colors.surfaceHover,
  },
  rowMain: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  rowMeta: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  metaMuted: {
    color: colors.textMuted,
  },
  rowTitle: {
    fontSize: 14,
    lineHeight: 18,
  },
  rowTitleRead: {
    color: colors.textSecondary,
  },
  rowTitleUnread: {
    color: colors.textPrimary,
    fontWeight: '600',
  },
  rowMessage: {
    color: colors.textMuted,
  },
  rowActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 0,
    gap: 2,
  },
  drillLink: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 2,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  drillLinkText: {
    color: colors.accent,
  },
  drillLinkGlyph: {
    color: colors.accent,
    fontSize: 13,
  },

  // group
  group: {
    borderRadius: 12,
    gap: spacing.xs,
  },
  groupChips: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingBottom: 4,
    paddingHorizontal: spacing.md,
  },
  groupMarkRead: {
    marginLeft: 'auto',
  },
  expandChip: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  expandChipGlyph: {
    color: colors.accent,
    fontSize: 12,
  },
  expandChipText: {
    color: colors.accent,
  },
  unreadChip: {
    backgroundColor: colors.warningSurface,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  unreadChipText: {
    color: colors.warning,
  },
  groupMembers: {
    borderLeftColor: colors.border,
    borderLeftWidth: 2,
    gap: spacing.xs,
    marginLeft: spacing.md,
    marginTop: spacing.xs,
    paddingLeft: spacing.sm,
  },
  groupStack: {
    gap: spacing.sm,
  },

  // filter bar
  filterBar: {
    gap: spacing.sm,
    padding: spacing.md,
  },
  chipRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  filterChip: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  filterChipActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  filterChipGlyph: {
    color: colors.textSecondary,
    fontSize: 12,
  },
  filterChipText: {
    color: colors.textSecondary,
  },
  filterChipTextActive: {
    color: colors.accent,
  },
  chipScroll: {
    flexGrow: 0,
  },
  chipScrollContent: {
    gap: spacing.xs,
    paddingVertical: 2,
  },
  pickerChip: {
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  pickerChipActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  pickerChipText: {
    color: colors.textSecondary,
  },
  searchInput: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    color: colors.textPrimary,
    minHeight: 40,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
  },
  clearAllRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
  },

  // view toggle
  viewToggle: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 2,
    marginLeft: 'auto',
    padding: 2,
  },
  viewToggleBtn: {
    alignItems: 'center',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  viewToggleBtnActive: {
    backgroundColor: colors.accentSoft,
  },
  viewToggleGlyph: {
    color: colors.textMuted,
    fontSize: 13,
  },
  viewToggleText: {
    color: colors.textMuted,
  },
  viewToggleTextActive: {
    color: colors.accent,
  },

  // skeleton / empty
  skeletonStack: {
    gap: spacing.sm,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    height: 56,
  },
  emptyState: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xl,
  },
  emptyGlyph: {
    color: colors.textMuted,
    fontSize: 28,
    lineHeight: 34,
  },
  emptyTitle: {
    color: colors.textPrimary,
    textAlign: 'center',
  },
  emptyMessage: {
    color: colors.textSecondary,
    textAlign: 'center',
  },
  emptyAction: {
    marginTop: spacing.sm,
  },

  // day grouping
  dayStack: {
    gap: spacing.md,
  },
  dayHeader: {
    color: colors.textMuted,
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
  },
  rowStack: {
    gap: spacing.xs,
  },

  // toast
  toastWrap: {
    bottom: spacing.lg,
    left: spacing.lg,
    position: 'absolute',
    right: spacing.lg,
  },
  toast: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.md,
  },
  toastBody: {
    flex: 1,
    gap: 2,
  },
  toastTitle: {
    color: colors.textPrimary,
  },
  toastDetail: {
    color: colors.textSecondary,
  },
  toastAction: {
    borderColor: colors.borderAccent,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  toastActionText: {
    color: colors.accent,
  },
  errorText: {
    color: colors.danger,
  },

  // context menu
  menuBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
  },
  menuSheetWrap: {
    bottom: 0,
    left: 0,
    padding: spacing.md,
    position: 'absolute',
    right: 0,
  },
  menuSheet: {
    gap: 2,
    padding: spacing.sm,
  },
  menuItem: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  menuItemIcon: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 20,
  },
  menuItemLabel: {
    color: colors.textPrimary,
  },
  menuItemDestructive: {
    color: colors.danger,
  },
});
