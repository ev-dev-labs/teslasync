import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BatteryWarning, Bug, Scale, Sigma } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, PanelTitle, Text, Badge, HelpTooltip } from '@/components/ui';
import { VehicleSelect } from '@/components/forms';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import {
  ChartContainer, ChartTooltip, ChartLegend,
  ComposedChart, Bar, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from '@/components/charts';

import { useChargingSessions } from '@/api/hooks/useCharging';
import { useDrives } from '@/api/hooks/useDriving';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useHiddenSeries } from '@/hooks/useHiddenSeries';
import { chartTokens } from '@/lib/tokens';

import { buildEnergyLedger } from '../lib/energyLedger';

export default function EnergyLedgerPage() {
  const { t } = useTranslation();
  usePageTitle(t('energyLedger.title', 'Energy Ledger'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;
  const { formatEnergy, formatPower, formatDistance } = useUnits();
  const ledgerHidden = useHiddenSeries('energy-ledger-monthly');

  const sessionsQuery = useChargingSessions(vehicleIdStr);
  const drivesQuery = useDrives(vehicleIdStr);

  const summary = useMemo(
    () => buildEnergyLedger(sessionsQuery.data ?? [], drivesQuery.data ?? []),
    [sessionsQuery.data, drivesQuery.data],
  );

  const chartData = useMemo(
    () =>
      summary.months.map((m) => ({
        month: m.month,
        charged: Math.round(m.chargedWh / 100) / 10,
        driven: -Math.round(m.drivenWh / 100) / 10,
        standby: -Math.round(m.standbyWh / 100) / 10,
        stored: Math.round(m.storedDeltaWh / 100) / 10,
        residual: Math.round(m.residualWh / 100) / 10,
      })),
    [summary.months],
  );

  const worstMonth = useMemo(
    () =>
      summary.months.reduce<(typeof summary.months)[number] | null>(
        (worst, m) => (worst == null || m.closureRate < worst.closureRate ? m : worst),
        null,
      ),
    [summary.months],
  );

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('energyLedger.title', 'Energy Ledger')} />;
  }

  const isLoading = sessionsQuery.isLoading || drivesQuery.isLoading;
  const isError = sessionsQuery.isError || drivesQuery.isError;
  const error = sessionsQuery.error ?? drivesQuery.error;

  return (
    <PageContainer
      title={t('energyLedger.title', 'Energy Ledger')}
      subtitle={t(
        'energyLedger.subtitle',
        'Double-entry accounting for electrons: every kilowatt-hour charged is matched against driving, standing still and the change in what is stored',
      )}
      query={[sessionsQuery, drivesQuery]}
      actions={<VehicleSelect />}
    >
      {/* 1 — KPI band */}
      <FadeIn>
        <section
          aria-label={t('energyLedger.kpis', 'Energy ledger metrics')}
          className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4"
        >
          {isError ? (
            <GlassPanel className="col-span-full p-4 sm:p-5">
              <QueryError
                error={error}
                onRetry={() => {
                  void sessionsQuery.refetch();
                  void drivesQuery.refetch();
                }}
              />
            </GlassPanel>
          ) : isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height={96} className="rounded-xl" />
            ))
          ) : (
            <>
              <MetricCard
                label={t('energyLedger.closure', 'Books Closure')}
                value={`${Math.round(summary.closureRate * 100)}%`}
                subtitle={t('energyLedger.closureHint', 'of charged energy accounted for')}
                icon={<Scale className="h-5 w-5" />}
                color={
                  summary.closureRate >= 0.9 ? 'green' : summary.closureRate >= 0.75 ? 'amber' : 'red'
                }
                help={{
                  i18nKey: 'help.energyLedger.closure',
                  defaultValue:
                    'Energy has to go somewhere. Everything charged either reached the wheels, was lost while standing still, or is still sitting in the pack — so charged minus driven minus standby minus the change in stored energy should come out near zero. Whatever is left over is the ledger residual, and it is the honest measure of how much your data is failing to explain.',
                }}
              />
              <MetricCard
                label={t('energyLedger.driving', 'Reached the Wheels')}
                value={`${Math.round(summary.drivingShare * 100)}%`}
                subtitle={formatEnergy(summary.totalDrivenWh, { precision: 0 })}
                icon={<Sigma className="h-5 w-5" />}
                color="cyan"
              />
              <MetricCard
                label={t('energyLedger.vampire', 'Vampire Drain')}
                value={`${Math.round(summary.vampireWhPerDay)} Wh/day`}
                subtitle={t('energyLedger.standbyPower', 'about {{p}} while parked', {
                  p: formatPower(summary.meanStandbyPowerW, { precision: 0 }),
                })}
                icon={<BatteryWarning className="h-5 w-5" />}
                color={summary.vampireWhPerDay > 1000 ? 'red' : 'purple'}
              />
              <MetricCard
                label={t('energyLedger.unexplained', 'Unexplained')}
                value={formatEnergy(Math.abs(summary.totalResidualWh), { precision: 0 })}
                subtitle={
                  summary.packCapacityWh != null
                    ? t('energyLedger.derivedPack', 'derived pack {{v}}', {
                        v: formatEnergy(summary.packCapacityWh, { precision: 0 }),
                      })
                    : t('energyLedger.noPack', 'pack size not yet derivable')
                }
                icon={<Bug className="h-5 w-5" />}
                color="blue"
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 2 — Monthly ledger */}
      <FadeIn delay={0.1}>
        {!isLoading && !isError && summary.months.length === 0 ? (
          <GlassPanel className="p-4 sm:p-5">
            <EmptyState /* no-action: the ledger fills in as charge sessions and drives are recorded. */
              icon={<Scale className="h-8 w-8" />}
              message={t(
                'energyLedger.noData',
                'Nothing to balance yet. The ledger needs both charge sessions and drives in the same month.',
              )}
            />
          </GlassPanel>
        ) : (
          <ChartContainer
            title={t('energyLedger.chart', 'Monthly Balance')}
            subtitle={t(
              'energyLedger.chartHint',
              'Charging above the line, consumption below; the line is what could not be explained',
            )}
            ariaLabel={t(
              'energyLedger.chart.aria',
              'Stacked bar chart of monthly energy charged against energy driven and lost to standby, with the unexplained residual overlaid',
            )}
            chartKey="energy-ledger-monthly"
            loading={isLoading}
            empty={chartData.length === 0}
            height={380}
            data={chartData}
            dataColumns={[
              { key: 'month', label: t('energyLedger.col.month', 'Month') },
              { key: 'charged', label: t('energyLedger.col.charged', 'Charged (kWh)') },
              { key: 'driven', label: t('energyLedger.col.driven', 'Driven (kWh)') },
              { key: 'standby', label: t('energyLedger.col.standby', 'Standby (kWh)') },
              { key: 'stored', label: t('energyLedger.col.stored', 'Δ stored (kWh)') },
              { key: 'residual', label: t('energyLedger.col.residual', 'Residual (kWh)') },
            ]}
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 16, right: 16, bottom: 24, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis dataKey="month" tick={{ fill: 'var(--text-muted)', fontSize: 10 }} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} unit=" kWh" />
                <Tooltip content={<ChartTooltip />} />
                <ChartLegend state={ledgerHidden} />
                <ReferenceLine y={0} stroke="var(--text-muted)" />
                <Bar
                  dataKey="charged"
                  name={t('energyLedger.col.charged', 'Charged (kWh)')}
                  stackId="in"
                  fill={chartTokens.series[2]}
                  radius={[3, 3, 0, 0]}
                  hide={ledgerHidden.isHidden('charged')}
                />
                <Bar
                  dataKey="driven"
                  name={t('energyLedger.col.driven', 'Driven (kWh)')}
                  stackId="out"
                  fill={chartTokens.series[0]}
                  hide={ledgerHidden.isHidden('driven')}
                />
                <Bar
                  dataKey="standby"
                  name={t('energyLedger.col.standby', 'Standby (kWh)')}
                  stackId="out"
                  fill={chartTokens.series[3]}
                  hide={ledgerHidden.isHidden('standby')}
                />
                <Line
                  type="monotone"
                  dataKey="residual"
                  name={t('energyLedger.col.residual', 'Residual (kWh)')}
                  stroke={chartTokens.series[5]}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  hide={ledgerHidden.isHidden('residual')}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartContainer>
        )}
      </FadeIn>

      {/* 3 — Month detail */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <Sigma className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('energyLedger.detail', 'Month by Month')}
            <HelpTooltip
              size="sm"
              i18nKey="help.energyLedger.detail"
              defaultValue="Standby loss cannot be measured directly, so it is reconstructed from state of charge: the drop between parking and the next event, converted to energy using a pack capacity derived from your own wide charge sessions rather than a spec-sheet figure. Gaps longer than a fortnight are treated as data outages instead of extraordinary vampire drain."
              ariaLabel={t('help.energyLedger.iconLabel', 'More info about the ledger method')}
            />
          </PanelTitle>
          {isLoading ? (
            <Skeleton height={180} />
          ) : summary.months.length === 0 ? (
            <EmptyState /* no-action: months appear as charge and drive history accumulates. */
              icon={<Bug className="h-8 w-8" />}
              message={t('energyLedger.noMonths', 'No complete month has been recorded yet.')}
            />
          ) : (
            <ul className="grid gap-3 lg:grid-cols-2">
              {summary.months.map((m) => (
                <li
                  key={m.month}
                  className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-3"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Text variant="body" className="font-medium">{m.month}</Text>
                    <Badge
                      variant={
                        m.closureRate >= 0.9
                          ? 'success'
                          : m.closureRate >= 0.75
                            ? 'warning'
                            : 'danger'
                      }
                    >
                      {t('energyLedger.closed', '{{pct}}% closed', {
                        pct: Math.round(m.closureRate * 100),
                      })}
                    </Badge>
                    {worstMonth != null && worstMonth.month === m.month && summary.months.length > 1 ? (
                      <Badge variant="neutral" size="sm">
                        {t('energyLedger.worst', 'Weakest month')}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                    <Text variant="caption">
                      {t('energyLedger.charged', 'Charged')}
                    </Text>
                    <Text variant="bodySm">
                      {t('energyLedger.chargedValue', '{{e}} · {{n}} sessions', {
                        e: formatEnergy(m.chargedWh, { precision: 0 }),
                        n: m.chargeSessions,
                      })}
                    </Text>
                    <Text variant="caption">
                      {t('energyLedger.driven', 'Driven')}
                    </Text>
                    <Text variant="bodySm">
                      {t('energyLedger.drivenValue', '{{e}} · {{d}}', {
                        e: formatEnergy(m.drivenWh, { precision: 0 }),
                        d: formatDistance(m.distanceM, { precision: 0 }),
                      })}
                    </Text>
                    <Text variant="caption">
                      {t('energyLedger.standby', 'Standby')}
                    </Text>
                    <Text variant="bodySm">
                      {t('energyLedger.standbyValue', '{{e}} over {{h}} h', {
                        e: formatEnergy(m.standbyWh, { precision: 0 }),
                        h: Math.round(m.idleHours),
                      })}
                    </Text>
                    <Text variant="caption">
                      {t('energyLedger.residual', 'Residual')}
                    </Text>
                    <Text variant="bodySm">
                      {`${m.residualWh >= 0 ? '+' : '−'}${formatEnergy(Math.abs(m.residualWh), {
                        precision: 0,
                      })}`}
                    </Text>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
