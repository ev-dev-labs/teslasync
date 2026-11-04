import { type ReactNode, useMemo } from 'react';
import { EmptyState } from '@/components/feedback';
import { Text } from '@/components/ui';
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

const POSITION_COORDS: Record<FlowNode['position'], { cx: number; cy: number }> = {
  left: { cx: 60, cy: 150 },
  right: { cx: 300, cy: 150 },
  center: { cx: 180, cy: 150 },
  top: { cx: 180, cy: 38 },
  bottom: { cx: 180, cy: 262 },
};

const FLOWING_STROKE_WIDTH = 2.5;
const IDLE_STROKE_WIDTH = 1.5;
const FLOW_DASH = '9 23';

/** A link animates only when the caller marks it active AND it carries flow. */
function isFlowing(arrow: FlowArrow): boolean {
  return arrow.active && Number.isFinite(arrow.value) && arrow.value !== 0;
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

  const vertical = nodes.some((node) => node.position === 'top' || node.position === 'bottom');
  const horizontalCenters = nodes.map((node) => (POSITION_COORDS[node.position] ?? POSITION_COORDS.center).cx);
  const viewLeft = vertical ? 0 : (Math.min(...horizontalCenters) + Math.max(...horizontalCenters)) / 2 - 180;
  const positionFor = (node: FlowNode) => {
    const position = POSITION_COORDS[node.position] ?? POSITION_COORDS.center;
    return vertical ? position : { ...position, cy: 75 };
  };

  return (
    <svg
      viewBox={`${viewLeft} 0 360 ${vertical ? 300 : 150}`}
      className="mx-auto h-full min-h-0 w-full"
      role="img"
      aria-label={ariaLabel}
    >
      {/* Nodes cover link endpoints so activity never runs across a reading. */}
      {visibleArrows.map((arrow) => {
        const fromNode = nodeMap.get(arrow.from);
        const toNode = nodeMap.get(arrow.to);
        if (!fromNode || !toNode) return null;

        const fromPos = positionFor(fromNode);
        const toPos = positionFor(toNode);
        const midX = (fromPos.cx + toPos.cx) / 2;
        const midY = (fromPos.cy + toPos.cy) / 2;

        const flowing = isFlowing(arrow);
        const colorClass = linkColor(arrow, flowing);
        const linkLabel = arrow.label?.trim() ? arrow.label : null;

        return (
          <g key={`${arrow.from}-${arrow.to}`}>
            {flowing && (
              <path
                d={`M${fromPos.cx} ${fromPos.cy} C${midX} ${fromPos.cy} ${midX} ${toPos.cy} ${toPos.cx} ${toPos.cy}`}
                fill="none"
                className="stroke-[var(--border-default)]"
                strokeWidth={IDLE_STROKE_WIDTH}
              />
            )}
            <path
              data-flow-edge=""
              d={`M${fromPos.cx} ${fromPos.cy} C${midX} ${fromPos.cy} ${midX} ${toPos.cy} ${toPos.cx} ${toPos.cy}`}
              fill="none"
              className={cn('stroke-current', colorClass, flowing && 'flow-active widget-state-motion')}
              strokeWidth={flowing ? FLOWING_STROKE_WIDTH : IDLE_STROKE_WIDTH}
              strokeDasharray={flowing ? FLOW_DASH : undefined}
              strokeLinecap="round"
            />
            {flowing && linkLabel && (
              <text
                x={fromPos.cx === toPos.cx ? midX + 64 : midX}
                y={fromPos.cx === toPos.cx ? midY + 4 : midY - 36}
                textAnchor="middle"
                fontSize={vertical ? 14 : 10}
                fontWeight={600}
                className="fill-[var(--text-primary)] tabular-nums forced-colors:fill-[CanvasText]"
              >
                {linkLabel}
              </text>
            )}
          </g>
        );
      })}

      {nodes.map((node) => {
        const pos = positionFor(node);
        const { name, reading } = captionFor(node, compact);

        return (
          <g key={node.id}>
            <rect
              data-flow-node={node.id}
              x={pos.cx - 48}
              y={pos.cy - 34}
              width={96}
              height={68}
              rx={10}
              className="fill-[var(--surface-1)] stroke-[var(--border-default)] forced-colors:fill-[Canvas] forced-colors:stroke-[CanvasText]"
              strokeWidth={1.5}
            />

            <foreignObject x={pos.cx - 43} y={pos.cy - 31} width={86} height={62}>
              <div className="flex h-full min-w-0 flex-col items-center justify-center gap-0.5 text-center">
                <div className="flex max-w-full items-center justify-center gap-1">
                  {node.icon && (
                    <span aria-hidden="true" className="flex size-3 shrink-0 items-center justify-center [&>svg]:size-3">
                      {node.icon}
                    </span>
                  )}
                  {name && <Text as="span" variant="caption" className="min-w-0 break-words leading-tight" title={name}>{name}</Text>}
                </div>
                {reading && <Text as="span" size="sm" weight="semibold" color="primary" className="max-w-full truncate tabular-nums" title={reading}>{reading}</Text>}
              </div>
            </foreignObject>
          </g>
        );
      })}
    </svg>
  );
}
