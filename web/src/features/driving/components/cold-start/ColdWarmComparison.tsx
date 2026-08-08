import { Scale, Snowflake } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { CHART_COLORS } from '@/components/charts';
import { MetricBar } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import {
  Badge,
  GlassPanel,
  HelpTooltip,
  MetricLabel,
  MetricValue,
  PanelTitle,
  Text,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import { fmtNumber } from '@/lib/numberFormat';

import type { ColdStartSummary } from '../../lib/coldStart';
import { ColdStartSectionBody } from './ColdStartSectionBody';
import type { ColdStartSectionState } from './types';
import { useColdStartDisplay } from './useColdStartDisplay';

interface ColdWarmComparisonProps {
  summary: ColdStartSummary;
  penaltyCostLabel: string | null;
  state: ColdStartSectionState;
  className?: string;
}

/** Aggregate weighted comparison and the only panel allowed to claim a penalty. */
export function ColdWarmComparison({
  summary,
  penaltyCostLabel,
  state,
  className,
}: ColdWarmComparisonProps) {
  const { t } = useTranslation();
  const { formatEfficiency, formatEnergy } = useColdStartDisplay();
  const classified = summary.cold.drives + summary.warm.drives;
  const maxEfficiency = Math.max(
    summary.cold.whPerKm ?? 0,
    summary.warm.whPerKm ?? 0,
    1,
  );
  const penaltyPositive =
    summary.sampleSufficient &&
    summary.penaltyWhPerKm != null &&
    summary.penaltyWhPerKm > 0;
  const deltaLabel =
    summary.penaltyShare != null
      ? t('coldStart.penaltyVsWarm', '{{sign}}{{pct}}% vs warm starts', {
          sign: summary.penaltyShare > 0 ? '+' : summary.penaltyShare < 0 ? '−' : '',
          pct: fmtNumber(Math.abs(summary.penaltyShare) * 100, 0),
        })
      : t('coldStart.comparison.awaitingDelta', 'Aggregate difference withheld');

  return (
    <GlassPanel
      className={cn(
        'h-full overflow-hidden bg-gradient-to-br from-cyan-500/[0.08] via-transparent to-emerald-500/[0.06] p-5 sm:p-6',
        className,
      )}
      role="region"
      aria-label={t('coldStart.sections.comparison', 'Cold and warm aggregate comparison')}
      data-testid="cold-start-comparison"
    >
      <PanelTitle className="mb-4 flex items-center gap-2">
        <Snowflake className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('coldStart.duel', 'Cold vs Warm Starts')}
        <HelpTooltip
          size="sm"
          i18nKey="coldStart.comparison.help"
          defaultValue="A drive is a cold start when the car sat parked for 6+ hours first, and a warm start when the gap is 1 hour or less. Comparing distance-weighted consumption between the groups isolates the battery- and cabin-warm-up penalty; in-between gaps are excluded as ambiguous."
          ariaLabel={t('help.coldStart.iconLabel', 'More info about cold start math')}
        />
      </PanelTitle>

      <ColdStartSectionBody state={state} className="min-h-64">
        {classified === 0 ? (
          <EmptyState /* no-action: changing the selected range may supply classified observations. */
            icon={<Scale className="h-8 w-8" aria-hidden="true" />}
            message={t(
              'coldStart.comparison.noGroups',
              'This window has no drives in the warm or cold parking-gap groups.',
            )}
          />
        ) : (
          <div className="flex min-h-64 flex-col justify-between gap-6">
            <div className="grid items-center gap-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
              <div>
                <Badge
                  variant={summary.sampleSufficient ? 'success' : 'warning'}
                  dot
                >
                  {summary.sampleSufficient
                    ? t('coldStart.comparison.sufficient', 'Aggregate sample ready')
                    : t('coldStart.comparison.building', 'Building aggregate confidence')}
                </Badge>
                <MetricValue className="mt-4">
                  {formatEfficiency(summary.penaltyWhPerKm)}
                </MetricValue>
                <MetricLabel className="mt-1">{deltaLabel}</MetricLabel>
                <Text as="p" variant="bodySm" className="mt-3">
                  {t(
                    'coldStart.comparison.samples',
                    '{{cold}} cold and {{warm}} warm observations',
                    { cold: summary.cold.drives, warm: summary.warm.drives },
                  )}
                </Text>
              </div>

              <div className="space-y-4">
                <MetricBar
                  label={t('coldStart.coldGroup', 'Cold starts ({{count}} drives)', {
                    count: summary.cold.drives,
                  })}
                  value={summary.cold.whPerKm ?? 0}
                  max={maxEfficiency}
                  color={CHART_COLORS[0]}
                  sublabel={formatEfficiency(summary.cold.whPerKm)}
                />
                <MetricBar
                  label={t('coldStart.warmGroup', 'Warm starts ({{count}} drives)', {
                    count: summary.warm.drives,
                  })}
                  value={summary.warm.whPerKm ?? 0}
                  max={maxEfficiency}
                  color={CHART_COLORS[1]}
                  sublabel={formatEfficiency(summary.warm.whPerKm)}
                />
              </div>
            </div>

            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4">
              <Text as="p" variant="bodySm">
                {!summary.sampleSufficient
                  ? t(
                      'coldStart.noData',
                      'Not enough cold and warm starts in this period to compare fairly (5+ of each needed).',
                    )
                  : penaltyPositive
                    ? penaltyCostLabel
                      ? t(
                          'coldStart.takeawayCost',
                          'Warm-up overhead added {{energy}} across this period — about {{cost}} at your electricity rate. Preconditioning while plugged in shifts that energy to the wall.',
                          {
                            energy: formatEnergy(summary.totalPenaltyWh, { precision: 1 }),
                            cost: penaltyCostLabel,
                          },
                        )
                      : t(
                          'coldStart.takeaway',
                          'Warm-up overhead added {{energy}} across this period. Preconditioning while plugged in shifts that energy to the wall.',
                          {
                            energy: formatEnergy(summary.totalPenaltyWh, { precision: 1 }),
                          },
                        )
                    : t(
                        'coldStart.comparison.noPositivePenalty',
                        'Cold starts did not consume more than the weighted warm baseline in this selected observed window, so no avoidable energy is claimed.',
                      )}
              </Text>
            </div>
          </div>
        )}
      </ColdStartSectionBody>
    </GlassPanel>
  );
}
