import { useMemo } from 'react';

import { useMotorHistory } from '@/api/hooks/useVehicles';
import { INTERVALS } from '@/lib/constants';
import { computeMotorStats, type MotorStats } from './helpers';

export const MOTOR_HISTORY_LIMIT = 200;

export interface UseMotorStatsResult {
  motorStats: MotorStats | null;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
}

/**
 * Aggregate motor statistics over the recent history window.
 *
 * Four panels on the Driving Dynamics page (summary KPIs, efficiency
 * insights, history charts and the style recommendations) all derive from the
 * same `/motor` history window. Each calls this hook rather than receiving a
 * prop computed once by the page: TanStack dedupes on the shared
 * `['motor-history', vehicleId, limit]` key, so the panels still share a
 * single in-flight request and a single cache entry while each one owns its
 * own loading / error state.
 *
 * The window refreshes at FAST cadence. It aggregates a rolling 200-row
 * window, so it genuinely does change as new telemetry lands — the page used
 * to fetch it exactly once and leave every derived panel frozen for the
 * lifetime of the route.
 */
export function useMotorStats(vehicleId: number | null | undefined): UseMotorStatsResult {
  const { data, isLoading, isError, error, refetch } = useMotorHistory(
    vehicleId ?? 0,
    MOTOR_HISTORY_LIMIT,
    INTERVALS.FAST,
  );

  const motorStats = useMemo(() => computeMotorStats(data), [data]);

  return {
    motorStats,
    isLoading,
    isError,
    error,
    refetch: () => {
      void refetch();
    },
  };
}
