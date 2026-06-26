// Native parity port of web/src/features/battery/pages/PowerFlowDashboardPage.tsx.
//
// Real-time Tesla Energy power-flow surface. Every behaviour from the web page
// is preserved one-for-one:
//   - All state names (siteId, since/until via useRangeState, the three energy
//     queries + refresh mutation) and their defaults (DEFAULT_SITE_ID = 1,
//     defaultPresetId '7d', persistKey 'power-flow.range', history limit 1000).
//   - The hasLiveData/live guard ('id' in liveStatus), the chartData useMemo
//     ({ time, label, solar, battery, grid, load, soc }), isLoading = liveLoading,
//     and the solarW/batteryW/loadW/gridW/soc/gridStatus/stormMode derivations.
//   - The fmtWatts / fmtWh helpers (W/kW + Wh/kWh thresholds) and the
//     PRESET_IDS list are ported byte-for-byte.
//   - The FlowArrow component (active styling + ↓ when power >= 0 else ↑ +
//     right-aligned fmtWatts), the battery SOC progress bar (width =
//     min(soc,100)%), energy-left / total-capacity rows, the four power flow
//     arrows (incl. the conditional grid-services arrow), and both history
//     charts (stacked power area + battery SOC) keep their data, series, and
//     empty/loading semantics.
//   - Every i18n key keeps its English default string (intent preserved).
//
// Web dependencies absent from the native parity manifest are remapped to
// native-safe equivalents (contract rules 4, 5 & 7) and documented in the
// sidecar:
//   - react-i18next useTranslation -> inlined useNativeTranslation(): a stable
//     (key, fallback, options?) => fallback shim reproducing i18next `{{name}}`
//     interpolation against the English fallback copy.
//   - lucide-react Sun/Battery/Home/Zap/ShieldAlert/RefreshCw/ArrowDown/ArrowUp/
//     Activity -> SemanticIcon glyph chips (StatCard icons + RefreshButton) and,
//     for the tiny inline badge / flow-arrow marks, a variant-coloured status
//     dot + a ↓/↑ text glyph (the established StatusBadge native idiom).
//   - @/components/layout PageContainer -> inline native PageContainer (title +
//     subtitle + loading spinner + error banner + children, mirroring the web
//     loading/error/children branches; children hidden while loading exactly
//     like the web). @/components/layout Grid -> flex-wrap layout Views.
//   - @/components/ui GlassPanel/Badge/Button -> the existing native GlassPanel,
//     an inline native Badge (variant surface + dot + label) and an inline
//     RefreshButton (icon + ActivityIndicator while pending + disabled), since
//     the native AppButton exposes no icon/loading surface.
//   - @/components/forms RangePicker + @/hooks/useRangeState -> the existing
//     native DatePresetChips driven by an inline native-safe useRangeState
//     (localStorage memory feature-detected; URL sync dropped on bare native).
//   - @/components/data-display StatCard -> the existing native StatCard.
//   - @/components/charts Recharts (ChartContainer/AreaChart/LineChart/Area/Line/
//     axes/Tooltip/Legend/gradients/CHART_COLORS) -> the existing native
//     AreaChartWrapper wrapped by an inline ChartContainer (title/subtitle/
//     loading/empty/height + ariaLabel). Both charts keep their series, colours,
//     labels, and x/y formatters; the SOC LineChart maps to a single-series
//     AreaChartWrapper since native has one shared chart primitive.
//   - @/components/feedback EmptyState -> inline native EmptyState (icon+message).
//   - @/components/motion FadeIn -> Animated.View opacity 0->1 mount fade;
//     StaggerContainer/StaggerItem -> pass-through layout wrappers (the parent
//     FadeIn already supplies the mount fade).
//   - @/hooks/usePageTitle -> native-safe usePageTitle (feature-detects
//     document.title; writes "{title} — TeslaSync").
//   - @/lib/dateFormat formatDateTime/formatDateShort + @/lib/numberFormat
//     fmtNumber -> ported faithfully (en-US / precision-2 defaults; the page
//     always passes explicit decimals); Intl options are applied where the
//     runtime supports them (full on react-native-web, best-effort on Hermes).
//   - @/lib/cn -> not imported; the single cn() active/inactive toggle in
//     FlowArrow maps to a StyleSheet ternary.
//
// No DOM-only modules, HTML elements, react-i18next, lucide-react, Recharts,
// Leaflet, or web UI components are imported — only react, react-native
// primitives, the ported web-parity energy hooks + datePresets lib +
// AreaChartWrapper + DatePresetChips + StatCard, and the existing apps/native
// SemanticIcon / AppText / GlassPanel / theme tokens.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type DimensionValue,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { SemanticIcon, type SemanticIconName } from '../../../../components/icons/SemanticIcon';
import { AppText } from '../../../../components/ui/AppText';
import { GlassPanel } from '../../../../components/ui/GlassPanel';
import { colors, spacing } from '../../../../theme/tokens';

import { AreaChartWrapper } from '../../../components/charts/AreaChartWrapper';
import { CHART_COLORS } from '../../../components/charts/chartUtils';
import { StatCard } from '../../../components/data-display/StatCard';
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
import {
  useRefreshTeslaEnergyLiveStatus,
  useTeslaEnergyLiveStatus,
  useTeslaEnergyLiveStatusHistory,
  type TeslaEnergyLiveStatus,
} from '../../../api/hooks/useEnergy';

/* ── i18n shim (react-i18next useTranslation) ──────────── */

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
    const doc = (globalThis as { document?: { title?: string } }).document;
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

/* ── Helpers (ported from @/lib/numberFormat) ──────────── */

// Web fmtNumber reads a module-global precision/locale set by the settings
// load path; this parity port keeps the same web defaults (precision 2,
// en-US). The page always passes explicit decimals so the default never bites.
const DEFAULT_PRECISION = 2;
const DEFAULT_LOCALE = 'en-US';

function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals?: number, locale?: string): string {
  const d = decimals ?? DEFAULT_PRECISION;
  const lc = locale ?? DEFAULT_LOCALE;
  try {
    return safeNumber(v).toLocaleString(lc, {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  } catch {
    return safeNumber(v).toLocaleString('en-US', {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    });
  }
}

/* ── Helpers (ported from @/lib/dateFormat) ────────────── */

// Both helpers accept null/undefined/garbage and return the universal "—"
// placeholder, matching the web formatter contract. Intl options are honoured
// where the runtime supports them (full on react-native-web; best-effort on
// bare Hermes, which never throws).
function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

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

/* ───────── Helpers (page-local, ported verbatim) ───────── */

function fmtWatts(watts: number | null | undefined): string {
  if (watts == null) {
    return '—';
  }
  const abs = Math.abs(watts);
  if (abs >= 1000) {
    return `${fmtNumber(watts / 1000, 1)} kW`;
  }
  return `${fmtNumber(watts, 0)} W`;
}

function fmtWh(wh: number | null | undefined): string {
  if (wh == null) {
    return '—';
  }
  if (Math.abs(wh) >= 1000) {
    return `${fmtNumber(wh / 1000, 1)} kWh`;
  }
  return `${fmtNumber(wh, 0)} Wh`;
}

const PRESET_IDS = ['today', 'yesterday', '7d', '30d', '90d', 'mtd', 'ytd'];

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
  const ls = (globalThis as { localStorage?: LocalStorageLike }).localStorage;
  if (ls && typeof ls.getItem === 'function' && typeof ls.setItem === 'function') {
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
    if (!parsed || !isValidIsoDate(parsed.start) || !isValidIsoDate(parsed.end)) {
      return null;
    }
    if (parsed.start > parsed.end) {
      return null;
    }
    return { start: parsed.start, end: parsed.end };
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
  const { defaultPresetId = '30d', persistKey, minDate } = opts;

  const fallback = useMemo<RangeValue>(() => {
    const preset = getDatePreset(defaultPresetId) ?? getDatePreset('30d');
    if (preset?.id === 'all') {
      const r = preset.resolve();
      return { start: resolveAllTimeStart(minDate), end: r.end };
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

  return { start: range.start, end: range.end, presetId, setRange };
}

/* ── FadeIn (web @/components/motion FadeIn) ───────────── */

function FadeIn({
  children,
  delay = 0,
}: {
  children: ReactNode;
  delay?: number;
}) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(opacity, {
      toValue: 1,
      duration: 220,
      delay: Math.round(delay * 1000),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [opacity, delay]);

  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
}

/* ── StaggerContainer / StaggerItem (web @/components/motion) ── */

// The parent FadeIn supplies the mount fade; the per-item stagger collapses to
// plain layout wrappers (container = pass-through, item = grid cell).
function StaggerContainer({ children }: { children: ReactNode }) {
  return <View style={styles.statGrid}>{children}</View>;
}

function StaggerItem({ children }: { children: ReactNode }) {
  return <View style={styles.statCell}>{children}</View>;
}

/* ── PageContainer (web @/components/layout PageContainer) ── */

function PageContainer({
  title,
  subtitle,
  loading,
  error,
  children,
}: {
  title: string;
  subtitle?: string;
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
        <AppText variant="title" weight="bold">
          {title}
        </AppText>
        {subtitle ? (
          <AppText style={styles.pageSubtitle} tone="muted" variant="caption">
            {subtitle}
          </AppText>
        ) : null}
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

/* ── RefreshButton (web @/components/ui Button) ────────── */

function RefreshButton({
  label,
  loading,
  onPress,
}: {
  label: string;
  loading: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ busy: loading, disabled: loading }}
      disabled={loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.refreshButton,
        loading && styles.refreshButtonDisabled,
        pressed && !loading && styles.refreshButtonPressed,
      ]}>
      {loading ? (
        <ActivityIndicator color={colors.accent} size="small" />
      ) : (
        <SemanticIcon decorative name="refresh" size="sm" />
      )}
      <AppText style={styles.refreshLabel} weight="semibold">
        {label}
      </AppText>
    </Pressable>
  );
}

/* ── Badge (web @/components/ui Badge) ─────────────────── */

type BadgeVariant = 'success' | 'danger' | 'warning' | 'info' | 'neutral';

function Badge({ label, variant }: { label: string; variant: BadgeVariant }) {
  return (
    <View style={[styles.badge, badgeSurfaceStyles[variant]]}>
      <View style={[styles.badgeDot, badgeDotStyles[variant]]} />
      <AppText
        style={badgeTextStyles[variant]}
        variant="caption"
        weight="semibold">
        {label}
      </AppText>
    </View>
  );
}

/* ── ChartContainer (web @/components/charts ChartContainer) ── */

function ChartContainer({
  title,
  subtitle,
  ariaLabel,
  loading,
  empty,
  height = 300,
  children,
}: {
  title: string;
  subtitle?: string;
  ariaLabel: string;
  loading?: boolean;
  empty?: boolean;
  height?: number;
  children: ReactNode;
}) {
  const t = useNativeTranslation();
  return (
    <GlassPanel
      accessibilityLabel={`${title}. ${ariaLabel}`}
      style={styles.chartPanel}>
      <View style={styles.chartTitleBlock}>
        <AppText variant="body" weight="semibold">
          {title}
        </AppText>
        {subtitle ? (
          <AppText style={styles.chartSubtitle} tone="muted" variant="caption">
            {subtitle}
          </AppText>
        ) : null}
      </View>
      <View style={[styles.chartBody, { minHeight: height }]}>
        {loading ? (
          <View style={styles.chartCentered}>
            <ActivityIndicator color={colors.accent} size="small" />
          </View>
        ) : empty ? (
          <View style={styles.chartCentered}>
            <SemanticIcon decorative name="trends" size="lg" />
            <AppText style={styles.emptyMessage} tone="muted">
              {t('chart.noData', 'No data available')}
            </AppText>
          </View>
        ) : (
          children
        )}
      </View>
    </GlassPanel>
  );
}

/* ───────── EmptyState (web @/components/feedback EmptyState) ───────── */

function EmptyState({
  icon,
  message,
}: {
  icon: SemanticIconName;
  message: string;
}) {
  return (
    <View accessibilityRole="summary" style={styles.empty}>
      <SemanticIcon decorative name={icon} size="lg" style={styles.emptyIcon} />
      <AppText style={styles.emptyMessage} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

/* ───────── Power Flow Arrows ───────── */

interface FlowArrowProps {
  from: string;
  to: string;
  power: number | null;
  active: boolean;
}

function FlowArrow({ from, to, power, active }: FlowArrowProps) {
  const textStyle = active ? styles.flowTextActive : styles.flowTextInactive;
  return (
    <View
      style={[
        styles.flowArrow,
        active ? styles.flowArrowActive : styles.flowArrowInactive,
      ]}>
      <AppText style={textStyle} variant="caption" weight="semibold">
        {from}
      </AppText>
      <AppText style={textStyle} variant="caption" weight="semibold">
        {(power ?? 0) >= 0 ? '↓' : '↑'}
      </AppText>
      <AppText style={textStyle} variant="caption" weight="semibold">
        {to}
      </AppText>
      <AppText style={[styles.flowValue, textStyle]} variant="caption">
        {fmtWatts(power)}
      </AppText>
    </View>
  );
}

/* ───────── Main Page ───────── */

// Use a fixed energy_site_id input for now; a future picker can select from multiple sites.
const DEFAULT_SITE_ID = 1;

const POWER_SERIES_COLORS = {
  solar: '#f59e0b',
  battery: '#22c55e',
  grid: '#a855f7',
  load: '#3b82f6',
} as const;

export default function PowerFlowDashboardPage() {
  const t = useNativeTranslation();
  usePageTitle(t('powerFlow.title', 'Power Flow'));

  const [siteId] = useState(DEFAULT_SITE_ID);
  const { start: since, end: until, presetId, setRange } = useRangeState({
    persistKey: 'power-flow.range',
    defaultPresetId: '7d',
  });

  const { data: liveStatus, isLoading: liveLoading } = useTeslaEnergyLiveStatus(siteId);
  const { data: history, isLoading: historyLoading } = useTeslaEnergyLiveStatusHistory(
    siteId, since, until, 1000,
  );
  const refreshMutation = useRefreshTeslaEnergyLiveStatus();

  // Safely handle the case where liveStatus is a "no data" message (not a real snapshot)
  const hasLiveData = liveStatus && 'id' in liveStatus;
  const live = hasLiveData ? (liveStatus as TeslaEnergyLiveStatus) : null;

  const chartData = useMemo(() => {
    return (history ?? []).map(s => ({
      time: new Date(s.timestamp).getTime(),
      label: formatDateTime(s.timestamp),
      solar: s.solar_power ?? 0,
      battery: s.battery_power ?? 0,
      grid: s.grid_power ?? 0,
      load: s.load_power ?? 0,
      soc: s.percentage_charged ?? 0,
    }));
  }, [history]);

  const isLoading = liveLoading;

  const solarW = live?.solar_power ?? null;
  const batteryW = live?.battery_power ?? null;
  const loadW = live?.load_power ?? null;
  const gridW = live?.grid_power ?? null;
  const soc = live?.percentage_charged ?? null;
  const gridStatus = live?.grid_status ?? null;
  const stormMode = live?.storm_mode_active ?? false;

  const powerSeries = useMemo(
    () => [
      { key: 'solar', label: t('powerFlow.solar', 'Solar'), color: POWER_SERIES_COLORS.solar },
      { key: 'battery', label: t('powerFlow.batteryLabel', 'Battery'), color: POWER_SERIES_COLORS.battery },
      { key: 'grid', label: t('powerFlow.grid', 'Grid'), color: POWER_SERIES_COLORS.grid },
      { key: 'load', label: t('powerFlow.home', 'Home'), color: POWER_SERIES_COLORS.load },
    ],
    [t],
  );

  const socSeries = useMemo(
    () => [
      {
        key: 'soc',
        label: t('powerFlow.stateOfCharge', 'State of Charge'),
        color: CHART_COLORS[1],
      },
    ],
    [t],
  );

  const xFormatter = useCallback(
    (raw: string) => formatDateShort(new Date(Number(raw))),
    [],
  );

  return (
    <PageContainer
      title={t('powerFlow.title', 'Power Flow')}
      subtitle={t('powerFlow.subtitle', 'Real-time power flow from your Tesla Energy system')}
      loading={isLoading}>
      {/* Refresh button */}
      <View style={styles.refreshRow}>
        <RefreshButton
          label={t('powerFlow.refresh', 'Refresh from Tesla')}
          loading={refreshMutation.isPending}
          onPress={() => refreshMutation.mutate(siteId)}
        />
      </View>

      {/* Status Badges */}
      <FadeIn>
        <View style={styles.badgeRow}>
          <Badge
            label={`${t('powerFlow.grid', 'Grid')}: ${gridStatus ?? '—'}`}
            variant={gridStatus === 'Active' ? 'success' : 'danger'}
          />
          {stormMode ? (
            <Badge
              label={t('powerFlow.stormMode', 'Storm Mode Active')}
              variant="warning"
            />
          ) : null}
          {live?.backup_capable ? (
            <Badge
              label={t('powerFlow.backupCapable', 'Backup Capable')}
              variant="info"
            />
          ) : null}
          {live ? (
            <Badge
              label={`${t('powerFlow.lastUpdate', 'Updated')}: ${formatDateTime(live.timestamp)}`}
              variant="neutral"
            />
          ) : null}
        </View>
      </FadeIn>

      {/* Stat Cards — current power */}
      <FadeIn delay={0.05}>
        <StaggerContainer>
          <StaggerItem>
            <StatCard
              icon={<SemanticIcon decorative name="sun" size="sm" />}
              label={t('powerFlow.solarPower', 'Solar Production')}
              loading={isLoading}
              value={fmtWatts(solarW)}
            />
          </StaggerItem>
          <StaggerItem>
            <StatCard
              icon={<SemanticIcon decorative name="battery" size="sm" />}
              label={t('powerFlow.batteryPower', 'Battery')}
              loading={isLoading}
              unit={(batteryW ?? 0) < 0 ? t('powerFlow.charging', 'Charging') : (batteryW ?? 0) > 0 ? t('powerFlow.discharging', 'Discharging') : undefined}
              value={fmtWatts(batteryW)}
            />
          </StaggerItem>
          <StaggerItem>
            <StatCard
              icon={<SemanticIcon decorative name="home" size="sm" />}
              label={t('powerFlow.homeConsumption', 'Home Consumption')}
              loading={isLoading}
              value={fmtWatts(loadW)}
            />
          </StaggerItem>
          <StaggerItem>
            <StatCard
              icon={<SemanticIcon decorative name="bolt" size="sm" />}
              label={t('powerFlow.gridPower', 'Grid')}
              loading={isLoading}
              unit={(gridW ?? 0) > 0 ? t('powerFlow.importing', 'Importing') : (gridW ?? 0) < 0 ? t('powerFlow.exporting', 'Exporting') : undefined}
              value={fmtWatts(gridW)}
            />
          </StaggerItem>
        </StaggerContainer>
      </FadeIn>

      {/* Battery SOC + Energy Left */}
      <FadeIn delay={0.1}>
        <View style={styles.panelGrid}>
          <GlassPanel style={styles.panel}>
            <AppText style={styles.panelTitle} tone="secondary" variant="caption" weight="semibold">
              {t('powerFlow.batteryState', 'Battery State')}
            </AppText>
            {live ? (
              <View style={styles.batteryBody}>
                <View style={styles.batteryRow}>
                  <AppText>{t('powerFlow.stateOfCharge', 'State of Charge')}</AppText>
                  <AppText variant="body" weight="bold">
                    {soc != null ? `${fmtNumber(soc, 1)}%` : '—'}
                  </AppText>
                </View>
                {soc != null ? (
                  <View style={styles.progressTrack}>
                    <View
                      style={[
                        styles.progressFill,
                        { width: `${Math.min(soc, 100)}%` as DimensionValue },
                      ]}
                    />
                  </View>
                ) : null}
                <View style={styles.batteryRow}>
                  <AppText>{t('powerFlow.energyLeft', 'Energy Remaining')}</AppText>
                  <AppText>{fmtWh(live.energy_left)}</AppText>
                </View>
                <View style={styles.batteryRow}>
                  <AppText>{t('powerFlow.totalCapacity', 'Total Capacity')}</AppText>
                  <AppText>{fmtWh(live.total_pack_energy)}</AppText>
                </View>
              </View>
            ) : (
              <EmptyState
                icon="battery"
                message={t('powerFlow.noBatteryData', 'No battery data — refresh to fetch')}
              />
            )}
          </GlassPanel>

          {/* Power Flow Diagram */}
          <GlassPanel style={styles.panel}>
            <AppText style={styles.panelTitle} tone="secondary" variant="caption" weight="semibold">
              {t('powerFlow.flowDiagram', 'Power Flow')}
            </AppText>
            {live ? (
              <View style={styles.flowList}>
                <FlowArrow
                  active={(solarW ?? 0) > 0}
                  from={t('powerFlow.solar', 'Solar')}
                  power={solarW}
                  to={t('powerFlow.home', 'Home')}
                />
                <FlowArrow
                  active={(batteryW ?? 0) !== 0}
                  from={t('powerFlow.batteryLabel', 'Battery')}
                  power={batteryW}
                  to={t('powerFlow.home', 'Home')}
                />
                <FlowArrow
                  active={(gridW ?? 0) !== 0}
                  from={t('powerFlow.grid', 'Grid')}
                  power={gridW}
                  to={t('powerFlow.home', 'Home')}
                />
                {(live.grid_services_power ?? 0) !== 0 ? (
                  <FlowArrow
                    active
                    from={t('powerFlow.gridServices', 'Grid Services')}
                    power={live.grid_services_power}
                    to={t('powerFlow.grid', 'Grid')}
                  />
                ) : null}
              </View>
            ) : (
              <EmptyState
                icon="activity"
                message={t('powerFlow.noFlowData', 'No power flow data yet')}
              />
            )}
          </GlassPanel>
        </View>
      </FadeIn>

      {/* Historical Charts */}
      <FadeIn delay={0.15}>
        <View style={styles.historySection}>
          <View style={styles.historyHeader}>
            <AppText variant="body" weight="bold">
              {t('powerFlow.history', 'Power History')}
            </AppText>
            <DatePresetChips
              activeId={presetId}
              onSelect={(sel: DatePresetSelection) =>
                setRange({ start: sel.start, end: sel.end })
              }
              presetIds={PRESET_IDS}
              testID="power-flow-range"
            />
          </View>

          {/* Stacked Power Area Chart */}
          <ChartContainer
            ariaLabel={t('powerFlow.powerOverTime.aria', 'Solar, battery, grid, and home power flow stacked area chart over time')}
            empty={chartData.length === 0}
            height={350}
            loading={historyLoading}
            subtitle={t('powerFlow.powerOverTimeDesc', 'Solar, battery, and grid power flow')}
            title={t('powerFlow.powerOverTime', 'Power Over Time')}>
            <AreaChartWrapper
              data={chartData}
              height={350}
              series={powerSeries}
              xFormatter={xFormatter}
              xKey="time"
              yFormatter={fmtWatts}
            />
          </ChartContainer>
        </View>
      </FadeIn>

      {/* Battery SOC Over Time */}
      <FadeIn delay={0.2}>
        <View style={styles.historySection}>
          <ChartContainer
            ariaLabel={t('powerFlow.socOverTime.aria', 'Battery state of charge percentage over time line chart')}
            empty={chartData.length === 0}
            height={250}
            loading={historyLoading}
            subtitle={t('powerFlow.socOverTimeDesc', 'Battery percentage over time')}
            title={t('powerFlow.socOverTime', 'Battery State of Charge')}>
            <AreaChartWrapper
              data={chartData}
              height={250}
              series={socSeries}
              xFormatter={xFormatter}
              xKey="time"
              yFormatter={(v: number) => `${v}%`}
            />
          </ChartContainer>
        </View>
      </FadeIn>
    </PageContainer>
  );
}

/* ── styles ────────────────────────────────────────────── */

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
    gap: spacing.xs,
  },
  pageSubtitle: {
    marginTop: 2,
  },
  loadingBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xxl,
  },
  errorBox: {
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerSurface,
    borderRadius: 16,
    padding: spacing.md,
  },
  errorText: {
    color: colors.danger,
  },
  refreshRow: {
    alignItems: 'flex-end',
  },
  refreshButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  refreshButtonDisabled: {
    opacity: 0.6,
  },
  refreshButtonPressed: {
    opacity: 0.82,
  },
  refreshLabel: {
    color: colors.textPrimary,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  badgeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  statCell: {
    flexBasis: '47%',
    flexGrow: 1,
    minWidth: 150,
  },
  panelGrid: {
    gap: spacing.md,
  },
  panel: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  panelTitle: {
    letterSpacing: 0.4,
  },
  batteryBody: {
    gap: spacing.md,
  },
  batteryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progressTrack: {
    width: '100%',
    height: 12,
    borderRadius: 999,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  progressFill: {
    height: 12,
    borderRadius: 999,
    backgroundColor: colors.success,
  },
  flowList: {
    gap: spacing.sm,
  },
  flowArrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: 12,
    borderWidth: 1,
  },
  flowArrowActive: {
    backgroundColor: colors.surfaceSelected,
    borderColor: colors.borderAccent,
  },
  flowArrowInactive: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
  flowTextActive: {
    color: colors.accent,
  },
  flowTextInactive: {
    color: colors.textMuted,
  },
  flowValue: {
    marginLeft: 'auto',
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  emptyIcon: {
    marginBottom: spacing.xs,
  },
  emptyMessage: {
    textAlign: 'center',
  },
  historySection: {
    gap: spacing.md,
  },
  historyHeader: {
    gap: spacing.sm,
  },
  chartPanel: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  chartTitleBlock: {
    gap: spacing.xs,
  },
  chartSubtitle: {
    marginTop: 2,
  },
  chartBody: {
    justifyContent: 'center',
  },
  chartCentered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
});

const badgeSurfaceStyles = StyleSheet.create<Record<BadgeVariant, ViewStyle>>({
  success: {
    backgroundColor: colors.successSurface,
    borderColor: colors.successBorder,
  },
  danger: {
    backgroundColor: colors.dangerSurface,
    borderColor: colors.dangerBorder,
  },
  warning: {
    backgroundColor: colors.warningSurface,
    borderColor: colors.warningBorder,
  },
  info: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.borderAccent,
  },
  neutral: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
});

const badgeDotStyles = StyleSheet.create<Record<BadgeVariant, ViewStyle>>({
  success: { backgroundColor: colors.success },
  danger: { backgroundColor: colors.danger },
  warning: { backgroundColor: colors.warning },
  info: { backgroundColor: colors.accent },
  neutral: { backgroundColor: colors.textMuted },
});

const badgeTextStyles = StyleSheet.create<Record<BadgeVariant, TextStyle>>({
  success: { color: colors.success },
  danger: { color: colors.danger },
  warning: { color: colors.warning },
  info: { color: colors.accent },
  neutral: { color: colors.textSecondary },
});
