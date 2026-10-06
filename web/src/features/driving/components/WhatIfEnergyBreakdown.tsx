import { CompositionRail } from '@/components/data-display';
import { Text } from '@/components/ui';
import type { EnergyBreakdown } from '../lib/whatIfModel';

type ComponentKey = keyof Omit<EnergyBreakdown, 'total'>;

interface WhatIfEnergyBreakdownProps {
  caption: string;
  breakdown: EnergyBreakdown;
  max: number;
  labels: Record<ComponentKey, string>;
  components: readonly { key: ComponentKey; color: string }[];
  formatWh: (wh: number) => string;
}

/** The simulator supplies the common denominator and the complete energy split. */
export function WhatIfEnergyBreakdown({
  caption, breakdown, max, labels, components, formatWh,
}: WhatIfEnergyBreakdownProps) {
  const segments = components.map(component => {
    const fraction = max > 0 ? (breakdown[component.key] / max) * 100 : 0;
    const widthPercent = Number.isFinite(fraction) ? Math.max(0, Math.min(100, fraction)) : 0;
    return {
      id: component.key,
      label: labels[component.key],
      detail: formatWh(breakdown[component.key]),
      color: component.color,
      widthPercent,
      // Retain the simulator's visual omission without dropping category evidence.
      hideFromTrack: !Number.isFinite(fraction) || fraction <= 0.5,
    };
  });
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <Text variant="caption">{caption}</Text>
        <Text variant="caption" className="font-mono tabular-nums">{formatWh(breakdown.total)}</Text>
      </div>
      <CompositionRail segments={segments} summary={`${caption} — ${formatWh(breakdown.total)}`} size="lg" />
    </div>
  );
}
