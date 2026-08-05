/**
 * Audit log entry shape + id/timestamp helpers. Entries are append-only and
 * capped (oldest dropped first) by the repository layer — see
 * `packRepository.ts`.
 */

import { safeRandomUUID } from '@/lib/safeUUID';

export type AuditAction =
  | 'catalog-preview'
  | 'install'
  | 'upgrade'
  | 'rollback'
  | 'uninstall'
  | 'enable'
  | 'disable'
  | 'trust-decision'
  | 'block'
  | 'verify-failed'
  | 'import'
  | 'export';

export interface AuditLogEntry {
  id: string;
  timestampIso: string;
  packId: string;
  packName: string;
  action: AuditAction;
  detail: string;
}

export interface BuildAuditEntryInput {
  packId: string;
  packName: string;
  action: AuditAction;
  detail: string;
  now?: () => Date;
}

export function buildAuditEntry({ packId, packName, action, detail, now }: BuildAuditEntryInput): AuditLogEntry {
  const clock = now ?? (() => new Date());
  return {
    id: safeRandomUUID(),
    timestampIso: clock().toISOString(),
    packId,
    packName,
    action,
    detail,
  };
}

export const MAX_AUDIT_LOG_ENTRIES = 500;
