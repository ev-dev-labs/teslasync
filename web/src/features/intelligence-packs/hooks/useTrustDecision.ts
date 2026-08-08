import { useQuery } from '@tanstack/react-query';

import { usePackRepositoryContext } from './packRepositoryContext';
import { intelPackQueryKeys } from './queryKeys';
import type { TrustDecision } from '../lib/trust';

/** The recorded local trust decision (if any) for a given pack id. */
export function useTrustDecision(packId: string | null | undefined) {
  const { repository } = usePackRepositoryContext();
  return useQuery<TrustDecision | null>({
    queryKey: intelPackQueryKeys.trust(packId ?? ''),
    queryFn: () => repository.getTrustDecision(packId as string),
    enabled: Boolean(packId),
    staleTime: 0,
  });
}
