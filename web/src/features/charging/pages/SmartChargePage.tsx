import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Zap,
  Clock,
  CalendarClock,
  CheckCircle2,
} from 'lucide-react';

import { PageLayout, LayoutCard, ChartCard, Grid } from '@/components/layout';
import {
  Button,
  Select,
  Input,
  Slider,
  Badge,
  DataTable,
  Text,
  Caption,
  ErrorText,
  useSortToggle,
  type Column,
} from '@/components/ui';
import { UnitInput, FormSection } from '@/components/forms';
import { StatStrip, type StatMetric } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError, StaleRefreshWarning } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useFormatting } from '@/hooks/useFormatting';

import { toLocalDatetimeStr } from '@/lib/dateFormat';
import { cn } from '@/lib/cn';
import { typography } from '@/lib/tokens';
import {
  useOptimizeCharge,
  useApplySchedule,
  useChargePlans,
  useRatePlans,
} from '@/api/hooks/useCharging';
import { RateTimeline } from '../components/smart-charge-modernization/RateTimeline';
import { AutopilotCard } from '../components/smart-charge-modernization/AutopilotCard';
import { ChargePointsCard } from '../components/smart-charge-modernization/ChargePointsCard';
import { AISmartChargeScheduleSuggestion } from '@/components/ai/AISmartChargeScheduleSuggestion';
import type { ChargePlan, OptimizeChargeResponse } from '@/types/charging';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { convertEnergyFromSI } from '@/lib/unitConversion';
import { useDataState } from '@/hooks/useDataState';
import { knownNumber } from '@/api/dataState';
import { safeArray } from '@/lib/safeArray';

const plannerColumns = { default: 1, xl: 3 };
const factColumns = { default: 1, sm: 2, lg: 4 };

function historySortValue(plan: ChargePlan, key: string): number | string {
  if (key === 'estimated_cost' || key === 'savings') return knownNumber(plan[key]) ?? Number.NEGATIVE_INFINITY;
  if (key === 'created_at') return Number.isFinite(Date.parse(plan.created_at)) ? Date.parse(plan.created_at) : Number.NEGATIVE_INFINITY;
  if (key === 'rate_plan') return plan.rate_plan ?? '';
  if (key === 'status') return plan.status ?? '';
  return '';
}

/**
 * Default "Depart By" value for the datetime-local input: tomorrow at 07:30 in
 * the user's LOCAL time, formatted `yyyy-MM-ddTHH:mm`.
 *
 * A `<input type="datetime-local">` value is interpreted as local wall-clock
 * time, so it must be built from local calendar fields. The previous
 * implementation used `toISOString().slice(0, 16)`, which emits UTC and shifted
 * the default by the user's timezone offset (e.g. a UTC+8 user saw the previous
 * day at 23:30 instead of tomorrow 07:30, and the value round-tripped back
 * through `new Date(departBy)` — parsed as local — drifting further each run).
 * `toLocalDatetimeStr` formats local fields; we trim its `:ss` suffix to the
 * minute precision the input expects.
 */
export const defaultDepartBy = (): string => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(7, 30, 0, 0);
  return toLocalDatetimeStr(d).slice(0, 16);
};

/** Maps a plan lifecycle status onto a shared Badge variant so the History
 *  table conveys state with colour + label (never colour alone). */
export function planStatusVariant(
  status: string,
): 'success' | 'info' | 'warning' | 'danger' | 'neutral' {
  switch (status) {
    case 'completed':
      return 'success';
    case 'scheduled':
    case 'applied':
      return 'info';
    case 'cancelled':
    case 'failed':
      return 'danger';
    case 'pending':
      return 'warning';
    default:
      return 'neutral';
  }
}

/** Compact label/value pair for the recommended-schedule facts grid. */
function ScheduleFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <Caption>{label}</Caption>
      <Text as="p" variant="body" className="mt-0.5 break-words font-medium">
        {value}
      </Text>
    </div>
  );
}

export default function SmartChargePage() {
  const { fmtNumber, fmtPercent } = useNumberFormatting();
  const { t } = useTranslation();
  usePageTitle(t('chargePlanner.title', 'Smart charge'));
  const { formatTime, formatDateTime: formatDate } = useDateFormat();
  const { formatCurrency } = useFormatting();

  // Data hooks
  const { vehicleId: selectedId } = useSelectedVehicle();
  const ratePlansQuery = useRatePlans();
  const { data: ratePlans, refetch: refetchRatePlans } = ratePlansQuery;
  const ratePlansState = useDataState(ratePlansQuery);
  const optimizeMutation = useOptimizeCharge();
  const applyMutation = useApplySchedule();

  // Form state — vehicleId comes from the global selection.
  const vehicleIdNum = selectedId ?? undefined;
  const currentVehicleId = useRef(vehicleIdNum);
  currentVehicleId.current = vehicleIdNum;
  const [targetSoc, setTargetSoc] = useState(80);
  const [departBy, setDepartBy] = useState(defaultDepartBy);
  // No hardcoded plan: the effect below defaults to the first available plan
  // (backend plans win over the built-in fallback) without ever clobbering an
  // explicit user choice.
  const [ratePlanId, setRatePlanId] = useState('');
  const [maxAmps, setMaxAmps] = useState(32);
  const [batteryCapacity, setBatteryCapacity] = useState(75);
  const [departByError, setDepartByError] = useState('');
  const [maxAmpsError, setMaxAmpsError] = useState('');
  const [capacityError, setCapacityError] = useState('');

  // Result state
  const [result, setResult] = useState<OptimizeChargeResponse | null>(null);
  const [applied, setApplied] = useState(false);
  const { sortKey, sortDir, onSort, sortFn } = useSortToggle();

  useEffect(() => {
    setResult(null);
    setApplied(false);
  }, [vehicleIdNum]);

  // Plan-history query — also drives the page-level freshness chip.
  const plansQuery = useChargePlans(vehicleIdNum);
  const {
    data: plans,
    isLoading: plansLoading,
    refetch: refetchPlans,
  } = plansQuery;
  const plansState = useDataState(plansQuery, { provenance: 'historical' });

  const ratePlanOptions = useMemo(
    () =>
      safeArray(ratePlans).map((p) => ({
        value: p.id,
        label: `${p.name} (${p.utility})`,
      })),
    [ratePlans],
  );

  const ratePlanSelectOptions = useMemo(
    () =>
      ratePlanOptions.length > 0
        ? ratePlanOptions
        : [
            { value: 'pge-ev2a', label: 'PG&E EV2-A' },
            { value: 'sce-tou-d', label: 'SCE TOU-D' },
            { value: 'sdge-tou-dr1', label: 'SDG&E TOU-DR1' },
          ],
    [ratePlanOptions],
  );

  // Keep the selection valid as the option list resolves: backend plans
  // replace the fallback default, but a value the user picked is left alone.
  useEffect(() => {
    if (
      ratePlanSelectOptions.length > 0 &&
      !ratePlanSelectOptions.some((o) => o.value === ratePlanId)
    ) {
      setRatePlanId(ratePlanSelectOptions[0].value);
    }
  }, [ratePlanSelectOptions, ratePlanId]);

  const chargeWindow = useMemo(() => {
    if (!result) return undefined;
    const start = new Date(result.schedule.start_time);
    const end = new Date(result.schedule.end_time);
    return { startHour: start.getHours(), endHour: end.getHours() || 24 };
  }, [result]);

  const handleOptimize = () => {
    if (!vehicleIdNum) return;
    // Validate before mutating: a cleared Depart By field parses to Invalid
    // Date, whose toISOString() throws an uncaught RangeError, and cleared
    // numerics collapse to 0 (Number('') / UnitInput null → 0).
    const departTs = new Date(departBy).getTime();
    const nextDepartByError =
      !departBy || Number.isNaN(departTs)
        ? t('chargePlanner.invalidDepartBy', 'Enter a valid departure date and time.')
        : '';
    const nextMaxAmpsError =
      !Number.isFinite(maxAmps) || maxAmps < 8 || maxAmps > 80
        ? t('chargePlanner.invalidMaxAmps', 'Enter an amperage between 8 and 80.')
        : '';
    const nextCapacityError =
      !Number.isFinite(batteryCapacity) || batteryCapacity <= 0
        ? t('chargePlanner.invalidCapacity', 'Enter a battery capacity greater than 0.')
        : '';
    setDepartByError(nextDepartByError);
    setMaxAmpsError(nextMaxAmpsError);
    setCapacityError(nextCapacityError);
    if (nextDepartByError || nextMaxAmpsError || nextCapacityError) return;
    setApplied(false);
    setResult(null);
    optimizeMutation.mutate(
      {
        vehicle_id: vehicleIdNum,
        target_soc: targetSoc,
        depart_by: new Date(departBy).toISOString(),
        rate_plan_id: ratePlanId,
        max_amps: maxAmps,
        battery_capacity_kwh: batteryCapacity,
      },
      {
        onSuccess: (data) => {
          if (currentVehicleId.current === vehicleIdNum) setResult(data);
        },
      },
    );
  };

  const handleApply = () => {
    if (!result) return;
    applyMutation.mutate(
      { plan_id: result.plan_id },
      {
        onSuccess: () => {
          if (currentVehicleId.current === vehicleIdNum) setApplied(true);
        },
      },
    );
  };

  const historyItems = useMemo(() => sortFn(safeArray(plans), historySortValue), [plans, sortFn]);
  const comparison = result?.comparison;
  const savingsPositive = (comparison?.savings ?? 0) > 0;

  const optimizeErrorMsg = optimizeMutation.isError
    ? optimizeMutation.error?.message ||
      t('chargePlanner.optimizeError', 'Optimization failed')
    : '';

  // Preserve the planner's specialist currency/rate presentation. Its existing
  // wire contract is not a canonical SI metric contract.
  const costMetrics: StatMetric[] = [
    {
      metricId: 'text', occurrenceId: 'charge-now',
      label: t('chargePlanner.chargeNowCost', 'Charge now'),
      rawValue: comparison && knownNumber(comparison.charge_now_cost) != null ? formatCurrency(comparison.charge_now_cost) : null,
      description: t('chargePlanner.currentRate', 'At current rates'),
      context: t('chargePlanner.currentRate', 'At current rates'),
    },
    {
      metricId: 'text', occurrenceId: 'optimized-cost',
      label: t('chargePlanner.optimizedCost', 'Optimized cost'),
      rawValue: comparison && knownNumber(comparison.optimized_cost) != null ? formatCurrency(comparison.optimized_cost) : null,
      context: result ? `${result.schedule.rate_tier} · ${fmtNumber(result.schedule.rate_cents_kwh)}¢/kWh` : undefined,
    },
    {
      metricId: 'text', occurrenceId: 'savings',
      label: t('chargePlanner.savings', 'Savings'),
      rawValue: comparison && knownNumber(comparison.savings) != null ? formatCurrency(comparison.savings) : null,
      comparisonContent: comparison && savingsPositive && knownNumber(comparison.savings_percent) != null
        ? <Text variant="bodySm">{fmtPercent(comparison.savings_percent)}</Text> : undefined,
    },
    {
      metricId: 'text', occurrenceId: 'energy-needed',
      label: t('chargePlanner.energyNeeded', 'Energy needed'),
      rawValue: result && knownNumber(result.kwh_needed) != null ? `${fmtNumber(result.kwh_needed)} kWh` : null,
      context: result && knownNumber(result.estimated_duration_hours) != null
        ? t('chargePlanner.estDuration', '~{{hours}}h', { hours: fmtNumber(result.estimated_duration_hours) }) : undefined,
    },
  ];

  const historyColumns = useMemo<Column<ChargePlan>[]>(
    () => [
      {
        key: 'created_at',
        filterValue: (p) => p.created_at ?? null,
        filterValueLabel: (_, p) => formatDate(p.created_at),
        header: t('chargePlanner.date', 'Date'),
        sortable: true,
        render: (p) => <Text variant="bodySm">{formatDate(p.created_at)}</Text>,
      },
      {
        key: 'window',
        header: t('chargePlanner.window', 'Window'),
        render: (p) => (
          <Text variant="bodySm" className="tabular-nums">
            {formatTime(p.scheduled_start)} — {formatTime(p.scheduled_end)}
          </Text>
        ),
      },
      {
        key: 'rate_plan',
        filterValue: (p) => p.rate_plan ?? null,
        header: t('chargePlanner.plan', 'Plan'),
        sortable: true,
        render: (p) => <Text variant="bodySm">{p.rate_plan ?? '—'}</Text>,
      },
      {
        key: 'estimated_cost',
        filterValue: (p) => p.estimated_cost ?? null,
        filterValueLabel: (_, p) => p.estimated_cost != null ? formatCurrency(p.estimated_cost) : '—',
        header: t('chargePlanner.cost', 'Cost'),
        align: 'right',
        sortable: true,
        render: (p) => (
          <Text variant="bodySm" className="tabular-nums">
            {p.estimated_cost != null ? formatCurrency(p.estimated_cost) : '—'}
          </Text>
        ),
      },
      {
        key: 'savings',
        filterValue: (p) => p.savings ?? null,
        filterValueLabel: (_, p) => p.savings != null && p.savings > 0 ? formatCurrency(p.savings) : '—',
        header: t('chargePlanner.savedAmount', 'Saved'),
        align: 'right',
        sortable: true,
        render: (p) => {
          const positive = p.savings != null && p.savings > 0;
          return (
            <span
              className={cn(
                typography.size.xs,
                'tabular-nums',
                positive ? 'text-emerald-300' : 'text-[var(--text-muted)]',
              )}
            >
              {positive ? formatCurrency(p.savings ?? 0) : '—'}
            </span>
          );
        },
      },
      {
        key: 'status',
        filterValue: (p) => p.status ?? null,
        header: t('chargePlanner.status', 'Status'),
        sortable: true,
        render: (p) => (
          <Badge variant={planStatusVariant(p.status)} size="sm">
            {p.status}
          </Badge>
        ),
      },
    ],
    [t, formatDate, formatTime, formatCurrency],
  );

  return (
    <PageLayout
      title={t('chargePlanner.title', 'Smart charge')}
      subtitle={t('chargePlanner.subtitle', 'Optimize charging schedule for the cheapest TOU rates')}
      query={plansQuery}
    >
      <div className="space-y-4 sm:space-y-6">
        {/* ── AI Smart-Charge Schedule Suggestion (opt-in, hidden when ai_mode='off') ── */}
        <FadeIn>
          <AISmartChargeScheduleSuggestion
            vehicleId={vehicleIdNum}
            targetSoc={targetSoc}
            departBy={departBy}
            ratePlanId={ratePlanId}
            maxAmps={maxAmps}
            batteryCapacityKwh={batteryCapacity}
          />
        </FadeIn>

        {/* ── 1 · KPI band — cost comparison (always visible; placeholder until optimized) ── */}
        <FadeIn delay={0.05}>
          <section
            aria-label={t('chargePlanner.costComparison', 'Cost comparison')}
          >
            <StatStrip
              id="smart-charge-cost-comparison"
              metrics={costMetrics}
              period={{
                kind: 'unknown',
                label: t('chargePlanner.costComparison', 'Cost comparison'),
                reason: t('chargePlanner.modernization.estimateContext', 'Optimizer estimates for the selected departure and rate plan; not measured charging costs.'),
              }}
            />
          </section>
        </FadeIn>

        {/* ── 2 · Autopilot — always-on profile, next-run preview, realized savings ── */}
        <FadeIn delay={0.08}>
          <AutopilotCard key={vehicleIdNum ?? 'none'} vehicleId={vehicleIdNum} />
        </FadeIn>

        {/* ── 3 · Primary bento — settings control rail + rate-timeline hero ── */}
        <FadeIn delay={0.1}>
          <Grid cols={plannerColumns}>
            {/* Charge settings (control rail) */}
            <FormSection title={t('chargePlanner.settings', 'Charge settings')}>
              <div className="space-y-4">
                {/* Live plans failed: say so with a retry instead of silently
                    substituting the built-in fallback list below. */}
                <StaleRefreshWarning state={ratePlansState} />
                {ratePlansState.fatalError && (
                  <QueryError
                    error={ratePlansState.fatalError}
                    onRetry={() => void refetchRatePlans()}
                    compact
                    resourceName={t('chargePlanner.ratePlansResource', 'rate plans')}
                  />
                )}
                <Select
                  id="smart-charge-rate-plan"
                  label={t('chargePlanner.ratePlan', 'Rate plan')}
                  options={ratePlanSelectOptions}
                  value={ratePlanId}
                  onChange={(e) => setRatePlanId(e.target.value)}
                />

                <Slider
                  id="smart-charge-target-soc"
                  label={t('chargePlanner.targetSoc', 'Target SOC')}
                  formatValue={(n) => `${n}%`}
                  min={20}
                  max={100}
                  step={5}
                  value={targetSoc}
                  onChange={setTargetSoc}
                />

                <Input
                  label={t('chargePlanner.departBy', 'Depart by')}
                  type="datetime-local"
                  value={departBy}
                  error={departByError || undefined}
                  onChange={(e) => {
                    setDepartBy(e.target.value);
                    if (departByError) setDepartByError('');
                  }}
                />

                <Input
                  id="smart-charge-max-amps"
                  label={t('chargePlanner.maxAmps', 'Max amps')}
                  type="number"
                  min={8}
                  max={80}
                  value={String(maxAmps)}
                  error={maxAmpsError || undefined}
                  onChange={(e) => {
                    setMaxAmps(Number(e.target.value));
                    if (maxAmpsError) setMaxAmpsError('');
                  }}
                />

                <UnitInput
                  label={t('chargePlanner.batteryCapacity', 'Battery capacity')}
                  unit="energy"
                  value={batteryCapacity / convertEnergyFromSI(1, 'kWh')}
                  error={capacityError || undefined}
                  onChange={(v) => {
                    setBatteryCapacity(v == null ? 0 : convertEnergyFromSI(v, 'kWh'));
                    if (capacityError) setCapacityError('');
                  }}
                />

                <Button
                  wrapLabel
                  onClick={handleOptimize}
                  disabled={!vehicleIdNum || optimizeMutation.isPending}
                  loading={optimizeMutation.isPending}
                  icon={<CalendarClock className="h-4 w-4" aria-hidden="true" />}
                  className="w-full gap-2"
                >
                  {t('chargePlanner.optimize', 'Find cheapest window')}
                </Button>

                {optimizeMutation.isError && <ErrorText>{optimizeErrorMsg}</ErrorText>}
                {!vehicleIdNum && (
                  <Caption>
                    {t('chargePlanner.selectVehiclePrompt', 'Select a vehicle to optimize a charge schedule.')}
                  </Caption>
                )}
              </div>
            </FormSection>

            {/* Rate timeline (hero) */}
            <div className="min-w-0 xl:col-span-2">
            <ChartCard
              title={t('chargePlanner.rateTimeline', '24-hour rate timeline')}
              ariaLabel={t('chargePlanner.rateTimelineChart', '24-hour electricity rate timeline')}
              data={safeArray(result?.hourly_rates).map(({ hour, rate_cents, tier }) => ({ hour, rate_cents, tier }))}
              exportData={safeArray(result?.hourly_rates).map(({ hour, rate_cents, tier }) => ({ hour, rate_cents, tier }))}
              exportable
              fullscreen
              dataColumns={[
                { key: 'hour', label: t('powershare.time', 'Time') },
                { key: 'rate_cents', label: t('chargePlanner.modernization.rateCentsPerKwh', 'Rate (cents/kWh)') },
                { key: 'tier', label: t('chargePlanner.modernization.rateTier', 'Rate tier') },
              ]}
              loading={optimizeMutation.isPending}
              error={optimizeMutation.isError ? optimizeMutation.error : null}
              empty={!result}
              emptyMessage={t('chargePlanner.runToSeeTimeline', 'Run an optimization to see the 24-hour rate timeline and the cheapest charge window.')}
              footer={result ? <Text as="p" variant="caption">{t('chargePlanner.windowInfo', 'Optimal window: {{start}} — {{end}}', {
                start: formatTime(result.schedule.start_time), end: formatTime(result.schedule.end_time),
              })}</Text> : undefined}
            >
              <RateTimeline rates={safeArray(result?.hourly_rates)} chargeWindow={chargeWindow} />
            </ChartCard>
            </div>
          </Grid>
        </FadeIn>

        {/* ── 4 · Schedule bento — recommended schedule + alternatives ── */}
        <FadeIn delay={0.15}>
          <Grid cols={plannerColumns}>
            {/* Recommended schedule + apply */}
            <div className="min-w-0 xl:col-span-2">
            <LayoutCard title={t('chargePlanner.schedule', 'Recommended schedule')}>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                {result &&
                  (applied ? (
                    <Badge variant="success" size="md" className="gap-1">
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      {t('chargePlanner.applied', 'Schedule applied!')}
                    </Badge>
                  ) : (
                    <Button
                      wrapLabel
                      onClick={handleApply}
                      disabled={applyMutation.isPending}
                      loading={applyMutation.isPending}
                      icon={<Zap className="h-4 w-4" aria-hidden="true" />}
                      className="gap-2"
                    >
                      {t('chargePlanner.applySchedule', 'Apply schedule')}
                    </Button>
                  ))}
              </div>

              {optimizeMutation.isPending ? (
                <Skeleton height={120} />
              ) : !result ? (
                <EmptyState /* no-action: awaiting a user-triggered optimization run */
                  icon={<CalendarClock className="h-8 w-8" />}
                  message={t(
                    'chargePlanner.runToSeeSchedule',
                    'Optimize a schedule to see the recommended charge window and apply it to your vehicle.',
                  )}
                />
              ) : (
                <>
                  {applyMutation.isError && (
                    <ErrorText className="mb-3">
                      {applyMutation.error?.message ||
                        t('chargePlanner.applyError', 'Failed to apply schedule')}
                    </ErrorText>
                  )}
                  <Grid cols={factColumns}>
                    <ScheduleFact
                      label={t('chargePlanner.currentSoc', 'Current SOC')}
                      value={knownNumber(result.current_soc) != null ? `${result.current_soc}%` : '—'}
                    />
                    <ScheduleFact
                      label={t('chargePlanner.targetSocLabel', 'Target SOC')}
                      value={knownNumber(result.target_soc) != null ? `${result.target_soc}%` : '—'}
                    />
                    <ScheduleFact
                      label={t('chargePlanner.startTime', 'Start time')}
                      value={formatTime(result.schedule.start_time)}
                    />
                    <ScheduleFact
                      label={t('chargePlanner.endTime', 'End time')}
                      value={formatTime(result.schedule.end_time)}
                    />
                  </Grid>
                </>
              )}
            </LayoutCard>
            </div>

            {/* Alternative windows */}
            <LayoutCard title={t('chargePlanner.alternatives', 'Alternative windows')}>

              {optimizeMutation.isPending ? (
                <Skeleton height={120} />
              ) : !result ? (
                <EmptyState /* no-action: awaiting a user-triggered optimization run */
                  icon={<Clock className="h-8 w-8" />}
                  message={t(
                    'chargePlanner.runToSeeAlternatives',
                    'Optimize a schedule to compare alternative charge windows.',
                  )}
                />
              ) : safeArray(result.alternative_windows).length === 0 ? (
                <EmptyState /* no-action: transient — the optimizer returned a single best window */
                  icon={<Clock className="h-8 w-8" />}
                  message={t('chargePlanner.noAlternatives', 'No alternative windows for this plan.')}
                />
              ) : (
                <ul className="space-y-2">
                  {safeArray(result.alternative_windows).map((alt, i) => (
                    <li
                      key={i}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--surface-2)] px-3 py-2"
                    >
                      <Text variant="bodySm" className="tabular-nums">
                        {formatTime(alt.start_time)} — {formatTime(alt.end_time)}
                      </Text>
                      <Caption className="break-words">{alt.rate_tier}</Caption>
                      <Text variant="body" className="font-medium tabular-nums">
                        {knownNumber(alt.estimated_cost) != null ? formatCurrency(alt.estimated_cost) : '—'}
                      </Text>
                    </li>
                  ))}
                </ul>
              )}
            </LayoutCard>
          </Grid>
        </FadeIn>

        {/* ── 5 · Detail band — plan history ── */}
        <FadeIn delay={0.2}>
          <LayoutCard title={t('chargePlanner.history', 'Plan history')}>
            <StaleRefreshWarning state={plansState} />
            {plansLoading && !plansState.hasData ? (
              <Skeleton height={200} />
            ) : plansState.fatalError ? (
              <QueryError error={plansState.fatalError} onRetry={() => refetchPlans()} />
            ) : (
              <DataTable
                enableValueFilters
                tableId="charging:smart-charge-history"
                columns={historyColumns}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={onSort}
                mobileColumns={['created_at', 'savings', 'status']}
                data={historyItems}
                keyExtractor={(p) => p.id}
                emptyMessage={t(
                  'chargePlanner.noHistory',
                  'No charge plans yet. Optimize a schedule above to get started.',
                )}
                pagination
              />
            )}
          </LayoutCard>
        </FadeIn>

        {/* ── 6 · OCPP band — non-Tesla charge points ── */}
        <FadeIn delay={0.25}>
          <ChargePointsCard />
        </FadeIn>
      </div>
    </PageLayout>
  );
}
