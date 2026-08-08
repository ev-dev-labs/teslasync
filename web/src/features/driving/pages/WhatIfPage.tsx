import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FlaskConical, Wind, Gauge, RotateCcw, TrendingDown, TrendingUp,
  BatteryCharging, Timer, Zap,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, PanelTitle, Text, Button, Badge, Select, Slider, Toggle } from '@/components/ui';
import { VehicleSelect } from '@/components/forms';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

import { useDrives, useDrive, useDriveTelemetry } from '@/api/hooks/useDriving';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateShort } from '@/lib/dateFormat';
import { chartTokens } from '@/lib/tokens';
import type { Drive } from '@/types/driving';

import {
  simulateWhatIf,
  DEFAULT_KNOBS,
  type WhatIfKnobs,
  type TirePreset,
  type EnergyBreakdown,
} from '../lib/whatIfModel';

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

/** One labelled stacked bar (actual or what-if) in the breakdown panel. */
function BreakdownRow({
  caption,
  breakdown,
  max,
  labels,
  formatWh,
}: {
  caption: string;
  breakdown: EnergyBreakdown;
  max: number;
  labels: Record<ComponentKey, string>;
  formatWh: (wh: number) => string;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <Text variant="caption">{caption}</Text>
        <Text variant="caption" className="font-mono tabular-nums">{formatWh(breakdown.total)}</Text>
      </div>
      <div
        className="flex h-7 w-full overflow-hidden rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-2)]"
        role="img"
        aria-label={`${caption} — ${formatWh(breakdown.total)}`}
      >
        {COMPONENTS.map((c) => {
          const pct = max > 0 ? (breakdown[c.key] / max) * 100 : 0;
          // Sub-0.5% slivers render as a hairline of colour with no readable
          // area — drop them so the bar stays clean rather than fringed.
          return pct > 0.5 ? (
            <div
              key={c.key}
              style={{ width: `${pct}%`, background: c.color }}
              title={`${labels[c.key]}: ${formatWh(breakdown[c.key])}`}
            />
          ) : null;
        })}
      </div>
    </div>
  );
}

export default function WhatIfPage() {
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
        label: `${formatDateShort(d.startTs)} · ${formatDistance(d.distanceM, { precision: 1 })}`,
      })),
    [drives, formatDistance],
  );

  const componentLabels = useMemo(
    () =>
      Object.fromEntries(
        COMPONENTS.map((c) => [c.key, t(c.i18nKey, c.fallback)]),
      ) as Record<ComponentKey, string>,
    [t],
  );

  const kwh = useMemo(
    () => (wh: number) => formatEnergy(wh, { precision: 1 }),
    [formatEnergy],
  );

  const socDelta =
    result.scenarioArrivalSoc != null && result.baselineArrivalSoc != null
      ? result.scenarioArrivalSoc - result.baselineArrivalSoc
      : null;
  const maxTotal = Math.max(result.baseline.total, result.scenario.total, 1);
  const saves = result.energyDeltaWh <= 0;
  const baselineDurationS = driveQuery.data?.durationS;
  const loading = drivesQuery.isLoading || driveQuery.isLoading || telemetryQuery.isLoading;

  return (
    <PageContainer
      title={t('whatIf.title', 'What-If Simulator')}
      subtitle={t('whatIf.subtitle', 'Replay a real drive under different conditions')}
      query={[drivesQuery, driveQuery, telemetryQuery]}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <VehicleSelect />
          {driveOptions.length > 0 && (
            <Select
              aria-label={t('whatIf.pickDrive', 'Choose a drive')}
              value={activeId}
              onChange={(e) => setSelectedId(e.target.value)}
              options={driveOptions}
            />
          )}
        </div>
      }
    >
      {drivesQuery.isError ? (
        <GlassPanel className="p-4 sm:p-5">
          <QueryError error={drivesQuery.error} onRetry={() => drivesQuery.refetch()} />
        </GlassPanel>
      ) : loading ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} height={96} className="rounded-xl" />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Skeleton height={340} className="rounded-xl xl:col-span-1" />
            <Skeleton height={340} className="rounded-xl xl:col-span-2" />
          </div>
        </>
      ) : !activeId ? (
        <GlassPanel className="p-4 sm:p-5">
          <EmptyState
            icon={<FlaskConical className="h-8 w-8" />}
            message={t('whatIf.noDrives', 'No drives found for this vehicle yet.')}
            actionTo={{ label: t('whatIf.browseDrives', 'Browse drives'), to: '/drives' }}
          />
        </GlassPanel>
      ) : !result.ok ? (
        <GlassPanel className="p-4 sm:p-5">
          <EmptyState /* no-action: nothing the user can do — this drive was imported without energy counters. The drive picker above is the recovery surface. */
            icon={<FlaskConical className="h-8 w-8" />}
            message={t('whatIf.noEnergy', 'This drive lacks the energy data needed to simulate.')}
          />
        </GlassPanel>
      ) : (
        <>
          {/* 1 — KPI band: the simulated outcome at a glance */}
          <FadeIn>
            <section
              aria-label={t('whatIf.kpis', 'Simulated drive outcome')}
              className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4"
            >
              <MetricCard
                label={t('whatIf.energy', 'Energy used')}
                value={kwh(result.scenario.total)}
                subtitle={`${t('whatIf.was', 'was')} ${kwh(result.baseline.total)}`}
                icon={<Zap className="h-5 w-5" />}
                color={saves ? 'green' : 'amber'}
              />
              <MetricCard
                label={t('whatIf.arrival', 'Arrival battery')}
                value={result.scenarioArrivalSoc != null ? `${Math.round(result.scenarioArrivalSoc)}%` : '—'}
                subtitle={
                  socDelta != null
                    ? `${socDelta >= 0 ? '+' : '−'}${Math.abs(socDelta).toFixed(1)}%`
                    : undefined
                }
                icon={<BatteryCharging className="h-5 w-5" />}
                color="cyan"
              />
              <MetricCard
                label={t('whatIf.duration', 'Duration')}
                value={formatDuration(result.scenarioDurationS, { precision: 0 })}
                subtitle={
                  baselineDurationS != null
                    ? `${t('whatIf.was', 'was')} ${formatDuration(baselineDurationS, { precision: 0 })}`
                    : undefined
                }
                icon={<Timer className="h-5 w-5" />}
                color="purple"
              />
            </section>
          </FadeIn>

          {/* 2 — Knobs (1/3) + energy breakdown & takeaway (2/3) */}
          <FadeIn delay={0.1}>
            <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
              <GlassPanel className="p-4 sm:p-5 xl:col-span-1">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <PanelTitle className="flex items-center gap-2">
                    <Gauge className="h-4 w-4 text-cyan-300" aria-hidden="true" />
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
                    formatValue={(v) => `${Math.round(v * 100)}%`}
                    onChange={(v) => setKnobs((k) => ({ ...k, speedFactor: v }))}
                  />

                  <div>
                    <Text variant="label" as="span" className="mb-1.5 block">
                      {t('whatIf.tires', 'Tire pressure')}
                    </Text>
                    <Select
                      aria-label={t('whatIf.tires', 'Tire pressure')}
                      value={knobs.tires}
                      onChange={(e) => setKnobs((k) => ({ ...k, tires: e.target.value as TirePreset }))}
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
                    formatValue={(v) => formatTemperature(v, { precision: 0 })}
                    onChange={(v) => setKnobs((k) => ({ ...k, ambientC: v }))}
                  />
                </div>
              </GlassPanel>

              <div className="flex flex-col gap-4 xl:col-span-2">
                <GlassPanel className="p-4 sm:p-5">
                  <PanelTitle className="mb-3 flex items-center gap-2">
                    <Wind className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                    {t('whatIf.breakdown', 'Energy breakdown')}
                  </PanelTitle>

                  <div className="space-y-4">
                    <BreakdownRow
                      caption={t('whatIf.baseline', 'Actual drive')}
                      breakdown={result.baseline}
                      max={maxTotal}
                      labels={componentLabels}
                      formatWh={kwh}
                    />
                    <BreakdownRow
                      caption={t('whatIf.scenario', 'What-if')}
                      breakdown={result.scenario}
                      max={maxTotal}
                      labels={componentLabels}
                      formatWh={kwh}
                    />
                  </div>

                  <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-[var(--border-subtle)] pt-3">
                    {COMPONENTS.map((c) => (
                      <li key={c.key} className="flex items-center gap-1.5">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: c.color }}
                          aria-hidden="true"
                        />
                        <Text variant="caption">{componentLabels[c.key]}</Text>
                        <Text variant="caption" className="font-mono tabular-nums">
                          {kwh(result.scenario[c.key])}
                        </Text>
                      </li>
                    ))}
                  </ul>
                </GlassPanel>

                <GlassPanel className="flex items-center gap-3 p-4 sm:p-5">
                  {saves ? (
                    <TrendingDown className="h-5 w-5 shrink-0 text-emerald-300" aria-hidden="true" />
                  ) : (
                    <TrendingUp className="h-5 w-5 shrink-0 text-rose-300" aria-hidden="true" />
                  )}
                  <Text variant="bodySm" className="flex-1">
                    {saves
                      ? t('whatIf.takeawaySave', 'This would save {{wh}} — arriving with {{soc}} more battery.', {
                          wh: kwh(Math.abs(result.energyDeltaWh)),
                          soc: socDelta != null ? `${Math.abs(socDelta).toFixed(1)}%` : '—',
                        })
                      : t('whatIf.takeawayCost', 'This would cost an extra {{wh}} — arriving with {{soc}} less battery.', {
                          wh: kwh(result.energyDeltaWh),
                          soc: socDelta != null ? `${Math.abs(socDelta).toFixed(1)}%` : '—',
                        })}
                  </Text>
                  <Badge variant={saves ? 'success' : 'warning'}>
                    {saves ? '−' : '+'}
                    {kwh(Math.abs(result.energyDeltaWh))}
                  </Badge>
                </GlassPanel>
              </div>
            </section>
          </FadeIn>
        </>
      )}
    </PageContainer>
  );
}
