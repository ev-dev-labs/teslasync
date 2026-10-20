import type { DataState } from '@/api/dataState';
import type { OperationalTone } from '@/components/data-display';

type Translate = (key: string, fallback: string) => string;
type Source = Pick<DataState<unknown>, 'status' | 'isRefreshing'>;

export function sourceBriefStatus(source: Source, loading: boolean, t: Translate) {
  const status = source.isRefreshing ? 'refreshing' : loading ? 'loading' : source.status;
  const labels = {
    initial: 'Awaiting source', initialFailure: 'Source unavailable', ok: 'Source loaded',
    stale: 'Retained source', partial: 'Partial source', unavailable: 'No source data',
    refreshing: 'Refreshing source', loading: 'Loading source',
  };
  const tone: OperationalTone = status === 'initialFailure' ? 'danger'
    : status === 'stale' || status === 'partial' ? 'warning' : 'neutral';
  return { statusLabel: t(`operations.sourceStatus.${status}`, labels[status]), statusTone: tone };
}
