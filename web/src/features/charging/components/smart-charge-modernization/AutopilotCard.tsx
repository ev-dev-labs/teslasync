import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, ShieldCheck, CalendarClock, Zap } from 'lucide-react';
import { LayoutCard, ChartCard, Grid } from '@/components/layout';
import { Button, Select, Input, Slider, Toggle, Badge, Text, Caption, ErrorText } from '@/components/ui';
import { type StatMetric } from '@/components/data-display';
import { ChargingSummaryBrief } from '../operationalbrief-all/ChargingSummaryBrief';
import { Skeleton, EmptyState, QueryError, StaleRefreshWarning } from '@/components/feedback';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useFormatting } from '@/hooks/useFormatting';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDataState } from '@/hooks/useDataState';
import { knownNumber } from '@/api/dataState';
import { safeArray } from '@/lib/safeArray';
import {
  useAutopilotProfile, useSaveAutopilotProfile, useAutopilotPreview,
  useAutopilotRun, useAutopilotSavings, useRatePlans,
} from '@/api/hooks/useCharging';
import type { AutopilotProfile } from '@/types/charging';
import { RateTimeline } from './RateTimeline';

const columns = { default: 1, lg: 2 };
const actionClassName = 'h-auto min-h-11 md:min-h-10';

/** Profile controls, preview and savings retain their independent sources. */
export function AutopilotCard({ vehicleId }: { vehicleId?: number }) {
  const { fmtPercent, fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const { formatTime } = useDateFormat();
  const { formatCurrency } = useFormatting();
  const profileQuery = useAutopilotProfile(vehicleId);
  const savingsQuery = useAutopilotSavings(vehicleId);
  const ratePlansQuery = useRatePlans();
  const profileState = useDataState(profileQuery);
  const savingsState = useDataState({ ...savingsQuery, data: savingsQuery.data ?? undefined }, { provenance: 'historical' });
  const ratePlansState = useDataState(ratePlansQuery);
  const saveMutation = useSaveAutopilotProfile();
  const previewMutation = useAutopilotPreview();
  const runMutation = useAutopilotRun();

  const stored = profileState.data;
  const [enabled, setEnabled] = useState(false);
  const [readyBy, setReadyBy] = useState('07:30');
  const [targetSoc, setTargetSoc] = useState(80);
  const [dailyCap, setDailyCap] = useState(80);
  const [tripOverride, setTripOverride] = useState(false);
  const [precondition, setPrecondition] = useState(true);
  const [ratePlanId, setRatePlanId] = useState('pge-ev2a');
  const [maxAmps, setMaxAmps] = useState(32);
  const [currentSoc, setCurrentSoc] = useState(50);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (stored && !hydrated) {
      setEnabled(stored.enabled);
      setReadyBy(stored.ready_by);
      setTargetSoc(stored.target_soc);
      setDailyCap(stored.daily_cap_soc);
      setTripOverride(stored.trip_override);
      setPrecondition(stored.precondition);
      setRatePlanId(stored.rate_plan);
      setMaxAmps(stored.max_amps);
      setHydrated(true);
    }
  }, [stored, hydrated]);

  const profileReady = stored != null && hydrated;
  const persistedEnabled = typeof stored?.enabled === 'boolean' ? stored.enabled : undefined;
  const enableDraftChanged = profileReady && persistedEnabled != null && enabled !== persistedEnabled;
  const ratePlans = safeArray(ratePlansState.data);
  const ratePlanOptions = ratePlans.length
    ? ratePlans.map(plan => ({ value: plan.id, label: `${plan.name} (${plan.utility})` }))
    : [{ value: 'pge-ev2a', label: 'PG&E EV2-A' }];

  const handleSave = () => {
    if (!vehicleId || !profileReady) return;
    const profile: AutopilotProfile = {
      vehicle_id: vehicleId,
      enabled,
      target_soc: targetSoc,
      ready_by: readyBy,
      rate_plan: ratePlanId,
      daily_cap_soc: dailyCap,
      trip_override: tripOverride,
      precondition,
      max_amps: maxAmps,
      battery_capacity_kwh: stored?.battery_capacity_kwh ?? 75,
    };
    saveMutation.mutate(profile);
  };
  const handlePreview = () => {
    if (vehicleId && profileReady) previewMutation.mutate({ vehicle_id: vehicleId, current_soc: currentSoc });
  };
  const handleRun = () => {
    if (vehicleId && profileReady && persistedEnabled === true && !saveMutation.isPending) {
      runMutation.mutate({ vehicle_id: vehicleId, current_soc: currentSoc });
    }
  };

  const [retainedPreview, setRetainedPreview] = useState<{
    vehicleId: number | undefined;
    data: NonNullable<typeof previewMutation.data>;
  } | null>(null);
  useEffect(() => {
    if (previewMutation.data != null && !previewMutation.isPending && !previewMutation.isError) {
      setRetainedPreview({ vehicleId, data: previewMutation.data });
    }
  }, [previewMutation.data, previewMutation.isPending, previewMutation.isError, vehicleId]);
  const preview = previewMutation.data ?? (retainedPreview && retainedPreview.vehicleId === vehicleId ? retainedPreview.data : undefined);
  const previewState = useDataState({
    data: preview,
    error: previewMutation.error,
    isError: previewMutation.isError,
    isFetching: previewMutation.isPending && !previewMutation.isPaused,
    fetchStatus: previewMutation.isPaused ? 'paused' : previewMutation.isPending ? 'fetching' : 'idle',
    refetch: vehicleId && profileReady && !previewMutation.isPending ? handlePreview : undefined,
  }, { provenance: 'inferred' });
  const savings = savingsState.data;
  const saveError = saveMutation.isError
    ? saveMutation.error?.message || t('autopilot.saveError', 'Failed to save autopilot settings') : '';
  const runError = runMutation.isError
    ? runMutation.error?.message || t('autopilot.runError', 'Run failed') : '';
  const runResult = runMutation.isSuccess && !runMutation.isPending && !runMutation.isPaused && !runMutation.isError
    ? runMutation.data ?? null : null;
  const previewMetrics: StatMetric[] = [
    {
      metricId: 'text', occurrenceId: 'next-window',
      label: t('autopilot.nextWindow', 'Next window'),
      rawValue: preview ? formatTime(preview.window.start_time) : null,
      context: preview ? t('autopilot.windowEnd', 'ends {{end}}', { end: formatTime(preview.window.end_time) }) : undefined,
    },
    {
      metricId: 'currency', occurrenceId: 'preview-savings',
      label: t('autopilot.previewSavings', 'Saves vs now'),
      rawValue: preview ? knownNumber(preview.savings) : null,
      display: { formatter: raw => ({ value: formatCurrency(raw), unit: '' }) },
      comparisonContent: preview && preview.savings > 0 && knownNumber(preview.savings_percent) != null
        ? <Text variant="bodySm">{fmtPercent(preview.savings_percent)}</Text> : undefined,
    },
  ];

  return (
    <LayoutCard title={t('autopilot.title', 'Charging Autopilot')}
      actions={<div className="flex flex-wrap items-center gap-3">
        <Badge variant={persistedEnabled === true ? 'success' : 'neutral'} size="sm">
          {persistedEnabled == null ? t('common.unknown', 'Unknown')
            : persistedEnabled ? t('autopilot.on', 'Autopilot on') : t('autopilot.off', 'Autopilot off')}
        </Badge>
        {enableDraftChanged && <Caption>
          {t('draft.recovery.fallbackLabel', 'Unsaved draft')}: {enabled ? t('common.on', 'On') : t('common.off', 'Off')}
        </Caption>}
        <Toggle checked={enabled} onChange={setEnabled} disabled={!profileReady}
          aria-label={t('autopilot.enable', 'Enable autopilot')} />
      </div>}>
      <StaleRefreshWarning state={profileState} />
      {profileState.fatalError && <QueryError error={profileState.fatalError} onRetry={() => void profileQuery.refetch()} />}
        <Grid cols={columns}>
          <div className="min-w-0 space-y-4">
            {profileQuery.isLoading && profileQuery.fetchStatus !== 'paused' && !stored ? <Skeleton height={180} /> : <>
            {!profileReady && !profileState.fatalError && vehicleId && (
              <Button variant="secondary" onClick={() => void profileQuery.refetch()}
                disabled={profileQuery.isFetching}>
                {t('error.retry', 'Retry')}
              </Button>
            )}
            <Input label={t('autopilot.readyBy', 'Ready by (daily)')} type="time"
              disabled={!profileReady} value={readyBy} onChange={event => setReadyBy(event.target.value)} />
            <Slider id="autopilot-current-soc" label={t('autopilot.currentSoc', 'Current SOC')}
              disabled={!profileReady} formatValue={value => `${value}%`} min={0} max={100} step={1} value={currentSoc} onChange={setCurrentSoc} />
            <Slider id="autopilot-target-soc" label={t('autopilot.targetSoc', 'Target SOC')}
              disabled={!profileReady} formatValue={value => `${value}%`} min={20} max={100} step={5} value={targetSoc} onChange={setTargetSoc} />
            <Slider id="autopilot-daily-cap" label={t('autopilot.dailyCap', 'Daily health cap')}
              disabled={!profileReady} formatValue={value => `${value}%`} min={50} max={100} step={5} value={dailyCap} onChange={setDailyCap} />
            <StaleRefreshWarning state={ratePlansState} />
            {ratePlansState.fatalError && <QueryError error={ratePlansState.fatalError}
              onRetry={() => void ratePlansQuery.refetch()} resourceName={t('chargePlanner.ratePlansResource', 'rate plans')} compact />}
            <Select label={t('autopilot.ratePlan', 'Rate plan')} options={ratePlanOptions}
              disabled={!profileReady} value={ratePlanId} onChange={event => setRatePlanId(event.target.value)} />
            <Input label={t('autopilot.maxAmps', 'Max amps')} type="number" min={8} max={80}
              disabled={!profileReady} value={String(maxAmps)} onChange={event => setMaxAmps(Number(event.target.value))} />
            <div className="flex flex-wrap gap-5">
              <Toggle label={t('autopilot.tripOverride', 'Trip override (allow 100%)')}
                disabled={!profileReady} checked={tripOverride} onChange={setTripOverride} size="sm" />
              <Toggle label={t('autopilot.precondition', 'Precondition before departure')}
                disabled={!profileReady} checked={precondition} onChange={setPrecondition} size="sm" />
            </div>
            </>}
            <div className="flex flex-wrap gap-2">
              <Button wrapLabel className={actionClassName} onClick={handleSave}
                disabled={!vehicleId || !profileReady || saveMutation.isPending} loading={saveMutation.isPending}>
                {t('autopilot.save', 'Save Autopilot')}
              </Button>
              <Button wrapLabel className={actionClassName} variant="secondary" onClick={handlePreview}
                disabled={!vehicleId || !profileReady || previewMutation.isPending} loading={previewMutation.isPending}
                icon={<CalendarClock className="h-4 w-4" aria-hidden="true" />}>
                {t('autopilot.preview', 'Preview next run')}
              </Button>
              <Button wrapLabel className={actionClassName} variant="secondary" onClick={handleRun}
                disabled={!vehicleId || !profileReady || persistedEnabled !== true || saveMutation.isPending || runMutation.isPending} loading={runMutation.isPending}
                icon={<Zap className="h-4 w-4" aria-hidden="true" />}
                title={t('autopilot.runHint', 'Schedule the optimal window on the vehicle now')}>
                {t('autopilot.run', 'Run now')}
              </Button>
            </div>
            {saveError && <ErrorText>{saveError}</ErrorText>}
            {runError && <ErrorText>{runError}</ErrorText>}
            {runResult && <Badge variant="success" size="sm" className="gap-1">
              <Zap className="h-3.5 w-3.5" aria-hidden="true" />{runResult.message}
            </Badge>}
            {!vehicleId && <Caption>{t('autopilot.selectVehicle', 'Select a vehicle to configure autopilot.')}</Caption>}
          </div>

          <div className="min-w-0 space-y-4">
            <ChargingSummaryBrief id="smart-charge-autopilot-preview" metrics={previewMetrics}
              description={t('chargePlanner.modernization.previewContext', 'Estimated next charge window from the current profile and SOC input; not an applied schedule.')}
              loading={previewMutation.isPending && !previewMutation.isPaused && !previewState.hasData}
              retained={previewState.hasData && (previewMutation.isPending || previewState.refreshError != null)}
              period={{ kind: 'unknown', label: t('autopilot.preview', 'Preview next run'),
                reason: t('chargePlanner.modernization.previewContext', 'Estimated next charge window from the current profile and SOC input; not an applied schedule.') }} />
            <StaleRefreshWarning state={previewState} />
            {previewState.fatalError && <QueryError error={previewState.fatalError}
              onRetry={vehicleId && profileReady && !previewMutation.isPending ? handlePreview : undefined} compact />}
            {!preview && !previewMutation.isPending && !previewState.fatalError ? (
              <EmptyState /* no-action: use the adjacent Save and Preview controls */
                icon={<Bot className="h-8 w-8" aria-hidden="true" />}
                message={t('autopilot.runToPreview', 'Save your settings, then preview the next automatic charge window.')} />
            ) : preview ? (
              <>
                {preview.capped_by_health_guardrail && <Badge variant="warning" size="sm" className="gap-1">
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('autopilot.capped', 'Health cap: {{target}}% → {{effective}}%', {
                    target: targetSoc, effective: preview.effective_target_soc,
                  })}
                </Badge>}
                <Text as="p" variant="bodySm">{preview.explanation}</Text>
                <Text as="p" variant="caption" className="tabular-nums">
                  {t('autopilot.energyNeeded', '{{kwh}} kWh · ~{{hours}}h · {{tier}}', {
                    kwh: knownNumber(preview.kwh_needed) != null ? fmtNumber(preview.kwh_needed) : '—',
                    hours: knownNumber(preview.estimated_duration_hours) != null ? fmtNumber(preview.estimated_duration_hours) : '—',
                    tier: preview.window.rate_tier,
                  })}
                </Text>
              </>
            ) : null}
            <ChartCard title={t('chargePlanner.rateTimeline', '24-hour rate timeline')}
              ariaLabel={t('chargePlanner.rateTimelineChart', '24-hour electricity rate timeline')}
              data={safeArray(preview?.hourly_rates).map(({ hour, rate_cents, tier }) => ({ hour, rate_cents, tier }))}
              dataColumns={[
                { key: 'hour', label: t('powershare.time', 'Time') },
                { key: 'rate_cents', label: t('chargePlanner.modernization.rateCentsPerKwh', 'Rate (cents/kWh)') },
                { key: 'tier', label: t('chargePlanner.modernization.rateTier', 'Rate tier') },
              ]}>
              {previewMutation.isPending && !previewMutation.isPaused && !preview
                ? <Skeleton height={120} />
                : <RateTimeline rates={safeArray(preview?.hourly_rates)}
                  chargeWindow={preview ? { startHour: new Date(preview.window.start_time).getHours(),
                    endHour: new Date(preview.window.end_time).getHours() || 24 } : undefined} />}
            </ChartCard>
            <StaleRefreshWarning state={savingsState} />
            {savingsState.fatalError && <QueryError error={savingsState.fatalError} onRetry={() => void savingsQuery.refetch()} />}
              <ChargingSummaryBrief id="smart-charge-autopilot-savings" title={t('autopilot.realized', 'Realized savings')}
                loading={savingsQuery.isLoading && savingsQuery.fetchStatus !== 'paused' && !savingsState.hasData}
                retained={savingsState.hasData && (savingsState.isRefreshing || savingsState.refreshError != null || savingsState.isRefreshBlocked)}
                footer={!savingsState.hasData && (savingsState.isRefreshBlocked || savingsQuery.data === null) && !savingsState.fatalError && !savingsQuery.isFetching && vehicleId
                  ? <Button variant="secondary" onClick={() => void savingsQuery.refetch()}>{t('error.retry', 'Retry')}</Button>
                  : undefined}
                metrics={[{ metricId: 'currency', occurrenceId: 'realized-savings',
                  label: t('autopilot.realized', 'Realized savings'), rawValue: savings?.total_savings,
                  display: { formatter: raw => ({ value: formatCurrency(raw), unit: '' }) },
                  context: savings ? t('autopilot.realizedValue', '{{total}} across {{runs}} runs', {
                    total: knownNumber(savings.total_savings) != null ? formatCurrency(savings.total_savings) : '—',
                    runs: knownNumber(savings.runs) ?? '—',
                  }) : undefined }]}
                period={{ kind: 'unknown', label: t('autopilot.realized', 'Realized savings'),
                  reason: t('charging.brief.autopilotSavingsScope',
                    'Independent autopilot savings source; its time bounds are not reported and it is not scoped by the planner departure date.') }} />
          </div>
        </Grid>
    </LayoutCard>
  );
}
