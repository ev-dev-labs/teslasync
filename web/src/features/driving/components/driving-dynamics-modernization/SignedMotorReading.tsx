import type { ComponentProps } from 'react';
import { BipolarBar } from '@/components/charts';

type SignedMotorReadingProps = Omit<ComponentProps<typeof BipolarBar>, 'value'> & {
  value: number | null;
};

/** Retain the feature's typed adapter; nullable geometry belongs to BipolarBar. */
export function SignedMotorReading({ value, ...props }: SignedMotorReadingProps) {
  return <BipolarBar {...props} value={value} />;
}
