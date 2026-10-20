import { useTranslation } from 'react-i18next';
import { Text } from '@/components/ui';
import type { SankeyFlow, SankeyLayout } from '../../lib/energyAnatomy';

interface EnergyFlowDiagramProps {
  sankey: SankeyLayout;
  flows: SankeyFlow[];
  metadata: Record<string, { i18nKey: string; fallback: string; color: string }>;
  totalEnergyWh: number;
  formatEnergy: (value: number) => string;
  share: (value: number) => string;
}

export function EnergyFlowDiagram({
  sankey, flows, metadata, totalEnergyWh, formatEnergy, share,
}: EnergyFlowDiagramProps) {
  const { t } = useTranslation();
  return (
    <div className="min-w-0 overflow-x-auto">
      <svg
        viewBox={`0 0 ${sankey.width + 200} ${sankey.height + 20}`}
        className="min-w-[560px]"
        role="img"
        aria-label={t('energyAnatomy.sankey.aria', 'Sankey diagram splitting {{total}} into aero drag, rolling resistance, climate, and other losses', {
          total: formatEnergy(totalEnergyWh),
        })}
      >
        <g transform="translate(90, 10)">
          {sankey.links.map((link) => (
            <path
              key={link.key}
              d={link.path}
              fill="none"
              stroke={metadata[link.key]!.color}
              strokeWidth={link.thickness}
              strokeOpacity={0.45}
            />
          ))}
          <rect
            x={sankey.source.x}
            y={sankey.source.y}
            width={sankey.source.width}
            height={sankey.source.height}
            rx={3}
            fill="var(--text-muted)"
          />
          <text
            x={sankey.source.x - 8}
            y={sankey.source.y + sankey.source.height / 2}
            textAnchor="end"
            dominantBaseline="middle"
            fill="var(--text-primary)"
            fontSize={12}
          >
            {t('energyAnatomy.battery', 'Battery')}
          </text>
          {sankey.targets.map((node) => {
            const meta = metadata[node.key]!;
            const value = flows.find((flow) => flow.key === node.key)?.value ?? 0;
            return (
              <g key={node.key}>
                <rect x={node.x} y={node.y} width={node.width} height={node.height} rx={3} fill={meta.color} />
                <text
                  x={node.x + node.width + 8}
                  y={node.y + node.height / 2}
                  dominantBaseline="middle"
                  fill="var(--text-primary)"
                  fontSize={12}
                >
                  {t(meta.i18nKey, meta.fallback)} · {share(value)}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 border-t border-[var(--border-subtle)] pt-3">
        {flows.map((flow) => (
          <li key={flow.key} className="flex items-center gap-1.5">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: metadata[flow.key]!.color }}
              aria-hidden="true"
            />
            <Text variant="caption">{t(metadata[flow.key]!.i18nKey, metadata[flow.key]!.fallback)}</Text>
            <Text variant="caption" className="font-mono tabular-nums">
              {formatEnergy(flow.value)}
            </Text>
          </li>
        ))}
      </ul>
    </div>
  );
}
