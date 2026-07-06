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
}

interface WidgetFlowDiagramProps {
  nodes: FlowNode[];
  arrows: FlowArrow[];
  compact?: boolean;
  emptyMessage?: string;
  /** Accessible name for the diagram. Localise at the call site (like `emptyMessage`). */
  ariaLabel?: string;
}

/* ── position → SVG coordinate mapping (100×100 viewBox) ── */

const POSITION_COORDS: Record<FlowNode['position'], { cx: number; cy: number }> = {
  top: { cx: 50, cy: 12 },
  bottom: { cx: 50, cy: 88 },
  left: { cx: 12, cy: 50 },
  right: { cx: 88, cy: 50 },
  center: { cx: 50, cy: 50 },
};

const NODE_RADIUS = 14;
const NODE_RADIUS_COMPACT = 10;
const MIN_STROKE = 1;
const MAX_STROKE = 4;

function arrowColor(value: number, override?: string): string {
  if (override) return override;
  if (value > 0) return 'text-emerald-400';
  if (value < 0) return 'text-red-400';
  return 'text-[var(--text-muted)]';
}

function strokeForValue(value: number, maxValue: number): number {
  if (maxValue === 0) return MIN_STROKE;
  const ratio = Math.abs(value) / maxValue;
  return MIN_STROKE + ratio * (MAX_STROKE - MIN_STROKE);
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

  const maxArrowValue = useMemo(
    () => arrows.reduce((max, a) => Math.max(max, Math.abs(a.value ?? 0)), 1),
    [arrows],
  );

  if (nodes.length === 0) {
    return <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={emptyMessage} className="py-8" />;
  }

  const r = compact ? NODE_RADIUS_COMPACT : NODE_RADIUS;

  return (
    <svg
      viewBox="0 0 100 100"
      className="h-full w-full"
      role="img"
      aria-label={ariaLabel}
    >
      <defs>
        {/* animated dash pattern for active arrows */}
        <style>{`
          @keyframes dashFlow {
            to { stroke-dashoffset: -12; }
          }
          .flow-active {
            animation: dashFlow 0.8s linear infinite;
          }
        `}</style>
      </defs>

      {/* ── arrows ── */}
      {visibleArrows.map((arrow) => {
        const fromNode = nodeMap.get(arrow.from);
        const toNode = nodeMap.get(arrow.to);
        if (!fromNode || !toNode) return null;

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

        const value = arrow.value ?? 0;
        const sw = strokeForValue(value, maxArrowValue);
        const colorClass = arrowColor(value, arrow.color);

        return (
          <line
            key={`${arrow.from}-${arrow.to}`}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            className={cn('stroke-current', colorClass, arrow.active && 'flow-active')}
            strokeWidth={sw}
            strokeDasharray={arrow.active ? '4 8' : undefined}
            strokeLinecap="round"
          />
        );
      })}

      {/* ── nodes ── */}
      {nodes.map((node) => {
        const pos = POSITION_COORDS[node.position] ?? POSITION_COORDS.center;
        const rawLabel = node.label ?? '';
        const label = compact && rawLabel.length > 3
          ? rawLabel.slice(0, 3).toUpperCase()
          : rawLabel;

        return (
          <g key={node.id}>
            {/* background circle */}
            <circle
              cx={pos.cx}
              cy={pos.cy}
              r={r}
              className="fill-white/5 stroke-white/20"
              strokeWidth={0.5}
            />

            {/* icon or value */}
            {/* fontSize is an SVG user-unit (scales with the 100×100 viewBox)
                and cascades into the foreignObject HTML — no arbitrary px class. */}
            <foreignObject
              x={pos.cx - r}
              y={pos.cy - r}
              width={r * 2}
              height={r * 2}
              fontSize={compact ? 5 : 6}
            >
              <div className="flex h-full w-full flex-col items-center justify-center">
                {node.icon && (
                  <span className="text-[var(--text-primary)]">
                    {node.icon}
                  </span>
                )}
                <span className="font-semibold text-[var(--text-primary)]">
                  {node.formattedValue ?? '—'}
                </span>
              </div>
            </foreignObject>

            {/* label below or above node */}
            <text
              x={pos.cx}
              y={node.position === 'bottom' ? pos.cy + r + 5 : pos.cy - r - 2}
              textAnchor="middle"
              fontSize={compact ? 3 : 4}
              className="fill-white/60 font-medium"
            >
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
