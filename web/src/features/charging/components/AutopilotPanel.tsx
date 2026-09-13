import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, PiggyBank, ShieldCheck, CalendarClock, Zap } from 'lucide-react';

import {
  GlassPanel,
  Button,
  Select,
  Input,
  Slider,
  Toggle,
  Badge,
  PanelTitle,
  Text,
  Caption,
  ErrorText,
} from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState } from '@/components/feedback';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useFormatting } from '@/hooks/useFormatting';
import { fmtNumber, fmtPercent } from '@/lib/numberFormat';
import {
  useAutopilotProfile,
  useSaveAutopilotProfile,
  useAutopilotPreview,
  useAutopilotRun,
  useAutopilotSavings,
  useRatePlans,
} from '@/api/hooks/useCharging';
import { RateTimeline } from './RateTimeline';
import type { AutopilotProfile } from '@/types/charging';

interface AutopilotPanelProps {
  vehicleId?: number;
}

/**
 * Charging Autopilot — the always-on layer above one-shot Smart Charge.
 * Owns the per-vehicle profile (ready-by, target, health guardrails),
 * previews the next automatic run, and surfaces realized savings.
 * Built from the same primitives as SmartChargePage (GlassPanel,
 * MetricCard, Toggle/Slider/Select/Input, RateTimeline) so it reads as
 * one product, not a bolt-on.
 */
export function AutopilotPanel({ vehicleId }: AutopilotPanelProps) {
  const { t } = useTranslation();
  const { formatTime } = useDateFormat();
  const { formatCurrency } = useFormatting();

  const profileQuery = useAutopilotProfile(vehicleId);
  const savingsQuery = useAutopilotSavings(vehicleId);
  const { data: ratePlans } = useRatePlans();
  const saveMutation = useSaveAutopilotProfile();
  const previewMutation = useAutopilotPreview();
  const runMutation = useAutopilotRun();

  const stored = profileQuery.data;
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

  // Seed the form once the stored profile arrives.
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

  const ratePlanOptions =
    (ratePlans ?? []).length > 0
      ? (ratePlans ?? []).map((p) => ({ value: p.id, label: `${p.name} (${p.utility})` }))
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
    if (!vehicleId) return;
    previewMutation.mutate({ vehicle_id: vehicleId, current_soc: currentSoc });
  };

  const handleRun = () => {
    if (!vehicleId) return;
    runMutation.mutate({ vehicle_id: vehicleId, current_soc: currentSoc });
  };

  const preview = previewMutation.data ?? null;
  const savings = savingsQuery.data;
  const saveError =
    saveMutation.isError
      ? (saveMutation.error as Error)?.message || t('autopilot.saveError', 'Failed to save autopilot settings')
      : '';
  const previewError =
    previewMutation.isError
      ? (previewMutation.error as Error)?.message || t('autopilot.previewError', 'Preview failed')
      : '';
  const runError =
    runMutation.isError
      ? (runMutation.error as Error)?.message || t('autopilot.runError', 'Run failed')
      : '';
  const runResult = runMutation.data ?? null;

  return (
    <GlassPanel className="p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <PanelTitle className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('autopilot.title', 'Charging Autopilot')}
        </PanelTitle>
        <div className="flex items-center gap-3">
          <Badge variant={enabled ? 'success' : 'neutral'} size="sm">
            {enabled
              ? t('autopilot.on', 'Autopilot on')
              : t('autopilot.off', 'Autopilot off')}
          </Badge>
          <Toggle
            checked={enabled}
            onChange={setEnabled}
            aria-label={t('autopilot.enable', 'Enable autopilot')}
          />
        </div>
      </div>

      {profileQuery.isLoading ? (
        <Skeleton height={180} />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Settings */}
          <div className="space-y-4">
            <Input
              label={t('autopilot.readyBy', 'Ready by (daily)')}
              type="time"
              value={readyBy}
              onChange={(e) => setReadyBy(e.target.value)}
            />
            <Slider
              id="autopilot-current-soc"
              label={t('autopilot.currentSoc', 'Current SOC')}
              formatValue={(n) => `${n}%`}
              min={0}
              max={100}
              step={1}
              value={currentSoc}
              onChange={setCurrentSoc}
            />
            <Slider
              id="autopilot-target-soc"
              label={t('autopilot.targetSoc', 'Target SOC')}
              formatValue={(n) => `${n}%`}
              min={20}
              max={100}
              step={5}
              value={targetSoc}
              onChange={setTargetSoc}
            />
            <Slider
              id="autopilot-daily-cap"
              label={t('autopilot.dailyCap', 'Daily health cap')}
              formatValue={(n) => `${n}%`}
              min={50}
              max={100}
              step={5}
              value={dailyCap}
              onChange={setDailyCap}
            />
            <Select
              label={t('autopilot.ratePlan', 'Rate plan')}
              options={ratePlanOptions}
              value={ratePlanId}
              onChange={(e) => setRatePlanId(e.target.value)}
            />
            <Input
              label={t('autopilot.maxAmps', 'Max amps')}
              type="number"
              min={8}
              max={80}
              value={String(maxAmps)}
              onChange={(e) => setMaxAmps(Number(e.target.value))}
            />
            <div className="flex flex-wrap gap-5">
              <Toggle
                label={t('autopilot.tripOverride', 'Trip override (allow 100%)')}
                checked={tripOverride}
                onChange={setTripOverride}
                size="sm"
              />
              <Toggle
                label={t('autopilot.precondition', 'Precondition before departure')}
                checked={precondition}
                onChange={setPrecondition}
                size="sm"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={handleSave} disabled={!vehicleId || saveMutation.isPending} loading={saveMutation.isPending}>
                {t('autopilot.save', 'Save Autopilot')}
              </Button>
              <Button
                variant="secondary"
                onClick={handlePreview}
                disabled={!vehicleId || previewMutation.isPending}
                loading={previewMutation.isPending}
                icon={<CalendarClock className="h-4 w-4" aria-hidden="true" />}
                className="gap-2"
              >
                {t('autopilot.preview', 'Preview next run')}
              </Button>
              <Button
                variant="secondary"
                onClick={handleRun}
                disabled={!vehicleId || !enabled || runMutation.isPending}
                loading={runMutation.isPending}
                icon={<Zap className="h-4 w-4" aria-hidden="true" />}
                className="gap-2"
                title={t('autopilot.runHint', 'Schedule the optimal window on the vehicle now')}
              >
                {t('autopilot.run', 'Run now')}
              </Button>
            </div>
            {saveError && <ErrorText>{saveError}</ErrorText>}
            {runError && <ErrorText>{runError}</ErrorText>}
            {runResult && (
              <Badge variant="success" size="sm" className="gap-1">
                <Zap className="h-3.5 w-3.5" aria-hidden="true" />
                {runResult.message}
              </Badge>
            )}
            {!vehicleId && (
              <Caption>
                {t('autopilot.selectVehicle', 'Select a vehicle to configure autopilot.')}
              </Caption>
            )}
          </div>

          {/* Next run + savings */}
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <MetricCard
                label={t('autopilot.nextWindow', 'Next window')}
                value={preview ? `${formatTime(preview.window.start_time)}` : '—'}
                icon={<CalendarClock className="h-5 w-5" aria-hidden="true" />}
                color="cyan"
                subtitle={
                  preview
                    ? t('autopilot.windowEnd', 'ends {{end}}', { end: formatTime(preview.window.end_time) })
                    : undefined
                }
              />
              <MetricCard
                label={t('autopilot.previewSavings', 'Saves vs now')}
                value={preview ? formatCurrency(preview.savings ?? 0) : '—'}
                icon={<PiggyBank className="h-5 w-5" aria-hidden="true" />}
                color="green"
                change={
                  preview && (preview.savings ?? 0) > 0
                    ? { value: fmtPercent(preview.savings_percent ?? 0, 0), positive: true }
                    : undefined
                }
              />
            </div>

            {previewMutation.isPending ? (
              <Skeleton height={120} />
            ) : previewError ? (
              <ErrorText>{previewError}</ErrorText>
            ) : !preview ? (
              <EmptyState
                icon={<Bot className="h-8 w-8" />}
                message={t(
                  'autopilot.runToPreview',
                  'Save your settings, then preview the next automatic charge window.',
                )}
              />
            ) : (
              <>
                {preview.capped_by_health_guardrail && (
                  <Badge variant="warning" size="sm" className="gap-1">
                    <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                    {t('autopilot.capped', 'Health cap: {{target}}% → {{effective}}%', {
                      target: targetSoc,
                      effective: preview.effective_target_soc,
                    })}
                  </Badge>
                )}
                <Text as="p" variant="bodySm">
                  {preview.explanation}
                </Text>
                <Text as="p" variant="caption" className="tabular-nums">
                  {t('autopilot.energyNeeded', '{{kwh}} kWh · ~{{hours}}h · {{tier}}', {
                    kwh: fmtNumber(preview.kwh_needed ?? 0, 1),
                    hours: fmtNumber(preview.estimated_duration_hours ?? 0, 1),
                    tier: preview.window.rate_tier,
                  })}
                </Text>
                <RateTimeline
                  rates={preview.hourly_rates ?? []}
                  chargeWindow={
                    preview.window
                      ? {
                          startHour: new Date(preview.window.start_time).getHours(),
                          endHour: new Date(preview.window.end_time).getHours() || 24,
                        }
                      : undefined
                  }
                />
              </>
            )}

            <div className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.03] px-3 py-2">
              <Text variant="bodySm" className="font-medium">
                {t('autopilot.realized', 'Realized savings')}
              </Text>
              <Text variant="bodySm" className="tabular-nums">
                {savings
                  ? t('autopilot.realizedValue', '{{total}} across {{runs}} runs', {
                      total: formatCurrency(savings.total_savings ?? 0),
                      runs: savings.runs ?? 0,
                    })
                  : '—'}
              </Text>
            </div>
          </div>
        </div>
      )}
    </GlassPanel>
  );
}
