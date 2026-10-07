import {
  CalendarCheck2,
  Activity,
  CircleGauge,
  Database,
  Route,
  TimerReset,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { GlassPanel, PanelTitle } from '@/components/ui';
import { fmtInt } from '@/lib/numberFormat';
import type { ArrivalReliabilityResult } from '../../lib/arrivalReliability';
import { arrivalIndex, arrivalPercent } from './labels';
import { ArrivalReliabilityQueryStatus } from './ArrivalReliabilityQueryStatus';
import type {
  ArrivalReliabilityQueryState,
  DurationFormatter,
} from './types';

interface ArrivalReliabilityKpiBandProps {
  analysis: ArrivalReliabilityResult;
  state: ArrivalReliabilityQueryState;
  locale: string;
  formatDuration: DurationFormatter;
}

export function ArrivalReliabilityKpiBand({
  analysis,
  state,
  locale,
  formatDuration,
}: ArrivalReliabilityKpiBandProps) {
  const { t } = useTranslation();
  const resolved = state.isResolved && !state.error;
  const unresolvedSubtitle = !state.vehicleSelected
    ? t(
        'arrivalReliability.states.selectVehicleKpi',
        'Select a vehicle above to load timing evidence.',
      )
    : state.isLoading
      ? t(
          'arrivalReliability.states.loadingKpi',
          'Waiting for returned drive history…',
        )
      : state.error
        ? t(
            'arrivalReliability.states.errorKpi',
            'Drive history is unavailable; use the status below to retry.',
          )
        : !state.isResolved
          ? t(
              'arrivalReliability.states.pendingKpi',
              'Drive-history availability has not resolved.',
            )
          : null;
  const capSubtitle = analysis.accounting.historyCapReached
    ? t('arrivalReliability.kpis.capReached', 'Latest 1,000-row cap reached')
    : t('arrivalReliability.kpis.capNotReached', 'Below the 1,000-row cap');

  return (
    <section
      aria-label={t(
        'arrivalReliability.kpis.aria',
        'Observed arrival timing evidence summary',
      )}
      data-testid="arrival-kpis"
    >
      <GlassPanel className="p-4 sm:p-5">
        <PanelTitle className="mb-4 flex items-center gap-2">
          <CircleGauge className="h-4 w-4 text-cyan-300" aria-hidden="true" />
          {t('arrivalReliability.kpis.title', 'Observed timing evidence')}
        </PanelTitle>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <MetricCard
            label={t('arrivalReliability.kpis.routes', 'Supported routes')}
            value={resolved ? fmtInt(analysis.coverage.supportedRoutes) : '—'}
            subtitle={
              unresolvedSubtitle ??
              t(
                'arrivalReliability.kpis.routeGate',
                'at least 3 drives each',
              )
            }
            icon={<Route className="h-5 w-5" />}
            color="cyan"
          />
          <MetricCard
            label={t('arrivalReliability.kpis.included', 'Included drives')}
            value={resolved ? fmtInt(analysis.accounting.includedRows) : '—'}
            subtitle={
              unresolvedSubtitle ??
              t(
                'arrivalReliability.kpis.returned',
                '{{count}} rows returned',
                { count: analysis.accounting.returnedRows },
              )
            }
            icon={<Database className="h-5 w-5" />}
            color="blue"
          />
          <MetricCard
            label={t(
              'arrivalReliability.kpis.coverage',
              'Repeated-route coverage',
            )}
            value={
              resolved
                ? arrivalPercent(
                    analysis.coverage.repeatedRouteCoverage,
                    locale,
                  )
                : '—'
            }
            subtitle={
              unresolvedSubtitle ??
              t(
                'arrivalReliability.kpis.coverageHint',
                'included drives on supported routes',
              )
            }
            icon={<CalendarCheck2 className="h-5 w-5" />}
            color="green"
          />
          <MetricCard
            label={t(
              'arrivalReliability.kpis.consistency',
              'Timing consistency index',
            )}
            value={
              resolved
                ? arrivalIndex(
                    analysis.aggregate.timingConsistencyIndex,
                    locale,
                  )
                : '—'
            }
            subtitle={
              unresolvedSubtitle ??
              t(
                'arrivalReliability.kpis.descriptive',
                'descriptive 0–100 index',
              )
            }
            icon={<Activity className="h-5 w-5" />}
            color="purple"
          />
          <MetricCard
            label={t(
              'arrivalReliability.kpis.allowanceShare',
              'Observed within-allowance share',
            )}
            value={
              resolved
                ? arrivalPercent(
                    analysis.aggregate.withinAllowanceShare,
                    locale,
                  )
                : '—'
            }
            subtitle={
              unresolvedSubtitle ??
              t(
                'arrivalReliability.kpis.inSample',
                'in-sample route observations',
              )
            }
            icon={<CalendarCheck2 className="h-5 w-5" />}
            color="green"
          />
          <MetricCard
            label={t(
              'arrivalReliability.kpis.p90Buffer',
              'Observed p90 buffer',
            )}
            value={
              resolved
                ? formatDuration(
                    analysis.aggregate.sampleWeightedP90BufferS,
                    { precision: 1 },
                  )
                : '—'
            }
            subtitle={unresolvedSubtitle ?? capSubtitle}
            icon={<TimerReset className="h-5 w-5" />}
            color="amber"
          />
        </div>
        <ArrivalReliabilityQueryStatus analysis={analysis} state={state} />
      </GlassPanel>
    </section>
  );
}
