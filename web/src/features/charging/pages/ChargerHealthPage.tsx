import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { PageLayout, CardGrid } from '@/components/layout';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { useChargingSessions } from '@/api/hooks/useCharging';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDataState } from '@/hooks/useDataState';
import { analyzeChargerHealth } from '../lib/chargerHealth';
import {
  ChargerHealthStats, ChargerHealthChart, ChargerHealthLocations,
} from '../components/charger-health-modernization';

export default function ChargerHealthPage() {
  const { t } = useTranslation();
  usePageTitle(t('chargerHealth.title', 'Charger Health'));
  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;

  // Frozen page operands are preserved: no history-hook substitution, bounds,
  // default-limit change, additional query, polling or query-policy override.
  const sessionsQuery = useChargingSessions(vehicleIdStr);
  const sessionsState = useDataState(sessionsQuery, { provenance: 'historical' });
  const summary = useMemo(
    () => analyzeChargerHealth(sessionsQuery.data ?? []),
    [sessionsQuery.data],
  );

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('chargerHealth.title', 'Charger Health')} />;
  }
  const loading = !sessionsState.hasData && !sessionsState.fatalError
    && !sessionsState.isRefreshBlocked && sessionsQuery.isLoading;

  return <PageLayout
    title={t('chargerHealth.title', 'Charger Health')}
    subtitle={t('chargerHealth.subtitle',
      'Every charging location benchmarked against its own best behaviour, so a stall that has quietly slowed down cannot hide')}
    query={sessionsQuery}
    busy={sessionsState.isRefreshing}
  >
    {/* 1 — Persistent four-slot metric band; unknown is not zero or healthy. */}
    <FadeIn>
      <ChargerHealthStats summary={summary} state={sessionsState} loading={loading} />
    </FadeIn>

    {/* 2 + 3 — Full allocated width; original chart then locations ordering.
        Each shell owns its source state. No PageContainer error/empty gate can
        erase the other sections or retained charging history. */}
    <CardGrid label={t('chargerHealth.layout.panels', 'Charger health analysis')} items={[
      {
        id: 'charger-health-performance',
        size: 'full',
        content: <ChargerHealthChart summary={summary} state={sessionsState} loading={loading} />,
      },
      {
        id: 'charger-health-locations',
        size: 'full',
        content: <ChargerHealthLocations summary={summary} state={sessionsState} loading={loading} />,
      },
    ]} />
  </PageLayout>;
}
