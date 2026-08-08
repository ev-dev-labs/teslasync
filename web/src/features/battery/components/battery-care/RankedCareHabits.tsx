import { CheckCircle2, ListChecks } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { EmptyState } from '@/components/feedback';
import { Badge, Text } from '@/components/ui';
import { fmtNumber, fmtPercent } from '@/lib/numberFormat';

import type {
  CareOpportunity,
  CareRiskId,
  CareScore,
} from '../../lib/batteryCare';
import { BatteryCareSection } from './BatteryCareSection';
import type { BatteryCareSectionState } from './types';

interface RankedCareHabitsProps {
  care: CareScore;
  state: BatteryCareSectionState;
  className?: string;
}

function opportunityTitle(id: CareRiskId, t: TFunction): string {
  switch (id) {
    case 'highFinish':
      return t('batteryCare.actions.highFinish.title', 'Review routine high-SoC finishes');
    case 'deepArrival':
      return t('batteryCare.actions.deepArrival.title', 'Review very low drive arrivals');
    case 'dcEnergy':
      return t('batteryCare.actions.dcEnergy.title', 'Review the classified DC energy mix');
    case 'outsideBand':
      return t('batteryCare.actions.outsideBand.title', 'Review routine finish targets');
  }
}

function opportunityDetail(
  opportunity: CareOpportunity,
  fullChargePct: number,
  t: TFunction,
): string {
  const values = {
    pct: fmtPercent(opportunity.observedShare * 100, 0),
    count: opportunity.sampleCount,
    threshold: fullChargePct,
  };
  switch (opportunity.id) {
    case 'highFinish':
      return t(
        'batteryCare.actions.highFinish.detail',
        '{{pct}} of {{count}} eligible sessions ended at {{threshold}}% or above. If trip needs allow, a lower routine target would reduce this index component.',
        values,
      );
    case 'deepArrival':
      return t(
        'batteryCare.actions.deepArrival.detail',
        '{{pct}} of {{count}} eligible drives ended below 10%. When practical, charging before similarly low arrivals would reduce this observed component.',
        values,
      );
    case 'dcEnergy':
      return t(
        'batteryCare.actions.dcEnergy.detail',
        '{{pct}} of classified energy was DC fast across {{count}} classified sessions. When equally convenient, adding AC charging would reduce this mix component.',
        values,
      );
    case 'outsideBand':
      return t(
        'batteryCare.actions.outsideBand.detail',
        '{{pct}} of {{count}} eligible sessions ended outside 20–80%. When range needs allow, more finishes inside that band would reduce this index component.',
        values,
      );
  }
}

/** Guarded, ranked adjustments derived only from calibrated score components. */
export function RankedCareHabits({
  care,
  state,
  className,
}: RankedCareHabitsProps) {
  const { t } = useTranslation();
  const hasObservedEvidence = care.riskComponents.some(
    (component) => component.observedShare != null,
  );

  return (
    <BatteryCareSection
      className={className}
      title={t('batteryCare.actions.title', 'Ranked habit opportunities')}
      description={t(
        'batteryCare.actions.description',
        'Ranked by descriptive index deduction, not estimated battery damage',
      )}
      icon={<ListChecks className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
      emptyIcon={<ListChecks className="h-8 w-8" aria-hidden="true" />}
      emptyMessage={t(
        'batteryCare.actions.empty',
        'No usable evidence is available to rank charging or arrival observations.',
      )}
      hasData={hasObservedEvidence}
      state={state}
      testId="battery-care-habits"
      badge={
        <Badge variant={care.opportunities.length > 0 ? 'warning' : 'success'} dot>
          {t('batteryCare.actions.ranked', '{{count}} ranked', {
            count: care.opportunities.length,
          })}
        </Badge>
      }
    >
      {care.opportunities.length === 0 ? (
        <EmptyState
          className="min-h-52"
          icon={<CheckCircle2 className="h-8 w-8" aria-hidden="true" />}
          message={
            care.scoreReady
              ? t(
                  'batteryCare.actions.noneSupported',
                  'No calibrated observation crossed the ranking thresholds in this returned window.',
                )
              : t(
                  'batteryCare.actions.noneCalibrated',
                  'More eligible evidence is needed before an observation can be ranked.',
                )
          }
        />
      ) : (
        <div className="space-y-3">
          {care.opportunities.map((opportunity) => (
            <div
              key={opportunity.id}
              className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-2)] p-4"
            >
              <div className="flex items-start gap-3">
                <Badge variant="neutral">
                  {t('batteryCare.actions.rank', '#{{rank}}', {
                    rank: opportunity.rank,
                  })}
                </Badge>
                <div className="min-w-0">
                  <Text as="h4" variant="subhead">
                    {opportunityTitle(opportunity.id, t)}
                  </Text>
                  <Text as="p" variant="bodySm" className="mt-1">
                    {opportunityDetail(
                      opportunity,
                      care.fullChargePct,
                      t,
                    )}
                  </Text>
                  <Text as="p" variant="caption" className="mt-2">
                    {t(
                      'batteryCare.actions.contribution',
                      'Current index deduction: {{points}} points',
                      {
                        points: fmtNumber(
                          opportunity.penaltyPoints,
                          1,
                        ),
                      },
                    )}
                  </Text>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </BatteryCareSection>
  );
}
