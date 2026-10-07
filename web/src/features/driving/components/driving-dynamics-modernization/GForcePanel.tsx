import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { LayoutCard } from '@/components/layout/layout-reference';
import type { StatMetric } from '@/components/data-display/stat-reference';
import { NestedDrivingBrief } from '../operationalbrief-a-m/NestedDrivingBrief';
import { EmptyState, QueryError, StaleRefreshWarning } from '@/components/feedback';
import { useDriveDynamicsLatest } from '@/api/hooks/useVehicles';
import { useDataState } from '@/hooks/useDataState';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { INTERVALS } from '@/lib/constants';
import { isFiniteNumber } from '@/lib/numberFormat';

/** Signed axes stay in g. Magnitude still requires BOTH measured axes. */
export default function GForcePanel({ vehicleId }: { vehicleId: number | null | undefined }) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const { precision, locale, fmtNumber } = useNumberFormatting();
  const query = useDriveDynamicsLatest(vehicleId ?? 0, INTERVALS.REALTIME);
  const state = useDataState(query);
  const data = state.data;
  const { lateral, longitudinal, magnitude, hasAny } = useMemo(() => {
    const rawLat = data?.lateral_acceleration;
    const rawLon = data?.longitudinal_acceleration;
    const lat = isFiniteNumber(rawLat) ? rawLat : null;
    const lon = isFiniteNumber(rawLon) ? rawLon : null;
    return {
      lateral: lat,
      longitudinal: lon,
      magnitude: lat != null && lon != null ? Math.sqrt(lat * lat + lon * lon) : null,
      hasAny: lat != null || lon != null,
    };
  }, [data?.lateral_acceleration, data?.longitudinal_acceleration]);
  const metrics: StatMetric[] = [
    { metricId: 'number', occurrenceId: 'g-force-lateral', rawValue: lateral,
      label: t('dynamics.lateral', 'Lateral'), display: { formatter: raw => ({ value: fmtNumber(raw), unit: 'g' }) }, context: t('dynamics.modernization.gUnit', 'g') },
    { metricId: 'number', occurrenceId: 'g-force-longitudinal', rawValue: longitudinal,
      label: t('dynamics.longitudinal', 'Longitudinal'), display: { formatter: raw => ({ value: fmtNumber(raw), unit: 'g' }) }, context: t('dynamics.modernization.gUnit', 'g') },
    { metricId: 'number', occurrenceId: 'g-force-combined', rawValue: magnitude,
      label: t('dynamics.combined', 'Combined'), display: { formatter: raw => ({ value: fmtNumber(raw), unit: 'g' }) }, context: t('dynamics.modernization.gUnit', 'g') },
  ];
  return (
    <LayoutCard title={t('dynamics.gForce', 'Acceleration G-Force')}>
      <StaleRefreshWarning state={state} label={t('dynamics.gForce', 'Acceleration G-Force')} />
      {state.fatalError ? <QueryError error={state.fatalError} onRetry={() => void query.refetch()} /> : null}
      {hasAny || query.isLoading ? (
        <NestedDrivingBrief
          testId="dynamics-g-force"
          title={t('dynamics.brief.accelerationAxes', 'Reported acceleration axes')}
          description={t('dynamics.modernization.gSource', 'Latest reported acceleration; missing axes are not zero.')}
          unavailable={state.fatalError != null}
          metrics={metrics}
          preferences={{ units: { ...unitPrefs, precision, locale }, currency: { kind: 'symbol', value: '' } }}
          loading={query.isLoading && !state.hasData}
          retained={state.refreshError != null}
          period={{
            kind: 'snapshot',
            // This projection has no observation timestamp. Do not substitute
            // HTTP receipt time or invent signal freshness.
            observedAt: null,
            label: t('dynamics.review.liveBadge', 'Current signals · not trip history'),
            provenance: t('dynamics.modernization.gSource', 'Latest reported acceleration; missing axes are not zero.'),
          }}
        />
      ) : state.fatalError ? null : (
        // no-action: Without a selected vehicle, the workspace picker owns selection.
        <EmptyState message={t('dynamics.gForceNoData', 'No G-force telemetry received yet')}
          action={vehicleId ? { label: t('common.retry', 'Retry'), onClick: () => void query.refetch() } : undefined} />
      )}
    </LayoutCard>
  );
}
