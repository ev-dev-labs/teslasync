// Native parity port of
// web/src/features/dashboard/widgets/EnergyFlowWidget.tsx.
//
// A dashboard widget that visualises a vehicle's live energy flow. It reads the
// live vehicle state (power / is_charging / charger_power / battery_level) and
// builds a flow diagram with a Battery node (left) and a Motor node (right) —
// labelled "Consuming" / "Regenerating" / "Standby" based on the sign of power —
// plus an optional Charger node (top) when the vehicle is charging. Arrows encode
// the direction + magnitude of the flow: Battery->Motor (cyan, active while
// consuming), Motor->Battery (emerald, active while regenerating) and, when
// charging, Charger->Battery (amber, always active). When there is no live state
// the section falls back to an EmptyState inside the shell (the panel is never
// hidden). The shell renders the title + Activity icon and a query-freshness chip
// wired to refetch, and surfaces the loading state.
//
// The web original leans on browser-only / not-yet-ported infrastructure, so —
// following the established conversion idiom (ChargingOptimizerWidget /
// BatteryHealthAnalyticsWidget) — every such dependency is reproduced inline with
// React Native primitives + the shared native building blocks and documented in
// the sidecar:
//
//   - WidgetShell (web .../WidgetShell.tsx) has no native port yet, so its
//     structure is inlined as `WidgetShell`: loading -> a skeleton block; error ->
//     a centred error box with a retry Pressable (mirrors the web <QueryError>);
//     otherwise a titled header (icon + uppercase muted title + freshness chip)
//     over the children, or — when title-less — the children with the freshness
//     chip overlaid top-right, exactly like the web shell. Only the props this
//     widget passes (title, icon, loading, updatedAt, isFetching, isStale,
//     isError, onRefresh) are honoured; help/widgetId/PinButton/HelpTooltip
//     extras are out of scope.
//   - DataFreshness (web data-display) — the 4-state (fresh/fetching/stale/error)
//     chip the shell renders — is reproduced inline as `WidgetFreshness`: same
//     isError>fetching>stale>fresh precedence, the same dot colour tiers, the
//     "just now / Nm/Nh/Nd/Nw ago" relative ladder, "updating…"/"error" labels,
//     a 30s re-render tick, and onRefresh wired to a Pressable (role=button).
//   - WidgetFlowDiagram (web .../shared/WidgetFlowDiagram.tsx) is an SVG diagram
//     (positioned node circles + variable-stroke animated lines), which RN cannot
//     render without react-native-svg (not a dependency). It is reproduced as a
//     native flex layout: the SVG position map (top/left/right/center/bottom)
//     becomes a top row / a left|center|right main row / a bottom row of node
//     chips, and each SVG <line> becomes a `FlowArrowRow` whose proportional fill
//     bar reproduces the web `strokeForValue` thickness (MIN_STROKE..MAX_STROKE),
//     `resolveArrowColor` reproduces the web `arrowColor`, and the active state
//     (web animated dash) is shown as a fully-opaque vs dimmed bar. The same
//     nodeMap, compact arrow sort+slice(0,3), maxArrowValue, nodes.length===0
//     EmptyState fallback, and compact label slice(0,3).toUpperCase() are kept.
//     The web node renders <AnimatedNumber value decimals={1} /> (NOT the
//     formattedValue), so the native chip shows fmtNumber(value, 1) and surfaces
//     the richer formattedValue via accessibilityLabel.
//   - feedback EmptyState -> shared native EmptyState (web's single `message`
//     becomes the native `title`; the web Activity `icon` + `className` have no
//     native EmptyState slot and are dropped — the energy signal is preserved by
//     the shell header glyph).
//   - lucide-react Activity/BatteryCharging/Zap/Plug have no native icon font;
//     each is reduced to a representative glyph while the meaningful signal — the
//     exact web hex colour — is preserved: Activity -> '\u223F' (neon-cyan, the
//     native `accent` token), BatteryCharging -> '\u26A1' (emerald-400 #34d399),
//     Zap -> '\u26A1' (purple-400 #a78bfa), Plug -> '\u2393' (amber-400 #fbbf24).
//   - @/lib/numberFormat fmtNumber is inlined verbatim (safeNumber guard, default
//     precision 2, en-US grouping) without the useSettings-driven global
//     precision/locale wiring.
//   - WidgetProps (web .../types.ts) -> local `WidgetProps`/`WidgetSize` (only
//     `vehicleId` is read here, matching the web destructure).
//   - react-i18next useTranslation('dashboard') -> a native English-default `t`
//     that keeps every widget.* / freshness.* key + the {{var}} interpolation.
//
// The data hooks are called unchanged: useVehicles() and useVehicleState(id, {
// refetchInterval: 5_000 }) via the native web-parity hooks, so the API paths
// (/vehicles, /vehicles/{id}/state), the snake_case fields (power, is_charging,
// charger_power, battery_level), the 5s refetch interval, and refetch semantics
// are preserved. State names (id, stateData, isLoading, isFetching, isStale,
// isError, dataUpdatedAt, refetch, state, power, isConsuming, isRegen, absPower,
// isCharging, chargerPower, batteryLevel, nodes, arrows) are preserved. No DOM,
// react-router, framer-motion, lucide-react, Recharts, Leaflet, or old web UI
// components are imported.

import React, {useEffect, useMemo, useState} from 'react';
import {Pressable, StyleSheet, View} from 'react-native';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {AppText} from '../../../../components/ui/AppText';
import {colors, spacing} from '../../../../theme/tokens';
import {useVehicleState, useVehicles} from '../../../api/hooks/useVehicles';

/* ─── i18n fallback (mirrors i18next default-value + {{var}} interpolation) ─── */

type TVars = Record<string, string | number>;

// react-i18next is not wired in native; i18next returns the supplied English
// default when a translation is missing, so this fallback returns that default
// while keeping every widget.* / freshness.* key verbatim and applying the same
// {{var}} interpolation as the web `t`.
function t(key: string, fallback: string, vars?: TVars): string {
  let out = fallback ?? key;
  if (vars) {
    for (const varKey of Object.keys(vars)) {
      out = out.split(`{{${varKey}}}`).join(String(vars[varKey]));
    }
  }
  return out;
}

/* ─── Inlined formatter (web @/lib/numberFormat fmtNumber) ────────────────── */

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

// web fmtNumber — locale-grouped, fixed precision. The web global precision
// defaults to 2 (set by useSettings, which native does not wire), so 2 is the
// faithful unconfigured default.
function fmtNumber(v: unknown, decimals = 2): string {
  return safeNumber(v).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/* ─── Widget contract types (web .../types.ts subset) ─────────────────────── */

interface WidgetSize {
  cols: number;
  rows: number;
}

export interface WidgetProps {
  vehicleId?: number;
  size: WidgetSize;
  config?: Record<string, unknown>;
}

/* ─── Flow diagram contract (web .../shared/WidgetFlowDiagram.tsx) ────────── */

type FlowPosition = 'top' | 'bottom' | 'left' | 'right' | 'center';

interface FlowNode {
  id: string;
  label: string;
  value: number;
  formattedValue: string;
  icon?: React.ReactNode;
  position: FlowPosition;
}

interface FlowArrow {
  from: string;
  to: string;
  value: number;
  active: boolean;
  color?: string;
}

// web WidgetFlowDiagram stroke bounds — reused here to size each arrow's fill bar
// so thickness still tracks magnitude (the SVG encoded it as line strokeWidth).
const MIN_STROKE = 1;
const MAX_STROKE = 4;

// web WidgetFlowDiagram.strokeForValue — ported verbatim.
function strokeForValue(value: number, maxValue: number): number {
  if (maxValue === 0) {
    return MIN_STROKE;
  }
  const ratio = Math.abs(value) / maxValue;
  return MIN_STROKE + ratio * (MAX_STROKE - MIN_STROKE);
}

// web Tailwind arrow colour classes -> hex. The widget passes cyan/emerald/amber;
// red + muted cover the web `arrowColor` fallback branches.
const ARROW_COLOR_HEX: Record<string, string> = {
  'text-cyan-400': '#22d3ee',
  'text-emerald-400': '#34d399',
  'text-amber-400': '#fbbf24',
  'text-red-400': '#f87171',
};

// web WidgetFlowDiagram.arrowColor — override wins, else >0 emerald / <0 red /
// 0 muted — mapped from the class strings to native hex.
function resolveArrowColor(value: number, override?: string): string {
  if (override) {
    return ARROW_COLOR_HEX[override] ?? colors.textMuted;
  }
  if (value > 0) {
    return ARROW_COLOR_HEX['text-emerald-400'];
  }
  if (value < 0) {
    return ARROW_COLOR_HEX['text-red-400'];
  }
  return colors.textMuted;
}

/* ─── Icon glyphs (web lucide Activity / BatteryCharging / Zap / Plug) ────── */

function ActivityGlyph() {
  return (
    <AppText
      variant="caption"
      weight="bold"
      accessibilityElementsHidden
      style={styles.activityGlyph}>
      {'\u223F'}
    </AppText>
  );
}

function NodeIcon({glyph, color}: {glyph: string; color: string}) {
  return (
    <AppText
      variant="caption"
      weight="bold"
      accessibilityElementsHidden
      style={[styles.nodeGlyph, {color}]}>
      {glyph}
    </AppText>
  );
}

/* ─── WidgetFreshness (web data-display DataFreshness 4-state chip) ────────── */

type FreshnessStatus = 'fresh' | 'fetching' | 'stale' | 'error';

// web FRESHNESS_COLORS dot tiers (emerald-400 / sky-400 / amber-400 / red-400).
const FRESHNESS_DOT: Record<FreshnessStatus, string> = {
  fresh: '#34d399',
  fetching: '#38bdf8',
  stale: '#fbbf24',
  error: '#f87171',
};

// web DataFreshness.formatRelativeTime — minute/hour/day/week relative ladder.
function formatFreshnessRelative(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) {
    return t('freshness.justNow', 'just now');
  }
  if (seconds < 3600) {
    return t('freshness.minutes', '{{m}}m ago', {m: Math.floor(seconds / 60)});
  }
  if (seconds < 86_400) {
    return t('freshness.hours', '{{h}}h ago', {h: Math.floor(seconds / 3600)});
  }
  if (seconds < 604_800) {
    return t('freshness.days', '{{d}}d ago', {d: Math.floor(seconds / 86_400)});
  }
  return t('freshness.weeks', '{{w}}w ago', {w: Math.floor(seconds / 604_800)});
}

function useThirtySecondTick(active: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) {
      return;
    }
    const id = setInterval(() => setTick(n => n + 1), 30_000);
    return () => clearInterval(id);
  }, [active]);
}

function WidgetFreshness({
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
}: {
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
}) {
  useThirtySecondTick(!!updatedAt && updatedAt > 0);

  const status: FreshnessStatus = isError
    ? 'error'
    : isFetching
      ? 'fetching'
      : isStale
        ? 'stale'
        : 'fresh';

  const relativeTime =
    updatedAt && updatedAt > 0 && !isFetching
      ? formatFreshnessRelative(updatedAt)
      : isFetching
        ? t('freshness.updating', 'updating\u2026')
        : isError
          ? t('freshness.error', 'error')
          : '';

  const refreshable = !!onRefresh && !isFetching;

  return (
    <Pressable
      accessibilityRole={onRefresh ? 'button' : 'text'}
      accessibilityLabel={
        onRefresh
          ? t('freshness.refresh', 'Refresh')
          : t('a11y.dataFreshness', 'Data freshness: {{state}}', {state: status})
      }
      accessibilityState={{disabled: !refreshable}}
      disabled={!refreshable}
      onPress={() => {
        if (refreshable) {
          onRefresh?.();
        }
      }}
      testID="energy-flow-freshness"
      style={styles.freshness}>
      <View
        style={[styles.freshnessDot, {backgroundColor: FRESHNESS_DOT[status]}]}
        testID="energy-flow-freshness-dot"
      />
      {relativeTime ? (
        <AppText
          variant="caption"
          tone="muted"
          numberOfLines={1}
          style={styles.freshnessLabel}>
          {relativeTime}
        </AppText>
      ) : null}
    </Pressable>
  );
}

/* ─── WidgetShell (web .../WidgetShell.tsx subset) ────────────────────────── */

function WidgetShell({
  title,
  icon,
  loading,
  error,
  updatedAt,
  isFetching,
  isStale,
  isError,
  onRefresh,
  children,
}: {
  title?: string;
  icon?: React.ReactNode;
  loading?: boolean;
  error?: string | null;
  updatedAt?: number;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  onRefresh?: () => void;
  children: React.ReactNode;
}) {
  if (loading) {
    return <View style={styles.skeleton} testID="energy-flow-loading" />;
  }

  if (error) {
    return (
      <View style={styles.errorBox} testID="energy-flow-error">
        <AppText tone="danger" weight="semibold" numberOfLines={3}>
          {error}
        </AppText>
        {onRefresh ? (
          <Pressable
            accessibilityRole="button"
            onPress={onRefresh}
            testID="energy-flow-error-retry">
            <AppText variant="caption" tone="accent">
              {t('common.retry', 'Retry')}
            </AppText>
          </Pressable>
        ) : null}
      </View>
    );
  }

  const freshness = (
    <WidgetFreshness
      updatedAt={updatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={onRefresh}
    />
  );

  // Title-less widgets overlay the freshness chip top-right, like the web shell.
  if (!title) {
    return (
      <View style={styles.shell} testID="energy-flow-widget">
        <View style={styles.freshnessOverlay}>{freshness}</View>
        <View style={styles.shellBody}>{children}</View>
      </View>
    );
  }

  return (
    <View style={styles.shell} testID="energy-flow-widget">
      <View style={styles.shellHeader}>
        <View style={styles.shellTitleRow}>
          {icon}
          <AppText
            accessibilityRole="header"
            numberOfLines={1}
            style={styles.shellTitle}>
            {title}
          </AppText>
        </View>
        {freshness}
      </View>
      <View style={styles.shellBody}>{children}</View>
    </View>
  );
}

/* ─── FlowNodeChip (web WidgetFlowDiagram node: circle + value + label) ───── */

function FlowNodeChip({node, compact}: {node: FlowNode; compact: boolean}) {
  // web: compact && label.length > 3 ? label.slice(0,3).toUpperCase() : label.
  const label =
    compact && node.label.length > 3
      ? node.label.slice(0, 3).toUpperCase()
      : node.label;

  return (
    <View style={styles.node} testID={`energy-flow-node-${node.id}`}>
      <View style={styles.nodeCircle}>
        {node.icon}
        {/* web renders <AnimatedNumber value decimals={1} />, not formattedValue;
            the richer formattedValue is surfaced via accessibilityLabel. */}
        <AppText
          weight="semibold"
          numberOfLines={1}
          accessibilityLabel={node.formattedValue}
          style={styles.nodeValue}>
          {fmtNumber(node.value, 1)}
        </AppText>
      </View>
      <AppText
        variant="caption"
        tone="muted"
        numberOfLines={1}
        style={styles.nodeLabel}>
        {label}
      </AppText>
    </View>
  );
}

/* ─── FlowArrowRow (web WidgetFlowDiagram <line>: direction + magnitude) ───── */

function FlowArrowRow({
  fromLabel,
  toLabel,
  value,
  active,
  color,
  ratio,
  thickness,
}: {
  fromLabel: string;
  toLabel: string;
  value: number;
  active: boolean;
  color: string;
  ratio: number;
  thickness: number;
}) {
  return (
    <View style={styles.arrowRow} testID="energy-flow-arrow">
      <AppText
        variant="caption"
        tone="muted"
        numberOfLines={1}
        style={styles.arrowLabel}>
        {fromLabel} {'\u2192'} {toLabel}
      </AppText>
      <View style={styles.arrowTrack}>
        <View
          style={[
            styles.arrowFill,
            {
              backgroundColor: color,
              width: `${Math.max(ratio * 100, 6)}%`,
              height: thickness * 2,
              opacity: active ? 1 : 0.3,
            },
          ]}
        />
      </View>
      <AppText
        variant="caption"
        weight="semibold"
        numberOfLines={1}
        style={[styles.arrowValue, {color}]}>
        {fmtNumber(Math.abs(value), 1)}
      </AppText>
    </View>
  );
}

/* ─── WidgetFlowDiagram (web .../shared/WidgetFlowDiagram.tsx native render) ── */

function WidgetFlowDiagram({
  nodes,
  arrows,
  compact = false,
  emptyMessage = 'No flow data available',
}: {
  nodes: FlowNode[];
  arrows: FlowArrow[];
  compact?: boolean;
  emptyMessage?: string;
}) {
  const nodeMap = useMemo(
    () => new Map(nodes.map(n => [n.id, n])),
    [nodes],
  );

  // web: compact keeps only the 3 strongest arrows (sorted by |value|).
  const visibleArrows = useMemo(() => {
    if (!compact) {
      return arrows;
    }
    return [...arrows]
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .slice(0, 3);
  }, [arrows, compact]);

  const maxArrowValue = useMemo(
    () => Math.max(...arrows.map(a => Math.abs(a.value)), 1),
    [arrows],
  );

  if (nodes.length === 0) {
    return (
      <View testID="energy-flow-diagram-empty">
        <EmptyState title={emptyMessage} message="" />
      </View>
    );
  }

  // web SVG positions -> native flex regions (top row / left|center|right / bottom).
  const topNodes = nodes.filter(n => n.position === 'top');
  const leftNodes = nodes.filter(n => n.position === 'left');
  const centerNodes = nodes.filter(n => n.position === 'center');
  const rightNodes = nodes.filter(n => n.position === 'right');
  const bottomNodes = nodes.filter(n => n.position === 'bottom');

  return (
    <View style={styles.diagram} testID="energy-flow-diagram">
      {topNodes.length > 0 ? (
        <View style={styles.diagramRowCenter}>
          {topNodes.map(n => (
            <FlowNodeChip key={n.id} node={n} compact={compact} />
          ))}
        </View>
      ) : null}

      <View style={styles.diagramMainRow}>
        <View style={styles.diagramSide}>
          {leftNodes.map(n => (
            <FlowNodeChip key={n.id} node={n} compact={compact} />
          ))}
        </View>
        {centerNodes.length > 0 ? (
          <View style={styles.diagramSide}>
            {centerNodes.map(n => (
              <FlowNodeChip key={n.id} node={n} compact={compact} />
            ))}
          </View>
        ) : null}
        <View style={styles.diagramSide}>
          {rightNodes.map(n => (
            <FlowNodeChip key={n.id} node={n} compact={compact} />
          ))}
        </View>
      </View>

      {bottomNodes.length > 0 ? (
        <View style={styles.diagramRowCenter}>
          {bottomNodes.map(n => (
            <FlowNodeChip key={n.id} node={n} compact={compact} />
          ))}
        </View>
      ) : null}

      <View style={styles.diagramArrows}>
        {visibleArrows.map(arrow => {
          const fromNode = nodeMap.get(arrow.from);
          const toNode = nodeMap.get(arrow.to);
          if (!fromNode || !toNode) {
            return null;
          }
          const thickness = strokeForValue(arrow.value, maxArrowValue);
          const color = resolveArrowColor(arrow.value, arrow.color);
          const ratio =
            maxArrowValue === 0 ? 0 : Math.abs(arrow.value) / maxArrowValue;
          return (
            <FlowArrowRow
              key={`${arrow.from}-${arrow.to}`}
              fromLabel={fromNode.label}
              toLabel={toNode.label}
              value={arrow.value}
              active={arrow.active}
              color={color}
              ratio={ratio}
              thickness={thickness}
            />
          );
        })}
      </View>
    </View>
  );
}

/* ─── EnergyFlowWidget (web .../EnergyFlowWidget.tsx default export) ───────── */

export default function EnergyFlowWidget({vehicleId}: WidgetProps) {
  const {data: vehicles} = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const {
    data: stateData,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useVehicleState(id, {refetchInterval: 5_000});

  // web `state = stateData?.state`. The native hook types `state` as
  // VehicleState | string | null; narrow to the object form so the field reads +
  // the render guard behave exactly like the web (runtime only ever yields a
  // VehicleState object or undefined on this path).
  const rawState = stateData?.state;
  const state =
    rawState != null && typeof rawState === 'object' ? rawState : undefined;

  const power = state?.power ?? 0;
  const isConsuming = power > 0;
  const isRegen = power < 0;
  const absPower = Math.abs(power);
  const isCharging = state?.is_charging ?? false;
  const chargerPower = state?.charger_power ?? 0;
  const batteryLevel = state?.battery_level ?? 0;

  const nodes = useMemo<FlowNode[]>(() => {
    const result: FlowNode[] = [
      {
        id: 'battery',
        label: t('widget.battery', 'Battery'),
        value: batteryLevel,
        formattedValue: `${batteryLevel}%`,
        icon: <NodeIcon glyph={'\u26A1'} color="#34d399" />,
        position: 'left',
      },
      {
        id: 'motor',
        label: isConsuming
          ? t('widget.consuming', 'Consuming')
          : isRegen
            ? t('widget.regenerating', 'Regenerating')
            : t('widget.standby', 'Standby'),
        value: absPower,
        formattedValue: absPower > 0 ? `${fmtNumber(absPower, 1)} kW` : '\u2014',
        icon: <NodeIcon glyph={'\u26A1'} color="#a78bfa" />,
        position: 'right',
      },
    ];

    if (isCharging) {
      result.push({
        id: 'charger',
        label: t('widget.charger', 'Charger'),
        value: chargerPower,
        formattedValue: `${fmtNumber(chargerPower, 1)} kW`,
        icon: <NodeIcon glyph={'\u2393'} color="#fbbf24" />,
        position: 'top',
      });
    }

    return result;
  }, [batteryLevel, absPower, isConsuming, isRegen, isCharging, chargerPower]);

  const arrows = useMemo<FlowArrow[]>(() => {
    const result: FlowArrow[] = [
      {
        from: 'battery',
        to: 'motor',
        value: isConsuming ? absPower : 0,
        active: isConsuming,
        color: 'text-cyan-400',
      },
      {
        from: 'motor',
        to: 'battery',
        value: isRegen ? absPower : 0,
        active: isRegen,
        color: 'text-emerald-400',
      },
    ];

    if (isCharging) {
      result.push({
        from: 'charger',
        to: 'battery',
        value: chargerPower,
        active: true,
        color: 'text-amber-400',
      });
    }

    return result;
  }, [absPower, isConsuming, isRegen, isCharging, chargerPower]);

  return (
    <WidgetShell
      title={t('widget.energyFlow', 'Energy Flow')}
      icon={<ActivityGlyph />}
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}>
      {state ? (
        <WidgetFlowDiagram
          nodes={nodes}
          arrows={arrows}
          emptyMessage={t('widget.noEnergyData', 'No energy data available')}
        />
      ) : (
        <View testID="energy-flow-empty">
          <EmptyState
            title={t('widget.noEnergyData', 'No energy data available')}
            message=""
          />
        </View>
      )}
    </WidgetShell>
  );
}

EnergyFlowWidget.displayName = 'EnergyFlowWidget';

const styles = StyleSheet.create({
  skeleton: {
    height: 180,
    borderRadius: 16,
    backgroundColor: colors.surfaceRaised,
  },
  errorBox: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    padding: spacing.md,
  },
  shell: {
    gap: spacing.sm,
  },
  shellHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  shellTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexShrink: 1,
  },
  shellTitle: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.textMuted,
    flexShrink: 1,
  },
  shellBody: {
    gap: spacing.sm,
  },
  freshnessOverlay: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  freshness: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  freshnessDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  freshnessLabel: {
    fontSize: 11,
  },
  activityGlyph: {
    color: colors.accent,
  },
  nodeGlyph: {
    fontSize: 14,
    lineHeight: 18,
  },
  diagram: {
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  diagramRowCenter: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  diagramMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  diagramSide: {
    flex: 1,
    alignItems: 'center',
  },
  node: {
    alignItems: 'center',
    gap: spacing.xs,
  },
  nodeCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  nodeValue: {
    fontSize: 13,
  },
  nodeLabel: {
    fontSize: 11,
    textAlign: 'center',
  },
  diagramArrows: {
    gap: spacing.sm,
  },
  arrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  arrowLabel: {
    width: 132,
  },
  arrowTrack: {
    flex: 1,
    height: 10,
    borderRadius: 999,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  arrowFill: {
    borderRadius: 999,
  },
  arrowValue: {
    width: 48,
    textAlign: 'right',
  },
});
