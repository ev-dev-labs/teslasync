import { useQuery } from '@tanstack/react-query';

import { usePackRepositoryContext } from './packRepositoryContext';
import { intelPackQueryKeys } from './queryKeys';
import type { AuditLogEntry } from '../lib/auditLog';

/** The local, append-only audit log for install/upgrade/rollback/uninstall/enable/disable/trust actions. */
export function useAuditLog(limit?: number) {
  const { repository } = usePackRepositoryContext();
  return useQuery<AuditLogEntry[]>({
    queryKey: intelPackQueryKeys.audit(limit),
    queryFn: () => repository.listAuditLog(limit),
    staleTime: 0,
  });
}
