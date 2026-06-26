// Native parity port of web/src/features/driving/pages/RegenEfficiencyPage.tsx.
//
// Regenerative-braking analysis surface. Every behaviour from the web page is
// preserved one-for-one:
//   - All state names + defaults: vehicleId/vehicleIdStr (useSelectedVehicle),
//     useRangeState({ persistKey: 'regen-efficiency.range', defaultPresetId:
//     'all' }) → start/end/setRange, useRegenEfficiency(vehicleIdStr, start,
//     end) → data/isLoading/error, useDrives(vehicleIdStr) → allDrives,
//     lifetimeRegenKwh/lifetimeDriveKwh (both null), the date-windowed `drives`
//     useMemo, useUnits() → unitPrefs/formatEnergy/formatPower, toDistanceDisplay,
//     distanceUnit, the monthlyTrend + regenDrives useMemos.
//   - The regenColor (>=25 green, >=15 cyan, >=8 amber, else red) and
//     getRegenRatio (null unless avgPowerW>0 && regenEnergyWh && energyUsedWh>0)
//     helpers are ported verbatim.
//   - Section structure: header actions (vehicle picker + range chips) → hero
//     RadialGauge + recovered-info line → 6 stat tiles → monthly regen trend
//     chart (>1 month) → regen-metrics MetricBars → recent-regen-drives table.
//   - Every i18n key keeps its English default string (intent preserved); the
//     recovered-info line keeps its {{energy}}/{{charges}} interpolation.
//   - SI stays on the wire; conversion happens only at the render boundary via
//     the useUnits()/useFormatPrefs() bridge (Phase-48 frontend SI-cutover rule).
//
// Web dependencies absent from the native parity manifest are remapped to
// native-safe equivalents (contract rules 4, 5 & 7) and documented in the
// sidecar:
//   - react-i18next useTranslation → inlined useNativeTranslation(): a stable
//     (key, fallback, options?) shim reproducing i18next `{{name}}`
//     interpolation against the English fallback copy.
//   - lucide-react Zap/Activity/Calendar → SemanticIcon glyphs bolt/activity/
//     calendar (lucide SVG has no native renderer).
//   - @/components/layout PageContainer → inline native PageContainer (title +
//     subtitle + always-visible actions + loading spinner / error banner /
//     children, mirroring the web header + loading/error/children branches).
//   - @/components/ui GlassPanel → the shared native GlassPanel; HelpTooltip →
//     an inline press-to-toggle help bubble (native has no hover surface; the
//     help body is also exposed as the trigger's accessibilityLabel).
//   - @/components/charts ChartContainer/ChartTooltip/AREA_DEFAULTS/
//     renderAnnotationLines/ComposedChart/Line/Bar/XAxis/YAxis/CartesianGrid/
//     Tooltip/ResponsiveContainer → an inline ChartContainer wrapping the shared
//     native AreaChartWrapper with two series (regenKwh #10b981 + drives
//     #a855f7). Native has one shared chart primitive with a single Y domain, so
//     the web dual-axis ComposedChart collapses to a two-series area chart; the
//     hover ChartTooltip, the annotation overlay lines (renderAnnotationLines)
//     and the dataColumns CSV/data-table affordance have no native analogue and
//     are dropped (the chart still carries an accessibilityLabel summary).
//     RadialGauge → the shared native parity RadialGauge.
//   - @/components/data-display AnimatedNumber + MetricBar → the shared native
//     ports (same value/decimals and value/max/color/label props).
//   - @/components/motion FadeIn → Animated.View opacity 0→1 mount fade;
//     StaggerContainer/StaggerItem → flex-grid wrappers (the parent FadeIn
//     supplies the mount fade).
//   - @/components/feedback EmptyState → inline native EmptyState (optional
//     SemanticIcon + muted message).
//   - @/components/forms RangePicker → the shared native DatePresetChips (the web
//     calendar picker has no native analogue; DEFAULT_PRESET_IDS includes 'all'
//     so the page's defaultPresetId 'all' highlights, triggerTestId maps to
//     testID); VehicleSelect → an inline native picker (Pressable + Modal)
//     backed by a shared module-level selected-vehicle store, paired with an
//     inline useSelectedVehicle, so the web read(useSelectedVehicle)+write
//     (VehicleSelect) shared-store coupling is preserved on native. URL/router
//     precedence + localStorage persistence are browser-only and dropped (the
//     selection is shared in-memory for the session, the same graceful
//     degradation the shared native VehicleSelect port documents).
//   - @/hooks useRangeState → native-safe shim (localStorage feature-detected;
//     precedence localStorage > defaultPresetId > today; URL sync dropped);
//     useSelectedVehicle → inline shared-store hook; useUnits → inline bridge
//     over useFormatPrefs reproducing unitPrefs.distance/locale/precision +
//     formatEnergy (SI Wh→kWh) + formatPower (SI W→kW); usePageTitle →
//     feature-detects document.title and writes "{title} — TeslaSync".
//   - @/lib/dateFormat formatDateShort → ported (Intl month/day, '—' for
//     null/invalid); @/lib/numberFormat fmtNumber/fmtPercent/fmtWithUnit →
//     settings-aware component callbacks over the shared fmtNumberRaw + the
//     useFormatPrefs locale/precision (same settings source the web module
//     globals read); @/lib/unitConversion convertDistanceFromSI → the shared
//     _formatPrimitives port.
//   - @/types/driving Drive + @/api/hooks/useDriving useRegenEfficiency/useDrives
//     → the ported native useDriving (same '/analytics/regen' + '/drives' paths,
//     same Drive/RegenEfficiencyData shapes, same snake_case query params).
//
// No DOM-only modules, HTML elements, react-i18next, lucide-react, Recharts,
// Leaflet, or web @/ UI components are imported — only react, react-native
// primitives, the shared native SemanticIcon / AppText / GlassPanel / theme
// tokens, and the ported parity RadialGauge / AreaChartWrapper / AnimatedNumber /
// MetricBar / DatePresetChips / datePresets / useDriving / useVehicles /
// _formatPrimitives.

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
  View,
} from 'react-native';

import {
  SemanticIcon,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, shadows, spacing} from '../../../../theme/tokens';

import {useDrives, useRegenEfficiency, type Drive} from '../../../api/hooks/useDriving';
import {useVehicles} from '../../../api/hooks/useVehicles';
import {AreaChartWrapper} from '../../../components/charts/AreaChartWrapper';
import {RadialGauge} from '../../../components/charts/RadialGauge';
import {AnimatedNumber} from '../../../components/data-display/AnimatedNumber';
import {
  convertDistanceFromSI,
  FALLBACK,
  fmtNumberRaw,
  isFiniteNumber,
  useFormatPrefs,
} from '../../../components/data-display/format/_formatPrimitives';
import {MetricBar} from '../../../components/data-display/MetricBar';
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

/* ── react-i18next useTranslation replacement ──────────── */

type NativeTOptions = Record<string, string | number>;
type NativeTFunction = (
  key: string,
  fallback: string,
  options?: NativeTOptions,
) => string;

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

/* ── usePageTitle shim ─────────────────────────────────── */

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

/* ── Helpers (ported from @/lib/dateFormat) ────────────── */

function formatDateShort(iso: string | Date | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

/* ── @/hooks/useUnits replacement (bridge over useFormatPrefs) ── */

interface FormatOptions {
  precision?: number;
}

type UnitFormatter = (
  value: number | null | undefined,
  options?: FormatOptions,
) => string;

interface UnitPrefsLike {
  distance: 'km' | 'mi';
  locale: string;
  precision: number;
}

interface UseUnitsResult {
  unitPrefs: UnitPrefsLike;
  formatEnergy: UnitFormatter;
  formatPower: UnitFormatter;
}

/** SI → display divisors (web convertEnergyFromSI / convertPowerFromSI). */
const WH_PER_KWH = 1000;
const W_PER_KW = 1000;
/** Web DEFAULT_PRECISION.energy / .power fallbacks (used when no override). */
const DEFAULT_ENERGY_PRECISION = 2;
const DEFAULT_POWER_PRECISION = 2;

/** Reproduces web unitConversion.resolvePrecision: override → pref → fallback. */
function resolveCallPrecision(
  override: number | undefined,
  prefPrecision: number | undefined,
  fallback: number,
): number {
  if (
    typeof override === 'number' &&
    Number.isFinite(override) &&
    override >= 0
  ) {
    return Math.floor(override);
  }
  if (
    typeof prefPrecision === 'number' &&
    Number.isFinite(prefPrecision) &&
    prefPrecision >= 0
  ) {
    return Math.floor(prefPrecision);
  }
  return fallback;
}

function useUnits(): UseUnitsResult {
  const {distanceUnit, locale, precision} = useFormatPrefs();

  const formatEnergy = useCallback<UnitFormatter>(
    (value, options) => {
      if (!isFiniteNumber(value)) {
        return FALLBACK;
      }
      const digits = resolveCallPrecision(
        options?.precision,
        precision,
        DEFAULT_ENERGY_PRECISION,
      );
      return `${fmtNumberRaw(value / WH_PER_KWH, digits, locale)} kWh`;
    },
    [locale, precision],
  );

  const formatPower = useCallback<UnitFormatter>(
    (value, options) => {
      if (!isFiniteNumber(value)) {
        return FALLBACK;
      }
      const digits = resolveCallPrecision(
        options?.precision,
        precision,
        DEFAULT_POWER_PRECISION,
      );
      return `${fmtNumberRaw(value / W_PER_KW, digits, locale)} kW`;
    },
    [locale, precision],
  );

  const unitPrefs = useMemo<UnitPrefsLike>(
    () => ({distance: distanceUnit, locale, precision}),
    [distanceUnit, locale, precision],
  );

  return useMemo(
    () => ({unitPrefs, formatEnergy, formatPower}),
    [unitPrefs, formatEnergy, formatPower],
  );
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
          pressed && styles.vsTriggerPressed,
        ]}
        testID="vehicle-select">
        <AppText numberOfLines={1} style={styles.vsTriggerLabel}>
          {selectedOption?.label ?? label}
        </AppText>
        <AppText
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.vsChevron}>
          ⌄
        </AppText>
      </Pressable>

      <Modal
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        transparent
        visible={open}>
        <Pressable style={styles.vsOverlay} onPress={() => setOpen(false)}>
          <Pressable style={styles.vsMenu} onPress={() => undefined}>
            <ScrollView style={styles.vsList}>
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
                      styles.vsOption,
                      selected && styles.vsOptionSelected,
                      pressed && styles.vsOptionPressed,
                    ]}
                    testID={`vehicle-select-option-${opt.value}`}>
                    <AppText
                      numberOfLines={1}
                      style={[
                        styles.vsOptionLabel,
                        selected && styles.vsOptionLabelSelected,
                      ]}
                      weight={selected ? 'semibold' : 'regular'}>
                      {opt.label}
                    </AppText>
                    {selected ? (
                      <AppText style={styles.vsCheck}>✓</AppText>
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

// Feature-detects Web Storage (present on react-native-web, absent on bare
// native). When unavailable the remembered range lives only in memory.
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
  const t = Date.parse(`${s}T00:00:00`);
  return !Number.isNaN(t);
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

// Native-safe equivalent of the web hook. Precedence on bare native is
// localStorage > defaultPresetId > today (the web URL layer has no native
// analogue). setRange clamps to minDate and persists, matching the web setter.
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

/* ── FadeIn / StaggerContainer / StaggerItem (web @/components/motion) ── */

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

function StaggerContainer({children}: {children: ReactNode}) {
  return <View style={styles.statGrid}>{children}</View>;
}

function StaggerItem({children}: {children: ReactNode}) {
  return <View style={styles.statCell}>{children}</View>;
}

/* ── PageContainer (web @/components/layout PageContainer) ── */

function PageContainer({
  title,
  subtitle,
  actions,
  loading,
  error,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  loading?: boolean;
  error?: Error | null;
  children: ReactNode;
}) {
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

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : error ? (
        <View style={styles.errorBox}>
          <AppText style={styles.errorText} variant="caption" weight="semibold">
            {error.message}
          </AppText>
        </View>
      ) : (
        children
      )}
    </ScrollView>
  );
}

/* ── ChartContainer (web @/components/charts ChartContainer) ── */

function ChartContainer({
  title,
  ariaLabel,
  height = 300,
  children,
}: {
  title: string;
  ariaLabel: string;
  height?: number;
  children: ReactNode;
}) {
  return (
    <GlassPanel
      accessibilityLabel={`${title}. ${ariaLabel}`}
      style={styles.chartPanel}>
      <View style={styles.chartTitleBlock}>
        <AppText variant="body" weight="semibold">
          {title}
        </AppText>
      </View>
      <View style={[styles.chartBody, {minHeight: height}]}>{children}</View>
    </GlassPanel>
  );
}

/* ── EmptyState (web @/components/feedback EmptyState) ──── */

function EmptyState({
  icon,
  message,
}: {
  icon?: SemanticIconName;
  message: string;
}) {
  return (
    <View accessibilityRole="summary" style={styles.emptyRoot}>
      {icon ? (
        <SemanticIcon
          decorative
          name={icon}
          size="lg"
          style={styles.emptyIconWrap}
        />
      ) : null}
      <AppText style={styles.emptyMessage} tone="muted" variant="caption">
        {message}
      </AppText>
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

/* ── StatTile (web hero stat GlassPanel) ───────────────── */

function StatTile({
  icon,
  value,
  label,
}: {
  icon: SemanticIconName;
  value: ReactNode;
  label: string;
}) {
  return (
    <GlassPanel style={styles.statTile}>
      <SemanticIcon decorative name={icon} size="sm" style={styles.statIcon} />
      {typeof value === 'string' || typeof value === 'number' ? (
        <AppText style={styles.statValueText} weight="bold">
          {value}
        </AppText>
      ) : (
        value
      )}
      <AppText
        numberOfLines={1}
        style={styles.statLabelText}
        tone="muted"
        variant="caption">
        {label}
      </AppText>
    </GlassPanel>
  );
}

/* ────────────────────────────────────────────────────────────────────── */
/*  Helpers (ported verbatim from the web page)                           */
/* ────────────────────────────────────────────────────────────────────── */

function regenColor(ratio: number): string {
  if (ratio >= 25) {
    return '#10b981';
  }
  if (ratio >= 15) {
    return '#00f0ff';
  }
  if (ratio >= 8) {
    return '#f59e0b';
  }
  return '#ef4444';
}

function getRegenRatio(drive: Drive): number | null {
  if (!drive.avgPowerW || drive.avgPowerW <= 0) {
    return null;
  }
  if (
    !drive.regenEnergyWh ||
    !drive.energyUsedWh ||
    drive.energyUsedWh <= 0
  ) {
    return null;
  }
  return (drive.regenEnergyWh / drive.energyUsedWh) * 100;
}

/* ────────────────────────────────────────────────────────────────────── */
/*  RegenEfficiencyPage                                                    */
/* ────────────────────────────────────────────────────────────────────── */

export default function RegenEfficiencyPage() {
  const t = useNativeTranslation();
  usePageTitle(t('regen.title', 'Regenerative Braking'));

  const {vehicleId} = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;

  const {start, end, presetId, setRange} = useRangeState({
    persistKey: 'regen-efficiency.range',
    defaultPresetId: 'all',
  });

  const {data, isLoading, error} = useRegenEfficiency(vehicleIdStr, start, end);
  const {data: allDrives} = useDrives(vehicleIdStr);
  const lifetimeRegenKwh: number | null = null;
  const lifetimeDriveKwh: number | null = null;

  // Narrow drives feeding the client-side monthly trend chart and the
  // recent-drives table to the picked window so they stay in sync with the
  // backend-side gauges/cards.
  const drives = useMemo(() => {
    if (!allDrives?.length) {
      return allDrives;
    }
    const startMs = new Date(`${start}T00:00:00`).getTime();
    const endMs = new Date(`${end}T23:59:59.999`).getTime();
    return allDrives.filter(d => {
      if (!d.startTs) {
        return false;
      }
      // Renamed from the web `t` to avoid shadowing the translation function.
      const ts = new Date(d.startTs).getTime();
      return ts >= startMs && ts <= endMs;
    });
  }, [allDrives, start, end]);

  const {unitPrefs, formatEnergy, formatPower} = useUnits();
  const toDistanceDisplay = useCallback(
    (value: number) => convertDistanceFromSI(value, unitPrefs.distance),
    [unitPrefs.distance],
  );

  const distanceUnit = unitPrefs.distance;

  const fmtNumber = useCallback(
    (v: unknown, decimals?: number) =>
      fmtNumberRaw(v, decimals ?? unitPrefs.precision, unitPrefs.locale),
    [unitPrefs.precision, unitPrefs.locale],
  );
  const fmtPercent = useCallback(
    (v: unknown, decimals?: number) => `${fmtNumber(v, decimals)}%`,
    [fmtNumber],
  );
  const fmtWithUnit = useCallback(
    (v: unknown, unit: string, decimals?: number) =>
      `${fmtNumber(v, decimals)} ${unit}`,
    [fmtNumber],
  );

  /* ---- Monthly regen trend from drives ---- */
  const monthlyTrend = useMemo(() => {
    if (!drives || drives.length === 0) {
      return [];
    }
    const byMonth = new Map<
      string,
      {totalRegen: number; count: number; totalDist: number}
    >();
    drives.forEach(d => {
      const month = d.startTs?.substring(0, 7);
      if (!month) {
        return;
      }
      const regen = d.regenEnergyWh ?? 0;
      const existing =
        byMonth.get(month) ?? {totalRegen: 0, count: 0, totalDist: 0};
      existing.totalRegen += regen;
      existing.count++;
      existing.totalDist += d.distanceM;
      byMonth.set(month, existing);
    });
    return Array.from(byMonth.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([month, val]) => ({
        month,
        regenKwh: parseFloat(fmtNumber(val.totalRegen / 1000, 1)),
        drives: val.count,
        distance: Math.round(toDistanceDisplay(val.totalDist)),
      }));
  }, [drives, toDistanceDisplay, fmtNumber]);

  /* ---- Per-drive regen list ---- */
  const regenDrives = useMemo(() => {
    if (!drives) {
      return [];
    }
    return drives
      .filter(d => d.regenEnergyWh && d.regenEnergyWh > 0)
      .slice(0, 20)
      .map(d => ({
        id: d.id,
        date: d.startTs ? formatDateShort(d.startTs) : '—',
        distance: fmtWithUnit(toDistanceDisplay(d.distanceM), distanceUnit),
        maxRegen: d.regenEnergyWh
          ? fmtWithUnit(d.regenEnergyWh / 1000, 'kWh')
          : '—',
        ratio: getRegenRatio(d),
      }));
  }, [drives, toDistanceDisplay, distanceUnit, fmtWithUnit]);

  return (
    <PageContainer
      title={t('regen.title', 'Regenerative Braking')}
      subtitle={t('regen.subtitle', 'Energy recovery analysis and regen efficiency')}
      error={error as Error | null}
      loading={isLoading}
      actions={
        <View style={styles.headerActions}>
          <VehicleSelect />
          <DatePresetChips
            activeId={presetId}
            onSelect={(sel: DatePresetSelection) =>
              setRange({start: sel.start, end: sel.end})
            }
            testID="regen-efficiency-range"
          />
        </View>
      }>
      {data ? (
        <>
          {/* Hero gauge */}
          <FadeIn>
            <GlassPanel style={styles.heroPanel}>
              <RadialGauge
                value={Math.round(data.regenRatio ?? 0)}
                max={100}
                label={t('regen.regenRatio', 'Regen Ratio')}
                unit="%"
                color={regenColor(data.regenRatio ?? 0)}
                size={160}
              />
              <AppText style={styles.heroHelper} tone="muted" variant="caption">
                {t(
                  'regen.recoveredInfo',
                  "You've recovered {{energy}} — equivalent to ~{{charges}} free charges.",
                  {
                    energy: formatEnergy(data.totalRegenWh ?? 0, {precision: 1}),
                    charges: fmtNumber(data.freeCharges ?? 0),
                  },
                )}
              </AppText>
            </GlassPanel>
          </FadeIn>

          {/* Stat tiles */}
          <StaggerContainer>
            <StaggerItem>
              <StatTile
                icon="bolt"
                label={t('regen.totalRegen', 'Total Regen')}
                value={formatEnergy(data.totalRegenWh ?? 0, {precision: 1})}
              />
            </StaggerItem>
            <StaggerItem>
              <StatTile
                icon="activity"
                label={t('regen.ratioLabel', 'Recovery Rate')}
                value={fmtPercent(data.regenRatio ?? 0)}
              />
            </StaggerItem>
            <StaggerItem>
              <StatTile
                icon="calendar"
                label={t('regen.monthlyAvg', 'Monthly Avg kW')}
                value={formatPower(data.monthlyAvgRegen ?? 0, {precision: 1})}
              />
            </StaggerItem>
            <StaggerItem>
              <StatTile
                icon="bolt"
                label={t('regen.freeCharges', 'Free Charges')}
                value={
                  <AnimatedNumber
                    decimals={1}
                    style={styles.statValueText}
                    value={data.freeCharges ?? 0}
                  />
                }
              />
            </StaggerItem>
            <StaggerItem>
              <StatTile
                icon="bolt"
                label={t('regen.lifetimeRegen', 'Lifetime Regen kWh')}
                value={
                  lifetimeRegenKwh != null ? (
                    <AnimatedNumber
                      decimals={1}
                      style={styles.statValueText}
                      value={lifetimeRegenKwh}
                    />
                  ) : (
                    '—'
                  )
                }
              />
            </StaggerItem>
            <StaggerItem>
              <StatTile
                icon="activity"
                label={t('regen.lifetimeDrive', 'Lifetime Drive kWh')}
                value={
                  lifetimeDriveKwh != null ? (
                    <AnimatedNumber
                      decimals={1}
                      style={styles.statValueText}
                      value={lifetimeDriveKwh}
                    />
                  ) : (
                    '—'
                  )
                }
              />
            </StaggerItem>
          </StaggerContainer>

          {/* Monthly regen trend chart */}
          {monthlyTrend.length > 1 ? (
            <FadeIn>
              <ChartContainer
                title={t('regen.monthlyTrend', 'Monthly Regen Trend')}
                ariaLabel={t(
                  'regen.monthlyTrend.aria',
                  'Monthly regen energy and drive count composed chart',
                )}
                height={260}>
                <AreaChartWrapper
                  data={monthlyTrend}
                  height={260}
                  series={[
                    {
                      key: 'regenKwh',
                      label: t('regen.regenKwh', 'Regen kWh'),
                      color: '#10b981',
                    },
                    {
                      key: 'drives',
                      label: t('regen.drives', 'Drives'),
                      color: '#a855f7',
                    },
                  ]}
                  xKey="month"
                />
              </ChartContainer>
            </FadeIn>
          ) : null}

          {/* Regen metrics strip */}
          <FadeIn>
            <GlassPanel style={styles.metricsPanel}>
              <View style={styles.sectionHeadingRow}>
                <SemanticIcon decorative name="activity" size="sm" />
                <AppText style={styles.sectionHeading} weight="semibold">
                  {t('regen.metrics', 'Regen Metrics')}
                </AppText>
                <HelpTooltip
                  ariaLabel={t(
                    'help.regenEfficiency.iconLabel',
                    'More info about regen metrics',
                  )}
                  body={t(
                    'help.regenEfficiency.body',
                    'Energy recovered through regenerative braking divided by total energy used during driving. Higher is better — Tesla cars typically reach 15–30% recovery in mixed driving.',
                  )}
                />
              </View>
              <View style={styles.metricsGrid}>
                <View style={styles.metricsCell}>
                  <MetricBar
                    color="#10b981"
                    label={t('regen.totalRegenLabel', 'Total Regen')}
                    max={Math.max(data.totalRegenWh ?? 0, 100000)}
                    value={data.totalRegenWh ?? 0}
                  />
                  <AppText style={styles.metricsValue} tone="muted" variant="caption">
                    {formatEnergy(data.totalRegenWh ?? 0, {precision: 1})}
                  </AppText>
                </View>
                <View style={styles.metricsCell}>
                  <MetricBar
                    color="#00f0ff"
                    label={t('regen.regenRatioBar', 'Regen Ratio')}
                    max={100}
                    value={data.regenRatio ?? 0}
                  />
                  <AppText style={styles.metricsValue} tone="muted" variant="caption">
                    {fmtPercent(data.regenRatio ?? 0)}
                  </AppText>
                </View>
                <View style={styles.metricsCell}>
                  <MetricBar
                    color="#a855f7"
                    label={t('regen.monthlyAvgBar', 'Monthly Avg')}
                    max={Math.max(data.monthlyAvgRegen ?? 0, 50)}
                    value={data.monthlyAvgRegen ?? 0}
                  />
                  <AppText style={styles.metricsValue} tone="muted" variant="caption">
                    {formatPower(data.monthlyAvgRegen ?? 0, {precision: 1})}
                  </AppText>
                </View>
                <View style={styles.metricsCell}>
                  <MetricBar
                    color="#f59e0b"
                    label={t('regen.freeChargesBar', 'Free Charges')}
                    max={Math.max(data.freeCharges ?? 0, 10)}
                    value={data.freeCharges ?? 0}
                  />
                  <AppText style={styles.metricsValue} tone="muted" variant="caption">
                    {fmtNumber(data.freeCharges ?? 0)}
                  </AppText>
                </View>
              </View>
            </GlassPanel>
          </FadeIn>

          {/* Per-drive regen table */}
          <FadeIn>
            <GlassPanel style={styles.tablePanel}>
              <View style={styles.sectionHeadingRow}>
                <SemanticIcon decorative name="bolt" size="sm" />
                <AppText style={styles.sectionHeading} weight="semibold">
                  {t('regen.recentDrives', 'Recent Regen Drives')}
                </AppText>
              </View>
              {regenDrives.length > 0 ? (
                <View>
                  <View style={styles.tableHeaderRow}>
                    <AppText
                      style={[styles.tableHeaderCell, styles.tableColDate]}
                      tone="muted"
                      variant="caption"
                      weight="semibold">
                      {t('regen.date', 'Date')}
                    </AppText>
                    <AppText
                      style={[styles.tableHeaderCell, styles.tableColFlex]}
                      tone="muted"
                      variant="caption"
                      weight="semibold">
                      {t('regen.distanceCol', 'Distance')}
                    </AppText>
                    <AppText
                      style={[styles.tableHeaderCell, styles.tableColFlex]}
                      tone="muted"
                      variant="caption"
                      weight="semibold">
                      {t('regen.maxRegenCol', 'Max Regen')}
                    </AppText>
                    <AppText
                      style={[styles.tableHeaderCell, styles.tableColRight]}
                      tone="muted"
                      variant="caption"
                      weight="semibold">
                      {t('regen.ratioCol', 'Ratio')}
                    </AppText>
                  </View>
                  {regenDrives.map(rd => (
                    <View key={rd.id} style={styles.tableRow}>
                      <AppText
                        style={[styles.tableCell, styles.tableColDate]}
                        tone="secondary"
                        variant="caption">
                        {rd.date}
                      </AppText>
                      <AppText
                        style={[
                          styles.tableCell,
                          styles.tableCellMono,
                          styles.tableColFlex,
                        ]}
                        variant="caption">
                        {rd.distance}
                      </AppText>
                      <AppText
                        style={[
                          styles.tableCell,
                          styles.tableCellMono,
                          styles.tableCellAccent,
                          styles.tableColFlex,
                        ]}
                        variant="caption">
                        {rd.maxRegen}
                      </AppText>
                      <AppText
                        style={[
                          styles.tableCell,
                          styles.tableColRight,
                          rd.ratio ? {color: regenColor(rd.ratio)} : null,
                        ]}
                        variant="caption"
                        weight="bold">
                        {rd.ratio ? fmtPercent(rd.ratio) : '—'}
                      </AppText>
                    </View>
                  ))}
                </View>
              ) : (
                <EmptyState
                  icon="activity"
                  message={t('common.noData', 'No data available')}
                />
              )}
            </GlassPanel>
          </FadeIn>
        </>
      ) : (
        // no-action: transient empty state — surfaces when source data is
        // missing; no specific recovery action available.
        <EmptyState
          message={t('regen.noData', 'No regen efficiency data available yet')}
        />
      )}
    </PageContainer>
  );
}

const styles = StyleSheet.create({
  chartBody: {
    gap: spacing.sm,
  },
  chartPanel: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  chartTitleBlock: {
    gap: 2,
  },
  emptyIconWrap: {
    marginBottom: spacing.sm,
  },
  emptyMessage: {
    textAlign: 'center',
  },
  emptyRoot: {
    alignItems: 'center',
    gap: spacing.xs,
    justifyContent: 'center',
    paddingVertical: spacing.xl,
  },
  errorBox: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
    borderRadius: 16,
    borderWidth: 1,
    padding: spacing.md,
  },
  errorText: {
    color: colors.danger,
  },
  headerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  helpBubble: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderWidth: 1,
    maxWidth: 260,
    padding: spacing.sm,
    position: 'absolute',
    right: 0,
    top: 26,
    zIndex: 10,
    ...shadows.panel,
  },
  helpBubbleText: {
    lineHeight: 16,
  },
  helpRoot: {
    position: 'relative',
  },
  heroHelper: {
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  heroPanel: {
    alignItems: 'center',
    padding: spacing.lg,
  },
  loadingBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
  metricsCell: {
    flexBasis: '46%',
    flexGrow: 1,
    minWidth: 120,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  metricsPanel: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  metricsValue: {
    fontSize: 10,
    marginTop: spacing.xs,
  },
  page: {
    backgroundColor: colors.background,
    flex: 1,
  },
  pageActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  pageContent: {
    gap: spacing.lg,
    padding: spacing.lg,
  },
  pageHeader: {
    gap: spacing.md,
  },
  pageSubtitle: {
    marginTop: spacing.xs,
  },
  pageTitleBlock: {
    gap: spacing.xs,
  },
  sectionHeading: {
    flexShrink: 1,
  },
  sectionHeadingRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  statCell: {
    flexBasis: '30%',
    flexGrow: 1,
    minWidth: 100,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statIcon: {
    marginBottom: spacing.xs,
  },
  statLabelText: {
    fontSize: 10,
    textAlign: 'center',
  },
  statTile: {
    alignItems: 'center',
    gap: 2,
    padding: spacing.md,
  },
  statValueText: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  tableCell: {
    color: colors.textPrimary,
  },
  tableCellAccent: {
    color: colors.accent,
  },
  tableCellMono: {
    fontFamily: MONO,
  },
  tableColDate: {
    flex: 1,
  },
  tableColFlex: {
    flex: 1,
  },
  tableColRight: {
    flex: 1,
    textAlign: 'right',
  },
  tableHeaderCell: {
    flex: 1,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  tablePanel: {
    gap: spacing.md,
    padding: spacing.lg,
  },
  tableRow: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.sm,
  },
  vsCheck: {
    color: colors.accent,
    fontSize: 14,
  },
  vsChevron: {
    color: colors.textMuted,
    fontSize: 14,
    marginLeft: 4,
  },
  vsList: {
    maxHeight: 320,
  },
  vsMenu: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    maxWidth: 360,
    padding: spacing.sm,
    width: '92%',
    ...shadows.panel,
  },
  vsOption: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  vsOptionLabel: {
    color: colors.textSecondary,
    flexShrink: 1,
    fontSize: 14,
    lineHeight: 18,
  },
  vsOptionLabelSelected: {
    color: colors.accent,
  },
  vsOptionPressed: {
    backgroundColor: colors.surfaceHover,
  },
  vsOptionSelected: {
    backgroundColor: colors.surfaceSelected,
  },
  vsOverlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
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
  vsTriggerPressed: {
    opacity: 0.85,
  },
});
