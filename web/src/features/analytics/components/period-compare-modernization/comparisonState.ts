import { deriveDataState, type DataStateSource } from '@/api/dataState';
import type { PeriodStats } from '@/api/hooks/usePeriodStats';

/**
 * Period windows remain independent query/cache identities. A failed refresh
 * never removes either retained operand; an absent operand is never a zero.
 * The endpoint provides no completeness evidence, so we do not infer it.
 */
export function deriveComparisonState(
  sourceA: DataStateSource<PeriodStats>,
  sourceB: DataStateSource<PeriodStats>,
) {
  const stateA = deriveDataState(sourceA, { provenance: 'historical' });
  const stateB = deriveDataState(sourceB, { provenance: 'historical' });
  const hasPair = stateA.data != null && stateB.data != null;
  return {
    stateA,
    stateB,
    a: stateA.data,
    b: stateB.data,
    hasPair,
    // Only the comparison depends on both sources. Independent source
    // summaries still render the successful neighbor during initial failure.
    comparisonError: hasPair ? null : stateA.fatalError ?? stateB.fatalError,
    comparisonLoading: !hasPair && Boolean(sourceA.isLoading || sourceB.isLoading),
  };
}
