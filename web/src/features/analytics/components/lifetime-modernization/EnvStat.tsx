import type { ReactNode } from 'react';
import { Text, HelperText } from '@/components/ui';

/** Retains the original ring/emoji/animated-value subtree and calculations. */
export function EnvStat({ visual, value, label }: {
  visual: ReactNode; value: ReactNode; label: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-4">
      <span className="shrink-0">{visual}</span>
      <div className="min-w-0">
        <Text as="p" size="2xl" weight="bold" color="primary" className="break-words tabular-nums">{value}</Text>
        <HelperText>{label}</HelperText>
      </div>
    </div>
  );
}
