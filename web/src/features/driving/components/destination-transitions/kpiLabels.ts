import type { TFunction } from 'i18next';

import type { DestinationTransitionResult } from '../../lib/destinationTransitions';
import { destinationEvidenceBandLabel } from './labels';
import type { DestinationTransitionsQueryState } from './types';

export function destinationKpiPendingText(
  t: TFunction,
  state: DestinationTransitionsQueryState,
): string | null {
  if (!state.vehicleSelected) {
    return t(
      'destinationTransitions.states.selectVehicleKpi',
      'Select a vehicle above to load destination evidence.',
    );
  }
  if (state.isLoading) {
    return t(
      'destinationTransitions.states.loadingKpi',
      'Waiting for returned drive history…',
    );
  }
  if (state.error) {
    return t(
      'destinationTransitions.states.errorKpi',
      'Drive history is unavailable; use the status below to retry.',
    );
  }
  if (!state.isResolved) {
    return t(
      'destinationTransitions.states.pendingKpi',
      'Drive-history availability has not resolved.',
    );
  }
  return null;
}

export function destinationLatestKpiText(
  t: TFunction,
  model: DestinationTransitionResult,
  resolved: boolean,
  pendingText: string | null,
): string {
  if (!resolved) return pendingText ?? '';
  const capState = model.accounting.historyCapReached
    ? t(
        'destinationTransitions.kpis.capReached',
        'latest 1,000-row cap reached',
      )
    : t(
        'destinationTransitions.kpis.capNotReached',
        'returned history below the 1,000-row cap',
      );
  const latest = model.latestState;
  if (!latest) {
    if (model.latestRowCategory === 'indeterminate') {
      return t(
        'destinationTransitions.kpis.latestIndeterminate',
        'Latest row cannot be established because returned chronology is incomplete · {{capState}}',
        { capState },
      );
    }
    if (model.latestRowCategory === 'none') {
      return t(
        'destinationTransitions.kpis.latestEmpty',
        'No returned row is available · {{capState}}',
        { capState },
      );
    }
    return t(
      'destinationTransitions.kpis.latestUnusable',
      'The actual latest row is unusable, so no historical successor is shown · {{capState}}',
      { capState },
    );
  }
  const leader = latest.historicalLeadingSuccessor;
  return leader
    ? t(
        'destinationTransitions.kpis.latestLeader',
        'Historical leading successor from latest observed destination: {{place}} · {{count}}/{{total}} observed · {{band}} · {{capState}}',
        {
          place: leader.toLabel,
          count: leader.count,
          total: leader.outgoingTransitions,
          band: destinationEvidenceBandLabel(t, leader.supportBand),
          capState,
        },
      )
    : t(
        'destinationTransitions.kpis.latestNoLeader',
        'No accepted outgoing edge from this latest destination · {{capState}}',
        { capState },
      );
}
