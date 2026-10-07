import { Fingerprint, Layers, Moon, Sigma } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { GlassPanel, PanelTitle, Text } from '@/components/ui';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import { sleepStateLabel } from './labels';
import { SleepEfficiencySectionBody } from './SleepEfficiencySectionBody';
import type { SleepEfficiencySectionProps } from './types';

export function TransitionDiversityDiagnostics({
  analysis,
  state,
}: SleepEfficiencySectionProps) {
  const { t } = useTranslation();
  const transitions = analysis.transitions;

  return (
    <section data-testid="sleep-efficiency-transition-diversity">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <Fingerprint
            className="h-4 w-4 text-amber-300"
            aria-hidden="true"
          />
          {t(
            'sleep.diversity.title',
            'Transition diversity and concentration',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'sleep.diversity.subtitle',
            'All diagnostics in this panel are destination-count based, not duration based.',
          )}
        </Text>
        <SleepEfficiencySectionBody state={state}>
          {transitions.totalCount > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <MetricCard
                icon={<Layers className="h-4 w-4" aria-hidden="true" />}
                label={t(
                  'sleep.diversity.dominant',
                  'Dominant destination',
                )}
                value={
                  transitions.dominantState
                    ? sleepStateLabel(t, transitions.dominantState)
                    : '—'
                }
                color="amber"
                subtitle={
                  transitions.dominantShare != null
                    ? t(
                        'sleep.diversity.dominantShare',
                        '{{value}}% of valid destination counts',
                        {
                          value: fmtNumber(
                            transitions.dominantShare * 100,
                          ),
                        },
                      )
                    : undefined
                }
              />
              <MetricCard
                icon={<Sigma className="h-4 w-4" aria-hidden="true" />}
                label={t(
                  'sleep.diversity.entropy',
                  'Normalized count entropy',
                )}
                value={
                  transitions.normalizedEntropy != null
                    ? fmtNumber(transitions.normalizedEntropy, 3)
                    : '—'
                }
                color="purple"
                subtitle={t(
                  'sleep.diversity.entropyRange',
                  '0 concentrated · 1 evenly distributed',
                )}
              />
              <MetricCard
                icon={<Layers className="h-4 w-4" aria-hidden="true" />}
                label={t(
                  'sleep.diversity.represented',
                  'Represented states',
                )}
                value={fmtInt(transitions.representedStateCount)}
                color="blue"
                subtitle={t(
                  'sleep.diversity.positiveCount',
                  'States with a positive valid count',
                )}
              />
              <MetricCard
                icon={<Moon className="h-4 w-4" aria-hidden="true" />}
                label={t(
                  'sleep.diversity.asleepShare',
                  'Asleep transition share',
                )}
                value={
                  transitions.asleepShare != null
                    ? t('sleep.diversity.percent', '{{value}}%', {
                        value: fmtNumber(
                          transitions.asleepShare * 100,
                        ),
                      })
                    : '—'
                }
                color="green"
                subtitle={t(
                  'sleep.diversity.notEfficiency',
                  'Not sleep efficiency or parked-time share',
                )}
              />
            </div>
          ) : (
            // no-action: diversity requires positive transition counts from the source
            <EmptyState
              className="py-8"
              icon={<Fingerprint className="h-8 w-8" aria-hidden="true" />}
              message={t(
                'sleep.diversity.empty',
                'No positive transition destination counts are available for diversity diagnostics.',
              )}
            />
          )}
        </SleepEfficiencySectionBody>
      </GlassPanel>
    </section>
  );
}
