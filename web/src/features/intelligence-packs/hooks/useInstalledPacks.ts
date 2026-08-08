import { useQuery } from '@tanstack/react-query';

import { usePackRepositoryContext } from './packRepositoryContext';
import { intelPackQueryKeys } from './queryKeys';
import type { InstalledPackRecord } from '../lib/packRepository';

/** All locally-installed packs (IndexedDB/localStorage/in-memory, never a network fetch). */
export function useInstalledPacks() {
  const { repository } = usePackRepositoryContext();
  return useQuery<InstalledPackRecord[]>({
    queryKey: intelPackQueryKeys.installed,
    queryFn: () => repository.listInstalled(),
    staleTime: 0,
  });
}
