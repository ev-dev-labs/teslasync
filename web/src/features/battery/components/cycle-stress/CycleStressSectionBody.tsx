import type { ReactNode } from 'react';
import { Activity } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Skeleton } from '@/components/feedback';
import { Text } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { CycleStressResult } from '../../lib/cycleStress';
import type {
  CycleStressQueryState,
  CycleStressSectionRequirement,
} from './types';

interface CycleStressSectionBodyProps {
  result: CycleStressResult;
  state: CycleStressQueryState;
  children: ReactNode;
  requirement?: CycleStressSectionRequirement;
  className?: string;
  skeletonHeight?: number;
}

function PassiveState({
  message,
  className,
}: {
  message: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex min-h-44 flex-col items-center justify-center py-10 text-center',
        className,
      )}
    >
      <Activity
        className="mb-3 h-8 w-8 text-[var(--text-muted)]"
        aria-hidden="true"
      />
      <Text as="p" variant="bodySm" className="max-w-xl">
        {message}
      </Text>
    </div>
  );
}

export function CycleStressSectionBody({
  result,
  state,
  children,
  requirement = 'intervals',
  className,
  skeletonHeight = 240,
}: CycleStressSectionBodyProps) {
  const { t } = useTranslation();

  if (!state.vehicleSelected) {
    return (
      <PassiveState
        className={className}
        message={t(
          'cycleStress.states.noVehiclePassive',
          'Select a vehicle to make its returned charge and drive evidence available.',
        )}
      />
    );
  }
  if (state.isLoading) {
    return (
      <div
        className={cn('min-h-44', className)}
        aria-label={t(
          'cycleStress.states.loadingAria',
          'Loading Cycle Stress evidence',
        )}
      >
        <Skeleton height={skeletonHeight} />
      </div>
    );
  }
  if (state.error) {
    return (
      <PassiveState
        className={className}
        message={t(
          'cycleStress.states.errorPassive',
          'Both source histories are unavailable; retry from the evidence status above.',
        )}
      />
    );
  }
  if (!state.isResolved) {
    return (
      <PassiveState
        className={className}
        message={t(
          'cycleStress.states.pendingPassive',
          'Source-history availability has not resolved.',
        )}
      />
    );
  }
  if (
    requirement !== 'none'
    && result.continuity.acceptedIntervals === 0
  ) {
    const returned =
      result.driveAccounting.returnedRows
      + result.chargingAccounting.returnedRows;
    return (
      <PassiveState
        className={className}
        message={
          returned === 0
            ? t(
                'cycleStress.states.emptyPassive',
                'No drive or charging rows were returned for this vehicle.',
              )
            : t(
                'cycleStress.states.noQualifiedPassive',
                'No returned row had complete, valid, direction-consistent SoC endpoints.',
              )
        }
      />
    );
  }
  if (requirement === 'cycles' && result.cycles.length === 0) {
    return (
      <PassiveState
        className={className}
        message={t(
          'cycleStress.states.noCyclesPassive',
          'Qualified endpoints are available, but no countable rainflow range was retained.',
        )}
      />
    );
  }
  if (
    requirement === 'turningPoints'
    && result.turningPoints.length === 0
  ) {
    return (
      <PassiveState
        className={className}
        message={t(
          'cycleStress.states.noTurningPointsPassive',
          'No continuity-bounded SoC turning points are available.',
        )}
      />
    );
  }
  return <div className={className}>{children}</div>;
}
