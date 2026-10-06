import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, ShieldCheck, CalendarClock, Zap } from 'lucide-react';
import { LayoutCard, ChartCard } from '@/components/layout/layout-reference';
import { Grid } from '@/components/layout';
import { Button, Select, Input, Slider, Toggle, Badge, Text, Caption, ErrorText } from '@/components/ui';
import { StatStrip, type StatMetric } from '@/components/data-display/stat-reference';
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
  const savingsState = useDataState(savingsQuery, { provenance: 'historical' });
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

  const ratePlans = safeArray(ratePlansState.data);
  const ratePlanOptions = ratePlans.length
    ? ratePlans.map(plan => ({ value: plan.id, label: `${plan.name} (${plan.utility})` }))
    : [{ value: 'pge-ev2a', label: 'PG&E EV2-A' }];

  const handleSave = () => {
    if (!vehicleId) return;
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
    if (vehicleId) previewMutation.mutate({ vehicle_id: vehicleId, current_soc: currentSoc });
  };
  const handleRun = () => {
    if (vehicleId) runMutation.mutate({ vehicle_id: vehicleId, current_soc: currentSoc });
  };

  const preview = previewMutation.data ?? null;
  const savings = savingsState.data;
  const saveError = saveMutation.isError
    ? saveMutation.error?.message || t('autopilot.saveError', 'Failed to save autopilot settings') : '';
  const previewError = previewMutation.isError
    ? previewMutation.error?.message || t('autopilot.previewError', 'Preview failed') : '';
  const runError = runMutation.isError
    ? runMutation.error?.message || t('autopilot.runError', 'Run failed') : '';
  const runResult = runMutation.data ?? null;
  const previewMetrics: StatMetric[] = [
    {
      metricId: 'text', occurrenceId: 'next-window',
      label: t('autopilot.nextWindow', 'Next window'),
      rawValue: preview ? formatTime(preview.window.start_time) : null,
      context: preview ? t('autopilot.windowEnd', 'ends {{end}}', { end: formatTime(preview.window.end_time) }) : undefined,
    },
    {
      metricId: 'text', occurrenceId: 'preview-savings',
      label: t('autopilot.previewSavings', 'Saves vs now'),
      rawValue: preview && knownNumber(preview.savings) != null ? formatCurrency(preview.savings) : null,
      comparisonContent: preview && preview.savings > 0 && knownNumber(preview.savings_percent) != null
        ? <Text variant="bodySm">{fmtPercent(preview.savings_percent)}</Text> : undefined,
    },
  ];

  return (
    <LayoutCard title={t('autopilot.title', 'Charging Autopilot')}
      actions={<div className="flex flex-wrap items-center gap-3">
        <Badge variant={enabled ? 'success' : 'neutral'} size="sm">
          {enabled ? t('autopilot.on', 'Autopilot on') : t('autopilot.off', 'Autopilot off')}
        </Badge>
        <Toggle checked={enabled} onChange={setEnabled} aria-label={t('autopilot.enable', 'Enable autopilot')} />
      </div>}>
      <StaleRefreshWarning state={profileState} />
      {profileState.fatalError && <QueryError error={profileState.fatalError} onRetry={() => void profileQuery.refetch()} />}
      {profileQuery.isLoading && !profileState.hasData ? <Skeleton height={180} /> : (
        <Grid cols={columns}>
          <div className="min-w-0 space-y-4">
            <Input label={t('autopilot.readyBy', 'Ready by (daily)')} type="time"
              value={readyBy} onChange={event => setReadyBy(event.target.value)} />
            <Slider id="autopilot-current-soc" label={t('autopilot.currentSoc', 'Current SOC')}
              formatValue={value => `${value}%`} min={0} max={100} step={1} value={currentSoc} onChange={setCurrentSoc} />
            <Slider id="autopilot-target-soc" label={t('autopilot.targetSoc', 'Target SOC')}
              formatValue={value => `${value}%`} min={20} max={100} step={5} value={targetSoc} onChange={setTargetSoc} />
            <Slider id="autopilot-daily-cap" label={t('autopilot.dailyCap', 'Daily health cap')}
              formatValue={value => `${value}%`} min={50} max={100} step={5} value={dailyCap} onChange={setDailyCap} />
            <StaleRefreshWarning state={ratePlansState} />
            {ratePlansState.fatalError && <QueryError error={ratePlansState.fatalError}
              onRetry={() => void ratePlansQuery.refetch()} resourceName={t('chargePlanner.ratePlansResource', 'rate plans')} compact />}
            <Select label={t('autopilot.ratePlan', 'Rate plan')} options={ratePlanOptions}
              value={ratePlanId} onChange={event => setRatePlanId(event.target.value)} />
            <Input label={t('autopilot.maxAmps', 'Max amps')} type="number" min={8} max={80}
              value={String(maxAmps)} onChange={event => setMaxAmps(Number(event.target.value))} />
            <div className="flex flex-wrap gap-5">
              <Toggle label={t('autopilot.tripOverride', 'Trip override (allow 100%)')}
                checked={tripOverride} onChange={setTripOverride} size="sm" />
              <Toggle label={t('autopilot.precondition', 'Precondition before departure')}
                checked={precondition} onChange={setPrecondition} size="sm" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={handleSave} disabled={!vehicleId || saveMutation.isPending} loading={saveMutation.isPending}>
                {t('autopilot.save', 'Save Autopilot')}
              </Button>
              <Button variant="secondary" onClick={handlePreview}
                disabled={!vehicleId || previewMutation.isPending} loading={previewMutation.isPending}
                icon={<CalendarClock className="h-4 w-4" aria-hidden="true" />}>
                {t('autopilot.preview', 'Preview next run')}
              </Button>
              <Button variant="secondary" onClick={handleRun}
                disabled={!vehicleId || !enabled || runMutation.isPending} loading={runMutation.isPending}
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
            <StatStrip id="smart-charge-autopilot-preview" metrics={previewMetrics}
              period={{ kind: 'unknown', label: t('autopilot.preview', 'Preview next run'),
                reason: t('chargePlanner.modernization.previewContext', 'Estimated next charge window from the current profile and SOC input; not an applied schedule.') }} />
            {previewMutation.isPending ? <Skeleton height={120} /> : previewError ? (
              <ErrorText>{previewError}</ErrorText>
            ) : !preview ? (
              <EmptyState /* no-action: use the adjacent Save and Preview controls */
                icon={<Bot className="h-8 w-8" aria-hidden="true" />}
                message={t('autopilot.runToPreview', 'Save your settings, then preview the next automatic charge window.')} />
            ) : (
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
                <ChartCard title={t('chargePlanner.rateTimeline', '24-hour rate timeline')}
                  ariaLabel={t('chargePlanner.rateTimelineChart', '24-hour electricity rate timeline')}
                  data={safeArray(preview.hourly_rates).map(({ hour, rate_cents, tier }) => ({ hour, rate_cents, tier }))}
                  dataColumns={[
                    { key: 'hour', label: t('powershare.time', 'Time') },
                    { key: 'rate_cents', label: t('chargePlanner.modernization.rateCentsPerKwh', 'Rate (cents/kWh)') },
                    { key: 'tier', label: t('chargePlanner.modernization.rateTier', 'Rate tier') },
                  ]}>
                  <RateTimeline rates={safeArray(preview.hourly_rates)}
                    chargeWindow={{ startHour: new Date(preview.window.start_time).getHours(),
                      endHour: new Date(preview.window.end_time).getHours() || 24 }} />
                </ChartCard>
              </>
            )}
            <StaleRefreshWarning state={savingsState} />
            {savingsState.fatalError ? <QueryError error={savingsState.fatalError} onRetry={() => void savingsQuery.refetch()} /> : (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--surface-2)] px-3 py-2">
                <Text variant="bodySm" className="font-medium">{t('autopilot.realized', 'Realized savings')}</Text>
                {savingsQuery.isLoading && !savingsState.hasData ? <Skeleton lines={1} /> : (
                  <Text variant="bodySm" className="tabular-nums">
                    {savings ? t('autopilot.realizedValue', '{{total}} across {{runs}} runs', {
                      total: knownNumber(savings.total_savings) != null ? formatCurrency(savings.total_savings) : '—',
                      runs: knownNumber(savings.runs) ?? '—',
                    }) : '—'}
                  </Text>
                )}
              </div>
            )}
          </div>
        </Grid>
      )}
    </LayoutCard>
  );
}
