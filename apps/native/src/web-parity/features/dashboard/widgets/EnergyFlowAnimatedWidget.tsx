// EnergyFlowAnimatedWidget — native parity port of
// web/src/features/dashboard/widgets/EnergyFlowAnimatedWidget.tsx.
//
// The dashboard "Energy Flow" widget. It resolves a vehicle from the explicit
// `vehicleId` prop, falling back to the first vehicle (`useVehicles`), then reads
// that vehicle's live state (`GET /vehicles/{id}/state` via useVehicleState with
// a 5_000 ms refetchInterval). From state it derives power / chargerPower /
// batteryLevel / isCharging and the isConsuming (>0.5) / isRegen (<-0.5) /
// absPower flags. When `size.cols < 2` it renders a stacked CompactView (battery
// %, plus a colour-coded charging / consuming / regen line, or "Idle"); otherwise
// it renders the WidgetFlowDiagram (battery=left, drive/regen/idle=right,
// charger=top nodes wired by three power-flow arrows). Every state name (vehicles,
// id, stateData, state, power, chargerPower, batteryLevel, isCharging,
// isConsuming, isRegen, absPower, isCompact, nodes, arrows), API path, the kW
// unit, number-format precision, the i18n key + English fallback for each label,
// and each render branch is preserved from the web source; all 170 source lines
// are mapped in the .parity.json sidecar.
//
// Native adaptations vs. the web source (behaviour / state / keys preserved):
//   - react-i18next useTranslation('dashboard') (web L2/L60) -> the native
//     t(key, fallback) shim used across the parity tree (the namespace is
//     accepted-and-ignored — there is no i18n runtime in RN). CompactView keeps
//     the exact (key, fallback) => string `t` prop contract (web L18).
//   - lucide-react Battery / Zap / Plug (web L3) -> the native SemanticIcon
//     glyphs 'battery' / 'bolt' (Zap = lightning bolt) / 'charger' (Plug)
//     rendered via glyphNode (lucide is browser-only).
//   - @/components/feedback EmptyState (web L4) -> an inline native EmptyState
//     (centered icon chip + muted message) — the feedback barrel is not in the
//     native parity manifest, so it is reproduced self-contained per the
//     BatteryGaugeWidget precedent.
//   - @/api/hooks useVehicles/useVehicleState (web L5) -> imported from their
//     canonical converted native hooks (../../../api/hooks/useVehicles) — same
//     query keys, same /vehicles + /vehicles/{id}/state paths, same fields and
//     the same {refetchInterval} option shape.
//   - @/lib/numberFormat fmtNumber (web L6) -> ported inline (en-US
//     toLocaleString, default 2 fraction digits = the web global-precision
//     default; safeNumber guard). Every call site passes explicit decimals.
//   - ./WidgetShell (web L7) + ./types WidgetProps (web L9) -> reproduced
//     self-contained here: these sibling widget primitives have their own
//     (later) manifest entries and are not yet in the native tree, so the shell
//     chrome and the WidgetProps/WidgetSize types are ported inline (the
//     BatteryGaugeWidget conversion established this inline-reproduction
//     pattern). WidgetShell's browser-only DataFreshness/PinButton/HelpTooltip/
//     Skeleton/QueryError chrome becomes a native-safe freshness pill (relative
//     "updated" time + a refresh Pressable wired to onRefresh, with stale/error/
//     fetching markers) and a dimmed skeleton box; the source's title + icon +
//     noPadding props are honoured.
//   - ./shared WidgetFlowDiagram + FlowNode/FlowArrow (web L8) -> reproduced
//     self-contained here as a native-safe flow diagram. The web component is an
//     SVG (<svg>/<line>/<circle>/<foreignObject>/<text>) and react-native-svg is
//     NOT a dependency, so the diagram is rebuilt with React Native primitives:
//     the square drawing area is measured via onLayout, the three nodes are
//     absolute-positioned circles (battery left / drive right / charger top) by
//     the same 100-unit POSITION_COORDS fractions, and each arrow becomes an
//     absolute, rotated View line whose thickness comes from the same
//     strokeForValue(value, maxArrowValue) ramp (MIN_STROKE..MAX_STROKE) and
//     whose colour comes from the same arrowColor override/sign rule. The web
//     CSS dash-flow keyframe animation on active arrows is purely cosmetic and
//     has no RN-without-reanimated equivalent, so active arrows are shown at full
//     opacity (inactive dimmed) instead of animated dashes — behaviour, node
//     positions, colours and magnitudes are preserved.
//   - WidgetFlowDiagram's AnimatedNumber (web ./shared, from
//     @/components/data-display) -> the canonical converted native AnimatedNumber
//     (real count-up impl) — same value + decimals={1} contract, fitting the
//     "Animated" widget intent.
//   - web L64 `const state = stateData?.state`: the native hook types `state` as
//     `VehicleState | string | null` (the web hook was loose), so a type-safe
//     narrow keeps the VehicleState object and treats the non-object placeholder
//     as "no state"; the `state` name and the `state ? … : EmptyState` decision
//     are preserved.
//   - web Tailwind colour classes (text-cyan-400 / text-emerald-400 /
//     text-amber-400 / text-red-400 / text-[var(--text-muted)] /
//     text-[var(--text-primary)]) -> their concrete palette hexes (CYAN/EMERALD/
//     AMBER/RED) and the native textMuted/textPrimary tokens, preserving the
//     exact cyan/emerald/amber visual intent.
//
// No DOM / SVG / lucide / react-i18next / Recharts / Leaflet / old web-UI imports
// reach the native output — only react, react-native primitives, the canonical
// AppText + GlassPanel + SemanticIcon, the converted AnimatedNumber + parity
// hooks, and theme tokens.

import React, {type ReactNode} from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import {
  getSemanticIconDefinition,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors} from '../../../../theme/tokens';
import {useVehicles, useVehicleState} from '../../../api/hooks/useVehicles';
import {AnimatedNumber} from '../../../components/data-display/AnimatedNumber';

// ── Ported widget types (web ./types WidgetProps / WidgetSize) ────────────────

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

// ── Ported flow-diagram types (web ./shared FlowNode / FlowArrow) ─────────────

interface FlowNode {
  id: string;
  label: string;
  value: number;
  formattedValue: string;
  icon?: ReactNode;
  position: 'top' | 'bottom' | 'left' | 'right' | 'center';
}

interface FlowArrow {
  from: string;
  to: string;
  value: number;
  active: boolean;
  color?: string;
}

// ── Native-safe i18n fallback (web react-i18next useTranslation) ─────────────

type NativeTFunction = (key: string, fallback: string) => string;

function useNativeTranslationFallback(): NativeTFunction {
  return React.useCallback((_key, fallback) => fallback, []);
}

// ── Ported number format (web @/lib/numberFormat fmtNumber) ───────────────────

function safeNumber(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function fmtNumber(v: unknown, decimals = 2): string {
  return safeNumber(v).toLocaleString('en-US', {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  });
}

// ── Tailwind palette → concrete colour (web colour classes) ───────────────────

const CYAN = '#22d3ee'; // web 'text-cyan-400'
const EMERALD = '#34d399'; // web 'text-emerald-400'
const AMBER = '#fbbf24'; // web 'text-amber-400'
const RED = '#f87171'; // web 'text-red-400'

// ── SemanticIcon glyph node (web lucide icon nodes) ──────────────────────────

/**
 * Renders a decorative glyph in the given colour, replacing a web lucide
 * `<Icon className="…" />` node.
 */
function glyphNode(
  name: SemanticIconName,
  color: string,
  glyphStyle: StyleProp<TextStyle>,
): ReactNode {
  return (
    <AppText
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[glyphStyle, {color}]}
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

// ── Inline native WidgetFlowDiagram (web ./shared WidgetFlowDiagram) ──────────

/* position → fractional coordinate mapping (web 100×100 viewBox / 100). */
const POSITION_COORDS: Record<FlowNode['position'], {cx: number; cy: number}> = {
  top: {cx: 0.5, cy: 0.12},
  bottom: {cx: 0.5, cy: 0.88},
  left: {cx: 0.12, cy: 0.5},
  right: {cx: 0.88, cy: 0.5},
  center: {cx: 0.5, cy: 0.5},
};

const NODE_RADIUS = 0.14;
const NODE_RADIUS_COMPACT = 0.1;
const MIN_STROKE = 1;
const MAX_STROKE = 4;

function arrowColor(value: number, override?: string): string {
  if (override) return override;
  if (value > 0) return EMERALD;
  if (value < 0) return RED;
  return colors.textMuted;
}

function strokeForValue(value: number, maxValue: number): number {
  if (maxValue === 0) return MIN_STROKE;
  const ratio = Math.abs(value) / maxValue;
  return MIN_STROKE + ratio * (MAX_STROKE - MIN_STROKE);
}

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
  const [box, setBox] = React.useState<{w: number; h: number}>({w: 0, h: 0});

  const nodeMap = React.useMemo(() => {
    const map = new Map<string, FlowNode>();
    nodes.forEach(node => map.set(node.id, node));
    return map;
  }, [nodes]);

  const visibleArrows = React.useMemo(() => {
    if (!compact) return arrows;
    return [...arrows]
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .slice(0, 3);
  }, [arrows, compact]);

  const maxArrowValue = React.useMemo(
    () => Math.max(...arrows.map(a => Math.abs(a.value)), 1),
    [arrows],
  );

  const onLayout = React.useCallback((event: LayoutChangeEvent) => {
    const {width, height} = event.nativeEvent.layout;
    setBox(prev =>
      prev.w === width && prev.h === height ? prev : {w: width, h: height},
    );
  }, []);

  if (nodes.length === 0) {
    return (
      // no-action: transient empty state — surfaces when source data is missing;
      // no specific recovery action available.
      <EmptyState message={emptyMessage} />
    );
  }

  const r = compact ? NODE_RADIUS_COMPACT : NODE_RADIUS;
  const side = Math.min(box.w, box.h);
  const rPx = r * side;

  return (
    <View
      accessibilityLabel="Energy flow diagram"
      accessibilityRole="image"
      onLayout={onLayout}
      style={styles.diagram}>
      {side > 0 ? (
        <View
          style={[
            styles.diagramSquare,
            {
              height: side,
              left: (box.w - side) / 2,
              top: (box.h - side) / 2,
              width: side,
            },
          ]}>
          {visibleArrows.map(arrow => {
            const fromNode = nodeMap.get(arrow.from);
            const toNode = nodeMap.get(arrow.to);
            if (!fromNode || !toNode) return null;

            const fromPos = POSITION_COORDS[fromNode.position];
            const toPos = POSITION_COORDS[toNode.position];

            const ax = fromPos.cx * side;
            const ay = fromPos.cy * side;
            const bx = toPos.cx * side;
            const by = toPos.cy * side;

            const dx = bx - ax;
            const dy = by - ay;
            const dist = Math.sqrt(dx * dx + dy * dy) || 1;
            const ux = dx / dist;
            const uy = dy / dist;

            // offset start/end by node radius so lines don't overlap circles
            const x1 = ax + ux * rPx;
            const y1 = ay + uy * rPx;
            const x2 = bx - ux * rPx;
            const y2 = by - uy * rPx;

            const lineLen = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
            const midX = (x1 + x2) / 2;
            const midY = (y1 + y2) / 2;
            const angleDeg = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;

            const sw = strokeForValue(arrow.value, maxArrowValue);
            const color = arrowColor(arrow.value, arrow.color);

            return (
              <View
                key={`${arrow.from}-${arrow.to}`}
                style={[
                  styles.flowLine,
                  {
                    backgroundColor: color,
                    height: sw,
                    left: midX - lineLen / 2,
                    opacity: arrow.active ? 1 : 0.35,
                    top: midY - sw / 2,
                    transform: [{rotate: `${angleDeg}deg`}],
                    width: lineLen,
                  },
                ]}
              />
            );
          })}

          {nodes.map(node => {
            const pos = POSITION_COORDS[node.position];
            const label =
              compact && node.label.length > 3
                ? node.label.slice(0, 3).toUpperCase()
                : node.label;
            const labelAbove = node.position !== 'bottom';

            return (
              <View
                key={node.id}
                style={[
                  styles.nodeCircle,
                  {
                    left: `${(pos.cx - r) * 100}%`,
                    top: `${(pos.cy - r) * 100}%`,
                    width: `${r * 2 * 100}%`,
                  },
                ]}>
                <AppText
                  numberOfLines={1}
                  style={[
                    styles.nodeLabel,
                    labelAbove ? styles.nodeLabelAbove : styles.nodeLabelBelow,
                  ]}>
                  {label}
                </AppText>
                {node.icon ? (
                  <View style={styles.nodeIconWrap}>{node.icon}</View>
                ) : null}
                <AnimatedNumber
                  decimals={1}
                  style={styles.nodeValue}
                  value={node.value}
                />
              </View>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

// ── Compact fallback (1-column / small) — web CompactView ─────────────────────

function CompactView({
  power,
  chargerPower,
  isCharging,
  batteryLevel,
  t,
}: {
  power: number;
  chargerPower: number;
  isCharging: boolean;
  batteryLevel: number;
  t: NativeTFunction;
}) {
  const isConsuming = power > 0.5;
  const isRegen = power < -0.5;

  return (
    <View style={styles.compact}>
      <AppText style={styles.compactLevel}>{`${batteryLevel}%`}</AppText>
      {isCharging ? (
        <View style={styles.compactRow}>
          {glyphNode('charger', AMBER, styles.compactGlyph)}
          <AppText style={[styles.compactText, {color: AMBER}]}>
            {`${fmtNumber(chargerPower, 1)} kW`}
          </AppText>
        </View>
      ) : null}
      {isConsuming ? (
        <View style={styles.compactRow}>
          {glyphNode('bolt', CYAN, styles.compactGlyph)}
          <AppText style={[styles.compactText, {color: CYAN}]}>
            {`${fmtNumber(power, 1)} kW`}
          </AppText>
        </View>
      ) : null}
      {isRegen ? (
        <View style={styles.compactRow}>
          {glyphNode('battery', EMERALD, styles.compactGlyph)}
          <AppText style={[styles.compactText, {color: EMERALD}]}>
            {`${fmtNumber(Math.abs(power), 1)} kW`}
          </AppText>
        </View>
      ) : null}
      {!isConsuming && !isRegen && !isCharging ? (
        <AppText style={styles.compactIdle}>
          {t('widget.energyFlowAnimated.idle', 'Idle')}
        </AppText>
      ) : null}
    </View>
  );
}

// ── Inline native WidgetShell (web ./WidgetShell) ─────────────────────────────

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    year: 'numeric',
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
  else if (updatedAt > 0)
    label = formatRelativeTime(new Date(updatedAt).toISOString());
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
          isError
            ? styles.freshnessError
            : isStale
              ? styles.freshnessStale
              : null,
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
  noPadding,
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
  noPadding?: boolean;
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
      <View style={[styles.shellBody, noPadding ? null : styles.shellBodyPad]}>
        {children}
      </View>
    </GlassPanel>
  );
}

// ── Main widget ──────────────────────────────────────────────────────────────

export default function EnergyFlowAnimatedWidget({
  vehicleId,
  size,
}: WidgetProps) {
  const t = useNativeTranslationFallback();
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
  const stateValue = stateData?.state;
  const state =
    stateValue != null && typeof stateValue === 'object' ? stateValue : undefined;

  const power = state?.power ?? 0;
  const chargerPower = state?.charger_power ?? 0;
  const batteryLevel = state?.battery_level ?? 0;
  const isCharging = state?.is_charging ?? false;
  const isConsuming = power > 0.5;
  const isRegen = power < -0.5;
  const absPower = Math.abs(power);

  const isCompact = size.cols < 2;

  const nodes = React.useMemo<FlowNode[]>(
    () => [
      {
        id: 'battery',
        label: t('widget.energyFlowAnimated.battery', 'Battery'),
        value: batteryLevel,
        formattedValue: `${batteryLevel}%`,
        icon: glyphNode('battery', colors.textPrimary, styles.nodeIcon),
        position: 'left',
      },
      {
        id: 'drive',
        label: isConsuming
          ? t('widget.energyFlowAnimated.drive', 'Drive')
          : isRegen
            ? t('widget.energyFlowAnimated.regen', 'Regen')
            : t('widget.energyFlowAnimated.idle', 'Idle'),
        value: absPower,
        formattedValue:
          isConsuming || isRegen ? `${fmtNumber(absPower, 1)} kW` : '—',
        icon: glyphNode('bolt', colors.textPrimary, styles.nodeIcon),
        position: 'right',
      },
      {
        id: 'charger',
        label: t('widget.energyFlowAnimated.charger', 'Charger'),
        value: chargerPower,
        formattedValue: isCharging ? `${fmtNumber(chargerPower, 0)} kW` : '—',
        icon: glyphNode('charger', colors.textPrimary, styles.nodeIcon),
        position: 'top',
      },
    ],
    [batteryLevel, absPower, chargerPower, isConsuming, isRegen, isCharging, t],
  );

  const arrows = React.useMemo<FlowArrow[]>(
    () => [
      {
        from: 'battery',
        to: 'drive',
        value: isConsuming ? absPower : 0,
        active: isConsuming,
        color: CYAN,
      },
      {
        from: 'drive',
        to: 'battery',
        value: isRegen ? absPower : 0,
        active: isRegen,
        color: EMERALD,
      },
      {
        from: 'charger',
        to: 'battery',
        value: isCharging ? chargerPower : 0,
        active: isCharging,
        color: AMBER,
      },
    ],
    [absPower, chargerPower, isConsuming, isRegen, isCharging],
  );

  return (
    <WidgetShell
      title={t('widget.energyFlowAnimated.title', 'Energy Flow')}
      icon={glyphNode('bolt', CYAN, styles.titleGlyph)}
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
      noPadding>
      {state ? (
        isCompact ? (
          <CompactView
            power={power}
            chargerPower={chargerPower}
            isCharging={isCharging}
            batteryLevel={batteryLevel}
            t={t}
          />
        ) : (
          <View style={styles.diagramWrap}>
            <WidgetFlowDiagram
              nodes={nodes}
              arrows={arrows}
              emptyMessage={t(
                'widget.energyFlowAnimated.noData',
                'No energy data available',
              )}
            />
          </View>
        )
      ) : (
        // no-action: transient empty state — surfaces when source data is
        // missing; no specific recovery action available.
        <EmptyState
          icon={glyphNode('bolt', colors.textMuted, styles.emptyGlyph)}
          message={t(
            'widget.energyFlowAnimated.noData',
            'No energy data available',
          )}
        />
      )}
    </WidgetShell>
  );
}

const styles = StyleSheet.create({
  compact: {
    alignItems: 'center',
    flex: 1,
    gap: 8,
    justifyContent: 'center',
    paddingVertical: 8,
  },
  compactGlyph: {
    fontSize: 10,
    lineHeight: 12,
  },
  compactIdle: {
    color: colors.textMuted,
    fontSize: 12,
  },
  compactLevel: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '700',
  },
  compactRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
  },
  compactText: {
    fontSize: 12,
  },
  diagram: {
    flex: 1,
    minHeight: 120,
    position: 'relative',
  },
  diagramSquare: {
    position: 'absolute',
  },
  diagramWrap: {
    flex: 1,
    paddingBottom: 8,
    paddingHorizontal: 8,
  },
  empty: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 16,
  },
  emptyGlyph: {
    fontSize: 11,
    letterSpacing: 0.2,
    lineHeight: 14,
    textAlign: 'center',
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
  flowLine: {
    borderRadius: 2,
    position: 'absolute',
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
  nodeCircle: {
    alignItems: 'center',
    aspectRatio: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    position: 'absolute',
  },
  nodeIcon: {
    fontSize: 9,
    lineHeight: 11,
    textAlign: 'center',
  },
  nodeIconWrap: {
    alignItems: 'center',
  },
  nodeLabel: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 9,
    fontWeight: '500',
  },
  nodeLabelAbove: {
    bottom: '100%',
    left: 0,
    marginBottom: 2,
    position: 'absolute',
    right: 0,
    textAlign: 'center',
  },
  nodeLabelBelow: {
    left: 0,
    marginTop: 2,
    position: 'absolute',
    right: 0,
    textAlign: 'center',
    top: '100%',
  },
  nodeValue: {
    color: colors.textPrimary,
    fontSize: 11,
    fontWeight: '600',
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
  shellBodyPad: {
    paddingBottom: 8,
    paddingHorizontal: 4,
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
  titleGlyph: {
    fontSize: 13,
    lineHeight: 16,
  },
});
