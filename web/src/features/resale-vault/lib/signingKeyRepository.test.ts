import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  detectKeyPersistenceCapability,
  generateSigningKey,
  listSigningKeys,
  getActiveSigningKeyRecord,
  getPrivateKeyHandle,
  revokeSigningKey,
  rotateSigningKey,
  __resetKeyRepositoryForTests,
  subscribeSigningKeys,
  getSigningKeysSnapshot,
} from './signingKeyRepository';
import { installFakeIndexedDb, uninstallFakeIndexedDb } from './fakeIndexedDb';
import { openVaultDb, STORE_SIGNING_KEYS, STORE_KEY_REGISTRY } from './vaultDb';

describe('signingKeyRepository — no IndexedDB (secure-session-only fallback)', () => {
  beforeEach(() => {
    __resetKeyRepositoryForTests();
  });

  it('reports persistence as unsupported with an explicit human-readable reason', async () => {
    const capability = await detectKeyPersistenceCapability();
    expect(capability.supported).toBe(false);
    expect(capability.reason).toMatch(/session/i);
  });

  it('still generates a working key pair, marked persisted:false', async () => {
    const record = await generateSigningKey();
    expect(record.persisted).toBe(false);
    expect(record.revoked_at).toBeNull();
    expect(record.public_jwk.kty).toBe('EC');
    expect(record.public_jwk.crv).toBe('P-256');

    const handle = await getPrivateKeyHandle(record.key_id);
    expect(handle).not.toBeNull();
    expect(handle?.type).toBe('private');
    expect(handle?.extractable).toBe(false);
  });

  it('getActiveSigningKeyRecord returns the newest non-revoked key', async () => {
    const first = await generateSigningKey();
    const second = await generateSigningKey();
    const active = await getActiveSigningKeyRecord();
    expect(active?.key_id).toBe(second.key_id);
    expect(active?.key_id).not.toBe(first.key_id);
  });

  it('revokeSigningKey marks the key revoked with a reason, and it drops out of "active"', async () => {
    const record = await generateSigningKey();
    const revoked = await revokeSigningKey(record.key_id, 'compromised');
    expect(revoked?.revoked_at).not.toBeNull();
    expect(revoked?.revoked_reason).toBe('compromised');
    expect(await getActiveSigningKeyRecord()).toBeNull();

    const listed = await listSigningKeys();
    expect(listed.find((k) => k.key_id === record.key_id)?.revoked_at).not.toBeNull();
  });

  it('rotateSigningKey revokes the current key (reason "rotated") and links the new key via rotated_from', async () => {
    const original = await generateSigningKey();
    const rotated = await rotateSigningKey();
    expect(rotated.key_id).not.toBe(original.key_id);
    expect(rotated.rotated_from).toBe(original.key_id);
    expect(rotated.revoked_at).toBeNull();

    const listed = await listSigningKeys();
    const originalAfter = listed.find((k) => k.key_id === original.key_id);
    expect(originalAfter?.revoked_at).not.toBeNull();
    expect(originalAfter?.revoked_reason).toBe('rotated');

    const active = await getActiveSigningKeyRecord();
    expect(active?.key_id).toBe(rotated.key_id);
  });

  it('getPrivateKeyHandle returns null for an unknown key id (e.g. lost session-only key after reload)', async () => {
    expect(await getPrivateKeyHandle('key_does_not_exist')).toBeNull();
  });

  it('publishes automatic generation and revocation without requiring a refresh', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSigningKeys(listener);
    try {
      const record = await generateSigningKey();
      expect(getSigningKeysSnapshot()).toEqual([record]);
      expect(listener).toHaveBeenCalledOnce();
      const revoked = await revokeSigningKey(record.key_id, 'manual');
      expect(getSigningKeysSnapshot()).toEqual([revoked]);
      expect(listener).toHaveBeenCalledTimes(2);
      unsubscribe();
      await generateSigningKey();
      expect(listener).toHaveBeenCalledTimes(2);
    } finally {
      unsubscribe();
    }
  });

  it('publishes a partially applied rotation while preserving its generation rejection', async () => {
    const original = await generateSigningKey();
    const listener = vi.fn();
    const unsubscribe = subscribeSigningKeys(listener);
    const generate = vi.spyOn(crypto.subtle, 'generateKey').mockRejectedValueOnce(new Error('Generation denied'));
    try {
      await expect(rotateSigningKey()).rejects.toThrow('Generation denied');
      expect(listener).toHaveBeenCalledOnce();
      expect(getSigningKeysSnapshot()[0]?.revoked_reason).toBe('rotated');
      expect(getSigningKeysSnapshot()[0]?.key_id).toBe(original.key_id);
      expect(await getActiveSigningKeyRecord()).toBeNull();
    } finally {
      generate.mockRestore();
      unsubscribe();
    }
  });
});

describe('signingKeyRepository — with fake IndexedDB installed (persisted path)', () => {
  let failWrite: 'abort' | 'error' | 'registry' | null;
  let holdWrite: boolean;
  let completeWrite: (() => void) | undefined;
  let writeStores: string | string[];

  beforeEach(async () => {
    __resetKeyRepositoryForTests();
    installFakeIndexedDb();
    failWrite = null;
    holdWrite = false;
    completeWrite = undefined;
    const db = await openVaultDb();
    const transaction = db.transaction.bind(db);
    // The existing fake models requests only. Add transaction lifecycle events
    // here so request success cannot stand in for a committed write.
    vi.spyOn(db, 'transaction').mockImplementation((stores, mode) => {
      const tx = transaction(stores, mode);
      if (mode !== 'readwrite') return tx;
      writeStores = stores;
      tx.abort = vi.fn();
      const failure = failWrite;
      if (failure === 'registry') {
        const objectStore = tx.objectStore.bind(tx);
        vi.spyOn(tx, 'objectStore').mockImplementation((name) => {
          const store = objectStore(name);
          if (name === STORE_KEY_REGISTRY) {
            vi.spyOn(store, 'put').mockImplementation(() => {
              throw new Error('Registry write denied');
            });
          }
          return store;
        });
      }
      const finish = () => {
        const event = new Event(failure === 'abort' ? 'abort' : failure === 'error' ? 'error' : 'complete');
        if (failure === 'abort') tx.onabort?.call(tx, event);
        else if (failure === 'error') tx.onerror?.call(tx, event);
        else if (failure !== 'registry') tx.oncomplete?.call(tx, event);
      };
      if (holdWrite) completeWrite = finish;
      else setTimeout(finish, 0);
      return tx;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    uninstallFakeIndexedDb();
  });

  it('reports persistence as supported', async () => {
    const capability = await detectKeyPersistenceCapability();
    expect(capability.supported).toBe(true);
    expect(capability.reason).toBeNull();
  });

  it('marks generated keys persisted:true', async () => {
    const record = await generateSigningKey();
    expect(record.persisted).toBe(true);
  });

  it('does not publish a persisted key until the key and registry transaction completes', async () => {
    await listSigningKeys();
    holdWrite = true;
    let settled = false;
    const pending = generateSigningKey().then((record) => {
      settled = true;
      return record;
    });
    await vi.waitFor(() => expect(completeWrite).toBeDefined());
    expect(writeStores).toEqual([STORE_SIGNING_KEYS, STORE_KEY_REGISTRY]);
    expect(settled).toBe(false);
    expect(await listSigningKeys()).toEqual([]);
    completeWrite!();
    expect((await pending).persisted).toBe(true);
  });

  it.each(['abort', 'error', 'registry'] as const)(
    'downgrades %s after request success to a usable session-only key',
    async (failure) => {
      await listSigningKeys();
      failWrite = failure;
      const record = await generateSigningKey();
      expect(record.persisted).toBe(false);
      expect((await getActiveSigningKeyRecord())?.persisted).toBe(false);
      expect(await getPrivateKeyHandle(record.key_id)).not.toBeNull();
      expect(await detectKeyPersistenceCapability()).toEqual({
        supported: false,
        reason: expect.stringMatching(/persistence failed.*session-only/i),
      });
    },
  );

  it('downgrades a failed revocation registry commit without losing the populated history', async () => {
    const record = await generateSigningKey();
    failWrite = 'abort';
    const revoked = await revokeSigningKey(record.key_id, 'compromised');
    expect(revoked?.persisted).toBe(false);
    expect(revoked?.revoked_reason).toBe('compromised');
    expect(await getActiveSigningKeyRecord()).toBeNull();
    expect(await listSigningKeys()).toEqual([revoked]);
  });

  it('survives a simulated reload: memory cache reset + IndexedDB re-hydration restores the key and registry', async () => {
    const record = await generateSigningKey();

    // Simulate a page reload: wipe the repository's in-memory caches only.
    // We deliberately do NOT call installFakeIndexedDb()/uninstallFakeIndexedDb()
    // again here — the fake's underlying `sharedDb` singleton is left in
    // place, standing in for the browser's durable IndexedDB storage
    // surviving across a real reload.
    __resetKeyRepositoryForTests();

    const rehydratedKeys = await listSigningKeys();
    expect(rehydratedKeys.map((k) => k.key_id)).toContain(record.key_id);

    const handle = await getPrivateKeyHandle(record.key_id);
    expect(handle).not.toBeNull();
  });
});
