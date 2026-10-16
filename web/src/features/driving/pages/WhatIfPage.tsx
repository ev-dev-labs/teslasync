import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FlaskConical, Wind, Gauge, RotateCcw, TrendingDown, TrendingUp,
} from 'lucide-react';

import { PageLayout } from '@/components/layout';
import { GlassPanel, PanelTitle, Text, Badge, Select, Slider, Toggle, IconButton } from '@/components/ui';

import type { StatMetric } from '@/components/data-display/stat-reference';
import { DrivingSummaryBrief } from '../components/operationalbrief-n-z/DrivingSummaryBrief';
import { Skeleton, EmptyState, QueryError, DataSourceNotice, SectionErrorBoundary, resolveDataSourceStatus } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

import { useDrives, useDrive, useDriveTelemetry } from '@/api/hooks/useDriving';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { useDataState } from '@/hooks/useDataState';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useDateFormat } from '@/hooks/useDateFormat';
import { chartTokens } from '@/lib/tokens';
import type { Drive } from '@/types/driving';

import {
  simulateWhatIf,
  DEFAULT_KNOBS,
  type WhatIfKnobs,
  type EnergyBreakdown,
} from '../lib/whatIfModel';
import { WhatIfEnergyBreakdown } from '../components/WhatIfEnergyBreakdown';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

type ComponentKey = keyof Omit<EnergyBreakdown, 'total'>;

/**
 * Stacked-bar palette for the energy split.
 *
 * Sourced from the shared color-blind-safe `chartTokens.series` rather than
 * page-local hexes so the simulator reads as part of the same visual system as
 * every other chart in the app. `other` is the residual bucket — not a signal —
 * so it stays on the theme's muted token and recedes in both light and dark.
 */
const COMPONENTS: {
  key: ComponentKey;
  i18nKey: string;
  fallback: string;
  color: string;
}[] = [
  { key: 'aero',      i18nKey: 'whatIf.compAero',      fallback: 'Aero drag', color: chartTokens.series[5] },
  { key: 'rolling',   i18nKey: 'whatIf.compRolling',   fallback: 'Rolling',   color: chartTokens.series[4] },
  { key: 'elevation', i18nKey: 'whatIf.compElevation', fallback: 'Elevation', color: chartTokens.series[2] },
  { key: 'climate',   i18nKey: 'whatIf.compClimate',   fallback: 'Climate',   color: chartTokens.series[6] },
  { key: 'other',     i18nKey: 'whatIf.compOther',     fallback: 'Other',     color: 'var(--text-muted)' },
];

export default function WhatIfPage() {
  const { fmtNumber } = useNumberFormatting();
  const { formatDateShort } = useDateFormat();
  const { t } = useTranslation();
  usePageTitle(t('whatIf.title', 'What-If Simulator'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const { formatDistance, formatEnergy, formatDuration, formatTemperature } = useUnits();

  const drivesQuery = useDrives(vehicleIdStr);
  const listResolved = vehicleIdStr != null && !drivesQuery.isPlaceholderData &&
    (drivesQuery.data !== undefined || drivesQuery.isSuccess);
  const drives = useMemo<Drive[]>(() => listResolved ? drivesQuery.data ?? [] : [], [drivesQuery.data, listResolved]);

  const [selection, setSelection] = useState({ vehicleId: vehicleIdStr, id: '' });
  const selectedId = selection.vehicleId === vehicleIdStr ? selection.id : '';
  const activeId = listResolved
    ? String((drives.find((drive) => String(drive.id) === selectedId) ?? drives[0])?.id ?? '')
    : '';
  if (selection.vehicleId !== vehicleIdStr || (listResolved && selection.id !== activeId)) {
    setSelection({ vehicleId: vehicleIdStr, id: listResolved ? activeId : selectedId });
  }

  const driveQuery = useDrive(activeId);
  const telemetryQuery = useDriveTelemetry(activeId);
  const driveData = activeId && !driveQuery.isPlaceholderData ? driveQuery.data : undefined;
  const telemetryData = activeId && !telemetryQuery.isPlaceholderData ? telemetryQuery.data : undefined;

  const [knobs, setKnobs] = useState<WhatIfKnobs>(DEFAULT_KNOBS);
  const result = useMemo(
    () => simulateWhatIf(driveData, telemetryData, knobs),
    [driveData, telemetryData, knobs],
  );

  const driveOptions = useMemo(
    () =>
      drives.map((d) => ({
        value: String(d.id),
        label: `${formatDateShort(d.startTs)} · ${formatDistance(d.distanceM)}`,
      })),
    [drives, formatDistance, formatDateShort],
  );

  const componentLabels = useMemo(
    () =>
      COMPONENTS.reduce<Record<ComponentKey, string>>((labels, c) => {
        labels[c.key] = t(c.i18nKey, c.fallback);
        return labels;
      }, { aero: '', rolling: '', elevation: '', climate: '', other: '' }),
    [t],
  );

  const kwh = useMemo(
    () => (wh: number) => formatEnergy(wh),
    [formatEnergy],
  );

  const socDelta =
    result.scenarioArrivalSoc != null && result.baselineArrivalSoc != null
      ? result.scenarioArrivalSoc - result.baselineArrivalSoc
      : null;
  const maxTotal = Math.max(result.baseline.total, result.scenario.total, 1);
  const saves = result.energyDeltaWh <= 0;
  const baselineDurationS = driveData?.durationS;
  const drivesState = useDataState({ ...drivesQuery, data: listResolved ? drivesQuery.data : undefined });
  const driveState = useDataState({ ...driveQuery, data: driveData });
  const telemetryState = useDataState({ ...telemetryQuery, data: telemetryData });
  const telemetryCoverage = useMemo(() => {
    const points = (telemetryData ?? []).filter(Boolean);
    return {
      total: points.length,
      elevation: points.filter((point) => Number.isFinite(point.elevation) && point.elevation != null).length,
      climate: points.filter((point) => typeof point.isClimateOn === 'boolean').length,
      ambient: points.filter((point) => Number.isFinite(point.outsideTemp) && point.outsideTemp != null).length,
    };
  }, [telemetryData]);
  const sources = [
    { id: 'drives', label: t('whatIf.pickDrive', 'Choose a drive'), query: { ...drivesQuery, data: listResolved ? drivesQuery.data : undefined }, enabled: Boolean(vehicleIdStr) },
    { id: 'drive', label: t('whatIf.baseline', 'Actual drive'), query: { ...driveQuery, data: driveData }, enabled: Boolean(activeId) },
    { id: 'telemetry', label: t('whatIf.breakdown', 'Energy breakdown'), query: { ...telemetryQuery, data: telemetryData }, enabled: Boolean(activeId) },
  ];
  const statuses = sources.filter((source) => source.enabled).map(resolveDataSourceStatus);
  const primaryStatus = resolveDataSourceStatus(sources[activeId ? 1 : 0]);
  const loading = Boolean(vehicleIdStr) && primaryStatus === 'loading';
  const retained = [drivesState, driveState, telemetryState].some((state) =>
    state.hasData && (state.isRefreshing || state.isRefreshBlocked || state.refreshError != null));
  const missingEnergyMessage = !vehicleIdStr
    ? t('driving.brief.selectVehicle', 'Select a vehicle')
    : primaryStatus === 'failed'
      ? t('driving.brief.unavailable', 'Source unavailable')
      : primaryStatus === 'paused' && !(activeId ? driveState.hasData : listResolved)
        ? t('dataSources.status.paused', 'Refresh paused')
        : !listResolved || (activeId && !driveState.hasData)
          ? t('dataSources.status.pending', 'Pending')
          : activeId
            ? t('whatIf.noEnergy', 'This drive lacks the energy data needed to simulate.')
            : t('whatIf.brief.noDrive', 'No selected recorded drive');
  const sourceStatus = !vehicleIdStr
    ? t('operations.status.prerequisite', 'Prerequisite required')
    : statuses.includes('failed')
      ? t('driving.brief.unavailable', 'Source unavailable')
      : statuses.includes('refreshFailed')
        ? t('dataSources.status.refreshFailed', 'Cached · refresh failed')
        : statuses.includes('paused')
          ? t('dataSources.status.paused', 'Refresh paused')
          : statuses.includes('loading')
            ? t('driving.brief.loading', 'Loading source')
            : statuses.includes('pending')
              ? t('dataSources.status.pending', 'Pending')
              : statuses.includes('refreshing')
                ? t('dataSources.status.refreshing', 'Refreshing')
                : !activeId || !result.ok
                  ? t('driving.brief.unavailable', 'Source unavailable')
                  : t('driving.brief.available', 'Source available');
  const summaryMetrics: readonly StatMetric[] = [
    {
      metricId: 'energy', occurrenceId: 'scenario-energy',
      rawValue: result.ok ? result.scenario.total : null,
      label: t('whatIf.energy', 'Energy used'),
      display: { formatter: (raw) => ({ value: kwh(raw), unit: '' }) },
      context: result.ok ? `${t('whatIf.was', 'was')} ${kwh(result.baseline.total)}` : undefined,
    },
    {
      metricId: 'percent', occurrenceId: 'scenario-arrival',
      rawValue: result.ok ? result.scenarioArrivalSoc : null,
      label: t('whatIf.arrival', 'Arrival battery'),
      display: { precision: 0 },
      context: result.ok && socDelta != null ? `${socDelta >= 0 ? '+' : '−'}${fmtNumber(Math.abs(socDelta))}%` : undefined,
    },
    {
      metricId: 'duration', occurrenceId: 'scenario-duration',
      rawValue: result.ok ? result.scenarioDurationS : null,
      label: t('whatIf.duration', 'Duration'),
      display: { formatter: (raw) => ({ value: formatDuration(raw), unit: '' }) },
      context: baselineDurationS != null ? `${t('whatIf.was', 'was')} ${formatDuration(baselineDurationS)}` : undefined,
    },
  ];

  return (
    <PageLayout
      title={t('whatIf.title', 'What-If Simulator')}
      subtitle={t('whatIf.subtitle', 'Replay a real drive under different conditions')}
      query={[drivesQuery, driveQuery, telemetryQuery]}
      busy={statuses.some((status) => status === 'loading' || status === 'refreshing')}
      contextActions={
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          {driveOptions.length > 0 && (
            <Select
              className="min-w-0 max-w-full"
              aria-label={t('whatIf.pickDrive', 'Choose a drive')}
              value={activeId}
              onChange={(e) => setSelection({ vehicleId: vehicleIdStr, id: e.target.value })}
              options={driveOptions}
            />
          )}
        </div>
      }
    >
      <FadeIn>
        <SectionErrorBoundary name="WhatIfSummary">
        <DrivingSummaryBrief
          id="what-if-brief"
          title={t('whatIf.kpis', 'Simulated drive outcome')}
          description={t('whatIf.brief.description', 'Scenario estimates compared with the selected recorded drive; these are model outputs, not observed savings.')}
          metrics={summaryMetrics}
          scope={driveData ? formatDateShort(driveData.startTs) : loading
            ? t('driving.brief.loading', 'Loading source')
            : missingEnergyMessage}
          provenance={t('whatIf.brief.provenance', 'Selected drive and telemetry, recomputed locally with the current simulation knobs.')}
          loading={loading}
          unavailable={!activeId || !result.ok}
          retained={retained}
          sourceStatus={sourceStatus}
        />
        </SectionErrorBoundary>
      </FadeIn>
      <DataSourceNotice sources={sources} />
      {drivesState.fatalError ? (
        <GlassPanel className="p-4 sm:p-5">
          <QueryError error={drivesState.fatalError} onRetry={() => drivesQuery.refetch()} />
        </GlassPanel>
      ) : listResolved && drives.length === 0 ? (
        <GlassPanel className="p-4 sm:p-5">
          <EmptyState icon={<FlaskConical className="h-8 w-8" />} message={t('whatIf.noDrives', 'No drives found for this vehicle yet.')}
            actionTo={{ label: t('whatIf.browseDrives', 'Browse drives'), to: '/drives' }} />
        </GlassPanel>
      ) : null}
          <FadeIn delay={0.1}>
            <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              <SectionErrorBoundary name="WhatIfKnobs">
              <GlassPanel className="min-w-0 p-4 sm:p-5 xl:col-span-1">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <PanelTitle className="flex items-center gap-2">
                    <Gauge className="h-4 w-4 text-[var(--text-secondary)]" aria-hidden="true" />
                    {t('whatIf.knobs', 'Knobs')}
                  </PanelTitle>
                  <IconButton icon={<RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />} label={t('whatIf.reset', 'Reset')} onClick={() => setKnobs(DEFAULT_KNOBS)} confirm={{ title: t('confirm.resetInputs.title', 'Reset all inputs?'), message: t('confirm.resetInputs.message', 'Your changes return to their default values.') }} />
                </div>

                <Text variant="caption" as="p" className="mb-4">
                  {t(
                    'whatIf.modelHelp',
                    'The recorded energy total anchors an estimated decomposition using generic vehicle constants. Aero, rolling, elevation and climate are modeled, not separately measured. Other is a signed unexplained residual; a negative value means the model exceeds the recorded total.',
                  )}
                </Text>

                <div className="flex flex-col gap-5">
                  <Slider
                    label={t('whatIf.speedLabel', 'Average speed')}
                    value={knobs.speedFactor}
                    min={0.8}
                    max={1.2}
                    step={0.05}
                    formatValue={(v) => `${fmtNumber(Math.round(v * 100))}%`}
                    onChange={(v) => setKnobs((k) => ({ ...k, speedFactor: v }))}
                  />

                  <div>
                    <Text variant="label" as="span" className="mb-1.5 block">
                      {t('whatIf.tires', 'Tire pressure')}
                    </Text>
                    <Select
                      aria-label={t('whatIf.tires', 'Tire pressure')}
                      value={knobs.tires}
                      onChange={(e) => {
                        const tires = e.target.value;
                        if (tires === 'low' || tires === 'nominal' || tires === 'high') setKnobs((k) => ({ ...k, tires }));
                      }}
                      options={[
                        { value: 'low', label: t('whatIf.tireLow', 'Under-inflated (−)') },
                        { value: 'nominal', label: t('whatIf.tireNominal', 'Nominal') },
                        { value: 'high', label: t('whatIf.tireHigh', 'Over-inflated (+)') },
                      ]}
                    />
                  </div>

                  <Toggle
                    label={t('whatIf.hvac', 'Climate (HVAC)')}
                    checked={knobs.hvac}
                    onChange={(checked) => setKnobs((k) => ({ ...k, hvac: checked }))}
                  />

                  <Slider
                    label={t('whatIf.ambientLabel', 'Ambient temperature')}
                    value={knobs.ambientC}
                    min={-10}
                    max={40}
                    step={1}
                    formatValue={(v) => formatTemperature(v)}
                    onChange={(v) => setKnobs((k) => ({ ...k, ambientC: v }))}
                  />
                </div>
              </GlassPanel>

              </SectionErrorBoundary>
              <div className="flex min-w-0 flex-col gap-4 xl:col-span-2">
                <SectionErrorBoundary name="WhatIfEnergy">
                <GlassPanel className="p-4 sm:p-5">
                  <PanelTitle className="mb-3 flex items-center gap-2">
                    <Wind className="h-4 w-4 text-[var(--text-secondary)]" aria-hidden="true" />
                    {t('whatIf.breakdown', 'Energy breakdown')}
                  </PanelTitle>

                  {driveState.fatalError ? (
                    <QueryError error={driveState.fatalError} onRetry={() => driveQuery.refetch()} />
                  ) : loading ? (
                    <Skeleton height={200} />
                  ) : !result.ok ? (
                    <EmptyState /* no-action: choose another recorded drive using the picker. */
                      icon={<FlaskConical className="h-8 w-8" />}
                      message={missingEnergyMessage} />
                  ) : (
                  <div className="space-y-4">
                    <WhatIfEnergyBreakdown
                      caption={t('whatIf.baseline', 'Actual drive')}
                      breakdown={result.baseline}
                      max={maxTotal}
                      labels={componentLabels}
                      formatWh={kwh}
                      components={COMPONENTS}
                    />
                    <WhatIfEnergyBreakdown
                      caption={t('whatIf.scenario', 'What-if')}
                      breakdown={result.scenario}
                      max={maxTotal}
                      labels={componentLabels}
                      formatWh={kwh}
                      components={COMPONENTS}
                    />
                  </div>

                  )}
                  {activeId && result.ok && (
                    <>
                    <Text as="p" variant="caption" className="mt-3">
                      {t('whatIf.fieldCoverage', 'Valid telemetry fields in {{total}} returned samples: elevation {{elevation}}, climate state {{climate}}, ambient temperature {{ambient}}. Field presence does not establish complete drive observations. Missing elevation yields no modeled climb; missing climate state assumes HVAC on; missing ambient temperature assumes {{temperature}}.', {
                        ...telemetryCoverage,
                        temperature: formatTemperature(DEFAULT_KNOBS.ambientC),
                      })}
                    </Text>
                    <Text as="p" variant="caption" className="mt-2">
                      {t('whatIf.packAssumptions', 'Arrival battery is modeled using a pack inferred from recorded energy and a valid battery drop when the inferred capacity is within model bounds; otherwise it uses the default pack. Current modeled capacity: {{capacity}}. Neither capacity nor arrival battery is a direct pack measurement.', {
                        capacity: kwh(result.packWh),
                      })}
                    </Text>
                    </>
                  )}
                </GlassPanel>
                </SectionErrorBoundary>
                <SectionErrorBoundary name="WhatIfTakeaway">
                <GlassPanel className="flex min-w-0 flex-wrap items-center gap-3 p-4 sm:p-5">
                  {result.ok ? (
                  <>
                  {saves ? (
                    <TrendingDown className="h-5 w-5 shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />
                  ) : (
                    <TrendingUp className="h-5 w-5 shrink-0 text-[var(--text-secondary)]" aria-hidden="true" />
                  )}
                  <Text variant="bodySm" className="min-w-0 flex-1">
                    {saves
                      ? t('whatIf.takeawaySave', 'This would save {{wh}} — arriving with {{soc}} more battery.', {
                          wh: kwh(Math.abs(result.energyDeltaWh)),
                          soc: socDelta != null ? `${fmtNumber(Math.abs(socDelta))}%` : '—',
                        })
                      : t('whatIf.takeawayCost', 'This would cost an extra {{wh}} — arriving with {{soc}} less battery.', {
                          wh: kwh(result.energyDeltaWh),
                          soc: socDelta != null ? `${fmtNumber(Math.abs(socDelta))}%` : '—',
                        })}
                  </Text>
                  <Badge variant={saves ? 'success' : 'warning'}>
                    {saves ? '−' : '+'}
                    {kwh(Math.abs(result.energyDeltaWh))}
                  </Badge>
                  </>
                  ) : loading ? <Skeleton height={40} /> : (
                    <Text variant="bodySm">{missingEnergyMessage}</Text>
                  )}
                </GlassPanel>
                </SectionErrorBoundary>
              </div>
            </section>
          </FadeIn>
    </PageLayout>
  );
}
