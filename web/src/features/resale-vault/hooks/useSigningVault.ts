/**
 * React state wrapper around `signingKeyRepository.ts` + `auditTrail.ts`.
 *
 * Owns nothing cryptographic itself — every actual key operation is
 * delegated to the pure repository module. This hook's only job is to
 * expose that async, module-level state as reactive React state (loading
 * flags, current capability/keys/audit log) and to log an audit entry
 * alongside every key-lifecycle action.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  detectKeyPersistenceCapability,
  generateSigningKey,
  listSigningKeys,
  revokeSigningKey,
  rotateSigningKey,
} from '../lib/signingKeyRepository';
import { listAuditEvents, recordAuditEvent } from '../lib/auditTrail';
import type { AuditEntry, SigningKeyRecord, VaultKeyCapability } from '../lib/types';

export interface UseSigningVaultResult {
  capability: VaultKeyCapability | null;
  keys: SigningKeyRecord[];
  activeKey: SigningKeyRecord | null;
  auditLog: AuditEntry[];
  isLoading: boolean;
  /** Set only while a generate/rotate/revoke action is in flight. */
  isMutating: boolean;
  error: string | null;
  generateKey: () => Promise<void>;
  rotateKey: () => Promise<void>;
  revokeKey: (keyId: string, reason: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useSigningVault(): UseSigningVaultResult {
  const [capability, setCapability] = useState<VaultKeyCapability | null>(null);
  const [keys, setKeys] = useState<SigningKeyRecord[]>([]);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [cap, keyList, audit] = await Promise.all([
        detectKeyPersistenceCapability(),
        listSigningKeys(),
        listAuditEvents(),
      ]);
      setCapability(cap);
      setKeys(keyList);
      setAuditLog(audit);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      await refresh();
      if (!cancelled) setIsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const generateKey = useCallback(async () => {
    setIsMutating(true);
    setError(null);
    try {
      const record = await generateSigningKey();
      await recordAuditEvent(
        'key_generated',
        `Generated signing key ${record.key_id} (persisted: ${record.persisted ? 'yes' : 'no, session-only'}).`,
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsMutating(false);
    }
  }, [refresh]);

  const rotateKey = useCallback(async () => {
    setIsMutating(true);
    setError(null);
    try {
      const record = await rotateSigningKey();
      await recordAuditEvent(
        'key_rotated',
        `Rotated signing key — new active key ${record.key_id}${record.rotated_from ? ` (previous: ${record.rotated_from})` : ''}.`,
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsMutating(false);
    }
  }, [refresh]);

  const revokeKey = useCallback(
    async (keyId: string, reason: string) => {
      setIsMutating(true);
      setError(null);
      try {
        await revokeSigningKey(keyId, reason);
        await recordAuditEvent('key_revoked', `Revoked signing key ${keyId} (reason: ${reason}).`);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsMutating(false);
      }
    },
    [refresh],
  );

  const activeKey = keys.find((k) => k.revoked_at === null) ?? null;

  return { capability, keys, activeKey, auditLog, isLoading, isMutating, error, generateKey, rotateKey, revokeKey, refresh };
}
