import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useSigningVault } from './useSigningVault';
import { __resetKeyRepositoryForTests } from '../lib/signingKeyRepository';
import { __resetAuditTrailForTests } from '../lib/auditTrail';

describe('useSigningVault', () => {
  beforeEach(() => {
    __resetKeyRepositoryForTests();
    __resetAuditTrailForTests();
  });

  it('loads capability/keys/audit log on mount', async () => {
    const { result } = renderHook(() => useSigningVault());
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.capability?.supported).toBe(false);
    expect(result.current.keys).toEqual([]);
    expect(result.current.activeKey).toBeNull();
  });

  it('generateKey() creates a key, records an audit entry, and refreshes state', async () => {
    const { result } = renderHook(() => useSigningVault());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.generateKey();
    });

    expect(result.current.keys).toHaveLength(1);
    expect(result.current.activeKey).not.toBeNull();
    expect(result.current.auditLog.some((e) => e.action === 'key_generated')).toBe(true);
    expect(result.current.isMutating).toBe(false);
  });

  it('rotateKey() revokes the old key and activates a new one, recording an audit entry', async () => {
    const { result } = renderHook(() => useSigningVault());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.generateKey();
    });
    const originalKeyId = result.current.activeKey?.key_id;

    await act(async () => {
      await result.current.rotateKey();
    });

    expect(result.current.activeKey?.key_id).not.toBe(originalKeyId);
    expect(result.current.keys.find((k) => k.key_id === originalKeyId)?.revoked_at).not.toBeNull();
    expect(result.current.auditLog.some((e) => e.action === 'key_rotated')).toBe(true);
  });

  it('revokeKey() revokes the given key with a reason and records an audit entry', async () => {
    const { result } = renderHook(() => useSigningVault());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.generateKey();
    });
    const keyId = result.current.activeKey!.key_id;

    await act(async () => {
      await result.current.revokeKey(keyId, 'compromised');
    });

    expect(result.current.activeKey).toBeNull();
    expect(result.current.keys.find((k) => k.key_id === keyId)?.revoked_reason).toBe('compromised');
    expect(result.current.auditLog.some((e) => e.action === 'key_revoked')).toBe(true);
  });
});
