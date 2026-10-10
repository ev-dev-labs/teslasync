import type { ReactNode } from 'react';
import { useCardPlacement } from '@/components/layout/layout-reference';
import { cn } from '@/lib/cn';
import { CareSourceNotices } from './CareSourceNotices';
import type { CareSectionState } from './state';

/** Preserve the existing domain specialists verbatim; adapt only placement/trust. */
export function SpecialistSlot({ children, state }: { children: ReactNode; state: CareSectionState }) {
  const placement = useCardPlacement();
  return (
    <div className={cn('flex h-full min-w-0 flex-col gap-3', placement?.className ?? 'col-span-1')}>
      <CareSourceNotices state={state} />
      {children}
    </div>
  );
}
