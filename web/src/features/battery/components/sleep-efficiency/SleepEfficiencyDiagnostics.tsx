import { Activity, Equal, Gauge, Scale } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { AlertBanner, EmptyState } from '@/components/feedback';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { fmtNumber } from '@/lib/numberFormat';
import { SleepEfficiencySectionBody } from './SleepEfficiencySectionBody';
import type { SleepEfficiencySectionProps } from './types';

export function SleepEfficiencyDiagnostics({
  analysis,
  state,
}: SleepEfficiencySectionProps) {
  const { t } = useTranslation();
  const dwell = analysis.dwell;

  return (
    <section data-testid="sleep-efficiency-diagnostics">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <Activity className="h-4 w-4 text-emerald-300" aria-hidden="true" />
          {t(
            'sleep.diagnostics.title',
            'Sleep-efficiency diagnostics',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'sleep.diagnostics.subtitle',
            'Reported and recomputed percentages are compared only after positive dwell evidence exists.',
          )}
        </Text>
        <SleepEfficiencySectionBody state={state}>
          {dwell.available ? (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <MetricCard
                  icon={<Gauge className="h-4 w-4" aria-hidden="true" />}
                  label={t(
                    'sleep.diagnostics.recomputed',
                    'Recomputed from dwell',
                  )}
                  value={
                    dwell.recomputedEfficiencyPct != null
                      ? t('sleep.diagnostics.percent', '{{value}}%', {
                          value: fmtNumber(
                            dwell.recomputedEfficiencyPct,
                          ),
                        })
                      : '—'
                  }
                  color="green"
                  subtitle={t(
                    'sleep.diagnostics.formula',
                    'Asleep minutes ÷ total valid minutes',
                  )}
                />
                <MetricCard
                  icon={<Scale className="h-4 w-4" aria-hidden="true" />}
                  label={t(
                    'sleep.diagnostics.reported',
                    'Backend-reported value',
                  )}
                  value={
                    dwell.reportedEfficiencyPct != null
                      ? t('sleep.diagnostics.percent', '{{value}}%', {
                          value: fmtNumber(
                            dwell.reportedEfficiencyPct,
                          ),
                        })
                      : '—'
                  }
                  color="cyan"
                  subtitle={
                    dwell.reportedEfficiencyPct != null
                      ? t(
                          'sleep.diagnostics.reportedAvailable',
                          'Finite percentage in the response',
                        )
                      : t(
                          'sleep.diagnostics.reportedMissing',
                          'Missing or invalid reported percentage',
                        )
                  }
                />
                <MetricCard
                  icon={<Equal className="h-4 w-4" aria-hidden="true" />}
                  label={t(
                    'sleep.diagnostics.difference',
                    'Reported minus recomputed',
                  )}
                  value={
                    dwell.reportedDifferencePoints != null
                      ? t(
                          'sleep.diagnostics.points',
                          '{{value}} percentage points',
                          {
                            value: fmtNumber(
                              dwell.reportedDifferencePoints,
                            ),
                          },
                        )
                      : '—'
                  }
                  color="purple"
                  subtitle={t(
                    'sleep.diagnostics.descriptiveOnly',
                    'Descriptive consistency check only',
                  )}
                />
              </div>
              {dwell.reportedDifferencePoints != null && (
                <AlertBanner className="mt-4" variant="info">
                  {t(
                    'sleep.diagnostics.comparisonNote',
                    'A difference identifies contract or aggregation divergence; it does not establish which source is causally correct.',
                  )}
                </AlertBanner>
              )}
            </>
          ) : (
            // no-action: duration diagnostics unlock automatically with positive dwell evidence
            <EmptyState
              className="py-8"
              icon={<Activity className="h-8 w-8" aria-hidden="true" />}
              title={t(
                'sleep.diagnostics.withheldTitle',
                'Duration diagnostic withheld',
              )}
              message={t(
                'sleep.diagnostics.withheld',
                'The current zero sleep_efficiency_pct is a placeholder while total_minutes remains zero. No 0% result is presented as measured.',
              )}
            />
          )}
        </SleepEfficiencySectionBody>
      </GlassPanel>
    </section>
  );
}
