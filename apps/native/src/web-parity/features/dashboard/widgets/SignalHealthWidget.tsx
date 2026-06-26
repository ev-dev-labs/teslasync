// Native parity port of web/src/features/dashboard/widgets/SignalHealthWidget.tsx.
//
// The web widget is a responsive dashboard tile that summarises a vehicle's
// telemetry signal health. It reads three queries — useSignalStats(id) (drives
// the shell freshness/loading/error props), useSignalGaps(id) (the live
// per-signal {timestamp} map) and useSignals(id) (the list of available signal
// names) — falling back to the first vehicle's id when no explicit vehicleId
// prop is given. A useMemo derives the active/stale counts, the freshness age
// and the sorted stale-signal list; a second useMemo derives the green/amber/
// red/neutral health level. The tile renders inside the shared <WidgetShell>
// and switches between an empty state, a compact (1-col) layout, and a standard/
// wide layout (4 StatCards + a status Badge, plus a scrollable stale-signal list
// when wide).
//
// None of the web imports are native-safe, so — mirroring the sibling native
// ports (AutomationStatusWidget, SecurityStatusWidget, LifetimeStatsWidget) —
// each piece is rebuilt with React Native primitives, AppText, the repo
// SemanticIcon glyphs, the design tokens, and the existing native telemetry/
// vehicle hooks. The deps with no native port yet (WidgetShell, ./types
// WidgetProps, @/components/data-display StatCard, @/components/ui Badge,
// @/components/feedback EmptyState, @/lib/numberFormat fmtInt, @/lib/dateFormat
// formatRelative, react-i18next, lucide-react) are inlined as self-contained
// native-safe parity within this file.
//
// Line-by-line coverage of the source:
//   L1     `import { useMemo }` -> kept (from 'react').
//   L2     useTranslation('dashboard') -> useNativeTranslationFallback (the i18n
//          namespace is retained as SIGNAL_HEALTH_WIDGET_I18N_NAMESPACE; the
//          fallback now also interpolates `{{count}}` so formatAge keeps parity).
//   L3     lucide Activity/AlertTriangle/CheckCircle2/Clock -> repo SemanticIcon
//          glyph stand-ins resolved once (activity/warning/success/clock).
//   L4     StatCard -> inlined native parity (label + optional icon row, big value).
//   L5     Badge -> inlined native parity (success/warning/danger/neutral).
//   L6     EmptyState -> inlined native parity (centred glyph + muted message).
//   L7     useSignalStats/useSignalGaps/useSignals -> native ../../../api/hooks/useTelemetry.
//   L8     useVehicles -> native ../../../api/hooks/useVehicles.
//   L9     fmtInt -> inlined parity (safeNumber + fmtNumber(v, 0)).
//   L10    formatRelative -> inlined parity (just now / Nm / Nh / Nd ago, else
//          absolute date via Intl.DateTimeFormat — the lib formatDate fallback).
//   L11    ./WidgetShell -> inlined native parity (loading/error/freshness pill).
//   L12    ./types WidgetProps -> mirrored field-for-field.
//   L14    STALE_THRESHOLD_MS = 5 * 60 * 1000 -> ported verbatim.
//   L16-20 GapSignal interface -> ported verbatim.
//   L22-25 default export SignalHealthWidget({ vehicleId, size }): t, vehicles,
//          id = vehicleId ?? vehicles?.[0]?.id ?? 0 -> ported verbatim.
//   L27-35 useSignalStats(id) destructure (stats/statsLoading/statsFetching/
//          statsStale/statsError/statsUpdatedAt/refetchStats) -> ported verbatim.
//   L37-38 useSignalGaps(id) -> gapData; useSignals(id) -> signals.
//   L40-41 isCompact = size.cols <= 1; isWide = size.cols >= 3.
//   L43-87 analysis = useMemo: totalSignals/activeCount/staleCount/gapSignals/
//          freshnessAge/latestTimestamp, the stale push + sort + freshness math,
//          deps [signals, gapData] -> ported verbatim.
//   L89-98 healthLevel = useMemo (neutral/red/amber/green via stale ratio),
//          deps [analysis] -> ported verbatim.
//   L100-106 healthColor -> healthTextColor token map (green->success, amber->
//          warning, red->danger, neutral->textMuted). Used for the header glyph
//          tone + compact age text.
//   L108-114 healthBadgeVariant -> ported verbatim (success/warning/danger/neutral).
//   L116-121 formatAge(seconds) -> ported verbatim, `{{count}}` interpolated.
//   L123    hasData = stats || signals || gapData -> ported verbatim (an empty
//          signals array is truthy, exactly as web).
//   L125-135 <WidgetShell> with the conditional (compact-hidden) title, the
//          health-toned Activity icon, loading=statsLoading, freshness props
//          (updatedAt/isFetching/isStale/isError) and onRefresh=refetchStats.
//   L136-141 !hasData -> EmptyState(activity glyph, 'No signal health data').
//   L142-159 isCompact -> centred Badge `{active}/{active+stale}`, bold total,
//          'signals' label, and the health-toned age when freshnessAge != null.
//   L160-185 standard/wide -> 2-col StatCard grid (Total Signals/Active/With
//          Gaps/Freshness) with their lucide-toned glyphs.
//   L187-201 status row -> uppercase muted 'Status' label + health Badge label.
//   L203-222 wide + gapSignals.length>0 -> bordered scrollable list header
//          'Stale / Gap Signals' + slice(0, isCompact ? 3 : 15) rows (name +
//          formatRelative(lastSeen) | '—').
//   L227    component close.
//
// No DOM, no react-i18next, no lucide-react, no Recharts/Leaflet, no
// framer-motion, and no web UI components are imported.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { getSemanticIconDefinition } from '../../../../components/icons/SemanticIcon';
import { AppText } from '../../../../components/ui/AppText';
import { colors, spacing } from '../../../../theme/tokens';
import {
  useSignalGaps,
  useSignals,
  useSignalStats,
} from '../../../api/hooks/useTelemetry';
import { useVehicles } from '../../../api/hooks/useVehicles';

/* ------------------------------------------------------------------ */
/*  i18n fallback (inlined react-i18next port)                         */
/* ------------------------------------------------------------------ */

// The web widget read `t` from useTranslation('dashboard'). Native parity has no
// i18n runtime wired, so this returns the English fallback for every (key,
// fallback) pair, preserving every i18n key. Unlike the simpler sibling ports,
// formatAge passes `{ count }`, so the fallback also interpolates `{{name}}`
// placeholders exactly the way i18next would (e.g. '{{count}}s ago' -> '42s ago').
const I18N_NAMESPACE = 'dashboard';

type TVars = Record<string, string | number>;
type NativeTFunction = (key: string, fallback: string, vars?: TVars) => string;

function interpolate(template: string, vars?: TVars): string {
  if (!vars) {
    return template;
  }
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const value = vars[name];
    return value == null ? '' : String(value);
  });
}

function useNativeTranslationFallback(): NativeTFunction {
  return useCallback(
    (_key: string, fallback: string, vars?: TVars) =>
      interpolate(fallback, vars),
    [],
  );
}

/* ------------------------------------------------------------------ */
/*  ./types mirror (no native port yet)                                */
/* ------------------------------------------------------------------ */

// Mirrored field-for-field from web ./types so the port stays self-contained.
interface WidgetSize {
  cols: number;
  rows: number;
}

interface WidgetConfig {
  vehicleId?: number;
  refreshRate?: number;
  chartType?: string;
  showTitle?: boolean;
  timeRange?: string;
  [key: string]: unknown;
}

interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: WidgetConfig;
}

/* ------------------------------------------------------------------ */
/*  lucide -> repo SemanticIcon glyph stand-ins                        */
/* ------------------------------------------------------------------ */

// Repo-canonical native stand-ins for the lucide glyphs, resolved once. The
// per-icon colour intent (Activity health-toned/cyan, CheckCircle2 green,
// AlertTriangle amber, Clock secondary) is applied at the call sites via tone.
const ACTIVITY_GLYPH = getSemanticIconDefinition('activity').glyph;
const CHECK_GLYPH = getSemanticIconDefinition('success').glyph;
const ALERT_GLYPH = getSemanticIconDefinition('warning').glyph;
const CLOCK_GLYPH = getSemanticIconDefinition('clock').glyph;

type GlyphTone = 'cyan' | 'green' | 'amber' | 'red' | 'muted' | 'secondary';

function Glyph({
  glyph,
  tone,
  style,
}: {
  glyph: string;
  tone: GlyphTone;
  style?: TextStyle | TextStyle[];
}) {
  return (
    <AppText style={[styles.glyph, glyphToneStyles[tone], style]} weight="bold">
      {glyph}
    </AppText>
  );
}

/* ------------------------------------------------------------------ */
/*  Parity for @/lib/numberFormat fmtInt                                */
/* ------------------------------------------------------------------ */

// web safeNumber: non-finite / non-number -> 0.
function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

// web fmtNumber(v, decimals, locale): locale-grouped fixed-precision string,
// falling back to en-US when the locale tag is rejected by Intl.
function fmtNumber(value: unknown, decimals = 0, locale = 'en-US'): string {
  try {
    return safeNumber(value).toLocaleString(locale, {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(value).toLocaleString('en-US', {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  }
}

// web fmtInt(v): fmtNumber(v, 0).
function fmtInt(value: unknown): string {
  return fmtNumber(value, 0);
}

/* ------------------------------------------------------------------ */
/*  Parity for @/lib/dateFormat formatRelative                          */
/* ------------------------------------------------------------------ */

// web formatDate(iso): "Apr 4, 2026" via Intl, the formatRelative >7d fallback.
function formatDate(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '—';
  }
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(d);
}

// web formatRelative(iso): "just now" / "Nm ago" / "Nh ago" / "Nd ago" (<7d),
// else the absolute formatDate label. Ported verbatim from lib/dateFormat.
function formatRelative(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
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
  return formatDate(iso);
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/ui <Badge>                                    */
/* ------------------------------------------------------------------ */

type BadgeVariant = 'success' | 'warning' | 'danger' | 'neutral';

// web Badge (size="sm"). The dark-mode variant palette maps to the matching
// token surface/border/text.
function Badge({
  variant,
  children,
}: {
  variant: BadgeVariant;
  children: ReactNode;
}) {
  return (
    <View style={[styles.badge, badgeContainerStyles[variant]]}>
      <AppText
        style={[styles.badgeText, badgeTextStyles[variant]]}
        variant="caption"
        weight="semibold">
        {children}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/data-display <StatCard>                        */
/* ------------------------------------------------------------------ */

// web StatCard(label, value, icon): a Card with a label + optional icon row
// above a large bold value. The trend/sublabel/unit/loading props are unused by
// this widget so they are intentionally omitted from the native parity surface.
function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string | number;
  icon?: ReactNode;
}) {
  return (
    <View style={styles.statCard}>
      <View style={styles.statCardHeader}>
        <AppText
          numberOfLines={1}
          style={styles.statCardLabel}
          tone="muted"
          variant="caption">
          {label}
        </AppText>
        {icon ?? null}
      </View>
      <AppText numberOfLines={1} style={styles.statCardValue} weight="bold">
        {value}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined @/components/feedback <EmptyState>                          */
/* ------------------------------------------------------------------ */

// web EmptyState(icon, message, className="py-4"): a centred icon glyph above a
// muted message line.
function EmptyState({ glyph, message }: { glyph: string; message: string }) {
  return (
    <View style={styles.emptyState}>
      <Glyph glyph={glyph} style={styles.emptyGlyph} tone="muted" />
      <AppText style={styles.emptyMessage} tone="muted" variant="caption">
        {message}
      </AppText>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Inlined ./WidgetShell                                              */
/* ------------------------------------------------------------------ */

// Native parity for the freshness pill the web WidgetShell renders in its header
// (web <DataFreshness>). A pressable refresh affordance with a status dot
// (error -> danger, fetching -> accent, stale -> warning, fresh -> success) and,
// when not compact, a short relative "updated" caption. Consumes every freshness
// prop so the refresh-on-press behaviour is preserved.
function DataFreshness({
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
  compact,
}: {
  updatedAt: number | null;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  onRefresh?: () => void;
  compact: boolean;
}) {
  const t = useNativeTranslationFallback();
  const dotStyle = isError
    ? freshnessDotStyles.error
    : isFetching
      ? freshnessDotStyles.fetching
      : isStale
        ? freshnessDotStyles.stale
        : freshnessDotStyles.fresh;

  return (
    <Pressable
      accessibilityLabel={t('widget.refresh', 'Refresh')}
      accessibilityRole="button"
      hitSlop={8}
      onPress={onRefresh}
      style={styles.freshness}>
      <View style={[styles.freshnessDot, dotStyle]} />
      {!compact && updatedAt ? (
        <AppText style={styles.freshnessLabel} tone="muted" variant="caption">
          {formatRelative(new Date(updatedAt).toISOString())}
        </AppText>
      ) : null}
    </Pressable>
  );
}

interface WidgetShellProps {
  title?: string;
  icon?: ReactNode;
  loading?: boolean;
  children: ReactNode;
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
}

function WidgetShell({
  title,
  icon,
  loading,
  children,
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
}: WidgetShellProps) {
  // Pulse-on-data-change effect (web `justUpdated`): ported verbatim; the
  // transient flag drives a subtle border highlight in place of the web box
  // shadow.
  const [justUpdated, setJustUpdated] = useState(false);
  const prevUpdatedAt = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (
      updatedAt &&
      updatedAt > 0 &&
      prevUpdatedAt.current !== undefined &&
      prevUpdatedAt.current !== updatedAt
    ) {
      setJustUpdated(true);
      const timer = setTimeout(() => setJustUpdated(false), 1500);
      prevUpdatedAt.current = updatedAt;
      return () => clearTimeout(timer);
    }
    prevUpdatedAt.current = updatedAt;
  }, [updatedAt]);

  if (loading) {
    return (
      <View style={styles.shellState}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const showFreshness = updatedAt !== undefined;
  const freshnessCompact = !title;
  const freshnessEl = showFreshness ? (
    <DataFreshness
      compact={freshnessCompact}
      isError={isError ?? false}
      isFetching={isFetching ?? false}
      isStale={isStale ?? false}
      onRefresh={onRefresh}
      updatedAt={updatedAt && updatedAt > 0 ? updatedAt : null}
    />
  ) : null;

  return (
    <View style={[styles.shell, justUpdated && styles.shellPulse]}>
      {title ? (
        <View style={styles.shellHeader}>
          <View style={styles.shellHeaderLeft}>
            {icon}
            <AppText style={styles.shellTitle} variant="caption" weight="semibold">
              {title}
            </AppText>
          </View>
          {freshnessEl}
        </View>
      ) : freshnessEl ? (
        <View style={styles.shellFreshnessOverlay}>{freshnessEl}</View>
      ) : null}
      <View style={styles.shellBody}>{children}</View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Pure logic / types (ported verbatim)                               */
/* ------------------------------------------------------------------ */

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

interface GapSignal {
  name: string;
  lastSeen: string | null;
  isStale: boolean;
}

type HealthLevel = 'neutral' | 'red' | 'amber' | 'green';

/* ------------------------------------------------------------------ */
/*  Widget                                                             */
/* ------------------------------------------------------------------ */

export default function SignalHealthWidget({ vehicleId, size }: WidgetProps) {
  const t = useNativeTranslationFallback();
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const {
    data: stats,
    isLoading: statsLoading,
    isFetching: statsFetching,
    isStale: statsStale,
    isError: statsError,
    dataUpdatedAt: statsUpdatedAt,
    refetch: refetchStats,
  } = useSignalStats(id);

  const { data: gapData } = useSignalGaps(id);
  const { data: signals } = useSignals(id);

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  const analysis = useMemo(() => {
    const allSignals = signals ?? [];
    const totalSignals = allSignals.length;
    const liveEntries = gapData ?? {};
    const now = Date.now();

    let activeCount = 0;
    let staleCount = 0;
    let latestTimestamp: string | null = null;
    const gapSignals: GapSignal[] = [];

    for (const [name, entry] of Object.entries(liveEntries)) {
      const ts = entry?.timestamp ?? null;
      if (ts) {
        const age = now - new Date(ts).getTime();
        if (age > STALE_THRESHOLD_MS) {
          staleCount++;
          gapSignals.push({ name, lastSeen: ts, isStale: true });
        } else {
          activeCount++;
        }
        if (!latestTimestamp || ts > latestTimestamp) {
          latestTimestamp = ts;
        }
      } else {
        staleCount++;
        gapSignals.push({ name, lastSeen: null, isStale: true });
      }
    }

    // Sort gap signals: null last-seen first, then oldest
    gapSignals.sort((a, b) => {
      if (!a.lastSeen && !b.lastSeen) return a.name.localeCompare(b.name);
      if (!a.lastSeen) return -1;
      if (!b.lastSeen) return 1;
      return new Date(a.lastSeen).getTime() - new Date(b.lastSeen).getTime();
    });

    // Freshness age in seconds
    const freshnessAge = latestTimestamp
      ? Math.max(0, Math.floor((now - new Date(latestTimestamp).getTime()) / 1000))
      : null;

    return { totalSignals, activeCount, staleCount, gapSignals, freshnessAge, latestTimestamp };
  }, [signals, gapData]);

  // Color coding: green = all fresh, amber = some stale, red = many gaps
  const healthLevel = useMemo<HealthLevel>(() => {
    const { activeCount, staleCount } = analysis;
    const total = activeCount + staleCount;
    if (total === 0) return 'neutral';
    const staleRatio = staleCount / total;
    if (staleRatio >= 0.5) return 'red';
    if (staleRatio > 0) return 'amber';
    return 'green';
  }, [analysis]);

  const healthTextColor = healthLevel === 'green'
    ? colors.success
    : healthLevel === 'amber'
      ? colors.warning
      : healthLevel === 'red'
        ? colors.danger
        : colors.textMuted;

  const healthGlyphTone: GlyphTone = healthLevel === 'green'
    ? 'green'
    : healthLevel === 'amber'
      ? 'amber'
      : healthLevel === 'red'
        ? 'red'
        : 'muted';

  const healthBadgeVariant: BadgeVariant = healthLevel === 'green'
    ? 'success'
    : healthLevel === 'amber'
      ? 'warning'
      : healthLevel === 'red'
        ? 'danger'
        : 'neutral';

  function formatAge(seconds: number | null): string {
    if (seconds == null) return '—';
    if (seconds < 60) return t('widget.signalHealth.secAgo', '{{count}}s ago', { count: seconds });
    if (seconds < 3600) return t('widget.signalHealth.minAgo', '{{count}}m ago', { count: Math.floor(seconds / 60) });
    return t('widget.signalHealth.hrAgo', '{{count}}h ago', { count: Math.floor(seconds / 3600) });
  }

  const hasData = stats || signals || gapData;

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.signalHealth.title', 'Signal Health')}
      icon={<Glyph glyph={ACTIVITY_GLYPH} style={styles.headerIcon} tone={healthGlyphTone} />}
      loading={statsLoading}
      updatedAt={statsUpdatedAt}
      isFetching={statsFetching}
      isStale={statsStale}
      isError={statsError}
      onRefresh={() => refetchStats()}>
      {!hasData ? (
        // no-action: transient empty state — surfaces when source data is
        // missing; no specific recovery action available
        <EmptyState
          glyph={ACTIVITY_GLYPH}
          message={t('widget.signalHealth.noData', 'No signal health data')}
        />
      ) : isCompact ? (
        /* ── Compact layout (1-col) ── */
        <View style={styles.compactRoot}>
          <Badge variant={healthBadgeVariant}>
            {analysis.activeCount}/{analysis.activeCount + analysis.staleCount}
          </Badge>
          <AppText style={styles.compactTotal} weight="bold">
            {fmtInt(analysis.totalSignals)}
          </AppText>
          <AppText style={styles.compactSignals} tone="secondary">
            {t('widget.signalHealth.signals', 'signals')}
          </AppText>
          {analysis.freshnessAge != null ? (
            <AppText style={[styles.compactAge, { color: healthTextColor }]}>
              {formatAge(analysis.freshnessAge)}
            </AppText>
          ) : null}
        </View>
      ) : (
        /* ── Standard / Wide layout ── */
        <View style={styles.standardRoot}>
          {/* Stats grid */}
          <View style={styles.statsGrid}>
            <StatCard
              label={t('widget.signalHealth.totalSignals', 'Total Signals')}
              value={fmtInt(analysis.totalSignals)}
              icon={<Glyph glyph={ACTIVITY_GLYPH} style={styles.statIcon} tone="cyan" />}
            />
            <StatCard
              label={t('widget.signalHealth.active', 'Active')}
              value={fmtInt(analysis.activeCount)}
              icon={<Glyph glyph={CHECK_GLYPH} style={styles.statIcon} tone="green" />}
            />
            <StatCard
              label={t('widget.signalHealth.withGaps', 'With Gaps')}
              value={fmtInt(analysis.staleCount)}
              icon={<Glyph glyph={ALERT_GLYPH} style={styles.statIcon} tone="amber" />}
            />
            <StatCard
              label={t('widget.signalHealth.freshness', 'Freshness')}
              value={formatAge(analysis.freshnessAge)}
              icon={<Glyph glyph={CLOCK_GLYPH} style={styles.statIcon} tone="secondary" />}
            />
          </View>

          {/* Health badge */}
          <View style={styles.statusRow}>
            <AppText style={styles.statusLabel} tone="muted">
              {t('widget.signalHealth.status', 'Status')}
            </AppText>
            <Badge variant={healthBadgeVariant}>
              {healthLevel === 'green'
                ? t('widget.signalHealth.healthy', 'Healthy')
                : healthLevel === 'amber'
                  ? t('widget.signalHealth.degraded', 'Degraded')
                  : healthLevel === 'red'
                    ? t('widget.signalHealth.critical', 'Critical')
                    : t('widget.signalHealth.unknown', 'Unknown')}
            </Badge>
          </View>

          {/* Wide view: stale signal list */}
          {isWide && analysis.gapSignals.length > 0 ? (
            <View style={styles.staleSection}>
              <AppText style={styles.staleHeading} tone="muted" weight="semibold">
                {t('widget.signalHealth.staleSignals', 'Stale / Gap Signals')}
              </AppText>
              <ScrollView style={styles.staleScroll}>
                {analysis.gapSignals.slice(0, isCompact ? 3 : 15).map((sig) => (
                  <View key={sig.name} style={styles.staleRow}>
                    <AppText
                      numberOfLines={1}
                      style={styles.staleName}
                      tone="secondary">
                      {sig.name}
                    </AppText>
                    <AppText numberOfLines={1} style={styles.staleSeen} tone="muted">
                      {sig.lastSeen ? formatRelative(sig.lastSeen) : '—'}
                    </AppText>
                  </View>
                ))}
              </ScrollView>
            </View>
          ) : null}
        </View>
      )}
    </WidgetShell>
  );
}

SignalHealthWidget.displayName = 'SignalHealthWidget';

// Surfaced so the i18n namespace the web widget used is retained and inspectable.
export const SIGNAL_HEALTH_WIDGET_I18N_NAMESPACE = I18N_NAMESPACE;

const styles = StyleSheet.create({
  // --- Glyph base ---
  glyph: {
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.4,
  },

  // --- WidgetShell ---
  shell: {
    flex: 1,
  },
  shellPulse: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.successBorder,
  },
  shellState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
  },
  shellHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  shellHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  shellTitle: {
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  shellFreshnessOverlay: {
    position: 'absolute',
    top: 6,
    right: 6,
    zIndex: 5,
  },
  shellBody: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },

  // --- DataFreshness ---
  freshness: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  freshnessDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  freshnessLabel: {
    fontSize: 10,
    lineHeight: 14,
  },

  // --- Header icon ---
  headerIcon: {
    fontSize: 12,
    lineHeight: 16,
  },

  // --- Compact view ---
  compactRoot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: 44,
  },
  compactTotal: {
    fontSize: 18,
    lineHeight: 22,
    color: colors.textPrimary,
  },
  compactSignals: {
    fontSize: 10,
    lineHeight: 14,
  },
  compactAge: {
    fontSize: 12,
    lineHeight: 16,
  },

  // --- Standard / wide view ---
  standardRoot: {
    flex: 1,
    gap: spacing.md,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statCard: {
    flexBasis: '47%',
    flexGrow: 1,
    gap: 2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceGlass,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  statCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  statCardLabel: {
    flexShrink: 1,
    fontSize: 11,
    lineHeight: 14,
  },
  statCardValue: {
    fontSize: 20,
    lineHeight: 26,
    color: colors.textPrimary,
  },
  statIcon: {
    fontSize: 11,
    lineHeight: 14,
  },

  // --- Status row ---
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  statusLabel: {
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },

  // --- Stale signal list ---
  staleSection: {
    flex: 1,
    minHeight: 0,
    marginTop: 'auto',
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
  },
  staleHeading: {
    fontSize: 10,
    lineHeight: 14,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  staleScroll: {
    flex: 1,
  },
  staleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    minHeight: 28,
  },
  staleName: {
    flexShrink: 1,
    maxWidth: '45%',
    fontSize: 12,
    lineHeight: 16,
  },
  staleSeen: {
    flexShrink: 1,
    fontSize: 10,
    lineHeight: 14,
  },

  // --- Badge ---
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 11,
    lineHeight: 14,
  },

  // --- Empty state ---
  emptyState: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
  },
  emptyGlyph: {
    fontSize: 16,
    lineHeight: 20,
  },
  emptyMessage: {
    textAlign: 'center',
  },
});

const glyphToneStyles = StyleSheet.create<Record<GlyphTone, TextStyle>>({
  cyan: {
    color: colors.accent,
  },
  green: {
    color: colors.success,
  },
  amber: {
    color: colors.warning,
  },
  red: {
    color: colors.danger,
  },
  muted: {
    color: colors.textMuted,
  },
  secondary: {
    color: colors.textSecondary,
  },
});

const badgeContainerStyles = StyleSheet.create<Record<BadgeVariant, ViewStyle>>({
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
  neutral: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
  },
});

const badgeTextStyles = StyleSheet.create<Record<BadgeVariant, TextStyle>>({
  success: {
    color: colors.success,
  },
  danger: {
    color: colors.danger,
  },
  warning: {
    color: colors.warning,
  },
  neutral: {
    color: colors.textSecondary,
  },
});

const freshnessDotStyles = StyleSheet.create({
  error: {
    backgroundColor: colors.danger,
  },
  fetching: {
    backgroundColor: colors.accent,
  },
  stale: {
    backgroundColor: colors.warning,
  },
  fresh: {
    backgroundColor: colors.success,
  },
});
