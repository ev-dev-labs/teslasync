import { History, Repeat2, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricBar } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import {
  Badge,
  GlassPanel,
  MetricLabel,
  MetricValue,
  PanelTitle,
  Text,
} from '@/components/ui';
import { CHART_COLORS } from '@/components/charts';
import { cn } from '@/lib/cn';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';

import type { ExplorerSummary } from '../../lib/explorer';
import { ExplorerSectionBody } from './ExplorerSectionBody';
import type { ExplorerSectionState } from './types';

interface NewRepeatBehaviorProps {
  summary: ExplorerSummary;
  state: ExplorerSectionState;
  className?: string;
}

export function NewRepeatBehavior({
  summary,
  state,
  className,
}: NewRepeatBehaviorProps) {
  const { t } = useTranslation();
  const behavior = summary.repeatBehavior;
  const newPercent = (behavior.newShare ?? 0) * 100;
  const repeatPercent = (behavior.repeatShare ?? 0) * 100;

  return (
    <section
      className={className}
      aria-label={t(
        'explorer.section.behavior',
        'New versus repeat destination behavior',
      )}
      data-testid="explorer-new-repeat"
    >
      <GlassPanel className={cn('h-full p-5 sm:p-6')}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <PanelTitle className="flex items-center gap-2">
            <Repeat2 className="h-4 w-4 text-emerald-300" aria-hidden="true" />
            {t('explorer.behavior.title', 'New vs repeat behavior')}
          </PanelTitle>
          <Badge
            variant={
              summary.evidence.behaviorSufficient ? 'success' : 'warning'
            }
            dot
          >
            {summary.evidence.behaviorSufficient
              ? t(
                  'explorer.behavior.supported',
                  'Behavior mix supported',
                )
              : t(
                  'explorer.behavior.building',
                  'More arrivals needed',
                )}
          </Badge>
        </div>

        <ExplorerSectionBody state={state} className="mt-4 min-h-72">
          {behavior.destinationArrivals === 0 ? (
            <EmptyState
              className="h-full"
              icon={<History className="h-8 w-8" aria-hidden="true" />}
              message={t(
                'explorer.behavior.empty',
                'No non-base destination arrivals are available to classify as new or repeat.',
              )}
            />
          ) : (
            <div className="flex min-h-72 flex-col justify-between gap-5">
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-xl bg-[var(--surface-2)] p-3">
                  <MetricValue>{fmtInt(behavior.destinationArrivals)}</MetricValue>
                  <MetricLabel>
                    {t(
                      'explorer.behavior.destinationArrivals',
                      'Destination arrivals',
                    )}
                  </MetricLabel>
                </div>
                <div className="rounded-xl bg-[var(--surface-2)] p-3">
                  <MetricValue>{fmtInt(behavior.newArrivals)}</MetricValue>
                  <MetricLabel>
                    {t('explorer.behavior.firstArrivals', 'First arrivals')}
                  </MetricLabel>
                </div>
                <div className="rounded-xl bg-[var(--surface-2)] p-3">
                  <MetricValue>{fmtInt(behavior.repeatArrivals)}</MetricValue>
                  <MetricLabel>
                    {t('explorer.behavior.returnArrivals', 'Return arrivals')}
                  </MetricLabel>
                </div>
              </div>

              <div className="space-y-4">
                <MetricBar
                  value={newPercent}
                  max={100}
                  color={CHART_COLORS[1]}
                  label={t(
                    'explorer.behavior.newShare',
                    'First-arrival share',
                  )}
                  sublabel={t(
                    'explorer.behavior.percentValue',
                    '{{value}}%',
                    { value: fmtNumber(newPercent, 0) },
                  )}
                />
                <MetricBar
                  value={repeatPercent}
                  max={100}
                  color={CHART_COLORS[0]}
                  label={t(
                    'explorer.behavior.repeatShare',
                    'Repeat-arrival share',
                  )}
                  sublabel={t(
                    'explorer.behavior.percentValue',
                    '{{value}}%',
                    { value: fmtNumber(repeatPercent, 0) },
                  )}
                />
              </div>

              <div className="flex items-start gap-2 rounded-xl border border-[var(--border-subtle)] p-3">
                <Sparkles
                  className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300"
                  aria-hidden="true"
                />
                <Text as="p" variant="caption">
                  {t(
                    'explorer.behavior.definition',
                    'The first chronological arrival in each destination cluster is new; later arrivals to that same cluster are repeat.',
                  )}
                </Text>
              </div>
            </div>
          )}
        </ExplorerSectionBody>
      </GlassPanel>
    </section>
  );
}
