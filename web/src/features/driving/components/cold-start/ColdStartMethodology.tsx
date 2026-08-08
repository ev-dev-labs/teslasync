import { CheckCircle2, FlaskConical, Info } from 'lucide-react';
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

import {
  COLD_GAP_HOURS,
  MIN_GROUP_DRIVES,
  WARM_GAP_HOURS,
  type ColdStartSummary,
} from '../../lib/coldStart';
import { ColdStartSectionBody } from './ColdStartSectionBody';
import type { ColdStartSectionState } from './types';

interface ColdStartMethodologyProps {
  summary: ColdStartSummary;
  observedDrives: number;
  windowLimit: number;
  state: ColdStartSectionState;
  className?: string;
}

/** Confidence, coverage, and bounded-window interpretation in one compact panel. */
export function ColdStartMethodology({
  summary,
  observedDrives,
  windowLimit,
  state,
  className,
}: ColdStartMethodologyProps) {
  const { t } = useTranslation();
  const classified = summary.cold.drives + summary.warm.drives;
  const capped = observedDrives >= windowLimit;

  return (
    <GlassPanel
      className={cn('h-full p-5 sm:p-6', className)}
      role="region"
      aria-label={t('coldStart.sections.method', 'Confidence and methodology')}
      data-testid="cold-start-method"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <PanelTitle className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-purple-300" aria-hidden="true" />
          {t('coldStart.method.title', 'Confidence & method')}
        </PanelTitle>
        <Badge variant={summary.sampleSufficient ? 'success' : 'warning'} dot>
          {summary.sampleSufficient
            ? t('coldStart.method.ready', 'Penalty claim supported')
            : t('coldStart.method.building', 'More samples needed')}
        </Badge>
      </div>

      <ColdStartSectionBody state={state} className="mt-4 min-h-64">
        {observedDrives === 0 ? (
          <EmptyState /* no-action: confidence populates automatically as the selected window returns drives. */
            className="h-full"
            icon={<Info className="h-8 w-8" aria-hidden="true" />}
            message={t(
              'coldStart.method.empty',
              'Method confidence will appear when drives are returned for the selected observed window.',
            )}
          />
        ) : (
          <div className="flex min-h-64 flex-col justify-between gap-4">
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-[var(--surface-2)] p-3">
                <MetricValue>{summary.cold.drives}/{MIN_GROUP_DRIVES}</MetricValue>
                <MetricLabel>{t('coldStart.method.coldEvidence', 'Cold evidence')}</MetricLabel>
              </div>
              <div className="rounded-xl bg-[var(--surface-2)] p-3">
                <MetricValue>{summary.warm.drives}/{MIN_GROUP_DRIVES}</MetricValue>
                <MetricLabel>{t('coldStart.method.warmEvidence', 'Warm evidence')}</MetricLabel>
              </div>
              <div className="rounded-xl bg-[var(--surface-2)] p-3">
                <MetricValue>{classified}</MetricValue>
                <MetricLabel>{t('coldStart.method.classified', 'Classified')}</MetricLabel>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" aria-hidden="true" />
                <Text as="p" variant="bodySm">
                  {t(
                    'coldStart.method.thresholds',
                    'Warm is ≤{{warm}} h, cold is ≥{{cold}} h, and {{ambiguous}} observations between them remain ambiguous.',
                    {
                      warm: WARM_GAP_HOURS,
                      cold: COLD_GAP_HOURS,
                      ambiguous: summary.ambiguous,
                    },
                  )}
                </Text>
              </div>
              <div className="flex items-start gap-2">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" aria-hidden="true" />
                <Text as="p" variant="bodySm">
                  {t(
                    'coldStart.method.coverage',
                    '{{unclassified}} usable drives could not be classified, including the first observed drive when its preceding park falls outside the window.',
                    { unclassified: summary.unclassified },
                  )}
                </Text>
              </div>
            </div>

            <div className="rounded-xl border border-[var(--border-subtle)] p-3">
              <Text as="p" variant="caption">
                {capped
                  ? t(
                      'coldStart.method.capped',
                      'The selected observed window reached the {{limit}}-drive API cap; older drives inside the range may not be represented.',
                      { limit: windowLimit },
                    )
                  : t(
                      'coldStart.method.window',
                      'This analysis uses {{count}} drives returned for the selected observed window (up to {{limit}}). Consumption is distance-weighted; only drives of at least 1 km with measured energy qualify.',
                      { count: observedDrives, limit: windowLimit },
                    )}
              </Text>
            </div>
          </div>
        )}
      </ColdStartSectionBody>
    </GlassPanel>
  );
}
