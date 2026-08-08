import type { ReactNode } from 'react';
import { CircleOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Skeleton } from '@/components/feedback';
import { Text } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { TrueCostQueryState } from './types';

interface TrueCostSectionBodyProps {
  state: TrueCostQueryState;
  children: ReactNode;
  className?: string;
  skeletonHeight?: number;
}

export function TrueCostSectionBody({
  state,
  children,
  className,
  skeletonHeight = 144,
}: TrueCostSectionBodyProps) {
  const { t } = useTranslation();
  const passive = (message: string) => (
    <div className={cn(
      'flex min-h-28 flex-col items-center justify-center py-6 text-center',
      className,
    )}>
      <CircleOff
        className="mb-2 h-6 w-6 text-[var(--text-muted)]"
        aria-hidden="true"
      />
      <Text as="p" variant="bodySm" className="max-w-2xl">{message}</Text>
    </div>
  );

  if (!state.enabled) {
    return passive(t(
      'tco.states.noVehicle',
      'Select a vehicle to load its lifetime operating-cost evidence.',
    ));
  }
  if (!state.hasData && state.isLoading) {
    return (
      <div
        className={cn('min-h-28', className)}
        role="status"
        aria-label={t('tco.states.loadingLabel', 'Loading operating-cost evidence')}
      >
        <Skeleton height={skeletonHeight} />
      </div>
    );
  }
  if (!state.hasData && state.isPaused) {
    return passive(t(
      'tco.states.paused',
      'The initial query is paused while the network is unavailable; no empty response is inferred.',
    ));
  }
  if (!state.hasData && state.error) {
    return passive(t(
      'tco.states.error',
      'Operating-cost evidence is unavailable. Retry from the evidence ledger.',
    ));
  }
  if (!state.hasData && !state.isResolved) {
    return passive(t(
      'tco.states.pending',
      'Source availability has not resolved yet.',
    ));
  }
  return <div className={className}>{children}</div>;
}
