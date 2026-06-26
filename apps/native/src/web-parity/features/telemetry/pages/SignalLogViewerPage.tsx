// Native parity port of web/src/features/telemetry/pages/SignalLogViewerPage.tsx.
//
// SignalLogViewerPage — query signal history from Postgres. Every behaviour of
// the web page is preserved one-for-one:
//   - State names + defaults: vehicleId (useSelectedVehicle, ?? 0), availableSignals
//     (useSignals(vehicleId)), selectedSignals/setSelectedSignals (useUrlArray
//     ('signals')), start/end/setRange (useRangeState({ persistKey:'signal-log.range',
//     defaultPresetId:'today' })), perPage (useState 50), page (useState 1),
//     queryKey (useState<number|null>(null)).
//   - canQuery = selectedSignals.length>0 && !!start && !!end && vehicleId>0.
//   - handleQuery (useCallback [canQuery]): if !canQuery return; setPage(1);
//     setQueryKey(Date.now()).
//   - fromIso/toIso useMemos: start ? new Date(`${start}T00:00:00`).toISOString() : '';
//     end ? new Date(`${end}T23:59:59.999`).toISOString() : ''.
//   - useQuery<SignalLogEntry[]>(['signal-log', vehicleId, queryKey]): Promise.all
//     over selectedSignals -> request('/signals/{vehicleId}/{sig}/history?from=&to=
//     &limit={perPage*10}') -> flatMap(adaptSignalHistoryResp) -> sort created_at
//     desc; enabled: queryKey !== null. anyError/totalRecords/rows(slice)/hasQueried
//     derived exactly as web.
//   - Section order: header (title 'Signal Log Viewer' + subtitle 'Query signal
//     history from Postgres' + VehicleSelect actions) -> error AlertBanner ->
//     vehicleId===0 EmptyState -> controls GlassPanel (SignalSelector + Time Range
//     RangePicker + Per Page Select + Query Button + records count) -> !hasQueried
//     EmptyState OR SignalHistoryTable.
//   - Every i18n key keeps its English default string (intent preserved). SI stays
//     on the wire — this page does no unit conversion (raw signal values), so there
//     is no display-boundary conversion to apply (Phase-48 SI-cutover: nothing to do).
//
// Web dependencies absent from the native parity manifest are remapped to
// native-safe equivalents (contract rules 4, 5 & 7) and documented in the sidecar:
//   - react-i18next useTranslation -> inlined useNativeTranslation(): a stable
//     (key, fallback?, options?) shim returning the English fallback (or the key)
//     and reproducing i18next `{{name}}` interpolation.
//   - lucide-react Database/AlertCircle/Activity/Search -> SemanticIcon glyphs
//     database/alertCircle/activity/search (lucide SVG has no native renderer).
//   - @/components/layout PageContainer -> inline native PageContainer (title +
//     subtitle + always-visible actions + children). The web `copyLink` affordance
//     (copy the page URL) has no native analogue (no address bar) and is inert.
//   - @/components/ui GlassPanel -> the shared native GlassPanel; Button -> inline
//     PrimaryButton (icon + label + loading ActivityIndicator + disabled); Select ->
//     inline NativeSelect (Pressable trigger + Modal option list, the proven
//     VehicleSelect pattern).
//   - @/components/feedback EmptyState -> inline native EmptyState (optional icon +
//     title + message); AlertBanner -> inline native AlertBanner (danger surface +
//     icon + message).
//   - @/components/forms RangePicker -> the shared native DatePresetChips (the web
//     calendar picker has no native analogue; presetIds map 1:1, value={{start,end}}
//     +onChange=setRange map to activeId=presetId+onSelect, triggerTestId 'signal-
//     log-range' -> testID); VehicleSelect -> an inline native picker backed by a
//     shared module-level selected-vehicle store, paired with an inline
//     useSelectedVehicle, so the web read(useSelectedVehicle)+write(VehicleSelect)
//     shared-store coupling is preserved on native.
//   - @/hooks usePageTitle -> feature-detects document.title; useUrlArray ->
//     useState-backed [string[], setter] (URL query sync dropped — no address bar);
//     useRangeState -> native-safe shim (localStorage feature-detected; precedence
//     localStorage > defaultPresetId > today; URL sync dropped); useSelectedVehicle
//     -> inline shared-store hook.
//   - @/api/client request + @/api/hooks/useTelemetry useSignals + @/api/types
//     SignalHistoryResp/SignalHistoryPoint -> the ported native modules (identical
//     '/signals/...' paths, query keys, snake_case params, and response shapes).
//   - @/components/SignalQueryControls adaptSignalHistoryResp/formatValue/
//     SignalLogEntry -> ported verbatim below (the BE typed {ts,kind,value} ->
//     legacy {created_at,value_num/str/bool} adapter is logic-identical).
//   - @/lib/errorMessage getErrorMessage + @/lib/colors CHART_COLORS -> ported
//     (CHART_COLORS imported from the native chartUtils, the same CB-safe palette).
//   - ../components/SignalSelector + ../components/SignalHistoryTable (feature
//     siblings, not yet ported as standalone native files) -> inlined native
//     equivalents: SignalSelector becomes a searchable add/remove multi-select
//     (the web ComboboxMulti), SignalHistoryTable becomes a GlassPanel list with
//     color-coded signals, type badges, row JSON expansion, a loading skeleton, an
//     empty state, and prev/next pagination (the web DataTable + Pagination).
//
// No DOM-only modules, HTML elements, react-i18next, lucide-react, Recharts, or
// Leaflet are imported — only react, react-native primitives, the shared native
// SemanticIcon / AppText / GlassPanel / theme tokens, and the ported parity
// request / useSignals / useVehicles / types / DatePresetChips / datePresets /
// CHART_COLORS.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import {useQuery} from '@tanstack/react-query';

import {
  SemanticIcon,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, shadows, spacing} from '../../../../theme/tokens';

import {request} from '../../../api/client';
import {useSignals} from '../../../api/hooks/useTelemetry';
import {useVehicles} from '../../../api/hooks/useVehicles';
import type {SignalHistoryPoint, SignalHistoryResp} from '../../../api/types';
import {CHART_COLORS} from '../../../components/charts/chartUtils';
import {
  DatePresetChips,
  type DatePresetSelection,
} from '../../../components/forms/DatePresetChips';
import {
  DATE_PRESETS,
  getDatePreset,
  matchPresetId,
  resolveAllTimeStart,
} from '../../../lib/datePresets';

const MONO = Platform.select({ios: 'Courier', default: 'monospace'});

const PER_PAGE_OPTIONS = [
  {value: '25', label: '25'},
  {value: '50', label: '50'},
  {value: '100', label: '100'},
  {value: '500', label: '500'},
];

const RANGE_PRESET_IDS = ['today', 'yesterday', '7d', '30d', '90d', 'all'];

/* ── react-i18next useTranslation replacement ──────────── */

type NativeTOptions = Record<string, string | number>;
type NativeTFunction = (
  key: string,
  fallback?: string,
  options?: NativeTOptions,
) => string;

function interpolate(text: string, options: NativeTOptions): string {
  return Object.keys(options).reduce(
    (acc, name) => acc.split(`{{${name}}}`).join(String(options[name])),
    text,
  );
}

function useNativeTranslation(): NativeTFunction {
  return useCallback(
    (key: string, fallback?: string, options?: NativeTOptions) => {
      const base = fallback ?? key;
      return options ? interpolate(base, options) : base;
    },
    [],
  );
}

/* ── usePageTitle shim (web @/hooks/usePageTitle) ──────── */

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

/* ── getErrorMessage (web @/lib/errorMessage) ──────────── */

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  return 'An unexpected error occurred';
}

/* ── Number / date helpers ─────────────────────────────── */

// web @/lib/numberFormat fmtInt — group with thousands separators.
function fmtInt(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// web @/hooks/useDateFormat formatDateTime — locale date + time, '—' on invalid.
function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/* ── SignalQueryControls adapters (web @/components/SignalQueryControls) ── */

interface SignalLogEntry {
  created_at: string;
  signal: string;
  value_num?: number | null;
  value_str?: string | null;
  value_bool?: boolean | null;
}

function adaptSignalHistoryPoint(
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
      entry.value_str = point.value;
      break;
    default:
      break;
  }
  return entry;
}

function adaptSignalHistoryResp(
  resp: SignalHistoryResp | null | undefined,
): SignalLogEntry[] {
  if (!resp || !Array.isArray(resp.data)) {
    return [];
  }
  const signal = resp.signal ?? '';
  return resp.data.map(p => adaptSignalHistoryPoint(p, signal));
}

function formatValue(entry: SignalLogEntry): string {
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

type ValueType = 'number' | 'string' | 'boolean';

function valueType(row: SignalLogEntry): ValueType {
  if (row.value_num !== null && row.value_num !== undefined) {
    return 'number';
  }
  if (row.value_bool !== null && row.value_bool !== undefined) {
    return 'boolean';
  }
  return 'string';
}

/* ── useUrlArray shim (web @/hooks/useUrlState useUrlArray) ── */
// Native has no address bar, so the array lives in component state instead of
// the URL query string. The [value, setter] tuple is the same shape the page
// consumes (onChange={setSelectedSignals}); the `key` is accepted but inert.

function useUrlArray(
  _key: string,
  defaultValue: readonly string[] = [],
): [string[], React.Dispatch<React.SetStateAction<string[]>>] {
  return useState<string[]>(() => [...defaultValue]);
}

/* ── Native-safe shared selected-vehicle store ─────────── */
// Native analogue of web store/selectedVehicle (Context + localStorage). RN has
// no localStorage and the parity tree pulls in no router, so the store is a lean
// module-level external store shared between this page's inline VehicleSelect
// (write) and useSelectedVehicle (read). Selection lives for the app session.

let selectedVehicleId: number | null = null;
const selectionListeners = new Set<() => void>();

function setSelectedVehicleId(id: number | null): void {
  const next = id != null && Number.isFinite(id) && id > 0 ? id : null;
  if (next === selectedVehicleId) {
    return;
  }
  selectedVehicleId = next;
  selectionListeners.forEach(listener => listener());
}

function subscribeSelection(listener: () => void): () => void {
  selectionListeners.add(listener);
  return () => {
    selectionListeners.delete(listener);
  };
}

function getSelectionSnapshot(): number | null {
  return selectedVehicleId;
}

function useSelectedVehicle() {
  const {data} = useVehicles();
  const vehicles = data ?? [];

  const stored = useSyncExternalStore(
    subscribeSelection,
    getSelectionSnapshot,
    getSelectionSnapshot,
  );

  // Default to the first vehicle the moment the fleet loads (web parity).
  const firstVehicleId = vehicles.length > 0 ? vehicles[0].id : null;
  useEffect(() => {
    if (stored == null && firstVehicleId != null) {
      setSelectedVehicleId(firstVehicleId);
    }
  }, [stored, firstVehicleId]);

  const effectiveId = stored ?? firstVehicleId;

  return {vehicleId: effectiveId, vehicles, setVehicleId: setSelectedVehicleId};
}

/* ── VehicleSelect (web @/components/forms VehicleSelect) ── */

function VehicleSelect() {
  const t = useNativeTranslation();
  const {vehicleId, vehicles, setVehicleId} = useSelectedVehicle();
  const [open, setOpen] = useState(false);

  if (vehicles.length === 0) {
    return null;
  }

  const options = vehicles.map(v => ({
    value: String(v.id),
    label: v.display_name || v.vin || `Vehicle ${v.id}`,
  }));

  const currentValue = vehicleId != null ? String(vehicleId) : '';
  const selectedOption = options.find(o => o.value === currentValue);
  const label = t('vehicleSelect.aria', 'Select vehicle');

  return (
    <>
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityState={{expanded: open}}
        onPress={() => setOpen(true)}
        style={({pressed}) => [
          styles.vsTrigger,
          pressed && styles.pressedDim,
        ]}
        testID="vehicle-select">
        <AppText numberOfLines={1} style={styles.vsTriggerLabel}>
          {selectedOption?.label ?? label}
        </AppText>
        <AppText
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.chevron}>
          ⌄
        </AppText>
      </Pressable>

      <Modal
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        transparent
        visible={open}>
        <Pressable style={styles.modalOverlay} onPress={() => setOpen(false)}>
          <Pressable style={styles.modalMenu} onPress={() => undefined}>
            <ScrollView style={styles.modalList}>
              {options.map(opt => {
                const selected = opt.value === currentValue;
                return (
                  <Pressable
                    key={opt.value}
                    accessibilityLabel={opt.label}
                    accessibilityRole="button"
                    accessibilityState={{selected}}
                    onPress={() => {
                      const next = Number(opt.value);
                      setVehicleId(
                        Number.isFinite(next) && next > 0 ? next : null,
                      );
                      setOpen(false);
                    }}
                    style={({pressed}) => [
                      styles.modalOption,
                      selected && styles.modalOptionSelected,
                      pressed && styles.modalOptionPressed,
                    ]}
                    testID={`vehicle-select-option-${opt.value}`}>
                    <AppText
                      numberOfLines={1}
                      style={[
                        styles.modalOptionLabel,
                        selected && styles.modalOptionLabelSelected,
                      ]}
                      weight={selected ? 'semibold' : 'regular'}>
                      {opt.label}
                    </AppText>
                    {selected ? (
                      <AppText style={styles.modalCheck}>✓</AppText>
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

/* ── useRangeState shim (web @/hooks/useRangeState) ─────── */

interface RangeValue {
  start: string;
  end: string;
}

interface UseRangeStateOptions {
  defaultPresetId?: string;
  persistKey?: string;
  minDate?: string;
}

interface LocalStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function getLocalStorage(): LocalStorageLike | null {
  const ls = (globalThis as {localStorage?: LocalStorageLike}).localStorage;
  if (
    ls &&
    typeof ls.getItem === 'function' &&
    typeof ls.setItem === 'function'
  ) {
    return ls;
  }
  return null;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidIsoDate(s: string | null | undefined): s is string {
  if (!s || !ISO_DATE_RE.test(s)) {
    return false;
  }
  const parsed = Date.parse(`${s}T00:00:00`);
  return !Number.isNaN(parsed);
}

function clampToMin(date: string, minDate: string | undefined): string {
  if (!minDate) {
    return date;
  }
  return date < minDate ? minDate : date;
}

function loadFromStorage(persistKey: string | undefined): RangeValue | null {
  if (!persistKey) {
    return null;
  }
  const ls = getLocalStorage();
  if (!ls) {
    return null;
  }
  try {
    const raw = ls.getItem(persistKey);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<RangeValue> | null;
    if (
      !parsed ||
      !isValidIsoDate(parsed.start) ||
      !isValidIsoDate(parsed.end)
    ) {
      return null;
    }
    if (parsed.start > parsed.end) {
      return null;
    }
    return {start: parsed.start, end: parsed.end};
  } catch {
    return null;
  }
}

function saveToStorage(persistKey: string | undefined, value: RangeValue) {
  if (!persistKey) {
    return;
  }
  const ls = getLocalStorage();
  if (!ls) {
    return;
  }
  try {
    ls.setItem(persistKey, JSON.stringify(value));
  } catch {
    /* storage full / disabled — silently ignore */
  }
}

interface UseRangeStateReturn {
  start: string;
  end: string;
  presetId: string | undefined;
  setRange: (range: RangeValue) => void;
}

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
    const stored = loadFromStorage(persistKey);
    if (!stored) {
      return fallback;
    }
    return {
      start: clampToMin(stored.start, minDate),
      end: clampToMin(stored.end, minDate),
    };
  });

  useEffect(() => {
    saveToStorage(persistKey, range);
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

/* ── FadeIn (web @/components/motion FadeIn) ───────────── */

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

/* ── PageContainer (web @/components/layout PageContainer) ── */

interface PageContainerProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  /** Web copy-page-URL affordance — inert on native (no address bar). */
  copyLink?: boolean;
  children: ReactNode;
}

function PageContainer({title, subtitle, actions, children}: PageContainerProps) {
  return (
    <ScrollView
      contentContainerStyle={styles.pageContent}
      keyboardShouldPersistTaps="handled"
      style={styles.page}>
      <View style={styles.pageHeader}>
        <View style={styles.pageTitleBlock}>
          <AppText variant="title" weight="bold">
            {title}
          </AppText>
          {subtitle ? (
            <AppText style={styles.pageSubtitle} tone="muted" variant="caption">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {actions ? <View style={styles.pageActions}>{actions}</View> : null}
      </View>
      {children}
    </ScrollView>
  );
}

/* ── AlertBanner (web @/components/feedback AlertBanner) ── */

function AlertBanner({
  icon,
  children,
}: {
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <View accessibilityRole="alert" style={styles.alertBanner}>
      {icon ? <View style={styles.alertIcon}>{icon}</View> : null}
      <AppText style={styles.alertText} tone="danger" variant="caption">
        {children}
      </AppText>
    </View>
  );
}

/* ── EmptyState (web @/components/feedback EmptyState) ──── */

function EmptyState({
  icon,
  title,
  message,
}: {
  icon?: SemanticIconName;
  title: string;
  message?: string;
}) {
  return (
    <View accessibilityRole="summary" style={styles.emptyRoot}>
      {icon ? (
        <SemanticIcon
          decorative
          name={icon}
          size="lg"
          style={styles.emptyIcon}
        />
      ) : null}
      <AppText style={styles.emptyTitle} weight="semibold">
        {title}
      </AppText>
      {message ? (
        <AppText style={styles.emptyMessage} tone="muted" variant="caption">
          {message}
        </AppText>
      ) : null}
    </View>
  );
}

/* ── HelpTooltip (web @/components/ui HelpTooltip) ──────── */
// Native has no hover surface; the help icon toggles an inline bubble and also
// carries the help body as its accessibilityLabel so assistive tech reads it.

function HelpTooltip({body, ariaLabel}: {body: string; ariaLabel: string}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.helpRoot}>
      <Pressable
        accessibilityLabel={`${ariaLabel}. ${body}`}
        accessibilityRole="button"
        hitSlop={6}
        onPress={() => setOpen(o => !o)}>
        <SemanticIcon decorative name="helpCircle" size="sm" />
      </Pressable>
      {open ? (
        <View style={styles.helpBubble}>
          <AppText style={styles.helpBubbleText} tone="secondary" variant="caption">
            {body}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

/* ── Type Badge (web @/components/ui Badge) ────────────── */

const BADGE_TONE: Record<ValueType, {bg: string; border: string; fg: string}> = {
  number: {bg: colors.accentSoft, border: colors.borderAccent, fg: colors.accent},
  string: {
    bg: colors.successSurface,
    border: colors.successBorder,
    fg: colors.success,
  },
  boolean: {
    bg: colors.warningSurface,
    border: colors.warningBorder,
    fg: colors.warning,
  },
};

function TypeBadge({type}: {type: ValueType}) {
  const tone = BADGE_TONE[type];
  return (
    <View
      style={[styles.badge, {backgroundColor: tone.bg, borderColor: tone.border}]}>
      <AppText style={[styles.badgeText, {color: tone.fg}]} weight="semibold">
        {type}
      </AppText>
    </View>
  );
}

/* ── PrimaryButton (web @/components/ui Button) ────────── */

function PrimaryButton({
  label,
  icon,
  onPress,
  disabled = false,
  loading = false,
}: {
  label: string;
  icon?: ReactNode;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{disabled: isDisabled, busy: loading}}
      disabled={isDisabled}
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        isDisabled && styles.buttonDisabled,
        pressed && !isDisabled && styles.pressedDim,
      ]}
      testID="signal-log-query">
      {loading ? (
        <ActivityIndicator color={colors.background} size="small" />
      ) : icon ? (
        <View style={styles.buttonIcon}>{icon}</View>
      ) : null}
      <AppText style={styles.buttonLabel} weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

/* ── NativeSelect (web @/components/ui Select) ─────────── */

interface SelectOption {
  value: string;
  label: string;
}

function NativeSelect({
  label,
  value,
  options,
  onValueChange,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onValueChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find(o => o.value === value);
  return (
    <View style={styles.selectRoot}>
      <AppText style={styles.fieldLabel} tone="muted" variant="caption">
        {label}
      </AppText>
      <Pressable
        accessibilityLabel={label}
        accessibilityRole="button"
        accessibilityState={{expanded: open}}
        onPress={() => setOpen(true)}
        style={({pressed}) => [styles.selectTrigger, pressed && styles.pressedDim]}
        testID="signal-log-per-page">
        <AppText style={styles.selectValue}>{selected?.label ?? value}</AppText>
        <AppText
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.chevron}>
          ⌄
        </AppText>
      </Pressable>

      <Modal
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        transparent
        visible={open}>
        <Pressable style={styles.modalOverlay} onPress={() => setOpen(false)}>
          <Pressable style={styles.modalMenu} onPress={() => undefined}>
            <ScrollView style={styles.modalList}>
              {options.map(opt => {
                const isSelected = opt.value === value;
                return (
                  <Pressable
                    key={opt.value}
                    accessibilityLabel={opt.label}
                    accessibilityRole="button"
                    accessibilityState={{selected: isSelected}}
                    onPress={() => {
                      onValueChange(opt.value);
                      setOpen(false);
                    }}
                    style={({pressed}) => [
                      styles.modalOption,
                      isSelected && styles.modalOptionSelected,
                      pressed && styles.modalOptionPressed,
                    ]}
                    testID={`signal-log-per-page-option-${opt.value}`}>
                    <AppText
                      style={[
                        styles.modalOptionLabel,
                        isSelected && styles.modalOptionLabelSelected,
                      ]}
                      weight={isSelected ? 'semibold' : 'regular'}>
                      {opt.label}
                    </AppText>
                    {isSelected ? (
                      <AppText style={styles.modalCheck}>✓</AppText>
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

/* ── SignalSelector (web ../components/SignalSelector) ── */

const SIGNAL_OPTION_CAP = 50;

interface SignalSelectorProps {
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
  /** Hard cap. `null` for no cap (web default 5). */
  max?: number | null;
  showLayerHelp?: boolean;
  labelOverride?: string;
}

function SignalSelector({
  options,
  value,
  onChange,
  max = 5,
  showLayerHelp = true,
  labelOverride,
}: SignalSelectorProps) {
  const t = useNativeTranslation();
  const [search, setSearch] = useState('');
  const cap = max ?? Number.POSITIVE_INFINITY;

  const label =
    labelOverride ??
    (max != null
      ? `${t('Signals')} (${value.length} / ${max})`
      : `${t('Signals')} (${value.length})`);

  const query = search.trim().toLowerCase();
  const filtered = options.filter(
    s => !value.includes(s) && (query ? s.toLowerCase().includes(query) : true),
  );
  const atCap = Number.isFinite(cap) && value.length >= cap;

  const addSignal = (sig: string) => {
    if (atCap) {
      return;
    }
    onChange([...value, sig]);
    setSearch('');
  };

  const removeSignal = (sig: string) => {
    onChange(value.filter(s => s !== sig));
  };

  return (
    <View style={styles.fullWidth}>
      <View style={styles.signalLabelRow}>
        <AppText style={styles.fieldLabel} tone="muted" variant="caption">
          {label}
        </AppText>
        {showLayerHelp ? (
          <HelpTooltip
            ariaLabel={t(
              'help.signal.layers.aria',
              'More info about signal layers (L1, L2, log)',
            )}
            body={t(
              'help.signal.layers',
              'TeslaSync exposes three live-state layers: L1 (in-process), L2 (Redis shared), and log (TimescaleDB history).',
            )}
          />
        ) : null}
      </View>

      {value.length > 0 ? (
        <View style={styles.chipWrap}>
          {value.map(sig => (
            <View key={sig} style={styles.signalChip}>
              <AppText style={styles.signalChipText} weight="semibold">
                {sig}
              </AppText>
              <Pressable
                accessibilityLabel={`Remove ${sig}`}
                accessibilityRole="button"
                hitSlop={6}
                onPress={() => removeSignal(sig)}>
                <AppText style={styles.signalChipRemove}>✕</AppText>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.searchRow}>
        <SemanticIcon decorative name="search" size="sm" style={styles.searchIcon} />
        <TextInput
          accessibilityLabel={t('Signals')}
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setSearch}
          placeholder={
            value.length ? t('Add more signals…') : t('Search signals…')
          }
          placeholderTextColor={colors.textMuted}
          style={styles.searchInput}
          value={search}
        />
      </View>

      {query && filtered.length > 0 ? (
        <View style={styles.optionList}>
          {filtered.slice(0, SIGNAL_OPTION_CAP).map(sig => (
            <Pressable
              key={sig}
              accessibilityLabel={sig}
              accessibilityRole="button"
              disabled={atCap}
              onPress={() => addSignal(sig)}
              style={({pressed}) => [
                styles.optionItem,
                pressed && styles.modalOptionPressed,
                atCap && styles.optionDisabled,
              ]}>
              <AppText style={styles.optionItemText}>{sig}</AppText>
            </Pressable>
          ))}
          {filtered.length > SIGNAL_OPTION_CAP ? (
            <AppText style={styles.optionMore} tone="muted" variant="caption">
              {`${filtered.length - SIGNAL_OPTION_CAP} more — refine search`}
            </AppText>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/* ── Pagination (web @/components/ui Pagination) ───────── */

function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const t = useNativeTranslation();
  const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  if (totalPages <= 1) {
    return null;
  }
  const atStart = page <= 1;
  const atEnd = page >= totalPages;
  return (
    <View style={styles.pagination}>
      <AppText style={styles.paginationMeta} tone="muted" variant="caption">
        {`${fmtInt(total)} ${t('records')}`}
      </AppText>
      <View style={styles.paginationControls}>
        <Pressable
          accessibilityLabel={t('Previous')}
          accessibilityRole="button"
          accessibilityState={{disabled: atStart}}
          disabled={atStart}
          onPress={() => onPageChange(page - 1)}
          style={({pressed}) => [
            styles.pageButton,
            atStart && styles.pageButtonDisabled,
            pressed && !atStart && styles.pressedDim,
          ]}>
          <AppText style={styles.pageButtonText} weight="semibold">
            ‹
          </AppText>
        </Pressable>
        <AppText style={styles.paginationLabel} tone="secondary" variant="caption">
          {`${t('Page')} ${page} ${t('of')} ${totalPages}`}
        </AppText>
        <Pressable
          accessibilityLabel={t('Next')}
          accessibilityRole="button"
          accessibilityState={{disabled: atEnd}}
          disabled={atEnd}
          onPress={() => onPageChange(page + 1)}
          style={({pressed}) => [
            styles.pageButton,
            atEnd && styles.pageButtonDisabled,
            pressed && !atEnd && styles.pressedDim,
          ]}>
          <AppText style={styles.pageButtonText} weight="semibold">
            ›
          </AppText>
        </Pressable>
      </View>
    </View>
  );
}

/* ── SignalHistoryTable (web ../components/SignalHistoryTable) ── */

interface SignalHistoryTableProps {
  rows: SignalLogEntry[];
  selectedSignals: string[];
  page: number;
  pageSize: number;
  totalRows: number;
  onPageChange: (page: number) => void;
  loading?: boolean;
  title?: string;
  showHeaderMeta?: boolean;
  expandable?: boolean;
}

function SignalHistoryTable({
  rows,
  selectedSignals,
  page,
  pageSize,
  totalRows,
  onPageChange,
  loading = false,
  title,
  showHeaderMeta = true,
  expandable = true,
}: SignalHistoryTableProps) {
  const t = useNativeTranslation();
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);

  const toggleExpanded = (key: string) => {
    setExpandedKeys(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key],
    );
  };

  return (
    <FadeIn>
      <GlassPanel style={styles.tablePanel}>
        <View style={styles.tableHeader}>
          <SemanticIcon decorative name="activity" size="sm" />
          <AppText style={styles.tableTitle} weight="semibold">
            {title ?? t('Signal Data')}
          </AppText>
          {showHeaderMeta ? (
            <AppText style={styles.tableMeta} tone="muted" variant="caption">
              {`${t('Page')} ${page} · ${fmtInt(totalRows)} ${t('total')}`}
            </AppText>
          ) : null}
        </View>

        {loading ? (
          <View style={styles.skeletonWrap}>
            {[1, 2, 3, 4, 5].map(i => (
              <View key={i} style={styles.skeletonRow} />
            ))}
          </View>
        ) : rows.length > 0 ? (
          <>
            <View>
              {rows.map(r => {
                const key = `${r.created_at}-${r.signal}`;
                const idx = selectedSignals.indexOf(r.signal);
                const color =
                  idx >= 0 ? CHART_COLORS[idx % CHART_COLORS.length] : undefined;
                const vt = valueType(r);
                const expanded = expandable && expandedKeys.includes(key);
                return (
                  <View key={key} style={styles.tableRowGroup}>
                    <Pressable
                      accessibilityRole={expandable ? 'button' : undefined}
                      accessibilityState={
                        expandable ? {expanded} : undefined
                      }
                      disabled={!expandable}
                      onPress={
                        expandable ? () => toggleExpanded(key) : undefined
                      }
                      style={({pressed}) => [
                        styles.tableRow,
                        pressed && expandable && styles.modalOptionPressed,
                      ]}>
                      <AppText
                        numberOfLines={1}
                        style={styles.cellTime}
                        tone="muted"
                        variant="caption">
                        {formatDateTime(r.created_at)}
                      </AppText>
                      <View style={styles.cellSignal}>
                        {color ? (
                          <View
                            style={[styles.signalDot, {backgroundColor: color}]}
                          />
                        ) : null}
                        <AppText
                          numberOfLines={1}
                          style={[
                            styles.cellSignalText,
                            color ? {color} : undefined,
                          ]}>
                          {r.signal}
                        </AppText>
                      </View>
                      <AppText
                        numberOfLines={1}
                        style={styles.cellValue}>
                        {formatValue(r)}
                      </AppText>
                      <TypeBadge type={vt} />
                    </Pressable>
                    {expanded ? (
                      <View style={styles.expandedBox}>
                        <AppText style={styles.expandedJson}>
                          {JSON.stringify(r, null, 2)}
                        </AppText>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
            <Pagination
              onPageChange={onPageChange}
              page={page}
              pageSize={pageSize}
              total={totalRows}
            />
          </>
        ) : (
          <EmptyState
            icon="activity"
            message={t('No signal data found for this query.')}
            title={t('No data')}
          />
        )}
      </GlassPanel>
    </FadeIn>
  );
}

/* ── SignalLogViewerPage ───────────────────────────────── */

export default function SignalLogViewerPage() {
  const t = useNativeTranslation();
  usePageTitle(t('Signal Log'));

  const {vehicleId: storeVehicleId} = useSelectedVehicle();
  const vehicleId = storeVehicleId ?? 0;

  const {data: availableSignals} = useSignals(vehicleId);
  const [selectedSignals, setSelectedSignals] = useUrlArray('signals');

  const {start, end, presetId, setRange} = useRangeState({
    persistKey: 'signal-log.range',
    defaultPresetId: 'today',
  });

  const [perPage, setPerPage] = useState(50);
  const [page, setPage] = useState(1);
  const [queryKey, setQueryKey] = useState<number | null>(null);

  const canQuery =
    selectedSignals.length > 0 && !!start && !!end && vehicleId > 0;

  const handleQuery = useCallback(() => {
    if (!canQuery) {
      return;
    }
    setPage(1);
    setQueryKey(Date.now());
  }, [canQuery]);

  const fromIso = useMemo(
    () => (start ? new Date(`${start}T00:00:00`).toISOString() : ''),
    [start],
  );
  const toIso = useMemo(
    () => (end ? new Date(`${end}T23:59:59.999`).toISOString() : ''),
    [end],
  );

  const {
    data: allRows,
    isLoading,
    isFetching,
    error: dataError,
  } = useQuery<SignalLogEntry[]>({
    queryKey: ['signal-log', vehicleId, queryKey],
    queryFn: async () => {
      const results = await Promise.all(
        selectedSignals.map(sig =>
          request<SignalHistoryResp>(
            `/signals/${vehicleId}/${sig}/history?from=${fromIso}&to=${toIso}&limit=${perPage * 10}`,
          ),
        ),
      );
      return results
        .flatMap(resp => adaptSignalHistoryResp(resp))
        .sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        );
    },
    enabled: queryKey !== null,
  });

  const anyError = dataError as Error | undefined;
  const totalRecords = (allRows ?? []).length;
  const rows = useMemo(() => {
    const startIdx = (page - 1) * perPage;
    return (allRows ?? []).slice(startIdx, startIdx + perPage);
  }, [allRows, page, perPage]);
  const hasQueried = queryKey !== null;

  return (
    <PageContainer
      actions={<VehicleSelect />}
      copyLink
      subtitle={t('Query signal history from Postgres')}
      title={t('Signal Log Viewer')}>
      {anyError ? (
        <AlertBanner
          icon={<SemanticIcon decorative name="alertCircle" size="sm" />}>
          {`${t('error.loadFailed', 'Failed to load data')}: ${getErrorMessage(
            anyError,
          )}`}
        </AlertBanner>
      ) : null}

      {vehicleId === 0 ? (
        <EmptyState
          icon="activity"
          message={t(
            'signalLog.noVehicleDesc',
            'Pick a vehicle from the picker above to query its signal history.',
          )}
          title={t('signalLog.noVehicle', 'Select a vehicle to begin')}
        />
      ) : (
        <>
          <GlassPanel style={styles.controlsPanel}>
            <SignalSelector
              max={null}
              onChange={setSelectedSignals}
              options={availableSignals ?? []}
              value={selectedSignals}
            />

            <View style={styles.controlsRow}>
              <View style={styles.rangeBlock}>
                <AppText style={styles.fieldLabel} tone="muted" variant="caption">
                  {t('Time Range')}
                </AppText>
                <DatePresetChips
                  activeId={presetId}
                  onSelect={(sel: DatePresetSelection) =>
                    setRange({start: sel.start, end: sel.end})
                  }
                  presetIds={RANGE_PRESET_IDS}
                  testID="signal-log-range"
                />
              </View>

              <View style={styles.actionsBlock}>
                <NativeSelect
                  label={t('Per Page')}
                  onValueChange={v => {
                    setPerPage(Number(v));
                    setPage(1);
                  }}
                  options={PER_PAGE_OPTIONS}
                  value={String(perPage)}
                />
                <PrimaryButton
                  disabled={!canQuery}
                  icon={<SemanticIcon decorative name="database" size="sm" />}
                  label={t('Query')}
                  loading={isFetching}
                  onPress={handleQuery}
                />
                {hasQueried ? (
                  <AppText
                    style={styles.recordsLabel}
                    tone="muted"
                    variant="caption">
                    {`${totalRecords} ${t('records')}`}
                  </AppText>
                ) : null}
              </View>
            </View>
          </GlassPanel>

          {!hasQueried ? (
            <EmptyState
              icon="database"
              message={t(
                'Choose one or more signals, set a date range, then hit Query to browse signal history.',
              )}
              title={t('Select signals and click Query')}
            />
          ) : (
            <SignalHistoryTable
              loading={isLoading}
              onPageChange={setPage}
              page={page}
              pageSize={perPage}
              rows={rows}
              selectedSignals={selectedSignals}
              totalRows={totalRecords}
            />
          )}
        </>
      )}
    </PageContainer>
  );
}

const styles = StyleSheet.create({
  actionsBlock: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  alertBanner: {
    alignItems: 'center',
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  alertIcon: {
    flexShrink: 0,
  },
  alertText: {
    flex: 1,
  },
  badge: {
    alignSelf: 'flex-start',
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 10,
    letterSpacing: 0.3,
    lineHeight: 14,
    textTransform: 'lowercase',
  },
  button: {
    alignItems: 'center',
    backgroundColor: colors.accent,
    borderRadius: 12,
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  buttonDisabled: {
    opacity: 0.48,
  },
  buttonIcon: {
    flexShrink: 0,
  },
  buttonLabel: {
    color: colors.background,
    fontSize: 13,
  },
  cellSignal: {
    alignItems: 'center',
    flexDirection: 'row',
    flex: 1.4,
    gap: 6,
  },
  cellSignalText: {
    color: colors.textPrimary,
    fontFamily: MONO,
    fontSize: 12,
    flexShrink: 1,
  },
  cellTime: {
    flex: 1.6,
    fontFamily: MONO,
  },
  cellValue: {
    color: colors.textPrimary,
    flex: 1,
    fontFamily: MONO,
    fontSize: 12,
  },
  chevron: {
    color: colors.textMuted,
    fontSize: 14,
    marginLeft: 4,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  controlsPanel: {
    gap: spacing.md,
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  controlsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  emptyIcon: {
    marginBottom: spacing.sm,
  },
  emptyMessage: {
    marginTop: spacing.xs,
    maxWidth: 420,
    textAlign: 'center',
  },
  emptyRoot: {
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  emptyTitle: {
    textAlign: 'center',
  },
  expandedBox: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
    marginTop: spacing.xs,
    padding: spacing.sm,
  },
  expandedJson: {
    color: colors.textSecondary,
    fontFamily: MONO,
    fontSize: 11,
    lineHeight: 16,
  },
  fieldLabel: {
    letterSpacing: 0.6,
    marginBottom: spacing.xs,
    textTransform: 'uppercase',
  },
  fullWidth: {
    width: '100%',
  },
  helpBubble: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: spacing.xs,
    maxWidth: 280,
    padding: spacing.sm,
    position: 'absolute',
    top: 24,
    zIndex: 20,
    ...shadows.panel,
  },
  helpBubbleText: {
    lineHeight: 16,
  },
  helpRoot: {
    position: 'relative',
  },
  modalCheck: {
    color: colors.accent,
    fontSize: 14,
  },
  modalList: {
    maxHeight: 320,
  },
  modalMenu: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    maxWidth: 360,
    padding: spacing.sm,
    width: '92%',
    ...shadows.panel,
  },
  modalOption: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  modalOptionLabel: {
    color: colors.textSecondary,
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 18,
  },
  modalOptionLabelSelected: {
    color: colors.accent,
  },
  modalOptionPressed: {
    backgroundColor: colors.surfaceHover,
  },
  modalOptionSelected: {
    backgroundColor: colors.surfaceSelected,
  },
  modalOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  optionDisabled: {
    opacity: 0.4,
  },
  optionItem: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  optionItemText: {
    color: colors.textSecondary,
    fontFamily: MONO,
    fontSize: 12,
  },
  optionList: {
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: spacing.xs,
    maxHeight: 240,
    overflow: 'hidden',
  },
  optionMore: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  page: {
    backgroundColor: colors.background,
    flex: 1,
  },
  pageActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexShrink: 1,
    gap: spacing.sm,
  },
  pageButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  pageButtonDisabled: {
    opacity: 0.3,
  },
  pageButtonText: {
    color: colors.textPrimary,
    fontSize: 16,
  },
  pageContent: {
    padding: spacing.lg,
  },
  pageHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  pageSubtitle: {
    marginTop: spacing.xs,
  },
  pageTitleBlock: {
    flexShrink: 1,
  },
  pagination: {
    alignItems: 'center',
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
  },
  paginationControls: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  paginationLabel: {
    minWidth: 90,
    textAlign: 'center',
  },
  paginationMeta: {
    flexShrink: 1,
  },
  pressedDim: {
    opacity: 0.82,
  },
  rangeBlock: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 200,
  },
  recordsLabel: {
    paddingBottom: spacing.sm,
  },
  searchIcon: {
    flexShrink: 0,
  },
  searchInput: {
    color: colors.textPrimary,
    flex: 1,
    fontFamily: MONO,
    fontSize: 13,
    paddingVertical: 4,
  },
  searchRow: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
  },
  selectRoot: {
    minWidth: 96,
  },
  selectTrigger: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 40,
    paddingHorizontal: 12,
  },
  selectValue: {
    color: colors.textPrimary,
    fontSize: 13,
  },
  signalChip: {
    alignItems: 'center',
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  signalChipRemove: {
    color: colors.textMuted,
    fontSize: 12,
  },
  signalChipText: {
    color: colors.accent,
    fontFamily: MONO,
    fontSize: 12,
  },
  signalDot: {
    borderRadius: 4,
    flexShrink: 0,
    height: 8,
    width: 8,
  },
  signalLabelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  skeletonRow: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 8,
    height: 32,
  },
  skeletonWrap: {
    gap: spacing.sm,
  },
  tableHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  tableMeta: {
    marginLeft: 'auto',
  },
  tablePanel: {
    padding: spacing.md,
  },
  tableRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  tableRowGroup: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
  },
  tableTitle: {
    color: colors.textPrimary,
    fontSize: 14,
  },
  vsTrigger: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    flexShrink: 1,
    gap: 6,
    justifyContent: 'space-between',
    minWidth: 140,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  vsTriggerLabel: {
    color: colors.textPrimary,
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 18,
  },
});
