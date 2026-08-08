import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  detectKeyPersistenceCapability,
  generateSigningKey,
  listSigningKeys,
  getActiveSigningKeyRecord,
  getPrivateKeyHandle,
  revokeSigningKey,
  rotateSigningKey,
  __resetKeyRepositoryForTests,
} from './signingKeyRepository';
import { installFakeIndexedDb, uninstallFakeIndexedDb } from './fakeIndexedDb';

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
});

describe('signingKeyRepository — with fake IndexedDB installed (persisted path)', () => {
  beforeEach(() => {
    __resetKeyRepositoryForTests();
    installFakeIndexedDb();
  });
  afterEach(() => {
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
