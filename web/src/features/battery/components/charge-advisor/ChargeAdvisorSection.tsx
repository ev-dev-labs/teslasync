import type { ReactNode } from 'react';
import { Database, PlugZap } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmptyState, Skeleton } from '@/components/feedback';
import { LayoutCard, SourceContent } from '@/components/layout';
import { Text } from '@/components/ui';
import { cn } from '@/lib/cn';

import type { ChargeAdvisorDependency, ChargeAdvisorQueryState } from './types';

interface ChargeAdvisorSectionProps {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  state: ChargeAdvisorQueryState;
  dependency?: ChargeAdvisorDependency;
  dataTestId: string;
  children: ReactNode;
  className?: string;
}

export function ChargeAdvisorSection({
  title,
  subtitle,
  icon,
  state,
  dependency = 'both',
  dataTestId,
  children,
  className,
}: ChargeAdvisorSectionProps) {
  const { t } = useTranslation();
  const needsDrive = dependency === 'drive' || dependency === 'both';
  const needsCharging = dependency === 'charging' || dependency === 'both';
  const loading =
    (needsDrive && state.driveLoading)
    || (needsCharging && state.chargingLoading);
  const missingDrive = needsDrive && !state.driveAvailable;
  const missingCharging = needsCharging && !state.chargingAvailable;

  return (
    <section data-testid={dataTestId} className={cn('min-w-0', className)}>
      <LayoutCard title={title} description={subtitle}
        actions={icon ?? <Database className="h-4 w-4 text-cyan-300" aria-hidden="true" />}>
        {state.vehicleSelected && !loading && (missingDrive || missingCharging) ? (
          <Text as="p" variant="bodySm" className="py-10 text-center">
            {missingDrive ? t(
              'chargeAdvisor.states.driveUnavailable',
              'Drive history is unavailable; retry from the evidence band above.',
            ) : t(
              'chargeAdvisor.states.chargingUnavailable',
              'Charging history is unavailable. No charging profile is inferred.',
            )}
          </Text>
        ) : <SourceContent
          label={title}
          state={!state.vehicleSelected ? 'empty' : loading ? 'loading' : 'ready'}
          loadingContent={<Skeleton height={180} />}
          emptyMessage={t('chargeAdvisor.states.selectVehicle', 'Select a vehicle to show its charge-advisor evidence.')}
          errorMessage={t('chargeAdvisor.states.driveUnavailable', 'Drive history is unavailable; retry from the evidence band above.')}
          emptyContent={!state.vehicleSelected ? (
          <EmptyState /* no-action: vehicle and scenario controls in the surrounding section determine this result */
            className="py-10"
            icon={<PlugZap className="h-7 w-7" aria-hidden="true" />}
            message={t(
              'chargeAdvisor.states.selectVehicle',
              'Select a vehicle to show its charge-advisor evidence.',
            )}
          />
        ) : null}
        >
          {children}
        </SourceContent>}
      </LayoutCard>
    </section>
  );
}
