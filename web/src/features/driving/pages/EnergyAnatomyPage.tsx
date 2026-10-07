import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Wind, Zap, Recycle, Waypoints } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, PanelTitle, Text, HelpTooltip } from '@/components/ui';
import { RangePicker, VehicleSelect } from '@/components/forms';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';

import { useDrives } from '@/api/hooks/useDriving';
import { useRangeState } from '@/hooks/useRangeState';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
import { chartTokens } from '@/lib/tokens';
import type { Drive } from '@/types/driving';

import { computeAnatomy, layoutSankey, type SankeyFlow } from '../lib/energyAnatomy';

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

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('energyAnatomy.title', 'Energy Anatomy')} />;
  }

  const isLoading = drivesQuery.isLoading;
  const isError = drivesQuery.isError;

  return (
    <PageContainer
      title={t('energyAnatomy.title', 'Energy Anatomy')}
      subtitle={t('energyAnatomy.subtitle', 'Where a period of traction energy physically went')}
      query={drivesQuery}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          <VehicleSelect />
          <RangePicker
            value={{ start, end }}
            onChange={setRange}
            align="end"
            triggerTestId="energy-anatomy-range"
          />
        </div>
      }
    >
      {/* 1 — KPI band */}
      <FadeIn>
        <section
          aria-label={t('energyAnatomy.kpis', 'Energy anatomy summary metrics')}
          className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"
        >
          {isError ? (
            <GlassPanel className="col-span-full p-4 sm:p-5">
              <QueryError error={drivesQuery.error} onRetry={() => drivesQuery.refetch()} />
            </GlassPanel>
          ) : isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height={96} className="rounded-xl" />
            ))
          ) : (
            <>
              <MetricCard
                label={t('energyAnatomy.total', 'Energy Used')}
                value={formatEnergy(anatomy.totalWh, { precision: 1 })}
                subtitle={t('energyAnatomy.driveCount', '{{count}} drives', { count: anatomy.drives })}
                icon={<Zap className="h-5 w-5" />}
                color="cyan"
              />
              <MetricCard
                label={t('energyAnatomy.biggest', 'Biggest Consumer')}
                value={t(COMPONENT_META[biggest[0]]!.i18nKey, COMPONENT_META[biggest[0]]!.fallback)}
                subtitle={share(biggest[1])}
                icon={<Wind className="h-5 w-5" />}
                color="purple"
              />
              <MetricCard
                label={t('energyAnatomy.climateCard', 'Climate Overhead')}
                value={share(anatomy.climateWh)}
                subtitle={formatEnergy(anatomy.climateWh, { precision: 1 })}
                icon={<Waypoints className="h-5 w-5" />}
                color="amber"
              />
              <MetricCard
                label={t('energyAnatomy.regen', 'Regen Credit')}
                value={formatEnergy(anatomy.regenWh, { precision: 1 })}
                subtitle={
                  anatomy.totalWh > 0
                    ? t('energyAnatomy.regenShare', '{{pct}}% recovered', {
                        pct: Math.round((anatomy.regenWh / anatomy.totalWh) * 100),
                      })
                    : undefined
                }
                icon={<Recycle className="h-5 w-5" />}
                color="green"
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 2 — Sankey */}
      <FadeIn delay={0.1}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <Waypoints className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('energyAnatomy.sankey', 'Energy Flow')}
            <HelpTooltip
              size="sm"
              i18nKey="help.energyAnatomy.body"
              defaultValue="An approximate physical anatomy of your measured consumption: aerodynamic drag grows with speed squared, rolling resistance with distance, and climate load with temperature deviation and time. The measured total is authoritative — physics only apportions it — so treat the split as directional, not laboratory-grade."
              ariaLabel={t('help.energyAnatomy.iconLabel', 'More info about the anatomy model')}
            />
          </PanelTitle>
          {isError ? (
            <QueryError error={drivesQuery.error} onRetry={() => drivesQuery.refetch()} />
          ) : isLoading ? (
            <Skeleton height={300} />
          ) : anatomy.totalWh === 0 ? (
            <EmptyState
              icon={<Waypoints className="h-8 w-8" />}
              message={t('energyAnatomy.noData', 'No drives with energy data in this period.')}
              actionTo={{ label: t('energyAnatomy.browseDrives', 'Browse drives'), to: '/drives' }}
            />
          ) : (
            <div className="overflow-x-auto">
              <svg
                viewBox={`0 0 ${sankey.width + 200} ${sankey.height + 20}`}
                className="min-w-[560px]"
                role="img"
                aria-label={t('energyAnatomy.sankey.aria', 'Sankey diagram splitting {{total}} into aero drag, rolling resistance, climate, and other losses', {
                  total: formatEnergy(anatomy.totalWh, { precision: 1 }),
                })}
              >
                <g transform="translate(90, 10)">
                  {/* ribbons */}
                  {sankey.links.map((link) => (
                    <path
                      key={link.key}
                      d={link.path}
                      fill="none"
                      stroke={COMPONENT_META[link.key]!.color}
                      strokeWidth={link.thickness}
                      strokeOpacity={0.45}
                    />
                  ))}
                  {/* source node */}
                  <rect
                    x={sankey.source.x}
                    y={sankey.source.y}
                    width={sankey.source.width}
                    height={sankey.source.height}
                    rx={3}
                    fill="var(--text-muted)"
                  />
                  <text
                    x={sankey.source.x - 8}
                    y={sankey.source.y + sankey.source.height / 2}
                    textAnchor="end"
                    dominantBaseline="middle"
                    fill="var(--text-primary)"
                    fontSize={12}
                  >
                    {t('energyAnatomy.battery', 'Battery')}
                  </text>
                  {/* target nodes + labels */}
                  {sankey.targets.map((node) => {
                    const meta = COMPONENT_META[node.key]!;
                    const value = flows.find((f) => f.key === node.key)?.value ?? 0;
                    return (
                      <g key={node.key}>
                        <rect x={node.x} y={node.y} width={node.width} height={node.height} rx={3} fill={meta.color} />
                        <text
                          x={node.x + node.width + 8}
                          y={node.y + node.height / 2}
                          dominantBaseline="middle"
                          fill="var(--text-primary)"
                          fontSize={12}
                        >
                          {t(meta.i18nKey, meta.fallback)} · {share(value)}
                        </text>
                      </g>
                    );
                  })}
                </g>
              </svg>
              <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 border-t border-[var(--border-subtle)] pt-3">
                {flows.map((f) => (
                  <li key={f.key} className="flex items-center gap-1.5">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: COMPONENT_META[f.key]!.color }}
                      aria-hidden="true"
                    />
                    <Text variant="caption">{t(COMPONENT_META[f.key]!.i18nKey, COMPONENT_META[f.key]!.fallback)}</Text>
                    <Text variant="caption" className="font-mono tabular-nums">
                      {formatEnergy(f.value, { precision: 1 })}
                    </Text>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
