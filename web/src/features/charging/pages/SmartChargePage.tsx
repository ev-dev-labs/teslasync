import { useState, useMemo } from 'react';
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

import { PageContainer, Grid } from '@/components/layout';
import { GlassPanel, Button, Select, Input } from '@/components/ui';
import { StatCard } from '@/components/data-display';
import { FadeIn } from '@/components/motion';
import { EmptyState, Spinner } from '@/components/feedback';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useVehicles } from '@/api/hooks/useVehicles';
import {
  useOptimizeCharge,
  useApplySchedule,
  useChargePlans,
  useRatePlans,
} from '@/api/hooks/useCharging';
import { RateTimeline } from '../components/RateTimeline';
import type { OptimizeChargeResponse } from '@/types/charging';

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}

const defaultDepartBy = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(7, 30, 0, 0);
  return d.toISOString().slice(0, 16); // yyyy-MM-ddTHH:mm for datetime-local input
};

export default function SmartChargePage() {
  const { t } = useTranslation();
  usePageTitle(t('chargePlanner.title', 'Smart Charge'));

  // Data hooks
  const { data: vehicles } = useVehicles();
  const { data: ratePlans } = useRatePlans();
  const optimizeMutation = useOptimizeCharge();
  const applyMutation = useApplySchedule();

  // Form state
  const [vehicleId, setVehicleId] = useState<string>('');
  const [targetSoc, setTargetSoc] = useState(80);
  const [departBy, setDepartBy] = useState(defaultDepartBy);
  const [ratePlanId, setRatePlanId] = useState('pge-ev2a');
  const [maxAmps, setMaxAmps] = useState(32);
  const [batteryCapacity, setBatteryCapacity] = useState(75);

  // Result state
  const [result, setResult] = useState<OptimizeChargeResponse | null>(null);
  const [applied, setApplied] = useState(false);

  const vehicleIdNum = vehicleId ? Number(vehicleId) : undefined;
  const { data: plans } = useChargePlans(vehicleIdNum);

  const vehicleOptions = useMemo(() =>
    (vehicles ?? []).map(v => ({
      value: String(v.id),
      label: v.display_name || `Vehicle ${v.id}`,
    })),
    [vehicles],
  );

  const ratePlanOptions = useMemo(() =>
    (ratePlans ?? []).map(p => ({
      value: p.id,
      label: `${p.name} (${p.utility})`,
    })),
    [ratePlans],
  );

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

  return (
    <PageContainer
      title={t('chargePlanner.title', 'Smart Charge')}
      subtitle={t('chargePlanner.subtitle', 'Optimize charging schedule for the cheapest TOU rates')}
    >
      {/* ── Settings Section ── */}
      <FadeIn>
        <GlassPanel className="p-6">
          <h2 className="text-lg font-semibold text-white/90 mb-4 flex items-center gap-2">
            <Zap className="h-5 w-5 text-cyan-400" />
            {t('chargePlanner.settings', 'Charge Settings')}
          </h2>

          <Grid cols={{ default: 1, sm: 2, lg: 4 }} gap={4}>
            <Select
              label={t('chargePlanner.vehicle', 'Vehicle')}
              options={vehicleOptions}
              value={vehicleId}
              onChange={e => setVehicleId(e.target.value)}
              placeholder={t('chargePlanner.selectVehicle', 'Select vehicle...')}
            />

            <Select
              label={t('chargePlanner.ratePlan', 'Rate Plan')}
              options={ratePlanOptions.length > 0 ? ratePlanOptions : [
                { value: 'pge-ev2a', label: 'PG&E EV2-A' },
                { value: 'sce-tou-d', label: 'SCE TOU-D' },
                { value: 'sdge-tou-dr1', label: 'SDG&E TOU-DR1' },
              ]}
              value={ratePlanId}
              onChange={e => setRatePlanId(e.target.value)}
            />

            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-300">
                {t('chargePlanner.targetSoc', 'Target SOC')} — {targetSoc}%
              </label>
              <input
                type="range"
                min={20}
                max={100}
                step={5}
                value={targetSoc}
                onChange={e => setTargetSoc(Number(e.target.value))}
                className="w-full accent-cyan-400"
              />
            </div>

            <Input
              label={t('chargePlanner.departBy', 'Depart By')}
              type="datetime-local"
              value={departBy}
              onChange={e => setDepartBy(e.target.value)}
            />

            <Input
              label={t('chargePlanner.maxAmps', 'Max Amps')}
              type="number"
              min={8}
              max={80}
              value={String(maxAmps)}
              onChange={e => setMaxAmps(Number(e.target.value))}
            />

            <Input
              label={t('chargePlanner.batteryCapacity', 'Battery Capacity (kWh)')}
              type="number"
              min={40}
              max={130}
              value={String(batteryCapacity)}
              onChange={e => setBatteryCapacity(Number(e.target.value))}
            />
          </Grid>

          <div className="mt-4 flex justify-end">
            <Button
              onClick={handleOptimize}
              disabled={!vehicleId || optimizeMutation.isPending}
              className="gap-2"
            >
              {optimizeMutation.isPending ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <CalendarClock className="h-4 w-4" />
              )}
              {t('chargePlanner.optimize', 'Find Cheapest Window')}
            </Button>
          </div>

          {optimizeMutation.isError && (
            <p className="mt-3 text-sm text-red-400">
              {(optimizeMutation.error as Error)?.message || t('chargePlanner.optimizeError', 'Optimization failed')}
            </p>
          )}
        </GlassPanel>
      </FadeIn>

      {/* ── Rate Timeline ── */}
      {result && (
        <FadeIn delay={0.05}>
          <GlassPanel className="p-6">
            <h2 className="text-lg font-semibold text-white/90 mb-4 flex items-center gap-2">
              <Clock className="h-5 w-5 text-cyan-400" />
              {t('chargePlanner.rateTimeline', '24-Hour Rate Timeline')}
            </h2>
            <RateTimeline rates={result.hourly_rates} chargeWindow={chargeWindow} />
            <p className="mt-3 text-sm text-white/50">
              {t('chargePlanner.windowInfo', 'Optimal window: {{start}} — {{end}}', {
                start: formatTime(result.schedule.start_time),
                end: formatTime(result.schedule.end_time),
              })}
            </p>
          </GlassPanel>
        </FadeIn>
      )}

      {/* ── Cost Comparison ── */}
      {result && (
        <FadeIn delay={0.1}>
          <Grid cols={{ default: 1, md: 3 }} gap={4}>
            <StatCard
              label={t('chargePlanner.chargeNowCost', 'Charge Now')}
              value={`$${result.comparison.charge_now_cost.toFixed(2)}`}
              icon={<DollarSign className="h-5 w-5 text-red-400" />}
              sublabel={t('chargePlanner.currentRate', 'At current rates')}
            />
            <StatCard
              label={t('chargePlanner.optimizedCost', 'Optimized Cost')}
              value={`$${result.comparison.optimized_cost.toFixed(2)}`}
              icon={<TrendingDown className="h-5 w-5 text-emerald-400" />}
              sublabel={`${result.schedule.rate_tier} · ${result.schedule.rate_cents_kwh.toFixed(1)}¢/kWh`}
            />
            <StatCard
              label={t('chargePlanner.savings', 'Savings')}
              value={`$${result.comparison.savings.toFixed(2)}`}
              icon={<BatteryCharging className="h-5 w-5 text-cyan-400" />}
              trend={{
                direction: result.comparison.savings > 0 ? 'down' : 'flat',
                value: `${result.comparison.savings_percent.toFixed(0)}%`,
                positive: result.comparison.savings > 0,
              }}
              sublabel={`${result.kwh_needed.toFixed(1)} kWh · ~${result.estimated_duration_hours.toFixed(1)}h`}
            />
          </Grid>
        </FadeIn>
      )}

      {/* ── Schedule Details & Apply ── */}
      {result && (
        <FadeIn delay={0.15}>
          <GlassPanel className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white/90 flex items-center gap-2">
                <CalendarClock className="h-5 w-5 text-cyan-400" />
                {t('chargePlanner.schedule', 'Recommended Schedule')}
              </h2>
              {!applied ? (
                <Button
                  onClick={handleApply}
                  disabled={applyMutation.isPending}
                  className="gap-2"
                >
                  {applyMutation.isPending ? (
                    <Spinner className="h-4 w-4" />
                  ) : (
                    <Zap className="h-4 w-4" />
                  )}
                  {t('chargePlanner.applySchedule', 'Apply Schedule')}
                </Button>
              ) : (
                <span className="flex items-center gap-2 text-emerald-400 text-sm font-medium">
                  <CheckCircle2 className="h-4 w-4" />
                  {t('chargePlanner.applied', 'Schedule Applied!')}
                </span>
              )}
            </div>

            {applyMutation.isError && (
              <p className="mb-3 text-sm text-red-400">
                {(applyMutation.error as Error)?.message || t('chargePlanner.applyError', 'Failed to apply schedule')}
              </p>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span className="text-white/50">{t('chargePlanner.currentSoc', 'Current SOC')}</span>
                <p className="text-white/90 font-medium">{result.current_soc}%</p>
              </div>
              <div>
                <span className="text-white/50">{t('chargePlanner.targetSocLabel', 'Target SOC')}</span>
                <p className="text-white/90 font-medium">{result.target_soc}%</p>
              </div>
              <div>
                <span className="text-white/50">{t('chargePlanner.startTime', 'Start Time')}</span>
                <p className="text-white/90 font-medium">{formatTime(result.schedule.start_time)}</p>
              </div>
              <div>
                <span className="text-white/50">{t('chargePlanner.endTime', 'End Time')}</span>
                <p className="text-white/90 font-medium">{formatTime(result.schedule.end_time)}</p>
              </div>
            </div>

            {/* Alternative windows */}
            {(result.alternative_windows ?? []).length > 0 && (
              <div className="mt-4 pt-4 border-t border-white/10">
                <h3 className="text-sm font-medium text-white/60 mb-2">
                  {t('chargePlanner.alternatives', 'Alternative Windows')}
                </h3>
                <div className="space-y-2">
                  {result.alternative_windows.map((alt, i) => (
                    <div key={i} className="flex items-center justify-between text-sm bg-white/[0.03] rounded-lg px-3 py-2">
                      <span className="text-white/70">
                        {formatTime(alt.start_time)} — {formatTime(alt.end_time)}
                      </span>
                      <span className="text-white/50">{alt.rate_tier}</span>
                      <span className="text-white/90 font-medium">${alt.estimated_cost.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </GlassPanel>
        </FadeIn>
      )}

      {/* ── History ── */}
      <FadeIn delay={result ? 0.2 : 0.05}>
        <GlassPanel className="p-6">
          <h2 className="text-lg font-semibold text-white/90 mb-4 flex items-center gap-2">
            <History className="h-5 w-5 text-cyan-400" />
            {t('chargePlanner.history', 'Plan History')}
          </h2>

          {historyItems.length > 0 ? (
            <div className="overflow-x-auto">
              <div className="grid grid-cols-[1fr_1fr_1fr_auto_auto_auto] gap-x-4 text-sm">
                <div className="contents text-white/50 border-b border-white/10">
                  <div className="py-2">{t('chargePlanner.date', 'Date')}</div>
                  <div className="py-2">{t('chargePlanner.window', 'Window')}</div>
                  <div className="py-2">{t('chargePlanner.plan', 'Plan')}</div>
                  <div className="py-2 text-right">{t('chargePlanner.cost', 'Cost')}</div>
                  <div className="py-2 text-right">{t('chargePlanner.savedAmount', 'Saved')}</div>
                  <div className="py-2">{t('chargePlanner.status', 'Status')}</div>
                </div>
                {historyItems.map(p => (
                  <div key={p.id} className="contents text-white/70">
                    <div className="py-2 border-b border-white/5">{formatDate(p.created_at)}</div>
                    <div className="py-2 border-b border-white/5">
                      {formatTime(p.scheduled_start)} — {formatTime(p.scheduled_end)}
                    </div>
                    <div className="py-2 border-b border-white/5">{p.rate_plan}</div>
                    <div className="py-2 border-b border-white/5 text-right">
                      {p.estimated_cost != null ? `$${p.estimated_cost.toFixed(2)}` : '—'}
                    </div>
                    <div className="py-2 border-b border-white/5 text-right text-emerald-400">
                      {p.savings != null && p.savings > 0 ? `$${p.savings.toFixed(2)}` : '—'}
                    </div>
                    <div className="py-2 border-b border-white/5">
                      <span className={
                        p.status === 'scheduled' ? 'text-cyan-400' :
                        p.status === 'completed' ? 'text-emerald-400' :
                        p.status === 'cancelled' ? 'text-red-400' :
                        'text-white/50'
                      }>
                        {p.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <EmptyState
              icon={<History className="h-10 w-10" />}
              message={t('chargePlanner.noHistory', 'No charge plans yet. Optimize a schedule above to get started.')}
            />
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
