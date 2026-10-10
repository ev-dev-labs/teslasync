import type { ReactNode } from 'react';
import { Text, Caption, HelperText } from '@/components/ui';

export function FunFactCard({ icon, value, unit, label }: {
  icon: ReactNode; value: string; unit: string; label: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-lg border border-[var(--border-default)] bg-[var(--surface-2)] p-3">
      {icon}
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline gap-1">
          <Text as="span" size="xl" weight="bold" color="primary" className="break-words tabular-nums">{value}</Text>
          {unit && <Caption>{unit}</Caption>}
        </p>
        <HelperText className="break-words">{label}</HelperText>
      </div>
    </div>
  );
}
