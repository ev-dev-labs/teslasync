import { Activity, AlertTriangle, CheckCircle2, Clock3, Target } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/feedback';
import {
  Badge, GlassPanel, MetricLabel, MetricValue, PanelTitle, Text,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import type { TargetBand, TargetSummary } from '../../lib/efficiencyTarget';
import { EfficiencyTargetSectionBody } from './EfficiencyTargetSectionBody';
import type { EfficiencyTargetSectionState } from './types';
import { useEfficiencyTargetDisplay } from './useEfficiencyTargetDisplay';

interface GoalPulseProps {
  summary: TargetSummary;
  state: EfficiencyTargetSectionState;
  className?: string;
}

export function GoalPulse({ summary, state, className }: GoalPulseProps) {
  const { t } = useTranslation();
  const { formatDistance, formatEfficiency, formatWeek } =
    useEfficiencyTargetDisplay();
  const latest = summary.latestCompletedWeek;
  const active = summary.activeWeek;
  const bandLabel = (band: TargetBand | null) => {
    if (band === 'onTarget') {
      return t('effTarget.status.onTarget', 'On target');
    }
    if (band === 'nearMiss') {
      return t('effTarget.status.nearMiss', 'Near miss');
    }
    if (band === 'offTrack') {
      return t('effTarget.status.offTrack', 'Off track');
    }
    return t('effTarget.status.ungraded', 'Ungraded');
  };
  const bandVariant = (band: TargetBand | null) => {
    if (band === 'onTarget') return 'success' as const;
    if (band === 'nearMiss') return 'warning' as const;
    if (band === 'offTrack') return 'danger' as const;
    return 'neutral' as const;
  };
  const marginLabel =
    latest?.targetGapWhPerKm == null
      ? '—'
      : latest.targetGapWhPerKm <= 0
        ? t('effTarget.pulse.underTarget', '{{value}} under target', {
            value: formatEfficiency(Math.abs(latest.targetGapWhPerKm), 1),
          })
        : t('effTarget.pulse.overTarget', '{{value}} over target', {
            value: formatEfficiency(latest.targetGapWhPerKm, 1),
          });

  return (
    <GlassPanel
      className={cn('h-full p-5 sm:p-6', className)}
      role="region"
      aria-label={t(
        'effTarget.sections.pulse',
        'Goal pulse and active-week snapshot',
      )}
      data-testid="efficiency-target-pulse"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PanelTitle className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('effTarget.pulse.title', 'Goal pulse')}
        </PanelTitle>
        <Badge variant="neutral" dot>
          {t('effTarget.pulse.observed', 'Observed history')}
        </Badge>
      </div>

      <EfficiencyTargetSectionBody state={state} className="mt-4 min-h-64">
        <div className="grid min-h-64 gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <MetricLabel>
                  {t(
                    'effTarget.pulse.latestCompleted',
                    'Latest completed week',
                  )}
                </MetricLabel>
                {latest ? (
                  <Text as="p" variant="caption" className="mt-1">
                    {t('effTarget.pulse.weekOf', 'Week of {{date}}', {
                      date: formatWeek(latest.weekStart),
                    })}
                  </Text>
                ) : null}
              </div>
              {latest ? (
                <Badge variant={bandVariant(latest.band)} dot>
                  {bandLabel(latest.band)}
                </Badge>
              ) : null}
            </div>
            {latest ? (
              <div className="mt-5 space-y-3">
                <div>
                  <MetricValue>{formatEfficiency(latest.whPerKm, 1)}</MetricValue>
                  <MetricLabel>
                    {t('effTarget.pulse.consumption', 'Consumption')}
                  </MetricLabel>
                </div>
                <div className="flex items-start gap-2">
                  {latest.hit ? (
                    <CheckCircle2
                      className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300"
                      aria-hidden="true"
                    />
                  ) : (
                    <AlertTriangle
                      className="mt-0.5 h-4 w-4 shrink-0 text-amber-300"
                      aria-hidden="true"
                    />
                  )}
                  <Text as="p" variant="bodySm">{marginLabel}</Text>
                </div>
              </div>
            ) : (
              <EmptyState
                className="py-8"
                icon={<Target className="h-7 w-7" aria-hidden="true" />}
                message={t(
                  'effTarget.pulse.noCompleted',
                  'No completed eligible week is available to grade yet.',
                )}
              />
            )}
          </div>

          <div className="rounded-xl border border-cyan-400/20 bg-cyan-400/[0.04] p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <MetricLabel>
                  {t('effTarget.pulse.activeWeek', 'Active week')}
                </MetricLabel>
                <Text as="p" variant="caption" className="mt-1">
                  {t('effTarget.pulse.activeHint', 'Snapshot only')}
                </Text>
              </div>
              <Badge variant="info" dot>
                <Clock3 className="h-3 w-3" aria-hidden="true" />
                {t('effTarget.status.inProgress', 'In progress · not graded')}
              </Badge>
            </div>
            {active ? (
              <div className="mt-5 grid grid-cols-3 gap-2">
                <div>
                  <MetricValue className="text-lg">
                    {formatEfficiency(active.whPerKm, 1)}
                  </MetricValue>
                  <MetricLabel>
                    {t('effTarget.pulse.consumption', 'Consumption')}
                  </MetricLabel>
                </div>
                <div>
                  <MetricValue className="text-lg">
                    {formatDistance(active.distanceM, { precision: 1 })}
                  </MetricValue>
                  <MetricLabel>
                    {t('effTarget.pulse.distance', 'Distance')}
                  </MetricLabel>
                </div>
                <div>
                  <MetricValue className="text-lg">{active.drives}</MetricValue>
                  <MetricLabel>
                    {t('effTarget.pulse.drives', 'Drives')}
                  </MetricLabel>
                </div>
              </div>
            ) : (
              <EmptyState
                className="py-8"
                icon={<Clock3 className="h-7 w-7" aria-hidden="true" />}
                message={t(
                  'effTarget.pulse.noActive',
                  'No eligible drives have been observed in the active week.',
                )}
              />
            )}
          </div>
        </div>
      </EfficiencyTargetSectionBody>
    </GlassPanel>
  );
}
