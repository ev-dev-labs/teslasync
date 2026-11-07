import { MetricLabel, MetricValue, Text } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { PackAppearance } from '../types';
import type { TirePressurePresentationProps, TireReading } from './Tire.types';

const positions: Record<TireReading['position'], string> = {
  fl: '@md:col-start-1 @md:row-start-1',
  fr: '@md:col-start-3 @md:row-start-1',
  rl: '@md:col-start-1 @md:row-start-2',
  rr: '@md:col-start-3 @md:row-start-2',
};
const tones: Record<TireReading['variant'], string> = {
  success: 'text-[var(--semantic-success)]', warning: 'text-[var(--semantic-warning)]',
  danger: 'text-[var(--semantic-danger)]', neutral: 'text-[var(--text-secondary)]',
};
const tiles: Record<PackAppearance, string> = {
  studio: 'rounded-lg border-s-2 border-[var(--border-strong)] ps-3',
  elevated: 'rounded-xl bg-[var(--surface-2)] p-3',
  precision: 'border-b border-[var(--border-subtle)] py-3',
  owner: 'rounded-lg border border-[var(--border-default)] p-3',
  iconic: 'rounded-2xl border-2 border-[var(--border-subtle)] p-3',
  expressive: 'rounded-t-2xl rounded-br-2xl rounded-bl-md bg-[var(--surface-2)] p-4',
  pixel: 'border-2 border-[var(--border-strong)] p-3 font-mono',
};

export default function TirePressureLayout({ appearance, vehicle, tires, summary, unit }: TirePressurePresentationProps) {
  const diagram = appearance !== 'precision';
  return (
    <div data-tire-appearance={appearance} className="flex min-w-0 flex-col gap-3">
      {appearance === 'owner' && summary}
      <div className={cn(
        'grid min-w-0 grid-cols-2 items-center gap-3',
        diagram ? '@md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)]' : '@lg:grid-cols-3',
      )}>
        <div className={cn(
          'col-span-2 min-w-0',
          diagram ? '@md:col-span-1 @md:col-start-2 @md:row-span-2 @md:row-start-1'
            : '@lg:col-span-1 @lg:row-span-2',
        )}>{vehicle}</div>
        {tires.map(tire => (
          <div key={tire.position} role="group" aria-label={tire.label} data-pressure-status={tire.variant}
            className={cn('min-w-0', tiles[appearance], diagram && positions[tire.position])}>
            <MetricLabel>{tire.label}</MetricLabel>
            <MetricValue className={cn('break-words', tones[tire.variant])}>{tire.value}</MetricValue>
            <Text variant="caption">{unit}</Text>
          </div>
        ))}
      </div>
      {appearance !== 'owner' && summary}
    </div>
  );
}
