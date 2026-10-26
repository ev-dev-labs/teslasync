import { type ReactNode, useMemo } from 'react';
import { EmptyState } from '@/components/feedback';
import { cn } from '@/lib/cn';

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
  /**
   * Optional caller-formatted link annotation (e.g. "4.2 kW"), rendered once
   * at the link midpoint in the After style. Omitted links render no label —
   * the value already appears in the node caption, and values are never
   * fabricated from the raw number here (units/i18n live at the call site).
   */
  label?: string;
}

interface WidgetFlowDiagramProps {
  nodes: FlowNode[];
  arrows: FlowArrow[];
  compact?: boolean;
  emptyMessage?: string;
  /** Accessible name for the diagram. Localise at the call site (like `emptyMessage`). */
  ariaLabel?: string;
}

/* ── Slot coordinates in the After `flow` viewBox (300 wide; taller than the
   helper's 150 so the two-line accessible caption never clips) ── */

const POSITION_COORDS: Record<FlowNode['position'], { cx: number; cy: number }> = {
  left: { cx: 40, cy: 70 },
  right: { cx: 260, cy: 70 },
  center: { cx: 150, cy: 70 },
  top: { cx: 150, cy: 30 },
  bottom: { cx: 150, cy: 115 },
};

const NODE_RADIUS = 19;
const NODE_RADIUS_COMPACT = 15;
/* After link language: flowing links 3px dashed + animated, idle links 1.5px. */
const FLOWING_STROKE_WIDTH = 3;
const IDLE_STROKE_WIDTH = 1.5;
const FLOW_DASH = '6 5';
const ICON_BOX = 20;

/** A link animates only when the caller marks it active AND it carries flow. */
function isFlowing(arrow: FlowArrow): boolean {
  return arrow.active && (arrow.value ?? 0) !== 0;
}

function linkColor(arrow: FlowArrow, flowing: boolean): string {
  if (arrow.color) return arrow.color;
  // Spec rule 4: color means status only. Idle links are neutral; the flowing
  // default is the restrained info accent — never sign-derived red/green.
  return flowing ? 'text-[var(--semantic-info)]' : 'text-[var(--border-default)]';
}

/**
 * Caption under a node: the After "Name value" line split into two stacked
 * elements — the muted name, then the caller-formatted reading in primary
 * semibold. Separate elements (not one concatenated string) so each stays
 * individually queryable by assistive tech and by the callers' exact-text
 * assertions (`getByText('Drive')`, `getAllByText('—')`).
 */
function captionFor(node: FlowNode, compact: boolean): { name: string; reading: string } {
  const rawLabel = node.label ?? '';
  const name = compact && rawLabel.length > 3 ? rawLabel.slice(0, 3).toUpperCase() : rawLabel;
  // Null/undefined means unknown (em dash); an explicit '' means the caller
  // intentionally blanks the reading (e.g. a bus node), so keep it blank.
  const reading = node.formattedValue ?? '—';
  return { name, reading };
}

/* ── main component ── */

export function WidgetFlowDiagram({
  nodes,
  arrows,
  compact = false,
  emptyMessage = 'No flow data available',
  ariaLabel = 'Energy flow diagram',
}: WidgetFlowDiagramProps) {
  const nodeMap = useMemo(
    () => new Map(nodes.map((n) => [n.id, n])),
    [nodes],
  );

  const visibleArrows = useMemo(() => {
    if (!compact) return arrows;
    return [...arrows]
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .slice(0, 3);
  }, [arrows, compact]);

  if (nodes.length === 0) {
    return <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={emptyMessage} className="py-8" />;
  }

  const r = compact ? NODE_RADIUS_COMPACT : NODE_RADIUS;

  return (
    <svg
      viewBox="0 0 300 170"
      className="mx-auto h-auto w-full"
      role="img"
      aria-label={ariaLabel}
    >
      {/* ── links (drawn first so node discs cover the endpoints) ── */}
      {visibleArrows.map((arrow) => {
        const fromNode = nodeMap.get(arrow.from);
        const toNode = nodeMap.get(arrow.to);
        if (!fromNode || !toNode) return null;

        const fromPos = POSITION_COORDS[fromNode.position] ?? POSITION_COORDS.center;
        const toPos = POSITION_COORDS[toNode.position] ?? POSITION_COORDS.center;
        const midX = (fromPos.cx + toPos.cx) / 2;
        const midY = (fromPos.cy + toPos.cy) / 2;

        const flowing = isFlowing(arrow);
        const colorClass = linkColor(arrow, flowing);
        const linkLabel = arrow.label?.trim() ? arrow.label : null;

        return (
          <g key={`${arrow.from}-${arrow.to}`}>
            <path
              d={`M${fromPos.cx} ${fromPos.cy} C${midX} ${fromPos.cy} ${midX} ${toPos.cy} ${toPos.cx} ${toPos.cy}`}
              fill="none"
              className={cn('stroke-current', colorClass, flowing && 'flow-active')}
              strokeWidth={flowing ? FLOWING_STROKE_WIDTH : IDLE_STROKE_WIDTH}
              strokeDasharray={flowing ? FLOW_DASH : undefined}
              strokeLinecap="round"
            />
            {flowing && linkLabel && (
              <text
                x={midX}
                y={midY - 6}
                textAnchor="middle"
                fontSize={10}
                fontWeight={600}
                className="fill-[var(--text-primary)] tabular-nums forced-colors:fill-[CanvasText]"
              >
                {linkLabel}
              </text>
            )}
          </g>
        );
      })}

      {/* ── nodes ── */}
      {nodes.map((node) => {
        const pos = POSITION_COORDS[node.position] ?? POSITION_COORDS.center;
        const { name, reading } = captionFor(node, compact);

        return (
          <g key={node.id}>
            <circle
              cx={pos.cx}
              cy={pos.cy}
              r={r}
              className="fill-[var(--surface-1)] stroke-[var(--border-default)] forced-colors:fill-[Canvas] forced-colors:stroke-[CanvasText]"
              strokeWidth={1.5}
            />

            {node.icon && (
              <foreignObject
                x={pos.cx - ICON_BOX / 2}
                y={pos.cy - ICON_BOX / 2}
                width={ICON_BOX}
                height={ICON_BOX}
              >
                <div aria-hidden="true" className="flex h-full w-full items-center justify-center">
                  {node.icon}
                </div>
              </foreignObject>
            )}

            {name && (
              <text
                x={pos.cx}
                y={pos.cy + r + 13}
                textAnchor="middle"
                fontSize={10.5}
                className="fill-[var(--text-muted)] font-medium forced-colors:fill-[CanvasText]"
              >
                {name}
              </text>
            )}
            {reading && (
              <text
                x={pos.cx}
                y={pos.cy + r + 27}
                textAnchor="middle"
                fontSize={11.5}
                fontWeight={600}
                className="fill-[var(--text-primary)] tabular-nums forced-colors:fill-[CanvasText]"
              >
                {reading}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
