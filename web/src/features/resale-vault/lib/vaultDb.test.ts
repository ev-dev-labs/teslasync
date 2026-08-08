import { describe, it, expect, afterEach } from 'vitest';
import {
  openVaultDb,
  idbPut,
  idbGet,
  idbGetAll,
  idbDelete,
  isIndexedDbAvailable,
  STORE_AUDIT_LOG,
} from './vaultDb';
import { installFakeIndexedDb, uninstallFakeIndexedDb } from './fakeIndexedDb';

describe('vaultDb (no indexedDB in this environment)', () => {
  it('isIndexedDbAvailable is false under plain jsdom/vitest', () => {
    expect(isIndexedDbAvailable()).toBe(false);
  });

  it('openVaultDb rejects explicitly rather than hanging or silently no-op-ing', async () => {
    await expect(openVaultDb()).rejects.toThrow(/indexedDB is not available/);
  });
});

describe('vaultDb (with fake IndexedDB installed)', () => {
  afterEach(() => {
    uninstallFakeIndexedDb();
  });

  it('opens the database and creates the expected object stores', async () => {
    installFakeIndexedDb();
    expect(isIndexedDbAvailable()).toBe(true);
    const db = await openVaultDb();
    expect(db.objectStoreNames.contains(STORE_AUDIT_LOG)).toBe(true);
  });

  it('round-trips put/get/getAll/delete', async () => {
    installFakeIndexedDb();
    const db = await openVaultDb();
    await idbPut(db, STORE_AUDIT_LOG, { id: 'a1', ts: '2024-01-01T00:00:00Z', action: 'key_generated', detail: 'x' });
    await idbPut(db, STORE_AUDIT_LOG, { id: 'a2', ts: '2024-01-02T00:00:00Z', action: 'report_signed', detail: 'y' });

    const one = await idbGet<{ id: string }>(db, STORE_AUDIT_LOG, 'a1');
    expect(one?.id).toBe('a1');

    const all = await idbGetAll<{ id: string }>(db, STORE_AUDIT_LOG);
    expect(all.map((r) => r.id).sort()).toEqual(['a1', 'a2']);

    await idbDelete(db, STORE_AUDIT_LOG, 'a1');
    const afterDelete = await idbGetAll<{ id: string }>(db, STORE_AUDIT_LOG);
    expect(afterDelete.map((r) => r.id)).toEqual(['a2']);
  });
});
