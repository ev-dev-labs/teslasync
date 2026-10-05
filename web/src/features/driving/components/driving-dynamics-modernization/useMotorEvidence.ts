import { useMemo } from 'react';
import { useMotorHistory, type MotorHistoryQuery } from '@/api/hooks/useVehicles';
import { useDataState } from '@/hooks/useDataState';
import { INTERVALS } from '@/lib/constants';
import { computeMotorStats } from '../driving-dynamics/helpers';
import { MOTOR_HISTORY_LIMIT } from '../driving-dynamics/useMotorStats';

/** The existing request/cache/bounds/poll policy, with trust metadata exposed.
 * No wire or cached SI values are normalized, renamed or converted here. */
export function useMotorEvidence(
  vehicleId: number | null | undefined,
  window?: MotorHistoryQuery,
) {
  const query = useMotorHistory(vehicleId ?? 0, {
    limit: MOTOR_HISTORY_LIMIT,
    refetchInterval: INTERVALS.FAST,
    ...window,
  });
  const state = useDataState(query, { provenance: 'historical' });
  const motorStats = useMemo(() => computeMotorStats(state.data), [state.data]);
  return { query, state, motorStats };
}
