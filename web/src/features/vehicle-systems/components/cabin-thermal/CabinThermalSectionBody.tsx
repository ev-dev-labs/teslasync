import type { ReactNode } from 'react';
import { ThermometerSun } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Skeleton } from '@/components/feedback';
import { Text } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { CabinThermalSummary } from '../../lib/cabinThermal';
import type {
  CabinThermalQueryState,
  CabinThermalSectionRequirement,
} from './types';

interface CabinThermalSectionBodyProps {
  summary: CabinThermalSummary;
  state: CabinThermalQueryState;
  children: ReactNode;
  requirement?: CabinThermalSectionRequirement;
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
        'flex min-h-32 flex-col items-center justify-center py-7 text-center',
        className,
      )}
    >
      <ThermometerSun
        className="mb-2 h-7 w-7 text-[var(--text-muted)]"
        aria-hidden="true"
      />
      <Text as="p" variant="bodySm" className="max-w-xl">
        {message}
      </Text>
    </div>
  );
}

/** Passive repeated state gate; the KPI band owns the only retry surface. */
export function CabinThermalSectionBody({
  summary,
  state,
  children,
  requirement = 'none',
  className,
  skeletonHeight = 160,
}: CabinThermalSectionBodyProps) {
  const { t } = useTranslation();

  if (!state.vehicleSelected) {
    return (
      <PassiveState
        className={className}
        message={t(
          'cabinThermal.states.noVehiclePassive',
          'Select a vehicle to make its returned climate evidence available.',
        )}
      />
    );
  }
  if (state.isLoading) {
    return (
      <div
        className={cn('min-h-32', className)}
        aria-label={t(
          'cabinThermal.states.loadingAria',
          'Loading cabin thermal evidence',
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
          'cabinThermal.states.errorPassive',
          'Climate history is unavailable; retry from the evidence status above.',
        )}
      />
    );
  }
  if (!state.isResolved) {
    return (
      <PassiveState
        className={className}
        message={t(
          'cabinThermal.states.pendingPassive',
          'Climate-history availability has not resolved.',
        )}
      />
    );
  }
  if (requirement !== 'none' && summary.accounting.normalizedRows === 0) {
    return (
      <PassiveState
        className={className}
        message={
          summary.accounting.returnedRows === 0
            ? t(
                'cabinThermal.states.emptyPassive',
                'No climate rows were returned for this vehicle.',
              )
            : t(
                'cabinThermal.states.noNormalizedPassive',
                'Rows were returned, but none had a unique valid timestamp and both finite temperatures.',
              )
        }
      />
    );
  }
  if (
    (requirement === 'candidates' || requirement === 'accepted')
    && summary.accounting.candidateWindows === 0
  ) {
    return (
      <PassiveState
        className={className}
        message={t(
          'cabinThermal.states.noCandidatesPassive',
          'No HVAC-off candidate window was formed from the normalized samples.',
        )}
      />
    );
  }
  if (
    requirement === 'accepted'
    && summary.accounting.acceptedFits === 0
  ) {
    return (
      <PassiveState
        className={className}
        message={t(
          'cabinThermal.states.noAcceptedPassive',
          'Every candidate was rejected, so fit summaries and passive-soak projections are withheld.',
        )}
      />
    );
  }
  return <div className={className}>{children}</div>;
}
