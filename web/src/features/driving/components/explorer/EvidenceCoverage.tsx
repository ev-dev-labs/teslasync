import { CheckCircle2, Database, Rows3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmptyState, InlineCallout } from '@/components/feedback';
import { Badge, GlassPanel, PanelTitle } from '@/components/ui';
import { cn } from '@/lib/cn';
import { fmtInt } from '@/lib/numberFormat';

import type { ExplorerSummary } from '../../lib/explorer';
import { CoverageMetrics } from './CoverageMetrics';
import { DiscoveryCadenceSummary } from './DiscoveryCadenceSummary';
import { ExclusionAccounting } from './ExclusionAccounting';
import { ExplorerSectionBody } from './ExplorerSectionBody';
import type { ExplorerSectionState } from './types';

interface EvidenceCoverageProps {
  summary: ExplorerSummary;
  state: ExplorerSectionState;
  className?: string;
}

export function EvidenceCoverage({
  summary,
  state,
  className,
}: EvidenceCoverageProps) {
  const { t } = useTranslation();
  const eligibility = summary.eligibility;

  return (
    <section
      className={className}
      aria-label={t(
        'explorer.section.coverage',
        'Location coverage, exclusions, and discovery cadence',
      )}
      data-testid="explorer-coverage"
    >
      <GlassPanel className={cn('p-5 sm:p-6')}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <PanelTitle className="flex items-center gap-2">
            <Database className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('explorer.coverage.title', 'Coverage & discovery cadence')}
          </PanelTitle>
          <Badge
            variant={summary.historyCapReached ? 'warning' : 'neutral'}
            dot
          >
            {summary.historyCapReached
              ? t(
                  'explorer.coverage.capReached',
                  '{{limit}}-row cap reached',
                  { limit: fmtInt(summary.historyLimit) },
                )
              : t(
                  'explorer.coverage.belowCap',
                  'Observed window below the row cap',
                )}
          </Badge>
        </div>

        <ExplorerSectionBody state={state} className="mt-4 min-h-80">
          {eligibility.observed === 0 ? (
            <EmptyState /* no-action: the active filters and recorded telemetry determine this read-only result */
              className="h-full"
              icon={<Rows3 className="h-8 w-8" aria-hidden="true" />}
              message={t(
                'explorer.coverage.empty',
                'Coverage will appear when drive history is returned for the selected vehicle.',
              )}
            />
          ) : (
            <div className="space-y-5">
              <CoverageMetrics eligibility={eligibility} />
              <div className="grid gap-4 lg:grid-cols-2">
                <ExclusionAccounting exclusions={eligibility.exclusions} />
                <DiscoveryCadenceSummary summary={summary} />
              </div>
              <InlineCallout
                variant={summary.historyCapReached ? 'warning' : 'info'}
                icon={
                  summary.historyCapReached
                    ? <Rows3 aria-hidden="true" />
                    : <CheckCircle2 aria-hidden="true" />
                }
              >
                {summary.historyCapReached
                  ? t(
                      'explorer.coverage.cappedWindow',
                      'The request returned {{limit}} rows and reached the API cap. Results describe only this bounded window; older drives may be absent.',
                      { limit: fmtInt(summary.historyLimit) },
                    )
                  : t(
                      'explorer.coverage.observedWindow',
                      'Results describe {{count}} returned rows, up to the {{limit}}-row request cap.',
                      {
                        count: eligibility.observed,
                        limit: summary.historyLimit,
                      },
                    )}
              </InlineCallout>
            </div>
          )}
        </ExplorerSectionBody>
      </GlassPanel>
    </section>
  );
}
