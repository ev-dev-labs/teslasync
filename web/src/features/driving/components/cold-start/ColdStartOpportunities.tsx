import { Lightbulb, Snowflake } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/feedback';
import {
  Badge,
  GlassPanel,
  MetricLabel,
  MetricValue,
  PanelTitle,
  Text,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/dateFormat';

import type {
  ColdStartOpportunity,
  ColdStartSummary,
} from '../../lib/coldStart';
import { ColdStartSectionBody } from './ColdStartSectionBody';
import type { ColdStartSectionState } from './types';
import { useColdStartDisplay } from './useColdStartDisplay';

interface ColdStartOpportunitiesProps {
  summary: ColdStartSummary;
  state: ColdStartSectionState;
  className?: string;
}

function emptyMessage(
  summary: ColdStartSummary,
  t: (key: string, fallback: string) => string,
): string {
  if (!summary.sampleSufficient) {
    return t(
      'coldStart.opportunities.insufficient',
      'Opportunities appear only after at least five cold and five warm drives establish the aggregate baseline.',
    );
  }
  if (summary.penaltyWhPerKm == null || summary.penaltyWhPerKm <= 0) {
    return t(
      'coldStart.opportunities.noPenalty',
      'No positive aggregate cold penalty was observed, so this window has no claimed avoidable-energy opportunities.',
    );
  }
  return t(
    'coldStart.opportunities.empty',
    'No individual cold start consumed more than the valid warm baseline in this window.',
  );
}

/** Largest observed cold starts above the valid aggregate warm baseline. */
export function ColdStartOpportunities({
  summary,
  state,
  className,
}: ColdStartOpportunitiesProps) {
  const { t } = useTranslation();
  const {
    formatDistance,
    formatDuration,
    formatEnergy,
    formatTemperature,
    unitPrefs,
  } = useColdStartDisplay();
  const opportunities: ColdStartOpportunity[] = summary.opportunities.slice(0, 5);

  return (
    <GlassPanel
      className={cn('h-full p-5 sm:p-6', className)}
      role="region"
      aria-label={t('coldStart.sections.opportunities', 'Cold-start opportunities')}
      data-testid="cold-start-opportunities"
    >
      <PanelTitle className="flex items-center gap-2">
        <Lightbulb className="h-4 w-4 text-amber-300" aria-hidden="true" />
        {t('coldStart.opportunities.title', 'Top cold-start opportunities')}
      </PanelTitle>
      <Text as="p" variant="caption" className="mt-1">
        {t(
          'coldStart.opportunities.subtitle',
          'Largest positive drive-level differences from the valid weighted warm baseline',
        )}
      </Text>

      <ColdStartSectionBody state={state} className="mt-4 min-h-64">
        {opportunities.length === 0 ? (
          <EmptyState /* no-action: evidence is observational; the range selector is the recovery surface. */
            className="h-full"
            icon={<Snowflake className="h-8 w-8" aria-hidden="true" />}
            message={emptyMessage(summary, t)}
          />
        ) : (
          <ol
            className="divide-y divide-[var(--border-subtle)]"
            aria-label={t(
              'coldStart.opportunities.listAria',
              'Ranked cold-start energy opportunities',
            )}
          >
            {opportunities.map((opportunity, index) => (
              <li
                key={opportunity.driveId}
                className="grid gap-3 py-3 first:pt-0 last:pb-0"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Text as="p" variant="body" className="truncate">
                      {formatDate(opportunity.startTs, {
                        locale: unitPrefs.locale,
                      })}
                    </Text>
                    <Text as="p" variant="caption">
                      {t('coldStart.opportunities.gapValue', '{{gap}} preceding gap', {
                        gap: formatDuration(opportunity.precedingGapS, {
                          precision: 1,
                        }),
                      })}
                    </Text>
                  </div>
                  <Badge variant="warning">
                    {t('coldStart.opportunities.rank', '#{{rank}}', {
                      rank: index + 1,
                    })}
                  </Badge>
                </div>

                <div className="grid grid-cols-3 gap-2 rounded-xl bg-[var(--surface-2)] p-3">
                  <div>
                    <MetricLabel>{t('coldStart.opportunities.distance', 'Distance')}</MetricLabel>
                    <Text as="p" variant="bodySm" mono className="mt-1">
                      {formatDistance(opportunity.distanceM, { precision: 1 })}
                    </Text>
                  </div>
                  <div>
                    <MetricLabel>{t('coldStart.opportunities.temperature', 'Temperature')}</MetricLabel>
                    <Text as="p" variant="bodySm" mono className="mt-1">
                      {formatTemperature(opportunity.outsideTempAvgC, {
                        precision: 1,
                      })}
                    </Text>
                  </div>
                  <div className="text-right">
                    <MetricLabel>{t('coldStart.opportunities.energy', 'Above baseline')}</MetricLabel>
                    <MetricValue className="mt-1 text-base">
                      {formatEnergy(opportunity.estimatedAvoidableWh, {
                        precision: 2,
                      })}
                    </MetricValue>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </ColdStartSectionBody>
    </GlassPanel>
  );
}
