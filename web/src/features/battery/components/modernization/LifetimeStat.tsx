import { MetricLabel, Text, Caption, HelperText } from '@/components/ui';
import { cn } from '@/lib/cn';

/** Retains specialist source labels and unit contracts (including BMS kWh). */
export function LifetimeStat({
  label, value, unit, desc, accent,
}: {
  label: string; value: string; unit?: string; desc: string; accent?: string;
}) {
  return (
    <div className="rounded-lg bg-[var(--surface-2)] p-4 ring-1 ring-[var(--border-subtle)]">
      <MetricLabel>{label}</MetricLabel>
      <p className="mt-1 flex items-baseline gap-1">
        <Text size="2xl" weight="bold" className={cn('tabular-nums tracking-tight', accent ?? 'text-[var(--text-primary)]')}>
          {value}
        </Text>
        {unit && <Caption>{unit}</Caption>}
      </p>
      <HelperText className="mt-1">{desc}</HelperText>
    </div>
  );
}
