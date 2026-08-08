import { Clock3 } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Skeleton } from '@/components/feedback';
import { Text } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { SeasonalFitStatus } from '../../lib/seasonalEfficiency';
import type { SeasonalQueryState } from './types';

interface SeasonalSectionBodyProps {
  state: SeasonalQueryState;
  children: ReactNode;
  requirement?: 'none' | 'included' | 'fit';
  fitStatus?: SeasonalFitStatus;
  className?: string;
  skeletonHeight?: number;
}

function PassiveState({ message }: { message: string }) {
  return (
    <div className="flex min-h-32 flex-col items-center justify-center py-8 text-center">
      <Clock3 className="mb-2 h-7 w-7 text-[var(--text-muted)]" aria-hidden="true" />
      <Text as="p" variant="bodySm" className="max-w-xl">{message}</Text>
    </div>
  );
}

export function SeasonalSectionBody({
  state,
  children,
  requirement = 'none',
  fitStatus,
  className,
  skeletonHeight = 180,
}: SeasonalSectionBodyProps) {
  const { t } = useTranslation();
  if (!state.vehicleSelected) {
    return (
      <PassiveState
        message={t(
          'seasonalEfficiency.states.noVehiclePassive',
          'Select a vehicle above to make local seasonal evidence available.',
        )}
      />
    );
  }
  if (state.isLoading) {
    return (
      <div className={cn('min-h-32', className)} aria-label={t(
        'seasonalEfficiency.states.loadingAria',
        'Loading seasonal efficiency history',
      )}>
        <Skeleton height={skeletonHeight} />
      </div>
    );
  }
  if (state.error) {
    return (
      <PassiveState
        message={t(
          'seasonalEfficiency.states.errorPassive',
          'Seasonal history is unavailable; retry from the evidence band above.',
        )}
      />
    );
  }
  if (!state.isResolved) {
    return (
      <PassiveState
        message={t(
          'seasonalEfficiency.states.pendingPassive',
          'Seasonal-history availability has not resolved.',
        )}
      />
    );
  }
  if (requirement === 'included' && fitStatus === undefined) {
    return <>{children}</>;
  }
  if (requirement === 'fit' && fitStatus !== 'ready') {
    return (
      <PassiveState
        message={t(
          'seasonalEfficiency.states.noFitPassive',
          'The descriptive harmonic curve is not eligible yet; the fit status above explains the required evidence.',
        )}
      />
    );
  }
  return <div className={className}>{children}</div>;
}
