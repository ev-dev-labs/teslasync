import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { BatteryCharging } from 'lucide-react';
import type { DataState } from '@/api/dataState';
import { LayoutCard, useCardPlacement } from '@/components/layout/layout-reference';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { cn } from '@/lib/cn';

interface CurveSourceSectionProps {
  title: string;
  state: DataState<unknown>;
  vehicleSelected: boolean;
  hasSessions: boolean;
  height: number;
  onResetRange: () => void;
  onRetry: () => void;
  children: ReactNode;
  selectionRequired?: boolean;
}

/** Placement only for populated specialists. Their own ChartContainer remains
 * the owner of exports, accessible data, annotations and persisted series IDs. */
export function CurveSourceSection({
  title, state, vehicleSelected, hasSessions, height, onResetRange, onRetry,
  children, selectionRequired = false,
}: CurveSourceSectionProps) {
  const { t } = useTranslation();
  const placement = useCardPlacement();
  const icon = <BatteryCharging className="h-8 w-8" aria-hidden="true" />;

  if (state.fatalError) {
    return (
      <LayoutCard title={title}>
        <QueryError
          error={state.fatalError}
          onRetry={onRetry}
          resourceName={t('charging.curve.resource', 'Charging sessions')}
        />
      </LayoutCard>
    );
  }
  if (vehicleSelected && !state.hasData && !state.isRefreshBlocked) {
    return (
      <LayoutCard title={title}>
        <Skeleton height={height} />
      </LayoutCard>
    );
  }
  if (!hasSessions || selectionRequired) {
    const message = !vehicleSelected
      ? t('charging.curve.modernization.chooseVehicle', 'Choose a vehicle in the workspace header to view charging sessions.')
      : state.isRefreshBlocked && !state.hasData
        ? t('charging.curve.modernization.waitingConnection', 'Charging sessions are waiting for a connection.')
        : selectionRequired && hasSessions
          ? t('charging.curve.selectSessionHint', 'Select a session above to view its charging curve')
          : t('charging.curve.empty', 'No charging sessions to plot a curve.');
    return (
      <LayoutCard title={title}>
        <div className="flex min-h-48 min-w-0 items-center justify-center">
          <EmptyState
            icon={icon}
            message={message}
            action={vehicleSelected && state.hasData && !hasSessions
              ? { label: t('charging.curve.resetRange', 'Reset date range'), onClick: onResetRange }
              : undefined}
          />
        </div>
      </LayoutCard>
    );
  }
  return (
    <div data-curve-specialist className={cn('w-full min-w-0', placement?.className ?? 'col-span-1')}>
      {children}
    </div>
  );
}
