import type { ReactNode } from 'react';
import { RouteOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Skeleton } from '@/components/feedback';
import { Text } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { DestinationTransitionResult } from '../../lib/destinationTransitions';
import type {
  DestinationTransitionsQueryState,
  DestinationTransitionsSectionRequirement,
} from './types';

interface DestinationTransitionsSectionBodyProps {
  model: DestinationTransitionResult;
  state: DestinationTransitionsQueryState;
  children: ReactNode;
  requirement?: DestinationTransitionsSectionRequirement;
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
      <RouteOff
        className="mb-3 h-8 w-8 text-[var(--text-muted)]"
        aria-hidden="true"
      />
      <Text as="p" variant="bodySm" className="max-w-xl">
        {message}
      </Text>
    </div>
  );
}

/** Passive repeated state gate; the KPI band owns the live query status. */
export function DestinationTransitionsSectionBody({
  model,
  state,
  children,
  requirement = 'transitions',
  className,
  skeletonHeight = 240,
}: DestinationTransitionsSectionBodyProps) {
  const { t } = useTranslation();

  if (!state.vehicleSelected) {
    return (
      <PassiveState
        className={className}
        message={t(
          'destinationTransitions.states.noVehiclePassive',
          'Select a vehicle to make its returned destination evidence available.',
        )}
      />
    );
  }
  if (state.isLoading) {
    return (
      <div
        className={cn('min-h-44', className)}
        aria-label={t(
          'destinationTransitions.states.loadingAria',
          'Loading destination transition history',
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
          'destinationTransitions.states.errorPassive',
          'Drive history is unavailable; retry from the evidence status above.',
        )}
      />
    );
  }
  if (!state.isResolved) {
    return (
      <PassiveState
        className={className}
        message={t(
          'destinationTransitions.states.pendingPassive',
          'Drive-history availability has not resolved.',
        )}
      />
    );
  }
  if (
    requirement !== 'none'
    && model.accounting.includedRows === 0
  ) {
    return (
      <PassiveState
        className={className}
        message={
          model.accounting.returnedRows === 0
            ? t(
                'destinationTransitions.states.emptyPassive',
                'No drives were returned, so there is no destination evidence.',
              )
            : t(
                'destinationTransitions.states.noQualifiedPassive',
                'No returned row was a completed, valid, non-future drive with a usable end destination.',
              )
        }
      />
    );
  }
  if (
    requirement !== 'none'
    && requirement !== 'visits'
    && model.acceptedTransitions === 0
  ) {
    return (
      <PassiveState
        className={className}
        message={t(
          'destinationTransitions.states.noContinuityPassive',
          'Destination visits exist, but no adjacent returned pair passed endpoint continuity and time-order checks.',
        )}
      />
    );
  }
  if (
    requirement === 'origins'
    && model.evidence.originsWithOutgoingEvidence === 0
  ) {
    return (
      <PassiveState
        className={className}
        message={t(
          'destinationTransitions.states.noOriginsPassive',
          'No origin has accepted outgoing transition evidence.',
        )}
      />
    );
  }
  if (requirement === 'months' && model.monthTrend.length === 0) {
    return (
      <PassiveState
        className={className}
        message={t(
          'destinationTransitions.states.noMonthsPassive',
          'No accepted transition is available for a vehicle-local month.',
        )}
      />
    );
  }
  return <div className={className}>{children}</div>;
}
