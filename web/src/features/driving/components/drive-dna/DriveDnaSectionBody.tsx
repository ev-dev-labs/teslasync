import type { ReactNode } from 'react';
import { Fingerprint } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Skeleton } from '@/components/feedback';
import { Text } from '@/components/ui';
import { cn } from '@/lib/cn';

import type { DriveDnaSectionState } from './types';

interface DriveDnaSectionBodyProps {
  state: DriveDnaSectionState;
  validRows: number;
  returnedRows: number;
  children: ReactNode;
  minimumRows?: number;
  allowZeroRows?: boolean;
  className?: string;
  skeletonHeight?: number;
}

interface PassiveStateProps {
  className: string;
  icon: ReactNode;
  message: string;
}

/** Repeated panel copy stays accessible without becoming another live region. */
function PassiveState({ className, icon, message }: PassiveStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center py-16 text-center',
        className,
      )}
    >
      <div className="mb-4 text-[var(--text-muted)]" aria-hidden="true">
        {icon}
      </div>
      <Text as="p" variant="bodySm" className="mb-4 max-w-md">
        {message}
      </Text>
    </div>
  );
}

/** Shared list/telemetry status gate mounted inside every evidence shell. */
export function DriveDnaSectionBody({
  state,
  validRows,
  returnedRows,
  children,
  minimumRows = 1,
  allowZeroRows = false,
  className,
  skeletonHeight = 240,
}: DriveDnaSectionBodyProps) {
  const { t } = useTranslation();
  const classes = cn('min-h-44', className);
  const icon = <Fingerprint className="h-8 w-8" aria-hidden="true" />;

  if (!state.vehicleSelected) {
    return (
      <PassiveState
        className={classes}
        icon={icon}
        message={t(
          'driveDna.states.noVehicle',
          'Select a vehicle to inspect its drive fingerprints.',
        )}
      />
    );
  }
  if (state.list.isLoading) {
    return (
      <div
        aria-label={t('driveDna.states.listLoading', 'Loading drive history')}
        className={classes}
      >
        <Skeleton height={skeletonHeight} />
      </div>
    );
  }
  if (state.list.error) {
    return (
      <PassiveState
        className={classes}
        icon={icon}
        message={t(
          'driveDna.states.listErrorPassive',
          'Drive history is unavailable; retry from the status above.',
        )}
      />
    );
  }
  if (!state.list.isResolved) {
    return (
      <PassiveState
        className={classes}
        icon={icon}
        message={t(
          'driveDna.states.listPending',
          'Drive-history availability has not resolved.',
        )}
      />
    );
  }
  if (!state.hasDrive) {
    return (
      <PassiveState
        className={classes}
        icon={icon}
        message={t(
          'driveDna.states.noDrives',
          'No drives were returned for this vehicle.',
        )}
      />
    );
  }
  if (state.telemetry.isLoading) {
    return (
      <div
        aria-label={t(
          'driveDna.states.telemetryLoading',
          'Loading selected-drive telemetry',
        )}
        className={classes}
      >
        <Skeleton height={skeletonHeight} />
      </div>
    );
  }
  if (state.telemetry.error) {
    return (
      <PassiveState
        className={classes}
        icon={icon}
        message={t(
          'driveDna.states.telemetryErrorPassive',
          'Selected-drive telemetry is unavailable; retry from the status above.',
        )}
      />
    );
  }
  if (!state.telemetry.isResolved) {
    return (
      <PassiveState
        className={classes}
        icon={icon}
        message={t(
          'driveDna.states.telemetryPending',
          'Selected-drive telemetry availability has not resolved.',
        )}
      />
    );
  }
  if (validRows === 0 && !allowZeroRows) {
    return (
      <PassiveState
        className={classes}
        icon={icon}
        message={
          returnedRows > 0
            ? t(
                'driveDna.states.invalidTimestamps',
                'Telemetry rows were returned, but none had a valid timestamp.',
              )
            : t(
                'driveDna.states.noTelemetry',
                'This drive returned no telemetry emissions.',
              )
        }
      />
    );
  }
  if (
    validRows < minimumRows &&
    !(allowZeroRows && validRows === 0)
  ) {
    return (
      <PassiveState
        className={classes}
        icon={icon}
        message={t(
          'driveDna.states.oneEmission',
          'One chronological emission is available; at least two are needed for this profile.',
        )}
      />
    );
  }
  return <div className={classes}>{children}</div>;
}
