import { Layers3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricBar } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { Badge, GlassPanel, PanelTitle, Text } from '@/components/ui';
import { CHART_COLORS } from '@/lib/colors';
import { fmtNumber } from '@/lib/numberFormat';
import { sleepStateLabel } from './labels';
import { SleepEfficiencySectionBody } from './SleepEfficiencySectionBody';
import type { SleepEfficiencySectionProps } from './types';

export function TransitionCompositionPanel({
  analysis,
  state,
}: SleepEfficiencySectionProps) {
  const { t } = useTranslation();
  const rows = analysis.transitions.states;

  return (
    <section data-testid="sleep-efficiency-transition-composition">
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-1 flex items-center gap-2">
          <Layers3 className="h-4 w-4 text-purple-300" aria-hidden="true" />
          {t(
            'sleep.composition.title',
            'Transition composition profile',
          )}
        </PanelTitle>
        <Text as="p" variant="caption" className="mb-4">
          {t(
            'sleep.composition.subtitle',
            'Each share uses valid destination counts only. Unknown non-empty state names remain visible rather than being discarded.',
          )}
        </Text>
        <SleepEfficiencySectionBody state={state}>
          {rows.length > 0 ? (
            <div className="space-y-4">
              {rows.map((row, index) => (
                <div key={row.state}>
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Text variant="bodySm" weight="medium">
                        {sleepStateLabel(t, row.state)}
                      </Text>
                      {!row.known && (
                        <Badge variant="warning" size="sm">
                          {t('sleep.composition.unknown', 'Unknown state')}
                        </Badge>
                      )}
                    </div>
                    <Text variant="caption" className="font-mono tabular-nums">
                      {t(
                        'sleep.composition.countShare',
                        '{{count}} · {{share}}%',
                        {
                          count: row.count,
                          share:
                            row.countShare != null
                              ? fmtNumber(row.countShare * 100)
                              : '—',
                        },
                      )}
                    </Text>
                  </div>
                  <MetricBar
                    label={t(
                      'sleep.composition.countShareLabel',
                      'Count share',
                    )}
                    value={(row.countShare ?? 0) * 100}
                    max={100}
                    color={
                      CHART_COLORS[index % CHART_COLORS.length]
                      ?? CHART_COLORS[0]
                    }
                    sublabel={
                      row.countShare != null
                        ? t('sleep.composition.percent', '{{value}}%', {
                            value: fmtNumber(row.countShare * 100),
                          })
                        : '—'
                    }
                  />
                </div>
              ))}
            </div>
          ) : (
            // no-action: transition rows are populated by vehicle telemetry
            <EmptyState
              className="py-8"
              icon={<Layers3 className="h-8 w-8" aria-hidden="true" />}
              message={t(
                'sleep.composition.empty',
                'No valid state rows are available for a count composition.',
              )}
            />
          )}
        </SleepEfficiencySectionBody>
      </GlassPanel>
    </section>
  );
}
