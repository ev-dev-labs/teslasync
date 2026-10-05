import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Footprints } from 'lucide-react';
import { LayoutCard } from '@/components/layout/layout-reference';
import { Badge, Caption } from '@/components/ui';
import { LinearGauge } from '@/components/charts';
import { EmptyState, Skeleton, QueryError } from '@/components/feedback';
import { useDriveDynamicsLatest } from '@/api/hooks/useVehicles';
import { useDataState } from '@/hooks/useDataState';
import { INTERVALS } from '@/lib/constants';
import { isFiniteNumber } from '@/lib/numberFormat';

export default function PedalUsage({ vehicleId }: { vehicleId: number | null | undefined }) {
  const { t } = useTranslation();
  const query = useDriveDynamicsLatest(vehicleId ?? 0, INTERVALS.REALTIME);
  const state = useDataState(query);
  const data = state.data;
  const handleRetry = useCallback(() => { void query.refetch(); }, [query.refetch]);
  const throttle = isFiniteNumber(data?.pedal_position) ? data.pedal_position : null;
  const brakePos = isFiniteNumber(data?.brake_pedal_position) ? data.brake_pedal_position : null;
  const brakeActive = typeof data?.brake_pedal_active === 'boolean' ? data.brake_pedal_active : null;
  const hasAny = throttle != null || brakePos != null || brakeActive != null;
  const brakeBadge = brakeActive == null
    ? { variant: 'neutral' as const, label: t('dynamics.brakeUnknown', 'Brake Unknown') }
    : brakeActive
      ? { variant: 'danger' as const, label: t('dynamics.brakeActive', 'Brake Active') }
      : { variant: 'success' as const, label: t('dynamics.brakeInactive', 'Brake Inactive') };

  return (
    <LayoutCard title={t('dynamics.pedalUsage', 'Pedal Usage')}>
      {query.isLoading && !state.hasData ? (
        <div role="status" aria-busy="true"
          aria-label={t('dynamics.pedalLoading', 'Loading pedal telemetry…')}
          className="grid min-h-[8rem] grid-cols-1 gap-4 py-2 @md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="flex flex-col items-center gap-3">
              <Skeleton rounded className="h-24 w-24" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </div>
      ) : hasAny ? (
        <div className="grid min-w-0 grid-cols-1 gap-4 @md:grid-cols-3">
          <div className="flex flex-col items-center gap-2">
            <LinearGauge value={throttle} max={100}
              label={t('dynamics.throttle', 'Throttle')} unit={throttle != null ? '%' : '—'}
              tone="info" size={120} />
            <Caption>{t('dynamics.throttlePosition', 'Throttle Position')}</Caption>
          </div>
          <div className="flex flex-col items-center gap-2">
            <LinearGauge value={brakePos} max={100}
              label={t('dynamics.brake', 'Brake')} unit={brakePos != null ? '%' : '—'}
              tone="danger" size={120} />
            <Caption>{t('dynamics.brakePedalPosition', 'Brake Pedal Position')}</Caption>
          </div>
          <div className="flex flex-col items-center justify-center gap-3">
            <Footprints className="h-8 w-8 text-[var(--text-muted)]" aria-hidden="true" />
            <Badge variant={brakeBadge.variant} size="lg">{brakeBadge.label}</Badge>
            <Caption>{t('dynamics.brakePedal', 'Brake Pedal Status')}</Caption>
          </div>
        </div>
      ) : state.fatalError ? (
        <QueryError error={state.fatalError} onRetry={handleRetry} resourceName={t('dynamics.pedalResource', 'Pedal telemetry')} />
      ) : (
        <EmptyState message={t('dynamics.pedalNoData', 'No pedal telemetry received yet')} />
      )}
    </LayoutCard>
  );
}
