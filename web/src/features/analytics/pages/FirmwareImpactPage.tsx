import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CardGrid, PageLayout, Section, type CardGridItem } from '@/components/layout/layout-reference';
import { Text } from '@/components/ui';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import { useDrives } from '@/api/hooks/useDriving';
import { useSoftwareUpdates } from '@/api/hooks/useVehicleSystems';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePageTitle } from '@/hooks/usePageTitle';
import { analyzeFirmwareImpact } from '../lib/firmwareImpact';
import {
  FirmwareImpactSlot,
  FirmwareImpactMetrics,
  FirmwareImpactChart,
  FirmwareImpactDetails,
  firmwareImpactState,
} from '../components/firmware-impact-modernization';

export default function FirmwareImpactPage() {
  const { t } = useTranslation();
  usePageTitle(t('firmwareImpact.title', 'Firmware impact'));
  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;

  // Preserve current query scopes, keys, cancellation and server defaults.
  // These are returned histories, not a claim of complete lifetime coverage.
  const drivesQuery = useDrives(vehicleIdStr);
  const updatesQuery = useSoftwareUpdates(vehicleIdStr ?? '');
  const state = firmwareImpactState(drivesQuery, updatesQuery);
  const dataSources = useMemo(
    () => [
      {
        id: 'drive-history',
        label: t('dataSources.labels.driveHistory', 'Drive history'),
        query: drivesQuery,
      },
      {
        id: 'software-updates',
        label: t('dataSources.labels.softwareUpdates', 'Software updates'),
        query: updatesQuery,
      },
    ],
    [drivesQuery, t, updatesQuery],
  );
  const summary = useMemo(
    () => analyzeFirmwareImpact(
      (updatesQuery.data ?? []).map((u) => ({
        version: u.version ?? '',
        installedAt: u.installedAt ?? null,
        status: u.status ?? undefined,
      })),
      drivesQuery.data ?? [],
    ),
    [updatesQuery.data, drivesQuery.data],
  );
  const chartData = useMemo(
    () => summary.impacts
      .filter((i) => i.verdict !== 'insufficient')
      .map((i) => ({
        version: i.version,
        delta: Math.round(i.deltaWhPerKm * 10) / 10,
        share: Math.round(i.deltaShare * 1000) / 10,
        p: i.p != null ? Math.round(i.p * 1000) / 1000 : null,
        verdict: i.verdict,
      })),
    [summary.impacts],
  );
  const exportData = useMemo(
    () => chartData.map(({ verdict, ...rest }) => ({ ...rest, verdict: String(verdict) })),
    [chartData],
  );
  const best = useMemo(
    () => summary.impacts
      .filter((i) => i.verdict === 'better')
      .sort((a, b) => a.deltaWhPerKm - b.deltaWhPerKm)[0] ?? null,
    [summary.impacts],
  );
  const worst = useMemo(
    () => summary.impacts
      .filter((i) => i.verdict === 'worse')
      .sort((a, b) => b.deltaWhPerKm - a.deltaWhPerKm)[0] ?? null,
    [summary.impacts],
  );
  const onRetry = () => {
    void drivesQuery.refetch();
    void updatesQuery.refetch();
  };

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('firmwareImpact.title', 'Firmware impact')} />;
  }

  // One observed/packed grid; each section keeps its own shell and state.
  // No additional vehicle/range selectors compete with the workspace header.
  const items: CardGridItem[] = [
    {
      id: 'firmware-metrics',
      size: 'full',
      content: (
        <FirmwareImpactSlot>
          <Section id="firmware-impact-summary" title={t('firmwareImpact.modernization.summary', 'Comparison overview')}>
            <FirmwareImpactMetrics summary={summary} best={best} worst={worst} state={state} onRetry={onRetry} />
          </Section>
        </FirmwareImpactSlot>
      ),
    },
    {
      id: 'firmware-deltas',
      size: 'full',
      content: (
        <FirmwareImpactSlot delay={0.1}>
          <Section id="firmware-impact-deltas" title={t('firmwareImpact.modernization.deltas', 'Observed consumption differences')}>
            <FirmwareImpactChart chartData={chartData} exportData={exportData} state={state} onRetry={onRetry} />
          </Section>
        </FirmwareImpactSlot>
      ),
    },
    {
      id: 'firmware-versions',
      size: 'full',
      content: (
        <FirmwareImpactSlot delay={0.2}>
          <Section id="firmware-impact-versions" title={t('firmwareImpact.modernization.evidence', 'Per-version evidence')}>
            <FirmwareImpactDetails summary={summary} state={state} onRetry={onRetry} />
          </Section>
        </FirmwareImpactSlot>
      ),
    },
  ];
  return (
    <PageLayout
      title={t('firmwareImpact.title', 'Firmware impact')}
      subtitle={t(
        'firmwareImpact.modernization.subtitle',
        'Observational before-and-after comparisons of software installs using Welch’s t-test on recorded consumption',
      )}
      query={[drivesQuery, updatesQuery]}
      dataSources={dataSources}
      busy={drivesQuery.isFetching || updatesQuery.isFetching}
    >
      <Text as="p" variant="bodySm">
        {t(
          'firmwareImpact.modernization.attribution',
          'These comparisons are observational, not controlled experiments. Weather, routes, speed, driving habits and other changes can affect consumption. Statistical significance and effect size do not prove that firmware caused a difference.',
        )}
      </Text>
      <CardGrid items={items} label={t('firmwareImpact.kpis', 'Firmware impact metrics')} />
    </PageLayout>
  );
}
