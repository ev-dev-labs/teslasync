import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Waypoints } from 'lucide-react';

import { PageLayout, LayoutCard, SourceContent } from '@/components/layout';
import { HelpTooltip } from '@/components/ui';
import { RangePicker } from '@/components/forms';
import type { StatMetric } from '@/components/data-display/stat-reference';
import { Skeleton, EmptyState, StaleRefreshWarning } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';

import { useDrives } from '@/api/hooks/useDriving';
import { useRangeState } from '@/hooks/useRangeState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDataState } from '@/hooks/useDataState';
import { chartTokens } from '@/lib/tokens';
import type { Drive } from '@/types/driving';

import { computeAnatomy, layoutSankey, type SankeyFlow } from '../lib/energyAnatomy';
import { EnergyFlowDiagram } from '../components/continuation-driving-secondary/EnergyFlowDiagram';
import { DrivingSummaryBrief } from '../components/operationalbrief-a-m/DrivingSummaryBrief';

const COMPONENT_META: Record<string, { i18nKey: string; fallback: string; color: string }> = {
  aero:    { i18nKey: 'energyAnatomy.aero',    fallback: 'Aero drag',      color: chartTokens.series[5] },
  rolling: { i18nKey: 'energyAnatomy.rolling', fallback: 'Rolling',        color: chartTokens.series[4] },
  climate: { i18nKey: 'energyAnatomy.climate', fallback: 'Climate (HVAC)', color: chartTokens.series[2] },
  other:   { i18nKey: 'energyAnatomy.other',   fallback: 'Drivetrain & other', color: chartTokens.series[0] },
};

export default function EnergyAnatomyPage() {
  const { t } = useTranslation();
  usePageTitle(t('energyAnatomy.title', 'Energy Anatomy'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const { formatEnergy } = useUnits();

  const { start, end, setRange } = useRangeState({
    persistKey: 'energy-anatomy.range',
    defaultPresetId: 'all',
  });

  const drivesQuery = useDrives(vehicleIdStr);
  const drivesState = useDataState(drivesQuery, { provenance: 'historical' });
  const allDrives = useMemo<Drive[]>(() => drivesQuery.data ?? [], [drivesQuery.data]);

  const drives = useMemo<Drive[]>(() => {
    if (!allDrives.length) return [];
    const startMs = new Date(`${start}T00:00:00`).getTime();
    const endMs = new Date(`${end}T23:59:59.999`).getTime();
    return allDrives.filter((d) => {
      if (!d.startTs) return false;
      const ts = new Date(d.startTs).getTime();
      return ts >= startMs && ts <= endMs;
    });
  }, [allDrives, start, end]);

  const anatomy = useMemo(() => computeAnatomy(drives), [drives]);

  const flows = useMemo<SankeyFlow[]>(
    () => [
      { key: 'aero', value: anatomy.aeroWh },
      { key: 'rolling', value: anatomy.rollingWh },
      { key: 'climate', value: anatomy.climateWh },
      { key: 'other', value: anatomy.otherWh },
    ],
    [anatomy],
  );
  const sankey = useMemo(() => layoutSankey(flows, 640, 300), [flows]);

  const share = (wh: number) =>
    anatomy.totalWh > 0 ? `${Math.round((wh / anatomy.totalWh) * 100)}%` : '—';

  const biggest = useMemo(() => {
    const entries = [
      ['aero', anatomy.aeroWh],
      ['rolling', anatomy.rollingWh],
      ['climate', anatomy.climateWh],
      ['other', anatomy.otherWh],
    ] as const;
    return entries.reduce((a, b) => (b[1] > a[1] ? b : a));
  }, [anatomy]);
  const available = drivesState.data != null;
  const briefMetrics: readonly StatMetric[] = [
    { metricId: 'energy', occurrenceId: 'used', rawValue: available ? anatomy.totalWh : null,
      label: t('energyAnatomy.total', 'Energy Used'),
      description: available
        ? t('energyAnatomy.driveCount', '{{count}} drives', { count: anatomy.drives })
        : t('driving.brief.pending', 'Drive evidence is not available yet.'),
      display: { formatter: (raw) => ({ value: formatEnergy(raw), unit: '' }) } },
    { metricId: 'text', occurrenceId: 'biggest',
      rawValue: available && anatomy.totalWh > 0 ? t(COMPONENT_META[biggest[0]]!.i18nKey, COMPONENT_META[biggest[0]]!.fallback) : null,
      label: t('energyAnatomy.biggest', 'Biggest Consumer'),
      description: t('energyAnatomy.brief.apportionment', 'Directional physical-model apportionment, not a directly measured component.'),
      context: share(biggest[1]) },
    { metricId: 'percent', occurrenceId: 'climate',
      rawValue: available && anatomy.totalWh > 0 ? Math.round((anatomy.climateWh / anatomy.totalWh) * 100) : null,
      label: t('energyAnatomy.climateCard', 'Climate Overhead'),
      description: t('energyAnatomy.brief.climate', 'Modeled climate share of measured traction energy.'),
      context: available ? formatEnergy(anatomy.climateWh) : undefined,
      display: { precision: 0 } },
    { metricId: 'energy', occurrenceId: 'regen', rawValue: available ? anatomy.regenWh : null,
      label: t('energyAnatomy.regen', 'Regen Credit'),
      description: t('energyAnatomy.brief.regen', 'Returned regeneration energy; recovery share uses the measured energy-used denominator.'),
      context: available && anatomy.totalWh > 0
        ? t('energyAnatomy.regenShare', '{{pct}}% recovered', { pct: Math.round((anatomy.regenWh / anatomy.totalWh) * 100) })
        : undefined,
      display: { formatter: (raw) => ({ value: formatEnergy(raw), unit: '' }) } },
  ];

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('energyAnatomy.title', 'Energy Anatomy')} />;
  }

  const isLoading = drivesState.status === 'initial';
  const isError = drivesState.fatalError != null;

  return (
    <PageLayout
      title={t('energyAnatomy.title', 'Energy Anatomy')}
      subtitle={t('energyAnatomy.subtitle', 'Where a period of traction energy physically went')}
      query={drivesQuery}
      contextActions={
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <RangePicker
            value={{ start, end }}
            onChange={setRange}
            align="end"
            triggerTestId="energy-anatomy-range"
          />
        </div>
      }
    >
      <StaleRefreshWarning state={drivesState} label={t('energyAnatomy.title', 'Energy Anatomy')} />
      {/* 1 — KPI band */}
      <FadeIn>
        <section
          aria-label={t('energyAnatomy.kpis', 'Energy anatomy summary metrics')}
        >
          <DrivingSummaryBrief metrics={briefMetrics}
            title={t('energyAnatomy.kpis', 'Energy anatomy summary metrics')}
            description={t('energyAnatomy.brief.description', 'Measured total energy anchors a directional physical split; component estimates are not laboratory-grade measurements.')}
            scope={t('driving.brief.window', '{{start}}–{{end}}; returned drive subset, not a server-wide aggregate', { start, end })}
            provenance={t('energyAnatomy.brief.source', 'Returned drive energy and regeneration; modeled aerodynamic, rolling and climate allocation.')}
            loading={isLoading} error={drivesState.fatalError}
            retained={drivesState.status === 'stale' || drivesState.refreshError != null}
            onRetry={() => void drivesQuery.refetch()} />
        </section>
      </FadeIn>

      {/* 2 — Sankey */}
      <FadeIn delay={0.1}>
        <LayoutCard
          title={t('energyAnatomy.sankey', 'Energy Flow')}
          actions={<>
            <Waypoints className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            <HelpTooltip
              size="sm"
              i18nKey="help.energyAnatomy.body"
              defaultValue="An approximate physical anatomy of your measured consumption: aerodynamic drag grows with speed squared, rolling resistance with distance, and climate load with temperature deviation and time. The measured total is authoritative — physics only apportions it — so treat the split as directional, not laboratory-grade."
              ariaLabel={t('help.energyAnatomy.iconLabel', 'More info about the anatomy model')}
            />
          </>}
        >
          <SourceContent
            state={isError ? 'error' : isLoading ? 'loading' : anatomy.totalWh === 0 ? 'empty' : 'ready'}
            label={t('energyAnatomy.sankey', 'Energy Flow')}
            error={drivesState.fatalError}
            errorMessage={t('drivingSecondary.states.historyError', 'Could not load drive history.')}
            errorRecovery={{ onRetry: () => void drivesQuery.refetch() }}
            loadingContent={<Skeleton height={300} />}
            emptyMessage={t('energyAnatomy.noData', 'No drives with energy data in this period.')}
            emptyContent={<EmptyState
              icon={<Waypoints className="h-8 w-8" />}
              message={t('energyAnatomy.noData', 'No drives with energy data in this period.')}
              actionTo={{ label: t('energyAnatomy.browseDrives', 'Browse drives'), to: '/drives' }}
            />}
          >
            <EnergyFlowDiagram
              sankey={sankey}
              flows={flows}
              metadata={COMPONENT_META}
              totalEnergyWh={anatomy.totalWh}
              formatEnergy={formatEnergy}
              share={share}
            />
          </SourceContent>
        </LayoutCard>
      </FadeIn>
    </PageLayout>
  );
}
