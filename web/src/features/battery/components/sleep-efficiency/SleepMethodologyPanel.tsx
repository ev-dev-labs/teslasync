import { BookMarked, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { AlertBanner } from '@/components/feedback';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import type { SleepEfficiencySectionProps } from './types';

export function SleepMethodologyPanel({
  analysis,
}: SleepEfficiencySectionProps) {
  const { t } = useTranslation();

  return (
    <section data-testid="sleep-efficiency-methodology">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <BookMarked
            className="h-4 w-4 text-purple-300"
            aria-hidden="true"
          />
          {t(
            'sleep.methodology.title',
            'Methodology and interpretation limits',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'sleep.methodology.subtitle',
            'The workspace changes automatically when qualifying future evidence arrives, while keeping source semantics explicit.',
          )}
        </Text>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <Text as="h3" variant="body" weight="semibold">
              {t('sleep.methodology.currentTitle', 'Current evidence model')}
            </Text>
            <ul className="mt-3 list-disc space-y-2 ps-5">
              <li>
                <Text variant="bodySm">
                  {t(
                    'sleep.methodology.transitionSemantics',
                    'state_distribution.count records FSM transition destinations from fsm_transitions.to_state; it is not occupancy or duration.',
                  )}
                </Text>
              </li>
              <li>
                <Text variant="bodySm">
                  {t(
                    'sleep.methodology.noDwell',
                    'The current repository pins total_minutes to zero until paired-transition dwell reconstruction exists.',
                  )}
                </Text>
              </li>
              <li>
                <Text variant="bodySm">
                  {t(
                    'sleep.methodology.utcDates',
                    'Date-only start and end bounds represent inclusive UTC calendar days.',
                  )}
                </Text>
              </li>
              <li>
                <Text variant="bodySm">
                  {t(
                    'sleep.methodology.placeholders',
                    'Zero sleep efficiency, time-to-sleep, Sentry metrics, event totals, and average Sentry duration are placeholder contract fields when their supporting collections are empty.',
                  )}
                </Text>
              </li>
            </ul>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <Text as="h3" variant="body" weight="semibold">
              {t(
                'sleep.methodology.contextTitle',
                'Context and future evidence',
              )}
            </Text>
            <ul className="mt-3 list-disc space-y-2 ps-5">
              <li>
                <Text variant="bodySm">
                  {t(
                    'sleep.methodology.capacitySources',
                    'Capacity source categories distinguish VIN estimate, model estimate, default estimate, other, and unavailable.',
                  )}
                </Text>
              </li>
              <li>
                <Text variant="bodySm">
                  {t(
                    'sleep.methodology.price',
                    'base_cost_per_kwh is electricity-price context; it does not establish measured energy use or a billed amount.',
                  )}
                </Text>
              </li>
              <li>
                <Text variant="bodySm">
                  {t(
                    'sleep.methodology.futureBehavior',
                    'Positive dwell minutes enable duration charts and recomputation; positive Sentry group counts enable comparison; validated events enable event summaries.',
                  )}
                </Text>
              </li>
              <li>
                <Text variant="bodySm">
                  {t(
                    'sleep.methodology.support',
                    'Evidence breadth is a transparent source-availability score, not statistical confidence or model accuracy.',
                  )}
                </Text>
              </li>
            </ul>
          </div>
        </div>
        <AlertBanner
          className="mt-4"
          variant="info"
          icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
        >
          {t(
            'sleep.methodology.nonClaims',
            'No panel makes battery-wear, causal, prescriptive, or “better behavior” claims. Count composition describes recorded transitions only, and projections remain context calculations.',
          )}
        </AlertBanner>
        {!analysis.source.clockValid && (
          <AlertBanner className="mt-4" variant="warning">
            {t(
              'sleep.methodology.invalidClock',
              'The supplied frozen clock is invalid, so event recency is unclassified and future filtering cannot be asserted.',
            )}
          </AlertBanner>
        )}
      </GlassPanel>
    </section>
  );
}
