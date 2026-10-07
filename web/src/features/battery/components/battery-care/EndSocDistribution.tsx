import { BatteryCharging } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { MetricBar } from '@/components/data-display';
import {
  Badge,
  MetricLabel,
  MetricValue,
} from '@/components/ui';
import { fmtPercent } from '@/lib/numberFormat';
import { chartTokens } from '@/lib/tokens';

import type {
  CareScore,
  EndSocBucketId,
} from '../../lib/batteryCare';
import { BatteryCareSection } from './BatteryCareSection';
import type { BatteryCareSectionState } from './types';

interface EndSocDistributionProps {
  care: CareScore;
  state: BatteryCareSectionState;
  className?: string;
}

function bucketLabel(id: EndSocBucketId, t: TFunction): string {
  switch (id) {
    case 'belowBand':
      return t('batteryCare.targets.bucket.below', 'Below 20%');
    case 'careBand':
      return t('batteryCare.targets.bucket.band', '20–80%');
    case 'aboveBand':
      return t(
        'batteryCare.targets.bucket.above',
        'Above 80% to below 95%',
      );
    case 'highFinish':
      return t('batteryCare.targets.bucket.high', '95–100%');
  }
}

/** Distribution of valid charging-session end SoC observations. */
export function EndSocDistribution({
  care,
  state,
  className,
}: EndSocDistributionProps) {
  const { t } = useTranslation();

  return (
    <BatteryCareSection
      className={className}
      title={t('batteryCare.targets.title', 'Charging target evidence')}
      description={t(
        'batteryCare.targets.description',
        'Observed session-end SoC; this does not measure how long the pack remained at a level',
      )}
      icon={
        <BatteryCharging
          className="h-4 w-4 text-emerald-300"
          aria-hidden="true"
        />
      }
      emptyIcon={<BatteryCharging className="h-8 w-8" aria-hidden="true" />}
      emptyMessage={t(
        'batteryCare.targets.empty',
        'No charging sessions with a valid end SoC are available in the returned window.',
      )}
      hasData={care.sessionsAnalyzed > 0}
      state={state}
      testId="battery-care-targets"
      badge={
        <Badge variant="neutral">
          {t('batteryCare.targets.eligible', '{{count}} eligible', {
            count: care.sessionsAnalyzed,
          })}
        </Badge>
      }
    >
      <div className="grid gap-4 sm:grid-cols-[0.65fr_1.35fr]">
        <div className="rounded-xl bg-[var(--surface-2)] p-4">
          <MetricValue>
            {care.medianEndSocPct != null
              ? fmtPercent(care.medianEndSocPct, 0)
              : '—'}
          </MetricValue>
          <MetricLabel>
            {t('batteryCare.targets.median', 'Median session-end SoC')}
          </MetricLabel>
        </div>

        <div className="space-y-4">
          {care.endSocDistribution.map((bucket, index) => (
            <MetricBar
              key={bucket.id}
              label={bucketLabel(bucket.id, t)}
              value={(bucket.share ?? 0) * 100}
              max={100}
              color={chartTokens.series[index + 1]}
              sublabel={t(
                'batteryCare.targets.bucketValue',
                '{{pct}} · {{count}} sessions',
                {
                  pct:
                    bucket.share != null
                      ? fmtPercent(bucket.share * 100, 0)
                      : '—',
                  count: bucket.count,
                },
              )}
            />
          ))}
        </div>
      </div>
    </BatteryCareSection>
  );
}
