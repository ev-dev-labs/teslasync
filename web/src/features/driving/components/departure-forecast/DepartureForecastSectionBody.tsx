import type { ReactNode } from 'react';
import { CalendarClock } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Skeleton } from '@/components/feedback';
import { Text } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { DepartureForecast } from '../../lib/departureForecast';
import type { DepartureForecastQueryState } from './types';

interface DepartureForecastSectionBodyProps {
  forecast: DepartureForecast;
  state: DepartureForecastQueryState;
  children: ReactNode;
  allowEmpty?: boolean;
  className?: string;
  skeletonHeight?: number;
}

interface PassiveStateProps {
  message: string;
  className?: string;
}

function PassiveState({ message, className }: PassiveStateProps) {
  return (
    <div
      className={cn(
        'flex min-h-44 flex-col items-center justify-center py-10 text-center',
        className,
      )}
    >
      <CalendarClock
        className="mb-3 h-8 w-8 text-[var(--text-muted)]"
        aria-hidden="true"
      />
      <Text as="p" variant="bodySm" className="max-w-lg">
        {message}
      </Text>
    </div>
  );
}

/** Passive repeated state gate; the KPI band owns the only live query status. */
export function DepartureForecastSectionBody({
  forecast,
  state,
  children,
  allowEmpty = false,
  className,
  skeletonHeight = 240,
}: DepartureForecastSectionBodyProps) {
  const { t } = useTranslation();

  if (!state.vehicleSelected) {
    return (
      <PassiveState
        className={className}
        message={t(
          'departure.states.noVehiclePassive',
          'Select a vehicle to make its returned departure evidence available.',
        )}
      />
    );
  }
  if (state.isLoading) {
    return (
      <div
        className={cn('min-h-44', className)}
        aria-label={t(
          'departure.states.loadingAria',
          'Loading departure history',
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
          'departure.states.errorPassive',
          'Departure history is unavailable; retry from the forecast status above.',
        )}
      />
    );
  }
  if (!state.isResolved) {
    return (
      <PassiveState
        className={className}
        message={t(
          'departure.states.pendingPassive',
          'Departure-history availability has not resolved.',
        )}
      />
    );
  }
  if (forecast.totalDepartures === 0 && !allowEmpty) {
    return (
      <PassiveState
        className={className}
        message={
          forecast.accounting.returnedRows === 0
            ? t(
                'departure.states.emptyPassive',
                'No drives were returned, so there is no learned departure pattern.',
              )
            : t(
                'departure.states.noQualifiedPassive',
                'No returned drive starts qualified for the 120-day model window.',
              )
        }
      />
    );
  }
  return <div className={className}>{children}</div>;
}
