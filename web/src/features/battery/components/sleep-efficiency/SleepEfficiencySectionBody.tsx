import type { ReactNode } from 'react';
import { Moon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmptyState, Skeleton } from '@/components/feedback';
import type { SleepEfficiencyQueryState } from './types';

interface SleepEfficiencySectionBodyProps {
  state: SleepEfficiencyQueryState;
  children: ReactNode;
  skeletonHeight?: number;
}

export function SleepEfficiencySectionBody({
  state,
  children,
  skeletonHeight = 220,
}: SleepEfficiencySectionBodyProps) {
  const { t } = useTranslation();

  if (!state.vehicleSelected) {
    return (
      // no-action: the persistent VehicleSelect in the page header owns vehicle selection
      <EmptyState
        className="py-8"
        icon={<Moon className="h-7 w-7" aria-hidden="true" />}
        message={t(
          'sleep.states.noVehiclePassive',
          'Select a vehicle to make sleep evidence available.',
        )}
      />
    );
  }
  if (state.isLoading) {
    return (
      <div
        role="status"
        aria-label={t(
          'sleep.states.loadingAria',
          'Loading sleep evidence',
        )}
      >
        <Skeleton height={skeletonHeight} />
      </div>
    );
  }
  if (state.error) {
    return (
      // no-action: the evidence band is the single retry surface for the initial query
      <EmptyState
        className="py-8"
        icon={<Moon className="h-7 w-7" aria-hidden="true" />}
        message={t(
          'sleep.states.errorPassive',
          'Sleep evidence is unavailable; retry from the evidence band.',
        )}
      />
    );
  }
  if (!state.isResolved) {
    return (
      // no-action: query resolution is automatic and has no section-level recovery action
      <EmptyState
        className="py-8"
        icon={<Moon className="h-7 w-7" aria-hidden="true" />}
        message={t(
          'sleep.states.pendingPassive',
          'Sleep evidence availability has not resolved.',
        )}
      />
    );
  }
  return <>{children}</>;
}
