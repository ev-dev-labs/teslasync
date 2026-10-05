import type { ComponentProps } from 'react';
import { BipolarBar } from '@/components/charts';
import { Text } from '@/components/ui';

type SignedMotorReadingProps = Omit<ComponentProps<typeof BipolarBar>, 'value'> & {
  value: number | null;
};

/** BipolarBar requires a number and exposes aria-valuenow=0 for non-finite
 * geometry. Keep absent readings as named groups, not counterfeit zero meters.
 * Finite readings retain the exact shared scale, formatting and colors. */
export function SignedMotorReading({ value, ...props }: SignedMotorReadingProps) {
  if (value != null) return <BipolarBar {...props} value={value} />;
  return (
    <div role="group" aria-label={props.label} className="flex w-full min-w-0 flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Text as="span" size="xs" weight="medium" color="muted">{props.label}</Text>
        <Text as="span" size="lg" weight="bold" color="primary">—</Text>
      </div>
      <div className="h-2.5 w-full rounded-full bg-[var(--surface-2)]" aria-hidden="true" />
      <div className="flex items-center justify-between">
        <Text as="span" size="xs" color="muted">{props.negativeLabel}</Text>
        <Text as="span" size="xs" color="muted">{props.positiveLabel}</Text>
      </div>
    </div>
  );
}
