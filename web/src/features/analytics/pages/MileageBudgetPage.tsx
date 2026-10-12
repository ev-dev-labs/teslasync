import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PageLayout, LayoutCard, ChartCard } from '@/components/layout';
import { Input, HelpTooltip } from '@/components/ui';

import { MetricBar } from '@/components/data-display';
import { AlertBanner, StaleRefreshWarning } from '@/components/feedback';
import { deriveDataState } from '@/api/dataState';
import { FadeIn } from '@/components/motion';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';
import {
  ChartLegend, ChartTooltip,
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
import { getChartFontFamily, getChartFontSize } from '@/lib/chartTypography';
import { chartTokens } from '@/lib/tokens';
import type { Drive } from '@/types/driving';

import { computeMileageBudget } from '../lib/mileageBudget';
import { useMileageBudget } from '../hooks/useMileageBudget';
import { MileageBudgetBrief as MileageBudgetSummary } from '../components/operationalbrief-a-m/MileageBudgetBrief';

/** km per statute mile, derived from the shared conversion lib. */
const KM_PER_MILE = convertDistanceToSI(1, 'mi') / 1000;
const HISTORY_LIMIT = 1_000;

interface NumericDraft {
  saved: number;
  unit: string;
  text: string;
}

export default function MileageBudgetPage() {
  const { t } = useTranslation();
  usePageTitle(t('mileageBudget.title', 'Mileage budget'));

  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;

  const { formatDistance, unitPrefs } = useUnits();
  const { formatCurrency } = useFormatting();
  const { config, update } = useMileageBudget();
  const nowMs = Date.now();
  const [allowanceDraft, setAllowanceDraft] = useState<NumericDraft | null>(null);
  const [overageDraft, setOverageDraft] = useState<NumericDraft | null>(null);
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
  const allowanceText = allowanceDraft?.saved === config.annualAllowanceKm &&
    allowanceDraft.unit === unitPrefs.distance ? allowanceDraft.text : String(allowanceDisplay);
  const allowanceInvalid = allowanceText === '' || !Number.isFinite(Number(allowanceText)) || Number(allowanceText) <= 0;
  function handleAllowanceChange(text: string): void {
    const n = Number(text);
    const valid = text !== '' && Number.isFinite(n) && n > 0;
    const saved = valid ? perMile ? n * KM_PER_MILE : n : config.annualAllowanceKm;
    setAllowanceDraft({ saved, unit: unitPrefs.distance, text });
    if (valid) update({ annualAllowanceKm: saved });
  }

  const overageDisplay =
    Math.round((perMile ? config.overagePerKm * KM_PER_MILE : config.overagePerKm) * 10_000) / 10_000;
  const overageText = overageDraft?.saved === config.overagePerKm &&
    overageDraft.unit === unitPrefs.distance ? overageDraft.text : String(overageDisplay);
  const overageInvalid = overageText === '' || !Number.isFinite(Number(overageText)) || Number(overageText) < 0;
  function handleOverageChange(text: string): void {
    const n = Number(text);
    const valid = text !== '' && Number.isFinite(n) && n >= 0;
    const saved = valid ? perMile ? n / KM_PER_MILE : n : config.overagePerKm;
    setOverageDraft({ saved, unit: unitPrefs.distance, text });
    if (valid) update({ overagePerKm: saved });
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
  const hasReturnedDrives = drives.length > 0;
  const chartTick = { fill: 'var(--text-secondary)', fontFamily: getChartFontFamily(), fontSize: getChartFontSize() };
  const paceOver =
    !historyCapped && budget.paceRatio != null && budget.paceRatio > 1;

  if (vehicleId == null) {
    return <NoVehicleSelected pageTitle={t('mileageBudget.title', 'Mileage budget')} />;
  }

  const source = deriveDataState(drivesQuery, { provenance: 'historical' });
  const isLoading = source.status === 'initial';
  const isError = source.fatalError != null;

  return (
    <PageLayout
      title={t('mileageBudget.title', 'Mileage budget')}
      subtitle={t('mileageBudget.subtitle', 'Lease and warranty allowance pacing with overage forecast')}
      query={drivesQuery}
      dataSources={[{ id: 'budget-drives', label: t('dataSources.labels.driveHistory', 'Drive history'), query: drivesQuery }]}
    >
      <StaleRefreshWarning state={source} />
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
        <MileageBudgetSummary
          budget={budget}
          source={source}
          formatDistance={formatDistance}
          formatCurrency={formatCurrency}
          period={{
            kind: 'event',
            eventId: `mileage-budget:${config.termStartIso}`,
            start: config.termStartIso,
            end: Number.isFinite(budget.termEndMs) ? new Date(budget.termEndMs).toISOString() : null,
            provenance: t('mileageBudget.termProvenance', 'Configured term; observed drive-history coverage may be incomplete.'),
            label: t('mileageBudget.termPeriod', 'Term starting {{start}} · {{months}} months', { start: config.termStartIso, months: config.termMonths }),
          }}
        />
      </FadeIn>

      {/* 2 — Terms (1/3) + cumulative chart (2/3) */}
      <FadeIn delay={0.1}>
        <section className="grid grid-cols-1 gap-4 @5xl:grid-cols-3">
          <LayoutCard title={t('mileageBudget.terms', 'Allowance terms')} actions={
              <HelpTooltip
                size="sm"
                i18nKey="help.mileageBudget.body"
                defaultValue="Enter your lease or warranty terms: yearly distance allowance, term start and length, and the per-distance overage fee. The projection extrapolates your average daily driving linearly to the end of the term."
                ariaLabel={t('help.mileageBudget.iconLabel', 'More info about allowance terms')}
              />
          }>

            <div className="flex flex-col gap-4">
              <Input
                className="min-h-11 md:min-h-10"
                type="number"
                inputMode="numeric"
                min={1}
                step={500}
                label={t('mileageBudget.allowancePerYear', 'Allowance per year')}
                value={allowanceText}
                error={allowanceInvalid ? t('common.invalidNumber', 'Enter a valid number') : undefined}
                onChange={(e) => handleAllowanceChange(e.target.value)}
                suffix={<span className="whitespace-nowrap">{distUnitLabel}</span>}
              />
              <Input
                className="min-h-11 md:min-h-10"
                type="date"
                label={t('mileageBudget.termStart', 'Term start')}
                value={config.termStartIso}
                onChange={(e) => e.target.value && update({ termStartIso: e.target.value })}
              />
              <Input
                className="min-h-11 md:min-h-10"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                label={t('mileageBudget.termMonths', 'Term length (months)')}
                value={config.termMonths}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isInteger(n) && n >= 1) update({ termMonths: n });
                }}
              />
              <Input
                className="min-h-11 md:min-h-10"
                type="number"
                inputMode="decimal"
                min={0}
                step={0.01}
                label={t('mileageBudget.overageRate', 'Overage fee')}
                value={overageText}
                error={overageInvalid ? t('common.invalidNumber', 'Enter a valid number') : undefined}
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
                  fill="solid"
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
                    value={source.hasData && hasReturnedDrives ? budget.usedM : null}
                    max={Math.max(budget.totalAllowanceM, 1)}
                    fill="solid"
                    color={paceOver ? chartTokens.series[3] : chartTokens.series[1]}
                    sublabel={source.hasData && hasReturnedDrives ? formatDistance(budget.usedM) : '—'}
                  />
                </div>
              </div>
            </div>
          </LayoutCard>

          <div className="min-w-0 @5xl:col-span-2">
          <ChartCard
            title={
              historyCapped
                ? t(
                    'mileageBudget.chartObserved',
                    'Observed distance vs allowance',
                  )
                : t('mileageBudget.chart', 'Distance vs allowance')
            }
            ariaLabel={`${historyCapped
                ? t(
                    'mileageBudget.chartObservedAria',
                    'Cumulative distance in the capped returned history against the pro-rata allowance, by month',
                  )
                : t(
                    'mileageBudget.chartAria',
                    'Cumulative driven distance against the pro-rata allowance, by month',
                  )} (${distUnitLabel})`}
            metadata={{ unitLabel: distUnitLabel }}
            loading={isLoading}
            error={source.fatalError}
            onRetry={source.retry ?? undefined}
            empty={!hasReturnedDrives || chartData.length < 2}
            emptyMessage={t('common.noDataForPeriod', 'No data available for this period')}
            height={340}
            size="standard"
            exportable
            data={chartData}
            dataColumns={[
              { key: 'month', label: t('mileageBudget.col.month', 'Month') },
              {
                key: 'used',
                label: `${historyCapped
                  ? t('mileageBudget.col.observedUsed', 'Observed driven')
                  : t('mileageBudget.col.used', 'Driven')} (${distUnitLabel})`,
              },
              { key: 'allowed', label: `${t('mileageBudget.col.allowed', 'Allowed')} (${distUnitLabel})` },
            ]}
            chartKey="mileage-budget"
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                <XAxis dataKey="month" tick={chartTick} />
                <YAxis tick={chartTick} unit={` ${distUnitLabel}`} />
                <Tooltip content={<ChartTooltip />} />
                <ChartLegend state={mileageHidden} />
                <Area
                  type="monotone"
                  dataKey="used"
                  name={t('mileageBudget.driven', 'Driven')}
                  unit={distUnitLabel}
                  stroke={chartTokens.series[0]}
                  fill={chartTokens.series[0]}
                  fillOpacity={0.08}
                  strokeWidth={2}
                  hide={mileageHidden.isHidden('used')}
                />
                <Line
                  type="monotone"
                  dataKey="allowed"
                  name={t('mileageBudget.allowed', 'Allowed')}
                  unit={distUnitLabel}
                  stroke={chartTokens.series[2]}
                  strokeWidth={1}
                  strokeDasharray="6 4"
                  dot={false}
                  hide={mileageHidden.isHidden('allowed')}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </ChartCard>
          </div>
        </section>
      </FadeIn>
    </PageLayout>
  );
}
