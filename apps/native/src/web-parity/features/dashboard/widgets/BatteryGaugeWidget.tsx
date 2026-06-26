// BatteryGaugeWidget — native parity port of
// web/src/features/dashboard/widgets/BatteryGaugeWidget.tsx.
//
// The dashboard "Battery" gauge widget. It resolves a vehicle from the explicit
// `vehicleId` prop, falling back to the first vehicle (`useVehicles`), then reads
// that vehicle's live state (`GET /vehicles/{id}/state` via useVehicleState). A
// RadialGauge renders the battery level as a percentage, tinted by a 50/20
// threshold palette (green / amber / red, grey when there is no state). A
// charging indicator is shown beneath the gauge when `state.is_charging` is true
// (standard size only — the gauge hero suppresses children in compact 1×1
// layouts). Every state name (vehicles, id, stateData, state, isCompact),
// API path, threshold hex, the `%` unit, the i18n key + English fallback, and
// each render branch is preserved from the web source; all 59 source lines are
// mapped in the .parity.json sidecar.
//
// Native adaptations vs. the web source (behaviour / state / keys preserved):
//   - react-i18next useTranslation('dashboard') (web L1/L10) -> the native
//     t(key, fallback) shim used across the parity tree (the namespace is
//     accepted-and-ignored — there is no i18n runtime in RN).
//   - lucide-react Battery (web L2) -> the native SemanticIcon 'battery' glyph
//     (lucide is browser-only); rendered as a muted decorative glyph inside the
//     empty-state icon chip.
//   - @/components/feedback EmptyState (web L3) -> an inline native EmptyState
//     (centered icon chip + muted message) — the feedback barrel is not in the
//     native parity manifest, so it is reproduced self-contained per the
//     AuditLogWidget precedent.
//   - ./shared WidgetGaugeHero (web L5) + ./WidgetShell (web L6) + ./types
//     WidgetProps (web L7) -> reproduced self-contained here: these sibling
//     widget primitives have their own (later) manifest entries and are not yet
//     in the native tree, so the gauge-hero layout, the shell chrome, and the
//     WidgetProps/WidgetSize/GaugeHeroConfig/GaugeHeroStat types are ported
//     inline (AuditLogWidget established this inline-reproduction pattern).
//     WidgetShell's browser-only DataFreshness/PinButton/HelpTooltip/Skeleton/
//     QueryError chrome becomes a native-safe freshness pill (relative "updated"
//     time + a refresh Pressable wired to onRefresh, with stale/error/fetching
//     markers) and a dimmed skeleton box.
//   - WidgetGaugeHero's RadialGauge (web ./shared, from @/components/charts) ->
//     the canonical converted native barrel RadialGauge (real native impl) —
//     same value/max/label/unit/color/size props.
//   - @/api/hooks useVehicles/useVehicleState (web L4) -> imported from their
//     canonical converted native hooks (../../../api/hooks/useVehicles) — same
//     query keys, same /vehicles + /vehicles/{id}/state paths, same fields.
//   - web L14 `const state = stateData?.state`: the native hook types `state`
//     strictly as `VehicleState | string | null` (the web hook was `any`), so a
//     type-safe narrow keeps the VehicleState object and treats the non-object
//     placeholder as "no state" (the only meaningful runtime branch); the
//     `state` name and the `state ? gauge : empty` decision are preserved.
//
// No DOM / lucide / react-i18next / Recharts / Leaflet / old web-UI imports
// reach the native output — only react, react-native primitives, the canonical
// AppText + GlassPanel + SemanticIcon + RadialGauge, the parity hooks, and
// theme tokens.

import React, {type ReactNode} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {RadialGauge} from '../../../components/charts';
import {
  getSemanticIconDefinition,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors} from '../../../../theme/tokens';
import {useVehicles, useVehicleState} from '../../../api/hooks/useVehicles';

// ── Ported widget types (web ./types WidgetProps, ./shared gauge config) ──────

/** Grid footprint in cols/rows (web `./types` WidgetSize). */
interface WidgetSize {
  cols: number; // 1-4
  rows: number; // 1-8
}

/** Widget render props (web `./types` WidgetProps). `config` is accepted for
 *  source parity but, like the web source, this widget reads only vehicleId +
 *  size. */
interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: Record<string, unknown>;
}

/** Gauge configuration (web `./shared` GaugeHeroConfig). */
interface GaugeHeroConfig {
  value: number;
  max: number;
  label: string;
  unit: string;
  color: string;
}

/** Optional supporting stat (web `./shared` GaugeHeroStat). */
interface GaugeHeroStat {
  label: string;
  value: string | number;
  unit?: string;
}

// ── Native-safe i18n fallback (web react-i18next useTranslation) ─────────────

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return React.useCallback((_key, fallback) => fallback, []);
}

// ── SemanticIcon glyph node (web lucide icon nodes) ──────────────────────────

/**
 * Renders a decorative glyph in the given color, replacing the web lucide
 * `<Icon className="h-6 w-6" />` node passed to the empty state.
 */
function glyphNode(name: SemanticIconName, color: string): ReactNode {
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.iconGlyph, {color}]}
      weight="bold">
      {getSemanticIconDefinition(name).glyph}
    </AppText>
  );
}

// ── Inline native EmptyState (web @/components/feedback EmptyState) ───────────

function EmptyState({icon, message}: {icon?: ReactNode; message: string}) {
  return (
    <View accessible accessibilityLabel={message} style={styles.empty}>
      {icon ? <View style={styles.emptyIcon}>{icon}</View> : null}
      <AppText style={styles.emptyMessage} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

// ── Inline native WidgetGaugeHero (web ./shared WidgetGaugeHero) ──────────────

function WidgetGaugeHero({
  gauge,
  stats,
  compact,
  children,
}: {
  gauge: GaugeHeroConfig;
  stats?: GaugeHeroStat[];
  compact?: boolean;
  children?: ReactNode;
}) {
  // Compact size never grows; the standard size renders at the wider radius.
  const size = compact ? 70 : 100;

  return (
    <View style={styles.gaugeHero}>
      <RadialGauge
        value={gauge.value}
        max={gauge.max}
        label={gauge.label}
        unit={gauge.unit}
        color={gauge.color}
        size={size}
      />

      {!compact && stats && stats.length > 0 ? (
        <View style={styles.statsRow}>
          {stats.map((stat) => (
            <View key={stat.label} style={styles.statItem}>
              <AppText numberOfLines={1} style={styles.statLabel} tone="secondary">
                {stat.label}
              </AppText>
              <AppText numberOfLines={1} style={styles.statValue}>
                {stat.value}
                {stat.unit ? (
                  <AppText style={styles.statUnit} tone="secondary">
                    {` ${stat.unit}`}
                  </AppText>
                ) : null}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}

      {!compact && children ? children : null}
    </View>
  );
}

// ── Inline native WidgetShell (web ./WidgetShell) ─────────────────────────────

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Relative "updated" time: <1m "Just now", <60m "Xm ago", <24h "Xh ago",
 *  else the absolute date-time. */
function formatRelativeTime(isoStr: string): string {
  const d = new Date(isoStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  return formatDateTime(isoStr);
}

/** Native-safe freshness pill: relative "updated" time + refresh affordance,
 *  reflecting the query's fetching/stale/error flags. Replaces the web
 *  DataFreshness chrome (which depends on browser-only timers/icons). */
function DataFreshness({
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
}: {
  updatedAt: number;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  onRefresh?: () => void;
}) {
  let label: string;
  if (isError) label = 'Error';
  else if (isFetching) label = 'Updating…';
  else if (updatedAt > 0) label = formatRelativeTime(new Date(updatedAt).toISOString());
  else label = 'Never';

  return (
    <Pressable
      accessibilityLabel="Refresh"
      accessibilityRole="button"
      hitSlop={6}
      onPress={onRefresh}
      style={styles.freshness}>
      <AppText
        style={[
          styles.freshnessText,
          isError ? styles.freshnessError : isStale ? styles.freshnessStale : null,
        ]}>
        {label}
      </AppText>
      <AppText style={styles.refreshGlyph} weight="bold">
        {getSemanticIconDefinition('refresh').glyph}
      </AppText>
    </Pressable>
  );
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
}: {
  title?: string;
  icon?: ReactNode;
  loading?: boolean;
  children: ReactNode;
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
}) {
  if (loading) {
    return <View accessibilityLabel="Loading" style={styles.skeleton} />;
  }

  return (
    <GlassPanel style={styles.shell}>
      <View style={styles.shellHeader}>
        <View style={styles.shellTitleGroup}>
          {icon}
          {title ? <AppText style={styles.shellTitle}>{title}</AppText> : null}
        </View>
        <DataFreshness
          isError={isError ?? false}
          isFetching={isFetching ?? false}
          isStale={isStale ?? false}
          onRefresh={onRefresh}
          updatedAt={updatedAt ?? 0}
        />
      </View>
      <View style={styles.shellBody}>{children}</View>
    </GlassPanel>
  );
}

// ── Main widget ────────────────────────────────────────────────────────────────

export default function BatteryGaugeWidget({vehicleId, size}: WidgetProps) {
  const t = useNativeTranslationFallback();
  const {data: vehicles} = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const {data: stateData, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch} =
    useVehicleState(id);
  const stateValue = stateData?.state;
  const state =
    stateValue != null && typeof stateValue === 'object' ? stateValue : undefined;
  const isCompact = size.cols === 1 && size.rows === 1;

  const batteryColor = () => {
    if (!state) return '#374151';
    if (state.battery_level > 50) return '#10b981';
    if (state.battery_level > 20) return '#f59e0b';
    return '#ef4444';
  };

  return (
    <WidgetShell
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}>
      {state ? (
        <WidgetGaugeHero
          gauge={{
            value: state.battery_level,
            max: 100,
            label: t('widget.battery', 'Battery'),
            unit: '%',
            color: batteryColor(),
          }}
          compact={isCompact}>
          {state.is_charging ? (
            <AppText style={styles.chargingText}>
              {`⚡ ${t('widget.charging', 'Charging')}`}
            </AppText>
          ) : null}
        </WidgetGaugeHero>
      ) : (
        <EmptyState
          icon={glyphNode('battery', colors.textMuted)}
          message={t('widget.noBattery', 'No battery data')}
        />
      )}
    </WidgetShell>
  );
}

const styles = StyleSheet.create({
  chargingText: {
    color: colors.success,
    fontSize: 10,
    marginTop: 8,
    textAlign: 'center',
  },
  empty: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  emptyIcon: {
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  emptyMessage: {
    textAlign: 'center',
  },
  freshness: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  freshnessError: {
    color: colors.danger,
  },
  freshnessStale: {
    color: colors.warning,
  },
  freshnessText: {
    color: colors.textMuted,
    fontSize: 11,
  },
  gaugeHero: {
    alignItems: 'center',
    gap: 8,
    justifyContent: 'center',
    paddingVertical: 8,
  },
  iconGlyph: {
    fontSize: 11,
    letterSpacing: 0.2,
    lineHeight: 14,
    textAlign: 'center',
  },
  refreshGlyph: {
    color: colors.accent,
    fontSize: 10,
  },
  shell: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  shellBody: {
    flex: 1,
    justifyContent: 'center',
    minHeight: 0,
  },
  shellHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  shellTitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  shellTitleGroup: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  skeleton: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: 24,
    flex: 1,
    minHeight: 120,
  },
  statItem: {
    alignItems: 'center',
    minWidth: 0,
  },
  statLabel: {
    fontSize: 12,
  },
  statUnit: {
    fontSize: 12,
    fontWeight: '400',
  },
  statValue: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  statsRow: {
    alignItems: 'center',
    columnGap: 16,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    rowGap: 4,
  },
});
