import {
  Activity,
  Database,
  MapPin,
  Network,
  Route,
  Signpost,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { MetricCard } from '@/components/data-display';
import { fmtInt } from '@/lib/numberFormat';
import type { DestinationTransitionResult } from '../../lib/destinationTransitions';
import {
  destinationBits,
  destinationIndex,
  destinationPercent,
} from './labels';
import {
  destinationKpiPendingText,
  destinationLatestKpiText,
} from './kpiLabels';
import type { DestinationTransitionsQueryState } from './types';

interface DestinationTransitionsKpiCardsProps {
  model: DestinationTransitionResult;
  state: DestinationTransitionsQueryState;
  locale: string;
}

export function DestinationTransitionsKpiCards({
  model,
  state,
  locale,
}: DestinationTransitionsKpiCardsProps) {
  const { t } = useTranslation();
  const resolved = state.isResolved && !state.error;
  const unresolvedSubtitle = destinationKpiPendingText(t, state);
  const latest = model.latestState;
  const latestSubtitle = destinationLatestKpiText(
    t,
    model,
    resolved,
    unresolvedSubtitle,
  );

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
      <MetricCard
        label={t(
          'destinationTransitions.kpis.includedVisits',
          'Included destination visits',
        )}
        value={resolved ? fmtInt(model.includedVisits) : '—'}
        subtitle={
          unresolvedSubtitle
          ?? t(
            'destinationTransitions.kpis.returnedRows',
            '{{count}} rows returned',
            { count: model.accounting.returnedRows },
          )
        }
        icon={<Database className="h-5 w-5" />}
        color="blue"
      />
      <MetricCard
        label={t(
          'destinationTransitions.kpis.acceptedTransitions',
          'Accepted transitions',
        )}
        value={resolved ? fmtInt(model.acceptedTransitions) : '—'}
        subtitle={
          unresolvedSubtitle
          ?? t(
            'destinationTransitions.kpis.candidatePairs',
            '{{count}} adjacent candidate pairs',
            { count: model.continuity.adjacentCandidatePairs },
          )
        }
        icon={<Network className="h-5 w-5" />}
        color="purple"
      />
      <MetricCard
        label={t(
          'destinationTransitions.kpis.uniqueDestinations',
          'Unique destinations',
        )}
        value={resolved ? fmtInt(model.uniqueDestinations) : '—'}
        subtitle={
          unresolvedSubtitle
          ?? t(
            'destinationTransitions.kpis.normalizedStates',
            'normalized end-location states',
          )
        }
        icon={<MapPin className="h-5 w-5" />}
        color="cyan"
      />
      <MetricCard
        label={t(
          'destinationTransitions.kpis.supportedOrigins',
          'Supported origin states',
        )}
        value={
          resolved
            ? fmtInt(model.evidence.supportedOriginStates)
            : '—'
        }
        subtitle={
          unresolvedSubtitle
          ?? t(
            'destinationTransitions.kpis.supportedCoverage',
            '{{coverage}} of accepted transitions · at least 3 outgoing each',
            {
              coverage: destinationPercent(
                model.evidence.supportedOriginTransitionCoverage,
                locale,
              ),
            },
          )
        }
        icon={<Route className="h-5 w-5" />}
        color="green"
      />
      <MetricCard
        label={t(
          'destinationTransitions.kpis.concentration',
          'Transition concentration index',
        )}
        value={
          resolved
            ? destinationIndex(
                model.evidence.transitionConcentrationIndex,
                locale,
              )
            : '—'
        }
        subtitle={
          unresolvedSubtitle
          ?? t(
            'destinationTransitions.kpis.entropyDetail',
            '{{bits}} weighted entropy bits · {{effective}} effective successors',
            {
              bits: destinationBits(
                model.evidence.weightedEntropyBits,
                locale,
              ),
              effective:
                model.evidence.effectiveSuccessorCount != null
                  ? fmtInt(model.evidence.effectiveSuccessorCount)
                  : '—',
            },
          )
        }
        icon={<Activity className="h-5 w-5" />}
        color="amber"
      />
      <MetricCard
        label={t(
          'destinationTransitions.kpis.latestDestination',
          'Latest observed destination',
        )}
        value={resolved && latest ? latest.label : '—'}
        subtitle={latestSubtitle}
        className="[&_.truncate]:overflow-visible [&_.truncate]:whitespace-normal"
        icon={<Signpost className="h-5 w-5" />}
        color="cyan"
      />
    </div>
  );
}
