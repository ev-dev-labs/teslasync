import type { ReactNode } from 'react';
import { Fan } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Skeleton } from '@/components/feedback';
import { Text } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { HvacCyclingSummary } from '../../lib/hvacCycling';
import type {
  HvacCyclingQueryState,
  HvacCyclingSectionRequirement,
} from './types';

interface HvacCyclingSectionBodyProps {
  summary: HvacCyclingSummary;
  state: HvacCyclingQueryState;
  children: ReactNode;
  requirement?: HvacCyclingSectionRequirement;
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
      <Fan
        className="mb-2 h-6 w-6 text-[var(--text-muted)]"
        aria-hidden="true"
      />
      <Text as="p" variant="bodySm" className="max-w-xl">
        {message}
      </Text>
    </div>
  );
}

/** Passive repeated state gate; the evidence ledger owns the only retry. */
export function HvacCyclingSectionBody({
  summary,
  state,
  children,
  requirement = 'none',
  className,
  skeletonHeight = 128,
}: HvacCyclingSectionBodyProps) {
  const { t } = useTranslation();

  if (!state.vehicleSelected) {
    return (
      <PassiveState
        className={className}
        message={t(
          'hvacCycling.states.noVehiclePassive',
          'Select a vehicle to make its returned HVAC timeline available.',
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
          'hvacCycling.states.errorPassive',
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
          'hvacCycling.states.pendingPassive',
          'Climate-history availability has not resolved.',
        )}
      />
    );
  }
  if (
    requirement !== 'none'
    && summary.rows.validKnownStateRows === 0
  ) {
    return (
      <PassiveState
        className={className}
        message={
          summary.rows.returnedRows === 0
            ? t(
                'hvacCycling.states.emptyPassive',
                'No climate rows were returned for this vehicle.',
              )
            : t(
                'hvacCycling.states.unknownPassive',
                'Rows were returned, but no unique timestamp had an interpretable HVAC state.',
              )
        }
      />
    );
  }
  if (
    (requirement === 'intervals' || requirement === 'runs')
    && summary.intervals.observedIntervals === 0
  ) {
    return (
      <PassiveState
        className={className}
        message={t(
          'hvacCycling.states.noIntervalsPassive',
          'Known samples exist, but no adjacent pair passed continuity and gap checks.',
        )}
      />
    );
  }
  if (requirement === 'runs' && summary.runs.length === 0) {
    return (
      <PassiveState
        className={className}
        message={t(
          'hvacCycling.states.noRunsPassive',
          'No observed interval formed a run fragment.',
        )}
      />
    );
  }
  return <div className={className}>{children}</div>;
}
