import type { ReactNode } from 'react';
import { GlassPanel, MetricLabel, Text } from '@/components/ui';
import { cn } from '@/lib/cn';

export function HealthStatCell({
  label, value, unit, accent, note,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  accent?: string;
  note?: ReactNode;
}) {
  return (
    <GlassPanel className="min-w-0 h-full p-4 text-center">
      <MetricLabel className="mb-1">{label}</MetricLabel>
      <Text
        as="p"
        size="2xl"
        weight="bold"
        color={accent ? undefined : 'primary'}
        className={cn('tabular-nums', accent)}
      >
        {value}
        {unit && <Text as="span" size="sm" color="muted">{` ${unit}`}</Text>}
      </Text>
      {note}
    </GlassPanel>
  );
}
