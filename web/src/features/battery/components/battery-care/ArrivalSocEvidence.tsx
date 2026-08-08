import { BatteryWarning } from 'lucide-react';
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
  ArrivalSocBucketId,
  CareScore,
} from '../../lib/batteryCare';
import { BatteryCareSection } from './BatteryCareSection';
import type { BatteryCareSectionState } from './types';

interface ArrivalSocEvidenceProps {
  care: CareScore;
  state: BatteryCareSectionState;
  className?: string;
}

function bucketLabel(id: ArrivalSocBucketId, t: TFunction): string {
  switch (id) {
    case 'below10':
      return t('batteryCare.arrivals.bucket.below10', 'Below 10%');
    case '10to19':
      return t('batteryCare.arrivals.bucket.10to19', '10–19%');
    case '20to49':
      return t('batteryCare.arrivals.bucket.20to49', '20–49%');
    case '50plus':
      return t('batteryCare.arrivals.bucket.50plus', '50% or above');
  }
}

/** End-of-drive SoC distribution, including explicit deep-arrival evidence. */
export function ArrivalSocEvidence({
  care,
  state,
  className,
}: ArrivalSocEvidenceProps) {
  const { t } = useTranslation();

  return (
    <BatteryCareSection
      className={className}
      title={t('batteryCare.arrivals.title', 'Arrival-SoC evidence')}
      description={t(
        'batteryCare.arrivals.description',
        'Observed end-of-drive SoC, without assumptions about subsequent parking or charging',
      )}
      icon={
        <BatteryWarning
          className="h-4 w-4 text-amber-300"
          aria-hidden="true"
        />
      }
      emptyIcon={<BatteryWarning className="h-8 w-8" aria-hidden="true" />}
      emptyMessage={t(
        'batteryCare.arrivals.empty',
        'No drives with a valid arrival SoC are available in the returned window.',
      )}
      hasData={care.drivesAnalyzed > 0}
      state={state}
      testId="battery-care-arrivals"
      badge={
        <Badge variant="neutral">
          {t('batteryCare.arrivals.eligible', '{{count}} eligible', {
            count: care.drivesAnalyzed,
          })}
        </Badge>
      }
    >
      <div className="grid gap-4 sm:grid-cols-[0.65fr_1.35fr]">
        <div className="rounded-xl bg-[var(--surface-2)] p-4">
          <MetricValue>
            {care.medianArrivalSocPct != null
              ? fmtPercent(care.medianArrivalSocPct, 0)
              : '—'}
          </MetricValue>
          <MetricLabel>
            {t('batteryCare.arrivals.median', 'Median drive-arrival SoC')}
          </MetricLabel>
        </div>

        <div className="space-y-4">
          {care.arrivalSocDistribution.map((bucket, index) => (
            <MetricBar
              key={bucket.id}
              label={bucketLabel(bucket.id, t)}
              value={(bucket.share ?? 0) * 100}
              max={100}
              color={chartTokens.series[index + 2]}
              sublabel={t(
                'batteryCare.arrivals.bucketValue',
                '{{pct}} · {{count}} drives',
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
