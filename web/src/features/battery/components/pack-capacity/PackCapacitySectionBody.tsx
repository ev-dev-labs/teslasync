import type { ReactNode } from 'react';
import { BatteryMedium } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Skeleton } from '@/components/feedback';
import { Text } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { PackCapacityResult } from '../../lib/packCapacity';
import type {
  PackCapacityQueryState,
  PackCapacitySectionRequirement,
} from './types';

interface PackCapacitySectionBodyProps {
  result: PackCapacityResult;
  state: PackCapacityQueryState;
  children: ReactNode;
  requirement?: PackCapacitySectionRequirement;
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
      <BatteryMedium
        className="mb-3 h-8 w-8 text-[var(--text-muted)]"
        aria-hidden="true"
      />
      <Text as="p" variant="bodySm" className="max-w-xl">
        {message}
      </Text>
    </div>
  );
}

export function PackCapacitySectionBody({
  result,
  state,
  children,
  requirement = 'observations',
  className,
  skeletonHeight = 240,
}: PackCapacitySectionBodyProps) {
  const { t } = useTranslation();

  if (!state.vehicleSelected) {
    return (
      <PassiveState
        className={className}
        message={t(
          'packCapacity.states.noVehiclePassive',
          'Select a vehicle to make its returned charging evidence available.',
        )}
      />
    );
  }
  if (state.isLoading) {
    return (
      <div
        className={cn('min-h-44', className)}
        aria-label={t(
          'packCapacity.states.loadingAria',
          'Loading Pack Capacity evidence',
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
          'packCapacity.states.errorPassive',
          'Charging history is unavailable; retry from the evidence status above.',
        )}
      />
    );
  }
  if (!state.isResolved) {
    return (
      <PassiveState
        className={className}
        message={t(
          'packCapacity.states.pendingPassive',
          'Charging-history availability has not resolved.',
        )}
      />
    );
  }
  if (
    requirement !== 'none'
    && result.observations.length === 0
  ) {
    return (
      <PassiveState
        className={className}
        message={
          result.accounting.returnedRows === 0
            ? t(
                'packCapacity.states.emptyPassive',
                'No charging sessions were returned for this vehicle.',
              )
            : t(
                'packCapacity.states.noQualifiedPassive',
                'No returned session met the completion, SoC-window, energy, and plausibility rules.',
              )
        }
      />
    );
  }
  if (
    requirement === 'fit'
    && result.summary.fit.status !== 'available'
  ) {
    return (
      <PassiveState
        className={className}
        message={t(
          'packCapacity.states.fitPassive',
          'The descriptive linear fit remains withheld until the observation, calendar-span, and active-month gates all pass.',
        )}
      />
    );
  }
  return <div className={className}>{children}</div>;
}
