import type { ReactNode } from 'react';
import { Clock3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Skeleton } from '@/components/feedback';
import { Text } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { RangeBufferResult } from '../../lib/rangeBuffer';
import type {
  RangeBufferQueryState,
  RangeBufferSectionRequirement,
} from './types';

interface RangeBufferSectionBodyProps {
  result: RangeBufferResult;
  state: RangeBufferQueryState;
  children: ReactNode;
  requirement?: RangeBufferSectionRequirement;
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
      <Clock3
        className="mb-3 h-8 w-8 text-[var(--text-muted)]"
        aria-hidden="true"
      />
      <Text as="p" variant="bodySm" className="max-w-xl">
        {message}
      </Text>
    </div>
  );
}

export function RangeBufferSectionBody({
  result,
  state,
  children,
  requirement = 'included',
  className,
  skeletonHeight = 240,
}: RangeBufferSectionBodyProps) {
  const { t } = useTranslation();

  if (!state.vehicleSelected) {
    return (
      <PassiveState
        className={className}
        message={t(
          'rangeBuffer.states.noVehiclePassive',
          'Select a vehicle to make its returned arrival-buffer evidence available.',
        )}
      />
    );
  }
  if (state.isLoading) {
    return (
      <div
        className={cn('min-h-44', className)}
        aria-label={t(
          'rangeBuffer.states.loadingAria',
          'Loading arrival buffer history',
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
          'rangeBuffer.states.errorPassive',
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
          'rangeBuffer.states.pendingPassive',
          'Drive-history availability has not resolved.',
        )}
      />
    );
  }
  if (
    requirement !== 'none'
    && result.accounting.includedRows === 0
  ) {
    return (
      <PassiveState
        className={className}
        message={
          result.accounting.returnedRows === 0
            ? t(
                'rangeBuffer.states.emptyPassive',
                'No drives were returned for this vehicle-local date window.',
              )
            : t(
                'rangeBuffer.states.noQualifiedPassive',
                'No returned row had a complete, valid, non-future arrival timestamp and usable arrival SoC.',
              )
        }
      />
    );
  }
  if (
    requirement === 'distance'
    && result.driveContext.distanceRows === 0
  ) {
    return (
      <PassiveState
        className={className}
        message={t(
          'rangeBuffer.states.noDistancePassive',
          'Included arrivals are available, but none has a positive finite drive distance.',
        )}
      />
    );
  }
  if (
    requirement === 'destinations'
    && result.destinationProfiles.length === 0
  ) {
    return (
      <PassiveState
        className={className}
        message={t(
          'rangeBuffer.states.noDestinationsPassive',
          'No normalized destination has the three included arrivals required for a supported profile.',
        )}
      />
    );
  }
  return <div className={className}>{children}</div>;
}
