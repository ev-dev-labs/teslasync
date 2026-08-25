import type { ReactNode } from 'react';
import { Database, PlugZap } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmptyState, Skeleton } from '@/components/feedback';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
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
  const loading =
    state.isLoading
    || (dependency !== 'charging' && state.driveLoading)
    || (dependency !== 'drive' && state.chargingLoading);
  const missingDrive = dependency !== 'charging' && !state.driveAvailable;
  const missingCharging = dependency !== 'drive' && !state.chargingAvailable;

  return (
    <section data-testid={dataTestId} className={cn('min-w-0', className)}>
      <GlassPanel className="h-full p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          {icon ?? <Database className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
          {title}
        </PanelTitle>
        {subtitle && (
          <Text as="p" variant="caption" className="mb-4">
            {subtitle}
          </Text>
        )}
        {!state.vehicleSelected ? (
          <EmptyState /* no-action: vehicle and scenario controls in the surrounding section determine this result */
            className="py-10"
            icon={<PlugZap className="h-7 w-7" aria-hidden="true" />}
            message={t(
              'chargeAdvisor.states.selectVehicle',
              'Select a vehicle to show its charge-advisor evidence.',
            )}
          />
        ) : loading ? (
          <Skeleton height={180} />
        ) : missingDrive ? (
          <Text as="p" variant="bodySm" className="py-10 text-center">
            {t(
              'chargeAdvisor.states.driveUnavailable',
              'Drive history is unavailable; retry from the evidence band above.',
            )}
          </Text>
        ) : missingCharging ? (
          <Text as="p" variant="bodySm" className="py-10 text-center">
            {t(
              'chargeAdvisor.states.chargingUnavailable',
              'Charging history is unavailable. No charging profile is inferred.',
            )}
          </Text>
        ) : (
          children
        )}
      </GlassPanel>
    </section>
  );
}
