import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FlaskConical, Wind, Gauge, RotateCcw, TrendingDown, TrendingUp,
} from 'lucide-react';

import { PageLayout } from '@/components/layout';
import { GlassPanel, PanelTitle, Text, Button, Badge, Select, Slider, Toggle } from '@/components/ui';

import type { StatMetric } from '@/components/data-display/stat-reference';
import { DrivingSummaryBrief } from '../components/operationalbrief-n-z/DrivingSummaryBrief';
import { Skeleton, EmptyState, QueryError, DataSourceNotice, SectionErrorBoundary } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

import { useDrives, useDrive, useDriveTelemetry } from '@/api/hooks/useDriving';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { useDataState } from '@/hooks/useDataState';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateShort } from '@/lib/dateFormat';
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
  const { t } = useTranslation();
  usePageTitle(t('whatIf.title', 'What-If Simulator'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const { formatDistance, formatEnergy, formatDuration, formatTemperature } = useUnits();

  const drivesQuery = useDrives(vehicleIdStr);
  const drives = useMemo<Drive[]>(() => drivesQuery.data ?? [], [drivesQuery.data]);

  const [selectedId, setSelectedId] = useState('');
  const activeId = selectedId || (drives[0] ? String(drives[0].id) : '');

  const driveQuery = useDrive(activeId);
  const telemetryQuery = useDriveTelemetry(activeId);

  const [knobs, setKnobs] = useState<WhatIfKnobs>(DEFAULT_KNOBS);
  const result = useMemo(
    () => simulateWhatIf(driveQuery.data, telemetryQuery.data, knobs),
    [driveQuery.data, telemetryQuery.data, knobs],
  );

  const driveOptions = useMemo(
    () =>
      drives.map((d) => ({
        value: String(d.id),
        label: `${formatDateShort(d.startTs)} · ${formatDistance(d.distanceM)}`,
      })),
    [drives, formatDistance],
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
  const baselineDurationS = driveQuery.data?.durationS;
  const drivesState = useDataState(drivesQuery);
  const driveState = useDataState(driveQuery);
  const telemetryState = useDataState(telemetryQuery);
  const loading = driveQuery.isLoading && !driveState.hasData;
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
      busy={drivesQuery.isLoading || loading || telemetryQuery.isLoading}
      contextActions={
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          {driveOptions.length > 0 && (
            <Select
              className="min-w-0 max-w-full"
              aria-label={t('whatIf.pickDrive', 'Choose a drive')}
              value={activeId}
              onChange={(e) => setSelectedId(e.target.value)}
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
          scope={driveQuery.data ? formatDateShort(driveQuery.data.startTs) : t('whatIf.brief.noDrive', 'No selected recorded drive')}
          provenance={t('whatIf.brief.provenance', 'Selected drive and telemetry, recomputed locally with the current simulation knobs.')}
          loading={loading}
          unavailable={!activeId || !result.ok}
          retained={Boolean(drivesState.refreshError || driveState.refreshError || telemetryState.refreshError)}
        />
        </SectionErrorBoundary>
      </FadeIn>
      <DataSourceNotice sources={[
        { id: 'drives', label: t('whatIf.pickDrive', 'Choose a drive'), query: drivesQuery, enabled: Boolean(vehicleIdStr) },
        { id: 'drive', label: t('whatIf.baseline', 'Actual drive'), query: driveQuery, enabled: Boolean(activeId) },
        { id: 'telemetry', label: t('whatIf.breakdown', 'Energy breakdown'), query: telemetryQuery, enabled: Boolean(activeId) },
      ]} />
      {drivesState.fatalError ? (
        <GlassPanel className="p-4 sm:p-5">
          <QueryError error={drivesState.fatalError} onRetry={() => drivesQuery.refetch()} />
        </GlassPanel>
      ) : !activeId && !drivesQuery.isLoading ? (
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
                  <Button variant="ghost" onClick={() => setKnobs(DEFAULT_KNOBS)}>
                    <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                    {t('whatIf.reset', 'Reset')}
                  </Button>
                </div>

                <Text variant="caption" as="p" className="mb-4">
                  {t(
                    'whatIf.blurb',
                    'Take a real drive and change how it was driven. The engine decomposes the energy you actually used and recomputes it — no guesswork, anchored to your data.',
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
                  ) : loading || (!activeId && drivesQuery.isLoading) ? (
                    <Skeleton height={200} />
                  ) : !result.ok ? (
                    <EmptyState /* no-action: choose another recorded drive using the picker. */
                      icon={<FlaskConical className="h-8 w-8" />}
                      message={t('whatIf.noEnergy', 'This drive lacks the energy data needed to simulate.')} />
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
                  {activeId && (!telemetryState.hasData || telemetryQuery.data?.length === 0) && result.ok && (
                    <Text as="p" variant="caption" className="mt-3">
                      {t('whatIf.telemetryAssumptions', 'Telemetry is incomplete; elevation and climate use model assumptions, not complete observations.')}
                    </Text>
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
                    <Text variant="bodySm">{t('whatIf.noEnergy', 'This drive lacks the energy data needed to simulate.')}</Text>
                  )}
                </GlassPanel>
                </SectionErrorBoundary>
              </div>
            </section>
          </FadeIn>
    </PageLayout>
  );
}
