import { useMutation, useQueryClient } from '@tanstack/react-query';

import { usePackRepositoryContext } from './packRepositoryContext';
import { intelPackQueryKeys } from './queryKeys';
import {
  installPack,
  rollbackPack,
  setPackEnabled,
  uninstallPack,
  upgradePack,
  type InstallPackInput,
  type UpgradePackInput,
} from '../lib/packActions';
import type { TrustDecision } from '../lib/trust';

/**
 * Imperative install/upgrade/rollback/uninstall/enable-disable/trust-decision
 * actions, each wired to the shared `PackRepository` and invalidating the
 * relevant TanStack Query caches afterward so every panel (installed
 * inventory, audit log, trust badges) reflects the change immediately.
 */
export function usePackActions() {
  const { repository } = usePackRepositoryContext();
  const queryClient = useQueryClient();

  function invalidateAfter(packId?: string) {
    queryClient.invalidateQueries({ queryKey: intelPackQueryKeys.installed });
    queryClient.invalidateQueries({ queryKey: ['intelligence-packs', 'audit'] });
    if (packId) queryClient.invalidateQueries({ queryKey: intelPackQueryKeys.trust(packId) });
  }

  const install = useMutation({
    mutationFn: (input: InstallPackInput) => installPack(repository, input),
    onSuccess: (record) => invalidateAfter(record.packId),
  });

  const upgrade = useMutation({
    mutationFn: (input: UpgradePackInput) => upgradePack(repository, input),
    onSuccess: (record) => invalidateAfter(record.packId),
  });

  const rollback = useMutation({
    mutationFn: (packId: string) => rollbackPack(repository, packId),
    onSuccess: (record) => invalidateAfter(record.packId),
  });

  const uninstall = useMutation({
    mutationFn: (packId: string) => uninstallPack(repository, packId),
    onSuccess: (_void, packId) => invalidateAfter(packId),
  });

  const setEnabled = useMutation({
    mutationFn: ({ packId, enabled }: { packId: string; enabled: boolean }) => setPackEnabled(repository, packId, enabled),
    onSuccess: (record) => invalidateAfter(record.packId),
  });

  const recordTrustDecision = useMutation({
    mutationFn: (decision: TrustDecision) => repository.putTrustDecision(decision),
    onSuccess: (_void, decision) => invalidateAfter(decision.packId),
  });

  return { install, upgrade, rollback, uninstall, setEnabled, recordTrustDecision };
}
