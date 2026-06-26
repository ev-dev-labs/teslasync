// Native parity port of web/src/features/dashboard/widgets/ChargingTelemetryWidget.tsx.
//
// Dashboard widget that polls a vehicle's latest charging-telemetry snapshot
// (every 5s) and, while the pack is Charging, renders a stat grid (voltage /
// current / power / phases, plus an efficiency stat in the wide layout), a
// derived AC/DC charger badge and a rolling power sparkline inside a widget
// shell. When not charging it surfaces a "Not currently charging" empty state.
// The compact (1-col) layout collapses to a single big power readout. The web
// file pulls in browser-only or web-UI dependencies that are absent from the
// native parity manifest (contract rules 4, 5 & 7); each is replaced with a
// React Native-safe equivalent and documented here + in the sidecar:
//
//   - react-i18next `useTranslation('dashboard')` (web L2, L16) -> inlined
//     useNativeTranslation(): a stable (key, fallback) => fallback shim so every
//     t('widget.chargingTelemetry.*','<English>') call keeps its English default
//     + translation-key intent (the established AlertFeed/ChargeHistory port
//     pattern).
//   - lucide-react Gauge / Zap / BatteryCharging / Plug (web L3) -> the shared
//     native SemanticIcon. lucide SVG has no native renderer, so each glyph maps
//     to the nearest semantic name with a fixed intrinsic tone (the same
//     color-tint -> semantic-icon collapse used by the ChargeHistory port):
//       Gauge          -> 'speedCircle' (gauge/dial; title + Current/Phases/
//                         Efficiency stat icons). The title Gauge's
//                         text-neon-green tint collapses to speedCircle's tone.
//       Zap            -> 'bolt'            (Voltage stat icon)
//       BatteryCharging-> 'batteryCharging' (Power stat icon + the compact big
//                         readout icon; the web `animate-pulse` is dropped — RN
//                         has no CSS keyframe animation, like other ports).
//       Plug           -> 'charger'         (not-charging empty-state icon)
//   - `@/components/charts` Sparkline (web L4) -> the ported native charts barrel
//     Sparkline (RN line/area segments, no Recharts/SVG). Same data/color/height
//     props.
//   - `@/components/ui` Badge (web L5) -> inlined native Badge: the rounded-full
//     variant+size pill reproduced with RN primitives. The web light/dark Tailwind
//     variant classes collapse to the native dark-theme token palette; only the
//     warning + neutral variants are exercised here.
//   - `@/components/feedback` EmptyState (web L6) -> inlined NotChargingEmpty: a
//     centred icon + muted message (the shared native EmptyState requires a title
//     and takes no icon, so it is inlined like the ChargeHistory port).
//   - `@/api/hooks/useVehicles` useChargingTelemetryLatest + useVehicles (web L7)
//     -> the ported native hooks (same '/charging-telemetry/latest?vehicle_id='
//     and '/vehicles' queries, same 5s refetch, same UseQueryResult fields).
//   - `@/lib/numberFormat` fmtNumber + fmtInt (web L8) -> ported inline
//     (locale-aware toLocaleString with safeNumber guard; fmtInt = fmtNumber(_,0)),
//     matching web numberFormat's pre-settings 'en-US' default. Every call passes
//     an explicit decimal count so the global precision is irrelevant.
//   - `./WidgetShell` WidgetShell (web L9) -> inlined native WidgetShell (same
//     skeleton/error/header/overlay-freshness/pulse subset already ported by the
//     AlertFeed/BackupMonitor/ChargeHistory widgets); the unused
//     query/help/widgetId/dashboardId/actions/noPadding props are omitted.
//   - `./shared` WidgetStatGrid + type StatGridItem (web L10) -> inlined native
//     WidgetStatGrid: the stat-card grid + empty-state contract reproduced with
//     RN primitives. The web `@container` column-count table (grid-cols-2 / -4
//     with @xs/@sm relaxation) collapses to a flex-wrap row whose cells share an
//     even flex-basis per `cols` — RN has no container queries. StatGridItem keeps
//     all source fields; `valueColor` holds a resolved native color (the web stored
//     a Tailwind class string there).
//   - `./types` WidgetProps (web L11) -> inlined native WidgetSize/WidgetProps
//     (the vehicleId/size subset this widget reads).
//
// Behaviour, state/ref names (powerHistoryRef, lastTsRef, voltage/current/power/
// phases, chargerType, efficiency, coreStats/wideStats/allStats, isCompact/isWide/
// isCharging), the MAX_POWER_HISTORY=30 rolling buffer, the during-render ref
// mutation keyed on data.ts, the SI fields read verbatim from the API
// (charger_power_w shown as "kW" exactly as the web does — no extra conversion is
// introduced so parity is preserved), the i18n keys, the size.cols breakpoints,
// and the 5s refetch interval are all preserved. No DOM-only modules, HTML
// elements, react-i18next, lucide-react, Recharts, Leaflet, or web @/ UI imports
// remain — only react, react-native primitives, the shared native SemanticIcon /
// AppText / theme tokens, and the ported parity Sparkline / useVehicles /
// DataFreshness / QueryError.

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {StyleSheet, View, type DimensionValue} from 'react-native';

import {SemanticIcon} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {colors} from '../../../../theme/tokens';
import {
  useChargingTelemetryLatest,
  useVehicles,
} from '../../../api/hooks/useVehicles';
import {Sparkline} from '../../../components/charts';
import {DataFreshness} from '../../../components/data-display/DataFreshness';
import {QueryError} from '../../../components/feedback/QueryError';

const MAX_POWER_HISTORY = 30;

// Tailwind emerald-300 — web colours the Power value + compact readout with it.
const EMERALD_300 = '#6ee7b7';

// ── react-i18next useTranslation('dashboard') replacement ──
type NativeTFunction = (key: string, fallback: string) => string;

// Returns the English fallback so the translation-key intent is preserved.
const nativeTranslate: NativeTFunction = (_key, fallback) => fallback;

function useNativeTranslation(): NativeTFunction {
  return nativeTranslate;
}

// ── @/lib/numberFormat fmtNumber + fmtInt (ported inline) ──
function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function fmtNumber(value: unknown, decimals = 2, locale = 'en-US'): string {
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

function fmtInt(value: unknown): string {
  return fmtNumber(value, 0);
}

// ── @/components/ui Badge (inlined native-safe subset) ──
type BadgeVariant = 'danger' | 'info' | 'neutral' | 'success' | 'warning';
type BadgeSize = 'lg' | 'md' | 'sm';

interface BadgeProps {
  children: ReactNode;
  size?: BadgeSize;
  variant?: BadgeVariant;
}

function Badge({children, size = 'md', variant = 'neutral'}: BadgeProps) {
  return (
    <View style={[styles.badge, badgeVariantStyles[variant], badgeSizeStyles[size]]}>
      <AppText
        style={[styles.badgeText, badgeTextColors[variant], badgeTextSizes[size]]}>
        {children}
      </AppText>
    </View>
  );
}

// ── ./shared WidgetStatGrid + StatGridItem (inlined native-safe subset) ──
interface StatGridItem {
  label: string;
  value: string | number;
  unit?: string;
  icon?: ReactNode;
  trend?: 'up' | 'down' | 'flat';
  trendValue?: string;
  // Native holds a resolved color value here (web stored a Tailwind class).
  valueColor?: string;
}

interface WidgetStatGridProps {
  stats: StatGridItem[];
  compact?: boolean;
  cols?: 2 | 3 | 4;
}

function autoCols(count: number): 2 | 3 | 4 {
  if (count % 3 === 0) return 3;
  if (count % 4 === 0) return 4;
  return 2;
}

function percentBasis(value: number): DimensionValue {
  return `${value}%` as DimensionValue;
}

function trendColor(trend: 'up' | 'down' | 'flat'): string {
  if (trend === 'up') return colors.success;
  if (trend === 'flat') return colors.textMuted;
  return colors.danger;
}

function trendArrow(trend: 'up' | 'down' | 'flat'): string {
  if (trend === 'up') return '↑';
  if (trend === 'down') return '↓';
  return '—';
}

function StatGridCell({stat}: {stat: StatGridItem}) {
  return (
    <View style={styles.statCard}>
      <View style={styles.statHeader}>
        <AppText
          numberOfLines={1}
          style={styles.statLabel}
          tone="muted"
          variant="caption"
          weight="semibold">
          {stat.label}
        </AppText>
        {stat.icon ? <View style={styles.statIcon}>{stat.icon}</View> : null}
      </View>
      <View style={styles.statValueRow}>
        <AppText
          numberOfLines={1}
          style={stat.valueColor ? {color: stat.valueColor} : undefined}
          variant="title"
          weight="bold">
          {stat.value}
        </AppText>
        {stat.unit ? (
          <AppText tone="muted" variant="caption">
            {stat.unit}
          </AppText>
        ) : null}
      </View>
      {stat.trend && stat.trendValue ? (
        <View style={styles.statTrendRow}>
          <AppText style={{color: trendColor(stat.trend)}} variant="caption">
            {`${trendArrow(stat.trend)} ${stat.trendValue}`}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

function WidgetStatGrid({stats, compact, cols}: WidgetStatGridProps) {
  // Transient empty state — surfaces when source data is missing; no specific
  // recovery action available (matches web EmptyState no-action comment).
  if (stats.length === 0) {
    return (
      <View style={styles.gridEmpty}>
        <AppText tone="muted" variant="caption">
          No stats available
        </AppText>
      </View>
    );
  }

  const resolvedCols = compact ? 1 : cols ?? autoCols(stats.length);
  const basis = percentBasis(100 / resolvedCols - 6);

  return (
    <View style={[styles.grid, compact ? styles.gridCompact : styles.gridStandard]}>
      {stats.map(stat => (
        <View key={stat.label} style={[styles.gridCell, {flexBasis: basis}]}>
          <StatGridCell stat={stat} />
        </View>
      ))}
    </View>
  );
}

// ── @/components/feedback EmptyState (inlined not-charging variant) ──
function NotChargingEmpty({message}: {message: string}) {
  // Transient empty state — surfaces when the pack is not charging; no specific
  // recovery action available (matches web EmptyState no-action comment).
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <SemanticIcon decorative name="charger" size="md" />
      </View>
      <AppText style={styles.emptyMessage} tone="muted" variant="caption">
        {message}
      </AppText>
    </View>
  );
}

// ── ./WidgetShell (inlined, native-safe subset) ──
interface WidgetShellProps {
  title?: string;
  icon?: ReactNode;
  loading?: boolean;
  error?: string | null;
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
  error,
  children,
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
}: WidgetShellProps) {
  // Pulse-on-data-change glow (web WidgetShell L59-80).
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
      <View
        accessibilityLabel="Loading"
        accessibilityRole="progressbar"
        style={styles.skeleton}
      />
    );
  }

  if (error) {
    return (
      <View style={styles.errorWrap}>
        <QueryError error={new Error(error)} />
      </View>
    );
  }

  const showFreshness = updatedAt !== undefined;
  // Compact (dot-only) when the widget has no title (typically 1×1 widgets).
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
        <View style={styles.header}>
          <View style={styles.titleGroup}>
            {icon}
            <AppText numberOfLines={1} style={styles.title}>
              {title}
            </AppText>
          </View>
          {freshnessEl}
        </View>
      ) : freshnessEl ? (
        <View style={styles.overlayFreshness}>{freshnessEl}</View>
      ) : null}
      <View style={styles.content}>{children}</View>
    </View>
  );
}

// ── ./types WidgetSize / WidgetProps (ported inline subset) ──
interface WidgetSize {
  cols: number;
  rows: number;
}

interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: Record<string, unknown>;
}

export default function ChargingTelemetryWidget({vehicleId, size}: WidgetProps) {
  const t = useNativeTranslation();
  const {data: vehicles} = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const {
    data,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useChargingTelemetryLatest(id, 5_000);

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 4;

  const isCharging = data?.charging_state === 'Charging';

  // Accumulate a rolling power history for the sparkline.
  const powerHistoryRef = useRef<number[]>([]);
  const lastTsRef = useRef<string | null>(null);

  if (data && data.ts !== lastTsRef.current) {
    lastTsRef.current = data.ts;
    const pw = data.charger_power_w ?? 0;
    powerHistoryRef.current = [
      ...powerHistoryRef.current.slice(-(MAX_POWER_HISTORY - 1)),
      pw,
    ];
  }

  const voltage = data?.charger_voltage ?? 0;
  const current = data?.charger_actual_current ?? 0;
  const power = data?.charger_power_w ?? 0;
  const phases = data?.charger_phases ?? 0;

  // Derive charger type from voltage/phases heuristic.
  const chargerType = useMemo(() => {
    if (!data || !isCharging) return null;
    if (voltage > 300) return 'DC';
    return 'AC';
  }, [data, isCharging, voltage]);

  // Derive efficiency: actual power vs pilot capacity.
  const efficiency = useMemo(() => {
    if (!data || !isCharging) return null;
    const pilot = data.charger_pilot_current ?? 0;
    if (pilot <= 0 || voltage <= 0) return null;
    const theoreticalPower = (pilot * voltage * (phases > 0 ? phases : 1)) / 1000;
    if (theoreticalPower <= 0) return null;
    return Math.min(100, (power / theoreticalPower) * 100);
  }, [data, isCharging, voltage, phases, power]);

  const coreStats = useMemo((): StatGridItem[] => {
    if (!isCharging) return [];
    return [
      {
        label: t('widget.chargingTelemetry.voltage', 'Voltage'),
        value: fmtNumber(voltage, 0),
        unit: 'V',
        icon: <SemanticIcon decorative name="bolt" size="sm" />,
      },
      {
        label: t('widget.chargingTelemetry.current', 'Current'),
        value: fmtNumber(current, 0),
        unit: 'A',
        icon: <SemanticIcon decorative name="speedCircle" size="sm" />,
      },
      {
        label: t('widget.chargingTelemetry.power', 'Power'),
        value: fmtNumber(power, 1),
        unit: 'kW',
        icon: <SemanticIcon decorative name="batteryCharging" size="sm" />,
        valueColor: EMERALD_300,
      },
      {
        label: t('widget.chargingTelemetry.phases', 'Phases'),
        value: phases > 0 ? fmtInt(phases) : '—',
        icon: <SemanticIcon decorative name="speedCircle" size="sm" />,
      },
    ];
  }, [isCharging, voltage, current, power, phases, t]);

  // Wide-only extra stats.
  const wideStats = useMemo((): StatGridItem[] => {
    if (!isCharging || !isWide) return [];
    const items: StatGridItem[] = [];
    if (efficiency != null) {
      items.push({
        label: t('widget.chargingTelemetry.efficiency', 'Efficiency'),
        value: fmtNumber(efficiency, 0),
        unit: '%',
        icon: <SemanticIcon decorative name="speedCircle" size="sm" />,
      });
    }
    return items;
  }, [isCharging, isWide, efficiency, t]);

  const allStats = useMemo(
    () => (isWide ? [...coreStats, ...wideStats] : coreStats),
    [isWide, coreStats, wideStats],
  );

  // ── Compact layout ──
  if (isCompact) {
    return (
      <WidgetShell
        error={error ? String(error) : null}
        isError={isError}
        isFetching={isFetching}
        isStale={isStale}
        loading={isLoading}
        onRefresh={() => refetch()}
        updatedAt={dataUpdatedAt}>
        {isCharging ? (
          <View style={styles.compactCharging}>
            <SemanticIcon decorative name="batteryCharging" size="md" />
            <AppText style={styles.compactPower} weight="bold">
              {`${fmtNumber(power, 1)} kW`}
            </AppText>
            <AppText style={styles.compactSub}>
              {`${fmtNumber(voltage, 0)}V · ${fmtNumber(current, 0)}A`}
            </AppText>
          </View>
        ) : (
          <NotChargingEmpty
            message={t(
              'widget.chargingTelemetry.notCharging',
              'Not currently charging',
            )}
          />
        )}
      </WidgetShell>
    );
  }

  // ── Standard / Wide layout ──
  return (
    <WidgetShell
      error={error ? String(error) : null}
      icon={<SemanticIcon decorative name="speedCircle" size="sm" />}
      isError={isError}
      isFetching={isFetching}
      isStale={isStale}
      loading={isLoading}
      onRefresh={() => refetch()}
      title={t('widget.chargingTelemetry.title', 'Charging Telemetry')}
      updatedAt={dataUpdatedAt}>
      {isCharging ? (
        <View style={styles.standardRoot}>
          <WidgetStatGrid cols={isWide ? 4 : 2} stats={allStats} />

          {/* Wide extras: charger type badge + sparkline */}
          {isWide ? (
            <View style={styles.wideExtras}>
              {chargerType ? (
                <Badge
                  size="sm"
                  variant={chargerType === 'DC' ? 'warning' : 'neutral'}>
                  {`${chargerType} ${t(
                    'widget.chargingTelemetry.charger',
                    'Charger',
                  )}`}
                </Badge>
              ) : null}
              {powerHistoryRef.current.length > 1 ? (
                <View style={styles.sparklineWrap}>
                  <Sparkline
                    color="#22c55e"
                    data={powerHistoryRef.current}
                    height={28}
                  />
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : (
        <NotChargingEmpty
          message={t(
            'widget.chargingTelemetry.notCharging',
            'Not currently charging',
          )}
        />
      )}
    </WidgetShell>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 4,
  },
  badgeText: {
    fontWeight: '500',
  },
  compactCharging: {
    alignItems: 'center',
    flex: 1,
    gap: 4,
    justifyContent: 'center',
    minHeight: 44,
  },
  compactPower: {
    color: EMERALD_300,
    fontSize: 18,
  },
  compactSub: {
    color: colors.textMuted,
    fontSize: 10,
  },
  content: {
    flex: 1,
    paddingBottom: 12,
    paddingHorizontal: 16,
  },
  empty: {
    alignItems: 'center',
    flex: 1,
    gap: 8,
    justifyContent: 'center',
    paddingVertical: 16,
  },
  emptyIcon: {
    marginBottom: 4,
  },
  emptyMessage: {
    textAlign: 'center',
  },
  errorWrap: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: 16,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  gridCell: {
    flexGrow: 1,
    minWidth: 0,
  },
  gridCompact: {
    gap: 8,
  },
  gridEmpty: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  gridStandard: {
    gap: 12,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 4,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  overlayFreshness: {
    position: 'absolute',
    right: 6,
    top: 6,
    zIndex: 5,
  },
  shell: {
    flex: 1,
  },
  shellPulse: {
    elevation: 6,
    shadowColor: '#22c55e',
    shadowOffset: {width: 0, height: 0},
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 12,
    flex: 1,
    minHeight: 120,
  },
  sparklineWrap: {
    flex: 1,
    minWidth: 0,
  },
  standardRoot: {
    flex: 1,
    gap: 12,
  },
  statCard: {
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    gap: 4,
    padding: 12,
  },
  statHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  statIcon: {
    flexShrink: 0,
    marginLeft: 4,
  },
  statLabel: {
    flexShrink: 1,
  },
  statTrendRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  statValueRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: 4,
  },
  title: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  titleGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  wideExtras: {
    alignItems: 'center',
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 16,
    paddingTop: 8,
  },
});

const badgeVariantStyles = StyleSheet.create({
  danger: {
    backgroundColor: colors.dangerSurface,
  },
  info: {
    backgroundColor: colors.accentSoft,
  },
  neutral: {
    backgroundColor: colors.surfaceRaised,
  },
  success: {
    backgroundColor: colors.successSurface,
  },
  warning: {
    backgroundColor: colors.warningSurface,
  },
});

const badgeTextColors = StyleSheet.create({
  danger: {
    color: colors.danger,
  },
  info: {
    color: colors.accent,
  },
  neutral: {
    color: colors.textSecondary,
  },
  success: {
    color: colors.success,
  },
  warning: {
    color: colors.warning,
  },
});

const badgeSizeStyles = StyleSheet.create({
  lg: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  md: {
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  sm: {
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
});

const badgeTextSizes = StyleSheet.create({
  lg: {
    fontSize: 14,
  },
  md: {
    fontSize: 12,
  },
  sm: {
    fontSize: 12,
  },
});
