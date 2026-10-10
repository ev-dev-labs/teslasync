import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles, Zap } from 'lucide-react';
import { Badge, Caption, Text } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useChargingOptimizer } from '@/api/hooks/useCharging';
import { useVehicles } from '@/api/hooks/useVehicles';

import { safeArray } from '@/lib/safeArray';
import { cn } from '@/lib/cn';
import { WidgetShell } from './WidgetShell';
import { WidgetTipCards, type TipItem } from './shared';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useFormatting } from '@/hooks/useFormatting';
import { useDataState } from '@/hooks/useDataState';
import { knownNumber } from '@/api/dataState';
import { WidgetBigNumber } from './shared';
import type { StatMetric } from '@/components/data-display';
import { DashboardSourceBrief } from '../components/operationalbrief-all/DashboardSourceBrief';
import { useDateFormat } from '@/hooks/useDateFormat';
import { neonColorMap } from '@/lib/tokens';

const PRIORITY_IMPACT: Record<string, 'high' | 'medium' | 'low'> = {
  high: 'high',
  medium: 'medium',
  low: 'low',
};

export default function ChargingOptimizerWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber } = useNumberFormatting();
  const { formatCurrency } = useFormatting();
  const { t } = useTranslation('dashboard');
  const vehiclesQuery = useVehicles();
  const candidate = vehicleId ?? safeArray(vehiclesQuery.data)[0]?.id;
  const vid = Number.isSafeInteger(candidate) && Number(candidate) > 0 ? candidate : null;
  const vehicleIdStr = vid != null ? String(vid) : null;
  const { formatTime } = useDateFormat();
  // These are clock hours, not instants: keep the wall-clock hour unchanged.
  const hourLabel = (hour: number | null) => hour == null ? '—' : formatTime(
    `2000-01-01T${String(((Math.round(hour) % 24) + 24) % 24).padStart(2, '0')}:00:00Z`,
    { tz: 'UTC' },
  );

  const query = useChargingOptimizer(vehicleIdStr);
  const {
    data, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch,
  } = query;
  const discoveryState = useDataState(vehiclesQuery);
  const sourceState = useDataState({
    ...query,
    data: data ?? (!vid || (!isLoading && !query.isPending && !isError) ? null : undefined),
  }, {
    provenance: 'inferred', unavailable: !data,
    partial: Boolean(data && (
      knownNumber(data.current_schedule?.most_common_start_hour) == null
      || knownNumber(data.current_schedule?.avg_charge_to_pct) == null
      || knownNumber(data.cost_analysis?.potential_monthly_savings) == null
      || knownNumber(data.cost_analysis?.sessions_during_peak_pct) == null
    )),
  });
  const dataState = !vid && vehicleId == null && discoveryState.status !== 'ok'
    ? discoveryState : sourceState;
  const refresh = () => {
    if (vehicleId == null) void vehiclesQuery.refetch?.();
    if (vid) void refetch();
  };

  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 4;

  const schedule = data?.current_schedule;
  const costAnalysis = data?.cost_analysis;
  const recommendations = safeArray(data?.recommendations);

  const optimalStartHour = knownNumber(schedule?.most_common_start_hour);
  const targetSoc = knownNumber(schedule?.avg_charge_to_pct);
  const monthlySavings = knownNumber(costAnalysis?.potential_monthly_savings);
  const peakPct = knownNumber(costAnalysis?.sessions_during_peak_pct);
  const offpeakHours = safeArray(costAnalysis?.offpeak_hours);
  const peakHours = safeArray(costAnalysis?.peak_hours);

  const scheduleMatchesOptimal = peakPct != null && peakPct < 30;
  const summaryMetrics: StatMetric[] = [
    { metricId: 'number', occurrenceId: 'optimizer-start-hour', rawValue: schedule?.most_common_start_hour,
      label: t('widget.chargingOptimizer.optimalStart', 'Optimal start'),
      description: t('widget.chargingOptimizer.hourSource', 'Returned wall-clock hour, not an elapsed duration or timezone-shifted instant.'),
      display: { formatter: raw => ({ value: hourLabel(raw), unit: '' }) } },
    { metricId: 'percent', occurrenceId: 'optimizer-target-soc', rawValue: schedule?.avg_charge_to_pct,
      label: t('widget.chargingOptimizer.targetSoc', 'Target SOC'),
      display: { formatter: raw => ({ value: fmtNumber(raw), unit: '%' }) } },
    { metricId: 'number', occurrenceId: 'optimizer-monthly-savings', rawValue: costAnalysis?.potential_monthly_savings,
      label: t('widget.chargingOptimizer.savingsLabel', 'Savings/mo'),
      description: t('widget.chargingOptimizer.savingsSource', 'Returned monthly savings estimate, retaining the existing currency formatting without changing its denomination.'),
      display: { formatter: raw => ({ value: formatCurrency(raw), unit: '' }) } },
  ];

  const tips: TipItem[] = useMemo(
    () =>
      recommendations.map((rec, i) => {
        // Guard each entry: a malformed payload may carry null/partial recs.
        const priority = rec?.priority;
        return {
          id: i,
          icon: <Sparkles className="h-4 w-4" />,
          title: rec?.title ?? '—',
          description: rec?.detail ?? '—',
          impact: priority ? PRIORITY_IMPACT[priority] : undefined,
          impactLabel: priority
            ? t(`widget.chargingOptimizer.priority.${priority}`, priority)
            : undefined,
        };
      }),
    [recommendations, t],
  );

  const shellProps = {
    title: t('widget.chargingOptimizer.title', 'Charging optimizer'),
    dataState: { ...dataState, retry: refresh },
    updatedAt: dataUpdatedAt,
    isFetching,
    isStale,
    isError,
    onRefresh: refresh,
  };

  // ── Compact (1 col) ──
  if (isCompact) {
    return (
      <WidgetShell {...shellProps}>
        {!data ? (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<Sparkles className="h-5 w-5" />}
            message={t('widget.chargingOptimizer.noData', 'No optimizer data')}
            className="py-4"
          />
        ) : (
          <WidgetBigNumber
            value={hourLabel(optimalStartHour)}
            align="center"
            subtitle={t('widget.chargingOptimizer.targetSocShort', 'SOC {{pct}}%', { pct: targetSoc == null ? '—' : fmtNumber(targetSoc) })}
            badge={monthlySavings != null && monthlySavings > 0 ? {
              text: t('widget.chargingOptimizer.savingsShort', '{{amount}}/mo', { amount: formatCurrency(monthlySavings) }),
              variant: 'success',
            } : undefined}
          />
        )}
      </WidgetShell>
    );
  }

  // ── Standard (2×2) and Wide (2×4+) ──
  return (
    <WidgetShell
      icon={<Sparkles className="h-3.5 w-3.5 text-[var(--text-secondary)]" />}
      {...shellProps}
    >
      {!data ? (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Sparkles className="h-5 w-5" />}
          message={t('widget.chargingOptimizer.noData', 'No optimizer data')}
          className="py-4"
        />
      ) : (
        <div className="flex flex-col gap-3 h-full">
          {/* Key metrics row */}
          <DashboardSourceBrief metrics={summaryMetrics} state={sourceState}
            eyebrow={t('widget.summaryEyebrow', 'Dashboard source summary')}
            title={t('widget.chargingOptimizer.summaryTitle', 'Returned charging recommendations')}
            description={t('widget.chargingOptimizer.summaryDescription', 'Schedule and cost estimates remain separate inferred operands; peak-use classification, the rate timeline and actionable recommendations remain below.')}
            scope={t('widget.chargingOptimizer.summaryScope', 'Vehicle {{id}} · returned optimizer analysis; exact source recording bounds and completeness are not supplied.', { id: vid ?? '—' })}
            testId="dashboard-charging-optimizer-brief" />

          {/* Schedule match badge */}
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <Caption className="min-w-0 [overflow-wrap:anywhere]">
              {t('widget.chargingOptimizer.peakUsage', 'Peak charging: {{pct}}%', { pct: peakPct == null ? '—' : fmtNumber(peakPct) })}
            </Caption>
            <Badge variant={peakPct == null ? 'neutral' : scheduleMatchesOptimal ? 'success' : 'warning'} size="sm">
              {peakPct == null ? '—' : scheduleMatchesOptimal
                ? t('widget.chargingOptimizer.optimized', 'Optimized')
                : t('widget.chargingOptimizer.canImprove', 'Can improve')}
            </Badge>
          </div>

          {/* Wide mode: 24h timeline bar */}
          {isWide && (
            <div className="flex flex-col gap-1">
              <Caption>
                {t('widget.chargingOptimizer.rateTimeline', '24h rate timeline')}
              </Caption>
              <div
                className="flex h-6 rounded-md overflow-hidden border border-[var(--border-subtle)]"
                role="img"
                aria-label={t('widget.chargingOptimizer.rateTimeline', '24h rate timeline')}
              >
                {Array.from({ length: 24 }, (_, h) => {
                  const isPeak = peakHours.includes(h);
                  const isOffpeak = offpeakHours.includes(h);
                  const isCurrentStart = h === optimalStartHour;
                  return (
                    <div
                      key={h}
                      className={cn(
                        'flex-1 relative',
                        isPeak && neonColorMap.red.bg,
                        isOffpeak && neonColorMap.green.bg,
                        !isPeak && !isOffpeak && 'bg-[var(--surface-2)]',
                      )}
                      title={`${hourLabel(h)} — ${isPeak ? t('widget.chargingOptimizer.peak', 'Peak') : isOffpeak ? t('widget.chargingOptimizer.offpeak', 'Off-peak') : t('widget.chargingOptimizer.standard', 'Standard')}`}
                    >
                      {isCurrentStart && (
                        <div className="absolute inset-0 flex items-center justify-center">
                          <Zap className={cn('h-3 w-3', neonColorMap.green.text)} aria-hidden="true" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap justify-between gap-1">
                {[0, 6, 12, 18, 0].map((h, i) => <Text key={i} variant="caption">{hourLabel(h)}</Text>)}
              </div>
            </div>
          )}

          {/* Recommendations as tip cards */}
          <div className="flex-1 min-h-0">
            <WidgetTipCards
              tips={tips}
              maxTips={isWide ? 5 : 3}
              compact={false}
              emptyMessage={t('widget.chargingOptimizer.noRecommendations', 'No recommendations')}
              emptyIcon={<Sparkles className="h-5 w-5" />}
            />
          </div>
        </div>
      )}
    </WidgetShell>
  );
}
