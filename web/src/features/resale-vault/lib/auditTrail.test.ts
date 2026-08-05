import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { recordAuditEvent, listAuditEvents, __resetAuditTrailForTests } from './auditTrail';
import { installFakeIndexedDb, uninstallFakeIndexedDb } from './fakeIndexedDb';

describe('auditTrail — no IndexedDB (in-memory session log)', () => {
  beforeEach(() => {
    __resetAuditTrailForTests();
  });

  it('starts empty', async () => {
    expect(await listAuditEvents()).toEqual([]);
  });

  it('appends entries and returns them newest-first', async () => {
    const first = await recordAuditEvent('key_generated', 'Generated signing key key_abc');
    const second = await recordAuditEvent('report_signed', 'Signed report report_0001');
    const entries = await listAuditEvents();
    expect(entries.map((e) => e.id)).toEqual([second.id, first.id]);
    expect(entries[1]?.action).toBe('key_generated');
  });

  it('each entry gets a unique id and an ISO timestamp', async () => {
    const a = await recordAuditEvent('report_exported', 'Exported report');
    const b = await recordAuditEvent('report_exported', 'Exported report');
    expect(a.id).not.toBe(b.id);
    expect(() => new Date(a.ts).toISOString()).not.toThrow();
  });
});

describe('auditTrail — with fake IndexedDB installed', () => {
  beforeEach(() => {
    __resetAuditTrailForTests();
    installFakeIndexedDb();
  });
  afterEach(() => {
    uninstallFakeIndexedDb();
  });

  it('persists entries such that a fresh hydration (simulated reload) sees them again', async () => {
    const entry = await recordAuditEvent('report_verified', 'Verified imported report');
    __resetAuditTrailForTests();
    const entries = await listAuditEvents();
    expect(entries.map((e) => e.id)).toContain(entry.id);
  });
});
