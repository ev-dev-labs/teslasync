import type { ReactNode } from 'react';
import { FileSearch2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Skeleton } from '@/components/feedback';
import { Text } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { BatteryPassportQueryState } from './types';

interface BatteryPassportSectionBodyProps {
  state: BatteryPassportQueryState;
  children: ReactNode;
  requirePassport?: boolean;
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
        'flex min-h-36 flex-col items-center justify-center py-8 text-center',
        className,
      )}
    >
      <FileSearch2
        className="mb-3 h-7 w-7 text-[var(--text-muted)]"
        aria-hidden="true"
      />
      <Text as="p" variant="bodySm" className="max-w-xl">
        {message}
      </Text>
    </div>
  );
}

export function BatteryPassportSectionBody({
  state,
  children,
  requirePassport = true,
  className,
  skeletonHeight = 180,
}: BatteryPassportSectionBodyProps) {
  const { t } = useTranslation();

  if (!state.vehicleSelected) {
    return (
      <PassiveState
        className={className}
        message={t(
          'batteryPassport.states.noVehiclePassive',
          'Select a vehicle to make its certificate evidence available.',
        )}
      />
    );
  }
  if (state.isLoading) {
    return (
      <div
        className={cn('min-h-36', className)}
        role="status"
        aria-label={t(
          'batteryPassport.states.loadingAria',
          'Loading Battery Passport evidence',
        )}
      >
        <Skeleton height={skeletonHeight} />
      </div>
    );
  }
  if (state.initialError) {
    return (
      <PassiveState
        className={className}
        message={t(
          'batteryPassport.states.errorPassive',
          'Certificate evidence is unavailable; retry from the certificate header.',
        )}
      />
    );
  }
  if (!state.isResolved) {
    return (
      <PassiveState
        className={className}
        message={t(
          'batteryPassport.states.pendingPassive',
          'Certificate availability has not resolved.',
        )}
      />
    );
  }
  if (requirePassport && !state.passport) {
    return (
      <PassiveState
        className={className}
        message={t(
          'batteryPassport.states.emptyPassive',
          'The endpoint returned no certificate for this vehicle.',
        )}
      />
    );
  }
  return <div className={className}>{children}</div>;
}
