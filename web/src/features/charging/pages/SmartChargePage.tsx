import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Zap,
  Clock,
  DollarSign,
  TrendingDown,
  BatteryCharging,
  CalendarClock,
  CheckCircle2,
  History,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import {
  GlassPanel,
  Button,
  Select,
  Input,
  Slider,
  Badge,
  DataTable,
  PanelTitle,
  Text,
  Caption,
  ErrorText,
  type Column,
} from '@/components/ui';
import { UnitInput, VehicleSelect } from '@/components/forms';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError, Spinner } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useFormatting } from '@/hooks/useFormatting';
import { fmtNumber, fmtPercent } from '@/lib/numberFormat';
import { toLocalDatetimeStr } from '@/lib/dateFormat';
import { cn } from '@/lib/cn';
import { typography } from '@/lib/tokens';
import {
  useOptimizeCharge,
  useApplySchedule,
  useChargePlans,
  useRatePlans,
} from '@/api/hooks/useCharging';
import { RateTimeline } from '../components/RateTimeline';
import { AISmartChargeScheduleSuggestion } from '@/components/ai/AISmartChargeScheduleSuggestion';
import type { ChargePlan, OptimizeChargeResponse } from '@/types/charging';

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
      <Text as="p" variant="body" className="mt-0.5 truncate font-medium">
        {value}
      </Text>
    </div>
  );
}

export default function SmartChargePage() {
  const { t } = useTranslation();
  usePageTitle(t('chargePlanner.title', 'Smart Charge'));
  const { formatTime, formatDateTime: formatDate } = useDateFormat();
  const { formatCurrency } = useFormatting();

  // Data hooks
  const { vehicleId: selectedId } = useSelectedVehicle();
  const { data: ratePlans } = useRatePlans();
  const optimizeMutation = useOptimizeCharge();
  const applyMutation = useApplySchedule();

  // Form state — vehicleId comes from the global selection.
  const vehicleIdNum = selectedId ?? undefined;
  const [targetSoc, setTargetSoc] = useState(80);
  const [departBy, setDepartBy] = useState(defaultDepartBy);
  const [ratePlanId, setRatePlanId] = useState('pge-ev2a');
  const [maxAmps, setMaxAmps] = useState(32);
  const [batteryCapacity, setBatteryCapacity] = useState(75);

  // Result state
  const [result, setResult] = useState<OptimizeChargeResponse | null>(null);
  const [applied, setApplied] = useState(false);

  // Plan-history query — also drives the page-level freshness chip.
  const plansQuery = useChargePlans(vehicleIdNum);
  const {
    data: plans,
    isLoading: plansLoading,
    isError: plansError,
    error: plansErrorObj,
    refetch: refetchPlans,
  } = plansQuery;

  const ratePlanOptions = useMemo(
    () =>
      (ratePlans ?? []).map((p) => ({
        value: p.id,
        label: `${p.name} (${p.utility})`,
      })),
    [ratePlans],
  );

  const ratePlanSelectOptions =
    ratePlanOptions.length > 0
      ? ratePlanOptions
      : [
          { value: 'pge-ev2a', label: 'PG&E EV2-A' },
          { value: 'sce-tou-d', label: 'SCE TOU-D' },
          { value: 'sdge-tou-dr1', label: 'SDG&E TOU-DR1' },
        ];

  const chargeWindow = useMemo(() => {
    if (!result) return undefined;
    const start = new Date(result.schedule.start_time);
    const end = new Date(result.schedule.end_time);
    return { startHour: start.getHours(), endHour: end.getHours() || 24 };
  }, [result]);

  const handleOptimize = () => {
    if (!vehicleIdNum) return;
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
        onSuccess: (data) => setResult(data),
      },
    );
  };

  const handleApply = () => {
    if (!result) return;
    applyMutation.mutate(
      { plan_id: result.plan_id },
      {
        onSuccess: () => setApplied(true),
      },
    );
  };

  const historyItems = plans ?? [];
  const comparison = result?.comparison;
  const savingsPositive = (comparison?.savings ?? 0) > 0;

  const optimizeErrorMsg = optimizeMutation.isError
    ? (optimizeMutation.error as Error)?.message ||
      t('chargePlanner.optimizeError', 'Optimization failed')
    : '';

  const historyColumns = useMemo<Column<ChargePlan>[]>(
    () => [
      {
        key: 'created_at',
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
        header: t('chargePlanner.plan', 'Plan'),
        sortable: true,
        render: (p) => <Text variant="bodySm">{p.rate_plan ?? '—'}</Text>,
      },
      {
        key: 'estimated_cost',
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
    <PageContainer
      title={t('chargePlanner.title', 'Smart Charge')}
      subtitle={t('chargePlanner.subtitle', 'Optimize charging schedule for the cheapest TOU rates')}
      actions={<VehicleSelect />}
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
            className="grid grid-cols-2 gap-4 lg:grid-cols-4"
          >
            <MetricCard
              label={t('chargePlanner.chargeNowCost', 'Charge Now')}
              value={comparison ? formatCurrency(comparison.charge_now_cost ?? 0) : '—'}
              icon={<DollarSign className="h-5 w-5" aria-hidden="true" />}
              color="red"
              subtitle={t('chargePlanner.currentRate', 'At current rates')}
            />
            <MetricCard
              label={t('chargePlanner.optimizedCost', 'Optimized Cost')}
              value={comparison ? formatCurrency(comparison.optimized_cost ?? 0) : '—'}
              icon={<TrendingDown className="h-5 w-5" aria-hidden="true" />}
              color="green"
              subtitle={
                result
                  ? `${result.schedule.rate_tier} · ${fmtNumber(result.schedule.rate_cents_kwh ?? 0, 1)}¢/kWh`
                  : undefined
              }
            />
            <MetricCard
              label={t('chargePlanner.savings', 'Savings')}
              value={comparison ? formatCurrency(comparison.savings ?? 0) : '—'}
              icon={<BatteryCharging className="h-5 w-5" aria-hidden="true" />}
              color="cyan"
              change={
                comparison && savingsPositive
                  ? { value: fmtPercent(comparison.savings_percent ?? 0, 0), positive: true }
                  : undefined
              }
            />
            <MetricCard
              label={t('chargePlanner.energyNeeded', 'Energy Needed')}
              value={result ? `${fmtNumber(result.kwh_needed ?? 0, 1)} kWh` : '—'}
              icon={<Zap className="h-5 w-5" aria-hidden="true" />}
              color="amber"
              subtitle={
                result
                  ? t('chargePlanner.estDuration', '~{{hours}}h', {
                      hours: fmtNumber(result.estimated_duration_hours ?? 0, 1),
                    })
                  : undefined
              }
            />
          </section>
        </FadeIn>

        {/* ── 2 · Primary bento — settings control rail + rate-timeline hero ── */}
        <FadeIn delay={0.1}>
          <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            {/* Charge settings (control rail) */}
            <GlassPanel className="p-4 sm:p-5 xl:col-span-1">
              <PanelTitle className="mb-4 flex items-center gap-2">
                <Zap className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t('chargePlanner.settings', 'Charge Settings')}
              </PanelTitle>

              <div className="space-y-4">
                <Select
                  label={t('chargePlanner.ratePlan', 'Rate Plan')}
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
                  label={t('chargePlanner.departBy', 'Depart By')}
                  type="datetime-local"
                  value={departBy}
                  onChange={(e) => setDepartBy(e.target.value)}
                />

                <Input
                  label={t('chargePlanner.maxAmps', 'Max Amps')}
                  type="number"
                  min={8}
                  max={80}
                  value={String(maxAmps)}
                  onChange={(e) => setMaxAmps(Number(e.target.value))}
                />

                <UnitInput
                  label={t('chargePlanner.batteryCapacity', 'Battery Capacity')}
                  unit="energy"
                  value={batteryCapacity}
                  onChange={(v) => setBatteryCapacity(v ?? 0)}
                />

                <Button
                  onClick={handleOptimize}
                  disabled={!vehicleIdNum || optimizeMutation.isPending}
                  className="w-full gap-2"
                >
                  {optimizeMutation.isPending ? (
                    <Spinner className="h-4 w-4" />
                  ) : (
                    <CalendarClock className="h-4 w-4" aria-hidden="true" />
                  )}
                  {t('chargePlanner.optimize', 'Find Cheapest Window')}
                </Button>

                {optimizeMutation.isError && <ErrorText>{optimizeErrorMsg}</ErrorText>}
                {!vehicleIdNum && (
                  <Caption>
                    {t('chargePlanner.selectVehiclePrompt', 'Select a vehicle to optimize a charge schedule.')}
                  </Caption>
                )}
              </div>
            </GlassPanel>

            {/* Rate timeline (hero) */}
            <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
              <PanelTitle className="mb-3 flex items-center gap-2">
                <Clock className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t('chargePlanner.rateTimeline', '24-Hour Rate Timeline')}
              </PanelTitle>

              {optimizeMutation.isPending ? (
                <Skeleton height={160} />
              ) : optimizeMutation.isError ? (
                <div className="py-8 text-center">
                  <ErrorText>{optimizeErrorMsg}</ErrorText>
                </div>
              ) : !result ? (
                <EmptyState /* no-action: awaiting a user-triggered optimization run */
                  icon={<Clock className="h-8 w-8" />}
                  message={t(
                    'chargePlanner.runToSeeTimeline',
                    'Run an optimization to see the 24-hour rate timeline and the cheapest charge window.',
                  )}
                />
              ) : (
                <>
                  <RateTimeline rates={result.hourly_rates ?? []} chargeWindow={chargeWindow} />
                  <Text as="p" variant="caption" className="mt-3">
                    {t('chargePlanner.windowInfo', 'Optimal window: {{start}} — {{end}}', {
                      start: formatTime(result.schedule.start_time),
                      end: formatTime(result.schedule.end_time),
                    })}
                  </Text>
                </>
              )}
            </GlassPanel>
          </section>
        </FadeIn>

        {/* ── 3 · Schedule bento — recommended schedule + alternatives ── */}
        <FadeIn delay={0.15}>
          <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            {/* Recommended schedule + apply */}
            <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <PanelTitle className="flex items-center gap-2">
                  <CalendarClock className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                  {t('chargePlanner.schedule', 'Recommended Schedule')}
                </PanelTitle>
                {result &&
                  (applied ? (
                    <Badge variant="success" size="md" className="gap-1">
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      {t('chargePlanner.applied', 'Schedule Applied!')}
                    </Badge>
                  ) : (
                    <Button onClick={handleApply} disabled={applyMutation.isPending} className="gap-2">
                      {applyMutation.isPending ? (
                        <Spinner className="h-4 w-4" />
                      ) : (
                        <Zap className="h-4 w-4" aria-hidden="true" />
                      )}
                      {t('chargePlanner.applySchedule', 'Apply Schedule')}
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
                      {(applyMutation.error as Error)?.message ||
                        t('chargePlanner.applyError', 'Failed to apply schedule')}
                    </ErrorText>
                  )}
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <ScheduleFact
                      label={t('chargePlanner.currentSoc', 'Current SOC')}
                      value={`${result.current_soc ?? 0}%`}
                    />
                    <ScheduleFact
                      label={t('chargePlanner.targetSocLabel', 'Target SOC')}
                      value={`${result.target_soc ?? 0}%`}
                    />
                    <ScheduleFact
                      label={t('chargePlanner.startTime', 'Start Time')}
                      value={formatTime(result.schedule.start_time)}
                    />
                    <ScheduleFact
                      label={t('chargePlanner.endTime', 'End Time')}
                      value={formatTime(result.schedule.end_time)}
                    />
                  </div>
                </>
              )}
            </GlassPanel>

            {/* Alternative windows */}
            <GlassPanel className="p-4 sm:p-5 xl:col-span-1">
              <PanelTitle className="mb-3 flex items-center gap-2">
                <Clock className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t('chargePlanner.alternatives', 'Alternative Windows')}
              </PanelTitle>

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
              ) : (result.alternative_windows ?? []).length === 0 ? (
                <EmptyState /* no-action: transient — the optimizer returned a single best window */
                  icon={<Clock className="h-8 w-8" />}
                  message={t('chargePlanner.noAlternatives', 'No alternative windows for this plan.')}
                />
              ) : (
                <ul className="space-y-2">
                  {(result.alternative_windows ?? []).map((alt, i) => (
                    <li
                      key={i}
                      className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.03] px-3 py-2"
                    >
                      <Text variant="bodySm" className="tabular-nums">
                        {formatTime(alt.start_time)} — {formatTime(alt.end_time)}
                      </Text>
                      <Caption className="truncate">{alt.rate_tier}</Caption>
                      <Text variant="body" className="font-medium tabular-nums">
                        {formatCurrency(alt.estimated_cost ?? 0)}
                      </Text>
                    </li>
                  ))}
                </ul>
              )}
            </GlassPanel>
          </section>
        </FadeIn>

        {/* ── 4 · Detail band — plan history ── */}
        <FadeIn delay={0.2}>
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <History className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('chargePlanner.history', 'Plan History')}
            </PanelTitle>

            {plansLoading && historyItems.length === 0 ? (
              <Skeleton height={200} />
            ) : plansError ? (
              <QueryError error={plansErrorObj} onRetry={() => refetchPlans()} />
            ) : (
              <DataTable
                tableId="charging:smart-charge-history"
                columns={historyColumns}
                data={historyItems}
                keyExtractor={(p) => p.id}
                emptyMessage={t(
                  'chargePlanner.noHistory',
                  'No charge plans yet. Optimize a schedule above to get started.',
                )}
                pagination
              />
            )}
          </GlassPanel>
        </FadeIn>
      </div>
    </PageContainer>
  );
}
