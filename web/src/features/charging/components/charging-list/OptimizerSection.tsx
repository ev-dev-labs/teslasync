import { useTranslation } from 'react-i18next';
import { Calendar, DollarSign, Lightbulb, Shield } from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { LinearGauge } from '@/components/charts';
import { FadeIn } from '@/components/motion';
import { EmptyState } from '@/components/feedback';
import { AlertBanner } from '@/components/feedback';
import { fmtNumber, safeNumber } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import type { ChargingOptimizerData } from '@/types/charging';
import { CostHeatmap } from './CostHeatmap';

interface OptimizerSectionProps {
  optimizer: ChargingOptimizerData;
}

export function OptimizerSection({ optimizer }: OptimizerSectionProps) {
  const { t } = useTranslation();
  // Neutralise NaN/undefined so the gauge never emits a NaN stroke-dashoffset
  // (which renders a broken arc) and the threshold branches stay deterministic.
  const score = safeNumber(optimizer.battery_health_score);

  return (
    <>
      {/* Savings banner */}
      {optimizer.cost_analysis.potential_monthly_savings > 5 && (
        <FadeIn delay={0.23}>
          <AlertBanner
            variant="success"
            icon={<DollarSign className="h-5 w-5" aria-hidden="true" />}
            title={t('charging.optimizer.savingsBanner', 'Save ~${{amount}}/month by adjusting your charging schedule', { amount: fmtNumber(optimizer.cost_analysis.potential_monthly_savings, 0) })}
          >
            {t('charging.optimizer.savingsDetail', 'Based on your charging patterns, shifting to off-peak hours could reduce your monthly costs.')}
          </AlertBanner>
        </FadeIn>
      )}

      {/* Habits + Battery Score + Cost Analysis */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Current Habits */}
        <FadeIn delay={0.24}>
          <GlassPanel className="p-6">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
              <Calendar className="h-4 w-4 text-neon-cyan" aria-hidden="true" />
              {t('charging.optimizer.habits', 'Charging Habits')}
            </h3>
            <div className="space-y-3">
              {[
                { label: t('charging.optimizer.sessionsWeek', 'Sessions/week'), value: fmtNumber(optimizer.current_schedule.avg_sessions_per_week, 1) },
                { label: t('charging.optimizer.homePct', 'Home charging'), value: `${fmtNumber(optimizer.current_schedule.home_charging_pct, 0)}%` },
                { label: t('charging.optimizer.avgTarget', 'Avg charge target'), value: `${fmtNumber(optimizer.current_schedule.avg_charge_to_pct, 0)}%` },
                { label: t('charging.optimizer.commonHour', 'Common start hour'), value: optimizer.current_schedule.most_common_start_hour != null ? `${optimizer.current_schedule.most_common_start_hour}:00` : '—' },
                { label: t('charging.optimizer.commonDay', 'Most common'), value: optimizer.current_schedule.most_common_day ?? '—' },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between text-xs">
                  <span className="text-[var(--text-secondary)]">{item.label}</span>
                  <span className="font-semibold text-[var(--text-primary)]">{item.value}</span>
                </div>
              ))}
            </div>
          </GlassPanel>
        </FadeIn>

        {/* Battery Health Score */}
        <FadeIn delay={0.25}>
          <GlassPanel className="flex flex-col items-center justify-center p-6">
            <LinearGauge
              value={score}
              max={100}
              label={t('charging.optimizer.batteryScore', 'Battery-Friendly Score')}
              color={
                score >= 75 ? '#22c55e' :
                score >= 50 ? '#f59e0b' : '#ef4444'
              }
              size={150}
            />
            <p className="mt-2 text-xs text-[var(--text-secondary)]">
              {score >= 75
                ? t('charging.optimizer.scoreGood', 'Your habits are battery-friendly')
                : score >= 50
                ? t('charging.optimizer.scoreFair', 'Room for improvement')
                : t('charging.optimizer.scorePoor', 'Consider adjusting your habits')}
            </p>
          </GlassPanel>
        </FadeIn>

        {/* Cost Analysis */}
        <FadeIn delay={0.26}>
          <GlassPanel className="p-6">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
              <DollarSign className="h-4 w-4 text-neon-green" aria-hidden="true" />
              {t('charging.optimizer.costAnalysis', 'Cost Analysis')}
            </h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--text-secondary)]">{t('charging.optimizer.peakRate', 'Peak rate')}</span>
                <span className="font-semibold text-red-400">${fmtNumber(optimizer.cost_analysis.peak_cost_per_kwh, 3)}/kWh</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--text-secondary)]">{t('charging.optimizer.offpeakRate', 'Off-peak rate')}</span>
                <span className="font-semibold text-emerald-300">${fmtNumber(optimizer.cost_analysis.offpeak_cost_per_kwh, 3)}/kWh</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--text-secondary)]">{t('charging.optimizer.peakSessions', 'Sessions during peak')}</span>
                <span className={cn('font-semibold',
                  optimizer.cost_analysis.sessions_during_peak_pct > 30 ? 'text-red-400' : 'text-emerald-300',
                )}>
                  {fmtNumber(optimizer.cost_analysis.sessions_during_peak_pct, 0)}%
                </span>
              </div>
              <div className="mt-2 pt-2 border-t border-white/[0.06]">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[var(--text-secondary)]">{t('charging.optimizer.peakHours', 'Peak hours')}</span>
                  <span className="text-[var(--text-secondary)] tabular-nums">{(optimizer.cost_analysis.peak_hours ?? []).map((h) => `${h}:00`).join(', ') || '—'}</span>
                </div>
                <div className="flex items-center justify-between text-xs mt-1">
                  <span className="text-[var(--text-secondary)]">{t('charging.optimizer.offpeakHours', 'Off-peak hours')}</span>
                  <span className="text-[var(--text-secondary)] tabular-nums">{(optimizer.cost_analysis.offpeak_hours ?? []).map((h) => `${h}:00`).join(', ') || '—'}</span>
                </div>
              </div>
            </div>
          </GlassPanel>
        </FadeIn>
      </div>

      {/* Cost Heatmap — always rendered; CostHeatmap owns its own empty state
          so the panel shell is never hidden when there is no heatmap data. */}
      <FadeIn delay={0.27}>
        <CostHeatmap
          heatmap={optimizer.weekly_heatmap ?? []}
          peakCostPerKwh={optimizer.cost_analysis.peak_cost_per_kwh}
        />
      </FadeIn>

      {/* Recommendations */}
      <FadeIn delay={0.28}>
        <GlassPanel className="p-6">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
            <Lightbulb className="h-4 w-4 text-neon-amber" aria-hidden="true" />
            {t('charging.optimizer.recommendations', 'Optimization Recommendations')}
          </h3>
          {(optimizer.recommendations ?? []).length > 0 ? (
            <div className="space-y-3">
              {(optimizer.recommendations ?? []).map((rec, i) => (
                <div
                  key={i}
                  className={cn(
                    'flex items-start gap-3 rounded-xl p-4',
                    rec.priority === 'high' ? 'bg-red-500/[0.06] border border-red-500/10' :
                    rec.priority === 'medium' ? 'bg-neon-amber/[0.06] border border-neon-amber/10' :
                    'bg-white/[0.03] border border-white/[0.06]',
                  )}
                >
                  <Shield className={cn('h-5 w-5 mt-0.5 shrink-0',
                    rec.priority === 'high' ? 'text-red-400' :
                    rec.priority === 'medium' ? 'text-amber-300' : 'text-emerald-300',
                  )} aria-hidden="true" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-[var(--text-primary)]">{rec.title}</span>
                      <span className={cn('text-2xs px-1.5 py-0.5 rounded-full uppercase tracking-wider font-medium',
                        rec.priority === 'high' ? 'bg-red-500/20 text-red-400' :
                        rec.priority === 'medium' ? 'bg-neon-amber/20 text-neon-amber' :
                        'bg-neon-green/20 text-neon-green',
                      )}>
                        {rec.priority}
                      </span>
                      {rec.estimated_savings != null && rec.estimated_savings > 0 && (
                        <span className="text-2xs px-1.5 py-0.5 rounded-full bg-neon-green/20 text-neon-green font-medium">
                          ~${fmtNumber(rec.estimated_savings, 0)}/mo
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[var(--text-secondary)]">{rec.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('charging.optimizer.noRecs', 'Recommendations will appear after more charging sessions.')} />
          )}
        </GlassPanel>
      </FadeIn>
    </>
  );
}
