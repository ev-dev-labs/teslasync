import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlaskConical, Wind, Gauge, RotateCcw, TrendingDown, TrendingUp } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, PanelTitle, Text, Button, Badge, Select, Slider, Toggle } from '@/components/ui';
import { VehicleSelect } from '@/components/forms';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

import { useDrives, useDrive, useDriveTelemetry } from '@/api/hooks/useDriving';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateShort } from '@/lib/dateFormat';
import type { Drive } from '@/types/driving';

import {
  simulateWhatIf,
  DEFAULT_KNOBS,
  type WhatIfKnobs,
  type TirePreset,
  type EnergyBreakdown,
} from '../lib/whatIfModel';

const COMPONENTS: { key: keyof Omit<EnergyBreakdown, 'total'>; label: string; color: string }[] = [
  { key: 'aero', label: 'Aero drag', color: '#38bdf8' },
  { key: 'rolling', label: 'Rolling', color: '#a78bfa' },
  { key: 'elevation', label: 'Elevation', color: '#f59e0b' },
  { key: 'climate', label: 'Climate', color: '#fb7185' },
  { key: 'other', label: 'Other', color: '#64748b' },
];

function kwh(wh: number): string {
  return `${(wh / 1000).toFixed(1)} kWh`;
}

function BreakdownBar({ b, max }: { b: EnergyBreakdown; max: number }) {
  return (
    <div className="flex h-6 w-full overflow-hidden rounded-md bg-white/5" role="img" aria-label={`Energy ${kwh(b.total)}`}>
      {COMPONENTS.map((c) => {
        const pct = max > 0 ? (b[c.key] / max) * 100 : 0;
        return pct > 0.5 ? (
          <div key={c.key} style={{ width: `${pct}%`, background: c.color }} title={`${c.label}: ${kwh(b[c.key])}`} />
        ) : null;
      })}
    </div>
  );
}

export default function WhatIfPage() {
  const { t } = useTranslation();
  usePageTitle(t('whatIf.title', 'What-If Simulator'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;

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
    () => drives.map((d) => ({ value: String(d.id), label: `${formatDateShort(d.startTs)} · ${(d.distanceM / 1000).toFixed(1)} km` })),
    [drives],
  );

  const socDelta =
    result.scenarioArrivalSoc != null && result.baselineArrivalSoc != null
      ? result.scenarioArrivalSoc - result.baselineArrivalSoc
      : null;
  const maxTotal = Math.max(result.baseline.total, result.scenario.total, 1);
  const loading = drivesQuery.isLoading || driveQuery.isLoading || telemetryQuery.isLoading;

  return (
    <PageContainer title={t('whatIf.title', 'What-If Simulator')}>
      <FadeIn>
        <GlassPanel className="mb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <PanelTitle><FlaskConical size={16} className="mr-1 inline text-cyan-400" aria-hidden /> {t('whatIf.heading', 'Rewrite a drive')}</PanelTitle>
              <Text variant="bodySm" className="text-white/60">
                {t('whatIf.blurb', 'Take a real drive and change how it was driven. The engine decomposes the energy you actually used and recomputes it — no guesswork, anchored to your data.')}
              </Text>
            </div>
            <div className="flex items-center gap-2">
              <VehicleSelect />
              {driveOptions.length > 0 && (
                <Select aria-label={t('whatIf.pickDrive', 'Choose a drive')} value={activeId} onChange={(e) => setSelectedId(e.target.value)} options={driveOptions} />
              )}
            </div>
          </div>
        </GlassPanel>
      </FadeIn>

      {drivesQuery.isError ? (
        <QueryError error={drivesQuery.error} onRetry={() => drivesQuery.refetch()} />
      ) : loading ? (
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="h-80 lg:col-span-1" />
          <Skeleton className="h-80 lg:col-span-2" />
        </div>
      ) : !activeId ? (
        <EmptyState message={t('whatIf.noDrives', 'No drives found for this vehicle yet.')} />
      ) : !result.ok ? (
        <EmptyState message={t('whatIf.noEnergy', 'This drive lacks the energy data needed to simulate.')} />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Controls */}
          <FadeIn>
            <GlassPanel className="flex flex-col gap-5">
              <div className="flex items-center justify-between">
                <PanelTitle><Gauge size={16} className="mr-1 inline text-cyan-400" aria-hidden /> {t('whatIf.knobs', 'Knobs')}</PanelTitle>
                <Button variant="ghost" onClick={() => setKnobs(DEFAULT_KNOBS)}>
                  <RotateCcw size={14} aria-hidden /> {t('whatIf.reset', 'Reset')}
                </Button>
              </div>

              <Slider
                label={t('whatIf.speed', 'Average speed: {{pct}}%', { pct: Math.round(knobs.speedFactor * 100) })}
                value={knobs.speedFactor}
                min={0.8}
                max={1.2}
                step={0.05}
                onChange={(v) => setKnobs((k) => ({ ...k, speedFactor: v }))}
              />

              <div>
                <Text variant="bodySm" className="mb-1 text-white/60">{t('whatIf.tires', 'Tire pressure')}</Text>
                <Select
                  aria-label={t('whatIf.tires', 'Tire pressure')}
                  value={knobs.tires}
                  onChange={(e) => setKnobs((k) => ({ ...k, tires: e.target.value as TirePreset }))}
                  options={[
                    { value: 'low', label: t('whatIf.tireLow', 'Under-inflated (−) ') },
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
                label={t('whatIf.ambient', 'Ambient temperature: {{c}}°C', { c: Math.round(knobs.ambientC) })}
                value={knobs.ambientC}
                min={-10}
                max={40}
                step={1}
                onChange={(v) => setKnobs((k) => ({ ...k, ambientC: v }))}
              />
            </GlassPanel>
          </FadeIn>

          {/* Results */}
          <FadeIn className="lg:col-span-2">
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <MetricCard label={t('whatIf.energy', 'Energy used')} value={kwh(result.scenario.total)} subtitle={`${t('whatIf.was', 'was')} ${kwh(result.baseline.total)}`} />
                <MetricCard
                  label={t('whatIf.arrival', 'Arrival battery')}
                  value={result.scenarioArrivalSoc != null ? `${Math.round(result.scenarioArrivalSoc)}%` : '—'}
                  subtitle={socDelta != null ? `${socDelta >= 0 ? '+' : ''}${socDelta.toFixed(1)}%` : undefined}
                />
                <MetricCard
                  label={t('whatIf.duration', 'Duration')}
                  value={`${Math.round(result.scenarioDurationS / 60)} min`}
                  subtitle={`${knobs.speedFactor === 1 ? '' : knobs.speedFactor > 1 ? t('whatIf.faster', 'faster') : t('whatIf.slower', 'slower')}`}
                />
              </div>

              <GlassPanel>
                <PanelTitle><Wind size={16} className="mr-1 inline text-cyan-400" aria-hidden /> {t('whatIf.breakdown', 'Energy breakdown')}</PanelTitle>
                <div className="mt-3 space-y-3">
                  <div>
                    <Text variant="bodySm" className="mb-1 text-white/50">{t('whatIf.baseline', 'Actual drive')} · {kwh(result.baseline.total)}</Text>
                    <BreakdownBar b={result.baseline} max={maxTotal} />
                  </div>
                  <div>
                    <Text variant="bodySm" className="mb-1 text-white/50">{t('whatIf.scenario', 'What-if')} · {kwh(result.scenario.total)}</Text>
                    <BreakdownBar b={result.scenario} max={maxTotal} />
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {COMPONENTS.map((c) => (
                    <span key={c.key} className="flex items-center gap-1 text-xs text-white/60">
                      <span className="h-2 w-2 rounded-full" style={{ background: c.color }} aria-hidden /> {c.label}
                    </span>
                  ))}
                </div>
              </GlassPanel>

              <GlassPanel className="flex items-center gap-3">
                {result.energyDeltaWh <= 0 ? (
                  <TrendingDown className="shrink-0 text-emerald-400" aria-hidden />
                ) : (
                  <TrendingUp className="shrink-0 text-rose-400" aria-hidden />
                )}
                <Text>
                  {result.energyDeltaWh <= 0
                    ? t('whatIf.takeawaySave', 'This would save {{wh}} — arriving with {{soc}} more battery.', {
                        wh: kwh(Math.abs(result.energyDeltaWh)),
                        soc: socDelta != null ? `${Math.abs(socDelta).toFixed(1)}%` : '—',
                      })
                    : t('whatIf.takeawayCost', 'This would cost an extra {{wh}} — arriving with {{soc}} less battery.', {
                        wh: kwh(result.energyDeltaWh),
                        soc: socDelta != null ? `${Math.abs(socDelta).toFixed(1)}%` : '—',
                      })}
                </Text>
                <Badge variant={result.energyDeltaWh <= 0 ? 'success' : 'warning'}>
                  {result.energyDeltaWh <= 0 ? '−' : '+'}
                  {kwh(Math.abs(result.energyDeltaWh))}
                </Badge>
              </GlassPanel>
            </div>
          </FadeIn>
        </div>
      )}
    </PageContainer>
  );
}
