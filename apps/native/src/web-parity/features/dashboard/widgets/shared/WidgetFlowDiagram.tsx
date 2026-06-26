// Native parity port of
// web/src/features/dashboard/widgets/shared/WidgetFlowDiagram.tsx.
//
// The web component is a shared dashboard primitive that renders an energy/power
// "flow diagram" inside a 100x100 SVG viewBox: a set of nodes (circles drawn at
// fixed top/bottom/left/right/center positions, each showing an optional icon, an
// animated value and a label) connected by arrows (SVG <line>s whose stroke width
// scales with magnitude, whose colour encodes sign/override, and which animate a
// dashed "flow" when active). It is consumed by EnergyFlowWidget,
// EnergyFlowAnimatedWidget and LivePowerFlowWidget.
//
// React Native has no SVG (no react-native-svg dependency in this app), so the
// geometry is reproduced with absolutely-positioned native Views, mirroring the
// established line-drawing technique in src/components/maps/MapRouteSummary.tsx
// (onLayout -> measured size -> centred + rotated View per segment). The 0..100
// viewBox coordinates are scaled to pixels with the SVG default preserveAspect
// ("xMidYMid meet"): side = min(width,height), scale = side/100, the square is
// centred. AnimatedNumber has no native count-up runtime, so the final formatted
// value renders directly (same convention as the sibling widget ports).
//
// Line-by-line coverage of the source:
//   L1   import {type ReactNode, useMemo} -> kept (plus useState/useCallback +
//        LayoutChangeEvent for the onLayout sizing that replaces SVG h-full/w-full).
//   L2   @/components/data-display AnimatedNumber -> no native count-up; the value
//        is formatted with an inlined fmtNumber(value, 1) and rendered in AppText.
//   L3   @/components/feedback EmptyState -> inlined native EmptyState (message +
//        py-8), matching the message-only call on L84.
//   L4   @/lib/cn -> not needed; className composition becomes RN style arrays.
//   L6-13  FlowNode interface -> ported verbatim (id/label/value/formattedValue/
//        icon?:ReactNode/position union). icon stays ReactNode (native-safe; native
//        consumers pass native nodes).
//   L15-21 FlowArrow interface -> ported verbatim (from/to/value/active/color?).
//   L23-28 WidgetFlowDiagramProps -> ported verbatim (nodes/arrows/compact?/
//        emptyMessage?).
//   L30-38 POSITION_COORDS (top/bottom/left/right/center -> {cx,cy}) -> ported
//        verbatim (viewBox units, scaled to px at render).
//   L40-43 NODE_RADIUS=14 / NODE_RADIUS_COMPACT=10 / MIN_STROKE=1 / MAX_STROKE=4
//        -> ported verbatim.
//   L45-50 arrowColor(value, override) -> ported; the web returns Tailwind text-*
//        classes consumed via stroke-current, so the same branch logic maps to the
//        equivalent hex (emerald-400 #34d399 / red-400 #f87171 / var(--text-muted)),
//        and an override class is resolved through TAILWIND_LINE_COLORS
//        (cyan/emerald/amber/yellow/purple/blue/red-400 — every class the three
//        consumers pass) with a raw-colour passthrough fallback.
//   L52-56 strokeForValue(value, maxValue) -> ported verbatim.
//   L60-65 WidgetFlowDiagram({nodes,arrows,compact=false,emptyMessage='No flow
//        data available'}) -> ported verbatim signature + defaults.
//   L66-69 nodeMap = new Map(nodes.map(n=>[n.id,n])) useMemo -> ported verbatim.
//   L71-76 visibleArrows (all, or compact -> top 3 by |value|) useMemo -> ported
//        verbatim.
//   L78-81 maxArrowValue = max(|value|...,1) useMemo -> ported verbatim.
//   L83-85 nodes.length===0 -> EmptyState(message=emptyMessage) (web className
//        py-8 -> paddingVertical 32) -> ported.
//   L87   r = compact ? NODE_RADIUS_COMPACT : NODE_RADIUS -> ported (viewBox units).
//   L89-106 <svg viewBox 0 0 100 100 h-full w-full> + <defs> dashFlow keyframes ->
//        replaced by an onLayout-measured relative root View; the CSS keyframe has
//        no native runtime so it is dropped (active arrows still render dashed).
//   L108-146 arrows: for each visible arrow look up from/to nodes (skip if either
//        missing), compute dx/dy/dist/unit-vector and the radius-offset endpoints
//        x1,y1,x2,y2 in viewBox units (ported verbatim), strokeForValue width and
//        arrowColor — then convert to px and draw a centred, atan2-rotated View
//        (solid rounded line; active -> dashed border line for the strokeDasharray
//        '4 8' intent). The dashFlow animation has no native runtime.
//   L148-204 nodes: for each node compute its px centre; draw the background circle
//        (fill-white/5 + stroke-white/20 + strokeWidth 0.5 scaled), the centred
//        icon (when present) + value (fmtNumber, text-[5px]/[4px] scaled,
//        font-semibold, var(--text-primary)), and the label (compact>3 ->
//        slice(0,3).toUpperCase()) positioned below ('bottom') / above (others) the
//        node (fill-white/60 + font-medium, text-[4px]/[3px] scaled). All ported.
//   L205-207 closing tags / component end -> ported.
//
// No DOM, no react-i18next, no Recharts/SVG, no Leaflet, no framer-motion and no
// web UI components are imported — only RN primitives plus the existing apps/native
// AppText component and design tokens.

import {useCallback, useMemo, useState, type ReactNode} from 'react';
import {
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../../components/ui/AppText';
import {colors} from '../../../../../theme/tokens';

export interface FlowNode {
  id: string;
  label: string;
  value: number;
  formattedValue: string;
  icon?: ReactNode;
  position: 'top' | 'bottom' | 'left' | 'right' | 'center';
}

export interface FlowArrow {
  from: string;
  to: string;
  value: number;
  active: boolean;
  color?: string;
}

interface WidgetFlowDiagramProps {
  nodes: FlowNode[];
  arrows: FlowArrow[];
  compact?: boolean;
  emptyMessage?: string;
}

/* ── position → viewBox coordinate mapping (100×100) ── */

const POSITION_COORDS: Record<
  FlowNode['position'],
  {cx: number; cy: number}
> = {
  top: {cx: 50, cy: 12},
  bottom: {cx: 50, cy: 88},
  left: {cx: 12, cy: 50},
  right: {cx: 88, cy: 50},
  center: {cx: 50, cy: 50},
};

const NODE_RADIUS = 14;
const NODE_RADIUS_COMPACT = 10;
const MIN_STROKE = 1;
const MAX_STROKE = 4;

/* ── colour mapping ──
 * The web returns Tailwind text-* classes consumed through `stroke-current`. The
 * three consumers pass cyan/emerald/amber/yellow/purple/blue-400 overrides; the
 * default branch yields emerald-400 (positive) / red-400 (negative) /
 * var(--text-muted) (zero). These map to the equivalent hex below. */

const TAILWIND_LINE_COLORS: Record<string, string> = {
  'text-cyan-400': '#22d3ee',
  'text-emerald-400': '#34d399',
  'text-amber-400': '#fbbf24',
  'text-yellow-400': '#facc15',
  'text-purple-400': '#c084fc',
  'text-blue-400': '#60a5fa',
  'text-red-400': '#f87171',
};

const MUTED_LINE_COLOR = colors.textMuted; // var(--text-muted)
const NODE_FILL = 'rgba(255, 255, 255, 0.05)'; // fill-white/5
const NODE_STROKE = 'rgba(255, 255, 255, 0.2)'; // stroke-white/20
const LABEL_COLOR = 'rgba(255, 255, 255, 0.6)'; // fill-white/60

function resolveLineColor(value: string): string {
  return TAILWIND_LINE_COLORS[value] ?? value;
}

function arrowColor(value: number, override?: string): string {
  if (override) {
    return resolveLineColor(override);
  }
  if (value > 0) {
    return TAILWIND_LINE_COLORS['text-emerald-400'];
  }
  if (value < 0) {
    return TAILWIND_LINE_COLORS['text-red-400'];
  }
  return MUTED_LINE_COLOR;
}

function strokeForValue(value: number, maxValue: number): number {
  if (maxValue === 0) {
    return MIN_STROKE;
  }
  const ratio = Math.abs(value) / maxValue;
  return MIN_STROKE + ratio * (MAX_STROKE - MIN_STROKE);
}

/* ── value formatter (AnimatedNumber has no native count-up runtime) ── */

function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function fmtNumber(value: number, decimals: number): string {
  try {
    return safeNumber(value).toLocaleString('en-US', {
      maximumFractionDigits: decimals,
      minimumFractionDigits: decimals,
    });
  } catch {
    return safeNumber(value).toFixed(decimals);
  }
}

/* ── inlined @/components/feedback EmptyState (message only) ── */

function EmptyState({message}: {message: string}) {
  return (
    <View style={styles.empty}>
      <AppText style={styles.emptyText} tone="muted">
        {message}
      </AppText>
    </View>
  );
}

/* ── main component ── */

export function WidgetFlowDiagram({
  nodes,
  arrows,
  compact = false,
  emptyMessage = 'No flow data available',
}: WidgetFlowDiagramProps) {
  const [size, setSize] = useState({width: 0, height: 0});

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const {width, height} = event.nativeEvent.layout;
    setSize(previous =>
      previous.width === width && previous.height === height
        ? previous
        : {width, height},
    );
  }, []);

  const nodeMap = useMemo(
    () => new Map(nodes.map(n => [n.id, n])),
    [nodes],
  );

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
    return <EmptyState message={emptyMessage} />;
  }

  // viewBox → pixel mapping (SVG xMidYMid meet): centre the 100×100 square.
  const side = Math.min(size.width, size.height);
  const scale = side / 100;
  const offsetX = (size.width - side) / 2;
  const offsetY = (size.height - side) / 2;
  const ready = side > 0;

  const r = compact ? NODE_RADIUS_COMPACT : NODE_RADIUS;
  const diameter = 2 * r * scale;
  const nodeBorder = ready ? Math.max(0.5 * scale, 0.5) : 0;
  const valueFont = (compact ? 4 : 5) * scale;
  const labelFont = (compact ? 3 : 4) * scale;
  const labelWidth = Math.max(diameter * 3, 48);

  return (
    <View style={styles.root} onLayout={handleLayout}>
      {/* ── arrows ── */}
      {visibleArrows.map(arrow => {
        const fromNode = nodeMap.get(arrow.from);
        const toNode = nodeMap.get(arrow.to);
        if (!fromNode || !toNode) {
          return null;
        }

        const fromPos = POSITION_COORDS[fromNode.position];
        const toPos = POSITION_COORDS[toNode.position];

        const dx = toPos.cx - fromPos.cx;
        const dy = toPos.cy - fromPos.cy;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const ux = dx / dist;
        const uy = dy / dist;

        // offset start/end by node radius so lines don't overlap circles
        const x1 = fromPos.cx + ux * r;
        const y1 = fromPos.cy + uy * r;
        const x2 = toPos.cx - ux * r;
        const y2 = toPos.cy - uy * r;

        const sw = strokeForValue(arrow.value, maxArrowValue);
        const color = arrowColor(arrow.value, arrow.color);

        // viewBox → px, then draw a centred, rotated line View.
        const px1 = offsetX + x1 * scale;
        const py1 = offsetY + y1 * scale;
        const px2 = offsetX + x2 * scale;
        const py2 = offsetY + y2 * scale;
        const lengthPx = Math.hypot(px2 - px1, py2 - py1);
        const angleRad = Math.atan2(py2 - py1, px2 - px1);
        const thicknessPx = ready ? Math.max(sw * scale, 1) : 0;

        const geometry: ViewStyle = {
          left: (px1 + px2) / 2 - lengthPx / 2,
          top: (py1 + py2) / 2 - thicknessPx / 2,
          width: lengthPx,
          height: thicknessPx,
          transform: [{rotate: `${angleRad}rad`}],
        };

        return (
          <View
            key={`${arrow.from}-${arrow.to}`}
            pointerEvents="none"
            style={[
              styles.arrow,
              geometry,
              arrow.active
                ? [
                    styles.arrowDashed,
                    {borderTopWidth: thicknessPx, borderColor: color},
                  ]
                : {backgroundColor: color, borderRadius: thicknessPx / 2},
            ]}
          />
        );
      })}

      {/* ── nodes ── */}
      {nodes.map(node => {
        const pos = POSITION_COORDS[node.position];
        const cxPx = offsetX + pos.cx * scale;
        const cyPx = offsetY + pos.cy * scale;

        const label =
          compact && node.label.length > 3
            ? node.label.slice(0, 3).toUpperCase()
            : node.label;

        const labelY =
          offsetY +
          (node.position === 'bottom'
            ? pos.cy + r + 5
            : pos.cy - r - 2) *
            scale;

        return (
          <View key={node.id} style={styles.nodeGroup} pointerEvents="none">
            {/* background circle + icon/value */}
            <View
              style={[
                styles.node,
                {
                  left: cxPx - r * scale,
                  top: cyPx - r * scale,
                  width: diameter,
                  height: diameter,
                  borderRadius: diameter / 2,
                  borderWidth: nodeBorder,
                },
              ]}>
              {node.icon ? (
                <View style={styles.iconWrap}>{node.icon}</View>
              ) : null}
              <AppText
                numberOfLines={1}
                style={[styles.valueText, {fontSize: valueFont}]}>
                {fmtNumber(node.value, 1)}
              </AppText>
            </View>

            {/* label below or above node */}
            <View
              style={[
                styles.labelWrap,
                {
                  left: cxPx - labelWidth / 2,
                  top: labelY - labelFont,
                  width: labelWidth,
                },
              ]}>
              <AppText
                numberOfLines={1}
                style={[styles.labelText, {fontSize: labelFont}]}>
                {label}
              </AppText>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    width: '100%',
    position: 'relative',
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32, // py-8
  },
  emptyText: {
    textAlign: 'center',
  },
  arrow: {
    position: 'absolute',
  },
  arrowDashed: {
    borderStyle: 'dashed',
  },
  nodeGroup: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  node: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: NODE_FILL,
    borderColor: NODE_STROKE,
  },
  iconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  valueText: {
    fontWeight: '600', // font-semibold
    color: colors.textPrimary, // var(--text-primary)
    textAlign: 'center',
  },
  labelWrap: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelText: {
    fontWeight: '500', // font-medium
    color: LABEL_COLOR,
    textAlign: 'center',
  },
});
