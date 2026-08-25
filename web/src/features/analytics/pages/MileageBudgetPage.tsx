import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Route, Gauge, TrendingUp, Wallet, SlidersHorizontal } from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, PanelTitle, Input, HelpTooltip } from '@/components/ui';
import { VehicleSelect } from '@/components/forms';
import { MetricCard, MetricBar } from '@/components/data-display';
import { AlertBanner, Skeleton, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import {
  ChartContainer, ChartLegend, ChartTooltip,
  ComposedChart, Line, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from '@/components/charts';

import { useDriveHistory } from '@/api/hooks/useDriving';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { useFormatting } from '@/hooks/useFormatting';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useHiddenSeries } from '@/hooks/useHiddenSeries';
import { convertDistanceToSI } from '@/lib/unitConversion';
import { chartTokens } from '@/lib/tokens';
import type { Drive } from '@/types/driving';

import { computeMileageBudget } from '../lib/mileageBudget';
import { useMileageBudget } from '../hooks/useMileageBudget';

/** km per statute mile, derived from the shared conversion lib. */
const KM_PER_MILE = convertDistanceToSI(1, 'mi') / 1000;
const HISTORY_LIMIT = 1_000;

export default function MileageBudgetPage() {
  const { t } = useTranslation();
  usePageTitle(t('mileageBudget.title', 'Mileage Budget'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;

  const { formatDistance, unitPrefs } = useUnits();
  const { formatCurrency } = useFormatting();
  const { config, update } = useMileageBudget();
  const [nowMs] = useState(() => Date.now());
  const mileageHidden = useHiddenSeries('mileage-budget');

  const drivesQuery = useDriveHistory(vehicleIdStr, HISTORY_LIMIT);
  const drives = useMemo<Drive[]>(() => drivesQuery.data ?? [], [drivesQuery.data]);

  const budget = useMemo(
    () => computeMileageBudget(drives, config, nowMs, HISTORY_LIMIT),
    [drives, config, nowMs],
  );

  const perMile = unitPrefs.distance === 'mi';
  const distUnitLabel = perMile ? t('mileageBudget.mi', 'mi') : t('mileageBudget.km', 'km');

  // Allowance is stored in km; edit in the user's display unit.
  const allowanceDisplay = Math.round(
    perMile ? config.annualAllowanceKm / KM_PER_MILE : config.annualAllowanceKm,
  );
  function handleAllowanceChange(text: string): void {
    if (text === '') return;
    const n = Number(text);
    if (!Number.isFinite(n) || n <= 0) return;
    update({ annualAllowanceKm: perMile ? n * KM_PER_MILE : n });
  }

  const overageDisplay =
    Math.round((perMile ? config.overagePerKm * KM_PER_MILE : config.overagePerKm) * 10_000) / 10_000;
  function handleOverageChange(text: string): void {
    if (text === '') return;
    const n = Number(text);
    if (!Number.isFinite(n) || n < 0) return;
    update({ overagePerKm: perMile ? n / KM_PER_MILE : n });
  }

  // Chart series in the user's display unit.
  const chartData = useMemo(
    () =>
      budget.monthly.map((m) => ({
        month: m.month,
        used: Math.round(perMile ? m.usedKm / KM_PER_MILE : m.usedKm),
        allowed: Math.round(perMile ? m.allowedKm / KM_PER_MILE : m.allowedKm),
      })),
    [budget.monthly, perMile],
  );

  const historyCapped = budget.historyCapReached;
  const paceOver =
    !historyCapped && budget.paceRatio != null && budget.paceRatio > 1;

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('mileageBudget.title', 'Mileage Budget')} />;
  }

  const isLoading = drivesQuery.isLoading;
  const isError = drivesQuery.isError;

  return (
    <PageContainer
      title={t('mileageBudget.title', 'Mileage Budget')}
      subtitle={t('mileageBudget.subtitle', 'Lease and warranty allowance pacing with overage forecast')}
      query={drivesQuery}
      actions={<VehicleSelect />}
    >
      {!isLoading && !isError && historyCapped ? (
        <AlertBanner
          variant="warning"
          title={t(
            'mileageBudget.cap.title',
            'History window reached its row cap',
          )}
        >
          {t(
            'mileageBudget.cap.body',
            'The request returned {{limit}} drives. Older term drives may be absent, so pace, term-total, and overage projections are withheld until the selected history is complete.',
            { limit: HISTORY_LIMIT },
          )}
        </AlertBanner>
      ) : null}

      {/* 1 — KPI band */}
      <FadeIn>
        <section
          aria-label={t('mileageBudget.kpis', 'Mileage budget summary metrics')}
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
                label={
                  historyCapped
                    ? t(
                        'mileageBudget.usedObserved',
                        'Observed in Returned Window',
                      )
                    : t('mileageBudget.used', 'Driven This Term')
                }
                value={formatDistance(budget.usedM, { precision: 0 })}
                subtitle={
                  historyCapped
                    ? t(
                        'mileageBudget.cap.observed',
                        'At least this much is present; older term drives may be absent',
                      )
                    : t(
                        'mileageBudget.allowedToDate',
                        'allowed so far: {{allowed}}',
                        {
                          allowed: formatDistance(
                            budget.allowedToDateM,
                            { precision: 0 },
                          ),
                        },
                      )
                }
                icon={<Route className="h-5 w-5" />}
                color="cyan"
              />
              <MetricCard
                label={t('mileageBudget.pace', 'Pace')}
                value={
                  !historyCapped && budget.paceRatio != null
                    ? `${Math.round(budget.paceRatio * 100)}%`
                    : '—'
                }
                subtitle={
                  historyCapped
                    ? t(
                        'mileageBudget.cap.unavailable',
                        'unavailable while history is capped',
                      )
                    : paceOver
                    ? t('mileageBudget.overPace', 'over budget pace')
                    : t('mileageBudget.underPace', 'within budget pace')
                }
                icon={<Gauge className="h-5 w-5" />}
                color={historyCapped ? 'cyan' : paceOver ? 'red' : 'green'}
              />
              <MetricCard
                label={t('mileageBudget.projected', 'Projected Term Total')}
                value={
                  !historyCapped && budget.projectedTotalM != null
                    ? formatDistance(budget.projectedTotalM, { precision: 0 })
                    : '—'
                }
                subtitle={
                  historyCapped
                    ? t(
                        'mileageBudget.cap.unavailable',
                        'unavailable while history is capped',
                      )
                    : t(
                        'mileageBudget.ofAllowance',
                        'allowance: {{total}}',
                        {
                          total: formatDistance(budget.totalAllowanceM, {
                            precision: 0,
                          }),
                        },
                      )
                }
                icon={<TrendingUp className="h-5 w-5" />}
                color="purple"
              />
              <MetricCard
                label={t('mileageBudget.overageCost', 'Projected Overage')}
                value={
                  historyCapped
                    ? '—'
                    : budget.projectedOverageM > 0
                      ? formatCurrency(budget.projectedOverageCost)
                      : formatCurrency(0)
                }
                subtitle={
                  historyCapped
                    ? t(
                        'mileageBudget.cap.unavailable',
                        'unavailable while history is capped',
                      )
                    : budget.projectedOverageM > 0
                    ? formatDistance(budget.projectedOverageM, { precision: 0 })
                    : t('mileageBudget.noOverage', 'no overage projected')
                }
                icon={<Wallet className="h-5 w-5" />}
                color={
                  historyCapped
                    ? 'cyan'
                    : budget.projectedOverageM > 0
                      ? 'amber'
                      : 'green'
                }
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 2 — Terms (1/3) + cumulative chart (2/3) */}
      <FadeIn delay={0.1}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          <GlassPanel className="p-4 sm:p-5 xl:col-span-1">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('mileageBudget.terms', 'Allowance Terms')}
              <HelpTooltip
                size="sm"
                i18nKey="help.mileageBudget.body"
                defaultValue="Enter your lease or warranty terms: yearly distance allowance, term start and length, and the per-distance overage fee. The projection extrapolates your average daily driving linearly to the end of the term."
                ariaLabel={t('help.mileageBudget.iconLabel', 'More info about allowance terms')}
              />
            </PanelTitle>

            <div className="flex flex-col gap-4">
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                step={500}
                label={t('mileageBudget.allowancePerYear', 'Allowance per year')}
                key={`allowance-${unitPrefs.distance}`}
                defaultValue={allowanceDisplay}
                onChange={(e) => handleAllowanceChange(e.target.value)}
                suffix={<span className="whitespace-nowrap">{distUnitLabel}</span>}
              />
              <Input
                type="date"
                label={t('mileageBudget.termStart', 'Term start')}
                value={config.termStartIso}
                onChange={(e) => e.target.value && update({ termStartIso: e.target.value })}
              />
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={120}
                step={1}
                label={t('mileageBudget.termMonths', 'Term length (months)')}
                value={config.termMonths}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isInteger(n) && n >= 1) update({ termMonths: n });
                }}
              />
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                step={0.01}
                label={t('mileageBudget.overageRate', 'Overage fee')}
                key={`overage-${unitPrefs.distance}`}
                defaultValue={overageDisplay}
                onChange={(e) => handleOverageChange(e.target.value)}
                suffix={
                  <span className="whitespace-nowrap">
                    {perMile ? t('mileageBudget.perMi', '/ mi') : t('mileageBudget.perKm', '/ km')}
                  </span>
                }
              />

              <div className="border-t border-[var(--border-subtle)] pt-4">
                <MetricBar
                  label={t('mileageBudget.termProgress', 'Term elapsed')}
                  value={budget.elapsedDays}
                  max={budget.totalDays}
                  color={chartTokens.series[0]}
                  sublabel={t('mileageBudget.daysLeft', '{{days}} days left', { days: budget.remainingDays })}
                />
                <div className="mt-3">
                  <MetricBar
                      label={
                        historyCapped
                          ? t(
                              'mileageBudget.allowanceUsedObserved',
                              'Observed allowance usage',
                            )
                          : t(
                              'mileageBudget.allowanceUsed',
                              'Allowance used',
                            )
                      }
                    value={budget.usedM}
                    max={Math.max(budget.totalAllowanceM, 1)}
                    color={paceOver ? chartTokens.series[3] : chartTokens.series[1]}
                    sublabel={formatDistance(budget.usedM, { precision: 0 })}
                  />
                </div>
              </div>
            </div>
          </GlassPanel>

          <ChartContainer
            className="xl:col-span-2"
            title={
              historyCapped
                ? t(
                    'mileageBudget.chartObserved',
                    'Observed Distance vs Allowance',
                  )
                : t('mileageBudget.chart', 'Distance vs Allowance')
            }
            ariaLabel={
              historyCapped
                ? t(
                    'mileageBudget.chartObservedAria',
                    'Cumulative distance in the capped returned history against the pro-rata allowance, by month',
                  )
                : t(
                    'mileageBudget.chart.aria',
                    'Cumulative driven distance against the pro-rata allowance, by month',
                  )
            }
            loading={isLoading}
            empty={chartData.length < 2}
            height={340}
            data={chartData}
            dataColumns={[
              { key: 'month', label: t('mileageBudget.col.month', 'Month') },
              {
                key: 'used',
                label: historyCapped
                  ? t('mileageBudget.col.observedUsed', 'Observed driven')
                  : t('mileageBudget.col.used', 'Driven'),
              },
              { key: 'allowed', label: t('mileageBudget.col.allowed', 'Allowed') },
            ]}
            chartKey="mileage-budget"
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis dataKey="month" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} />
                <Tooltip content={<ChartTooltip />} />
                <ChartLegend state={mileageHidden} />
                <Area
                  type="monotone"
                  dataKey="used"
                  name={t('mileageBudget.driven', 'Driven')}
                  stroke={chartTokens.series[0]}
                  fill={chartTokens.series[0]}
                  fillOpacity={0.15}
                  strokeWidth={2}
                  hide={mileageHidden.isHidden('used')}
                />
                <Line
                  type="monotone"
                  dataKey="allowed"
                  name={t('mileageBudget.allowed', 'Allowed')}
                  stroke={chartTokens.series[2]}
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  dot={false}
                  hide={mileageHidden.isHidden('allowed')}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartContainer>
        </section>
      </FadeIn>
    </PageContainer>
  );
}
