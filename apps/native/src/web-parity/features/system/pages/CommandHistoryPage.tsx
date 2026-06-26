/**
 * Native parity port of web/src/features/system/pages/CommandHistoryPage.tsx.
 *
 * The web page is the per-vehicle command audit log: a header (vehicle Select +
 * RangePicker + "Back to Commands" link), four summary StatCards (commands in the
 * last 24h, success rate, most-used command, last-sent relative time), a filter
 * bar (status TabNav All/Success/Failed + a deferred command search box with a
 * pending spinner), a paginated command Timeline, and a Pagination footer. It
 * reads the command history from `useCommandHistory(activeVehicleId)` (exact path
 * `/vehicles/{id}/commands/history?limit=200`), mirrors the active vehicle +
 * filters into the URL query string, defers the search query so typing stays
 * responsive, and derives all stats/filters from the full history.
 *
 * This native port preserves that contract 1:1 — the same data hook + API path,
 * the same `useUrlEnum('status')` / `useUrlString('q')` / `useUrlNumber('page')`
 * filter state, the `useUrlBatch` atomic multi-key writes, the `useSelectedVehicle`
 * selection, the `useRangeState` window, the `useDeferredValue` search + pending
 * flag, the verbatim COMMAND_LABELS / formatCommandName / buildSubtitle helpers,
 * the `filtered` / `paginatedCommands` / `stats` / `timelineItems` memos, all four
 * StatCards, the status tabs, the search box, the Timeline (or EmptyState), and
 * the Pagination footer — using React Native primitives, the existing native
 * AppText / GlassPanel + design tokens, and the already-ported web-parity Timeline
 * and Pagination components.
 *
 * Browser-only / not-yet-ported dependencies are reduced explicitly and
 * documented in the `.parity.json` sidecar:
 *   - react `useDeferredValue` / `useMemo` (web L9): preserved verbatim.
 *   - react-i18next `useTranslation` (web L10): no native i18next runtime, so an
 *     inline native-safe `t(key, fallback?, params?)` shim returns the English
 *     fallback (else the key) and interpolates i18next-style `{{count}}`
 *     placeholders, preserving every key + intent verbatim.
 *   - react-router-dom `Link to="/commands"` (web L11): no DOM router on native →
 *     a `Pressable` with `accessibilityRole="link"` whose destination path is
 *     preserved as `COMMANDS_ROUTE`; the native navigator shell owns navigation.
 *   - `@/components/layout` PageContainer / Grid (web L12): no native parity port
 *     yet, so a minimal native-safe `PageContainer` (ScrollView scaffold with
 *     title / subtitle / loading / error / actions / children, body gated behind
 *     the loading spinner) is reproduced locally, and the Grid becomes a native
 *     2-column wrapped StyleSheet grid.
 *   - `@/components/ui` GlassPanel / Input / Select / TabNav / Pagination
 *     (web L13-15): GlassPanel + Pagination are existing ports; Input → a native
 *     TextInput search box, Select → a native Pressable chip selector, TabNav → a
 *     native segmented chip control — each preserving the public prop shapes the
 *     page uses.
 *   - `@/components/data-display` StatCard / Timeline (web L16): Timeline is the
 *     already-ported web-parity component; StatCard is reproduced locally
 *     (label + icon eyebrow row + large value), matching the web StatCard intent.
 *   - `@/components/feedback` EmptyState (web L17): local native-safe EmptyState
 *     (icon + message).
 *   - `@/components/motion` FadeIn / StaggerContainer (web L18): framer-motion has
 *     no native equivalent here → static passthrough Views (the established
 *     precedent); the `delay` prop is accepted but inert.
 *   - `@/components/forms` RangePicker (web L19): the web calendar popover has no
 *     native equivalent → a display-only chip showing the active range; the
 *     `onChange` write path stays wired.
 *   - `@/hooks/usePageTitle` (web L20): `document.title` is browser-only → a
 *     documented no-op (the native navigator owns the title).
 *   - `@/hooks/useRangeState` (web L21): the web hook layers URL + localStorage +
 *     date presets; native has no router/localStorage → a native-safe shared
 *     external store seeded to the `defaultPresetId: 'all'` window
 *     (ALL_TIME_START → today), preserving the `{start, end, setRange}` contract.
 *   - `@/hooks/useUrlState` useUrlBatch / useUrlEnum / useUrlNumber / useUrlString
 *     (web L22): reproduced over a native-safe module-level URL-param external
 *     store (the EfficiencyPage precedent) preserving the read/omit-default/atomic
 *     write semantics this page relies on.
 *   - `@/hooks/useSelectedVehicle` (web L23): native-safe shared external store →
 *     first vehicle (router path/query precedence dropped), preserving the
 *     `{vehicleId, vehicles, setVehicleId}` contract.
 *   - `@/api/hooks/useCommands` useCommandHistory / CommandLogEntry (web L24):
 *     imported from the already-ported native hook module (same
 *     `/vehicles/{id}/commands/history?limit=200` path + response shape).
 *   - `@/lib/dateFormat` formatDateTime / formatRelative (web L25): ported
 *     native-safe (tz-aware via Intl, '—' for nullish/invalid, "just now" / "Nm
 *     ago" / "Nh ago" / "Nd ago" / absolute-date relative ladder).
 *   - lucide-react History / CheckCircle / XCircle / Terminal / Clock / TrendingUp
 *     / Award / Search / Gamepad2 (web L26-29): DOM SVG icons → decorative glyph
 *     constants (the established icon→glyph precedent).
 *   - the event-based `onChange` handlers (web L140/L148, ChangeEvent target.value)
 *     become value-based native callbacks; the handler LOGIC (setSearchQuery +
 *     page reset; Number-parse + setVehicleId + setUrl batch) is preserved.
 */
import React, {
  useCallback,
  useDeferredValue,
  useMemo,
  useSyncExternalStore,
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

import {useCommandHistory, type CommandLogEntry} from '../../../api/hooks/useCommands';
import {useVehicles, type Vehicle} from '../../../api/hooks/useVehicles';
import {Pagination} from '../../../components/ui/Pagination';
import {Timeline, type TimelineItemData} from '../../../components/data-display/Timeline';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing, typography} from '../../../../theme/tokens';

/* ------------------------------------------------------------------ */
/*  native-safe i18n (react-i18next has no native runtime, web L10)    */
/* ------------------------------------------------------------------ */

type NativeTParams = Record<string, string | number>;
type NativeTFunction = (
  key: string,
  fallback?: string,
  params?: NativeTParams,
) => string;

/** Interpolates i18next-style `{{name}}` placeholders, mirroring t(key, def, opts). */
function interpolate(template: string, params?: NativeTParams): string {
  if (!params) {
    return template;
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const value = params[name];
    return value === undefined ? '' : String(value);
  });
}

function useNativeTranslation(): NativeTFunction {
  return useCallback(
    (key: string, fallback?: string, params?: NativeTParams) =>
      interpolate(fallback ?? key, params),
    [],
  );
}

/* ------------------------------------------------------------------ */
/*  native-safe usePageTitle (web document.title is browser-only, L20) */
/* ------------------------------------------------------------------ */

function usePageTitle(_title: string): void {
  // The web hook writes document.title; on native the navigator owns the header
  // title, so the resolved title is intentionally not applied.
}

/* ------------------------------------------------------------------ */
/*  native-safe URL-param store (web @/hooks/useUrlState, web L22)      */
/* ------------------------------------------------------------------ */

const urlStateStore = new Map<string, string>();
const urlStateListeners = new Set<() => void>();

function getUrlParam(key: string): string | undefined {
  return urlStateStore.get(key);
}

function subscribeUrlState(listener: () => void): () => void {
  urlStateListeners.add(listener);
  return () => {
    urlStateListeners.delete(listener);
  };
}

function notifyUrlState(): void {
  urlStateListeners.forEach(listener => listener());
}

/** Atomic multi-key write — null/undefined/'' deletes the key (web useUrlBatch). */
function setUrlParams(updates: Record<string, string | null | undefined>): void {
  let changed = false;
  for (const [key, value] of Object.entries(updates)) {
    if (value == null || value === '') {
      if (urlStateStore.delete(key)) {
        changed = true;
      }
    } else if (urlStateStore.get(key) !== value) {
      urlStateStore.set(key, value);
      changed = true;
    }
  }
  if (changed) {
    notifyUrlState();
  }
}

function useUrlString(
  key: string,
  defaultValue = '',
): [string, (value: string) => void] {
  const raw = useSyncExternalStore(
    subscribeUrlState,
    () => getUrlParam(key),
    () => getUrlParam(key),
  );
  const value = raw ?? defaultValue;
  const set = useCallback((next: string) => setUrlParams({[key]: next}), [key]);
  return [value, set];
}

function useUrlNumber(
  key: string,
  defaultValue = 0,
): [number, (value: number) => void] {
  const raw = useSyncExternalStore(
    subscribeUrlState,
    () => getUrlParam(key),
    () => getUrlParam(key),
  );
  let value = defaultValue;
  if (raw != null) {
    const n = Number(raw);
    if (Number.isFinite(n)) {
      value = n;
    }
  }
  const set = useCallback(
    (next: number) =>
      setUrlParams({[key]: next === defaultValue ? null : String(next)}),
    [key, defaultValue],
  );
  return [value, set];
}

function useUrlEnum<E extends string>(
  key: string,
  allowed: readonly E[],
  defaultValue: E,
): [E, (value: E) => void] {
  const raw = useSyncExternalStore(
    subscribeUrlState,
    () => getUrlParam(key),
    () => getUrlParam(key),
  );
  const value = raw != null && allowed.includes(raw as E) ? (raw as E) : defaultValue;
  const set = useCallback(
    (next: E) => setUrlParams({[key]: next === defaultValue ? null : next}),
    [key, defaultValue],
  );
  return [value, set];
}

function useUrlBatch(): (
  updates: Record<string, string | null | undefined>,
) => void {
  return useCallback(updates => setUrlParams(updates), []);
}

/* ------------------------------------------------------------------ */
/*  native-safe useSelectedVehicle (web @/hooks/useSelectedVehicle, L23)*/
/* ------------------------------------------------------------------ */

let selectedVehicleOverride: number | null = null;
const selectedVehicleListeners = new Set<() => void>();

function getSelectedVehicleOverride(): number | null {
  return selectedVehicleOverride;
}

function subscribeSelectedVehicle(listener: () => void): () => void {
  selectedVehicleListeners.add(listener);
  return () => {
    selectedVehicleListeners.delete(listener);
  };
}

function setSelectedVehicleOverride(id: number | null): void {
  if (selectedVehicleOverride === id) {
    return;
  }
  selectedVehicleOverride = id;
  selectedVehicleListeners.forEach(listener => listener());
}

interface SelectedVehicleResult {
  vehicleId: number | null;
  vehicles: Vehicle[];
  setVehicleId: (id: number | null) => void;
}

/**
 * The web hook reads ?vehicle_id from the URL, persists the pick in a zustand
 * store, and falls back to the first vehicle. Native has no router, so the
 * precedence collapses to: shared override store → first vehicle.
 */
function useSelectedVehicle(): SelectedVehicleResult {
  const {data} = useVehicles();
  const vehicles = data ?? [];
  const override = useSyncExternalStore(
    subscribeSelectedVehicle,
    getSelectedVehicleOverride,
    getSelectedVehicleOverride,
  );
  const firstVehicleId = vehicles.length > 0 ? vehicles[0].id : null;
  const vehicleId = override ?? firstVehicleId;
  const setVehicleId = useCallback(
    (id: number | null) => setSelectedVehicleOverride(id),
    [],
  );
  return {vehicleId, vehicles, setVehicleId};
}

/* ------------------------------------------------------------------ */
/*  native-safe useRangeState (web @/hooks/useRangeState, web L21)      */
/* ------------------------------------------------------------------ */

interface RangeValue {
  start: string;
  end: string;
}

function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// defaultPresetId: 'all' → web resolveAllTimeStart() falls back to 2015-01-01.
const ALL_TIME_START = '2015-01-01';
let rangeState: RangeValue = {start: ALL_TIME_START, end: isoDay(new Date())};
const rangeListeners = new Set<() => void>();

function getRangeState(): RangeValue {
  return rangeState;
}

function subscribeRange(listener: () => void): () => void {
  rangeListeners.add(listener);
  return () => {
    rangeListeners.delete(listener);
  };
}

function setRangeStateValue(next: RangeValue): void {
  if (rangeState.start === next.start && rangeState.end === next.end) {
    return;
  }
  rangeState = {start: next.start, end: next.end};
  rangeListeners.forEach(listener => listener());
}

interface UseRangeStateOptions {
  persistKey?: string;
  defaultPresetId?: string;
}

function useRangeState(_opts?: UseRangeStateOptions): {
  start: string;
  end: string;
  setRange: (range: RangeValue) => void;
} {
  const state = useSyncExternalStore(subscribeRange, getRangeState, getRangeState);
  const setRange = useCallback((r: RangeValue) => setRangeStateValue(r), []);
  return {start: state.start, end: state.end, setRange};
}

/* ------------------------------------------------------------------ */
/*  decorative glyph stand-ins for the lucide-react icons (web L26-29)  */
/* ------------------------------------------------------------------ */

const ICON_HISTORY = '\uD83D\uDCDC'; // 📜 History (audit log)
const ICON_CHECK = '\u2713'; // ✓ CheckCircle
const ICON_X = '\u2717'; // ✗ XCircle
const ICON_TERMINAL = '\u276F'; // ❯ Terminal
const ICON_CLOCK = '\uD83D\uDD50'; // 🕐 Clock
const ICON_TRENDING_UP = '\uD83D\uDCC8'; // 📈 TrendingUp
const ICON_AWARD = '\uD83C\uDFC6'; // 🏆 Award
const ICON_SEARCH = '\uD83D\uDD0D'; // 🔍 Search
const ICON_GAMEPAD = '\uD83C\uDFAE'; // 🎮 Gamepad2

/** Web Link `to="/commands"` destination, preserved verbatim. */
const COMMANDS_ROUTE = '/commands';

/* ------------------------------------------------------------------ */
/*  Helpers (ported verbatim from the web file, web L33-95)            */
/* ------------------------------------------------------------------ */

const COMMAND_LABELS: Record<string, string> = {
  lock: 'Lock',
  unlock: 'Unlock',
  wake_up: 'Wake Up',
  climate_on: 'Climate ON',
  climate_off: 'Climate OFF',
  honk_horn: 'Honk Horn',
  flash_lights: 'Flash Lights',
  charge_start: 'Start Charging',
  charge_stop: 'Stop Charging',
  set_charge_limit: 'Set Charge Limit',
  set_temps: 'Set Temperature',
  actuate_trunk: 'Open/Close Trunk',
  actuate_frunk: 'Open Frunk',
  window_control: 'Window Control',
  sun_roof_control: 'Sunroof Control',
  remote_start_drive: 'Remote Start',
  set_sentry_mode: 'Sentry Mode',
  set_speed_limit: 'Speed Limit',
  clear_speed_limit: 'Clear Speed Limit',
  set_valet_mode: 'Valet Mode',
  reset_valet_pin: 'Reset Valet PIN',
  schedule_software_update: 'Schedule Update',
  cancel_software_update: 'Cancel Update',
  media_toggle_playback: 'Media Play/Pause',
  media_next_track: 'Next Track',
  media_prev_track: 'Previous Track',
  media_volume_up: 'Volume Up',
  media_volume_down: 'Volume Down',
  adjust_volume: 'Adjust Volume',
  navigation_request: 'Navigate',
  share: 'Share to Vehicle',
  trigger_homelink: 'Trigger HomeLink',
  set_bioweapon_mode: 'Bioweapon Defense',
  set_climate_keeper: 'Climate Keeper',
  set_cop_temp: 'Cabin Overheat Protection',
  dog_mode_on: 'Dog Mode ON',
  dog_mode_off: 'Dog Mode OFF',
  camp_mode_on: 'Camp Mode ON',
  camp_mode_off: 'Camp Mode OFF',
  set_scheduled_departure: 'Scheduled Departure',
  set_scheduled_charging: 'Scheduled Charging',
  set_preconditioning_max: 'Max Preconditioning',
  auto_conditioning_start: 'Start Preconditioning',
  auto_conditioning_stop: 'Stop Preconditioning',
  remote_seat_heater_request: 'Seat Heater',
  remote_seat_cooler_request: 'Seat Cooler',
  remote_steering_wheel_heater_request: 'Steering Wheel Heater',
  close_charge_port: 'Close Charge Port',
  open_charge_port: 'Open Charge Port',
  set_pin_to_drive: 'PIN to Drive',
};

function formatCommandName(cmd: string): string {
  return (
    COMMAND_LABELS[cmd] ??
    cmd.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  );
}

const PAGE_SIZE = 25;

const STATUS_FILTERS = ['all', 'success', 'failed'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

/* ------------------------------------------------------------------ */
/*  ported date helpers (web @/lib/dateFormat formatDateTime/Relative)  */
/* ------------------------------------------------------------------ */

interface FormatOptions {
  tz?: string;
  locale?: string;
}

function intlOpts(
  base: Intl.DateTimeFormatOptions,
  opts?: FormatOptions,
): Intl.DateTimeFormatOptions {
  return opts?.tz ? {...base, timeZone: opts.tz} : base;
}

function intlLocale(opts?: FormatOptions): string | undefined {
  const raw = opts?.locale;
  if (typeof raw === 'string' && raw.trim().length > 0) {
    return raw;
  }
  return undefined;
}

/** Full date + time: "Apr 4, 2026, 2:30 AM". '—' for nullish/invalid input. */
function formatDateTime(
  iso: string | Date | null | undefined,
  opts?: FormatOptions,
): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  try {
    return d.toLocaleString(
      intlLocale(opts),
      intlOpts(
        {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        },
        opts,
      ),
    );
  } catch {
    return d.toISOString();
  }
}

/** Date only: "Apr 4, 2026". '—' for nullish/invalid input. */
function formatDate(
  iso: string | Date | null | undefined,
  opts?: FormatOptions,
): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  try {
    return d.toLocaleDateString(
      intlLocale(opts),
      intlOpts({year: 'numeric', month: 'short', day: 'numeric'}, opts),
    );
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** Short date: "Apr 4". '—' for nullish/invalid input. */
function formatDateShort(
  iso: string | Date | null | undefined,
  opts?: FormatOptions,
): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  try {
    return d.toLocaleDateString(
      intlLocale(opts),
      intlOpts({month: 'short', day: 'numeric'}, opts),
    );
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** Relative time: "just now", "3m ago", "2h ago", "5d ago", else absolute date. */
function formatRelative(
  iso: string | Date | null | undefined,
  opts?: FormatOptions,
): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  const now = Date.now();
  const diff = now - d.getTime();
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
  return formatDate(iso, opts);
}

/* ------------------------------------------------------------------ */
/*  native FadeIn / StaggerContainer (web @/components/motion, web L18) */
/* ------------------------------------------------------------------ */

function FadeIn({children}: {children: ReactNode; delay?: number}) {
  return <View>{children}</View>;
}

function StaggerContainer({children}: {children: ReactNode}) {
  return <View>{children}</View>;
}

/* ------------------------------------------------------------------ */
/*  native StatCard (web @/components/data-display StatCard, web L16)   */
/* ------------------------------------------------------------------ */

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: string;
}

function StatCard({label, value, icon}: StatCardProps) {
  return (
    <View style={styles.statCard} testID="command-history-stat-card">
      <View style={styles.statCardHeader}>
        <AppText numberOfLines={1} style={styles.statCardLabel}>
          {label}
        </AppText>
        {icon ? (
          <AppText
            importantForAccessibility="no"
            style={styles.statCardIcon}
            tone="muted">
            {icon}
          </AppText>
        ) : null}
      </View>
      <AppText numberOfLines={1} style={styles.statCardValue}>
        {value}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native TabNav (web @/components/ui TabNav, web L14)                 */
/* ------------------------------------------------------------------ */

interface TabItem {
  key: string;
  label: string;
  icon?: string;
}

function TabNav({
  tabs,
  active,
  onChange,
}: {
  tabs: TabItem[];
  active: string;
  onChange: (key: string) => void;
}) {
  return (
    <View accessibilityRole="tablist" style={styles.tabNav}>
      {tabs.map(tab => {
        const selected = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{selected}}
            onPress={() => onChange(tab.key)}
            style={({pressed}) => [
              styles.tab,
              selected && styles.tabActive,
              pressed && !selected && styles.tabPressed,
            ]}
            testID={`command-history-tab-${tab.key}`}>
            {tab.icon ? (
              <AppText
                importantForAccessibility="no"
                style={[styles.tabIcon, selected && styles.tabIconActive]}>
                {tab.icon}
              </AppText>
            ) : null}
            <AppText
              style={[styles.tabLabel, selected && styles.tabLabelActive]}>
              {tab.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native Select — vehicle picker (web @/components/ui Select, web L14)*/
/* ------------------------------------------------------------------ */

interface SelectOption {
  value: string;
  label: string;
}

function VehicleSelect({
  options,
  value,
  onChange,
  label,
}: {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <View
      accessibilityLabel={label}
      accessibilityRole="radiogroup"
      style={styles.vehicleSelect}
      testID="command-history-vehicle-select">
      {options.map(opt => {
        const selected = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            accessibilityLabel={opt.label}
            accessibilityRole="radio"
            accessibilityState={{selected}}
            onPress={() => onChange(opt.value)}
            style={({pressed}) => [
              styles.vehicleChip,
              selected && styles.vehicleChipActive,
              pressed && !selected && styles.vehicleChipPressed,
            ]}
            testID={`command-history-vehicle-${opt.value}`}>
            <AppText
              numberOfLines={1}
              style={[
                styles.vehicleChipText,
                selected && styles.vehicleChipTextActive,
              ]}>
              {opt.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native search Input (web @/components/ui Input, web L14)            */
/* ------------------------------------------------------------------ */

function SearchInput({
  value,
  onChangeText,
  placeholder,
  label,
  pending,
  pendingLabel,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  label: string;
  pending: boolean;
  pendingLabel: string;
}) {
  return (
    <View style={styles.searchWrap}>
      <AppText
        importantForAccessibility="no"
        style={styles.searchIcon}
        tone="muted">
        {ICON_SEARCH}
      </AppText>
      <TextInput
        accessibilityLabel={label}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        style={styles.searchInput}
        testID="command-history-search"
        value={value}
      />
      {pending ? (
        <AppText
          accessibilityLabel={pendingLabel}
          accessibilityRole="text"
          style={styles.searchPending}
          testID="command-history-search-pending"
          tone="accent">
          {'\u2026'}
        </AppText>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native RangePicker (web @/components/forms RangePicker, web L19)    */
/* ------------------------------------------------------------------ */

function RangePicker({
  value,
  onChange,
  triggerTestId,
}: {
  value: RangeValue;
  onChange: (range: RangeValue) => void;
  align?: 'start' | 'end';
  triggerTestId?: string;
}) {
  // The web calendar popover has no native equivalent here; the trigger is a
  // display-only chip showing the active range. `onChange` is retained so the
  // write path stays wired even though the native trigger does not open a picker.
  void onChange;
  const labelText = `${formatDateShort(value.start)} \u2013 ${formatDateShort(
    value.end,
  )}`;
  return (
    <Pressable
      accessibilityRole="button"
      style={styles.rangePicker}
      testID={triggerTestId}>
      <AppText style={styles.rangePickerText} tone="secondary" variant="caption">
        {labelText}
      </AppText>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/*  native back-to-commands link (web react-router Link, web L11/L275)  */
/* ------------------------------------------------------------------ */

function BackToCommandsLink({label}: {label: string}) {
  return (
    <Pressable
      accessibilityHint={`Go to ${COMMANDS_ROUTE}`}
      accessibilityRole="link"
      // Destination COMMANDS_ROUTE is preserved from the web Link; the native
      // navigator shell owns the actual transition, so this page wires no handler.
      style={({pressed}) => [styles.backLink, pressed && styles.backLinkPressed]}
      testID="command-history-back-link">
      <AppText
        importantForAccessibility="no"
        style={styles.backLinkIcon}
        tone="secondary">
        {ICON_GAMEPAD}
      </AppText>
      <AppText style={styles.backLinkText} tone="secondary">
        {label}
      </AppText>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/*  native EmptyState (web @/components/feedback EmptyState, web L17)   */
/* ------------------------------------------------------------------ */

function EmptyState({
  icon,
  message,
  testID,
}: {
  icon?: string;
  message: string;
  testID?: string;
}) {
  return (
    <View style={styles.emptyState} testID={testID}>
      {icon ? (
        <AppText
          importantForAccessibility="no"
          style={styles.emptyStateIcon}
          tone="muted">
          {icon}
        </AppText>
      ) : null}
      <AppText style={styles.emptyStateMessage} tone="muted" variant="caption">
        {message}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native PageContainer (web @/components/layout PageContainer, web L12)*/
/* ------------------------------------------------------------------ */

interface PageContainerProps {
  title: string;
  subtitle?: string;
  loading?: boolean;
  error?: unknown;
  actions?: ReactNode;
  children: ReactNode;
  testID?: string;
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  return 'An unexpected error occurred';
}

function PageContainer({
  title,
  subtitle,
  loading,
  error,
  actions,
  children,
  testID,
}: PageContainerProps) {
  return (
    <ScrollView
      contentContainerStyle={styles.scaffold}
      testID={testID ?? 'command-history-page'}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <AppText style={styles.title} variant="title" weight="bold">
            {title}
          </AppText>
          {subtitle ? (
            <AppText style={styles.subtitle} tone="muted">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {actions ?? null}
      </View>

      {loading ? (
        <View style={styles.loading} testID="command-history-loading">
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : error ? (
        <View style={styles.errorBox} testID="command-history-error">
          <AppText style={styles.errorText} tone="danger" variant="caption">
            {getErrorMessage(error)}
          </AppText>
        </View>
      ) : (
        <View style={styles.body}>{children}</View>
      )}
    </ScrollView>
  );
}

/* ------------------------------------------------------------------ */
/*  Subtitle builder (ported verbatim, web L397-425)                   */
/* ------------------------------------------------------------------ */

function buildSubtitle(cmd: CommandLogEntry): string {
  const parts: string[] = [];

  if (cmd.params && cmd.params !== '{}' && cmd.params !== '') {
    try {
      const parsed = JSON.parse(cmd.params);
      const entries = Object.entries(parsed);
      if (entries.length > 0) {
        parts.push(entries.map(([k, v]) => `${k}: ${v}`).join(', '));
      }
    } catch {
      parts.push(cmd.params);
    }
  }

  if (cmd.error) {
    parts.push(`Error: ${cmd.error}`);
  }

  if (parts.length === 0) {
    parts.push(formatDateTime(cmd.created_at, {tz: 'UTC'}));
  }

  return parts.join(' \u00B7 ');
}

/* ═══════════════════════════════════════════════════════════════════════
   CommandHistoryPage — audit log of all vehicle commands (web L102-393)
   ═══════════════════════════════════════════════════════════════════════ */

export default function CommandHistoryPage() {
  const t = useNativeTranslation();
  usePageTitle(t('commandHistory.title', 'Command History'));

  // Vehicle selection (web reads ?vehicle_id; native uses the shared store).
  const {vehicleId, vehicles, setVehicleId} = useSelectedVehicle();
  const activeVehicleId = vehicleId != null ? String(vehicleId) : undefined;

  // Data
  const {data: commands, isLoading, error} = useCommandHistory(activeVehicleId);
  // Web reads `const allCommands = commands ?? []` inline; native memoises it so
  // the array reference stays stable across renders (otherwise the filtered/stats
  // useMemos would recompute every render — react-hooks/exhaustive-deps).
  const allCommands = useMemo(() => commands ?? [], [commands]);

  // Filters
  const [statusFilter] = useUrlEnum<StatusFilter>('status', STATUS_FILTERS, 'all');
  const [searchQuery, setSearchQuery] = useUrlString('q', '');
  const [page, setPage] = useUrlNumber('page', 1);

  // useUrlBatch — atomically write multiple URL params in one navigation so the
  // status change and page reset don't race (web useUrlState.ts:60-67).
  const setUrl = useUrlBatch();

  // Defer the search query so the input stays responsive while the timeline +
  // stats + pagination chain re-renders at non-urgent priority.
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const isSearchPending = !Object.is(searchQuery, deferredSearchQuery);

  // Reset page when filters change — write both keys atomically.
  const handleStatusChange = (key: string) => {
    setUrl({status: key === 'all' ? null : (key as StatusFilter), page: null});
  };
  // Web's onChange reads e.target.value; native TextInput yields the value
  // directly. Search is fed back through the same input on the very next render,
  // so resetting page independently here is safe (no concurrent multi-key write).
  const handleSearchChange = (next: string) => {
    setSearchQuery(next);
    if (page !== 1) {
      setPage(1);
    }
  };
  // Web's onChange reads e.target.value off the <select>; native yields the value.
  const handleVehicleChange = (next: string) => {
    const n = Number(next);
    if (Number.isFinite(n) && n > 0) {
      setVehicleId(n);
      setUrl({vehicle_id: next, page: null});
    }
  };

  // Filtered commands
  const {start, end, setRange} = useRangeState({
    persistKey: 'command-history.range',
    defaultPresetId: 'all',
  });
  const filtered = useMemo(() => {
    let result = allCommands;
    const startMs = new Date(`${start}T00:00:00`).getTime();
    const endMs = new Date(`${end}T23:59:59.999`).getTime();
    result = result.filter(c => {
      if (!c.created_at) {
        return false;
      }
      const ts = new Date(c.created_at).getTime();
      return ts >= startMs && ts <= endMs;
    });
    if (statusFilter !== 'all') {
      result = result.filter(c => c.status === statusFilter);
    }
    if (deferredSearchQuery.trim()) {
      const q = deferredSearchQuery.toLowerCase();
      result = result.filter(
        c =>
          c.command.toLowerCase().includes(q) ||
          formatCommandName(c.command).toLowerCase().includes(q),
      );
    }
    return result;
  }, [allCommands, start, end, statusFilter, deferredSearchQuery]);

  // Pagination
  const paginatedCommands = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page],
  );

  // Stats (from full history, not filtered)
  const stats = useMemo(() => {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const last24h = allCommands.filter(
      c => now - new Date(c.created_at).getTime() < dayMs,
    );
    const successCount = allCommands.filter(c => c.status === 'success').length;
    const successRate =
      allCommands.length > 0
        ? Math.round((successCount / allCommands.length) * 100)
        : 0;

    // Most used command
    const cmdCounts: Record<string, number> = {};
    for (const c of allCommands) {
      cmdCounts[c.command] = (cmdCounts[c.command] ?? 0) + 1;
    }
    const mostUsed =
      Object.keys(cmdCounts).length > 0
        ? Object.entries(cmdCounts).sort((a, b) => b[1] - a[1])[0][0]
        : null;

    const lastCommand = allCommands.length > 0 ? allCommands[0] : null;

    return {
      total24h: last24h.length,
      successRate,
      mostUsed,
      lastCommand,
    };
  }, [allCommands]);

  // Timeline data
  const timelineItems = useMemo<TimelineItemData[]>(
    () =>
      paginatedCommands.map(cmd => ({
        icon: cmd.status === 'success' ? ICON_CHECK : ICON_X,
        title: formatCommandName(cmd.command),
        subtitle: buildSubtitle(cmd),
        time: formatRelative(cmd.created_at, {tz: 'UTC'}),
        color: cmd.status === 'success' ? '#22c55e' : '#ef4444',
      })),
    [paginatedCommands],
  );

  const statusTabs: TabItem[] = [
    {key: 'all', label: t('commandHistory.filterAll', 'All'), icon: ICON_TERMINAL},
    {
      key: 'success',
      label: t('commandHistory.filterSuccess', 'Success'),
      icon: ICON_CHECK,
    },
    {
      key: 'failed',
      label: t('commandHistory.filterFailed', 'Failed'),
      icon: ICON_X,
    },
  ];

  return (
    <PageContainer
      actions={
        <View style={styles.headerActions}>
          {vehicles.length > 0 ? (
            <VehicleSelect
              label={t('commandHistory.selectVehicle', 'Select vehicle')}
              onChange={handleVehicleChange}
              options={vehicles.map(v => ({
                value: String(v.id),
                label: v.display_name || `Vehicle ${v.id}`,
              }))}
              value={activeVehicleId ?? ''}
            />
          ) : null}
          <RangePicker
            align="end"
            onChange={r => {
              setRange(r);
              if (page !== 1) {
                setPage(1);
              }
            }}
            triggerTestId="command-history-range"
            value={{start, end}}
          />
          <BackToCommandsLink
            label={t('commandHistory.backToCommands', 'Commands')}
          />
        </View>
      }
      error={error ?? undefined}
      loading={isLoading}
      subtitle={t(
        'commandHistory.subtitle',
        'Audit log of all vehicle commands',
      )}
      testID="command-history-page"
      title={t('commandHistory.title', 'Command History')}>
      {/* ── Section 1: Stats ────────────────────────────────────────────── */}
      <FadeIn>
        <View style={styles.statGrid}>
          <View style={styles.statCell}>
            <StatCard
              icon={ICON_TERMINAL}
              label={t('commandHistory.total24h', 'Commands (24h)')}
              value={stats.total24h}
            />
          </View>
          <View style={styles.statCell}>
            <StatCard
              icon={ICON_TRENDING_UP}
              label={t('commandHistory.successRate', 'Success Rate')}
              value={`${stats.successRate}%`}
            />
          </View>
          <View style={styles.statCell}>
            <StatCard
              icon={ICON_AWARD}
              label={t('commandHistory.mostUsed', 'Most Used')}
              value={stats.mostUsed ? formatCommandName(stats.mostUsed) : '—'}
            />
          </View>
          <View style={styles.statCell}>
            <StatCard
              icon={ICON_CLOCK}
              label={t('commandHistory.lastSent', 'Last Sent')}
              value={
                stats.lastCommand
                  ? formatRelative(stats.lastCommand.created_at, {tz: 'UTC'})
                  : '—'
              }
            />
          </View>
        </View>
      </FadeIn>

      {/* ── Section 2: Filters ──────────────────────────────────────────── */}
      <FadeIn delay={0.05}>
        <GlassPanel style={styles.filterPanel}>
          <View style={styles.filterRow}>
            <TabNav
              active={statusFilter}
              onChange={handleStatusChange}
              tabs={statusTabs}
            />
            <SearchInput
              label={t('commandHistory.searchCommands', 'Search commands')}
              onChangeText={handleSearchChange}
              pending={isSearchPending}
              pendingLabel={t('filter.pending', 'Filtering…')}
              placeholder={t(
                'commandHistory.searchPlaceholder',
                'Search commands…',
              )}
              value={searchQuery}
            />
          </View>
        </GlassPanel>
      </FadeIn>

      {/* ── Section 3: Command Timeline ─────────────────────────────────── */}
      <FadeIn delay={0.1}>
        <GlassPanel style={styles.timelinePanel}>
          <View style={styles.timelineHeader}>
            <AppText
              importantForAccessibility="no"
              style={styles.timelineHeaderIcon}
              tone="secondary">
              {ICON_HISTORY}
            </AppText>
            <AppText style={styles.timelineTitle} weight="semibold">
              {t('commandHistory.timelineTitle', 'Command Timeline')}
            </AppText>
            <AppText style={styles.timelineCount} tone="muted">
              {t('commandHistory.showing', '{{count}} commands', {
                count: filtered.length,
              })}
            </AppText>
          </View>

          {filtered.length > 0 ? (
            <StaggerContainer>
              <Timeline items={timelineItems} />
            </StaggerContainer>
          ) : (
            <EmptyState
              icon={ICON_HISTORY}
              message={
                searchQuery || statusFilter !== 'all'
                  ? t(
                      'commandHistory.noFilterResults',
                      'No commands match the current filters',
                    )
                  : t(
                      'commandHistory.noCommands',
                      'No commands have been sent yet',
                    )
              }
              testID="command-history-empty"
            />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── Section 4: Pagination ───────────────────────────────────────── */}
      {filtered.length > PAGE_SIZE ? (
        <FadeIn delay={0.15}>
          <Pagination
            onPageChange={setPage}
            page={page}
            pageSize={PAGE_SIZE}
            total={filtered.length}
          />
        </FadeIn>
      ) : null}
    </PageContainer>
  );
}

const styles = StyleSheet.create({
  backLink: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  backLinkIcon: {
    fontSize: 13,
  },
  backLinkPressed: {
    backgroundColor: colors.surfaceHover,
  },
  backLinkText: {
    fontSize: typography.caption,
  },
  body: {
    gap: spacing.md,
  },
  emptyState: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xl,
  },
  emptyStateIcon: {
    fontSize: 20,
  },
  emptyStateMessage: {
    textAlign: 'center',
  },
  errorBox: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 12,
    borderWidth: 1,
    padding: spacing.md,
  },
  errorText: {
    lineHeight: 18,
  },
  filterPanel: {
    padding: spacing.md,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  header: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  headerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  headerText: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 200,
  },
  loading: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
  },
  rangePicker: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  rangePickerText: {
    fontSize: typography.caption,
  },
  scaffold: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  searchIcon: {
    fontSize: 13,
  },
  searchInput: {
    color: colors.textSecondary,
    flex: 1,
    fontSize: typography.caption,
    paddingVertical: spacing.xs,
  },
  searchPending: {
    fontSize: 14,
  },
  searchWrap: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    minWidth: 200,
    paddingHorizontal: spacing.sm,
  },
  statCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 12,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  statCardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statCardIcon: {
    fontSize: 14,
  },
  statCardLabel: {
    color: colors.textMuted,
    flexShrink: 1,
    fontSize: typography.caption,
    fontWeight: '500',
  },
  statCardValue: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  statCell: {
    width: '48%',
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  subtitle: {
    fontSize: typography.caption,
    lineHeight: 18,
  },
  tab: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  tabActive: {
    backgroundColor: colors.accentSoft,
  },
  tabIcon: {
    color: colors.textMuted,
    fontSize: 12,
  },
  tabIconActive: {
    color: colors.accent,
  },
  tabLabel: {
    color: colors.textSecondary,
    fontSize: typography.caption,
    fontWeight: '500',
  },
  tabLabelActive: {
    color: colors.textPrimary,
  },
  tabNav: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  tabPressed: {
    backgroundColor: colors.surfaceHover,
  },
  timelineCount: {
    fontSize: typography.caption,
    marginLeft: 'auto',
  },
  timelineHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  timelineHeaderIcon: {
    fontSize: 14,
  },
  timelinePanel: {
    padding: spacing.lg,
  },
  timelineTitle: {
    color: colors.textPrimary,
    fontSize: typography.body,
  },
  title: {
    color: colors.textPrimary,
  },
  vehicleChip: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    maxWidth: 160,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  vehicleChipActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  vehicleChipPressed: {
    backgroundColor: colors.surfaceHover,
  },
  vehicleChipText: {
    color: colors.textSecondary,
    fontSize: typography.caption,
  },
  vehicleChipTextActive: {
    color: colors.textPrimary,
  },
  vehicleSelect: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
});
