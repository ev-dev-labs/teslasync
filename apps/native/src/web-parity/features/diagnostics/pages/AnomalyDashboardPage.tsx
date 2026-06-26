/**
 * Native parity port of web/src/features/diagnostics/pages/AnomalyDashboardPage.tsx.
 *
 * The web page is the "Anomaly Detection" dashboard: a four-up summary-stat row
 * (signals monitored / anomalies in 7d / anomalies in 24h / health categories),
 * two opt-in AI cards (anomaly explanations + learned per-vehicle baselines), a
 * System-Health category grid, a scrollable anomaly timeline, and a "Most
 * Frequent Anomalies" horizontal bar chart. It reads the globally-selected
 * vehicle, fetches /analytics/anomalies through the canonical useAnomalies
 * TanStack Query hook, derives a top-10 per-signal frequency memo, and gates
 * each section behind an EmptyState when its slice of the payload is missing.
 *
 * This native port preserves that contract 1:1 — the same useAnomalies hook +
 * exact API path, every state/derived name (selectedId / activeIdStr / data /
 * isLoading / error / signalFrequency / healthEntries), the verbatim
 * signalFrequency memo (freq map → entries → sort desc by count → slice(0,10)),
 * the healthEntries = Object.entries(health_summary ?? {}) derivation, the
 * severityVariant / statusColor / statusBg / typeLabel helpers, the HEALTH_ICONS
 * category→icon map, all six sections, and every i18n key + English fallback —
 * using React Native primitives, the existing native AppText / GlassPanel +
 * design tokens, and the already-ported web-parity useAnomalies hook +
 * AIAnomalyExplanations / AILearnedAnomalyBaselines components.
 *
 * Browser-only / not-yet-ported dependencies are reduced explicitly and
 * documented in the `.parity.json` sidecar:
 *   - react-i18next `useTranslation` (web L2): no native i18next runtime, so an
 *     inline native-safe `t(key, fallback?)` returns the English fallback (else
 *     the key). Every key + intent is preserved verbatim.
 *   - lucide-react Shield/AlertTriangle/Activity/Zap/Thermometer/Car/Battery/
 *     Wind/ChevronRight (web L3-7): DOM SVG icons → semantic emoji glyph
 *     constants rendered through a colour-baked GlyphIcon (the MileagePage /
 *     SentryEventLogWidget icon→glyph precedent).
 *   - `@/components/layout` PageContainer (web L9): reproduced locally as a
 *     native-safe ScrollView scaffold honouring title / subtitle / loading /
 *     error / actions / children, gating the body behind the loading spinner
 *     and the error box exactly as the web container does.
 *   - `@/components/ui` GlassPanel/Badge (web L10): native GlassPanel is the
 *     existing port; Badge is reproduced locally as a native-safe pill
 *     (variant success/warning/danger + size, tinted from the design tokens).
 *   - `@/components/forms` VehicleSelect (web L11): a Pressable chip selector
 *     wired to the shared selected-vehicle store (the SmartChargePage precedent).
 *   - `@/components/data-display` StatCard/TimeStamp (web L12): StatCard → a
 *     native-safe card (label / value / icon); TimeStamp → a native-safe
 *     timestamp honouring the user's time_format_default (relative vs absolute,
 *     ported dateFormat), with the web hover tooltip alternate dropped (no hover
 *     on native) and the universal "—" placeholder for nullish/invalid input.
 *   - `@/components/charts` ChartTooltip/axisTickSm/CHART_COLORS/BarChart/Bar/
 *     XAxis/YAxis/Tooltip/ResponsiveContainer (web L13-16): Recharts has no
 *     native SVG backend, so the horizontal frequency bar chart is reproduced as
 *     a real View-based native chart (one row per signal: a fixed-width label +
 *     a proportional CHART_COLORS[3] bar + the count), preserving the data shape,
 *     the bar colour, and the Math.max(200, len*35) height budget. The numeric
 *     XAxis ticks + hover ChartTooltip are dropped (no hover on native); the
 *     count is shown inline on each bar instead. CHART_COLORS is imported from
 *     the native charts module to keep the exact CHART_COLORS[3] fill.
 *   - `@/components/feedback` EmptyState (web L17): native-safe message-only
 *     empty state with an optional icon slot.
 *   - `@/components/motion` FadeIn/StaggerContainer/StaggerItem (web L18):
 *     framer-motion entrance/stagger → a static passthrough FadeIn (the `delay`
 *     prop is accepted but inert), a StaggerContainer two-column wrap grid
 *     (matching the web base grid-cols-2), and a StaggerItem cell.
 *   - `@/api/hooks/useAnomalies` + `type AnomalyEntry` (web L20): imported from
 *     the already-ported native ../../../api/hooks/useAnomalies (identical
 *     /analytics/anomalies?vehicle_id=&days= path + AnomalyData/AnomalyEntry
 *     shapes).
 *   - `@/components/ai/AIAnomalyExplanations` + `AILearnedAnomalyBaselines`
 *     (web L21-22): imported from the already-ported web-parity components (same
 *     opt-in withAiFeature gate + vehicleId prop).
 *   - `@/hooks/useSelectedVehicle` (web L23): the web hook layers react-router
 *     params over a zustand store; native has neither, so a native-safe hook
 *     derives the selection from the ported useVehicles() list via a shared
 *     module-level external store, preserving the `vehicleId` contract.
 *   - `@/hooks/usePageTitle` (web L24): document.title is browser-only → a
 *     documented no-op (the native navigator owns the title).
 *   - `@/lib/numberFormat` fmtNumber (web L25): ported native-safe (safeNumber
 *     guard + toLocaleString, default precision 2).
 *   - `@/lib/cn` cn (web L26): the className class-merge is irrelevant to React
 *     Native StyleSheet composition, so it is dropped — styles are composed via
 *     style arrays instead.
 *
 * No DOM/Recharts/Leaflet/lucide/react-router/old-web-UI imports remain.
 */
import React, {
  useCallback,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {ActivityIndicator, Pressable, ScrollView, StyleSheet, View} from 'react-native';

import {AIAnomalyExplanations} from '../../../components/ai/AIAnomalyExplanations';
import {AILearnedAnomalyBaselines} from '../../../components/ai/AILearnedAnomalyBaselines';
import {CHART_COLORS} from '../../../components/charts';
import {useAnomalies, type AnomalyEntry} from '../../../api/hooks/useAnomalies';
import {useSettings} from '../../../api/hooks/useSettings';
import {useVehicles, type Vehicle} from '../../../api/hooks/useVehicles';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing, typography} from '../../../../theme/tokens';

/* ------------------------------------------------------------------ */
/*  lucide-react icon stand-ins (web L3-7)                             */
/* ------------------------------------------------------------------ */

const ICON_SHIELD = '\uD83D\uDEE1'; // 🛡 (Shield)
const ICON_ALERT_TRIANGLE = '\u26A0'; // ⚠ (AlertTriangle)
const ICON_ACTIVITY = '\uD83D\uDCC8'; // 📈 (Activity)
const ICON_ZAP = '\u26A1'; // ⚡ (Zap)
const ICON_THERMOMETER = '\uD83C\uDF21'; // 🌡 (Thermometer)
const ICON_CAR = '\uD83D\uDE97'; // 🚗 (Car)
const ICON_BATTERY = '\uD83D\uDD0B'; // 🔋 (Battery)
const ICON_WIND = '\uD83D\uDCA8'; // 💨 (Wind)
const ICON_CHEVRON_RIGHT = '\u203A'; // › (ChevronRight)

const SIGMA = '\u03C3'; // σ (z-score suffix, web L222)

/* Tailwind tints used by the web statusColor / section icons. */
const RED_400 = '#f87171'; // text-red-400
const AMBER_300 = '#fcd34d'; // text-amber-300
const EMERALD_300 = '#6ee7b7'; // text-emerald-300
const NEON_AMBER = '#f59e0b'; // text-neon-amber (web tailwind neon.amber)

/* ------------------------------------------------------------------ */
/*  native-safe i18n (react-i18next has no native runtime, web L2)     */
/* ------------------------------------------------------------------ */

type NativeTFunction = (key: string, fallback?: string) => string;

/** Mirrors `t(key, default?)`: the English default else the key. */
function useNativeTranslation(): NativeTFunction {
  return useMemo<NativeTFunction>(() => (key, fallback) => fallback ?? key, []);
}

/* ------------------------------------------------------------------ */
/*  native-safe usePageTitle (web document.title is browser-only)      */
/* ------------------------------------------------------------------ */

function usePageTitle(_title: string): void {
  // The web hook writes document.title; on native the navigator owns the header
  // title, so the resolved title is intentionally not applied here.
}

/* ------------------------------------------------------------------ */
/*  ported number formatter (web @/lib/numberFormat fmtNumber)         */
/* ------------------------------------------------------------------ */

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** fmtNumber — locale-aware, default precision 2 (web/src/lib/numberFormat.ts). */
function fmtNumber(v: unknown, decimals = 2): string {
  try {
    return safeNumber(v).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(v).toFixed(decimals);
  }
}

/* ------------------------------------------------------------------ */
/*  ported date formatters (web @/lib/dateFormat via TimeStamp)        */
/* ------------------------------------------------------------------ */

/** formatDateTime — "Apr 4, 2026, 2:30 AM" else "—" (web formatDateTime). */
function formatDateTimeNative(date: Date, locale: string): string {
  try {
    return date.toLocaleString(locale || undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}

/** formatRelative — "Just now" / "{n}m ago" / … else absolute (web formatRelative). */
function formatRelativeNative(date: Date, locale: string): string {
  const diffMs = Date.now() - date.getTime();
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) {
    return 'Just now';
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m ago`;
  }
  if (seconds < 86_400) {
    return `${Math.floor(seconds / 3600)}h ago`;
  }
  if (seconds < 604_800) {
    return `${Math.floor(seconds / 86_400)}d ago`;
  }
  return formatDateTimeNative(date, locale);
}

/* ------------------------------------------------------------------ */
/*  native-safe useSelectedVehicle (web @/hooks/useSelectedVehicle)    */
/* ------------------------------------------------------------------ */

interface SelectedVehicleResult {
  vehicleId: number | null;
  vehicles: Vehicle[];
  setVehicleId: (id: number | null) => void;
}

// Module-level shared selection store (the SmartChargePage precedent). The web
// hook persists the picker choice in a zustand store so the header VehicleSelect
// and the page body stay in sync; native reproduces that single source of truth
// with a tiny external store. Router path/query precedence is dropped (no router).
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
/*  Helpers (web L30-63)                                               */
/* ------------------------------------------------------------------ */

const HEALTH_ICONS: Record<string, string> = {
  battery: ICON_BATTERY,
  tires: ICON_CAR,
  motors: ICON_ZAP,
  hvac: ICON_WIND,
  charging: ICON_ACTIVITY,
};

type BadgeVariant = 'success' | 'warning' | 'danger';

function severityVariant(s: string): BadgeVariant {
  if (s === 'critical') {
    return 'danger';
  }
  if (s === 'warning') {
    return 'warning';
  }
  return 'success';
}

function statusColor(s: string): string {
  if (s === 'critical') {
    return RED_400;
  }
  if (s === 'warning') {
    return AMBER_300;
  }
  return EMERALD_300;
}

interface TintStyle {
  backgroundColor: string;
  borderColor: string;
}

// web statusBg: critical bg-red-500/10 border-red-500/20, warning
// bg-neon-amber/10 border-neon-amber/20, else bg-neon-green/10 border-neon-green/20.
function statusBg(s: string): TintStyle {
  if (s === 'critical') {
    return {
      backgroundColor: 'rgba(239, 68, 68, 0.1)',
      borderColor: 'rgba(239, 68, 68, 0.2)',
    };
  }
  if (s === 'warning') {
    return {
      backgroundColor: 'rgba(245, 158, 11, 0.1)',
      borderColor: 'rgba(245, 158, 11, 0.2)',
    };
  }
  return {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderColor: 'rgba(16, 185, 129, 0.2)',
  };
}

// web timeline card: critical bg-red-500/[0.05] border-red-500/15, warning
// bg-neon-amber/[0.05] border-neon-amber/15, else bg-white/[0.02] border-white/[0.06].
function anomalyTint(severity: string): TintStyle {
  if (severity === 'critical') {
    return {
      backgroundColor: 'rgba(239, 68, 68, 0.05)',
      borderColor: 'rgba(239, 68, 68, 0.15)',
    };
  }
  if (severity === 'warning') {
    return {
      backgroundColor: 'rgba(245, 158, 11, 0.05)',
      borderColor: 'rgba(245, 158, 11, 0.15)',
    };
  }
  return {
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
    borderColor: 'rgba(255, 255, 255, 0.06)',
  };
}

function typeLabel(type: string): string {
  switch (type) {
    case 'z_score':
      return 'Statistical';
    case 'range':
      return 'Range';
    case 'trend':
      return 'Trend';
    default:
      return type;
  }
}

function capitalize(value: string): string {
  return value.length > 0 ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

/* ------------------------------------------------------------------ */
/*  native GlyphIcon (lucide icon -> colour-baked glyph)               */
/* ------------------------------------------------------------------ */

interface GlyphIconProps {
  glyph: string;
  color?: string;
  size?: number;
}

function GlyphIcon({glyph, color = colors.textMuted, size = 16}: GlyphIconProps) {
  return (
    <AppText
      importantForAccessibility="no-hide-descendants"
      style={[styles.glyph, {color, fontSize: size, lineHeight: size + 4}]}>
      {glyph}
    </AppText>
  );
}

/* ------------------------------------------------------------------ */
/*  native Badge (web @/components/ui Badge)                            */
/* ------------------------------------------------------------------ */

const BADGE_TINTS: Record<BadgeVariant, {color: string; tint: TintStyle}> = {
  success: {
    color: colors.success,
    tint: {backgroundColor: colors.successSurface, borderColor: colors.successBorder},
  },
  warning: {
    color: colors.warning,
    tint: {backgroundColor: colors.warningSurface, borderColor: colors.warningBorder},
  },
  danger: {
    color: colors.danger,
    tint: {backgroundColor: colors.dangerSurface, borderColor: colors.dangerBorder},
  },
};

function Badge({variant, children}: {variant: BadgeVariant; children: string}) {
  const {color, tint} = BADGE_TINTS[variant];
  return (
    <View style={[styles.badge, tint]}>
      <AppText numberOfLines={1} style={[styles.badgeText, {color}]} variant="caption" weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native StatCard (web @/components/data-display StatCard)            */
/* ------------------------------------------------------------------ */

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: ReactNode;
}

function StatCard({label, value, icon}: StatCardProps) {
  return (
    <View style={styles.statCard}>
      <View style={styles.statHeader}>
        <AppText numberOfLines={1} style={styles.statLabel} tone="muted" variant="caption">
          {label}
        </AppText>
        {icon ? <View style={styles.statIcon}>{icon}</View> : null}
      </View>
      <AppText numberOfLines={1} style={styles.statValue} weight="bold">
        {value}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native TimeStamp (web @/components/data-display TimeStamp)          */
/* ------------------------------------------------------------------ */

function TimeStamp({value}: {value: string | number | Date | null | undefined}) {
  const {data: settings} = useSettings();
  const locale = settings?.locale ?? settings?.language ?? '';
  const pref = settings?.time_format_default === 'absolute' ? 'absolute' : 'relative';

  let text = '\u2014';
  if (value != null) {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(date.getTime())) {
      text =
        pref === 'relative'
          ? formatRelativeNative(date, locale)
          : formatDateTimeNative(date, locale);
    }
  }

  return (
    <AppText style={styles.metaText} tone="muted" variant="caption">
      {text}
    </AppText>
  );
}

/* ------------------------------------------------------------------ */
/*  native EmptyState (web @/components/feedback EmptyState)            */
/* ------------------------------------------------------------------ */

interface EmptyStateProps {
  icon?: ReactNode;
  message: string;
  testID?: string;
}

function EmptyState({icon, message, testID}: EmptyStateProps) {
  return (
    <View style={styles.emptyState} testID={testID}>
      {icon ? <View style={styles.emptyStateIcon}>{icon}</View> : null}
      <AppText style={styles.emptyStateMessage} tone="muted" variant="caption">
        {message}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native motion (web @/components/motion FadeIn/Stagger)              */
/* ------------------------------------------------------------------ */

function FadeIn({children}: {children: ReactNode; delay?: number}) {
  return <View style={styles.section}>{children}</View>;
}

// web StaggerContainer className="grid grid-cols-2 ... lg:grid-cols-4" → a
// two-column wrap grid (the phone base breakpoint); StaggerItem is one cell.
function StaggerContainer({children}: {children: ReactNode}) {
  return <View style={styles.statGrid}>{children}</View>;
}

function StaggerItem({children}: {children: ReactNode}) {
  return <View style={styles.statCell}>{children}</View>;
}

/* ------------------------------------------------------------------ */
/*  native VehicleSelect (web @/components/forms VehicleSelect)         */
/* ------------------------------------------------------------------ */

function VehicleSelect() {
  const {vehicleId, vehicles, setVehicleId} = useSelectedVehicle();

  if (vehicles.length === 0) {
    return null;
  }

  return (
    <View style={styles.vehicleSelect} testID="vehicle-select">
      {vehicles.map(v => {
        const active = v.id === vehicleId;
        const label = v.display_name || v.vin || `Vehicle ${v.id}`;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{selected: active}}
            hitSlop={4}
            key={v.id}
            onPress={() => setVehicleId(v.id)}
            style={[styles.vehicleChip, active && styles.vehicleChipActive]}>
            <AppText
              numberOfLines={1}
              style={[styles.vehicleChipText, active && styles.vehicleChipTextActive]}
              variant="caption">
              {label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  native PageContainer (web @/components/layout PageContainer)        */
/* ------------------------------------------------------------------ */

interface PageContainerProps {
  title: string;
  subtitle?: string;
  loading?: boolean;
  error?: Error | null;
  actions?: ReactNode;
  children: ReactNode;
  testID?: string;
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
    <ScrollView contentContainerStyle={styles.scaffold} testID={testID ?? 'anomaly-dashboard-page'}>
      <View style={styles.scaffoldHeader}>
        <View style={styles.scaffoldHeaderText}>
          <AppText style={styles.scaffoldTitle} variant="title" weight="bold">
            {title}
          </AppText>
          {subtitle ? (
            <AppText style={styles.scaffoldSubtitle} tone="muted">
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {actions ? <View style={styles.scaffoldActions}>{actions}</View> : null}
      </View>

      {loading ? (
        <View style={styles.loading} testID="anomaly-loading">
          <ActivityIndicator color={colors.accent} size="large" />
        </View>
      ) : error ? (
        <View style={styles.errorBox} testID="anomaly-error">
          <AppText style={styles.errorText} variant="caption">
            {error.message}
          </AppText>
        </View>
      ) : (
        <View style={styles.scaffoldBody}>{children}</View>
      )}
    </ScrollView>
  );
}

/* ------------------------------------------------------------------ */
/*  native AnomalyFrequencyChart (web @/components/charts BarChart)     */
/* ------------------------------------------------------------------ */

interface FrequencyRow {
  signal: string;
  count: number;
}

const BAR_FILL = CHART_COLORS[3]; // web fill={CHART_COLORS[3]}

function AnomalyFrequencyChart({data, label}: {data: FrequencyRow[]; label: string}) {
  const maxCount = useMemo(
    () => data.reduce((max, row) => Math.max(max, row.count), 0) || 1,
    [data],
  );
  // web ResponsiveContainer height={Math.max(200, signalFrequency.length * 35)}.
  const minHeight = Math.max(200, data.length * 35);

  return (
    <View accessibilityLabel={label} style={[styles.chart, {minHeight}]}>
      {data.map(row => {
        const pct = Math.max((row.count / maxCount) * 100, 4);
        return (
          <View key={row.signal} style={styles.chartRow}>
            <AppText numberOfLines={1} style={styles.chartLabel} tone="secondary" variant="caption">
              {row.signal}
            </AppText>
            <View style={styles.chartTrack}>
              <View style={[styles.chartBar, {backgroundColor: BAR_FILL, width: `${pct}%`}]} />
            </View>
            <AppText style={styles.chartCount} variant="caption" weight="semibold">
              {row.count}
            </AppText>
          </View>
        );
      })}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Page (web L67-267)                                                 */
/* ------------------------------------------------------------------ */

export default function AnomalyDashboardPage() {
  const t = useNativeTranslation();
  usePageTitle(t('anomaly.title', 'Anomaly Detection'));

  const {vehicleId: selectedId} = useSelectedVehicle();
  const activeIdStr = selectedId != null ? String(selectedId) : null;

  const {data, isLoading, error} = useAnomalies(activeIdStr);

  /* Anomaly frequency by signal (for bar chart) */
  const signalFrequency = useMemo(() => {
    const freq: Record<string, number> = {};
    for (const a of data?.anomalies ?? []) {
      freq[a.signal] = (freq[a.signal] ?? 0) + 1;
    }
    return Object.entries(freq)
      .map(([signal, count]) => ({signal, count}))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [data]);

  const healthEntries = Object.entries(data?.health_summary ?? {});

  return (
    <PageContainer
      title={t('anomaly.title', 'Anomaly Detection')}
      subtitle={t('anomaly.subtitle', 'Automatic health monitoring and signal anomaly detection')}
      loading={isLoading}
      error={error}
      actions={<VehicleSelect />}>
      {/* ── Summary Stats ──────────────────────────────── */}
      <FadeIn>
        <StaggerContainer>
          <StaggerItem>
            <StatCard
              label={t('anomaly.monitored', 'Signals Monitored')}
              value={data?.signals_monitored ?? 0}
              icon={<GlyphIcon glyph={ICON_ACTIVITY} />}
            />
          </StaggerItem>
          <StaggerItem>
            <StatCard
              label={t('anomaly.last7d', 'Anomalies (7d)')}
              value={data?.anomalies_last_7d ?? 0}
              icon={<GlyphIcon glyph={ICON_ALERT_TRIANGLE} />}
            />
          </StaggerItem>
          <StaggerItem>
            <StatCard
              label={t('anomaly.last24h', 'Anomalies (24h)')}
              value={data?.anomalies_last_24h ?? 0}
              icon={<GlyphIcon glyph={ICON_SHIELD} />}
            />
          </StaggerItem>
          <StaggerItem>
            <StatCard
              label={t('anomaly.categories', 'Health Categories')}
              value={healthEntries.length}
              icon={<GlyphIcon glyph={ICON_THERMOMETER} />}
            />
          </StaggerItem>
        </StaggerContainer>
      </FadeIn>

      {/* Opt-in AI anomaly explanation. Renders only when ai_mode != 'off' AND  */}
      {/* the anomaly-explanations toggle is on; the withAiFeature HOC inside     */}
      {/* AIAnomalyExplanations enforces the gate. The deterministic detector +   */}
      {/* safe-range messages below remain the canonical baseline (ADR-015 §I3).  */}
      <FadeIn delay={0.04}>
        <AIAnomalyExplanations vehicleId={selectedId ?? undefined} />
      </FadeIn>

      {/* Opt-in learned per-vehicle anomaly baselines. Renders only when         */}
      {/* ai_mode != 'off' AND the learned-baselines toggle is on; the            */}
      {/* withAiFeature HOC inside AILearnedAnomalyBaselines enforces the gate.    */}
      {/* The static safeRanges + Z-score detector remains the canonical baseline */}
      {/* and the per-signal fallback for the learned trainer (ADR-015 §I3).      */}
      <FadeIn delay={0.045}>
        <AILearnedAnomalyBaselines vehicleId={selectedId ?? undefined} />
      </FadeIn>

      {/* ── Health Summary Cards ───────────────────────── */}
      <FadeIn delay={0.05}>
        <GlassPanel style={styles.panel}>
          <AppText style={styles.panelTitle} weight="semibold">
            {t('anomaly.healthSummary', 'System Health')}
          </AppText>
          {healthEntries.length > 0 ? (
            <View style={styles.healthGrid}>
              {healthEntries.map(([category, status]) => {
                const glyph = HEALTH_ICONS[category] ?? ICON_SHIELD;
                return (
                  <View key={category} style={[styles.healthCard, statusBg(status)]}>
                    <GlyphIcon color={statusColor(status)} glyph={glyph} size={24} />
                    <AppText numberOfLines={1} style={styles.healthLabel} variant="caption" weight="semibold">
                      {capitalize(category)}
                    </AppText>
                    <Badge variant={severityVariant(status)}>{status}</Badge>
                  </View>
                );
              })}
            </View>
          ) : (
            // no-action: transient empty state — surfaces when source data is
            // missing; no specific recovery action available.
            <EmptyState message={t('anomaly.noHealth', 'Health data will appear once telemetry is available.')} />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── Anomaly Timeline ──────────────────────────── */}
      <FadeIn delay={0.1}>
        <GlassPanel style={styles.panel}>
          <View style={styles.panelTitleRow}>
            <GlyphIcon color={NEON_AMBER} glyph={ICON_ALERT_TRIANGLE} />
            <AppText style={styles.panelTitle} weight="semibold">
              {t('anomaly.timeline', 'Anomaly Timeline')}
            </AppText>
          </View>
          {(data?.anomalies ?? []).length > 0 ? (
            <View style={styles.timeline}>
              {(data?.anomalies ?? []).map((a: AnomalyEntry, i: number) => (
                <View key={`${a.signal}-${a.type}-${i}`} style={[styles.anomalyRow, anomalyTint(a.severity)]}>
                  <View style={styles.anomalyBadge}>
                    <Badge variant={severityVariant(a.severity)}>{a.severity}</Badge>
                  </View>
                  <View style={styles.anomalyBody}>
                    <View style={styles.anomalyHeader}>
                      <AppText style={styles.anomalySignal} weight="semibold">
                        {a.signal}
                      </AppText>
                      <View style={styles.typeChip}>
                        <AppText style={styles.typeChipText} tone="muted" variant="caption">
                          {typeLabel(a.type)}
                        </AppText>
                      </View>
                      {a.z_score > 0 ? (
                        <AppText style={styles.metaText} tone="muted" variant="caption">
                          {`${fmtNumber(a.z_score, 1)}${SIGMA}`}
                        </AppText>
                      ) : null}
                    </View>
                    <AppText style={styles.anomalyMessage} tone="secondary" variant="caption">
                      {a.message}
                    </AppText>
                    <View style={styles.anomalyMeta}>
                      <AppText style={styles.metaText} tone="muted" variant="caption">
                        {`${t('anomaly.value', 'Value')}: ${fmtNumber(a.value, 2)}`}
                      </AppText>
                      <AppText style={styles.metaText} tone="muted" variant="caption">
                        {`${t('anomaly.baseline', 'Baseline')}: ${fmtNumber(a.baseline, 2)}`}
                      </AppText>
                      <TimeStamp value={a.detected_at} />
                    </View>
                  </View>
                  <GlyphIcon glyph={ICON_CHEVRON_RIGHT} />
                </View>
              ))}
            </View>
          ) : (
            // no-action: transient empty state — surfaces when source data is
            // missing; no specific recovery action available.
            <EmptyState
              icon={<GlyphIcon glyph={ICON_SHIELD} size={32} />}
              message={t('anomaly.noAnomalies', 'No anomalies detected — all systems normal.')}
            />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── Anomaly Frequency by Signal ───────────────── */}
      <FadeIn delay={0.15}>
        <GlassPanel style={styles.panel}>
          <AppText style={styles.panelTitle} weight="semibold">
            {t('anomaly.frequency', 'Most Frequent Anomalies')}
          </AppText>
          {signalFrequency.length > 0 ? (
            <AnomalyFrequencyChart data={signalFrequency} label={t('anomaly.count', 'Anomalies')} />
          ) : (
            // no-action: transient empty state — surfaces when source data is
            // missing; no specific recovery action available.
            <EmptyState message={t('anomaly.noFrequency', 'Anomaly frequency data will appear after detection runs.')} />
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}

const styles = StyleSheet.create({
  scaffold: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  scaffoldHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  scaffoldHeaderText: {
    flex: 1,
    gap: spacing.xs,
  },
  scaffoldTitle: {
    color: colors.textPrimary,
  },
  scaffoldSubtitle: {
    color: colors.textMuted,
  },
  scaffoldActions: {
    flexShrink: 1,
    alignItems: 'flex-end',
  },
  scaffoldBody: {
    gap: spacing.lg,
  },
  loading: {
    paddingVertical: spacing.xxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBox: {
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerSurface,
    borderRadius: 16,
    padding: spacing.lg,
  },
  errorText: {
    color: colors.danger,
  },
  section: {
    gap: spacing.lg,
  },
  glyph: {
    textAlign: 'center',
  },
  /* StatCard + stagger grid */
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  statCell: {
    flexBasis: '47%',
    flexGrow: 1,
  },
  statCard: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceGlass,
    borderRadius: 18,
    padding: spacing.md,
    gap: spacing.sm,
  },
  statHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  statLabel: {
    flex: 1,
  },
  statIcon: {
    marginLeft: spacing.sm,
  },
  statValue: {
    color: colors.textPrimary,
    fontSize: typography.title,
    lineHeight: 28,
  },
  /* Badge */
  badge: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  badgeText: {
    textTransform: 'capitalize',
  },
  /* Panels */
  panel: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  panelTitle: {
    color: colors.textPrimary,
  },
  panelTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  /* Health grid */
  healthGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  healthCard: {
    flexBasis: '47%',
    flexGrow: 1,
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: 16,
    padding: spacing.md,
  },
  healthLabel: {
    color: colors.textPrimary,
  },
  /* Anomaly timeline */
  timeline: {
    gap: spacing.md,
  },
  anomalyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    borderWidth: 1,
    borderRadius: 16,
    padding: spacing.md,
  },
  anomalyBadge: {
    marginTop: 2,
  },
  anomalyBody: {
    flex: 1,
    gap: spacing.xs,
  },
  anomalyHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
  },
  anomalySignal: {
    color: colors.textPrimary,
  },
  typeChip: {
    borderRadius: 999,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: spacing.sm,
    paddingVertical: 1,
  },
  typeChipText: {
    fontSize: 10,
  },
  anomalyMessage: {
    marginTop: 2,
  },
  anomalyMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  metaText: {
    fontSize: 10,
  },
  /* Frequency chart */
  chart: {
    gap: spacing.sm,
    justifyContent: 'center',
  },
  chartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  chartLabel: {
    width: 140,
  },
  chartTrack: {
    flex: 1,
    height: 18,
    borderRadius: 6,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  chartBar: {
    height: '100%',
    borderTopRightRadius: 6,
    borderBottomRightRadius: 6,
  },
  chartCount: {
    color: colors.textPrimary,
    minWidth: 28,
    textAlign: 'right',
  },
  /* EmptyState */
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  emptyStateIcon: {
    opacity: 0.7,
  },
  emptyStateMessage: {
    textAlign: 'center',
  },
  /* VehicleSelect */
  vehicleSelect: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    justifyContent: 'flex-end',
  },
  vehicleChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surfaceRaised,
  },
  vehicleChipActive: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.surfaceSelected,
  },
  vehicleChipText: {
    color: colors.textSecondary,
  },
  vehicleChipTextActive: {
    color: colors.accent,
  },
});
