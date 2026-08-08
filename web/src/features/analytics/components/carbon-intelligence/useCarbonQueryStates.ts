import { useCallback, useMemo } from 'react';

import { carbonQueryState, type CarbonQueryLike } from './queryState';
import type { CarbonQueryStates } from './types';

interface CarbonQueryWithRefetch extends CarbonQueryLike {
  refetch: () => unknown;
}

interface CarbonQueryStateInput {
  intensity: CarbonQueryWithRefetch;
  period: CarbonQueryWithRefetch;
  lifetime: CarbonQueryWithRefetch;
  recommendation: CarbonQueryWithRefetch;
  vehicleSelected: boolean;
}

export function useCarbonQueryStates({
  intensity,
  period,
  lifetime,
  recommendation,
  vehicleSelected,
}: CarbonQueryStateInput): CarbonQueryStates {
  const retryIntensity = useCallback(() => {
    void intensity.refetch();
  }, [intensity.refetch]);
  const retryPeriod = useCallback(() => {
    void period.refetch();
  }, [period.refetch]);
  const retryLifetime = useCallback(() => {
    void lifetime.refetch();
  }, [lifetime.refetch]);
  const retryRecommendation = useCallback(() => {
    void recommendation.refetch();
  }, [recommendation.refetch]);

  return useMemo(
    () => ({
      intensity: carbonQueryState(intensity, true, retryIntensity),
      period: carbonQueryState(period, vehicleSelected, retryPeriod),
      lifetime: carbonQueryState(lifetime, vehicleSelected, retryLifetime),
      recommendation: carbonQueryState(
        recommendation,
        vehicleSelected,
        retryRecommendation,
      ),
    }),
    [
      intensity,
      lifetime,
      period,
      recommendation,
      retryIntensity,
      retryLifetime,
      retryPeriod,
      retryRecommendation,
      vehicleSelected,
    ],
  );
}
