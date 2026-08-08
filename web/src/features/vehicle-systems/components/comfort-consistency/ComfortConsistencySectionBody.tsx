import { Thermometer } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Skeleton } from '@/components/feedback';
import { Text } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { ComfortConsistencySummary } from '../../lib/comfortConsistency';
import type {
  ComfortConsistencyQueryState,
  ComfortConsistencyRequirement,
} from './types';

interface ComfortConsistencySectionBodyProps {
  summary: ComfortConsistencySummary;
  state: ComfortConsistencyQueryState;
  children: ReactNode;
  requirement?: ComfortConsistencyRequirement;
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
        'flex min-h-24 flex-col items-center justify-center py-5 text-center',
        className,
      )}
    >
      <Thermometer
        className="mb-2 h-6 w-6 text-[var(--text-muted)]"
        aria-hidden="true"
      />
      <Text as="p" variant="bodySm" className="max-w-xl">
        {message}
      </Text>
    </div>
  );
}

export function ComfortConsistencySectionBody({
  summary,
  state,
  children,
  requirement = 'none',
  className,
  skeletonHeight = 128,
}: ComfortConsistencySectionBodyProps) {
  const { t } = useTranslation();

  if (!state.vehicleSelected) {
    return (
      <PassiveState
        className={className}
        message={t(
          'comfortConsistency.states.noVehiclePassive',
          'Select a vehicle to make its returned comfort timeline available.',
        )}
      />
    );
  }
  if (state.isLoading) {
    return (
      <div className={cn('min-h-24', className)}>
        <Skeleton height={skeletonHeight} />
      </div>
    );
  }
  if (state.error) {
    return (
      <PassiveState
        className={className}
        message={t(
          'comfortConsistency.states.errorPassive',
          'Climate history is unavailable; retry from the evidence ledger above.',
        )}
      />
    );
  }
  if (!state.isResolved) {
    return (
      <PassiveState
        className={className}
        message={t(
          'comfortConsistency.states.pendingPassive',
          'Climate-history availability has not resolved.',
        )}
      />
    );
  }
  if (
    requirement !== 'none'
    && summary.rows.uniqueTimestampRows === 0
  ) {
    return (
      <PassiveState
        className={className}
        message={t(
          'comfortConsistency.states.noTimestampsPassive',
          'No unique valid timestamp is available for chronological analysis.',
        )}
      />
    );
  }
  if (
    ['samples', 'intervals', 'runs', 'windows'].includes(requirement)
    && summary.analyzedSamples === 0
  ) {
    return (
      <PassiveState
        className={className}
        message={t(
          'comfortConsistency.states.noSamplesPassive',
          'No row passed the active-HVAC, cabin-temperature, and setpoint gates.',
        )}
      />
    );
  }
  if (
    ['intervals'].includes(requirement)
    && summary.intervals.observedActiveIntervals === 0
  ) {
    return (
      <PassiveState
        className={className}
        message={t(
          'comfortConsistency.states.noIntervalsPassive',
          'Active samples exist, but no adjacent interval passed continuity and gap checks.',
        )}
      />
    );
  }
  if (
    ['runs', 'windows'].includes(requirement)
    && summary.activeRunCount === 0
  ) {
    return (
      <PassiveState
        className={className}
        message={t(
          'comfortConsistency.states.noRunsPassive',
          'No active thermal sample formed a chronological run fragment.',
        )}
      />
    );
  }
  if (
    requirement === 'windows'
    && summary.stabilizationWindows.length === 0
  ) {
    return (
      <PassiveState
        className={className}
        message={t(
          'comfortConsistency.states.noWindowsPassive',
          'Active fragments exist, but none began outside the configured comfort band.',
        )}
      />
    );
  }
  return <div className={className}>{children}</div>;
}
